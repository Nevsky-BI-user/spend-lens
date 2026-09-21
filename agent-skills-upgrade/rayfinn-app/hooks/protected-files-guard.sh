#!/bin/sh
# PreToolUse guard for Edit|Write (see hooks/README.md for the settings.json wiring).
#
# Enforces two CLAUDE.md rules:
#   1. "Не змінюй fabric.yaml і rayfin.yml без явного запиту."  -> hard block (exit 2)
#      Also covers rayfin/.lockfile.json and the generated src/fabric.generated.ts.
#   2. "Перед зміною DAX-запитів у *.dax спершу показуй план."  -> permissionDecision "ask"
#
# POSIX sh only (runs under Windows Git Bash). No jq dependency.

input=$(cat)

# Extract tool_input.file_path from the hook's stdin JSON (first "file_path" wins).
file_path=$(printf '%s' "$input" \
  | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | head -n 1)

# No file_path (or unexpected payload) — nothing to guard.
[ -z "$file_path" ] && exit 0

# Normalize Windows separators (JSON-escaped \\ or raw \) to / for matching.
norm=$(printf '%s' "$file_path" | sed 's/\\\\/\//g; s/\\/\//g')

case "$norm" in
  */fabric.yaml|fabric.yaml|*/rayfin.yml|rayfin.yml|*/rayfin/.lockfile.json|rayfin/.lockfile.json|*/fabric.generated.ts|fabric.generated.ts)
    cat >&2 <<'MSG'
БЛОКОВАНО: цей файл захищено правилом CLAUDE.md — «Не змінюй fabric.yaml і rayfin.yml без явного запиту.»
Захищені файли: fabric.yaml, rayfin/rayfin.yml, rayfin/.lockfile.json, src/fabric.generated.ts.
- fabric.yaml змінюється лише через CLI: `npx fabric-app-data add ...`
- src/fabric.generated.ts — згенерований файл: `npx fabric-app-data generate -o src/fabric.generated.ts` (ручні правки буде перезаписано)
- rayfin/rayfin.yml та rayfin/.lockfile.json керуються `npx rayfin ...`
Якщо користувач ЯВНО попросив саме цю правку — виконай її відповідною командою CLI або попроси користувача внести зміну вручну чи тимчасово вимкнути hook у .claude/settings.json.
MSG
    exit 2
    ;;
  *.dax)
    # Visible warning path: plain exit 0 + stderr is invisible to the model,
    # so surface the CLAUDE.md rule through the JSON "ask" decision instead.
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"CLAUDE.md: «Перед зміною DAX-запитів у *.dax спершу показуй план.» Якщо план ще не показано — спершу коротко поясни, що саме і чому зміниться в запиті (і які columnMetadata-ключі це зачепить), і дочекайся підтвердження."}}'
    exit 0
    ;;
esac

exit 0
