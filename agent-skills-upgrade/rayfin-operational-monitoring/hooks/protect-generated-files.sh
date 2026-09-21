#!/bin/sh
# protect-generated-files.sh — PreToolUse-hook (matcher: Edit|Write).
#
# Блокує РУЧНЕ редагування згенерованих/зібраних файлів — у кожного є своє
# джерело істини, і правка виходу мовчки губиться при наступній генерації:
#   • seed/metric_structure.json      ← генерує seed/build_structure.py
#   • rayfin/.temp/** (вкл. dab-config.json) ← перегенеровує rayfin CLI
#   • будь-який dab-config.json       ← згенерований конфіг DAB (лише інспекція)
#   • public/manual/*.pdf             ← збирає docs/manual/build.mjs
#
# Механіка Claude Code PreToolUse: stdin — JSON виклику інструмента; для
# Edit/Write шлях лежить у tool_input.file_path. exit 2 блокує виклик,
# stderr показується моделі.
#
# Windows: хуки виконуються через Git Bash — POSIX sh, без GNU-only прапорців;
# шляхи можуть приходити з бекслешами, тому нормалізуємо їх у слеші. LF, не CRLF.

INPUT=$(cat)

# --- дістати tool_input.file_path: jq → python3 → python; не розпарсили — пропустити ---
if command -v jq >/dev/null 2>&1; then
  FP=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  PY=""
  command -v python3 >/dev/null 2>&1 && PY=python3
  [ -z "$PY" ] && command -v python >/dev/null 2>&1 && PY=python
  [ -z "$PY" ] && exit 0
  FP=$(printf '%s' "$INPUT" | "$PY" -c \
    'import json,sys;print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' \
    2>/dev/null)
fi

[ -z "$FP" ] && exit 0
FP=$(printf '%s' "$FP" | tr '\\' '/')

deny() {
  echo "ЗАБЛОКОВАНО (protect-generated-files): $1" >&2
  echo "Файл: $FP" >&2
  exit 2
}

case "$FP" in
  */seed/metric_structure.json|seed/metric_structure.json)
    deny "seed/metric_structure.json ГЕНЕРУЄТЬСЯ скриптом seed/build_structure.py — руками не правити (правило .claude/rules/seed-dictionary.md). Треба змінити клас/домен/правило розрахунку показника → редагуй правила чи overrides у seed/build_structure.py і перегенеруй файл (скіл seed-refresh)." ;;
  */rayfin/.temp/*|rayfin/.temp/*)
    deny "rayfin/.temp/** — робочі артефакти rayfin CLI, перегенеровуються при кожному rayfin up. Правка живе до наступної збірки й нічого не змінює в застосунку. Джерело істини — rayfin/data/schema.ts і rayfin/rayfin.yml; dab-config.json звідси лише ЧИТАЮТЬ для інспекції політик (скіл policy-review, крок 3)." ;;
  */dab-config.json|dab-config.json)
    deny "dab-config.json — ЗГЕНЕРОВАНИЙ конфіг Data API Builder; його призначення тут — інспекція справжніх колонок у x-schema.fields після rayfin up db apply, а не редагування. Зміни політик — у rayfin/data/schema.ts (скіл schema-change)." ;;
  */public/manual/*.pdf|public/manual/*.pdf)
    deny "public/manual/*.pdf ЗБИРАЄТЬСЯ скриптом docs/manual/build.mjs (node docs/manual/build.mjs --force); зміст і верстка правляться в docs/manual/manual.html. Особлива політика коміту: щотижневе перезбирання свідомо лишає PDF незакоміченим, у git він іде лише разом із викоткою — крок у скілі deploy-checklist." ;;
esac

exit 0
