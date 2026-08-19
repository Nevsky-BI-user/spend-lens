// v1.10 — «Звідки течуть токени інструментів»: чисті функції над snapshot.toolOutput.
//
// Що саме міряємо. Колектор рахує ДОВЖИНУ ВИВОДУ кожного `tool_result` у
// символах і відносить її до київського дня самого результату. Це те, що
// інструменти ПОВЕРНУЛИ в контекст, а не те, за що виставлено рахунок: один і
// той самий результат далі перечитується з кешу на кожному наступному ході,
// тож реальний тиск на витрати вищий за ці числа, а не нижчий.
//
// Навіщо картка стоїть над карткою RTK: RTK підрізає вивід КОМАНД, тобто лише
// Bash-скибку цього потоку. Поки не видно, що Read дає більшу частину виводу,
// економія RTK виглядає підозріло малою — і користувач шукає ваду там, де її
// немає.
//
// Наближення chars → tokens. Беремо 4 символи на токен — груба, але звична
// оцінка для латиниці й коду. Два місця, де вона хибить, названо в UI:
//  - українська/кирилиця в UTF-8 дає ~2–3 символи на токен (недооцінка);
//  - base64-скриншоти (computer, browser) — це не текст: мільйон символів
//    картинки коштує моделі приблизно півтори тисячі токенів, тож для таких
//    інструментів правило 4:1 завищує оцінку на порядки. Тому в UI ця колонка
//    підписана як приблизна, а не як «токени».

import { blendedInputPrice, priciestInputPrice, sliceDays } from './rtkValue.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Скільки символів вважаємо одним токеном (див. застереження вгорі файлу). */
export const CHARS_PER_TOKEN = 4;

/**
 * Інструменти, чий вивід узагалі може потрапити під ніж RTK.
 * RTK — проксі для команд оболонки, тож дотягується рівно до Bash. PowerShell
 * ходить повз нього (окремий інструмент харнесу, не через rtk-хук), Read/Grep
 * читають файли всередині процесу — жодного проксі там немає.
 */
export const RTK_REACHABLE = new Set(['Bash']);

/** Хвостова корзина, яку зводить колектор (топ-12 інструментів на день + решта). */
export const OTHER_TOOL = 'інші';

/**
 * Скільки інструментів на день колектор лишає іменованими (TOOLS_PER_DAY у
 * collect.mjs). Решта дня падає в рядок OTHER_TOOL ще ДО того, як снапшот
 * дійде сюди, — тож у rows може вже бути готовий «інші», і UI не має права
 * домальовувати другий такий самий підпис.
 */
export const TOOLS_PER_DAY = 12;

/** Приблизна кількість токенів у символах виводу. */
export function charsToTokens(chars) {
  const c = Number(chars) || 0;
  return c > 0 ? c / CHARS_PER_TOKEN : 0;
}

/** Чи є в снапшоті придатний до показу зріз виводу інструментів. */
export function hasToolFlow(toolOutput) {
  return Array.isArray(toolOutput) && toolOutput.some((r) => r && Number(r.chars) > 0);
}

/** Рядки toolOutput у межах вікна (включно), відкинувши биті. */
function sliceRows(toolOutput, { from = null, to = null } = {}) {
  if (!Array.isArray(toolOutput)) return [];
  return toolOutput.filter(
    (r) =>
      r &&
      DAY_RE.test(String(r.day || '')) &&
      typeof r.tool === 'string' &&
      r.tool &&
      (!from || r.day >= from) &&
      (!to || r.day <= to)
  );
}

/**
 * Чи є вивід інструментів САМЕ в цьому вікні.
 *
 * hasToolFlow() відповідає на інше питання — «чи є блок у снапшоті взагалі».
 * Для перехресних посилань цього замало: картка потоку за порожній період
 * показує порожній стан, і посилатися на неї як на пояснення тоді не можна.
 */
export function hasToolFlowInWindow(toolOutput, { from = null, to = null } = {}) {
  if (!hasToolFlow(toolOutput)) return false;
  return sliceRows(toolOutput, { from, to }).some((r) => Number(r.chars) > 0);
}

/**
 * Межі даних про вивід інструментів — перший і останній день, за який вони є.
 * Потрібні, щоб не стверджувати «за період нічого не було», коли насправді
 * снапшот тих днів просто не покриває.
 * @returns {{from: string|null, to: string|null}}
 */
export function toolFlowCoverage(toolOutput) {
  let from = null;
  let to = null;
  for (const r of sliceRows(toolOutput)) {
    if (from == null || r.day < from) from = r.day;
    if (to == null || r.day > to) to = r.day;
  }
  return { from, to };
}

/**
 * Денний зріз потоку: скільки вивели інструменти кожного дня вікна.
 *
 * @param {Array} toolOutput  snapshot.toolOutput
 * @param {{from?: string|null, to?: string|null}} win  межі включно
 * @returns {Array<{day: string, calls: number, chars: number, tokens: number,
 *                  tools: Array<{tool: string, calls: number, chars: number, tokens: number}>}>}
 *          відсортовано за днем; інструменти всередині дня — за символами вниз.
 */
export function toolFlowByDay(toolOutput, { from = null, to = null } = {}) {
  const byDay = new Map();
  for (const r of sliceRows(toolOutput, { from, to })) {
    let d = byDay.get(r.day);
    if (!d) byDay.set(r.day, (d = { day: r.day, calls: 0, chars: 0, tokens: 0, tools: [] }));
    const calls = Number(r.calls) || 0;
    const chars = Number(r.chars) || 0;
    d.calls += calls;
    d.chars += chars;
    d.tools.push({ tool: r.tool, calls, chars, tokens: charsToTokens(chars) });
  }
  const rows = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  for (const d of rows) {
    d.tokens = charsToTokens(d.chars);
    d.tools.sort((a, b) => b.chars - a.chars || a.tool.localeCompare(b.tool));
  }
  return rows;
}

/**
 * Підсумок за вікном: кожен інструмент — скільки викликів, символів, токенів,
 * яка частка потоку і скільки це приблизно коштує вхідними грошима.
 *
 * Ціна — та сама змішана вхідна ціна, що й у картці RTK (rtkValue.js): середнє
 * вхідних цін моделей, зважене їхньою часткою у ВИТРАТАХ вікна. Ланцюг запасних
 * варіантів такий самий: суміш вікна → суміш усіх днів → найдорожча вжита
 * модель → 0 (тоді estUsd не показуємо).
 *
 * @param {Array} toolOutput   snapshot.toolOutput
 * @param {object} opts
 * @param {string|null} opts.from   межа вікна (включно)
 * @param {string|null} opts.to     межа вікна (включно)
 * @param {Array}  opts.days        УСІ дні снапшота (вивід інструментів не
 *                                  поділений за проєктами — фільтр проєкту
 *                                  до нього не застосовується)
 * @param {object} opts.pricingUsed таблиця цін зі снапшота
 * @returns {null | {
 *   rows: Array<{tool, calls, chars, tokens, share, estUsd, reachable}>,
 *   chars: number, tokens: number, calls: number, estUsd: number,
 *   reachableChars: number, reachableTokens: number, reachableShare: number,
 *   reachableTools: string[], days: number,
 *   blendedInput: number, priceSource: 'period'|'all'|'max'|'none'
 * }}  null — показувати нічого (немає блоку toolOutput).
 */
export function toolFlowTotals(
  toolOutput,
  { from = null, to = null, days = [], pricingUsed = {} } = {}
) {
  if (!hasToolFlow(toolOutput)) return null;

  const rowsIn = sliceRows(toolOutput, { from, to });

  // Ціна: спочатку суміш самого вікна, далі — дедалі грубіші запасні варіанти.
  let price = blendedInputPrice(sliceDays(days, { from, to }), pricingUsed);
  let priceSource = 'period';
  if (price == null) { price = blendedInputPrice(days, pricingUsed); priceSource = 'all'; }
  if (price == null) { price = priciestInputPrice(days, pricingUsed); priceSource = 'max'; }
  if (price == null) { price = 0; priceSource = 'none'; }

  const byTool = new Map();
  const daySet = new Set();
  let chars = 0;
  let calls = 0;
  for (const r of rowsIn) {
    const c = Number(r.chars) || 0;
    const n = Number(r.calls) || 0;
    daySet.add(r.day);
    chars += c;
    calls += n;
    let t = byTool.get(r.tool);
    if (!t) byTool.set(r.tool, (t = { tool: r.tool, calls: 0, chars: 0 }));
    t.calls += n;
    t.chars += c;
  }

  const rows = [...byTool.values()]
    .sort((a, b) => b.chars - a.chars || a.tool.localeCompare(b.tool))
    .map((t) => {
      const tokens = charsToTokens(t.chars);
      return {
        tool: t.tool,
        calls: t.calls,
        chars: t.chars,
        tokens,
        share: chars > 0 ? t.chars / chars : 0,
        estUsd: (tokens * price) / 1e6,
        reachable: RTK_REACHABLE.has(t.tool),
      };
    });

  const reachable = rows.filter((r) => r.reachable);
  const reachableChars = reachable.reduce((a, r) => a + r.chars, 0);
  const tokens = charsToTokens(chars);

  return {
    rows,
    chars,
    tokens,
    calls,
    estUsd: (tokens * price) / 1e6,
    reachableChars,
    reachableTokens: charsToTokens(reachableChars),
    reachableShare: chars > 0 ? reachableChars / chars : 0,
    reachableTools: reachable.map((r) => r.tool),
    days: daySet.size,
    blendedInput: price,
    priceSource,
  };
}
