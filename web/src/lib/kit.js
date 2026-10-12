// Скіли й агенти по сесіях застосунку (CONTRACT v1.12, частина B).
//
// Колектор кладе у снапшот (необов'язково, schemaVersion не змінюється):
//   appGroups    = [{id, name, order}]  групи бічної панелі десктопа
//   appSessions  = [{appSessionId, title, groupId, group, orderInGroup,
//                    archived, createdAt, lastActivityAt, model, effort,
//                    project, transcripts, transcriptsFound, costUsd,
//                    skills, skillsInAgents, agents, agentsInAgents,
//                    workflows, commands}]
//   appUngrouped = [{project, sessions, lastActivityAt}]
//   sessions[].digest += {skills, agents, workflows, commands,
//                         skillsInAgents, agentsInAgents}
//
// Модуль чистий: без DOM, без React, без window та import.meta, тож його
// можна імпортувати з Node і перевіряти скриптом. Вкладка «Скіли й агенти»,
// блок у дровері сесії й аркуш XLSX рахують усе тут.
//
// Відсутні дані (старий снапшот, збій читання застосунку) ніколи не кидають:
// kitStatus() пояснює причину одним реченням, решта функцій повертає [] або null.

import { fmtDomMonth, shortModel } from './format.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_TZ = 'Europe/Kyiv';

/** Ключі дайджесту v1.12; хоч один присутній означає, що колектор їх збирав. */
export const KIT_DIGEST_KEYS = [
  'skills', 'skillsInAgents', 'agents', 'agentsInAgents', 'workflows', 'commands',
];

// ------------------------------------------------------------ дати --------

/** 'YYYY-MM-DD' + delta днів (календарна арифметика без поясів). */
function shiftDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

const fmtCache = new Map();

/** Intl-форматер для поясу; невалідний пояс дає null (запасний шлях нижче). */
function tzFormatter(timeZone) {
  const key = timeZone || DEFAULT_TZ;
  if (fmtCache.has(key)) return fmtCache.get(key);
  let fmt = null;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: key, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch {
    fmt = null;
  }
  fmtCache.set(key, fmt);
  return fmt;
}

/** ISO у компоненти заданого поясу: {y, m, d, hh, mm} рядками або null. */
function tzParts(iso, timeZone) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const fmt = tzFormatter(timeZone);
  const p2 = (n) => String(n).padStart(2, '0');
  if (!fmt) {
    return {
      y: String(date.getFullYear()), m: p2(date.getMonth() + 1), d: p2(date.getDate()),
      hh: p2(date.getHours()), mm: p2(date.getMinutes()),
    };
  }
  const out = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type === 'year') out.y = part.value;
    else if (part.type === 'month') out.m = part.value;
    else if (part.type === 'day') out.d = part.value;
    else if (part.type === 'hour') out.hh = part.value;
    else if (part.type === 'minute') out.mm = part.value;
  }
  return out;
}

/** ISO → 'YYYY-MM-DD' у поясі снапшота (Київ). */
export function tzDay(iso, timeZone = DEFAULT_TZ) {
  const p = tzParts(iso, timeZone);
  return p ? `${p.y}-${p.m}-${p.d}` : '';
}

/** ISO → '12.10, 11:45' за Києвом (рядок сесії на вкладці). */
export function fmtKyivShort(iso, timeZone = DEFAULT_TZ) {
  const p = tzParts(iso, timeZone);
  if (!p) return '';
  return `${p.d}.${p.m}, ${p.hh}:${p.mm}`;
}

/** ISO → '12 жовтня 2026, 11:45' за Києвом (текстова дата для XLSX). */
export function fmtKyivLong(iso, timeZone = DEFAULT_TZ) {
  const p = tzParts(iso, timeZone);
  if (!p) return '';
  return `${fmtDomMonth(Number(p.d), `${p.y}-${p.m}`)} ${p.y}, ${p.hh}:${p.mm}`;
}

// ------------------------------------------------------ наявність даних ---

/**
 * Чи є що показувати. ok:false супроводжує одне речення причини:
 * попередження колектора, якщо воно є, інакше пояснення, чого бракує.
 * @returns {{ok:true} | {ok:false, reason:string}}
 */
export function kitStatus(snapshot) {
  const snap = snapshot || {};
  if (Array.isArray(snap.appSessions)) return { ok: true };
  const warning = (snap.warnings || []).find(
    (w) => typeof w === 'string' && /сесії застосунку/i.test(w)
  );
  if (warning) return { ok: false, reason: warning };
  if (snap.appSessions === null) {
    return {
      ok: false,
      reason: 'Колектор не прочитав сесії застосунку: збір запускали з --no-app або папка застосунку недоступна.',
    };
  }
  return {
    ok: false,
    reason: 'Ці дані зібрано старішою версією колектора, у них ще немає сесій застосунку: оновіть колектор і зберіть дані знову.',
  };
}

// ------------------------------------------------------------- групи ------

/**
 * Групи в порядку бічної панелі. Сесія з groupId, якого немає в appGroups
 * (розсинхрон даних), отримує групу в кінці списку, щоб рядок не загубився.
 * @returns {Array<{id:string, name:string, order:number}>}
 */
export function kitGroups(snapshot) {
  const snap = snapshot || {};
  const raw = Array.isArray(snap.appGroups) ? snap.appGroups : [];
  const groups = raw
    .filter((g) => g && typeof g.id === 'string' && g.id)
    .map((g, i) => ({
      id: g.id,
      name: String(g.name || g.id),
      order: Number.isFinite(Number(g.order)) ? Number(g.order) : i,
      idx: i,
    }))
    .sort((a, b) => a.order - b.order || a.idx - b.idx);
  const known = new Set(groups.map((g) => g.id));
  for (const s of Array.isArray(snap.appSessions) ? snap.appSessions : []) {
    if (s && s.groupId && !known.has(s.groupId)) {
      known.add(s.groupId);
      groups.push({ id: s.groupId, name: String(s.group || s.groupId), order: Infinity, idx: groups.length });
    }
  }
  return groups.map(({ id, name, order }) => ({ id, name, order }));
}

/**
 * Вибір груп з URL проти наявних груп: невідомі id відкидаються; якщо не
 * лишилось жодного або вибрано всі, повертається null (тобто «усі групи»).
 */
export function normalizeGroupSelection(selected, groups) {
  if (!Array.isArray(selected) || !selected.length) return null;
  const ids = new Set((groups || []).map((g) => g.id));
  const valid = [...new Set(selected.filter((id) => ids.has(id)))];
  if (!valid.length || valid.length === ids.size) return null;
  return valid;
}

/**
 * Перемикання чіпа групи. Із «усі» клік лишає одну групу; далі клік додає
 * або прибирає; зняли останню або вибрали всі: знову «усі» (null).
 */
export function toggleGroupSelection(selected, id, groups) {
  const current = normalizeGroupSelection(selected, groups);
  if (!current) return normalizeGroupSelection([id], groups);
  const next = current.includes(id) ? current.filter((g) => g !== id) : [...current, id];
  return normalizeGroupSelection(next, groups);
}

// ------------------------------------------------------------ фільтр ------

/**
 * Сесії застосунку під фільтрами вкладки і глобальним зрізом.
 *  - groups: масив id або null (усі); archived: показувати архівні;
 *  - project: точний збіг;
 *  - day (дрил-даун) перевизначає period, як і для решти вкладок;
 *  - period рахується від anchorDay (останній день снапшота) за днем
 *    lastActivityAt у поясі снапшота; 0 означає «увесь час».
 */
export function filterAppSessions(snapshot, {
  groups = null, archived = false, project = null, period = 0, day = null, anchorDay = null,
} = {}) {
  const snap = snapshot || {};
  const list = Array.isArray(snap.appSessions) ? snap.appSessions : [];
  const tz = snap.timezone || DEFAULT_TZ;
  const sel = normalizeGroupSelection(groups, kitGroups(snap));
  const groupSet = sel ? new Set(sel) : null;
  const exact = DAY_RE.test(day || '') ? day : null;
  const from = exact || (period && DAY_RE.test(anchorDay || '') ? shiftDay(anchorDay, -(period - 1)) : null);

  return list.filter((s) => {
    if (!s) return false;
    if (!archived && s.archived) return false;
    if (groupSet && !groupSet.has(s.groupId)) return false;
    if (project && s.project !== project) return false;
    if (from) {
      const d = tzDay(s.lastActivityAt, tz);
      if (!d || d < from) return false;
      if (exact && d !== exact) return false;
    }
    return true;
  });
}

/** Скільки архівних сесій сховано тумблером (той самий зріз, але з архівними). */
export function hiddenArchivedCount(snapshot, opts = {}) {
  return filterAppSessions(snapshot, { ...opts, archived: true }).filter((s) => s.archived).length;
}

// -------------------------------------------------------- мапи лічильників -

/** Додатні цілі лічильники мапи {name: count} як [{name, count}], за спаданням. */
export function mapEntries(map) {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map)
    .map(([name, count]) => ({ name, count: Number(count) || 0 }))
    .filter((e) => e.name && e.count > 0)
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Мапа → 'xlsx ×3, pdf ×1' (порожньо, якщо нічого). */
export function mapText(map) {
  return mapEntries(map).map((e) => `${e.name} ×${e.count}`).join(', ');
}

/** Сума мап по списку записів: sumMaps(list, 'skills'). */
export function sumMaps(list, key) {
  const out = {};
  for (const s of list || []) {
    for (const e of mapEntries(s && s[key])) out[e.name] = (out[e.name] || 0) + e.count;
  }
  return out;
}

function hasAny(map) {
  return mapEntries(map).length > 0;
}

/** Чи викликала сесія хоч щось зі скілів, агентів чи воркфлоу (свої або в агентах). */
export function usedAnything(rec) {
  if (!rec) return false;
  return hasAny(rec.skills) || hasAny(rec.skillsInAgents)
    || hasAny(rec.agents) || hasAny(rec.agentsInAgents)
    || (Number(rec.workflows) || 0) > 0;
}

// ------------------------------------------------------------ підсумки ----

/**
 * Підсумок для картки вкладки. Скіли й агенти рахуються за ВЛАСНИМИ
 * викликами сесії (skills, agents); виклики всередині агентів видно в рядках.
 */
export function kitSummary(list, { topN = 8 } = {}) {
  const rows = list || [];
  const skills = sumMaps(rows, 'skills');
  const agents = sumMaps(rows, 'agents');
  return {
    sessions: rows.length,
    withSkills: rows.filter((s) => hasAny(s.skills)).length,
    withAgents: rows.filter((s) => hasAny(s.agents)).length,
    skillCalls: mapEntries(skills).reduce((a, e) => a + e.count, 0),
    agentCalls: mapEntries(agents).reduce((a, e) => a + e.count, 0),
    topSkills: mapEntries(skills).slice(0, topN),
    topAgents: mapEntries(agents).slice(0, topN),
    workflows: rows.reduce((a, s) => a + (Number(s.workflows) || 0), 0),
    costUsd: rows.reduce((a, s) => a + (Number(s.costUsd) || 0), 0),
  };
}

/** Порядок усередині групи: orderInGroup ↑ (без нього в кінці), далі свіжіші вище. */
function compareInGroup(a, b) {
  const oa = Number.isFinite(Number(a.orderInGroup)) && a.orderInGroup !== null ? Number(a.orderInGroup) : Infinity;
  const ob = Number.isFinite(Number(b.orderInGroup)) && b.orderInGroup !== null ? Number(b.orderInGroup) : Infinity;
  if (oa !== ob) return oa - ob;
  const ta = a.lastActivityAt || '';
  const tb = b.lastActivityAt || '';
  return ta < tb ? 1 : ta > tb ? -1 : 0;
}

/**
 * Сесії, розкладені по групах у порядку панелі. Порожні групи не повертаються.
 * @returns {Array<{group:{id,name,order}, sessions:Array, costUsd:number}>}
 */
export function groupAppSessions(list, groups) {
  const byGroup = new Map((groups || []).map((g) => [g.id, []]));
  for (const s of list || []) {
    if (byGroup.has(s.groupId)) byGroup.get(s.groupId).push(s);
  }
  return (groups || [])
    .map((g) => {
      const sessions = byGroup.get(g.id).slice().sort(compareInGroup);
      return {
        group: g,
        sessions,
        costUsd: sessions.reduce((a, s) => a + (Number(s.costUsd) || 0), 0),
      };
    })
    .filter((g) => g.sessions.length > 0);
}

/**
 * «Без групи»: лічильники за проєктами (за весь час, період до них не
 * застосовується, бо колектор віддає лише загальну кількість).
 */
export function ungroupedRows(snapshot, { project = null } = {}) {
  const snap = snapshot || {};
  const raw = Array.isArray(snap.appUngrouped) ? snap.appUngrouped : [];
  const rows = raw
    .filter((r) => r && r.project && (!project || r.project === project))
    .map((r) => ({
      project: r.project,
      sessions: Number(r.sessions) || 0,
      lastActivityAt: r.lastActivityAt || null,
    }))
    .filter((r) => r.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions || (a.project < b.project ? -1 : 1));
  return { rows, total: rows.reduce((a, r) => a + r.sessions, 0) };
}

// ------------------------------------------------------- зв'язок із сесіями -

/**
 * Найсвіжіший транскрипт сесії застосунку серед sessions[] (основні, не
 * сабчейни). Порядку масиву transcripts не довіряємо: беремо найпізніший
 * endedAt (або startedAt). Немає жодного в sessions[] (наприклад, сесія
 * дешевша за $0.01 і обрізана колектором): null, рядок не клікається.
 */
export function latestTranscriptSession(appSession, sessionsById) {
  if (!appSession || !Array.isArray(appSession.transcripts) || !sessionsById) return null;
  let best = null;
  let bestTs = '';
  for (const id of appSession.transcripts) {
    const s = sessionsById.get(id);
    if (!s || s.sidechain) continue;
    const ts = s.endedAt || s.startedAt || '';
    if (!best || ts > bestTs) {
      best = s;
      bestTs = ts;
    }
  }
  return best;
}

/** sessions[] → Map(sessionId → session). */
export function indexSessions(sessions) {
  const m = new Map();
  for (const s of sessions || []) if (s && s.sessionId) m.set(s.sessionId, s);
  return m;
}

// ---------------------------------------------------------- дайджест -------

/**
 * Поля v1.12 з дайджесту сесії для блоку дровера. Жодного поля немає
 * (старий колектор): null, блок не показується. Поля є, але порожні:
 * used:false, блок показує тьмяний рядок.
 */
export function digestKit(digest) {
  if (!digest || typeof digest !== 'object') return null;
  if (!KIT_DIGEST_KEYS.some((k) => digest[k] !== undefined)) return null;
  const rec = {
    skills: mapEntries(digest.skills),
    skillsInAgents: mapEntries(digest.skillsInAgents),
    agents: mapEntries(digest.agents),
    agentsInAgents: mapEntries(digest.agentsInAgents),
    workflows: Number(digest.workflows) || 0,
    commands: mapEntries(digest.commands),
  };
  return { ...rec, used: usedAnything(digest) };
}

// ------------------------------------------------------------ XLSX --------

/**
 * Рядки аркуша «Скіли й агенти»: одна сесія застосунку на рядок, у порядку
 * груп і панелі. null, якщо даних застосунку у знімку немає (аркуша не буде).
 */
export function kitSheetRows(snapshot, opts = {}) {
  if (!kitStatus(snapshot).ok) return null;
  const groups = kitGroups(snapshot);
  const tz = (snapshot && snapshot.timezone) || DEFAULT_TZ;
  const list = filterAppSessions(snapshot, opts);
  const rows = [];
  for (const g of groupAppSessions(list, groups)) {
    for (const s of g.sessions) {
      rows.push({
        group: g.group.name,
        title: String(s.title || s.appSessionId || ''),
        lastActivity: fmtKyivLong(s.lastActivityAt, tz),
        model: s.model ? shortModel(s.model) : '',
        effort: s.effort ? String(s.effort) : '',
        costUsd: Number(s.costUsd) || 0,
        skills: mapText(s.skills),
        skillsInAgents: mapText(s.skillsInAgents),
        agents: mapText(s.agents),
        workflows: Number(s.workflows) || 0,
        commands: mapText(s.commands),
      });
    }
  }
  return rows;
}
