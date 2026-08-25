---
name: dax-svg
description: >
  Use this skill when the user wants a micro-visual rendered INSIDE a Power BI
  table/matrix cell via an Image URL measure — SVG written in DAX. Covers:
  sparklines (спарклайн), in-cell bar charts, progress rings, bullet charts,
  badges/indicators, heatmap cells, waffle, lollipop, radar,
  Gaussian overlays; viewBox, coordinates, scaling, escaping,
  color encoding. Trigger on: "SVG", "SVG міра",
  "SVG в DAX", "Image measure", "намалюй в таблиці", "спарклайн",
  "графік в комірці", "міні-графік", "зроби chart в DAX", existing
  SVG DAX code with issues — and whenever the requested visual lives in a
  table/matrix cell, even if the user never says "SVG". Do NOT trigger for:
  standalone charts on the report canvas (use deneb-vegalite); plain numeric/text
  measures (use dax-measures); slow-measure tuning (use dax-optimization);
  PNG icons (use icon-set-manager). Bare "намалюй"/"візуалізуй" with no
  cell/table context → prefer deneb-vegalite or ask.
  Always output the FULL measure text — never abbreviate.
---

# DAX SVG Skill

This skill produces SVG visualizations as DAX measures for Power BI.
The output is always a complete, copy-paste-ready DAX measure.

## When to Use

- SVG visuals written as DAX Image measures: bar charts, sparklines, badges/indicators, progress rings, radar, bullet/waffle/lollipop charts, heatmap cells, Gaussian overlays.
- The routing axis is **cell vs canvas**: a visual inside a table/matrix cell → this skill; a standalone visual on the report canvas → `deneb-vegalite`.
- NOT for: plain DAX measures/KPIs → `dax-measures`; Deneb/Vega-Lite specs → `deneb-vegalite`; slow-measure tuning → `dax-optimization`; PNG icons → `icon-set-manager`; choosing which visual answers the question → `pbi-visualization-strategy`.

## Critical Rule: Full Output

**Every response that contains a DAX measure MUST output the entire measure from the first character to the last.**
Never truncate. Never use `...`, `// ...`, `-- rest unchanged`, `-- same as above`, or any placeholder.
If the measure is 300 lines — output 300 lines. The user will paste this directly into Tabular Editor or Power BI Desktop.
Partial output is useless and forces the user to manually reconstruct the measure, which defeats the purpose.

If a measure is being edited, output the entire measure with the edit applied, not just the changed fragment.

## SVG in DAX: How It Works

Power BI can render SVG inside a **table or matrix cell** via the Image URL data category.
The measure returns a string that starts with `"data:image/svg+xml;utf8,"` followed by URL-encoded SVG markup.

**The SVG renders ONLY in a table/matrix cell.** A Card visual (classic `card` or new `cardVisual`) does **not** render an Image-URL measure — it prints the raw `data:image/svg+xml,…` string as text. Put SVG measures in a table or matrix, never a card.

The general pattern:

```dax
MyVisual =
VAR _svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 [W] [H]'>"
    & [... elements ...]
    & "</svg>"
RETURN
    "data:image/svg+xml;utf8," & SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(_svg, "&", "&amp;"), "%", "%25"), "#", "%23"), """", "'")
```

**Choose the ending by rendering target:**

- **Image URL** (the `Image URL` data category in a table/matrix, or any path that treats the string as a URL): the prefix and the SUBSTITUTE chain are **mandatory**. `data:image/svg+xml;utf8,` makes it a data URI, and the chain escapes `&`→`&amp;`, `%`→`%25` (**before** `#`!), `#`→`%23`, and `"`→`'` so the URL stays valid.
- **Direct-SVG visual** (HTML Content / "HTML viz" custom visuals, or a wrapper UDF that itself adds the prefix and escaping): return the **raw** `<svg>…</svg>` with **literal `#` colors**, **no prefix**, and **no SUBSTITUTE** — i.e. `RETURN _svg`. These visuals render the string as markup and do **not** URL-decode it, so `%23` is read as an invalid color and every fill/stroke falls back to **black** (bars, text, and white-on-dark labels all disappear); the prefix itself shows up as stray text.

Never escape `#`→`%23` for a direct-SVG visual, and never omit it for an Image URL. The `FORMAT(..., "en-US")` rule for coordinates applies to **both** targets.

Escaping has TWO levels — XML per data value, URI once on the whole string; merging them breaks labels like `"< 1 року"` → reference.md §1.

## Quick Reference

| Rule | Depth |
|---|---|
| Every coordinate/dimension: `FORMAT(_val, "0.0", "en-US")` — never ROUND, never locale-default FORMAT | reference.md §7 |
| Escape order: `&`→`&amp;`, then `%`→`%25` **before** `#`→`%23`, then `"`→`'` | §12 |
| Size the SVG ~12% smaller than the PBI object; HTML Content host: `svgH ≤ objectH − 20` | §3–§4 |
| Progress/track bars = two side-by-side solid rects, never a solid fill over a translucent one | §10 |
| Dark reports: bright accents (`#34d399`/`#fcd34d`/`#f87171`/`#22d3ee`) + light-grey text (`#e2e8f0`/`#cbd5e1`) | §8, §13 |
| No `<linearGradient>`/`<radialGradient>` — flat fills; fake gradients via `rgb()` interpolation | §8 |
| Background, rounded corners, title = container chrome; the measure returns a transparent SVG | §5 |
| Copy-paste recipes (bar, ring, bullet, sparkline, radar, badge, waffle, lollipop, heatmap, Gaussian) | §9 |

## Common Mistakes (verified in Power BI Desktop 2.155)

| Mistake | What actually happens | Do this instead |
|---------|-----------------------|-----------------|
| Blaming `<text>` for a solid-black cell | The real cause is an **unescaped `%`** in a text label — `FORMAT(x, "0.0%")` → `"126.5%"`, and `%` opens a URI escape that breaks the data URI. Every primitive (rect/path/circle/text/▲) actually renders; deleting the `<text>` is the wrong fix | Add `%`→`%25` to the SUBSTITUTE chain, **before** `#`→`%23`. Diagnose with a matrix of colors × primitives, iterated live via powerbi-modeling MCP (update → Refresh → screenshot) — no Desktop restart |
| Overlaying a solid `<rect>` on a semi-transparent or `fill='none'` rect | The top solid rect can fail to paint — the progress fill / overlay disappears | Draw two side-by-side solid rects (fill + remainder), edges touching, no overlap (see Layering) |
| Putting the Image-URL SVG measure in a Card visual | The card shows the raw `data:image/svg+xml,…` string, not the picture | Render SVG measures only in a **table or matrix** cell (Data category = Image URL) |
| Medium greys (`#475569`, `#64748b`) for lines/text on a dark report | They read as pure black — invisible | Bright accent tokens only (`#34d399`/`#fcd34d`/`#f87171`/`#22d3ee`); light greys (`#e2e8f0`/`#cbd5e1`) for text |
| Judging chip/badge text contrast against the page | Text inside a colored chip is read against the **chip** fill, not the page; a pill at `opacity=0.18` + colored text is borderline and often fails | Compute contrast against the chip's **effective** (post-opacity) fill; verify by zooming into a screenshot |
| Loose TMDL indentation on the measure, or trusting the render after a fix | Trailing measure properties (`lineageTag`, `dataCategory`) at anything other than **exactly 2 tabs** throw a whole-model SYNTAXERROR; and Desktop can replay the OLD error from a stale `.pbi/cache.abf` after the measure is already fixed | Indent trailing props with exactly 2 tabs. If the same error persists after a correct fix, delete `.pbi/cache.abf` and Refresh now |

Layering → reference.md §10; full symptom → cause → fix debugging table → reference.md §11.

## Output Format

Every measure output must be:
1. Complete — first line to last line, no abbreviations
2. Wrapped in a DAX code block: ```dax ... ```
3. Commented — include short inline comments for non-obvious logic
4. Formatted — proper indentation, one attribute per line in CONCATENATEX for readability
5. Tested mentally — walk through the logic with sample values to catch coordinate errors before presenting

## Depth Index

reference.md: §1 two-level escaping (XML vs URI) · §2 coordinate system & viewBox sizes · §3 object sizing (anti-scrollbar ~12%) · §4 HTML Content host wrapper margins · §5 backing plate & padding in the report, not DAX · §6 SVG element reference · §7 DAX string construction (CONCATENATEX, FORMAT) · §8 color encoding & dark-theme rule · §9 recipe list (`references/recipes.md`) · §10 layering · §11 debugging table · §12 escaping chain order · §13 style guidelines · §14 performance.
