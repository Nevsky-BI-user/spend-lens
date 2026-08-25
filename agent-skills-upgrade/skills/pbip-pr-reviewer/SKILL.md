---
name: pbip-pr-reviewer
description: |
  Виконує детальний review pull request'у у Power BI PBIP-репозиторії
  (TMDL + Report JSON). Trigger on: "review PR", "ревью PR", "ревью цього PR",
  "ревью пул-реквесту", "проаналізуй зміни в моделі/звіті", "перевір diff
  з main" — КОЛИ поточна директорія містить PBIP-артефакти: *.pbip, *.pbir,
  *.pbism, *.tmdl, .SemanticModel/, .Report/. Skill категоризує зміни
  (model / DAX / visuals / config / noise), виконує deep review DAX-мір на
  anti-patterns і performance, перевіряє структурні зміни моделі
  (relationships, RLS, calc groups), і генерує structured markdown report
  з recommended vote. Do NOT trigger: для PR у репозиторіях без PBIP-файлів
  (use built-in code-review); для оптимізації окремої міри поза PR
  (use dax-optimization); для написання нових мір (use dax-measures).
---

# PBIP Pull Request Reviewer

## Огляд

Детальний review PBIP-репо (TMDL + Report JSON) проти main-гілки.
Генерує structured markdown report для рев'юера.
Передумова: Поточна директорія — це чекаут PR-гілки (через worktree або
switch). Команда `git` доступна. Файли PBIP читаються напряму з filesystem.

## Коли використовувати / NOT for

- "Review PR", "ревью пул-реквесту", "проаналізуй зміни" — diff PR-гілки проти main
  у репозиторії з PBIP-артефактами (*.pbip, *.pbir, *.pbism, *.tmdl, .SemanticModel/, .Report/).
- NOT for: PR без PBIP-файлів → вбудований `code-review`; написання/виправлення DAX →
  `dax-measures`; оптимізація повільної міри поза PR → `dax-optimization`;
  редагування visuals → `powerbi-visuals`; деплой → `pbip-deploy`; release notes → `pbip-release-notes`.

## Обмеження

- Не модифікувати файли в PR-гілці — тільки читати
- Не виконувати write-операції до Azure DevOps (це не входить у skill)
- Якщо PR супер-великий (> 50 файлів структурних змін) — не намагатися
  покрити кожен файл, рекомендувати розбити PR на менші

## Кроки виконання

1. **Контекст PR** — команди нижче. Якщо у директорії є `PR_DESCRIPTION.md`,
   `CHANGES.md` або подібний — прочитати.
2. **Категоризувати файли** — Quick Reference нижче.
3. **Deep DAX review** — кожен новий/змінений `measure` по anti-patterns
   checklist → reference.md §1.
4. **Model structural review** — relationships / RLS roles / calculation
   groups → reference.md §2.
5. **Visual review** — структурні зміни в JSON сторінок, без координат
   → reference.md §3.
6. **Noise filtering** — Зміни в `diagramLayout.json` ігнорувати. Якщо весь
   PR — це тільки diagramLayout, згадати у Flags.
7. **Output** — За замовчуванням зберегти у `./review.md`. Якщо користувач
   задав інший шлях — використати його. Використати ТОЧНО структуру шаблону
   (включно з порогами Risk LOW / MEDIUM / HIGH) → reference.md §4.

```bash
git log -1 --pretty=fuller        # автор, повідомлення
git diff main...HEAD --stat       # загальна статистика
git diff main...HEAD --name-only  # список файлів
```

## Quick Reference — категорії файлів

| Категорія | Шляхи |
|---|---|
| **Model (structural)** | `relationships.tmdl`, `model.tmdl`, `roles/*.tmdl`, `cultures/*.tmdl`, `perspectives/*.tmdl` |
| **DAX measures** | `tables/*.tmdl` — секції `measure`, `column` calculated |
| **Calculation groups** | `tables/*Calculations*.tmdl` |
| **Visuals** | `*.Report/definition/pages/*.json`, `theme.json` |
| **Config** | `*.pbip`, `*.pbism`, `*.pbir`, `definition.pbism` |
| **Noise (ignore)** | `diagramLayout.json`, `.pbi/localSettings.json` |

## Принципи review (обов'язкові)

- Бути конкретним: не "DAX має проблеми", а "`Sales[Margin %]` використовує
  `/` замість `DIVIDE()` на рядку 142".
- Фокус на тому, що може зламатися (баги, performance, security), не на
  стилі; не повторювати очевидне.
- Враховувати контекст PR: hotfix → focused review; refactor → поведінка не
  змінилася; feature → функціональність + якість коду.
- Не вигадувати проблеми, якщо їх нема — перебільшення підриває довіру до
  AI-review.
- Action Items — конкретні дії для людини; Recommended Vote — advisory,
  фінальне рішення приймає людина.

Повні формулювання з прикладами → reference.md §5.

## Після report

Follow-up (глибший аналіз міри, альтернативний DAX, refactor pattern,
performance prediction) не блокувати — продовжувати діалог у контексті
already-loaded files → reference.md §6.
