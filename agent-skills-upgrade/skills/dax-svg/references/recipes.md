# DAX SVG — Recipes

Referenced by reference.md §9. Full copy-paste-ready Image-URL measures for the ten standard SVG-in-DAX visuals.

## Index

| # | Recipe | viewBox | Typical host |
|---|--------|---------|--------------|
| 1 | Horizontal bar chart with label | `0 0 200 20` | table/matrix cell |
| 2 | Progress ring (donut) | `0 0 100 100` | table/matrix cell |
| 3 | Bullet chart | `0 0 200 20` | table/matrix cell |
| 4 | Sparkline | `0 0 150 40` | table/matrix cell |
| 5 | Radar/spider chart | `0 0 200 200` | single-row table |
| 6 | Badge/indicator with icon | `0 0 100 30` | table/matrix cell |
| 7 | Waffle chart | `0 0 108 108` | single-row table |
| 8 | Lollipop chart | `0 0 200 20` | table/matrix cell |
| 9 | Heatmap cell | `0 0 100 30` | matrix cell |
| 10 | Gaussian/bell curve overlay | `0 0 200 60` | table/matrix cell |

## Shared conventions

Every recipe below follows the skill's verified rules — do not "simplify" them away:

- **Rendering target = Image URL.** Set the measure's Data Category to *Image URL* and place it in a **table or matrix cell** — a Card prints the raw string (SKILL.md). For a direct-SVG host (HTML Content etc.) return the raw `_svg` with no prefix and no SUBSTITUTE chain instead — see SKILL.md "Choose the ending by rendering target".
- **Canonical ending.** Every measure ends with `"data:image/svg+xml;utf8," & SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(_svg, "&", "&amp;"), "%", "%25"), "#", "%23"), """", "'")`. Order is fixed: `&` first, `%` **before** `#`, then `"`→`'` (reference.md §12).
- **Coordinates.** Every computed number is emitted via `FORMAT(_x, "0.0", "en-US")` (or `"0"` for integers) — never bare concatenation, never locale-default FORMAT (§7). Static literals typed directly into the string (`x='0'`, `height='8'`) are already strings and need nothing.
- **Transparent SVG.** No full-bleed background rect — background, rounded corners and title belong to the Power BI container (§5). Size the PBI object ~12% larger than the viewBox to avoid scrollbars (§3).
- **Attribute quoting.** Single quotes inside the DAX string, so the final `"`→`'` substitution is harmless.
- **Colors.** Dark-report accent tokens: `#34d399` green, `#fcd34d` amber, `#f87171` red, `#22d3ee` cyan; light-grey text `#e2e8f0`/`#cbd5e1`; muted structure `#334155`/`#1e293b` (§8). Literal `#` is fine — the ending chain converts it to `%23`. Each recipe's Tuning list includes the light-theme swap.
- **Placeholders.** `[Value]`, `[Target]`, `'Table'[Category]`, `'Calendar'[MonthKey]` are placeholders for your model's measures/columns — replace them, keep everything else.

---

## 1. Horizontal bar chart with label

An in-cell data bar with a right-aligned value label, scaled to the maximum across the visible categories so bars are comparable row to row. viewBox `0 0 200 20`; bar zone is x 0–150, label zone x 155–200. The track is two side-by-side solid rects (done + remainder) per §10 — never a fill over a translucent rect. The label is numeric only, so no per-value XML escaping is needed; a text label from data would need §1 treatment.

```dax
SVG Bar with Label =
VAR _val = [Value]
VAR _max =
    MAXX( ALLSELECTED( 'Table'[Category] ), [Value] )   -- shared scale across rows
VAR _ratio =
    MAX( MIN( DIVIDE( _val, _max, 0 ), 1 ), 0 )   -- clamp negatives
VAR _barMax = 150
VAR _barW = _barMax * _ratio
VAR _restW = _barMax - _barW
VAR _lbl =
    SUBSTITUTE( FORMAT( _val, "#,##0", "en-US" ), ",", " " )   -- 120 000, locale-proof
VAR _svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='20' viewBox='0 0 200 20'>"
        -- done + remainder: two touching solid rects, no overlap (§10)
        & "<rect x='0' y='6' width='" & FORMAT( _barW, "0.0", "en-US" )
            & "' height='8' rx='4' fill='#34d399'/>"
        & "<rect x='" & FORMAT( _barW, "0.0", "en-US" )
            & "' y='6' width='" & FORMAT( _restW, "0.0", "en-US" )
            & "' height='8' rx='4' fill='#334155'/>"
        & "<text x='155' y='10' font-family='Segoe UI, sans-serif' font-size='11'"
            & " fill='#e2e8f0' text-anchor='start' dominant-baseline='central'>"
            & _lbl
        & "</text>"
    & "</svg>"
RETURN
    IF(
        NOT ISBLANK( _val ),
        "data:image/svg+xml;utf8,"
            & SUBSTITUTE(
                SUBSTITUTE(
                    SUBSTITUTE(
                        SUBSTITUTE( _svg, "&", "&amp;" ),
                        "%", "%25"
                    ),
                    "#", "%23"
                ),
                """", "'"
            )
    )
```

Tuning:
- Bar color: swap `#34d399` for `#22d3ee` (neutral series) or a SWITCH on thresholds (§8).
- Widths: change `_barMax` and the `x='155'` label start together; keep label zone ≥ 40 px.
- Scale: replace `ALLSELECTED('Table'[Category])` with `ALL(...)` for a page-independent scale.
- Light theme: remainder `#334155` → `#E0E0E0`; label `#e2e8f0` → `#333333`; accent can stay or deepen to `#059669`.

## 2. Progress ring (donut)

A percent-to-target ring with a centered label, viewBox `0 0 100 100`. The ring is drawn as **two non-overlapping dash arcs** on the same circle — progress and remainder occupy disjoint spans (the remainder arc is shifted with a negative `stroke-dashoffset`), honoring the no-overlay rule (§10) in stroke form. The `%` in the center label is exactly why the ending chain is mandatory: unescaped `%` blanks the whole cell (§11).

```dax
SVG Progress Ring =
VAR _pct =
    MIN( MAX( DIVIDE( [Value], [Target], 0 ), 0 ), 1 )
VAR _r = 40
VAR _circ = 2 * PI() * _r          -- ≈ 251.3
VAR _done = _circ * _pct
VAR _rest = _circ - _done
VAR _lbl = FORMAT( _pct, "0%", "en-US" )   -- the '%' is escaped by the RETURN chain
VAR _svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'>"
        -- progress arc: draw _done, skip _rest; rotated to start at 12 o'clock
        & "<circle cx='50' cy='50' r='" & FORMAT( _r, "0", "en-US" )
            & "' fill='none' stroke='#34d399' stroke-width='12'"
            & " stroke-dasharray='" & FORMAT( _done, "0.0", "en-US" )
            & " " & FORMAT( _rest, "0.0", "en-US" )
            & "' transform='rotate(-90 50 50)'/>"
        -- remainder arc: same circle, dash pattern shifted by -_done so the
        -- two arcs cover disjoint spans — no overlap, no translucent track (§10)
        & "<circle cx='50' cy='50' r='" & FORMAT( _r, "0", "en-US" )
            & "' fill='none' stroke='#334155' stroke-width='12'"
            & " stroke-dasharray='" & FORMAT( _rest, "0.0", "en-US" )
            & " " & FORMAT( _done, "0.0", "en-US" )
            & "' stroke-dashoffset='" & FORMAT( - _done, "0.0", "en-US" )
            & "' transform='rotate(-90 50 50)'/>"
        & "<text x='50' y='50' font-family='Segoe UI, sans-serif' font-size='20' font-weight='600'"
            & " fill='#e2e8f0' text-anchor='middle' dominant-baseline='central'>"
            & _lbl
        & "</text>"
    & "</svg>"
RETURN
    IF(
        NOT ISBLANK( [Value] ) && NOT ISBLANK( [Target] ),
        "data:image/svg+xml;utf8,"
            & SUBSTITUTE(
                SUBSTITUTE(
                    SUBSTITUTE(
                        SUBSTITUTE( _svg, "&", "&amp;" ),
                        "%", "%25"
                    ),
                    "#", "%23"
                ),
                """", "'"
            )
    )
```

Tuning:
- Thickness: `stroke-width='12'`; if you increase it, shrink `_r` so `_r + width/2 ≤ 50`.
- Conditional ring color: `SWITCH(TRUE(), _pct >= 0.9, "#34d399", _pct >= 0.7, "#fcd34d", "#f87171")`.
- Rounded arc ends: add `stroke-linecap='round'` to the progress circle only (caps extend slightly into the remainder span — acceptable at ≥ 5%).
- Light theme: remainder `#334155` → `#E0E0E0`; label `#e2e8f0` → `#333333`.

## 3. Bullet chart

Compact target-vs-actual with qualitative bands, viewBox `0 0 200 20`. The three bands are **solid** stepped fills laid side by side (no `opacity` — §13), so the value bar may sit on top of them: the documented paint failure only concerns solid shapes over translucent or `fill='none'` shapes (§10). Bands here are 60% / 85% / beyond of `[Target]`; the amber tick marks the target itself.

```dax
SVG Bullet Chart =
VAR _val = [Value]
VAR _tgt = [Target]
VAR _bandPoor = 0.60          -- band edges as fractions of target
VAR _bandOk = 0.85
VAR _axisMax = MAX( MAX( _val, _tgt ) * 1.10, 1 )   -- 10% headroom so no mark clips
VAR _w = 200
VAR _xVal = MAX( DIVIDE( _val, _axisMax, 0 ), 0 ) * _w   -- clamp negatives
VAR _xTgt = DIVIDE( _tgt, _axisMax, 0 ) * _w
VAR _xPoor = DIVIDE( _bandPoor * _tgt, _axisMax, 0 ) * _w
VAR _xOk = DIVIDE( _bandOk * _tgt, _axisMax, 0 ) * _w
VAR _svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='20' viewBox='0 0 200 20'>"
        -- three SOLID stepped bands, side by side (no opacity, §13)
        & "<rect x='0' y='2' width='" & FORMAT( _xPoor, "0.0", "en-US" )
            & "' height='16' fill='#1e293b'/>"
        & "<rect x='" & FORMAT( _xPoor, "0.0", "en-US" )
            & "' y='2' width='" & FORMAT( _xOk - _xPoor, "0.0", "en-US" )
            & "' height='16' fill='#334155'/>"
        & "<rect x='" & FORMAT( _xOk, "0.0", "en-US" )
            & "' y='2' width='" & FORMAT( _w - _xOk, "0.0", "en-US" )
            & "' height='16' fill='#475569'/>"
        -- actual: solid bar over solid bands (allowed; never over translucent, §10)
        & "<rect x='0' y='7' width='" & FORMAT( _xVal, "0.0", "en-US" )
            & "' height='6' rx='3' fill='#22d3ee'/>"
        -- target tick
        & "<line x1='" & FORMAT( _xTgt, "0.0", "en-US" )
            & "' y1='3' x2='" & FORMAT( _xTgt, "0.0", "en-US" )
            & "' y2='17' stroke='#fcd34d' stroke-width='2'/>"
    & "</svg>"
RETURN
    IF(
        NOT ISBLANK( _val ) && NOT ISBLANK( _tgt ),
        "data:image/svg+xml;utf8,"
            & SUBSTITUTE(
                SUBSTITUTE(
                    SUBSTITUTE(
                        SUBSTITUTE( _svg, "&", "&amp;" ),
                        "%", "%25"
                    ),
                    "#", "%23"
                ),
                """", "'"
            )
    )
```

Tuning:
- Band thresholds: replace `_bandPoor`/`_bandOk` constants with threshold measures.
- Actual bar color by attainment: SWITCH on `DIVIDE(_val, _tgt)` with the accent tokens.
- Fixed cross-row scale: replace `_axisMax` with `MAXX(ALLSELECTED('Table'[Category]), [Target]) * 1.2`.
- Light theme: bands `#1e293b`/`#334155`/`#475569` → `#EEEEEE`/`#DDDDDD`/`#CCCCCC`; keep bar `#22d3ee` or deepen to `#0891b2`; target tick `#fcd34d` → `#d97706`.

## 4. Sparkline

A per-row trend line over the periods visible in the current filter context, viewBox `0 0 150 40`, with an accent dot on the latest point. Keep the series to 12–20 points (§14). **Sort discipline:** CONCATENATEX must be given an explicit `ORDER BY` on the period *key* — never rely on the engine's scan order, or the polyline zig-zags. The same key drives the RANKX index used for x positions.

```dax
SVG Sparkline =
VAR _w = 150
VAR _h = 40
VAR _padX = 4
VAR _padY = 6
VAR _pts =
    FILTER(
        ADDCOLUMNS(
            VALUES( 'Calendar'[MonthKey] ),   -- sortable key, e.g. 202401 … 202412
            "@v", [Value]
        ),
        NOT ISBLANK( [@v] )                   -- a blank point would emit "x," and break the polyline
    )
VAR _n = COUNTROWS( _pts )
VAR _den = IF( _n > 1, _n - 1, 1 )
VAR _minV = MINX( _pts, [@v] )
VAR _maxV = MAXX( _pts, [@v] )
VAR _rng = IF( _maxV = _minV, 1, _maxV - _minV )   -- flat series → centered line, no div/0
VAR _off = IF( _maxV = _minV, 0.5, 0 )
VAR _idx =
    ADDCOLUMNS(
        _pts,
        "@i", RANKX( _pts, 'Calendar'[MonthKey], , ASC, DENSE )
    )
VAR _points =
    CONCATENATEX(
        _idx,
        FORMAT( _padX + ( [@i] - 1 ) * ( _w - 2 * _padX ) / _den, "0.0", "en-US" )
            & ","
            & FORMAT( _h - _padY - ( [@v] - _minV + _off ) / _rng * ( _h - 2 * _padY ), "0.0", "en-US" ),
        " ",
        'Calendar'[MonthKey], ASC             -- ORDER BY the key: sort discipline
    )
VAR _lastV = MAXX( FILTER( _idx, [@i] = _n ), [@v] )
VAR _lastX = _padX + ( _n - 1 ) * ( _w - 2 * _padX ) / _den
VAR _lastY = _h - _padY - ( _lastV - _minV + _off ) / _rng * ( _h - 2 * _padY )
VAR _svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='150' height='40' viewBox='0 0 150 40'>"
        & "<polyline points='" & _points
            & "' fill='none' stroke='#22d3ee' stroke-width='1.5'"
            & " stroke-linecap='round' stroke-linejoin='round'/>"
        & "<circle cx='" & FORMAT( _lastX, "0.0", "en-US" )
            & "' cy='" & FORMAT( _lastY, "0.0", "en-US" )
            & "' r='2.5' fill='#34d399'/>"
    & "</svg>"
RETURN
    IF(
        _n > 0,
        "data:image/svg+xml;utf8,"
            & SUBSTITUTE(
                SUBSTITUTE(
                    SUBSTITUTE(
                        SUBSTITUTE( _svg, "&", "&amp;" ),
                        "%", "%25"
                    ),
                    "#", "%23"
                ),
                """", "'"
            )
    )
```

Tuning:
- Point cap: pre-filter to the last N keys with `TOPN(12, ..., 'Calendar'[MonthKey], DESC)` (§14).
- Min/max markers: add two more small circles at the `_minV`/`_maxV` points (`#f87171` for min).
- Last-point emphasis: enlarge `r` or color it by trend (`_lastV` vs previous point).
- Light theme: line `#22d3ee` → `#0891b2`; dot `#34d399` → `#059669`.

## 5. Radar/spider chart

One polygon over N category axes, viewBox `0 0 200 200`, center (100,100), outer radius 70. Angles come from `SIN`/`COS` with degrees × `PI()/180`, first axis pointing up (−90°). The data shape is a **polyline whose first vertex is repeated at the end** to close it, drawn `fill='none'` with vertex dots — no fill over the `fill='none'` grid circles (§10). Put this measure in a table with no category on rows (one cell shows all axes); it needs at least 3 categories.

```dax
SVG Radar Chart =
VAR _cx = 100
VAR _cy = 100
VAR _rMax = 70
VAR _axes =
    ADDCOLUMNS(
        ALLSELECTED( 'Table'[Category] ),
        "@v", [Value]
    )
VAR _n = COUNTROWS( _axes )
VAR _maxV = MAXX( _axes, [@v] )
VAR _idx =
    ADDCOLUMNS(
        _axes,
        "@i", RANKX( _axes, 'Table'[Category], , ASC, DENSE )
    )
VAR _grid =
    "<circle cx='100' cy='100' r='" & FORMAT( _rMax / 3, "0.0", "en-US" )
        & "' fill='none' stroke='#cbd5e1' stroke-width='0.4'/>"
    & "<circle cx='100' cy='100' r='" & FORMAT( _rMax * 2 / 3, "0.0", "en-US" )
        & "' fill='none' stroke='#cbd5e1' stroke-width='0.4'/>"
    & "<circle cx='100' cy='100' r='" & FORMAT( _rMax, "0.0", "en-US" )
        & "' fill='none' stroke='#cbd5e1' stroke-width='0.4'/>"
VAR _spokes =
    CONCATENATEX(
        _idx,
        VAR _a = ( ( [@i] - 1 ) * 360 / _n - 90 ) * PI() / 180
        RETURN
            "<line x1='100' y1='100'"
            & " x2='" & FORMAT( _cx + _rMax * COS( _a ), "0.0", "en-US" ) & "'"
            & " y2='" & FORMAT( _cy + _rMax * SIN( _a ), "0.0", "en-US" ) & "'"
            & " stroke='#cbd5e1' stroke-width='0.4'/>",
        "",
        'Table'[Category], ASC
    )
VAR _dataPts =
    CONCATENATEX(
        _idx,
        VAR _a = ( ( [@i] - 1 ) * 360 / _n - 90 ) * PI() / 180
        VAR _rr = _rMax * DIVIDE( [@v], _maxV, 0 )
        RETURN
            FORMAT( _cx + _rr * COS( _a ), "0.0", "en-US" ) & ","
            & FORMAT( _cy + _rr * SIN( _a ), "0.0", "en-US" ),
        " ",
        'Table'[Category], ASC
    )
-- close the polygon: repeat the first vertex (axis 1 points straight up)
VAR _firstV = MAXX( FILTER( _idx, [@i] = 1 ), [@v] )
VAR _firstR = _rMax * DIVIDE( _firstV, _maxV, 0 )
VAR _closed =
    _dataPts & " "
    & FORMAT( _cx, "0.0", "en-US" ) & ","
    & FORMAT( _cy - _firstR, "0.0", "en-US" )
VAR _dots =
    CONCATENATEX(
        _idx,
        VAR _a = ( ( [@i] - 1 ) * 360 / _n - 90 ) * PI() / 180
        VAR _rr = _rMax * DIVIDE( [@v], _maxV, 0 )
        RETURN
            "<circle cx='" & FORMAT( _cx + _rr * COS( _a ), "0.0", "en-US" )
            & "' cy='" & FORMAT( _cy + _rr * SIN( _a ), "0.0", "en-US" )
            & "' r='2.5' fill='#22d3ee'/>",
        "",
        'Table'[Category], ASC
    )
VAR _svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'>"
        & _grid
        & _spokes
        & "<polyline points='" & _closed
            & "' fill='none' stroke='#22d3ee' stroke-width='2' stroke-linejoin='round'/>"
        & _dots
    & "</svg>"
RETURN
    IF(
        _n >= 3,
        "data:image/svg+xml;utf8,"
            & SUBSTITUTE(
                SUBSTITUTE(
                    SUBSTITUTE(
                        SUBSTITUTE( _svg, "&", "&amp;" ),
                        "%", "%25"
                    ),
                    "#", "%23"
                ),
                """", "'"
            )
    )
```

Tuning:
- Axis scale: replace `_maxV` with a fixed cap measure when axes have known maxima (e.g. scores out of 10).
- Axis captions: add a `<text>` per axis at radius `_rMax + 12` with `text-anchor` switched on the angle — and XML-escape the category name per value (reference.md §1).
- Grid: `#cbd5e1` at `stroke-width='0.4'` is the dark-theme grid rule (§8); add rings by copying a circle with a new radius.
- Light theme: grid/spokes `#cbd5e1` → `#CCCCCC`; polygon `#22d3ee` → `#0891b2`.

## 6. Badge/indicator with icon

A pill chip with a direction glyph and a delta percentage, viewBox `0 0 100 30`. Literal `▲`/`▼`/`●` glyphs in `<text>` are fine — they render like any primitive (SKILL.md Common Mistakes). The chip is a **solid** dark fill: judge text contrast against the chip, not the page, and avoid the translucent-pill trap (a pill at `opacity≈0.18` plus colored text is borderline). The `%` in the label is handled by the ending chain.

```dax
SVG Delta Badge =
VAR _val = [Value]
VAR _base = [Target]          -- comparison base: target, prior year, plan…
VAR _delta = DIVIDE( _val - _base, _base )
VAR _up = _delta > 0.005      -- ±0.5% dead zone reads as "flat"
VAR _down = _delta < -0.005
VAR _accent =
    SWITCH( TRUE(), _up, "#34d399", _down, "#f87171", "#cbd5e1" )
VAR _glyph =
    SWITCH( TRUE(), _up, "▲", _down, "▼", "●" )
VAR _lbl = FORMAT( _delta, "+0.0%;-0.0%;0.0%", "en-US" )
VAR _svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='100' height='30' viewBox='0 0 100 30'>"
        -- solid chip: contrast is judged against THIS fill (SKILL.md)
        & "<rect x='2' y='4' width='96' height='22' rx='11' fill='#1e293b'/>"
        & "<text x='30' y='15' font-family='Segoe UI, sans-serif' font-size='9'"
            & " fill='" & _accent & "' text-anchor='middle' dominant-baseline='central'>"
            & _glyph
        & "</text>"
        & "<text x='40' y='15' font-family='Segoe UI, sans-serif' font-size='11' font-weight='600'"
            & " fill='" & _accent & "' text-anchor='start' dominant-baseline='central'>"
            & _lbl
        & "</text>"
    & "</svg>"
RETURN
    IF(
        NOT ISBLANK( _delta ),
        "data:image/svg+xml;utf8,"
            & SUBSTITUTE(
                SUBSTITUTE(
                    SUBSTITUTE(
                        SUBSTITUTE( _svg, "&", "&amp;" ),
                        "%", "%25"
                    ),
                    "#", "%23"
                ),
                """", "'"
            )
    )
```

Tuning:
- Semantics: for "lower is better" KPIs, swap the `_up`/`_down` color mapping, not the glyphs.
- Dead zone: widen `0.005` to suppress noise; or drop it for strict `>0`/`<0`.
- Path-arrow alternative: replace the glyph `<text>` with `<path d='M 26 18 L 30 12 L 34 18 Z' fill='...'/>` (up) / mirrored for down.
- Light theme: chip `#1e293b` → `#F0F0F0`; neutral `#cbd5e1` → `#666666`; accents deepen to `#059669`/`#dc2626` for contrast on the pale chip.

## 7. Waffle chart

A 10×10 grid where each square is 1% — filled squares grow bottom-up, left-to-right. viewBox `0 0 108 108` (10 cells of 9 px on an 11 px pitch). Cells are absolutely positioned and never overlap, so CONCATENATEX needs no ORDER BY here — layering is irrelevant (contrast with the sparkline). Note the `GENERATESERIES` column is literally named `Value`: unqualified `[Value]` inside the iterator resolves **measure-first**, so if your model contains a measure named exactly `Value`, rename it (or this pattern silently reads the measure).

```dax
SVG Waffle Chart =
VAR _pct =
    MIN( MAX( DIVIDE( [Value], [Target], 0 ), 0 ), 1 )
VAR _filled = ROUND( _pct * 100, 0 )
VAR _pitch = 11
VAR _cells =
    CONCATENATEX(
        GENERATESERIES( 0, 99, 1 ),
        -- [Value] here is GENERATESERIES's own column (0..99), NOT a model measure —
        -- see the naming caveat in the intro above
        VAR _i = [Value]
        VAR _row = INT( _i / 10 )
        VAR _col = MOD( _i, 10 )
        VAR _fill = IF( _i < _filled, "#34d399", "#334155" )
        RETURN
            "<rect x='" & FORMAT( _col * _pitch, "0", "en-US" )
            & "' y='" & FORMAT( ( 9 - _row ) * _pitch, "0", "en-US" )   -- bottom-up fill
            & "' width='9' height='9' rx='2' fill='" & _fill & "'/>",
        ""
    )
VAR _svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='108' height='108' viewBox='0 0 108 108'>"
        & _cells
    & "</svg>"
RETURN
    IF(
        NOT ISBLANK( [Value] ) && NOT ISBLANK( [Target] ),
        "data:image/svg+xml;utf8,"
            & SUBSTITUTE(
                SUBSTITUTE(
                    SUBSTITUTE(
                        SUBSTITUTE( _svg, "&", "&amp;" ),
                        "%", "%25"
                    ),
                    "#", "%23"
                ),
                """", "'"
            )
    )
```

Tuning:
- Fill direction: `y = _row * _pitch` fills top-down instead; swap `_col`/`_row` roles for column-wise fill.
- Threshold color: make `_fill` a SWITCH — e.g. filled squares `#f87171` while `_pct < 0.5`, `#fcd34d` to 0.8, `#34d399` above.
- Density: a 5×5 grid (each square = 4%) needs `GENERATESERIES(0, 24, 1)`, `/5`, `MOD(_i, 5)` and a recomputed pitch.
- Light theme: empty squares `#334155` → `#E0E0E0`; filled `#34d399` → `#059669`.

## 8. Lollipop chart

The lighter cousin of the in-cell bar: a stem, an accent head, and a right-aligned label. viewBox `0 0 200 20`; plot zone 0–145 leaves room for the head circle before the label zone at 155. Stem and axis remainder are two touching line segments — the same side-by-side discipline as bar tracks (§10) — with the head circle sitting on the joint.

```dax
SVG Lollipop =
VAR _val = [Value]
VAR _max =
    MAXX( ALLSELECTED( 'Table'[Category] ), [Value] )
VAR _plotMax = 145
VAR _x =
    MAX( MIN( DIVIDE( _val, _max, 0 ), 1 ) * _plotMax, 2 )   -- floor so the head never clips at 0
VAR _lbl =
    SUBSTITUTE( FORMAT( _val, "#,##0", "en-US" ), ",", " " )
VAR _svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='20' viewBox='0 0 200 20'>"
        -- stem 0→x and remainder x→plotMax: two touching segments, no overlap (§10)
        & "<line x1='0' y1='10' x2='" & FORMAT( _x, "0.0", "en-US" )
            & "' y2='10' stroke='#22d3ee' stroke-width='2' stroke-linecap='round'/>"
        & "<line x1='" & FORMAT( _x, "0.0", "en-US" )
            & "' y1='10' x2='" & FORMAT( _plotMax, "0.0", "en-US" )
            & "' y2='10' stroke='#334155' stroke-width='1'/>"
        & "<circle cx='" & FORMAT( _x, "0.0", "en-US" )
            & "' cy='10' r='4.5' fill='#22d3ee'/>"
        & "<text x='155' y='10' font-family='Segoe UI, sans-serif' font-size='11'"
            & " fill='#e2e8f0' text-anchor='start' dominant-baseline='central'>"
            & _lbl
        & "</text>"
    & "</svg>"
RETURN
    IF(
        NOT ISBLANK( _val ),
        "data:image/svg+xml;utf8,"
            & SUBSTITUTE(
                SUBSTITUTE(
                    SUBSTITUTE(
                        SUBSTITUTE( _svg, "&", "&amp;" ),
                        "%", "%25"
                    ),
                    "#", "%23"
                ),
                """", "'"
            )
    )
```

Tuning:
- Head: `r='4.5'` and `#22d3ee` — color the head by threshold while keeping the stem neutral for a subtle KPI read.
- Target variant: add a `#fcd34d` vertical tick like the bullet chart's at the target x.
- Remainder line: delete the second `<line>` for a floating lollipop with no axis remainder.
- Light theme: remainder `#334155` → `#E0E0E0`; stem/head `#22d3ee` → `#0891b2`; label `#e2e8f0` → `#333333`.

## 9. Heatmap cell

A matrix-cell rect whose fill interpolates between two flat colors computed channel-by-channel in DAX (`rgb(r,g,b)`), per the no-`<linearGradient>` rule (§8). viewBox `0 0 100 30`. The rect is the **data mark**, not container chrome, so it is allowed despite the transparent-background rule (§5) — it stays inset 1 px from the edges. The label color flips at mid-scale so text stays readable against its own cell.

```dax
SVG Heatmap Cell =
VAR _val = [Value]
VAR _minV = MINX( ALLSELECTED( 'Table'[Category] ), [Value] )
VAR _maxV = MAXX( ALLSELECTED( 'Table'[Category] ), [Value] )
VAR _t =
    MIN( MAX( DIVIDE( _val - _minV, _maxV - _minV, 0.5 ), 0 ), 1 )
-- interpolate #1e293b (30,41,59) → #34d399 (52,211,153) as flat rgb() — §8, no gradients
VAR _r = INT( 30 + ( 52 - 30 ) * _t )
VAR _g = INT( 41 + ( 211 - 41 ) * _t )
VAR _b = INT( 59 + ( 153 - 59 ) * _t )
VAR _fill =
    "rgb(" & FORMAT( _r, "0", "en-US" )
    & "," & FORMAT( _g, "0", "en-US" )
    & "," & FORMAT( _b, "0", "en-US" ) & ")"
VAR _txt = IF( _t > 0.55, "#0f172a", "#e2e8f0" )   -- dark text on bright fills, light on dark
VAR _lbl =
    SUBSTITUTE( FORMAT( _val, "#,##0", "en-US" ), ",", " " )
VAR _svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='100' height='30' viewBox='0 0 100 30'>"
        & "<rect x='1' y='1' width='98' height='28' rx='3' fill='" & _fill & "'/>"
        & "<text x='50' y='15' font-family='Segoe UI, sans-serif' font-size='11'"
            & " fill='" & _txt & "' text-anchor='middle' dominant-baseline='central'>"
            & _lbl
        & "</text>"
    & "</svg>"
RETURN
    IF(
        NOT ISBLANK( _val ),
        "data:image/svg+xml;utf8,"
            & SUBSTITUTE(
                SUBSTITUTE(
                    SUBSTITUTE(
                        SUBSTITUTE( _svg, "&", "&amp;" ),
                        "%", "%25"
                    ),
                    "#", "%23"
                ),
                """", "'"
            )
    )
```

Tuning:
- Normalization scope: in a matrix, normalize over both axes — `ALLSELECTED('Table'[Category], 'Calendar'[MonthKey])` — or the color only ranks within one row.
- Ramp: swap the high endpoint to `#f87171` (248,113,113) for a "hot = bad" scale; for a diverging scale, branch on `_t < 0.5` and interpolate each half to a midpoint color.
- Text flip point: retune `0.55` after changing endpoints — verify against the *effective* fill, not the page (SKILL.md).
- Light theme: interpolate `#FFFFFF` (255,255,255) → `#059669` (5,150,105) and flip text between `#333333` and `#FFFFFF`.

## 10. Gaussian/bell curve overlay

A normal-distribution curve sampled at 41 points into a polyline, with an amber marker showing where the current row's value sits within the population (mean ± 3σ across visible categories). viewBox `0 0 200 60`. `EXP(-z²/2)` is `NORM.DIST(x, μ, σ, FALSE)` rescaled to peak 1 — same shape, no normalizing constant needed. The same `GENERATESERIES` naming caveat as the waffle applies; here the ORDER BY **is** required, because polyline point order matters.

```dax
SVG Gaussian Overlay =
VAR _w = 200
VAR _h = 60
VAR _padX = 6
VAR _top = 8
VAR _baseY = 52
VAR _val = [Value]
VAR _pop =
    ADDCOLUMNS( ALLSELECTED( 'Table'[Category] ), "@v", [Value] )
VAR _mu = AVERAGEX( _pop, [@v] )
VAR _sd = STDEVX.P( _pop, [@v] )
VAR _plotW = _w - 2 * _padX
VAR _plotH = _baseY - _top
VAR _steps = 40
VAR _curve =
    CONCATENATEX(
        GENERATESERIES( 0, _steps, 1 ),
        -- [Value] = the series column (see waffle naming caveat)
        VAR _i = [Value]
        VAR _z = -3 + 6 * _i / _steps
        -- EXP(-z²/2) ≡ NORM.DIST(x, _mu, _sd, FALSE) / NORM.DIST(_mu, _mu, _sd, FALSE)
        VAR _y = _baseY - EXP( -0.5 * _z * _z ) * _plotH
        RETURN
            FORMAT( _padX + _plotW * _i / _steps, "0.0", "en-US" ) & ","
            & FORMAT( _y, "0.0", "en-US" ),
        " ",
        [Value], ASC                          -- point order matters for a polyline
    )
VAR _z0 = MIN( MAX( DIVIDE( _val - _mu, _sd ), -3 ), 3 )
VAR _xv = _padX + _plotW * ( _z0 + 3 ) / 6
VAR _svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='60' viewBox='0 0 200 60'>"
        -- baseline
        & "<line x1='" & FORMAT( _padX, "0.0", "en-US" )
            & "' y1='" & FORMAT( _baseY, "0.0", "en-US" )
            & "' x2='" & FORMAT( _w - _padX, "0.0", "en-US" )
            & "' y2='" & FORMAT( _baseY, "0.0", "en-US" )
            & "' stroke='#334155' stroke-width='1'/>"
        -- bell curve
        & "<polyline points='" & _curve
            & "' fill='none' stroke='#22d3ee' stroke-width='1.5' stroke-linejoin='round'/>"
        -- current row's position in the distribution
        & "<line x1='" & FORMAT( _xv, "0.0", "en-US" )
            & "' y1='" & FORMAT( _top, "0.0", "en-US" )
            & "' x2='" & FORMAT( _xv, "0.0", "en-US" )
            & "' y2='" & FORMAT( _baseY, "0.0", "en-US" )
            & "' stroke='#fcd34d' stroke-width='2' stroke-dasharray='3,2'/>"
    & "</svg>"
RETURN
    IF(
        NOT ISBLANK( _val ) && _sd > 0,
        "data:image/svg+xml;utf8,"
            & SUBSTITUTE(
                SUBSTITUTE(
                    SUBSTITUTE(
                        SUBSTITUTE( _svg, "&", "&amp;" ),
                        "%", "%25"
                    ),
                    "#", "%23"
                ),
                """", "'"
            )
    )
```

Tuning:
- Population: swap `ALLSELECTED('Table'[Category])` for the grain the distribution should describe (e.g. all stores, all months).
- Resolution: `_steps = 40` is smooth at 200 px; going below ~24 shows corners, going above wastes string length (§14).
- Mean marker: add a second vertical line at `x = _padX + _plotW / 2` in `#cbd5e1`, `stroke-width='1'`.
- Histogram flavor: replace the polyline with side-by-side bars — one `<rect>` per step, width `_plotW / _steps`, heights from the same `EXP` term (flat fills, edges touching).
- Light theme: baseline `#334155` → `#CCCCCC`; curve `#22d3ee` → `#0891b2`; marker `#fcd34d` → `#d97706`.
