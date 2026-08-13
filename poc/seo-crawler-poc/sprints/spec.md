# Spec — seo-crawler-poc (POC-1) — sprint DAG

> brief.md is the contract. This spec slices the build. `surface: cli`, no deploy, no git
> (operating contract §0 — slices write to disjoint directories instead of worktrees; Main
> Claude owns all shared/foundation files and is the only integrator).

> **SUPERSEDED IN PART — audited 2026-08-13.** This is the POC-1 slice plan as dispatched and is kept
> as written. Where the shipped code diverged, the code is right and this document is not. Do not
> quote a number from here as a fact about the system:
>
> - `surface: cli` — it is **mixed**; `brief.md`'s own header says so and a full Next.js dashboard
>   shipped. ("no git" was true of `poc/` and remains so; the repo root does have a `.git/`.)
> - Foundation scripts "crawl / test / typecheck / bench" → **8** today, adding `postinstall`,
>   `analyze`, `diff`, `graph` (`poc/seo-crawler-poc/package.json`).
> - S8's 6 route skeletons (Overview, Runs, Pages, Failures & Blocked, Sitemap & Robots, page detail)
>   → **10 pages + 5 API routes** (`find ../seo-dashboard/app -name page.tsx`).
> - S9's "max pages (default 100, UI cap 300)" → the default 100 is still right; the **cap is now
>   1,000,000** (`../seo-dashboard/lib/crawl-runner.ts:263`).
> - S9's "spawns the crawler CLI (`npx tsx src/index.ts …`) **detached**" is wrong on both counts: it
>   spawns `process.execPath` with `--import tsx`, and is deliberately **NOT** detached — the code
>   carries the reason ("detached strips the console on win32"). ("last ~30 log lines" is still
>   accurate — 30 is the default of `tailLog`'s `maxLines` parameter, not a hardcoded value.)
> - S10/S13's page-detail section list ("every section fully built", 10 numbered) → the jump nav
>   carries **17** sections (`grep -cE '\{\s*id:\s*"' ../seo-dashboard/components/explorer/section-nav.tsx`).
> - A4's near-duplicate note "**minhash is Tier 2**, say so in the rule prose" is superseded — MinHash
>   + LSH shipped in `src/analysis/similarity.ts`, and the rule prose in
>   `src/analysis/rules/site/duplicates.ts` was updated to state the real method.
> - A5's `depends_on: A4's issues.json FIXTURE` is stale — A4 landed and real `issues.json` files are
>   produced end-to-end.
> - Slices **B (authenticated crawling), C1 (form login), C2 (PageRank)** and the screenshot capture
>   work are not in this DAG at all; they were dispatched later. Reconstructed entries for them are at
>   the end of `../WORK_LOG.md`.

## Foundation (Main Claude, BEFORE fan-out — not a slice)

- `package.json` (deps pinned: crawlee ^3, playwright, cheerio, robots-parser, fast-xml-parser,
  tldts, typescript, tsx, vitest, @types/node; scripts: crawl / test / typecheck / bench),
  `tsconfig.json`, `vitest.config.ts`, `.gitignore` (storage/, node_modules/).
- `src/models/*.ts` — the FULL shared type contract (CrawledPage, LinkRecord, ImageRecord,
  StructuredDataRecord, Redirect, FailureRecord + FailureClass, RobotsInfo, SitemapResult,
  CrawlScope, CrawlOptions, CrawlSummary, ExtractionResult).
- Typed stub files for every module below (compiling signatures with `throw new Error("stub")`
  bodies) so any slice can code against any other slice's interface from minute zero.
- `npm install` + `npx playwright install chromium` (background).

**Design DNA**: n/a (CLI). Console output should be clean and scannable (the plan §20 summary
block); no color libraries needed.

## Sprints

### S1 — url-intelligence
- mode: A · depends_on: [] · parallel_safe_with: [S2,S3,S4,S5,S6,S7]
- **Owns**: `src/url/**`, `tests/unit/url/**`
- Scope: `deriveScope(startUrl, hostAliases)` (registrable domain via tldts; www/non-www both in
  scope; aliased hosts — e.g. `summittrailgear.example` when crawling `localhost:3105` — are
  in-scope too), `remapAliasedUrl(url, scope)` (rewrites scheme+host of an aliased-host URL onto
  the seed origin so queue identity + sitemap cross-ref line up; non-aliased URLs pass through),
  `normalizeUrl(raw, base?)` (relative resolution, protocol+host lowercase, default-port strip,
  fragment strip, tracking-param strip [utm_*, gclid, fbclid, msclkid, ref], stable query-param
  sort, duplicate-param collapse, trailing-slash strip except root, percent-encoding
  normalization; returns null for non-http(s)/mailto/tel/javascript/data), `isInScope`,
  `uniqueKeyFor(normalizedUrl)`. Exhaustive unit tests incl. the plan §6 examples.

### S2 — extraction
- mode: A · depends_on: [] · parallel_safe_with: [S1,S3,S4,S5,S6,S7]
- **Owns**: `src/extraction/**`, `tests/unit/extraction/**`, `tests/fixtures/html/**`
- Scope: cheerio-based pure extractors over `{ html, url, finalUrl, statusCode, headers,
  responseTimeMs }`: metadata (title, metaDescription, canonical resolved absolute, robots meta
  incl. noindex/nofollow + X-Robots-Tag header merge), headings (h1/h2/h3 text arrays), links
  (resolve vs <base href> + finalUrl; anchor text; rel/nofollow/sponsored/ugc/target; internal vs
  external needs CrawlScope — take it as arg), images (resolved src, alt null-vs-empty
  distinction, width/height as numbers when present, format from extension), structured data
  (every application/ld+json block: raw always; parsed or parseError), content (script/style/nav
  noise removed → text, wordCount, sha256 contentHash normalized-whitespace), aggregate
  `extractPage(...)` returning ExtractionResult. Unit tests with HTML fixtures covering every
  seeded-issue shape from brief §6 (missing title, dup titles, no-alt img, BMP format, missing
  dimensions, invalid JSON-LD, Recipe-on-article, second H1, H1→H3 jump, http:// internal link,
  www absolute link, canonical-to-other-URL, thin content).

### S3 — discovery
- mode: A · depends_on: [] · parallel_safe_with: [S1,S2,S4,S5,S6,S7]
- **Owns**: `src/discovery/**`, `tests/unit/discovery/**`, `tests/fixtures/xml/**`
- Scope: `fetchRobots(origin)` → RobotsInfo (status, raw content, sitemap declarations,
  isAllowed(url), parseStatus; 404 robots = allow-all, recorded); `discoverSitemaps(robots,
  origin)` → SitemapResult (tries declarations + /sitemap.xml fallback; recurses sitemap
  indexes; per-URL source file attribution; malformed-XML and fetch errors preserved as
  evidence, never thrown). Plain `fetch` + robots-parser + fast-xml-parser. Unit tests with
  fixture XML (urlset, index→children, malformed, gzip optional-skip note).
- **Alias contract (plan-review-2 resolution)**: S3 is alias-AGNOSTIC by design — it fetches
  what it is given and returns entries/declarations AS AUTHORED. The caller (S4) remaps
  aliased-host sitemap declarations through `remapAliasedUrl` BEFORE `discoverSitemaps`, and
  remaps entry URLs before seeding. Accepted limitation: aliased-host CHILD sitemaps inside a
  sitemapindex are fetched literally (absent from the POC matrix; recorded here).

### S4 — crawler-core
- mode: A · depends_on: [] (codes against foundation stubs) · parallel_safe_with: [S1,S2,S3,S5,S6,S7]
- **Owns**: `src/crawler/**`, `src/index.ts`
- Scope: CLI arg parsing (node:util parseArgs → CrawlOptions incl. `--alias host[,host...]`; no
  new deps); crawl orchestration:
  seed queue (start URL + sitemap URLs w/ discoverySources — **robots.sitemaps declarations are
  remapped via `remapAliasedUrl` BEFORE calling `discoverSitemaps`, and sitemap entries are
  remapped → normalized → scope-filtered before seeding; the target-site robots.txt declares its
  sitemap on the aliased host, so an unmapped fetch DNS-fails** — plan-review-2), Crawlee CheerioCrawler as primary
  (uniqueKey = normalized URL, maxRequestsPerCrawl, maxConcurrency, per-host rate limit,
  timeouts, retries/backoff via Crawlee), robots gate (blocked → recorded, not fetched),
  redirect-chain capture (Crawlee/got response chain), depth/parent propagation via userData,
  enqueue discovered in-scope links (alias-remapped via S1), external links recorded only;
  calls S7's `needsJsRendering` → escalate that URL to a PlaywrightCrawler instance for
  re-fetch + re-extract from rendered DOM (`renderedWith: "playwright"`, `--render
  never|always` overrides); redirect-loop + failure classification into FailureRecord; wire
  extraction/storage/report through their stub interfaces. This slice is the integrator's
  biggest risk — keep module boundaries exactly as the stubs define them.

### S5 — storage-report
- mode: A · depends_on: [] · parallel_safe_with: [S1,S2,S3,S4,S6,S7]
- **Owns**: `src/storage/**`, `src/report/**`, `tests/unit/report/**`
- Scope: `RunStore` (storage/runs/<runId>/: raw/<pageId>.html, pages/<pageId>.json,
  failures.json, blocked.json, robots.json, sitemaps.json, report.json; pageId = 12-char sha256
  of normalizedUrl; async-safe appends; robots-blocked URLs are NOT failures — they live in
  blocked.json via `saveBlocked` and the summary's `blockedByRobots`); report builder: CrawlSummary from the run's records
  (discovered/unique/allowed/attempted/successful/failed/blocked/redirect count/status
  histogram/js-rendered/internal+external link totals/orphan candidates = crawled pages with 0
  internal inlinks excl. seed/duration/coverage %), `printSummary` in the plan §20 console
  format, plus `sitemapCrossRef` (in-sitemap-not-crawled, crawled-not-in-sitemap, sitemap-404s)
  — **cross-ref matches by pathname+search, host-agnostic (plan-review-2): sitemap entries are
  authored (possibly aliased-host) URLs while page records store remapped normalized URLs; the
  remap preserves path/query, so path matching is exact for the alias case.**
  Unit tests on fixture record sets.

### S6 — bench-harness
- mode: A · depends_on: [] · parallel_safe_with: [S1,S2,S3,S4,S5,S7]
- **Owns**: `scripts/**`
- Scope: `scripts/serve-target-site.ts` (or .ps1+.sh pair): production-build + start
  `../target-site` on port 3105 (check port free first; never kill others' processes);
  `scripts/bench.ts`: runs the brief §4 test matrix via the CLI (child_process), collects each
  run's report.json into `storage/bench/<timestamp>/`, emits `POC-1-REPORT.md` skeleton with
  per-target coverage tables + seeded-evidence checklist (evidence lookups against stored page
  JSONs). MUST NOT modify `../target-site` source. Verify target-site `npm run build` passes.

### S7 — js-detection
- mode: A · depends_on: [] · parallel_safe_with: [S1,S2,S3,S4,S5,S6]
- **Owns**: `src/detection/**`, `tests/unit/detection/**`, `tests/fixtures/detection/**`
- Scope: `needsJsRendering(html, extraction, scope)` — the plan §18 heuristic: tiny body
  (< ~1.5KB meaningful markup), app-shell/framework markers with empty roots (`<div id="root">
  </div>`, `<div id="__next"></div>`, `data-reactroot`, vue/angular mount points), low
  text-to-markup ratio, zero same-domain links AND near-zero visible text in static HTML,
  `<noscript>` "enable JavaScript" markers. Conservative: false positives cost a Playwright
  fetch, false negatives cost evidence — bias slightly toward escalation, but a normal
  content-rich SSR page must never escalate. Returns every fired signal by name (they land in
  `CrawledPage.renderSignals`). Fixture-driven unit tests: CSR app shell (quotes.toscrape.com/js
  shape), rich SSR page, tiny static page (example.com shape — must NOT escalate), noscript-only
  page, empty-body 200.

### S8 — dashboard-scaffold (UI wave 1)
- mode: A · depends_on: [] · parallel_safe_with: [all] · **blocks S9, S10**
- **Owns**: `../seo-dashboard/**` (new Next.js app) — this wave, everything in it
- Scope: create-next-app (TS, App Router, Tailwind v4) at `poc/seo-dashboard`, port 3100;
  design-dna.md §3 token system (light+dark, `[data-theme]`, no-flash script, toggle
  persisted); §4 full-height app shell (sidebar + topbar + scrollable main, responsive
  collapse); `lib/data.ts` fs readers over `../seo-crawler-poc/storage/runs/**` (listRuns,
  getRun, getPages filter/search/sort, getPage, getBench) + `CRAWLER_STORAGE_DIR` env; UI
  primitives (Card, Chip, Badge, DeltaPill, StatValue, Skeleton, EmptyState, ThemeToggle,
  Button, Table shell); route skeletons with honest placeholders (Overview, Runs, Pages,
  Failures & Blocked, Sitemap & Robots, page detail). lucide-react icons only.

### S9 — dashboard-overview + dynamic crawl trigger (UI wave 2, after S8)
- mode: A · depends_on: [S8] · parallel_safe_with: [S10]
- **Owns**: `../seo-dashboard/app/(overview)/**` (or app/page.tsx), `../seo-dashboard/app/api/crawls/**`, `../seo-dashboard/components/charts/**`, `../seo-dashboard/components/overview/**`, `../seo-dashboard/lib/crawl-runner.ts`
- Scope: the design-dna §2 Overview — action cards row, KPI strip w/ prev-run deltas, hex-matrix
  status chart + dot-matrix timeline (custom SVG per §5 chart rules), "Pages that need you"
  table, run-selector + filter chips, Export (report.json download). ui-feedback-loop
  discipline (Playwright screenshots both themes).
- **"+ New crawl" = REAL dynamic crawl trigger (Sagar, 2026-08-11 — hard POC-1 requirement:
  input any website link, the system crawls it per the documentation).** Slide-over form:
  start URL (required, http/https validated), max pages (default 100, UI cap 300), respect
  robots (default on), render mode (default auto), optional host aliases. Submit → POST
  `/api/crawls` → `lib/crawl-runner.ts` spawns the crawler CLI (`npx tsx src/index.ts <url>
  ...` with cwd = ../seo-crawler-poc) detached, runId = `ui-<yyyymmdd-hhmmss>`, stdout/stderr
  piped to `storage/runs/<runId>/crawl.log`, wrapper writes `.crawl-status.json`
  {state: running|done|failed, pid, startedAt, exitCode} on spawn/exit. GET
  `/api/crawls/<runId>` returns status + last ~30 log lines + report-ready flag. Panel shows
  live progress (poll ~2s: status line + log tail), completion state switches the dashboard to
  the new run; failure state shows exit code + log tail with retry. Server-side politeness
  guards: rps default 2 for non-localhost hosts, maxPages clamp, reject non-http(s). One crawl
  at a time (409 when one is running — POC). Empty-runs empty state points here ("Crawl your
  first site").

### S10 — dashboard-explorer (UI wave 2, after S8)
- mode: A · depends_on: [S8] · parallel_safe_with: [S9]
- **Owns**: `../seo-dashboard/app/pages/**`, `app/failures/**`, `app/sitemap/**`, `app/runs/**`, `../seo-dashboard/components/explorer/**`
- Scope: Pages explorer (filter chips, URL search, sortable columns, status/renderedWith/depth
  facets), Failures & Blocked view (failure classes, blocked list + robots evidence), Sitemap &
  Robots view (cross-ref: in-sitemap-not-crawled / crawled-not-in-sitemap / sitemap 404s +
  robots.txt content), Runs list. Same feedback-loop discipline.
- **Page evidence detail — HARD POC-1 REQUIREMENT (Sagar, 2026-08-11): every section fully
  built, none stubbed.** Route `/pages/[id]?run=` renders the complete CrawledPage:
  1. Header band: URL, status chip, renderedWith badge + renderSignals list, fetchedAt,
     response time, crawl meta (depth · parentUrl link · discoverySources chips).
  2. Metadata: title + char count, metaDescription + char count, canonical (flag when it points
     at a different URL than the page), robots (raw meta values, noindex/nofollow flags,
     x-robots-tag header) — null vs empty rendered distinctly, never blank cells.
  3. Headings: h1/h2/h3 in document order (level-indented list) + per-level counts.
  4. Links: table of every link — anchor, target AS AUTHORED, targetNormalized, internal/
     external, rel + nofollow/sponsored/ugc badges — with internal/external filter + counts.
  5. Images: table — src, alt (null="missing" badge vs empty-string="empty" badge — the seeded
     distinction must be visible), width×height ("—" when absent), format (BMP flagged).
  6. Structured data: one card per block — raw JSON (mono, scrollable) + parsed-OK state or the
     parseError message highlighted; the seeded truncated block must render its raw + error.
  7. Content: wordCount, contentHash, collapsible extracted-text preview.
  8. Redirect chain: hop list from → to with per-hop status codes (2-hop /old-gear must render).
  9. Captured headers subset.
  10. Actions: "Open raw HTML" (API route streams storage raw/<pageId>.html) + "Download raw",
      "Copy JSON" (full record to clipboard) + "Download JSON".
  Every section has an explicit empty state ("No structured data on this page"). QA-User grades
  this view field-by-field against the stored JSON of at least 2 real pages (one seeded-issue
  page, one redirected page).

## POC-2 wave (A1-A5, approved 2026-08-12) — brief §6b is the contract

### A1 — extraction-extensions
- depends_on: [foundation-v2] · parallel_safe_with: [A2,A3,A4,A5]
- **Owns**: `src/extraction/**` (extend existing modules + new social.ts/hreflang.ts/pageStats.ts), `tests/unit/extraction/**`, `tests/fixtures/html/**` (additions)
- Scope: og:*/twitter:* meta capture (raw map, ordered); titles[]/metaDescriptions[]/h1 ALL
  instances (existing single fields stay = first instance, back-compat); pixel-width estimate
  for title/desc (char-width table approximating Google SERP Arial — document the table's
  provenance in a comment; exactness NOT required, flag as estimate); hreflang from <link
  rel="alternate" hreflang> (lang code + resolved href); metaRefresh (content parsed:
  delay+url); metaKeywords; pageStats (htmlBytes from artifact, textRatio, domNodes via
  cheerio traversal, contentEncoding + httpVersion passed in via FetchArtifact extension).
  Tests per field incl. multi-instance + absent cases.

### A2 — crawler-capture-v2
- depends_on: [foundation-v2] · parallel_safe_with: [A1,A3,A4,A5]
- **Owns**: `src/crawler/**`, `src/index.ts`, `src/storage/runStore.ts` (EXTEND, don't rewrite
  — plan-review MF-1: add saveStaticRaw + saveExternalChecks; keep every existing method
  byte-compatible)
- Scope: KEPT_HEADERS += security headers (strict-transport-security, content-security-policy,
  x-frame-options, x-content-type-options, referrer-policy) + content-encoding; httpVersion
  capture (got response.httpVersion; playwright: protocol via response — best-effort, null ok);
  dual storage on escalation: keep static HTML as `raw/<pageId>.static.html`, rendered stays
  `raw/<pageId>.html`, compute renderDivergence by extracting BOTH and diffing (title, desc,
  canonical, robots.noindex, links.length, wordCount) → CrawledPage.renderDivergence; optional
  `--check-external` (HEAD external links, cap 50/run, rps-limited, results into a new
  `external-links.json` via RunStore stub extension); wire FetchArtifact extras.

### A3 — analysis-engine + page rules
- depends_on: [foundation-v2] · parallel_safe_with: [A1,A2,A4,A5]
- **Owns**: `src/analysis/engine.ts`, `src/analysis/config.ts`, `src/analysis/rules/page/**`, `tests/unit/analysis/page/**`
- Scope: rule engine per foundation types (registry, config load/merge/validation, severity
  override support, evaluate pages iteratively, findings assembly w/ evidence pointers =
  JSON-path-ish refs into the stored record); `analysis.config.json` defaults (title 30-60
  chars + pixel bounds, desc 70-155, thin <80 words, etc. — document every default's source);
  page-level rule packs: on-page (title/desc/H1 missing/multiple/short/long, heading
  hierarchy), indexability (noindex, canonical mismatch/absent, meta-refresh), images
  (missing/empty alt, BMP/format, missing dims), structured-data (parseError, type-vs-context
  where derivable, **and required-property checks for common @types — Product needs offers,
  Article needs headline, FAQ needs mainEntity; document exactly which Google rich-result
  requirements are covered — plan-review MF-4; the seeded #11c "Product missing offers" MUST
  be detectable**), social (missing OG/Twitter), content (thin, low text-ratio), http
  (status-based, slow-page threshold), security-header notices. **Severity discipline
  (MF-5): deterministic-fact rules (missing title, noindex, 4xx) may default error; heuristic/
  threshold rules (thin content, low text-ratio, slow page, weakly-linked, near-dup) MUST
  default warning or notice.** Rules degrade gracefully when a field is `undefined` (pre-v2
  runs — the v2 fields are OPTIONAL in types.ts per MF-2): finding skipped + rule listed in
  rulesSkippedDataUnavailable, never false fire; `undefined` ≠ empty capture. Unit tests per
  rule (fires + doesn't-fire + data-missing cases).

### A4 — analysis-site-rules + store + CLI + gate
- depends_on: [foundation-v2] · parallel_safe_with: [A1,A2,A3,A5]
- **Owns**: `src/analysis/rules/site/**`, `src/analysis/store.ts`, `src/analysis/cli.ts` (+ package.json script via Main Claude), `scripts/analyzer-gate.ts`, `tests/unit/analysis/site/**`
- Scope: site-level passes over the full run: duplicate title/desc clusters, exact-dup
  contentHash clusters + near-dup candidates (wordCount proximity ≤5% as POC proxy — minhash
  is Tier 2, say so in the rule prose), orphan candidates (report field + sitemap set
  algebra), sitemap hygiene (404-in-sitemap, noindex-in-sitemap, in-sitemap-not-crawled,
  crawled-not-in-sitemap), robots-blocked inventory, redirect chains>1 + loops (from records/
  failures), hreflang reciprocity (when captured), weakly-linked pages (1 inlink),
  **canonical-target validity (canonical → 4xx/5xx/redirect/noindex — cross-page lookup) and
  broken internal links (link targetNormalized → failure record / 4xx page) — both A4
  site-scope per plan-review MF-3**; issues.json
  writer (rulebookVersion, config snapshot, healthScore, counts, issues[]); Health Score;
  `npm run analyze -- --run <id> [--config path]`; the GATE script per brief §6b (manifest
  live-grep → expected rule hits per URL → PASS/FAIL table like evidence-check.ts).
- **Gate precision (plan-review MF-5)**: the gate's expectation table maps EACH manifest item
  to (expected rule id(s), expected URL(s), expected MINIMUM severity — heuristic-nature items
  #9 weakly-linked/#17 thin/#18 near-dup expect warning-or-notice, deterministic items expect
  error-or-warning as appropriate; the table is explicit in the gate source). "Clean pages" =
  crawled 2xx pages of the acceptance runs whose source files carry ZERO `seeded:` comments
  (derived from the live grep, listed in gate output). False-positive bar: no ERROR-severity
  finding on a clean page; warnings/notices on clean pages are reported for eyeballing but
  don't fail the gate.

### A5 — dashboard-issues-UI
- depends_on: [foundation-v2 + A4's issues.json FIXTURE (provided by foundation)] · parallel_safe_with: [A1,A2,A3,A4]
- **Owns**: `../seo-dashboard/app/issues/**`, `../seo-dashboard/components/issues/**`, `../seo-dashboard/lib/data-issues.ts`, Issues section in `app/pages/[id]/page.tsx` (surgical addition to the section list + nav), Health Score card wiring in `components/overview/action-cards.tsx` (surgical), `lib/crawl-runner.ts` post-crawl auto-analyze (spawn analyze after crawl exit 0/2 — same windowsHide non-detached discipline).
- Scope: /issues view per design-dna v1+v2 (rule groups: severity chip, affected count, %
  coverage, expand → affected URLs → page detail links; severity filter chips; run selector
  respected; empty state "run analyze"/"no issues"); page-detail Issues section (per-page
  findings w/ evidence rendered as field:value pairs; **jump links ONLY to fields that have an
  existing display section (title/meta/robots/headings/links/images/schema/content/redirects/
  headers) — evidence for sectionless fields (social/hreflang/pageStats) renders its value
  INLINE in the issue card, no dead links — plan-review MF-5b**);
  Overview Health Score (replaces nothing — augments coverage card area per design-dna Law 5);
  data layer reads issues.json (optional-safe for runs without it). Playwright verify both
  themes vs the foundation fixture + a real analyzed run if A4 lands in time.

## do_not_touch (every slice)

`sprints/**`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/models/**`
(contract changes go through Main Claude as a BLOCKED return), any directory owned by another
slice, `../target-site/**` source (S6 may run its npm scripts only).

## Integration (Main Claude, after slices return)

Replace remaining stubs, `npm run typecheck`, `npm test`, first end-to-end crawl against
target-site, fix seams. Then Phase 3 dual QA.
