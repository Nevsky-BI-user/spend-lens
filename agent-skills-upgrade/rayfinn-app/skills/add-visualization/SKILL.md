---
name: add-visualization
description: >
  Scaffold a complete new visualization for this app end-to-end: DAX query (.dax),
  Vega-Lite spec (.json), factory (.ts), barrel exports, component wiring, and the
  factory spec (.spec.ts) — with a live CLI run to capture exact column names.
  Triggers: "додай візуалізацію", "новий графік на сторінку", "додай чарт",
  "add a chart", "add a visualization", "new query", "новий запит для сторінки".
  Do NOT use for: editing an existing visual's spec (use visuals), pure DAX
  debugging (use dax-authoring), browser validation only (use app-validation).
---

# Add Visualization

Every **chart** visualization is a **triad** in `src/queries/{page-or-domain}/`: `{name}.dax` + `{name}.json` + `{name}.ts`, plus a `{name}.spec.ts`; grid/KPI/bespoke-UI factories legitimately omit the `.json` and the `vegaLiteSpec` field (see `org-structure.ts`, `team-kpis.ts`) — they still get the `.dax` + `.ts` + `.spec.ts`. Follow the steps in order — the live query run in Step 2 is not optional.

## Step 0 — Name and placement

Ask (or derive from the request): which dashboard page/domain group (`team`, `org`, `metrics`, or a new folder) and a kebab-case base name describing the visual, e.g. `absence-by-month`. The factory function is the camelCase twin: `absenceByMonth`.

## Step 1 — Draft the DAX

Read `docs/semantic-model.md` first if it exists (see the **schema-snapshot** skill); otherwise discover metadata per **schema-discovery**. Author the query per **dax-authoring** (syntax, patterns) and **query-design** (aggregate to the visual's grain in DAX; presentation belongs in TS/Vega-Lite). Save the draft directly to its final home: `src/queries/{group}/{name}.dax`.

## Step 2 — Run it live and capture EXACT column names

```bash
npx fabric-app-data query <connection-alias> --file src/queries/{group}/{name}.dax
```

Always prefer `--file` over `--query` here — this model's column names contain Cyrillic and spaces, and `--query` shell-escaping mangles quotes. The alias comes from `fabric.yaml` (copy it from any existing factory).

**This step kills the #1 silent failure.** The `columnMetadata` keys must match the CLI output column names **byte-for-byte** (e.g. `dim_table[Колонка з пробілами]`, `[Total Revenue]`). Copy them verbatim — never guess, never "fix" spelling (the model contains load-bearing misspellings). A mismatched key is not an error: the metadata is silently dropped and the chart renders without titles/formats, or not at all.

## Step 3 — `columnMetadata`

For each output column, one entry: `name` (key with `. [ ] \ " '` removed — used in Vega-Lite encodings), `displayName` (Ukrainian label for axes/tooltips/headers), `format` (VBA format string, e.g. `0%`, `#,0` — omit for text). Pull `displayName`/`format` from the schema snapshot or `INFO.VIEW` output, not from imagination.

## Step 4 — Vega-Lite spec (`.json`)

Author per the **visuals** skill. Encode fields by the cleaned `name` values from Step 3; titles come from `displayName`, formatting from `format`. Never inline the spec in a `.ts` or component file.

## Step 5 — Factory (`.ts`)

```ts
import type { VisualizationSpec } from "@microsoft/fabric-visuals";
import type { ColumnMetadataMap } from "@/lib/to-data-table";
import query from "./{name}.dax?raw";
import spec from "./{name}.json"; // charts only — grid/KPI/bespoke-UI factories have no .json

const connection = "<connection-alias>"; // same alias as the other factories

/** Column metadata keyed by original DAX column name (verbatim from CLI output). */
const columnMetadata: ColumnMetadataMap = { /* Step 3 */ };

export function {camelName}(/* optional typed params */) {
  return { connection, query, columnMetadata, vegaLiteSpec: spec as VisualizationSpec }; // vegaLiteSpec: charts only — omit it in grid/KPI/bespoke-UI factories
}
```

Parameters that change query **structure** get variant `.dax` files (`{name}-{variant}.dax`) selected in the factory; small substitutions may happen in TS, but the base query always comes from a `.dax` import.

## Step 6 — Barrels

Add `export { {camelName} } from "./{name}";` to `src/queries/{group}/index.ts`. A new group folder also needs `export * from "./{group}";` in `src/queries/index.ts`.

## Step 7 — Component

Reuse the generic query-driven card (`vega-chart-card.component.tsx`) when the visual is a standard chart card — pass it the factory result. Only scaffold a bespoke component when layout demands it, using the mandatory pattern:

```tsx
const { data, isLoading, error } = useSemanticModelQuery({ connection, query });
if (isLoading) return <ChartSkeleton />;
if (data?.status === "error") return <ErrorBanner message={data.error.message} />; // SDK never throws
if (error) return <ErrorBanner message={error.message} />;                         // network-level only
if (data?.status !== "success") return null;
const dataTable = toDataTable(data.table, columnMetadata);
return <VegaVisual spec={vegaLiteSpec} data={dataTable} theme={theme} />;
```

The SDK **never throws** on query failure — auth errors and invalid DAX arrive as `data.status === "error"`. Skipping that branch is the second most common bug after metadata-key drift.

## Step 8 — Factory spec (`.spec.ts`)

Per app-validation: **factories always have specs.** Co-locate `{name}.spec.ts` and build fixtures from the **real column shape** you saw in Step 2 (representative, not invented):

```ts
import { describe, it, expect } from "vitest";
import { {camelName} } from "./{name}";

describe("{camelName}", () => {
  it("returns connection, query, metadata and spec", () => {
    const { connection, query, columnMetadata, vegaLiteSpec } = {camelName}();
    expect(connection).toBe("<connection-alias>");
    expect(query).toContain("EVALUATE");
    expect(Object.keys(columnMetadata)).toEqual([
      /* the exact CLI column names from Step 2, in order */
    ]);
    if (vegaLiteSpec) expect(vegaLiteSpec).toHaveProperty("mark"); // or "layer"/"encoding" — charts only; skip when the factory has no spec
  });
  // one extra test per factory parameter: assert the query/spec mutation it produces
});
```

## Step 9 — Verify

Run `npm run lint && npm test`. Then validate in the browser via the **app-validation** skill (Fabric portal embed flow only — never bare `localhost`).
