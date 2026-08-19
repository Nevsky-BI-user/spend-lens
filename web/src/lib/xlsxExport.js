// Експорт поточного зрізу в XLSX (CONTRACT v1.6, пункт 7).
//
// ВАЖЛИВО: `exceljs` підвантажується ЛИШЕ динамічним import() всередині
// buildWorkbook() — інакше ~250 КБ бібліотеки потрапили б у головний бандл,
// хоча кнопкою «Експорт XLSX» користуються раз на день. Rollup/Vite виносять
// такий import у окремий чанк автоматично.
//
// Модуль чистий у частині підготовки даних: buildSheetData() рахує все без
// exceljs і без DOM (юніт-тестабельно), buildWorkbook() лише малює.

import {
  analyzeSessions, buildRecommendations, costPerOutputMTokByModel,
  efficiencyKpis, lastDay, plural,
} from './analytics.js';
import { FLAG_META } from './rules.js';
import { withAnomalyFlag } from './anomalies.js';
import { lowReturnSessions, indexBySession, withLowReturnFlag } from './efficiency.js';
import { buildProjectCards, capitalizeFirst, projectSummary } from './digest.js';
import { fmtDomMonth, shortModel } from './format.js';
import { rtkWindow } from './rtkValue.js';
import { charsToTokens } from './toolFlow.js';

// ------------------------------------------------------------ формати ------

const MONEY = '$#,##0.00';
const MONEY4 = '$#,##0.0000';   // вартість одного ходу — центи мають значення
const INT = '#,##0';
const PCT = '0.0%';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F7' } };
const HEADER_FONT = { bold: true, color: { argb: 'FF1C1C1E' } };
const HEADER_BORDER = { bottom: { style: 'thin', color: { argb: 'FFD1D1D6' } } };

const SEVERITY_LABEL = { high: 'критично', medium: 'помітно', low: 'дрібниця' };

const META_ALL = withLowReturnFlag(withAnomalyFlag(FLAG_META));

// ------------------------------------------------------------ дати --------

/** Розкладає ISO у компоненти заданого поясу (снапшот пише UTC). */
function partsInTz(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch {
    fmt = null;
  }
  if (!fmt) {
    const p = (n) => String(n).padStart(2, '0');
    return {
      y: d.getFullYear(), m: p(d.getMonth() + 1), d: p(d.getDate()),
      hh: p(d.getHours()), mm: p(d.getMinutes()),
    };
  }
  const out = {};
  for (const part of fmt.formatToParts(d)) {
    if (part.type === 'year') out.y = Number(part.value);
    else if (part.type === 'month') out.m = part.value;
    else if (part.type === 'day') out.d = part.value;
    else if (part.type === 'hour') out.hh = part.value;
    else if (part.type === 'minute') out.mm = part.value;
  }
  return out;
}

/**
 * Прапорці «Слабка віддача» ззовні: приймаємо і сирий Map, і результат
 * analyzeReturn(). null → рахуємо самі на зрізі.
 */
function normalizeReturnMap(src) {
  if (!src) return null;
  // Порожню мапу повертаємо як є: «App порахував і слабкої віддачі не знайшов» —
  // це не привід перерахувати на зрізі й дописати в аркуш зайві чіпи.
  if (src instanceof Map) return src;
  if (src.byId instanceof Map) return src.byId;
  return null;
}

/** 'YYYY-MM-DD' → '18 серпня 2026' (дати в аркушах — текстом, як у контракті). */
export function fmtDayUa(day) {
  if (!day || day.length < 10) return '—';
  const dom = Number(day.slice(8, 10));
  return `${fmtDomMonth(dom, day.slice(0, 7))} ${day.slice(0, 4)}`;
}

/** ISO → '12 серпня 2026, 15:07' у поясі снапшота. */
export function fmtDateTimeUa(iso, timeZone = 'Europe/Kyiv') {
  if (!iso) return '—';
  const p = partsInTz(iso, timeZone);
  if (!p) return '—';
  return `${fmtDomMonth(Number(p.d), `${p.y}-${p.m}`)} ${p.y}, ${p.hh}:${p.mm}`;
}

/** Людська назва періоду для шапки «Огляду». */
function periodLabel(period, day) {
  if (day) return `день ${fmtDayUa(day)}`;
  const n = Number(period) || 0;
  if (!n) return 'увесь час';
  return `${n} ${plural(n, 'день', 'дні', 'днів')}`;
}

// ------------------------------------------------------ підготовка даних ---

/** Назви моделей з ненульовою вартістю, скорочені: 'opus-5, fable-5'. */
function modelsText(models) {
  return Object.entries(models || {})
    .filter(([, m]) => (m.costUsd || 0) > 0)
    .sort((a, b) => (b[1].costUsd || 0) - (a[1].costUsd || 0))
    .map(([model]) => shortModel(model))
    .join(', ');
}

function flagLabel(type) {
  const meta = META_ALL[type];
  return (meta && meta.label) || type;
}

/**
 * Уся арифметика експорту в одному місці — без exceljs і без DOM.
 * @param {object} snapshot ВІДФІЛЬТРОВАНИЙ зріз (period/project/day уже застосовані)
 * @param {{project?:string|null, period?:number, day?:string|null,
 *          budgetUsd?:number|null, forecastTotal?:number|null,
 *          sessionReturns?:Map|{byId:Map}|null}} [meta]
 * @returns {{kpi:Array, daily:Array, projects:Array, models:Array,
 *            sessions:Array, recommendations:Array, meta:object}}
 */
export function buildSheetData(snapshot, meta = {}) {
  const snap = snapshot || {};
  const days = snap.days || [];
  const sessions = snap.sessions || [];
  const timeZone = snap.timezone || 'Europe/Kyiv';
  const project = meta.project || null;
  const day = meta.day || null;
  const period = meta.period ?? 0;

  // --- дні ---
  const dayMap = new Map();
  for (const d of days) {
    const row = dayMap.get(d.day) || {
      day: d.day, costUsd: 0, input: 0, output: 0,
      cacheRead: 0, cacheWrite: 0, messages: 0,
    };
    row.costUsd += d.costUsd || 0;
    row.input += d.input || 0;
    row.output += d.output || 0;
    row.cacheRead += d.cacheRead || 0;
    row.cacheWrite += (d.cacheWrite5m || 0) + (d.cacheWrite1h || 0);
    row.messages += d.messages || 0;
    dayMap.set(d.day, row);
  }
  const daily = [...dayMap.values()]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((r) => ({
      ...r,
      dayText: fmtDayUa(r.day),
      costPerTurn: r.messages > 0 ? r.costUsd / r.messages : null,
    }));

  // --- проєкти ---
  const projMap = new Map();
  for (const d of days) {
    const row = projMap.get(d.project) || {
      project: d.project, costUsd: 0, input: 0, output: 0,
      cacheRead: 0, cacheWrite: 0, messages: 0, sidechainUsd: 0,
    };
    row.costUsd += d.costUsd || 0;
    row.input += d.input || 0;
    row.output += d.output || 0;
    row.cacheRead += d.cacheRead || 0;
    row.cacheWrite += (d.cacheWrite5m || 0) + (d.cacheWrite1h || 0);
    row.messages += d.messages || 0;
    if (d.sidechain) row.sidechainUsd += d.costUsd || 0;
    projMap.set(d.project, row);
  }
  // Кількість сесій беремо з `sessions`: у `days` поле `sessions` рахується
  // на грануляції день×модель×сабчейн, і сума по днях задвоювала б сесії.
  const sessCount = new Map();
  for (const s of sessions) {
    sessCount.set(s.project, (sessCount.get(s.project) || 0) + 1);
  }
  const totalUsd = daily.reduce((a, r) => a + r.costUsd, 0);
  // v1.7b: дайджест проєкту (активність, області, правки, опис) — з того самого
  // розрахунку, що живить вкладку «Проєкти», щоб аркуш і екран не розходилися.
  // Снапшот v1: карток із дайджестом немає — колонки лишаються порожніми.
  const cardByProject = new Map(buildProjectCards(snap).map((c) => [c.project, c]));
  const projects = [...projMap.values()]
    .map((r) => {
      const c = cardByProject.get(r.project) || null;
      return {
        ...r,
        sessions: sessCount.get(r.project) || 0,
        share: totalUsd > 0 ? r.costUsd / totalUsd : 0,
        sidechainShare: r.costUsd > 0 ? r.sidechainUsd / r.costUsd : 0,
        activity: c && c.activity ? capitalizeFirst(c.activity) : '',
        areas: c ? c.areas.map((a) => a.path).join(', ') : '',
        edits: c ? c.edits : null,
        filesTouched: c ? c.filesTouched : null,
        sidechainSessions: c ? c.sidechainSessions : null,
        firstDayText: c && c.firstDay ? fmtDayUa(c.firstDay) : '',
        lastDayText: c && c.lastDay ? fmtDayUa(c.lastDay) : '',
        topSessions: c ? c.titles.map((t) => t.title).join(' | ') : '',
        summary: c ? (c.note || projectSummary(c)) : '',
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  // --- моделі ---
  const modelMap = new Map();
  for (const d of days) {
    const row = modelMap.get(d.model) || {
      model: d.model, costUsd: 0, input: 0, output: 0,
      cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, messages: 0,
    };
    row.costUsd += d.costUsd || 0;
    row.input += d.input || 0;
    row.output += d.output || 0;
    row.cacheRead += d.cacheRead || 0;
    row.cacheWrite5m += d.cacheWrite5m || 0;
    row.cacheWrite1h += d.cacheWrite1h || 0;
    row.messages += d.messages || 0;
    modelMap.set(d.model, row);
  }
  const perMTok = new Map(costPerOutputMTokByModel(days).map((r) => [r.model, r.usdPerMTok]));
  const models = [...modelMap.values()]
    .map((r) => ({
      ...r,
      shortName: shortModel(r.model),
      share: totalUsd > 0 ? r.costUsd / totalUsd : 0,
      usdPerMTok: perMTok.get(r.model) ?? null,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  // --- сесії з прапорцями (включно зі «Слабкою віддачею») ---
  //
  // Прапорці БЕРЕМО ГОТОВІ з meta.sessionReturns (App рахує їх на повній
  // історії проєкту). Перерахунок на самому зрізі давав інший набір: медіани
  // ставок у вікні «7 днів» стоять на кількох сесіях — і чіп, який видно в
  // таблиці, тихо зникав з аркуша. Фолбек на зріз лишаємо для викликів поза
  // App (юніт-тести, Node) — там повна історія і є цим зрізом.
  const { flagged } = analyzeSessions(snap);
  const returnById = normalizeReturnMap(meta.sessionReturns)
    || indexBySession(lowReturnSessions(sessions));
  const sessionRows = flagged
    .map(({ session: s, flags }) => {
      const lowReturn = returnById.get(s.sessionId);
      const all = lowReturn ? [...flags, lowReturn] : flags;
      const t = s.totals || {};
      const d = s.digest || null;
      return {
        title: s.title || s.sessionId,
        project: s.project,
        // v1.7b: дайджест сесії. Немає (снапшот v1) → порожні клітинки,
        // структура аркуша стабільна між версіями снапшота.
        activity: d && d.activity ? capitalizeFirst(d.activity) : '',
        areas: d ? (d.areas || []).map((a) => a.path).join(', ') : '',
        edits: d ? (d.edits || 0) : null,
        filesTouched: d ? (d.filesTouched || 0) : null,
        intent: d ? (d.intent || '') : '',
        startedAt: fmtDateTimeUa(s.startedAt, timeZone),
        endedAt: fmtDateTimeUa(s.endedAt, timeZone),
        models: modelsText(s.models),
        input: t.input || 0,
        output: t.output || 0,
        cacheRead: t.cacheRead || 0,
        cacheWrite: (t.cacheWrite5m || 0) + (t.cacheWrite1h || 0),
        cacheHitRate: s.cacheHitRate || 0,
        avgContext: s.avgContext || 0,
        maxContext: s.maxContext || 0,
        userTurns: s.userTurns || 0,
        assistantTurns: s.assistantTurns || 0,
        sidechain: s.sidechain ? 'так' : 'ні',
        costUsd: t.costUsd || 0,
        flags: all.map((f) => flagLabel(f.type)).join(', '),
        wasteUsd: all.reduce((a, f) => a + (f.wasteUsd || 0), 0),
        sessionId: s.sessionId,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  // --- рекомендації ---
  const projectOfSession = new Map(sessions.map((s) => [s.sessionId, s.project]));
  const recommendations = buildRecommendations(snap).map((c) => {
    const key = String(c.id || '').split('|')[1] || '';
    const proj = c.type === 'LONG_SESSION'
      ? (projectOfSession.get(key) || '—')
      : (key || '—');
    return {
      rule: flagLabel(c.type),
      project: proj,
      severity: SEVERITY_LABEL[c.severity] || c.severity,
      wasteUsd: c.wasteUsd || 0,
      title: c.title,
      evidence: c.evidence,
      prompt: c.prompt,
    };
  });

  // --- KPI ---
  const eff = efficiencyKpis(days, sessions);
  const from = daily.length ? daily[0].day : null;
  const to = daily.length ? daily[daily.length - 1].day : null;
  const budgetUsd = Number.isFinite(Number(meta.budgetUsd)) && meta.budgetUsd
    ? Number(meta.budgetUsd) : null;
  const forecastTotal = Number.isFinite(Number(meta.forecastTotal)) && meta.forecastTotal != null
    ? Number(meta.forecastTotal) : null;

  const kpi = [
    { label: 'Зріз (проєкт)', value: project || 'усі проєкти' },
    { label: 'Період', value: periodLabel(period, day) },
    { label: 'Діапазон днів', value: from ? `${fmtDayUa(from)} — ${fmtDayUa(to)}` : '—' },
    { label: 'Дані станом на', value: fmtDateTimeUa(snap.generatedAt, timeZone) },
    { label: 'Часовий пояс', value: timeZone },
    { label: 'Разом', value: totalUsd, fmt: MONEY },
    { label: 'Днів у зрізі', value: daily.length, fmt: INT },
    { label: 'Сесій', value: eff.sessionCount, fmt: INT },
    { label: 'Ходів асистента', value: eff.messages, fmt: INT },
    { label: 'Вхідні токени', value: daily.reduce((a, r) => a + r.input, 0), fmt: INT },
    { label: 'Вихідні токени', value: daily.reduce((a, r) => a + r.output, 0), fmt: INT },
    { label: 'Кеш-читання, токени', value: daily.reduce((a, r) => a + r.cacheRead, 0), fmt: INT },
    { label: 'Кеш-запис, токени', value: daily.reduce((a, r) => a + r.cacheWrite, 0), fmt: INT },
    { label: 'Частка кешу в контексті', value: eff.cacheShare, fmt: PCT },
    { label: 'Середня вартість сесії', value: eff.avgSessionUsd, fmt: MONEY },
    { label: 'Медіанна вартість сесії', value: eff.medianSessionUsd, fmt: MONEY },
    { label: 'Середня вартість ходу', value: eff.avgTurnUsd, fmt: MONEY4 },
    { label: 'Бюджет місяця', value: budgetUsd ?? '—', fmt: budgetUsd ? MONEY : null },
    { label: 'Прогноз на кінець місяця', value: forecastTotal ?? '—', fmt: forecastTotal ? MONEY : null },
  ];

  // --- вивід інструментів (v1.10) ---
  // Вікно рахуємо тим самим rtkWindow, що й картка: колектор не ділить вивід
  // за проєктами, тож фільтр проєкту сюди не застосовується (інакше межі from/to
  // з `daily` звузили б період до днів, активних лише в одному проєкті).
  const toolWin = rtkWindow({ period, day, anchorDay: meta.anchorDay || '' });
  const toolOutput = (Array.isArray(snap.toolOutput) ? snap.toolOutput : [])
    .filter(
      (r) =>
        r && r.day && r.tool
        && (!toolWin.from || r.day >= toolWin.from)
        && (!toolWin.to || r.day <= toolWin.to)
    )
    .map((r) => ({
      day: r.day,
      dayText: fmtDayUa(r.day),
      tool: r.tool,
      calls: Number(r.calls) || 0,
      chars: Number(r.chars) || 0,
      tokens: Math.round(charsToTokens(r.chars)),
    }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : b.chars - a.chars));

  return {
    kpi,
    daily,
    projects,
    models,
    sessions: sessionRows,
    recommendations,
    toolOutput,
    meta: { project, period, day, timeZone, totalUsd, from, to, budgetUsd, forecastTotal },
  };
}

// ------------------------------------------------------------ малювання ----

/** Динамічний import: exceljs живе в лінивому чанку, а не в головному бандлі. */
async function loadExcelJS() {
  const mod = await import('exceljs');
  const lib = mod.default || mod;
  const Workbook = lib.Workbook || mod.Workbook;
  if (!Workbook) throw new Error('exceljs: не знайдено конструктор Workbook');
  return Workbook;
}

/** Жирна шапка з підкладкою #F2F2F7 + межа знизу. */
function styleHeaderRow(ws, rowNumber, fromCol = 1, toCol = null) {
  const row = ws.getRow(rowNumber);
  const last = toCol || row.cellCount;
  for (let c = fromCol; c <= last; c++) {
    const cell = row.getCell(c);
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = HEADER_BORDER;
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
  row.height = 22;
}

/** Аркуш «шапка + рядки» зі стандартним оформленням. */
function addTableSheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || 16,
    style: c.numFmt ? { numFmt: c.numFmt } : undefined,
  }));
  ws.addRows(rows);
  styleHeaderRow(ws, 1, 1, columns.length);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  for (const c of columns) {
    if (c.wrap) ws.getColumn(c.key).alignment = { wrapText: true, vertical: 'top' };
  }
  return ws;
}

/**
 * Книга з п'яти аркушів (CONTRACT v1.6 §7).
 * exceljs підвантажується динамічно ВСЕРЕДИНІ функції.
 *
 * @param {object} snapshotSlice відфільтрований зріз (period/project/day)
 * @param {{project?:string|null, period?:number, day?:string|null,
 *          budgetUsd?:number|null, forecastTotal?:number|null,
 *          sessionReturns?:Map|{byId:Map}|null}} [meta]
 * @returns {Promise<object>} exceljs Workbook
 */
export async function buildWorkbook(snapshotSlice, meta = {}) {
  const Workbook = await loadExcelJS();
  const data = buildSheetData(snapshotSlice, meta);

  const wb = new Workbook();
  wb.creator = 'spend-lens';
  wb.lastModifiedBy = 'spend-lens';
  wb.created = new Date();
  wb.modified = new Date();

  // ---------------- Огляд: KPI (A:B) + денні суми (D:K) --------------------
  // Обидві шапки — у рядку 1, тож заморожений верхній рядок накриває обидва
  // блоки, а автофільтр чіпляється лише до денної таблиці.
  const ov = wb.addWorksheet('Огляд');
  ov.getCell('A1').value = 'Показник';
  ov.getCell('B1').value = 'Значення';
  data.kpi.forEach((k, i) => {
    const r = i + 2;
    ov.getCell(`A${r}`).value = k.label;
    const cell = ov.getCell(`B${r}`);
    cell.value = k.value;
    if (k.fmt) cell.numFmt = k.fmt;
  });

  const dailyCols = [
    ['День', 'dayText', 18, null],
    ['$', 'costUsd', 12, MONEY],
    ['Вхідні', 'input', 14, INT],
    ['Вихідні', 'output', 14, INT],
    ['Кеш-читання', 'cacheRead', 16, INT],
    ['Кеш-запис', 'cacheWrite', 14, INT],
    ['Ходи асистента', 'messages', 16, INT],
    ['$ за хід', 'costPerTurn', 12, MONEY4],
  ];
  const D0 = 4; // перша колонка денної таблиці (D)
  ov.getColumn(1).width = 30;
  ov.getColumn(2).width = 26;
  ov.getColumn(3).width = 3;
  dailyCols.forEach(([header, , width, numFmt], i) => {
    const col = ov.getColumn(D0 + i);
    col.width = width;
    if (numFmt) col.numFmt = numFmt;
    ov.getCell(1, D0 + i).value = header;
  });
  data.daily.forEach((r, i) => {
    dailyCols.forEach(([, key], c) => {
      const cell = ov.getCell(i + 2, D0 + c);
      cell.value = r[key] == null ? '—' : r[key];
    });
  });
  // Шапка обох блоків — рядок 1 (включно з порожньою колонкою-роздільником C).
  styleHeaderRow(ov, 1, 1, D0 + dailyCols.length - 1);
  ov.views = [{ state: 'frozen', ySplit: 1 }];
  ov.autoFilter = {
    from: { row: 1, column: D0 },
    to: { row: 1, column: D0 + dailyCols.length - 1 },
  };

  // ---------------- Проєкти ------------------------------------------------
  addTableSheet(wb, 'Проєкти', [
    { header: 'Проєкт', key: 'project', width: 34 },
    { header: '$', key: 'costUsd', width: 12, numFmt: MONEY },
    { header: 'Частка', key: 'share', width: 10, numFmt: PCT },
    { header: 'Вхідні', key: 'input', width: 14, numFmt: INT },
    { header: 'Вихідні', key: 'output', width: 14, numFmt: INT },
    { header: 'Кеш-читання', key: 'cacheRead', width: 16, numFmt: INT },
    { header: 'Кеш-запис', key: 'cacheWrite', width: 14, numFmt: INT },
    { header: 'Ходи асистента', key: 'messages', width: 16, numFmt: INT },
    { header: 'Сесій', key: 'sessions', width: 10, numFmt: INT },
    { header: '$ субагентів', key: 'sidechainUsd', width: 14, numFmt: MONEY },
    { header: 'Частка субагентів', key: 'sidechainShare', width: 18, numFmt: PCT },
    // --- v1.7b: дайджест проєкту ---
    { header: 'Сесій субагентів', key: 'sidechainSessions', width: 17, numFmt: INT },
    { header: 'Активність', key: 'activity', width: 22 },
    { header: 'Області', key: 'areas', width: 44, wrap: true },
    { header: 'Правки', key: 'edits', width: 11, numFmt: INT },
    { header: 'Файли', key: 'filesTouched', width: 11, numFmt: INT },
    { header: 'Перший день', key: 'firstDayText', width: 18 },
    { header: 'Останній день', key: 'lastDayText', width: 18 },
    { header: 'Опис', key: 'summary', width: 60, wrap: true },
    { header: 'Топ-сесії', key: 'topSessions', width: 70, wrap: true },
  ], data.projects);

  // ---------------- Моделі -------------------------------------------------
  addTableSheet(wb, 'Моделі', [
    { header: 'Модель', key: 'shortName', width: 26 },
    { header: '$', key: 'costUsd', width: 12, numFmt: MONEY },
    { header: 'Частка', key: 'share', width: 10, numFmt: PCT },
    { header: 'Вхідні', key: 'input', width: 14, numFmt: INT },
    { header: 'Вихідні', key: 'output', width: 14, numFmt: INT },
    { header: 'Кеш-читання', key: 'cacheRead', width: 16, numFmt: INT },
    { header: 'Кеш-запис 5 хв', key: 'cacheWrite5m', width: 16, numFmt: INT },
    { header: 'Кеш-запис 1 год', key: 'cacheWrite1h', width: 16, numFmt: INT },
    { header: 'Ходи асистента', key: 'messages', width: 16, numFmt: INT },
    { header: '$ за 1M вихідних', key: 'usdPerMTok', width: 18, numFmt: MONEY },
    { header: 'Повна назва', key: 'model', width: 30 },
  ], data.models);

  // ---------------- Сесії --------------------------------------------------
  addTableSheet(wb, 'Сесії', [
    { header: 'Назва', key: 'title', width: 52, wrap: true },
    { header: 'Проєкт', key: 'project', width: 26 },
    { header: 'Початок', key: 'startedAt', width: 24 },
    { header: 'Завершення', key: 'endedAt', width: 24 },
    { header: 'Моделі', key: 'models', width: 30 },
    { header: 'Вхідні', key: 'input', width: 13, numFmt: INT },
    { header: 'Вихідні', key: 'output', width: 13, numFmt: INT },
    { header: 'Кеш-читання', key: 'cacheRead', width: 16, numFmt: INT },
    { header: 'Кеш-запис', key: 'cacheWrite', width: 14, numFmt: INT },
    { header: 'Кеш-хіт', key: 'cacheHitRate', width: 11, numFmt: PCT },
    { header: 'Контекст сер.', key: 'avgContext', width: 15, numFmt: INT },
    { header: 'Контекст макс.', key: 'maxContext', width: 15, numFmt: INT },
    { header: 'Ходи користувача', key: 'userTurns', width: 17, numFmt: INT },
    { header: 'Ходи асистента', key: 'assistantTurns', width: 16, numFmt: INT },
    { header: 'Субагент', key: 'sidechain', width: 11 },
    { header: '$', key: 'costUsd', width: 12, numFmt: MONEY },
    { header: 'Прапорці', key: 'flags', width: 40, wrap: true },
    { header: 'Оцінка втрат, $', key: 'wasteUsd', width: 16, numFmt: MONEY },
    // --- v1.7b: дайджест сесії ---
    { header: 'Активність', key: 'activity', width: 22 },
    { header: 'Області', key: 'areas', width: 44, wrap: true },
    { header: 'Правки', key: 'edits', width: 11, numFmt: INT },
    { header: 'Файли', key: 'filesTouched', width: 11, numFmt: INT },
    { header: 'Запит', key: 'intent', width: 70, wrap: true },
    { header: 'ID сесії', key: 'sessionId', width: 38 },
  ], data.sessions);

  // ---------------- Вивід інструментів (v1.10) -----------------------------
  // Символи → токени за наближенням 4:1; для скриншотів у base64 воно завищує,
  // тому колонка називається «Токени, приблизно», а не «Токени».
  if (data.toolOutput.length) {
    addTableSheet(wb, 'Вивід інструментів', [
      { header: 'День', key: 'dayText', width: 18 },
      { header: 'Інструмент', key: 'tool', width: 24 },
      { header: 'Результатів', key: 'calls', width: 14, numFmt: INT },
      { header: 'Символів', key: 'chars', width: 16, numFmt: INT },
      { header: 'Токени, приблизно', key: 'tokens', width: 20, numFmt: INT },
    ], data.toolOutput);
  }

  // ---------------- Рекомендації -------------------------------------------
  addTableSheet(wb, 'Рекомендації', [
    { header: 'Правило', key: 'rule', width: 22 },
    { header: 'Проєкт', key: 'project', width: 26 },
    { header: 'Серйозність', key: 'severity', width: 14 },
    { header: 'Втрати, $', key: 'wasteUsd', width: 13, numFmt: MONEY },
    { header: 'Заголовок', key: 'title', width: 44, wrap: true },
    { header: 'Доказ', key: 'evidence', width: 52, wrap: true },
    { header: 'Промпт', key: 'prompt', width: 90, wrap: true },
  ], data.recommendations);

  return wb;
}

// ------------------------------------------------------------ вивантаження -

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Назва файлу без символів, заборонених у файлових системах. */
function safeSlug(s) {
  return String(s)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'зріз';
}

/**
 * `spend-lens_{зріз}_{YYYY-MM-DD}.xlsx`, де {зріз} — проєкт або «усі-проєкти».
 * Дата — день дрил-дауну, інакше останній день зрізу, інакше сьогодні.
 */
export function xlsxFilename({ project = null, day = null, snapshot = null, date = null } = {}) {
  const slice = project ? safeSlug(project) : 'усі-проєкти';
  const stamp = day
    || date
    || (snapshot && lastDay(snapshot.days || []))
    || new Date().toISOString().slice(0, 10);
  return `spend-lens_${slice}_${stamp}.xlsx`;
}

/**
 * Вивантажує книгу через Blob + тимчасовий <a download>.
 * Поза браузером (Node-тести) просто повертає буфер — без падінь.
 * @returns {Promise<ArrayBuffer>}
 */
export async function downloadWorkbook(wb, filename = 'spend-lens.xlsx') {
  const buffer = await wb.xlsx.writeBuffer();
  const hasDom = typeof document !== 'undefined'
    && typeof Blob !== 'undefined'
    && typeof URL !== 'undefined'
    && typeof URL.createObjectURL === 'function';
  if (!hasDom) return buffer;

  const url = URL.createObjectURL(new Blob([buffer], { type: XLSX_MIME }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Відкликаємо URL із затримкою: Safari встигає почати завантаження.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return buffer;
}

/**
 * Один виклик для кнопки «Експорт XLSX»: зібрати книгу і віддати файл.
 * Стан «Готуємо файл…» тримає UI навколо цього await.
 */
export async function exportSnapshotXlsx(snapshotSlice, meta = {}) {
  const wb = await buildWorkbook(snapshotSlice, meta);
  const filename = meta.filename || xlsxFilename({
    project: meta.project || null,
    day: meta.day || null,
    snapshot: snapshotSlice,
  });
  await downloadWorkbook(wb, filename);
  return filename;
}
