/**
 * spend-lens: метадані десктопного застосунку Claude (v1.12), без npm-залежностей.
 *
 * Читає групи бокової панелі й сесії Claude Code, які веде застосунок:
 *   %APPDATA%\Claude\claude_desktop_config.json
 *     лише ключ preferences.epitaxyPrefs["dframe-group-scopes"]["<org>/<account>"]:
 *     groups [{id, name}] у порядку панелі, assignments {"code:local_<id>": groupId},
 *     order {groupId: ["code:local_<id>", ...]} = порядок усередині групи;
 *   %APPDATA%\Claude\claude-code-sessions\<org>\<account>\local_*.json
 *     лише sessionId, cliSessionId, priorCliSessionIds, title, cwd, model, effort,
 *     isArchived, createdAt, lastActivityAt (мс від епохи).
 *
 * ПРИВАТНІСТЬ: обидва файли містять стороннє (конфіги MCP, дозволи, можливо секрети).
 * Поза переліченими полями нічого не копіюється, не логується й не серіалізується.
 * Причини збою фіксовані й без шляхів: шлях містить імʼя облікового запису, а текст
 * помилки JSON.parse цитує шматок файла.
 *
 * Читається на кожному прогоні, не кешується. Зʼєднання з транскриптами робить
 * collect.mjs; цей модуль лише читає й упорядковує.
 */

import fs from 'node:fs';
import path from 'node:path';

const SCOPE_PART_RE = /^[A-Za-z0-9_-]+$/;
const SESSION_FILE_RE = /^local_[A-Za-z0-9_-]+\.json$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);
const ms = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

const fail = (reason) => ({ ok: false, reason });

/** Лише дозволені поля одного local_*.json, у свіжому обʼєкті. */
function pickSession(raw, fileBase) {
  const ids = [];
  const cli = str(raw.cliSessionId);
  if (cli) ids.push(cli);
  if (Array.isArray(raw.priorCliSessionIds)) {
    for (const id of raw.priorCliSessionIds) if (str(id) && !ids.includes(id)) ids.push(id);
  }
  const sid = str(raw.sessionId);
  return {
    appSessionId: sid && sid.startsWith('local_') ? sid : fileBase,
    transcripts: ids,
    title: str(raw.title),
    cwd: str(raw.cwd),
    model: str(raw.model),
    effort: str(raw.effort),
    archived: raw.isArchived === true,
    createdAt: ms(raw.createdAt),
    lastActivityAt: ms(raw.lastActivityAt),
  };
}

const HEAD_BYTES = 8192;
const HEAD_SID_RE = /"sessionId"\s*:\s*"(local_[A-Za-z0-9_-]+)"/;
const HEAD_CWD_RE = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const HEAD_LAST_RE = /"lastActivityAt"\s*:\s*(\d+)/;

/**
 * Швидкий шлях для сесій без групи: sessionId, cwd і lastActivityAt з перших 8 КБ
 * файла (у застосунку вони стоять на початку). null, якщо чогось не знайдено, і тоді
 * файл розбирається повністю.
 */
function readHead(file) {
  let text;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
      text = buf.toString('utf8', 0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  const mc = HEAD_CWD_RE.exec(text);
  const ml = HEAD_LAST_RE.exec(text);
  if (!mc || !ml) return null;
  let cwd;
  try {
    cwd = JSON.parse(`"${mc[1]}"`);
  } catch {
    return null;
  }
  const ms0 = Number(ml[1]);
  const sid = HEAD_SID_RE.exec(text);
  return { appSessionId: sid ? sid[1] : null, cwd: cwd || null, lastActivityAt: ms(ms0) };
}

/** Розбирає один scope; null, якщо будова неочікувана. */
function readScope(key, scope) {
  const parts = key.split('/');
  if (parts.length !== 2 || !parts.every((p) => SCOPE_PART_RE.test(p))) return null;
  if (!isPlainObject(scope) || !Array.isArray(scope.groups)) return null;
  const groups = [];
  for (const g of scope.groups) {
    if (!isPlainObject(g) || !str(g.id) || typeof g.name !== 'string') return null;
    groups.push({ id: g.id, name: g.name });
  }
  if (scope.assignments !== undefined && !isPlainObject(scope.assignments)) return null;
  if (scope.order !== undefined && !isPlainObject(scope.order)) return null;
  const assignments = new Map();
  for (const [k, v] of Object.entries(scope.assignments || {})) {
    if (typeof v === 'string' && k.startsWith('code:')) assignments.set(k.slice(5), v);
  }
  const order = new Map(); // groupId -> Map(appSessionId -> index)
  for (const [gid, list] of Object.entries(scope.order || {})) {
    if (!Array.isArray(list)) continue;
    const idx = new Map();
    list.forEach((item, i) => {
      if (typeof item === 'string' && item.startsWith('code:') && !idx.has(item.slice(5))) idx.set(item.slice(5), i);
    });
    order.set(gid, idx);
  }
  return { parts, groups, assignments, order };
}

/**
 * @param {{appData?: string}} [opts]  тека %APPDATA% (за замовчуванням process.env.APPDATA)
 * @returns {{ok:false, reason:string} | {ok:true,
 *   groups: {id,name,order}[],
 *   sessions: {appSessionId,transcripts,title,cwd,model,effort,archived,createdAt,lastActivityAt,groupId,group,orderInGroup}[],
 *   ungrouped: {cwd,lastActivityAt}[],
 *   stats: {files, unreadable, assignedMissing}}}
 */
export function readDesktopApp(opts = {}) {
  const appData = opts.appData || process.env.APPDATA;
  if (!appData) return fail('не задано змінну APPDATA');
  const root = path.join(appData, 'Claude');

  let cfgText;
  try {
    cfgText = fs.readFileSync(path.join(root, 'claude_desktop_config.json'), 'utf8');
  } catch {
    return fail('немає файла claude_desktop_config.json');
  }
  let scopes;
  try {
    const cfg = JSON.parse(cfgText);
    const prefs = isPlainObject(cfg) && isPlainObject(cfg.preferences) ? cfg.preferences : null;
    const ep = prefs && isPlainObject(prefs.epitaxyPrefs) ? prefs.epitaxyPrefs : null;
    scopes = ep ? ep['dframe-group-scopes'] : undefined;
  } catch {
    return fail('claude_desktop_config.json не вдалося розібрати');
  }
  cfgText = null; // решта конфігу більше не потрібна
  if (scopes === undefined) return fail('у налаштуваннях немає груп бокової панелі');
  if (!isPlainObject(scopes) || !Object.keys(scopes).length) {
    return fail('неочікувана будова груп бокової панелі');
  }

  const groups = [];
  const groupById = new Map();
  const sessions = [];
  const ungrouped = [];
  const stats = { files: 0, unreadable: 0, assignedMissing: 0 };
  let scopeDirs = 0;

  for (const [key, raw] of Object.entries(scopes)) {
    const scope = readScope(key, raw);
    if (!scope) return fail('неочікувана будова груп бокової панелі');
    for (const g of scope.groups) {
      if (groupById.has(g.id)) continue;
      const row = { id: g.id, name: g.name, order: groups.length };
      groups.push(row);
      groupById.set(g.id, row);
    }

    const dir = path.join(root, 'claude-code-sessions', ...scope.parts);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue; // тека цього scope відсутня; якщо немає жодної, нижче збій
    }
    scopeDirs++;

    const seen = new Set();
    const byGroup = new Map(); // groupId -> [session]
    for (const name of names) {
      if (!SESSION_FILE_RE.test(name)) continue;
      stats.files++;
      const file = path.join(dir, name);
      const fileBase = name.slice(0, -5);
      // Сесія без групи (таких ~95 %, переважно прогони рутин) потрібна лише як
      // cwd + lastActivityAt: беремо їх із голови файла, не розбираючи сотні МБ.
      const head = readHead(file);
      if (head && !scope.assignments.has(head.appSessionId || fileBase)) {
        seen.add(head.appSessionId || fileBase);
        ungrouped.push({ cwd: head.cwd, lastActivityAt: head.lastActivityAt });
        continue;
      }
      let s;
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!isPlainObject(parsed)) throw new Error('shape');
        s = pickSession(parsed, fileBase);
      } catch {
        stats.unreadable++;
        continue;
      }
      seen.add(s.appSessionId);
      const gid = scope.assignments.get(s.appSessionId);
      const g = gid ? groupById.get(gid) : null;
      if (!g) {
        ungrouped.push({ cwd: s.cwd, lastActivityAt: s.lastActivityAt });
        continue;
      }
      let arr = byGroup.get(g.id);
      if (!arr) byGroup.set(g.id, (arr = []));
      arr.push(s);
    }
    for (const sid of scope.assignments.keys()) if (!seen.has(sid)) stats.assignedMissing++;

    // порядок у групі: індекс у order[groupId]; кого там немає, той після,
    // свіжіші першими; далі щільний ранг 0..n-1
    for (const [gid, arr] of byGroup) {
      const idx = scope.order.get(gid) || new Map();
      const pos = (s) => (idx.has(s.appSessionId) ? idx.get(s.appSessionId) : Number.MAX_SAFE_INTEGER);
      arr.sort((a, b) => pos(a) - pos(b) || (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
      const g = groupById.get(gid);
      arr.forEach((s, i) => sessions.push({ ...s, groupId: gid, group: g.name, orderInGroup: i }));
    }
  }

  if (!scopeDirs) return fail('немає теки claude-code-sessions для облікового запису');

  sessions.sort(
    (a, b) => groupById.get(a.groupId).order - groupById.get(b.groupId).order || a.orderInGroup - b.orderInGroup
  );
  return { ok: true, groups, sessions, ungrouped, stats };
}
