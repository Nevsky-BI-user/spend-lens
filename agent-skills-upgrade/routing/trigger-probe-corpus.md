# Корпус тригер-тестів для Power BI-скілів

Корпус реалістичних промптів з очікуваним скілом-переможцем. Використовуйте його
для перевірки маршрутизації **після кожної зміни описів** — тим самим методом
живих `claude -p` проб, який вже застосовувався в powerbi-craft-marketplace
(37/39 first-pass у v0.1.4), або через `claude plugin eval` (нижче).

Формат: `промпт → очікуваний скіл` (│ додатково допустимий).

## dax-measures (значення міри: нова / неправильна)

- «зроби міру з YoY по виручці» → dax-measures
- «напиши міру % виконання плану» → dax-measures
- «міра повертає неправильний total у матриці» → dax-measures
- «чому BLANK замість нуля?» → dax-measures
- «додай KPI відхилення від плану» → dax-measures
- «динамічне форматування: мінус у дужках» → dax-measures
- «semi-additive залишок на кінець місяця» → dax-measures

## dax-optimization (міра правильна, але повільна)

- «оптимізуй цю міру, вона гальмує» → dax-optimization
- «звіт повільно відкривається, ось міра» → dax-optimization
- «міра довго рахується на великій таблиці» → dax-optimization
- «поясни server timings з DAX Studio» → dax-optimization
- «refactor DAX for performance» → dax-optimization
- «зроби цю міру читабельнішою без зміни логіки» → dax-optimization

## dax-svg (намальоване В КОМІРЦІ таблиці/матриці)

- «намалюй спарклайн в таблиці» → dax-svg
- «додай міні-бар в комірку матриці» → dax-svg
- «progress ring в таблицю по кожному проєкту» → dax-svg
- «бейдж зі стрілкою вгору/вниз у комірці» → dax-svg
- «SVG міра не рендериться, чорний квадрат» → dax-svg
- «heatmap-заливка комірок через Image URL» → dax-svg

## deneb-vegalite (окремий візуал НА КАНВІ)

- «намалюй waterfall» → deneb-vegalite
- «зроби графік з двома осями» → deneb-vegalite
- «small multiples по регіонах» → deneb-vegalite
- «напиши Vega-Lite spec для scatter» → deneb-vegalite
- «Deneb не реагує на кросфільтрацію» → deneb-vegalite
- «зроби KPI-картку як окремий візуал» → deneb-vegalite

## icon-set-manager (PNG-іконки / URL)

- «знайди іконку для дашборда» → icon-set-manager
- «намалюй іконку експорту» → icon-set-manager
- «потрібні іконки статусів у звіт» → icon-set-manager
- «зроби міру що показує іконку по статусу» → icon-set-manager
- «додай PNG для хедера» → icon-set-manager

## pbip-pr-reviewer (review PR у PBIP-репо)

- (у PBIP-репо) «ревью цього PR» → pbip-pr-reviewer
- (у PBIP-репо) «проаналізуй зміни в моделі проти main» → pbip-pr-reviewer
- (у React-репо) «ревью цього PR» → code-review (вбудований), НЕ pbip-pr-reviewer

## Граничні випадки (найцінніші проби)

- «зроби heatmap» без контексту → deneb-vegalite │ одне уточнювальне питання
- «намалюй bullet chart в матриці» → dax-svg
- «оптимізуй звіт» (без міри) → dax-optimization │ питання про Performance Analyzer
- «міра повільна І повертає неправильний total» → dax-measures спершу (коректність), потім dax-optimization
- «іконка тренду в комірці, намальована» → dax-svg (намальована, не PNG)

## Як ганяти проби

### Метод А: живий роутер (швидко, як у marketplace v0.1.4)

```bash
# кожен промпт окремою одноразовою сесією; дивимось, який Skill викликано
claude -p "намалюй спарклайн в таблиці" --max-turns 2 2>&1 | grep -i "skill"
```

Прогнати весь корпус → порахувати first-pass hit rate → промпти-промахи
фіксують, яку фразу додати в опис скіла-власника або яку межу — в опис злодія.

### Метод Б: claude plugin eval (відтворювано, для CI)

Структура на кожен скіл (приклад для dax-svg):

```
skills/dax-svg/evals/sparkline-in-table/prompt.md
---
name: 'Trigger: спарклайн в таблиці'
runs: 3
---
намалюй спарклайн в таблиці по місяцях

skills/dax-svg/evals/sparkline-in-table/graders/skill_used.md
---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"dax-svg"'
min: 1
---
Скіл dax-svg має бути викликаний для спарклайна в таблиці.
```

Запуск: `claude plugin eval skills/dax-svg`. Негативні проби (промпт для сусіда,
grader з `max: 0`) ловлять over-triggering — саме «спрацьовує коли не треба».

### Критерій готовності

- first-pass hit rate ≥ 90% по корпусу;
- нуль перехоплень між dax-svg ↔ deneb-vegalite на граничних випадках;
- «оптимізуй…»-промпти більше не потрапляють у dax-measures.

## Доповнення 2026-09-02 — marketplace 0.1.20 (мова, букмарки, кнопки, навігація, іконки)

### dashboard-copy (бізнес-мова підписів і переклад термінів)

- «як назвати картку headcount українською?» → dashboard-copy
- «перейменуй показники на дашборді, щоб зрозумів директор» → dashboard-copy
- «переклади turnover rate і absenteeism для підписів» → dashboard-copy
- «підпиши KPI-картки з одиницями» → dashboard-copy
- «додай довідку до дашборда з глосарієм показників» → dashboard-copy
- «що написати в тултіпі, щоб не повторювати число?» → data-storytelling │ dashboard-copy
- «у рядку виходить "з червень" — виправ» → ukrainian-ui-copy
- «перепиши мені цей звіт простіше» → plain-report

### powerbi-bookmarks (файли й обсяг букмарок, обидва формати)

- «зроби закладки для вкладок на одній сторінці» → powerbi-bookmarks
- «блок протікає на інші вкладки» → powerbi-bookmarks
- «звіт не відкривається після додавання букмарки в bookmarks.json» → powerbi-bookmarks
- «сховай групу візуалів букмаркою у PBIR» → powerbi-bookmarks
- «панель фільтрів, що ховається за кнопкою» → pbi-filter-panel-bookmark

### pbi-buttons-actions (кнопка та її дія)

- «кнопка переходу на сторінку деталей з іконкою» → pbi-buttons-actions
- «як у visual.json задати дію кнопки Back?» → pbi-buttons-actions
- «кнопка скинути всі фільтри» → pbi-buttons-actions
- «стани кнопки при наведенні і натисканні» → pbi-buttons-actions
- «кнопка назад на сторінці drillthrough» → pbi-drillthrough │ pbi-buttons-actions

### pbi-navigation-tabs / pbi-navigation-variants (навігація)

- «додай навігатор сторінок у звіт» → pbi-navigation-tabs
- «активна вкладка не відрізняється від інших» → pbi-navigation-tabs
- «зроби кілька варіантів меню, я оберу» → pbi-navigation-variants
- «постав обране меню на кожну сторінку звіту» → pbi-navigation-variants
- «меню звіту як у нашому React-застосунку» → pbi-navigation-variants │ pbi-navigation-tabs

### icon-set-manager (іконки: знайти і де ставити)

- «постав іконки на кнопки навігації» → icon-set-manager
- «де на дашборді потрібні іконки, а де ні?» → icon-set-manager
- «знайди іконку фільтра в бібліотеці» → icon-set-manager

### pbip-deploy / fabric-cli-powerbi (розгортання)

- «опублікуй дашборд у робочий простір» → pbip-deploy
- «після деплою перевір, що меню на всіх сторінках рендериться» → pbip-deploy
- «запусти refresh моделі через fab» → fabric-cli-powerbi
- «експортуй кожну сторінку звіту в PNG» → fabric-cli-powerbi
