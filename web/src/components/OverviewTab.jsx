// Вкладка «Огляд»: KPI-картки, картка бюджету, щоденний stacked bar (за
// моделями / за проєктами) з дрил-дауном і позначками аномальних днів,
// наростаючий підсумок місяця з порівнянням і прогнозом, топ проєктів за
// період із Δ проти попереднього вікна і — ОСТАННЬОЮ (CONTRACT v1.8 §2) —
// картка «Слабка віддача».
//
// Дані: `snapshot` — відфільтрований період + проєкт (графік днів, топ проєктів);
// `kpiDays` — лише фільтр проєкту (KPI, бюджет і місячна картка тримають свої вікна).

import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import {
  computeKpis, dailyByModel, dailyByProject, cumulativeMonthCompare,
  projectsWithDelta, OTHER_PROJECT,
} from '../lib/analytics.js';
import {
  fmtUsd, fmtUsdCompact, fmtDayShort, fmtDomMonth, fmtPct, monthName, shortModel, plural,
} from '../lib/format.js';
import { Card, Segmented, EmptyState } from './ui.jsx';
import BudgetCard from './BudgetCard.jsx';
import LowReturnCard from './LowReturnCard.jsx';
import {
  GRID, X_PROPS, Y_PROPS, ChartTooltip, LegendRow,
  buildModelColors, buildSeriesColors, useChartHeight,
} from './charts.jsx';

const BLUE = '#007AFF';
const GRAY = '#8E8E93';
const RED = '#FF3B30';

function KpiCards({ days, anchorDay }) {
  const kpis = useMemo(() => computeKpis(days, anchorDay), [days, anchorDay]);
  return (
    <div className="kpi-grid">
      {kpis.map((k) => (
        <div
          className="card kpi-card"
          key={k.label}
          // Підказка розкриває базу: без неї «+148 %» — число без опори.
          title={k.baseAvg
            ? `Середній активний день за весь час: ${fmtUsd(k.baseAvg)} (${k.baseDays} ${plural(k.baseDays, 'день', 'дні', 'днів')} зі споживанням; дні без витрат не рахуються)`
            : undefined}
        >
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{fmtUsd(k.costUsd)}</div>
          {k.deltaPct != null ? (
            <div className={`kpi-delta ${k.deltaPct >= 0 ? 'up' : 'down'}`}>
              {k.deltaPct >= 0 ? '+' : '−'}{fmtPct(Math.abs(k.deltaPct), 1)}
              <span className="kpi-delta-note"> {k.deltaNote || 'проти попер. періоду'}</span>
            </div>
          ) : (
            <div className="kpi-delta muted">{k.allTime ? 'за весь час' : 'немає бази порівняння'}</div>
          )}
        </div>
      ))}
    </div>
  );
}

const SPLIT_OPTIONS = [
  { value: 'models', label: 'За моделями' },
  { value: 'projects', label: 'За проєктами' },
];

// Скільки проєктів лишаються окремими серіями; решта — «Інші» (CONTRACT v1.5).
const TOP_PROJECTS = 6;

/** Червона крапка над стовпчиком аномального дня (CONTRACT v1.6 §3). */
function AnomalyDot({ cx, cy, payload }) {
  if (cx == null || cy == null || payload?.anomalyMark == null) return null;
  return (
    <circle cx={cx} cy={cy - 9} r={4} fill={RED} stroke="#FFFFFF" strokeWidth={1.5} />
  );
}

/** Stacked bar витрат за днями з перемикачем розбивки (моделі / проєкти). */
function DailyCard({ days, height, returns, onSelectDay }) {
  const [splitBy, setSplitBy] = useState('models');
  const byModel = useMemo(() => dailyByModel(days), [days]);
  const byProject = useMemo(() => dailyByProject(days, { topN: TOP_PROJECTS }), [days]);
  const modelColors = useMemo(() => buildModelColors(byModel.models), [byModel.models]);
  const projColors = useMemo(() => buildSeriesColors(byProject.projects), [byProject.projects]);

  const isModels = splitBy === 'models';
  const baseRows = isModels ? byModel.rows : byProject.rows;
  const keys = isModels ? byModel.models : byProject.projects;
  const colors = isModels ? modelColors : projColors;

  // Позначка аномалії — денна сума з детектора (він рахує на повній історії,
  // а не на видимому вікні), тож крапка стоїть рівно на вершині стовпчика.
  const byDay = returns?.days?.byDay;
  const flagged = returns?.days?.flaggedDays;
  const rows = useMemo(() => {
    if (!flagged || flagged.size === 0) return baseRows;
    return baseRows.map((r) => ({
      ...r,
      anomalyMark: flagged.has(r.day) ? (byDay.get(r.day)?.costUsd ?? null) : null,
    }));
  }, [baseRows, flagged, byDay]);
  const hasAnomalyInView = rows.some((r) => r.anomalyMark != null);
  // Назва серії: моделі скорочуємо (claude-fable-5 → fable-5), проєкти — як є.
  const nameOf = isModels ? shortModel : (k) => k;
  // Про «Інші» згадуємо лише тоді, коли така серія справді є: при фільтрі на
  // один проєкт (або коли проєктів ≤ topN) обіцяти її було б неправдою.
  const hasOther = byProject.projects.includes(OTHER_PROJECT);

  const baseSubtitle = isModels
    ? 'Вартість за моделями за вибраний період'
    : hasOther
      ? `Вартість за проєктами за вибраний період: топ-${TOP_PROJECTS}, решта — «${OTHER_PROJECT}»`
      : 'Вартість за проєктами за вибраний період';

  return (
    <Card
      title="Витрати за днями"
      subtitle={onSelectDay ? `${baseSubtitle} · клік по стовпчику покаже сесії того дня` : baseSubtitle}
      actions={
        <Segmented
          options={SPLIT_OPTIONS}
          value={splitBy}
          onChange={setSplitBy}
          ariaLabel="Розбивка витрат за днями"
        />
      }
    >
      <div className={onSelectDay ? 'chart-clickable' : undefined}>
        <ResponsiveContainer width="100%" height={height(280)}>
          <ComposedChart
            data={rows}
            barCategoryGap="28%"
            margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
            onClick={(e) => {
              // activeLabel — значення dataKey осі X (день) у клікнутій категорії;
              // це надійніше за onClick на кожному <Bar>, бо ловить і кліки
              // повз сам стовпчик (на телефоні влучити в 24px непросто).
              if (onSelectDay && e && e.activeLabel) onSelectDay(e.activeLabel);
            }}
          >
            <CartesianGrid {...GRID} />
            <XAxis dataKey="day" {...X_PROPS} tickFormatter={fmtDayShort} minTickGap={28} />
            <YAxis {...Y_PROPS} tickFormatter={fmtUsdCompact} />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              content={<ChartTooltip labelFormatter={fmtDayShort} nameFormatter={nameOf} />}
            />
            {keys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="cost"
                fill={colors.get(k)}
                stroke="#FFFFFF"
                strokeWidth={1}
                maxBarSize={24}
                radius={i === keys.length - 1 ? [6, 6, 0, 0] : 0}
              />
            ))}
            {/* Лінія-носій для крапок аномалій: сама лінія невидима, значення
                дорівнює вершині стека, тож домен осі Y не зсувається. */}
            {hasAnomalyInView && (
              <Line
                type="linear"
                dataKey="anomalyMark"
                name="anomalyMark"
                stroke="none"
                legendType="none"
                tooltipType="none"
                connectNulls={false}
                isAnimationActive={false}
                dot={<AnomalyDot />}
                activeDot={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <LegendRow
        items={[
          ...keys.map((k) => ({ label: nameOf(k), color: colors.get(k) })),
          ...(hasAnomalyInView ? [{ label: 'аномальний день', color: RED }] : []),
        ]}
      />
    </Card>
  );
}

// Порядок рядків у тултіпі: спершу факт, потім прогноз, потім минулий місяць
// (лінії ж малюються у зворотному порядку, щоб синя була згори). Сортує сам
// ChartTooltip — Tooltip.itemSorter працює лише з дефолтним вмістом.
const TIP_ORDER = { cur: 0, forecast: 1, prev: 2 };
const SERIES_NAMES = { cur: 'цей місяць', forecast: 'прогноз', prev: 'минулий місяць' };

/** Наростаючий підсумок місяця: факт + минулий місяць + прогноз до кінця.
 *  `cmp` рахує корінь вкладки — ті самі числа потрібні картці бюджету. */
function CumulativeCard({ cmp, height }) {
  const label = monthName(cmp.month);
  const subtitle = cmp.forecastTotal != null
    ? `Прогноз на кінець місяця: ${fmtUsd(cmp.forecastTotal)} · минулий місяць: ${fmtUsd(cmp.prevTotal)}`
    : `Разом за місяць: ${fmtUsd(cmp.curTotal)} · минулий місяць: ${fmtUsd(cmp.prevTotal)}`;

  return (
    <Card title={`Наростаючий підсумок — ${label}`} subtitle={subtitle}>
      {/* 280, як у щоденного бару: три накладені серії потребують повітря,
          та й у grid-2 картка сусідить із високим списком топ-проєктів. */}
      <ResponsiveContainer width="100%" height={height(280)}>
        <LineChart data={cmp.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="dom" {...X_PROPS} minTickGap={18} />
          <YAxis {...Y_PROPS} tickFormatter={fmtUsdCompact} />
          <Tooltip
            content={
              <ChartTooltip
                order={TIP_ORDER}
                labelFormatter={(dom) => fmtDomMonth(dom, cmp.month)}
                nameFormatter={(n) => SERIES_NAMES[n] || n}
              />
            }
          />
          {/* Підпорядковані серії — тонші, пунктирні, приглушені; синя суцільна
              лінія факту оголошена останньою, тож малюється поверх них. */}
          <Line
            type="monotone" dataKey="prev" name="prev"
            stroke={GRAY} strokeWidth={1.5} strokeDasharray="4 4"
            dot={false} activeDot={{ r: 3, strokeWidth: 2, stroke: '#FFFFFF' }}
            connectNulls={false}
          />
          <Line
            type="monotone" dataKey="forecast" name="forecast"
            stroke={BLUE} strokeWidth={1.5} strokeDasharray="5 5" strokeOpacity={0.5}
            dot={false} activeDot={{ r: 3, strokeWidth: 2, stroke: '#FFFFFF' }}
            connectNulls={false}
          />
          <Line
            type="monotone" dataKey="cur" name="cur"
            stroke={BLUE} strokeWidth={2.5}
            dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#FFFFFF' }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <LegendRow
        items={[
          { label: SERIES_NAMES.cur, color: BLUE },
          ...(cmp.forecastTotal != null
            ? [{ label: SERIES_NAMES.forecast, color: BLUE, dash: true, faded: true }]
            : []),
          { label: SERIES_NAMES.prev, color: GRAY, dash: true },
        ]}
      />
    </Card>
  );
}

/** Δ-бейдж проти попереднього вікна: дорожче — червоний, дешевше — зелений.
 *  Період «Увесь час» бази для порівняння не має — тоді бейджа просто немає. */
function DeltaBadge({ deltaPct, isNew }) {
  if (isNew) return <span className="delta-chip new">новий</span>;
  if (deltaPct == null) return null;
  const up = deltaPct >= 0;
  return (
    <span className={`delta-chip ${up ? 'up' : 'down'}`}>
      {up ? '+' : '−'}{fmtPct(Math.abs(deltaPct), 0)}
    </span>
  );
}

/** Топ проєктів за період: горизонтальні бари, клік → глобальний фільтр. */
function TopProjectsCard({ days, kpiDays, period, project, anchorDay, onSelectProject }) {
  const rows = useMemo(
    () => projectsWithDelta(days, kpiDays, { period, anchorDay, topN: 8 }),
    [days, kpiDays, period, anchorDay]
  );
  const max = rows.reduce((a, r) => Math.max(a, r.costUsd), 0);
  const subtitle = period > 0
    ? `Вартість за період і зміна проти попередніх ${period} днів`
    : 'Вартість за весь час — попереднього вікна для порівняння немає';

  return (
    <Card
      title="Топ проєктів за період"
      subtitle={subtitle}
      actions={project && onSelectProject ? (
        <button type="button" className="link-btn" onClick={() => onSelectProject(null)}>
          Показати всі проєкти
        </button>
      ) : null}
    >
      {rows.length === 0 ? (
        <EmptyState text="За вибраний період витрат немає." />
      ) : (
        <ul className="proj-bars">
          {rows.map((r) => (
            <li key={r.project}>
              <button
                type="button"
                className="proj-bar"
                title={`Показати лише ${r.project}`}
                aria-label={`${r.project}: ${fmtUsd(r.costUsd)}. Показати лише цей проєкт`}
                onClick={() => onSelectProject && onSelectProject(r.project)}
              >
                <span className="proj-bar-head">
                  <span className="proj-bar-name">{r.project}</span>
                  <span className="proj-bar-cost">{fmtUsd(r.costUsd)}</span>
                </span>
                <span className="proj-bar-row">
                  <span className="proj-bar-track">
                    <span
                      className="proj-bar-fill"
                      style={{ width: `${max > 0 ? Math.max(2, (r.costUsd / max) * 100) : 0}%` }}
                    />
                  </span>
                  <DeltaBadge deltaPct={r.deltaPct} isNew={r.isNew} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function OverviewTab({
  snapshot, kpiDays, anchorDay, period = 0, project = null,
  returns = null, budgetUsd = null, onBudgetChange,
  onSelectProject, onSelectDay,
}) {
  const days = snapshot.days || [];
  // kpiDays — лише фільтр проєкту: місячна картка мусить бачити ВЕСЬ місяць,
  // інакше при періоді «7 днів» наростаючий підсумок обрізався (BUGFIX v1.5).
  const monthDays = kpiDays && kpiDays.length ? kpiDays : days;
  const h = useChartHeight(); // v1.4: ≤768px висоти графіків −15%
  const cmp = useMemo(
    () => cumulativeMonthCompare(monthDays, anchorDay),
    [monthDays, anchorDay]
  );

  return (
    <>
      <KpiCards days={monthDays} anchorDay={anchorDay} />

      <BudgetCard
        budgetUsd={budgetUsd}
        monthCost={cmp.curTotal}
        forecastTotal={cmp.forecastTotal}
        month={cmp.month}
        onChange={onBudgetChange}
      />

      <DailyCard days={days} height={h} returns={returns} onSelectDay={onSelectDay} />

      <div className="grid-2">
        <CumulativeCard cmp={cmp} height={h} />
        <TopProjectsCard
          days={days}
          kpiDays={monthDays}
          period={period}
          project={project}
          anchorDay={anchorDay}
          onSelectProject={onSelectProject}
        />
      </div>

      {/* CONTRACT v1.8 §2: розбір «де віддача слабка» — в самий низ сторінки,
          після грошей і трендів. */}
      <LowReturnCard
        returns={returns}
        days={days}
        sessions={snapshot.sessions || []}
        timeZone={snapshot.timezone}
        onSelectDay={onSelectDay}
      />
    </>
  );
}
