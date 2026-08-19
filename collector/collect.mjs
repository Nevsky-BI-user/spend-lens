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
 * - v1.7a digests: per-session tool histogram / areas / edits / filesTouched / intent /
 *   activity label, plus a top-level projects[] roll-up. Tool facts are deduped by the
 *   `tool_use` BLOCK id (`toolu_*`, globally unique) — NOT by message.id: one API
 *   response is written on several lines that share a message.id but each carry a
 *   DIFFERENT slice of message.content (one tool_use per line), so a message-level
 *   dedup would drop every tool call except the last of a parallel batch.
 * - v1.9: блок `rtk` (статистика Rust Token Killer) — best-effort, див. rtk.mjs.
 *   Немає rtk / він упав → snapshot.rtk = null і жодного попередження.
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
import { collectRtk } from './rtk.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '.cache');
const FILE_CACHE = path.join(CACHE_DIR, 'files.json');
const LITELLM_CACHE = path.join(CACHE_DIR, 'litellm.json');
const PRICING_FALLBACK = path.join(__dirname, 'pricing.json');
const PROJECT_NOTES = path.join(__dirname, 'projects.json'); // optional, gitignored
const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_VERSION = 8; // v1.7a: області без службових тек харнесу
const SCHEMA_VERSION = 2;
const TZ = 'Europe/Kyiv';
const PARSE_CONCURRENCY = 8;

// ---------------------------------------------------------------- CLI args

function parseArgs(argv) {
  const args = {
    source: path.join(os.homedir(), '.claude', 'projects'),
    out: path.resolve(__dirname, '..', 'web', 'public', 'data', 'usage.json'),
    push: true,
    verbose: false,
    rtk: true,
    // v1.9: шлях до бінара rtk. Потрібен для перевірки деградації — вказавши
    // неіснуючий файл, можна переконатися, що збір далі працює (snapshot.rtk = null).
    rtkBin: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = path.resolve(argv[++i]);
    else if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--no-push') args.push = false;
    else if (a === '--no-rtk') args.rtk = false;
    else if (a === '--rtk-bin') args.rtkBin = argv[++i];
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node collector/collect.mjs [--source <dir>] [--out <file>] [--no-push] [--no-rtk] [--rtk-bin <path>] [--verbose]');
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

// ---------------------------------------------------------------- text cleaning

/**
 * Identity masking. Everything derived from a transcript can end up in the snapshot,
 * in Supabase and in an emailed PDF/XLSX, so the machine account must never ride along:
 * the home directory becomes %USERPROFILE% and any stray occurrence of the account name
 * becomes %USERNAME%. The name is matched loosely (`HEAVY_METAL` / `HEAVY METAL` /
 * `HEAVY-METAL`) because markdown stripping elsewhere can turn `_` into a space.
 */
const rxEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOME_DIR = os.homedir() || '';
const HOME_RE = HOME_DIR
  ? new RegExp(rxEscape(HOME_DIR).replace(/\\\\|\//g, '[\\\\/]'), 'gi')
  : null;
const ACCOUNT_NAME = HOME_DIR.split(/[\\/]/).filter(Boolean).pop() || '';
const ACCOUNT_RE =
  ACCOUNT_NAME.length >= 4
    ? new RegExp(ACCOUNT_NAME.split(/[_\-\s]+/).map(rxEscape).join('[_\\-\\s]?'), 'gi')
    : null;

function maskIdentity(s) {
  let t = s;
  if (HOME_RE) t = t.replace(HOME_RE, '%USERPROFILE%');
  if (ACCOUNT_RE) t = t.replace(ACCOUNT_RE, '%USERNAME%');
  return t;
}

/**
 * Secret redaction. `intent` is the FIRST user message — the exact turn where
 * «ось ключ, полагодь конфіг» happens — and it leaves the machine by email, so any
 * credential-shaped token is replaced before the text is stored. Over-redaction is the
 * intended failure mode.
 */
const SECRET_MASK = '«приховано»';
// [pattern, replacement] — the credential NAME is kept so the intent still reads
// («SUPABASE_ANON_KEY=«приховано»»); only the value dies.
const SECRET_PATTERNS = [
  [/-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?(?:-----END[ A-Z]*PRIVATE KEY-----|$)/g, SECRET_MASK],
  // NAME=value / NAME: value where the NAME itself declares a credential
  [
    /\b([A-Za-z][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE)[A-Za-z0-9_]*\s*[:=]\s*)\S+/g,
    `$1${SECRET_MASK}`,
  ],
  [
    /\b(password|passwd|pwd|api[_-]?key|apikey|secret|token|bearer|пароль)(\s*[:=]\s*)\S+/gi,
    `$1$2${SECRET_MASK}`,
  ],
  // bare provider tokens
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, SECRET_MASK],
  [/\bsk-[A-Za-z0-9]{16,}/g, SECRET_MASK],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, SECRET_MASK],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, SECRET_MASK],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, SECRET_MASK],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, SECRET_MASK],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{12,}/g, SECRET_MASK],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, SECRET_MASK],
  [/\bsb[ps]_[A-Za-z0-9_-]{20,}/g, SECRET_MASK],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, SECRET_MASK],
];

function redactSecrets(s) {
  let t = s;
  for (const [re, to] of SECRET_PATTERNS) t = t.replace(re, to);
  return t;
}

/** Strip harness noise blocks that are never part of what the user actually asked. */
function stripNoiseBlocks(s) {
  let t = s;
  t = t.replace(/<system-reminder>[\s\S]*?(<\/system-reminder>|$)/gi, ' ');
  t = t.replace(/<task-notification>[\s\S]*?(<\/task-notification>|$)/gi, ' ');
  t = t.replace(/<local-command-stdout>[\s\S]*?(<\/local-command-stdout>|$)/gi, ' ');
  return t;
}

function cleanTitle(s) {
  if (!s || typeof s !== 'string') return '';
  let t = stripNoiseBlocks(s);
  t = t.replace(/<command-name>([\s\S]*?)<\/command-name>/g, ' $1 ');
  t = t.replace(/<command-message>[\s\S]*?<\/command-message>/g, ' ');
  t = t.replace(/<command-args>([\s\S]*?)<\/command-args>/g, ' $1 ');
  t = t.replace(/<[a-zA-Z][^>\n]{0,60}>|<\/[a-zA-Z][^>\n]{0,60}>/g, ' ');
  // titles are emailed / pushed to Supabase too — no credentials, no account name
  t = maskIdentity(redactSecrets(t));
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > 110) t = t.slice(0, 109).trimEnd() + '…';
  return t;
}

/** Truncate at a word boundary, appending an ellipsis. */
function truncateWords(s, max) {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.5) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:.\-–—]+$/, '') + '…';
}

/**
 * digest.intent — the first user message, cleaned: harness blocks, slash-command
 * wrappers and fenced code go away; the command name and its args survive (for a
 * `/loop …` session the command line IS the intent); 200 chars on a word boundary.
 *
 * PRIVACY: this string is stored in the snapshot, pushed to sessions_agg.digest and
 * shipped in the emailed PDF/XLSX. Credentials are redacted and every path is reduced
 * to a basename BEFORE the markdown pass — that pass turns `_` into a space, which
 * would otherwise split `HEAVY_METAL` and defeat both the path regex and a naive
 * username grep on the snapshot.
 */
function cleanIntent(s) {
  if (!s || typeof s !== 'string') return '';
  let t = stripNoiseBlocks(s);
  // <command-message> is just the slash-command label (redundant with the name);
  // the NAME and the ARGS are the user's actual request, so they are unwrapped, not cut.
  t = t.replace(/<command-message>[\s\S]*?(<\/command-message>|$)/gi, ' ');
  t = t.replace(/<command-args>([\s\S]*?)(<\/command-args>|$)/gi, ' $1 ');
  t = t.replace(/<command-name>([\s\S]*?)(<\/command-name>|$)/gi, ' $1 ');
  t = t.replace(/<command-[a-z-]*>[\s\S]*?(<\/command-[a-z-]*>|$)/gi, ' ');
  t = t.replace(/```[\s\S]*?(```|$)/g, ' ');
  t = t.replace(/~~~[\s\S]*?(~~~|$)/g, ' ');
  t = t.replace(/<[a-zA-Z][^>\n]{0,60}>|<\/[a-zA-Z][^>\n]{0,60}>/g, ' ');
  // order matters: secrets → identity → paths → markdown noise (see the note above)
  t = redactSecrets(t);
  t = maskIdentity(t);
  t = shortenPaths(t);
  t = t.replace(/[`*_>#]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return truncateWords(t, 200);
}

/** Collapse long/absolute paths down to their basename so titles stay readable. */
function shortenPaths(s) {
  return s
    .replace(/[A-Za-z]:[\\/][^\s"'`,;)]+/g, (m) => m.split(/[\\/]/).filter(Boolean).pop() || m)
    .replace(/(?:[\w.@+-]+[\\/]){2,}[\w.@+-]*/g, (m) => m.split(/[\\/]/).filter(Boolean).pop() || m);
}

const SIDECHAIN_PREFIX = 'субагент: ';

/**
 * Sidechain sessions open with a machine-written brief (paths, acceptance criteria,
 * report format). Never surface that raw: take the cleaned intent, drop the paths,
 * keep the first sentence, prefix «субагент: », cap at 110 chars.
 */
function sidechainTitle(text) {
  let t = shortenPaths(maskIdentity(redactSecrets(String(text || ''))))
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return 'субагент';
  const cap = 110 - SIDECHAIN_PREFIX.length;
  // Cut at the first sentence boundary that still leaves a self-contained line.
  // Briefs open with a boilerplate context clause («Project X, Windows 11, Node 24.»),
  // so a boundary before ~50 chars is skipped rather than used as the whole title.
  const re = /[.!?…](?:\s|$)/g;
  let m;
  while ((m = re.exec(t))) {
    if (m.index + 1 < 50) continue;
    if (m.index + 1 <= cap) t = t.slice(0, m.index);
    break;
  }
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > cap) t = truncateWords(t, cap);
  return SIDECHAIN_PREFIX + t;
}

// ---------------------------------------------------------------- digest primitives

/**
 * MCP tool names are `mcp__<server>__<tool>`; the server is what carries meaning.
 * Contract-named aliases first, then the bare server label; plain tools keep their name.
 */
const MCP_ALIASES = {
  Claude_Browser: 'browser',
  'claude-in-chrome': 'browser',
  'computer-use': 'computer',
};
function normTool(name) {
  if (typeof name !== 'string' || !name) return 'unknown';
  if (!name.startsWith('mcp__')) return name;
  const server = name.split('__')[1] || 'mcp';
  if (MCP_ALIASES[server]) return MCP_ALIASES[server];
  let s = server;
  if (s.startsWith('plugin_')) {
    // plugin servers are `plugin_<bundle>_<server>`, sometimes with a version bundle
    // (`plugin_0_3_6_powerbi-modeling-mcp`) — the trailing server name is the useful bit
    s = s.slice(7).replace(/^(?:\d+[._])+/, '');
    const cut = s.lastIndexOf('_');
    if (cut > 0) s = s.slice(cut + 1);
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) || /^[0-9a-f]{16,}$/i.test(s)) s = 'mcp';
  return s || 'mcp';
}

const PATH_KEYS = ['file_path', 'path', 'notebook_path'];
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const ORCH_TOOLS = new Set(['Agent', 'Workflow']);

/**
 * Dedup key for one tool call. The `tool_use` block carries its own globally unique
 * `toolu_*` id; the `toolu_` prefix is dropped to keep the file cache small. Real API
 * records always have it — the fallback only guards hand-edited/truncated transcripts
 * and stays stable across the duplicated lines of one message.
 */
function toolBlockKey(block, msgKey, idx) {
  const id = block.id;
  if (typeof id === 'string' && id) return id.startsWith('toolu_') ? id.slice(6) : id;
  return 'x' + hashKey(`${msgKey}|${idx}|${block.name}`);
}

/** Pack one tool call into a compact cache string: `name`, `name|area`, `name|area|fileKey`. */
function packToolFact(name, area, fileKey) {
  if (fileKey) return `${name}|${area || ''}|${fileKey}`;
  if (area) return `${name}|${area}`;
  return name;
}

function unpackToolFact(fact) {
  const i1 = fact.indexOf('|');
  if (i1 < 0) return [fact, '', ''];
  const i2 = fact.indexOf('|', i1 + 1);
  if (i2 < 0) return [fact.slice(0, i1), fact.slice(i1 + 1), ''];
  return [fact.slice(0, i1), fact.slice(i1 + 1, i2), fact.slice(i2 + 1)];
}

/** FNV-1a → base36. Only used to count DISTINCT files, never to reconstruct a path. */
function hashKey(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Робочі теки самого Claude Code — вони кажуть не про проєкт, а про харнес.
// Без цього фільтра `scratchpad` і `.claude/plans` витісняють справжні
// `components/analytics` з топ-5 областей (заміряно: 12,7 % ваги).
const NOISE_SEGS = new Set([
  'scratchpad', 'node_modules', '.git', '.cache', 'dist', 'build',
  'appdata', 'temp', 'tmp', 'out',
]);

function isHarnessDir(dir) {
  for (const seg of dir.split('/')) {
    if (!seg) continue;
    const low = seg.toLowerCase();
    if (NOISE_SEGS.has(low)) return true;
    if (low === '.claude' || low.startsWith('.claude-')) return true;
    // Мангловані назви тек Claude Code: `C--github-…`, `C--PROJECTS-…`
    if (/^[a-z]--/i.test(seg)) return true;
  }
  return false;
}

/**
 * From a raw tool-input path → { area, fileKey }.
 * area = last 2 segments of the DIRECTORY (forward slashes, drive letter dropped).
 * fileKey = hash of the full normalized path, only when the value looks like a file.
 * Harness dirs (scratchpad, .claude, mangled project dirs) contribute no area.
 */
function pathFacts(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/\\/g, '/').trim();
  if (!s || s.length > 400 || s.includes('|')) return null;
  s = s.replace(/\/+$/, '');
  if (!s) return null;
  const slash = s.lastIndexOf('/');
  const base = slash >= 0 ? s.slice(slash + 1) : s;
  const isFile = base.includes('.') && base !== '..' && base !== '.';
  const dir = isFile ? (slash >= 0 ? s.slice(0, slash) : '') : s;
  let area = null;
  if (dir && !isHarnessDir(dir)) {
    // drop drive letters, dot segments and opaque uuid/hex segments (scratchpad and
    // worktree dirs are named after session ids and would drown out the real area)
    const segs = dir
      .split('/')
      .filter(
        (x) =>
          x &&
          x !== '.' &&
          x !== '..' &&
          !/^[A-Za-z]:$/.test(x) &&
          !UUID_RE.test(x) &&
          !/^[0-9a-f]{12,}$/i.test(x)
      );
    // areas are shown as chips (Проєкти tab, session drawer) and exported to XLSX/PDF —
    // scratchpad/worktree dirs are named after the account, so mask it here too
    if (segs.length) area = maskIdentity(segs.slice(-2).join('/'));
  }
  return { area, fileKey: isFile ? hashKey(s.toLowerCase()) : null };
}

/** Single Ukrainian activity label from the tool mix; first match wins (contract v1.7a). */
function activityLabel(counts, total) {
  if (!total) return 'без інструментів';
  const g = (...names) => names.reduce((a, n) => a + (counts.get(n) || 0), 0);
  let orch = 0;
  for (const [n, c] of counts) if (ORCH_TOOLS.has(n) || n.startsWith('Task')) orch += c;
  if (g('browser') / total >= 0.15) return 'перевірка в браузері';
  if (g('computer') / total >= 0.15) return 'робота з десктопом';
  if (orch / total >= 0.08) return 'оркестрація агентів';
  if (g('Edit', 'Write', 'NotebookEdit') / total >= 0.25) return 'правки коду';
  if (g('Bash', 'PowerShell') / total >= 0.35) return 'запуски й перевірки';
  if (g('Read', 'Grep', 'Glob') / total >= 0.35) return 'розбір коду';
  return 'змішана робота';
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
 *              firstUserText, firstIntent, userTurns, firstTs, lastTs,
 *              msgs:  { [dedupKey]:  [model, tsMs, in, out, read, w5m, w1h] },
 *              tools: { [toolBlockKey]: "name|area|fileKey" } }
 *   }
 * }
 * `msgs` and `tools` are deduped on DIFFERENT keys on purpose. One API response is
 * written on several lines that share `message.id` and repeat identical usage but each
 * carry a different SLICE of `message.content` — so usage must collapse per message,
 * while tool calls must collapse per `tool_use` block id or a parallel batch loses
 * everything except its last block (~20 % of all calls on the real corpus).
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
          firstIntent: null,
          userTurns: 0,
          firstTs: null,
          lastTs: null,
          msgs: {},
          tools: {},
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
        const arr = [
          msg.model || 'unknown',
          Number.isNaN(ts) ? 0 : ts,
          u.input_tokens || 0,
          u.output_tokens || 0,
          u.cache_read_input_tokens || 0,
          w5,
          w1,
        ];
        unit.msgs[dedupKey] = arr;

        // v1.7a digest facts: one entry per tool_use BLOCK, keyed by the block's own id
        // (duplicated lines repeat block ids, so the map collapses them by itself).
        const content = msg.content;
        if (Array.isArray(content)) {
          for (let bi = 0; bi < content.length; bi++) {
            const b = content[bi];
            if (!b || b.type !== 'tool_use') continue;
            let area = '';
            let fileKey = '';
            const inp = b.input;
            if (inp && typeof inp === 'object') {
              for (const k of PATH_KEYS) {
                if (typeof inp[k] !== 'string') continue;
                const pf = pathFacts(inp[k]);
                if (pf) {
                  area = pf.area || '';
                  fileKey = pf.fileKey || '';
                }
                break; // one path per tool call
              }
            }
            unit.tools[toolBlockKey(b, dedupKey, bi)] = packToolFact(normTool(b.name), area, fileKey);
          }
        }
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
          if (t) {
            unit.firstUserText = t;
            unit.firstIntent = cleanIntent(text) || null;
          }
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

const topEntries = (map, n) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, n);

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
  const globalMsgs = new Map(); // dedupKey -> { owner, arr }
  const globalTools = new Map(); // tool_use block id -> { owner, fact }
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
          firstIntent: null,
          userTurns: 0,
          firstTs: null,
          lastTs: null,
          msgKeys: new Set(),
          toolKeys: new Set(),
        };
        sessions.set(key, m);
      }
      m.sidechain = m.sidechain || u.sidechain;
      for (const [cwd, n] of Object.entries(u.cwds)) m.cwds[cwd] = (m.cwds[cwd] || 0) + n;
      if (u.customTitle) m.customTitle = u.customTitle;
      if (u.lastSummary) m.lastSummary = u.lastSummary;
      if (u.firstUserText && !m.firstUserText) {
        m.firstUserText = u.firstUserText;
        m.firstIntent = u.firstIntent || null;
      }
      m.userTurns += u.userTurns;
      if (u.firstTs !== null && (m.firstTs === null || u.firstTs < m.firstTs)) m.firstTs = u.firstTs;
      if (u.lastTs !== null && (m.lastTs === null || u.lastTs > m.lastTs)) m.lastTs = u.lastTs;
      for (const [dk, arr] of Object.entries(u.msgs)) {
        const prev = globalMsgs.get(dk);
        if (prev) prev.owner.msgKeys.delete(dk); // later occurrence wins
        globalMsgs.set(dk, { owner: m, arr });
        m.msgKeys.add(dk);
      }
      for (const [tk, fact] of Object.entries(u.tools || {})) {
        const prev = globalTools.get(tk);
        if (prev) prev.owner.toolKeys.delete(tk); // later occurrence wins, as for msgs
        globalTools.set(tk, { owner: m, fact });
        m.toolKeys.add(tk);
      }
    }
  }
  const dedupedMsgs = globalMsgs.size;
  const dedupedTools = globalTools.size;

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

  // 5. aggregate: days (day × project × model × sidechain) + sessions (+ digests)
  const dayBuckets = new Map();
  const sessionRows = [];
  const modelTotals = new Map(); // model -> cost

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
    // digest accumulators
    const toolCounts = new Map();
    const areaCounts = new Map();
    const fileKeys = new Set();
    let edits = 0;
    let toolCalls = 0;

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

    // digest facts: one pass over the globally deduped tool_use blocks of this session
    for (const tk of m.toolKeys) {
      const entry = globalTools.get(tk);
      if (!entry) continue;
      const [name, area, fileKey] = unpackToolFact(entry.fact);
      toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
      toolCalls++;
      if (EDIT_TOOLS.has(name)) edits++;
      if (area) areaCounts.set(area, (areaCounts.get(area) || 0) + 1);
      if (fileKey) fileKeys.add(fileKey);
    }

    if (nMsgs === 0 && m.userTurns === 0) continue;

    const denom = totals.input + totals.cacheRead + totals.cacheWrite5m + totals.cacheWrite1h;

    // ---- digest (v1.7a) ----------------------------------------------
    const intent = m.firstIntent || null;
    const tools = {};
    let otherTools = 0;
    topEntries(toolCounts, Number.MAX_SAFE_INTEGER).forEach(([n, c], i) => {
      if (i < 8) tools[n] = c;
      else otherTools += c;
    });
    if (otherTools) tools.other = otherTools;
    const digest = {
      activity: activityLabel(toolCounts, toolCalls),
      tools,
      areas: topEntries(areaCounts, 5).map(([p, c]) => ({ path: p, count: c })),
      edits,
      filesTouched: fileKeys.size,
      intent,
    };

    // ---- title --------------------------------------------------------
    const title = m.sidechain
      ? sidechainTitle(intent || cleanTitle(m.lastSummary) || m.firstUserText || '')
      : m.customTitle
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
      digest,
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

  // ---- projects[] (v1.7a) ---------------------------------------------
  // Money comes from the SAME rounded day rows the dashboard sums, so
  // sum(projects[].costUsd) === sum(days[].costUsd) by construction.
  const projAgg = new Map();
  const projectOf = (name) => {
    let p = projAgg.get(name);
    if (!p) {
      p = {
        project: name,
        sessions: 0,
        sidechainSessions: 0,
        costUsd: 0,
        firstDay: null,
        lastDay: null,
        modelCost: new Map(),
        areas: new Map(),
        activities: new Map(),
        titled: [],
      };
      projAgg.set(name, p);
    }
    return p;
  };
  for (const d of days) {
    const p = projectOf(d.project);
    p.costUsd += d.costUsd;
    p.modelCost.set(d.model, (p.modelCost.get(d.model) || 0) + d.costUsd);
    if (p.firstDay === null || d.day < p.firstDay) p.firstDay = d.day;
    if (p.lastDay === null || d.day > p.lastDay) p.lastDay = d.day;
  }
  // Roll up over the sessions the snapshot actually ships (>= $0.01): counting the
  // sub-cent stubs would let one-message no-op sessions dominate the activity mix and
  // make «34 сесії» disagree with what the Сесії tab lists for the project.
  for (const s of keptSessions) {
    const p = projectOf(s.project);
    p.sessions++;
    if (s.sidechain) p.sidechainSessions++;
    p.activities.set(s.digest.activity, (p.activities.get(s.digest.activity) || 0) + 1);
    for (const a of s.digest.areas) p.areas.set(a.path, (p.areas.get(a.path) || 0) + a.count);
    if (s.title) p.titled.push([s.title, s.totals.costUsd]);
  }
  const notesRaw = readJsonSafe(PROJECT_NOTES);
  const notes = notesRaw && typeof notesRaw === 'object' && !Array.isArray(notesRaw) ? notesRaw : {};
  const projects = [...projAgg.values()]
    .map((p) => ({
      project: p.project,
      sessions: p.sessions,
      sidechainSessions: p.sidechainSessions,
      costUsd: round(p.costUsd, 4),
      firstDay: p.firstDay,
      lastDay: p.lastDay,
      models: topEntries(p.modelCost, 3).filter(([, c]) => c > 0).map(([mdl]) => mdl),
      areas: topEntries(p.areas, 5).map(([pth, count]) => ({ path: pth, count })),
      activities: topEntries(p.activities, Number.MAX_SAFE_INTEGER).map(([label, count]) => ({ label, count })),
      titles: p.titled.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t),
      note:
        typeof notes[p.project] === 'string' && notes[p.project].trim()
          ? notes[p.project].trim()
          : null,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || a.project.localeCompare(b.project));

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

  // v1.9: статистика RTK. Відсутність rtk — норма, а не проблема, тому
  // жодного запису у warnings; споживачі мусять терпіти rtk === null.
  const rtk = args.rtk
    ? await collectRtk({ bin: args.rtkBin, verbose: args.verbose })
    : null;

  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    timezone: TZ,
    pricingSource: pricing.source,
    pricingUsed,
    warnings: [...warnings],
    projects,
    days,
    sessions: keptSessions,
    rtk,
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
  log(`tool calls: ${dedupedTools} (deduped by tool_use block id)`);
  log(`malformed:  ${malformed} lines`);
  log(`sessions:   ${sessionRows.length} total, ${keptSessions.length} kept in snapshot (>= $0.01)`);
  log(`day rows:   ${days.length}`);
  log(`projects:   ${projects.length} (${projects.filter((p) => p.note).length} with a manual note)`);
  log(`pricing:    ${pricing.source}`);
  log(
    rtk
      ? `rtk:        ${rtk.summary.total_saved} збережених токенів, ${rtk.summary.total_commands} команд, ${rtk.daily.length} дн., ${rtk.commands.length} у таблиці команд`
      : `rtk:        немає даних (${args.rtk ? 'rtk недоступний' : '--no-rtk'})`
  );
  if (warnings.size) log(`warnings:   ${[...warnings].join('; ')}`);
  log('--- total cost by model ---');
  for (const [model, cost] of [...modelTotals.entries()].sort((a, b) => b[1] - a[1])) {
    if (cost > 0 || model !== '<synthetic>') log(`  ${model.padEnd(32)} ${fmt$(cost)}`);
  }
  log('--- top-5 projects by cost ---');
  for (const p of projects.slice(0, 5)) {
    const act = (p.activities[0] && p.activities[0].label) || '—';
    log(`  ${p.project.padEnd(32)} ${fmt$(p.costUsd).padStart(10)}  ${act}`);
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
