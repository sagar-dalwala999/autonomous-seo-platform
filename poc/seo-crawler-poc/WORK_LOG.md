# Work Log

Per-slice entries below are historical: each records what that slice shipped, at the time it
shipped, and is not rewritten when a later slice changes the same numbers. Anything you need to be
**currently** true — rule counts, test counts — lives in the dated block immediately below, next to
the command that produced it. See "Documentation accuracy" in the root `README.md`.

## Current counts (recount before quoting; each figure carries the command that produced it)

Counted **2026-08-13 16:03 +0530** on branch `extraction-correctness`, from `poc/seo-crawler-poc/`:

| Figure | Value | Command |
|---|---|---|
| Page rules registered | 50 | `grep -rhE '^\s*id: "' src/analysis/rules/page/*.ts \| wc -l` |
| Site rules registered | 21 | `grep -rhE '^\s*id: "' src/analysis/rules/site/*.ts \| wc -l` |
| Crawler test cases | 622 in 55 files | `npm test` (vitest run) — 606 passing, 16 failing at that moment |
| Dashboard test cases | 14 in 3 files | `cd ../seo-dashboard && npm test` |

Every page and site rule module is spread by its `index.ts` aggregator, so the module id counts equal
the registered totals — verified by reading `src/analysis/rules/{page,site}/index.ts`.

**These figures are volatile.** During the two hours of this audit alone the crawler suite went
519 → 622 cases and the page rulebook went 34 → 50 rules, because slices were landing concurrently.
The 16 failures in the snapshot above are in files whose source was mid-edit at the time, not a
standing defect. **Re-run the command; never quote the table.**

Use the runner, not a grep. A static `grep -c 'it('` over `tests/` disagrees with vitest in both
directions — it missed 7 cases repo-wide on one pass (calls not at the start of a line) and
over-counted several files on another (commented-out or string-embedded matches). The runner is
ground truth.

## S2 — extraction
- Implemented `extractPage` (src/extraction/index.ts, frozen signature) split into metadata/headings/links/images/schema/content modules; every field wrapped in a `safe()` catch so the function can never throw.
- Metadata: case-insensitive meta[name] lookups, robots meta merges `<meta name=robots>`+`googlebot`+`x-robots-tag` header (agent-prefix strip, "none"→noindex+nofollow).
- Links: mailto/tel/javascript/sms/fax + empty/fragment hrefs excluded from evidence entirely (decision); authored scheme/host preserved verbatim in `target`, normalization/scope delegated to `src/url`.
- Images: alt `undefined` vs `""` mapped to `null` vs `""` (missing-vs-empty is the seeded evidence); width/height only accepted as bare digit strings.
- Schema: every ld+json block captured raw + parsed/parseError, never dropped (truncated/empty blocks included).
- Content: clones `$.root()` before stripping script/style/noscript/template/nav/header/footer/`[aria-hidden=true]` — caller's tree never mutated; sha256 contentHash of lowercased whitespace-collapsed text.
- 52 vitest cases (tests/unit/extraction/*, 7 files) + 20 HTML fixtures (tests/fixtures/html/) mirroring the real target-site's 18 seeded manifest classes (read straight from `../target-site/app/**/page.tsx` source comments) plus 2 synthetic shapes (two-H1, `<base href>`).
- `npx vitest run tests/unit/extraction`: 52/52 passing. `npx tsc --noEmit`: 0 errors project-wide.

## S5 — storage-report
- Implemented `RunStore` (src/storage/runStore.ts): mkdir-recursive init, raw/pages/failures/blocked/robots/sitemaps/report JSON I/O, sha256-based 12-hex pageId, promise-chained `saveFailure` for concurrent-safe read-modify-write.
- Implemented `buildSummary` + `printSummary` (src/report/summary.ts): dedup semantics for unique/attempted/statusHistogram across pages+failures, orphan detection via `discoverySources.includes("seed")`, sitemap cross-ref by URL path (host-alias-safe), coverage math with 0-attempted guard, plan §20 console format.
- 15 unit tests written (tests/unit/report/{summary,runStore}.test.ts + fixtures.ts) — all passing (`npx vitest run tests/unit/report`).
- `npx tsc --noEmit`: clean for src/storage/** and src/report/**; one pre-existing error in src/detection/needsJsRendering.ts (S7's in-flight stub, not touched).

## S7 — js-detection
- Implemented `needsJsRendering` (src/detection/needsJsRendering.ts): 6 named signals (tiny-body, empty-app-shell, low-text-ratio, no-links-no-text, noscript-warning, spa-bundle-only), decision rule = any strong signal OR >=2 weak signals, `DETECTION_THRESHOLDS` exported for the POC report to cite.
- Dependency-free: regex/string heuristics only (no cheerio). Empty-app-shell isolates a mount root's inner text via a depth-counted `<div>`/`</div>` scan rather than a full parser.
- 6 fixtures authored (tests/fixtures/detection/*.html) + a fixture-honest ExtractionResult builder (tests/unit/detection/helpers.ts, wordCount/contentHash derived from the same text, never hand-typed).
- 7 vitest cases, all passing (`npx vitest run tests/unit/detection`). `npx tsc --noEmit` clean project-wide.

## S6 — bench-harness
- `scripts/lib/{paths,proc,stamp,records}.ts`: shared helpers — spawn/log/HTTP-poll, sortable stamps, read-only loaders for a run's stored evidence (pages/failures/blocked/sitemaps/report) typed against `src/models/types`.
- `scripts/serve-target-site.ts` + `scripts/stop-target-site.ts`: build (optional) + serve `../target-site`, poll until 200, record PID+port; stop script verifies the recorded PID's command line looks like next/node (via `Get-CimInstance`/`ps`) before killing, refuses otherwise.
- Live-verified and fixed two real Windows process bugs (not found by reasoning from code — only by actually running it):
  1. `spawnDetached` piped the detached child's stdout through this process's own stream — that keeps the event loop alive forever, so the parent script never exited even though the server was up. Fixed: child writes straight to a file descriptor (`stdio: [ignore, fd, fd]`), no pipe.
  2. `npx next start` under `shell:true` returns the PID of the transient `cmd.exe` wrapper, which can exit while a grandchild keeps serving — `stop-target-site.ts` then can't find/kill anything. Fixed: spawn `node <target-site>/node_modules/next/dist/bin/next start -p <port>` directly (no npx/cmd.exe layer), so the recorded PID is the real server.
  3. `detached: process.platform !== "win32"` disabled detach on Windows — the child stayed attached to this console session and died the instant the spawning script's console was torn down (confirmed via a matched diagnostic: identical spawn with `detached:true` survived, `detached:false` did not). Fixed to `detached: true` unconditionally.
- `scripts/bench.ts`: runs the brief §4 test matrix (target-full, target-robots, redirect-chain, redirect-loop, books, quotes-js, example) via `npm run crawl --`, logs to `storage/bench/<stamp>/<name>.log`, copies each run's `report.json`, writes `manifest.json`. `--only`/`--skip-external` flags; external targets keep `--rps 2`.
- `scripts/evidence-check.ts`: all 18 seeded-manifest checks (brief §6) implemented as programmatic assertions against stored run records, plus a live re-grep of `../target-site` for `seeded` comments (traceability appendix, not hardcoded). Writes `evidence.md`, exits 1 on any FAIL.
- `scripts/poc-report.ts` + `scripts/bench-flow.ts`: assembles `POC-1-REPORT.md` (coverage table + inlined evidence.md + env note + auto-listed known-limitations) from the latest bench dir; `bench-flow.ts` chains serve→bench→evidence-check→poc-report, each still runnable standalone.
- VERIFIED live end-to-end (bench.ts/evidence-check.ts need S4/S2/S3/S5/S7 integrated first, so only serve/stop could be exercised today): `npm run build` in target-site passes; server starts and survives independently; `GET /` → 200; `/robots.txt` serves the seeded Disallow:/guides/ content; `/sitemap.xml` serves the seeded 404-entry/omissions content; `/old-gear` → 2-hop redirect chain (307→/gear-old→200 /products, `num_redirects=2`); `/loop-a` → genuine redirect loop (curl exit 47, CURLE_TOO_MANY_REDIRECTS); `stop-target-site.ts` correctly identified the real PID via command line and killed only it, port confirmed free after. `npx tsc --noEmit`: clean project-wide.

## S8 — dashboard-scaffold (UI wave 1)
- New Next.js 16 app at `../seo-dashboard` (App Router, TS, Tailwind v4, no src-dir, `@/*` alias, no git — `--disable-git`), `lucide-react` added. `dev`/`start` scripts pinned to port 3100.
- Token system (`app/globals.css`): design-dna §3 table as CSS custom properties on `:root`/`[data-theme="dark"]` + a `prefers-color-scheme` media-query fallback for no-JS clients; `@theme inline` maps them to Tailwind color/radius/shadow utilities (`bg-card`, `text-secondary`, `rounded-card`, `shadow-popover`, …). Renamed the brand token to `primary` and the body-text token to `foreground` (both literally named `--text-primary`/`--primary` in design-dna) to avoid a Tailwind utility-name collision — documented inline.
- No-flash theming: `next/script` `beforeInteractive` inline script reads `localStorage("theme")` and stamps `data-theme` before paint; `ThemeToggle` (Light/Dark/System) live-swaps + persists + listens for OS changes while on System. `suppressHydrationWarning` on `<html>` since the script's stamp intentionally diverges from the SSR markup.
- App shell (`components/shell/*`): sidebar (264px, brand block, search-with-`/`-shortcut routing to `/pages?q=`, nav map w/ real Runs badge, active = bordered pill, bottom Appearance/Help/user row) + topbar (route title via a small path→title table, extensible right-slot via `lib/topbar-actions-context.tsx` for S9/S10) + `main` as the only scroll region. <1024px: icon rail + a `SlideOver`-based nav drawer (hand-rolled focus trap + Esc + scrim, no extra deps).
- `lib/data.ts` (server-only, no `server-only` pkg since it's not an allowed dep — enforced by convention/comment instead): `listRuns`/`getRun`/`getPages` (status/rendered/q/sort/dir/limit/offset, module-Map cache per run)/`getPage`/`rawHtmlPath`/`getBench`. Verified the on-disk shapes against `src/storage/runStore.ts` and `scripts/bench.ts` directly rather than guessing. `lib/types.ts` duplicates the read-side contract (header comment names `src/models/types.ts` as source of truth) per the spec's fallback option.
- UI primitives (`components/ui/*`): Button (primary/outline/ghost/dark)/Card/Chip/Badge/DeltaPill/StatValue/Skeleton/EmptyState/Table (sticky header, `aria-sort`, tabular-nums)/SlideOver/ThemeToggle — tokens only, zero raw hex.
- Route skeletons (Overview/Runs/Pages/Pages[id]/Failures/Sitemap) each in one file, real data-layer calls, honest EmptyStates (no-runs-yet shows the actual `npm run crawl --` command; failures page distinguishes "no runs" from "run is clean").
- VERIFIED live: ran two real crawls (`smoke-example`, `smoke-books`, both left in `storage/runs/` — real evidence, harmless) to prove the pipeline beyond empty states; also exercised 24 pre-existing real runs from other slices' testing (target-full/target-robots/redirect-loop/quotes-js/…) through every route. `npm run build`: compiles + typechecks clean (one benign Turbopack tracing warning on the intentionally-dynamic `CRAWLER_STORAGE_DIR` path, documented inline). Playwright: zero console errors/warnings across the whole session; light+dark verified (including live toggle); 1440/1023(icon-rail)/390 widths verified, no page-level horizontal scroll, table overflow correctly scoped to its own card; mobile nav drawer opens/closes on Esc with focus correctly restored to the trigger button; Inter self-hosted font confirmed loaded (200) and applied (`getComputedStyle` on `<h1>`); defensive fs-read path confirmed live via a genuine `console.warn` for one malformed run dir. Found and fixed a real bug during this pass: `getPages`' sort comparator indexed `depth`/`responseTimeMs` as top-level fields when they're nested (`crawl.depth`/`performance.responseTimeMs`) — replaced with an explicit `sortValue()` switch.

## S10 — dashboard-explorer + page evidence detail (UI wave 2)
- `../seo-dashboard/lib/explorer-shared.ts` (client-safe types: StatusBucket, ExplorerRow, statusTone, bucketForStatus — zero fs imports) + `lib/data-explorer.ts` (server-only: buildExplorerRows merges pages/*.json + failures.json + blocked.json into one row list, groupFailuresByClass, findPageIdByUrl for host-agnostic pathname+search cross-ref matching). Real bug caught by the build: a client component (`PagesExplorerClient`) originally imported straight from `lib/data-explorer.ts`, which imports `lib/data.ts`'s `node:fs/promises` — Turbopack fataled ("chunking context does not support external modules"). Fixed by splitting client-safe types into their own file; client components now only ever import `explorer-shared.ts`.
- `/pages`: full explorer (`components/explorer/pages-explorer-client.tsx`, client) — status chips (All/2xx/3xx/4xx/5xx/Failed/Blocked with live counts, unified over real pages + failures.json + blocked.json rows), rendered + depth facets, URL filter, sortable columns via the existing `Th` aria-sort control, "show more" pagination (100/page). Depth column placed right after Status (Sagar's live-review note: depth must be first-class, never buried) and bolded.
- `/pages/[id]`: the full 10-section evidence detail — `components/explorer/evidence-panels.tsx` (server: HeaderBand w/ bolded Depth + parentUrl link via `findPageIdByUrl` + discoverySources chips, MetadataPanel w/ canonical-mismatch flag + x-robots-tag header shown separately from merged robots.meta, HeadingsPanel, ImagesPanel w/ missing-vs-empty alt badges + BMP flag, StructuredDataPanel w/ raw+parseError, RedirectChainPanel, HeadersPanel) + `links-panel.tsx` (client, internal/external filter+counts) + `collapsible-text.tsx` (client, content preview toggle) + `page-actions.tsx` (client: Copy JSON via clipboard, Download JSON via Blob, Open/Download raw HTML via plain `<a>` — a `<button>`-in-`<a>` is invalid HTML so these are NOT the shared `Button` component, just anchor tags styled to match).
- `app/api/raw/[runId]/[pageId]/route.ts` (new): streams the stored raw HTML. Decision: always serves `text/plain` (never `text/html`) even for "Open raw HTML" — crawled markup is untrusted third-party content and this tool has no auth, so this guarantees it can never execute as a script in our own origin. `?download=1` adds `Content-Disposition: attachment`. Regex-validates runId/pageId (`^[a-zA-Z0-9_.-]+$`) against path traversal; verified a `..%2F..` attempt gets a 400, a missing page gets a 404.
- `/failures`: grouped by `reason` (whatever FailureClass values are actually present) with per-group counts, Depth column added, blocked.json section, robots.txt evidence card (content, parseStatus, sitemap declarations).
- `/sitemap`: added the three cross-ref lists (in-sitemap-not-crawled / crawled-not-in-sitemap / sitemapEntriesFailed) with counts, each entry linked to `/pages/<id>` when `findPageIdByUrl` resolves a record; sitemap files list now shows total entries + per-file error badges.
- `/runs`: link target changed from `/pages?run=` to `/?run=` (Overview) per spec item 5.
- VERIFIED live (prod server `next start -p 3102`, port checked free first; 3100/3101/3105 left untouched — this session's shared Playwright browser also had S9's own tabs/dev server open concurrently, handled via explicit `browser_tabs select` before each capture): `npm run build` passes (0 TypeScript errors after S9's concurrent `lib/crawl-runner.ts` edit briefly broke the shared build — not my file, resolved itself and re-verified clean). Field-by-field checked the detail view against stored JSON for all three requested seeded pages, all exact matches: (a) `8b1af16b8754` in `20260811-110248-target-full` = `/blog/choosing-hiking-boots` — invalid JSON-LD renders raw truncated block + exact parseError string "Expected double-quoted property name in JSON at position 151 (line 1 column 152)"; (b) `af6552b41fcb` in `20260811-110248-redirect-chain` = `/old-gear` — the real 2-hop chain (`/old-gear`→307→`/gear-old`→307→`/products`, final 200) renders as an ordered hop list with per-hop status badges; (c) `0ee65adde711` in `20260811-110248-target-full` = `/products/switchback-trekking-poles` — noindex badge (danger tone) + missing-alt badge (danger tone) on its one image both render correctly (note: naive `grep` on these JSON files false-matches the FIRST `"url"` key, which is nested inside `images[]` when present before the top-level field — verified all three pageIds via `node -e "JSON.parse(...)"` instead of trusting grep). Copy JSON verified via `navigator.clipboard.readText()` round-trip; raw HTML route verified byte-identical to the stored file via `diff`. Zero console errors/warnings across every screen, light + dark, at both 1440 and a 390 mobile width (shared browser window was resized by the concurrent session mid-pass; used it as a bonus responsive check rather than fighting it back to desktop every time). Confirmed the app-shell scroll region works post-shell-fix (`main.scrollHeight(1550) > clientHeight(897)`, `overflowY: auto`, `scrollTop` settable) per Main Claude's live-review note. Dev server stopped at the end of the session.

## S9 — dashboard-overview + dynamic crawl trigger (UI wave 2)
- Overview (`app/page.tsx`): action cards (coverage/failed/blocked, tinted headers, real footnotes derived from `report.failuresByClass`/`blocked.json`), KPI strip w/ real prev-run deltas (`lib/data-overview.ts`'s `buildKpiStrip`, "first run" caption when no previous run exists — never a fake delta), custom-SVG hex-matrix (`components/charts/hex-matrix.tsx`, true pointy-top hexagons via computed polygon points, not squares) + dot-matrix timeline (`components/charts/dot-matrix-timeline.tsx`, stacked dot columns two-toned HTTP/Playwright), "Pages that need you" work-queue table merging 4xx/5xx + noindex-on-crawlable + orphan candidates + redirect-loop failures, run-selector (custom dropdown, not a native `<select>`) + status filter chips linking into `/pages`/`/failures` (S10-owned routes).
- Found and fixed a real bug via the Playwright loop, not by reading code: `DeltaPill` (do-not-touch, S8-owned) rigidly couples color to direction (up=green,down=red); my first KPI implementation flipped direction for "good/bad" metrics (e.g. lower response time = green) which produced a visually contradictory pill — a negative diff shown with a green up-arrow. Fixed `kpi()` in `lib/data-overview.ts` to always match the literal numeric sign; screenshot-verified before/after.
- **Dynamic crawl trigger — scope changed mid-build (Sagar, live review): moved from a SlideOver to a dedicated full page `app/new-crawl/page.tsx`** (form left / live progress+log right, stacks on mobile). `lib/crawl-runner.ts` spawns the crawler via `spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], { cwd: <crawler-poc>, shell: false, detached: true, stdio: ["ignore", fd, fd] })` — verified live that `node --import tsx src/index.ts --help` runs the CLI in a single process (tsx publishes its loader at its package "." export), so no npx/cmd.exe wrapper layer and the captured PID is the real worker. `.crawl-status.json` is the source of truth (not in-memory state), with a reconciling read in `getCrawlStatus()`: if state says "running" but the pid is no longer alive (dev-server restart or crash), it infers done-vs-failed from whether `report.json` exists and persists the correction — this survives a killed/restarted dashboard process, which in-memory-only tracking would not. `app/api/crawls/route.ts` (POST, 409 when another crawl is running) + `app/api/crawls/[runId]/route.ts` (GET, status + last-30-line log tail + reportReady flag).
- Added a **Max depth** field per the live scope change; CLI does not yet support `--max-depth` as of this session (`node --import tsx src/index.ts --help` has no such flag) — wired the full plumbing (`StartCrawlInput.maxDepth`, validated, appended as `--max-depth N` when set) but the UI field itself ships **disabled** with a "coming in integration" hint (`MAX_DEPTH_SUPPORTED = false` in `app/new-crawl/page.tsx`) rather than faking support, per instruction. Flip that one constant once the CLI flag is confirmed live.
- Added the hybrid-engine helper line on `/new-crawl` next to the render-mode control, matching the wording given.
- **REAL end-to-end verification, not simulated**: submitted a real crawl through the built UI against `http://localhost:3105` (seeded target-site), max-pages 30, respect-robots on. Observed via Playwright: `POST /api/crawls` → 202, `runId: ui-20260811-171311`; polled `GET /api/crawls/ui-20260811-171311` (6× before completion, all 200); progress panel → "Crawl complete" with a real log tail (Successful 18, Failed 3, Blocked 2, 404 3, JS-rendered 1, Internal links 161, Max depth reached 2, orphan candidates); cross-checked `.crawl-status.json` on disk independently of the UI (`state:"done", exitCode:2, maxDepth:null`) — exitCode 2 is the CLI's documented "completed with failures" code, correctly mapped to `"done"` (not `"failed"`) since a real report was produced. "View run" → Overview switched to the new run via `?run=ui-20260811-171311`; action cards, KPI deltas, hex-matrix (first real render with the "blocked" gray-dark class populated — 2 real robots-blocked hexes), and the work-queue table all rendered real numbers matching the run.
- Playwright verification note: the shared Playwright MCP browser session in this environment is contended by other concurrently-running Generator agents (S10 was actively testing the same dashboard on port 3102 throughout) — `browser_tabs select`/`new` followed by a resize+screenshot repeatedly landed on another agent's tab mid-sequence. Worked around by minimizing round-trips between establishing a tab and capturing, and by reading back every screenshot before trusting it, discarding several genuinely-mislanded captures rather than reporting them as mine.
- `npx tsc --noEmit`: 0 errors in every file this slice owns. `npm run build`: passes clean (exit 0) — route table includes `/`, `/new-crawl` (static), `/api/crawls`, `/api/crawls/[runId]`. Zero console errors/warnings across the whole session on every screen captured (Overview light/dark/mobile, /new-crawl form/running/complete). Dev server (port 3101) stopped at the end of the session.

## S11 — new-crawl form overhaul (unmistakable control state)
- Root cause of Sagar's live-test complaint: the render-mode segmented control (S9's `ThemeToggle`-style pattern) only differentiated the selected option by a subtle `bg-card`+`shadow-card` shift, and the robots switch only differentiated on/off by track color — neither read clearly at a glance. Rebuilt both from scratch in new `components/new-crawl/` (own dir per scope, `components/ui/*` primitives read but not edited).
- `RenderModeCards.tsx`: 3-card radiogroup — selected = `border-primary` + `ring-2 ring-primary` + `bg-primary/10` tint + a solid filled check badge + title text turns `--primary` (five simultaneous signals, not one). Roving-tabindex keyboard nav: Arrow Left/Right/Up/Down move focus **and** selection together (wrap-around) per ARIA radiogroup authoring practice, Space/Enter via native `<button>`. Live-verified via Playwright accessibility snapshot (`[checked] [active]` moved from Auto→Never on a single `ArrowRight`).
- `RobotsSwitch.tsx`: bigger 24×44 track, `bg-primary` filled when on vs `bg-subtle`+`border-strong` neutral when off, plus a state **sentence** that changes text (not just color) — "On — blocked URLs are recorded, not fetched" vs "Off — robots rules ignored for this crawl" in `--warn`, `aria-live="polite"` so screen readers get the change too.
- `StatusChip.tsx` + `ProgressPanel.tsx`: status chip (spinner+ping-dot while running, ok-green done, danger-red failed), live mm:ss elapsed timer (freezes at done/failed, resets on new submission), mono auto-scrolling log tail, Report ready/pending badge on completion.
- Rewrote `app/new-crawl/page.tsx` into 3 labeled sections (Target/Limits/Engine via a shared `FormSection` eyebrow) + inline onBlur validation (URL malformed, maxPages 1–300, maxDepth ≥0) via a shared `FormField` — red border + `role=alert` message, cleared on next edit. Submit button shows an inline spinner+label while starting/running rather than swapping variants. **Behavior contract unchanged**: identical `POST /api/crawls` payload shape, identical `GET /api/crawls/<runId>` polling, identical done/failed handling, "View run" nav, `MAX_DEPTH_SUPPORTED` still `true`.
- VERIFIED live on `npx next start -p 3103` (Sagar's port 3100 never touched, confirmed 200 OK before and after): every render-mode card clicked + keyboard-navigated in both light and dark, screenshotted selected each time; robots switch toggled both directions in both themes; a real inline validation error triggered (`not-a-url` + maxPages `500`) and screenshotted with both red borders + messages visible; **two real crawls submitted** against `http://localhost:3105` — `ui-20260811-174837` (maxPages 10/depth 1, done in 6s, 9 ok/1 failed, "Max depth reached: 1") and `ui-20260811-174941` (maxPages 100, screenshot caught mid-flight in the Running state with the elapsed timer live at 0:02) — both reached "Crawl complete" with a populated log tail and a working "View run" link. Zero console errors/warnings across the entire session (checked repeatedly). `npm run build`: clean, 0 TS errors, exit 0 (pre-existing `lib/crawl-runner.ts`/`lib/data.ts` filesystem-tracing warnings are unrelated do-not-touch files).
- Real Windows gotcha hit and fixed: killing the PID captured from `nohup npx next start & echo $!` did nothing — `npx` spawns a child `node` that actually binds the port, and the captured PID was the already-exited wrapper. Resolved the true owner via `Get-NetTCPConnection -LocalPort 3103 -State Listen`, confirmed its `StartTime` matched this session before killing it; verified port 3103 freed and port 3100 still 200 OK afterward.
- 9 screenshots in `sprints/breadcrumbs/s11-screens/`: initial(light,Auto) · Never-selected(light) · Always-selected(light) · robots-off(light) · Auto-selected(dark) · Never-selected+robots-off(dark) · validation-errors(light) · crawl-running(light) · crawl-done(light).

## S12 — media extraction (videos: files + YouTube/Vimeo/iframe embeds)
- `src/models/types.ts`: added `VideoRecord` (url, kind: file|youtube|vimeo|iframe, poster, mimeType, providerId) after `ImageRecord`; added `videos: VideoRecord[]` to `ExtractionResult` after `images`. Nothing else in the type contract touched.
- `src/extraction/media.ts` (new): `extractVideos($, base)` — every `<video src>` and child `<source>` becomes one `VideoRecord` per distinct RESOLVED source URL (deduped via a resolved-URL `Set`), all sharing the parent `<video>`'s resolved `poster`; kind `file`. Every `<iframe src>` matched against YouTube (`youtube.com/embed/`, `youtube-nocookie.com/embed/`, `youtu.be/` — all 3 authored shapes), Vimeo (`player.vimeo.com/video/<id>`), or a video-ish fallback list (dailymotion/wistia/loom/brightcove/jwplayer/`video` substring) → `kind: "iframe"` with `providerId: null`; anything else (maps embeds, etc.) excluded entirely. `data:`/`blob:` sources skipped on both tags. Follows S2's style exactly — no local try/catch (relies on `resolveAbsolute` + the outer `safe()` wrapper in `index.ts`), never throws.
- `src/extraction/index.ts`: wired `videos: safe(() => extractVideos($, base), [])` right after `images`, imported + re-exported `extractVideos`. `buildCrawledPage` in `src/crawler/crawl.ts` spreads `...extraction`, so `videos` flows through to `CrawledPage`/storage/dashboard with **zero** changes to the crawler, storage, or report layers — confirmed `src/report/summary.ts` never references `images`/`videos`, so the report summary genuinely stays untouched (page-record-only, per spec).
- `tests/fixtures/html/media-mixed.html` (new) + `tests/unit/extraction/media.test.ts` (new, 9 cases): `<video src>`+poster, multi-`<source>` w/ shared relative poster + per-source `type` attrs, all 3 YouTube URL shapes (incl. a query-string variant), Vimeo, a non-video iframe proving exclusion, relative-src resolution, unknown-video-ish-embed bucketing, data:/blob: skip, same-URL dedup, no-src skip, and two never-throws cases (malformed/unclosed markup, unresolvable src).
- Typecheck-forced minimal fix (per dispatch's explicit exception): `tests/unit/detection/helpers.ts` and `tests/unit/report/fixtures.ts` each build a literal `ExtractionResult`/`CrawledPage` — added `videos: []` (one line each) so the new required field compiles; no other change, no video logic added to either owning slice's actual source.
- VERIFIED: `npx vitest run tests/unit/extraction` → 61/61 (52 pre-existing + 9 new). `npx vitest run` (full suite) → 123/123 across 15 files. `npx tsc --noEmit` → zero errors project-wide, confirmed twice.
- Real-network proof attempt: curl-fetched 6 real public URLs hunting a live server-rendered YouTube/Vimeo `<iframe>`; most 404'd (link rot from training-data recall), and the one live 200 (`w3schools.com/html/html_youtube.asp`) turned out to hold the embed as HTML-escaped example-code text, not a live tag — `extractPage` correctly returned `videos: []` on it (verified this is genuinely correct, not a bug). Given the time-box, fell back to the brief's explicitly-sanctioned alternative: ran `extractPage` end-to-end (real `FetchArtifact`/`CrawlScope` shapes, no test doubles) against `media-mixed.html` via a throwaway `scripts/_s12-proof-media.ts` (deleted after use) — got exactly the 7 expected `VideoRecord`s with correct `kind`/`url`/`poster`/`mimeType`/`providerId`, proving the full wire-in path end to end, not just the isolated unit test.

## A1 — extraction-extensions (POC-2 wave)
- `src/extraction/social.ts` (new): `extractSocialTags($)` → `{ og, twitter }` ordered maps. Checks BOTH `property=` and `name=` attrs for both prefixes (og is spec'd via property, twitter via name, but real pages mix them up) — key resolution is `property ?? name`. First occurrence of a duplicate key wins (documented — `Record` can't hold an ordered list, so a page with two `og:image` tags collapses onto one entry).
- `src/extraction/hreflang.ts` (new): `extractHreflang($, base)` → `HreflangEntry[]` from `<link rel="alternate" hreflang="...">`, resolved absolute href. `rel=alternate` links with no `hreflang` attr (feeds, print stylesheets) are excluded — they aren't language annotations.
- `src/extraction/pixel-width.ts` (new): `estimateTitlePx`/`estimateMetaDescriptionPx`. Char-width table = Adobe's public-domain standard Helvetica AFM per-1000-em advance widths (Arial is Microsoft's metric-compatible Helvetica substitute, and Google's desktop SERP renders in an Arial-family sans-serif) — provenance + estimate-not-measurement caveat documented in the file's top comment, matching `PixelWidths`' doc comment on the type. Title bucket scales at 20px, description at 14px (approximate Google SERP sizes). Unknown chars (accented/CJK/emoji) fall back to the average lowercase width (556/1000). Null in → null out; `""` also null (falsy check) so "empty → null" holds.
- `src/extraction/pageStats.ts` (new): `extractPageStats($, html, contentText, headers, httpVersion)` — `htmlBytes` = UTF-8 byte length of raw html (not JS string length — multi-byte chars matter), `textRatio` = UTF-8 byte length of the ALREADY-noise-stripped content text (reuses `content.ts`'s `extractContent().text` rather than recomputing, so "content text" means the same thing everywhere) `/ htmlBytes`, clamped to 1; `domNodes` = `$("*").length` (element nodes only, matches how DOM-inspector tools report node count); `contentEncoding`/`httpVersion` passed through from the fetch layer.
- `src/extraction/metadata.ts` (extended, not rewritten): added `extractTitles`/`extractMetaDescriptions` (every instance, document order, `[]` when none — existing `extractTitle`/`extractMetaDescription` untouched, still `.first()` = back-compat), `extractMetaKeywords` (meta[name=keywords], collapsed), `extractMetaRefresh` (new `findMetaHttpEquivContent` helper — meta-refresh is authored via `http-equiv=`, not `name=`, easy trap; regex `^\s*([\d.]+)\s*(?:;\s*url\s*=\s*(.+))?\s*$` parses delay+url, strips optional quotes around the url target, malformed content keeps `raw` with `delaySeconds`/`url` both null).
- `src/extraction/headings.ts`: unchanged — already selected all `<h1>` via cheerio (`$(sel).map().get()` has no truncation), so "beyond first two" was already correct; added a regression test proving it (4 h1s) rather than touching the module.
- `src/extraction/index.ts`: replaced the entire v2 placeholder block with real wired calls, each `safe()`-wrapped per existing convention; `content` (needed for both `pageStats.textRatio` and the existing `content` field) and `title`/`metaDescription` (needed for `pixelWidths`) hoisted into locals once and reused rather than recomputed.
- New fixture `tests/fixtures/html/multi-instance-social.html`: 2×`<title>`, 2× meta description, OG+Twitter tags authored both standard (og via property, twitter via name) AND swapped (og via name, twitter via property) to prove both are captured, a duplicate `og:image` to prove first-wins, a 3-entry hreflang cluster + an alternate-with-no-hreflang control, a `5;url=/redirected-page` meta refresh, and meta keywords.
- Tests added: `social.test.ts` (6), `hreflang.test.ts` (5), `pixel-width.test.ts` (5), `pageStats.test.ts` (7), plus extended `metadata.test.ts` (+13: titles/descriptions multi-instance, keywords, 5× refresh incl. malformed/quoted/case-insensitive-http-equiv), `headings.test.ts` (+1: 4-h1 no-truncation), `index.test.ts` (+2: full v2 field wiring end-to-end on the new fixture, and empty-but-never-undefined defaults on a v1-shaped page). Every new/absent/multi-instance/malformed case from the dispatch is covered.
- VERIFIED: `npx vitest run tests/unit/extraction` → 99/99 (67 pre-existing + 32 new). `npx vitest run` (full repo suite) → 161/161 across 19 files, all pre-existing extraction tests still green untouched. `npx tsc --noEmit` → 0 errors.
- No `do_not_touch` files touched: `src/models/types.ts`, `src/crawler/**`, `src/analysis/**`, `sprints/**` (besides this breadcrumb) all left alone. `extractPage`'s exported signature (`artifact, scope`) unchanged — `src/crawler/crawl.ts`'s two call sites needed zero edits.

## A2 — crawler-capture-v2 (POC-2 wave)
- `KEPT_HEADERS` (src/crawler/crawl.ts) += `content-encoding`, `strict-transport-security`, `content-security-policy`, `x-frame-options`, `x-content-type-options`, `referrer-policy` — same `pickHeaders` filter, no new logic path.
- `httpVersion`: Cheerio pass reads `response.httpVersion` (got/`IncomingMessageWithTimings`, directly typed — no cast needed); Playwright pass calls `await response.httpVersion().catch(() => null)` (best-effort per spec — Chrome DevTools Protocol format `"HTTP/1.1"`, differs from got's bare `"1.1"`; both threaded through `FetchArtifact.httpVersion` into A1's real `pageStats.httpVersion`, unchanged on that side).
- Dual storage + `renderDivergence`: **carry decision** — extended the escalation `Map<string, string[]>` (signals only) to `Map<string, EscalationCandidate>` where `EscalationCandidate = { signals, staticHtml: string|null, staticExtraction: ExtractionResult|null }`, populated from the Cheerio pass's already-computed `html`/`extraction` locals (no re-read from disk, no second `extractPage` call for the static side). Populated for real JS-detection escalations AND 403/429 fetch-retry escalations (both have a genuine static body to diff against); left `null` for pure network-failure retries (timeout/DNS never got a response). In the PW `requestHandler`, when a candidate carries a static snapshot: `store.saveStaticRaw()` writes `raw/<id>.static.html` BEFORE the pass's own `saveRaw`/`savePage` overwrite `raw/<id>.html`/`pages/<id>.json`, then `computeRenderDivergence(staticExtraction, extraction)` diffs title/metaDescription/canonical/`robots.noindex`/`links.length`/`content.wordCount` → `RenderDivergence`, passed into `buildCrawledPage`'s new optional `renderDivergence` param (defaults `null`, replacing the old hardcoded `null`).
- `RunStore` (extend-only, byte-compatible): added `saveStaticRaw(normalizedUrl, html)` → `raw/<id>.static.html`, `saveExternalChecks(results)` → `external-links.json`. Zero changes to existing methods/signatures.
- `--check-external` (src/index.ts + src/crawler/crawl.ts): `runCrawl(options, checkExternal = false)` — second param, not a `CrawlOptions` field, since `src/models/types.ts` is do_not_touch for this slice. After the report is built, `runExternalLinkChecks` collects up to 50 unique external `link.target`s across stored pages (in discovery order, first-`checkedFrom`-wins), sequential HEAD requests at `EXTERNAL_CHECK_RPS=2` (~500ms spacing) with a 10s `AbortSignal.timeout`, real fetch errors captured as `{statusCode: null, error: message}` — never swallowed. CLI help text + a `check-external: <bool>` startup log line added.
- VERIFIED: `npx tsc --noEmit` → 0 errors. `npx vitest run` → 161/161 (concurrent A1 work grew the suite from the 123 baseline; all green, none touched by this slice). Real crawl `quotes.toscrape.com/js --max-pages 5` (run `a2-verify-quotesjs`): 2 pages escalated, both have `raw/<id>.html` + `raw/<id>.static.html` on disk and real non-null `renderDivergence` (e.g. `wordCountDelta: 213`/`542`, `linkCountDelta: 0`, `staticRawSaved: true`). Real crawl `localhost:3105 --no-robots --max-pages 10 --check-external` (run `a2-verify-targetsite-noalias`, alias deliberately omitted per dispatch note so `summittrailgear.example` links count as external): `external-links.json` written with 4 real HEAD-check results against the fictional host — genuine `fetch failed` DNS errors, not fabricated, which is the honest real-world outcome for a non-resolving domain.
- Known quirk (not a bug): Playwright's `httpVersion()` returns CDP-format strings (`"HTTP/1.1"`) vs got's bare `"1.1"` on the Cheerio side — spec only required best-effort capture, no format normalization was in scope.

## A3 — analysis-engine + page rules (POC-2 wave)
- `analysis.config.json` (project root): Screaming-Frog-aligned defaults (title 30-60 chars/561px, desc 70-155 chars/985px, thin <80 words, slow >2000ms, redirectChainMax 1, nearDup 5%, weakInlink 1) — every threshold's source documented in a `_sources` doc-header map; `_docs` explains the defaults-file/override-file merge relationship.
- `src/analysis/config.ts`: `loadConfig(configPath?)` — reads the root config as defaults (path resolved via `import.meta.url`, not cwd), deep-merges an optional override file (thresholds per-key, rules per-ruleId), then `validate()`s (non-negative finite thresholds, min<max pairs, 0-1/0-100 range checks, severity enum).
- `src/analysis/rules/page/**` (8 modules + `shared.ts` helper + `index.ts` aggregator, 29 rules **as shipped by this slice** — but the per-module breakdown that follows sums to 30, so "29" was already wrong when written. Later slices added `render-divergence.ts`, `transport.ts`, `head.ts`, `fonts.ts`, `structure.ts` and `url-too-long`, and the total is still climbing — see "Current counts" at the top of this log, and recount rather than quoting either number): on-page.ts (11: title/desc missing/too-short/too-long/multiple, h1-missing/multiple, heading-hierarchy-skip), indexability.ts (4: noindex, canonical-mismatch [loose scheme/www/trailing-slash-tolerant same-URL check], canonical-absent, meta-refresh-present), images.ts (4: missing-alt vs empty-alt kept distinct per the null-vs-"" evidence contract, bad-format [bmp/tiff/ico], missing-dimensions), structured-data.ts (3: parse-error, missing-required-property [MF-4 POC subset: Product→name+offers, Article→headline, FAQPage→mainEntity], type-mismatch [heuristic: curated type→URL-keyword hint map, e.g. Recipe needs "recipe/food/cook" in the URL — documented as narrow, not a content classifier]), social.ts (2: og/twitter missing), content.ts (2: thin-content, low-text-ratio), http.ts (3: 4xx/5xx, slow-page), security.ts (1: security-headers-missing, gated on `pageStats` presence as a proxy for the v2 header-capture wave since old runs can't distinguish "header not sent" from "header not captured").
- MF-5 severity discipline applied throughout: only deterministic-fact rules (title-missing, noindex, 4xx/5xx, structured-data-parse-error) default `error`; every threshold/heuristic rule (thin-content, low-text-ratio, slow-page, title/desc-too-short/long, type-mismatch) defaults `warning` or `notice`, never `error`.
- Every v2-optional-field rule (title-multiple, meta-description-multiple, meta-refresh-present, og-missing, twitter-missing, low-text-ratio, security-headers-missing) returns `null` (not `[]`) when its field is `undefined` — never false-fires on an absent-vs-empty pre-v2 field.
- `src/analysis/engine.ts`: `runAnalysis` — tolerant direct-fs reads of pages/failures/blocked/sitemaps/robots/report.json (ENOENT → sane fallback, any other error rethrown); runs `pageRules()` per page + `siteRules()` once via a shared context, with a `stub:`-prefixed-error catch so A3 could develop/test independently of A4's landing order (moot once A4 shipped — real siteRules() run normally); backfills `pageId` from the storage filename (rules never see it directly); stable `severity → ruleId → url` sort for byte-identical repeat runs; `healthScore` = (analyzed − pages-with-≥1-error-issue) / analyzed × 100 rounded to 1 decimal, resolving error-issue → page via `pageId` or a `url`→`pageId` fallback map (covers site-scope issues that set `url` but not `pageId`); `rulesRun` = count of non-disabled registered rules (page+site); `rulesSkippedDataUnavailable` = dedup'd sorted ruleIds that skipped at least once.
- Tests: `tests/unit/analysis/page/*.test.ts` (8 files, one per rule module, fires/doesn't-fire pairs for v1-field rules and full fires/doesn't-fire/skip-on-undefined triads for the 7 v2-gated rules) + `config.test.ts` (defaults load, override deep-merge, 3 validation-rejection cases) + `engine.test.ts` (deterministic ordering incl. repeat-run byte-identical check, healthScore math, pre-v2 graceful degradation with zero throws, missing-files tolerance, zero-pages edge case). 69 A3 tests, all passing.
- VERIFIED: `npx tsc --noEmit` → 0 errors project-wide. `npx vitest run` (full repo suite, after A1/A2/A4 all landed concurrently) → 290/290 across 37 files. Real smoke test: copied `storage/runs/20260811-110248-target-full` (the pre-v2 run — zero v2 fields present) to a scratch dir, ran `runAnalysis` against it via a throwaway `scratch-a3-smoke.ts` (deleted after), then deleted the scratch run copy. Result: 25 pages analyzed, healthScore 60.0, 127 issues (14 error/51 warning/62 notice), 8 rules correctly listed as data-unavailable-skipped (7 mine + A4's hreflang-not-reciprocal), zero throws. Confirmed firing exactly where the target-site's `seeded:` source comments say they should: `/about` → title-missing+meta-description-missing; `/products/ridgeline-backpack-45l` → structured-data-missing-required-property:offers (manifest #11c, the hard-required case); `/products/switchback-trekking-poles` → noindex (#12); `/blog/layering-basics` → structured-data-type-mismatch:Recipe (#11b); `/contact` → title-too-short+h1-missing (#3b/#6a); `/blog/trail-snacks` → thin-content (#17); `/products/granite-hiking-boots` → image-bad-format:bmp+meta-description-missing (#10d/#4).
- Gap flagged for the owner/gate (not built — out of both A3's and A4's scope text as written): manifest #15b (http:// non-https absolute internal link) and #15c (absolute www/non-www mix) have no rule anywhere in the POC-2 rulebook; the evidence is captured (`LinkRecord.target` preserves the authored URL) but nothing flags it as an issue.

## A4 — analysis-site-rules + store + CLI + gate (POC-2 wave)
- `src/analysis/rules/site/**` (types.ts + helpers.ts + 6 rule modules + index.ts aggregator, 16 site rules **as shipped by this slice** — later slices added `link-consistency.ts`, `favicons.ts`, `auth-required-link` and `sitemap-too-many-urls`, and the total is still climbing; see "Current counts" at the top of this log, and recount rather than quoting either number): duplicates.ts (duplicate-title, duplicate-description, exact-duplicate-content, near-duplicate-content [pairwise wordCount-delta-≤5% within the same section-path-prefix sanity guard, explicitly documented as a POC proxy — minhash is Tier 2]), orphans.ts (orphan-page, sourced from the crawler's own `report.orphanCandidates` rather than recomputed), sitemap.ts (sitemap-404-entry, sitemap-noindex-included, sitemap-not-crawled, crawled-not-in-sitemap — all 4 computed independently from `ctx.sitemap.entries` + `ctx.pages` + `ctx.failures` via local pathname matching, not trusted from `report.sitemap.*`, so the analyzer stays correct even if the crawler's own cross-ref logic diverges), robots.ts (robots-blocked, notice severity per spec), redirects.ts (redirect-chain >`config.thresholds.redirectChainMax`, redirect-loop from `failures.json`), links.ts (weakly-linked [exactly `weakInlinkCount` inlinks, seed excluded, evidence anchored to the real source `links[N]` entries], canonical-target-invalid [MF-3: canonical → 4xx/5xx/redirected/noindexed target via cross-page lookup], broken-internal-link [MF-3: `link.targetNormalized` → a `failures.json` http-4xx/5xx record or a crawled 4xx+ page]), hreflang.ts (hreflang-not-reciprocal — returns `null` data-unavailable unless hreflang is captured on ≥1 page, per spec).
- MF-5 severity discipline: `redirect-loop` and `broken-internal-link` default `error` (deterministic facts); `weakly-linked`, `near-duplicate-content` default `notice`; everything else `warning`/`notice`. All overridable via `config.rules[id]`.
- `src/analysis/store.ts`: `writeIssues`/`readIssues` — stable `severity → ruleId → url` sort on write (byte-diffable repeat runs), `readIssues` returns `null` on ENOENT (never-analyzed run).
- `src/analysis/cli.ts`: `parseArgs` → `loadConfig` → `runAnalysis` → prints healthScore/counts/rulesSkippedDataUnavailable/top-8-rules-by-count. No fallback/stub-tolerance in the CLI itself (that tolerance lived in A3's engine during concurrent dev).
- `scripts/analyzer-gate.ts`: explicit 30-row expectation table (18 manifest items, several split into sub-items 6a/6b/6c, 10a/10b(N/A)/10c/10d, 11a/11b/11c, 15a/15b(N/A)/15c(N/A), 16a/16b, plus a derived bonus 14c for sitemap-noindex-included) mapping manifest id → run (full/robots/chain/loop, auto-discovered from the latest `storage/bench/<stamp>/manifest.json` same as `evidence-check.ts`, or explicit `--run/--robots-run/--chain-run/--loop-run`) → expected category/ruleId(s) + URL(s) + minimum severity (+ `forbidError` for the 3 MF-5-named heuristic items #9/#17/#18). Generic matcher does category-OR-ruleId matching so page-scope rows (owned by A3, whose exact ruleIds I couldn't predict at dispatch time) resolve correctly via A3's real category names (`on-page`/`indexability`/`images`/`structured-data`/`content`/`http`/`social`) confirmed by grep once A3 landed. Also runs: a false-positive check (any error-severity issue on a "clean" page — derived from a live grep of `../target-site/app/**/page.tsx` for `seeded` comments, same manifest source as `evidence-check.ts`, minus those routes — is a FAIL; warnings/notices on clean pages print for eyeballing only); an evidence-pointer resolution check (100% must resolve to a real stored field — dot-path resolver against the page record, falling back to report.json/sitemaps.json/blocked.json/failures.json for site-scope evidence; `expectAbsent` mode handles "missing property" findings whose evidence value is `null`, e.g. structuredData[0].parsed.offers, correctly rather than false-failing on a legitimately-absent leaf). Exit 1 on any manifest FAIL, false-positive violation, or unresolved/missing evidence pointer.
- TESTS: `tests/unit/analysis/site/*.test.ts` (7 rule files + store.test.ts, 45 tests) — hand-built `SiteRuleContext`/`CrawledPage`/`FailureRecord`/`AnalysisConfig` fixtures per rule (fires/doesn't-fire/data-unavailable triads where applicable, config severity-override + enabled=false coverage, seed-exclusion for weakly-linked, section-prefix + delta-threshold boundaries for near-dup).
- VERIFIED for real, not just unit tests: ran `npx tsx src/analysis/cli.ts --run <id>` against all 4 real POC-1 bench runs (target-full/target-robots/redirect-chain/redirect-loop, `20260811-110248` stamp) through A3's real engine — 268 total issues written to real `issues.json` files, zero throws. Ran `scripts/analyzer-gate.ts` against that real output: **27/30 PASS, 0 FAIL, 3 N/A** (10b/15b/15c — no analyzer rule exists for image-byte-size or http-vs-https/www-mix link evidence, documented as crawler-evidence-only, out of analyzer scope), false-positive check PASS (0 error-severity findings on any of the target-site's non-seeded pages), evidence-resolution 395/395 pointers resolved, exit code 0. Also self-tested the gate's failure paths with a throwaway synthetic run (deleted after): confirmed it correctly FAILs on a missing expected issue, on a deliberately-bogus error-severity finding on a clean page, and on a deliberately-bad evidence field path — then confirmed `process.exit(1)` in isolation (not just non-zero from a piped `tail`).
- `npx tsc --noEmit` → 0 errors project-wide (checked repeatedly through the build, including after A1/A2/A3 landed concurrently).

## C3 — real near-duplicate detection (replaces the wordCount proxy)
- `src/analysis/similarity.ts` (was a stub): `shingle(text, size)` — lowercase, strip punctuation (`/[^\p{L}\p{N}\s]/gu`), collapse whitespace, word n-gram windows, default n=5. `minHashSignature(shingles, hashes)` — FNV-1a 32-bit with two fixed offset bases (h1, h2), then `hashes` pseudo-independent hash fns derived via Kirsch-Mitzenmacher double-hashing (`h_i = (h1 + i*h2) mod 2^32`) rather than hashing `hashes` times per shingle. Pure function of the input strings — no RNG, no Date — so signatures are byte-identical run-to-run, machine-to-machine (verified: called `minHashSignature` twice on the same Set, `toEqual`).
- `findNearDuplicates(pages, runId, opts)`: excludes exact duplicates first (drops any page whose `content.contentHash` recurs elsewhere in the run, before signatures are even built — exact-duplicate-content owns those), applies a "meaningful content" floor (`wordCount >= shingleSize`, plus an explicit empty-shingle-set skip so two contentless pages can't spuriously read as 100% similar via all-Infinity signature collision). LSH banding: signature split into bands of `ROWS_PER_BAND=8` rows (16 bands at the default 128-hash signature); two pages are only ever fully compared if >=1 band matches byte-for-byte across both — turns O(n²) into ~O(n) bucket lookups + a small candidate-pair pass. Union-find over candidate pairs whose full estimated Jaccard >= threshold; final cluster `similarity` = the LOWEST pairwise estimate across ALL members (not just the LSH edges that formed it) — matches `SimilarityCluster`'s own doc comment ("the conservative figure to report"), computed cheaply since post-clustering groups are small.
- **Threshold tuning (the acceptance-gate-critical part)**: item spec's suggested default was 0.9. Measured the seeded manifest-#18 pair's TRUE (non-estimated) 5-word-shingle Jaccard directly from real extracted `content.text` (storage/runs/poc2-full) with a standalone script: **0.824**. 0.9 would silently miss it. Chose **DEFAULT_THRESHOLD = 0.75** — ~7pp of margin below the measured pair, while still requiring near word-for-word overlap (unrelated same-length pages measured ~0.0 Jaccard in the same script, confirming the threshold stays conservative against the exact false-positive failure mode the old wordCount proxy had). Live-measured MinHash *estimate* (128 hashes) for the real pair: **0.859** (matches the analyzer output % on `poc2-full`).
- **LSH band/row choice**: b=16 bands × r=8 rows (signatureSize/ROWS_PER_BAND=128/8) puts the recall S-curve's ~50% crossing at approximately `(1/b)^(1/r) = (1/16)^(1/8) ≈ 0.81` — close to the tuned 0.75 threshold, so genuine near-dup pairs land in a shared bucket with high probability (computed recall at the seeded pair's true similarity 0.824: `1-(1-0.824^8)^16 ≈ 98%`) while dissimilar pages are never compared. `signatureSize` values not evenly divisible by 8 fall back to a single band (correctness-preserving brute-force path; not hit by the production default).
- `src/analysis/rules/site/duplicates.ts`: `nearDuplicateContentRule` rewritten to call `findNearDuplicates(ctx.pages, ...)` — one issue per cluster member, message states the real `~NN% similar (estimated Jaccard)` + peer URLs, evidence = `content.contentHash` + `content.wordCount` + peer `pageId`s, `threshold` field states the real method. Description no longer says "NOT a real similarity score" — states the actual method (5-word MinHash+LSH) and configured threshold. Dropped the old per-section-prefix restriction (a sanity guard the length-proxy needed; a real similarity score doesn't — proven by a new test that two pages in DIFFERENT sections with the seeded-pair-level text overlap now correctly fire).
- Config (deliberate, minimal exception to this slice's `do_not_touch: config.ts` — the dispatch's own item 5 explicitly asked for "Do NOT delete the old key from the AnalysisConfig interface... mark it deprecated in a comment", which only makes sense as an edit to that interface): added `thresholds.nearDupSimilarity?: number` (optional, so pre-C3 configs/fixtures still validate untouched) to `src/analysis/config.ts`'s `AnalysisConfig`, `@deprecated`-commented the now-unread `nearDupWordCountDeltaPct` in place (left, not deleted — another slice/config may still reference it). `validate()`, `THRESHOLD_KEYS`, merge logic, and everything else in config.ts untouched. `analysis.config.json`: added `"nearDupSimilarity": 0.75` + a `_sources` doc entry with the measured-similarity rationale; old key/value left as-is.
- TESTS: `tests/unit/analysis/similarity.test.ts` (new, 16 cases) — shingle normalization/windowing/empty-floor, minHashSignature determinism + length + identical-set + real-pair-estimate (>0.7) + unrelated-set (<0.3), findNearDuplicates: real seeded pair clusters above default threshold, matching-wordCount-unrelated-content does NOT cluster (the bug this slice fixes), exact-dup exclusion, meaningful-content floor, custom threshold un-clusters the pair, lowest-pairwise-in-3+-cluster, and a 302-page timing/no-spurious-clustering regression guard (<5s, exactly 1 cluster). `tests/unit/analysis/site/duplicates.test.ts`'s near-dup block rewritten (7 cases) using the pair's real extracted text: fires with real similarity/message/threshold text, wordCount-proxy-bug fixed, fires cross-section now, exact-dup exclusion, config threshold override, graceful fallback when a config lacks nearDupSimilarity, severity-override/enabled=false.
- Caught and fixed a real bug during dev, not just by reasoning: an initial synthetic 300-page timing test used a linear-formula word generator (`word${(i*977+w*13)%5000}`) instead of real randomness — its arithmetic structure caused accidental multi-word shingle alignment between unrelated "pages" (90 spurious clusters). Replaced with a seeded xorshift32 PRNG; re-ran — 1 cluster (the real seeded pair only). Kept as a cautionary note since it's exactly the kind of false-positive a bad similarity implementation would also produce, and it wasn't the algorithm — it was the test's own fake data being deterministic in a way that looked random but wasn't.
- VERIFIED for real: `npx tsc --noEmit` → 0 errors project-wide. `npx vitest run` → 365/365 across 43 files (315 pre-existing + 15 rewritten in duplicates.test.ts + a net +19 vs. the old near-dup block, +16 new in similarity.test.ts — no regressions). `npm run analyze -- --run poc2-full` then `npx tsx scripts/analyzer-gate.ts --run poc2-full --robots-run poc2-robots --chain-run poc2-chain --loop-run poc2-loop`: **29/30 PASS, 0 FAIL, 1 N/A** (unchanged N/A is the pre-existing hreflang one, unrelated to this slice); #18 PASSES via the real algorithm (analyzer output: both seeded URLs, "~86% similar"); false-positive check PASS; evidence-pointer resolution 709/709 resolved, 0 unresolved, 0 issues with zero evidence. Scale check: `npm run analyze -- --run books-full-site` (1,195 pages, all 48 rules) completed in 43s with zero crash/stack-overflow (healthScore 100, 0 errors) — isolated `findNearDuplicates` timing on the same 1,195 pages (standalone script, load+call only): **608ms**, producing 50 clusters / 102 pages, similarity range 73-96%, 100% of them structurally legitimate (books.toscrape catalogue pagination/category listing pages sharing template boilerplate — zero false positives on unrelated individual product pages, spot-checked by filtering for any non-`catalogue/page-N`/`catalogue/category` URL among the findings: 0 found).

## C4 — crawl-over-crawl comparison (monitoring: what changed since last time)
- `src/diff/crawlDiff.ts` (was a stub): `diffRuns(baseRunDir, headRunDir)` — loads both runs' `pages/*.json` directly (mirrors `RunStore.loadAllPages` but takes a directory, not a runId, since the CLI resolves `--base/--head` to paths itself), keyed by `pathnameOf(primaryUrl(page))` (imported read-only from `src/analysis/rules/site/helpers.ts` — never modified, do_not_touch honored) so a page survives host aliasing/scheme drift between two crawls of the same site, falling back to the raw URL when unparseable so nothing silently vanishes from the diff. `added`/`removed` = URL set difference on those keys. `changed` = for keys in both, compares 12 fields (statusCode, title, metaDescription, canonical, robots.noindex, h1-joined, content.contentHash, content.wordCount, links.length, images.length, redirectChain.length, renderedWith) — content is compared via `contentHash` only, never by diffing extracted text, per spec. Zero-change pages count toward `unchangedCount`, never `changed`. `issues` lifecycle (new/fixed/persisting) computed only when BOTH runs have `issues.json` (read via the existing `readIssues` from `src/analysis/store.ts`, also read-only imported) — `null`, never a fake zero, when either side hasn't been analyzed. `added`/`removed`/`changed` arrays are sorted before return so repeated runs over the same two directories are byte-identical regardless of filesystem readdir order. Only throws for "run directory not found" (via an `fs.stat` check on each side up front); a malformed individual page file is skipped, never fatal.
- `src/diff/cli.ts` (new): `npm run diff -- --base <runId> --head <runId> [--out storage]` — resolves both ids to `storage/runs/<id>`, calls `diffRuns`, writes `storage/diffs/<base>__<head>.json` (dir created if missing), prints counts + issue-lifecycle line + up to 10 changed URLs with per-field before→after. `package.json` touched by exactly one line: `"diff": "tsx src/diff/cli.ts"`.
- TESTS: `tests/unit/diff/crawlDiff.test.ts` (7 cases, own `fixtures.ts` writing real temp run directories via `mkdtemp` — same pattern as `tests/unit/analysis/site/store.test.ts`/`tests/unit/report/runStore.test.ts`, not mocked): run-directory-not-found throws a clear Error; added/removed detection by pathname; a title change AND a contentHash change both land as separate `PageFieldChange`s on the same page; a page with zero field changes counts as unchanged, not changed; issue lifecycle new/fixed/persisting via `ruleId::url` keys; `issues: null` (not zero) when either side lacks `issues.json`; determinism — two `diffRuns` calls over the same fixtures produce identical sorted output regardless of insertion order.
- DASHBOARD `/compare` (new route + nav entry "Compare" under Crawl data in `components/shell/nav-config.ts`, the one permitted surgical edit): decision — **computes the diff ON THE FLY** via `lib/data-compare.ts` rather than reading `storage/diffs/*.json`, reusing `lib/data.ts`'s existing `getPages`/`listRuns` and `lib/data-issues.ts`'s `readAnalysisReport` (server-only, same `node:fs` pattern as every other `lib/data-*.ts` file). Field-for-field mirrors `src/diff/crawlDiff.ts`'s algorithm but can't import it directly — same cross-project fallback already established by `lib/types.ts`'s header comment (no TS project reference between the two sibling apps, kept in sync manually). `app/compare/page.tsx`: base/head run pickers reflected into `?base=&head=` (shareable, back/forward-safe), defaults to the two most recent runs when unset, honest empty states for zero/one run available, invalid/missing selection ("pick two runs"), same run picked twice, and (inside `IssueLifecycleBand`) issues not available when either run lacks `issues.json`. `components/compare/`: `run-pair-selector.tsx` (two custom dropdowns, not native `<select>`, + a swap button), `compare-summary-tiles.tsx` (added/removed/changed/unchanged), `issue-lifecycle-band.tsx` (new/fixed/persisting), `added-removed-lists.tsx` (added pages link into the head run, removed pages link into the base run — never a dead link into the run that doesn't have the page, using the existing `findPageIdByUrl` from `lib/data-explorer.ts`), `changed-pages-table.tsx` (URL + per-field before→after chips via the existing `formatEvidenceValue` from `lib/data-issues.ts`, each row linking to `/pages/<pageId>?run=<headRunId>`).
- VERIFIED for real: `npx tsc --noEmit` clean in both projects. `npx vitest run` (seo-crawler-poc) → 343/344 passing, my 7/7 green; the 1 failure is `tests/unit/graph/pagerank.test.ts` (a concurrent sibling slice's own test, `src/graph/**` is this slice's do_not_touch, untouched). `npm run build` (seo-dashboard) → exit 0, `/compare` listed as a dynamic route, only pre-existing filesystem-tracing warnings (same class already present on `lib/data.ts` before this slice). Real CLI runs against real stored data: `npm run diff -- --base poc2-full --head auth-anon` → 0 added, 1 removed (`/guides/gear-repair`), 24 changed (site-wide `links.length` +1 on every page — a real nav change between the two crawls), 0 unchanged, issues not available (auth-anon has no `issues.json`); `npm run diff -- --base auth-anon --head auth-loggedin` → 6 added (the 5 `/members/*` pages + the logout endpoint), 0 removed, 0 changed, 24 unchanged, issues not available. Dashboard verified live on port 3104 (3100 — the user's live server — never touched; stopped 3104 cleanly after) via Playwright MCP in both light and dark theme: `/compare?base=poc2-full&head=auth-loggedin` (both runs analyzed) renders real tiles (6/1/24/0) + real issue lifecycle (76 new/17 fixed/185 persisting) + a scrollable added/removed list + a 24-row changed table, matching the CLI's numbers exactly on the shared pairs; clicked a changed-page link and landed on `/pages/dfd21bdfc4bb?run=auth-loggedin` correctly; `/compare` with no query params correctly defaulted to the two most recent runs; `/compare?base=poc2-full&head=poc2-full` → "Pick two different runs"; `/compare?base=does-not-exist&head=poc2-full` → "Pick two runs to compare"; `/compare?base=poc2-full&head=auth-anon` → real tiles + honest "Issue lifecycle not available" copy naming both real run ids. Zero console errors/warnings and zero non-200 network responses across every navigation. Screenshots (7, both themes + 4 states) in `sprints/breadcrumbs/c4-screens/`.
- Not committed: this slice runs in the shared working tree (not a separate git worktree — `sprints/spec.md`'s original POC-1 note about "no git" no longer holds now that `git status` shows an active `auth-crawling` branch, but the operating contract still reserves commits for explicit instruction) — changes are left staged-in-tree for the integrator, scoped exactly to `src/diff/**`, `tests/unit/diff/**`, one `package.json` line, and on the dashboard `app/compare/**` + `components/compare/**` + `lib/data-compare.ts` + the one nav-config.ts edit.

---

# Retrospectively reconstructed entries (documentation audit, 2026-08-13)

The four slices below shipped with **no WORK_LOG entry and no `sprints/breadcrumbs/*.json`** —
roughly a third of the crawler's shipped features were undocumented in this log. They were
reconstructed on 2026-08-13 from the shipped source, the committed tests, the commit messages, and
the artifacts on disk. Every statement below traces to one of those four sources.

Read them differently from the entries above. Those were written by the slice author as the work
happened and record what that author actually ran. These were not: **what was verified at build time
is not recoverable.** Where a commit message states a result it is quoted and attributed as such;
where it does not, this log says the verification is unknown rather than inventing a VERIFIED line.
No timeline beyond the commit dates is claimed.

## B — authenticated crawling + safety guard rails (reconstructed)
Commits `2cfc72f` "Crawl protected routes, and refuse to touch the dangerous ones" (crawler,
2026-08-12) and `4868fbc` "Add the Access section and the skipped-for-safety panel" (dashboard,
2026-08-12). Screens: `sprints/breadcrumbs/b3-screens/` (13 PNGs, light + dark) — the only
breadcrumb this slice left. In-code slice markers: `src/crawler/safety.ts`'s header says "Slice B2
implements"; the dashboard's `lib/types.ts` says "Additive (B3, ...)". No B1 marker survives.

- `src/models/types.ts`: `CrawlAuth` (`basic: {username,password}|null`, `cookie: string|null`,
  `headers: Record<string,string>`, plus C1's `formLogin`) — doc comment "Never persisted into run
  evidence." `CrawlSafety` (`excludePatterns`, `denyLogout`, `denyDestructive`) and
  `SkippedUrlRecord` (`url`, `reason: "logout"|"destructive"|"user-excluded"`, `matchedPattern`,
  `foundOn`) — a guarded URL is recorded as evidence, never silently dropped. `CrawlOptions` gains
  `auth?` and `safety?`.
- `src/crawler/safety.ts` (new, 104 lines): `LOGOUT_PATTERNS` (6: `/logout`, `/log-out`, `/signout`,
  `/sign-out`, `/logoff`, `/log-off`), `DESTRUCTIVE_PATTERNS` (10: `/delete`, `/remove`, `/destroy`,
  `/cancel`, `/unsubscribe`, `/revoke`, `/purge`, `/reset`, `/deactivate`, `/archive/`).
  `checkSafety()` evaluates user excludes first (plain case-insensitive substring), then logout,
  then destructive (both word-boundary matched, so `/delete` hits `/members/reports/q1/delete` and
  `/delete/123` but not `/undeleted-items`). `authHeaders()` builds `Authorization: Basic <base64>`
  + `Cookie`, then `Object.assign`s `--header` values **last** — so a custom header deliberately
  outranks both.
- **Asymmetric defaults, by design.** `defaultSafety(auth)` turns the guard rails ON only when
  credentials are present. The type's own doc comment states why: on an anonymous crawl
  `/how-to-cancel-a-subscription` is just an article, and skipping it would silently cost coverage.
  The flip side is a documented coverage tradeoff, asserted by a test that names it as such: on an
  authenticated crawl that same article **is** skipped as `destructive`.
- `src/crawler/crawl.ts`: `authHeaders` threaded into both passes — the Cheerio pass attaches them
  per-request via `makeSeedRequest`; the Playwright pass uses `page.setExtraHTTPHeaders(authHdrs)`
  in `preNavigationHooks`, with an in-code note that browser navigation ignores `Request.headers`
  entirely and that `context.addCookies` was rejected because it is domain-scoped and would need
  per-`--alias` duplication. `checkSafety` runs in the enqueue gate after robots + depth; a hit is
  deduped into `skippedByUrl` (a guarded path like `/logout` is typically linked from every member
  page) and written to `skipped.json` at the end of the run.
- Session-loss detection is deliberately partial and says so in the code ("basic — full detection is
  a later step"): `noteAuthResponse` warns **once** — `[auth] session may have expired at <url> —
  later pages may be anonymous` — on a 401/403 that follows at least one success. It never
  re-authenticates and never aborts.
- CLI (`src/index.ts`): `--basic-auth user:pass`, `--cookie "<header>"`, `--header "Name: Value"`
  (repeatable), `--exclude a,b,c` (one flag, comma-separated), `--no-safety` (prints a WARNING and
  clears both deny flags). Credentials are never printed: the startup banner names the method only
  (`auth: form-login|basic|cookie|headers|none`).
- DASHBOARD (B3): `components/new-crawl/AuthSection.tsx` (new, 409 lines) — collapsed-by-default
  "This site needs a login" switch → `none|basic|cookie|header` radio-cards (roving tabindex,
  arrow-key navigable) → method-specific fields (password and header-value inputs are
  `type=password`) → a mandatory `role="alert"` callout ("This crawl runs as your logged-in user …
  use a read-only test account") → a "Skip logout & destructive links" switch that **starts locked
  ON and cannot be changed until the Advanced disclosure is opened**, turning the knob red with a
  danger block when unchecked. `lib/crawl-runner.ts` mirrors the client's validation server-side
  ("never trust the client alone") and derives `authMethod` rather than accepting it.
  `app/failures/page.tsx` gains a "Skipped for safety" panel grouped by reason, with URL / matched
  pattern / found-on columns.
- Follow-up fix, same day: commit `e65c406` "Catch logout links that live in the query string".
  `safety.ts` now matches against `pathname + search`, not pathname alone. The in-code note records
  the incident verbatim: a query-string-only bait, `/api/session?action=logout`, evaded the pattern
  while a decoy plain `/logout` link was caught — and a live authenticated crawl followed the real
  one and logged itself out.
- TESTS: `tests/unit/crawler/safety.test.ts` — **22 cases**
  (`grep -cE "^\s*(it|test)(\.(only|skip|todo|concurrent))?\s*\(" tests/unit/crawler/safety.test.ts`,
  counted 2026-08-13), across `defaultSafety`, `checkSafety`, `authHeaders` and a named
  query-string-logout regression block.
- EVIDENCE ON DISK: runs `auth-anon`, `auth-loggedin` and `b2-anon-regression`.
  `storage/runs/auth-loggedin/skipped.json` holds exactly the two records the guard rails exist for —
  `/logout` (reason `logout`, matched `/logout`) and `/members/reports/q1/delete` (reason
  `destructive`, matched `/delete`), both `foundOn` `/members`.
- NOT RECOVERABLE: what the slice author ran to verify this at build time. The commits carry no
  verification claim beyond the incident description in `e65c406`.

## C1 — form login (reconstructed)
Commit `5a4f2cb` "Log in through a real form, for sites where a cookie cannot be pasted"
(2026-08-12). No breadcrumb, no screens, and no item spec survives — `sprints/brief.md` and
`sprints/spec.md` do not mention C1 or form login at all.

- `src/crawler/formLogin.ts` (new, 74 lines): `performFormLogin(config, context)` →
  `{ ok, cookies, error? }`, and `cookiesToHeader(cookies)` → `name=value; name=value`.
  `NAV_TIMEOUT_MS = 15000` is the single timeout reused for every step. **Never throws** — every
  failure mode returns `ok:false` with a reason so the caller can abort rather than silently proceed
  anonymous.
- **No selector heuristics.** Selectors are entirely operator-supplied, with CLI defaults
  (`input[name=username]`, `input[type=password]`, `button[type=submit]`). There is no autodetect,
  no fallback chain, and no retry — one attempt, one page.
- Submit deliberately races the navigation: `Promise.all([waitForLoadState("networkidle").catch(()
  => {}), page.click(submitSelector)])`, because a submit handler can navigate synchronously and
  awaiting the click first would race the navigation event. A networkidle timeout is swallowed — it
  is not a login failure.
- Success detection is two-tier: `--login-success-selector` when given, otherwise the fallback "did
  the server set *any* cookie", on the reasoning that a wrong-credentials submit that just re-renders
  the login page sets nothing. Both failure messages name the likely cause and point at the flag.
- Session handoff is a **serialized `Cookie` request header, not Playwright `storageState`**
  (`storageState` appears nowhere in `src/` or `tests/`) — deliberately, so the session rides
  `authHeaders()`'s existing Cookie path unchanged and reaches the Cheerio pass and the Playwright
  pass identically. `resolveEffectiveAuth` in `crawl.ts` launches its own throwaway Chromium, logs
  in, merges the cookie into `CrawlAuth.cookie`, and closes that browser in `finally`.
- Ordering: `resolveEffectiveAuth` runs **before** `new RunStore(...)` — "a failed login must leave
  no partial run directory behind". Failure is fatal with **no anonymous fallback**: it throws
  `Form login failed at <url>, aborting crawl (no anonymous fallback): …`, because "a half-anonymous
  authenticated crawl is worse than none".
- CLI: `--login-url`, `--login-user`, `--login-pass` (all-or-nothing — any one present requires all
  three, "a partially-specified form login is an operator mistake, not a silent skip"), plus
  `--login-user-selector`, `--login-pass-selector`, `--login-submit-selector`,
  `--login-success-selector`. `defaultSafety()` predates form login and only inspects
  basic/cookie/headers, so `src/index.ts` ORs `formLogin !== null` into the same "strict when
  credentials are present" default.
- Fixture: `../target-site/app/login/page.tsx` + `lib/session.ts` (`crawler-test` /
  `poc-demo-1234`, cookie `poc_session`) + `app/api/session/route.ts` + `proxy.ts` (Next 16's
  renamed middleware — the only place that can return a bare 401 before a page renders,
  `matcher: ["/members", "/members/:path*"]`). That route's `GET ?action=logout` is a deliberate
  bait: a plain `<a>` a crawler could follow via GET, which is what proves or disproves the safety
  guard.
- TESTS: `tests/unit/crawler/formLogin.test.ts` — **9 cases** (same grep, counted 2026-08-13). Not
  mocked: a real `node:http` server on port 0 and a real `chromium.launch()`, so the test exercises
  actual browser navigation and cookie behaviour. Covers success, success-via-successSelector, wrong
  credentials with and without a successSelector, a bad username selector, a login page with no form
  at all, an unreachable login URL, and `cookiesToHeader` join + empty-array.
- Commit-message claim, quoted not re-verified: "Both passes are authenticated, proven by all five
  protected pages returning 200 rather than 401."
- NOT HANDLED, and not acknowledged anywhere in the code: MFA/2FA, CAPTCHA, CSRF-token extraction,
  SSO/OAuth redirect flows, multi-step (email-then-password) forms, iframed or shadow-DOM login
  forms, and re-login on session expiry. Verified by grepping `src/`, `tests/`, this log and
  `sprints/` for `mfa|2fa|captcha|recaptcha|csrf|sso|oauth` — the only hits are the literal example
  cookie string `"session=abc; csrf=xyz"`.
- There is **no dashboard UI for form login** — `CrawlAuthInput` in `lib/crawl-runner.ts` has no
  `formLogin` field and no `--login-*` flag is ever emitted. Form login is CLI-only.

## C2 — internal PageRank over the crawled link graph (reconstructed)
Commit `d8bd875` "Compute internal PageRank over the crawled link graph" (2026-08-12, +510/−0
across 5 files). No breadcrumb, no screens, no surviving item spec.

- `src/graph/pagerank.ts` (189 lines): `computeGraph(pages, runId, opts?)` → `GraphReport`.
  `DEFAULT_DAMPING = 0.85` (exported), `DEFAULT_MAX_ITERATIONS = 100`, `DEFAULT_EPSILON = 1e-6`.
  Power iteration from `1/n`, convergence on `max|new − old| < epsilon`, `converged:false` recorded
  honestly when the iteration cap is hit instead.
- **Dangling nodes redistribute every pass**, with the reasoning in-code: a page with zero outlinks
  must spread its rank across every node each iteration or total rank leaks below 1.0. A test pins
  rank conservation at ≈1.0 for `maxIterations` ∈ {1, 2, 5, 100} — this is the classic
  implementation bug, and it is tested rather than assumed.
- Edge construction: internal links only, self-links excluded, targets outside the crawled set
  excluded, and **deduped per source page** — a nav logo and a footer link both pointing at `/` count
  as one edge. That is Screaming Frog's model, not Oncrawl's (which counts every occurrence); the
  raw occurrence count survives on `PageGraphScore.inlinks`, and only `uniqueInlinks` and the edges
  themselves are deduped.
- Presentation scaling follows Ahrefs' model: `internalRank` = `Math.log(rawRank)` min-max scaled to
  1–100 and rounded. Zero variance (a symmetric cycle, a single-page graph) scores everything 100 —
  every node is equally the best page available. `rawRank` is kept alongside so the maths stays
  auditable. `Number.EPSILON` floors the raw value so `Math.log` stays finite at damping 1.0.
- Node identity mirrors the analyzer's alias-safe key (`pathnameOf(primaryUrl(page))`), and
  `buildInlinkOccurrences` is imported verbatim from `src/analysis/rules/site/helpers.ts` so orphan
  and inlink evidence matches issue evidence exactly. Known inherited simplification, stated in the
  code: two URLs differing only in query string collapse to one node, first page wins.
- `orphans` = crawled 2xx pages with zero internal inlinks, seed excluded — 2xx-only deliberately
  mirrors `report/summary.ts`'s `orphanCandidates`, because a 404 with zero inlinks is a broken
  link, not orphaned content.
- Output: `src/graph/writeGraphReport.ts` writes `storage/runs/<runId>/graph.json` directly rather
  than through `RunStore` (owned by another slice per the brief) — so `graph.json` is deliberately
  outside the RunStore contract. `src/graph/cli.ts`: `npm run graph -- --run <runId> [--out storage]
  [--damping N] [--max-iterations N] [--epsilon N]`, printing a top-10-by-`internalRank` table.
- Determinism: output arrays are sorted `rawRank` desc, tie-broken by URL — never Map or object
  iteration order. `generatedAt` is the one non-deterministic field, and the determinism test
  explicitly overwrites it.
- TESTS: `tests/unit/graph/pagerank.test.ts` — **14 cases** (same grep, counted 2026-08-13): empty
  set, single page, 3-node cycle against the known answer 1/3, hub-and-spoke, the dangling-node
  conservation sweep, orphan-with-seed-excluded, a zero-inlink 404 that is *not* an orphan,
  duplicate-link dedupe, self-link exclusion, repeat-run determinism, depth taken verbatim from
  `crawl.depth`, `pageId` matching `RunStore.pageIdFor`, a non-default damping reported honestly,
  and the iteration-cap/`converged:false` path. **`cli.ts` and `writeGraphReport.ts` have no tests.**
- EVIDENCE ON DISK: exactly two `graph.json` files exist — `storage/runs/poc2-full/graph.json`
  (damping 0.85, 8 iterations, converged, top page `/blog` at rank 100 / rawRank 0.11602696) and
  `storage/runs/books-full-site/graph.json` (17 iterations, converged, top page inlinks 1286 /
  uniqueInlinks 1194). Both generated 2026-08-12T08:39Z.
- Commit-message claims, quoted not re-verified: "1,195 pages converge in 17 iterations, 149ms" (the
  iteration count matches `books-full-site/graph.json` on disk; the timing appears in no stored
  artifact), and two bugs found by running against real stored crawls rather than fixtures —
  self-links inflating inlink counts, and a crawled 404 reported as an orphan, caught by
  cross-checking against the crawler's own `report.json`.
- **No consumer.** Nothing reads `graph.json` — not the analyzer, not the report pipeline, and not
  the dashboard (`grep -riE "pagerank|internalRank|graph\.json|GraphReport" poc/seo-dashboard/` → 0
  matches outside unrelated "paragraph" / "Open Graph" strings). C2 is a standalone CLI pass.

## Screenshots — per-page thumb + full-page WebP capture (reconstructed)
Commit `c39a2d8` "Screenshot each page during the crawl, since replaying HTML cannot show a JS site"
(2026-08-13). No slice letter, no breadcrumb, no screens.

- `src/crawler/crawl.ts`: `captureScreenshot(page, normalizedUrl, finalUrl)` + `settleForThumb(page)`,
  called from exactly one place — the Playwright pass's `requestHandler`, gated on
  `options.screenshots`. Playwright-only by necessity: the Cheerio pass has no browser.
- **The flag forces escalation.** A page the JS heuristic would have left on the static pass is
  escalated anyway, tagged with the synthetic render signal `"screenshots:forced"` — a screenshot
  needs a browser. `--render never --screenshots` is therefore silently upgraded to the alternating
  pipeline. The flag also un-blocks `image`, `media` and `font` requests that the browser pass
  otherwise aborts, so bandwidth and memory rise before the extra load is even counted.
- Two captures per page, two mechanisms. Full: `page.screenshot({ type: "webp", quality: 80,
  fullPage: true })` on the already-loaded page. Thumb: a **second, disposable `BrowserContext`** at
  `{width:1368,height:768}` and `deviceScaleFactor: 0.25`, auth headers re-applied, and **a second
  full page load**. The reason is recorded in-code as verified there, not assumed: `deviceScaleFactor`
  is fixed at context creation and Playwright's screenshot sizing ignores a live CDP emulation
  override, so a genuinely downscaled thumb needs its own low-DSF context. The cost — one extra page
  load per page, **outside Crawlee's rps throttle** — is called out in the same comment as "an
  accepted cost for a POC evidence feature, not a production crawl path".
- Ordering constraint, documented twice in-code because it is load-bearing and untested: scrolling
  freezes LCP, so the required order is vitals → scroll → screenshot, never screenshot first.
- Storage: `RunStore.saveScreenshots()` writes `storage/runs/<runId>/screenshots/<pageId>.thumb.webp`
  and `<pageId>.full.webp` — **WebP, not PNG** — and returns forward-slashed run-relative paths.
  `CrawledPage.screenshot` is a deliberate tri-state: `undefined` = flag off or pre-screenshot run,
  `null` = flag on but this page's capture failed, object = success. It is never coerced to `null`,
  so "not attempted" stays distinguishable from "failed".
- Never fails the crawl: every capture path is caught, logs `[screenshot] capture failed for …`, and
  records `null`.
- Constants are hardcoded with no CLI surface: thumb viewport 1368×768, DSF 0.25, thumb quality 75,
  full quality 80, screenshot timeout 10s, thumb load timeout 30s, thumb settle cap 12s. The only
  flag is `--screenshots` (boolean, default off).
- DASHBOARD: `app/api/screenshot/[runId]/[pageId]/route.ts` serves the image (`?size=full|thumb`, a
  `SAFE_ID` allowlist plus a path-containment assert, `Cache-Control: immutable`);
  `components/preview/page-replay.tsx` adds a "Screenshot" tab alongside "Live page" and "Captured
  HTML", with the honest disabled-tab tooltip "No screenshot stored for this run — re-crawl with
  --screenshots".
- TESTS: **one**, at the storage layer — `tests/unit/report/runStore.test.ts`'s `saveScreenshots`
  case. `captureScreenshot` itself, the forced-escalation branch, the route-abort relaxation, the
  `--screenshots` CLI parse, the failure→`null` path and the dashboard route have **no test
  coverage**.
- EVIDENCE ON DISK: exactly one run has screenshots — `storage/runs/sagar-shots2/screenshots/`,
  holding one page's pair (`df4821b295cf.full.webp` 272 KB, `df4821b295cf.thumb.webp` 3 KB).
  `find storage -name '*.png'` → 0; the format is WebP throughout.
- KNOWN GAPS, found during this audit and not fixed here (documentation-only task):
  - **The thumb is written but never read.** The dashboard requests only `?size=full`; nothing
    anywhere requests `size=thumb`. The second context and second page load currently produce a dead
    artifact.
  - Error pages get no screenshot in `auto`/`never` mode — escalation is gated on `statusCode < 400`.
    Only `--render always` would capture them.
  - No retention policy, no size cap, no cleanup. At ~272 KB/page for the full capture, a 1,000-page
    run is roughly 270 MB of WebP.
  - `CrawlOptions.loadFonts` is read in `crawl.ts` but has **no CLI flag**, so it is unreachable
    except as a side effect of `--screenshots`.

## Images/performance merge — 4-way audit follow-up (2026-08-13)
Scope: `src/extraction/**` + `tests/unit/extraction/**` only. Read `scratchpad/audit/reports/datarules.md`
§2.7/§2.13 first — much of the images/performance gap the audit scored 3/10 and 2/10 was **already
closed** by prior work in this repo (srcset, `<picture>`, inline+`<style>`-block CSS backgrounds,
`<svg><use>`, `probeImageAsset` byte-size+header-decode with `sizeError` provenance, RDFa with OG
excluded via `SOCIAL_PREFIXES`, real TTFB via `httpTimingsFromGot`/`httpTimingsFromPlaywright` in
`crawl.ts`, and browser-observed `<img>` sizing via `readObservedImages`/`applyObservedImageSizes`,
all already wired). Did not duplicate any of that.

Added, taking from the 3-way audit per the brief:
- **`src/extraction/readability.ts` (new)** — Flesch Reading Ease + Flesch-Kincaid Grade, and 1-/2-word
  stopword-filtered keyword density. Reimplemented from Jemish's formula (same well-known 1948/1975
  formulas, zero dependency), wired into `content.ts`'s `extractContent()` as `content.readability` /
  `content.keywordDensity`.
- **`src/extraction/resourceHints.ts` (new)** — static (markup-only, no browser) script/stylesheet/
  preload inventory: async/defer/module flags, inline-script byte total, and a render-blocking flag
  per script/stylesheet (sync external `<head>` script; stylesheet not scoped to print/speech media).
  Closes the Kishan-only "script/stylesheet/preload inventory + inline-script bytes" and "render-blocking"
  gaps that drove the 2/10 performance score, entirely from markup — wired into `extractPage()` as
  `ExtractionResult.resourceHints`.
- **`src/extraction/images.ts`** — three new lazy-src fallback attrs from Nayan's list (`data-image`,
  `data-bg`, `data-fallback-src`, added to `SRC_ATTRS`). New pure functions, none wired into `crawl.ts`
  (out of scope — see below): `collectComputedBackgroundsInPage(cssScanLimit)` — a Playwright-serializable,
  self-contained collector (no inner named function/const-arrow bindings, per this repo's documented
  `__name()` esbuild trap) that sweeps computed `background-image`/`border-image-source`/`mask-image`/
  `list-style-image` across every element **and its `::before`/`::after`**, i.e. Nayan/Kishan's widest
  CSS-image sweep (external stylesheets + cascade + pseudo-elements, none of which the existing
  regex-based `extractBackgroundImages` can see); `mergeComputedBackgroundImages(existing, hits)` folds
  its results into new `ImageRecord`s (`kind:"background"`, `source:"computed-style"`, new
  `pseudoElement` field), deduped against what the static parse already found;
  `mergeNetworkObservedImages(images, backgroundImages, observed)` creates new `kind:"network"` records
  for browser responses matching no DOM node at all (canvas/CSS/JS-injected assets — Nayan's
  network-observed-image strength), matched on exact URL only and never trusting a non-2xx response's
  body as a byte size (the same 404-body trap `probeImageAsset` already guards against).
- `src/models/types.ts` — additive/optional only: `ImageKind` gained `"network"`; `ImageRecord` gained
  `pseudoElement?`/`networkContentType?`; new `ComputedBackgroundHit`, `NetworkObservedAsset`,
  `ResourceHints` (+ `ScriptResourceRecord`/`StylesheetResourceRecord`/`PreloadResourceRecord`),
  `ReadabilityReport`, `KeywordCount`, `KeywordDensityReport`. `PageContent` gained `readability?`/
  `keywordDensity?`; `ExtractionResult` gained `resourceHints?`. Older stored runs on disk still parse
  (every new field is optional).

**NOT done — needs wiring in `src/crawler/crawl.ts` (read-only for this slice, reporting rather than
editing per the brief)**:
1. Call `collectComputedBackgroundsInPage` via `page.evaluate(...)` in the Playwright `requestHandler`
   (same timing as the existing `readObservedImages` call), then
   `extraction.backgroundImages.push(...mergeComputedBackgroundImages(extraction.backgroundImages, hits))`.
2. Add a `page.on("response", ...)` listener in the Playwright pass (filtered to `content-type: image/*`
   or an image-extension regex, capped like `IMAGE_PROBE_CAP_DEFAULT`), then
   `mergeNetworkObservedImages(extraction.images, extraction.backgroundImages, observed)` and append
   the result.
3. Nayan's `img.decode()`-based settle, run **twice** (a second pass catches images whose `src` was
   assigned by script after the first settle), before `readObservedImages` — currently the browser pass
   has no explicit decode-settle step at all before reading `naturalWidth`.
4. A CSS-scan-limit constant (Kishan uses 4,000 elements) analogous to `IMAGE_PROBE_CAP_DEFAULT`, passed
   to `collectComputedBackgroundsInPage`.
No rules written (two sibling agents own the rulebook) — see "rules this enables" in the task report.

- `npx vitest run tests/unit/extraction`: **345/345 passing** (20 files; 3 new: `readability.test.ts`,
  `resourceHints.test.ts`, `images-merge.test.ts` — the latter exercises
  `collectComputedBackgroundsInPage`'s REAL code path against stubbed `document`/`window` globals, not
  jsdom, since this project has no DOM test environment configured).
- `npx tsc --noEmit`: 0 errors in `src/extraction/**` or `src/models/types.ts`. Project-wide, 4
  pre-existing errors in `src/analysis/rules/**` and 1 in `src/crawler/crawl.ts` at time of writing —
  sibling agents' concurrent in-progress work outside this slice's ownership (config keys /
  cancellation signal wiring), confirmed by re-reading those exact lines.

## Data-rules port wave — content/images/structured-data/social/security/render-divergence/fonts/head/transport (page) + duplicates/hreflang/orphans/link-consistency/favicons (site) (4-way audit)

Ported the subset of `datarules.md` §5 ("rules we don't have") that fell under this family and was
honestly portable against already-captured data. Most of the family's headline gaps (missing
recommended/unknown-type structured-data validation, viewport/charset/base-href rules, near-dup
detection, favicon/link-consistency rules, HTTPS/mixed-content) turned out to already be shipped by
a prior wave — datarules.md predates that landing. Net new:

- `zero-word-content` (content.ts, error) — wordCount===0 as its own deterministic finding,
  distinct from threshold-based thin-content.
- `low-readability` (content.ts, notice) — reads the pre-computed `content.readability` report
  (landed concurrently by a sibling extraction slice; originally hand-rolled the Flesch formula,
  switched over once the field existed to avoid two implementations of the same math). Gated to
  `contentAreaMethod === "article"` after a real spot-check on a books.toscrape.com crawl showed a
  category/nav-listing page (contentAreaMethod "body-minus-chrome") scoring Flesch ~18-26 despite
  being a genre-navigation strip, not prose — dozens of short polysyllabic category names with no
  real sentence structure tank the formula. Confirmed clean (0 false positives) on the same run
  after the gate; confirmed real firings on `20260813-112000-books` before the gate (Flesch 18-27
  on genuine category pages) and 0 after, all correctly re-attributable to non-article content.
- `oversized-html` (transport.ts, warning) — `pageStats.htmlBytes` past 500KB (Kishan's literal).
- `og-incomplete` (social.ts, notice) — names which of og:title/description/image/url are missing
  when the og map is non-empty (og-missing already owns the fully-absent case).
- `no-structured-data` (structured-data-report.ts, notice) — zero items across JSON-LD/microdata/
  RDFa; distinct from the existing `structured-data-no-json-ld`, which requires legacy markup to
  already be present.
- `render-added-nothing` (render-divergence.ts, notice) — a page escalated to a full browser
  render whose measured divergence shows zero gain (words/links/title/description/canonical/
  noindex all unchanged). Per-page adaptation of Kishan's site-level "renders produced nothing
  new" — our storage model only has per-page divergence, not his renderDiscards aggregate.
- `url-variant-duplicate` (site/duplicates.ts, warning) — same page reachable at case/
  `/index.html`/trailing-slash URL variants, corroborated by identical `content.contentHash` (never
  clusters on URL shape alone). True-positive-confirmed on real data: books.toscrape.com serves
  byte-identical content at `/` and `/index.html`.

Skipped (say-so, per the brief's hard rule against shipping a rule that can't fire honestly):
- Oversized image bytes, broken-image verification — no image byte-size field in this record
  (`ImageRecord` has no `bytes`); would need an extraction change out of this slice's ownership.
- Missing/no Cache-Control, no cache validators (ETag), missing Permissions-Policy — none of the
  three headers are in `crawl.ts`'s `KEPT_HEADERS`; can't fire honestly without an extraction change.
- `<html lang>` missing / RTL-without-`dir` — `<html lang>`/`dir` aren't captured anywhere in
  `ExtractionResult`.
- "Needed rendering, didn't get it" (Kishan) — our escalation decision and execution are the same
  step (`needsJsRendering` → immediate re-crawl), so there is no storable "wanted but didn't get"
  state the way Kishan's architecture has one.
- "www and non-www both serving 2xx" — requires a live out-of-band probe against the other host;
  not a rule over already-stored data.
- Keyword density — captured by the sibling extraction slice as `content.keywordDensity`, but no
  team in the 4-way audit runs a *rule* on it (Jemish captures it as data-only too); nothing to port.

Three near-duplicate rule ids collided with a concurrent sibling slice mid-build (`no-compression`
landed in both `transport.ts` and `http.ts`; `page-buried-too-deep` in both `orphans.ts` and
`links.ts`; `long-content-no-subheadings` in both `content.ts` and `on-page.ts`) — same source
material (Kishan/Jemish), independently ported by both of us before either noticed. Removed all
three from this slice's files in favor of the sibling's (`http.ts`/`links.ts`/`on-page.ts` own that
territory more naturally); kept `url-variant-duplicate`, which had no collision.

Near-dup decision (ours vs Nayan's SimHash): kept ours (MinHash-128 + LSH, 5-word shingles,
`nearDupSimilarity` 0.75). Nayan's `findDuplicateGroups` defaults `threshold = 0.9`
(`new-zip/src/duplicates.ts:35`) against 64-bit SimHash of word trigrams; our own measured Jaccard
for the seeded near-dup fixture pair is ~0.824 true / ~0.859 estimated (see similarity.ts's own doc
comment + WORK_LOG.md §C3) — Nayan's 0.9 cutoff would silently miss that exact pair by 0.0094, which
is the specific defect the brief calls out. Did not port SimHash.

- `npx vitest run tests/unit/analysis`: 642/642 passing (38 files) after the port.
- `npx tsc --noEmit`: 0 errors in any file this slice touched (content.ts, transport.ts, social.ts,
  structured-data-report.ts, render-divergence.ts, site/duplicates.ts, site/orphans.ts, site/
  index.ts, config.ts, analysis.config.json). Project-wide errors present at various points during
  this session were all in `src/crawler/crawl.ts`, `src/queue/runner.ts`, and test files under
  other slices' ownership — confirmed by filename, re-checked after each edit.
- `npx tsx src/analysis/cli.ts --run <real-run>` spot-checked against `20260813-112000-books` (150
  pages) and `books-full-site` (1195 pages, both books.toscrape.com): `no-structured-data` fires
  150/150 on the smaller run (true positive — the site ships no JSON-LD/microdata/RDFa anywhere,
  confirmed by inspecting `structuredDataReport.counts` directly); `url-variant-duplicate` fires on
  the real `/` vs `/index.html` pair on both runs (true positive, byte-identical contentHash
  confirmed); `low-readability` correctly reports data-unavailable (skipped) on both runs once
  gated to the sibling's not-yet-backfilled `content.readability` field — will only fire on a fresh
  crawl taken with the current extraction code.
