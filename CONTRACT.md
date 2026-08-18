# spend-lens — Build Contract (binding spec)

Analytics dashboard for Claude Code spend & token usage. Owner: Nevsky-BI-user.
Goal: user glances at dashboard → sees WHERE money burns and WHY → copies a ready-made Ukrainian prompt to Claude Code to optimize.

## Architecture

```
Local machine (daily, Task Scheduler 20:00)
  collector/collect.mjs  — parses %USERPROFILE%/.claude/projects/**/*.jsonl (~1.3GB, ~1900 files)
      → writes web/public/data/usage.json   (local snapshot, GITIGNORED — never committed)
      → upserts aggregates to Supabase (if .env configured)
GitHub Pages (public repo Nevsky-BI-user/spend-lens)
  web/  — Vite + React + Recharts SPA, base '/spend-lens/'
      Supabase mode: Google OAuth (+ email OTP fallback), reads tables via anon key + RLS
      Local mode (dev): fetch('data/usage.json')
      Demo mode: fetch('data/demo.json') (committed, synthetic) + banner «Демо-дані»
  .github/workflows/deploy.yml — deploy on push + daily cron 03:00 UTC
```

Mode resolution in web app: `import.meta.env.VITE_SUPABASE_URL` set at build → Supabase mode (auth required). Else → try `data/usage.json`, on 404 → `data/demo.json` with demo banner. `?demo=1` forces demo.

## Directory ownership (agents MUST stay in their lanes)

- **collector agent**: `collector/**`, writes `web/public/data/usage.json` (output only)
- **webapp agent**: `web/**` EXCEPT `web/public/data/usage.json`; owns `web/public/data/demo.json`
- **supabase agent**: `supabase/**`
- **devops agent**: `.github/**`, `scripts/**`, `README.md`, `.gitignore`
- Nobody runs `git commit`. Nobody touches another lane.

## JSONL facts (verified on real data, CC v2.1.209)

- Records: JSON per line. Relevant: `type:"assistant"` with `message.usage`, `message.model`, `message.id`, top-level `requestId`, `timestamp`, `sessionId`, `cwd`, `gitBranch`, `version`, `isSidechain`, `uuid`, `parentUuid`. Also `type:"user"` (user turns), `type:"summary"` (`summary` field = session title, `leafUuid`), `customTitle` may exist.
- **CRITICAL — dedup**: the SAME API response is written on MULTIPLE lines (same `message.id` + `requestId`, identical usage). Dedup key: `message.id ?? requestId`; keep LAST occurrence. Without dedup costs inflate ~2-4×.
- `usage` fields: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, and `cache_creation.ephemeral_5m_input_tokens` / `.ephemeral_1h_input_tokens` (split matters for price). If `cache_creation` object missing (older versions) treat all cache_creation as 5m.
- Model `<synthetic>` = internal, cost 0. Skip records without usage.
- Sidechain (subagent) transcripts are separate sessionIds with `isSidechain:true`. Do NOT try to link to parent in v1: count them into project/day totals, list them as sessions with `sidechain:true`.
- Project folder name = transcript dir name (e.g. `C--github-proj-alpha`). Derive `project` = last meaningful segment of most-frequent `cwd` in session (e.g. `proj-alpha`); fallback dir name. Worktree dirs (`*-claude-worktrees-*`) → map to their base project (strip from `--claude-worktrees-` / `-claude-worktrees-` onward).

## Pricing (USD per MTok)

`collector/pricing.json` fallback table; at runtime try fetch LiteLLM `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json` (5s timeout, cache to `collector/.cache/litellm.json`, silent fallback). Match by model id prefix. Cost formula:

```
cost = in*input + out*output + cacheRead*read + write5m*(input*1.25) + write1h*(input*2.0)
```

Fallback table (per MTok, aligned with LiteLLM as of 2026-08): fable-5 & opus-5: in 10, out 50, read 1 · opus-4-5: in 5, out 25, read 0.5 · sonnet-5: in 2, out 10, read 0.2 · sonnet-4*: in 3, out 15, read 0.3 · opus-4-1 & opus-4: in 15, out 75, read 1.5 · haiku-4-5: in 1, out 5, read 0.1 · 3-5-haiku: 0.8/4/0.08 · `<synthetic>` & unknown-with-warning: 0 (unknown models: collect list into snapshot `warnings`).
Snapshot embeds `pricingUsed` (effective table) + `pricingSource: "litellm"|"fallback"`.

## Snapshot schema — usage.json / demo.json (schemaVersion 1)

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-18T18:00:00Z",
  "timezone": "Europe/Kyiv",           // day bucketing TZ
  "pricingSource": "litellm",
  "pricingUsed": { "claude-fable-5": {"input":5,"output":25,"cacheRead":0.5} },
  "warnings": ["unknown model: x"],
  "days": [{                            // grain: day × project × model × sidechain
    "day":"2026-08-18","project":"proj-alpha","model":"claude-fable-5","sidechain":false,
    "input":123,"output":456,"cacheRead":0,"cacheWrite5m":0,"cacheWrite1h":0,
    "costUsd":1.23,"messages":12,"sessions":3
  }],
  "sessions": [{
    "sessionId":"uuid","project":"proj-alpha","projectPath":"C:\\github\\proj-alpha",
    "title":"...", "sidechain":false,
    "startedAt":"ISO","endedAt":"ISO","userTurns":5,"assistantTurns":42,
    "models":{"claude-fable-5":{"input":1,"output":2,"cacheRead":3,"cacheWrite5m":4,"cacheWrite1h":5,"costUsd":6}},
    "totals":{"input":1,"output":2,"cacheRead":3,"cacheWrite5m":4,"cacheWrite1h":5,"costUsd":6},
    "maxContext":180000,"avgContext":90000,   // context = input+cacheRead+cacheWrite per assistant msg
    "cacheHitRate":0.93                        // cacheRead / (input+cacheRead+cacheWrite5m+cacheWrite1h)
  }]
}
```

Title priority: `customTitle` → last `summary` record → first user text (strip `<system-reminder>`/command tags, collapse whitespace, truncate 110 chars). Sessions with costUsd < $0.01 may be dropped from `sessions` (keep in `days`).

## Analysis logic (WEB APP, `web/src/lib/analytics.js` — pure functions, unit-testable)

Computed client-side from snapshot/DB so thresholds are tunable without re-collecting. All money = USD.

**Session flags** (thresholds in `web/src/lib/rules.js`):
- `CACHE_MISS` — cacheHitRate < 0.6 AND costUsd > 1. Waste estimate: `(input+writes) priced as-is  −  same tokens priced at cacheRead` × 0.5 realistic factor.
- `FAT_CONTEXT` — avgContext > 120_000. Waste: cost of (avgContext−60k baseline) cacheRead+input share per turn.
- `LONG_SESSION` — assistantTurns > 300 (context never cleared).
- `PREMIUM_MODEL` — modelPremiumUsd = costUsd − costIfSonnet(recomputed from token mix) > 3.
- `SUBAGENT_HEAVY` — project-level: sidechain cost share > 50% AND > $2.
- `TOP_BURNER` — session cost > p90 across sessions.

**Factors view (Пофакторний аналіз)**: aggregate flag waste-estimates across sessions → Pareto bar «Де живе перевитрата»: Кеш-промахи / Роздутий контекст / Дорога модель / Наддовгі сесії / Субагенти. Each factor card: total $, top-3 sessions/projects as evidence, plain-language «чому це відбувається».

**Recommendations (Дії)**: each triggered rule renders a card: severity (🔴>$10, 🟠>$3, 🟡), evidence line with real numbers, and a READY-TO-PASTE Ukrainian prompt for Claude Code with Copy button. Templates (interpolate real values):
- CACHE_MISS → «У проєкті {project} низький кеш-хіт ({rate}%). Проаналізуй, що інвалідовує кеш: хуки, що змінюють системний промпт (rtk, SessionStart), часті рестарти сесій. Запропонуй виправлення.»
- FAT_CONTEXT → «Сесії в {project} тримають контекст ~{avg}k токенів. Розбивай задачі, використовуй /clear між незалежними задачами, виноси довідкові дані в CLAUDE.md/скіли замість читання великих файлів щотурну.»
- PREMIUM_MODEL → «Механічні задачі в {project} йдуть на {model}. Признач для субагентів-скаутів model: haiku, для масових правок sonnet; залиш преміум-модель тільки для архітектури й складного дебагу.»
- LONG_SESSION → «Сесія "{title}" — {turns} ходів без очистки. Заведи звичку: одна задача = одна сесія або /clear.»
- SUBAGENT_HEAVY → «{project}: {share}% витрат — субагенти. Перевір, чи не запускаються workflows/агенти там, де вистачить одного проходу.»

## Web app spec

Stack: Vite 5+, React 18, Recharts, @supabase/supabase-js, plain CSS (no Tailwind). Hash-tab navigation (no router). `vite.config.js`: `base: '/spend-lens/'`. Language of ALL UI copy: Ukrainian (proper grammar; thousands separator — narrow space; $ with 2 decimals; percentages «%», not «п.п.» unless a difference of percentages).

Tabs:
1. **Огляд** — KPI cards: Сьогодні / 7 днів / 30 днів / Разом (+% vs prev period); stacked daily bar (cost by model, rounded tops); line: cumulative month.
2. **Категорії** — Pareto bar cost-by-project (30 днів + перемикач періоду); donut cost-by-model; split Основні/Субагенти; cache economics: daily % cacheRead of context + $ saved by cache.
3. **Сесії** — table sorted by cost desc: Назва, Проєкт, Коли, Модель(и), Токени (in/out/cache), Кеш-хіт %, Контекст avg, $, чіпи-прапорці. Row click → drawer: model mix, метрики, flags with waste $, session-specific recommendations.
4. **Фактори** — Pareto «де перевитрата» + factor cards (див. Analysis logic).
5. **Дії** — recommendation cards with Copy-button prompts, sorted by waste $ desc.

### Design — iOS light (user-confirmed, binding)

- Background `#F2F2F7`, cards `#FFFFFF`, radius 14px, subtle shadow `0 1px 3px rgba(0,0,0,.06)`.
- Font: `-apple-system, "SF Pro Text", "Segoe UI Variable", "Segoe UI", Inter, sans-serif`. Text `#1C1C1E`, secondary `#8E8E93`.
- Accents (iOS system): blue `#007AFF`, teal `#32ADE6`/`#30D5C8`, orange `#FF9500`, green `#34C759`, red `#FF3B30`, purple `#AF52DE`, indigo `#5856D6`, gray `#8E8E93`. Chart series order: blue, teal, orange, purple, green, gray.
- Pill chips (flags/categories): pastel bg = accent at ~12% opacity, text = darkened accent (like iOS badges), radius 999px, font-size 12px. Flag colors: CACHE_MISS orange, FAT_CONTEXT purple, PREMIUM_MODEL red, LONG_SESSION indigo, SUBAGENT_HEAVY teal, TOP_BURNER gray.
- Charts: light solid gridlines `#E5E5EA`, no vertical grid, bar radius [6,6,0,0], tooltip = white card. Numbers on axes compact (`$12`, `340k`).
- No dark theme in v1 (explicit user choice: light).

### Supabase client mode
- `signInWithOAuth({provider:'google'})` and email OTP form as fallback; after auth read tables `usage_days`, `sessions_agg`, `meta`. Unauthed → centered iOS-style login card. RLS denies non-allowlisted users → show «Доступ заборонено для {email}».
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (GitHub repo **variables**, baked at build).

## Supabase schema (`supabase/migrations/001_init.sql`)

Tables: `usage_days` (PK day,project,model,sidechain — columns mirror snapshot `days`), `sessions_agg` (PK session_id — mirrors snapshot `sessions`, `models` jsonb, generated column day), `meta` (key PK, value jsonb — stores generatedAt, pricingUsed, warnings), `allowed_users` (email PK, seeded with the owner's email — see the migration file).
RLS: enable on all; SELECT for authenticated where `auth.jwt()->>'email' in (select email from allowed_users)`; no INSERT/UPDATE policies (service role bypasses). Collector upserts via PostgREST (`Prefer: resolution=merge-duplicates`) with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `collector/.env` (gitignored; `.env.example` committed).

## Collector CLI

`node collector/collect.mjs [--source <dir>] [--out <file>] [--no-push] [--verbose]`
- Full rescan with per-file cache `collector/.cache/files.json` keyed by path+size+mtime storing per-file pre-aggregates → re-parse only changed files. Streaming line reader; tolerate malformed lines (count them).
- Day bucketing in Europe/Kyiv. After snapshot write: push to Supabase if env present (batch upserts, ≤500 rows/req); log summary table: files parsed/cached, msgs, deduped, total cost by model, top-5 projects, elapsed.
- Zero npm dependencies (node:fs/readline/https only). Node 24 available.

## Daily schedule

- `scripts/run-collector.ps1` — runs collector, logs to `collector/.cache/last-run.log`.
- `scripts/register-task.ps1` — `schtasks /Create /TN "spend-lens-daily" /SC DAILY /ST 20:00` running run-collector.ps1 (uses `-ExecutionPolicy Bypass`, absolute paths).
- `.github/workflows/deploy.yml` — triggers: push main, `schedule: cron '0 3 * * *'`, workflow_dispatch. Steps: checkout, setup-node 22+cache npm (web/package-lock), npm ci in web, VITE_* from `vars`, build, upload-pages-artifact (web/dist), deploy-pages. Permissions pages:write id-token:write.

## v1.1 UI upgrades (user feedback, binding)

**Global filter toolbar** in App header row (right of tabs, all tabs): (1) period Segmented «7 днів / 30 днів / Увесь час», default «30 днів», anchored to last snapshot day; (2) project dropdown «Усі проєкти» + projects sorted by total cost desc. Filtering applied ONCE in App via memoized `filterSnapshot(snapshot, {period, project})` → tabs consume the filtered snapshot: days by day-range + project; sessions by `startedAt` day-range + project equality. CategoriesTab drops its local period toolbar. OverviewTab: KPI cards respect the project filter but keep their fixed windows (Сьогодні/7/30/Разом); both charts respect period + project.

**SessionsTab sorting**: clickable column headers with ▲/▼ indicator; toggle asc/desc; default $ desc. Sort keys: Назва (alpha), Проєкт (alpha), Коли (startedAt), Токени (input+output+cacheRead total), Кеш-хіт, Контекст (avgContext), $, Прапорці (flag count).

**No truncation anywhere**: horizontal-bar YAxis width computed from longest visible label (approx `min(280, 12 + maxChars*7.2)`); Sessions «Прапорці» cell wraps chips (flex-wrap, per-chip nowrap), column wide enough; table wrapper scrolls horizontally (`overflow-x auto`) instead of clipping. «Моделі» cell hides zero-cost models (`<synthetic>` etc.).

## v1.2 Email PDF digests (binding)

`report/` module, zero UI — a print-optimized HTML → PDF pipeline + SMTP send. Runs locally on schedule.

**CLI**: `node report/report.mjs --type daily|monthly|yearly [--date YYYY-MM-DD] [--no-send] [--out <dir>]`. Anchor «сьогодні» = `--date` or current Kyiv date. daily → **the PREVIOUS Kyiv day of the anchor** (звіт о 08:00 за добу, що завершилась; `--date 2026-08-18` → звіт за 2026-08-17); monthly → previous calendar month of anchor; yearly → previous calendar year. Reads `web/public/data/usage.json`; REUSES pure libs via import: `web/src/lib/analytics.js`, `rules.js`, `format.js` (they are plain ESM — no build needed).

**Files**: `report/report.mjs` (orchestrator), `render.mjs` (HTML template, all CSS inline, UA copy), `svg.mjs` (hand-rolled inline-SVG charts: h-bar, stacked daily bars, donut; NO chart libs), `pdf.mjs` (find chrome.exe else msedge.exe → `--headless=new --print-to-pdf`), `mailer.mjs` (nodemailer, smtp.gmail.com:465; env `SMTP_USER`, `SMTP_APP_PASSWORD`, `REPORT_TO`; env missing → log «email пропущено», still write PDF, exit 0), `package.json` (dep: nodemailer only), `.env.example` (placeholders only). PDFs → `report/out/` (gitignored). `report/.env` gitignored (root catch-all `.env*` + add `report/out/`).

**Design**: A4 portrait, @page margins ~14mm, same iOS light tokens (bg white for print, #1C1C1E text, accents per web palette, pastel chips), header «spend-lens — зведення за {період}» + generated-at, footer. Numbers via format.js (NNBSP + comma). No external resources — fully self-contained HTML.

**Content** — daily: KPI row (вартість дня, Δ vs попередній день, токени in/out/cacheRead, кеш-хіт, к-сть сесій), h-bar вартість за проєктами (день), model split, top-5 сесій (назва, проєкт, $, чіпи-прапорці), рекомендації дня (buildRecommendations на відфільтрованому дні), попередження якщо день порожній. monthly: KPI (місяць $ vs попередній місяць, токени, кеш-заощадження), stacked daily bars за моделями, top-10 проєктів, top-10 сесій, факторний Pareto, рекомендації. yearly: 12 monthly bars, річні KPI, top-10 проєктів/сесій року, фактори.

**Email**: subject `spend-lens: зведення за {період} — {сума $}`; plaintext body = 3-5 рядків підсумку; PDF attached (`spend-lens-{type}-{date}.pdf`).

**Schedule**: `scripts/run-report.ps1` (PS 5.1): collector collect (push) → report daily (за попередню добу); if day==1 also monthly; if Jan 1 also yearly; log `collector/.cache/report-run.log`. `scripts/register-report-task.ps1`: schtasks "spend-lens-report" daily **08:00**.

## v1.3 PDF = the real site (binding; supersedes svg.mjs rendering)

Goal: the PDF must be visually identical to the dashboard — same React components, Recharts charts, cards, chips, styles — not a parallel hand-drawn template.

**Web print mode**: `web/src/print/PrintReport.jsx` (+`print.css`). App.jsx checks `new URLSearchParams(location.search)` BEFORE hash routing: `?print=daily|monthly|yearly&date=YYYY-MM-DD` → render `<PrintReport type date />` instead of the app (no auth, no toolbar; data ALWAYS from local `data/usage.json` fetch — print mode ignores Supabase build mode; fetch fail → visible error text). Layout per report type mirrors v1.2 content (KPI row, cost-by-project h-bar, model donut, daily/monthly stacked bars, top sessions table with flag chips, recommendation cards) but built from the SAME components: `charts.jsx`, `ui.jsx`, `analytics.js`, `format.js`, styles.css tokens. Recharts in print: fixed-size containers (no ResponsiveContainer measuring races), `isAnimationActive={false}` everywhere. Print CSS: container width 766px, `@page` A4 margin 10mm, `print-color-adjust: exact` + `-webkit-print-color-adjust: exact` (pastel chips/charts must keep color), `.card { break-inside: avoid }`, white page bg. A `#print-ready` marker element is rendered only after data load completes (print waits on it).

**Pipeline (`report/`)**: `pdf.mjs` gains `printSite({distDir, dataDir, urlPath, outPdf})` — ephemeral-port `node:http` static server: `/spend-lens/data/*` → `web/public/data/*` (fresh snapshot wins), `/spend-lens/*` → `web/dist/*` (correct MIME for html/js/css/json/svg); Chrome/Edge `--headless=new --print-to-pdf=<abs> --virtual-time-budget=20000 --no-pdf-header-footer` on `http://127.0.0.1:<port>/spend-lens/?print=<type>&date=<anchor>`; server closes after print; stale-PDF guard (rmSync before, status check, size floor) stays. `report.mjs`: computes anchor + email summary as before; renders via printSite; if `web/dist/index.html` missing → fall back to legacy `render.mjs`+`svg.mjs` path with a loud log line (legacy files stay in repo). `scripts/run-report.ps1` adds `npm --prefix <repo>\web run build` before reporting (keeps dist in sync with src; ~3s).

## v1.4 Responsive / mobile (binding)

The dashboard must be fully usable at 375×812 (phone), 768×1024 (tablet), and desktop. All responsive rules go in `@media screen and (max-width: …)` blocks — NEVER bare `@media (max-width)` — so the print pipeline (fixed 766px, print media) is untouched. Do not modify `web/src/print/**`.

- **≤768px**: filter toolbar wraps to its own full-width row under the tabs; KPI grid 4→2 columns; every `.grid-2` collapses to one column; chart heights may shrink ~15%; touch targets ≥44px.
- **≤640px (phone)**: sessions table becomes a card list (назва, проєкт, дата, $, чіпи; tap → drawer), the drawer becomes a full-screen bottom sheet with a ≥44px close button; KPI grid 2 columns; donut and legends stack vertically.
- **Horizontal-bar charts on phone**: category labels must remain fully readable at 375px WITHOUT truncation — cap the y-axis width at ~45% of the container and wrap long names onto two lines (custom tick), or move labels above bars. No clipped text.
- **No page-level horizontal scroll at any width** (tables/charts scroll inside their own containers). `index.html` must have a proper viewport meta.
- Verification: JS-measured `document.documentElement.scrollWidth <= innerWidth` at 375/768/1280, plus overflow checks on every tab.

## Privacy (public repo!)

`.gitignore` MUST cover: `web/public/data/usage.json`, `collector/.cache/`, `collector/.env`, `node_modules`, `dist`. No real usage numbers, session titles, client/project names, or `HEAVY_METAL` username in committed files — docs use `%USERPROFILE%`. demo.json = synthetic projects («proj-alpha», «proj-beta»...). README in Ukrainian.
