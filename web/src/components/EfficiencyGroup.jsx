// Група «Ефективність» на вкладці «Категорії» (CONTRACT v1.6, пункт 4).
//
// Три погляди на те, скільки коштує одиниця роботи:
//  (a) вартість одного ходу асистента за днями + ковзне середнє 7 днів;
//  (b) фактична ціна $ за 1M вихідних токенів у розрізі моделей;
//  (c) KPI-трійця: середня сесія, середній хід, частка кешу в контексті.
//
// Дані — з відфільтрованого зрізу (період + проєкт + день), як і решта вкладки.

import React, { useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts';
import {
  costPerTurnSeries, costPerOutputMTokByModel, efficiencyKpis, plural,
} from '../lib/analytics.js';
import {
  fmtUsd, fmtUsdFine, fmtUsdCompact, fmtDayShort, fmtInt, fmtPct, fmtTokens, shortModel,
} from '../lib/format.js';
import { Card, EmptyState } from './ui.jsx';
import {
  GRID, X_PROPS, Y_PROPS, ChartTooltip, LegendRow, useHBarAxis,
} from './charts.jsx';

const BLUE = '#007AFF';
const TEAL = '#32ADE6';

const TURN_NAMES = { costPerTurn: 'вартість ходу', ma: 'середнє за 7 днів' };

/** (a) Вартість одного ходу асистента: факт + ковзне середнє. */
function CostPerTurnCard({ days, height }) {
  const series = useMemo(() => costPerTurnSeries(days, { ma: 7 }), [days]);

  return (
    <Card
      title="Вартість одного ходу асистента"
      subtitle="Менше — краще; зростання означає, що кожен хід тягне більше контексту"
    >
      {series.rows.length === 0 ? (
        <EmptyState text="За вибраний період ходів асистента немає." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={height(220)}>
            <LineChart data={series.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="day" {...X_PROPS} tickFormatter={fmtDayShort} minTickGap={28} />
              <YAxis {...Y_PROPS} width={56} tickFormatter={fmtUsdFine} />
              <Tooltip
                content={
                  <ChartTooltip
                    labelFormatter={fmtDayShort}
                    nameFormatter={(n) => TURN_NAMES[n] || n}
                    valueFormatter={(v) => fmtUsdFine(v)}
                  />
                }
              />
              <Line
                type="monotone" dataKey="costPerTurn" name="costPerTurn"
                stroke={TEAL} strokeWidth={1.5} strokeOpacity={0.7} dot={false}
                activeDot={{ r: 3, strokeWidth: 2, stroke: '#FFFFFF' }}
              />
              <Line
                type="monotone" dataKey="ma" name="ma"
                stroke={BLUE} strokeWidth={2.5} dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#FFFFFF' }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
          <LegendRow
            items={[
              { label: TURN_NAMES.costPerTurn, color: TEAL },
              { label: TURN_NAMES.ma, color: BLUE },
            ]}
          />
          <p className="muted-text">
            Середнє за зріз: {fmtUsdFine(series.avgCostPerTurn)} за хід
            {' · '}{fmtInt(series.totalMessages)} {plural(series.totalMessages, 'хід', 'ходи', 'ходів')}
          </p>
        </>
      )}
    </Card>
  );
}

/** (b) Фактична ціна виходу: $ за 1M вихідних токенів, за моделями. */
function OutputPriceCard({ days, isPhone }) {
  const rows = useMemo(
    () => costPerOutputMTokByModel(days).map((r) => ({ ...r, label: shortModel(r.model) })),
    [days]
  );
  const axis = useHBarAxis(rows.map((r) => r.label), isPhone, 40);

  return (
    <Card
      title="$ за 1M вихідних токенів"
      subtitle="Фактична ціна виходу: у неї зашита й вартість контексту, тож модель із роздутим контекстом дорожча за прайс"
    >
      {rows.length === 0 ? (
        <EmptyState text="За вибраний період вихідних токенів немає." />
      ) : (
        <div ref={axis.ref}>
          <ResponsiveContainer width="100%" height={Math.max(160, rows.length * axis.rowHeight + 24)}>
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: isPhone ? 52 : 64, left: isPhone ? 0 : 8, bottom: 4 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={false}
                width={axis.yWidth}
                tick={axis.tick}
              />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                content={<ChartTooltip nameFormatter={() => 'ціна виходу'} />}
              />
              <Bar dataKey="usdPerMTok" fill={BLUE} barSize={20} radius={[0, 6, 6, 0]}>
                <LabelList
                  dataKey="usdPerMTok"
                  position="right"
                  formatter={isPhone ? fmtUsdCompact : fmtUsd}
                  style={{ fontSize: isPhone ? 11 : 12, fill: '#1C1C1E' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/** (c) KPI-трійця ефективності. */
function EfficiencyKpis({ days, sessions }) {
  const k = useMemo(() => efficiencyKpis(days, sessions), [days, sessions]);
  return (
    <div className="kpi-grid kpi-grid-3">
      <div className="card kpi-card">
        <div className="kpi-label">Середня вартість сесії</div>
        <div className="kpi-value">{fmtUsd(k.avgSessionUsd)}</div>
        <div className="kpi-delta muted">
          медіана {fmtUsd(k.medianSessionUsd)} · {fmtInt(k.sessionCount)}{' '}
          {plural(k.sessionCount, 'сесія', 'сесії', 'сесій')}
        </div>
      </div>
      <div className="card kpi-card">
        <div className="kpi-label">Середня вартість ходу</div>
        <div className="kpi-value">{fmtUsdFine(k.avgTurnUsd)}</div>
        <div className="kpi-delta muted">
          {fmtInt(k.messages)} {plural(k.messages, 'хід', 'ходи', 'ходів')} асистента
        </div>
      </div>
      <div className="card kpi-card">
        <div className="kpi-label">Частка кешу в контексті</div>
        <div className="kpi-value">{fmtPct(k.cacheShare * 100)}</div>
        <div className="kpi-delta muted">
          {fmtTokens(k.cacheReadTokens)} з {fmtTokens(k.contextTokens)} токенів
        </div>
      </div>
    </div>
  );
}

export default function EfficiencyGroup({ days, sessions, height, isPhone }) {
  return (
    <>
      <h2 className="group-title">Ефективність</h2>
      <EfficiencyKpis days={days} sessions={sessions} />
      <div className="grid-2">
        <CostPerTurnCard days={days} height={height} />
        <OutputPriceCard days={days} isPhone={isPhone} />
      </div>
    </>
  );
}
