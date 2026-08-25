# agent-skills-upgrade — пакет прокачки скілів, агентів та інструкцій

Результат аудиту екосистеми скілів (5 репозиторіїв + synced-набір claude.ai),
аналізу двох проєктів (Rayfin_Operational_Monitoring, rayfinn-app) і дослідження
ринку скілів. Повний звіт — `REPORT.md`.

## Головні висновки за 30 секунд

1. **Дрейф бібліотек — доведений**: 37 із 45 спільних скілів мають розбіжні копії
   (див. `scripts/drift-report-2026-08-25.txt`). Synced-копії на claude.ai
   **старіші за виправлення від 2026-07-11**: `dax-svg` там досі вчить баговану
   схему ескейпінгу без `%→%25`, а `icon-set-manager` — незаповнений шаблон
   з неробочими командами. Хмарні сесії реально працюють на гірших скілах, ніж локальні.
2. **Конфлікти тригерингу**: `power-bi-dax-optimization` ніколи не вигравав у
   `dax-measures` (той сам claims «optimize»); голе «намалюй» у `dax-svg` крало
   запити Deneb; `pbip-pr-reviewer` стріляв у будь-якому репо. Виправлено новими
   описами за деревом маршрутизації (`routing/skill-routing.md`).
3. **Півтора скіла були недописані**: обіцяний `dax-svg/references/recipes.md`
   не існував ніде (написаний тут), `power-bi-dax-optimization` був конвертованим
   ChatGPT-промптом (замінений повноцінним `dax-optimization`).

## Що в пакеті

```
skills/                    ← готові до заливки скіли (canonical-тіла з marketplace + нові описи)
  dax-measures/            оновлений опис: без «optimize», межі за наміром
  dax-svg/                 оновлений опис (комірка!) + НОВИЙ references/recipes.md (10 рецептів)
  deneb-vegalite/          оновлений опис (канва!)
  icon-set-manager/        опис без зайвих деталей + «намалюй іконку»
  pbip-pr-reviewer/        опис зі скоупом на PBIP-файли
  dax-optimization/        НОВИЙ скіл — єдиний власник performance (заміна power-bi-dax-optimization)
routing/
  skill-routing.md         дерево з 5 питань + снипет для CLAUDE.md + гігієна каналів
  trigger-probe-corpus.md  корпус промптів для перевірки тригерингу (claude -p / plugin eval)
scripts/
  skill_drift_check.py     детектор розсинхрону бібліотек (stdlib, exit 1 при дрейфі)
  drift-report-2026-08-25.txt  знімок поточного дрейфу (з цієї сесії)
rayfin-operational-monitoring/  пакет для приватного репо: хуки, скіли, агент, FIXES.md
rayfinn-app/                    пакет для приватного репо: скіли, хук, FIXES.md
REPORT.md                  повний звіт: проєкти, ринок, «Мет Майк», рекомендації
```

## Як застосувати (порядок має значення)

1. **Marketplace (canonical)**: перенести оновлені `SKILL.md` з `skills/` у
   `powerbi-craft-marketplace/plugins/dax-craft/skills/...` (+ `dax-optimization`
   як новий скіл у dax-craft, `references/recipes.md` у dax-svg), підняти версії
   plugin.json + marketplace.json, прогнати `validate_repo.py`.
2. **claude.ai**: видалити застарілі synced-скіли (обов'язково `power-bi-dax-optimization` —
   інакше два скіли знову конкурують) і залити папки з `skills/` заново (zip кожної).
3. **Локально**: оновити `~/.claude/skills` з canonical; далі тримати один канал
   на середовище (див. `routing/skill-routing.md`, розділ «Гігієна каналів»).
4. **Проєкти**: вміст `rayfin-operational-monitoring/` і `rayfinn-app/` скопіювати
   у відповідні приватні репо в `.claude/` (інструкції в їхніх README/FIXES.md).
5. **Перевірка**: прогнати корпус із `routing/trigger-probe-corpus.md`;
   далі — `skill_drift_check.py` у cron/CI, щоб дрейф більше не накопичувався.

## Безпека публікації

Пакет лежить у публічному репо, тому: тіла скілів узяті з уже публічного
powerbi-craft-marketplace (санітизовані), нові файли не містять email-адрес,
GUID-ів воркспейсів чи внутрішніх назв метрик. Проєктні пакети описують
файли й процеси, а не дані.
