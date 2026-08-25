# PreToolUse-хуки для спільного робочого дерева

Два скрипти для `.claude/hooks/` цього репозиторію. Вони ДОПОВНЮЮТЬ наявний
інлайн-хук у `.claude/settings.json` (той, що блокує `rayfin up` /
`npm run dev`) — його лишити без змін, нові записи додаються поруч у той самий
масив `PreToolUse`.

| Скрипт | Матчер | Що стереже |
|---|---|---|
| `git-branch-guard.sh` | `Bash\|PowerShell` | інциденти спільного дерева: `git add -A` / `git add .` / `git commit -a`; прямий `git commit` у master (merge-коміти дозволені); ланцюжки `git checkout … && … git commit` одним викликом |
| `protect-generated-files.sh` | `Edit\|Write` | ручні правки згенерованих файлів: `seed/metric_structure.json`, `rayfin/.temp/**`, будь-який `dab-config.json`, `public/manual/*.pdf` |

## Встановлення

1. Скопіювати обидва `.sh` у `.claude/hooks/` (створити теку). Зберегти з
   **LF**, не CRLF — CRLF ламає shebang у Git Bash (`.gitattributes`:
   `.claude/hooks/*.sh text eol=lf`).
2. У `.claude/settings.json` домерджити до наявного `hooks.PreToolUse` два
   записи. Перший наявний rayfin-up-запис лишити без змін; нижче — лише два
   нові записи, які додаються ДО нього:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/git-branch-guard.sh\""
          }
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/protect-generated-files.sh\""
          }
        ]
      }
    ]
  }
}
```

`$CLAUDE_PROJECT_DIR` Claude Code підставляє сам (корінь проєкту) — команда
працює з будь-якої поточної теки, включно з git worktree. Git-команди в цьому
репо подекуди йдуть через інструмент PowerShell (CLAUDE.md: `git commit -F` під
PowerShell 5.1), тому матчер запису `git-branch-guard.sh` ставити одразу
`"Bash|PowerShell"` (як у наявного rayfin-up-хука) — формат stdin той самий.

## Механіка (довідково)

- PreToolUse-хук отримує на stdin JSON виклику інструмента; команда Bash — у
  `tool_input.command`, шлях Edit/Write — у `tool_input.file_path`.
- `exit 2` блокує виклик; stderr показується моделі (тому пояснення — розгорнуті,
  з поточною гілкою і зведенням `git status --short`). Будь-який інший код —
  виклик проходить.
- Парсинг JSON: `jq`, з фолбеком на `python3`/`python`. Якщо жодного немає —
  хук пропускає виклик (fail-open), щоб не заблокувати всю роботу; на цій
  машині `jq` є (ним користується наявний rayfin-up-хук).
- Обидва скрипти — POSIX sh без GNU-only прапорців: на Windows хуки виконуються
  через Git Bash.

## Межі

Хуки — евристика проти ТИПОВИХ форм небезпечних команд, а не повний парсер
shell. Екзотичні обходи (`git -C`, аліаси, скрипт-обгортка) вони не ловлять —
першоджерелом лишається протокол коміту в CLAUDE.md («Git-процес») і
docs/parallel-sessions.md; хук лише страхує від автопілоту.
