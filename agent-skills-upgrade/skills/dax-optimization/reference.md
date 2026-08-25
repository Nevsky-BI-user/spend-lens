# DAX Optimization — Reference

Deep material behind SKILL.md. Sections are numbered so SKILL.md pointers (`reference.md §N`) resolve.

## §1. Measuring Methodology

### 1.1 Performance Analyzer (Power BI Desktop)

1. View → Performance Analyzer → **Start recording** → interact or **Refresh visuals**.
2. Each visual reports three buckets:
   - **DAX query** — time the engine spent answering the query. This is what DAX optimization can fix.
   - **Visual display** — rendering. DAX rewrites will not help; reduce data points / visual complexity.
   - **Other** — mostly waiting for other visuals (queries run with limited parallelism). A page of 30 visuals shows huge "Other" even when every query is fast.
3. **Copy query** on the slow visual → this exact query goes to DAX Studio. Optimize the query the visual actually runs, not a synthetic one.

### 1.2 DAX Studio Server Timings

Connect DAX Studio to the running Desktop file, enable **Server Timings** (and **Query Plan** if needed), then:

1. **Clear Cache** (or enable "Clear on Run") — mandatory before every comparison run.
2. Run the query. Read the summary:
   - **Total** — end-to-end duration.
   - **SE** — storage engine duration; **SE CPU** — total CPU across SE threads. `SE CPU / SE` ≈ parallelism achieved.
   - **FE** — formula engine duration = Total − SE. FE is single-threaded: high FE is a ceiling no hardware fixes.
   - **SE Queries** — number of storage engine requests. Dozens per visual cell count is a red flag.
   - **SE Cache** — requests answered from the VertiPaq cache. Any nonzero on a "cold" run means the cache was not cleared.
3. In the query list, inspect each SE query's **xmSQL** (pseudo-SQL of the SE request). Glance at:
   - the **Rows / KB** columns — the size of the materialized datacache. A datacache far larger than the visual's cell count means over-materialization;
   - `CallbackDataID(...)` in the text — FE code injected into the scan (→ §3);
   - joins to tables the measure should not need — expanded-table or bi-di leakage.

### 1.3 Cold vs warm cache

The VertiPaq cache stores recent SE results (datacaches) and serves identical requests in ~0 ms. Always compare **cold vs cold** (Clear Cache before each run), then optionally note the warm timing — warm is what users see on repeat interaction, cold is the honest cost of the query. Run each variant 2–3 times cold and take the median; single runs are noisy.

### 1.4 VertiPaq Analyzer metrics

DAX Studio → Advanced → **View Metrics**. Before blaming DAX, check the model:

| Metric | What it tells you |
|---|---|
| Column **Cardinality** | Drives dictionary size, join cost, DISTINCTCOUNT cost. Millions of distinct values on a filter/join column is a model problem, not a DAX problem. |
| Column **Total Size** (Data + Dictionary + Hierarchy) | The columns that dominate model size dominate scan time when referenced. |
| **Encoding** — Value vs Hash | Hash-encoded high-cardinality numeric columns (e.g. keys stored as strings, un-rounded decimals) compress poorly. |
| **% of Table / DB** | Quick triage: one column at 40% of the model is the first suspect. |

If VertiPaq Analyzer shows the referenced column is huge, the model-level levers of §7 will beat any rewrite.

## §2. Storage Engine vs Formula Engine

Mental model that every diagnosis rests on:

- **Storage Engine (SE)** — VertiPaq in Import mode (the source database in DirectQuery, → §6). Answers only simple xmSQL: scans, GROUP BY, simple aggregations (SUM, MIN, MAX, COUNT, DISTINCTCOUNT), basic arithmetic on columns (`+ - * /`). **Multithreaded** — roughly one thread per column segment (~1M rows per segment in Power BI models, 8M default in Analysis Services). Results are **datacaches**: uncompressed in-memory row sets handed to FE. SE results are **cached** (VertiPaq cache) — except datacaches produced with CallbackDataID (→ §3).
- **Formula Engine (FE)** — executes the query plan: consumes datacaches, joins them, and evaluates everything SE cannot (conditional logic, iteration over datacaches, RANKX, string work). **Single-threaded** per query and **not cached** by the engine.

Optimization therefore has three levers, in order:

1. Push work into SE **without triggering callbacks** — pure scans and aggregations.
2. Keep datacaches **small** — rows materialized ≈ rows the visual needs. Materialization size is the silent killer: a 20-row visual backed by a 12M-row datacache spends its life moving memory.
3. Keep the remaining FE work **cheap** — fewer iterations over smaller caches, no repeated subexpressions.

## §3. CallbackDataID Catalog

**What it is.** When an aggregation pushed to SE contains an expression SE cannot compute natively, SE calls back into FE for that expression while scanning. The xmSQL shows it as `[CallbackDataID(...)]`, and DAX Studio highlights SE queries that contain callbacks.

**Why it hurts twice:**

1. FE code runs inside the scan — callbacks execute within SE's parallel threads, but each evaluation is far slower than a native SE operator.
2. **The resulting datacache is excluded from the VertiPaq cache.** The query re-pays full price on every execution — warm-cache behavior disappears for that datacache.

**Common triggers inside iterators over base tables:**

| Construct in the iterated expression | Why |
|---|---|
| `IF`, `SWITCH`, any conditional | No native conditional in xmSQL |
| `DIVIDE(a, b)` | Its zero-test is a conditional; plain `a / b` on columns is native (but returns infinity on zero, not BLANK — different semantics, use with care) |
| `IFERROR`, `ISERROR` | Error handling is FE-only, and adds error-tracking overhead on top |
| `ROUND`, `INT`, `MROUND`, `FORMAT` | Not native SE operators |
| Date/time functions on expressions (`YEAR`, `EOMONTH`, …) | FE-only |
| `RAND`, string manipulation | FE-only |

**How to remove — worked example:**

```dax
// BEFORE — IF inside SUMX over the fact table: CallbackDataID on every row, datacache not cacheable
Big Ticket Revenue =
SUMX(
    Sales,
    IF(Sales[Quantity] > 3, Sales[Quantity] * Sales[Net Price])
)

// AFTER — the condition becomes a filter (pure SE), the arithmetic stays native
Big Ticket Revenue =
CALCULATE(
    SUMX(Sales, Sales[Quantity] * Sales[Net Price]),
    KEEPFILTERS(Sales[Quantity] > 3)
)
```

Other removals: precompute row-static logic as a **calculated column** (paid once at refresh, compressed, native at query time); restructure so only `+ - * /` on columns remains inside the iterator; move the conditional outside the aggregation (branch on the aggregate, not per row) when the semantics allow it.

**Distinguish from context transition:** a measure reference inside an iterator does NOT show up as CallbackDataID — it typically produces additional SE queries or a fat FE loop instead (→ §4). Different fingerprint, different fix.

## §4. Context Transition Costs

Context transition (a measure reference or `CALCULATE` inside row context) converts the current row into an equivalent filter context. Cost scales with **how many times it fires** — once per iterated row.

- Over `VALUES(Dim[Column])` with 200 values: 200 transitions, negligible.
- Over a 50M-row fact table: 50M transitions. Best case the optimizer fuses it into one grouped SE query; worst case it is per-row FE evaluation or one datacache per granularity value. Symptom: high FE%, or SE query counts tracking iteration cardinality.

**Rules:**

1. **Iterate the lowest-cardinality table that carries the needed grain.** If the inner measure only varies by product, iterate `VALUES('Product'[ProductKey])`, never `Sales` (SKILL.md Pattern 4).
2. **Hoist invariant measures into VARs before the iterator.** A variable is evaluated at most once, in the context where it is defined:

```dax
// BEFORE — [Target Share] (here assumed row-invariant) still transitions per row
Above Target Sales =
SUMX(
    VALUES('Product'[ProductKey]),
    IF(CALCULATE([Sales Amount]) > [Target Share] * [Total Sales], CALCULATE([Sales Amount]))
)

// AFTER — invariants hoisted (valid ONLY if [Target Share] and [Total Sales] are unaffected by the product filter, e.g. defined over ALL — confirm before applying)
Above Target Sales =
VAR _threshold = [Target Share] * [Total Sales]
RETURN
    SUMX(
        VALUES('Product'[ProductKey]),
        VAR _amt = CALCULATE([Sales Amount])
        RETURN IF(_amt > _threshold, _amt)
    )
```

3. **Beware tables with duplicate rows.** Context transition on a table with duplicates filters ALL duplicates at once — a correctness trap and a performance one (the resulting filter is a whole-row filter over the expanded table). Iterate a key column, not the raw table.

## §5. Bottleneck → Fix Catalog

Expands the SKILL.md table with worked diagnoses.

### 5.1 High FE% — row-by-row formula engine work

**Fingerprint:** FE ≥ 60–70% of Total; SE queries few and fast; FE time grows linearly with fact rows.
**Causes:** nested iterators (each outer row re-scans an inner table), conditionals applied per row in FE, context transition over high cardinality (→ §4), RANKX over a large, unfiltered column.
**Fixes:** SKILL.md Patterns 2–4 — restructure to one pass at the correct grain (`SUMMARIZE` + context transition), turn per-row conditionals into filters, hoist invariants. For RANKX: rank over `ALLSELECTED` of the displayed column only, and gate with `ISINSCOPE` (→ 5.4).

### 5.2 Many SE queries / callbacks

**Fingerprint:** SE query count in the dozens-to-hundreds for one visual; or few queries but `CallbackDataID` present and SE Cache always 0 on repeat runs.
**Causes:** conditionals/DIVIDE/IFERROR inside aggregations (→ §3); a measure computed per cell where each cell's filter combination spawns its own datacache; multiple `USERELATIONSHIP` / `CROSSFILTER` variants of the same base measure in one visual — each variant is a separate filter shape, so datacaches cannot be shared across them.
**Fixes:** remove callbacks (→ §3); reduce distinct measure variants per visual (one relationship-switching measure driven by a slicer instead of five side-by-side variants, or materialize the alternate-relationship value as a column at refresh); check whether the visual really needs measure × measure grids.

### 5.3 Huge materialization

**Fingerprint:** an SE query returns millions of rows / hundreds of MB (Rows/KB columns) for a visual that displays a handful of cells.
**Causes:**

- `FILTER(<table>, …)` as a filter argument — materializes the **expanded table** (the table plus every table reachable via many-to-one paths). Note: `ALL(<table>)` passed directly to CALCULATE is a filter-removal modifier (REMOVEFILTERS semantics) and materializes nothing; it only materializes when iterated, e.g. `FILTER(ALL(Sales), …)`;
- iterating a fact table while referencing measures (whole-row context must be carried);
- **bidirectional relationships** — filters propagate both ways, so SE joins drag in tables the measure never mentions;
- missing `KEEPFILTERS`, forcing the plan to rebuild filters from scratch instead of intersecting existing ones.

**Fixes:** filter columns, never tables (SKILL.md Pattern 1); `CALCULATETABLE` with column predicates instead of `FILTER` over a raw table when a table is genuinely needed; make relationships single-direction and use `CROSSFILTER(…, BOTH)` inside the one measure that needs it; keep slicer-driven filters intact with `KEEPFILTERS`.

### 5.4 Slow totals

**Fingerprint:** detail rows render fast; the total row (or a card showing the same measure) is the slow part. Server Timings for the total-level query show the full detail computation re-running.
**Fix A — don't compute at the total:**

```dax
Product Rank =
IF(
    ISINSCOPE('Product'[Product Name]),   // total row: not in scope → BLANK, zero cost
    RANKX(ALLSELECTED('Product'[Product Name]), [Sales Amount], , DESC, DENSE)
)
```

**Fix B — compute the detail table once, aggregate the VAR:**

```dax
Total Best-Seller Revenue =
VAR _perProduct =
    ADDCOLUMNS(
        ALLSELECTED('Product'[ProductKey]),
        "@amt", CALCULATE([Sales Amount])
    )
VAR _top = TOPN(10, _perProduct, [@amt], DESC)
RETURN
    SUMX(_top, [@amt])   // the total is a single TOPN over one small per-product datacache — not a rank recomputed per product row
```

State explicitly when Fix A changes what the total shows (BLANK instead of a value) — that is a visible semantic change the user must sign off on.

### 5.5 Slow visuals, fast queries

**Fingerprint:** Performance Analyzer shows small "DAX query" but large "Visual display" or "Other".
**Causes & fixes:** too many visuals per page (queries queue — "Other"); a matrix with 15+ measures (every measure runs for every cell — split the matrix or use field parameters); Top N applied as a visual-level filter re-evaluates the ranking measure for every measure in the visual (compute one rank measure, filter on it); high-point scatter/line visuals (rendering, not DAX — aggregate or sample). This class is not solvable by rewriting the measure — say so instead of pretending a rewrite helped.

## §6. DirectQuery & Composite Models

Every datacache request becomes a **SQL query against the source**. FE still runs locally; the SE column of Server Timings shows the SQL text instead of xmSQL. Consequences:

- **Round-trips dominate.** A visual that needs 8 datacaches issues 8 SQL queries. Measure variants, per-cell computations, and TREATAS with large value lists multiply queries. Keep measures to plain aggregations that translate to `SUM/COUNT/GROUP BY`.
- **Complex DAX degrades hard.** What Import would handle as an FE loop over a datacache can become either a monstrous generated SQL statement or a detail-level retrieval into FE. Iterator-heavy patterns from §4–§5 are usually the wrong shape for DQ; pre-model the logic in the source or in Power Query **where it folds** — a non-folding Power Query step over DQ is itself a blocker.
- **Avoid bidirectional relationships** — they generate correlated subqueries / extra joins per query and multiply source load.
- **Dual storage mode** for dimensions joined to DQ facts: slicers resolve from the in-memory copy, joins fold to the source. A pure-Import dim related to a DQ fact makes a **limited relationship**: the engine transfers the dim's key values into the SQL (an `IN (…)` list or semi-join) — fine at low cardinality, terrible at 100K+ keys. Keep cross-source join columns low-cardinality.
- **Aggregation tables** (→ §7) are the single biggest DQ lever: an Import-mode aggregate answers the high-grain 95% of queries in-memory; only drill-downs hit the source.
- `APPROXIMATEDISTINCTCOUNT` is a DQ-only tool (Azure SQL, Synapse dedicated SQL pool, BigQuery, Databricks, Snowflake); it maps to the source's HyperLogLog aggregate. Not available in Import or Dual.

## §7. Model-Level Levers (when DAX can't save you)

Recommend these when §1.4 metrics point at the model. Each entry: lever → when to recommend.

| Lever | When to recommend |
|---|---|
| **Cardinality reduction** — split datetime into Date + Time columns, round decimals to needed precision, drop unused key/GUID columns, store keys as integers | VertiPaq Analyzer shows one column dominating size; DISTINCTCOUNT or joins on a multi-million-cardinality column; datetime columns with seconds precision |
| **Disable Auto date/time** (Options → Data Load) | Model contains many date columns — each spawns a hidden local date table; model size and metadata bloat with zero benefit once a real Date table exists |
| **Star over snowflake** — flatten dimension chains into single dimensions | Traces show multi-hop joins (`RELATED` chains, Dim→SubDim→SubSubDim); measures must reach through 2+ relationships |
| **Aggregation tables** — Import-grain aggregate over the detail fact, mapped via Manage aggregations (or user-managed with `ISFILTERED` switching) | Fact table 100M+ rows but most visuals show month/category grain; DirectQuery facts (→ §6); totals pages that re-scan detail |
| **Incremental refresh awareness** | Many small partitions produce many small segments → slightly worse compression and more per-segment scan overhead, and rows can no longer be globally re-ordered for optimal run-length encoding. Not a reason to avoid IR — a reason not to over-partition (daily partitions on a small table) and to expect modest scan regressions after enabling it |

Model changes alter refresh behavior and downstream reports — flag them as recommendations for the model owner, not silent edits bundled into a measure rewrite.

## §8. Readability & Maintainability Conventions

Performance-neutral by design: none of these change the query plan (variables can only help — each VAR is evaluated lazily, at most once, in the context where it is defined).

1. **VAR naming:** `_lowerCamelCase` with a leading underscore (`_py`, `_threshold`, `_perProduct`), matching the dax-measures house style. Name the business meaning, not the mechanics: `_priorYearSales`, not `_calc1`. `@`-prefixed names for ADDCOLUMNS extension columns (`"@amt"`).
2. **One VAR per logical step;** the RETURN expression should read as the last sentence of the story — ideally a single function call or short expression over named parts.
3. **Formatting — DAX Formatter conventions:** keywords and function names UPPERCASE; one argument per line once a call stops fitting on one line; closing parenthesis aligned under the function; 4-space indentation. Long measures formatted this way diff cleanly in PBIP/TMDL repos.
4. **Comment discipline:** comment WHY (business rule, chosen trade-off, "KEEPFILTERS because slicer X must survive"), never restate WHAT the code visibly does. Delete stale comments during the rewrite — a wrong comment is worse than none. `//` for line comments, `/* */` only for header blocks.
5. **Preserve the public surface:** keep the measure name, format string, and display folder; put the optimized body in place. If splitting helper measures out improves reuse, name them as hidden building blocks (e.g. prefix or a "_Internal" folder) and say what was added.
6. **Ship the readable version.** If an "ugly but 5% faster" variant exists, present both timings and let the user choose; default recommendation is the readable one unless the gap is material.

## §9. Expected Impact Honesty

- **Never promise ×N speedups.** Query plans depend on cardinality, filters, cache state, and engine version; a pattern that gave 10× on one model gives 1.1× on another.
- With model access: report the measured table — cold-cache Total, FE, SE, SE queries, largest materialization — before and after, and name the run count (median of 3). Reporting template:

| Metric (cold cache, median of 3) | Before | After |
|---|---|---|
| Total (ms) | … | … |
| FE (ms / %) | … | … |
| SE (ms) / SE CPU (parallelism) | … | … |
| SE queries / with CallbackDataID | … | … |
| Largest materialization (rows) | … | … |

- Without model access: state the mechanism ("removes a per-row context transition over ~50M rows; FE-bound, so expect the FE share to drop") and label every number as an expectation. Ask the user to run the §1 measurement and report back.
- If measurements show the rewrite did NOT help, say so and revert — do not rationalize. The diagnosis, not the rewrite, was wrong: reclassify against §5.
- Measure on realistic volumes. A dev subset with 100K rows hides FE linear costs and materialization blowups that only appear at production scale.
