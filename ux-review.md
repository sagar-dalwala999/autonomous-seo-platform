# UX Improvement Plan — SEO Dashboard (poc/seo-dashboard)

> Review generated 2026-08-14 against the current repo state (branch `main`; the earlier
> conversation's work — Sitemap & Robots merge, What to Fix. rebuild, cursor/pointer fixes —
> lives on branch `kishan` and is **not** in this checkout). Grounded in a read of every
> `app/*/page.tsx`, the shell components, and the cross-page link graph.
>
> Goal: **fewest clicks to every important function**, without breaking the URL-state,
> run-carries-across-navigation, and honest-empty-state behaviors the app already does well.

---

## 1. What the app has today (flow map)

**Navigation chrome**
- Sidebar with 4 groups: *Start here* (Overview, Runs, Crawl queue), *Findings* (What to Fix.,
  Failures & Blocked, Sitemap & Robots), *Explore pages* (Pages, All Measurements, Links, Images,
  Redirects), *Compare & history* (Compare, Activity). New-Crawl primary button + page search.
- Topbar: title + **global Run selector** (persists `?run=` across all nav), per-page actions.
- `?run=` is forwarded by sidebar, mobile rail, and icon links; every destination falls back to the
  latest run. Pages/Issues/etc. all resolve the run server-side via `resolveRunId`.

**Pages (17 routes)** — overview, runs, queue, issues (What to Fix.), failures, sitemap, pages,
pages/[id], pages/[id]/preview, measurements, links, images, redirects, compare, activity,
new-crawl, login/signup.

**Existing cross-links (good coverage already)**
- Overview: filter chips → `/pages?status=…`; action cards → failures / sitemap / issues;
  measurements grid → slide-over drilldown → page detail; "Pages that need you" work queue → page detail.
- Failures, sitemap, compare, links, images, measurements, activity all link URL/page rows → page detail.
- Page detail: breadcrumb (Pages → section → URL), Prev/Next **within the same filtered set**,
  sticky section nav, per-page issues panel with evidence → related sections/pages.
- Issues: KPI tiles filter the list; finding rows expand to FOUND/WHY/FIX/PAGES with page-detail links.

---

## 2. Click-count analysis of the core journeys

| Journey | Today's path | Clicks | Problem |
|---|---|---|---|
| New site → see what's wrong | New Crawl → run → done → "View dashboard" → scroll → health action card | 5–6 | Analysis is **CLI-only**; if the newest run isn't analyzed, /issues is a dead end |
| Analyze a run | *Leave the app*, run `npm run analyze`, `analyze:automation`, `fixplan` in a terminal, reload | 1 terminal session + reload | The app never exposes "Analyze now"; the biggest single barrier |
| Runs table → a run's issues | Runs → click run (→ Overview) → scroll → health card → Issues | 3 | Runs rows only link to Overview; no per-run shortcuts |
| Landing on an unanalyzed run | (implicit — newest run wins) | 0 (you're already stuck) | Run selector gives no "analyzed / health" signal, so you don't know you'll hit a dead end |
| Investigate one finding | Issues → expand row → click page → detail | 3 | Good; could be 2 with a jump-to-page affordance on the row |
| Compare current run vs previous | Sidebar Compare → (defaults to 2 latest) | 2 | Fine, but no "compare vs previous" shortcut from Overview/Issues |
| Jump to a specific page/rule | Sidebar search (pages only) → Pages → filter | 2–3 | Search scope is pages-only; no global jump (Cmd+K) |
| Step between findings | Issues → scroll, re-expand | many | No j/k or arrow-key navigation in the findings list |

---

## 3. Findings (ordered by leverage)

### P0 — the highest-leverage fixes

**3.1 In-app "Analyze now" (kills the biggest dead end).**
Today `npm run analyze` + `analyze:automation` + `fixplan` are all CLI-only. The app *already has*
server-side re-analysis (`/api/crawls/[runId]/reanalyze`, `reanalyzeAndWait` used by mute/unmute)
— it's just never surfaced as a user action. Add an **Analyze button** that chains reanalyze →
automation → fixplan, exposed in:
- the `/issues` "This run hasn't been analyzed" empty state (replace the code block with a button),
- the new-crawl "done" panel (after crawl completes, offer "Analyze & view issues"),
- the Run selector dropdown (per-run "Analyze" for unanalyzed runs).
Removes the terminal round-trip and the "hasn't been analyzed" dead end entirely.

**3.2 Run selector signals analysis state.**
The RunSelector dropdown shows hostname · time · coverage · pages, but nothing about analysis. Add
a per-run **health + "not analyzed" indicator** (both in the trigger chip and the list). This
directly prevents the recurring "why does this show 'This run hasn't been analyzed'?" confusion.

**3.3 Runs table: per-run quick links.**
Every Runs row links only to Overview. Add a compact action set per row — **Overview / Issues /
Pages / Failures / Compare with previous** — turning the Runs table into a real hub (3 clicks → 1).

### P1 — navigation & cross-linking

**3.4 Global command palette (Cmd/Ctrl+K).**
The app already has page search + the `/` shortcut. Build a palette that searches **pages, rules,
runs, and measurements** and jumps straight to them (or to a rule-filtered issues view). Single
keypress replaces 2–3 clicks for every power-user journey.

**3.5 Extend search scope.** Sidebar search is pages-only. Let it also match findings/rules
(→ `/issues?q=…`) and run IDs (→ `/runs`/Overview).

**3.6 "Compare with previous run" shortcuts.**
On Overview action cards and the Issues header, add a "vs previous" delta affordance
(`/compare?base=<prev>&head=<current>`). The KpiStrip (already computed by `buildKpiStrip`, currently
commented out) is the natural home — restore a compact version with the compare link.

**3.7 New-crawl done state.** The done panel offers "View run" (Pages) and "View dashboard". Add
"View issues" (auto-analyze first). This is the seam where analysis friction currently bites most.

**3.8 Finding rows: one-click page jump.** The expanded FOUND/WHY/FIX body lists pages; make the
top page of a finding reachable from the collapsed row (e.g. the page count becomes a link) and add
j/k + Enter keyboard stepping through findings (Expanded/Prev-Next already exist on page detail).

### P2 — polish & consistency

**3.9 Overview "Pages that need you" → Issues link.** The work queue's issue badges (e.g.
"5xx", "noindex") could deep-link to the rule in /issues rather than only row-level page evidence.

**3.10 Breadcrumbs on more pages.** Page detail has a breadcrumb; Issues/Pages/Measurements rely on
sidebar highlight. A slim breadcrumb (site → run → page) on the main data pages would shorten
"where am I" and add one-click hops.

**3.11 Honest-but-actionable empty states.** Several empty states show a `npm run …` code block.
Keep the honesty, add the action: an Analyze button (3.1), or a "Start crawl" link where none exists.

**3.12 Mobile pass.** Icon rail + slide-over already works; verify the Issues toolbar (dropdowns,
pills) and Measurements grid wrap cleanly at <640px, and that Prev/Next on page detail remain
reachable.

---

## 4. What NOT to change (keep the good)

- `?run=` carried across every nav link — the app's best "fewest clicks" feature; protect it in any
  new palette/link work.
- URL-state filters everywhere (pages explorer, issues view/severity/show, compare pair) — shareable
  and back-button-safe.
- Page-detail Prev/Next inside the *filtered* set, sticky section nav, slide-over drilldowns that
  don't lose the list context.
- Honest degraded states (not analyzed / not classified / "no page match") — these earned trust;
  the fix is to add *actions*, not to fake data.

---

## 5. Suggested implementation order

1. **3.1 Analyze now** (API route chain + issues empty-state button + new-crawl done action) —
   highest value, touches the reanalyze plumbing that already exists.
2. **3.2 Run-selector analysis badges** — small, directly kills the recurring confusion.
3. **3.3 Runs quick links** — pure server page, fast, big click reduction.
4. **3.4 Command palette** — one new client component + search index, reuses existing data libs.
5. **3.6 + 3.7 Compare shortcut & done-state** — small per-page additions.
6. Remaining P1/P2 as time allows.
