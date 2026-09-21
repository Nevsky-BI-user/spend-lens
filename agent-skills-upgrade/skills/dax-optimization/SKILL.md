---
name: dax-optimization
description: "Use this skill whenever the user asks to OPTIMIZE an EXISTING DAX measure or query in Power BI — performance, readability, maintainability. Single owner of DAX performance work. Trigger on: \"оптимізуй міру\", \"оптимізуй DAX\", \"міра гальмує\", \"повільна міра\", \"повільний звіт\", \"тормозить\", \"довго рахується\", \"чому так довго\", \"optimize this measure\", \"slow measure\", \"slow report\", \"improve performance\", \"refactor DAX\", \"зроби міру читабельнішою\", \"читабельніше\", mentions of DAX Studio / Performance Analyzer / Server Timings / VertiPaq, or a working measure shown with a speed complaint. Analyzes bottlenecks (context transition, nested iterators, FILTER over whole tables), rewrites with VAR, DIVIDE, KEEPFILTERS; explains changes and expected impact. Do NOT trigger for: writing NEW measures or fixing WRONG results (use dax-measures); SVG visual measures (use dax-svg); Deneb specs (use deneb-vegalite); whole-PR review (use pbip-pr-reviewer). Always output the FULL optimized measure — never abbreviate."
---

# DAX Optimization Skill

## Overview

Single owner of DAX performance work: takes a measure or query that already returns the RIGHT result and makes it fast, readable, maintainable — without silently changing what it returns.
NOT for: new measures or wrong results → `dax-measures`; SVG measures → `dax-svg`; Deneb specs → `deneb-vegalite`; whole-PR review → `pbip-pr-reviewer`.

## Method: Diagnose First, Rewrite Second

Never optimize blind — a rewrite without a measurement is a guess.

1. **Reproduce & measure.** Performance Analyzer in Desktop → copy the visual's query → DAX Studio, Server Timings ON, Clear Cache, run. Record: total ms, FE vs SE split, SE query count, largest materialization (rows). → reference.md §1
2. **Classify the bottleneck** with the table below (full catalog → reference.md §5).
3. **Rewrite** with the matching pattern. State every edge-case semantic change (blanks, totals, ties).
4. **Re-measure** cold-cache, same query shape, and report BOTH timings side by side. Without model access, label numbers as *expected*, not *measured* (→ reference.md §9).

If the fix depends on model facts you don't have — row counts, column cardinality, storage mode (Import / DirectQuery / Composite), relationship directions — **ask before rewriting**.

## Bottleneck Classes

| Symptom in Server Timings | Likely cause | Fix pattern |
|---|---|---|
| High FE% (single-threaded FE dominates) | Row-by-row FE work: nested iterators, IF inside SUMX over a materialized table expression (over a base fact table this appears as CallbackDataID — next row), context transition per row of a large table | Patterns 2–4; §4–§5 |
| Many SE queries, or CallbackDataID in xmSQL | IF / DIVIDE / IFERROR / ROUND inside an aggregation over a fact table; per-cell datacaches; USERELATIONSHIP variants evaluated per cell | Move the conditional out of the iterator; §3 |
| Huge materialization (millions of datacache rows) | FILTER over a whole (expanded) table instead of one column; missing KEEPFILTERS; bidirectional relationships widening joins | Pattern 1; §5.3, §6 |
| Cells fast, total row slow | Whole computation re-runs at total grain (RANKX, detail-level iterators) | ISINSCOPE branch or pre-aggregated VAR; §5.4 |
| Query fast in DAX Studio, visual/page slow | Too many visuals or measures per page; Top N visual filter re-applied per measure | Fewer visuals, shared rank VAR; §5.5, §7 |

## Rewrite Patterns

### 1. FILTER over a table → column predicate + KEEPFILTERS
```dax
// BEFORE — materializes the expanded Sales table row by row
Red Sales = CALCULATE([Sales Amount], FILTER(Sales, RELATED('Product'[Color]) = "Red"))

// AFTER — SE filters one column; KEEPFILTERS preserves existing Color filters (same semantics as BEFORE)
Red Sales = CALCULATE([Sales Amount], KEEPFILTERS('Product'[Color] = "Red"))
```

### 2. Nested iterators → SUMMARIZE at the right grain
```dax
// BEFORE — for every customer, FILTER re-scans Sales: O(customers × sales rows), all in FE
Avg Customer Revenue = AVERAGEX(Customer, SUMX(FILTER(Sales, Sales[CustomerKey] = Customer[CustomerKey]), Sales[Quantity] * Sales[Net Price]))

// AFTER — group once at customer grain; context transition uses the relationship
Avg Customer Revenue =
AVERAGEX(
    SUMMARIZE(Sales, Customer[CustomerKey]),
    CALCULATE(SUMX(Sales, Sales[Quantity] * Sales[Net Price]))
)
```

### 3. Repeated identical CALCULATE → single VAR
```dax
// BEFORE — the PY expression is evaluated twice per cell
YoY % = DIVIDE([Sales Amount] - CALCULATE([Sales Amount], SAMEPERIODLASTYEAR('Date'[Date])), CALCULATE([Sales Amount], SAMEPERIODLASTYEAR('Date'[Date])))

// AFTER — evaluated once, reused; also self-documenting
YoY % =
VAR _py = CALCULATE([Sales Amount], SAMEPERIODLASTYEAR('Date'[Date]))
RETURN DIVIDE([Sales Amount] - _py, _py)
```

### 4. Context transition per fact row → iterate the low-cardinality grain
```dax
// BEFORE — [Adjustment Factor] forces a context transition for EVERY Sales row
Adjusted Revenue = SUMX(Sales, [Adjustment Factor] * Sales[Line Amount])

// AFTER — one transition per product (valid ONLY if the factor is constant per product — confirm before applying)
Adjusted Revenue = SUMX(VALUES('Product'[ProductKey]), [Adjustment Factor] * CALCULATE(SUM(Sales[Line Amount])))
```

### 5. Forced zeros → keep BLANK (or COALESCE at the display edge)
```dax
// BEFORE — "+ 0" (same for IF(ISBLANK(x), 0, x)) returns a value for EVERY cell: blank-row elimination is lost, sparse matrices go dense
Orders = COUNTROWS(Sales) + 0
// AFTER — keep BLANK so empty combinations are skipped (the actual perf win)
Orders = COUNTROWS(Sales)
// If a visible zero is a hard requirement: COALESCE — clearer than +0, but still dense; expect no speedup from it
Orders = COALESCE(COUNTROWS(Sales), 0)
```

### 6. DISTINCTCOUNT on a huge column → APPROXIMATEDISTINCTCOUNT (DirectQuery only)
```dax
// BEFORE — exact distinct count on a high-cardinality column, expensive at the source
Unique Customers = DISTINCTCOUNT(Sales[CustomerID])
// AFTER — HyperLogLog estimate pushed to the source; small error. ONLY DirectQuery over Azure SQL / Synapse / BigQuery / Databricks / Snowflake — not Import, not Dual. Confirm approximation is acceptable
Unique Customers = APPROXIMATEDISTINCTCOUNT(Sales[CustomerID])
```
For Import mode, attack cardinality instead (split datetime, pre-aggregate) → reference.md §7.

## Critical Rules

1. **Full output.** Every optimized measure is output entirely, first character to last — never `...`, never `// rest unchanged`.
2. **Never change semantics silently.** If a rewrite alters blanks, totals, ties, or duplicate handling, say so explicitly next to the measure.
3. **Ask for model context** (sizes, cardinality, storage mode) whenever the right fix depends on it. DirectQuery/Composite specifics → reference.md §6.
4. **Report deltas, not promises.** Measured before/after numbers when possible; otherwise mechanisms and expected direction only (→ reference.md §9).

## Common Mistakes

| Mistake | Why it hurts | Instead |
|---|---|---|
| Rewriting before profiling | You polish the 10% that was never the bottleneck | Server Timings first, always |
| `FILTER(Table, …)` as a CALCULATE filter | Materializes the expanded table | Column predicate + KEEPFILTERS (Pattern 1) |
| IFERROR / error-guards inside iterators | CallbackDataID: slower SE scan AND the datacache is not cached | DIVIDE at the outer level; fix the data |
| `+ 0` everywhere "for nice visuals" | Dense result set — every cell computed and returned | Keep BLANK; COALESCE only where truly required |
| Trusting warm-cache timings | SE cache answers from memory — the "improvement" is fake | Clear Cache; compare cold vs cold |
| Micro-rewrites all over the measure | Readability lost for unmeasured gains | Change only the proven bottleneck; keep the rest |

Measurement methodology, FE/SE model, CallbackDataID catalog, DirectQuery, model-level levers → [reference.md](reference.md).
