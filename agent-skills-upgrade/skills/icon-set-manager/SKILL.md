---
name: icon-set-manager
description: Use whenever the user asks to create, search, find, list, or manage PNG icons for Power BI reports stored in a GitHub icon library. Unified find-or-fetch flow - if the requested icon exists in manifest.json, return raw URL and DAX snippet; if not, fetch from external sources (Iconify aggregator with 200+ sets, SVG Repo), commit to GitHub, return URL. Trigger on - 'іконка', 'icon', 'набір іконок', 'знайди іконку', 'намалюй іконку', 'find icon', 'create icons', 'PNG для звіту', 'Power BI icon', 'додай іконки', 'потрібні іконки', 'icon library'. Owns every request whose deliverable is a PNG icon asset or its URL, including SWITCH-based icon URL measures. Do NOT trigger for - DAX measure logic (use dax-measures), SVG drawn in DAX inside table cells (use dax-svg), Deneb specs (use deneb-vegalite). Defaults (transparent PNG, brand color, 64/128px, snake_case naming, permissive licenses) → reference.md §1.
---

# Icon Set Manager

Unified workflow for Power BI icon library: searches existing icons by semantic query, fetches missing icons from free sources, stores everything in one GitHub repository organized by category.

Repo `Nevsky-BI-user/icons-png-powerbi` @ `main`, local clone `<local clone of icons-png-powerbi>`, `manifest.json` at repo root. Full configuration, URL patterns, optional API keys → reference.md §1.

## When to Use / NOT for

- Any request to create, search, find, list, or manage PNG icons for Power BI reports. Primary entry point. Activates on any icon-related query.
- 20 fixed categories (navigation, actions, kpi, status, … sales) → reference.md §2; category not on the list → ask for confirmation before creating a new folder.
- NOT for: DAX measures → `dax-measures`; SVG measures → `dax-svg`; Deneb specs → `deneb-vegalite`; report.json editing mechanics (`resourcePackages`, byte-faithful edits) → `powerbi-visuals`.

## Unified Workflow: Find or Fetch

1. **Parse query** — intent (lookup / create / ambiguous), category, concept, style/color/size overrides → reference.md §3
2. **Search manifest first** — `git pull`, semantic match, HIGH/MEDIUM/ZERO confidence decision matrix → reference.md §4
3. **Fetch external** (only if ZERO or user confirms) — chain: Iconify direct → Iconify search → SVG Repo → Flaticon → Icons8 → manual pick; %23 color-encoding and alpha checks → reference.md §5
4. **Update manifest.json** — entry schema, tag generation (укр/рос/synonyms), `description` field, license/attribution → reference.md §6
5. **Atomic JSON update** with jq + validation → reference.md §7
6. **Commit and push** — one logical operation = one commit; batch = ONE commit at end → reference.md §8
7. **Return result** — path, Raw, CDN, license, DAX snippet; delivery rules → reference.md §9; DAX patterns → §14
8. **Post-commit summary table — MANDATORY** after every push; only files changed in this commit → reference.md §10
9. **Regenerate gallery.html + gallery.md — MANDATORY**; open only the changed PNGs, never the full gallery → reference.md §11

Modes (Search-Only, Create-Only, Batch) → reference.md §12 · Error handling table → §13 · Performance and scale limits → §15.

## Defaults

| Parameter | Default | Override trigger |
|---|---|---|
| Color | `063e61` | "колір X", "color X", "білий", "чорний", "червоний", brand-color names |
| Size | `64px` | "128", "256", "великий", "hero", "header", "заголовок", "banner" |
| Background | transparent | (never overridden, always transparent) |
| Style family | `material-symbols` (use `-outline` icon-name suffix for outlined style) | "lucide", "mdi", "tabler", "phosphor", "game", "carbon", "fluent", "heroicons" |
| Naming | `{category}_{name}` snake_case ASCII | (fixed convention) |
| License preference | permissive (MIT, Apache 2.0, CC0, CC-BY-SA, ISC) | "будь-яка ліцензія", "any license" |

Hero/header sizing: if user requests size ≥128 OR query contains hero-marker words, fetch 128px.

## Delivery imperatives

- The returned URL renders **only** in a Table/Matrix column whose measure has **Data Category = Image URL** — always remind the user to set it in model view.
- A standalone PBIR `image` visual will NOT render a CDN/raw URL (empty placeholder, Desktop 2.155, incident І-9) — embed as report resource via `RegisteredResources` + `ResourcePackageItem`, recolored for the theme → reference.md §9.
- Default to `url_cdn` (jsDelivr) in DAX — faster, not rate-limited. Use `url_raw` only for debugging.

## Common Mistakes

| Mistake | Why it fails | Fix |
|---|---|---|
| Delivering only a CDN/raw URL for a header logo or icon tile | A standalone PBIR `image` visual does not fetch external URLs — Desktop renders an empty placeholder (2.155, incident І-9) | Embed via `RegisteredResources` + `ResourcePackageItem` (Step 7 → "Delivery"). URL delivery is valid **only** for a Table/Matrix Image-URL measure. |
| Embedding the default `063e61` icon on a dark report | Dark icon on a dark background is near-invisible | Recolor to a light token before embedding: `magick in.png -channel RGB +level-colors "#cbd5e1","#cbd5e1" +channel out.png` |

"Delivery" embedding recipe = reference.md §9.

## Output Discipline

- Never fabricate icon names — always search source APIs first
- For batch >5: present proposed list, wait for confirmation
- Always output `url_cdn` in DAX snippets (faster than raw)
- Preserve manifest entry order — append only, never reorder
- Never overwrite existing PNG without explicit user request (use `_v2`)
- Always validate file is PNG (use `file` command) before committing
- Always commit + push atomically — one logical operation = one commit
- For attribution-required sources, ALWAYS update `ATTRIBUTIONS.md` and `manifest.attribution` field
- **After every successful `git push`, ALWAYS output the Step 8 summary table** — but include ONLY files changed in this commit (use `git diff --name-status HEAD~1..HEAD -- icons/` to get the list with A/M/R/D status). Never re-list unchanged icons from the repo. If only manifest/gallery changed, output `Без змін в іконках цього коміту.` instead of a table.
- **After the table, open ONLY the changed PNGs (or `_changes.html` for >5 icons) — never auto-open the full gallery.html.** The user uses gallery.html on their own time; post-commit they want to see what just changed, not the whole library.

## Verification After Each Operation

```bash
# 1. File is valid PNG
file icons/${CATEGORY}/${CATEGORY}_${NAME}.png
# Expected: PNG image data, 64 x 64, 8-bit/color RGBA

# 2. Manifest valid JSON
jq empty manifest.json

# 3. Entry exists in manifest
jq -r --arg path "icons/${CATEGORY}/${CATEGORY}_${NAME}.png" \
   '.icons[] | select(.path == $path) | .name' manifest.json

# 4. Commit pushed
git log origin/main..HEAD  # should be empty

# 5. Raw URL responds 200 (test 30s after push)
curl -sI "https://raw.githubusercontent.com/Nevsky-BI-user/icons-png-powerbi/main/icons/${CATEGORY}/${CATEGORY}_${NAME}.png" | head -1
```
