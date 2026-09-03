#!/usr/bin/env node
// window-lint.mjs — примусова перевірка політики «жодного самочинного термінала».
//
// Заборона стосується ЛИШЕ запуску, який програма чи агент ініціює САМА:
// за розкладом, по кліку, у фоновому конвеєрі. Якщо користувач явно попросив
// видиме вікно — це дозволено, але має бути позначено маркером у коді:
//     spend-lens:allow-window(<коротка причина>)   (префікс проєкту необовʼязковий)
// у коментарі того самого рядка або рядка безпосередньо над ним. Для правил
// рівня 'visible' та сама причина має бути описана в CONTRACT.md → «Process
// launch policy», інакше маркер не діє (політика вимагає письмового обґрунтування).
//
// Запуск:
//   node scripts/window-lint.mjs            # усе дерево (так само --all)
//   node scripts/window-lint.mjs --staged   # лише проіндексовані файли (pre-commit)
//   node scripts/window-lint.mjs --list     # показати правила і вийти
//   node scripts/window-lint.mjs --root <dir>   # будь-який інший проєкт
//
// --root знімає білий список каталогів spend-lens і сканує все дерево вказаної
// теки (крім node_modules, dist, build і подібних): правила однакові для всіх
// проєктів, специфічна для spend-lens лише розкладка тек.
// Код виходу: 0 — чисто; 1 — знайдено порушення; 2 — помилка самого лінтера.
//
// Zero-dep: лише node:fs / node:path / node:child_process (для --staged).
// Сам лінтер підкоряється тій самій політиці: нічого не запускає у видимому вікні.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SELF_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// --root <dir> перемикає лінтер на чуже дерево. Розбираємо аргумент тут, бо від
// нього залежать і корінь сканування, і те, чи діє білий список тек spend-lens.
function argRoot(argv) {
  const i = argv.indexOf('--root');
  if (i === -1) return null;
  const value = argv[i + 1];
  if (!value || value.startsWith('--')) {
    console.error('window-lint: --root потребує шляху до теки проєкту.');
    process.exit(2);
  }
  return resolve(value);
}

const FOREIGN_ROOT = argRoot(process.argv.slice(2));
const ROOT = FOREIGN_ROOT || SELF_ROOT;

// Кожне правило перевірено на реальному дереві: 0 хибних спрацювань.
// level: 'visible' — доведене вікно; 'risk' — залежить від умов.
// Обидва рівні валять перевірку; різниця в тому, що маркер для 'visible'
// додатково вимагає абзацу в CONTRACT.md.
const RULES = [
  { id: 1,  level: 'visible', ext: ['.cmd', '.bat', '.ps1', '.psm1'], re: /(?:^|[&|@(]\s*)\s*pause\b/i,
    msg: '`pause` блокує процес до натискання клавіші; у прихованому запуску натискати нікому — завдання висить.' },
  { id: 2,  level: 'visible', ext: ['.ps1', '.psm1'], re: /\bRead-Host\b/i,
    msg: '`Read-Host` чекає на ввід зі stdin, якого в прихованому запуску немає — завдання висить до ExecutionTimeLimit.' },
  { id: 3,  level: 'visible', ext: ['.cmd', '.bat', '.ps1', '.psm1'], re: /\btimeout(?:\.exe)?["']?\s+[/-]t\b/i,
    msg: '`timeout /t` утримує консоль «щоб устигнути прочитати» — у прихованому запуску лише зʼїдає ліміт виконання.' },
  { id: 4,  level: 'risk', ext: ['.ps1', '.psm1'], re: /\bStart-Process\b(?![^\n]*(?:-WindowStyle\s+Hidden|-NoNewWindow))/i,
    msg: '`Start-Process` без -WindowStyle Hidden / -NoNewWindow створює НОВЕ вікно, навіть із прихованого батька.' },
  { id: 5,  level: 'visible', ext: ['.ps1', '.psm1', '.cmd', '.bat', '.vbs', '.mjs', '.js'], re: /-Window(?:Style)?\s+(?:Normal|Maximized|Minimized)\b/i,
    msg: 'Явне замовлення видимого вікна (Minimized теж створює вікно і краде фокус).' },
  { id: 6,  level: 'visible', ext: ['.ps1', '.psm1', '.cmd', '.bat', '.vbs', '.mjs', '.js'], re: /\b(?:cmd(?:\.exe)?|%ComSpec%)\b["']?(?:\s+\/[a-z]+)*\s+\/k\b/i,
    msg: '`cmd /k` навмисно лишає консоль відкритою після виконання — гарантований висячий процес під розкладом.' },
  { id: 7,  level: 'visible', ext: ['.ps1', '.psm1', '.cmd', '.bat', '.vbs', '.mjs', '.js'], re: /\bconhost(?:\.exe)?\b(?!\s*--headless)/i,
    msg: 'conhost.exe — це і є хост консольного вікна Windows; згадка в операційному коді означає навмисне вікно.' },
  { id: 8,  level: 'visible', ext: ['.cmd', '.bat'], re: /(?:^|[&|(]\s*|@)\s*start\b(?![^\n]*\/b\b)/i,
    msg: '`start` без /b створює нове вікно консолі (як і /min, /max, /wait).' },
  { id: 9,  level: 'risk', ext: ['.mjs', '.js'], multiline: true,
    re: /(?<![.\w$])(?<!function\s)(?:(?:child_process|childProcess|cp)\.)?(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\s*\((?![^;]{0,400}windowsHide\s*:\s*true)/,
    msg: 'Node на Windows показує вікно консолі дочірнього процесу; вимкнути це може лише windowsHide: true.' },
  { id: 10, level: 'risk', ext: ['.mjs', '.js'], multiline: true,
    re: /\[(?![^\]]{0,600}(?:--headless|\.\.\.[A-Za-z_$]))[^\]]{0,600}--(?:print-to-pdf|dump-dom|user-data-dir|remote-debugging-port)|headless\s*:\s*false/,
    msg: 'Запуск браузера без --headless відкриває повноцінне вікно (windowsHide ховає лише консоль, не GUI).' },
  { id: 11, level: 'visible', ext: ['.ps1', '.psm1', '.cmd', '.bat'],
    re: /\bschtasks\b[^\n]*\/TR\b(?![^\n]*-Window(?:Style)?\s+Hidden)[^\n]*(?:powershell|pwsh|cmd\.exe|cscript)/i,
    msg: 'Рядок /TR виконується щодня: консольний хост без -WindowStyle Hidden показує вікно на кожному запуску.' },
  { id: 12, level: 'visible', ext: ['.vbs', '.vbe', '.wsf'], re: /\.Run\s*\(?\s*[^,\n()]+(?:,(?!\s*0\s*[,)])|[)\r\n]|$)/i,
    msg: 'WScript.Shell.Run: другий аргумент — стиль вікна; 0 = приховане, пропущений або інший = видиме.' },
  { id: 13, level: 'risk', ext: ['.mjs', '.js', '.json'], re: /\bopen\s*:\s*true\b|\bvite\b[^\n]*\s(?:--open\b|-o\b)/i,
    msg: 'Vite з open:true / --open відкриває вікно браузера при старті.' },
  { id: 14, level: 'risk', ext: ['.ps1', '.psm1', '.cmd', '.bat', '.vbs', '.mjs', '.js'],
    re: /-NoProfile\b(?![^\n]*-Window\w*\s+Hidden)[^\n]*-(?:File|Command|EncodedCommand)\b/i,
    msg: 'Зібраний рядок запуску PowerShell без -WindowStyle Hidden — вікно зʼявиться на весь час роботи скрипта.' },
  { id: 15, level: 'risk', ext: ['.ps1', '.psm1'], re: /\bcmd(?:\.exe)?\s+(?:\/[a-z]\s+)*\/c\b(?![^\n]*(?:\||>|Out-File))/i,
    msg: '`cmd.exe /c` дозволений лише з перенаправленим виводом — інакше він не перевикористовує приховану консоль батька.' },
  { id: 16, level: 'risk', ext: ['.ps1', '.psm1'], re: /\bStart-Sleep\b/i,
    msg: '`Start-Sleep` — PowerShell-відповідник `timeout /t`; якщо це не ретрай, а «щоб побачити вікно», це порушення.' },
  { id: 17, level: 'visible', ext: ['.vbs', '.vbe', '.wsf'], re: /\.Exec\s*\(/,
    msg: 'WshShell.Exec() не має параметра стилю вікна: для консольного процесу вікно створюється завжди.' },
];

// Білий список: скануємо лише операційний код. Усе інше (документація, браузерний
// код, node_modules, сторонній підпроєкт agent-skills-upgrade) — поза скоупом.
const SCAN_DIRS = ['scripts', 'collector', 'report'];
const SCAN_FILES = ['web/vite.config.js'];
const SCAN_EXT = new Set(['.ps1', '.psm1', '.cmd', '.bat', '.vbs', '.vbe', '.wsf', '.mjs', '.js']);
const EXCLUDE_RE = /(^|\/)(\.git|node_modules|dist|out|build|coverage|vendor|target|\.venv|\.next|\.cache|agent-skills-upgrade|web\/src|web\/public|web\/dist)(\/|$)/;
// Сам лінтер зі сканування виключено: він цитує заборонені патерни в рядкових
// літералах правил, а не запускає процеси. Його єдиний виклик git — з windowsHide.
// Порівнюємо за іменем файлу, щоб копія лінтера в чужому дереві теж не ловила себе.
const SELF = 'scripts/window-lint.mjs';
function isSelf(rel) { return rel === SELF || rel.endsWith('/window-lint.mjs'); }

// Префікс проєкту необовʼязковий: у spend-lens маркер пишуть як
// spend-lens:allow-window(...), в іншому проєкті достатньо allow-window(...).
const MARKER_RE = /(?:[\w.-]+:)?allow-window\(([^)]+)\)/i;

function toPosix(p) { return p.split(sep).join('/'); }

function collectFiles(dir, acc) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const full = join(dir, name);
    const rel = toPosix(relative(ROOT, full));
    if (EXCLUDE_RE.test(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) collectFiles(full, acc);
    else if (SCAN_EXT.has(extname(name)) && !isSelf(rel)) acc.push(rel);
  }
  return acc;
}

function targetFiles(staged) {
  if (!staged) {
    const acc = [];
    if (FOREIGN_ROOT) {
      // Чужий проєкт: розкладка тек невідома, тому скануємо все дерево.
      collectFiles(ROOT, acc);
    } else {
      for (const d of SCAN_DIRS) collectFiles(join(ROOT, d), acc);
      for (const f of SCAN_FILES) if (existsSync(join(ROOT, f))) acc.push(f);
    }
    return acc.sort();
  }
  // --staged: лише проіндексовані файли, щоб не гальмувати комміт.
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  return out.split('\n').map(s => s.trim()).filter(Boolean)
    .filter(f => !EXCLUDE_RE.test(f))
    .filter(f => SCAN_EXT.has(extname(f)))
    .filter(f => FOREIGN_ROOT || SCAN_DIRS.some(d => f.startsWith(d + '/')) || SCAN_FILES.includes(f))
    .filter(f => !isSelf(f))
    .filter(f => existsSync(join(ROOT, f)));
}

// Зрізає коментарі, поважаючи лапки: без цього правила ловлять текст політики
// у шапках скриптів (перевірено — 4 хибні спрацювання без зрізання).
function stripComments(line, ext, state) {
  if (ext === '.cmd' || ext === '.bat') {
    if (/^\s*(@?rem\b|::)/i.test(line)) return '';
    return line;
  }
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (state.block) {
      if (ch === '*' && next === '/') { state.block = false; i++; }
      continue;
    }
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      // У PowerShell і VBS апостроф-коментар можливий лише поза лапками.
      if (ch === "'" && (ext === '.vbs' || ext === '.vbe' || ext === '.wsf')) break;
      quote = ch; out += ch; continue;
    }
    if ((ext === '.ps1' || ext === '.psm1') && ch === '#') break;
    if ((ext === '.mjs' || ext === '.js') && ch === '/' && next === '/') break;
    if ((ext === '.mjs' || ext === '.js') && ch === '/' && next === '*') { state.block = true; i++; continue; }
    out += ch;
  }
  return out;
}

// Обґрунтування маркера шукаємо в документах політики самого проєкту, що
// сканується: у spend-lens це CONTRACT.md, в інших проєктах — CLAUDE.md.
function contractText() {
  let text = '';
  for (const name of ['CONTRACT.md', 'CLAUDE.md']) {
    const p = join(ROOT, name);
    if (existsSync(p)) text += ' ' + readFileSync(p, 'utf8');
  }
  return text.toLowerCase().replace(/\s+/g, ' ');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    for (const r of RULES) console.log(`#${r.id} [${r.level}] ${r.ext.join(',')}  ${r.re}`);
    return 0;
  }
  const staged = argv.includes('--staged');
  const files = targetFiles(staged);
  const contract = contractText();
  const violations = [];
  let scanned = 0;

  for (const rel of files) {
    const ext = extname(rel);
    let text;
    try { text = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
    scanned++;
    const raw = text.split(/\r?\n/);

    // Маркери збираємо ДО зрізання коментарів — вони живуть саме в коментарях.
    const markers = new Map();
    raw.forEach((line, i) => {
      const m = line.match(MARKER_RE);
      if (m) markers.set(i + 1, m[1].trim());
    });

    const state = { block: false };
    const codeLines = raw.map(line => stripComments(line, ext, state));

    const record = (rule, lineNo) => {
      const reason = markers.get(lineNo) || markers.get(lineNo - 1);
      const line = (raw[lineNo - 1] || '').trim();
      if (reason) {
        if (rule.level === 'risk') return;
        const norm = reason.toLowerCase().replace(/\s+/g, ' ');
        if (contract.includes(norm)) return;
        violations.push({ rel, lineNo, rule, line,
          extra: `маркер є, але його причини («${reason}») немає в CONTRACT.md → Process launch policy` });
        return;
      }
      violations.push({ rel, lineNo, rule, line, extra: '' });
    };

    // Однорядкові правила.
    codeLines.forEach((code, i) => {
      if (!code.trim()) return;
      for (const rule of RULES) {
        if (rule.multiline) continue;
        if (!rule.ext.includes(ext)) continue;
        if (rule.re.test(code)) record(rule, i + 1);
      }
    });

    // Правила, чий лукахед перетинає рядки (опції spawn часто на наступному рядку):
    // матчимо по всьому тексту, номер рядка рахуємо з позиції збігу.
    const codeText = codeLines.join('\n');
    for (const rule of RULES) {
      if (!rule.multiline) continue;
      if (!rule.ext.includes(ext)) continue;
      const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
      let m;
      while ((m = re.exec(codeText)) !== null) {
        const lineNo = codeText.slice(0, m.index).split('\n').length;
        record(rule, lineNo);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }

  if (!violations.length) {
    const where = FOREIGN_ROOT ? ` у ${FOREIGN_ROOT}` : '';
    console.log(`window-lint: чисто${where} — ${scanned} файл(ів), 0 порушень (${RULES.length} правил).`);
    return 0;
  }
  console.error(`window-lint: ${violations.length} порушень політики «жодного самочинного термінала»\n`);
  for (const v of violations) {
    console.error(`${v.rel}:${v.lineNo}  [правило #${v.rule.id}, ${v.rule.level}]`);
    console.error(`  ${v.line}`);
    console.error(`  ${v.rule.msg}`);
    if (v.extra) console.error(`  ${v.extra}`);
    console.error('');
  }
  console.error('Якщо видиме вікно тут — це ЯВНА вимога користувача, познач рядок маркером');
  console.error('  spend-lens:allow-window(<причина>)');
  console.error('у коментарі того самого або попереднього рядка; для правил рівня "visible"');
  console.error('ту саму причину додай у CONTRACT.md → «Process launch policy».');
  return 1;
}

try {
  process.exit(main());
} catch (err) {
  console.error('window-lint: внутрішня помилка —', err && err.message ? err.message : err);
  process.exit(2);
}
