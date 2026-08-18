// Вкладка «Категорії»: Pareto за проєктами, donut за моделями,
// split Основні/Субагенти, економіка кешу. Період і проєкт застосовує
// глобальний фільтр в App — снапшот приходить уже відфільтрованим.

import React, { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts';
import {
  costByProject, costByModel, mainVsSidechain, cacheEconomics,
} from '../lib/analytics.js';
import { fmtUsd, fmtUsdCompact, fmtDayShort, fmtPct, shortModel } from '../lib/format.js';
import { Card } from './ui.jsx';
import { GRID, X_PROPS, Y_PROPS, ChartTooltip, LegendRow, buildModelColors, yAxisWidth } from './charts.jsx';

export default function CategoriesTab({ snapshot }) {
  const days = snapshot.days || [];

  // period = 0: дні вже обрізані глобальним фільтром, додатково не ріжемо.
  const byProject = useMemo(() => costByProject(days, 0), [days]);
  const byModel = useMemo(() => costByModel(days, 0), [days]);
  const split = useMemo(() => mainVsSidechain(days, 0), [days]);
  const cache = useMemo(
    () => cacheEconomics(days, snapshot.pricingUsed, 0),
    [days, snapshot.pricingUsed]
  );

  const modelColors = useMemo(() => buildModelColors(byModel.map((m) => m.model)), [byModel]);
  const modelTotal = byModel.reduce((a, m) => a + m.costUsd, 0);
  const splitTotal = split.main + split.side;
  const savedTotal = cache.reduce((a, r) => a + r.savedUsd, 0);

  return (
    <>
      <Card title="Де живуть витрати" subtitle="Вартість за проєктами, від більшого до меншого">
        <ResponsiveContainer width="100%" height={Math.max(200, byProject.length * 40)}>
          <BarChart data={byProject} layout="vertical" margin={{ top: 4, right: 64, left: 8, bottom: 4 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="project"
              tickLine={false}
              axisLine={false}
              width={yAxisWidth(byProject.map((x) => x.project))}
              tick={{ fontSize: 12, fill: '#1C1C1E' }}
            />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              content={<ChartTooltip nameFormatter={() => 'вартість'} />}
            />
            <Bar dataKey="costUsd" fill="#007AFF" barSize={22} radius={[0, 6, 6, 0]}>
              <LabelList dataKey="costUsd" position="right" formatter={fmtUsd} style={{ fontSize: 12, fill: '#1C1C1E' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid-2">
        <Card title="Вартість за моделями">
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={byModel}
                  dataKey="costUsd"
                  nameKey="model"
                  innerRadius="62%"
                  outerRadius="88%"
                  paddingAngle={2}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                >
                  {byModel.map((m) => (
                    <Cell key={m.model} fill={modelColors.get(m.model)} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <div className="donut-total">{fmtUsdCompact(modelTotal)}</div>
              <div className="donut-caption">разом</div>
            </div>
          </div>
          <LegendRow
            items={byModel.map((m) => ({
              label: `${shortModel(m.model)} · ${fmtUsd(m.costUsd)}`,
              color: modelColors.get(m.model),
            }))}
          />
        </Card>

        <Card title="Основні проти субагентів" subtitle="Частка сабчейн-сесій у витратах">
          <div className="split-band" role="img" aria-label="Основні проти субагентів">
            {splitTotal > 0 && (
              <>
                <div className="split-main" style={{ width: `${(split.main / splitTotal) * 100}%` }} />
                <div className="split-side" style={{ width: `${(split.side / splitTotal) * 100}%` }} />
              </>
            )}
          </div>
          <div className="split-legend">
            <span><span className="dot" style={{ background: '#007AFF' }} /> Основні сесії — {fmtUsd(split.main)} ({fmtPct(splitTotal ? (split.main / splitTotal) * 100 : 0)})</span>
            <span><span className="dot" style={{ background: '#32ADE6' }} /> Субагенти — {fmtUsd(split.side)} ({fmtPct(splitTotal ? (split.side / splitTotal) * 100 : 0)})</span>
          </div>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Кеш-хіт за днями" subtitle="% cacheRead від усього контексту">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={cache} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="day" {...X_PROPS} tickFormatter={fmtDayShort} minTickGap={28} />
              <YAxis {...Y_PROPS} domain={[0, 100]} tickFormatter={(v) => `${Math.round(v)}%`} />
              <Tooltip
                content={
                  <ChartTooltip
                    labelFormatter={fmtDayShort}
                    nameFormatter={() => 'кеш-хіт'}
                    valueFormatter={(v) => fmtPct(v, 1)}
                  />
                }
              />
              <Line type="monotone" dataKey="hitPct" stroke="#34C759" strokeWidth={2} dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#FFFFFF' }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Скільки заощадив кеш" subtitle={`Разом за період: ${fmtUsd(savedTotal)}`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={cache} barCategoryGap="28%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="day" {...X_PROPS} tickFormatter={fmtDayShort} minTickGap={28} />
              <YAxis {...Y_PROPS} tickFormatter={fmtUsdCompact} />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                content={<ChartTooltip labelFormatter={fmtDayShort} nameFormatter={() => 'заощаджено'} />}
              />
              <Bar dataKey="savedUsd" fill="#34C759" maxBarSize={24} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </>
  );
}
