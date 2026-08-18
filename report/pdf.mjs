// HTML → PDF через headless Chrome (або Edge — на Win11 присутній завжди).
// Пошук браузера: стандартні шляхи встановлення + реєстр (App Paths).
// Друк: --headless=new --print-to-pdf="<абс. шлях>" file:///<абс. html>.

import { existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
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
