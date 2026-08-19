// Вкладка «Категорії»: Pareto за проєктами, donut за моделями,
// split Основні/Субагенти, економіка кешу. Період і проєкт застосовує
// глобальний фільтр в App — снапшот приходить уже відфільтрованим.
// v1.4: на телефоні h-бар отримує багаторядкові лейбли (useHBarAxis),
// висоти графіків стискаються ~15% на ≤768 (useChartHeight).
// v1.6: група «Ефективність» (ціна ходу, ціна виходу, KPI-трійця) і теплокарта
// «Коли горять гроші» — обидві живуть на цьому ж зрізі.
// v1.8: дрібні проєкти в «Де живуть витрати» згортаються в «Інші — N проєктів»
// (§3), картку «Основні проти субагентів» перероблено (§4).

import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts';
import {
  costByProject, costByModel, mainVsSidechain, cacheEconomics,
  projectSidechainStats, groupSmallProjects, plural,
} from '../lib/analytics.js';
import { SMALL_PROJECT_USD } from '../lib/rules.js';
import { fmtUsd, fmtUsdCompact, fmtDayShort, fmtPct, shortModel } from '../lib/format.js';
import { Card } from './ui.jsx';
import EfficiencyGroup from './EfficiencyGroup.jsx';
import HeatmapCard from './HeatmapCard.jsx';
import {
  GRID, X_PROPS, Y_PROPS, ChartTooltip, LegendRow, buildModelColors,
  useMediaQuery, useChartHeight, useHBarAxis, PHONE_MEDIA,
} from './charts.jsx';

const BLUE = '#007AFF';
const ORANGE = '#FF9500';
const GRAY = '#8E8E93';

/**
 * «Де живуть витрати» з групуванням дрібних проєктів (CONTRACT v1.8 §3).
 * Згорнутий рядок сірий, як і зведена серія «Інші» на стеку «Огляду».
 */
function SpendByProjectCard({ days, isPhone }) {
  const [expanded, setExpanded] = useState(false);
  // period = 0: дні вже обрізані глобальним фільтром, додатково не ріжемо.
  const all = useMemo(() => costByProject(days, 0), [days]);
  const group = useMemo(() => groupSmallProjects(all), [all]);
  const rows = expanded ? all : group.rows;

  // v1.4: на телефоні y-вісь ≤45% контейнера + багаторядкові лейбли.
  const axis = useHBarAxis(rows.map((x) => x.project), isPhone);
  const barLabelFmt = isPhone ? fmtUsdCompact : fmtUsd;

  const subtitle = group.grouped
    ? `Вартість за проєктами, від більшого до меншого · дрібніші за ${fmtUsd(SMALL_PROJECT_USD)} зведено в «Інші»`
    : 'Вартість за проєктами, від більшого до меншого';

  return (
    <Card
      title="Де живуть витрати"
      subtitle={subtitle}
      actions={group.grouped ? (
        <button
          type="button"
          className="btn-secondary btn-compact"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={expanded
            ? 'Згорнути дрібні проєкти в один рядок'
            : `Показати всі ${all.length} ${plural(all.length, 'проєкт', 'проєкти', 'проєктів')}`}
        >
          {expanded ? 'Згорнути дрібні' : 'Показати всі'}
        </button>
      ) : null}
    >
      <div ref={axis.ref}>
        <ResponsiveContainer width="100%" height={Math.max(200, rows.length * axis.rowHeight)}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: isPhone ? 52 : 64, left: isPhone ? 0 : 8, bottom: 4 }}>
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
              content={<ChartTooltip nameFormatter={() => 'вартість'} />}
            />
            <Bar dataKey="costUsd" barSize={22} radius={[0, 6, 6, 0]}>
              {rows.map((r) => (
                <Cell key={r.project} fill={r.isOther ? GRAY : BLUE} />
              ))}
              <LabelList dataKey="costUsd" position="right" formatter={barLabelFmt} style={{ fontSize: isPhone ? 11 : 12, fill: '#1C1C1E' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {group.grouped && !expanded && (
        <p className="muted-text">
          У «Інших» — {group.otherCount}{' '}
          {plural(group.otherCount, 'проєкт', 'проєкти', 'проєктів')} на {fmtUsd(group.otherUsd)}.
        </p>
      )}
    </Card>
  );
}

/**
 * «Основні проти субагентів» (CONTRACT v1.8 §4).
 * Субагенти — помаранчеві #FF9500 (teal #32ADE6 читався як той самий синій),
 * велика цифра частки і топ-5 проєктів, де субагенти зʼїдають бюджет.
 */
function SubagentCard({ days }) {
  const split = useMemo(() => mainVsSidechain(days, 0), [days]);
  const total = split.main + split.side;
  const sidePct = total > 0 ? (split.side / total) * 100 : 0;

  const top = useMemo(() => {
    const stats = projectSidechainStats(days).filter((r) => r.side > 0);
    if (!stats.length) return [];
    // Поріг суттєвості: проєкт із $12 сабчейнів і часткою 100 % витіснив би
    // з рейтингу той, де субагенти справді зʼїдають бюджет. Беремо 5 % усіх
    // сабчейн-витрат; якщо так не лишається нікого (вузький зріз) — рейтинг
    // будується за сумою.
    const floor = Math.max(1, split.side * 0.05);
    const ranked = stats.filter((r) => r.side >= floor);
    const src = ranked.length ? ranked : stats;
    return [...src]
      .sort((a, b) => (b.share - a.share) || (b.side - a.side))
      .slice(0, 5);
  }, [days, split.side]);

  return (
    <Card
      title="Основні проти субагентів"
      subtitle="Кожен субагент отримує власну копію контексту — тому його ходи коштують окремо"
      className="subagent-card"
    >
      <div className="split-figure">
        <span className="split-figure-value">{fmtPct(sidePct)}</span>
        <span className="split-figure-caption">
          витрат — субагенти, це {fmtUsd(split.side)} із {fmtUsd(total)}
        </span>
      </div>

      <div className="split-band" role="img" aria-label={`Субагенти — ${fmtPct(sidePct)} витрат`}>
        {total > 0 && (
          <>
            <div className="split-main" style={{ width: `${(split.main / total) * 100}%` }} />
            <div className="split-side" style={{ width: `${(split.side / total) * 100}%` }} />
          </>
        )}
      </div>
      <LegendRow
        items={[
          { label: `Основні сесії — ${fmtUsd(split.main)}`, color: BLUE },
          { label: `Субагенти — ${fmtUsd(split.side)}`, color: ORANGE },
        ]}
      />

      {top.length > 0 && (
        <>
          <h4 className="card-section">Де субагенти зʼїдають найбільшу частку</h4>
          <ul className="side-rank">
            {top.map((r) => (
              <li key={r.project}>
                <span className="side-rank-head">
                  <span className="side-rank-name">{r.project}</span>
                  <span className="side-rank-nums">
                    {fmtPct(r.share * 100)} · {fmtUsd(r.side)}
                  </span>
                </span>
                <span className="side-rank-track">
                  <span
                    className="side-rank-fill"
                    style={{ width: `${Math.max(2, Math.min(100, r.share * 100))}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export default function CategoriesTab({ snapshot, returns = null }) {
  const days = snapshot.days || [];
  const isPhone = useMediaQuery(PHONE_MEDIA);
  const h = useChartHeight();

  const byModel = useMemo(() => costByModel(days, 0), [days]);
  const cache = useMemo(
    () => cacheEconomics(days, snapshot.pricingUsed, 0),
    [days, snapshot.pricingUsed]
  );

  const modelColors = useMemo(() => buildModelColors(byModel.map((m) => m.model)), [byModel]);
  const modelTotal = byModel.reduce((a, m) => a + m.costUsd, 0);
  const savedTotal = cache.reduce((a, r) => a + r.savedUsd, 0);

  return (
    <>
      <SpendByProjectCard days={days} isPhone={isPhone} />

      <div className="grid-2">
        <Card title="Вартість за моделями">
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={h(220)}>
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

        <SubagentCard days={days} />
      </div>

      <div className="grid-2">
        <Card title="Кеш-хіт за днями" subtitle="% cacheRead від усього контексту">
          <ResponsiveContainer width="100%" height={h(200)}>
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
          <ResponsiveContainer width="100%" height={h(200)}>
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

      <EfficiencyGroup
        days={days}
        sessions={snapshot.sessions || []}
        baselines={returns ? returns.baselines : null}
        height={h}
        isPhone={isPhone}
      />

      <HeatmapCard sessions={snapshot.sessions || []} timeZone={snapshot.timezone} />
    </>
  );
}
