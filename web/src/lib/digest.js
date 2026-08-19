// Дайджести сесій і проєктів (CONTRACT v1.7, частина B — читання).
//
// Колектор (частина A) кладе у снапшот schemaVersion 2:
//   sessions[].digest = {activity, tools:{name:count}, areas:[{path,count}],
//                        edits, filesTouched, intent}
//   projects[]        = {project, sessions, ..., areas, activities, titles, note}
//
// Цей модуль — чисті функції без DOM і без React: він рахує все, що показують
// вкладка «Проєкти», рядок-дайджест у «Сесіях», блок «Що відбувалося» в дровері,
// PDF і XLSX. Один розрахунок — п'ять споживачів.
//
// ВАЖЛИВО (v1: старий снапшот без дайджестів): жодна функція не кидає й не
// повертає «порожній каркас» — усе, чого немає, повертається як null або []
// і UI просто не рендерить блок. Наявність даних перевіряють через
// hasDigestData().
//
// Чому картки проєктів рахуються з ВІДФІЛЬТРОВАНОГО зрізу, а не беруться
// готовими з projects[]: projects[] — це агрегат за ВСЮ історію, а глобальний
// фільтр (період / день / проєкт) — головний контракт дашборда. Картка, яка
// ігнорує «7 днів», показувала б суми, що не сходяться з рештою вкладок.
// З projects[] беремо тільки те, чого зі зрізу не вивести: ручний `note`.

import {
  fmtInt, fmtDayRange, plural,
} from './format.js';

/** 'правки коду' → 'Правки коду' (рядок-опис починається з великої). */
export function capitalizeFirst(s) {
  const t = String(s || '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/**
 * Чи є в снапшоті дайджести взагалі (schemaVersion 2).
 * Порожній зріз (немає сесій за період) — це НЕ відсутність дайджестів:
 * ознакою лишається top-level projects[] з колектора.
 */
export function hasDigestData(snapshot) {
  if (!snapshot) return false;
  if (Array.isArray(snapshot.projects) && snapshot.projects.length > 0) return true;
  return (snapshot.sessions || []).some((s) => s && s.digest);
}

/** Топ-інструменти сесії як чіпи. Службовий ключ `other` (хвіст гістограми) не чіп. */
export function topTools(digest, limit = 5) {
  const tools = (digest && digest.tools) || null;
  if (!tools) return [];
  return Object.entries(tools)
    .filter(([name, count]) => name !== 'other' && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/** Скільки всього викликів інструментів у сесії (разом із хвостом `other`). */
export function toolCallCount(digest) {
  const tools = (digest && digest.tools) || null;
  if (!tools) return 0;
  return Object.values(tools).reduce((a, n) => a + (Number(n) || 0), 0);
}

/** Тривалість сесії в мс (startedAt→endedAt) або null, якщо міток немає. */
export function sessionDurationMs(session) {
  if (!session || !session.startedAt || !session.endedAt) return null;
  const a = new Date(session.startedAt).getTime();
  const b = new Date(session.endedAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return b - a;
}

/**
 * Рядок під назвою сесії: «Правки коду · web/src/components · 12 файлів».
 * Порожні складові просто випадають; зовсім порожній дайджест → null,
 * і викликач нічого не рендерить (снапшот v1 не має ламати таблицю).
 */
export function sessionDigestLine(session) {
  const d = session && session.digest;
  if (!d) return null;
  const parts = [];
  if (d.activity) parts.push(capitalizeFirst(d.activity));
  const area = (d.areas || [])[0];
  if (area && area.path) parts.push(area.path);
  const files = Number(d.filesTouched) || 0;
  if (files > 0) parts.push(`${fmtInt(files)} ${plural(files, 'файл', 'файли', 'файлів')}`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Картки проєктів для вкладки «Проєкти» (і для аркуша XLSX).
 * Вхід — ВЖЕ відфільтрований снапшот; вихід відсортований за вартістю ↓.
 *
 * Гроші й діапазон днів беруться з `days` (там повний облік), кількість сесій
 * і дайджести — із `sessions` (колектор відкидає сесії дешевші за $0.01, тож
 * ці два числа й не мусять сходитися — так само рахує аркуш «Проєкти» з v1.6).
 *
 * `share` — частка проєкту у витратах. База за замовчуванням — сума самого
 * зрізу, але викликач може передати `totalUsd`: коли в тулбарі вибрано один
 * проєкт, у зрізі лишається лише він, і частка «від зрізу» завжди дорівнювала б
 * 100 %. Вкладка «Проєкти» тому передає суму того самого періоду БЕЗ фільтра за
 * проєктом — картка показує ту саму частку до і після натискання «Показати лише
 * цей проєкт».
 *
 * @param {object} snapshot зріз {days, sessions, projects?}
 * @param {{topAreas?:number, topTitles?:number, topActivities?:number,
 *   totalUsd?:number|null}} [opts]
 * @returns {Array<{project:string, costUsd:number, share:number, sessions:number,
 *   sidechainSessions:number, sidechainUsd:number, sidechainShare:number,
 *   firstDay:string|null, lastDay:string|null, edits:number, filesTouched:number,
 *   activity:string|null, activities:Array<{label:string,count:number,share:number}>,
 *   areas:Array<{path:string,count:number}>,
 *   titles:Array<{title:string,costUsd:number,sessionId:string,sidechain:boolean}>,
 *   note:string|null, hasDigest:boolean}>}
 */
export function buildProjectCards(snapshot, {
  topAreas = 5, topTitles = 5, topActivities = 6, totalUsd: totalUsdBase = null,
} = {}) {
  const days = (snapshot && snapshot.days) || [];
  const sessions = (snapshot && snapshot.sessions) || [];
  const notes = new Map(
    ((snapshot && snapshot.projects) || []).map((p) => [p.project, p.note || null])
  );

  const map = new Map();
  const row = (project) => {
    let r = map.get(project);
    if (!r) {
      r = {
        project,
        costUsd: 0,
        sidechainUsd: 0,
        sessions: 0,
        sidechainSessions: 0,
        firstDay: null,
        lastDay: null,
        edits: 0,
        filesTouched: 0,
        hasDigest: false,
        areaMap: new Map(),
        actMap: new Map(),
        titles: [],
      };
      map.set(project, r);
    }
    return r;
  };

  for (const d of days) {
    if (!d || !d.project) continue;
    const r = row(d.project);
    r.costUsd += d.costUsd || 0;
    if (d.sidechain) r.sidechainUsd += d.costUsd || 0;
    if (d.day) {
      if (!r.firstDay || d.day < r.firstDay) r.firstDay = d.day;
      if (!r.lastDay || d.day > r.lastDay) r.lastDay = d.day;
    }
  }

  for (const s of sessions) {
    if (!s || !s.project) continue;
    const r = row(s.project);
    r.sessions += 1;
    if (s.sidechain) r.sidechainSessions += 1;
    r.titles.push({
      title: s.title || s.sessionId,
      costUsd: (s.totals && s.totals.costUsd) || 0,
      sessionId: s.sessionId,
      sidechain: !!s.sidechain,
    });
    const d = s.digest;
    if (!d) continue;
    r.hasDigest = true;
    r.edits += Number(d.edits) || 0;
    r.filesTouched += Number(d.filesTouched) || 0;
    if (d.activity) r.actMap.set(d.activity, (r.actMap.get(d.activity) || 0) + 1);
    for (const a of d.areas || []) {
      if (!a || !a.path) continue;
      r.areaMap.set(a.path, (r.areaMap.get(a.path) || 0) + (Number(a.count) || 0));
    }
  }

  // Number.isFinite відсіює і null (бази не передали), і NaN; 0 як базу теж
  // не беремо — ділення дало б Infinity замість чесного «частку не порахувати».
  const sliceUsd = [...map.values()].reduce((a, r) => a + r.costUsd, 0);
  const totalUsd = Number.isFinite(totalUsdBase) && totalUsdBase > 0
    ? totalUsdBase
    : sliceUsd;

  return [...map.values()]
    .map((r) => {
      const actTotal = [...r.actMap.values()].reduce((a, n) => a + n, 0);
      const activities = [...r.actMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topActivities)
        .map(([label, count]) => ({
          label, count, share: actTotal > 0 ? count / actTotal : 0,
        }));
      return {
        project: r.project,
        costUsd: r.costUsd,
        share: totalUsd > 0 ? r.costUsd / totalUsd : 0,
        sessions: r.sessions,
        sidechainSessions: r.sidechainSessions,
        sidechainUsd: r.sidechainUsd,
        sidechainShare: r.costUsd > 0 ? r.sidechainUsd / r.costUsd : 0,
        firstDay: r.firstDay,
        lastDay: r.lastDay,
        edits: r.edits,
        filesTouched: r.filesTouched,
        hasDigest: r.hasDigest,
        activity: activities.length ? activities[0].label : null,
        activities,
        areas: [...r.areaMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, topAreas)
          .map(([path, count]) => ({ path, count })),
        titles: r.titles
          .sort((a, b) => b.costUsd - a.costUsd)
          .slice(0, topTitles),
        note: notes.get(r.project) || null,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);
}

/**
 * Автоопис проєкту одним реченням:
 * «Правки коду · components/analytics, src/pages · 231 сесія · 7.08–19.08».
 * Складові, яких немає, просто випадають — речення лишається граматичним.
 */
export function projectSummary(card) {
  if (!card) return '';
  const parts = [];
  if (card.activity) parts.push(capitalizeFirst(card.activity));
  if (card.areas.length) parts.push(card.areas.slice(0, 2).map((a) => a.path).join(', '));
  const n = card.sessions || 0;
  if (n > 0) parts.push(`${fmtInt(n)} ${plural(n, 'сесія', 'сесії', 'сесій')}`);
  const range = fmtDayRange(card.firstDay, card.lastDay);
  if (range) parts.push(range);
  return parts.join(' · ');
}

/**
 * Мапа «проєкт → переважна активність» для стислого рядка «Чим займалися»
 * (PDF, денне зведення). Переважна = найчастіша серед сесій проєкту —
 * так само, як колектор рахує projects[].activities.
 * @returns {Map<string,string>}
 */
export function projectActivityMap(sessions) {
  const byProject = new Map();
  for (const s of sessions || []) {
    const label = s && s.digest && s.digest.activity;
    if (!label || !s.project) continue;
    const m = byProject.get(s.project) || new Map();
    m.set(label, (m.get(label) || 0) + 1);
    byProject.set(s.project, m);
  }
  const out = new Map();
  for (const [project, m] of byProject) {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) out.set(project, top[0]);
  }
  return out;
}
