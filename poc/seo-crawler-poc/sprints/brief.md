# Brief — seo-crawler-poc (POC-1: Crawler)

> POC-1 of the Autonomous SEO Platform (SPEC.md §25, Deliverable 5.1: "crawl website").
> Source plan: `docs/phase 1_POC_crawler.md` — that document IS the requirements spec; this brief
> distills it into a buildable contract. Binding tech decisions: D-01 (Node/TS), D-02 (Crawlee
> hybrid static-first with Playwright escalation).

```yaml
surface: mixed                 # CLI crawler + full-page web dashboard (Sagar, 2026-08-11 16:0x:
                               # reference-driven UI, light+dark, full height/width, no modal shell)
build_class: port              # re-derived per plan-review-1 Q8: the parity bar is plan §27 + the 18
                               # seeded-evidence items — 90 min target / 150 min ceiling
qa_depth: deep                 # 7 slices (>6) trips the derivation rule; deep checks run in QA Round 1
dangerous_actions: []          # read-only GET crawling; politeness caps below are hard requirements
capabilities:
  db: no
  auth: no
  api_routes: no
  external_deploy: no
  secrets: no
  background_jobs: no
qa_user_test_creds: n/a (single-user CLI)
```

## 1. Product Overview

A command-line crawler that proves the crawl/data-ingestion foundation for the Autonomous SEO
Platform:

```
npm run crawl -- <startUrl> [--max-pages N] [--concurrency N] [--no-robots] [--render auto|never|always]
```

Given a domain it must: discover pages (HTML links + robots.txt + sitemap.xml incl. sitemap
indexes), crawl them recursively (static-first HTTP via Crawlee CheerioCrawler; escalate to
Playwright only when JS-detection says the static HTML is insufficient), extract the full
SEO-relevant record per page, preserve raw evidence, classify failures, and finish with a
measurable coverage report.

**POC-1 proves architecture + crawler capability. It is NOT the production distributed platform.**
No PostgreSQL/Redis/queues/AI/GSC — local file storage only (plan §3, §22).

## 2. Core Elements (make-or-break)

1. **Recursive same-domain crawl** from a start URL; discovery via HTML links AND sitemap
   (robots.txt → sitemap declarations → sitemap index → sitemaps), with per-URL
   `discoverySources` recorded (`html-link`, `sitemap`, `seed`), merged when found via both.
2. **URL intelligence**: normalization (protocol, host casing, default ports, fragment strip,
   tracking-param strip, query-param ordering, trailing-slash policy), dedup via normalized
   identity, scope enforcement (same registrable domain; www/non-www treated as in-scope but the
   crossing is preserved in evidence), depth + parentUrl tracking, external links recorded but
   never crawled.
3. **CrawledPage extraction** (the schema in §5 below): status, redirect chain, final URL,
   canonical, robots meta (noindex/nofollow) + X-Robots-Tag header, title, meta description,
   H1/H2/H3, images (src/alt/width/height/format), links (resolved absolute, internal/external,
   anchor text, rel/nofollow/sponsored/ugc/target), JSON-LD structured data (parsed when valid,
   raw + parse-error preserved when invalid), text content + word count + content hash,
   response time, depth/parent/discoverySources.
4. **Hybrid rendering**: HTTP-first; JS-detection heuristic (tiny body, app-shell markers, low
   text-to-markup ratio, framework markers with empty roots, no same-domain links in static
   HTML); escalate that page to Playwright, re-extract from rendered DOM, record `renderedWith`.
5. **robots.txt compliance** (on by default, `--no-robots` to override for the POC's own test
   site): blocked URLs are recorded as `blocked`, never fetched; robots.txt itself stored as
   evidence with status/content/sitemap declarations/parse status. "Crawler cannot access page"
   is kept distinct from "page accessible but has noindex".
6. **Reliability**: per-request timeout, retries with backoff, rate limiting + bounded
   concurrency (politeness defaults: concurrency ≤ 5, ≤ 10 req/s local target, ≤ 2 req/s
   external sites), max-pages guard (infinite-crawl protection), failure classification
   (timeout / dns / 4xx / 5xx / redirect-loop / parse-error), redirect-loop detection.
7. **Evidence storage + coverage report** on disk per crawl run:
   `storage/runs/<runId>/raw/*.html`, `pages/*.json`, `failures.json`, `report.json` + a
   human-readable console summary matching plan §20 (discovered / unique / allowed / attempted /
   successful / failed / blocked / redirects / 404 / 5xx / JS-rendered / internal links /
   external links / orphan candidates / duration / coverage %).

### 2b. Dashboard core elements (added by Sagar mid-build — reference-driven UI)

8. **Full-page analytics dashboard** (`poc/seo-dashboard`, Next.js, port 3100) over the crawl
   evidence on disk, modeled on Sagar's reference image and bound by `sprints/design-dna.md`:
   sidebar app shell (full height/width, NEVER a centered modal), action cards with CTAs, KPI
   strip with real deltas vs previous run, hex-matrix status chart + dot-matrix crawl timeline
   (custom SVG), "Pages that need you" work-queue table, page-level evidence drill-down (full
   CrawledPage + raw HTML), run selector, light AND dark theme (toggle + system), WCAG-AA
   contrast, keyboard/reduced-motion support. Reads `storage/runs/**` via server-side fs —
   no DB, no auth, no fabricated numbers: every figure traces to a stored record.
   **The page evidence detail ships COMPLETE in POC-1 (Sagar): headings, links, images,
   structured data, content, redirect chain, headers, raw HTML access, copy/download JSON —
   full section list + acceptance in spec.md S10.**
   **Dynamic crawl from the UI ships in POC-1 (Sagar): paste any website link into "+ New
   crawl" → the system actually crawls it (spawned crawler run, live progress + log tail,
   run appears in the dashboard on completion) — contract in spec.md S9. QA-User must execute
   a real UI-triggered crawl end-to-end.**

## 3. Highest-Leverage Features (ranked, full list)

1. Core crawl loop (Crawlee RequestQueue + CheerioCrawler) — everything depends on it.
2. URL normalization/scope/dedup — correctness of the whole frontier.
3. Extraction layer producing the stable CrawledPage schema — the contract every later POC consumes.
4. Sitemap + robots discovery with per-source attribution.
5. JS-detection + Playwright escalation.
6. Coverage report + failure classification.
7. Bench harness: scripted runs of the full test matrix producing a POC-1 report.
8. (Eventually, NOT in this POC) resume support; distributed workers; DB-backed storage.

## 4. Test matrix (proof runs — the POC deliverable)

| Target | Type | What it proves |
|---|---|---|
| `poc/target-site` (local Next.js, port 3105) | Controlled site with **18 seeded issue classes** | Extraction evidence completeness — every seeded issue must be visible in stored records (see §6) |
| Same, `/old-gear`, `/loop-a` | Redirect chain + redirect loop | Redirect capture + loop classification |
| `https://books.toscrape.com` (cap 150 pages) | Static, ~1000 pages | Static crawl at modest scale, pagination, coverage math |
| `https://quotes.toscrape.com/js/` (cap 30) | Client-side rendered | JS-detection fires, Playwright fallback extracts content invisible to HTTP |
| `https://example.com` | Trivial | Smoke |

External crawls are read-only GETs with the politeness caps above — no logins, no forms, no writes.

## 5. The CrawledPage schema (stable contract — plan §13)

As defined in `src/models/` (Redirect, Link, Image, StructuredData, CrawledPage, CrawlSummary,
FailureRecord). The plan doc §13 interface is the baseline; additions: `normalizedUrl`,
`contentHash`, `headers` (subset: content-type, x-robots-tag), `renderedWith: "http" | "playwright"`,
`fetchedAt`, `runId`.

## 6. MVP Acceptance Criteria

The plan doc §27 checklist is the acceptance contract (Discovery / URL processing / HTTP / SEO
extraction / Browser / Reliability / Storage / Benchmark blocks). Additionally, on the seeded
target-site the stored records must contain the raw evidence for all 18 seeded manifest classes,
e.g.: `/about` record has `title: null` + `metaDescription: null`; duplicate title pair visible
across the two blog records; `/products/switchback-trekking-poles` has `robots.noindex: true`;
`/gear-archive` crawled (via direct seed or sitemap-absence noted) with zero inlinks → orphan
candidate; `/guides/*` recorded as `blocked` under robots mode; sitemap report lists the 404
sitemap entry `/guides/gear-repair` and the four omitted-but-linked pages; `/old-gear` shows the
2-hop redirect chain; `/loop-a` classified `redirect-loop`; invalid JSON-LD on
`/blog/choosing-hiking-boots` preserved raw with parse error; near-duplicate pair shares similar
contentHash/wordCount evidence; http:// and www absolute internal links preserved in link records.

**The crawler does NOT judge/detect issues (that is POC-2, the analyzer). It must only make the
evidence unambiguously present in its output.**

## 6b. POC-2 + Crawler v2 Tier 1 (approved by Sagar 2026-08-12 — "okay go")

Grounding: `research/crawler-advanced-competitive.md` (4-lane competitive research) + SPEC §6
+ D-08 (deterministic rulebook; AI never decides issue-hood).

**Tier 1 — record completeness (crawler)**: social tags (og:*/twitter:*), multi-instance
titles/metaDescriptions/H1 capture, title/desc pixel-width estimate, hreflang (head links),
meta refresh + keywords, pageStats (htmlBytes, textRatio, domNodes, contentEncoding,
httpVersion), security headers captured, dual raw+rendered HTML storage on escalation with
renderDivergence (title/desc/canonical/robots/linkCount/wordCount raw-vs-rendered), optional
capped external-link checking (`--check-external`). Old runs stay readable (new fields
optional on the read side).

**POC-2 — the analyzer** (SPEC §25 deliverable 5.2): deterministic rule engine over stored
run evidence → `storage/runs/<runId>/issues.json`. Rules = declarative registry with
id/category/severity default (error|warning|notice)/threshold config
(`analysis.config.json`, Screaming-Frog-aligned defaults per D-08)/evidence pointers/fix
prose. Page-level + site-level (duplicate clusters, orphans, sitemap hygiene, redirect
chains/loops, canonical checks, hreflang reciprocity) passes. Health Score = pages without
error-severity issues ÷ crawled pages × 100 (Ahrefs model). CLI `npm run analyze -- --run
<id>`; UI runner auto-analyzes after each crawl. Dashboard: Issues nav view (rule groups w/
severity + affected count + % coverage → affected-URL table → page evidence), Issues section
on page detail, Health Score on Overview.

**Acceptance gate (hard)**: `scripts/analyzer-gate.ts` maps ALL 18 seeded manifest classes to
detected issues on the correct URLs across the target-site acceptance runs; zero
error-severity findings on pages with no seeded issue (warnings/notices exempt); 100% of
issues carry evidence pointers that resolve to real stored fields.

PostgreSQL, Elasticsearch, graph/vector DBs, Redis, queues, distributed workers, Kubernetes, AI,
GSC, SERP APIs, scoring, recommendation engine, GitHub integration, deployment, autonomous agent,
crawl resume (design for it — Crawlee queue persists — but no resume UX).

## 8. Phase 0 assumptions (user not live — correct anything wrong at review)

- **Location**: `poc/seo-crawler-poc/` inside the platform repo folder (plan says "separate repo";
  §0 git safety forbids creating repos without instruction, so it is a separate FOLDER, no git).
- **Stack**: Node 22 + TypeScript, Crawlee ^3, Playwright chromium, cheerio, robots-parser,
  fast-xml-parser (sitemaps; Crawlee `Sitemap` used where it fits), tldts (registrable-domain
  scope), vitest + tsx. No DB.
- **Success measure**: §27 checklist + seeded-evidence table + test-matrix runs, compiled into
  `POC-1-REPORT.md` with real command output.
- **www/non-www**: both in scope (same registrable domain) — evidence of the mix preserved.
- **Trailing slash**: normalize by stripping (except root), consistent with Next.js behavior.
- **robots.txt**: respected by default; the local target-site run uses `--no-robots` for full
  coverage PLUS a robots-on run to prove blocking works.
- **Host aliasing** (plan-review-1 Q4): target-site fixtures reference the fictional production
  host `summittrailgear.example` while the site serves on `localhost:3105`. The CLI gets a
  first-class `--alias <host,host,...>` option: aliased hosts count as in-scope and their URLs are
  remapped onto the seed origin for queue identity + sitemap cross-reference, while link/evidence
  records preserve the authored URLs. This mirrors a real production need (staging-domain crawls,
  domain migrations) — not a test hack. Bench runs use
  `--alias summittrailgear.example,www.summittrailgear.example`.
- **Milestone ordering** (plan-review-1 Q1): the plan doc §25 recommends a serial
  "smallest-milestone-first" path. This build intentionally deviates: the full POC-1 scope ships
  in ONE parallel wave of 7 slices, because the milestone ordering is a serial-development
  strategy and the module boundaries are already fixed by the stub contract. The §25 milestone
  remains the integration smoke test (first E2E run) before QA.
