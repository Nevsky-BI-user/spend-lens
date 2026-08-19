// Група «Ефективність» на вкладці «Категорії» (CONTRACT v1.6, пункт 4).
//
// Три погляди на те, скільки коштує одиниця роботи:
//  (a) вартість одного ходу асистента за днями + ковзне середнє 7 днів;
//  (b) фактична ціна $ за 1M вихідних токенів у розрізі моделей;
//  (c) KPI-трійця: середня сесія, середній хід, частка кешу в контексті;
//  (d) v1.8 §1 — «Віддача на витрачене»: ціна ОДИНИЦІ роботи (правки),
//      проєкти за $ за правку з лінією медіани й найгірші сесії за індексом.
//
// Дані — з відфільтрованого зрізу (період + проєкт + день), як і решта вкладки.

import React, { useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts';
import {
  costPerTurnSeries, costPerOutputMTokByModel, efficiencyKpis, plural,
} from '../lib/analytics.js';
import {
  fmtUsd, fmtUsdFine, fmtUsdCompact, fmtDayShort, fmtInt, fmtPct, fmtTokens, shortModel,
} from '../lib/format.js';
import {
  baselines as computeBaselines, projectReturn, projectReturnMedian, lowReturnSessions,
  basePoints, baseMinPoints, hasNorm, fmtRateUsd, CLASS_EDITS, RETURN_RULES,
} from '../lib/efficiency.js';
import { Card, EmptyState } from './ui.jsx';
import {
  GRID, X_PROPS, Y_PROPS, ChartTooltip, LegendRow, useHBarAxis,
} from './charts.jsx';

const BLUE = '#007AFF';
const TEAL = '#32ADE6';
const ORANGE = '#FF9500';
const GRAY = '#8E8E93';

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

/**
 * (d) «Віддача на витрачене» (CONTRACT v1.8 §1): KPI-трійця ставок, проєкти
 * за $ за правку з лінією медіани і 5 найгірших сесій за індексом віддачі.
 *
 * `baselines` приходить з App — там медіани рахуються на ПОВНІЙ історії
 * проєкту, тож норма не стрибає від зміни періоду. Немає (виклик поза App) —
 * рахуємо на видимому зрізі.
 */
function ReturnCard({ sessions, baselines: baseProp, isPhone }) {
  const base = useMemo(
    () => baseProp || computeBaselines(sessions),
    [baseProp, sessions]
  );
  const edits = base[CLASS_EDITS] || {};
  const medianEdit = edits.usdPerEdit != null ? edits.usdPerEdit : null;
  // Точки норми — це сесії, що дали САМЕ ставку $ за правку (не всі сесії
  // класу), і поки їх менше за 8, норма не сформована (CONTRACT v1.6 §3).
  const need = baseMinPoints(base);
  const editPoints = basePoints(base, CLASS_EDITS);
  const normReady = editPoints >= need;
  const normAny = hasNorm(base);
  const rows = useMemo(() => projectReturn(sessions, { topN: 8 }), [sessions]);
  // Лінія рахується по ТІЙ САМІЙ популяції, що й стовпчики (ставка проєкту),
  // інакше вона систематично лежала б нижче за них.
  const medianRef = useMemo(() => projectReturnMedian(sessions), [sessions]);
  const worst = useMemo(
    // minCostUsd той самий, що й у прапорця: сесія на $0,70 з індексом 95
    // формально «найгірша», але на дашборді про гроші вона нічого не значить.
    // minIndex > 1: сесія РІВНО на медіані не «дорожча за медіану».
    () => lowReturnSessions(sessions, {
      base,
      minIndex: RETURN_RULES.worstMinIndex,
      minCostUsd: RETURN_RULES.minCostUsd,
      sortBy: 'index',
      limit: 5,
    }),
    [sessions, base]
  );
  const axis = useHBarAxis(rows.map((r) => r.project), isPhone, 38);
  const hasData = rows.length > 0 || worst.length > 0 || medianEdit != null;

  return (
    <Card
      title="Віддача на витрачене"
      subtitle="Менше — краще: скільки коштувала одиниця роботи. Порівнюємо ставки, а не суми — дешева сесія могла не зробити нічого"
      className="return-card"
    >
      {!hasData ? (
        <EmptyState text="У цьому зрізі немає правок у файлах — ціну одиниці роботи рахувати нема з чого." />
      ) : (
        <>
          <div className="return-kpis">
            <div>
              <span>Медіана $ за правку</span>
              <strong>{medianEdit != null ? fmtRateUsd(medianEdit) : '—'}</strong>
              <em>
                {normReady ? (
                  <>
                    {fmtInt(editPoints)}{' '}
                    {plural(editPoints, 'сесія', 'сесії', 'сесій')} класу «правки»
                  </>
                ) : (
                  <>
                    замало для норми: {fmtInt(editPoints)} з {fmtInt(need)} сесій
                    {' '}класу «правки»
                  </>
                )}
              </em>
            </div>
            <div>
              <span>Медіана контексту на правку</span>
              <strong>{edits.contextPerEdit != null ? fmtTokens(edits.contextPerEdit) : '—'}</strong>
              <em>токенів контексту на одну правку</em>
            </div>
            <div>
              <span>Частка виходу</span>
              <strong>
                {base.all && base.all.outputShare != null
                  ? fmtPct(base.all.outputShare * 100, 1)
                  : '—'}
              </strong>
              <em>вихідних токенів серед усіх оплачених</em>
            </div>
          </div>

          {rows.length > 0 && (
            <>
              <h4 className="card-section">Проєкти за ціною однієї правки: менше — краще</h4>
              <div ref={axis.ref}>
                <ResponsiveContainer width="100%" height={Math.max(160, rows.length * axis.rowHeight + 30)}>
                  <BarChart
                    data={rows}
                    layout="vertical"
                    margin={{ top: 18, right: isPhone ? 52 : 64, left: isPhone ? 0 : 8, bottom: 4 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="project"
                      tickLine={false}
                      axisLine={false}
                      width={axis.yWidth}
                      tick={axis.tick}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                      content={<ChartTooltip nameFormatter={() => '$ за правку'} valueFormatter={fmtRateUsd} />}
                    />
                    {medianRef != null && (
                      <ReferenceLine
                        x={medianRef}
                        stroke={GRAY}
                        strokeDasharray="4 4"
                        ifOverflow="extendDomain"
                        label={{
                          value: `медіана проєктів ${fmtRateUsd(medianRef)}`,
                          position: 'top',
                          fill: GRAY,
                          fontSize: 11,
                        }}
                      />
                    )}
                    <Bar dataKey="usdPerEdit" fill={ORANGE} barSize={18} radius={[0, 6, 6, 0]}>
                      <LabelList
                        dataKey="usdPerEdit"
                        position="right"
                        formatter={fmtRateUsd}
                        style={{ fontSize: isPhone ? 11 : 12, fill: '#1C1C1E' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="muted-text">
                Стовпчик — витрати проєкту, поділені на його правки
                {medianRef != null
                  ? '; лінія — медіана цієї ж ставки по всіх проєктах зрізу.'
                  : '.'}
              </p>
            </>
          )}

          {!normAny && (
            <p className="muted-text">
              Порівняння сесій із нормою вимкнено: у жодному класі ще немає{' '}
              {fmtInt(need)} порівнянних сесій.
            </p>
          )}

          {worst.length > 0 && (
            <>
              <h4 className="card-section">
                Найгірша віддача — {worst.length}{' '}
                {plural(worst.length, 'сесія', 'сесії', 'сесій')}
              </h4>
              <ul className="return-sessions">
                {worst.map((w) => (
                  <li key={w.sessionId}>
                    <span className="return-session-head">
                      <span className="return-session-title">{w.title}</span>
                      <span className="return-session-cost">{fmtUsd(w.costUsd)}</span>
                    </span>
                    <span className="return-session-sub">{w.project} · {w.class}</span>
                    <span className="return-session-why">{w.evidence}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Card>
  );
}

export default function EfficiencyGroup({ days, sessions, baselines = null, height, isPhone }) {
  return (
    <>
      <h2 className="group-title">Ефективність</h2>
      <EfficiencyKpis days={days} sessions={sessions} />
      <ReturnCard sessions={sessions} baselines={baselines} isPhone={isPhone} />
      <div className="grid-2">
        <CostPerTurnCard days={days} height={height} />
        <OutputPriceCard days={days} isPhone={isPhone} />
      </div>
    </>
  );
}
