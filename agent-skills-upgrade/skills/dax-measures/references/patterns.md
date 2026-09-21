# DAX Patterns Reference

Extended recipes for the `dax-measures` skill. Same rules as SKILL.md: every measure
is output complete, wrapped in a ```dax block, with `//` comments for non-obvious logic.
Model vocabulary matches SKILL.md: `FactSales`, `DimDate`, `DimProduct`, `DimCustomer`,
`BudgetTable`, measure `[Sales Amount]`.

> Provenance note: the original account-store copy of this file was lost; this version
> was reconstructed 2026-08-06 following the section list declared in SKILL.md.

---

## 1. ABC / Pareto Analysis

Classify axis items by cumulative share: A = top 80%, B = next 15%, C = last 5%.

```dax
ABC Class =
VAR _current = [Sales Amount]
VAR _allProducts =
    ADDCOLUMNS(
        ALLSELECTED(DimProduct[ProductName]),
        "@Sales", [Sales Amount]
    )
VAR _total = SUMX(_allProducts, [@Sales])
VAR _cumulative =
    SUMX(
        // everything selling at least as much as the current product
        FILTER(_allProducts, [@Sales] >= _current),
        [@Sales]
    )
VAR _cumPct = DIVIDE(_cumulative, _total)
RETURN
IF(
    NOT ISBLANK(_current),
    SWITCH(
        TRUE(),
        _cumPct <= 0.80, "A",
        _cumPct <= 0.95, "B",
        "C"
    )
)
```

```dax
Pareto Cumulative % =
VAR _current = [Sales Amount]
VAR _allProducts =
    ADDCOLUMNS(
        ALLSELECTED(DimProduct[ProductName]),
        "@Sales", [Sales Amount]
    )
VAR _total = SUMX(_allProducts, [@Sales])
VAR _cumulative =
    SUMX(
        FILTER(_allProducts, [@Sales] >= _current),
        [@Sales]
    )
RETURN
DIVIDE(_cumulative, _total)
```

Notes:
- Ties share a cumulative bucket. If exact ordering matters, add a tiebreaker
  (compare `[@Sales]` first, then product name).
- `ALLSELECTED` makes the classification respect slicers; use `ALL` for a fixed
  whole-model classification.

---

## 2. New vs Returning Customers

A customer is *new* in the filtered period if they have no sales before it.

```dax
New Customers =
VAR _periodStart = MIN(DimDate[Date])
VAR _customersNow = VALUES(FactSales[CustomerKey])
VAR _customersBefore =
    CALCULATETABLE(
        VALUES(FactSales[CustomerKey]),
        DimDate[Date] < _periodStart,
        REMOVEFILTERS(DimDate)
    )
RETURN
COUNTROWS(EXCEPT(_customersNow, _customersBefore))
```

```dax
Returning Customers =
VAR _periodStart = MIN(DimDate[Date])
VAR _customersNow = VALUES(FactSales[CustomerKey])
VAR _customersBefore =
    CALCULATETABLE(
        VALUES(FactSales[CustomerKey]),
        DimDate[Date] < _periodStart,
        REMOVEFILTERS(DimDate)
    )
RETURN
COUNTROWS(INTERSECT(_customersNow, _customersBefore))
```

Sanity check: `[New Customers] + [Returning Customers] = DISTINCTCOUNT(FactSales[CustomerKey])`
for any period. If it does not hold, the date filter is leaking (check `REMOVEFILTERS` scope).

---

## 3. Budget vs Actual Variance

Grain first: actuals are daily, budget is usually monthly. Connect `BudgetTable` to the
model either through a physical relationship on a `YearMonth` column or virtually via
`TREATAS` (SKILL.md §7). Never relate budget to `DimDate[Date]` directly.

```dax
Variance = [Sales Amount] - [Budget Amount]
```

```dax
Variance % =
VAR _budget = [Budget Amount]
RETURN
IF(
    NOT ISBLANK(_budget) && _budget <> 0,
    DIVIDE([Sales Amount] - _budget, _budget)
)
```

```dax
Budget Status =
SWITCH(
    TRUE(),
    ISBLANK([Budget Amount]), "No budget",
    [Variance %] >= 0,        "On / above plan",
    [Variance %] >= -0.05,    "Slightly below",
    "Below plan"
)
```

Pitfall: at day granularity the actuals exist but budget is BLANK — the variance becomes
the full actual. Report variance only at budget grain or higher (month, quarter, year).

---

## 4. Snapshot-Based Headcount

Snapshot facts (headcount, inventory, balances) must never be summed across time.
Base pattern is in SKILL.md §6; the snapshot-specific rule:

```dax
Headcount =
CALCULATE(
    SUM(FactHR[EmployeeCount]),
    // last date in the current period that actually has a snapshot
    LASTNONBLANK(DimDate[Date], CALCULATE(COUNTROWS(FactHR)))
)
```

Behavior to verify in a matrix by month:
- each month shows its own last snapshot;
- the year total shows the *December* (last) snapshot, not a sum of 12 months.

If snapshots are strictly monthly, filtering `FactHR[SnapshotDate] = EOMONTH(MAX(DimDate[Date]), 0)`
is cheaper than `LASTNONBLANK`, but breaks when a month is missing — prefer `LASTNONBLANK`.

---

## 5. Calculation Groups

One calculation group per concern (time intelligence, currency, scenario). TMDL sketch
(lineageTags omitted; ordinals explicit — see §19 for lineageTag rules):

```tmdl
table 'Time Intelligence'
	calculationGroup
		precedence: 10

		calculationItem Current = SELECTEDMEASURE()

		calculationItem YTD = TOTALYTD(SELECTEDMEASURE(), DimDate[Date])
			ordinal: 1

		calculationItem PY = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR(DimDate[Date]))
			ordinal: 2

		calculationItem 'YoY %' =
				VAR _py = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR(DimDate[Date]))
				RETURN DIVIDE(SELECTEDMEASURE() - _py, _py)
			ordinal: 3
			formatStringDefinition = "0.0%"

	column 'Time Calc'
		dataType: string
		sourceColumn: Name
		sortByColumn: Ordinal

	column Ordinal
		dataType: int64
		isHidden
		sourceColumn: Ordinal
```

Rules:
- `formatStringDefinition` on an item overrides the measure's format (the `YoY %` item
  turns any currency measure into a percentage display).
- Changing an item's `ordinal` reorders every slicer/axis using the group — treat ordinal
  edits as breaking changes for downstream reports.
- With several groups, set `precedence` explicitly; higher precedence is applied last.
- Items apply to *every* measure via `SELECTEDMEASURE()`; exclude measures with
  `ISSELECTEDMEASURE()` guards when needed.

---

## 6. Field Parameter Patterns

A field parameter is a calculated table with `NAMEOF` triples: display name, field, ordinal.

```dax
Measure Selector = {
    ("Revenue",  NAMEOF([Sales Amount]), 0),
    ("Profit",   NAMEOF([Profit]),       1),
    ("Margin %", NAMEOF([Margin %]),     2)
}
```

Extending with a grouping column (4th element), e.g. to split slicer into sections:

```dax
Field Selector = {
    ("Category",     NAMEOF(DimProduct[Category]),    0, "Product"),
    ("Sub-category", NAMEOF(DimProduct[SubCategory]), 1, "Product"),
    ("Year",         NAMEOF(DimDate[Year]),           2, "Time")
}
```

Rules:
- Keep the `NAMEOF` column hidden; sort the display column by the ordinal column.
- Field parameters carry `extendedProperties` (ParameterMetadata) that Desktop writes.
  Creating them purely by hand in TMDL is fragile — create in Desktop, then edit the
  DAX expression in TMDL if rows must change.
- A field parameter used on an axis replaces the need for SWITCH-based dynamic measures (§7).

---

## 7. Dynamic Axis / Dynamic Measures

Preferred: field parameters (§6) — they swap real fields, keep formats, and work on axes.

Fallback (older models, or logic beyond field swap): disconnected selector + SWITCH,
as in SKILL.md §9:

```dax
Selected Measure =
SWITCH(
    SELECTEDVALUE(MeasureSelector[MeasureName]),
    "Revenue", [Revenue],
    "Profit",  [Profit],
    "Margin",  [Margin %],
    BLANK()
)
```

Limitations of the SWITCH approach — state them when proposing it:
- one format string for all branches (fix with a dynamic format string, §19);
- axis fields cannot be swapped, only the measure;
- every visual using it recalculates all branches' dependencies for lineage.

---

## 8. Many-to-Many Relationships

Prefer an explicit bridge table over a native `*:*` (limited) relationship:

```
DimCustomer 1 ──* BridgeCustomerGroup *── 1 DimGroup
FactSales   *──1 DimCustomer
```

Filter flows DimGroup → bridge → DimCustomer only if the bridge→customer relationship
is bidirectional, or if the measure opens it explicitly:

```dax
Sales by Group =
CALCULATE(
    [Sales Amount],
    CROSSFILTER(BridgeCustomerGroup[CustomerKey], DimCustomer[CustomerKey], BOTH)
)
```

Virtual alternative without any relationship (SKILL.md §7):

```dax
Sales by Group (virtual) =
CALCULATE(
    [Sales Amount],
    TREATAS(VALUES(BridgeCustomerGroup[CustomerKey]), FactSales[CustomerKey])
)
```

Why avoid native `*:*` limited relationships: no blank-row for orphans (mismatches
disappear silently), weaker engine optimizations, and RLS filter propagation surprises.
Keep model-wide bidirectional filters off fact tables; scope `CROSSFILTER` per measure.

---

## 9. Date-to-Date Comparison with Incomplete Periods

Raw YoY overstates decline while the current period is still filling. Cut the prior
year at the same point in time:

```dax
PY Sales (comparable) =
VAR _lastDataDate =
    CALCULATE(MAX(FactSales[OrderDate]), REMOVEFILTERS())
VAR _cutoffPY = EDATE(_lastDataDate, -12)   // same day one year back; handles 29-Feb
RETURN
CALCULATE(
    [Sales Amount],
    SAMEPERIODLASTYEAR(DimDate[Date]),
    KEEPFILTERS(DimDate[Date] <= _cutoffPY)
)
```

```dax
YoY % (comparable) =
VAR _current = [Sales Amount]
VAR _py = [PY Sales (comparable)]
RETURN
IF(
    NOT ISBLANK(_py) && _py <> 0,
    DIVIDE(_current - _py, _py)
)
```

Label the visual explicitly ("YoY, comparable period") — a silent cutoff misleads readers
who reconcile against full-year PY numbers.

---

## 10. Naming Conventions

- **Tables**: business names, singular or natural plural (`Sales`, `Customer`, `Date`).
  `Dim`/`Fact` prefixes are fine in source but hide or rename for user-facing models.
- **Columns**: human-readable, no prefixes, no CamelCase in user-facing fields
  (`Order Date`, not `OrderDateKey`). Hide all key columns.
- **Measures**: spaces allowed and encouraged; name states the business meaning plus
  qualifier (`Sales Amount`, `Sales YoY %`, `Headcount EOM`). Never `Measure1`, `New Measure`.
- **Display folders**: group by subject, numbered for ordering (`01 Sales`, `02 Time Intelligence`).
- **Variables**: `_lowerCamel` with leading underscore (matches SKILL.md examples).
- One home rule: a measure lives on the fact table it primarily reads, or on a dedicated
  measure table — pick one convention per model and never mix.

---

## 11. Measure Documentation & Version History

Document in the model, not in a side file — `description` surfaces as a tooltip in the
field list:

```tmdl
measure 'Sales Amount' = SUMX(FactSales, FactSales[Quantity] * FactSales[UnitPrice])
	formatString: #,0
	displayFolder: 01 Sales
	description: Gross sales before returns. Grain: order line. 2026-03: switched from SUM(Amount) to SUMX over line grain.
```

- Keep the description to: definition, grain, owner, last breaking change with date.
- Longer history goes into an annotation, not the description:

```tmdl
	annotation Changelog = 2026-03 SUMX rewrite; 2025-11 initial version
```

- Renaming a measure is a breaking change for downstream thin reports — keep the
  `lineageTag` (§19) and cascade the rename through report JSON.

---

## 12. Date Table Patterns

Calculated calendar covering whole years of the fact range:

```dax
DimDate =
VAR _min = DATE(YEAR(MIN(FactSales[OrderDate])), 1, 1)
VAR _max = DATE(YEAR(MAX(FactSales[OrderDate])), 12, 31)
RETURN
ADDCOLUMNS(
    CALENDAR(_min, _max),
    "Year", YEAR([Date]),
    "Month Number", MONTH([Date]),
    "Month", FORMAT([Date], "mmm"),
    "YearMonth", FORMAT([Date], "yyyy-mm"),
    "Quarter", "Q" & ROUNDUP(MONTH([Date]) / 3, 0),
    "Day of Week", FORMAT([Date], "ddd"),
    "Is Working Day", WEEKDAY([Date], 2) <= 5
)
```

Fiscal year starting April (add inside the same ADDCOLUMNS):

```dax
    "Fiscal Year", "FY" & IF(MONTH([Date]) >= 4, YEAR([Date]) + 1, YEAR([Date])),
    "Fiscal Month Number", MOD(MONTH([Date]) - 4, 12) + 1
```

Non-negotiables:
- **Mark as Date Table** on `[Date]` — otherwise time intelligence silently misbehaves.
- Sort `Month` by `Month Number`, `Day of Week` by a weekday number column.
- Whole years only: `TOTALYTD`/`SAMEPERIODLASTYEAR` assume complete years exist.
- Fiscal time intelligence uses the `"3/31"` year-end argument (SKILL.md §3).

---

## 13. Calculated Column vs Measure — Decision Guide

| Question | Column | Measure |
|----------|--------|---------|
| Needed on a slicer, axis, or in a relationship? | ✔ | ✘ |
| Value depends on filters / user selection? | ✘ | ✔ |
| Static per row, known at refresh time? | ✔ | possible but wasteful |
| Aggregation over many rows? | ✘ | ✔ |
| Cost model | RAM (stored, per row) | CPU (computed at query time) |

Tie-breakers:
- If a calculated column is justified, push it further upstream first: Power Query,
  or the source view — better compression, no DAX dependency chain.
- Row-level flags used by RLS must be columns.
- When both work (e.g. price band), a column wins for slicing, a measure wins for
  what-if flexibility.

---

## 14. Inactive Relationships (USERELATIONSHIP, CROSSFILTER)

Second date on a fact → keep one relationship active, switch per measure:

```dax
Sales by Ship Date =
CALCULATE(
    [Sales Amount],
    USERELATIONSHIP(DimDate[Date], FactSales[ShipDate])
)
```

Open filter direction for one calculation instead of a model-wide bidirectional filter:

```dax
Products Sold per Customer =
CALCULATE(
    DISTINCTCOUNT(FactSales[ProductKey]),
    CROSSFILTER(FactSales[CustomerKey], DimCustomer[CustomerKey], BOTH)
)
```

Cautions:
- `USERELATIONSHIP` fails at query time when RLS filters either side of the switched
  relationship — test with **View as Role**, not just as admin.
- `CROSSFILTER(..., NONE)` is the inverse tool: disable an active relationship inside
  one measure.

---

## 15. Customer Cohort / Retention Analysis

Cohort = month of first purchase. Calculated column on `DimCustomer`:

```dax
Cohort Month =
VAR _first = CALCULATE(MIN(FactSales[OrderDate]))  // context transition: this customer
RETURN
IF(NOT ISBLANK(_first), EOMONTH(_first, -1) + 1)   // first day of first-purchase month
```

Matrix: rows = `DimCustomer[Cohort Month]`, columns = `DimDate[YearMonth]`:

```dax
Active Customers = DISTINCTCOUNT(FactSales[CustomerKey])
```

```dax
Cohort Size =
CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerKey]),
    REMOVEFILTERS(DimDate)   // cohort row filter stays, month column filter removed
)
```

```dax
Retention % = DIVIDE([Active Customers], [Cohort Size])
```

Reading: the diagonal is each cohort's first month (retention = 100%); cells left of the
diagonal are structurally blank. For "months since first purchase" columns instead of
calendar months, add an offset measure `DATEDIFF(SELECTEDVALUE(DimCustomer[Cohort Month]), MAX(DimDate[Date]), MONTH)`
and use it as a visual filter or a computed axis in a Deneb/matrix design.

---

## 16. Top N with Ties and "Others" Bucket

Ties: `RANKX(..., DENSE)` gives 1,2,2,3 — "rank ≤ 10" may return more than 10 items.
`SKIP` (default) gives 1,2,2,4 — exactly 10 ranks but positions skipped. `TOPN` keeps
*all* boundary ties, so it can also return more than N rows. Decide and say which.

"Others" needs an axis member that does not exist in `DimProduct` — use a disconnected
axis table:

```dax
Product Axis =
UNION(
    SELECTCOLUMNS(ALLNOBLANKROW(DimProduct[ProductName]), "Product", DimProduct[ProductName]),
    ROW("Product", "Others")
)
```

```dax
Sales Top N + Others =
VAR _n = 10
VAR _axisValue = SELECTEDVALUE('Product Axis'[Product])
VAR _products = ALLSELECTED(DimProduct[ProductName])
VAR _top = TOPN(_n, _products, [Sales Amount], DESC)   // keeps boundary ties
VAR _isTop =
    NOT ISEMPTY(FILTER(_top, DimProduct[ProductName] = _axisValue))
RETURN
SWITCH(
    TRUE(),
    _axisValue = "Others",
        CALCULATE([Sales Amount], EXCEPT(_products, _top)),
    _isTop,
        CALCULATE([Sales Amount], DimProduct[ProductName] = _axisValue)
    // non-top named products return BLANK and drop off the visual
)
```

Sort the visual by this measure descending; "Others" lands by size (pin it last with a
rank measure if the design requires).

---

## 17. Parameter Tables (GENERATESERIES, What-If)

```dax
Growth % Parameter = GENERATESERIES(0, 0.30, 0.01)
```

```dax
Growth % Value = SELECTEDVALUE('Growth % Parameter'[Value], 0)
// second argument = default when nothing / multiple selected
```

```dax
Projected Sales = [Sales Amount] * (1 + [Growth % Value])
```

Rules:
- The parameter table stays **disconnected** — no relationships.
- Use a single-select slicer; the `SELECTEDVALUE` default covers the no-selection state.
- Format the parameter column (here: percentage) — the slicer inherits it.
- Multi-parameter what-if: one table per parameter; never cross-join them into one.

---

## 18. VALUES vs DISTINCT vs FILTERS

| Function | Returns | Blank row (orphan facts) |
|----------|---------|--------------------------|
| `VALUES(col)` | unique values in current filter context | **included** |
| `DISTINCT(col)` | unique values in current filter context | excluded |
| `FILTERS(col)` | values directly filtered on the column (ignores cross-filtering from other tables) | n/a |
| `ALLNOBLANKROW(col)` | all values ignoring filters | excluded |

The trap: fact rows whose key has no match in the dimension create a virtual blank row.
`COUNTROWS(VALUES(Dim[Key]))` then exceeds `COUNTROWS(DISTINCT(Dim[Key]))` by 1 — totals
"one extra" or an unexplained (Blank) axis item usually mean orphans. Fix the data, or
consciously choose `DISTINCT`.

`SELECTEDVALUE(col, default)` ≡ `IF(HASONEVALUE(col), VALUES(col), default)` — always
prefer `SELECTEDVALUE` (also faster).

---

## 19. PBIP / TMDL Context

Measures in a PBIP live in `*.SemanticModel/definition/tables/<Table>.tmdl`:

```tmdl
measure 'Sales YoY %' =
		VAR _py = CALCULATE([Sales Amount], SAMEPERIODLASTYEAR(DimDate[Date]))
		RETURN DIVIDE([Sales Amount] - _py, _py)
	formatString: 0.0%
	displayFolder: 02 Time Intelligence
	lineageTag: 8f3c2b1a-0000-4000-8000-000000000000
```

Dynamic format string (the model-level twin of the `""""&FORMAT` visual trick in SKILL.md §1):

```tmdl
measure 'Sales (auto unit)' = [Sales Amount]
	displayFolder: 01 Sales
	lineageTag: 7e2b1a9c-0000-4000-8000-000000000000
	formatStringDefinition =
			VAR _v = ABS([Sales (auto unit)])
			RETURN
			SWITCH(
				TRUE(),
				_v >= 1e6, "#,0,,.0 ""M""",
				_v >= 1e3, "#,0,.0 ""K""",
				"#,0"
			)
```

Rules:
- **lineageTag is identity.** Never regenerate, duplicate, or hand-edit it; a rename
  keeps the tag. Reports bind to names, but deployment pipelines diff by tag.
- New measures need a fresh unique GUID lineageTag (generate, don't copy-paste-edit).
- Structural TMDL validation does not catch DAX semantics — run new measures against
  a live engine (Desktop or an AS instance) before calling them done.
- Desktop caches the model: after editing TMDL outside Desktop, close Desktop first or
  delete the project's `.pbi/cache.abf`, or your edits will be shadowed by the cache.
