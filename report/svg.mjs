// Ручні inline-SVG-графіки для PDF-звітів spend-lens. Жодних бібліотек,
// жодних анімацій — статичні, друк-готові SVG з явними width/height + viewBox.
// Палітра — iOS light з CONTRACT.md: серії blue, teal, orange, purple, green, gray;
// сітка #E5E5EA (лише горизонтальна), текст #1C1C1E, вторинний #8E8E93.

export const SERIES_COLORS = ['#007AFF', '#32ADE6', '#FF9500', '#AF52DE', '#34C759', '#8E8E93'];
export const GRID = '#E5E5EA';
export const TEXT = '#1C1C1E';
export const MUTED = '#8E8E93';

const FONT_STACK = "-apple-system,'SF Pro Text','Segoe UI Variable','Segoe UI',Inter,sans-serif";

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s, n) {
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function r2(x) {
  return Math.round(x * 100) / 100;
}

/** «Гарний» максимум осі: 1/2/2.5/5 × 10^k. */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const m = v / base;
  let n;
  if (m <= 1) n = 1;
  else if (m <= 2) n = 2;
  else if (m <= 2.5) n = 2.5;
  else if (m <= 5) n = 5;
  else n = 10;
  return n * base;
}

function svgOpen(width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" style="font-family:${FONT_STACK}">`;
}

/** Прямокутник із заокругленням тільки згори (для верхнього сегмента стека). */
function roundedTopRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  if (rr <= 0.2) return `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}"/>`;
  return `<path d="M ${r2(x)} ${r2(y + h)} L ${r2(x)} ${r2(y + rr)} Q ${r2(x)} ${r2(y)} ${r2(x + rr)} ${r2(y)} ` +
    `L ${r2(x + w - rr)} ${r2(y)} Q ${r2(x + w)} ${r2(y)} ${r2(x + w)} ${r2(y + rr)} L ${r2(x + w)} ${r2(y + h)} Z"/>`;
}

/**
 * Горизонтальний барчарт (Pareto).
 * items: [{ label, value, color? }] — value у USD (або будь-що, valueFmt форматує).
 */
export function hBar({ items, width = 640, barH = 16, gap = 8, valueFmt = String, maxLabelChars = 38 }) {
  if (!items.length) return '';
  const labels = items.map((i) => truncate(i.label, maxLabelChars));
  const maxChars = labels.reduce((a, s) => Math.max(a, s.length), 0);
  const labelW = Math.min(230, 16 + maxChars * 5.6);
  const valTexts = items.map((i) => valueFmt(i.value));
  const valW = valTexts.reduce((a, s) => Math.max(a, s.length), 0) * 6 + 10;
  const barMax = Math.max(30, width - labelW - valW - 12);
  const max = items.reduce((a, i) => Math.max(a, i.value), 0);
  const height = items.length * (barH + gap) - gap + 8;

  let out = svgOpen(width, height);
  items.forEach((it, i) => {
    const y = 4 + i * (barH + gap);
    const w = max > 0 && it.value > 0 ? Math.max(2, (it.value / max) * barMax) : 0;
    const color = it.color || SERIES_COLORS[0];
    out += `<text x="${r2(labelW - 8)}" y="${r2(y + barH / 2 + 3.5)}" text-anchor="end" font-size="9.5" fill="${TEXT}">${esc(labels[i])}</text>`;
    if (w > 0) out += `<rect x="${r2(labelW)}" y="${y}" width="${r2(w)}" height="${barH}" rx="4" fill="${color}"/>`;
    out += `<text x="${r2(labelW + w + 6)}" y="${r2(y + barH / 2 + 3.5)}" font-size="9.5" fill="${MUTED}">${esc(valTexts[i])}</text>`;
  });
  return out + '</svg>';
}

/**
 * Стековані вертикальні бари (щоденні/щомісячні витрати за моделями).
 * rows:   [{ label, values: { [seriesKey]: number } }]
 * series: [{ key, label, color }] — порядок стека знизу догори.
 */
export function stackedBars({ rows, series, width = 640, chartH = 150, yFmt = String, labelEvery = 1 }) {
  if (!rows.length || !series.length) return '';
  const padL = 46;
  const padR = 4;
  const padT = 8;
  const labelH = 15;

  // Легенда: розкладка в рядки по ширині
  const innerW = width - padL - padR;
  const legendItems = series.map((s) => ({ ...s, w: 12 + s.label.length * 5.4 + 16 }));
  const legendRows = [[]];
  let rowW = 0;
  for (const li of legendItems) {
    if (rowW + li.w > innerW && legendRows[legendRows.length - 1].length) {
      legendRows.push([]);
      rowW = 0;
    }
    legendRows[legendRows.length - 1].push(li);
    rowW += li.w;
  }
  const legendH = legendRows.length * 15 + 4;
  const height = padT + chartH + labelH + legendH;

  const totals = rows.map((r) => series.reduce((a, s) => a + (r.values[s.key] || 0), 0));
  const max = niceMax(totals.reduce((a, v) => Math.max(a, v), 0));

  let out = svgOpen(width, height);

  // Горизонтальна сітка + підписи осі Y (4 поділки), вертикальної сітки немає
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = (max / ticks) * t;
    const y = r2(padT + chartH - (v / max) * chartH);
    // Нульова поділка — компактно («$0», не «$0,00»): правило компактних осей з контракту
    const tickText = v === 0 ? yFmt(v).replace(/,0+(?!\d)/, '') : yFmt(v);
    out += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
    out += `<text x="${padL - 6}" y="${r2(y + 3)}" text-anchor="end" font-size="8.5" fill="${MUTED}">${esc(tickText)}</text>`;
  }

  // Бари
  const n = rows.length;
  const slot = innerW / n;
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  rows.forEach((row, i) => {
    const x = padL + i * slot + (slot - barW) / 2;
    // верхній ненульовий сегмент — для заокруглення
    let topIdx = -1;
    for (let si = series.length - 1; si >= 0; si--) {
      if ((row.values[series[si].key] || 0) > 0) { topIdx = si; break; }
    }
    let acc = 0;
    series.forEach((s, si) => {
      const v = row.values[s.key] || 0;
      if (v <= 0) return;
      const h = (v / max) * chartH;
      const y = padT + chartH - ((acc + v) / max) * chartH;
      if (si === topIdx) {
        out += `<g fill="${s.color}">${roundedTopRect(x, y, barW, h, 3)}</g>`;
      } else {
        out += `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(barW)}" height="${r2(h)}" fill="${s.color}"/>`;
      }
      acc += v;
    });
    // Підпис X
    if (i % labelEvery === 0) {
      out += `<text x="${r2(x + barW / 2)}" y="${r2(padT + chartH + 11)}" text-anchor="middle" font-size="8.5" fill="${MUTED}">${esc(row.label)}</text>`;
    }
  });

  // Легенда
  let ly = padT + chartH + labelH + 8;
  for (const lrow of legendRows) {
    let lx = padL;
    for (const li of lrow) {
      out += `<circle cx="${r2(lx + 4)}" cy="${r2(ly)}" r="3.5" fill="${li.color}"/>`;
      out += `<text x="${r2(lx + 12)}" y="${r2(ly + 3)}" font-size="9" fill="${TEXT}">${esc(li.label)}</text>`;
      lx += li.w;
    }
    ly += 15;
  }

  return out + '</svg>';
}

/**
 * Донат (розподіл вартості за моделями) з легендою праворуч.
 * items: [{ label, value, color }]
 */
export function donut({ items, width = 640, size = 150, thickness = 26, valueFmt = String, centerLabel = '' }) {
  const data = items.filter((i) => i.value > 0);
  if (!data.length) return '';
  const total = data.reduce((a, i) => a + i.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const rOut = size / 2 - 2;
  const rIn = rOut - thickness;
  const legendRowH = 16;
  const height = Math.max(size, 10 + data.length * legendRowH);

  let out = svgOpen(width, height);
  let a0 = -Math.PI / 2;
  for (const it of data) {
    const frac = it.value / total;
    let a1 = a0 + frac * 2 * Math.PI;
    if (frac > 0.9999) a1 -= 0.0002; // повне коло — інакше дуга вироджується
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => [r2(cx + r * Math.cos(a)), r2(cy + r * Math.sin(a))];
    const [x0, y0] = p(rOut, a0);
    const [x1, y1] = p(rOut, a1);
    const [x2, y2] = p(rIn, a1);
    const [x3, y3] = p(rIn, a0);
    out += `<path d="M ${x0} ${y0} A ${r2(rOut)} ${r2(rOut)} 0 ${large} 1 ${x1} ${y1} ` +
      `L ${x2} ${y2} A ${r2(rIn)} ${r2(rIn)} 0 ${large} 0 ${x3} ${y3} Z" fill="${it.color}"/>`;
    a0 = a0 + frac * 2 * Math.PI;
  }

  // Центр: підпис + сума
  if (centerLabel) {
    out += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="8.5" fill="${MUTED}">${esc(centerLabel)}</text>`;
    out += `<text x="${cx}" y="${cy + 9}" text-anchor="middle" font-size="12" font-weight="700" fill="${TEXT}">${esc(valueFmt(total))}</text>`;
  } else {
    out += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="${TEXT}">${esc(valueFmt(total))}</text>`;
  }

  // Легенда праворуч: точка, назва, значення (частка %)
  const lx = size + 18;
  data.forEach((it, i) => {
    const y = 12 + i * legendRowH;
    const pct = Math.round((it.value / total) * 100);
    out += `<circle cx="${lx + 4}" cy="${y}" r="3.5" fill="${it.color}"/>`;
    out += `<text x="${lx + 13}" y="${y + 3}" font-size="9.5" fill="${TEXT}">${esc(truncate(it.label, 28))}</text>`;
    out += `<text x="${lx + 13 + 160}" y="${y + 3}" font-size="9.5" fill="${MUTED}">${esc(valueFmt(it.value))} · ${pct} %</text>`;
  });

  return out + '</svg>';
}
