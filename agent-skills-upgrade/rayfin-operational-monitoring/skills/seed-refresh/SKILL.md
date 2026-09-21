---
name: seed-refresh
description: Церемонія оновлення довідника показників з нового Excel — parse_dictionary.py → звірка стабільності uuid5-ID («ids identical: True») → build_structure.py → дельти лічильників проти docs/data-model.md → імпорт в адмінці (refPass). Використовувати на запити «онови довідник», «новий Excel довідника», «оновити metric_structure», «перегенеруй seed», «імпорт метрик», seed refresh, dictionary update. НЕ для змін схеми БД (скіл schema-change), НЕ для ручного редагування seed/metric_structure.json (заборонено — файл генерується), НЕ для самої викотки (скіл deploy-checklist).
---

# Оновлення довідника показників (seed-пайплайн)

Пайплайн: Excel → `seed/parse_dictionary.py` → `seed/*.json` →
`seed/build_structure.py` → `seed/metric_structure.json` → імпорт через
«Адміністрування → Довідники». Правила стабільності ID і подвійних відступів
Excel — `.claude/rules/seed-dictionary.md` (підтягується при роботі з seed/**).

## 0. Гілка

`docs/seed-<дата>` або `fix/seed-<тема>` від master. Протокол коміту спільного
дерева (CLAUDE.md «Git-процес») діє і тут: add лише явними шляхами.

## 1. Шляхи в скриптах (історична міна — перевіряти ЗАВЖДИ)

Константи шляхів у скриптах hard-coded і вже відставали від переїзду репо:

- `seed/parse_dictionary.py`: `SRC` (Excel у Downloads конкретного користувача)
  і `OUT_DIR` (абсолютний шлях до seed/ у СТАРІЙ теці `C:\github\…` — репо
  тепер живе в `C:\azure_repos\…`);
- `seed/build_structure.py`: `SEED` (та сама стара тека).

Перед запуском:

1. Спитати в користувача шлях до НОВОГО Excel — не вгадувати за старим `SRC`.
2. Виправити константи: `OUT_DIR`/`SEED` виводити від розташування скрипта
   (`os.path.dirname(os.path.abspath(__file__))`), `SRC` — аргументом CLI з
   фолбеком. Разова правка, комітиться разом з оновленням довідника.
3. Якщо правити скрипти зараз недоречно — щонайменше звірити, що всі три
   константи вказують на ЦЕЙ клон, інакше вихід мовчки поїде в чужу теку.

## 2. Парсинг

```bash
python seed/parse_dictionary.py
```

Переглянути консольний звіт: organizations / metrics / розбивка по аркушах /
periods / collected(●) + reference / frequencies / roots + children. Різкий
стрибок кількостей чи порожній аркуш → зупинитись і показати користувачу.

## 3. Diff і стабільність ID (STOP-перевірка)

```bash
git diff --stat seed/
```

```bash
python - <<'EOF'
import json, subprocess
def ids(src): return {m["id"]: m["name"] for m in json.loads(src)}
old = ids(subprocess.run(["git", "show", "HEAD:seed/metric_definitions.json"],
                         capture_output=True, text=True, encoding="utf-8").stdout)
new = ids(open("seed/metric_definitions.json", encoding="utf-8").read())
print("ids identical:", set(old) == set(new))
for i in sorted(set(old) - set(new)): print("  зник :", old[i])
for i in sorted(set(new) - set(old)): print("  новий:", new[i])
EOF
```

- `ids identical: True` — правки не зачепили жодного ID; продовжуємо.
- `False` допустиме ЛИШЕ коли в Excel реально додано/прибрано рядки: кожен
  «зник»/«новий» пояснити змінами файлу. «Зник» показник, який у Excel
  лишився, = парсер зламав стабільність uuid5 (ID рахується від СИРОЇ назви
  рядка ДО чисток) → **STOP**: не комітити, лагодити парсер, перегенерувати.

## 4. Модель обчислень

```bash
python seed/build_structure.py
```

Переглянути звіт: row_role / calc_rule / time_agg / weighted linked /
metric_class / metric_domain / spot-чеки. Класифікація виводиться ПРАВИЛАМИ у
скрипті: змінити клас/домен/правило окремого показника → правити правила чи
overrides у `build_structure.py`, ніколи не JSON руками.

## 5. Дельти проти документації

Звірити лічильники з docs/data-model.md (§2.3: загальна кількість показників,
manual/reference, розподіли metric_class і metric_domain; розділ про
розрахункові показники: calc_rule). Вивести користувачу таблицю:

| Лічильник | У docs | Стало | Δ |
|---|---|---|---|

## 6. Документація — В ТОМУ Ж КОМІТІ

- docs/data-model.md: оновити числа й розподіли + штамп «Оновлено:» у шапці.
- docs/clarification-questions.md: статуси ✅/🔶/⬜ — якщо новий довідник
  закриває наявні питання чи відкриває нові.

## 7. Передача далі — імпорт у застосунок

Порядок: (якщо мінялась і схема — спершу БД, див. schema-change) → фронт →
«Адміністрування → Довідники → Імпортувати» (створює відсутні + оновлює
змінені). `weight_metric_id`/`equals_metric_id` можуть посилатись на показник,
який створюється пізніше, — тому імпорт спершу пише їх null-ами, а звʼязки
ставить ДРУГИМ проходом `refPass` (`src/pages/admin/catalogSync.ts`);
FK-помилка «other items depend on this record» на першому проході — причина
існування другого проходу, а не збій імпорту. Викотка — скілом
`deploy-checklist`, не звідси.
