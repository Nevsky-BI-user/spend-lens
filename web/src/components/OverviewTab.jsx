// Вкладка «Огляд»: KPI-картки, щоденний stacked bar за моделями,
// кумулятивна лінія поточного місяця.

import React, { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { computeKpis, dailyByModel, cumulativeMonth, lastDay } from '../lib/analytics.js';
import { fmtUsd, fmtUsdCompact, fmtDayShort, fmtPct, shortModel } from '../lib/format.js';
import { Card } from './ui.jsx';
import {
  GRID, X_PROPS, Y_PROPS, ChartTooltip, LegendRow, buildModelColors, useChartHeight,
} from './charts.jsx';

function KpiCards({ days, anchorDay }) {
  const kpis = useMemo(() => computeKpis(days, anchorDay), [days, anchorDay]);
  return (
    <div className="kpi-grid">
      {kpis.map((k) => (
        <div className="card kpi-card" key={k.label}>
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{fmtUsd(k.costUsd)}</div>
          {k.deltaPct != null ? (
            <div className={`kpi-delta ${k.deltaPct >= 0 ? 'up' : 'down'}`}>
              {k.deltaPct >= 0 ? '+' : '−'}{fmtPct(Math.abs(k.deltaPct), 1)}
              <span className="kpi-delta-note"> проти попер. періоду</span>
            </div>
          ) : (
            <div className="kpi-delta muted">{k.allTime ? 'за весь час' : 'немає бази порівняння'}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// snapshot — відфільтрований (період + проєкт) для графіків;
// kpiDays — лише фільтр проєкту (KPI тримають фіксовані вікна);
// anchorDay — останній день повного снапшота («сьогодні»).
export default function OverviewTab({ snapshot, kpiDays, anchorDay }) {
  const days = snapshot.days || [];
  const h = useChartHeight(); // v1.4: ≤768px висоти графіків −15%
  const { rows, models } = useMemo(() => dailyByModel(days), [days]);
  const colors = useMemo(() => buildModelColors(models), [models]);
  const cum = useMemo(() => cumulativeMonth(days), [days]);
  const monthLabel = useMemo(() => {
    const t = lastDay(days);
    if (!t) return '';
    const names = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень',
      'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
    return names[Number(t.slice(5, 7)) - 1];
  }, [days]);

  return (
    <>
      <KpiCards days={kpiDays || days} anchorDay={anchorDay} />

      <Card title="Витрати за днями" subtitle="Вартість за моделями за вибраний період">
        <ResponsiveContainer width="100%" height={h(280)}>
          <BarChart data={rows} barCategoryGap="28%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="day" {...X_PROPS} tickFormatter={fmtDayShort} minTickGap={28} />
            <YAxis {...Y_PROPS} tickFormatter={fmtUsdCompact} />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              content={<ChartTooltip labelFormatter={fmtDayShort} />}
            />
            {models.map((m, i) => (
              <Bar
                key={m}
                dataKey={m}
                stackId="cost"
                fill={colors.get(m)}
                stroke="#FFFFFF"
                strokeWidth={1}
                maxBarSize={24}
                radius={i === models.length - 1 ? [6, 6, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <LegendRow items={models.map((m) => ({ label: shortModel(m), color: colors.get(m) }))} />
      </Card>

      <Card title={`Наростаючий підсумок — ${monthLabel}`} subtitle="Кумулятивна вартість поточного місяця">
        <ResponsiveContainer width="100%" height={h(240)}>
          <LineChart data={cum} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="day" {...X_PROPS} tickFormatter={fmtDayShort} minTickGap={28} />
            <YAxis {...Y_PROPS} tickFormatter={fmtUsdCompact} />
            <Tooltip
              content={
                <ChartTooltip
                  labelFormatter={fmtDayShort}
                  nameFormatter={() => 'разом з початку місяця'}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="cumUsd"
              name="cumUsd"
              stroke="#007AFF"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: '#FFFFFF' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </>
  );
}
