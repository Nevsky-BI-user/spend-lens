// Картка «Скільки економить RTK» на вкладці «Категорії» (CONTRACT v1.9).
//
// RTK (Rust Token Killer) — локальний CLI-проксі, який підрізає вивід команд
// ЩЕ ДО того, як він потрапить у модель. Збережені токени — це вхід, якого не
// було; оцінюємо їх вхідною ціною тієї суміші моделей, якою реально працювали
// (rtkValue.js), і чесно називаємо це нижньою межею.
//
// Межі відповідальності:
//  - фільтр ПЕРІОДУ застосовується (вікно рахує rtkWindow за тим самим якорем,
//    що й решта дашборда);
//  - фільтр ПРОЄКТУ не застосовується — rtk не поділяє статистику за проєктами,
//    і про це прямо сказано в підзаголовку;
//  - немає snapshot.rtk → компонент повертає null і картки просто немає
//    (жодного порожнього стану, жодної помилки).

import React, { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import {
  valueRtk, rtkWindow, rtkCoverage, topRtkCommands, hasRtkData, RTK_FLOOR_NOTE,
} from '../lib/rtkValue.js';
import {
  fmtUsd, fmtTokens, fmtInt, fmtPct, fmtDayShort, fmtDomMonth, plural,
} from '../lib/format.js';
import { Card, EmptyState } from './ui.jsx';
import { GRID, X_PROPS, Y_PROPS } from './charts.jsx';

const GREEN = '#34C759';

/** '2026-08-12' → '12 серпня' (для прози в підзаголовку й порожньому стані). */
const dayInWords = (day) => fmtDomMonth(Number(String(day).slice(8, 10)), day);

const SUBTITLE_BASE =
  'RTK підрізає вивід команд ще до моделі. Статистика глобальна: '
  + 'фільтр за проєктом на неї не впливає';

/** Тултіп денного бару: збережені токени + їхня грошова оцінка. */
function RtkTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{fmtDayShort(label)}</div>
      <div className="chart-tooltip-row">
        <span className="dot" style={{ background: GREEN }} />
        <span className="chart-tooltip-name">збережено</span>
        <span className="chart-tooltip-value">{fmtTokens(row.savedTokens)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="dot" style={{ background: GREEN, opacity: 0.35 }} />
        <span className="chart-tooltip-name">оцінка</span>
        <span className="chart-tooltip-value">{fmtUsd(row.valueUsd)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="dot" style={{ background: 'transparent' }} />
        <span className="chart-tooltip-name">команд</span>
        <span className="chart-tooltip-value">{fmtInt(row.commands)}</span>
      </div>
    </div>
  );
}

export default function RtkCard({
  rtk, allDays = [], pricingUsed = {}, period = 0, day = null, anchorDay = '', height,
}) {
  const h = height || ((base) => base);

  const win = useMemo(
    () => rtkWindow({ period, day, anchorDay }),
    [period, day, anchorDay]
  );
  const val = useMemo(
    () => valueRtk(rtk, { ...win, days: allDays, pricingUsed }),
    [rtk, win, allDays, pricingUsed]
  );
  const commands = useMemo(() => topRtkCommands(rtk, 5), [rtk]);
  // Межі денної статистики rtk: у неї є строк зберігання, тож «за період немає
  // рядків» і «RTK тих днів узагалі не бачив» — різні твердження.
  const cover = useMemo(() => rtkCoverage(rtk), [rtk]);

  // Немає блоку rtk у снапшоті — картки не існує (CONTRACT v1.9).
  if (!hasRtkData(rtk) || !val) return null;

  const nDays = val.rows.length;
  const maxSaved = commands.reduce((a, c) => Math.max(a, c.savedTokens || 0), 0);

  // Запит ширший за наявну статистику: «30 днів» і «увесь час» дають однакові
  // числа, і мовчати про це не можна — інакше фільтр виглядає зламаним.
  const truncated = nDays > 0 && !!cover.from && (win.from == null || win.from < cover.from);
  const subtitle = truncated
    ? `${SUBTITLE_BASE}. Денні лічильники RTK починаються з ${dayInWords(cover.from)} — `
      + 'за раніші дні їх немає, тож ширші періоди нічого не додають.'
    : `${SUBTITLE_BASE}, період — впливає.`;

  // Порожньо може бути з двох різних причин; стверджувати «не обробив жодної
  // команди» можна лише там, де RTK справді вів облік.
  let emptyText = 'За вибраний період RTK не обробив жодної команди.';
  if (cover.from && win.to && win.to < cover.from) {
    emptyText = `RTK зберігає денну статистику лише з ${dayInWords(cover.from)} — `
      + 'за раніші дні її немає.';
  } else if (cover.to && win.from && win.from > cover.to) {
    emptyText = `Денна статистика RTK закінчується ${dayInWords(cover.to)} — `
      + 'за пізніші дні її немає.';
  }

  return (
    <Card
      title="Скільки економить RTK"
      subtitle={subtitle}
    >
      {nDays === 0 ? (
        <EmptyState text={emptyText} />
      ) : (
        <>
          <div className="kpi-grid kpi-grid-3">
            <div className="card kpi-card">
              <div className="kpi-label">Збережено токенів</div>
              <div className="kpi-value">{fmtTokens(val.savedTokens)}</div>
              <div className="kpi-delta muted">
                {fmtPct(val.savingsPct, 1)} від того, що RTK обробив
              </div>
            </div>
            <div className="card kpi-card">
              <div className="kpi-label">Оцінка в грошах, мінімум</div>
              <div className="kpi-value">{fmtUsd(val.valueUsd)}</div>
              <div className="kpi-delta muted">
                вхідна ціна суміші — {fmtUsd(val.blendedInput)} за 1M токенів
              </div>
            </div>
            <div className="card kpi-card">
              <div className="kpi-label">Команд оброблено</div>
              <div className="kpi-value">{fmtInt(val.commands)}</div>
              <div className="kpi-delta muted">
                за {fmtInt(nDays)} {plural(nDays, 'день', 'дні', 'днів')} зі статистикою
              </div>
            </div>
          </div>

          <h4 className="card-section">Збережені токени за днями</h4>
          <ResponsiveContainer width="100%" height={h(200)}>
            <BarChart data={val.rows} barCategoryGap="28%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="date" {...X_PROPS} tickFormatter={fmtDayShort} minTickGap={28} />
              <YAxis {...Y_PROPS} width={52} tickFormatter={fmtTokens} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={<RtkTooltip />} />
              <Bar dataKey="savedTokens" fill={GREEN} maxBarSize={24} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {commands.length > 0 && (
            <>
              <h4 className="card-section">Що саме підрізає найбільше</h4>
              <ul className="side-rank rtk-rank">
                {commands.map((c) => (
                  <li key={c.command}>
                    <span className="side-rank-head">
                      <span className="side-rank-name">{c.command}</span>
                      <span className="side-rank-nums">
                        {fmtTokens(c.savedTokens)} · {fmtInt(c.count)}{' '}
                        {plural(c.count, 'виклик', 'виклики', 'викликів')}
                      </span>
                    </span>
                    <span className="side-rank-track">
                      <span
                        className="side-rank-fill"
                        style={{ width: `${maxSaved > 0 ? Math.max(2, (c.savedTokens / maxSaved) * 100) : 2}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted-text">
                Лічильники команд — за весь час роботи RTK, не лише за вибраний період.
              </p>
            </>
          )}

          <p className="muted-text">{RTK_FLOOR_NOTE}</p>
        </>
      )}
    </Card>
  );
}
