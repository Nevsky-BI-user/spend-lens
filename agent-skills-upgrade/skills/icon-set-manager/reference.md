# Icon Set Manager — Reference

Depth for [SKILL.md](SKILL.md). Sections are numbered so SKILL.md pointers (`reference.md §N`) resolve.

## §1. Configuration

These values are substituted during setup (see `setup-instructions.md`):

- **REPO_OWNER**: `Nevsky-BI-user`
- **REPO_NAME**: `icons-png-powerbi`
- **BRANCH**: `main`
- **LOCAL_CLONE**: `<local clone of icons-png-powerbi>`
- **MANIFEST_PATH**: `manifest.json` (at repo root)
- **ICON_PATH_PATTERN**: `icons/{category}/{category}_{name}.png`
- **RAW_URL_PATTERN**: `https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/{BRANCH}/{path}`
- **CDN_URL_PATTERN**: `https://cdn.jsdelivr.net/gh/{REPO_OWNER}/{REPO_NAME}@{BRANCH}/{path}` (jsDelivr proxy for production Power BI)

API keys (optional, stored in user config):

- **FLATICON_KEY**: `~/.config/icon-set-manager/flaticon.key` (chmod 600)
- **ICONS8_KEY**: `~/.config/icon-set-manager/icons8.key` (chmod 600)

If a key file is absent, that source is silently skipped in the fallback chain.

## §2. 20 Categories

```
navigation       — home, back, forward, menu, search, filter, breadcrumb, sidebar
actions          — refresh, export, import, edit, delete, add, drill, share, save, copy
kpi              — trend-up, trend-down, target, threshold, alert, gauge, score, goal
status           — ok, warning, error, info, pending, locked, blocked, completed
time             — calendar, clock, period, history, schedule, deadline, timer
data             — table, chart, database, file, dataset, query, pivot, csv, excel
users            — person, team, role, manager, group, profile, avatar
communication    — email, chat, notification, phone, video, message, bell
security         — lock, shield, key, password, audit, access, permission
documents        — contract, certificate, report, invoice-doc, presentation, archive
geography        — map, pin, region, country, globe, address, route-map
analytics        — funnel, segment, cohort, dashboard, insight, distribution
finance          — money, currency, bank, invoice, payment, budget, profit, expense
ecommerce        — cart, order, product, shipping, package, discount, store
hr               — employee, hiring, training, onboarding, performance, leave, payroll
agro             — crop, livestock, tractor, field, harvest, weather, seed, irrigation
logistics        — truck, warehouse, container, delivery, route, fleet
production       — factory, machine, quality, conveyor, gear, assembly, robot
marketing        — campaign, megaphone, lead, conversion, brand, ad
sales            — deal, pipeline, contract, handshake, quote, opportunity, won, lost
```

If user requests a category not on this list, ask for confirmation before creating a new folder.

## §3. Step 1 — Parse query

Extract:
- **Intent**: explicit lookup ("знайди іконку для X") vs explicit create ("створи іконку X") vs ambiguous ("потрібна іконка X")
- **Category**: from explicit mention OR inferred from concept (e.g., "tractor" → `agro`); if ambiguous, ask
- **Concept/name**: actual icon meaning
- **Style override**: e.g., "в стилі lucide"
- **Color override**: e.g., "колір білий"
- **Size override**: e.g., "128px", "hero"

## §4. Step 2 — Search existing icons in manifest

```bash
cd <local clone of icons-png-powerbi>
git pull --quiet origin main  # ensure manifest is current
```

Read `manifest.json`. Match query semantically:

1. **Exact name match** within category → confidence HIGH
2. **Tag exact match** (any tag field equals query term) → confidence HIGH
3. **Substring/fuzzy name match** within category → confidence MEDIUM
4. **Cross-category tag match** → confidence MEDIUM
5. **Semantic match** (e.g., "growth" → finds icon tagged `trend-up`) → confidence MEDIUM
6. **No match** → confidence ZERO

Decision matrix:

| Confidence | Style override matches stored style? | Action |
|---|---|---|
| HIGH | yes | Return existing icon, skip fetch |
| HIGH | no | Return existing + offer to fetch alternative in requested style |
| MEDIUM | — | Show top 3 existing candidates + offer to fetch new |
| ZERO | — | Proceed to Step 3 (fetch) |

If user explicitly says "створи новий" / "force new" — skip search, go to Step 3.

## §5. Step 3 — Fetch from external sources (only if Step 2 = ZERO or user confirms)

Fallback chain executed in order. First success wins.

```
3.1  Iconify direct lookup   → api.iconify.design/{set}/{name}.svg?color=%23063e61&width=64&height=64
     (Iconify serves SVG only — convert to PNG locally with magick/rsvg-convert.
      Note %23 = URL-encoded # — required for stroke-based sets like lucide/tabler)
     Sets tried in order: material-symbols, mdi, lucide, tabler,
                          phosphor, game-icons, carbon, fluent, healthicons

3.2  Iconify search API      → api.iconify.design/search?query={term}&limit=20
     Pick first match from preferred sets above; respect license preference.

3.3  SVG Repo direct/search  → www.svgrepo.com/api/v1/search?term={term}&type=svg
     Download SVG → recolor (sed) → rsvg-convert to PNG.

3.4  Flaticon API (if key)   → api.flaticon.com/v3/search/icons?q={term}
     Requires FLATICON_KEY. Free tier: attribution required.

3.5  Icons8 API (if key)     → api.icons8.com/api/iconsets/v3/icons?term={term}
     Requires ICONS8_KEY. Free tier: 100 downloads/day, attribution required.

3.6  Manual selection        → Iconify search returns candidates →
                              present 5 to user → user picks.
```

### 3.1 Iconify direct (SVG endpoint + local rasterization)

Iconify's public API serves SVG only — there is no server-side PNG renderer. Fetch SVG with color and size baked in, then rasterize to PNG locally using `magick` (ImageMagick, Windows/macOS/Linux) or `rsvg-convert` (librsvg, Linux/macOS).

```bash
SET="material-symbols"
NAME="agriculture"
CATEGORY="agro"
COLOR="063e61"
SIZE=64
TMPSVG="${TMPDIR:-/tmp}/iconify_$$.svg"
OUT="icons/${CATEGORY}/${CATEGORY}_${NAME}.png"

# Download SVG with color and size baked in (Iconify renders these server-side into the SVG).
# IMPORTANT: URL-encode `#` as `%23` in color param. Without it, Iconify inserts bare hex
# (e.g. stroke="854f0b") which CSS treats as an unknown named color → invisible stroke for
# lucide/tabler/phosphor (stroke-based sets). Material-symbols (fill-based) is tolerant but
# %23 is correct in all cases.
curl -sfL --max-time 10 \
  "https://api.iconify.design/${SET}/${NAME}.svg?color=%23${COLOR}&width=${SIZE}&height=${SIZE}" \
  -o "${TMPSVG}"

# Verify it's actually SVG (Iconify returns 404 HTML when icon/set missing)
if ! head -1 "${TMPSVG}" | grep -q "<svg"; then
  rm -f "${TMPSVG}"
  # Fall through to next set in chain
  return 1
fi

# Rasterize: prefer ImageMagick, fall back to rsvg-convert
if command -v magick >/dev/null 2>&1; then
  magick -background none "${TMPSVG}" -resize ${SIZE}x${SIZE} "${OUT}"
elif command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w ${SIZE} -h ${SIZE} -b none "${TMPSVG}" -o "${OUT}"
else
  echo "ERROR: install ImageMagick (winget install ImageMagick.ImageMagick.Q16) or librsvg (apt install librsvg2-bin / brew install librsvg)"
  rm -f "${TMPSVG}"
  return 1
fi

rm -f "${TMPSVG}"

# Verify result is PNG AND has visible content (alpha mean > 0.01)
# A fully-transparent PNG passes the "PNG image" check but is invisible — common bug when
# color param is malformed (e.g. missing %23 prefix for stroke icons).
if file "${OUT}" | grep -q "PNG image"; then
  ALPHA=$(magick identify -format "%[fx:mean.a]" "${OUT}" 2>/dev/null || echo "1.0")
  if awk -v a="${ALPHA}" 'BEGIN{exit !(a > 0.01)}'; then
    SOURCE="iconify:${SET}"
    LICENSE=$(curl -s "https://api.iconify.design/collection?prefix=${SET}" | jq -r '.license.title // "unknown"')
  else
    rm -f "${OUT}"
    echo "ERROR: PNG is fully transparent (likely color-param encoding bug). Verify ?color=%23<hex>"
    return 1
  fi
else
  rm -f "${OUT}"
  return 1
fi
```

**Windows note**: on native Windows, `magick.exe` is at `C:\Program Files\ImageMagick-*\magick.exe`. After winget install, restart shell to pick up PATH. In current session, call full path directly.

### 3.2 Iconify search (fuzzy across all 200+ sets)

```bash
QUERY="growth chart"
ENCODED=$(printf %s "$QUERY" | jq -sRr @uri)
RESULTS=$(curl -s "https://api.iconify.design/search?query=${ENCODED}&limit=20" | jq -r '.icons[]')

# Returns list like:
#   material-symbols:trending-up
#   lucide:trending-up
#   mdi:trending-up
# Pick first match from preferred sets; verify license is permissive.
```

### 3.3 SVG Repo (vector source, requires local conversion)

```bash
QUERY="tractor"
CATEGORY="agro"
NAME="tractor"
COLOR="063e61"
SIZE=64

# Search SVG Repo
RESPONSE=$(curl -s "https://www.svgrepo.com/api/v1/search?term=${QUERY}&type=svg")
SVG_URL=$(echo "$RESPONSE" | jq -r '.icons[0].svg_url // empty')
LICENSE=$(echo "$RESPONSE" | jq -r '.icons[0].license // "unknown"')
AUTHOR=$(echo "$RESPONSE" | jq -r '.icons[0].author // empty')

if [ -z "$SVG_URL" ]; then
  echo "SVG Repo: no results for $QUERY"
  exit 1
fi

# Download SVG
curl -sfL "$SVG_URL" -o /tmp/icon.svg

# Recolor if monotone — replace any fill hex or currentColor with target color
sed -i.bak -E \
  -e 's/fill="#[0-9A-Fa-f]{3,8}"/fill="#'"$COLOR"'"/g' \
  -e 's/currentColor/#'"$COLOR"'/g' \
  /tmp/icon.svg

# Rasterize to transparent PNG of target size
rsvg-convert -w "$SIZE" -h "$SIZE" -b none /tmp/icon.svg \
  -o "icons/${CATEGORY}/${CATEGORY}_${NAME}.png"

# Cleanup
rm -f /tmp/icon.svg /tmp/icon.svg.bak
```

### 3.4 Flaticon (requires API key, attribution required)

```bash
KEY=$(cat ~/.config/icon-set-manager/flaticon.key 2>/dev/null)
[ -z "$KEY" ] && { echo "SKIP Flaticon: no key"; exit 1; }

# Authenticate (Flaticon uses Bearer token after exchange)
TOKEN=$(curl -s -X POST "https://api.flaticon.com/v3/app/authentication" \
  -H "Accept: application/json" \
  -d "apikey=${KEY}" | jq -r '.data.token')

# Search
QUERY="employee"
RESPONSE=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://api.flaticon.com/v3/search/icons/priority?q=${QUERY}&styleColor=black&limit=10")

# Pick first result
ICON_ID=$(echo "$RESPONSE" | jq -r '.data[0].id')
ICON_AUTHOR=$(echo "$RESPONSE" | jq -r '.data[0].author.name')
ICON_PACK=$(echo "$RESPONSE" | jq -r '.data[0].pack.name')
ICON_URL=$(echo "$RESPONSE" | jq -r '.data[0].images.png."64"')

curl -sfL -o "icons/${CATEGORY}/${CATEGORY}_${NAME}.png" "$ICON_URL"

# Attribution required for free tier — stored in manifest + ATTRIBUTIONS.md
```

### 3.5 Icons8 (requires API key, attribution required)

```bash
KEY=$(cat ~/.config/icon-set-manager/icons8.key 2>/dev/null)
[ -z "$KEY" ] && { echo "SKIP Icons8: no key"; exit 1; }

QUERY="department"
RESPONSE=$(curl -s -H "Authorization: ${KEY}" \
  "https://api.icons8.com/api/iconsets/v3/icons?term=${QUERY}&platform=color&amount=10")

ICON_ID=$(echo "$RESPONSE" | jq -r '.icons[0].id')
ICON_URL="https://img.icons8.com/${ICON_ID}/${SIZE}/${COLOR}.png"

curl -sfL -o "icons/${CATEGORY}/${CATEGORY}_${NAME}.png" "$ICON_URL"
```

## §6. Step 4 — Update manifest.json

Append entry to `icons` array. Schema:

```json
{
  "path": "icons/agro/agro_tractor.png",
  "url_raw": "https://raw.githubusercontent.com/Nevsky-BI-user/icons-png-powerbi/main/icons/agro/agro_tractor.png",
  "url_cdn": "https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/agro/agro_tractor.png",
  "category": "agro",
  "name": "tractor",
  "tags": ["tractor", "farm machinery", "agriculture", "трактор", "трактор", "agro", "vehicle"],
  "source": "iconify:material-symbols",
  "source_icon_id": "material-symbols:agriculture",
  "style": "outlined",
  "size_px": 64,
  "color": "063e61",
  "license": "Apache-2.0",
  "attribution": null,
  "added": "2026-05-11"
}
```

**Tag generation**:
- Original icon name (split kebab/camel: `trend-up` → `trend up`)
- English synonyms (2-4)
- Ukrainian translation (always include)
- Russian translation
- Category name
- Industry-specific synonyms (e.g., for `kpi_target` add `goal`, `objective`, `okr`)

**License handling**:
- Permissive non-attribution (MIT, Apache-2.0, CC0, ISC) → `"attribution": null`
- Attribution-required (CC-BY, CC-BY-SA, Flaticon free, Icons8 free) → fill `"attribution": "Icon by {author} from {pack} via {source}"`
- Append unique attribution to `ATTRIBUTIONS.md` in repo root (deduplicate by `source_icon_id`)

### Manifest schema: description field

When adding new entries to manifest, **always include** a `description` string (5-15 words, Ukrainian) right after `tags`:

```json
"tags": [...],
"description": "Стрілка вгору — зростання, кар'єра, тренд",
```

If the icons are added/recolored for a specific named visual, append " · у візуалі: <site>": `"Стрілка вгору — зростання · у візуалі: KPI #2 \"Кар'єрний шлях\""`. The gallery and the Step 8 table both consume this field.

For pre-existing entries without `description`: derive a default from `name` + first 3 `tags` and add it on the next operation that touches that entry.

## §7. Step 5 — Atomic JSON update

```bash
ENTRY='{ "path": "icons/agro/agro_tractor.png", ... }'

jq --argjson entry "$ENTRY" \
   --arg date "$(date +%Y-%m-%d)" \
   '.icons += [$entry] | .updated = $date | .count = (.icons | length)' \
   manifest.json > manifest.tmp && mv manifest.tmp manifest.json

# Validate
jq empty manifest.json || { echo "manifest.json corrupt"; exit 1; }
```

## §8. Step 6 — Commit and push

```bash
git add icons/${CATEGORY}/${CATEGORY}_${NAME}.png manifest.json ATTRIBUTIONS.md 2>/dev/null
git add icons/ manifest.json
git commit -m "Add ${CATEGORY}/${NAME} from ${SOURCE}"
git push --quiet origin main
```

**For batch operations** (multiple icons in one request): collect all changes, ONE commit + push at the end.

## §9. Step 7 — Return result (and Delivery rules)

Output format:

```
Іконка знайдена/створена.

Шлях:     icons/agro/agro_tractor.png
Raw:      https://raw.githubusercontent.com/Nevsky-BI-user/icons-png-powerbi/main/icons/agro/agro_tractor.png
CDN:      https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/agro/agro_tractor.png
Джерело:  Iconify / material-symbols
Ліцензія: Apache-2.0 (без attribution)

DAX:
Icon Tractor = "https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/agro/agro_tractor.png"
```

Always remind user: set the measure's **Data Category → Image URL** in Power BI model view, then use it in a **Table / Matrix column**. A standalone `image` visual will NOT render this URL — see "Delivery" below.

Default to `url_cdn` (jsDelivr) in DAX — faster, not rate-limited. Use `url_raw` only for debugging.

### Delivery: URL is enough for a measure, NOT for a standalone `image` visual

The CDN/raw URL this skill returns renders **only** where Power BI fetches the URL itself — a **Table / Matrix column** whose measure has **Data Category = Image URL**. It does **NOT** render inside a standalone PBIR `image` visual (header logo, icon tile): Desktop shows an empty placeholder because it does not pull external URLs into an `image` visual (verified in Desktop 2.155, incident І-9).

For a standalone `image` visual the icon must be an **embedded report resource**, not a URL:

1. Copy the PNG into `<Report>.Report/StaticResources/RegisteredResources/<file>.png`.
2. Register it in `report.json` → `resourcePackages` as an item of type `Image` (package name `RegisteredResources`, PackageType `1`).
3. Reference it in the visual via `ResourcePackageItem` (not a URL string):

   ```json
   "imageUrl": { "expr": { "ResourcePackageItem": {
       "PackageName": "RegisteredResources", "PackageType": 1, "ItemName": "<file>.png" } } }
   ```

4. **Recolor for the target theme first.** The default `063e61` icon is near-invisible on a dark report background — repaint to a light token before embedding:

   ```bash
   magick in.png -channel RGB +level-colors "#cbd5e1","#cbd5e1" +channel out.png
   ```

Report.json editing mechanics (adding to `resourcePackages`, byte-faithful edits): use the `powerbi-visuals` skill.

## §10. Step 8 — Post-commit summary table (MANDATORY)

**Always** output a markdown table immediately after `git push` succeeds. The table lists **only** files changed in *this commit* — never re-list unchanged icons that already lived in the repo. The user needs this to manually pick icons in Power BI without re-reading the response.

**Get the changed-file list before building the table** — never reconstruct from memory:

```bash
git diff --name-status HEAD~1..HEAD -- 'icons/' manifest.json gallery.html
```

This emits lines like `A<TAB>icons/agro/agro_tractor.png` or `M<TAB>icons/kpi/kpi_trend_up.png`. Use these letters in the **Статус** column:
- `A` → `🆕 NEW` (file did not exist before this commit)
- `M` → `♻️ CHANGED` (file existed and was overwritten — recolor / re-fetch / restyle)
- `R` → `📛 RENAMED` (path changed; show `old → new` in the file column)
- `D` → `🗑️ DELETED` (file removed; CDN/local columns get `—`)

Filter out `manifest.json` and `gallery.html` rows — they are infrastructure, not user-facing icons. The table is **icons-only**.

Format:

```
**Commit `<short-sha>` pushed.** Змінено у цьому коміті:

| Статус | Категорія | Файл | Опис | Локально | CDN URL (для Power BI) |
|---|---|---|---|---|---|
| 🆕 NEW | agro | agro_tractor.png | Трактор — сільгосптехніка, агро · у візуалі: KPI «Агро» | `<local clone of icons-png-powerbi>icons\agro\agro_tractor.png` | `https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/agro/agro_tractor.png` |
| ♻️ CHANGED | kpi  | kpi_trend_up.png | Стрілка вгору — зростання · колір 3c3489 (KPI «Кар'єра») | `<local clone of icons-png-powerbi>icons\kpi\kpi_trend_up.png`  | `https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/kpi/kpi_trend_up.png` |
```

Rules:
- **Only rows with status A/M/R/D for paths under `icons/`** — never include unchanged icons. If the commit modified 3 icons out of 50 in repo, the table has exactly 3 rows.
- **If no icons changed** (e.g. commit only touches gallery.html or manifest schema), skip the table entirely and just say `Без змін в іконках цього коміту.` — don't show an empty table.
- **For CHANGED rows**, mention in the Опис column WHAT changed: color, style, source set, dimensions. Example: `♻️ CHANGED ... | колір 063e61 → 6b7b8e, source material-symbols → lucide`. This helps the user understand why something they were referencing might look different.
- **Опис** column: short Ukrainian phrase (5-12 words) — what the icon visually depicts + its primary semantic role. If added/recolored for a specific named visual, append ` · у візуалі: <use sites>`. Example: `Монети — гроші, винагорода · у візуалі: KPI «РЦД», Tooltip «Оклад»`.
- **Локально** column: full Windows path with backslashes
- **CDN URL** column: full jsDelivr URL with `@main`
- Sort rows by status (NEW first, then CHANGED, then RENAMED, then DELETED), then category, then name
- Heading wording: `**Commit \`<sha>\` pushed.** Змінено у цьому коміті:` for mixed; `**Commit \`<sha>\` pushed.** Додано:` if all NEW; `**Commit \`<sha>\` pushed.** Перезаписано:` if all CHANGED

After the table, append a one-liner reminder:
- `Power BI: Image URL Data Category на DAX-мірі. Або скопіюй PNG з локального шляху і вкинь у Image visual.`

If any CDN URL is known to be stale immediately after push (jsDelivr propagation delay), also append:
- `⚠️ CDN може віддавати старе ~5-10 хв. Для негайної свіжості заміни @main на @<sha>.`

## §11. Step 9 — Regenerate gallery.html (MANDATORY after Step 8)

The repo has `gallery.html` at root — a self-contained HTML viewer showing every icon with preview, category, description, color, and a click-to-copy CDN URL button. **Always regenerate it after any add/recolor/rename/delete operation** so it reflects current manifest state.

Procedure:
1. Read `manifest.json`
2. For each entry, emit a card with: `<img src="{url_cdn}">`, category badge, name, color dot (using `color` field), description text (use `description` field if present, else fall back to comma-joined `tags`), `source_icon_id`
3. Sort cards by category, then name
4. Embed all data inline in a `<script>const DATA=[...]</script>` block — no external dependencies
5. **Preserve** the auto-refresh JS block at the end (`__initialFingerprint` / `__selfHash` / `setInterval` 3000ms) — this is what makes an already-open gallery auto-reload when the file changes. Without it, the user has to manually F5.
6. Include the existing search/filter and copy-to-clipboard JS (see prior `gallery.html` for reference template)
7. Write to `<local clone of icons-png-powerbi>gallery.html` (overwrite)
8. `git add gallery.html` — include in the same commit as the icons (DON'T make a separate commit just for the gallery — one logical operation = one commit)

**After `git push` completes, open ONLY the changed icons — do NOT open the full gallery automatically.** The user uses the gallery on their own time to browse the whole set; after a commit they want fast visual confirmation of what just changed.

Get the list of changed icon files (same `git diff --name-status` already used for the Step 8 table) and open each one:

```powershell
$changed = git diff --name-status HEAD~1..HEAD -- 'icons/' | ForEach-Object { ($_ -split "`t")[1] }
$changed | ForEach-Object {
  Start-Process "<local clone of icons-png-powerbi>$($_ -replace '/','\')"
}
```

Each PNG opens in the default image viewer (Windows Photos / browser tab). User instantly sees what was just produced without searching the gallery.

**ALWAYS regenerate `gallery.md` at repo root** with the latest commit's icon changes — this is a permanent file (committed to repo) that GitHub renders directly. It always contains *only* the most recent icon-changing commit's diff. The user (and anyone else viewing the repo on GitHub) can see at a glance what just changed.

`gallery.md` schema:

```markdown
# Last changes

**Commit [`<sha>`](https://github.com/Nevsky-BI-user/icons-png-powerbi/commit/<sha>)** — <commit subject>

| Статус | Категорія | Файл | Прев'ю | Опис | Локально | CDN URL |
|---|---|---|---|---|---|---|
| 🆕 NEW | <cat> | <file>.png | ![<name>](icons/<cat>/<file>.png) | <desc + use-site> | `C:\...\<file>.png` | https://cdn.jsdelivr.net/gh/.../<file>.png |
... (one row per icon in this commit; same status/sort rules as Step 8) ...

---

> Цей файл містить **тільки** іконки, що змінились/додались в останньому коміті, де було торкнуто `icons/`. Регенерується автоматично при кожному push з icon-змінами.
> Для повного перегляду всіх іконок — відкрий [`gallery.html`](gallery.html) локально (`<local clone of icons-png-powerbi>gallery.html`).
```

The `![…](icons/…/…)` markdown image syntax uses repo-relative paths — GitHub renders the actual PNG inline in the table cell.

`gallery.md` is committed in the same commit as the icon changes (same logical operation). If a commit has no icon changes (only manifest/gallery infrastructure), do NOT touch `gallery.md` — leave it showing the last meaningful icon commit.

**For local quick-look after push** (≤5 changed icons): also open each changed PNG via `Start-Process <full path>` — system image viewer pops up. For >5 icons: skip the multi-window approach and rely on `gallery.md` (open via `Start-Process "<local clone of icons-png-powerbi>gallery.md"` which opens default markdown viewer, or just navigate to the GitHub URL).

The full `gallery.html` is still regenerated and pushed (Step 9) so the user's already-open gallery tab auto-refreshes within 3s. But the **primary** post-commit deliverables are: chat table (Step 8) + `gallery.md` (permanent on-repo changelog) + opening just the changed PNGs.

Do NOT use `taskkill` / `Stop-Process` on browser processes — that closes ALL the user's browser tabs, not just the gallery.

In the Step 8 table heading, mention the gallery:
- `📂 Повний перегляд: gallery.html (вже відкритий — авторефрешиться через 3с)`

The gallery template lives at `gallery.html` in the repo — read it first to preserve the styling/JS structure, then only swap the `DATA` array contents. The auto-refresh block lives between the comment `// ── Auto-refresh:` and `</script>` — keep it verbatim.

## §12. Modes: Search-Only, Create-Only, Batch

### Search-Only Mode

User says "тільки пошук" / "не створюй" / "search only" — execute Steps 1-2, skip Step 3 if no match. Return: "В репо нема. Хочете створити з зовнішніх джерел?"

### Create-Only Mode

User says "створи новий" / "force new" / "не шукай в репо" — skip Step 2, go straight to Step 3. Useful when:
- Stored icon is in wrong style/color and user wants alternative
- User wants duplicate with different name

Append `_v2` / `_alt` / user-supplied suffix to filename to avoid collision.

### Batch Mode

User requests multiple icons (e.g., "створи 6 іконок для hr"):

1. Resolve full list of icon names (explicit list OR category seed names)
2. Show proposed list, wait for confirmation IF count > 5
3. For each icon: Steps 1-5 (with `git push` deferred)
4. ONE commit + push at end: `Add hr icons: employee, hiring, training, onboarding, performance, leave (6)`
5. After push: output the Step 8 summary table (MANDATORY) — one row per file in this commit. Do NOT output a separate block per icon — the table replaces all per-icon detail.

## §13. Error Handling

| Symptom | Cause | Resolution |
|---|---|---|
| `curl` returns HTML 404 instead of PNG | Icon name not in Iconify set | Fall through to next set in chain automatically |
| `rsvg-convert: command not found` | `librsvg2-bin` not installed | `sudo apt install librsvg2-bin` or `brew install librsvg` |
| `jq: command not found` | `jq` not installed | `sudo apt install jq` or `brew install jq` |
| `git push` rejected (non-fast-forward) | Remote ahead of local | `git pull --rebase origin main`, retry |
| `git push` auth failure | `gh auth` token expired | `gh auth refresh` |
| Iconify search returns nothing | Term too specific | Broaden with synonyms; try SVG Repo |
| SVG Repo returns nothing | Term not indexed | Try Flaticon/Icons8 if keys configured |
| All sources return nothing | Concept too niche | Present user with 3-5 closest matches from Iconify search |
| Duplicate name in manifest | Same `path` already exists | Skip fetch, return existing; if override → ask for `_v2` suffix |
| `manifest.json` parse error | Malformed from interrupted write | `git show HEAD:manifest.json > manifest.json` |
| jsDelivr 404 immediately after push | Cache not yet updated | Wait 5-10 minutes; use `url_raw` meanwhile |
| Recolor didn't apply (SVG Repo) | Multi-color SVG, has multiple fills | Skip recolor, use original colors; warn user |

## §14. DAX Generation Patterns

### Single icon constant

```dax
Icon Tractor = "https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/agro/agro_tractor.png"
```

### Dynamic switch by dimension

```dax
Icon URL =
SWITCH(
    SELECTEDVALUE(DimCategory[Category]),
    "Sales",     "https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/sales/sales_pipeline.png",
    "HR",        "https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/hr/hr_employee.png",
    "Agro",      "https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/agro/agro_tractor.png",
    "Finance",   "https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/finance/finance_money.png",
    BLANK()
)
```

### Conditional KPI icon

```dax
Trend Icon =
VAR _yoy = [Sales YoY %]
RETURN
SWITCH(
    TRUE(),
    _yoy >= 0.05,  "https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/kpi/kpi_trend_up.png",
    _yoy <= -0.05, "https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/kpi/kpi_trend_down.png",
                   "https://cdn.jsdelivr.net/gh/Nevsky-BI-user/icons-png-powerbi@main/icons/kpi/kpi_neutral.png"
)
```

Always remind: set **Data Category → Image URL** on the measure in model view.

## §15. Performance and Scale

Soft limit triggers (skill warns user when approaching):

- **Category folder >800 files** → suggest subcategories (e.g., `agro/livestock/`, `agro/machinery/`)
- **Total icons in manifest >5,000** → suggest sharding manifest by category
- **Manifest file size >2 MB** → same suggestion
- **Commits in last hour >100** → batch more aggressively

GitHub absolute limits (will be enforced):
- Single file: 100 MiB (PNG icons ≈5-10 KB, irrelevant)
- Repo size recommended: 1 GB (≈500,000 icons at 2 KB avg)
- Repo soft cap: 5 GB
- Directory width: 3,000 entries
- Push rate: 6/min recommended
