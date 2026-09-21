---
name: schema-snapshot
description: >
  Cache the semantic model schema in docs/semantic-model.md so agents read it
  instead of re-running INFO queries every session. Covers creating the snapshot
  (tables, columns with Ukrainian display names, measures with format strings,
  relationships, load-bearing quirks) and the read-first / refresh-on-error rule.
  Triggers: "схема моделі", "які є таблиці", "які є міри", "semantic model schema",
  "onboard to the model", session start before any DAX work.
  Do NOT use for: authoring queries (use dax-authoring / query-design) or
  registering connections (use fabric-cli).
---

# Schema Snapshot

INFO discovery queries are slow, repetitive, and burn a live model round-trip per session. Run them **once**, persist the result to `docs/semantic-model.md`, and treat that file as the schema source of truth until it is proven stale.

## The rule (for every agent session)

1. **Read `docs/semantic-model.md` first** — before any schema-discovery query, before drafting DAX.
2. **Re-run INFO queries only when:** (a) a query fails with an unknown table/column/measure, or (b) the user says the model changed. Refresh only the affected section unless the user asked for a full refresh.
3. **Update the snapshot in the same commit** as the fix that revealed the staleness. A stale snapshot is worse than none.

## Creating / refreshing the snapshot

Run each via the CLI (write to a temp `.dax` file and use `--file` if quoting breaks):

```bash
npx fabric-app-data query <connection-alias> --query "EVALUATE INFO.VIEW.TABLES()"
npx fabric-app-data query <connection-alias> --query "EVALUATE SELECTCOLUMNS(INFO.VIEW.COLUMNS(), [Table], [Name], [DataType], [FormatString], [IsHidden], [SummarizeBy])"
npx fabric-app-data query <connection-alias> --query "EVALUATE SELECTCOLUMNS(INFO.VIEW.MEASURES(), [Table], [Name], [FormatString], [DisplayFolder])"
npx fabric-app-data query <connection-alias> --query "EVALUATE SELECTCOLUMNS(INFO.VIEW.RELATIONSHIPS(), [FromTable], [FromColumn], [ToTable], [ToColumn], [IsActive], [CrossFilteringBehavior])"
```

See **schema-discovery** for narrowing patterns and the elevated `INFO.*` catalog if `INFO.VIEW.*` is not enough.

## Snapshot format (`docs/semantic-model.md`)

```markdown
# Semantic model — <connection-alias>
_Знято: YYYY-MM-DD. Оновлюй через skill schema-snapshot; лише метадані — ЖОДНИХ рядків даних._

## Таблиці            — name, storage mode, one-line purpose
## Колонки            — per table: exact DAX name | DataType | display name (укр) | FormatString | hidden?
## Міри               — exact name | FormatString | DisplayFolder | one-line purpose
## Звʼязки            — FromTable[Col] → ToTable[Col], active?, cross-filter direction
## Load-bearing quirks
```

Rules for the file:

- **Exact names, verbatim.** Column and measure names are copied as-is from INFO output — including spaces, Cyrillic, and misspellings. These strings are DAX references and `columnMetadata` keys.
- **Metadata only, never data.** This is a people-analytics model: no sample rows, no employee names, no values from fact tables — ever.
- **Ukrainian display names** go next to each column/measure so factories can fill `displayName` without another round-trip.

## Load-bearing quirks section

This section documents traps that look like bugs but must be left alone. Seed it with at least:

- **Historic misspellings in the model are load-bearing.** At least one column name in this model carries a spelling error. It must be referenced **exactly as spelled** — "fixing" it in a `.dax` file breaks the query, and renaming it in the model breaks every existing query and `columnMetadata` key. List each such name here with a "DO NOT correct" note.
- Names with spaces/Cyrillic that require exact bracket quoting in DAX.
- Hidden columns that are still queried by the app, if any.
- Measures whose format string differs from what the UI displays (client-side overrides).

Add new quirks the moment they cost anyone debugging time.
