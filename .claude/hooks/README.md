# privacy-guard.sh

PreToolUse hook для інструмента `Bash` у Claude Code. Кодом закріплює правило
[CONTRACT.md](../../CONTRACT.md) → «Privacy»: репозиторій публічний, реальні дані
лежать поруч із кодом, і єдиний їхній захист — `.gitignore`. Хук не дає агентові
індексувати наосліп або поіменно додати приватний файл.

| Команда | Дія | Чому |
|---|---|---|
| `git add -A`, `git add --all`, `git add .`, `git add ./`, `git add :/`, `git add *`, комбіновані прапорці з `A` (`-Af`, `-vA`) | **Блок** (exit 2, українське повідомлення) | Масове додавання ставить усі приватні файли на один рядок у `.gitignore`. Файли додаються поіменно. |
| `git add -f` / `--force` (і комбіновані `-fv`) | **Блок** | `-f` обходить `.gitignore` — тобто саме той механізм, що тримає `usage.json` і `.env` поза git. |
| `git add <шлях>` або `git commit … <шлях>`, де шлях — `.env`, `.env.*` (крім `.env.example`), `collector/.cache/…`, `collector/projects.json`, `report/out/…`, `*.pdf`, будь-який `usage.json` | **Блок** | Це блок `PRIVACY-CRITICAL` з `.gitignore`: ключі, логи з реальними назвами, реальні витрати, готові звіти. Лапки й Windows-роздільники `\` нормалізуються. |
| те саме, але в **іншому репозиторії**: `cd /home/user/rayfinn-app && git add -A`, `git -C ../other add .`, або `cwd` сесії поза spend-lens | пропуск (exit 0, без виводу) | Хук стереже лише цей репозиторій. Корінь — `$CLAUDE_PROJECT_DIR` (без нього — репозиторій, де лежить скрипт), стартова тека — `cwd` з payload; `cd`, `pushd`, `popd` і `git -C` відстежуються між сегментами. |
| решта (`git status`, `git add README.md`, `git commit -am …`, не-git команди, а також `echo`/`grep`, що лише згадують `git add -A`) | пропуск (exit 0, без виводу) | — |

Команда розбивається на прості команди за `;`, `|`, `&`, новим рядком і дужками,
тому `cd web && git add .` теж блокується. Перевіряється лише команда, яка
справді починається з `git` (після `sudo`, `env`, `VAR=x` тощо), — рядок у
`grep` чи `echo` хук не чіпає. Глобальні опції `git -C <dir> add …` розуміє.

Тека, яку не можна обчислити (`cd $VAR`, `cd ~user`, `cd -` без історії,
`popd`), вважається **всередині** проєкту — помилка в бік блокування. Шляхи
Windows (`C:\…`) і Git Bash (`/c/…`) зводяться до одного вигляду перед
порівнянням.

Що хук **не** робить: не перевіряє `Edit`/`Write` (це не шлях у git) і не
замінює `.gitignore`. Він — друга лінія, не перша.

Обмеження: хук бачить текст команди, а не її семантику. Heredoc чи рядок
тексту, у якому трапляється `&& git add .`, теж заблокується — такі тексти
пишіть через інструмент `Write`, а не через `cat <<EOF` у `Bash`. Це свідома
ціна за простий POSIX-скрипт без парсера оболонки.

## Встановлення

Усе вже в репозиторії: `.claude/settings.json` викликає скрипт на кожен `Bash`.
На Windows Git Bash `chmod +x` не потрібен — запуск іде через `bash`. Скрипт
виконується всередині процесу Claude Code і вікна не відкриває (CLAUDE.md §1).

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/privacy-guard.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Розбір JSON зі stdin: `jq`, якщо є; інакше `python3`, інакше `python`; без
жодного з них — приблизний `sed`, який може захопити зайве, але не пропустити.
На Windows достатньо Git Bash + Python.

## Перевірка вручну

```bash
# Очікується exit 2 + повідомлення про блок:
echo '{"tool_input":{"command":"git add -A"}}' | bash .claude/hooks/privacy-guard.sh; echo "exit=$?"
echo '{"tool_input":{"command":"cd web && git add ."}}' | bash .claude/hooks/privacy-guard.sh; echo "exit=$?"
echo '{"tool_input":{"command":"git add collector/.env"}}' | bash .claude/hooks/privacy-guard.sh; echo "exit=$?"

# Очікується тихий exit 0:
echo '{"tool_input":{"command":"git add README.md RUNBOOK.md"}}' | bash .claude/hooks/privacy-guard.sh; echo "exit=$?"
echo '{"tool_input":{"command":"git add collector/.env.example"}}' | bash .claude/hooks/privacy-guard.sh; echo "exit=$?"
echo '{"tool_input":{"command":"git status"}}' | bash .claude/hooks/privacy-guard.sh; echo "exit=$?"
```

## Обхід (свідомий)

Хук не має «магічного» слова для обходу. Якщо файл справді має бути в git —
приберіть його з `.gitignore` і додайте поіменно без `-f`. Якщо треба саме
`git add -A` — користувач набирає команду сам у своїй оболонці або тимчасово
вимикає hook у `.claude/settings.json`. Це захист від тихих помилок агента, а не
від людини.
