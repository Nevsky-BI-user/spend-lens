# DAX Measures — Reference

Pattern library moved out of SKILL.md. Sections are numbered so SKILL.md pointers
(`reference.md §N`) resolve. Extended recipes live in
[references/patterns.md](references/patterns.md) — index in §13.

## §1. Dynamic Format Strings

Power BI dynamic formatting via a "Format" measure assigned to a value measure's Format property.

### Core Pattern: `""""&FORMAT(...)`

```
""""&FORMAT([actual measure], "format pattern")
```

`""""` in DAX = literal `"` character. Power BI interprets everything after it as literal display text.

**Value measure** returns a constant (e.g. 0) for chart positioning.
**Format measure** returns `""""&FORMAT(...)` to render the actual value as visible text.

### K/M Auto-Scaling Template

```dax
Format Measure =
VAR _val = [Source Measure]
VAR _abs = ABS(_val)
VAR _sign = IF(_val > 0, "+", IF(_val < 0, "−", ""))
RETURN
IF(
    ISBLANK(_val),
    """""",
    IF(
        _abs >= 1000000,
        """"&"Δ " & _sign & FORMAT(_abs / 1000000, "#,##0.0") & "M",
        IF(
            _abs >= 1000,
            """"&"Δ " & _sign & FORMAT(_abs / 1000, "#,##0.0") & "K",
            """"&"Δ " & _sign & FORMAT(_abs, "#,##0.0")
        )
    )
)
```

### Rules

1. **Measure = constant, Format = text.** Value measure → number for positioning. Format measure → `""""&FORMAT(...)`.
2. **Never use native format string scaling** (commas after 0 for /1000). Use explicit `FORMAT(_val / 1000, ...)`.
3. **FORMAT patterns are locale-independent inside FORMAT().** Always `.` for decimal, `,` for thousands in the pattern string. Power BI renders per report locale.
4. **`""""` prefix is mandatory.** Without it Power BI interprets result as format string, not literal text.
5. **ISBLANK guard.** Return `""""""` (empty literal) for blanks.
6. **Percentage variant:** `""""&FORMAT([Pct Measure], "#,##0.0%")` → displays `45,3%`.
7. **Custom prefix/suffix:** `""""&FORMAT([Measure], "#,##0") & " шт."` → displays `1 234 шт.`.

## §2. CALCULATE Patterns

### Basic filter override
```dax
Sales LY =
CALCULATE(
    [Sales Amount],
    DATEADD(DimDate[Date], -1, YEAR)
)
```

### Nested CALCULATE (context reset)
```dax
Share of Total =
DIVIDE(
    [Sales Amount],
    CALCULATE(
        [Sales Amount],
        REMOVEFILTERS(DimProduct[Category])
    )
)
```

### KEEPFILTERS
```dax
Sales Top Category =
CALCULATE(
    [Sales Amount],
    KEEPFILTERS(DimProduct[Category] = "Electronics")
    // KEEPFILTERS intersects with existing filter instead of overriding
)
```

### ALL vs REMOVEFILTERS vs ALLEXCEPT
- `ALL(Table)` — removes all filters from the table
- `ALL(Table[Column])` — removes filter from one column
- `REMOVEFILTERS(Table[Column])` — same as ALL for columns, preferred syntax
- `ALLEXCEPT(Table, Table[Col1], Table[Col2])` — removes all filters EXCEPT listed columns
- `ALLSELECTED()` — restores to visual-level filter context

## §3. Time Intelligence

All time intelligence requires a Date table marked as Date Table in the model.

### Standard Patterns
```dax
YTD Sales = TOTALYTD([Sales Amount], DimDate[Date])
MTD Sales = TOTALMTD([Sales Amount], DimDate[Date])
QTD Sales = TOTALQTD([Sales Amount], DimDate[Date])
```

### Previous Period
```dax
PY Sales = CALCULATE([Sales Amount], SAMEPERIODLASTYEAR(DimDate[Date]))
PM Sales = CALCULATE([Sales Amount], DATEADD(DimDate[Date], -1, MONTH))
```

### YoY Change
```dax
YoY % =
VAR _current = [Sales Amount]
VAR _py = [PY Sales]
RETURN
IF(
    NOT ISBLANK(_py) && _py <> 0,
    DIVIDE(_current - _py, _py)
)
```

### Custom Fiscal Year (starts April)
```dax
Fiscal YTD =
TOTALYTD([Sales Amount], DimDate[Date], "3/31")
```

### Parallel Period
```dax
PP Sales =
CALCULATE(
    [Sales Amount],
    PARALLELPERIOD(DimDate[Date], -1, MONTH)
)
```

## §4. Iterator Patterns

### SUMX — row-by-row calculation
```dax
Revenue = SUMX(Sales, Sales[Quantity] * Sales[UnitPrice])
```

### CONCATENATEX — string aggregation with sort
```dax
Product List =
CONCATENATEX(
    VALUES(DimProduct[ProductName]),
    DimProduct[ProductName],
    ", ",
    DimProduct[ProductName], ASC
)
```

### Context Transition inside iterators
```dax
Weighted Score =
SUMX(
    DimCriteria,
    DimCriteria[Weight] *
    CALCULATE(AVERAGE(Scores[Value]))
    // CALCULATE converts row context → filter context
)
```

## §5. Ranking

### Basic RANKX
```dax
Product Rank =
RANKX(
    ALL(DimProduct[ProductName]),
    [Sales Amount],
    ,
    DESC,
    DENSE
)
```

### Top N filter
```dax
Sales Top 10 =
VAR _rank = RANKX(ALL(DimProduct[ProductName]), [Sales Amount], , DESC, DENSE)
RETURN
IF(_rank <= 10, [Sales Amount])
```

## §6. Semi-Additive Measures

For balances, headcount, inventory — where SUM across time is meaningless.

### Last known value
```dax
Headcount =
CALCULATE(
    SUM(FactHR[EmployeeCount]),
    LASTNONBLANK(DimDate[Date], CALCULATE(COUNTROWS(FactHR)))
)
```

### Closing balance
```dax
Closing Balance =
CALCULATE(
    SUM(FactInventory[Balance]),
    LASTDATE(DimDate[Date])
)
```

## §7. Virtual Relationships (TREATAS)

```dax
Budget with Date Filter =
CALCULATE(
    [Budget Amount],
    TREATAS(VALUES(DimDate[YearMonth]), BudgetTable[YearMonth])
)
```

TREATAS transfers filter context without a physical model relationship.

## §8. Error Handling

```dax
// Safe division — BLANK when denominator is 0
Margin % = DIVIDE([Profit], [Revenue])

// IFERROR wrapper
Safe Calc = IFERROR([Complex Measure], BLANK())

// ISBLANK guard — prevents 0 on charts when no data
Result =
VAR _val = [Some Measure]
RETURN
IF(NOT ISBLANK(_val), _val * 1.1)
```

## §9. SWITCH TRUE Pattern

```dax
Status =
SWITCH(
    TRUE(),
    [Score] >= 90, "Excellent",
    [Score] >= 70, "Good",
    [Score] >= 50, "Average",
    "Below Average"
)
```

### Multi-measure selector
```dax
Selected Measure =
SWITCH(
    SELECTEDVALUE(MeasureSelector[MeasureName]),
    "Revenue", [Revenue],
    "Profit", [Profit],
    "Margin", [Margin %],
    BLANK()
)
```

## §10. Running Total

```dax
Running Total =
VAR _currentDate = MAX(DimDate[Date])
RETURN
CALCULATE(
    [Sales Amount],
    DimDate[Date] <= _currentDate,
    ALLSELECTED(DimDate[Date])
)
```

## §11. Moving Average

```dax
MA 3M =
AVERAGEX(
    DATESINPERIOD(DimDate[Date], MAX(DimDate[Date]), -3, MONTH),
    [Sales Amount]
)
```

## §12. Percentage of Total / Parent

```dax
// Grand total
% of Total = DIVIDE([Sales Amount], CALCULATE([Sales Amount], ALL(FactSales)))

// Visible total (respects slicers)
% of Visible = DIVIDE([Sales Amount], CALCULATE([Sales Amount], ALLSELECTED()))

// Parent in hierarchy
% of Parent =
DIVIDE(
    [Sales Amount],
    CALCULATE([Sales Amount], ALLSELECTED(DimProduct[SubCategory]))
)
```

## §13. Detailed Patterns Reference

Read `references/patterns.md` for extended recipes:
- ABC / Pareto analysis
- New vs Returning customers
- Budget vs Actual variance
- Snapshot-based headcount
- Calculation Groups
- Field Parameter patterns
- Dynamic axis / dynamic measures
- Many-to-many relationships
- Date-to-date comparison with incomplete periods
- Naming conventions (tables, columns, measures, folders)
- Measure documentation and version history
- Date table patterns (calendar, fiscal year)
- Calculated column vs measure decision guide
- Inactive relationships (USERELATIONSHIP, CROSSFILTER)
- Customer cohort / retention analysis
- Top N with ties and "Others" bucket
- Parameter tables (GENERATESERIES, What-If)
- VALUES vs DISTINCT vs FILTERS
- PBIP / TMDL context (lineageTag, formatStringDefinition)
