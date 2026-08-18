// Спільні шматки для графіків Recharts: палітра серій (iOS-акценти, порядок
// з CONTRACT.md), прив’язка кольорів до моделей, тултіп-картка, пропси осей.

import React from 'react';
import { fmtUsd, shortModel } from '../lib/format.js';

// Порядок серій: blue, teal, orange, purple, green, gray (binding).
export const SERIES = ['#007AFF', '#32ADE6', '#FF9500', '#AF52DE', '#34C759', '#8E8E93'];

// Колір іде за сутністю (моделлю), не за рангом: відомі сім’ї закріплені,
// решта отримує вільні слоти у фіксованому порядку серій.
const PINNED = [
  [/fable|opus/i, '#007AFF'],   // blue
  [/sonnet/i, '#32ADE6'],       // teal
  [/haiku/i, '#FF9500'],        // orange
];

export function buildModelColors(models) {
  const map = new Map();
  const used = new Set();
  for (const m of models) {
    const pin = PINNED.find(([re]) => re.test(m));
    if (pin && !used.has(pin[1])) { map.set(m, pin[1]); used.add(pin[1]); }
  }
  const free = SERIES.filter((c) => !used.has(c));
  let i = 0;
  for (const m of models) {
    if (!map.has(m)) map.set(m, free[i % free.length] || '#8E8E93'), i++;
  }
  return map;
}

/** Ширина YAxis горизонтального бару за найдовшим лейблом — без обрізань.
 *  Апроксимація: 12px відступ + ~7.2px на символ, стеля 280px (CONTRACT v1.1). */
export function yAxisWidth(labels) {
  let max = 0;
  for (const s of labels || []) max = Math.max(max, String(s ?? '').length);
  return Math.min(280, Math.round(12 + max * 7.2));
}

// Пропси «тихих» осей і сітки (світлі суцільні лінії, без вертикальної сітки).
export const GRID = { vertical: false, stroke: '#E5E5EA', strokeWidth: 1 };
export const AXIS_TICK = { fontSize: 11, fill: '#8E8E93' };
export const X_PROPS = { tickLine: false, axisLine: false, tick: AXIS_TICK, tickMargin: 6 };
export const Y_PROPS = { tickLine: false, axisLine: false, tick: AXIS_TICK, width: 44 };

/** Білий тултіп-картка. valueFormatter(value, name) → рядок. */
export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter, nameFormatter }) {
  if (!active || !payload || !payload.length) return null;
  const fmtV = valueFormatter || ((v) => fmtUsd(v));
  const fmtN = nameFormatter || ((n) => shortModel(n));
  return (
    <div className="chart-tooltip">
      {label != null && (
        <div className="chart-tooltip-label">{labelFormatter ? labelFormatter(label) : label}</div>
      )}
      {payload.filter((p) => p.value !== 0 || payload.length === 1).map((p) => (
        <div className="chart-tooltip-row" key={p.dataKey || p.name}>
          <span className="dot" style={{ background: p.color || p.fill }} />
          <span className="chart-tooltip-name">{fmtN(p.name)}</span>
          <span className="chart-tooltip-value">{fmtV(p.value, p.name)}</span>
        </div>
      ))}
    </div>
  );
}

/** Легенда-рядок під графіком: кольорова крапка + назва. */
export function LegendRow({ items }) {
  return (
    <div className="legend-row">
      {items.map((it) => (
        <span className="legend-item" key={it.label}>
          <span className="dot" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
