---
name: deneb-vegalite
description: >
  Use this skill when the user wants a STANDALONE chart visual on the Power BI
  report canvas built with the Deneb custom visual (Vega-Lite or Vega JSON).
  Covers: bar/column, line, area, scatter, waterfall, heatmap visuals, small
  multiples, layered views, KPI cards, cross-filtering (__selected__),
  pbiFormat, tooltips, transforms, params, config tab. Trigger on: "Deneb", "Vega-Lite", "Vega", "Deneb spec",
  "Deneb візуал", "зроби Deneb chart", "напиши Vega-Lite spec",
  "кастомний візуал", existing Deneb JSON with issues — and any Power BI chart
  request NOT inside a table/matrix cell, especially when native visuals can't
  do it ("намалюй waterfall", "зроби графік", small multiples). Do NOT trigger
  for: in-cell visuals — sparkline/спарклайн, bars, badges inside a table
  (use dax-svg); the DAX measures feeding the visual (use dax-measures);
  slow measures (use dax-optimization); native visual JSON in report.json
  (use powerbi-visuals). Always output FULL JSON.
  Output Specification and Config as separate blocks.
---

# Deneb Vega-Lite Skill

## Overview

This skill produces Vega-Lite (and optionally Vega) JSON specifications for the Deneb
custom visual in Power BI. Deneb binds Power BI data to a dataset named `"dataset"`;
the spec defines marks, encodings, transforms, and layers. What Deneb is and its
limits (certified, no external data, 10k row limit) → reference.md §1.

## When to Use / NOT for

- Any Deneb visual work: new specs, edits, debugging, conditional formatting, cross-filtering, tooltips, Config tab.
- The routing axis is **cell vs canvas**: a standalone visual on the report canvas → this skill; a visual inside a table/matrix cell → `dax-svg`.
- NOT for: DAX measures → `dax-measures`; SVG-in-measure visuals → `dax-svg`; slow-measure tuning → `dax-optimization`; native visual JSON in report.json → `powerbi-visuals`; which chart answers the question → `pbi-visualization-strategy`.

## Critical Rule: Full Output

**Every response that contains a Deneb specification MUST output the entire JSON from opening `{` to closing `}`.**
Never truncate. Never use `...`, `// ...`, `/* rest unchanged */`, or any placeholder.
The user will paste this directly into the Deneb Visual Editor.
Partial output is useless — the editor requires valid complete JSON.

If a spec is being edited, output the entire spec with the edit applied.

Always output two separate JSON blocks:
1. **Specification** (the main spec)
2. **Config** (the config tab)

## Quick Reference

Every Vega-Lite spec in Deneb follows this skeleton:

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "params": [],
  "transform": [],
  "layer": [
    {
      "mark": {"type": "bar"},
      "encoding": {}
    }
  ],
  "encoding": {}
}
```

| Property | Purpose |
|----------|---------|
| `data` | Always `{"name": "dataset"}` — binds to Power BI data |
| `mark` | Shape type: `bar`, `line`, `point`, `area`, `text`, `rule`, `rect`, `arc`, `tick`, `trail`, `geoshape` |
| `encoding` | Maps data fields to visual channels: `x`, `y`, `color`, `size`, `opacity`, `text`, `tooltip`, `order`, `detail` |
| `transform` | Data transformations: `filter`, `calculate`, `aggregate`, `fold`, `flatten`, `window`, `joinaggregate`, `bin` |
| `params` | Named constants (like DAX variables) or selection parameters |
| `layer` | Array of mark+encoding objects drawn in order (later = on top) |
| `facet` | Split data into small multiples by a field |
| `concat` / `hconcat` / `vconcat` | Combine multiple views |
| `resolve` | Control shared vs independent scales/axes across layers |
| `title` | Chart title (string or object with subtitle, anchor, etc.) |

Depth: field types & encoding channels → reference.md §2 · data binding, special chars,
granularity → §3 · Config tab → §4 · number formatting (D3/pbiFormat) → §5 ·
transforms → §6 · layers → §7 · cross-filtering `__selected__` → §8 · tooltips → §9 ·
params → §10 · conditional formatting → §11 · sorting → §12 · axis formatting → §13 ·
performance → §14.

## Common Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| Empty visual | No fields in Values data role | Add at least one column/measure |
| Field not found | Special chars in name (`.`, `[`, `]`) | Use underscore replacement |
| Measures show wrong values | Wrong granularity | Check what rows the dataset produces (think like a table visual) |
| Cross-filtering doesn't work | Data was transformed | Use un-transformed datum for cross-filter marks |
| Cross-filtering one-way only | Known limitation | Deneb-to-Deneb cross-filtering has limitations |
| Tooltip shows [object Object] | Used pbiFormat in format property without formatType | Add `"formatType": "pbiFormat"` |
| Currency shows wrong symbol | Browser locale mismatch | Use `"options": {"cultureSelector": "en-US"}` |
| Null values break line | Nulls in data | Add `{"filter": "isValid(datum.FieldName)"}` transform |
| Validation error in config | Unsupported property | Check Vega-Lite schema version; remove invalid property |
| Bar chart instead of column | x/y fields swapped | Swap field assignments in encoding |

## Output Format

Every spec output must be:
1. **Complete** — full JSON, no abbreviations
2. **Two blocks**: Specification + Config
3. **Valid JSON** — no comments (JSON does not support `//` comments; Deneb's JSONC editor does, but output pure JSON for safety)
4. **Field names matching** — use exact Power BI column/measure names (with special char replacements)
5. **Formatted** — proper indentation for readability

Read `references/recipes.md` for complete copy-paste-ready specifications for common chart types.
