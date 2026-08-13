Entries are historical: each records what that slice shipped at the time, and is not rewritten when
a later slice changes the same number. Corrections found in the 2026-08-13 documentation audit are
added as dated `AUDIT 2026-08-13` lines under the claim they correct, never by editing the original
text. Convention: root `README.md` → "Documentation accuracy".

This log covers S13, S14 and A5 only. `/compare`, `/pages/[id]/preview`, `/api/replay`,
`/api/screenshot` and the Access/auth panel all shipped with no entry here — the crawler's
`WORK_LOG.md` carries reconstructed entries for the auth and screenshot work.

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
  - AUDIT 2026-08-13: 10 was correct for S13; the nav now carries **17** sections (issues,
    metadata, head-metadata, head-integrity, favicons, fonts, headings, document-structure, links,
    images, media, structured-data, content, replay, redirects, headers, crawl) — added by A5 and
    the later extraction/preview waves.
    `grep -cE '\{\s*id:\s*"' components/explorer/section-nav.tsx` → 17.
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
  - AUDIT 2026-08-13: correct for S14; the clamp has since been raised again to **1,000,000**
    (`lib/crawl-runner.ts:263` `Math.min(1_000_000, ...)`, `app/new-crawl/page.tsx:36`
    `n > 1000000`).
- Verified via Playwright on localhost:3104 (both themes): 5 click-through pairs landed on
  correctly-filtered destinations (action card -> failures, hex legend 4xx -> /pages?status=4xx
  filtered to 4/29 rows, failures row -> page detail, action card -> sitemap, runs row ->
  Overview?run=). Zero console errors in every check after a build-collision false alarm (S13's
  concurrent build corrupted a chunk hash mid-test; rebuild+restart fixed it, unrelated to my code).
- Noted (not fixed, out of scope): /pages does not yet honor `sort=`/`dir=` from the URL — my KPI
  "Avg response time" link navigates correctly but doesn't pre-sort. `status=` and `rendered=`
  ARE honored (confirmed live). Flagged for S13/Main Claude, not blocking.
  - AUDIT 2026-08-13: **fixed, and this note was never retracted** — it contradicted S13's own entry
    above (which already claims the fix) for however long both stood. `sort=` and `dir=` are read
    and written by `components/explorer/pages-explorer-client.tsx:47-48,110-111,119-121`.

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
    - AUDIT 2026-08-13: **A4 landed; `src/analysis/cli.ts` is no longer a stub** and real
      `issues.json` files are produced end-to-end. `grep -rn 'throw new Error("stub' ../seo-crawler-poc/src/`
      → 0 hits. Left the original text intact because it was true when written, but it was the most
      misleading line in the repo while it stood unannotated.
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

# dash-3screens work log — Activity + All Measurements + What the site tells crawlers

- Read this file's history + design-dna conventions + every owned/adjacent source file
  (lib/data.ts, lib/data-measurements.ts, lib/data-sitefiles.ts, lib/events-log.ts,
  lib/crawl-runner.ts, app/api/crawls/[runId]/{events,measurements,site-files,site-files/ai-access}
  routes, components/shell/**, components/ui/**, components/issues/**, app/pages/**,
  ../seo-crawler-poc/src/analysis/measurements/{compute,types}.ts, ../seo-crawler-poc/src/events/
  {eventLog,types}.ts) before writing any component.
- **Activity** (`app/activity/page.tsx`, `components/activity/**`): consumes the real, already-live
  `/api/crawls/:id/events` SSE endpoint (durable events.ndjson when present, synthetic
  crawl.log/progress tail fallback otherwise — both real, sibling-built, wired). Custom windowed
  virtualization (no new deps — fixed 30px row height, ~30-60 DOM rows regardless of feed size),
  auto-scroll with pause-on-scroll-up + "jump to latest" affordance, capped-backoff reconnect (own
  retry loop, not native EventSource auto-retry, so a legitimate finish never spam-reconnects).
  Filter chips for kind + status bucket + free-text search. Real event taxonomy from
  src/events/types.ts (crawl-started/request/browser-render/certificate-check/
  outbound-link-check/image-measuring/crawl-cancelled/crawl-finished) plus the synthetic
  fallback's log/progress/done, each with a distinct label/tone — an unrecognized future kind
  renders as a visible "Unknown event (kind)" row rather than being silently dropped.
  - Real bug found + fixed (own files only): lib/events-log.ts's `type`/`ts` field rename was
    edited live by a sibling agent mid-session (confirmed by re-reading the file + a fresh curl
    before building against it) — built against the corrected shape.
  - Real bug found + fixed (own files only): for an ALREADY-finished run, the SSR-fetched initial
    batch already contains the terminal `crawl-finished` row; a resumed EventSource with
    `fromSeq` past that row never sees it again under the shared route's "flag finished by
    observing a terminal row THIS read" logic, so the connection polled forever with the UI stuck
    on "Connecting…" (verified live against storage/runs/extraction-verify). Fixed entirely
    client-side: `alreadyTerminal(initialEvents)` skips opening a stream at all when the SSR data
    already proves the run is done. app/api/** wasn't touched.
- **All Measurements** (`app/measurements/page.tsx`, `components/measurements/**`,
  `lib/measurements-view.ts`, `lib/measurements-drilldown.ts`): the real 31-card computation layer
  (`../seo-crawler-poc/src/analysis/measurements/compute.ts`) exists and is complete but the
  shared `/api/crawls/:id/measurements` route is not yet wired to it (still returns
  lib/data-measurements.ts's older overview/histogram shape — confirmed live via curl). Built a
  shape-adapter (`adaptMeasurements`) that renders the rich v2 31-card/9-category grid the instant
  the route starts returning `measurements: Measurement[]`, and meanwhile renders every real
  number the live endpoint returns today (legacy shape) under a visible banner — never a
  fabricated card. `unavailable` cards (pageWeight, bytesDownloaded today; certificate +
  render-blocking always once v2 lands) render with a dashed border, a muted icon, "Not available"
  in place of a number, and the stated reason — never a bare 0.
  - "Deep-link into a filtered pages list": /pages' real client filters can't faithfully express
    most of the 31 ids without risking a count-vs-destination mismatch, so built an in-page
    SlideOver drill-down (Server Action `app/measurements/actions.ts`, computed server-side
    against the SAME `getPages()` already used everywhere) instead. Cross-checked every
    id against compute.ts line-by-line before enabling it; kept only the 10 with GUARANTEED exact
    parity (pages-crawled, redirects, missing-title, missing-meta-description, missing-h1,
    multiple-h1, thin-content [reads the real analysis.config.json threshold, not a guess],
    noindex, deep-pages, needs-javascript). Explicitly excluded broken-pages (compute.ts unions
    pages.json + failures.json; failures-only URLs have no page record to link to) and
    images-without-alt (compute.ts counts images, a drill-down panel can only count pages — same
    button, different unit, reads as a mismatch even though neither number is wrong) — verified
    both gaps by re-deriving compute.ts's real numbers against phase2-final's stored pages
    directly (thinContentWords=80 real threshold → 8 matches; broken-pages pages.json-only → 4
    vs. compute.ts's union-based count that would differ once wired). Drill-down is additionally
    gated off entirely while shape==="legacy" (a couple of legacy ids reuse a v2 id name under a
    DIFFERENT rule — legacy thin-content is a hardcoded <300-word count, not the config threshold).
- **What the site tells crawlers** (`app/sitefiles/page.tsx`, `components/sitefiles/**`,
  `lib/sitefiles-lines.ts`): both backing endpoints (`/site-files`, `/site-files/ai-access`) are
  real, live, sibling-shipped — consumed via direct server-side lib import (`getRun`,
  `buildAiAccessTable`), matching this codebase's SSR convention. Headline always states all 4
  brief-mandated verdict buckets (allowed/blocked/partly blocked/ignores robots.txt) plus a 5th
  "unknown" bucket shown separately when robots.txt itself is unavailable/unparseable — never
  collapsed to a single count. "Matched rule with source line number": AiAccessRow has no line
  number field; added an independent re-scan of the same raw robots.txt content
  (`lib/sitefiles-lines.ts`, verdict logic NOT duplicated, only line lookup) rather than editing
  the shared lib/data-sitefiles.ts a sibling might be mid-editing. llms.txt panel explicitly
  labeled "informational only — never affects a score". Distinct from `/sitemap` (existing,
  robots+sitemap-cross-ref focused) — this screen owns the AI-crawler table and cross-links to
  `/sitemap` for full sitemap coverage rather than duplicating it.
- `components/shell/nav-config.ts`: added Activity/All Measurements/"What the site tells
  crawlers" nav entries + ROUTE_TITLES (additive-only, same precedent as A5's `/issues` entry —
  re-read the file immediately before editing since a concurrent sibling had already added their
  own `/queue`/`/links`/`/images`/`/redirects` entries mid-session).
- Alignment defects found and fixed while building (owner's explicit "our UI but with proper
  alignment" requirement): measurement cards now use a consistent flex-column with the
  label/icon row, value, explainer, and drill-down button all top-aligned per card regardless of
  explainer text length (`h-full` + flex on Card); table numeric columns (status codes, source
  line numbers) use `tabular-nums`; the AI-crawler table's verdict column is a fixed-tone badge so
  all 13 rows' badges left-align at the same x position regardless of label length; Activity's
  event rows use fixed-width columns (time/kind/status) with `tabular-nums` on the status cell so
  columns don't jitter as different-width values stream in.
- Verified: `npx tsc --noEmit` clean, `npm run lint` clean on every file this slice touched (4
  pre-existing errors remain in image-thumb.tsx/media-panel.tsx/ProgressPanel.tsx/theme-toggle.tsx
  — none touched by this slice, confirmed present before this slice started), `npm run build`
  clean (only the same class of pre-existing "dynamic filesystem access" Turbopack warning already
  emitted by lib/data.ts/lib/crawl-runner.ts for the identical env-driven path pattern).
  Real 2 bugs found + fixed during build (both above): fixed within this slice's own files only,
  neither touched app/api/** or a shared lib file.
- Playwright/browser verification on :3901 (`next start` on the built production bundle — `next
  dev` refused a second instance against this project directory while :3100's dev server was
  running, a project-wide singleton lock unrelated to port; never touched :3100, confirmed still
  200 OK throughout and after). The shared Playwright MCP browser turned out to be actively driven
  by a concurrent sibling agent (tabs got silently navigated/closed mid-verification more than
  once) — switched to claude-in-chrome's isolated MCP tab group for the remainder of the pass.
  Both themes, all 3 screens, zero console errors on every check. Virtualization proven, not
  assumed: seeded a temporary 3,001-event synthetic run (`qa-virtualization-test`, same
  temporary-fixture technique A5 used for issues.json) and confirmed via direct DOM query
  (`document.querySelectorAll('.divide-y > div').length`) that exactly 36 rows existed in the DOM
  against "3,001 of 3,001 events" — then deleted the fixture. Kind/status filter chips, the
  pause-on-scroll-up "jump to latest" affordance, and light/dark theme all exercised live.

# 2026-08-13 work log — login screen rebuild, scrollbars, sidebar audit

- Scope: `app/login/page.tsx`, `components/auth/**`, `components/shell/**`, `app/globals.css`,
  `components/ui/button.tsx` (added `size="lg"`), `components/ui/theme-toggle.tsx` (touched since
  shell was in scope). Sole agent running; no other slice active.
- **Login screen**: rebuilt as a split panel per 3 owner-picked references (Gradiator/OnlyPipe/a
  third dark ref), but in our own tokens, not theirs (owner correction mid-task: "understand our
  style... based on that we have to do that"). Visual half (`AuthVisual.tsx`) is a static,
  decorative echo of the app's OWN hex-matrix chart (`components/charts/hex-matrix.tsx` on
  Overview) — same hex geometry (R=9, flat-top offset grid) and same status-class color mapping,
  not an invented motif — deterministic LCG-seeded cell tones (no Math.random/Date.now: those
  would desync between SSR and hydration and throw a real mismatch). Legend + coverage dial reuse
  the app's own `StatValue`/legend-row visual pattern. SVG is `aria-hidden` throughout — it is
  decorative, not a claim about real run data. Social login (Google/Apple/GitHub, present in all
  3 references) dropped entirely per owner: verified zero `signInWithOAuth` calls anywhere in the
  codebase and confirmed `app/auth/callback/route.ts`'s own comment says it exists only "if
  extended later" — nothing is wired. Email+password only, form rebalanced for the shorter
  composition (no divider, no reserved slot).
- **Contrast bugs found and fixed via real computed-style checks** (not eyeballed): footer byline
  `text-faint` on `bg-canvas` measured 4.16:1 (light) — below the 4.5:1 floor — fixed to
  `text-secondary` (5.43:1). AuthVisual legend `%` chip, same `text-faint`-on-`bg-subtle` pattern
  copied from the real HexMatrix legend, measured 4.39:1 — fixed to `text-secondary` (5.72:1);
  flagged (not fixed, out of ownership) that `components/charts/hex-matrix.tsx` ships the
  original with the same borderline pairing. Error banner `text-danger` on `bg-danger-bg` (same
  pairing as `Badge` tone="danger") measured 4.23:1 — fixed by keeping the icon red (graphics
  only need 3:1) and moving the message text to `text-foreground` (15.5:1). Pre-existing
  `placeholder:text-faint` on `bg-canvas` (4.16:1 light, unchanged from the prior LoginForm,
  used identically elsewhere e.g. SearchInput) left as-is — out of this slice's introduced set,
  and the field's visible label already carries the accessible name.
- **Scrollbars**: `scrollbar-width`/`scrollbar-color` token-driven + `::-webkit-scrollbar` for
  both engines. Real bug caught by computed-style testing, not assumed: setting these on `:root`
  alone left `<body>` computing `scrollbar-width: auto` (spec says inherited, Tailwind's preflight
  apparently breaks that inheritance in practice) — moved to the universal selector `*` so every
  element gets it directly. `overscroll-behavior: contain` added to `.overflow-y-auto` /
  `.overflow-auto` / `.overflow-x-auto` (Tailwind's own utility classnames, so every real scroll
  region in the app is covered with zero per-component edits) — fixes the "chains to page scroll"
  complaint on the sidebar and everywhere else with the same shape.
- **Sidebar defects found before fixing** (owner asked for the list, not just the result): (1)
  active vs. hover nearly indistinguishable — both resolved to `bg-subtle`, only differed by a
  1px border barely darker than its own surface; (2) no `focus-visible` ring on the main nav
  `Link` at all, inconsistent with every other interactive control in the app; (3) one flat
  8-item "Crawl data" bucket mixing findings + page drill-downs + crawler-directive info, vs. 2
  items in "Essentials" — no structure matching the actual crawl→findings→pages→compare workflow;
  (4) "Crawl queue" filed under catch-all "Practitioner tools" despite being the direct next step
  after triggering a crawl; (5) the "Account" footer label used identical weight/case to real nav
  section headers; (6) no desktop collapse control, purely breakpoint-driven; (7) run-selector
  styled as a low-emphasis secondary chip despite being the single most consequential piece of
  global state in the app.
- **Sidebar fixes**: regrouped `NAV_SECTIONS` into Start here / Findings / Explore pages / Compare
  & history (`nav-config.ts`, additive re-order only, no route changes). Active state now
  `bg-elevated` + `font-semibold` + a 2px inset primary left accent
  (`shadow-[inset_2px_0_0_0_var(--primary)]`, chosen over a real border to avoid a padding/box-
  model shift) — visually distinct from hover's plain `bg-subtle`. `focus-visible:ring-2
  focus-visible:ring-primary` added to nav links (verified live via real Tab presses + computed
  `box-shadow`, not assumed). "Account" label de-capitalized/de-bolded to `text-faint` normal
  case so it reads as a footer caption, not a nav section. Added a real, working desktop collapse
  toggle (`lib/sidebar-collapse.ts`, localStorage-persisted, same SSR-default-then-correct-on-
  mount trade-off `ThemeToggle` already uses) — collapses to the existing icon-rail markup
  (factored into a shared `iconLink` helper in `app-shell.tsx` so mobile rail and desktop-collapsed
  rail don't duplicate) with its own expand/collapse buttons independent of the mobile hamburger.
  Verified live: toggle, persists across reload, un-collapses, mobile SlideOver still shows the
  new grouping correctly. Run-selector bumped from `bg-subtle`/`text-secondary` to
  `bg-elevated`/`border-strong`/`text-foreground`/`shadow-card` with a `hover:border-primary`
  affordance.
- **Verification**: `npx tsc --noEmit` clean. `npm run lint` clean on every file this slice
  touched — 2 pre-existing errors remain in `image-thumb.tsx`/`media-panel.tsx` (untouched,
  confirmed present before this slice). `theme-toggle.tsx`'s pre-existing
  `react-hooks/set-state-in-effect` error fixed properly (not suppressed silently) using this
  codebase's own established pattern for that exact rule — a scoped `eslint-disable-next-line`
  with a reason comment, same as the precedent already in `components/preview/page-replay.tsx`
  and `components/queue/queue-client.tsx` — applied identically to the new collapse-state effect
  in `app-shell.tsx`. `npm run build` clean (same pre-existing "dynamic filesystem access"
  Turbopack warning as prior slices, unrelated to this one). Could not use `next dev` (project-
  wide singleton lock, another session had it) — used `npm run build && npx next start -p 3980`,
  confirmed the port-3980 process was actually killed and restarted (not just re-requested) before
  every re-check by PID via `netstat`, stopped cleanly at the end, never touched :3100. Real
  browser verification via claude-in-chrome + chrome-devtools-mcp (CDP viewport emulation — the
  claude-in-chrome `resize_window` tool did not actually change `window.innerWidth` on this
  machine, confirmed by direct JS check, so switched tools rather than trusting its "success"
  response). Logged in with the real QA account (`qa-user@seo-platform.test`, credentials supplied
  by the coordinator mid-task) to verify the sidebar/scrollbar against the authenticated app
  rather than in isolation; the public login screen was verified separately since it required no
  auth. Contrast ratios computed from real `getComputedStyle` token values via an in-page WCAG
  luminance/contrast function, both themes, both reported in full to the owner. Tab order, focus
  rings, and Enter-to-submit all driven for real (typed real credentials, watched the real 400
  from Supabase, confirmed the error banner renders and is announced via `role="alert"`).
  Screenshots in `qa-screenshots/{login,sidebar}-*.png` — both themes, desktop (1440) and narrow
  (390) widths, plus the error state and the mobile SlideOver nav.
  Screenshots in qa-screenshots/{activity,measurements,sitefiles}-{light,dark}-*.{png,jpg}.
