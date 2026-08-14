# SEO Dashboard UX Improvement Plan (poc/seo-dashboard only)

> Reviewed 2026-08-14 against the actual code on branch `main` (merge `070cc80` includes the
> redesigned What to Fix. module). Every claim below cites the file it came from. Scope is
> **poc/seo-dashboard only** — nothing in seo-crawler-poc is proposed here (the crawler's CLIs
> are only mentioned where the dashboard already spawns them).
>
> Goal: users reach every important function in the fewest clicks, without breaking what the app
> already does well (URL-state filters, `?run=` carried across nav, honest empty states).

---

## 1. Inventory (verified against the code)

**Routes (`app/*/page.tsx`):** `/` Overview · `/runs` · `/queue` · `/issues` (What to Fix.) ·
`/failures` · `/sitemap` · `/pages` · `/pages/[id]` · `/pages/[id]/preview` · `/measurements` ·
`/links` · `/images` · `/redirects` · `/compare` · `/activity` · `/new-crawl` · `/login` `/signup`.

**Shell (`components/shell/`):** `nav-config.ts` (4 grouped sections, 12 nav items),
`app-shell.tsx` (expanded sidebar / collapsed icon rail / mobile icon rail + slide-over; forwards
`?run=`), `topbar.tsx` (title + global `RunSelector`), `sidebar.tsx` (collapsible sections,
`SearchInput`, New Crawl button), `search-input.tsx` (pages-only search, `/` shortcut).

**Run model:** `lib/run-selection.ts` `pickDefaultRun` (newest run with ≥2 pages) + `lib/data.ts`
`resolveRunId` (valid `?run=` wins, else default). Run selector hidden on `/new-crawl`, `/runs`,
`/compare`, `/queue` (`nav-config.ts` `showRunSelectorFor`).

**API routes (`app/api/`, 45 route.ts):** crawls CRUD + progress/events/cancel/rerun/**reanalyze**,
pages, issues (+`/[ruleId]`, `instances`), links, redirects, sitemaps, site-files, measurements,
fix-plan, rules-run, exports, queue, mutes, comparisons, raw/replay/screenshot, artifacts, ready,
version, health. **Post-crawl auto-analyze exists** (`lib/crawl-runner.ts` `spawnAnalyze` runs
`analysis/cli.ts` → issues.json), and a **reanalyze endpoint exists** (`POST /crawls/:id/reanalyze`).

---

## 2. Click-count analysis of the core journeys

| Journey | Today's path | Clicks | Code evidence |
|---|---|---|---|
| Crawl a site → see findings | New Crawl → form → Start → done → "Explore Pages" → nav to Issues | 5–6 | `ProgressPanel.tsx` done-state offers only Pages/Dashboard |
| Analyze a CLI-crawled run | *Leave the app*, `npm run analyze …`, reload | terminal + reload | `issues/page.tsx` empty state shows a code block; `POST /crawls/:id/reanalyze` exists but no UI calls it |
| Runs list → a run's issues | Runs → click row (→ Overview) → scroll → health card → Issues | 3 | `runs/page.tsx` every cell links only to `/?run=` |
| Land on an unanalyzed run | (implicit — newest wins) | stuck | `run-selector.tsx` shows hostname/time/coverage only, no analysis state |
| Investigate one finding | Issues → expand row → click page | 3 | `finding-row.tsx` PAGES list links to detail |
| See all pages for one rule | (not possible) | — | no rule-level drill-down link anywhere; `issues/[ruleId]` + `instances` API routes are unused by UI |
| Compare vs previous crawl | Sidebar Compare → defaults to 2 latest | 2 | `compare/page.tsx`; no one-click shortcut from Overview/Issues |
| Jump to a specific page/rule | `/` → sidebar search (pages only) → Pages filter | 2–3 | `search-input.tsx` always goes to `/pages?q=` |
| Step between findings | scroll, re-expand each row | many | no j/k keyboard stepping in `issues-client.tsx` |

---

## 3. Findings

### P0 — dead ends and the biggest click counts

**3.1 No in-app Analyze button (the top dead end).** `issues/page.tsx` and the fix-plan empty
state (`issues-client.tsx` "Fix plan not generated for this run yet — run `npm run fixplan`…")
tell the user to use a terminal. Yet the plumbing exists: `POST /crawls/:id/reanalyze`
(`app/api/crawls/[runId]/reanalyze/route.ts`) and awaited `reanalyzeAndWait` (`lib/mutes.ts`) both
spawn the analyzer. Add an **Analyze now** button that calls the endpoint and then `router.refresh()`
in three places: the issues empty state, the run selector dropdown (per-run), and the new-crawl
done panel. Also chain the automation + fixplan generators (`analyze:automation`, `fixplan` CLIs —
currently only `analysis/cli.ts` runs post-crawl) so a fresh analyze produces automation badges and
a real fix plan, not "Not classified"/"not generated".

**3.2 Run selector gives no analysis signal.** `run-selector.tsx` shows hostname · time ·
coverage · pages. Add a per-run **health + analyzed** indicator (checked and unchecked). Prevents
the recurring "why does this show 'This run hasn't been analyzed'?" and lets users pick the analyzed
run in one click instead of discovering the dead end after navigating.

**3.3 Runs table links only to Overview.** `runs/page.tsx` wraps every cell in
`/?run=${runId}`. Add per-row quick links — **Issues · Failures · Pages · Compare vs previous** —
so a run's findings are 1 click, not 3. Also: the Runs page ignores `?run=` entirely, yet
`queue-client.tsx` links jobs to `/runs?run=…` — that link is a silent no-op; either honor the param
(highlight the row) or point queue links at `/?run=`.

### P1 — navigation & cross-linking

**3.4 No command palette; search is pages-only.** `search-input.tsx` routes everything to
`/pages?q=`. Build a **Cmd/Ctrl+K palette** searching pages, rules, runs, measurements — jump
straight to a page detail, a rule-filtered Issues view, a run, or a measurement. Reuses
`filterAndSortRows`, `buildExplorerRows`, and the run list already loaded by the layout. Extend the
sidebar search to findings/rules and run IDs.

**3.5 Rule-level drill-down doesn't exist.** Findings are per-rule rows, but nothing links to
"all pages with this rule". The API already has `/crawls/:id/issues/[ruleId]` and
`/issues/instances`. Add: a `?rule=` param on `/issues` (filter `filterIssues` by ruleId), a link
from `finding-row.tsx`'s rule header ("N pages → view all"), and a back-link from `page-issues-panel.tsx`
to the global rule view.

**3.6 No "compare vs previous" shortcut.** `buildKpiStrip` is computed on Overview
(`app/page.tsx:79`) but the `KpiStripView` is commented out (`app/page.tsx:91`). Restore a compact
strip with delta pills and make each tile + a "vs previous" link jump to
`/compare?base=<prev>&head=<current>`. Same one-click affordance on the Issues header.

**3.7 New-crawl done state has no "View issues".** `ProgressPanel.tsx` done-state shows only
"Explore Pages" + "Dashboard Overview". Add **"Analyze & view issues"** (calls 3.1, then
`/issues?run=`). This is where analysis friction bites hardest — the user is already watching the
run finish.

**3.8 Failures and Sitemap don't cross-link back.** `failures/page.tsx`'s "Blocked by robots.txt"
section and robots evidence have no link to `/sitemap` (which shows the AI-crawler verdicts); the
sitemap page's robots/sitemap panels don't link to `/failures`. These are the same topic seen from
two angles — one hop each.

**3.9 Overview work-queue issue badges aren't clickable.** `work-queue-table.tsx` renders issue
badges (5xx, redirect-loop, noindex…) as static text; the row links to page evidence. Make each
badge a link to `/issues?q=<issueLabel>` (the Issues search already matches labels) or a severity
filter.

### P2 — polish & consistency

**3.10 Keyboard stepping in Issues.** `finding-row.tsx` rows are `<details>`-style cards; add
j/k (or ↑/↓) + Enter navigation across `areaGroups`/`priorityRanked`, mirroring the Prev/Next
already on page detail (`breadcrumb-nav.tsx`).

**3.11 Dead `category` URL param.** `issues-client.tsx:107` reads `category` from the URL but no
control writes it (only `clearAll` removes it). Either surface a Category dropdown in the toolbar
(data: `g.category` per group) or drop the param — right now it's a latent filter nobody can set.

**3.12 Actionable empty states.** Replace CLI code blocks with buttons where an API exists:
`issues/page.tsx` (Analyze), `issues-client.tsx` fix-plan empty state (Analyze/Generate), and the
`worstPages` "predates the priority engine — reanalyze" message (Reanalyze). Keep the honesty,
add the action.

**3.13 Breadcrumbs on main data pages.** Page detail has one (`breadcrumb-nav.tsx`); Issues,
Pages, Measurements rely on sidebar highlight. A slim site→run→page breadcrumb on those pages adds
one-click upward hops and "where am I".

**3.14 Mobile pass.** Verify Issues toolbar (dropdowns, segmented pills, search), the AREAS rail
(already `hidden md:flex`), and Measurements grid wrap cleanly below 640px; confirm
`group-nav.tsx` / `issues-toolbar.tsx` don't overflow.

---

## 4. Step-by-step implementation order

> **Status 2026-08-14:** Steps 1–8 are implemented and verified live on branch `kishan` (tsc,
> eslint, 18/18 tests, `next build`, and preview checks for every feature).

**Step 1 — Analyze now (3.1).**
- Add a small client `AnalyzeNowButton` that `POST /api/crawls/<id>/reanalyze`, polls
  `GET /api/crawls/<id>` until issues.json exists (or reuses the awaited `reanalyzeAndWait` via a
  server action), then `router.refresh()`.
- Place in: `issues/page.tsx` empty state, `run-selector.tsx` per-run menu, `ProgressPanel.tsx`
  done state.
- Chain automation + fixplan generation into the same action (spawn the two CLIs after analysis
  completes — mirrors `crawl-runner.ts`'s `spawnAnalyze` discipline).

**Step 2 — Run-selector analysis badges (3.2).**
- Extend `RunListItem` with `analyzed`/`healthScore` (computed once in `listRuns` via
  `readAnalysisReport` — cheap, additive) and render dots in `run-selector.tsx`.

**Step 3 — Runs table hub (3.3).**
- Rewrite `runs/page.tsx` rows: keep the overview link, add 4 icon quick-links; honor `?run=` for
  highlight; point `queue-client.tsx` job links at `/?run=`.

**Step 4 — Command palette (3.4).**
- New `components/shell/command-palette.tsx` (Cmd/Ctrl+K, `/` fallback), server-fed index of
  pages/rules/runs/measurements, `?run=` forwarded on every jump. Wire into `app-shell.tsx`.

**Step 5 — Rule drill-down (3.5).**
- Add `?rule=` to `issues-client.tsx`; link from `finding-row.tsx` rule header; back-link from
  `page-issues-panel.tsx`.

**Step 6 — Compare shortcuts + KpiStrip (3.6).**
- Un-comment/adapt `KpiStripView` on Overview with delta pills; add "vs previous" links on
  Overview and Issues.

**Step 7 — New-crawl done → issues (3.7) and cross-links (3.8, 3.9).**
- One button + two small Link additions (failures↔sitemap, work-queue badges → issues).

**Step 8 — P2 batch (3.10–3.14):** keyboard stepping, category dropdown or param cleanup,
actionable empty states, breadcrumbs, mobile pass.

---

## 5. What to preserve (do not break)

- `?run=` forwarding in `app-shell.tsx` / `sidebar.tsx` and `resolveRunId` fallback — the app's
  best click-reducer; every new palette/link must forward it.
- URL-state filters (pages explorer, issues view/severity/show, compare pair, links/images/redirects)
  — shareable and back-button-safe.
- Page-detail Prev/Next inside the **filtered** set, sticky `SectionNav`, slide-over drilldowns that
  keep the list context (`measurements`, `links` sources).
- Honest degraded states ("not analyzed", "Not classified", "no page match", "predates the priority
  engine") — the fix is adding actions (3.12), never fabricating data.
- Post-crawl auto-analyze (`crawl-runner.ts` `spawnAnalyze`) — keep, extend it with automation +
  fixplan rather than replacing it.
