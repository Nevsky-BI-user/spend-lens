// Стан застосунку в адресному рядку (CONTRACT v1.6, пункт 6):
// tab + period + project + day + budget живуть у query-рядку, тож посилання
// можна переслати, а «назад» скасовує дрил-даун.
//
// Правила:
//  - `?print=` перевіряється РАНІШЕ (App.jsx) і сюди не потрапляє взагалі;
//  - невалідні значення тихо падають у дефолти (жодних помилок користувачу);
//  - чужі параметри (`demo=1`, `print=`) зберігаються при перезаписі URL —
//    інакше перемикання фільтра вибило б застосунок із демо-режиму;
//  - `#hash` лишається робочим псевдонімом вкладки (старі посилання).

/** Ключі, якими володіє цей модуль; решта параметрів URL недоторкані. */
const MANAGED = ['tab', 'period', 'project', 'day', 'budget'];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** localStorage-ключ місячного бюджету (CONTRACT v1.6 §2). */
export const BUDGET_KEY = 'spend-lens.budget';

/** Бюджет із localStorage: додатне число або null. Приватний режим не валить. */
export function readStoredBudget() {
  try {
    const v = Number(window.localStorage.getItem(BUDGET_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Записати/стерти бюджет у localStorage (null = вимкнено). */
export function writeStoredBudget(value) {
  try {
    if (value == null) window.localStorage.removeItem(BUDGET_KEY);
    else window.localStorage.setItem(BUDGET_KEY, String(value));
  } catch {
    /* Safari у приватному режимі кидає QuotaExceeded — бюджет просто не переживе перезавантаження */
  }
}

/** '300', '300,5' → 300 / 300.5; сміття, нуль і мінус → null. */
export function parseBudget(raw) {
  if (raw == null || raw === '') return null;
  const v = Number(String(raw).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Валідний день 'YYYY-MM-DD' або null. */
export function parseDay(raw) {
  return DAY_RE.test(raw || '') ? raw : null;
}

/**
 * Розбір стану з location. Період у URL людяний: `period=7|30|all`.
 * @param {{search?:string, hash?:string, tabIds:string[], periodValues:number[],
 *          defaultTab?:string, defaultPeriod?:number}} opts
 * @returns {{tab:string, period:number, project:string|null, day:string|null, budget:number|null}}
 */
export function parseUrlState({
  search = '',
  hash = '',
  tabIds = [],
  periodValues = [],
  defaultTab = 'overview',
  defaultPeriod = 30,
} = {}) {
  const p = new URLSearchParams(search);

  // Вкладка: ?tab= має пріоритет, #hash — сумісний псевдонім (v1.0-посилання).
  const hashTab = String(hash || '').replace(/^#\/?/, '');
  const rawTab = p.get('tab') || hashTab;
  const tab = tabIds.includes(rawTab) ? rawTab : defaultTab;

  let period = defaultPeriod;
  const rawPeriod = p.get('period');
  if (rawPeriod != null) {
    const n = rawPeriod === 'all' ? 0 : Number(rawPeriod);
    if (Number.isFinite(n) && periodValues.includes(n)) period = n;
  }

  const project = p.get('project') || null;
  const day = parseDay(p.get('day'));

  // Пріоритет джерел бюджету (CONTRACT §2): URL → localStorage → немає.
  const rawBudget = p.get('budget');
  const budget = rawBudget != null ? parseBudget(rawBudget) : readStoredBudget();

  return { tab, period, project, day, budget };
}

/**
 * URL для стану: зберігає чужі параметри, викидає дефолти (щоб адреса
 * лишалася короткою) і скидає `#hash` — вкладка тепер живе в `?tab=`.
 */
export function buildUrl(state, { defaultTab = 'overview', defaultPeriod = 30, location = window.location } = {}) {
  const p = new URLSearchParams(location.search);
  for (const k of MANAGED) p.delete(k);

  if (state.tab && state.tab !== defaultTab) p.set('tab', state.tab);
  if (state.period !== defaultPeriod) p.set('period', state.period === 0 ? 'all' : String(state.period));
  if (state.project) p.set('project', state.project);
  if (state.day) p.set('day', state.day);
  if (state.budget != null) p.set('budget', String(state.budget));

  const qs = p.toString();
  return `${location.pathname}${qs ? `?${qs}` : ''}`;
}

/**
 * Записати стан в історію. `push` — для вкладки й дрил-дауну (щоб «назад»
 * їх скасовував); `replace` — для дрібних правок фільтра, які не варті
 * окремого запису історії.
 */
export function writeUrlState(state, { push = false, defaultTab, defaultPeriod } = {}) {
  const url = buildUrl(state, { defaultTab, defaultPeriod });
  const current = `${window.location.pathname}${window.location.search}`;
  if (push) {
    // Той самий URL двічі підряд у стек не пишемо: інакше «назад» довелося б
    // тиснути двічі, щоб побачити зміну.
    if (url === current) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  } else {
    window.history.replaceState(null, '', url);
  }
}
