#!/usr/bin/env node
/**
 * spend-lens collector — parses Claude Code JSONL transcripts into a usage snapshot.
 *
 * Usage: node collector/collect.mjs [--source <dir>] [--out <file>] [--no-push] [--verbose]
 *
 * Zero npm dependencies (node:fs / node:readline / node:https only). Node >= 20.
 * - Full rescan with per-file cache (collector/.cache/files.json keyed by path+size+mtime)
 *   storing per-file pre-aggregates; only changed files are re-parsed.
 * - Streaming line reader, tolerates malformed lines (counted).
 * - Dedup: same API response is written on multiple lines (same message.id + requestId,
 *   identical usage). Dedup key: message.id ?? requestId; keep LAST occurrence (globally,
 *   files processed in mtime order).
 * - Day bucketing in Europe/Kyiv.
 * - Pricing: LiteLLM fetch (5s timeout, cached) with silent fallback to pricing.json.
 * - After writing the snapshot: push aggregates to Supabase (skipped silently when
 *   collector/.env is absent, or when --no-push).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { httpsGetJson } from './http.mjs';
import { pushToSupabase } from './push.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '.cache');
const FILE_CACHE = path.join(CACHE_DIR, 'files.json');
const LITELLM_CACHE = path.join(CACHE_DIR, 'litellm.json');
const PRICING_FALLBACK = path.join(__dirname, 'pricing.json');
const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_VERSION = 3;
const TZ = 'Europe/Kyiv';
const PARSE_CONCURRENCY = 8;

// ---------------------------------------------------------------- CLI args

function parseArgs(argv) {
  const args = {
    source: path.join(os.homedir(), '.claude', 'projects'),
    out: path.resolve(__dirname, '..', 'web', 'public', 'data', 'usage.json'),
    push: true,
    verbose: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = path.resolve(argv[++i]);
    else if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--no-push') args.push = false;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node collector/collect.mjs [--source <dir>] [--out <file>] [--no-push] [--verbose]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

// ---------------------------------------------------------------- fs helpers

function walkJsonl(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(p, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, obj, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------- day bucketing (Europe/Kyiv)

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dayMemo = new Map(); // hour bucket -> "YYYY-MM-DD"
function kyivDay(tsMs) {
  const hour = Math.floor(tsMs / 3600000);
  let d = dayMemo.get(hour);
  if (d === undefined) {
    d = dayFmt.format(tsMs);
    dayMemo.set(hour, d);
  }
  return d;
}

// ---------------------------------------------------------------- title cleaning

function cleanTitle(s) {
  if (!s || typeof s !== 'string') return '';
  let t = s;
  t = t.replace(/<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g, ' ');
  t = t.replace(/<command-name>([\s\S]*?)<\/command-name>/g, ' $1 ');
  t = t.replace(/<command-message>[\s\S]*?<\/command-message>/g, ' ');
  t = t.replace(/<command-args>([\s\S]*?)<\/command-args>/g, ' $1 ');
  t = t.replace(/<local-command-stdout>[\s\S]*?(<\/local-command-stdout>|$)/g, ' ');
  t = t.replace(/<[a-zA-Z][^>\n]{0,60}>|<\/[a-zA-Z][^>\n]{0,60}>/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > 110) t = t.slice(0, 109).trimEnd() + '…';
  return t;
}

// ---------------------------------------------------------------- project derivation

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WT_RE = /-{1,2}claude-worktrees-/i;

function deriveProject(cwd, dirName) {
  if (cwd) {
    let p = String(cwd);
    const wt = p.toLowerCase().indexOf('claude-worktrees');
    if (wt >= 0) p = p.slice(0, wt);
    p = p.replace(/[\\/.\-\s]+$/, '');
    const segs = p.split(/[\\/]+/).filter((s) => s && !/^[A-Za-z]:$/.test(s));
    // last meaningful segment: skip uuid-like / hex-blob segments
    for (let i = segs.length - 1; i >= 0; i--) {
      const seg = segs[i];
      if (UUID_RE.test(seg) || /^[0-9a-f]{12,}$/i.test(seg)) continue;
      return seg;
    }
  }
  if (dirName) {
    let d = dirName;
    const m = d.search(WT_RE);
    if (m >= 0) d = d.slice(0, m).replace(/-+$/, '');
    return d;
  }
  return 'unknown';
}

// ---------------------------------------------------------------- per-file parse

/**
 * FileAgg = {
 *   malformed, rawMsgs,
 *   units: {
 *     [key]: { id, sidechain, cwds:{}, dirName, customTitle, lastSummary,
 *              firstUserText, userTurns, firstTs, lastTs,
 *              msgs: { [dedupKey]: [model, tsMs, in, out, read, w5m, w1h] } }
 *   }
 * }
 */
function parseFile(file, dirName) {
  return new Promise((resolve) => {
    const agg = { malformed: 0, rawMsgs: 0, units: {} };
    const base = path.basename(file, '.jsonl');
    const fileDefaultSid = UUID_RE.test(base) ? base : null;
    let lastSummary = null;
    const customTitles = new Map(); // sessionId -> title

    const unitFor = (sid, agentId, sidechain) => {
      const key = agentId ? `${sid}:${agentId}` : sid;
      let u = agg.units[key];
      if (!u) {
        u = agg.units[key] = {
          id: key,
          sidechain: !!sidechain,
          cwds: {},
          dirName,
          customTitle: null,
          lastSummary: null,
          firstUserText: null,
          userTurns: 0,
          firstTs: null,
          lastTs: null,
          msgs: {},
        };
      }
      if (sidechain) u.sidechain = true;
      return u;
    };

    const touch = (u, rec) => {
      if (rec.cwd) u.cwds[rec.cwd] = (u.cwds[rec.cwd] || 0) + 1;
      if (rec.timestamp) {
        const t = Date.parse(rec.timestamp);
        if (!Number.isNaN(t)) {
          if (u.firstTs === null || t < u.firstTs) u.firstTs = t;
          if (u.lastTs === null || t > u.lastTs) u.lastTs = t;
        }
      }
    };

    let stream;
    try {
      stream = fs.createReadStream(file, { encoding: 'utf8' });
    } catch {
      resolve(agg);
      return;
    }
    stream.on('error', () => resolve(agg));
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line) return;
      // cheap pre-filter: only parse record types we care about;
      // обірвані/биті рядки (крах під час запису) ловимо евристикою країв без JSON.parse
      const isAssistant = line.includes('"type":"assistant"');
      const isUser = line.includes('"type":"user"');
      const isSummary = line.includes('"type":"summary"');
      const isCustom = line.includes('"customTitle"');
      if (!isAssistant && !isUser && !isSummary && !isCustom) {
        const t = line.trimEnd();
        if (t && (t[0] !== '{' || t[t.length - 1] !== '}')) agg.malformed++;
        return;
      }
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        agg.malformed++;
        return;
      }
      if (o.type === 'summary') {
        if (typeof o.summary === 'string' && o.summary.trim()) lastSummary = o.summary;
        return;
      }
      if (typeof o.customTitle === 'string' && o.customTitle.trim()) {
        customTitles.set(o.sessionId || fileDefaultSid || '', o.customTitle);
        if (o.type === 'custom-title') return;
      }
      if (o.type === 'assistant') {
        const msg = o.message;
        if (!msg || !msg.usage) return; // skip records without usage
        const u = msg.usage;
        agg.rawMsgs++;
        const sid = o.sessionId || fileDefaultSid || base;
        const unit = unitFor(sid, o.agentId, o.isSidechain);
        touch(unit, o);
        const dedupKey = msg.id || o.requestId || o.uuid || `${file}:${agg.rawMsgs}`;
        const cc = u.cache_creation;
        let w5, w1;
        if (cc && (cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null)) {
          w5 = cc.ephemeral_5m_input_tokens || 0;
          w1 = cc.ephemeral_1h_input_tokens || 0;
        } else {
          w5 = u.cache_creation_input_tokens || 0; // older versions: treat all as 5m
          w1 = 0;
        }
        const ts = o.timestamp ? Date.parse(o.timestamp) : NaN;
        // keep LAST occurrence within the file (object assignment overwrites)
        unit.msgs[dedupKey] = [
          msg.model || 'unknown',
          Number.isNaN(ts) ? 0 : ts,
          u.input_tokens || 0,
          u.output_tokens || 0,
          u.cache_read_input_tokens || 0,
          w5,
          w1,
        ];
        return;
      }
      if (o.type === 'user') {
        if (o.isMeta) return;
        const sid = o.sessionId || fileDefaultSid || base;
        const unit = unitFor(sid, o.agentId, o.isSidechain);
        touch(unit, o);
        if (o.toolUseResult !== undefined) return;
        const m = o.message;
        const c = m && m.content;
        let text = '';
        if (typeof c === 'string') text = c;
        else if (Array.isArray(c)) {
          if (c.some((x) => x && x.type === 'tool_result')) return;
          text = c.filter((x) => x && x.type === 'text').map((x) => x.text).join(' ');
        } else return;
        if (!text.trim()) return;
        unit.userTurns++;
        if (!unit.firstUserText) {
          const t = cleanTitle(text);
          if (t) unit.firstUserText = t;
        }
      }
    });

    rl.on('close', () => {
      // attribute customTitle / lastSummary
      for (const [sid, title] of customTitles) {
        if (agg.units[sid]) agg.units[sid].customTitle = title;
        else if (fileDefaultSid && agg.units[fileDefaultSid]) agg.units[fileDefaultSid].customTitle = title;
      }
      if (lastSummary && fileDefaultSid && agg.units[fileDefaultSid]) {
        agg.units[fileDefaultSid].lastSummary = lastSummary;
      } else if (lastSummary) {
        const keys = Object.keys(agg.units);
        if (keys.length === 1) agg.units[keys[0]].lastSummary = lastSummary;
      }
      resolve(agg);
    });
  });
}

// ---------------------------------------------------------------- pricing

async function loadPricing(verbose) {
  let litellm = null;
  let source = 'fallback';
  let fetchNote = '';
  try {
    litellm = await httpsGetJson(LITELLM_URL, 5000);
    try {
      writeJsonAtomic(LITELLM_CACHE, litellm);
    } catch { /* cache write failure is non-fatal */ }
    source = 'litellm';
  } catch (e) {
    fetchNote = `LiteLLM fetch failed (${e.message || e})`;
    const cached = readJsonSafe(LITELLM_CACHE);
    if (cached) {
      litellm = cached;
      source = 'litellm';
      fetchNote += ', using cached litellm.json';
    } else {
      fetchNote += ', using pricing.json fallback';
    }
  }
  if (verbose && fetchNote) console.log(`[pricing] ${fetchNote}`);
  const fallback = readJsonSafe(PRICING_FALLBACK) || {};
  return { litellm, fallback, source };
}

/** Resolve per-MTok price entry {input, output, cacheRead, write5m, write1h} for a model id. */
function resolvePrice(model, pricing, warnings) {
  const zero = { input: 0, output: 0, cacheRead: 0, write5m: 0, write1h: 0 };
  if (!model || model === '<synthetic>' || model === 'unknown') return zero;
  const { litellm, fallback } = pricing;
  if (litellm) {
    let entry = litellm[model] || litellm['anthropic/' + model];
    if (!entry) {
      // prefix match against litellm keys
      let best = null;
      for (const k of Object.keys(litellm)) {
        const kk = k.startsWith('anthropic/') ? k.slice(10) : k;
        if (!kk.includes('claude')) continue;
        if (model.startsWith(kk) || kk.startsWith(model)) {
          if (!best || kk.length > best.len) best = { k, len: kk.length };
        }
      }
      if (best) entry = litellm[best.k];
    }
    if (entry && entry.input_cost_per_token != null) {
      const inMTok = entry.input_cost_per_token * 1e6;
      return {
        input: inMTok,
        output: (entry.output_cost_per_token || 0) * 1e6,
        cacheRead: (entry.cache_read_input_token_cost || 0) * 1e6,
        write5m:
          entry.cache_creation_input_token_cost != null
            ? entry.cache_creation_input_token_cost * 1e6
            : inMTok * 1.25,
        write1h:
          entry.cache_creation_input_token_cost_above_1hr != null
            ? entry.cache_creation_input_token_cost_above_1hr * 1e6
            : inMTok * 2.0,
      };
    }
  }
  // fallback table: substring match, most specific (longest) key first
  const keys = Object.keys(fallback).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (model.includes(k)) {
      const p = fallback[k];
      return {
        input: p.input,
        output: p.output,
        cacheRead: p.cacheRead,
        write5m: p.input * 1.25,
        write1h: p.input * 2.0,
      };
    }
  }
  warnings.add(`unknown model: ${model}`);
  return zero;
}

function msgCost(arr, price) {
  // arr = [model, ts, in, out, read, w5, w1]
  return (
    (arr[2] * price.input +
      arr[3] * price.output +
      arr[4] * price.cacheRead +
      arr[5] * price.write5m +
      arr[6] * price.write1h) /
    1e6
  );
}

const round = (n, d) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

// ---------------------------------------------------------------- main

async function main() {
  const t0 = Date.now();
  const args = parseArgs(process.argv);
  const log = (...a) => console.log(...a);
  const vlog = (...a) => { if (args.verbose) console.log(...a); };

  if (!fs.existsSync(args.source)) {
    console.error(`Source directory not found: ${args.source}`);
    process.exit(1);
  }

  // 1. discover files (файл може зникнути між обходом і stat — пропускаємо)
  const files = walkJsonl(args.source)
    .map((p) => {
      try {
        const st = fs.statSync(p);
        return { path: p, size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  files.sort((a, b) => a.mtimeMs - b.mtimeMs); // dedup "keep last" = newest file wins
  vlog(`[scan] ${files.length} jsonl files in ${args.source}`);

  // 2. per-file cache
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheRaw = readJsonSafe(FILE_CACHE);
  const cache =
    cacheRaw && cacheRaw.version === CACHE_VERSION && cacheRaw.files ? cacheRaw.files : {};
  const newCache = {};
  let cachedCount = 0;
  let parsedCount = 0;

  const results = new Array(files.length);
  const toParse = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const c = cache[f.path];
    if (c && c.size === f.size && c.mtimeMs === f.mtimeMs) {
      results[i] = c.agg;
      newCache[f.path] = c;
      cachedCount++;
    } else {
      toParse.push(i);
    }
  }

  // limited-concurrency parse pool
  {
    let next = 0;
    const sourceRoot = args.source;
    const worker = async () => {
      while (next < toParse.length) {
        const idx = toParse[next++];
        const f = files[idx];
        const rel = path.relative(sourceRoot, f.path);
        const dirName = rel.split(path.sep)[0] || path.basename(path.dirname(f.path));
        const agg = await parseFile(f.path, dirName);
        results[idx] = agg;
        newCache[f.path] = { size: f.size, mtimeMs: f.mtimeMs, agg };
        parsedCount++;
        if (args.verbose && parsedCount % 200 === 0) {
          vlog(`[parse] ${parsedCount}/${toParse.length} files...`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARSE_CONCURRENCY, toParse.length) }, worker));
  }

  try {
    writeJsonAtomic(FILE_CACHE, { version: CACHE_VERSION, files: newCache });
  } catch (e) {
    vlog(`[cache] failed to write files.json: ${e.message}`);
  }

  // 3. merge units across files + GLOBAL dedup (message.id ?? requestId, keep last)
  const sessions = new Map(); // unit key -> merged unit
  const globalMsgs = new Map(); // dedupKey -> { unitKey, arr }
  let rawMsgs = 0;
  let malformed = 0;

  for (const agg of results) {
    if (!agg) continue;
    malformed += agg.malformed;
    rawMsgs += agg.rawMsgs;
    for (const [key, u] of Object.entries(agg.units)) {
      let m = sessions.get(key);
      if (!m) {
        m = {
          id: key,
          sidechain: u.sidechain,
          cwds: {},
          dirName: u.dirName,
          customTitle: null,
          lastSummary: null,
          firstUserText: null,
          userTurns: 0,
          firstTs: null,
          lastTs: null,
          msgKeys: new Set(),
        };
        sessions.set(key, m);
      }
      m.sidechain = m.sidechain || u.sidechain;
      for (const [cwd, n] of Object.entries(u.cwds)) m.cwds[cwd] = (m.cwds[cwd] || 0) + n;
      if (u.customTitle) m.customTitle = u.customTitle;
      if (u.lastSummary) m.lastSummary = u.lastSummary;
      if (u.firstUserText && !m.firstUserText) m.firstUserText = u.firstUserText;
      m.userTurns += u.userTurns;
      if (u.firstTs !== null && (m.firstTs === null || u.firstTs < m.firstTs)) m.firstTs = u.firstTs;
      if (u.lastTs !== null && (m.lastTs === null || u.lastTs > m.lastTs)) m.lastTs = u.lastTs;
      for (const [dk, arr] of Object.entries(u.msgs)) {
        const prev = globalMsgs.get(dk);
        if (prev) prev.owner.msgKeys.delete(dk); // later occurrence wins
        globalMsgs.set(dk, { owner: m, arr });
        m.msgKeys.add(dk);
      }
    }
  }
  const dedupedMsgs = globalMsgs.size;

  // 4. pricing
  const pricing = await loadPricing(args.verbose);
  const warnings = new Set();
  const priceByModel = new Map();
  const priceFor = (model) => {
    let p = priceByModel.get(model);
    if (!p) {
      p = resolvePrice(model, pricing, warnings);
      priceByModel.set(model, p);
    }
    return p;
  };

  // 5. aggregate: days (day × project × model × sidechain) + sessions
  const dayBuckets = new Map();
  const sessionRows = [];
  const modelTotals = new Map(); // model -> cost
  const projectTotals = new Map(); // project -> cost

  for (const m of sessions.values()) {
    // project from most frequent cwd
    let topCwd = null;
    let topN = -1;
    for (const [cwd, n] of Object.entries(m.cwds)) {
      if (n > topN) { topN = n; topCwd = cwd; }
    }
    const project = deriveProject(topCwd, m.dirName);

    const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, costUsd: 0 };
    const models = {};
    let ctxSum = 0;
    let ctxMax = 0;
    let nMsgs = 0;

    for (const dk of m.msgKeys) {
      const { arr } = globalMsgs.get(dk);
      const [model, ts, inp, out, rd, w5, w1] = arr;
      const price = priceFor(model);
      const cost = msgCost(arr, price);
      nMsgs++;
      totals.input += inp; totals.output += out; totals.cacheRead += rd;
      totals.cacheWrite5m += w5; totals.cacheWrite1h += w1; totals.costUsd += cost;
      let mm = models[model];
      if (!mm) mm = models[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, costUsd: 0 };
      mm.input += inp; mm.output += out; mm.cacheRead += rd;
      mm.cacheWrite5m += w5; mm.cacheWrite1h += w1; mm.costUsd += cost;
      const ctx = inp + rd + w5 + w1;
      ctxSum += ctx;
      if (ctx > ctxMax) ctxMax = ctx;
      modelTotals.set(model, (modelTotals.get(model) || 0) + cost);
      projectTotals.set(project, (projectTotals.get(project) || 0) + cost);

      // day bucket
      if (ts > 0) {
        const day = kyivDay(ts);
        const bk = `${day}|${project}|${model}|${m.sidechain ? 1 : 0}`;
        let b = dayBuckets.get(bk);
        if (!b) {
          b = { day, project, model, sidechain: m.sidechain, input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, costUsd: 0, messages: 0, sessionSet: new Set() };
          dayBuckets.set(bk, b);
        }
        b.input += inp; b.output += out; b.cacheRead += rd;
        b.cacheWrite5m += w5; b.cacheWrite1h += w1; b.costUsd += cost;
        b.messages++;
        b.sessionSet.add(m.id);
      }
    }

    if (nMsgs === 0 && m.userTurns === 0) continue;

    const denom = totals.input + totals.cacheRead + totals.cacheWrite5m + totals.cacheWrite1h;
    const title = m.customTitle
      ? cleanTitle(m.customTitle)
      : m.lastSummary
        ? cleanTitle(m.lastSummary)
        : m.firstUserText || '';

    for (const mm of Object.values(models)) mm.costUsd = round(mm.costUsd, 4);
    sessionRows.push({
      sessionId: m.id,
      project,
      projectPath: topCwd || '',
      title,
      sidechain: m.sidechain,
      startedAt: m.firstTs !== null ? new Date(m.firstTs).toISOString() : null,
      endedAt: m.lastTs !== null ? new Date(m.lastTs).toISOString() : null,
      userTurns: m.userTurns,
      assistantTurns: nMsgs,
      models,
      totals: { ...totals, costUsd: round(totals.costUsd, 4) },
      maxContext: ctxMax,
      avgContext: nMsgs ? Math.round(ctxSum / nMsgs) : 0,
      cacheHitRate: denom > 0 ? round(totals.cacheRead / denom, 4) : 0,
    });
  }

  // 6. snapshot
  const days = [...dayBuckets.values()]
    .map((b) => ({
      day: b.day,
      project: b.project,
      model: b.model,
      sidechain: b.sidechain,
      input: b.input,
      output: b.output,
      cacheRead: b.cacheRead,
      cacheWrite5m: b.cacheWrite5m,
      cacheWrite1h: b.cacheWrite1h,
      costUsd: round(b.costUsd, 4),
      messages: b.messages,
      sessions: b.sessionSet.size,
    }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.project.localeCompare(b.project) || a.model.localeCompare(b.model));

  // sessions < $0.01 dropped from `sessions` (kept in `days`)
  const keptSessions = sessionRows
    .filter((s) => s.totals.costUsd >= 0.01)
    .sort((a, b) => b.totals.costUsd - a.totals.costUsd);

  const pricingUsed = {};
  for (const [model, p] of priceByModel) {
    if (model === '<synthetic>') continue;
    pricingUsed[model] = {
      input: round(p.input, 4),
      output: round(p.output, 4),
      cacheRead: round(p.cacheRead, 4),
      write5m: round(p.write5m, 4),
      write1h: round(p.write1h, 4),
    };
  }

  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    timezone: TZ,
    pricingSource: pricing.source,
    pricingUsed,
    warnings: [...warnings],
    days,
    sessions: keptSessions,
  };

  writeJsonAtomic(args.out, snapshot);
  const outSize = fs.statSync(args.out).size;

  // 7. summary log
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const totalCost = [...modelTotals.values()].reduce((a, b) => a + b, 0);
  const fmt$ = (n) => '$' + n.toFixed(2);
  log('');
  log('=== spend-lens collector summary ===');
  log(`files:      ${files.length} (parsed ${parsedCount}, cached ${cachedCount})`);
  log(`messages:   ${rawMsgs} raw -> ${dedupedMsgs} after dedup (${rawMsgs - dedupedMsgs} duplicates collapsed)`);
  log(`malformed:  ${malformed} lines`);
  log(`sessions:   ${sessionRows.length} total, ${keptSessions.length} kept in snapshot (>= $0.01)`);
  log(`day rows:   ${days.length}`);
  log(`pricing:    ${pricing.source}`);
  if (warnings.size) log(`warnings:   ${[...warnings].join('; ')}`);
  log('--- total cost by model ---');
  for (const [model, cost] of [...modelTotals.entries()].sort((a, b) => b[1] - a[1])) {
    if (cost > 0 || model !== '<synthetic>') log(`  ${model.padEnd(32)} ${fmt$(cost)}`);
  }
  log('--- top-5 projects by cost ---');
  for (const [project, cost] of [...projectTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    log(`  ${project.padEnd(32)} ${fmt$(cost)}`);
  }
  log(`TOTAL: ${fmt$(totalCost)}`);
  log(`snapshot:   ${args.out} (${(outSize / 1024 / 1024).toFixed(2)} MB)`);
  log(`elapsed:    ${elapsed}s`);

  // 8. Supabase push
  if (args.push) {
    await pushToSupabase(snapshot, {
      envPath: path.join(__dirname, '.env'),
      verbose: args.verbose,
    });
  } else {
    vlog('[push] skipped (--no-push)');
  }
}

main().catch((e) => {
  console.error('collector failed:', e);
  process.exit(1);
});
