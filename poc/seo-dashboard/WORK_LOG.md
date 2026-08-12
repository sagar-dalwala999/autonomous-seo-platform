# S13 work log — explorer + page-detail excellence

- Read design-dna-v2.md Laws 1-5 + design-dna.md v1 tokens + all owned/adjacent source files.
- lib/types.ts: added VideoKind/VideoRecord (matched S12's landed shape, incl. mimeType) +
  optional `page.videos` field (undefined-safe for pre-S12 runs).
- lib/explorer-shared.ts: sectionOf, SortKey, ExplorerFilterParams, filterAndSortRows (pure,
  shared by the client explorer AND the server detail page's prev/next), SectionGroup,
  groupBySection — re-exported via lib/data-explorer.ts.
- Law 1: pages-explorer-client.tsx rewritten on useSearchParams/useRouter as the single source of
  truth (run/q/status/rendered/depth/sort/dir/group/section all URL-synced — answers S14's flagged
  "sort=/dir= not honored" note above, now fixed). Every detail link carries the active filter
  query so Prev/Next on the detail page walks the same filtered+sorted set the list showed.
- Law 1: breadcrumb-nav.tsx (Pages > section > path) + Prev/Next; CrawlPanel links the "sitemap"
  discoverySources chip -> /sitemap, parentUrl -> parent's detail.
- Law 2: section-nav.tsx — sticky, scroll-spied (IntersectionObserver) jump nav for the 10 detail
  sections. pages-explorer-client.tsx "Group by section" — collapsible groups, counts + status-mix
  badges, keyboard-operable (native buttons, verified Enter toggles).
- Law 3: image-thumb.tsx (56px thumb, open-full-in-new-tab, broken-image fallback icon) in
  ImagesPanel. media-panel.tsx (new "Media" section) — file/youtube/vimeo/iframe kinds, "not
  captured in this run" vs "no videos" empty states.
- Law 4: json-tree.tsx (collapsible key tree) + structured-data-block.tsx (@type badge, parseError
  highlighted inline, raw JSON-LD behind a toggle) in StructuredDataPanel.
- Fixed 2 real bugs found during Playwright verification (both documented in
  sprints/breadcrumbs/s13.json): (1) `items-start` on the detail grid broke `sticky` after ~300px
  of scroll — the nav column's own box was shrunk to its content height instead of the row's full
  height; (2) ImageThumb/YoutubeThumb `onError` lost a race against hydration on fast cross-origin
  404s (browser starts the fetch from server HTML before React attaches the listener) — fixed by
  deferring `src` to a post-mount effect so the `<img>` is a client-created element instead.
- Verified live on :3103 (never touched Sagar's :3100): real crawls via POST /api/crawls, both
  themes, zero console errors throughout. Screenshots in
  seo-crawler-poc/sprints/breadcrumbs/s13-screens/. Stopped my :3103 server + the :3107 fixture
  server before finishing; :3100 confirmed still 200 OK.

# S14 work log — overview + secondary views excellence

- Read design-dna-v2.md + design-dna.md + all owned files (app/page.tsx, components/overview/**,
  components/charts/**, app/runs, app/failures, app/sitemap, app/new-crawl, lib/data-overview.ts).
- Fixed delta-pill polarity bug: lib/data-overview.ts `kpi()` now returns a `sentiment`
  (good/bad/neutral) decoupled from literal `direction` (arrow). kpi-strip.tsx renders a local
  `KpiTrendPill` from sentiment (not the shared do-not-touch DeltaPill, which hardcodes up=green).
- Law 1: linked hex-matrix legend rows, timeline HTTP/Playwright legend + total, all 4 KPI values,
  action-card values, work-queue row URL text -> filtered /pages or /failures destinations.
- Law 2: failures page groups (incl. "Blocked by robots.txt") converted to native
  <details>/<summary> collapsible groups (free keyboard support); each failure/blocked row links
  to its page record via findPageIdByUrl or shows "never crawled".
- Law 2: sitemap cross-ref cards now show an explicit "never crawled" / "no page match" badge
  when no page record resolves (previously silent plain text).
- Law 5: bento-refined action-card row (coverage card spans 2/4 cols with a CoverageBar) and
  chart row (hex matrix 3/5, timeline 2/5) on Overview only.
- Runs list rewritten: richer rows (startUrl, duration, computed maxDepth via getPages, coverage
  bar, pages/failed/blocked chips), every cell links to `/?run=<id>`.
- New-crawl: maxPages clamp raised 300->1000 (client validateMaxPages + the one permitted line in
  lib/crawl-runner.ts validate()), added the "your own site? go full..." helper text.
- Verified via Playwright on localhost:3104 (both themes): 5 click-through pairs landed on
  correctly-filtered destinations (action card -> failures, hex legend 4xx -> /pages?status=4xx
  filtered to 4/29 rows, failures row -> page detail, action card -> sitemap, runs row ->
  Overview?run=). Zero console errors in every check after a build-collision false alarm (S13's
  concurrent build corrupted a chunk hash mid-test; rebuild+restart fixed it, unrelated to my code).
- Noted (not fixed, out of scope): /pages does not yet honor `sort=`/`dir=` from the URL — my KPI
  "Avg response time" link navigates correctly but doesn't pre-sort. `status=` and `rendered=`
  ARE honored (confirmed live). Flagged for S13/Main Claude, not blocking.

# A5 work log — dashboard Issues UI (POC-2)

- Read spec.md A5 + brief.md §6b + design-dna.md/-v2.md + src/models/types.ts analysis contract +
  the fixture (sprints/fixtures/issues-sample.json) + all owned/adjacent dashboard source.
- lib/types.ts: added IssueSeverity/IssueEvidence/Issue/AnalysisReport (mirrors crawler A4's
  types.ts POC-2 section exactly), additive only.
- lib/data-issues.ts (new): readAnalysisReport (optional-safe fs read, own STORAGE_ROOT/RUNS_DIR
  resolution — lib/data.ts is do-not-touch and exports no path constants to reuse), groupIssuesByRule
  (affected-page count = distinct pageIds across an issue's own pointer + its evidence pointers, not
  a naive items.length), findingsForPage (primary pageId match OR site-scope issue referencing this
  page via evidence), sectionForField (MF-5b: evidence dot-path -> page-detail section id, null for
  sectionless v2-optional fields so the UI renders inline instead of a dead link), formatEvidenceValue.
- components/issues/**: SeverityBadge, IssuesSummaryBand (health score + error/warning/notice
  counts), IssuesFilterChips (severity + category, URL state via ?severity=&category=, preserves
  run), RuleGroupCard (<details> collapsible per rule — severity/category/coverage in the summary,
  expand -> every affected URL linking /pages/<pageId>?run=, "never crawled" badge when no page
  record resolves, same idiom as failures/sitemap pages), PageIssuesPanel (page-detail Issues
  section — evidence field:value pairs, jump link to an existing section OR inline value per
  MF-5b, cross-page evidence pointers link "(other page)").
- app/issues/page.tsx (new route): run-aware via resolveRunId, honest empty states (no runs / not
  analyzed with the exact `npm run analyze -- --run <id>` command / clean-run celebration card /
  no-results-for-filter with a Clear-filters link), rulesSkippedDataUnavailable shown honestly.
- Surgical edits (all additive, no existing behavior changed):
  - components/overview/action-cards.tsx: made async (self-contained readAnalysisReport call, so
    the Overview page itself needed zero edits), added the 4th "SEO health score" action card
    (green tint) only when issues.json exists for the run -> grid goes 4 to 5 cols; absent
    entirely (falls back to the original 4-col layout) when the run hasn't been analyzed.
  - app/pages/[id]/page.tsx: reads analysisReport + findingsForPage, renders <PageIssuesPanel>
    as the first panel (before Metadata).
  - lib/crawl-runner.ts: post-crawl auto-analyze — on exit 0/2 spawns
    `node --import tsx src/analysis/cli.ts --run <runId>` (cwd seo-crawler-poc, windowsHide,
    NOT detached, appended to the same crawl.log), wrapped so a spawn/exit failure only logs,
    never flips the crawl's own status to failed. src/analysis/cli.ts is still A4's stub as of
    this writing (`throw new Error("stub...")`) — the spawn is correct and will start working
    the moment A4 lands; verified today by exercising the UI against the issues-sample fixture
    dropped directly into storage, not by a real analyze run (A4 wasn't done yet).
  - components/explorer/section-nav.tsx: added {id:"issues", label:"Issues"} as the FIRST
    section (matches PageIssuesPanel's position as the first panel).
  - components/shell/nav-config.ts: added "Issues" to the Crawl data nav section + a "/issues"
    ROUTE_TITLES entry. Not in the dispatch's literal file list, but spec.md's "(add Issues
    section to the section list + nav)" and design-dna-v2 Law 1 ("everything links") both point
    at it — without a sidebar entry, /issues would only be reachable via the health-score card,
    which itself only appears once a run has been analyzed. One array line + one title line,
    additive, no restructuring.
- Verified: `npx tsc --noEmit` clean, `npm run build` clean (only the pre-existing Turbopack
  "dynamic filesystem access" warning, same class already emitted by lib/data.ts and
  lib/crawl-runner.ts for the identical env-driven path pattern — not a regression).
- Playwright verify on :3103 (never touched Sagar's :3100, confirmed still up throughout and
  after): fixture copied TEMPORARILY to storage/runs/target-site-full/issues.json. Both themes:
  /issues (severity + category filter chips update the URL and the list correctly, rule groups
  expand, real match 0ee65adde711/robots-noindex -> page detail), page-detail Issues section on
  that same real page (evidence jump link -> #metadata, URL hash updates, section-nav shows
  Issues first), Overview health card (76.2/100, links to /issues, absent + 4-col fallback
  confirmed via evaluate() on a run without issues.json). Also verified the "not analyzed" empty
  state (run smoke-example, exact CLI command shown, page-detail Issues section shows the same
  honest message) and the "run is clean" celebration (temporary synthetic zero-issue
  issues.json dropped on run smoke-books, confirmed "This run is clean" text, then deleted).
  Zero console errors on every check except one pre-existing, unrelated 404
  (poles-switchback.png — ImageThumb, S10-owned, fetching the original crawled image from
  localhost:3105 which wasn't running; not caused by or related to A5).
  Screenshots in seo-crawler-poc/sprints/breadcrumbs/a5-screens/.
- Stopped the :3103 server, deleted the temporary target-site-full/issues.json fixture copy and
  the temporary smoke-books/issues.json synthetic test file, confirmed both gone via `ls`/`find`.
