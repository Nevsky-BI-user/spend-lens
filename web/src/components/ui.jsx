// Дрібні UI-примітиви: картка, чіп-прапорець, кнопка копіювання,
// сегментований перемикач, порожній стан.

import React, { useState } from 'react';
import { FLAG_META } from '../lib/rules.js';
import { withAnomalyFlag } from '../lib/anomalies.js';
import { fmtUsd } from '../lib/format.js';

/** FLAG_META + ANOMALY (v1.6): rules.js лишається недоторканим. */
export const FLAG_META_ALL = withAnomalyFlag(FLAG_META);

/**
 * Картка. `actions` (v1.5, необов’язковий) — керування праворуч від заголовка
 * (перемикач, посилання). Без нього DOM лишається таким самим, як до v1.5:
 * друкований шаблон покладається на селектор `.card-title + :not(.card-subtitle)`.
 */
export function Card({ title, subtitle, children, className = '', actions = null }) {
  const head = (
    <>
      {title && <h3 className="card-title">{title}</h3>}
      {subtitle && <p className="card-subtitle">{subtitle}</p>}
    </>
  );
  return (
    <section className={`card ${className}`}>
      {actions ? (
        <div className="card-head">
          <div className="card-head-text">{head}</div>
          <div className="card-actions">{actions}</div>
        </div>
      ) : head}
      {children}
    </section>
  );
}

/** Пастельний чіп прапорця (iOS-бейдж). */
export function FlagChip({ type, wasteUsd = null }) {
  const meta = FLAG_META_ALL[type] || { label: type };
  return (
    <span className={`chip chip-${type}`}>
      {meta.label}
      {wasteUsd != null && wasteUsd > 0 && <em>{fmtUsd(wasteUsd)}</em>}
    </span>
  );
}

/** Кнопка «Копіювати промпт» із підтвердженням. */
export function CopyButton({ text, label = 'Копіювати промпт' }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  };
  return (
    <button type="button" className={`copy-btn ${done ? 'done' : ''}`} onClick={copy}>
      {done ? 'Скопійовано' : label}
    </button>
  );
}

/** iOS-сегментований перемикач (фільтр, не таби — тому radiogroup).
 *  options: [{value,label}]; ariaLabel — назва групи для скрінрідера. */
export function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Дропдаун проєкту в стилі iOS: біла картка, радіус, синій шеврон.
 * projects — назви, відсортовані за вартістю ↓; value null = усі проєкти.
 */
export function ProjectSelect({ projects, value, onChange }) {
  return (
    <span className="project-select-wrap">
      <select
        className="project-select"
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="Фільтр за проєктом"
      >
        <option value="">Усі проєкти</option>
        {projects.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    </span>
  );
}

/**
 * Знімний чіп активного дня-дрилдауну в тулбарі (CONTRACT v1.6 §1).
 * Уся пігулка — одна кнопка «скинути»: ціль дотику ≥44px, як вимагає контракт,
 * і не треба ловити хрестик 12×12.
 */
export function DayChip({ label, onClear }) {
  return (
    <button
      type="button"
      className="day-chip"
      onClick={onClear}
      title="Скинути фільтр за днем"
      aria-label={`Активний фільтр за день: ${label}. Скинути`}
    >
      <span className="day-chip-label">{label}</span>
      <span className="day-chip-x" aria-hidden="true">✕</span>
    </button>
  );
}

/** Кнопка тулбара «Експорт XLSX» зі станом «Готуємо файл…» (CONTRACT v1.6 §7). */
export function ExportButton({ busy, onClick, error = null }) {
  return (
    <button
      type="button"
      className={`toolbar-btn${busy ? ' busy' : ''}`}
      onClick={onClick}
      disabled={busy}
      title={error || 'Вивантажити поточний зріз у XLSX'}
    >
      {busy ? 'Готуємо файл…' : 'Експорт XLSX'}
    </button>
  );
}

export function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}
