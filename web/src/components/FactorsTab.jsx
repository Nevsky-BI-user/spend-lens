// Вкладка «Фактори»: Pareto «Де живе перевитрата» + картки факторів
// із топ-3 доказами та поясненням «чому це відбувається».

import React, { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, LabelList,
} from 'recharts';
import { computeFactors } from '../lib/analytics.js';
import { fmtUsd } from '../lib/format.js';
import { FLAG_META } from '../lib/rules.js';
import { Card, EmptyState } from './ui.jsx';
import { ChartTooltip } from './charts.jsx';

export default function FactorsTab({ snapshot }) {
  const factors = useMemo(() => computeFactors(snapshot), [snapshot]);
  const nonZero = factors.filter((f) => f.totalUsd > 0.005);

  if (!nonZero.length) {
    return <EmptyState text="Перевитрат не виявлено — усі сесії в межах здорових порогів." />;
  }

  const chartData = nonZero.map((f) => ({
    ...f,
    label: FLAG_META[f.type]?.labelAgg || FLAG_META[f.type]?.label || f.type,
  }));

  return (
    <>
      <Card title="Де живе перевитрата" subtitle="Оцінка втрат за факторами, USD">
        <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 44)}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 72, left: 8, bottom: 4 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={false}
              width={150}
              tick={{ fontSize: 12, fill: '#1C1C1E' }}
            />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              content={<ChartTooltip nameFormatter={() => 'оцінка втрат'} />}
            />
            <Bar dataKey="totalUsd" barSize={22} radius={[0, 6, 6, 0]}>
              {chartData.map((f) => (
                <Cell key={f.type} fill={FLAG_META[f.type]?.color || '#8E8E93'} />
              ))}
              <LabelList dataKey="totalUsd" position="right" formatter={fmtUsd} style={{ fontSize: 12, fill: '#1C1C1E' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="factor-grid">
        {nonZero.map((f) => (
          <Card key={f.type} className="factor-card">
            <div className="factor-head">
              <span className={`chip chip-${f.type}`}>{FLAG_META[f.type]?.labelAgg || FLAG_META[f.type]?.label || f.type}</span>
              <strong className="factor-total">{fmtUsd(f.totalUsd)}</strong>
            </div>
            <p className="factor-why">{f.why}</p>
            {f.evidence.length > 0 && (
              <>
                <p className="factor-evidence-title">Найбільші джерела:</p>
                <ul className="factor-evidence">
                  {f.evidence.map((e, i) => (
                    <li key={i}>
                      <span className="evidence-name">
                        {e.kind === 'project' ? `проєкт ${e.name}` : e.name}
                      </span>
                      {e.kind !== 'project' && <span className="evidence-project"> · {e.project}</span>}
                      <span className="evidence-usd">{fmtUsd(e.wasteUsd)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
