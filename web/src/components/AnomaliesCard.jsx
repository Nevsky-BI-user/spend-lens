// Картка «Аномалії» на «Огляді» (CONTRACT v1.6, пункт 3).
// Показує топ-5 підозрілих точок — і дні, і сесії — з поясненням «чому».
//
// Детекція (anomalies.js) рахується на ПОВНІЙ історії проєкту: ковзне вікно
// 30 днів і медіана сесій проєкту вимагають бази для порівняння. Тут список
// звужується до поточного зрізу, щоб картка описувала те, що видно на графіку.

import React, { useMemo } from 'react';
import { fmtUsd, fmtDayShort, fmtDateTime } from '../lib/format.js';
import { plural } from '../lib/analytics.js';
import { Card, EmptyState } from './ui.jsx';

const TOP_N = 5;
const KYIV = 'Europe/Kyiv';

/** ISO → день 'YYYY-MM-DD' у поясі снапшота (для дрил-дауну із сесії). */
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

/**
 * @param {{anomalies:object, days:Array, sessions:Array, timeZone?:string,
 *          onSelectDay?:function}} props
 *  anomalies — результат detectAnomalies() на історії (не на зрізі);
 *  days/sessions — ВИДИМИЙ зріз (для звуження списку).
 */
export default function AnomaliesCard({
  anomalies, days = [], sessions = [], timeZone = KYIV, onSelectDay,
}) {
  const rows = useMemo(() => {
    if (!anomalies) return [];
    const toDay = isoDayFormatter(timeZone);
    const visibleDays = new Set((days || []).map((d) => d.day));
    const visibleSessions = new Set((sessions || []).map((s) => s.sessionId));

    const dayRows = (anomalies.days?.anomalies || [])
      .filter((a) => visibleDays.has(a.day))
      .map((a) => ({
        key: `day:${a.day}`,
        kind: 'day',
        kindLabel: 'день',
        title: fmtDayShort(a.day),
        sub: null,
        costUsd: a.costUsd,
        why: a.evidence,
        day: a.day,
      }));

    const sessionRows = (anomalies.sessions?.list || [])
      .filter((a) => visibleSessions.has(a.sessionId))
      .map((a) => ({
        key: `session:${a.sessionId}`,
        kind: 'session',
        kindLabel: 'сесія',
        title: a.title,
        sub: `${a.project}${a.startedAt ? ` · ${fmtDateTime(a.startedAt)}` : ''}`,
        costUsd: a.costUsd,
        why: a.evidence,
        day: a.startedAt ? toDay(a.startedAt) : null,
      }));

    return [...dayRows, ...sessionRows]
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, TOP_N);
  }, [anomalies, days, sessions, timeZone]);

  const total = (anomalies?.days?.anomalies?.length || 0) + (anomalies?.sessions?.list?.length || 0);
  const thin = anomalies
    ? (anomalies.days?.points || 0) < (anomalies.days?.minPoints || 8)
    : false;

  const subtitle = thin
    ? 'Замало даних для порівняння — детекція вмикається від 8 днів історії'
    : rows.length > 0
      ? `Витрати, що різко вибиваються з типових: ${rows.length} ${plural(rows.length, 'точка', 'точки', 'точок')} у цьому зрізі`
      : 'Витрати, що різко вибиваються з типових';

  return (
    <Card title="Аномалії" subtitle={subtitle} className="anomalies-card">
      {rows.length === 0 ? (
        <EmptyState text="Аномалій не виявлено." />
      ) : (
        <ul className="anomaly-list">
          {rows.map((r) => {
            const clickable = Boolean(onSelectDay && r.day);
            const Inner = (
              <>
                <span className="anomaly-head">
                  <span className={`anomaly-kind ${r.kind}`}>{r.kindLabel}</span>
                  <span className="anomaly-title">{r.title}</span>
                  <span className="anomaly-cost">{fmtUsd(r.costUsd)}</span>
                </span>
                {r.sub && <span className="anomaly-sub">{r.sub}</span>}
                <span className="anomaly-why">{r.why}</span>
              </>
            );
            return (
              <li key={r.key}>
                {clickable ? (
                  <button
                    type="button"
                    className="anomaly-row"
                    title={`Показати сесії за ${fmtDayShort(r.day)}`}
                    onClick={() => onSelectDay(r.day)}
                  >
                    {Inner}
                  </button>
                ) : (
                  <div className="anomaly-row static">{Inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {total > rows.length && (
        <p className="muted-text">
          Усього в історії проєкту: {total} {plural(total, 'аномалія', 'аномалії', 'аномалій')}.
        </p>
      )}
    </Card>
  );
}
