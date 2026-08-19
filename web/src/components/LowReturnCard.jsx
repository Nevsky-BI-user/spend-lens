// Картка «Слабка віддача» на «Огляді» (CONTRACT v1.8 §1-2; замінює v1.6
// «Аномалії»). Останній блок сторінки: спершу гроші й тренд, потім розбір.
//
// Головний список — сесії, де ОДИНИЦЯ роботи коштувала помітно дорожче за
// вашу медіану. Абсолютні суми між сесіями тут не порівнюються взагалі:
// дешева сесія могла не зробити нічого, і множник проти неї нічого не означає.
//
// Денна детекція (v1.6 §3) лишилась заради контролю бюджету й малює червоні
// крапки на графіку — тому дні присутні окремим блоком, теж із відносним
// доказом (ціна правки того дня проти ціни правки у звичайний день).
//
// Розрахунок (efficiency.js + anomalies.js) робиться на ПОВНІЙ історії
// проєкту — медіани ставок і ковзне вікно 30 днів вимагають бази. Тут список
// звужується до видимого зрізу, щоб картка описувала те, що є на екрані.

import React, { useMemo } from 'react';
import { fmtUsd, fmtDayShort, fmtDateTime } from '../lib/format.js';
import { plural } from '../lib/analytics.js';
import { DAY_RETURN_FOOTNOTE, hasNorm, baseMinPoints } from '../lib/efficiency.js';
import { Card, EmptyState } from './ui.jsx';

const TOP_N = 5;
const KYIV = 'Europe/Kyiv';

const SUBTITLE = 'Сесії, де кожна одиниця роботи коштувала помітно дорожче за вашу норму';

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

function ReturnList({ rows, onSelectDay }) {
  return (
    <ul className="anomaly-list">
      {rows.map((r) => {
        const clickable = Boolean(onSelectDay && r.day);
        const inner = (
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
                {inner}
              </button>
            ) : (
              <div className="anomaly-row static">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * @param {{returns:object, days:Array, sessions:Array, timeZone?:string,
 *          onSelectDay?:function}} props
 *  returns — результат analyzeReturn() + {days} з detectDayAnomalies()
 *            на історії (не на зрізі);
 *  days/sessions — ВИДИМИЙ зріз (для звуження списків).
 */
export default function LowReturnCard({
  returns, days = [], sessions = [], timeZone = KYIV, onSelectDay,
}) {
  const toDay = useMemo(() => isoDayFormatter(timeZone), [timeZone]);

  const sessionRows = useMemo(() => {
    if (!returns) return [];
    const visible = new Set((sessions || []).map((s) => s.sessionId));
    return (returns.list || [])
      .filter((a) => visible.has(a.sessionId))
      .slice(0, TOP_N)
      .map((a) => ({
        key: `session:${a.sessionId}`,
        kind: 'session',
        kindLabel: a.class,
        title: a.title,
        sub: `${a.project}${a.startedAt ? ` · ${fmtDateTime(a.startedAt)}` : ''}`,
        costUsd: a.costUsd,
        why: a.evidence,
        day: a.startedAt ? toDay(a.startedAt) : null,
      }));
  }, [returns, sessions, toDay]);

  const dayRows = useMemo(() => {
    if (!returns || !returns.days) return [];
    const visible = new Set((days || []).map((d) => d.day));
    return (returns.days.anomalies || [])
      .filter((a) => visible.has(a.day))
      .slice(0, TOP_N)
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
  }, [returns, days]);

  const totalLow = (returns && returns.list ? returns.list.length : 0);
  // Норма рахується В МЕЖАХ КЛАСУ, тож і захист ≥8 читаємо по класах:
  // `baselines.all.count` змішує «правки» з «аналізом» і показував «норма
  // ціла» там, де клас стояв на п'яти точках. Детекцію вимикає returnIndex —
  // тут лише пояснюємо користувачеві, чому список порожній.
  const base = returns ? returns.baselines : null;
  const need = baseMinPoints(base);
  const thin = returns ? !hasNorm(base) : false;

  const subtitle = thin
    ? `Замало даних для порівняння — норма рахується щонайменше з ${need} сесій одного класу`
    : SUBTITLE;

  const emptyText = thin
    ? `Норма ще не сформована: у жодному класі немає ${need} порівнянних сесій.`
    : 'Сесій зі слабкою віддачею у цьому зрізі немає.';

  return (
    <Card title="Слабка віддача" subtitle={subtitle} className="anomalies-card">
      {sessionRows.length === 0 ? (
        <EmptyState text={emptyText} />
      ) : (
        <ReturnList rows={sessionRows} onSelectDay={onSelectDay} />
      )}

      {totalLow > sessionRows.length && (
        <p className="muted-text">
          Усього в історії проєкту: {totalLow}{' '}
          {plural(totalLow, 'сесія', 'сесії', 'сесій')} зі слабкою віддачею.
        </p>
      )}

      {dayRows.length > 0 && (
        <>
          <h4 className="card-section">Дні з різким сплеском витрат</h4>
          <ReturnList rows={dayRows} onSelectDay={onSelectDay} />
          <p className="muted-text">{DAY_RETURN_FOOTNOTE}.</p>
        </>
      )}
    </Card>
  );
}
