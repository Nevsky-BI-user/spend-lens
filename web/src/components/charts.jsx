// Спільні шматки для графіків Recharts: палітра серій (iOS-акценти, порядок
// з CONTRACT.md), прив’язка кольорів до моделей, тултіп-картка, пропси осей,
// адаптивні хуки v1.4 (медіазапити, ширина контейнера, y-вісь h-бару на телефоні).

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmtUsd, shortModel } from '../lib/format.js';

// Порядок серій: blue, teal, orange, purple, green, gray (binding, CONTRACT.md).
// Далі — запасні відтінки (indigo, yellow) для 7-8 моделей в одному періоді:
// без них buildModelColors зациклюється і дві моделі отримують однаковий колір.
export const SERIES = ['#007AFF', '#32ADE6', '#FF9500', '#AF52DE', '#34C759', '#8E8E93', '#5856D6', '#FFCC00'];

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

/* ===================================================================== v1.4 —
   адаптивні хуки. ЛИШЕ для екранного режиму: PrintReport цих хуків не імпортує,
   тож друкований пайплайн (фіксовані 766px) не зачеплено. */

export const PHONE_MEDIA = '(max-width: 640px)';
export const TABLET_MEDIA = '(max-width: 768px)';

/** true, коли вʼюпорт відповідає CSS-медіазапиту (стежить за змінами). */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** [ref, width]: жива ширина елемента через ResizeObserver (0 до першого виміру). */
export function useMeasuredWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || 0;
      setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** h(base): на ≤768px висоти графіків стискаються ~15% (CONTRACT v1.4). */
export function useChartHeight() {
  const compact = useMediaQuery(TABLET_MEDIA);
  return useCallback((base) => (compact ? Math.round(base * 0.85) : base), [compact]);
}

// Метрика переносу лейблів y-осі на телефоні (шрифт 11px, кирилиця ~6.2px/симв).
const TICK_FONT_PHONE = 11;
const TICK_CHAR_W = 6.2;
const TICK_LINE_H = 13;

/** Перенос назви на рядки ≤maxChars: по словах; надто довге слово — жорсткий
 *  розріз. Нічого не обрізається — рядків стільки, скільки треба. */
export function wrapLabel(text, maxChars) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let w of words) {
    while (w.length > maxChars) {
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!w) continue;
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** Кастомний багаторядковий тік y-осі (телефон): назва повністю, без обрізань.
 *  Recharts клонує елемент із x/y/payload; рядки центруються по вертикалі. */
export function MultilineTick({ x, y, payload, maxChars }) {
  const lines = wrapLabel(payload?.value, maxChars);
  const y0 = y - ((lines.length - 1) * TICK_LINE_H) / 2;
  return (
    <text x={x} y={y0} textAnchor="end" fontSize={TICK_FONT_PHONE} fill="#1C1C1E">
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 4 : TICK_LINE_H}>{line}</tspan>
      ))}
    </text>
  );
}

/**
 * Параметри y-осі горизонтального бару (CONTRACT v1.4):
 * телефон — ширина осі ≤ ~45% контейнера + багаторядковий тік (читабельно на
 * 375px без обрізань); ширше — формула v1.1 за найдовшим лейблом.
 * Повертає { ref, yWidth, tick, rowHeight }; ref — на обгортку графіка.
 */
export function useHBarAxis(labels, isPhone, baseRowHeight = 40) {
  const [ref, width] = useMeasuredWidth();
  if (!isPhone) {
    return {
      ref,
      yWidth: yAxisWidth(labels),
      tick: { fontSize: 12, fill: '#1C1C1E' },
      rowHeight: baseRowHeight,
    };
  }
  const containerW = width || 300; // до першого виміру — безпечний дефолт
  const yWidth = Math.min(yAxisWidth(labels), Math.max(96, Math.floor(containerW * 0.45)));
  const maxChars = Math.max(6, Math.floor((yWidth - 8) / TICK_CHAR_W));
  let maxLines = 1;
  for (const l of labels || []) {
    maxLines = Math.max(maxLines, wrapLabel(l, maxChars).length);
  }
  return {
    ref,
    yWidth,
    tick: <MultilineTick maxChars={maxChars} />,
    rowHeight: Math.max(baseRowHeight, maxLines * TICK_LINE_H + 14),
  };
}
