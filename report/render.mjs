// HTML-шаблон PDF-звіту spend-lens: A4 portrait, iOS-light токени (друк: біле тло),
// уся розмітка і CSS — інлайн, без зовнішніх ресурсів. Копія — українською.

import { FLAG_META } from '../web/src/lib/rules.js';
import { fmtUsd, fmtTokens, fmtInt } from '../web/src/lib/format.js';

const NNBSP = ' ';

// Затемнені відтінки акцентів для тексту чипів (як iOS-бейджі: пастельне тло 12 %,
// текст — насичений темніший акцент)
const CHIP_TEXT = {
  '#FF9500': '#A35F00', // orange
  '#AF52DE': '#7A2FA3', // purple
  '#FF3B30': '#B3271F', // red
  '#5856D6': '#3B3A99', // indigo
  '#32ADE6': '#1F6F96', // teal
  '#8E8E93': '#5B5B60', // gray
};

const SEVERITY_COLORS = { high: '#FF3B30', medium: '#FF9500', low: '#FFCC00' };

/**
 * Модуль % зміни для дельт: ≥100 → ціле з групуванням тисяч («4 159 %»),
 * інакше 1 знак після коми («3,3 %»). NNBSP перед «%».
 * Єдина точка істини для KPI-дельт і тексту листа (report.mjs).
 */
export function fmtDeltaPct(pctAbs) {
  const v = Math.abs(Number(pctAbs) || 0);
  return (v >= 100 ? fmtInt(v) : v.toFixed(1).replace('.', ',')) + NNBSP + '%';
}

/**
 * Токени з групуванням тисяч у мільйонах: ≥1000M → «4 897M» (web-овий fmtTokens
 * дав би «4897,0M»). Менші значення — як у fmtTokens. Обгортка живе тут,
 * бо web/src/lib — чужа смуга (правиться паралельним workflow).
 */
export function fmtTokensG(x) {
  const v = Number(x) || 0;
  if (Math.abs(v) >= 1e9) return `${fmtInt(v / 1e6)}M`;
  return fmtTokens(v);
}

export function escHtml(s) {
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

/** Картка-секція звіту. */
export function card(title, innerHtml) {
  return `<section class="card"><h2>${escHtml(title)}</h2>${innerHtml}</section>`;
}

/** Попередження (порожній період тощо). */
export function warnBox(text) {
  return `<div class="warn">${escHtml(text)}</div>`;
}

/** Чип-прапорець сесії. */
export function chip(type) {
  const meta = FLAG_META[type];
  if (!meta) return '';
  const text = CHIP_TEXT[meta.color] || '#5B5B60';
  return `<span class="chip" style="background:${meta.color}1F;color:${text}">${escHtml(meta.label)}</span>`;
}

/**
 * Рядок KPI-карток.
 * kpis: [{ label, value, delta?: { pct, name }, sub? }]
 *  delta.pct — % зміни (додатний = витрати зросли = червоний; відʼємний = зелений)
 */
export function kpiRow(kpis) {
  const cols = kpis.length > 6 ? 4 : 3;
  const cells = kpis.map((k) => {
    let extra = '';
    if (k.delta && k.delta.pct !== null && k.delta.pct !== undefined && isFinite(k.delta.pct)) {
      const up = k.delta.pct >= 0;
      const cls = up ? 'delta-up' : 'delta-down';
      const arrow = up ? '▲' : '▼';
      const pctText = fmtDeltaPct(k.delta.pct);
      extra = `<div class="kpi-delta ${cls}">${arrow} ${up ? '+' : '−'}${pctText} проти ${escHtml(k.delta.name)}</div>`;
    } else if (k.delta) {
      extra = `<div class="kpi-sub">немає бази для порівняння</div>`;
    } else if (k.sub) {
      extra = `<div class="kpi-sub">${escHtml(k.sub)}</div>`;
    }
    return `<div class="kpi"><div class="kpi-label">${escHtml(k.label)}</div>` +
      `<div class="kpi-value">${escHtml(k.value)}</div>${extra}</div>`;
  });
  return `<div class="kpis cols-${cols}">${cells.join('')}</div>`;
}

/**
 * Таблиця топ-сесій: Назва / Проєкт / Вартість / Прапорці.
 * rows: [{ title, project, costUsd, flags: ['CACHE_MISS', ...] }]
 */
export function sessionsTable(rows) {
  if (!rows.length) return warnBox('Сесій за період немає.');
  const body = rows.map((r) => {
    const chips = (r.flags || []).map(chip).join(' ') || '<span class="none">—</span>';
    return `<tr><td class="t-title">${escHtml(truncate(r.title || r.sessionId || '(без назви)', 70))}</td>` +
      `<td class="t-proj">${escHtml(r.project || '—')}</td>` +
      `<td class="t-usd">${escHtml(fmtUsd(r.costUsd || 0))}</td>` +
      `<td class="t-flags">${chips}</td></tr>`;
  });
  return `<table class="sessions"><thead><tr>` +
    `<th>Назва</th><th>Проєкт</th><th class="t-usd">Вартість</th><th>Прапорці</th>` +
    `</tr></thead><tbody>${body.join('')}</tbody></table>`;
}

/**
 * Картки рекомендацій (buildRecommendations) з готовим до вставки промптом.
 */
export function recCards(cards, limit = 5) {
  const top = cards.slice(0, limit);
  if (!top.length) return warnBox('Рекомендацій немає — перевитрат за період не виявлено.');
  return top.map((c) => {
    const dotColor = SEVERITY_COLORS[c.severity] || SEVERITY_COLORS.low;
    return `<div class="rec">` +
      `<div class="rec-head"><span class="dot" style="background:${dotColor}"></span>` +
      `<span class="rec-title">${escHtml(c.title)}</span>` +
      `<span class="rec-waste">${escHtml(fmtUsd(c.wasteUsd))}</span></div>` +
      `<div class="rec-evidence">${escHtml(c.evidence)}</div>` +
      `<div class="rec-prompt"><div class="rec-prompt-label">Промпт для Claude Code</div>` +
      `${escHtml(c.prompt)}</div></div>`;
  }).join('');
}

/** Компактний підпис токенів: «in 12k · out 340k · кеш 1,2M». */
export function tokensLine(t) {
  return `in ${fmtTokensG(t.input)} · out ${fmtTokensG(t.output)} · кеш ${fmtTokensG(t.cacheRead)}`;
}

/**
 * Повний HTML-документ звіту.
 */
export function renderReport({ periodLabel, generatedAtLabel, bodyHtml }) {
  const title = `spend-lens — зведення за ${periodLabel}`;
  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #FFFFFF; }
  body {
    font-family: -apple-system, "SF Pro Text", "Segoe UI Variable", "Segoe UI", Inter, sans-serif;
    color: #1C1C1E;
    font-size: 10.5px;
    line-height: 1.45;
  }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .header h1 { font-size: 17px; font-weight: 700; letter-spacing: -0.2px; }
  .header .brand { color: #007AFF; }
  .header .meta { text-align: right; color: #8E8E93; font-size: 9px; line-height: 1.5; }

  .kpis { display: grid; gap: 8px; margin-bottom: 12px; }
  .kpis.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .kpis.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .kpi { border: 1px solid #E5E5EA; border-radius: 12px; padding: 8px 10px; background: #FFFFFF; break-inside: avoid; }
  .kpi-label { color: #8E8E93; font-size: 9px; text-transform: none; margin-bottom: 2px; }
  .kpi-value { font-size: 15px; font-weight: 700; letter-spacing: -0.2px; overflow-wrap: anywhere; }
  .kpi-delta { font-size: 8.5px; margin-top: 2px; }
  .kpi-delta.delta-up { color: #FF3B30; }
  .kpi-delta.delta-down { color: #34C759; }
  .kpi-sub { color: #8E8E93; font-size: 8.5px; margin-top: 2px; }

  .card {
    border: 1px solid #E5E5EA; border-radius: 14px; background: #FFFFFF;
    padding: 10px 12px; margin-bottom: 10px; break-inside: avoid;
  }
  .card h2 { font-size: 11.5px; font-weight: 600; margin-bottom: 8px; }
  .card svg { display: block; max-width: 100%; }

  .warn {
    border: 1px solid #FF95004D; background: #FF95001A; color: #A35F00;
    border-radius: 10px; padding: 8px 10px; font-size: 10px;
  }

  table.sessions { width: 100%; border-collapse: collapse; }
  table.sessions th {
    text-align: left; color: #8E8E93; font-size: 8.5px; font-weight: 600;
    border-bottom: 1px solid #E5E5EA; padding: 3px 6px 4px;
  }
  table.sessions td { padding: 4px 6px; border-bottom: 1px solid #F2F2F7; vertical-align: top; font-size: 9.5px; }
  table.sessions tr:last-child td { border-bottom: none; }
  td.t-title { max-width: 250px; }
  td.t-proj { max-width: 150px; overflow-wrap: anywhere; color: #8E8E93; }
  th.t-usd, td.t-usd { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.t-flags { max-width: 170px; }
  td.t-flags .none { color: #C7C7CC; }

  .chip {
    display: inline-block; border-radius: 999px; padding: 1px 7px 2px;
    font-size: 8px; font-weight: 600; white-space: nowrap; margin: 1px 2px 1px 0;
  }

  .rec { border: 1px solid #E5E5EA; border-radius: 12px; padding: 8px 10px; margin-bottom: 8px; break-inside: avoid; background: #FFFFFF; }
  .rec-head { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
  .rec .dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
  .rec-title { font-weight: 600; font-size: 10.5px; flex: 1 1 auto; }
  .rec-waste { color: #FF3B30; font-weight: 700; font-size: 10.5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .rec-evidence { color: #8E8E93; font-size: 9px; margin-bottom: 5px; }
  .rec-prompt {
    background: #F2F2F7; border-radius: 8px; padding: 6px 8px; font-size: 9px; line-height: 1.5;
  }
  .rec-prompt-label { color: #8E8E93; font-size: 7.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px; }

  footer {
    margin-top: 14px; padding-top: 8px; border-top: 1px solid #E5E5EA;
    color: #8E8E93; font-size: 8.5px; display: flex; justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="header">
    <h1><span class="brand">spend-lens</span> — зведення за ${escHtml(periodLabel)}</h1>
    <div class="meta">Сформовано: ${escHtml(generatedAtLabel)}<br>Часовий пояс: Europe/Kyiv</div>
  </div>
  ${bodyHtml}
  <footer>
    <span>spend-lens · автоматичний PDF-звіт</span>
    <span>${escHtml(generatedAtLabel)}</span>
  </footer>
</body>
</html>`;
}
