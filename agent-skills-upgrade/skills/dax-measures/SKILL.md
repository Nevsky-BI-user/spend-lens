---
name: dax-measures
description: >
  Use this skill whenever the user asks to create, edit, or debug the LOGIC of DAX
  measures in Power BI — output is a numeric/text value, not a drawing. Covers:
  CALCULATE, time intelligence (YTD, PY, YoY), dynamic format strings (""""&FORMAT),
  KPI values, ranking, running totals, % of total, semi-additive measures,
  TREATAS, Top N, ABC, moving averages, iterators (SUMX, AVERAGEX, COUNTX),
  SWITCH logic, context transition, filter manipulation. Trigger on: "DAX", "міра",
  "measure", "напиши міру", "зроби міру", "порахуй в DAX", "додай KPI",
  "динамічне форматування", "неправильний результат",
  "BLANK замість нуля", or DAX code with wrong results. Do NOT trigger when:
  the user wants a DRAWN visual — спарклайн or chart in a table cell
  (use dax-svg), standalone chart visual (use deneb-vegalite); the measure
  is SLOW or needs a readability refactor — "оптимізуй", "гальмує",
  "читабельніше", "refactor" (use dax-optimization);
  іконки/icons (use icon-set-manager).
  Always output FULL measure — never abbreviate or use "...".
---

# DAX Measures Skill

## Overview

This skill produces DAX measures for Power BI.
Output is always complete, copy-paste-ready DAX code.
Pattern library → [reference.md](reference.md); extended recipes → `references/patterns.md` (index in reference.md §13).

## When to Use

- Creating, editing, or debugging the logic of any DAX measure: CALCULATE, time intelligence, dynamic format strings, KPI, ranking, iterators, semi-additive, TREATAS.
- NOT for: SVG visuals rendered from DAX → `dax-svg`; Deneb/Vega-Lite specs → `deneb-vegalite`; a measure that is CORRECT but SLOW (performance tuning) → `dax-optimization`; PNG icons → `icon-set-manager`.

## Critical Rule: Full Output

**Every response that contains a DAX measure MUST output the entire measure from the first character to the last.**
Never truncate. Never use `...`, `// ...`, `-- rest unchanged`, `-- same as above`, or any placeholder.
If the measure is 80 lines — output 80 lines.
If a measure is being edited — output the entire measure with the edit applied.

## Output Format

Every measure output must be:
1. Complete — first line to last line
2. Wrapped in a DAX code block: ```dax ... ```
3. Commented — inline comments for non-obvious logic (use `//`)
4. Formatted — proper indentation, VAR/RETURN structure
5. Tested mentally — walk through with sample values before presenting

## Quick Reference

| Task | Pattern | Details |
|---|---|---|
| Dynamic format string | Value measure = constant; format measure = `""""&FORMAT(...)` | reference.md §1 |
| Filter override / share of total | CALCULATE + REMOVEFILTERS / KEEPFILTERS / ALLEXCEPT | reference.md §2 |
| YTD / PY / YoY | TOTALYTD, SAMEPERIODLASTYEAR, DATEADD (needs marked Date table) | reference.md §3 |
| Row-by-row calc, string list | SUMX, CONCATENATEX, context transition | reference.md §4 |
| Ranking / Top N | RANKX over ALL(...), DESC, DENSE | reference.md §5 |
| Balances, headcount, inventory | Semi-additive: LASTNONBLANK / LASTDATE | reference.md §6 |
| Filter without relationship | TREATAS | reference.md §7 |
| Safe division, blank guards | DIVIDE, IFERROR, ISBLANK | reference.md §8 |
| Threshold buckets, measure selector | SWITCH(TRUE(), ...) / SWITCH(SELECTEDVALUE(...)) | reference.md §9 |
| Running total | Date <= MAX + ALLSELECTED | reference.md §10 |
| Moving average | AVERAGEX + DATESINPERIOD | reference.md §11 |
| % of total / parent | DIVIDE + ALL / ALLSELECTED | reference.md §12 |
| ABC, cohorts, budget vs actual, calc groups, date tables… | Extended recipes | reference.md §13 → references/patterns.md |

## Common Debugging

| Symptom | Cause | Fix |
|---------|-------|-----|
| Same value everywhere | Missing context transition | Add CALCULATE() inside iterator |
| BLANK instead of 0 | No data for filter | Add `+ 0` or IF(ISBLANK(), 0, ...) |
| Wrong totals in matrix | Additive assumption | Use semi-additive pattern |
| Filter not applied | ALL/REMOVEFILTERS too broad | Narrow to specific column |
| Circular dependency | Measure references itself via table | Split into separate measures |
| LOOKUPVALUE fails after Append | Trailing spaces / type mismatch | TRIM columns, check types |
| Slow measure | Nested iterators or large FILTER | Hand off to `dax-optimization` (diagnose first, then rewrite) |
| Dynamic format shows raw string | Missing `""""` prefix | Add `""""&` before FORMAT |
| Dynamic format shows "Δ 0" | Value measure = 0, but should be real value | OR: use `""""&FORMAT` pattern with actual source measure in FORMAT |
