// Дрібні UI-примітиви: картка, чіп-прапорець, кнопка копіювання,
// сегментований перемикач, порожній стан.

import React, { useState } from 'react';
import { FLAG_META } from '../lib/rules.js';
import { withAnomalyFlag } from '../lib/anomalies.js';
import { withLowReturnFlag } from '../lib/efficiency.js';
import { fmtUsd } from '../lib/format.js';

/** FLAG_META + ANOMALY (v1.6, дні) + LOW_RETURN (v1.8, сесії):
 *  rules.js лишається недоторканим. */
export const FLAG_META_ALL = withLowReturnFlag(withAnomalyFlag(FLAG_META));

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

/**
 * Короткі назви прапорців — ЛИШЕ для колонки «Прапорці» в таблиці «Сесій»
 * (v1.8). Повні назви ширші за колонку 16 %, тож чіпи ставали в стовпчик і
 * рядок виростав до ~162px. Коротка назва вміщує два чіпи в ряд; повна
 * лишається в `title`, у дровері й у картках на телефоні — нічого не зникає.
 */
export const FLAG_SHORT = {
  CACHE_MISS: 'Кеш-промах',
  FAT_CONTEXT: 'Контекст',
  PREMIUM_MODEL: 'Модель',
  LONG_SESSION: 'Довга сесія',
  SUBAGENT_HEAVY: 'Субагент',
  TOP_BURNER: 'Топ витрат',
  ANOMALY: 'Аномалія',
  LOW_RETURN: 'Віддача',
};

/** Пастельний чіп прапорця (iOS-бейдж). `short` — компактний варіант. */
export function FlagChip({ type, wasteUsd = null, short = false }) {
  const meta = FLAG_META_ALL[type] || { label: type };
  const label = short ? (FLAG_SHORT[type] || meta.label) : meta.label;
  return (
    <span className={`chip chip-${type}`} title={short ? meta.label : undefined}>
      {label}
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

/**
 * Кнопка «Оновити» (v1.11). Перечитує дані БЕЗ перезавантаження сторінки:
 * фільтри, вкладка й прокрутка лишаються на місці. `stale` — підсвітка, коли
 * дані старші за поріг: інакше кнопку не помічають і дивляться на вчорашні цифри.
 */
export function RefreshButton({ busy, stale, onClick, title }) {
  return (
    <button
      type="button"
      className={`toolbar-btn refresh-btn${busy ? ' busy' : ''}${stale ? ' stale' : ''}`}
      onClick={onClick}
      disabled={busy}
      title={title || 'Перечитати дані'}
      aria-label="Оновити дані"
    >
      <span className="refresh-icon" aria-hidden="true">⟳</span>
      {busy ? 'Оновлюю…' : 'Оновити'}
    </button>
  );
}
