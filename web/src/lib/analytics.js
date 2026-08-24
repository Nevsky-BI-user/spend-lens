// Чисті функції аналітики spend-lens. Жодних побічних ефектів, юніт-тестабельні.
// Вхід: снапшот (schemaVersion 1) — { days, sessions, pricingUsed, ... }.
// Гроші — USD. Ціни — USD за MTok (див. CONTRACT.md).

import { RULES, SEVERITY, SMALL_PROJECT_USD } from './rules.js';
import { fmtUsd, plural } from './format.js';

// ---------------------------------------------------------------- pricing ---

const WRITE_5M_MULT = 1.25;
const WRITE_1H_MULT = 2.0;

/** Ціна моделі з pricingUsed; невідома модель → нулі. */
export function priceFor(pricingUsed, model) {
  const p = (pricingUsed && pricingUsed[model]) || null;
  if (!p) return { input: 0, output: 0, cacheRead: 0 };
  return { input: p.input || 0, output: p.output || 0, cacheRead: p.cacheRead || 0 };
}

/** Вартість набору токенів за таблицею цін (USD/MTok). */
export function costOfTokens(tok, p) {
  const M = 1e6;
  return (
    (tok.input || 0) * p.input / M +
    (tok.output || 0) * p.output / M +
    (tok.cacheRead || 0) * p.cacheRead / M +
    (tok.cacheWrite5m || 0) * (p.input * WRITE_5M_MULT) / M +
    (tok.cacheWrite1h || 0) * (p.input * WRITE_1H_MULT) / M
  );
}

// ------------------------------------------------------------- утиліти ------

export function percentile(sortedAsc, q) {
  if (!sortedAsc.length) return 0;
  const idx = (sortedAsc.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function sum(arr, f) { return arr.reduce((a, x) => a + f(x), 0); }

/** Грошовий рядок для доказів: 1234.5 → '1 234,50' (як fmtUsd, без «$»). */
function usd(x) { return fmtUsd(Number(x) || 0).slice(1); }

/** YYYY-MM-DD → Date (локальний опівніч). */
export function dayToDate(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Останній день у снапшоті (як «сьогодні» для демо-даних). */
export function lastDay(days) {
  return days.reduce((a, d) => (d.day > a ? d.day : a), days[0] ? days[0].day : '');
}

function shiftDay(day, delta) {
  const d = dayToDate(day);
  d.setDate(d.getDate() + delta);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Форматер ISO-мітки → 'YYYY-MM-DD' у часовому поясі снапшота.
 * days бакетуються колектором у snapshot.timezone (Europe/Kyiv), тож
 * startedAt сесій треба зводити до дня в ТОМУ САМОМУ поясі — інакше для
 * глядача з іншим поясом сесії біля опівночі випадають з вікна періоду
 * або потрапляють у нього зайвий раз. Невалідний/відсутній пояс →
 * локальний час як запасний варіант.
 */
function isoDayFormatter(timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return (iso) => fmt.format(new Date(iso));
  } catch {
    return (iso) => {
      const d = new Date(iso);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
  }
}

// ------------------------------------------------------ глобальний фільтр ---

/** Проєкти за сумарною вартістю ↓ (для дропдауна «Усі проєкти»). */
export function projectsByCost(days) {
  const map = new Map();
  for (const d of days || []) {
    map.set(d.project, (map.get(d.project) || 0) + (d.costUsd || 0));
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([project]) => project);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Глобальний фільтр снапшота (чиста функція, мемоїзується в App):
 *  period  — кількість днів (7/30) від останнього дня снапшота; 0 = увесь час;
 *  project — назва проєкту або null = усі проєкти;
 *  day     — рівно один день 'YYYY-MM-DD' (дрил-даун v1.6). ПЕРЕВИЗНАЧАЄ period:
 *            користувач клікнув конкретний стовпчик і хоче саме його, а не
 *            «7 днів, серед яких є цей». Невалідне значення ігнорується.
 * days фільтруються за днем і проєктом; sessions — за днем startedAt (у поясі
 * снапшота, як і бакетування колектора) і проєктом.
 */
export function filterSnapshot(snapshot, { period = 0, project = null, day = null } = {}) {
  const days = snapshot.days || [];
  const sessions = snapshot.sessions || [];
  const exact = DAY_RE.test(day || '') ? day : null;
  const anchor = lastDay(days);
  const from = exact || (period && anchor ? shiftDay(anchor, -(period - 1)) : null);
  const to = exact; // null = без верхньої межі (звичайний період)
  const projOk = (p) => !project || p === project;
  const toDay = from ? isoDayFormatter(snapshot.timezone) : null;
  const sessionDayOk = (s) => {
    if (!from) return true;
    if (!s.startedAt) return false;
    const d = toDay(s.startedAt);
    return d >= from && (!to || d <= to);
  };

  return {
    ...snapshot,
    days: days.filter(
      (d) => projOk(d.project) && (!from || d.day >= from) && (!to || d.day <= to)
    ),
    sessions: sessions.filter((s) => projOk(s.project) && sessionDayOk(s)),
  };
}

// ---------------------------------------------------------------- KPI --------

/**
 * Середня вартість АКТИВНОГО дня за весь час: сума днів із витратами,
 * поділена на кількість таких днів. Дні без споживання (вихідні, відпустка)
 * у знаменник не йдуть — інакше «типовий день» падає тим нижче, чим більше
 * ви відпочивали, і будь-який робочий день виглядає аномальним.
 * `excludeDay` прибирає з бази сам день порівняння: інакше він тягнув би
 * власне середнє на себе (при 60 днях — на ~1,6 %, і тим сильніше, чим
 * дорожчий день).
 */
export function avgActiveDayCost(days, { excludeDay = null } = {}) {
  const byDay = new Map();
  for (const d of days || []) {
    if (excludeDay && d.day === excludeDay) continue;
    byDay.set(d.day, (byDay.get(d.day) || 0) + (d.costUsd || 0));
  }
  let total = 0, n = 0;
  for (const c of byDay.values()) {
    if (c > 0) { total += c; n += 1; }
  }
  return { avg: n ? total / n : 0, days: n };
}

/**
 * KPI: Сьогодні / 7 днів / 30 днів / Разом.
 * «Сьогодні» = anchorDay (останній день ПОВНОГО снапшота), щоб фільтр
 * за проєктом не зсував вікна на останній активний день проєкту.
 *
 * База порівняння різна за задумом:
 *  - «Сьогодні» — СЕРЕДНІЙ активний день за весь час. Учорашній день як база
 *    нічого не каже: якщо вчора не працювали, будь-яка сьогоднішня робота дає
 *    «+∞», а після важкого вчора нормальний день виглядає провалом.
 *  - решта вікон — попереднє вікно тієї ж довжини (тиждень проти тижня).
 */
export function computeKpis(days, anchorDay = null) {
  const today = anchorDay || lastDay(days);
  if (!today) return [];
  const inRange = (from, to) => days.filter((d) => d.day >= from && d.day <= to);
  const cost = (rows) => sum(rows, (r) => r.costUsd || 0);

  const mk = (label, from, to, prevFrom, prevTo) => {
    const cur = cost(inRange(from, to));
    const prev = prevFrom ? cost(inRange(prevFrom, prevTo)) : null;
    const deltaPct = prev && prev > 0 ? ((cur - prev) / prev) * 100 : null;
    return { label, costUsd: cur, deltaPct, deltaNote: 'проти попер. періоду' };
  };

  const todayCost = cost(inRange(today, today));
  const base = avgActiveDayCost(days, { excludeDay: today });
  const todayDelta = base.avg > 0 ? ((todayCost - base.avg) / base.avg) * 100 : null;

  return [
    {
      label: 'Сьогодні',
      costUsd: todayCost,
      deltaPct: todayDelta,
      deltaNote: 'проти середнього дня',
      baseAvg: base.avg,
      baseDays: base.days,
    },
    mk('7 днів', shiftDay(today, -6), today, shiftDay(today, -13), shiftDay(today, -7)),
    mk('30 днів', shiftDay(today, -29), today, shiftDay(today, -59), shiftDay(today, -30)),
    { label: 'Разом', costUsd: cost(days), deltaPct: null, allTime: true },
  ];
}

// ------------------------------------------------------------ серії днів ----

/** Щоденні витрати з розбивкою за моделями (для stacked bar).
 *  Моделі з нульовою сумарною вартістю (наприклад, `<synthetic>`) не потрапляють
 *  у список серій — інакше вони засмічують легенду порожніми рядками. */
export function dailyByModel(days, { from = null, to = null } = {}) {
  const map = new Map();
  const totals = new Map();
  for (const d of days) {
    if (from && d.day < from) continue;
    if (to && d.day > to) continue;
    totals.set(d.model, (totals.get(d.model) || 0) + (d.costUsd || 0));
    const row = map.get(d.day) || { day: d.day };
    row[d.model] = (row[d.model] || 0) + (d.costUsd || 0);
    map.set(d.day, row);
  }
  const rows = [...map.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const models = [...totals.entries()]
    .filter(([, cost]) => cost > 0)
    .map(([m]) => m)
    .sort();
  return { rows, models };
}

// ------------------------------------------------ v1.5: дні × проєкти -------

/** Назва зведеної серії «решта проєктів» (завжди остання, сіра). */
export const OTHER_PROJECT = 'Інші';

/**
 * Щоденні витрати з розбивкою за ПРОЄКТАМИ (stacked bar, близнюк dailyByModel).
 * topN найдорожчих проєктів у видимому діапазоні лишаються собою, решта
 * зводиться в «Інші» (завжди останній елемент `projects` → верх стеку).
 * Проєкти з нульовою сумарною вартістю не потрапляють у серії — інакше вони
 * засмічують легенду порожніми рядками (та сама логіка, що в dailyByModel).
 */
export function dailyByProject(days, { topN = 6 } = {}) {
  const totals = new Map();
  for (const d of days) {
    totals.set(d.project, (totals.get(d.project) || 0) + (d.costUsd || 0));
  }
  const ranked = [...totals.entries()]
    .filter(([, cost]) => cost > 0)
    .sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, topN).map(([p]) => p);
  const topSet = new Set(top);
  const restSet = new Set(ranked.slice(topN).map(([p]) => p));

  const map = new Map();
  for (const d of days) {
    let key = null;
    if (topSet.has(d.project)) key = d.project;
    else if (restSet.has(d.project)) key = OTHER_PROJECT;
    if (!key) continue; // проєкт із нульовою вартістю — не окрема серія
    const row = map.get(d.day) || { day: d.day };
    row[key] = (row[key] || 0) + (d.costUsd || 0);
    map.set(d.day, row);
  }
  const rows = [...map.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const projects = restSet.size ? [...top, OTHER_PROJECT] : top;
  return { rows, projects };
}

/** Кількість днів у місяці 'YYYY-MM'. */
function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Попередній календарний місяць для 'YYYY-MM'. */
function prevMonthOf(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Порівняння наростаючих підсумків по днях місяця (v1.5).
 *  cur      — цей місяць, кумулятивно, до дня-якоря включно (далі null);
 *  prev     — минулий місяць, кумулятивно, вирівняний за днем місяця;
 *  forecast — продовження від дня-якоря до кінця місяця за run-rate
 *             (сума за останні 7 днів / 7); null, якщо якір — останній
 *             день свого місяця (прогнозувати нема чого).
 * Довжина рядків = кількість днів у ЦЬОМУ місяці: вісь і тултіп підписані
 * поточним місяцем, тож зайві дні довшого минулого (31 травня проти 30 днів
 * червня) дали б неіснуючу дату «31 червня». Повний підсумок минулого місяця
 * лишається доступним у `prevTotal` (рахується окремо від рядків).
 * Гроші не округлюються — форматування лишається на format.js.
 */
export function cumulativeMonthCompare(days, anchorDay = null) {
  const anchor = anchorDay || lastDay(days);
  const empty = {
    rows: [], forecastTotal: null, prevTotal: 0, curTotal: 0,
    runRate: 0, month: '', monthDays: 0, anchorDom: 0,
  };
  if (!anchor) return empty;

  const month = anchor.slice(0, 7);
  const prevMonth = prevMonthOf(month);
  const anchorDom = Number(anchor.slice(8, 10));
  const lenCur = daysInMonth(month);
  const lenPrev = daysInMonth(prevMonth);

  const curDaily = new Array(lenCur + 1).fill(0);
  const prevDaily = new Array(lenPrev + 1).fill(0);
  for (const d of days) {
    const ym = d.day.slice(0, 7);
    const dom = Number(d.day.slice(8, 10));
    if (ym === month && dom >= 1 && dom <= lenCur) curDaily[dom] += d.costUsd || 0;
    else if (ym === prevMonth && dom >= 1 && dom <= lenPrev) prevDaily[dom] += d.costUsd || 0;
  }

  // Run-rate рахуємо по КАЛЕНДАРНОМУ вікну (7 днів назад від якоря), а не
  // «від початку місяця»: на початку місяця середнє по 2-3 днях стрибало б.
  const from = shiftDay(anchor, -6);
  let last7 = 0;
  for (const d of days) {
    if (d.day >= from && d.day <= anchor) last7 += d.costUsd || 0;
  }
  const runRate = last7 / 7;

  const hasForecast = anchorDom < lenCur;
  const rows = [];
  let accCur = 0, accPrev = 0, curTotal = 0;
  for (let dom = 1; dom <= lenCur; dom++) {
    accCur += curDaily[dom];
    if (dom <= lenPrev) accPrev += prevDaily[dom];
    if (dom === anchorDom) curTotal = accCur;
    rows.push({
      dom,
      cur: dom <= anchorDom ? accCur : null,
      // Коротший минулий місяць (лютий проти березня) просто обривається.
      prev: dom <= lenPrev ? accPrev : null,
      forecast: null,
    });
  }
  if (hasForecast) {
    // Прогноз стартує в точці якоря — інакше пунктир «висів» би в повітрі.
    for (let dom = anchorDom; dom <= lenCur; dom++) {
      rows[dom - 1].forecast = curTotal + runRate * (dom - anchorDom);
    }
  }

  return {
    rows,
    forecastTotal: hasForecast ? curTotal + runRate * (lenCur - anchorDom) : null,
    // Повний минулий місяць — незалежно від того, чи вліз він у рядки.
    prevTotal: prevDaily.reduce((a, x) => a + x, 0),
    curTotal,
    runRate,
    month,
    monthDays: lenCur,
    anchorDom,
  };
}

/**
 * Топ проєктів за період + Δ проти попереднього вікна такої ж довжини (v1.5).
 *  daysFiltered — дні, вже обрізані глобальним фільтром (період + проєкт);
 *  daysAll      — ті самі дні БЕЗ фільтра періоду (потрібні для минулого вікна);
 *  period       — довжина вікна в днях; 0 («увесь час») → порівняння немає.
 * Повертає [{ project, costUsd, prevUsd, deltaPct, isNew }], вартість ↓.
 */
export function projectsWithDelta(
  daysFiltered,
  daysAll,
  { period = 0, anchorDay = null, topN = 8 } = {}
) {
  const anchor = anchorDay || lastDay(daysAll && daysAll.length ? daysAll : daysFiltered || []);
  const cur = new Map();
  for (const d of daysFiltered || []) {
    cur.set(d.project, (cur.get(d.project) || 0) + (d.costUsd || 0));
  }
  const ranked = [...cur.entries()]
    .filter(([, cost]) => cost > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  // Попереднє вікно тієї ж довжини, впритул перед поточним (як у computeKpis).
  let prev = null;
  if (period > 0 && anchor) {
    const prevTo = shiftDay(anchor, -period);
    const prevFrom = shiftDay(anchor, -(period * 2 - 1));
    prev = new Map();
    for (const d of daysAll || []) {
      if (d.day < prevFrom || d.day > prevTo) continue;
      prev.set(d.project, (prev.get(d.project) || 0) + (d.costUsd || 0));
    }
  }

  return ranked.map(([project, costUsd]) => {
    const prevUsd = prev ? (prev.get(project) || 0) : null;
    return {
      project,
      costUsd,
      prevUsd,
      deltaPct: prevUsd > 0 ? ((costUsd - prevUsd) / prevUsd) * 100 : null,
      isNew: prev != null && prevUsd === 0,
    };
  });
}

/** Кумулятивна вартість поточного місяця (місяць останнього дня). */
export function cumulativeMonth(days) {
  const today = lastDay(days);
  if (!today) return [];
  const month = today.slice(0, 7);
  const daily = new Map();
  for (const d of days) {
    if (d.day.slice(0, 7) !== month) continue;
    daily.set(d.day, (daily.get(d.day) || 0) + (d.costUsd || 0));
  }
  const sorted = [...daily.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  let acc = 0;
  return sorted.map(([day, c]) => { acc += c; return { day, cumUsd: acc }; });
}

/** Pareto: вартість за проєктами за період (днів назад від останнього дня). */
export function costByProject(days, periodDays = 30) {
  const today = lastDay(days);
  const from = periodDays ? shiftDay(today, -(periodDays - 1)) : null;
  const map = new Map();
  for (const d of days) {
    if (from && d.day < from) continue;
    map.set(d.project, (map.get(d.project) || 0) + (d.costUsd || 0));
  }
  return [...map.entries()]
    .map(([project, costUsd]) => ({ project, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

/** Вартість за моделями (donut). */
export function costByModel(days, periodDays = 30) {
  const today = lastDay(days);
  const from = periodDays ? shiftDay(today, -(periodDays - 1)) : null;
  const map = new Map();
  for (const d of days) {
    if (from && d.day < from) continue;
    map.set(d.model, (map.get(d.model) || 0) + (d.costUsd || 0));
  }
  return [...map.entries()]
    .map(([model, costUsd]) => ({ model, costUsd }))
    .filter((x) => x.costUsd > 0) // нульові моделі (`<synthetic>`) не показуємо в donut
    .sort((a, b) => b.costUsd - a.costUsd);
}

/** Основні проти субагентів (sidechain) за період. */
export function mainVsSidechain(days, periodDays = 30) {
  const today = lastDay(days);
  const from = periodDays ? shiftDay(today, -(periodDays - 1)) : null;
  let main = 0, side = 0;
  for (const d of days) {
    if (from && d.day < from) continue;
    if (d.sidechain) side += d.costUsd || 0; else main += d.costUsd || 0;
  }
  return { main, side };
}

/**
 * Економіка кешу за днями:
 *  hitPct  — % cacheRead від контексту (input+cacheRead+cacheWrite*)
 *  savedUsd — скільки зекономив кеш = cacheRead × (input − cacheRead) ціни моделі
 */
export function cacheEconomics(days, pricingUsed, periodDays = 30) {
  const today = lastDay(days);
  const from = periodDays ? shiftDay(today, -(periodDays - 1)) : null;
  const map = new Map();
  for (const d of days) {
    if (from && d.day < from) continue;
    const row = map.get(d.day) || { day: d.day, read: 0, ctx: 0, savedUsd: 0 };
    const ctx = (d.input || 0) + (d.cacheRead || 0) + (d.cacheWrite5m || 0) + (d.cacheWrite1h || 0);
    row.read += d.cacheRead || 0;
    row.ctx += ctx;
    const p = priceFor(pricingUsed, d.model);
    row.savedUsd += (d.cacheRead || 0) * Math.max(0, p.input - p.cacheRead) / 1e6;
    map.set(d.day, row);
  }
  return [...map.values()]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((r) => ({ day: r.day, hitPct: r.ctx > 0 ? (r.read / r.ctx) * 100 : 0, savedUsd: r.savedUsd }));
}

// ------------------------------------------------------- проєкти: сабчейни --

/** Статистика сабчейнів на рівні проєкту (з days). */
export function projectSidechainStats(days) {
  const map = new Map();
  for (const d of days) {
    const row = map.get(d.project) || { project: d.project, total: 0, side: 0 };
    row.total += d.costUsd || 0;
    if (d.sidechain) row.side += d.costUsd || 0;
    map.set(d.project, row);
  }
  return [...map.values()].map((r) => ({
    ...r,
    share: r.total > 0 ? r.side / r.total : 0,
  }));
}

// ------------------------------------------------------------ прапорці ------

/**
 * Прапорці однієї сесії. Повертає масив { type, wasteUsd, evidence }.
 * p90CostUsd і subagentProjects передаються ззовні (контекст усього снапшота).
 */
export function sessionFlags(session, pricingUsed, { p90CostUsd = Infinity, subagentProjects = new Set() } = {}) {
  const flags = [];
  const t = session.totals || {};
  const cost = t.costUsd || 0;

  // --- CACHE_MISS ---
  const R = RULES.CACHE_MISS;
  if ((session.cacheHitRate ?? 1) < R.maxHitRate && cost > R.minCostUsd) {
    // (input + writes) за повною ціною − ті самі токени за ціною cacheRead, × коефіцієнт
    let asIs = 0, ifCached = 0;
    for (const [model, m] of Object.entries(session.models || {})) {
      const p = priceFor(pricingUsed, model);
      const tokens = (m.input || 0) + (m.cacheWrite5m || 0) + (m.cacheWrite1h || 0);
      asIs += costOfTokens({ input: m.input, cacheWrite5m: m.cacheWrite5m, cacheWrite1h: m.cacheWrite1h }, p);
      ifCached += tokens * p.cacheRead / 1e6;
    }
    const wasteUsd = Math.max(0, (asIs - ifCached) * R.realisticFactor);
    flags.push({
      type: 'CACHE_MISS',
      wasteUsd,
      evidence: `кеш-хіт ${Math.round((session.cacheHitRate || 0) * 100)} % при вартості $${usd(cost)}`,
    });
  }

  // --- FAT_CONTEXT ---
  const F = RULES.FAT_CONTEXT;
  if ((session.avgContext || 0) > F.maxAvgContext) {
    // Вартість надлишку контексту (avgContext − базлайн) на кожен хід асистента,
    // за змішаною ціною input/cacheRead відповідно до фактичного міксу токенів.
    const excess = (session.avgContext || 0) - F.baselineContext;
    let ctxTokens = 0, ctxCost = 0;
    for (const [model, m] of Object.entries(session.models || {})) {
      const p = priceFor(pricingUsed, model);
      const tokens = (m.input || 0) + (m.cacheRead || 0) + (m.cacheWrite5m || 0) + (m.cacheWrite1h || 0);
      ctxTokens += tokens;
      ctxCost += costOfTokens({
        input: m.input, cacheRead: m.cacheRead,
        cacheWrite5m: m.cacheWrite5m, cacheWrite1h: m.cacheWrite1h,
      }, p);
    }
    const blended = ctxTokens > 0 ? ctxCost / ctxTokens : 0; // USD за токен контексту
    const wasteUsd = Math.max(0, excess * (session.assistantTurns || 0) * blended);
    flags.push({
      type: 'FAT_CONTEXT',
      wasteUsd,
      evidence: `середній контекст ${Math.round((session.avgContext || 0) / 1000)}k токенів`,
    });
  }

  // --- LONG_SESSION ---
  const L = RULES.LONG_SESSION;
  if ((session.assistantTurns || 0) > L.maxAssistantTurns) {
    flags.push({
      type: 'LONG_SESSION',
      wasteUsd: cost * L.wasteShare,
      evidence: `${session.assistantTurns} ${plural(session.assistantTurns, 'хід', 'ходи', 'ходів')} асистента без очищення контексту`,
    });
  }

  // --- PREMIUM_MODEL ---
  const P = RULES.PREMIUM_MODEL;
  {
    let ifSonnet = 0;
    for (const m of Object.values(session.models || {})) {
      ifSonnet += costOfTokens({
        input: m.input, output: m.output, cacheRead: m.cacheRead,
        cacheWrite5m: m.cacheWrite5m, cacheWrite1h: m.cacheWrite1h,
      }, P.sonnetPricing);
    }
    const premium = cost - ifSonnet;
    if (premium > P.minPremiumUsd) {
      flags.push({
        type: 'PREMIUM_MODEL',
        wasteUsd: premium,
        evidence: `надбавка проти sonnet: $${usd(premium)}`,
      });
    }
  }

  // --- SUBAGENT_HEAVY (позначка сесії, якщо її проєкт — сабчейн-важкий) ---
  if (session.sidechain && subagentProjects.has(session.project)) {
    flags.push({
      type: 'SUBAGENT_HEAVY',
      wasteUsd: cost * RULES.SUBAGENT_HEAVY.wasteShare,
      evidence: `сабчейн-сесія в проєкті з переважанням субагентів`,
    });
  }

  // --- TOP_BURNER ---
  if (cost > p90CostUsd) {
    flags.push({
      type: 'TOP_BURNER',
      wasteUsd: 0,
      // v1.8: без порівняння «дорожча за типову сесію» — лише позиція
      // в розподілі власних витрат, без множників проти чужої суми.
      evidence: `$${usd(cost)} за сесію — верхні 10 % за витратами`,
    });
  }

  return flags;
}

/** Прапорці всіх сесій + контекст (p90, сабчейн-важкі проєкти). */
export function analyzeSessions(snapshot) {
  const sessions = snapshot.sessions || [];
  const costs = sessions.map((s) => (s.totals && s.totals.costUsd) || 0).sort((a, b) => a - b);
  const p90CostUsd = percentile(costs, RULES.TOP_BURNER.percentile);

  const S = RULES.SUBAGENT_HEAVY;
  const projStats = projectSidechainStats(snapshot.days || []);
  const heavy = projStats.filter((p) => p.share > S.minShare && p.side > S.minCostUsd);
  const subagentProjects = new Set(heavy.map((p) => p.project));

  const flagged = sessions.map((s) => ({
    session: s,
    flags: sessionFlags(s, snapshot.pricingUsed, { p90CostUsd, subagentProjects }),
  }));

  return { flagged, p90CostUsd, subagentHeavyProjects: heavy };
}

// ------------------------------------------------------------- фактори ------

const FACTOR_ORDER = ['CACHE_MISS', 'FAT_CONTEXT', 'PREMIUM_MODEL', 'LONG_SESSION', 'SUBAGENT_HEAVY'];

const FACTOR_WHY = {
  CACHE_MISS:
    'Кеш інвалідовується: хуки змінюють системний промпт щотурну, сесії часто рестартують — і той самий контекст оплачується за повною ціною замість кешу.',
  FAT_CONTEXT:
    'Кожен хід асистента заново читає весь контекст. Контекст понад ~120k токенів означає, що більшість оплачених токенів — це баласт, який не стосується поточної задачі.',
  PREMIUM_MODEL:
    'Преміум-модель виконує механічну роботу (масові правки, скаутинг файлів), з якою так само добре впорається sonnet або haiku за кілька відсотків ціни.',
  LONG_SESSION:
    'Сесія без /clear накопичує контекст: наприкінці кожен хід тягне за собою всю історію, і вартість ходу зростає в рази.',
  SUBAGENT_HEAVY:
    'Субагенти множать витрати: кожен отримує власну копію контексту. Коли їхня частка переважає, часто це workflow, де вистачило б одного проходу.',
};

/**
 * Пофакторний аналіз: сума оцінок втрат за типами прапорців.
 * SUBAGENT_HEAVY рахується на рівні проєктів (щоб не задвоювати сесії).
 */
export function computeFactors(snapshot) {
  const { flagged, subagentHeavyProjects } = analyzeSessions(snapshot);
  const acc = new Map(FACTOR_ORDER.map((t) => [t, { type: t, totalUsd: 0, evidence: [] }]));

  for (const { session, flags } of flagged) {
    for (const f of flags) {
      if (f.type === 'SUBAGENT_HEAVY' || f.type === 'TOP_BURNER') continue;
      const a = acc.get(f.type);
      a.totalUsd += f.wasteUsd;
      a.evidence.push({
        kind: 'session',
        name: session.title || session.sessionId,
        project: session.project,
        wasteUsd: f.wasteUsd,
      });
    }
  }

  const subFactor = acc.get('SUBAGENT_HEAVY');
  for (const p of subagentHeavyProjects) {
    const waste = p.side * RULES.SUBAGENT_HEAVY.wasteShare;
    subFactor.totalUsd += waste;
    subFactor.evidence.push({ kind: 'project', name: p.project, project: p.project, wasteUsd: waste });
  }

  return [...acc.values()]
    .map((a) => ({
      ...a,
      why: FACTOR_WHY[a.type],
      evidence: a.evidence.sort((x, y) => y.wasteUsd - x.wasteUsd).slice(0, 3),
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd);
}

// ------------------------------------------------------- рекомендації -------

function severityOf(wasteUsd) {
  if (wasteUsd > SEVERITY.high) return 'high';
  if (wasteUsd > SEVERITY.medium) return 'medium';
  return 'low';
}

function dominantModel(models) {
  let best = null, bestCost = -1;
  for (const [model, m] of Object.entries(models || {})) {
    if ((m.costUsd || 0) > bestCost) { bestCost = m.costUsd || 0; best = model; }
  }
  return best || 'невідому модель';
}

/**
 * Картки «Дії»: згруповані за правилом і проєктом (LONG_SESSION — за сесією),
 * з готовими до вставки українськими промптами. Сортування: втрати ↓.
 */
export function buildRecommendations(snapshot) {
  const { flagged, subagentHeavyProjects } = analyzeSessions(snapshot);
  const cards = [];

  // Групуємо CACHE_MISS / FAT_CONTEXT / PREMIUM_MODEL за проєктом
  const byProject = new Map();
  for (const { session, flags } of flagged) {
    for (const f of flags) {
      if (!['CACHE_MISS', 'FAT_CONTEXT', 'PREMIUM_MODEL'].includes(f.type)) continue;
      const key = `${f.type}|${session.project}`;
      const g = byProject.get(key) || { type: f.type, project: session.project, wasteUsd: 0, sessions: [] };
      g.wasteUsd += f.wasteUsd;
      g.sessions.push({ session, flag: f });
      byProject.set(key, g);
    }
  }

  for (const g of byProject.values()) {
    const n = g.sessions.length;
    if (g.type === 'CACHE_MISS') {
      const rates = g.sessions.map(({ session }) => session.cacheHitRate || 0);
      const rate = Math.round((rates.reduce((a, x) => a + x, 0) / n) * 100);
      cards.push({
        id: `CACHE_MISS|${g.project}`,
        type: 'CACHE_MISS',
        severity: severityOf(g.wasteUsd),
        wasteUsd: g.wasteUsd,
        title: `Кеш-промахи в проєкті ${g.project}`,
        evidence: `${n} ${plural(n, 'сесія', 'сесії', 'сесій')}, середній кеш-хіт ${rate} %, оцінка втрат $${usd(g.wasteUsd)}`,
        prompt: `У проєкті ${g.project} низький кеш-хіт (${rate}%). Проаналізуй, що інвалідовує кеш: хуки, що змінюють системний промпт (rtk, SessionStart), часті рестарти сесій. Запропонуй виправлення.`,
      });
    } else if (g.type === 'FAT_CONTEXT') {
      const avg = Math.round(
        g.sessions.reduce((a, { session }) => a + (session.avgContext || 0), 0) / n / 1000
      );
      cards.push({
        id: `FAT_CONTEXT|${g.project}`,
        type: 'FAT_CONTEXT',
        severity: severityOf(g.wasteUsd),
        wasteUsd: g.wasteUsd,
        title: `Роздутий контекст у проєкті ${g.project}`,
        evidence: `${n} ${plural(n, 'сесія', 'сесії', 'сесій')} із середнім контекстом ~${avg}k токенів, оцінка втрат $${usd(g.wasteUsd)}`,
        prompt: `Сесії в ${g.project} тримають контекст ~${avg}k токенів. Розбивай задачі, використовуй /clear між незалежними задачами, виноси довідкові дані в CLAUDE.md/скіли замість читання великих файлів щотурну.`,
      });
    } else if (g.type === 'PREMIUM_MODEL') {
      const model = dominantModel(g.sessions[0].session.models);
      cards.push({
        id: `PREMIUM_MODEL|${g.project}`,
        type: 'PREMIUM_MODEL',
        severity: severityOf(g.wasteUsd),
        wasteUsd: g.wasteUsd,
        title: `Дорога модель у проєкті ${g.project}`,
        evidence: `${n} ${plural(n, 'сесія', 'сесії', 'сесій')}, надбавка проти sonnet $${usd(g.wasteUsd)}`,
        prompt: `Механічні задачі в ${g.project} йдуть на ${model}. Признач для субагентів-скаутів model: haiku, для масових правок sonnet; залиш преміум-модель тільки для архітектури й складного дебагу.`,
      });
    }
  }

  // LONG_SESSION — картка на сесію
  for (const { session, flags } of flagged) {
    const f = flags.find((x) => x.type === 'LONG_SESSION');
    if (!f) continue;
    const title = session.title || session.sessionId.slice(0, 8);
    cards.push({
      id: `LONG_SESSION|${session.sessionId}`,
      type: 'LONG_SESSION',
      severity: severityOf(f.wasteUsd),
      wasteUsd: f.wasteUsd,
      title: `Наддовга сесія в проєкті ${session.project}`,
      evidence: `${session.assistantTurns} ${plural(session.assistantTurns, 'хід', 'ходи', 'ходів')}, вартість $${usd(session.totals?.costUsd || 0)}, оцінка втрат $${usd(f.wasteUsd)}`,
      prompt: `Сесія "${title}" — ${session.assistantTurns} ${plural(session.assistantTurns, 'хід', 'ходи', 'ходів')} без очищення. Заведи звичку: одна задача = одна сесія або /clear.`,
    });
  }

  // SUBAGENT_HEAVY — картка на проєкт
  for (const p of subagentHeavyProjects) {
    const share = Math.round(p.share * 100);
    const waste = p.side * RULES.SUBAGENT_HEAVY.wasteShare;
    cards.push({
      id: `SUBAGENT_HEAVY|${p.project}`,
      type: 'SUBAGENT_HEAVY',
      severity: severityOf(waste),
      wasteUsd: waste,
      title: `Субагенти домінують у проєкті ${p.project}`,
      evidence: `${share} % витрат проєкту ($${usd(p.side)}) — сабчейни, оцінка втрат $${usd(waste)}`,
      prompt: `${p.project}: ${share}% витрат — субагенти. Перевір, чи не запускаються workflows/агенти там, де вистачить одного проходу.`,
    });
  }

  return cards.sort((a, b) => b.wasteUsd - a.wasteUsd);
}

/** Рекомендації однієї сесії (для дровера). */
export function sessionRecommendations(session, flags) {
  const recs = [];
  const title = session.title || session.sessionId.slice(0, 8);
  for (const f of flags) {
    switch (f.type) {
      case 'CACHE_MISS': {
        const rate = Math.round((session.cacheHitRate || 0) * 100);
        recs.push({
          type: f.type,
          prompt: `У проєкті ${session.project} низький кеш-хіт (${rate}%). Проаналізуй, що інвалідовує кеш: хуки, що змінюють системний промпт (rtk, SessionStart), часті рестарти сесій. Запропонуй виправлення.`,
        });
        break;
      }
      case 'FAT_CONTEXT': {
        const avg = Math.round((session.avgContext || 0) / 1000);
        recs.push({
          type: f.type,
          prompt: `Сесії в ${session.project} тримають контекст ~${avg}k токенів. Розбивай задачі, використовуй /clear між незалежними задачами, виноси довідкові дані в CLAUDE.md/скіли замість читання великих файлів щотурну.`,
        });
        break;
      }
      case 'PREMIUM_MODEL': {
        recs.push({
          type: f.type,
          prompt: `Механічні задачі в ${session.project} йдуть на ${dominantModel(session.models)}. Признач для субагентів-скаутів model: haiku, для масових правок sonnet; залиш преміум-модель тільки для архітектури й складного дебагу.`,
        });
        break;
      }
      case 'LONG_SESSION': {
        recs.push({
          type: f.type,
          prompt: `Сесія "${title}" — ${session.assistantTurns} ${plural(session.assistantTurns, 'хід', 'ходи', 'ходів')} без очищення. Заведи звичку: одна задача = одна сесія або /clear.`,
        });
        break;
      }
      case 'SUBAGENT_HEAVY': {
        recs.push({
          type: f.type,
          prompt: `${session.project}: значна частка витрат — субагенти. Перевір, чи не запускаються workflows/агенти там, де вистачить одного проходу.`,
        });
        break;
      }
      default:
        break;
    }
  }
  return recs;
}

// =========================================================== v1.6 ==========
// Нові чисті функції (ефективність, патерни, бюджет). Додаються ЛИШЕ
// доповненням: сигнатури функцій вище не змінюються — на них спирається
// web/src/print/PrintReport.jsx.

// ------------------------------------------------ ефективність (v1.6 §4) ----

/**
 * «Вартість одного ходу асистента» по днях + ковзне середнє (CONTRACT v1.6 §4a).
 * Дні з `messages = 0` пропускаються (ділити нема на що).
 *
 * Ковзне середнє ЗВАЖЕНЕ: сума вартості вікна / сума ходів вікна, а не
 * середнє з відношень — інакше день з одним ходом важив би стільки ж,
 * скільки день із двома сотнями. Вікно — останні `ma` НАЯВНИХ точок
 * (порожні дні у снапшот не пишуться); на початку серії вікно неповне,
 * але значення завжди визначене, щоб лінія не зникала на короткому періоді.
 *
 * @param {Array} days снапшот `days`
 * @param {{ma?:number}} [opts] розмір вікна ковзного середнього (типово 7)
 * @returns {{rows:Array<{day:string,costUsd:number,messages:number,costPerTurn:number,ma:number}>,
 *            maWindow:number, avgCostPerTurn:number, totalCostUsd:number, totalMessages:number}}
 */
export function costPerTurnSeries(days, { ma = 7 } = {}) {
  const map = new Map();
  for (const d of days || []) {
    if (!d || !d.day) continue;
    const row = map.get(d.day) || { day: d.day, costUsd: 0, messages: 0 };
    row.costUsd += d.costUsd || 0;
    row.messages += d.messages || 0;
    map.set(d.day, row);
  }
  const rows = [...map.values()]
    .filter((r) => r.messages > 0)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((r) => ({ ...r, costPerTurn: r.costUsd / r.messages, ma: null }));

  const win = Math.max(1, Math.round(ma) || 1);
  for (let i = 0; i < rows.length; i++) {
    let c = 0, m = 0;
    for (let j = Math.max(0, i - win + 1); j <= i; j++) {
      c += rows[j].costUsd;
      m += rows[j].messages;
    }
    rows[i].ma = m > 0 ? c / m : null;
  }

  const totalCostUsd = sum(rows, (r) => r.costUsd);
  const totalMessages = sum(rows, (r) => r.messages);
  return {
    rows,
    maWindow: win,
    avgCostPerTurn: totalMessages > 0 ? totalCostUsd / totalMessages : 0,
    totalCostUsd,
    totalMessages,
  };
}

/**
 * «$ за 1M вихідних токенів» за моделями (CONTRACT v1.6 §4b) — горизонтальні
 * бари. Це фактична (а не прайсова) ціна виходу: у неї зашита вся вартість
 * контексту, тому модель із роздутим контекстом виглядає дорожчою за прайс.
 * Моделі без виходу або без вартості (`<synthetic>`) не потрапляють у список.
 * @returns {Array<{model:string,costUsd:number,output:number,messages:number,usdPerMTok:number}>} ↓ за usdPerMTok
 */
export function costPerOutputMTokByModel(days) {
  const map = new Map();
  for (const d of days || []) {
    if (!d || !d.model) continue;
    const row = map.get(d.model) || { model: d.model, costUsd: 0, output: 0, messages: 0 };
    row.costUsd += d.costUsd || 0;
    row.output += d.output || 0;
    row.messages += d.messages || 0;
    map.set(d.model, row);
  }
  return [...map.values()]
    .filter((r) => r.output > 0 && r.costUsd > 0)
    .map((r) => ({ ...r, usdPerMTok: (r.costUsd / r.output) * 1e6 }))
    .sort((a, b) => b.usdPerMTok - a.usdPerMTok);
}

/**
 * KPI-трійця картки «Ефективність» (CONTRACT v1.6 §4c):
 * середня вартість сесії, середня вартість ходу, частка кешу в контексті.
 * Гроші за ходами беруться з `days` (там повний облік), середня сесія —
 * із `sessions` (там сесії дешевші за $0.01 можуть бути відкинуті колектором,
 * тож sessionCount ≠ кількість сесій у `days`).
 * @returns {{avgSessionUsd:number, medianSessionUsd:number, sessionCount:number,
 *            avgTurnUsd:number, messages:number, totalUsd:number, sessionsUsd:number,
 *            cacheShare:number, cacheReadTokens:number, contextTokens:number}}
 */
export function efficiencyKpis(days, sessions) {
  let totalUsd = 0, messages = 0;
  let cacheReadTokens = 0, contextTokens = 0;
  for (const d of days || []) {
    totalUsd += d.costUsd || 0;
    messages += d.messages || 0;
    const read = d.cacheRead || 0;
    cacheReadTokens += read;
    contextTokens += (d.input || 0) + read + (d.cacheWrite5m || 0) + (d.cacheWrite1h || 0);
  }
  const costs = (sessions || []).map((s) => (s.totals && s.totals.costUsd) || 0);
  const sessionsUsd = costs.reduce((a, x) => a + x, 0);
  const sorted = [...costs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const medianSessionUsd = sorted.length
    ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
    : 0;

  return {
    avgSessionUsd: costs.length ? sessionsUsd / costs.length : 0,
    medianSessionUsd,
    sessionCount: costs.length,
    sessionsUsd,
    avgTurnUsd: messages > 0 ? totalUsd / messages : 0,
    messages,
    totalUsd,
    cacheShare: contextTokens > 0 ? cacheReadTokens / contextTokens : 0,
    cacheReadTokens,
    contextTokens,
  };
}

// -------------------------------------------------- патерни: теплокарта -----

/** Дні тижня, понеділок першим (рядки теплокарти). */
export const WEEKDAYS_SHORT_UA = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
export const WEEKDAYS_UA = [
  'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота', 'неділя',
];

const EN_WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** ISO → { weekday: 0..6 (Пн=0), hour: 0..23 } у заданому поясі. */
function weekdayHourFormatter(timeZone) {
  let fmt = null;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', hourCycle: 'h23',
    });
  } catch {
    fmt = null; // невалідний пояс → локальний час як запасний варіант
  }
  return (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    if (!fmt) return { weekday: (d.getDay() + 6) % 7, hour: d.getHours() };
    let weekday = null, hour = null;
    for (const part of fmt.formatToParts(d)) {
      if (part.type === 'weekday') weekday = EN_WEEKDAY_INDEX[part.value];
      else if (part.type === 'hour') hour = Number(part.value);
    }
    if (weekday == null || !Number.isFinite(hour)) return null;
    return { weekday, hour: hour % 24 };
  };
}

/**
 * Теплокарта «Коли горять гроші» (CONTRACT v1.6 §5): 7 × 24, вартість сесії
 * віднесена до ГОДИНИ ЇЇ ПОЧАТКУ, переведеної в `timeZone` (Europe/Kyiv) через
 * Intl — снапшот зберігає startedAt в UTC, а глядач може сидіти будь-де.
 * Рядок 0 — понеділок (українська тижнева сітка).
 *
 * @param {Array} sessions снапшот `sessions`
 * @param {string} [timeZone='Europe/Kyiv']
 * @returns {{matrix:number[][], counts:number[][], max:number, min:number, minNonZero:number,
 *            total:number, sessions:number, skipped:number, timeZone:string,
 *            peak:{weekday:number,hour:number,costUsd:number,sessions:number}|null,
 *            byWeekday:number[], byHour:number[],
 *            weekdays:string[], weekdaysFull:string[]}}
 */
export function heatmapWeekdayHour(sessions, timeZone = 'Europe/Kyiv') {
  const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const counts = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const toWh = weekdayHourFormatter(timeZone);
  let total = 0, used = 0, skipped = 0;

  for (const s of sessions || []) {
    const wh = s && s.startedAt ? toWh(s.startedAt) : null;
    if (!wh) { skipped++; continue; }
    const cost = (s.totals && s.totals.costUsd) || 0;
    matrix[wh.weekday][wh.hour] += cost;
    counts[wh.weekday][wh.hour] += 1;
    total += cost;
    used++;
  }

  let max = 0, min = Infinity, minNonZero = Infinity, peak = null;
  const byWeekday = new Array(7).fill(0);
  const byHour = new Array(24).fill(0);
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      const v = matrix[w][h];
      byWeekday[w] += v;
      byHour[h] += v;
      if (v > max) { max = v; peak = { weekday: w, hour: h, costUsd: v, sessions: counts[w][h] }; }
      if (v < min) min = v;
      if (v > 0 && v < minNonZero) minNonZero = v;
    }
  }

  return {
    matrix,
    counts,
    max,
    min: Number.isFinite(min) ? min : 0,
    minNonZero: Number.isFinite(minNonZero) ? minNonZero : 0,
    total,
    sessions: used,
    skipped,
    timeZone,
    peak,
    byWeekday,
    byHour,
    weekdays: WEEKDAYS_SHORT_UA,
    weekdaysFull: WEEKDAYS_UA,
  };
}

// ------------------------------------------------------ бюджет (v1.6 §2) ----

/**
 * Стан місячного бюджету (CONTRACT v1.6 §2).
 *  monthCost     — уже витрачено в поточному місяці (cumulativeMonthCompare.curTotal);
 *  forecastTotal — прогноз на кінець місяця (cumulativeMonthCompare.forecastTotal),
 *                  null у останній день місяця — тоді все рахується по факту;
 *  budgetUsd     — бюджет; не задано / ≤ 0 → повертається null (картка ховається).
 *
 * `state` — вердикт-чіп: враховує ПРОГНОЗ (у цьому й сенс раннього
 * попередження: у межах бюджету «сьогодні» ще нічого не означає 10-го числа).
 * `barState` — колір смуги прогресу, рахується ЛИШЕ за фактом (CONTRACT:
 * зелений < 80 %, оранжевий 80–100 %, червоний > 100 %).
 *
 * @returns {{pct:number, state:'ok'|'edge'|'over', overUsd:number,
 *            barState:'ok'|'edge'|'over', spentUsd:number, budgetUsd:number,
 *            forecastTotal:number|null, forecastPct:number|null,
 *            remainingUsd:number, basisUsd:number}|null}
 */
export function budgetStatus({ monthCost = 0, forecastTotal = null, budgetUsd = null } = {}) {
  const budget = Number(budgetUsd);
  if (!Number.isFinite(budget) || budget <= 0) return null;

  const spent = Number(monthCost) || 0;
  const forecast = Number.isFinite(Number(forecastTotal)) && forecastTotal != null
    ? Number(forecastTotal)
    : null;
  const basis = Math.max(spent, forecast == null ? 0 : forecast);

  const pct = (spent / budget) * 100;
  const barState = pct > 100 ? 'over' : pct >= 80 ? 'edge' : 'ok';
  const state = basis > budget ? 'over' : basis >= budget * 0.8 ? 'edge' : 'ok';

  return {
    pct,
    state,
    overUsd: Math.max(0, basis - budget),
    barState,
    spentUsd: spent,
    budgetUsd: budget,
    forecastTotal: forecast,
    forecastPct: forecast == null ? null : (forecast / budget) * 100,
    remainingUsd: Math.max(0, budget - spent),
    basisUsd: basis,
  };
}

// ============================================ v1.8 §3: дрібні проєкти ========

/** Підпис зведеного рядка: «Інші — 12 проєктів». */
export function otherProjectsLabel(n) {
  return `${OTHER_PROJECT} — ${n} ${plural(n, 'проєкт', 'проєкти', 'проєктів')}`;
}

/**
 * Згортання дрібних проєктів в один рядок (CONTRACT v1.8 §3).
 *
 * Вхід — уже відсортований за вартістю ↓ масив рядків із полями
 * `project` і `costUsd` (costByProject, картки вкладки «Проєкти»).
 *
 * Захист від виродженого випадку: якщо після згортання окремих рядків
 * лишається менше `minRows`, згортання не має сенсу (на короткому періоді
 * дрібне все) — тоді показуємо `fallbackTopN` найбільших поіменно, а решту
 * зводимо. Якщо і зводити нема чого, повертаємо вхід як є.
 *
 * @param {Array<{project:string,costUsd:number}>} rows
 * @param {{threshold?:number, minRows?:number, fallbackTopN?:number}} [opts]
 * @returns {{rows:Array, small:Array, grouped:boolean, otherUsd:number,
 *            otherCount:number, otherLabel:string|null}}
 *   `rows` — видимий згорнутий список (зведений рядок останній, із
 *   `isOther:true` і `project` = otherProjectsLabel(n)).
 */
export function groupSmallProjects(rows, {
  threshold = SMALL_PROJECT_USD, minRows = 3, fallbackTopN = 5,
} = {}) {
  const src = (rows || []).filter(Boolean);
  const empty = {
    rows: src, small: [], grouped: false, otherUsd: 0, otherCount: 0, otherLabel: null,
  };
  if (src.length <= minRows) return empty;

  let big = src.filter((r) => (r.costUsd || 0) >= threshold);
  let small = src.filter((r) => (r.costUsd || 0) < threshold);

  // Вироджений випадок: майже все дрібне — тоді ділимо за рангом, а не сумою.
  if (big.length < minRows) {
    big = src.slice(0, fallbackTopN);
    small = src.slice(fallbackTopN);
  }
  if (!small.length) return empty;

  const otherUsd = small.reduce((a, r) => a + (r.costUsd || 0), 0);
  const otherLabel = otherProjectsLabel(small.length);
  return {
    rows: [...big, {
      project: otherLabel,
      costUsd: otherUsd,
      isOther: true,
      count: small.length,
      items: small,
    }],
    small,
    grouped: true,
    otherUsd,
    otherCount: small.length,
    otherLabel,
  };
}

// ----------------------------------------------------------- морфологія -----

/**
 * Українська множина: plural(n, 'сесія', 'сесії', 'сесій').
 * Реалізація переїхала у format.js (v1.7: форматери тривалості й діапазону
 * днів теж її потребують, а format.js не має права імпортувати analytics.js).
 * Реекспорт лишає старі імпорти `from './analytics.js'` робочими.
 */
export { plural };
