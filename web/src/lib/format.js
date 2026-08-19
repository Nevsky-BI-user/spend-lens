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
