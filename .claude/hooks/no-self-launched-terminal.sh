#!/bin/sh
# PreToolUse guard for Bash|Write|Edit.
#
# Enforces the CLAUDE.md / CONTRACT.md rule: НІЩО не запускає термінал САМОЧИННО.
# Заборона стосується лише самочинного запуску — того, який агент або програма
# ініціює сама. Якщо користувач ЯВНО попросив видиме вікно, це дозволено.
# Саме тому хук не блокує (exit 2), а повертає permissionDecision "ask":
# явна вказівка користувача проходить через підтвердження, самочинний запуск —
# ні. Жорсткий блок тут був би неправильний: він забороняв би й те, що дозволено.
#
# POSIX sh only (runs under Windows Git Bash too). No jq dependency.

input=$(cat)

# Grab the fields that can carry a launch: Bash.command, Write.content,
# Edit.new_string. Newlines inside JSON strings are escaped as \n, so the whole
# payload collapses to one line per field — matching stays line-oriented.
payload=$(printf '%s' "$input" | sed -n 's/.*"\(command\|content\|new_string\)"[[:space:]]*:[[:space:]]*"\(.*\)/\2/p')

[ -z "$payload" ] && exit 0

# Newlines/tabs inside the JSON arrive escaped (\n, \r, \t). Without unescaping
# them "@echo off\npause" reads as "...offnpause" and the word boundary before
# `pause` never matches. Turn the escapes into spaces before any matching.
payload=$(printf '%s' "$payload" | sed 's/\\n/ /g; s/\\r/ /g; s/\\t/ /g')

# `--` before every pattern: patterns starting with `-` are otherwise read as
# grep options ("invalid option -- 'W'").
has() {
  printf '%s' "$payload" | grep -qiE -- "$1"
}

# Свідомий виняток за явним запитом користувача — маркер знімає перевірку.
has '([a-zA-Z0-9_.-]+:)?allow-window\(' && exit 0

hit=""

# `start` без /b (дозволена форма — саме з /b, як у scripts/refresh.cmd).
if [ -z "$hit" ] && has '(^|[^a-z])start[[:space:]]+' && ! has '(^|[^a-z])start[[:space:]]+[^&|]*/b([[:space:]]|$)'; then
  hit='cmd `start` без /b створює нове вікно консолі'
fi

# Start-Process без явного приховування.
if [ -z "$hit" ] && has 'Start-Process' && ! has 'Start-Process[^&|]*(-WindowStyle[[:space:]]+Hidden|-NoNewWindow)'; then
  hit='Start-Process без -WindowStyle Hidden / -NoNewWindow створює нове вікно'
fi

if [ -z "$hit" ] && has '(cmd(\.exe)?|%ComSpec%)[^&|]*[[:space:]]/k([[:space:]]|$)'; then
  hit='`cmd /k` навмисно лишає консоль відкритою'
fi
if [ -z "$hit" ] && has 'conhost(\.exe)?'; then
  hit='conhost.exe — це і є хост консольного вікна'
fi
if [ -z "$hit" ] && has '\-Window(Style)?[[:space:]]+(Normal|Maximized|Minimized)'; then
  hit='явне замовлення видимого вікна'
fi
if [ -z "$hit" ] && has '(^|[^a-z])(pause|Read-Host)([^a-z]|$)'; then
  hit='блокуючий запит вводу підвішує прихований запуск'
fi
if [ -z "$hit" ] && has 'timeout(\.exe)?[[:space:]]+/t[[:space:]]'; then
  hit='`timeout /t` утримує консоль «щоб устигнути прочитати»'
fi
if [ -z "$hit" ] && has '\.Exec[[:space:]]*\('; then
  hit='WshShell.Exec() завжди створює вікно для консольного процесу'
fi

[ -z "$hit" ] && exit 0

printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"ask\",\"permissionDecisionReason\":\"CLAUDE.md / CONTRACT.md «Process launch policy»: $hit. Самочинно (за розкладом, по кліку, у фоновому конвеєрі) так робити не можна — запускай приховано: -WindowStyle Hidden, windowsHide: true, wscript Shell.Run(...,0,...), --headless=new. Якщо це саме те, що користувач попросив ЯВНО — підтвердь дію і познач рядок маркером allow-window(<причина>) (префікс проєкту необовʼязковий), а причину додай у CONTRACT.md.\"}}"
exit 0
