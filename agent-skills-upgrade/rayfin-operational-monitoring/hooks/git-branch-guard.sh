#!/bin/sh
# git-branch-guard.sh — PreToolUse-hook (matcher: Bash|PowerShell) для спільного робочого дерева.
#
# У цій теці одночасно працюють кілька сесій Claude: файли, HEAD та індекс —
# спільні (docs/parallel-sessions.md). Хук блокує команди, які вже призводили
# до інцидентів «коміт пішов не туди» (тричі, 2026-08-12…17):
#   1) git add -A / git add --all / git add . / git commit -a — згрібають чужу
#      незакомічену роботу з дерева;
#   2) git commit, коли поточна гілка master — прямі коміти в master заборонені
#      (виняток: у репо триває merge, є .git/MERGE_HEAD — текст повідомлення
#      не перевіряємо, він підробний);
#   3) ланцюжок `git checkout … && … git commit` одним викликом — якщо хук чи
#      помилка заблокує середню ланку, попередні вже виконались, HEAD переїхав,
#      і коміт іде не туди. Git-кроки — тільки окремими викликами.
#
# Механіка Claude Code PreToolUse: на stdin приходить JSON виклику інструмента
# ({"tool_name":"Bash","tool_input":{"command":"…"}}); exit 2 БЛОКУЄ виклик, а
# stderr показується моделі. Будь-який інший exit-код — виклик проходить.
#
# Windows: хуки виконуються через Git Bash — скрипт свідомо POSIX sh, без
# GNU-only прапорців (grep -P, head --lines тощо). Зберігати з LF, не CRLF.

INPUT=$(cat)

# --- дістати tool_input.command: jq → python3 → python; не розпарсили — пропустити ---
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  PY=""
  command -v python3 >/dev/null 2>&1 && PY=python3
  [ -z "$PY" ] && command -v python >/dev/null 2>&1 && PY=python
  [ -z "$PY" ] && exit 0
  CMD=$(printf '%s' "$INPUT" | "$PY" -c \
    'import json,sys;print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' \
    2>/dev/null)
fi

[ -z "$CMD" ] && exit 0
case "$CMD" in *git*) ;; *) exit 0 ;; esac

# багаторядкову команду аналізуємо як один рядок
FLAT=$(printf '%s' "$CMD" | tr '\n' ' ')

block() {
  BR=$(git branch --show-current 2>/dev/null)
  echo "ЗАБЛОКОВАНО (git-branch-guard): $1" >&2
  echo "Поточна гілка: ${BR:-<не визначено>}" >&2
  echo "git status --short (перші 15 рядків — що зараз лежить у СПІЛЬНОМУ дереві):" >&2
  git status --short 2>/dev/null | head -n 15 >&2
  echo "Протокол: docs/parallel-sessions.md §3 — git-кроки ОКРЕМИМИ викликами; add лише явними шляхами; перед add і ще раз перед commit перевіряти git branch --show-current та git diff --staged --stat." >&2
  exit 2
}

# --- 3) ланцюжок checkout/switch + commit одним викликом ---------------------
if printf '%s' "$FLAT" | grep -qE '(^|[^[:alnum:]_.-])git[[:space:]]+(checkout|switch)' \
   && printf '%s' "$FLAT" | grep -qE '(^|[^[:alnum:]_.-])git[[:space:]]+commit' \
   && printf '%s' "$FLAT" | grep -qE '(&&|;)'; then
  block "ланцюжок 'git checkout/switch … && … git commit' одним викликом. Між ланками HEAD може переїхати під сусідньою сесією, а при блокуванні середньої ланки коміт піде в чужу гілку. Виконуй git-кроки окремими викликами, з перевіркою гілки перед commit."
fi

# --- 1) масові add і commit -a ----------------------------------------------
if printf '%s' "$FLAT" | grep -qE '(^|[^[:alnum:]_.-])git[[:space:]]+add[[:space:]]+(-A|--all)([^[:alnum:]-]|$)'; then
  block "git add -A / git add --all згрібає в індекс ЧУЖУ незакомічену роботу — у цьому дереві паралельно працюють кілька сесій. Додавай файли явними шляхами: git add <шлях> <шлях>."
fi
if printf '%s' "$FLAT" | grep -qE '(^|[^[:alnum:]_.-])git[[:space:]]+add[[:space:]]+\.(/)?([[:space:]]|;|$)'; then
  block "git add . згрібає в індекс ЧУЖУ незакомічену роботу — у цьому дереві паралельно працюють кілька сесій. Додавай файли явними шляхами: git add <шлях> <шлях>."
fi
# -a/-am/--all одразу після commit (хвіст не-алфанум ловить і -am"msg"),
# або standalone -a будь-де далі в команді (переставлені прапорці: -m x -a)
if printf '%s' "$FLAT" | grep -qE '(^|[^[:alnum:]_.-])git[[:space:]]+commit[[:space:]]+(-a|-am|--all)([^[:alnum:]-]|$)' \
   || printf '%s' "$FLAT" | grep -qE '(^|[^[:alnum:]_.-])git[[:space:]]+commit.*[[:space:]]-a([^[:alnum:]-]|$)'; then
  block "git commit -a комітить УСІ змінені файли дерева, включно з чужими. Спершу git add явними шляхами, потім git commit без -a."
fi

# --- 2) commit на master (дозволений лише merge-коміт) -----------------------
# Довіряємо лише стану репо (.git/MERGE_HEAD): текст повідомлення «Merge …»
# підробний і винятком НЕ є.
if printf '%s' "$FLAT" | grep -qE '(^|[^[:alnum:]_.-])git[[:space:]]+commit([[:space:]]|$)'; then
  BR=$(git branch --show-current 2>/dev/null)
  if [ "$BR" = "master" ]; then
    GITDIR=$(git rev-parse --git-dir 2>/dev/null)
    MERGING=no
    [ -n "$GITDIR" ] && [ -f "$GITDIR/MERGE_HEAD" ] && MERGING=yes
    if [ "$MERGING" = "yes" ]; then
      : # завершення merge — легальний коміт у master
    else
      block "прямий git commit у master. У master потрапляють лише merge-коміти (git merge --no-ff з фіча-гілки). Ймовірно, HEAD переїхав: створи/повернись на свою гілку (git checkout -b feature/<назва> або git checkout <своя-гілка>) і закоміть там; якщо коміт уже пішов не туди — cherry-pick на гілку від master (docs/parallel-sessions.md §3)."
    fi
  fi
fi

exit 0
