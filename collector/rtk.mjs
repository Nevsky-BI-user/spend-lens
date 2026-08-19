/**
 * spend-lens — збір статистики RTK (Rust Token Killer), CONTRACT v1.9.
 *
 * RTK — локальний CLI-проксі, що підрізає вивід команд ДО того, як він
 * потрапить у модель. Він веде власну статистику; spend-lens її лише читає.
 *
 * Два джерела (обидва — best-effort, жодне не може завалити збір):
 *   1. `rtk gain --format json --daily` → { summary, daily[] } — єдине надійне
 *      джерело чисел. `--history` / `--quota` для json НЕ реалізовані (віддають
 *      сам summary), тому їх не викликаємо.
 *   2. plain `rtk gain` → текстова таблиця «By Command»; парситься регуляркою,
 *      бо машинного формату для неї не існує. Провал парсу → commands: [].
 *
 * Контракт на помилки: відсутній бінар, ненульовий код, таймаут, побитий JSON —
 * усе це повертає null (або [] для команд) МОВЧКИ. Відсутність rtk — це норма,
 * а не проблема, тому в snapshot.warnings нічого не додається.
 *
 * Таймаут зобовʼязаний знімати ВСЕ дерево процесів і рвати stdio (див. killTree
 * і releaseChild): якщо rtk підвисне на заблокованій БД статистики, живий онук
 * триматиме успадкований pipe, 'close' не настане — і колектор, запущений із
 * Планувальника, не завершиться взагалі, залишивши без PDF увесь денний звіт.
 *
 * Дати з rtk — уже локальні календарні дні; НЕ перебудовуємо їх у Europe/Kyiv
 * (подвійне зсування зіпсувало б вирівнювання з days[]).
 *
 * Zero-dep: лише node:child_process.
 */

import { spawn, spawnSync } from 'node:child_process';

const TIMEOUT_MS = 5000;
const MAX_COMMANDS = 10;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Бінар rtk: аргумент → env → 'rtk'. Env потрібен для перевірки деградації
 *  (вказати неіснуючий шлях і переконатися, що збір не ламається). */
export function resolveRtkBin(binArg = null) {
  return binArg || process.env.SPEND_LENS_RTK_BIN || 'rtk';
}

/**
 * Убиває ВСЕ дерево процесів, а не лише прямого нащадка.
 *
 * Це принципово: на Windows прямий нащадок — це cmd.exe (і через shell-ретрай,
 * і тому, що rtk встановлений як npm-шим), а справжній rtk висить онуком.
 * `child.kill()` зняв би тільки cmd.exe, а онук лишився б жити й тримати
 * успадкований кінець pipe'а — саме через це колектор раніше не завершувався.
 */
function killTree(child) {
  const pid = child && child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    let killed = false;
    try {
      // Саме СИНХРОННО. Асинхронний taskkill не встигав: node виходив раніше,
      // ніж той стартував, а якби ми паралельно зробили child.kill(), то зняли
      // б cmd.exe і /T уже не знайшов би, чиїх онуків убивати.
      // Гілка таймауту рідкісна — десятки мілісекунд блокування тут безплатні.
      const r = spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 3000,
      });
      killed = !r.error && r.status === 0;
    } catch { /* немає taskkill — нижче звичайний kill */ }
    if (!killed) { try { child.kill(); } catch { /* вже мертвий */ } }
  } else {
    // detached:true дав нам власну групу процесів — знімаємо її цілком.
    try { process.kill(-pid, 'SIGKILL'); } catch {
      try { child.kill('SIGKILL'); } catch { /* вже мертвий */ }
    }
  }
}

/**
 * Відчіплює stdio й сам процес від event loop.
 *
 * Навіть після kill дескриптори лишаються відкритими, поки їх тримає бодай
 * один нащадок; без destroy() 'close' не настане ніколи, і libuv не дасть
 * ноді вийти. Тому після таймауту ми не чекаємо на 'close', а рвемо потоки.
 */
function releaseChild(child) {
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    try { stream.removeAllListeners(); } catch { /* байдуже */ }
    try { stream.destroy(); } catch { /* байдуже */ }
  }
  try { child.removeAllListeners(); } catch { /* байдуже */ }
  child.on('error', () => {}); // після unref помилки нікому ловити
  try { child.unref(); } catch { /* байдуже */ }
}

/**
 * Запускає бінар і повертає:
 *   { code, stdout }              — процес завершився сам;
 *   { code: null, timedOut: true} — не вклався в timeoutMs (дерево вбито);
 *   null                          — не вдалося навіть запустити (ENOENT тощо).
 * Ніколи не кидає і нічого не друкує (лог — лише у verbose колектора).
 */
function run(bin, args, { timeoutMs = TIMEOUT_MS, useShell = false } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      // shell:true — лише як ретрай; команду складаємо одним рядком, бо
      // масив аргументів разом із shell дає DEP0190 (їх би просто склеїли).
      const cmd = useShell ? `"${bin}" ${args.join(' ')}` : bin;
      child = spawn(cmd, useShell ? [] : args, {
        windowsHide: true,
        shell: useShell,
        stdio: ['ignore', 'pipe', 'pipe'],
        // POSIX: власна група процесів, щоб kill(-pid) зняв і онуків.
        // На Windows detached лише відкриває зайве вікно — там працює taskkill /T.
        detached: process.platform !== 'win32',
      });
    } catch {
      resolve(null);
      return;
    }

    let out = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      killTree(child);
      releaseChild(child);
      // Не чекаємо на 'close': його може не бути взагалі, якщо pipe тримає
      // онук. Повертаємо явний маркер таймауту — ретрай через shell на нього
      // не спрацьовує (інакше ми чекали б удруге й лишили друге дерево).
      finish({ code: null, timedOut: true, stdout: '' });
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      // Стеля на випадок, якщо колись rtk почне сипати мегабайти:
      // 4 МБ вистачає з запасом, далі просто не накопичуємо.
      if (out.length < 4 * 1024 * 1024) out += chunk;
    });
    child.stdout.on('error', () => {});
    child.stderr.on('data', () => {}); // stderr не потрібен, але його треба вичитати
    child.stderr.on('error', () => {});
    // ENOENT (немає бінара) приходить саме сюди
    child.on('error', () => finish(null));
    child.on('close', (code) => finish({ code, stdout: out }));
  });
}

/**
 * Запуск із одноразовим ретраєм через shell на Windows (rtk міг бути .cmd-шимом).
 * Ретрай — ЛИШЕ коли процес не запустився (null). Після таймауту повторювати
 * не можна: це ще одні timeoutMs очікування і ще одне дерево процесів.
 */
async function runResilient(bin, args, opts) {
  const first = await run(bin, args, opts);
  if (first || process.platform !== 'win32' || /\.(exe|com)$/i.test(bin)) return first;
  return run(bin, args, { ...opts, useShell: true });
}

// ------------------------------------------------------------------ json ----

function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function normalizeSummary(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    total_commands: num(s.total_commands),
    total_input: num(s.total_input),
    total_output: num(s.total_output),
    total_saved: num(s.total_saved),
    avg_savings_pct: num(s.avg_savings_pct),
    total_time_ms: num(s.total_time_ms),
    avg_time_ms: num(s.avg_time_ms),
  };
}

function normalizeDaily(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r === 'object' && DAY_RE.test(String(r.date || '')))
    .map((r) => ({
      date: String(r.date),
      commands: num(r.commands),
      input_tokens: num(r.input_tokens),
      output_tokens: num(r.output_tokens),
      saved_tokens: num(r.saved_tokens),
      savings_pct: num(r.savings_pct),
      total_time_ms: num(r.total_time_ms),
      avg_time_ms: num(r.avg_time_ms),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ------------------------------------------------------------------ text ----

// « 1.  rtk read                    470  183.6K    9.2%     2ms  ████ »
// Роздільник між назвою команди і лічильником — ДВА+ пробіли, тож команда
// з одинарними пробілами всередині («rtk git add -A») лишається цілою.
// У класі лічильника поруч зі звичайним пробілом стоїть вузький нерозривний
// (U+202F) — на випадок, якщо rtk колись почне розділяти тисячі.
const ROW_RE = /^\s*(\d{1,3})\.\s+(\S.*?)\s{2,}([\d,  ]+)\s+([\d.,]+\s*[KMGB]?)\s+([\d.,]+)\s*%/;

/** '183.6K' → 183600; '470' → 470; сміття → null. */
export function parseTokenCount(raw) {
  const s = String(raw || '').replace(/[, \s]/g, '');
  const m = /^([\d.]+)([KMGB]?)$/i.exec(s);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  const mult = { '': 1, K: 1e3, M: 1e6, G: 1e9, B: 1e9 }[m[2].toUpperCase()] ?? 1;
  return Math.round(base * mult);
}

/**
 * Best-effort парс таблиці «By Command» із текстового виводу `rtk gain`.
 * Машинного формату для неї немає, тому будь-яка невдача = порожній масив.
 * @returns {{command:string,count:number,savedTokens:number,avgPct:number}[]}
 */
export function parseCommandTable(text) {
  if (!text || typeof text !== 'string') return [];
  const rows = [];
  let seenHeader = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#\s+Command\b/.test(line)) { seenHeader = true; continue; }
    // Рядки до заголовка таблиці не чіпаємо: у зведенні згори теж є цифри.
    if (!seenHeader) continue;
    const m = ROW_RE.exec(line);
    if (!m) continue;
    const count = parseTokenCount(m[3]);
    const saved = parseTokenCount(m[4]);
    const pct = Number(String(m[5]).replace(',', '.'));
    const command = m[2].trim();
    if (!command || count == null || saved == null) continue;
    rows.push({
      command,
      count,
      savedTokens: saved,
      avgPct: Number.isFinite(pct) ? Math.round(pct * 10) / 10 : 0,
    });
    if (rows.length >= MAX_COMMANDS) break;
  }
  return rows;
}

// ------------------------------------------------------------------ api -----

/**
 * Збирає блок `rtk` для снапшота.
 * @returns {Promise<null | {collectedAt:string, summary:object, daily:object[], commands:object[]}>}
 *          null — rtk немає / він упав / вивід нечитабельний (це НЕ помилка).
 */
export async function collectRtk({ bin = null, timeoutMs = TIMEOUT_MS, verbose = false } = {}) {
  const exe = resolveRtkBin(bin);
  const vlog = (...a) => { if (verbose) console.log('[rtk]', ...a); };

  const why = (r) => (!r ? 'немає бінара' : r.timedOut ? `таймаут ${timeoutMs} мс` : `код ${r.code}`);

  const res = await runResilient(exe, ['gain', '--format', 'json', '--daily'], { timeoutMs });
  if (!res || res.code !== 0 || !res.stdout.trim()) {
    vlog(`пропущено (${why(res)})`);
    return null;
  }

  let parsed;
  try {
    // Деякі релізи можуть друкувати заголовок перед JSON — беремо від першої «{».
    const start = res.stdout.indexOf('{');
    parsed = JSON.parse(start > 0 ? res.stdout.slice(start) : res.stdout);
  } catch {
    vlog('пропущено (нечитабельний JSON)');
    return null;
  }

  const summary = normalizeSummary(parsed && parsed.summary);
  const daily = normalizeDaily(parsed && parsed.daily);
  if (!summary) {
    vlog('пропущено (у виводі немає summary)');
    return null;
  }

  // Таблиця команд — окремий, необовʼязковий запуск: її провал не скасовує решту.
  let commands = [];
  const textRes = await runResilient(exe, ['gain'], { timeoutMs });
  if (textRes && textRes.code === 0) commands = parseCommandTable(textRes.stdout);
  else vlog(`таблиця команд пропущена (${why(textRes)})`);
  vlog(
    `summary: ${summary.total_commands} команд, ${summary.total_saved} збережених токенів; ` +
    `днів: ${daily.length}; у таблиці команд: ${commands.length}`
  );

  return {
    collectedAt: new Date().toISOString(),
    summary,
    daily,
    commands,
  };
}
