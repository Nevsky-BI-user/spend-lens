// Оцінка економії RTK (CONTRACT v1.9). Чисті функції, без побічних ефектів.
//
// Що саме рахуємо. RTK підрізає вивід команд ДО того, як він потрапить у
// модель, тож збережені токени — це токени, які НІКОЛИ не були відправлені як
// ВХІД. Отже їх треба оцінювати за вхідною ціною тієї суміші моделей, якою
// реально працювали того дня:
//
//   blendedInput(day) = Σ(вхідна ціна моделі × частка моделі у вартості дня)
//   valueUsd(day)     = saved_tokens × blendedInput / 1e6
//
// Запасні шляхи, коли для дня немає рядків у days[] (RTK рахує команди навіть
// тоді, коли Claude Code того дня не викликався): суміш усього періоду →
// найдорожча з використаних моделей.
//
// У ЧОМУ САМЕ це нижня оцінка (floor). Занижує вона рівно одне — повторні
// читання: збережені токени пораховано як одноразовий вхід, хоча в реальності
// кожен зайвий рядок ще й перечитувався б з кешу на кожному ході. Ціна ж
// зважена ЧАСТКОЮ У ВИТРАТАХ (так велить контракт), а це важча суміш, ніж якби
// ми зважували часткою у вхідних токенах, — тобто ціна тягне оцінку вгору, а не
// вниз. Тому «мінімум» без уточнення був би нечесним, і текст застереження
// нижче називає вимір прямо.
//
// Дати з rtk — уже локальні календарні дні (колектор їх не перебудовує), тому
// зріз робиться простим строковим порівнянням 'YYYY-MM-DD', як і всюди в days[].

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Текст застереження про нижню оцінку — один на картку й на будь-який звіт. */
export const RTK_FLOOR_NOTE =
  'Мінімальна оцінка щодо повторних читань: заощаджені токени пораховано як ' +
  'одноразовий вхід, хоча насправді кожен зайвий рядок ще й перечитувався б ' +
  'із кешу на кожному ході. Ціну взято вхідну, зважену часткою моделі ' +
  'у витратах дня.';

/** Стислий варіант того самого застереження — для PDF, де місця на рядок обмаль. */
export const RTK_FLOOR_NOTE_SHORT =
  'мінімальна оцінка: заощаджене пораховано як одноразовий вхід, без повторних читань із кешу';

/** Зсув дня 'YYYY-MM-DD' на delta діб (UTC-безпечно, без залежності від локалі). */
function shiftDay(day, delta) {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Чи є в снапшоті придатний до показу блок rtk. */
export function hasRtkData(rtk) {
  return !!(rtk && rtk.summary && Array.isArray(rtk.daily) && rtk.daily.length);
}

/**
 * Вікно періоду для зрізу rtk — дзеркало filterSnapshot з analytics.js:
 * день дрилдауну перевизначає період, period === 0 означає «увесь час».
 * Проєктний фільтр сюди НЕ передається: статистика rtk не поділена за проєктами.
 * @returns {{from: string|null, to: string|null}} межі включно; null = без межі.
 */
export function rtkWindow({ period = 0, day = null, anchorDay = '' } = {}) {
  const exact = DAY_RE.test(String(day || '')) ? day : null;
  if (exact) return { from: exact, to: exact };
  const anchor = DAY_RE.test(String(anchorDay || '')) ? anchorDay : null;
  if (!period || !anchor) return { from: null, to: null };
  return { from: shiftDay(anchor, -(period - 1)), to: anchor };
}

/**
 * Межі денної статистики rtk — перший і останній день, за який вона взагалі є.
 *
 * RTK тримає денні лічильники з обмеженим строком зберігання (на 0.45.0 — сім
 * днів), тож «немає рядків за період» і «того періоду RTK не бачив» — різні
 * речі. Без цих меж картка стверджувала б про роботу те, чого не знає.
 * @returns {{from: string|null, to: string|null}} null-и, коли даних немає взагалі.
 */
export function rtkCoverage(rtk) {
  if (!rtk || !Array.isArray(rtk.daily)) return { from: null, to: null };
  let from = null;
  let to = null;
  for (const r of rtk.daily) {
    const d = r && String(r.date || '');
    if (!DAY_RE.test(d)) continue;
    if (from == null || d < from) from = d;
    if (to == null || d > to) to = d;
  }
  return { from, to };
}

/** Рядки rtk.daily у межах вікна (включно), відсортовані за датою. */
export function sliceRtkDaily(rtk, { from = null, to = null } = {}) {
  if (!rtk || !Array.isArray(rtk.daily)) return [];
  return rtk.daily
    .filter((r) => r && DAY_RE.test(String(r.date || '')))
    .filter((r) => (!from || r.date >= from) && (!to || r.date <= to))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Рядки days[] у межах вікна (включно). */
export function sliceDays(days, { from = null, to = null } = {}) {
  return (days || []).filter((d) => (!from || d.day >= from) && (!to || d.day <= to));
}

/** Вхідна ціна моделі з pricingUsed (USD/MTok); невідома модель → 0. */
function inputPrice(pricingUsed, model) {
  const p = pricingUsed && pricingUsed[model];
  const v = p ? Number(p.input) : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Змішана вхідна ціна набору днів: середнє вхідних цін, зважене часткою
 * моделі у ВАРТОСТІ (не в токенах — гроші показують, чим справді працювали).
 * Моделі без ціни (`<synthetic>`, невідомі) не потрапляють ні в чисельник, ні
 * в знаменник, інакше вони розбавляли б оцінку нулями.
 * @returns {number|null} USD/MTok або null, якщо зважувати нічим.
 */
export function blendedInputPrice(days, pricingUsed) {
  const byModel = new Map();
  for (const d of days || []) {
    const price = inputPrice(pricingUsed, d.model);
    if (price <= 0) continue;
    const cost = Number(d.costUsd) || 0;
    if (cost <= 0) continue;
    byModel.set(d.model, (byModel.get(d.model) || 0) + cost);
  }
  let total = 0;
  for (const cost of byModel.values()) total += cost;
  if (total <= 0) return null;
  let blended = 0;
  for (const [model, cost] of byModel) blended += inputPrice(pricingUsed, model) * (cost / total);
  return blended;
}

/**
 * Найдорожча вхідна ціна серед РЕАЛЬНО використаних моделей (останній
 * запасний шлях). Якщо days порожні — серед усіх відомих цін.
 * @returns {number|null}
 */
export function priciestInputPrice(days, pricingUsed) {
  let max = 0;
  const used = new Set((days || []).map((d) => d.model));
  const models = used.size ? [...used] : Object.keys(pricingUsed || {});
  for (const m of models) max = Math.max(max, inputPrice(pricingUsed, m));
  return max > 0 ? max : null;
}

/**
 * Повна оцінка економії RTK за вікном.
 *
 * @param {object|null} rtk         снапшотний блок rtk
 * @param {object} opts
 * @param {string|null} opts.from   межа зрізу (включно)
 * @param {string|null} opts.to     межа зрізу (включно)
 * @param {Array}  opts.days        УСІ дні снапшота (без фільтра за проєктом —
 *                                  статистика rtk глобальна)
 * @param {object} opts.pricingUsed таблиця цін зі снапшота
 * @returns {null | {
 *   rows: Array, savedTokens: number, inputTokens: number, outputTokens: number,
 *   commands: number, savingsPct: number, valueUsd: number,
 *   blendedInput: number, priceSource: 'day'|'period'|'max'|'none'
 * }}  null — показувати нічого (немає блоку rtk).
 */
export function valueRtk(rtk, { from = null, to = null, days = [], pricingUsed = {} } = {}) {
  if (!hasRtkData(rtk)) return null;

  const rows = sliceRtkDaily(rtk, { from, to });
  const windowDays = sliceDays(days, { from, to });

  // Запасні ціни рахуємо один раз: суміш усього вікна, далі — найдорожча модель.
  const periodPrice = blendedInputPrice(windowDays, pricingUsed);
  const maxPrice = priciestInputPrice(days, pricingUsed);

  const byDay = new Map();
  for (const d of windowDays) {
    if (!byDay.has(d.day)) byDay.set(d.day, []);
    byDay.get(d.day).push(d);
  }

  const sources = new Set();
  const priced = rows.map((r) => {
    const dayPrice = blendedInputPrice(byDay.get(r.date) || [], pricingUsed);
    let price = dayPrice;
    let source = 'day';
    if (price == null) { price = periodPrice; source = 'period'; }
    if (price == null) { price = maxPrice; source = 'max'; }
    if (price == null) { price = 0; source = 'none'; }
    sources.add(source);
    const saved = Number(r.saved_tokens) || 0;
    return {
      date: r.date,
      savedTokens: saved,
      commands: Number(r.commands) || 0,
      // input_tokens — СИРИЙ вивід команд (до підрізання), output_tokens — те,
      // що дійшло до моделі; їхня різниця і є saved_tokens.
      inputTokens: Number(r.input_tokens) || 0,
      outputTokens: Number(r.output_tokens) || 0,
      savingsPct: Number(r.savings_pct) || 0,
      blendedInput: price,
      valueUsd: (saved * price) / 1e6,
    };
  });

  const sum = (f) => priced.reduce((a, r) => a + f(r), 0);
  const savedTokens = sum((r) => r.savedTokens);
  const inputTokens = sum((r) => r.inputTokens);
  const valueUsd = sum((r) => r.valueUsd);
  // Ефективна ціна періоду: назад із грошей у ціну — тоді число в підписі
  // завжди узгоджене з сумою, навіть коли дні оцінені за різними сумішами.
  const blendedInput = savedTokens > 0 ? (valueUsd / savedTokens) * 1e6 : (periodPrice ?? maxPrice ?? 0);

  const order = ['day', 'period', 'max', 'none'];
  const priceSource = order.find((s) => sources.has(s)) || 'none';

  return {
    rows: priced,
    savedTokens,
    inputTokens,
    outputTokens: sum((r) => r.outputTokens),
    commands: sum((r) => r.commands),
    // Частка зрізаного від СИРОГО виводу. `input_tokens` у rtk — це те, що
    // команди видали ДО підрізання (перевірено: input − output = saved, а
    // savings_pct = saved / input), тож знаменник — саме input, без додавання
    // saved. Зважуємо сумами, а не середнім денних відсотків: день із трьома
    // командами не має важити як день із девʼятьмастами.
    savingsPct: inputTokens > 0 ? (savedTokens / inputTokens) * 100 : 0,
    valueUsd,
    blendedInput,
    priceSource,
  };
}

/** Топ-N команд за збереженими токенами (порядок rtk уже такий — не сортуємо повторно). */
export function topRtkCommands(rtk, n = 5) {
  if (!rtk || !Array.isArray(rtk.commands)) return [];
  return rtk.commands
    .filter((c) => c && c.command && Number(c.savedTokens) > 0)
    .slice()
    .sort((a, b) => (Number(b.savedTokens) || 0) - (Number(a.savedTokens) || 0))
    .slice(0, n);
}
