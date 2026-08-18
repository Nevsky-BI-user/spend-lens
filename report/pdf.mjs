// HTML → PDF через headless Chrome (або Edge — на Win11 присутній завжди).
// Пошук браузера: стандартні шляхи встановлення + реєстр (App Paths).
// Два шляхи друку:
//   htmlToPdf(html, pdf)  — legacy v1.2: file:///<абс. html> (render.mjs+svg.mjs);
//   printSite({...})      — v1.3: ефемерний node:http статик-сервер роздає
//     web/dist (збірку сайту) і web/public/data (свіжий снапшот) під
//     /spend-lens/*, Chrome друкує http://127.0.0.1:<port>/spend-lens/?print=...
//     з --virtual-time-budget (чекає фетч data/usage.json і рендер Recharts);
//     перед друком --dump-dom-проба перевіряє маркер #print-ready — без нього
//     друк фейлиться, а не мовчки віддає стан «Завантаження даних…».

import { existsSync, statSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

const APP_PATHS_KEY = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths';

/** Значення (default) ключа App Paths у реєстрі або null. */
function regAppPath(hive, exeName) {
  try {
    const out = execFileSync(
      'reg',
      ['query', `${hive}\\${APP_PATHS_KEY}\\${exeName}`, '/ve'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const m = out.match(/REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m);
    if (m) {
      let p = m[1].trim().replace(/^"|"$/g, '');
      // REG_EXPAND_SZ може містити %ProgramFiles% тощо
      p = p.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
      return p;
    }
  } catch {
    // ключа немає — не помилка
  }
  return null;
}

/** Знаходить chrome.exe (пріоритет) або msedge.exe. Повертає { exe, name } або null. */
export function findBrowser() {
  const pf = process.env.ProgramFiles;
  const pf86 = process.env['ProgramFiles(x86)'];
  const lad = process.env.LOCALAPPDATA;

  const chromePaths = [];
  for (const base of [pf, pf86, lad]) {
    if (base) chromePaths.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  for (const p of chromePaths) {
    if (existsSync(p)) return { exe: p, name: 'chrome' };
  }
  for (const hive of ['HKLM', 'HKCU']) {
    const p = regAppPath(hive, 'chrome.exe');
    if (p && existsSync(p)) return { exe: p, name: 'chrome' };
  }

  const edgePaths = [];
  for (const base of [pf86, pf]) {
    if (base) edgePaths.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  for (const p of edgePaths) {
    if (existsSync(p)) return { exe: p, name: 'edge' };
  }
  for (const hive of ['HKLM', 'HKCU']) {
    const p = regAppPath(hive, 'msedge.exe');
    if (p && existsSync(p)) return { exe: p, name: 'edge' };
  }

  return null;
}

/**
 * Друкує htmlPath у pdfPath. Кидає Error, якщо браузера немає, друк упав
 * (ненульовий exit-код) або PDF відсутній чи підозріло малий (≤10 КБ).
 * Перед друком видаляє залишок PDF від попереднього запуску — інакше старий
 * файл маскує невдалий друк, і надсилається вчорашній звіт.
 * Повертає { exe, name, sizeBytes }.
 */
export function htmlToPdf(htmlPath, pdfPath) {
  const browser = findBrowser();
  if (!browser) {
    throw new Error('Не знайдено chrome.exe або msedge.exe — немає чим надрукувати PDF.');
  }

  const absHtml = path.resolve(htmlPath);
  const absPdf = path.resolve(pdfPath);
  const fileUrl = 'file:///' + absHtml.replace(/\\/g, '/');

  // Прибираємо PDF попереднього запуску (той самий день → те саме імʼя файлу):
  // якщо він лишиться, перевірка existsSync нижче прийме СТАРИЙ файл за успіх.
  try {
    rmSync(absPdf, { force: true });
  } catch (err) {
    throw new Error(
      `Не вдалося видалити попередній PDF (${absPdf}): ${err.message}. ` +
      'Схоже, файл відкритий в іншій програмі — закрий переглядач PDF і повтори.'
    );
  }

  // Окремий тимчасовий профіль: не конфліктує із запущеним браузером користувача
  const profileDir = mkdtempSync(path.join(os.tmpdir(), 'spend-lens-pdf-'));

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${profileDir}`,
    '--no-pdf-header-footer',
    `--print-to-pdf=${absPdf}`,
    fileUrl,
  ];

  let result;
  try {
    result = spawnSync(browser.exe, args, {
      windowsHide: true,
      timeout: 120_000,
      encoding: 'utf8',
    });
  } finally {
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* профіль міг лишитись заблокованим */ }
  }

  const stderrTail = () =>
    (result.stderr || '').split(/\r?\n/).filter(Boolean).slice(-5).join(' | ') || '(порожньо)';

  if (result.error) {
    throw new Error(`Запуск ${browser.name} не вдався: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const code = result.status === null ? `сигнал ${result.signal || '?'} (таймаут?)` : `exit ${result.status}`;
    throw new Error(`Друк PDF упав (${browser.name}, ${code}). stderr: ${stderrTail()}`);
  }

  if (!existsSync(absPdf)) {
    throw new Error(`PDF не створено (${browser.name}, exit ${result.status}). stderr: ${stderrTail()}`);
  }

  const sizeBytes = statSync(absPdf).size;
  if (sizeBytes <= 10 * 1024) {
    throw new Error(`PDF підозріло малий (${sizeBytes} байт ≤ 10 КБ) — схоже, сторінка не відрендерилась: ${absPdf}`);
  }

  return { exe: browser.exe, name: browser.name, sizeBytes };
}

// ------------------------------------------------------- v1.3: printSite -----

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Ефемерний статик-сервер під base '/spend-lens/':
 *   /spend-lens/data/*  → dataDir (web/public/data — свіжий снапшот ВИГРАЄ,
 *                         навіть якщо в dist лежить стара копія data/);
 *   /spend-lens/*       → distDir (web/dist);
 *   /spend-lens/ або /spend-lens → index.html.
 * Захист від виходу за межі каталогу (path traversal), cache-control: no-store.
 */
function createStaticServer({ distDir, dataDir }) {
  const safeJoin = (baseDir, rel) => {
    const abs = path.normalize(path.join(baseDir, rel));
    const root = path.normalize(baseDir + path.sep);
    return abs.startsWith(root) || abs === path.normalize(baseDir) ? abs : null;
  };

  return createServer((req, res) => {
    const fail = (code, msg) => {
      res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(msg);
    };
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      if (pathname !== '/spend-lens' && !pathname.startsWith('/spend-lens/')) {
        return fail(404, 'not found (base /spend-lens/)');
      }
      const rel = pathname.slice('/spend-lens'.length).replace(/^\/+/, '');

      let abs;
      if (rel.startsWith('data/')) {
        abs = safeJoin(dataDir, rel.slice('data/'.length));
      } else {
        abs = safeJoin(distDir, rel === '' ? 'index.html' : rel);
      }
      if (!abs || !existsSync(abs) || !statSync(abs).isFile()) return fail(404, 'not found');

      const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(readFileSync(abs));
    } catch (err) {
      fail(500, `server error: ${err.message}`);
    }
  });
}

/** Асинхронний запуск браузера (сервер має відповідати, поки Chrome друкує).
 *  stdout збирається для --dump-dom (перевірка маркера #print-ready). */
function runBrowser(exe, args, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); resolve({ error, stdout, stderr }); });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr, timedOut });
    });
  });
}

/**
 * v1.3 «PDF = справжній сайт»: друкує сторінку зібраного сайту в PDF.
 *   distDir — web/dist (збірка Vite), dataDir — web/public/data (свіжий снапшот),
 *   urlPath — шлях із query, напр. '/spend-lens/?print=daily&date=2026-08-17',
 *   outPdf  — куди писати PDF.
 * Перед друком — проба готовності: --dump-dom з тим самим virtual-time-budget
 * має містити маркер #print-ready (рендериться лише після завантаження даних),
 * інакше кидаємо Error. Стале-PDF-guard (rmSync до друку), перевірки exit-коду,
 * наявності й розміру (>10 КБ) — ті самі, що в htmlToPdf.
 * Повертає { exe, name, sizeBytes, port }.
 */
export async function printSite({ distDir, dataDir, urlPath, outPdf, virtualTimeBudgetMs = 20_000 }) {
  const browser = findBrowser();
  if (!browser) {
    throw new Error('Не знайдено chrome.exe або msedge.exe — немає чим надрукувати PDF.');
  }
  if (!existsSync(path.join(distDir, 'index.html'))) {
    throw new Error(`Немає збірки сайту: ${path.join(distDir, 'index.html')} — запусти npm --prefix web run build.`);
  }

  const absPdf = path.resolve(outPdf);
  // Прибираємо PDF попереднього запуску: інакше старий файл маскує невдалий друк.
  try {
    rmSync(absPdf, { force: true });
  } catch (err) {
    throw new Error(
      `Не вдалося видалити попередній PDF (${absPdf}): ${err.message}. ` +
      'Схоже, файл відкритий в іншій програмі — закрий переглядач PDF і повтори.'
    );
  }

  const server = createStaticServer({ distDir, dataDir });
  const port = await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  const url = `http://127.0.0.1:${port}${urlPath}`;
  const baseArgs = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--no-pdf-header-footer',
    `--virtual-time-budget=${virtualTimeBudgetMs}`,
  ];

  const profiles = [];
  const makeProfile = () => {
    const p = mkdtempSync(path.join(os.tmpdir(), 'spend-lens-pdf-'));
    profiles.push(p);
    return p;
  };

  let result;
  try {
    // ПЕРЕВІРКА ГОТОВНОСТІ перед друком: --dump-dom тим самим virtual-time-budget.
    // Маркер #print-ready рендериться ЛИШЕ після завантаження даних (PrintReport.jsx);
    // сам по собі друк його не чекає — таймінг тримається на семантиці
    // --virtual-time-budget (пауза на pending fetch). Якщо браузер колись змінить
    // цю семантику (таке вже було під час міграції old→new headless), без цієї
    // перевірки надрукується стан «Завантаження даних…», який проходить поріг
    // розміру, — і порожній звіт мовчки піде поштою. Тут ми фейлимось гучно.
    const probe = await runBrowser(browser.exe, [
      ...baseArgs, `--user-data-dir=${makeProfile()}`, '--dump-dom', url,
    ]);
    if (probe.error) {
      throw new Error(`Перевірка готовності сторінки не вдалася (${browser.name}): ${probe.error.message}`);
    }
    if (probe.timedOut || probe.status !== 0) {
      const code = probe.timedOut
        ? 'таймаут 120 с'
        : (probe.status === null ? `сигнал ${probe.signal || '?'}` : `exit ${probe.status}`);
      throw new Error(`Перевірка готовності сторінки впала (${browser.name}, ${code}, ${url}).`);
    }
    const dom = probe.stdout || '';
    if (!dom.includes('id="print-ready"')) {
      const hint = dom.includes('Завантаження даних')
        ? 'сторінка так і лишилась у стані «Завантаження даних…» — virtual-time-budget не дочекався фетча'
        : dom.includes('error-note')
          ? 'сторінка показала помилку завантаження data/usage.json'
          : 'маркер #print-ready відсутній у DOM';
      throw new Error(`Сторінка друку не готова (${hint}): ${url}`);
    }

    result = await runBrowser(browser.exe, [
      ...baseArgs, `--user-data-dir=${makeProfile()}`, `--print-to-pdf=${absPdf}`, url,
    ]);
  } finally {
    server.close();
    for (const p of profiles) {
      try { rmSync(p, { recursive: true, force: true }); } catch { /* профіль міг лишитись заблокованим */ }
    }
  }

  const stderrTail = () =>
    (result.stderr || '').split(/\r?\n/).filter(Boolean).slice(-5).join(' | ') || '(порожньо)';

  if (result.error) {
    throw new Error(`Запуск ${browser.name} не вдався: ${result.error.message}`);
  }
  if (result.timedOut || result.status !== 0) {
    const code = result.timedOut
      ? 'таймаут 120 с'
      : (result.status === null ? `сигнал ${result.signal || '?'}` : `exit ${result.status}`);
    throw new Error(`Друк сайту в PDF упав (${browser.name}, ${code}, ${url}). stderr: ${stderrTail()}`);
  }
  if (!existsSync(absPdf)) {
    throw new Error(`PDF не створено (${browser.name}, ${url}). stderr: ${stderrTail()}`);
  }

  const sizeBytes = statSync(absPdf).size;
  if (sizeBytes <= 10 * 1024) {
    throw new Error(`PDF підозріло малий (${sizeBytes} байт ≤ 10 КБ) — схоже, сторінка не відрендерилась: ${absPdf}`);
  }

  return { exe: browser.exe, name: browser.name, sizeBytes, port };
}
