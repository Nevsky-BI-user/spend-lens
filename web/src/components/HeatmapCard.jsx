// Картка «Коли горять гроші» (CONTRACT v1.6, пункт 5): теплокарта
// день тижня × година доби за часом ПОЧАТКУ сесії в Europe/Kyiv.
//
// Малюємо CSS-гріднею, а не Recharts: 168 клітинок — це таблиця, і їй
// потрібні липкі підписи та горизонтальний скрол ВСЕРЕДИНІ картки на телефоні
// (page-level скрол заборонено, CONTRACT v1.4).

import React, { useMemo } from 'react';
import { heatmapWeekdayHour, plural } from '../lib/analytics.js';
import { fmtUsd, fmtUsdCompact } from '../lib/format.js';
import { Card, EmptyState } from './ui.jsx';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Один тон (iOS blue) прозорістю: білий → #007AFF.
 * Показник 0.7 підтягує середні клітинки — при чисто лінійній шкалі один
 * сплеск робить решту карти невидимою, і читати її стає нічого.
 */
function alphaFor(value, max) {
  if (!(value > 0) || !(max > 0)) return 0;
  return 0.10 + 0.90 * Math.pow(value / max, 0.7);
}

export default function HeatmapCard({ sessions, timeZone = 'Europe/Kyiv' }) {
  const hm = useMemo(() => heatmapWeekdayHour(sessions, timeZone), [sessions, timeZone]);

  const subtitle = hm.peak && hm.peak.costUsd > 0
    ? `Пік: ${hm.weekdaysFull[hm.peak.weekday]}, ${hm.peak.hour}:00 — ${fmtUsd(hm.peak.costUsd)}`
    : 'Вартість сесій за днем тижня і годиною початку';

  return (
    <Card title="Коли горять гроші" subtitle={subtitle} className="heatmap-card">
      {hm.total <= 0 ? (
        <EmptyState text="За вибраний зріз сесій немає." />
      ) : (
        <>
          <div className="heatmap-scroll">
            <div
              className="heatmap"
              role="img"
              aria-label={`Теплокарта витрат: ${hm.weekdaysFull[hm.peak.weekday]}, ${hm.peak.hour}:00 — найдорожча година`}
            >
              <div className="heatmap-corner" />
              {HOURS.map((h) => (
                <div className="heatmap-hour" key={`h${h}`}>{h % 3 === 0 ? h : ''}</div>
              ))}
              {hm.weekdays.map((wd, w) => (
                <React.Fragment key={wd}>
                  <div className="heatmap-wd">{wd}</div>
                  {HOURS.map((h) => {
                    const v = hm.matrix[w][h];
                    const n = hm.counts[w][h];
                    return (
                      <div
                        className={`heatmap-cell${v > 0 ? '' : ' zero'}`}
                        key={`${w}-${h}`}
                        style={{ background: v > 0 ? `rgba(0, 122, 255, ${alphaFor(v, hm.max).toFixed(3)})` : undefined }}
                        title={`${hm.weekdaysFull[w]}, ${h}:00 — ${fmtUsd(v)}, ${n} ${plural(n, 'сесія', 'сесії', 'сесій')}`}
                      />
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="heatmap-legend">
            <span className="heatmap-legend-label">{fmtUsdCompact(0)}</span>
            <span className="heatmap-ramp" aria-hidden="true" />
            <span className="heatmap-legend-label">{fmtUsdCompact(hm.max)}</span>
            <span className="heatmap-legend-note">за годину</span>
          </div>

          <p className="muted-text">
            Вартість віднесено до години початку сесії · часовий пояс {hm.timeZone} ·{' '}
            {hm.sessions} {plural(hm.sessions, 'сесія', 'сесії', 'сесій')}
            {hm.skipped > 0 && ` (${hm.skipped} без часу початку — пропущено)`}
          </p>
        </>
      )}
    </Card>
  );
}
