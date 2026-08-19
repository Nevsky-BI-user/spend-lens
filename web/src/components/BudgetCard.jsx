// Картка «Бюджет місяця» (CONTRACT v1.6, пункт 2).
// Один компонент для дашборда і для друку: `editable={false}` прибирає
// редагування (у PDF кнопки мертві), решта — той самий вигляд і ті самі числа.
//
// Стан рахує чиста budgetStatus() з analytics.js:
//   barState (колір смуги) — суто за фактом витрат (зелений <80 %, оранж 80–100 %, червоний >100 %);
//   state    (вердикт-чіп) — за ПРОГНОЗОМ, у цьому й суть раннього попередження.

import React, { useEffect, useState } from 'react';
import { budgetStatus } from '../lib/analytics.js';
import { fmtUsd, fmtPct, monthName } from '../lib/format.js';
import { Card } from './ui.jsx';

const VERDICT = {
  ok: { label: 'у межах бюджету', cls: 'ok' },
  edge: { label: 'на межі', cls: 'edge' },
  over: { label: 'перевищення', cls: 'over' },
};

/*
 * Чіп-вердикт стоїть впритул до рядка ФАКТУ («Витрачено $X з $Y»), тож і сума
 * в ньому має бути з тієї самої бази. st.overUsd рахується від basis =
 * max(факт, прогноз) — при бюджеті $300 і витратах $328,05 чіп писав
 * «перевищення на $336,11» (це прогноз), хоча фактично перебір $28,06.
 * Правило: є фактичний перебір — показуємо його; сам лише прогноз —
 * явно позначаємо словом «прогноз».
 */
function verdictText(st) {
  const v = VERDICT[st.state] || VERDICT.ok;
  if (st.state !== 'over') return v.label;
  const factOver = Math.max(0, st.spentUsd - st.budgetUsd);
  return factOver > 0
    ? `${v.label} на ${fmtUsd(factOver)}`
    : `прогноз: ${v.label} на ${fmtUsd(st.overUsd)}`;
}

/** Інлайн-редактор суми: число в USD, порожнє поле = вимкнути бюджет. */
function BudgetEditor({ value, onSave, onCancel }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);

  const submit = (e) => {
    e.preventDefault();
    const raw = draft.trim().replace(',', '.');
    if (raw === '') { onSave(null); return; }
    const n = Number(raw);
    onSave(Number.isFinite(n) && n > 0 ? n : null);
  };

  return (
    <form className="budget-editor" onSubmit={submit}>
      <label className="budget-editor-label" htmlFor="budget-input">Місячний бюджет, $</label>
      <div className="budget-editor-row">
        <input
          id="budget-input"
          className="budget-input"
          type="number"
          min="0"
          step="1"
          inputMode="decimal"
          placeholder="напр. 300"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <button type="submit" className="btn-primary btn-compact">Зберегти</button>
        <button type="button" className="btn-secondary btn-compact" onClick={onCancel}>Скасувати</button>
      </div>
      <p className="muted-text">Порожнє поле вимикає бюджет. Значення зберігається в цьому браузері й у посиланні.</p>
    </form>
  );
}

/**
 * @param {{budgetUsd:number|null, monthCost:number, forecastTotal:number|null,
 *          month:string, onChange?:function, editable?:boolean}} props
 *  month — 'YYYY-MM' (для заголовка); onChange(null) вимикає бюджет.
 */
export default function BudgetCard({
  budgetUsd = null,
  monthCost = 0,
  forecastTotal = null,
  month = '',
  onChange = null,
  editable = true,
}) {
  const [editing, setEditing] = useState(false);
  const st = budgetStatus({ monthCost, forecastTotal, budgetUsd });

  const save = (v) => {
    setEditing(false);
    if (onChange) onChange(v);
  };

  // Бюджет не задано: картки немає взагалі — лише тихе посилання (CONTRACT §2).
  if (!st) {
    if (!editable) return null;
    if (!editing) {
      return (
        <div className="budget-hint">
          <button type="button" className="link-btn" onClick={() => setEditing(true)}>
            Задати бюджет
          </button>
          <span className="muted-text"> — і дашборд попереджатиме про перевитрату заздалегідь.</span>
        </div>
      );
    }
    return (
      <Card title="Бюджет місяця" className="budget-card">
        <BudgetEditor value={null} onSave={save} onCancel={() => setEditing(false)} />
      </Card>
    );
  }

  const label = monthName(month);
  const pctShown = Math.min(100, Math.max(0, st.pct));

  return (
    <Card
      title={label ? `Бюджет місяця — ${label}` : 'Бюджет місяця'}
      className="budget-card"
      actions={editable && !editing ? (
        <button type="button" className="link-btn" onClick={() => setEditing(true)}>Змінити</button>
      ) : null}
    >
      {editing ? (
        <BudgetEditor value={st.budgetUsd} onSave={save} onCancel={() => setEditing(false)} />
      ) : (
        <>
          <div className="budget-top">
            <span className="budget-spent">
              Витрачено {fmtUsd(st.spentUsd)} з {fmtUsd(st.budgetUsd)}
              <span className="budget-pct"> ({fmtPct(st.pct)})</span>
            </span>
            <span className={`budget-verdict ${VERDICT[st.state].cls}`}>{verdictText(st)}</span>
          </div>

          <div
            className="budget-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(st.pct)}
            aria-label={`Виконання бюджету: ${fmtPct(st.pct)}`}
          >
            <span className={`budget-fill ${st.barState}`} style={{ width: `${pctShown}%` }} />
          </div>

          {/* Друге речення — окреме, бо його база інша: залишок рахується від
              ФАКТУ (бюджет − витрачено), а не від прогнозу. Через тире виходило
              «закриється на $636,11 — лишається $671,95», ніби залишок випливає
              з прогнозу (за прогнозом лишилося б $363,89). */}
          <p className="budget-forecast">
            {st.forecastTotal != null
              ? `За поточним темпом місяць закриється на ${fmtUsd(st.forecastTotal)}`
              : `Місяць закрито на ${fmtUsd(st.spentUsd)}`}
            {st.state === 'over'
              ? ` — це на ${fmtUsd(st.overUsd)} більше за бюджет.`
              : st.forecastTotal != null
                ? `. Наразі невитраченими лишаються ${fmtUsd(st.remainingUsd)}.`
                : `. Невитраченими лишилися ${fmtUsd(st.remainingUsd)}.`}
          </p>
        </>
      )}
    </Card>
  );
}
