// Відносна віддача (CONTRACT v1.8 §1). Чисті функції, без DOM і React.
//
// Порівнювати абсолютні суми двох сесій безглуздо: дешева сесія могла не
// зробити взагалі нічого, тож «у 1027 разів дорожча за типову» не описує
// жодної проблеми. Тому тут усе рахується СТАВКАМИ — скільки коштувала
// одиниця зробленої роботи:
//   $ за правку, $ за 1k вихідних токенів, контекст на правку.
//
// Медіана береться В МЕЖАХ КЛАСУ сесії: «правки» й «аналіз» — різна природа
// роботи, і мірило в них різне. Порожні та копійчані сесії медіану не
// формують (інакше вона сповзає в нуль і «дорожчим за норму» стає все).
//
// Джерело правок/файлів — дайджести колектора (v1.7a, schemaVersion 2).
// Снапшот v1 без `digest` деградує тихо: усі ставки за правку — null,
// клас сесії — «аналіз», UI відповідних блоків просто не рендерить.

import { fmtUsd, fmtInt, plural } from './format.js';

// ------------------------------------------------------------- налаштування -

export const RETURN_RULES = {
  editsThreshold: 3,   // digest.edits >= 3 → клас «правки»
  baseMinCostUsd: 0.5, // сесії дешевші за це не формують медіану
  minBasePoints: 8,    // ≥8 порівнянних точок У КЛАСІ, інакше детекції немає
  minIndex: 3,         // «слабка віддача» — від 3× медіани
  minCostUsd: 5,       // …і лише коли сесія коштувала бодай $5
  worstMinIndex: 1.2,  // список «найгірша віддача» — від 1,2× (нижче — це не «дорожче»)
  parIndex: 1.1,       // ближче за це до медіани — «на рівні», без множника
  dayWarnIndex: 1.15,  // день дорожчий за медіану менш ніж на 15 % — «як звичайний»
};

export const CLASS_EDITS = 'правки';
export const CLASS_ANALYSIS = 'аналіз';

/** Прапорець сесії зі слабкою віддачею (заміна session-level ANOMALY). */
export const LOW_RETURN_FLAG = 'LOW_RETURN';

export const LOW_RETURN_FLAG_META = {
  label: 'Слабка віддача',
  labelAgg: 'Слабка віддача',
  color: '#FF3B30',
};

/** FLAG_META + LOW_RETURN — щоб чіп рендерився без правок rules.js. */
export function withLowReturnFlag(flagMeta = {}) {
  return { ...flagMeta, [LOW_RETURN_FLAG]: LOW_RETURN_FLAG_META };
}

// -------------------------------------------------------------- статистика --

/** Медіана (порожній вхід → null, а не 0: «нема з чим порівнювати»). */
export function median(values) {
  const arr = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = arr.length >> 1;
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

// -------------------------------------------------------------- копірайт ----

const TIMES_WORD = { 2: 'удвічі', 3: 'утричі', 4: 'вчетверо' };

/**
 * Множник словами до 4×, далі цифрами (CONTRACT v1.8):
 * 2,03 → «удвічі», 3,4 → «у 3,4 раза», 12 → «у 12 разів».
 */
export function timesPhrase(x) {
  if (!Number.isFinite(x) || x <= 0) return 'у рази';
  const whole = Math.round(x);
  if (whole >= 2 && whole <= 4 && Math.abs(x - whole) < 0.1) return TIMES_WORD[whole];
  if (x >= 10) {
    const n = Math.round(x);
    return `у ${fmtInt(n)} ${plural(n, 'раз', 'рази', 'разів')}`;
  }
  const r = Math.round(x * 10) / 10;
  if (Number.isInteger(r)) return `у ${r} ${plural(r, 'раз', 'рази', 'разів')}`;
  return `у ${String(r).replace('.', ',')} раза`;
}

/**
 * Гроші-ставка: $4,20 / $0,82 / $0,041 / $0,0041.
 * fmtUsd на двох знаках перетворив би ціну 1k вихідних токенів на «$0,00»,
 * а fmtUsdFine дописав би «$0,8200» там, де вистачає двох знаків.
 */
export function fmtRateUsd(x) {
  const v = Number(x) || 0;
  const abs = Math.abs(v);
  if (abs >= 0.1) return fmtUsd(v);
  const digits = abs >= 0.01 ? 3 : 4;
  const [i, f] = abs.toFixed(digits).split('.');
  return `${v < 0 ? '−' : ''}$${i},${f}`;
}

/** Одиниця виміру ставки в тексті доказу. */
const METRIC_UNIT = {
  usdPerEdit: 'за правку',
  usdPerKOut: 'за 1k вихідних токенів',
};

// ------------------------------------------------------------ ставки сесії --

/**
 * Ставки однієї сесії. Кожна — null, коли знаменник нульовий.
 * Контекст = input + cacheRead + cacheWrite5m + cacheWrite1h (CONTRACT v1.8).
 *
 * @param {object} session сесія снапшота
 * @returns {{usdPerEdit:number|null, usdPerKOut:number|null,
 *            contextPerEdit:number|null, outputShare:number|null,
 *            costUsd:number, edits:number, output:number, context:number}}
 */
export function sessionRates(session) {
  const t = (session && session.totals) || {};
  const costUsd = t.costUsd || 0;
  const output = t.output || 0;
  const context = (t.input || 0) + (t.cacheRead || 0)
    + (t.cacheWrite5m || 0) + (t.cacheWrite1h || 0);
  const edits = Number(session && session.digest && session.digest.edits) || 0;
  const tokens = output + context;
  return {
    usdPerEdit: edits > 0 ? costUsd / edits : null,
    usdPerKOut: output > 0 ? costUsd / (output / 1000) : null,
    contextPerEdit: edits > 0 ? context / edits : null,
    outputShare: tokens > 0 ? output / tokens : null,
    costUsd,
    edits,
    output,
    context,
  };
}

/** Клас сесії: «правки» від 3 правок, інакше «аналіз». */
export function sessionClass(session) {
  const edits = Number(session && session.digest && session.digest.edits) || 0;
  return edits >= RETURN_RULES.editsThreshold ? CLASS_EDITS : CLASS_ANALYSIS;
}

/** Метрика, за якою судимо клас: правки — $ за правку, аналіз — $ за 1k виходу. */
export function classMetric(cls) {
  return cls === CLASS_EDITS ? 'usdPerEdit' : 'usdPerKOut';
}

const RATE_KEYS = ['usdPerEdit', 'usdPerKOut', 'contextPerEdit', 'outputShare'];

/**
 * Медіани ставок у межах класу (CONTRACT v1.8): рахуються ЛИШЕ по сесіях
 * від `minCostUsd` і лише там, де знаменник ненульовий — порожні сесії не
 * мають права тягнути норму вниз.
 *
 * `counts[metric]` — скільки САМЕ ЦЮ ставку дали сесій класу. Це і є
 * «порівнянні точки» захисту ≥8 (CONTRACT v1.6 §3): загальний `count`
 * бакета для нього не годиться — сесія без правок у нього входить, а в
 * медіану `usdPerEdit` — ні.
 *
 * @returns {{[CLASS_EDITS]:object, [CLASS_ANALYSIS]:object, all:object,
 *            minCostUsd:number, minPoints:number}} у кожному бакеті —
 *            медіани RATE_KEYS + count + counts
 */
export function baselines(sessions, {
  minCostUsd = RETURN_RULES.baseMinCostUsd,
  minPoints = RETURN_RULES.minBasePoints,
} = {}) {
  const bucket = () => ({ usdPerEdit: [], usdPerKOut: [], contextPerEdit: [], outputShare: [], n: 0 });
  const raw = {
    [CLASS_EDITS]: bucket(),
    [CLASS_ANALYSIS]: bucket(),
    all: bucket(),
  };

  for (const s of sessions || []) {
    const cost = (s && s.totals && s.totals.costUsd) || 0;
    if (!(cost >= minCostUsd)) continue;
    const rates = sessionRates(s);
    const b = raw[sessionClass(s)];
    b.n += 1;
    raw.all.n += 1;
    for (const k of RATE_KEYS) {
      if (rates[k] == null) continue;
      b[k].push(rates[k]);
      raw.all[k].push(rates[k]);
    }
  }

  const reduce = (b) => {
    const out = { count: b.n, counts: {} };
    for (const k of RATE_KEYS) {
      out[k] = median(b[k]);
      out.counts[k] = b[k].length;
    }
    return out;
  };

  return {
    [CLASS_EDITS]: reduce(raw[CLASS_EDITS]),
    [CLASS_ANALYSIS]: reduce(raw[CLASS_ANALYSIS]),
    all: reduce(raw.all),
    minCostUsd,
    minPoints,
  };
}

/** Скільки порівнянних точок має клас за СВОЄЮ метрикою (основа захисту ≥8). */
export function basePoints(base, cls) {
  const b = base && base[cls];
  if (!b || !b.counts) return 0;
  return b.counts[classMetric(cls)] || 0;
}

/** Скільки точок вимагає норма (з самих baselines або з правил). */
export function baseMinPoints(base) {
  return base && base.minPoints != null ? base.minPoints : RETURN_RULES.minBasePoints;
}

/** Чи сформована норма бодай в одному класі — інакше детекції немає взагалі. */
export function hasNorm(base) {
  if (!base) return false;
  const need = baseMinPoints(base);
  return basePoints(base, CLASS_EDITS) >= need || basePoints(base, CLASS_ANALYSIS) >= need;
}

/**
 * Індекс віддачі сесії проти медіани СВОГО класу.
 * `index > 1` — гірша віддача (одиниця роботи коштувала дорожче за норму).
 *
 * ЗАХИСТ (CONTRACT v1.6 §3, чинний і для v1.8): поки в класі менше ніж
 * `minPoints` порівнянних точок, `index` = null — норми ще немає, і множник
 * проти медіани з 3-5 спостережень нічого не доводить. Усі споживачі
 * (прапорці, дровер, картки, XLSX) ходять сюди, тож детекція вимикається
 * скрізь одночасно.
 *
 * @returns {{metric:string, value:number|null, median:number|null,
 *            index:number|null, class:string, points:number, enough:boolean,
 *            minPoints:number, rates:object, costUsd:number}}
 */
export function returnIndex(session, base, { minPoints = null } = {}) {
  const cls = sessionClass(session);
  const metric = classMetric(cls);
  const rates = sessionRates(session);
  const value = rates[metric];
  const med = base && base[cls] ? base[cls][metric] : null;
  const need = minPoints != null ? minPoints : baseMinPoints(base);
  const points = basePoints(base, cls);
  const enough = points >= need;
  const index = enough && value != null && med != null && med > 0 ? value / med : null;
  return {
    metric,
    value,
    median: med,
    index,
    class: cls,
    points,
    enough,
    minPoints: need,
    rates,
    costUsd: rates.costUsd,
  };
}

/**
 * Доказ у словах (CONTRACT v1.8):
 * «$4,20 за правку — утричі дорожче за вашу медіану ($1,40)»
 * «$0,82 за 1k вихідних токенів — удвічі дорожче за медіану ($0,41)»
 *
 * Біля самої медіани множник не пишемо взагалі: округлення дало б
 * самозаперечне «$0,31 за правку — у 1 раз дорожче за медіану ($0,31)».
 */
export function returnEvidence(ri) {
  if (!ri || ri.index == null) return null;
  const unit = METRIC_UNIT[ri.metric] || '';
  const rate = `${fmtRateUsd(ri.value)} ${unit}`;
  const med = fmtRateUsd(ri.median);
  // «за» вимагає знахідного («дешевше за вашу медіану»), «на рівні» — родового
  // («на рівні вашої медіани»): дві різні форми, не одна.
  const acc = ri.metric === 'usdPerEdit' ? 'за вашу медіану' : 'за медіану';
  const gen = ri.metric === 'usdPerEdit' ? 'вашої медіани' : 'медіани';
  if (ri.index <= 1 / RETURN_RULES.parIndex) {
    return `${rate} — дешевше ${acc} (${med})`;
  }
  if (ri.index < RETURN_RULES.parIndex) {
    return `${rate} — на рівні ${gen} (${med})`;
  }
  return `${rate} — ${timesPhrase(ri.index)} дорожче ${acc} (${med})`;
}

/**
 * Сесії зі слабкою віддачею. Замінює session-level детекцію аномалій:
 * порівнюється не сума, а ціна одиниці роботи.
 *
 * Сортування типово за `(index − 1) × costUsd` — «скільки грошей коштувала
 * саме погана віддача»; `sortBy: 'index'` дає найгірші за індексом.
 *
 * @param {Array} sessions
 * @param {{minIndex?:number, minCostUsd?:number, base?:object,
 *          sortBy?:'lost'|'index', limit?:number|null}} [opts]
 * @returns {Array} елементи — ГОТОВІ прапорці sessionFlags():
 *   {type:'LOW_RETURN', wasteUsd:0, evidence, …}. wasteUsd = 0 навмисно:
 *   це сигнал «подивись сюди», а не оцінка втрат — інакше вкладка «Фактори»
 *   задвоїла б суми. Оцінка окремо, полем `lostUsd`.
 */
export function lowReturnSessions(sessions, {
  minIndex = RETURN_RULES.minIndex,
  minCostUsd = RETURN_RULES.minCostUsd,
  base = null,
  sortBy = 'lost',
  limit = null,
} = {}) {
  const b = base || baselines(sessions);
  const out = [];

  for (const s of sessions || []) {
    if (!s) continue;
    const cost = (s.totals && s.totals.costUsd) || 0;
    if (!(cost >= minCostUsd)) continue;
    const ri = returnIndex(s, b);
    if (ri.index == null || !(ri.index >= minIndex)) continue;
    out.push({
      type: LOW_RETURN_FLAG,
      wasteUsd: 0,
      evidence: returnEvidence(ri),
      sessionId: s.sessionId,
      project: s.project || '—',
      title: s.title || s.sessionId,
      startedAt: s.startedAt || null,
      costUsd: cost,
      lostUsd: Math.max(0, (ri.index - 1) * cost),
      metric: ri.metric,
      value: ri.value,
      medianValue: ri.median,
      index: ri.index,
      basePoints: ri.points,
      class: ri.class,
      edits: ri.rates.edits,
    });
  }

  out.sort(sortBy === 'index'
    ? (a, b2) => b2.index - a.index
    : (a, b2) => b2.lostUsd - a.lostUsd);
  return limit ? out.slice(0, limit) : out;
}

/** sessionId → прапорець (O(1) для таблиці «Сесії» й дровера). */
export function indexBySession(list) {
  const map = new Map();
  for (const it of list || []) if (it && it.sessionId) map.set(it.sessionId, it);
  return map;
}

// ----------------------------------------------------------- рівень проєкту -

/**
 * Віддача проєктів: $ за правку. Беруться `topN` найдорожчих проєктів (там
 * лежать гроші), відсортовані за ставкою ↓ — найгірша віддача згори.
 * Проєкти без правок у зрізі відсутні: ділити нема на що.
 */
export function projectReturn(sessions, { topN = 8, minEdits = 1 } = {}) {
  const map = new Map();
  for (const s of sessions || []) {
    if (!s || !s.project) continue;
    const r = map.get(s.project) || { project: s.project, costUsd: 0, edits: 0, sessions: 0 };
    r.costUsd += (s.totals && s.totals.costUsd) || 0;
    r.edits += Number(s.digest && s.digest.edits) || 0;
    r.sessions += 1;
    map.set(s.project, r);
  }
  return [...map.values()]
    .filter((r) => r.edits >= minEdits && r.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, topN)
    .map((r) => ({ ...r, usdPerEdit: r.costUsd / r.edits }))
    .sort((a, b) => b.usdPerEdit - a.usdPerEdit);
}

/**
 * Медіана ставки $ за правку МІЖ ПРОЄКТАМИ — та сама популяція, що й
 * стовпчики `projectReturn` (сума витрат проєкту / його правки). Медіана
 * ПОСЕСІЙНИХ ставок для цієї лінії не годиться: дорога сесія з однією
 * правкою тягне агрегат проєкту вгору, а в посесійній медіані вона одна
 * точка — лінія систематично лежала б нижче за стовпчики.
 */
export function projectReturnMedian(sessions, { minEdits = 1, minProjects = 3 } = {}) {
  const rows = projectReturn(sessions, { topN: Infinity, minEdits });
  // Медіана з одного-двох проєктів лягла б рівно на стовпчик — лінія, що не
  // каже нічого; у такому зрізі краще не малювати її взагалі.
  if (rows.length < minProjects) return null;
  return median(rows.map((r) => r.usdPerEdit));
}

// -------------------------------------------------------------- рівень дня --

const KYIV = 'Europe/Kyiv';

/** ISO → 'YYYY-MM-DD' у поясі снапшота. */
function isoDayFormatter(timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || KYIV, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return (iso) => fmt.format(new Date(iso));
  } catch {
    return (iso) => new Date(iso).toISOString().slice(0, 10);
  }
}

/** Підпис-виноска до денної ставки — обов'язковий за контрактом. */
export const DAY_RETURN_FOOTNOTE =
  'правки віднесено до дня, коли сесія почалася';

/**
 * Денна віддача: $ за правку по днях + індекс проти медіанного дня.
 * Правки дня = сума `digest.edits` сесій, ЩО ПОЧАЛИСЯ цього київського дня
 * (сесія може тягнутися кілька діб — звідси виноска DAY_RETURN_FOOTNOTE).
 *
 * @returns {{rows:Array, byDay:Map<string,object>, medianUsdPerEdit:number|null,
 *            footnote:string}}
 */
export function dayReturn(days, sessions, timeZone = KYIV, {
  minCostUsd = RETURN_RULES.baseMinCostUsd,
} = {}) {
  const toDay = isoDayFormatter(timeZone);

  const cost = new Map();
  for (const d of days || []) {
    if (!d || !d.day) continue;
    cost.set(d.day, (cost.get(d.day) || 0) + (d.costUsd || 0));
  }

  const edits = new Map();
  for (const s of sessions || []) {
    const e = Number(s && s.digest && s.digest.edits) || 0;
    if (!e || !s.startedAt) continue;
    const day = toDay(s.startedAt);
    edits.set(day, (edits.get(day) || 0) + e);
  }

  const rows = [...cost.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, costUsd]) => {
      const e = edits.get(day) || 0;
      return {
        day,
        costUsd,
        edits: e,
        usdPerEdit: e > 0 ? costUsd / e : null,
        index: null,
        median: null,
      };
    });

  const med = median(
    rows.filter((r) => r.usdPerEdit != null && r.costUsd >= minCostUsd).map((r) => r.usdPerEdit)
  );
  for (const r of rows) {
    r.median = med;
    r.index = r.usdPerEdit != null && med != null && med > 0 ? r.usdPerEdit / med : null;
  }

  return {
    rows,
    byDay: new Map(rows.map((r) => [r.day, r])),
    medianUsdPerEdit: med,
    footnote: DAY_RETURN_FOOTNOTE,
  };
}

/**
 * Доказ для дня — теж ставками (CONTRACT v1.8: денна детекція лишається,
 * але формулювання стає відносним):
 * «$17,30 за правку — вчетверо дорожче за звичний день ($4,10)».
 * День без правок порівнювати нема з чим — кажемо це прямо, а не міряємо
 * суму проти суми.
 */
export function dayReturnEvidence(row) {
  if (!row) return null;
  if (row.usdPerEdit == null || row.index == null) {
    return 'правок у файлах цього дня не було — гроші пішли на розбір і перевірки';
  }
  if (row.index >= RETURN_RULES.dayWarnIndex) {
    return `${fmtRateUsd(row.usdPerEdit)} за правку — ${timesPhrase(row.index)} дорожче за звичний день (${fmtRateUsd(row.median)})`;
  }
  return `${fmtRateUsd(row.usdPerEdit)} за правку — як у звичайний день (${fmtRateUsd(row.median)}); витрати зросли за рахунок обсягу роботи`;
}

/**
 * Усе про віддачу за один виклик — зручно для мемоїзації в App.
 * @param {object} snapshot зріз {days, sessions, timezone}
 */
export function analyzeReturn(snapshot, opts = {}) {
  const sessions = (snapshot && snapshot.sessions) || [];
  const base = baselines(sessions, opts.baselines);
  const list = lowReturnSessions(sessions, { ...opts.low, base });
  return {
    baselines: base,
    list,
    byId: indexBySession(list),
    dayRates: dayReturn((snapshot && snapshot.days) || [], sessions,
      (snapshot && snapshot.timezone) || KYIV),
  };
}
