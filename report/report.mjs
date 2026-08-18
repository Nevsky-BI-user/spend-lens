// spend-lens v1.2 — email PDF digests.
// CLI: node report/report.mjs --type daily|monthly|yearly [--date YYYY-MM-DD] [--no-send] [--out <dir>]
//
// Якір «сьогодні» = --date або поточна дата в Europe/Kyiv (через Intl, НЕ локальний час сервера).
//   daily   → цей день; monthly → попередній календарний місяць якоря;
//   yearly  → попередній календарний рік якоря.
// Читає web/public/data/usage.json і повторно використовує чисті ESM-бібліотеки вебзастосунку
// (web/src/lib/analytics.js, rules.js, format.js) — без збирання.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  costByProject, costByModel, cacheEconomics,
  analyzeSessions, computeFactors, buildRecommendations, plural,
} from '../web/src/lib/analytics.js';
import { FLAG_META } from '../web/src/lib/rules.js';
import { fmtUsd, fmtUsdCompact, fmtInt, fmtPct, shortModel } from '../web/src/lib/format.js';

import { hBar, stackedBars, donut, SERIES_COLORS } from './svg.mjs';
import {
  renderReport, card, warnBox, kpiRow, sessionsTable, recCards,
  fmtDeltaPct, fmtTokensG,
} from './render.mjs';
import { htmlToPdf } from './pdf.mjs';
import { sendReport } from './mailer.mjs';

const KYIV = 'Europe/Kyiv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const MONTHS_NOM = [
  'січень', 'лютий', 'березень', 'квітень', 'травень', 'червень',
  'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень',
];
const MONTHS_GEN = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
];
const MONTHS_SHORT = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];

// ------------------------------------------------------------------ дати -----

const kyivDayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: KYIV, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Поточна (або передана) мить → 'YYYY-MM-DD' у Києві. */
function kyivDay(date = new Date()) {
  return kyivDayFmt.format(date);
}

/** ISO-мітка → київський день 'YYYY-MM-DD' (для фільтра сесій), null якщо не парситься. */
function kyivDayOfIso(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : kyivDayFmt.format(d);
}

/** Зсув дня на delta діб (UTC-безпечно, без залежності від локального TZ). */
function shiftDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function lastDateOfMonth(y, m) { // m: 1..12
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad2 = (n) => String(n).padStart(2, '0');

/** '2026-08-18' → '18 серпня 2026'. */
function fmtDayGen(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]} ${y}`;
}

/** «Сформовано»: поточна київська мить → '18 серпня 2026, 21:03 (Київ)'. */
function kyivNowLabel() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((acc, x) => (acc[x.type] = x.value, acc), {});
  return `${Number(p.day)} ${MONTHS_GEN[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} (Київ)`;
}

/**
 * Період звіту за типом і якорем.
 * daily → сам якір; monthly → попередній календарний місяць; yearly → попередній рік.
 */
function computePeriod(type, anchor) {
  const [ay, am] = anchor.split('-').map(Number);

  if (type === 'daily') {
    return {
      from: anchor, to: anchor,
      prevFrom: shiftDay(anchor, -1), prevTo: shiftDay(anchor, -1),
      label: fmtDayGen(anchor), prevName: 'попереднього дня',
      fileTag: anchor,
    };
  }

  if (type === 'monthly') {
    let y = ay, m = am - 1;
    if (m === 0) { m = 12; y -= 1; }
    let py = y, pm = m - 1;
    if (pm === 0) { pm = 12; py -= 1; }
    return {
      from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(lastDateOfMonth(y, m))}`,
      prevFrom: `${py}-${pad2(pm)}-01`, prevTo: `${py}-${pad2(pm)}-${pad2(lastDateOfMonth(py, pm))}`,
      label: `${MONTHS_NOM[m - 1]} ${y}`, prevName: 'попереднього місяця',
      fileTag: `${y}-${pad2(m)}`, year: y, month: m,
    };
  }

  // yearly
  const y = ay - 1;
  return {
    from: `${y}-01-01`, to: `${y}-12-31`,
    prevFrom: `${y - 1}-01-01`, prevTo: `${y - 1}-12-31`,
    label: `${y} рік`, prevName: 'попереднього року',
    fileTag: String(y), year: y,
  };
}

// ------------------------------------------------------------- агрегація -----

/** Фільтр снапшота за [from..to]: days — за day, sessions — за київським днем startedAt. */
function filterRange(snapshot, from, to) {
  const days = (snapshot.days || []).filter((d) => d.day >= from && d.day <= to);
  const sessions = (snapshot.sessions || []).filter((s) => {
    const d = s.startedAt ? kyivDayOfIso(s.startedAt) : null;
    return d && d >= from && d <= to;
  });
  return { ...snapshot, days, sessions };
}

function sumDays(days) {
  const t = { cost: 0, input: 0, output: 0, cacheRead: 0, w5: 0, w1: 0 };
  for (const d of days) {
    t.cost += d.costUsd || 0;
    t.input += d.input || 0;
    t.output += d.output || 0;
    t.cacheRead += d.cacheRead || 0;
    t.w5 += d.cacheWrite5m || 0;
    t.w1 += d.cacheWrite1h || 0;
  }
  const ctx = t.input + t.cacheRead + t.w5 + t.w1;
  t.hitPct = ctx > 0 ? (t.cacheRead / ctx) * 100 : 0;
  return t;
}

function deltaPct(cur, prev) {
  return prev > 0 ? ((cur - prev) / prev) * 100 : null;
}

/** Скільки грошей зекономив кеш за період (Σ по днях). */
function cacheSavedUsd(days, pricingUsed) {
  return cacheEconomics(days, pricingUsed, 0).reduce((a, r) => a + r.savedUsd, 0);
}

/** Топ-5 моделей за вартістю + «інші»: серії для стека/доната. */
function topModelSeries(days) {
  const totals = new Map();
  for (const d of days) totals.set(d.model, (totals.get(d.model) || 0) + (d.costUsd || 0));
  const sorted = [...totals.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 5).map(([m]) => m);
  const series = top.map((m, i) => ({ key: m, label: shortModel(m), color: SERIES_COLORS[i] }));
  if (sorted.length > 5) series.push({ key: '__other', label: 'інші', color: SERIES_COLORS[5] });
  const topSet = new Set(top);
  return { series, keyFor: (model) => (topSet.has(model) ? model : '__other') };
}

/** Донат «розподіл за моделями» (top-5 + інші). */
function modelDonut(days) {
  const { series, keyFor } = topModelSeries(days);
  const acc = new Map(series.map((s) => [s.key, { label: s.label, color: s.color, value: 0 }]));
  for (const d of days) {
    const item = acc.get(keyFor(d.model));
    if (item) item.value += d.costUsd || 0;
  }
  return donut({
    items: [...acc.values()],
    valueFmt: fmtUsdCompact,
    centerLabel: 'разом',
  });
}

/** Рядки топ-сесій для таблиці (з прапорцями з analyzeSessions). */
function topSessionRows(filtered, limit) {
  const { flagged } = analyzeSessions(filtered);
  const flagsBySession = new Map(flagged.map((f) => [f.session.sessionId, f.flags.map((x) => x.type)]));
  return [...filtered.sessions]
    .sort((a, b) => ((b.totals && b.totals.costUsd) || 0) - ((a.totals && a.totals.costUsd) || 0))
    .slice(0, limit)
    .map((s) => ({
      title: s.title,
      sessionId: s.sessionId,
      project: s.project,
      costUsd: (s.totals && s.totals.costUsd) || 0,
      flags: flagsBySession.get(s.sessionId) || [],
    }));
}

/** Pareto «Де живе перевитрата» за факторами. */
function factorPareto(filtered) {
  const factors = computeFactors(filtered).filter((f) => f.totalUsd > 0.01);
  if (!factors.length) return warnBox('Суттєвих факторів перевитрати за період не виявлено.');
  return hBar({
    items: factors.map((f) => ({
      label: (FLAG_META[f.type] && FLAG_META[f.type].labelAgg) || f.type,
      value: f.totalUsd,
      color: (FLAG_META[f.type] && FLAG_META[f.type].color) || SERIES_COLORS[5],
    })),
    valueFmt: fmtUsdCompact,
  });
}

function topProjectBar(days, limit) {
  const items = costByProject(days, 0).slice(0, limit)
    .map((p) => ({ label: p.project, value: p.costUsd, color: SERIES_COLORS[0] }));
  return hBar({ items, valueFmt: fmtUsdCompact });
}

// ---------------------------------------------------------- view-будівники ---

function commonKpis(t, tp, period, filtered, extra) {
  const kpis = [
    { label: extra.costLabel, value: fmtUsd(t.cost), delta: { pct: deltaPct(t.cost, tp.cost), name: period.prevName } },
    { label: 'Токени in', value: fmtTokensG(t.input) },
    { label: 'Токени out', value: fmtTokensG(t.output) },
    { label: 'Кеш-читання', value: fmtTokensG(t.cacheRead) },
  ];
  if (extra.withSavings) {
    kpis.push({ label: 'Кеш-заощадження', value: fmtUsd(cacheSavedUsd(filtered.days, filtered.pricingUsed)) });
  }
  kpis.push({ label: 'Кеш-хіт', value: fmtPct(t.hitPct) });
  kpis.push({
    label: 'Сесії',
    value: fmtInt(filtered.sessions.length),
    sub: 'вартістю від $0,01',
  });
  if (extra.withTopProject) {
    const top = costByProject(filtered.days, 0)[0];
    kpis.push(top
      ? { label: 'Найдорожчий проєкт', value: top.project, sub: fmtUsd(top.costUsd) }
      : { label: 'Найдорожчий проєкт', value: '—' });
  }
  return kpis;
}

function buildDaily(snapshot, period) {
  const cur = filterRange(snapshot, period.from, period.to);
  const prev = filterRange(snapshot, period.prevFrom, period.prevTo);
  const t = sumDays(cur.days);
  const tp = sumDays(prev.days);

  const kpis = commonKpis(t, tp, period, cur, { costLabel: 'Вартість дня' });
  let body = kpiRow(kpis);

  if (!cur.days.length) {
    body += warnBox(`За ${period.label} даних у снапшоті немає. Схоже, Claude Code цього дня не використовувався або collector ще не запускався.`);
    return { body, totals: t, filtered: cur };
  }

  body += card('Вартість за проєктами', topProjectBar(cur.days, 12));
  body += card('Розподіл за моделями', modelDonut(cur.days));
  body += card('Топ-5 сесій дня', sessionsTable(topSessionRows(cur, 5)));
  body += card('Рекомендації дня', recCards(buildRecommendations(cur), 5));
  return { body, totals: t, filtered: cur };
}

function buildMonthly(snapshot, period) {
  const cur = filterRange(snapshot, period.from, period.to);
  const prev = filterRange(snapshot, period.prevFrom, period.prevTo);
  const t = sumDays(cur.days);
  const tp = sumDays(prev.days);

  const kpis = commonKpis(t, tp, period, cur, {
    costLabel: 'Вартість місяця', withSavings: true, withTopProject: true,
  });
  let body = kpiRow(kpis);

  if (!cur.days.length) {
    body += warnBox(`За ${period.label} даних у снапшоті немає.`);
    return { body, totals: t, filtered: cur };
  }

  // Щоденні стековані бари за моделями — всі дні місяця, включно з порожніми
  const { series, keyFor } = topModelSeries(cur.days);
  const byDay = new Map();
  for (const d of cur.days) {
    const row = byDay.get(d.day) || {};
    const key = keyFor(d.model);
    row[key] = (row[key] || 0) + (d.costUsd || 0);
    byDay.set(d.day, row);
  }
  const nDays = lastDateOfMonth(period.year, period.month);
  const rows = [];
  for (let dd = 1; dd <= nDays; dd++) {
    const day = `${period.year}-${pad2(period.month)}-${pad2(dd)}`;
    rows.push({ label: String(dd), values: byDay.get(day) || {} });
  }
  body += card('Витрати за днями (за моделями)', stackedBars({ rows, series, yFmt: fmtUsdCompact }));
  body += card('Топ-10 проєктів місяця', topProjectBar(cur.days, 10));
  body += card('Топ-10 сесій місяця', sessionsTable(topSessionRows(cur, 10)));
  body += card('Де живе перевитрата', factorPareto(cur));
  body += card('Рекомендації', recCards(buildRecommendations(cur), 8));
  return { body, totals: t, filtered: cur };
}

function buildYearly(snapshot, period) {
  const cur = filterRange(snapshot, period.from, period.to);
  const prev = filterRange(snapshot, period.prevFrom, period.prevTo);
  const t = sumDays(cur.days);
  const tp = sumDays(prev.days);

  const kpis = commonKpis(t, tp, period, cur, {
    costLabel: 'Вартість року', withSavings: true, withTopProject: true,
  });
  let body = kpiRow(kpis);

  if (!cur.days.length) {
    body += warnBox(`За ${period.label} даних у снапшоті немає.`);
    return { body, totals: t, filtered: cur };
  }

  // 12 місячних стекованих барів за моделями
  const { series, keyFor } = topModelSeries(cur.days);
  const byMonth = new Map(); // 1..12 → { key: cost }
  for (const d of cur.days) {
    const m = Number(d.day.slice(5, 7));
    const row = byMonth.get(m) || {};
    const key = keyFor(d.model);
    row[key] = (row[key] || 0) + (d.costUsd || 0);
    byMonth.set(m, row);
  }
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    rows.push({ label: MONTHS_SHORT[m - 1], values: byMonth.get(m) || {} });
  }
  body += card('Витрати за місяцями (за моделями)', stackedBars({ rows, series, yFmt: fmtUsdCompact }));
  body += card('Топ-10 проєктів року', topProjectBar(cur.days, 10));
  body += card('Топ-10 сесій року', sessionsTable(topSessionRows(cur, 10)));
  body += card('Де живе перевитрата', factorPareto(cur));
  return { body, totals: t, filtered: cur };
}

// --------------------------------------------------------------- email -------

function emailText({ period, totals, tp, filtered }) {
  const lines = [`Зведення spend-lens за ${period.label}.`];
  if (!filtered.days.length) {
    lines.push('Даних за період немає — Claude Code не використовувався або collector не запускався.');
  } else {
    const d = deltaPct(totals.cost, tp.cost);
    const deltaText = d === null ? '' :
      ` (${d >= 0 ? '+' : '−'}${fmtDeltaPct(d)} проти ${period.prevName})`;
    lines.push(`Витрати: ${fmtUsd(totals.cost)}${deltaText}.`);
    lines.push(`Токени: in ${fmtTokensG(totals.input)} · out ${fmtTokensG(totals.output)} · кеш ${fmtTokensG(totals.cacheRead)}. Кеш-хіт: ${fmtPct(totals.hitPct)}.`);
    const top = costByProject(filtered.days, 0)[0];
    const n = filtered.sessions.length;
    lines.push(`${fmtInt(n)} ${plural(n, 'сесія', 'сесії', 'сесій')}.` +
      (top ? ` Найдорожчий проєкт: ${top.project} (${fmtUsd(top.costUsd)}).` : ''));
  }
  lines.push('PDF з деталями — у вкладенні.');
  return lines.join('\n');
}

// ----------------------------------------------------------------- main ------

function usage() {
  console.error('Використання: node report/report.mjs --type daily|monthly|yearly [--date YYYY-MM-DD] [--no-send] [--out <dir>]');
}

function parseArgs(argv) {
  const args = { type: null, date: null, noSend: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--type') args.type = argv[++i];
    else if (a === '--date') args.date = argv[++i];
    else if (a === '--no-send') args.noSend = true;
    else if (a === '--out') args.out = argv[++i];
    else {
      console.error(`Невідомий аргумент: ${a}`);
      usage();
      process.exit(1);
    }
  }
  if (!['daily', 'monthly', 'yearly'].includes(args.type)) {
    console.error('Помилка: --type має бути daily, monthly або yearly.');
    usage();
    process.exit(1);
  }
  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    console.error('Помилка: --date має формат YYYY-MM-DD.');
    process.exit(1);
  }
  return args;
}

/** Простий .env-лоадер (без залежностей): report/.env, наявні env не перетирає. */
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv(path.join(__dirname, '.env'));

  const snapshotPath = path.join(repoRoot, 'web', 'public', 'data', 'usage.json');
  if (!existsSync(snapshotPath)) {
    console.error(`Немає снапшота ${snapshotPath} — спочатку запусти collector (node collector/collect.mjs).`);
    process.exit(1);
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));

  const anchor = args.date || kyivDay();
  const period = computePeriod(args.type, anchor);

  const builders = { daily: buildDaily, monthly: buildMonthly, yearly: buildYearly };
  const { body, totals, filtered } = builders[args.type](snapshot, period);
  const prevTotals = sumDays(filterRange(snapshot, period.prevFrom, period.prevTo).days);

  const html = renderReport({
    periodLabel: period.label,
    generatedAtLabel: kyivNowLabel(),
    bodyHtml: body,
  });

  const outDir = args.out ? path.resolve(process.cwd(), args.out) : path.join(__dirname, 'out');
  mkdirSync(outDir, { recursive: true });
  const baseName = `spend-lens-${args.type}-${period.fileTag}`;
  const htmlPath = path.join(outDir, `${baseName}.html`);
  const pdfPath = path.join(outDir, `${baseName}.pdf`);
  writeFileSync(htmlPath, html, 'utf8');

  console.log(`[report] тип: ${args.type} · період: ${period.label} (${period.from}..${period.to}) · якір: ${anchor}`);
  console.log(`[report] витрати за період: ${fmtUsd(totals.cost)} · сесій: ${filtered.sessions.length}`);

  let printed;
  try {
    printed = htmlToPdf(htmlPath, pdfPath);
  } catch (err) {
    console.error(`[report] ПОМИЛКА друку PDF: ${err.message}`);
    console.error(`[report] HTML залишено для діагностики: ${htmlPath}`);
    process.exit(1);
  }
  console.log(`[report] PDF: ${pdfPath} (${Math.round(printed.sizeBytes / 1024)} КБ, ${printed.name})`);

  if (args.noSend) {
    console.log('[report] email: пропущено (--no-send)');
    return;
  }

  const subject = `spend-lens: зведення за ${period.label} — ${fmtUsd(totals.cost)}`;
  const text = emailText({ period, totals, tp: prevTotals, filtered });
  try {
    const sent = await sendReport({ subject, text, pdfPath, filename: `${baseName}.pdf` });
    if (!sent) console.log('[report] email: пропущено (env не налаштовано), PDF записано — exit 0');
  } catch (err) {
    console.error(`[report] ПОМИЛКА надсилання пошти: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[report] НЕОЧІКУВАНА ПОМИЛКА: ${err.stack || err.message}`);
  process.exit(1);
});
