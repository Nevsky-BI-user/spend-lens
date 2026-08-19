// Виявлення аномальних ДНІВ за витратами (CONTRACT v1.6 §3, звужено v1.8 §1).
// Чисті функції.
//
// v1.8: детекція на рівні СЕСІЙ звідси прибрана. Порівнювати абсолютну
// вартість сесії з медіанною вартістю сесії безглуздо (дешева сесія могла
// нічого не зробити) — її замінила відносна віддача, web/src/lib/efficiency.js.
// Денна детекція лишається заради контролю бюджету, але доказ до неї теж
// відносний: ціна однієї правки того дня проти ціни правки у звичайний день.
//
// Робастна статистика: медіана + MAD, БЕЗ середнього та σ — один сплеск на
// $300 зсуває середнє так, що «аномалією» перестає бути будь-що.
// Скрізь діє захист: якщо порівнювати нема з чим (< minPoints точок),
// детекція не працює взагалі — краще нічого не показати, ніж позначити
// аномалією другу сесію в проєкті.

import { dayToDate } from './analytics.js';
import { fmtUsd } from './format.js';
import { dayReturnEvidence } from './efficiency.js';

// --------------------------------------------------------------- описувач ---

/** Тип прапорця (сумісний із FLAG_META та sessionFlags()). */
export const ANOMALY_FLAG = 'ANOMALY';

/**
 * Описувач у форматі FLAG_META (rules.js): { label, labelAgg, color }.
 * Колір — iOS red #FF3B30 (CONTRACT: «color #FF3B30, chip «Аномалія»»).
 * Для чіпа потрібен CSS-клас `.chip-ANOMALY` (пастель 12 % + темний текст).
 */
export const ANOMALY_FLAG_META = {
  label: 'Аномалія',
  labelAgg: 'Аномалії',
  color: '#FF3B30',
};

/** Готовий фрагмент мапи прапорців: { ANOMALY: {…} }. */
export const ANOMALY_FLAG_ENTRY = { [ANOMALY_FLAG]: ANOMALY_FLAG_META };

/**
 * FLAG_META + ANOMALY, щоб колонка «Прапорці» рендерила «Аномалія» без
 * правок rules.js: `const META = withAnomalyFlag(FLAG_META)`.
 */
export function withAnomalyFlag(flagMeta = {}) {
  return { ...flagMeta, [ANOMALY_FLAG]: ANOMALY_FLAG_META };
}

/** Пороги детекції (тюняться без перезбирання снапшота). */
export const ANOMALY_RULES = {
  minPoints: 8,            // спільний захист: менше точок — детекції немає
  day: {
    trailing: 30,          // ковзне вікно, календарних днів
    k: 3,                  // cost > median + k × 1.4826 × MAD
    minUsd: 1,             // день дешевший за $1 аномалією не вважаємо
  },
  MAD_SCALE: 1.4826,       // масштаб MAD до σ нормального розподілу
};

// ------------------------------------------------------------- статистика ---

/** Медіана (порожній масив → 0). Вхід не мутується. */
export function median(values) {
  const arr = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = arr.length >> 1;
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

/** MAD = median(|x − median(x)|). med можна передати, якщо вже пораховано. */
export function mad(values, med = null) {
  const arr = (values || []).filter((v) => Number.isFinite(v));
  if (!arr.length) return 0;
  const m = med == null ? median(arr) : med;
  return median(arr.map((v) => Math.abs(v - m)));
}

/** MAD, масштабований до σ (1.4826 × MAD). */
export function scaledMad(values, med = null) {
  return ANOMALY_RULES.MAD_SCALE * mad(values, med);
}

// ------------------------------------------------------------- дні: утиліти --

function shiftDay(day, delta) {
  const d = dayToDate(day);
  d.setDate(d.getDate() + delta);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// --------------------------------------------------------- аномальні дні ----

/**
 * Аномально дорогі ДНІ: ковзне календарне вікно `trailing` днів (включно з
 * самим днем), поріг `median + k × 1.4826 × MAD` по денних сумах у вікні.
 *
 * Вікно календарне, але точками є ЛИШЕ дні, наявні у снапшоті: колектор не
 * пише порожні дні, а домальовувати нулі не можна — вони затягнули б медіану
 * вниз і зробили б аномалією кожен робочий день.
 *
 * Захист:
 *  - у вікні має бути ≥ minPoints точок, інакше день не оцінюється;
 *  - якщо MAD виродився в 0 (усі дні однакові), беремо запасну дисперсію
 *    = медіана (поріг стає (1+k)×median) — інакше поріг = median і аномалією
 *    став би кожен день, дорожчий за медіану бодай на цент;
 *  - день дешевший за minUsd аномалією не вважається за жодних умов.
 *
 * @param {Array} days снапшот `days` (грануляція день×проєкт×модель×сабчейн)
 * @param {{trailing?:number,k?:number,minPoints?:number,minUsd?:number}} [opts]
 * @returns {{
 *   rows: Array,            // УСІ дні (зростання), із полями median/threshold/isAnomaly
 *   anomalies: Array,       // лише аномальні, вартість ↓ (для картки «Аномалії»)
 *   byDay: Map<string,object>,
 *   flaggedDays: Set<string>,   // для червоних крапок на графіку
 *   trailing:number, k:number, minPoints:number, points:number
 * }}
 */
export function detectDayAnomalies(days, {
  trailing = ANOMALY_RULES.day.trailing,
  k = ANOMALY_RULES.day.k,
  minPoints = ANOMALY_RULES.minPoints,
  minUsd = ANOMALY_RULES.day.minUsd,
  dayRates = null,
} = {}) {
  const totals = new Map();
  for (const d of days || []) {
    if (!d || !d.day) continue;
    totals.set(d.day, (totals.get(d.day) || 0) + (d.costUsd || 0));
  }
  const series = [...totals.entries()]
    .map(([day, costUsd]) => ({ day, costUsd }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  const rows = [];
  const byDay = new Map();
  const flaggedDays = new Set();
  let lo = 0;

  for (let i = 0; i < series.length; i++) {
    const { day, costUsd } = series[i];
    const from = shiftDay(day, -(trailing - 1));
    while (lo < i && series[lo].day < from) lo++;

    const window = series.slice(lo, i + 1).map((r) => r.costUsd);
    const points = window.length;
    let medianUsd = 0, madUsd = 0, thresholdUsd = null, isAnomaly = false, evidence = null;

    if (points >= minPoints) {
      medianUsd = median(window);
      madUsd = ANOMALY_RULES.MAD_SCALE * mad(window, medianUsd);
      const spread = madUsd > 0 ? madUsd : medianUsd; // запасна дисперсія
      thresholdUsd = medianUsd + k * spread;
      isAnomaly = costUsd > thresholdUsd && costUsd >= minUsd;
    }

    const ratio = medianUsd > 0 ? costUsd / medianUsd : Infinity;
    if (isAnomaly) {
      // Доказ — ВІДНОСНИЙ (v1.8): ціна однієї правки того дня проти ціни
      // правки у звичайний день. Без ставок (снапшот v1 без дайджестів) —
      // чесно кажемо, що день дорогий, БЕЗ порівняння суми з сумою.
      const rate = dayRates ? dayRates.get(day) : null;
      evidence = rate
        ? dayReturnEvidence(rate)
        : `${fmtUsd(costUsd)} за добу — різкий сплеск витрат`;
    }

    const row = {
      type: ANOMALY_FLAG,
      wasteUsd: 0,
      day,
      costUsd,
      medianUsd,
      madUsd,
      thresholdUsd,
      ratio,
      points,
      isAnomaly,
      evidence,
    };
    rows.push(row);
    byDay.set(day, row);
    if (isAnomaly) flaggedDays.add(day);
  }

  const anomalies = rows.filter((r) => r.isAnomaly).sort((a, b) => b.costUsd - a.costUsd);
  return { rows, anomalies, byDay, flaggedDays, trailing, k, minPoints, points: series.length };
}

/**
 * Обгортка для мемоїзації в App: денні аномалії на переданому зрізі.
 * `dayRates` — результат dayReturn() з efficiency.js (Map day → ставка).
 * @returns {{ days: ReturnType<detectDayAnomalies> }}
 */
export function detectAnomalies(snapshot, { day = {} } = {}) {
  return {
    days: detectDayAnomalies((snapshot && snapshot.days) || [], day),
  };
}
