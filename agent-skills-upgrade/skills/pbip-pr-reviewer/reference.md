# PBIP Pull Request Reviewer — Reference

Деталі кроків зі SKILL.md. Нумерація «§N» відповідає покликанням звідти.

## §1. Deep DAX review

Для кожного нового або зміненого `measure` блоку:

1. Виокремити повний DAX-вираз
2. Перевірити по checklist (нижче)
3. Якщо знайдено проблему — описати з посиланням на рядок і запропонувати fix

### DAX anti-patterns checklist

- [ ] `/` замість `DIVIDE()` без захисту від нуля
- [ ] `FILTER()` обгортає всю таблицю там, де можна простий boolean filter
- [ ] `EARLIER()` там, де можна використати `VAR`
- [ ] Відсутній `formatString` для публічних мір
- [ ] Контекстна трансформація неявна — `CALCULATE` всередині iterator без коментаря
- [ ] Бідірекціональний фільтр без явного `USERELATIONSHIP`
- [ ] Hard-coded values, які мають бути параметрами
- [ ] Vague назви: `Measure1`, `New Measure`, `Test`
- [ ] Дублювання логіки між мірами (можна винести у base measure)
- [ ] Iterator (SUMX, AVERAGEX) на великих таблицях без агрегації

## §2. Model structural review

**`relationships.tmdl`:**
- Кількість додано / змінено / видалено relationships
- Cardinality (1:1, 1:*, *:*)
- Cross-filter direction (single vs both)
- Risk: bidirectional на великих fact-таблицях, *:* без explicit bridge

**`roles/*.tmdl`:**
- filterExpression: на fact-таблиці (правильно) чи тільки на dim (ризик leak)
- USERPRINCIPALNAME vs hardcoded

**Calculation groups (якщо змінено):**
- Перерахувати додані/змінені calculationItems
- Перевірити `ordinal` — чи не зрушив існуючі
- Перевірити formatString expression
- HIGH risk: будь-яка зміна впливає на всі downstream звіти

## §3. Visual review

JSON-файли сторінок:
- Не читати координати (`x`, `y`, `width`, `height`)
- Шукати в diff: `"name":` (нові візуали), `"type":` (зміни типів), `"filters":` (зміни фільтрації)
- Перевірити, чи додані візуали посилаються на існуючі міри

## §4. Шаблон output

Використати ТОЧНО цю структуру:

```markdown
# PR Review Report

**Date**: [yyyy-mm-dd hh:mm]
**Branch**: [source] → main
**Author**: [from git log]

---

## Executive Summary
[2-3 sentences: що PR робить, загальна якість]

## Risk Assessment
**Level**: LOW | MEDIUM | HIGH
**Justification**: [одне речення]

Risk = HIGH якщо: зміни в RLS roles, relationships з впливом на cardinality/direction,
calculation groups, видалення таблиці/колонки що використовуються downstream.

Risk = MEDIUM якщо: > 5 нових/змінених DAX мір, нові таблиці або зв'язки,
зміни у model structure без structural impact.

Risk = LOW: дрібні фікси, форматування, visual-only без зміни логіки, theme, config.

## Model Changes
[Якщо немає — "No structural model changes." і пропустити підсекції]

### Relationships
- Added: [список]
- Modified: [що змінилося]
- Removed: [які]

### RLS Roles
- [Назва ролі]: [що змінилося, оцінка ризику leak]

### Calculation Groups
- [Назва групи]: [які items, impact]

## DAX Review

### New Measures ([N])

#### `Table[Measure Name]`
**Logic**: [одне речення]
**Issues**:
- [конкретна проблема з посиланням на рядок]
**Suggested**:
\`\`\`dax
[fixed version]
\`\`\`

[Повторити для кожної нової міри]

### Modified Measures ([N])

#### `Table[Measure Name]`
**Change**: [що змінилося]
**Before / After**:
\`\`\`dax
-- Before:
[OLD]

-- After:
[NEW]
\`\`\`
**Impact**: [на що це вплине]

## Visual Changes
[Список affected pages, типи змін структурні, не координати]

## Flags
[Перерахувати все, що потребує особливої уваги]
- ⚠ [конкретна проблема-ризик]

[Якщо нема — "No flags."]

## Reviewer Action Items
1. [Конкретна дія — файл відкрити, операцію виконати, refresh запустити]
2. [Інша]
3. ...

## Recommended Vote
**APPROVE** | **WAIT_FOR_AUTHOR** | **REJECT**

**Rationale**: [одне речення]

[Advisory. Людина приймає фінальне рішення.]
```

## §5. Принципи якісного review

1. **Бути конкретним**: не "DAX має проблеми", а
   "`Sales[Margin %]` використовує `/` замість `DIVIDE()` на рядку 142"

2. **Не повторювати очевидне**: не писати "Ця міра використовує CALCULATE",
   якщо це нормальна практика

3. **Фокус на тому, що може зламатися**, не на стилі:
   - Виявляти потенційні баги, performance issues, security ризики
   - Стилістичні зауваги — тільки якщо порушують команді conventions

4. **Враховувати контекст PR**:
   - Hotfix → focused review, не вимагати ідеального коду
   - Refactor → переконатися, що поведінка не змінилася
   - Feature → перевірка функціональності + якості коду

5. **Не вигадувати проблеми**, якщо їх нема. Якщо PR простий і чистий —
   так і написати. Перебільшення підриває довіру до AI-review.

6. **Конкретні Action Items** для людини:
   - "Перевірити refresh у dev workspace після merge"
   - "Запустити View as Role для нової ролі XYZ"
   - "Профайлити міру `[Total Sales LY]` у DAX Studio"

## §6. Інтерактивне продовження

Після генерації первинного report користувач може запросити:
- Глибший аналіз конкретної міри
- Альтернативний підхід до DAX
- Refactor pattern
- Performance prediction

Skill не блокує follow-up — продовжувати діалог у контексті already-loaded files.
