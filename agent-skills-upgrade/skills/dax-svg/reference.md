# DAX SVG — Reference

Depth file for the `dax-svg` skill. Sections are numbered so SKILL.md pointers (`reference.md §N`) resolve.

## §1. Escaping has TWO levels — do not merge them

("The chain" = the `RETURN` SUBSTITUTE chain from the core pattern in SKILL.md; full form in §12.)

The chain above is **URI-level** and runs once on the finished string. It cannot
carry XML escaping, because XML metacharacters must be escaped **per value**:

| Level | What | Where | Chars |
|---|---|---|---|
| XML | text that came **from data** | around each `[Column]` / label var | `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;` |
| URI | the whole finished `_svg` | once, in `RETURN` | `%`→`%25` (before `#`), `#`→`%23`, `"`→`'` |

Applying `&`→`&amp;` globally instead of per value looks equivalent and is not:

- `<` and `>` **cannot** join the global chain — they would escape the SVG's own
  tags and destroy the markup. So a label like `"< 1 року"` or `"P&L > plan"`
  reaches the parser raw and **the whole visual renders as a broken image**.
- Add `<`→`&lt;` per value while `&`→`&amp;` still runs globally, and the global
  pass turns `&lt;` into `&amp;lt;` — the label renders as the literal text `&lt;`.

Inside the per-value chain the order is fixed: **`&` first**, otherwise it eats
the ampersands that `&lt;`/`&gt;` just introduced.

```dax
VAR _lbl = SUBSTITUTE( SUBSTITUTE( SUBSTITUTE(
               'fact'[TenureBand], "&", "&amp;" ), "<", "&lt;" ), ">", "&gt;" )
```

Symptom to recognise: **one** SVG visual is an empty tile / broken-image icon
while its siblings render, and the measure itself returns a normal-length
`data:image/svg+xml…` string when queried. The measure is fine; the payload is
not well-formed XML.

Diagnose by parsing, not by staring — pull the value over `executeQueries`,
`urllib.parse.unquote` it and `ET.fromstring` it. The parse error names the exact
column. Guessing which of five measures is broken costs far more.

A rename hack like `SUBSTITUTE([Dept], "Research & Development", "R and D")`
is a sign the escaping is wrong at the design level, not a fix.

## §2. SVG Coordinate System

SVG uses a top-left origin: x grows right, y grows down.

`viewBox="0 0 W H"` defines the coordinate space. All coordinates inside the SVG are relative to this box.
In a table/matrix cell the SVG is constrained by the column width and row height; for a standalone object Power BI renders it at its intrinsic (`viewBox`) size and does not upscale it. To avoid clipping and scrollbars, size the SVG smaller than the object — see *Power BI Object Sizing* below.

Common viewBox sizes:
- Narrow cell (badge, indicator): `viewBox="0 0 100 30"`
- Bar chart in a cell: `viewBox="0 0 200 20"`
- Radar chart: `viewBox="0 0 200 200"`
- Complex multi-element: `viewBox="0 0 300 100"`

## §3. Power BI Object Sizing (Prevent Scrollbars)

Power BI renders the measure's SVG at its intrinsic pixel size — the `viewBox` dimensions (and any explicit `width`/`height`). It does **not** reliably scale the SVG up to fill the visual, so if the SVG is as large as, or larger than, the visual's content area, Power BI clips the edges (the descenders of the bottom text row vanish) and shows a scrollbar.

**Rule: size the SVG ~12% smaller than the Power BI object.** Equivalently, the object should be ~10% larger than the SVG. The margin absorbs rounding, borders, and the visual's internal padding, so no scrollbar appears.

For a Power BI object of `W × H` px:
- `viewBox = "0 0 round(W × 0.88) round(H × 0.88)"`
- set explicit `width` / `height` on `<svg>` to the same numbers
- leave an internal bottom margin of ~8–12% of the height below the last text baseline so descenders never clip

Example — object `510 × 140` → `width='449' height='123' viewBox='0 0 449 123'`, with the lowest caption baseline at ~`y=109` (≈14px of clear space below it).

This is the fix for the common "scrollbar + clipped bottom labels" symptom.

## §4. HTML Content host: wrapper margins + card inset (verified on a production report, 2026-07-28)

The `htmlContent…` custom visual wraps the raw SVG in its own HTML container with **~16px of
extra chrome (body margins/padding)**. Sizing the SVG to the naive 0.88 ratio of the object can
STILL scroll: a 1142×110 SVG in a 1298×124 object showed a vertical scrollbar because
110 + wrapper margins > 124. Budget the wrapper explicitly:

- `svgH ≤ objectH - 20`, `svgW ≤ objectW - 20` (safer than a bare ratio for short/wide objects).

When the SVG draws its own white "card" background on a colored report page, use TWO levels of
padding, both inside the viewBox (the visual itself gives you neither):

- **Outer inset** (page shows around the card): card `<rect>` at ~`x=6 y=3`,
  `width = W-12`, `height = H-6`, `rx≈10`, `stroke` in the report's divider color.
- **Inner padding** (content off the card edge): first text baseline ≥ card top + 14,
  last baseline ≤ card bottom - 4, content x inset ≥ 18 from card sides.

Symptom table addition: "card touches visual edges + thin empty strips + scrollbar" → SVG sized
to the full object with no wrapper budget and no card inset — apply both rules above.

## §5. Backing plate + internal padding — put them in the report, not in the DAX

An SVG that paints its own background bakes the theme into DAX: the fill cannot follow a retheme,
corners cannot be rounded natively, and one palette change means editing every measure. Native
container chrome does all of it once. Prefer this split:

| Concern | Where it belongs |
|---|---|
| Background fill, rounded corners, border, shadow | container `visualContainerObjects` (`border.radius`, `dropShadow`) or a `shape` behind |
| Title / subtitle | container `title` / `subTitle` — **not** a `<text>` heading inside the SVG |
| Padding between artwork and plate edge | **geometry of the image object** |
| Data marks only | the SVG |

The measure therefore returns a **transparent** SVG: no full-bleed `<rect>`, no
`style="background:…"` on the root.

**Internal padding is a positioning problem, not a drawing problem.** An `image` visual with
`fit: 'Fit'` fills its container edge to edge and exposes no padding property. Give the plate
and the artwork two different boxes:

```
plate   x,      y,      w,        h          <- shape: fill, rounded, shadow
image   x + P,  y + T,  w - 2·P,  h - T - P  <- transparent container, carries title/subTitle
```

`P` = 16 (side and bottom inset), `T` = 12 when the image object carries the title itself
(its own title block then supplies the top padding), else `T` = P. Under 12 px reads as a
rendering fault; over 24 px wastes plot area.

The deploy-free alternative when the measure cannot be changed: keep one box but set
`fit: 'Normal'` and size the `viewBox` ~12% under the object (see *Power BI Object Sizing*) —
the leftover space becomes the padding. `fit: 'Fit'` cancels this and must not be combined with it.

**Symptom → cause**

| Symptom | Cause |
|---|---|
| Artwork runs into the rounded corners; corners look clipped | image object shares the plate's box — inset it |
| Opaque white square on a themed page | SVG paints its own background — drop the full-bleed rect |
| Title rendered twice | container `title` **and** a `<text>` heading in the SVG |
| Plate has no rounding or shadow at all | the chrome helper was wrapped around the chart constructor only and the image constructor bypassed it — wrap **every** container constructor, then verify by reading the produced JSON, not the call sites |

## §6. Core SVG Elements Reference

### Rectangle
```xml
<rect x='10' y='5' width='80' height='15' rx='3' fill='#4CAF50'/>
```
- `rx` — corner radius (rounded corners)
- Use for bars, backgrounds, progress indicators

### Circle
```xml
<circle cx='50' cy='50' r='40' fill='none' stroke='#2196F3' stroke-width='3'/>
```
- `cx`, `cy` — center coordinates
- `r` — radius

### Line
```xml
<line x1='0' y1='50' x2='200' y2='50' stroke='#999' stroke-width='1' stroke-dasharray='4,2'/>
```
- `stroke-dasharray` — dashed line pattern (dash length, gap length)

### Path
```xml
<path d='M 10 80 L 50 20 L 90 60 L 130 30' fill='none' stroke='#FF5722' stroke-width='2'/>
```
- `M` — move to (start point)
- `L` — line to
- `A` — arc (for curves)
- `Z` — close path

### Text
```xml
<text x='50' y='15' font-size='11' fill='#333' text-anchor='middle' dominant-baseline='central'>Label</text>
```
- `text-anchor`: `start` | `middle` | `end` — horizontal alignment relative to x
- `dominant-baseline`: `auto` | `central` | `hanging` — vertical alignment relative to y
- `font-family`: use `Segoe UI, sans-serif` for Power BI consistency
- **An unescaped `%` in text content blanks the whole cell** — `FORMAT(x, "0.0%")` emits `"126.5%"`, and `%` opens a URI escape. The `<text>` element itself renders fine; escape `%`→`%25` (see Escaping Rules).

### Polygon
```xml
<polygon points='100,10 40,198 190,78 10,78 160,198' fill='#FFD700' stroke='#333'/>
```
- Points as comma-separated x,y pairs

## §7. DAX String Construction Patterns

### Basic concatenation
```dax
VAR _bar =
    "<rect x='0' y='0' width='" & FORMAT(_value, "0.0") & "' height='16' fill='" & _color & "'/>"
```

### CONCATENATEX for repeating elements
When you need to render one element per row (e.g., one bar per category):

```dax
VAR _bars =
    CONCATENATEX(
        _table,
        "<rect"
            & " x='" & FORMAT([_x], "0.0") & "'"
            & " y='" & FORMAT([_y], "0.0") & "'"
            & " width='" & FORMAT([_w], "0.0") & "'"
            & " height='16'"
            & " fill='" & [_color] & "'"
        & "/>",
        "",
        [_sortCol], ASC
    )
```

The 3rd argument of CONCATENATEX is the delimiter (empty string = no separator).
The 4th/5th arguments control sort order — critical for layering (elements rendered later appear on top).

### FORMAT for numeric precision
Always use FORMAT for coordinates and dimensions, and pass an explicit dot-locale as the third argument so the decimal separator is never a comma:
- `FORMAT(_val, "0.0", "en-US")` — one decimal, dot guaranteed
- `FORMAT(_val, "0", "en-US")` — integer
- `FORMAT(_pct, "0.00%", "en-US")` — displayed percentage in text elements

**Never use ROUND for SVG coordinates** — FORMAT produces a string directly; ROUND returns a number that may pick up a locale decimal separator (comma vs dot).

**Always pass `"en-US"` to FORMAT for every coordinate and dimension.** In a non-US model (e.g. uk-UA, where the decimal separator is a comma) plain `FORMAT(_val, "0.0")` emits `"161,6"`, which is invalid inside an SVG attribute and silently breaks the render. The third argument forces a dot: `FORMAT(_val, "0.0", "en-US")` → `"161.6"`. The same applies to every measure in `references/recipes.md`.

For grouped value labels, force the thousands separator to a space regardless of locale:
`SUBSTITUTE( FORMAT( _val, "#,##0", "en-US" ), ",", " " )` → `"120 000"`.

## §8. Color Encoding Patterns

### Conditional color via SWITCH/IF
```dax
VAR _color =
    SWITCH(
        TRUE(),
        _value >= 0.9, "#4CAF50",   // green
        _value >= 0.7, "#FFC107",   // amber
        _value >= 0.5, "#FF9800",   // orange
        "#F44336"                    // red
    )
```

### Gradient via interpolation
For smooth color transitions, interpolate RGB channels:

```dax
VAR _r = INT(255 * (1 - _normalized) + 76 * _normalized)
VAR _g = INT(67 * (1 - _normalized) + 175 * _normalized)
VAR _b = INT(55 * (1 - _normalized) + 80 * _normalized)
VAR _color = "rgb(" & _r & "," & _g & "," & _b & ")"
```

Where `_normalized` is a value between 0 and 1.

> **Caution — avoid `<linearGradient>` / `<radialGradient>` in Power BI.** Gradient elements referenced via `fill='url(#id)'` frequently render blank in Power BI's data-URI SVG: the `#` is URL-encoded to `%23` and the paint-server reference often fails to resolve, leaving the shape invisible. Use **flat fills**. To fake a gradient, compute one flat color per element with the `rgb()` interpolation above, or stack a few flat `<rect>` bands of stepped colors.

### Dark-theme color rule
On a **dark** report, medium greys read as pure black and disappear. This is a verified production failure — a value/label styled `#475569` or `#64748b` on a dark page looks black, not grey.

- **Accents:** use only bright tokens — `#34d399` (green), `#fcd34d` (amber), `#f87171` (red), `#22d3ee` (cyan).
- **Text / gridlines on dark:** light greys — `#e2e8f0`, `#cbd5e1`.
- The "dark grey text" defaults in *Style Guidelines* below apply to **light** reports only.

### Hex color encoding
When using `#` in SVG inside DAX, the `#` must be escaped in the final SUBSTITUTE chain:
```dax
SUBSTITUTE(_svg, "#", "%23")
```
This is already handled by the standard SUBSTITUTE chain (`%`→`%25` must run **before** `#`→`%23`). Never forget it.

## §9. Common Visualization Recipes

Read `references/recipes.md` for full copy-paste-ready measures for:
- Horizontal bar chart with label
- Progress ring (donut)
- Bullet chart
- Sparkline
- Radar/spider chart
- Badge/indicator with icon
- Waffle chart
- Lollipop chart
- Heatmap cell
- Gaussian/bell curve overlay

## §10. Layering: never overlap on top of transparent / `fill='none'`

A solid `<rect>` drawn **on top of** a semi-transparent (`opacity`) rect or a `fill='none'` rect can silently fail to paint — the top shape vanishes. This breaks the intuitive "track + fill" overlay pattern.

**Build progress and track bars as TWO side-by-side solid rects** — the filled portion and the remainder — with edges touching and **no overlap**:

```xml
<!-- track = two solid segments, not a fill over a translucent track -->
<rect x='0'  y='6' width='60'  height='8' rx='4' fill='#34d399'/>  <!-- done -->
<rect x='60' y='6' width='40'  height='8' rx='4' fill='#334155'/>  <!-- remaining -->
```

Do not stack a solid fill over a translucent background bar and expect the fill to show.

## §11. Debugging SVG in DAX

Common issues and fixes:

| Symptom | Cause | Fix |
|---------|-------|-----|
| Blank cell | Missing `data:image/svg+xml;utf8,` prefix | Add the prefix to RETURN |
| Blank cell | Unescaped `#` in color | Ensure SUBSTITUTE chain includes `"#", "%23"` |
| Blank cell | Double quotes in SVG | Use single quotes inside SVG, or escape via SUBSTITUTE |
| Blank cell | `&` in text content | Ensure SUBSTITUTE chain includes `"&", "&amp;"` |
| Solid black cell (whole SVG gone) | Unescaped `%` in a text label (e.g. `FORMAT(…, "0.0%")` → `"126.5%"`) breaks the data URI | Add `%`→`%25` to the SUBSTITUTE chain, before `#`→`%23`; do not remove the `<text>` |
| Raw `data:image/svg+xml,…` string shown | Measure placed in a Card visual | Move to a table/matrix cell — a card won't render an Image-URL SVG |
| Progress fill / overlay missing | Solid rect overlaps a semi-transparent or `fill='none'` rect | Use two side-by-side solid rects, no overlap |
| Rect/line/text invisible on a dark report | Medium grey reads as black on dark bg | Use bright accent tokens; light greys for text |
| Image icon instead of SVG | Data category not set to Image URL | Set measure → Properties → Data Category → Image URL |
| Coordinates wrong | Locale uses comma as decimal separator | Use FORMAT with `"en-US"`, not ROUND or direct number concatenation |
| Elements overlap | Wrong y-offset calculation | Check RANKX or row-index calculation for y positions |
| Text cut off | viewBox too small | Increase viewBox dimensions |
| Scrollbar + clipped bottom/edge labels | SVG intrinsic size ≥ visual content area | Make the SVG ~12% smaller than the object (see Power BI Object Sizing) |
| Same error after fixing the measure | Stale `.pbi/cache.abf` served by Desktop | Delete `.pbi/cache.abf`, then Refresh now |
| SVG not scaling | Missing viewBox | Always include viewBox attribute on `<svg>` |

## §12. Escaping Rules Summary

The RETURN statement must always end with:
```dax
RETURN
    "data:image/svg+xml;utf8,"
    & SUBSTITUTE(
        SUBSTITUTE(
            SUBSTITUTE(
                SUBSTITUTE(_svg, "&", "&amp;"),
                "%", "%25"
            ),
            "#", "%23"
        ),
        """", "'"
    )
```

Order matters:
1. First escape `&` → `&amp;` (otherwise you'd double-escape `&amp;` later)
2. Then escape `%` → `%25` — **before** `#`, or `%23` turns into `%2523` and also breaks. A stray `%` usually comes from `FORMAT(x, "0.0%")` in a text label (the I-10 root cause: unescaped `%`, not the `<text>` element)
3. Then escape `#` → `%23`
4. Then escape `"` → `'` (replaces any remaining double quotes with single quotes)

## §13. Style Guidelines

- Use `Segoe UI` as font-family — it matches Power BI's native look
- Default font-size: 11 for labels, 9 for secondary text
- Use `opacity` only for standalone background bands — **never draw a solid fill on top of a semi-transparent or `fill='none'` rect**, as the top rect can silently drop out (see Layering / Common Mistakes). Prefer separate, non-overlapping solid shapes.
- Add `rx='2'` or `rx='3'` to rect for modern rounded look
- Use `stroke-linecap='round'` on lines for polished endpoints
- **Light reports:** axis lines / gridlines light grey `#E0E0E0` or `#CCCCCC`; text dark grey `#333333` or `#666666`, not pure black.
- **Dark reports:** those greys invert — medium greys read as black. Use bright accent tokens (`#34d399`/`#fcd34d`/`#f87171`/`#22d3ee`) and light-grey text (`#e2e8f0`/`#cbd5e1`). See *Dark-theme color rule*.
  (Layering = §10; Common Mistakes = SKILL.md; Dark-theme color rule = §8.)

## §14. Performance Considerations

- SVG measures are evaluated per cell. In a matrix with 1000 rows, the measure runs 1000 times.
- Keep SVG string length reasonable — avoid unnecessary whitespace or attributes.
- CONCATENATEX inside an SVG measure that itself is inside a matrix can be very slow if the inner table is large.
- For sparklines, limit data points to 12–20 max.
- Avoid nested CONCATENATEX when possible — flatten to a single pass.
