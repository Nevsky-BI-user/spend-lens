// Форматування чисел і дат (українська локаль).
// Розділювач тисяч — вузький нерозривний пробіл (U+202F), $ із 2 знаками.

const NNBSP = ' ';

function group(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
}

/** $1 234,56 (2 знаки після коми). */
export function fmtUsd(x) {
  const v = Number(x) || 0;
  const neg = v < 0;
  const abs = Math.abs(v);
  const [i, f] = abs.toFixed(2).split('.');
  return `${neg ? '−' : ''}$${group(i)},${f}`;
}

/** Компактні гроші для осей/карток: $12, $1,2k. */
export function fmtUsdCompact(x) {
  const v = Number(x) || 0;
  const abs = Math.abs(v);
  if (abs >= 1000) return `$${(v / 1000).toFixed(1).replace('.', ',')}k`;
  if (abs >= 100) return `$${Math.round(v)}`;
  if (abs >= 10) {
    return Number.isInteger(Math.round(v * 10) / 10)
      ? `$${Math.round(v)}`
      : `$${v.toFixed(1).replace('.', ',')}`;
  }
  return `$${v.toFixed(2).replace('.', ',')}`;
}

/**
 * Дрібні гроші (v1.6): вартість одного ходу асистента — це центи, і на двох
 * знаках $0,05 усі дні виглядають однаково. До $1 показуємо 4 знаки
 * ($0,0463), від $1 — звичайний fmtUsd.
 */
export function fmtUsdFine(x) {
  const v = Number(x) || 0;
  if (Math.abs(v) >= 1) return fmtUsd(v);
  const [i, f] = Math.abs(v).toFixed(4).split('.');
  return `${v < 0 ? '−' : ''}$${i},${f}`;
}

/** Компактні токени: 340k, 1,2M, 4 897M. */
export function fmtTokens(x) {
  const v = Number(x) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${group(String(Math.round(v / 1e6)))}M`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')}M`;
  if (abs >= 1e3) return `${Math.round(v / 1e3)}k`;
  return group(String(Math.round(v)));
}

/** Ціле з розділювачами тисяч. */
export function fmtInt(x) {
  return group(String(Math.round(Number(x) || 0)));
}

/** Відсоток: 93 %. */
export function fmtPct(x, digits = 0) {
  const v = Number(x) || 0;
  return `${v.toFixed(digits).replace('.', ',')}${NNBSP}%`;
}

const MONTHS_SHORT = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
const MONTHS_GEN = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
];
const MONTHS_NOM = [
  'січень', 'лютий', 'березень', 'квітень', 'травень', 'червень',
  'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень',
];

/** Місяць у називному (для заголовків): '2026-08' | '2026-08-18' → 'серпень'. */
export function monthName(ym) {
  const m = Number(String(ym || '').slice(5, 7));
  return MONTHS_NOM[m - 1] || '';
}

/** День місяця + місяць у родовому: (18, '2026-08') → '18 серпня'. */
export function fmtDomMonth(dom, ym) {
  const m = Number(String(ym || '').slice(5, 7));
  return `${dom} ${MONTHS_GEN[m - 1] || ''}`.trim();
}

/** '2026-08-18' → '18 сер'. */
export function fmtDayShort(day) {
  const [, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

/**
 * Українська множина: plural(n, 'сесія', 'сесії', 'сесій').
 * Живе тут, а не в analytics.js, бо форматери (тривалість, діапазон днів)
 * не мають права залежати від аналітики — залежність іде рівно в один бік.
 * analytics.js реекспортує цю ж функцію, тож старі імпорти працюють.
 */
export function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}

/**
 * Числова дата для стислих підписів (v1.7): '2026-08-07' → '7.08'.
 * `withYear` додає дві цифри року — потрібен лише в діапазонах через межу року.
 */
export function fmtDayNum(day, { withYear = false } = {}) {
  const s = String(day || '');
  if (s.length < 10) return '';
  const dom = Number(s.slice(8, 10));
  return withYear ? `${dom}.${s.slice(5, 7)}.${s.slice(2, 4)}` : `${dom}.${s.slice(5, 7)}`;
}

/**
 * Діапазон днів для рядка-опису проєкту: '7.08–19.08'.
 * Один день → без тире; різні роки → рік у обох кінцях (7.08.25–19.08.26).
 */
export function fmtDayRange(from, to) {
  const a = String(from || '');
  const b = String(to || '');
  if (!a && !b) return '';
  if (!a || !b || a === b) return fmtDayNum(a || b);
  const withYear = a.slice(0, 4) !== b.slice(0, 4);
  return `${fmtDayNum(a, { withYear })}–${fmtDayNum(b, { withYear })}`;
}

/**
 * Тривалість сесії: '45 хв', '6 год 12 хв', '3 дні 4 год'.
 * Скорочення для годин/хвилин — навмисно: «6 годин 12 хвилин» у метриці
 * дровера переносилось би на два рядки, а відмінок «год»/«хв» незмінний.
 */
export function fmtDuration(ms) {
  const total = Number(ms);
  if (!Number.isFinite(total) || total <= 0) return '—';
  const min = Math.round(total / 60000);
  if (min < 1) return 'менше хвилини';
  if (min < 60) return `${min} хв`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h} год ${m} хв` : `${h} год`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  const dayWord = plural(d, 'день', 'дні', 'днів');
  return hh ? `${d} ${dayWord} ${hh} год` : `${d} ${dayWord}`;
}

/** ISO → '18 серпня, 14:32'. */
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}, ${hh}:${mm}`;
}

/** Скорочена назва моделі: claude-fable-5 → fable-5. */
export function shortModel(model) {
  return String(model || '').replace(/^claude-/, '').replace(/-\d{8}$/, '');
}
