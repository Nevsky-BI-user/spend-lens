// Друкований режим v1.3 «PDF = справжній сайт» (?print=daily|monthly|yearly&date=YYYY-MM-DD).
// Той самий візуальний шар, що й дашборд: компоненти ui.jsx/charts.jsx, аналітика
// analytics.js, формат format.js, токени styles.css — але у фіксованій ширині 766px
// під A4 (print.css). Дані ЗАВЖДИ з локального data/usage.json (Supabase-режим
// друк ігнорує); фейл фетча → видимий текст помилки. Після завантаження даних
// рендериться маркер #print-ready — PDF-пайплайн (report/pdf.mjs) перевіряє його
// наявність --dump-dom-пробою перед друком і фейлиться, якщо маркера немає.
//
// Періоди (дзеркало report/report.mjs::computePeriod):
//   daily   — РІВНО переданий день: викликач передає ВЖЕ ЗСУНУТУ дату
//             (звіт о 08:00 за добу, що завершилась → report.mjs шле date=вчора);
//             без date — попередня київська доба від «зараз».
//   monthly — попередній календарний місяць якоря date (без date — від сьогодні).
//   yearly  — попередній календарний рік якоря date.
//
// v1.6 (єдина розморожена правка цього файлу): за наявності ?budget= у звіт
// додається та сама картка «Бюджет місяця», що й на дашборді — компонент
// спільний, лише без інлайн-редагування (у PDF кнопки мертві). Для yearly
// картки немає: місячний бюджет у річному зведенні нічого не означає.

import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, LabelList,
} from 'recharts';
import {
  costByProject, costByModel, dailyByModel, cacheEconomics,
  analyzeSessions, computeFactors, buildRecommendations, cumulativeMonthCompare,
} from '../lib/analytics.js';
import { parseBudget } from '../lib/urlState.js';
import { FLAG_META } from '../lib/rules.js';
import {
  fmtUsd, fmtUsdCompact, fmtTokens, fmtInt, fmtPct, fmtDateTime, shortModel,
} from '../lib/format.js';
import { Card, FlagChip } from '../components/ui.jsx';
import BudgetCard from '../components/BudgetCard.jsx';
import { GRID, X_PROPS, Y_PROPS, LegendRow, buildModelColors, yAxisWidth } from '../components/charts.jsx';
import './print.css';

const KYIV = 'Europe/Kyiv';
const FULL_W = 726; // 766px контейнер − 2×20px внутрішніх відступів картки

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

const pad2 = (n) => String(n).padStart(2, '0');

function kyivToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Зсув дня 'YYYY-MM-DD' на delta діб (UTC-безпечно). */
function shiftDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function lastDateOfMonth(y, m) { // m: 1..12
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** '2026-08-17' → '17 серпня 2026'. */
function fmtDayGen(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]} ${y}`;
}

/** ISO-мітка → день 'YYYY-MM-DD' у поясі снапшота (для фільтра сесій). */
function isoDayFormatter(timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || KYIV, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return (iso) => fmt.format(new Date(iso));
  } catch {
    return (iso) => new Date(iso).toISOString().slice(0, 10);
  }
}

const isValidDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

/** Період звіту (дзеркало report.mjs, крім daily — див. шапку файлу). */
function computePeriod(type, dateParam) {
  if (type === 'daily') {
    const day = isValidDay(dateParam) ? dateParam : shiftDay(kyivToday(), -1);
    return {
      from: day, to: day,
      prevFrom: shiftDay(day, -1), prevTo: shiftDay(day, -1),
      label: fmtDayGen(day), prevName: 'проти попереднього дня',
    };
  }

  const anchor = isValidDay(dateParam) ? dateParam : kyivToday();
  const [ay, am] = anchor.split('-').map(Number);

  if (type === 'monthly') {
    let y = ay, m = am - 1;
    if (m === 0) { m = 12; y -= 1; }
    let py = y, pm = m - 1;
    if (pm === 0) { pm = 12; py -= 1; }
    return {
      from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(lastDateOfMonth(y, m))}`,
      prevFrom: `${py}-${pad2(pm)}-01`, prevTo: `${py}-${pad2(pm)}-${pad2(lastDateOfMonth(py, pm))}`,
      label: `${MONTHS_NOM[m - 1]} ${y}`, prevName: 'проти попереднього місяця',
      year: y, month: m,
    };
  }

  // yearly
  const y = ay - 1;
  return {
    from: `${y}-01-01`, to: `${y}-12-31`,
    prevFrom: `${y - 1}-01-01`, prevTo: `${y - 1}-12-31`,
    label: `${y} рік`, prevName: 'проти попереднього року',
    year: y,
  };
}

// ------------------------------------------------------------- агрегація -----

/** Фільтр снапшота за [from..to]: days — за day, sessions — за днем startedAt. */
function filterRange(snapshot, from, to) {
  const toDay = isoDayFormatter(snapshot.timezone);
  const days = (snapshot.days || []).filter((d) => d.day >= from && d.day <= to);
  const sessions = (snapshot.sessions || []).filter((s) => {
    if (!s.startedAt) return false;
    const d = toDay(s.startedAt);
    return d >= from && d <= to;
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

// --------------------------------------------------------------- блоки -------

function KpiCards({ kpis }) {
  return (
    <div className="kpi-grid">
      {kpis.map((k) => (
        <div className="card kpi-card" key={k.label}>
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{k.value}</div>
          {k.delta ? (
            k.delta.pct != null ? (
              <div className={`kpi-delta ${k.delta.pct >= 0 ? 'up' : 'down'}`}>
                {k.delta.pct >= 0 ? '+' : '−'}{fmtPct(Math.abs(k.delta.pct), 1)}
                <span className="kpi-delta-note"> {k.delta.name}</span>
              </div>
            ) : (
              /* Немає бази (попередній період = $0) — як на дашборді (OverviewTab) */
              <div className="kpi-delta muted">немає бази порівняння</div>
            )
          ) : k.sub ? (
            <div className="kpi-delta muted">{k.sub}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Горизонтальний Pareto вартості за проєктами (як «Категорії» на сайті). */
function ProjectsBar({ days, limit }) {
  const items = costByProject(days, 0).slice(0, limit);
  if (!items.length) return null;
  return (
    <BarChart
      width={FULL_W}
      height={Math.max(96, items.length * 36 + 16)}
      data={items}
      layout="vertical"
      margin={{ top: 4, right: 72, left: 8, bottom: 4 }}
    >
      <XAxis type="number" hide />
      <YAxis
        type="category"
        dataKey="project"
        tickLine={false}
        axisLine={false}
        width={yAxisWidth(items.map((x) => x.project))}
        tick={{ fontSize: 12, fill: '#1C1C1E' }}
      />
      <Bar dataKey="costUsd" fill="#007AFF" barSize={20} radius={[0, 6, 6, 0]} isAnimationActive={false}>
        <LabelList dataKey="costUsd" position="right" formatter={fmtUsd} style={{ fontSize: 12, fill: '#1C1C1E' }} />
      </Bar>
    </BarChart>
  );
}

/** Донат «розподіл за моделями» з підсумком у центрі (як «Категорії»). */
function ModelDonut({ days }) {
  const byModel = costByModel(days, 0);
  const colors = buildModelColors(byModel.map((m) => m.model));
  const total = byModel.reduce((a, m) => a + m.costUsd, 0);
  if (!byModel.length) return null;
  return (
    <>
      <div className="donut-wrap" style={{ width: FULL_W }}>
        <PieChart width={FULL_W} height={220}>
          <Pie
            data={byModel}
            dataKey="costUsd"
            nameKey="model"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={2}
            stroke="#FFFFFF"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {byModel.map((m) => (
              <Cell key={m.model} fill={colors.get(m.model)} />
            ))}
          </Pie>
        </PieChart>
        <div className="donut-center">
          <div className="donut-total">{fmtUsdCompact(total)}</div>
          <div className="donut-caption">разом</div>
        </div>
      </div>
      <LegendRow
        items={byModel.map((m) => ({
          label: `${shortModel(m.model)} · ${fmtUsd(m.costUsd)}`,
          color: colors.get(m.model),
        }))}
      />
    </>
  );
}

/** Стековані бари за моделями (дні місяця / місяці року), як «Огляд». */
function StackedByModel({ rows, models, colors }) {
  return (
    <>
      <BarChart
        width={FULL_W}
        height={240}
        data={rows}
        barCategoryGap="24%"
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...X_PROPS} minTickGap={4} />
        <YAxis {...Y_PROPS} tickFormatter={fmtUsdCompact} />
        {models.map((m, i) => (
          <Bar
            key={m}
            dataKey={m}
            stackId="cost"
            fill={colors.get(m)}
            stroke="#FFFFFF"
            strokeWidth={1}
            maxBarSize={20}
            radius={i === models.length - 1 ? [4, 4, 0, 0] : 0}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
      <LegendRow items={models.map((m) => ({ label: shortModel(m), color: colors.get(m) }))} />
    </>
  );
}

/** Pareto «Де живе перевитрата» (як вкладка «Фактори»). */
function FactorsBar({ factors }) {
  const data = factors.map((f) => ({
    ...f,
    label: FLAG_META[f.type]?.labelAgg || FLAG_META[f.type]?.label || f.type,
  }));
  return (
    <BarChart
      width={FULL_W}
      height={Math.max(120, data.length * 40 + 16)}
      data={data}
      layout="vertical"
      margin={{ top: 4, right: 72, left: 8, bottom: 4 }}
    >
      <XAxis type="number" hide />
      <YAxis
        type="category"
        dataKey="label"
        tickLine={false}
        axisLine={false}
        width={yAxisWidth(data.map((f) => f.label))}
        tick={{ fontSize: 12, fill: '#1C1C1E' }}
      />
      <Bar dataKey="totalUsd" barSize={20} radius={[0, 6, 6, 0]} isAnimationActive={false}>
        {data.map((f) => (
          <Cell key={f.type} fill={FLAG_META[f.type]?.color || '#8E8E93'} />
        ))}
        <LabelList dataKey="totalUsd" position="right" formatter={fmtUsd} style={{ fontSize: 12, fill: '#1C1C1E' }} />
      </Bar>
    </BarChart>
  );
}

/** Топ-сесії періоду: назва, проєкт, $, чіпи-прапорці (v1.2 content). */
function TopSessionsTable({ filtered, limit }) {
  const { flagged } = analyzeSessions(filtered);
  const rows = [...flagged]
    .sort((a, b) => ((b.session.totals?.costUsd) || 0) - ((a.session.totals?.costUsd) || 0))
    .slice(0, limit);
  if (!rows.length) return <p className="muted-text">Сесій за період немає.</p>;
  return (
    <div className="table-scroll">
      <table className="sessions-table">
        <thead>
          <tr>
            <th>Назва</th>
            <th>Проєкт</th>
            <th>$</th>
            <th>Прапорці</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ session: s, flags }) => (
            <tr key={s.sessionId}>
              <td className="cell-title">
                {s.title || s.sessionId}
                {s.sidechain && <span className="side-badge">сабчейн</span>}
              </td>
              <td>{s.project}</td>
              <td className="cell-num cell-cost">{fmtUsd(s.totals?.costUsd)}</td>
              <td className="cell-flags">
                <div className="chip-row">
                  {flags.map((f) => <FlagChip key={f.type} type={f.type} />)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SEVERITY_ICON = { high: '🔴', medium: '🟠', low: '🟡' };
const SEVERITY_LABEL = { high: 'критично', medium: 'помітно', low: 'дрібниця' };

/** Картки рекомендацій (як «Дії», без кнопки копіювання — у PDF вона мертва). */
function RecommendationCards({ filtered, limit }) {
  const cards = buildRecommendations(filtered).slice(0, limit);
  if (!cards.length) {
    return <p className="muted-text">Рекомендацій немає — витрати виглядають здоровими.</p>;
  }
  return (
    <div className="actions-list">
      {cards.map((c) => (
        <Card key={c.id} className="action-card">
          <div className="action-head">
            <span className="severity" title={SEVERITY_LABEL[c.severity]}>{SEVERITY_ICON[c.severity]}</span>
            <h3 className="action-title">{c.title}</h3>
            <span className="action-waste">{fmtUsd(c.wasteUsd)}</span>
          </div>
          <div className="chip-row"><FlagChip type={c.type} /></div>
          <p className="action-evidence">{c.evidence}</p>
          <div className="prompt-box">
            <p>{c.prompt}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Картка бюджету місяця (CONTRACT v1.6 §2) — рахується по ПОВНОМУ снапшоту,
 * а не по періоду звіту: бюджет місячний, і для денного зведення потрібен
 * накопичений підсумок місяця станом на день звіту.
 */
function BudgetBlock({ snapshot, anchorDay, budgetUsd }) {
  if (!budgetUsd) return null;
  const cmp = cumulativeMonthCompare(snapshot.days || [], anchorDay);
  return (
    <BudgetCard
      budgetUsd={budgetUsd}
      monthCost={cmp.curTotal}
      forecastTotal={cmp.forecastTotal}
      month={cmp.month}
      editable={false}
    />
  );
}

// -------------------------------------------------------- макети звітів ------

function commonKpis(t, tp, period, filtered, { costLabel, withSavings = false, withTopProject = false }) {
  const kpis = [
    { label: costLabel, value: fmtUsd(t.cost), delta: { pct: deltaPct(t.cost, tp.cost), name: period.prevName } },
    { label: 'Токени in', value: fmtTokens(t.input) },
    { label: 'Токени out', value: fmtTokens(t.output) },
    { label: 'Кеш-читання', value: fmtTokens(t.cacheRead) },
  ];
  if (withSavings) {
    const saved = cacheEconomics(filtered.days, filtered.pricingUsed, 0)
      .reduce((a, r) => a + r.savedUsd, 0);
    kpis.push({ label: 'Кеш-заощадження', value: fmtUsd(saved) });
  }
  kpis.push({ label: 'Кеш-хіт', value: fmtPct(t.hitPct) });
  kpis.push({ label: 'Сесії', value: fmtInt(filtered.sessions.length), sub: 'вартістю від $0,01' });
  if (withTopProject) {
    const top = costByProject(filtered.days, 0)[0];
    kpis.push(top
      ? { label: 'Найдорожчий проєкт', value: top.project, sub: fmtUsd(top.costUsd) }
      : { label: 'Найдорожчий проєкт', value: '—' });
  }
  return kpis;
}

function DailyReport({ snapshot, period, budgetUsd }) {
  const cur = filterRange(snapshot, period.from, period.to);
  const prev = filterRange(snapshot, period.prevFrom, period.prevTo);
  const t = sumDays(cur.days);
  const tp = sumDays(prev.days);

  return (
    <>
      <KpiCards kpis={commonKpis(t, tp, period, cur, { costLabel: 'Вартість дня' })} />
      <BudgetBlock snapshot={snapshot} anchorDay={period.to} budgetUsd={budgetUsd} />
      {!cur.days.length ? (
        <div className="warn-banner">
          За {period.label} даних у снапшоті немає. Схоже, Claude Code цього дня не використовувався
          або collector ще не запускався.
        </div>
      ) : (
        <>
          <Card title="Вартість за проєктами"><ProjectsBar days={cur.days} limit={12} /></Card>
          <Card title="Розподіл за моделями"><ModelDonut days={cur.days} /></Card>
          <Card title="Топ-5 сесій дня"><TopSessionsTable filtered={cur} limit={5} /></Card>
          <Card title="Рекомендації дня"><RecommendationCards filtered={cur} limit={5} /></Card>
        </>
      )}
    </>
  );
}

function MonthlyReport({ snapshot, period, budgetUsd }) {
  const cur = filterRange(snapshot, period.from, period.to);
  const prev = filterRange(snapshot, period.prevFrom, period.prevTo);
  const t = sumDays(cur.days);
  const tp = sumDays(prev.days);
  const factors = computeFactors(cur).filter((f) => f.totalUsd > 0.01);

  // Всі дні місяця (включно з порожніми), стек за моделями
  const { models } = dailyByModel(cur.days);
  const colors = buildModelColors(models);
  const byDay = new Map();
  for (const d of cur.days) {
    const row = byDay.get(d.day) || {};
    row[d.model] = (row[d.model] || 0) + (d.costUsd || 0);
    byDay.set(d.day, row);
  }
  const rows = [];
  const nDays = lastDateOfMonth(period.year, period.month);
  for (let dd = 1; dd <= nDays; dd++) {
    const day = `${period.year}-${pad2(period.month)}-${pad2(dd)}`;
    const src = byDay.get(day) || {};
    const row = { label: String(dd) };
    for (const m of models) row[m] = src[m] || 0;
    rows.push(row);
  }

  return (
    <>
      <KpiCards kpis={commonKpis(t, tp, period, cur, {
        costLabel: 'Вартість місяця', withSavings: true, withTopProject: true,
      })} />
      <BudgetBlock snapshot={snapshot} anchorDay={period.to} budgetUsd={budgetUsd} />
      {!cur.days.length ? (
        <div className="warn-banner">За {period.label} даних у снапшоті немає.</div>
      ) : (
        <>
          <Card title="Витрати за днями" subtitle="Вартість за моделями, всі дні місяця">
            <StackedByModel rows={rows} models={models} colors={colors} />
          </Card>
          <Card title="Топ-10 проєктів місяця"><ProjectsBar days={cur.days} limit={10} /></Card>
          <Card title="Топ-10 сесій місяця"><TopSessionsTable filtered={cur} limit={10} /></Card>
          <Card title="Де живе перевитрата" subtitle="Оцінка втрат за факторами, USD">
            {factors.length
              ? <FactorsBar factors={factors} />
              : <p className="muted-text">Суттєвих факторів перевитрати за період не виявлено.</p>}
          </Card>
          <Card title="Рекомендації"><RecommendationCards filtered={cur} limit={8} /></Card>
        </>
      )}
    </>
  );
}

function YearlyReport({ snapshot, period }) {
  const cur = filterRange(snapshot, period.from, period.to);
  const prev = filterRange(snapshot, period.prevFrom, period.prevTo);
  const t = sumDays(cur.days);
  const tp = sumDays(prev.days);
  const factors = computeFactors(cur).filter((f) => f.totalUsd > 0.01);

  // 12 місячних стеків за моделями
  const { models } = dailyByModel(cur.days);
  const colors = buildModelColors(models);
  const byMonth = new Map();
  for (const d of cur.days) {
    const m = Number(d.day.slice(5, 7));
    const row = byMonth.get(m) || {};
    row[d.model] = (row[d.model] || 0) + (d.costUsd || 0);
    byMonth.set(m, row);
  }
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const src = byMonth.get(m) || {};
    const row = { label: MONTHS_SHORT[m - 1] };
    for (const model of models) row[model] = src[model] || 0;
    rows.push(row);
  }

  return (
    <>
      <KpiCards kpis={commonKpis(t, tp, period, cur, {
        costLabel: 'Вартість року', withSavings: true, withTopProject: true,
      })} />
      {!cur.days.length ? (
        <div className="warn-banner">За {period.label} даних у снапшоті немає.</div>
      ) : (
        <>
          <Card title="Витрати за місяцями" subtitle="Вартість за моделями">
            <StackedByModel rows={rows} models={models} colors={colors} />
          </Card>
          <Card title="Топ-10 проєктів року"><ProjectsBar days={cur.days} limit={10} /></Card>
          <Card title="Топ-10 сесій року"><TopSessionsTable filtered={cur} limit={10} /></Card>
          <Card title="Де живе перевитрата" subtitle="Оцінка втрат за факторами, USD">
            {factors.length
              ? <FactorsBar factors={factors} />
              : <p className="muted-text">Суттєвих факторів перевитрати за період не виявлено.</p>}
          </Card>
        </>
      )}
    </>
  );
}

const LAYOUTS = { daily: DailyReport, monthly: MonthlyReport, yearly: YearlyReport };

// ---------------------------------------------------------------- корінь -----

export default function PrintReport({ type, date, budget = '' }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    document.body.classList.add('print-mode');
    return () => document.body.classList.remove('print-mode');
  }, []);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || '/';
    fetch(`${base}data/usage.json`, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((snapshot) => setState({ status: 'ready', snapshot }))
      .catch((e) => setState({ status: 'error', error: e.message }));
  }, []);

  const period = useMemo(() => computePeriod(type, date), [type, date]);
  const budgetUsd = useMemo(() => parseBudget(budget), [budget]);

  if (state.status === 'loading') {
    return <div className="print-report"><p className="muted-text">Завантаження даних…</p></div>;
  }
  if (state.status === 'error') {
    return (
      <div className="print-report">
        <p className="error-note">
          Помилка: не вдалося завантажити data/usage.json ({state.error}).
          Запусти collector і збери сайт заново.
        </p>
      </div>
    );
  }

  const { snapshot } = state;
  const Layout = LAYOUTS[type] || DailyReport;

  return (
    <div className="print-report">
      <header className="print-header">
        <h1>spend-lens — зведення за {period.label}</h1>
        <p className="print-sub">
          Дані оновлено: {fmtDateTime(snapshot.generatedAt)} · часовий пояс {snapshot.timezone || KYIV}
        </p>
      </header>

      <Layout snapshot={snapshot} period={period} budgetUsd={budgetUsd} />

      <footer className="print-footer">
        spend-lens · джерело цін: {snapshot.pricingSource === 'litellm' ? 'LiteLLM' : 'вбудована таблиця'}
      </footer>

      {/* Маркер для PDF-пайплайна: рендериться ЛИШЕ після завантаження даних */}
      <div id="print-ready" data-period={`${period.from}..${period.to}`} />
    </div>
  );
}
