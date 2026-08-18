// Чисті функції аналітики spend-lens. Жодних побічних ефектів, юніт-тестабельні.
// Вхід: снапшот (schemaVersion 1) — { days, sessions, pricingUsed, ... }.
// Гроші — USD. Ціни — USD за MTok (див. CONTRACT.md).

import { RULES, SEVERITY } from './rules.js';
import { fmtUsd } from './format.js';

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

// ---------------------------------------------------------------- KPI --------

/**
 * KPI: Сьогодні / 7 днів / 30 днів / Разом (+% проти попереднього періоду).
 * «Сьогодні» = останній день снапшота.
 */
export function computeKpis(days) {
  const today = lastDay(days);
  if (!today) return [];
  const inRange = (from, to) => days.filter((d) => d.day >= from && d.day <= to);
  const cost = (rows) => sum(rows, (r) => r.costUsd || 0);

  const mk = (label, from, to, prevFrom, prevTo) => {
    const cur = cost(inRange(from, to));
    const prev = prevFrom ? cost(inRange(prevFrom, prevTo)) : null;
    const deltaPct = prev && prev > 0 ? ((cur - prev) / prev) * 100 : null;
    return { label, costUsd: cur, deltaPct };
  };

  return [
    mk('Сьогодні', today, today, shiftDay(today, -1), shiftDay(today, -1)),
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
      evidence: `вартість $${usd(cost)} — вище p90 усіх сесій`,
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

// ----------------------------------------------------------- морфологія -----

/** Українська множина: plural(n, 'сесія', 'сесії', 'сесій'). */
export function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}
