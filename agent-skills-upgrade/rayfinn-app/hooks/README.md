# protected-files-guard.sh

PreToolUse hook для Claude Code, який кодом закріплює два правила з CLAUDE.md:

| Файл / патерн | Дія | Чому |
|---|---|---|
| `fabric.yaml`, `rayfin/rayfin.yml`, `rayfin/.lockfile.json`, `src/fabric.generated.ts` | **Блок** (exit 2, українське повідомлення) | «Не змінюй fabric.yaml і rayfin.yml без явного запиту»; generated-файл перезаписується `npx fabric-app-data generate` |
| `*.dax` | **Ask** (`permissionDecision: "ask"`) | «Перед зміною DAX-запитів у `*.dax` спершу показуй план» — користувач бачить причину і підтверджує правку |
| решта | пропуск (exit 0) | — |

Чому саме так для `*.dax`: `exit 0` + stderr модель **не бачить** (вивід невидимий), тому
попередження подається через JSON-форму `{"hookSpecificOutput":{"permissionDecision":"ask",...}}`.
Якщо ваша версія Claude Code її не підтримує — замініть цю гілку на `exit 2` з тим самим
текстом у stderr (жорсткіше, але видимо для моделі).

## Встановлення

1. Скопіюйте `protected-files-guard.sh` у `.claude/hooks/` приватного репозиторію.
2. `chmod +x .claude/hooks/protected-files-guard.sh` (на Windows Git Bash не обовʼязково — запуск іде через `bash`).
3. Додайте в `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protected-files-guard.sh"
          }
        ]
      }
    ]
  }
}
```

Скрипт — чистий POSIX `sh` без залежностей (без `jq`), працює у Windows Git Bash;
Windows-шляхи з `\` нормалізуються перед перевіркою.

## Перевірка вручну

```bash
# Очікується exit 2 + повідомлення про блок:
echo '{"tool_input":{"file_path":"fabric.yaml"}}' | bash .claude/hooks/protected-files-guard.sh; echo "exit=$?"

# Очікується JSON з permissionDecision "ask":
echo '{"tool_input":{"file_path":"src/queries/team/team-kpis.dax"}}' | bash .claude/hooks/protected-files-guard.sh; echo "exit=$?"

# Очікується тихий exit 0:
echo '{"tool_input":{"file_path":"src/App.tsx"}}' | bash .claude/hooks/protected-files-guard.sh; echo "exit=$?"
```

## Обхід (свідомий)

Якщо користувач явно просить змінити захищений файл: зробіть це відповідною CLI-командою
(`npx fabric-app-data add/generate`, `npx rayfin ...`), або користувач вносить правку сам,
або тимчасово закоментуйте hook у `.claude/settings.json`. Hook навмисно не має «магічного»
слова для обходу — це захист від тихих правок, а не від людини.
