// Дрібні UI-примітиви: картка, чіп-прапорець, кнопка копіювання,
// сегментований перемикач, порожній стан.

import React, { useState } from 'react';
import { FLAG_META } from '../lib/rules.js';
import { fmtUsd } from '../lib/format.js';

export function Card({ title, subtitle, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {title && <h3 className="card-title">{title}</h3>}
      {subtitle && <p className="card-subtitle">{subtitle}</p>}
      {children}
    </section>
  );
}

/** Пастельний чіп прапорця (iOS-бейдж). */
export function FlagChip({ type, wasteUsd = null }) {
  const meta = FLAG_META[type] || { label: type };
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

/** iOS-сегментований перемикач. options: [{value,label}] */
export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}
