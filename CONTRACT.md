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

## Process launch policy (binding, all lanes)

**Nothing in this repo may open a terminal on its own initiative.** The ban is on
SELF-INITIATED launches — anything a script, a scheduled task, a double-click
handler or an agent starts by itself. A visible console is allowed only when the
user asked for it explicitly: a command they typed into a shell of their own, or a
window they explicitly requested. Everything the project starts on its own runs
**hidden**.

- **Scheduled tasks**: registered with `Register-ScheduledTask` and an **S4U**
  principal (`register-task.ps1`, `register-report-task.ps1`). S4U runs the task
  without an interactive logon — session 0, no desktop — so no window can be
  created at all. `schtasks /Create` without `/RU /RP /NP` is FORBIDDEN: it
  produces `LogonType=InteractiveToken`, so the task only ever runs in a session
  that has a desktop, and `-WindowStyle Hidden` hides the window only after
  conhost has already drawn it. That was the project's one real violation — a
  visible flash at 20:00 and 08:00 every day — fixed in v1.13. When S4U is
  refused (no "Log on as a batch job" right) the scripts fall back to an
  interactive principal and print a warning saying so.
- **On-demand runs**: `scripts/refresh.vbs` — wscript.exe (GUI subsystem, never
  given a console) + `Shell.Run(cmd, 0, True)`, window style `0`. An optional
  `report` argument drives the report pipeline the same windowless way.
- **Node child processes**: every `spawn` / `spawnSync` / `execFileSync` passes
  `windowsHide: true`; browsers are launched `--headless=new` — `windowsHide`
  suppresses a console, never a GUI window. `cmd.exe /d /c` helpers are allowed
  only with redirected output, so they reuse the parent's hidden console.
- **No blocking prompt anywhere**: no `pause`, no `Read-Host`, no `timeout /t`,
  and no modal `MsgBox`. A modal dialog in a non-interactive session renders on an
  invisible window station where nobody can dismiss it, and the task hangs until
  its execution limit — the 2026-08-24 failure (three orphaned shells, 45 min).
  `refresh.vbs` uses `Shell.Popup` with a 60-second timeout instead.
- **Feedback goes elsewhere**: `collector/.cache/last-run.log` and
  `report-run.log`, the «Дані оновлено» stamp in the dashboard and the PDF, the
  «Оновити» button.

### Enforcement — code, not prose

- `scripts/window-lint.mjs` — 17 rules over `scripts/`, `collector/`, `report/`,
  `web/vite.config.js`; exit 1 on any hit. `--staged` for a pre-commit hook,
  `--list` prints the rules. Comments are stripped before matching, so the policy
  text in file headers does not trip it. Validated: 0 hits on the current tree,
  all 17 rules fire on synthetic violations.
- `scripts/window-lint.mjs --root <dir>` — **the same 17 rules against any other
  project**. The directory whitelist is spend-lens-specific, so `--root` drops it
  and walks the whole tree instead (skipping `node_modules`, `dist`, `build`,
  `vendor`, `.venv`, `target`, `coverage`, `.next`, `out`, `.cache`). The marker's
  project prefix is optional outside this repo — `allow-window(<reason>)` is
  enough — and the justification is read from that project's `CONTRACT.md` **or**
  `CLAUDE.md`. Caveat: with no whitelist, browser-side JavaScript is scanned too,
  and a page-local `exec(...)` reads as `child_process.exec` under rule #9.
- `.github/workflows/window-lint.yml` — runs the linter on every push and PR.
- `.claude/hooks/no-self-launched-terminal.sh` — PreToolUse guard on
  `Bash|Write|Edit`. It **asks** rather than blocks, precisely because an explicit
  user instruction is allowed: the user can approve, while an agent's own
  initiative does not slip through silently.

### The machine, not just the tree

The linter and the hook police the repository; neither can see a task that is
already registered on a PC. A task created by an older version keeps its old
principal until it is re-registered, and a window that flashes every few minutes
may belong to software that has nothing to do with this project. Two scripts
close that gap, and neither opens a terminal to do it:

- `scripts/audit-tasks.ps1` (run it as `wscript.exe scripts\tasks.vbs`) —
  **read-only**. Lists every scheduled task whose principal has a desktop AND
  whose action is a console host — that combination, and only it, puts a window
  on screen; every task repeating more often than hourly; and, from
  `Microsoft-Windows-TaskScheduler/Operational` events 129/200, what actually
  fired in the last `-HistoryHours` hours and at what cadence, so "something
  flashed just now" gets a name. Output: a self-dismissing dialog plus
  `collector/.cache/task-audit.log` (full inventory) and `task-audit-summary.txt`.
  It names tasks and never disables one — deleting third-party tasks is the
  owner's decision, not a script's.
- `scripts/fix-tasks.ps1` (`wscript.exe scripts\tasks.vbs fix`) — re-registers
  `spend-lens-daily` and `spend-lens-report` through the corrected register
  scripts and records the resulting `LogonType`; a windowless logon type (S4U /
  Password / ServiceAccount / None) is the proof the flash is gone. Needed once
  per machine: fixing the code does not change a task that is already registered.

### Deliberate exceptions

An exception needs a marker in the code — `spend-lens:allow-window(<reason>)` in a
comment on the same or the previous line — AND, for `visible`-level rules, the same
reason written down in this section. The linter rejects a marker whose reason is
not here.

- **`scripts/refresh.cmd` — за явним запитом користувача: сумісність із наявними
  ярликами.** A double-clicked `.cmd` flashes a console before cmd.exe parses its
  first line; that cannot be fixed from inside a `.cmd`. The file is kept only so
  existing desktop shortcuts keep working — it prints nothing, waits for nothing
  and hands off to `refresh.vbs`. The flash follows a user's double-click, so it is
  user-initiated, not self-initiated. New shortcuts must point at
  `scripts/refresh.vbs`.

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
- `scripts/register-task.ps1` — `Register-ScheduledTask "spend-lens-daily"`, daily 20:00, running run-collector.ps1 with an **S4U principal** (no interactive logon → no desktop → no window), `-ExecutionPolicy Bypass`, `-WindowStyle Hidden`, `-MultipleInstances IgnoreNew`, absolute paths. Falls back to an interactive principal only if S4U is refused.
- `scripts/tasks.vbs` — windowless entry point for the two task tools: no argument (or `audit`) runs `scripts/audit-tasks.ps1` (read-only inventory + what actually fired, from the Task Scheduler log), `fix` runs `scripts/fix-tasks.ps1` (re-register both spend-lens tasks with the S4U principal). Results land in `collector/.cache/task-audit*.{log,txt}` / `task-fix*.{log,txt}` and in a `Shell.Popup` with a 180-second timeout. See «Process launch policy → The machine, not just the tree».
- `scripts/refresh.vbs` — on-demand run with no window at all; `refresh.vbs report` drives the report pipeline (see «Process launch policy»); `scripts/refresh.cmd` only delegates to it. run-collector.ps1 also syncs `web/public/data/usage.json` → `web/dist/data/usage.json` when a local build exists.
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

## v1.5 Overview: projects, comparison, forecast (binding)

Goal: the Огляд tab must answer «куди пішли гроші за проєктами» and «чи йдемо ми на перевитрату», not only «скільки за моделями».

**BUGFIX first**: `OverviewTab` currently feeds the period-filtered `days` into `cumulativeMonth`, so with period «7 днів» the card titled «Наростаючий підсумок — {місяць}» shows a truncated month. The monthly card MUST use `kpiDays` (project-filtered, NOT period-filtered), like the KPI row; the daily chart keeps the period-filtered days.

**1. Daily chart split toggle** — `Card «Витрати за днями»` gets a Segmented «За моделями / За проєктами» (default «За моделями»), rendered in the card header area (new optional `actions` prop on `Card`). New pure fn `dailyByProject(days, {topN = 6})` in analytics.js: top-N projects by total cost in the visible range, everything else aggregated into `«Інші»` (always last, gray `#8E8E93`). Same stacked-bar styling as models. Legend below shows project names + colors. Color assignment: new exported `buildSeriesColors(keys)` in charts.jsx (generalization of `buildModelColors`, same SERIES order; `«Інші»` pinned gray).

**2. Bottom row becomes `grid-2`**:
- **Left — «Наростаючий підсумок — {місяць}»**: current-month cumulative line (blue, solid) + previous-month cumulative overlaid by day-of-month (gray `#8E8E93`, `strokeDasharray "4 4"`, name «минулий місяць») + forecast continuation (blue dashed, from today to month end, `strokeDasharray "5 5"`) computed as `runRate = сума за останні 7 днів / 7` extrapolated linearly. Subtitle shows «Прогноз на кінець місяця: $X» (only when the month is in progress; if the anchor day is the last day of its month, omit forecast). New pure fns: `cumulativeMonthCompare(days, anchorDay)` → `{rows:[{dom, cur, prev, forecast}], forecastTotal, prevTotal}` where `dom` = day-of-month 1..31. Tooltip labels: «{dom} {місяць}», series «цей місяць», «минулий місяць», «прогноз».
- **Right — «Топ проєктів за період»**: horizontal bars (top-8 by cost in the period-filtered range) with cost label and a Δ-badge vs the immediately preceding equal-length window («+34 %» red / «−12 %» green / «новий» purple chip when previous window had $0). New pure fn `projectsWithDelta(daysFiltered, daysAll, {period, anchorDay, topN = 8})`. Bars are clickable: clicking sets the global project filter (App passes `onSelectProject`); cursor pointer + `title="Показати лише {проєкт}"`; keyboard accessible (`tabIndex`, Enter/Space). When a single project is already selected, the card shows that project only and a «Показати всі проєкти» link.

**3. Consistency rules**: all new UI copy in grammatically correct Ukrainian (mind «за 7 днів», plural forms); numbers via format.js; iOS palette only; charts `isAnimationActive` default on-screen but the print path (`web/src/print/**`) is NOT to be modified — however, if `PrintReport` imports `dailyByModel`/`cumulativeMonth`, those signatures must stay backward-compatible (add new functions instead of changing old ones). Responsive: at ≤768px the `grid-2` collapses (already covered by v1.4); the Segmented in the card header wraps under the title.

## v1.6 Drill-down, budget, anomalies, efficiency, patterns, URL state, XLSX (binding)

Seven features. All UI copy Ukrainian, iOS palette, format.js numbers, responsive per v1.4 (verify 375/768/1280). `web/src/print/**` is UNFROZEN for the budget line only (item 2) — any change there requires re-verifying the PDF end-to-end.

**1. Drill-down day → sessions.** Global filter gains optional `day` (YYYY-MM-DD). `filterSnapshot` accepts `day`; when set it overrides `period` (exact-day match for `days`; sessions by Kyiv-day of `startedAt`). Clicking a bar in Overview «Витрати за днями» sets `day` and switches to the Сесії tab. Active day shows as a dismissible chip in the filter toolbar («18 серпня ✕», ≥44px touch target); clearing restores the previous period. Same click-through on the Категорії project bars is already covered by v1.5 (project filter).

**2. Budget + early warning.** Monthly budget in USD, source priority: URL `?budget=` → `localStorage['spend-lens.budget']` → none. Editable inline on the Overview budget card (number input, saves to localStorage, «—» = вимкнено). New card «Бюджет місяця» in the KPI area: progress bar (green <80 %, orange 80–100 %, red >100 %), «Витрачено $X з $Y (N %)», forecast line «За поточним темпом місяць закриється на $Z» (reuse v1.5 `cumulativeMonthCompare.forecastTotal`) and a verdict chip: «в межах бюджету» / «на межі» / «перевищення на $W». Hidden entirely when no budget is set (show a subtle «Задати бюджет» link instead). `PrintReport` renders the same card when `?budget=` is present; `report/report.mjs` appends `&budget=` from `MONTHLY_BUDGET_USD` in `report/.env` (documented in `.env.example`), and the email body gains the forecast-vs-budget line when set.

**3. Anomalies.** New `web/src/lib/anomalies.js` (pure): robust detection via median + MAD (no mean/σ — outliers skew it).
- Session anomaly: `costUsd > max(3 × median(project sessions), $5)` → flag `ANOMALY` (color `#FF3B30`, chip «Аномалія») with evidence «у {n} разів дорожча за типову сесію в проєкті ({median})». Feeds the Сесії flags column and the drawer.
- Day anomaly: over the trailing 30 days, `cost > median + 3 × 1.4826 × MAD` → marked with a red dot on the Overview daily chart and listed in a new Overview card «Аномалії» (top-5: день/сесія, $, чому). Empty state: «Аномалій не виявлено».
- Guard: require ≥8 comparable points, else no detection (avoid flagging on thin data).

**4. Efficiency.** New card group on Категорії: «Ефективність» — (a) line «Вартість одного ходу асистента» per day (`costUsd / messages`, days with `messages = 0` skipped) with a 7-day moving average; (b) horizontal bars «$ за 1M вихідних токенів» by model (`costUsd / output × 1e6`); (c) KPI trio: середня вартість сесії, середня вартість ходу, частка кешу у контексті. Subtitle must state the point: «менше — краще; зростання означає, що кожен хід тягне більше контексту».

**5. Patterns heatmap.** New card «Коли горять гроші» on Категорії: weekday × hour-of-day heatmap built from `sessions[].startedAt` converted to **Europe/Kyiv** (7 rows × 24 cols, cost summed by session start hour). Sequential single-hue scale (white → `#007AFF`), legend with min/max, cell tooltip «{день}, {година}:00 — $X, {n} сесій». Footnote: «вартість віднесено до години початку сесії». Phone: horizontally scrollable inside its card, never page-level scroll.

**6. URL state.** Tab + filters (`tab`, `period`, `project`, `day`, `budget`) live in the URL query string; back/forward work; links shareable. Rules: `?print=` mode is checked FIRST and ignores all of this; invalid values fall back to defaults silently; state writes use `history.replaceState` for filter tweaks and `pushState` for tab/day changes (so «назад» undoes a drill-down). Keep the existing `#hash` tab links working as aliases.

**7. XLSX export.** Button «Експорт XLSX» in the filter toolbar. Uses `exceljs` **lazy-loaded via dynamic `import()`** (must not enter the main bundle) in `web/src/lib/xlsxExport.js`. Exports the CURRENT slice (period/project/day applied), sheets: «Огляд» (KPI + денні суми), «Проєкти», «Моделі», «Сесії» (усі колонки таблиці + прапорці текстом), «Рекомендації» (правило, проєкт, втрати, промпт). Styling: bold header row with `#F2F2F7` fill, frozen top row, autofilter, column widths, `$#,##0.00` for money, integer format with thousands for tokens, dates as text in Ukrainian format. Filename `spend-lens_{зріз}_{YYYY-MM-DD}.xlsx` where `{зріз}` = project or «усі-проєкти». Download via Blob + temporary anchor; show a brief «Готуємо файл…» state while the chunk loads.

## v1.7 Session & project digests (binding)

Goal: answer «що тут відбувалося» for any session or project WITHOUT calling an LLM — everything is derived deterministically from transcripts. Two lanes: **v1.7a collector/DB** (this section, part A) and **v1.7b UI** (part B, ships after v1.6).

### Part A — collector (`collector/**`, `supabase/migrations/002_*.sql`)

Extract per session while streaming (assistant lines are already JSON.parsed — walk `message.content` blocks):
- `tools`: histogram of `tool_use` block `name` (keep top 8 + `other` count). Normalize MCP names: `mcp__Claude_Browser__*` → `browser`, `mcp__computer-use__*` → `computer`, keep plain names otherwise.
- `areas`: top 5 directories from tool inputs `file_path`/`path`/`notebook_path`, normalized to forward slashes and shortened to the last 2 path segments of the DIRECTORY (e.g. `web/src/components`); count occurrences.
- `edits`: count of Edit/Write/NotebookEdit calls; `filesTouched`: distinct file paths count.
- `intent`: first user message text, cleaned — strip `<system-reminder>…</system-reminder>`, `<task-notification>…`, `<command-*>` blocks and code fences, collapse whitespace, truncate 200 chars at a word boundary. Empty → null.
- `activity`: single Ukrainian label from the tool mix, first match wins: browser≥15 % → `перевірка в браузері`; computer≥15 % → `робота з десктопом`; Task/Workflow/Agent≥8 % → `оркестрація агентів`; (Edit+Write)≥25 % → `правки коду`; (Bash+PowerShell)≥35 % → `запуски й перевірки`; (Read+Grep+Glob)≥35 % → `розбір коду`; else `змішана робота`.

Snapshot additions (schemaVersion → **2**, but readers must tolerate v1):
- `sessions[].digest = {activity, tools:{name:count}, areas:[{path,count}], edits, filesTouched, intent}`
- NEW top-level `projects[]`: `{project, sessions, sidechainSessions, costUsd, firstDay, lastDay, models:[top3], areas:[{path,count} top5], activities:[{label,count}], titles:[top5 session titles by cost], note}` — `note` comes from optional gitignored `collector/projects.json` (`{"<project>": "ручний опис"}`), else `null`.
- Session title fix: for `sidechain:true` sessions prefix the derived title with `субагент: ` and build it from the cleaned intent (never the raw brief with paths/instructions); cap 110 chars.

Cache: digests must live in the per-file cache — bump `CACHE_VERSION`. Performance budget: cold full run ≤ 20 s on ~1 900 files (currently ~8 s); report the measured time.
Supabase: `002_digests.sql` — `alter table sessions_agg add column if not exists digest jsonb`; new table `projects_agg` mirroring `projects[]` (PK project, `note` text, jsonb for arrays), same RLS pattern as existing tables (SELECT for allowlisted authenticated users only). Collector upserts it.
Safety while testing: use `--out <scratchpad path>` for trial runs; overwrite the real `web/public/data/usage.json` only after the schema is verified.

### Part B — UI (`web/src/**`, print + XLSX)

- NEW tab **«Проєкти»** (between Категорії and Сесії): card per project sorted by cost — назва, `note` or auto-summary sentence («Правки коду · web/src/components, report · 34 сесії · 18.06–19.08»), КПІ (витрати, сесії, частка субагентів), chips of top areas, list of top-5 session titles with cost, button «Показати лише цей проєкт» (sets the global project filter).
- **Сесії**: second line under the title in the table = `activity · top area · N файлів`; drawer gains a «Що відбувалося» block (activity, areas, tools top-5 as chips, edits/files, duration, `intent` as a quoted paragraph).
- **PDF**: top-sessions table gains the same one-line digest under the title; daily report gains a compact «Чим займалися» line per project in the projects card (activity label only).
- **XLSX**: «Сесії» sheet gains columns Активність / Області / Правки / Файли / Запит; new sheet «Проєкти».
- Snapshot v1 fallback: when `digest`/`projects` are absent, all new UI degrades silently (no empty blocks, no crashes).

## v1.8 Relative return, small-project grouping, subagent card, layout (binding)

User feedback, four items. All Ukrainian copy, iOS palette, v1.4 responsive, no truncation.

### 1. Відносна віддача замість порівняння абсолютних сум (core change)

The current anomaly evidence («у 1027 разів дорожча за типову сесію») is rejected as meaningless: a cheap session may have produced nothing, so comparing absolute costs compares nothing. Replace it with **rate comparisons** — cost per unit of produced effect.

NEW pure module `web/src/lib/efficiency.js` (uses v1.7a digests):
- `sessionRates(session)` → `{usdPerEdit, usdPerKOut, contextPerEdit, outputShare}`; each null when its denominator is 0. Context = `input + cacheRead + cacheWrite5m + cacheWrite1h`.
- `sessionClass(session)` → `'правки'` when `digest.edits >= 3`, else `'аналіз'`.
- `baselines(sessions)` → median of each rate **within class**, computed only over sessions with `costUsd >= 0.5` and a non-zero denominator (empty sessions must not drag medians to zero).
- `returnIndex(session, baselines)` → `{metric, value, median, index, class}` where `index = value / median` (>1 = gірша віддача).
- `lowReturnSessions(sessions, {minIndex = 3, minCostUsd = 5})` → sorted by `(index − 1) × costUsd` desc — «скільки грошей коштувала саме погана віддача».
- `dayReturn(days, sessions, timeZone)` → per-day `usdPerEdit` (day edits = sum of `digest.edits` of sessions STARTED that Kyiv day; footnote required) + index vs the median day.

Evidence wording (multiplier in words up to 4×, digits above): «$4,20 за правку — утричі дорожче за вашу медіану ($1,40)»; analysis class: «$0,82 за 1k вихідних токенів — удвічі дорожче за медіану ($0,41)»; day: «$17,30 за правку — вчетверо дорожче за звичний день ($4,10)». NEVER compare a session's absolute cost to another session's absolute cost anywhere in the UI, PDF or XLSX.

The `ANOMALY` flag keeps its detection for DAYS (budget awareness) but its evidence must also be rate-based; the session-level absolute-cost anomaly is REPLACED by low-return detection. Card renamed **«Слабка віддача»**, subtitle «Сесії, де кожна одиниця роботи коштувала помітно дорожче за вашу норму».

NEW card **«Віддача на витрачене»** in the Ефективність group (Категорії): KPI trio (медіана $ за правку, медіана контексту на правку, частка виходу), horizontal bars of projects by `usdPerEdit` (top-8, «менше — краще», median reference line), and a list of the 5 worst-index sessions.

### 2. Аномалії/Слабка віддача — вниз сторінки
On Огляд the card moves to the LAST position (after «Топ проєктів за період»).

### 3. Дрібні проєкти → «Інші» з розгортанням
`SMALL_PROJECT_USD = 50` in rules.js. In «Де живуть витрати» (Категорії) and the Проєкти tab, projects with `costUsd < 50` collapse into one gray row «Інші — N проєктів» with a toggle «Показати всі» / «Згорнути дрібні» (state local to the card, ≥44px target). Guard: if collapsing would leave fewer than 3 individual rows, show the top-5 individually instead (degenerate case: short periods where everything is small). The daily stacked-by-project chart keeps its top-6 rule (a stacked bar with many series is unreadable) — do not change it.

### 3b. Ряд вкладок ніколи не переноситься (already implemented — do not revert)
`ExportButton` lives in the HEADER (`.app-meta`, next to email/Вийти), NOT in `.filter-toolbar` — it is an action, not a filter, and it was the element that pushed the tab bar onto a second line. `.tabs { flex-wrap: nowrap; flex: 0 0 auto }` at ≥861px; the project select is the only flexible item in the row. Keep this arrangement.

### 4. Картка «Основні проти субагентів» — перероблення
Problems: `#007AFF` vs `#32ADE6` read as one colour, and the card is mostly empty space. Required: субагенти switch to orange `#FF9500` (main stays blue `#007AFF`) — a clearly different hue; add a large share figure («19 % витрат — субагенти») with caption; fill the empty space with a ranked list of the top-5 projects by subagent share (mini bar + % + $), so the card answers «де саме субагенти зʼїдають бюджет». Keep the same card height class as its `grid-2` sibling.

## v1.9 RTK savings integration (binding)

RTK (Rust Token Killer) is a local CLI proxy that trims command output before it reaches the model. It keeps its own stats; spend-lens must show **how much it saves**.

**Source of truth** (verified on rtk 0.45.0): `rtk gain --format json --daily` → `{summary:{total_commands, total_input, total_output, total_saved, avg_savings_pct, total_time_ms, avg_time_ms}, daily:[{date, commands, input_tokens, output_tokens, saved_tokens, savings_pct, total_time_ms, avg_time_ms}]}`. `--history`/`--quota` are NOT implemented for json (they return summary only) — the per-command table exists only in the text output of plain `rtk gain`; parse it best-effort with a regex and treat failure as non-fatal (`commands: []`).

**Collector** (`collector/rtk.mjs`, called from collect.mjs): spawn `rtk gain --format json --daily` with a 5 s timeout; if the binary is missing, errors, or returns unparseable output → snapshot gets `rtk: null` and a `warnings` entry is NOT added (absence of rtk is normal, not a problem). Also run plain `rtk gain` (5 s) for the top-command table; parse rows `#. command count saved avg% time` into `[{command, count, savedTokens, avgPct}]`, top 10. Dates from rtk are already local calendar days — keep them as-is and DO NOT re-bucket.

Snapshot: new top-level `rtk = {collectedAt, summary, daily, commands}` (schemaVersion stays 2 — consumers must tolerate its absence). Supabase: `meta` row `key='rtk'` (jsonb value) — no new table; `supabaseData.js` reads it back into `snapshot.rtk`.

**Valuation** (`web/src/lib/rtkValue.js`, pure): saved tokens are tokens never sent as INPUT. Value them at the **input** price of the model mix actually used that day: `blendedInput(day) = Σ(model input price × model cost share)` from `pricingUsed` + `days[]`; fall back to the period-wide mix, then to the priciest used model. `valueUsd(day) = saved_tokens × blendedInput / 1e6`. The UI must state this is a **floor** («мінімальна оцінка: збережені токени рахуються як одноразовий вхід, хоча в реальності кожен зайвий рядок ще й перечитувався б з кешу щохода»).

**UI** — new card **«Скільки економить RTK»** on Категорії (after the cache-economics pair):
- KPI trio: збережено токенів (з %), оцінка в $ (floor), команд оброблено.
- Daily bar chart of `saved_tokens` aligned to the current period filter (green `#34C759`), with `$` in the tooltip.
- Top-5 commands list (command, count, saved) when `commands` is non-empty.
- Absent `snapshot.rtk` → the whole card does not render (no empty state, no error).
- The period filter applies to the daily chart and to the KPI (sum over visible days); the project filter does NOT apply (rtk stats are not per-project) — say so in the subtitle.
- PDF daily/monthly report: one compact line in the projects/KPI area — «RTK зберіг {tokens} токенів (~${value}) за період» — only when data exists.

## v1.10 Tool-output flow — «звідки течуть токени» (binding)

Motivation (measured 2026-08-19 over transcripts since 2026-08-12): tool results total ≈187M chars ≈47M tokens. Read **62,1 %**, computer-use batches 17,0 %, **Bash only 7,8 %**, Grep 2,2 %, Glob 1,7 %, PowerShell 0,9 %. RTK can only ever touch the Bash slice — that is why its savings look small next to total spend. The dashboard must show this flow permanently instead of leaving the user to guess.

**Collector** (`collect.mjs`, additive): while streaming, map `tool_use.id → name` per file (already done for digests) and, on `type:"user"` messages, accumulate each `tool_result` block's serialized length against that tool. Normalize MCP names as in v1.7a (`mcp__Claude_Browser__*` → `browser`, `mcp__computer-use__*` → `computer`). Aggregate to a new top-level `toolOutput: [{day, tool, calls, chars}]` (day = Kyiv day of the RESULT record; keep top 12 tools per day + `інші`). Facts ride on the same dedup key as digests — a `tool_result` may be written on several lines. Cache: bump `CACHE_VERSION`. Budget: cold run must stay ≤20 s; report measured time and snapshot size delta (expected ≤ +250 KB).

**Web** (`web/src/lib/toolFlow.js`, pure): `toolFlowByDay(toolOutput, {from, to})`, `toolFlowTotals(...)` → per-tool `{tool, calls, chars, tokens, share}` with `tokens = chars / 4` (state the approximation in the UI), `estUsd` at the same blended input price as the RTK card (`rtkValue.blendedInputPrice`), and `RTK_REACHABLE = new Set(['Bash'])` so the card can mark the reachable slice.

**UI** — new card **«Звідки течуть токени інструментів»** on Категорії, directly ABOVE the RTK card (it explains the RTK card's ceiling):
- Horizontal Pareto of tools by chars for the selected period, value labels in tokens (`фmtTokens`) + share; the RTK-reachable bar(s) painted green `#34C759`, the rest blue `#007AFF`, with a legend «у зоні дії RTK / поза нею».
- Subtitle names the point: «≈{tokens} токенів вивели інструменти за період. RTK підрізає лише {share} з них — решта приходить від Read, Grep і скриншотів.»
- A note that chars→tokens is a ≈4:1 approximation, and that this counts what tools RETURNED, not what was billed (cache re-reads multiply it).
- Absent `toolOutput` (old snapshot) → card does not render.
- The RTK card's subtitle gains a cross-reference sentence pointing at this card.

**PDF/XLSX**: XLSX gains a «Вивід інструментів» sheet (day, tool, calls, chars, tokens); PDF unchanged (space is tight).

## Privacy (public repo!)

`.gitignore` MUST cover: `web/public/data/usage.json`, `collector/.cache/`, `collector/.env`, `node_modules`, `dist`. No real usage numbers, session titles, client/project names, or `HEAVY_METAL` username in committed files — docs use `%USERPROFILE%`. demo.json = synthetic projects («proj-alpha», «proj-beta»...). README in Ukrainian.
