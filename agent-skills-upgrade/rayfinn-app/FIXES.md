# FIXES — пріоритезований чекліст покращень репозиторію

Порядок — за співвідношенням «ризик/ціна виправлення». Кожен пункт самодостатній і може йти окремим PR (через skill `ship-pr`).

## 1. Переписати README.md — досі шаблон Microsoft ✅ найдешевший фікс

- [ ] **Проблема:** README — незмінений starter-template «Fabric Apps – Analytics» з інструкціями для *GitHub Copilot CLI* і прикладами промптів про «Contoso Sales». Він активно вводить в оману: новий розробник (або агент, що читає README) отримує неправильні інструкції запуску.
- [ ] **Фікс:** короткий README про фактичний застосунок (аналітичний дашборд): передумови (Node 22, Azure CLI + `az login`, `playwright-cli`), `npm install` → `npm run dev` → `npm run test:fabric`, посилання на AGENTS.md/CLAUDE.md як на джерело правди для агентів. Приклади промптів Copilot — видалити.

## 2. Naming drift: назва пакета / конекшн-аліас ≠ домен застосунку

- [ ] **Проблема:** історичний конекшн-аліас у `fabric.yaml` та назва пакета в `package.json` не збігаються з фактичним доменом застосунку. Кожен новий агент витрачає час на підозру «чи не той це репозиторій/модель?».
- [ ] **Рекомендація (дешева, безпечна):** НЕ перейменовувати аліас — він захардкоджений у кожній factory (`const connection = "<конекшн-аліас у fabric.yaml>"`), і перейменування ламає всі 12 factory + кеш-ключі. Натомість додати в CLAUDE.md один рядок: *«Аліас `<конекшн-аліас у fabric.yaml>` — історичний, вказує на актуальну модель застосунку. Не перейменовувати.»* Те саме — коментарем у `fabric.yaml`.
- [ ] **Альтернатива (дорога):** одноразовий координований rename в одному PR: аліас у `fabric.yaml` → усі factory → `npx fabric-app-data generate` → `package.json name`. Робити лише свідомо і за один прохід.

## 3. Дублікат дерев скілів + мертвий шлях `.github/skills`

- [ ] **Проблема:** `.claude/skills/` і `.agents/skills/` — побайтово ідентичні (перевірено `diff -rq`). Два дерева неминуче розійдуться при першій же правці одного з них. Додатково: коментар у `scripts/open-fabric-portal.mjs` посилається на `.github/skills/playwright-cli/references/fabric-embed.md` — каталогу `.github/` не існує; реальний файл — `.claude/skills/app-validation/references/fabric-embed.md`.
- [ ] **Фікс:** оголосити `.claude/skills/` канонічним (AGENTS.md при цьому лінкує на `.agents/skills/` — оновити лінки або лишити `.agents` як дзеркало). Дзеркало підтримувати або symlink-ом (на Windows — junction), або sync-перевіркою: скрипт `scripts/check-skills-sync.mjs` (по суті `diff -rq`), що падає при розбіжності, викликаний з `npm test`. Виправити мертвий шлях у коментарі `open-fabric-portal.mjs`.

## 4. Суперечність: «NEVER use mock data» vs мокнутий spec

- [ ] **Проблема:** AGENTS.md, Critical Rule 1 — «NEVER use mock, fake, or hardcoded data» — без застережень. Але skill `app-validation` (розділ Spec Files) прямо вимагає фікстури у тестах, і `src/hooks/use-semantic-model-query.spec.ts` вже мокає Fabric-клієнт. Формально кожен запуск тестів порушує Critical Rule 1 — агент, що читає правила буквально, або відмовиться писати тести, або «виправить» робочий spec.
- [ ] **Фікс:** підняти carve-out у сам Rule 1 в AGENTS.md: *«…All data must come from a real source. Виняток: unit-тести (`*.spec.ts*`) використовують репрезентативні фікстури, що відтворюють реальну форму колонок (див. app-validation → Spec Files); мокати можна лише транспорт/клієнт, не бізнес-дані в UI.»*

## 5. Відсутні spec-файли для 12 factory

- [ ] **Проблема:** правило app-validation — «**Always** for query factory functions» — порушене всіма 12 factory у `src/queries/` (жодного `*.spec.ts` поруч). Саме specs ловлять головний тихий баг: розїзд ключів `columnMetadata` з реальними іменами колонок.
- [ ] **Фікс:** дописати 12 specs за шаблоном зі skill `add-visualization` (Step 8): точний список ключів `columnMetadata`, `connection`, `query` містить `EVALUATE`, наявність `mark`/`layer` у spec; для параметризованих factory (`org-structure`, `metric-ranking`) — по тесту на кожну гілку параметра. Для **нових** візуалізацій skill `add-visualization` тепер скафолдить spec автоматично — борг далі не росте.

## 6. Zero-checks auto-merge: додати CI або quality-gate hook

- [ ] **Проблема:** CLAUDE.md вимагає вмикати `gh pr merge --auto --merge` одразу після створення PR, але в репозиторії немає `.github/workflows/` і жодних required checks — auto-merge зливає PR **без lint і тестів узагалі**.
- [ ] **Фікс (мінімум):** один workflow `ci.yml`: `npm ci && npm run lint && npx vitest run` на `pull_request`; зробити його required check для auto-merge. **Додатково/замість:** Stop-hook або крок у skill `ship-pr` (уже додано: Step 1 — `npm run lint && npm test` перед створенням PR), але локальний gate не захищає від PR з інших машин — CI потрібен.

## 7. Sub-Agent Delegation: ролі без визначень

- [ ] **Проблема:** AGENTS.md описує делегування суб-агентам (schema-discovery агент, окремі агенти на DAX і компоненти), але в `.claude/agents/` немає жодного визначення — ролі аспіраційні, і кожна сесія імпровізує розбиття.
- [ ] **Фікс:** або створити реальні визначення (`.claude/agents/dax-author.md` — skills dax-authoring + query-design + schema-snapshot, tools Bash/Read/Write; `.claude/agents/component-builder.md` — skills app-design + visuals, без доступу до `fabric.yaml`), або додати в AGENTS.md примітку *«ролі — рекомендація для розбиття задач, formal agent definitions відсутні»*. Перший варіант кращий: він зробить паралелізм із розділу Sub-Agent Delegation відтворюваним.

---

**Після впровадження:** пункти 1–4 — разові правки документації/конфігів; 5 — механічна робота за готовим шаблоном; 6 — інфраструктура; 7 — за смаком власника. Нові скіли (`add-visualization`, `schema-snapshot`, `ship-pr`) і hook `protected-files-guard.sh` з цього пакета закривають причини, через які борг накопичувався.
