# Research Lane: Website Crawling Engine (SPEC §4)

Research date: 2026-08-10. All product names, prices, quotas verified against current (2026) sources.

---

## Summary

**Recommendation: build the crawler on Crawlee for JavaScript (TypeScript), using a hybrid
static-first design — `CheerioCrawler` (plain HTTP + parse) as the default engine, escalating to
`PlaywrightCrawler` only for pages/templates proven to need JS rendering, with Crawlee's
`AdaptivePlaywrightCrawler` rendering-type predictor as the switching mechanism** [1][2].

Why this wins for an SEO platform:

- Every SEO field the spec demands (title, meta description, H1–H3, canonicals, robots meta,
  links, images+alt, JSON-LD, word count) is extractable from HTML — a full browser is only needed
  when the HTML is a JS shell. Static HTTP crawling is ~10x cheaper than browser crawling
  (Apify's own benchmark: ~3,000 pages/CU Cheerio vs ~300 pages/CU browser) [10].
- Crawlee is the only evaluated framework that ships, in one MIT-licensed package: HTTP + browser
  crawlers behind one API, automatic rendering-type detection, robots.txt enforcement
  (`respectRobotsTxtFile`), sitemap discovery/parsing utilities, autoscaling (1→200 concurrent),
  per-crawl request deduplication via `uniqueKey`, and a lockable request queue
  (`RequestQueueV2`) that lets multiple workers share one frontier [1][3][4][5][6][7].
- It is TypeScript/Node — the same stack the rest of the platform (Next.js code modification,
  GitHub automation) will use, so one team, one runtime, shared types.

Around the crawler: **BullMQ on Redis** for site-level job orchestration (one job = one site
crawl; the page frontier stays inside Crawlee's queue, not BullMQ) [30][31]; **Postgres** for
per-page extract rows + link-graph edges; **S3 with zstd compression** for raw HTML bodies
(~$0.05/month storage for a 100k-page site) [34][35]; **simhash (64-bit)** for near-duplicate
content detection [24]; **CrUX API + PageSpeed Insights API (both free)** for performance data
with self-hosted Lighthouse on template representatives only [20][22][23]; and a **connection-layer
SSRF egress guard** because customer-supplied URLs are attacker-controlled fetch targets [36][37].

Managed alternatives (Firecrawl, Apify platform) are viable for a PoC in days, but their per-page
economics break at the 100k-page recrawl scale this product needs (Firecrawl: 1 credit/page ⇒ a
single 100k-page monthly recrawl consumes an entire $83/mo Standard plan per site) [8][9].

---

## Findings

### 1. Which crawler, and why

**Field-extraction reality check.** The spec's required signals split into two buckets:

| Signal | Needs browser? |
|---|---|
| URL, status, redirect chain, headers | No — HTTP client |
| robots.txt, sitemap.xml, X-Robots-Tag | No |
| title, meta description, robots meta, canonical | No (unless JS-injected) |
| H1–H3, images+alt, internal/external links | No (unless client-rendered) |
| JSON-LD / microdata structured data | No (unless JS-injected) |
| word count, content, page depth | No (unless client-rendered) |
| duplicate content (hashing) | No |
| Core Web Vitals lab data, render-blocking, layout shift | **Yes** (Lighthouse/browser) |
| "what Google actually indexes" on CSR sites | **Yes** (rendered DOM) |

A 2020s-era study (searchviu, 200 domains) found 96% of domains show *some* difference between
raw and rendered HTML in SEO-relevant areas (text, links, titles, metas), but only 56% of URLs
were affected — differences cluster by template, not by page [28]. So the correct architecture is
neither "always render" (10x cost) nor "never render" (misses CSR content): it is
**static-first with per-template escalation**.

**Framework verdicts (2026):**

- **Crawlee (JS)** — actively developed (v3.16 current line), from the Apify team; unified
  `CheerioCrawler`/`PlaywrightCrawler`/`AdaptivePlaywrightCrawler` API; called the "closest direct
  successor to Scrapy in architectural maturity" and the strongest all-in-one Node choice
  [12][13]. Ships robots.txt compliance, sitemap utils, autoscaling, session/proxy management,
  request dedup, storage adapters. **Recommended.**
- **Playwright (raw)** — the browser *engine*, not a crawler: no frontier, dedup, politeness, or
  robots handling. In 2026 it is the default browser-automation pick over Puppeteer: tri-engine
  (Chromium/Firefox/WebKit), auto-waiting, ~5x npm download lead (57.6M vs 10.7M weekly) [14][15].
  **Use it as Crawlee's rendering engine, not standalone.**
- **Puppeteer** — Chrome-centric (Firefox now via WebDriver BiDi); still fine for narrow Chrome
  scraping, but no advantage here since Crawlee wraps Playwright equally well [14][15].
- **Scrapy (Python)** — most mature Python option, excellent static throughput (benchmarked ~4x
  faster than requests+BeautifulSoup) [12][13], but JS rendering is a bolt-on (scrapy-playwright)
  and it splits the platform into a second language/runtime. Choose only if the team is
  Python-first.
- **Plain fetch + Cheerio/parse5** — maximal control, but you rebuild retries, autoscaling,
  robots, queue, dedup, session rotation — exactly the undifferentiated plumbing Crawlee gives
  free. Acceptable for the PoC crawl (SPEC §25 PoC 1), wrong for the product.
- **Firecrawl (hosted)** — 1 credit/page for Scrape/Crawl/Map/Monitor; plans: Free 1k credits,
  Hobby $16/mo→5k, Standard $83/mo→100k, Growth $333/mo→500k, Scale $599/mo→1M (annual billing);
  concurrency 2/5/50/100/150 by tier; subscription-only since June 2026, credits don't roll over
  [8][9]. Output is optimized for LLM ingestion (markdown), not for exhaustive SEO field capture
  (redirect chains, header-level detail, link-graph edges). **Economics fail at scale**: one
  100k-page site recrawled monthly = 100k credits/month = the entire Standard plan *per customer
  site*. Useful as an emergency fallback for hostile/edge-case sites.
- **Apify platform (hosted Crawlee)** — compute-unit pricing $0.2–0.3/CU depending on plan
  (Starter ~$49/mo, Scale ~$499, Business ~$999); ~3,000 pages/CU static, ~300 pages/CU browser ⇒
  roughly $0.04–0.09 per 1,000 static pages, $0.40–0.90 per 1,000 rendered pages, plus proxy and
  rented-actor fees [10][11]. Legitimate ops-outsourcing path since Crawlee code runs there
  unchanged — a genuinely useful property: **build on Crawlee locally, keep Apify as an overflow/
  burst deployment target with zero code changes.** Self-hosting is still ~5–10x cheaper at
  steady state.

### 2. Detecting when JS rendering is actually required

Three complementary mechanisms, in order of authority:

1. **Empirical dual-fetch comparison (ground truth).** Fetch the page statically, parse the SEO
   field set; render the same page, parse again; diff titles, metas, H1s, word count, link count,
   canonical. If the deltas are material, the page (and its template cluster) is marked
   `requires-render`. This is exactly what Crawlee's `AdaptivePlaywrightCrawler` automates: its
   `RenderingTypePredictor` learns from already-crawled pages, re-tests on a configurable sample
   (`renderingTypeDetectionRatio`, default 0.1 ≈ 10% of requests), and persists detection results
   across runs [1][2]. Recent releases persist rendering-type detection results and expose
   in-flight detection counts.
2. **Framework/shell heuristics (cheap pre-classification)** on the static HTML: near-empty
   `<div id="root">`/`<div id="__next">` body with large script payload; `__NEXT_DATA__` present
   (Next.js — note: if `__NEXT_DATA__`/RSC payload contains the content, the *static* HTML
   usually already has it server-rendered; pure-CSR Next is the minority); `window.__NUXT__`,
   `ng-version`, `data-reactroot`; body text < ~200 chars with 100KB+ of JS; meta tags injected
   only client-side [29].
3. **Template clustering.** Classify per URL-pattern (e.g. `/product/*`, `/blog/*`), not per
   page — the searchviu data shows rendering differences are template-level [28]. Store the
   decision per pattern; re-validate on ~5–10% of subsequent fetches to catch site redesigns.

Extra SEO-platform nuance worth productizing: modern AI crawlers (GPTBot, ClaudeBot,
PerplexityBot) do **not** execute JavaScript [29] — so the raw-vs-rendered delta is itself a
reportable SEO finding ("your prices/FAQ exist only in the rendered DOM; AI search engines never
see them"), not just an internal routing decision. Persist both variants when they differ.

### 3. Distributed crawling design

Key insight that simplifies everything: **this platform crawls customer sites, not the open
web.** The unit of work is "crawl site X" (1–100k+ pages on 1–few hostnames), not a trillion-URL
global frontier. That collapses the classic search-engine design [33] into:

- **Site-level orchestration (BullMQ):** one queue of crawl jobs; each job = one site crawl or
  recrawl wave. Workers pick up jobs; horizontal scaling = more workers = more *sites* in
  parallel. BullMQ Pro "groups" give per-group (= per-site/per-tenant) concurrency caps and
  rate limits enforced globally across all workers (`setGroupConcurrency`,
  `setGroupRateLimit`) [30][31][32] — this is also the fair-scheduling mechanism preventing one
  100k-page customer from starving ten 500-page customers.
- **Page-level frontier (inside the crawler, not BullMQ):** the classic two-level frontier
  (priority front-queues + per-host politeness back-queues) [33] degenerates to a single
  per-site priority queue since one job ≈ one host. Do **not** enqueue 100k page-fetches as
  100k BullMQ jobs — frontier state (dedup set, depth, retries, per-host timing) belongs in the
  crawler's own queue. Crawlee's `RequestQueueV2` supports **request locking**
  (`listAndLockHead`), explicitly designed so multiple crawler processes/machines can consume
  one shared frontier safely [3][4] — that's the scale-out path for a single giant site.
- **Politeness ownership:** all fetches for one host flow through one politeness governor
  (single job owner, or the shared-queue lock holder set), so per-host delay/concurrency state
  is accurate. Persist per-host state in Redis so restarts don't reset politeness [33].
- **Isolation:** each crawl job runs in a container with fixed CPU/RAM; browser pools are
  separate worker types from HTTP workers (browser workers are ~10x heavier [10]) so they scale
  independently.

### 4. Very large (100k+ page) sites

Throughput math: at a polite 5 req/s sustained, 100k pages ≈ 5.5 h static. Rendered, a browser
worker does ~0.5–2 pages/s; a 100k-page fully-rendered crawl is a multi-day, ~10x-cost job [10] —
another reason static-first is non-negotiable.

Tactics:

- **Sitemap-first seeding**: ingest sitemap index + child sitemaps before link discovery
  (Crawlee's `Sitemap` class + `discoverValidSitemaps` check robots.txt `Sitemap:` lines, then
  `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap.txt`) [6][7]. Gives near-complete URL inventory
  in minutes, page-depth measurement then runs as BFS from the homepage over discovered links.
- **Crawl budget + prioritization**: per-plan page caps; priority = (depth ascending, sitemap
  presence, GSC-traffic pages first). Report "crawl truncated at N" honestly.
- **URL-space traps**: faceted navigation, calendars, session params can make URL space infinite.
  Enforce max depth, max URLs per URL-pattern, and per-pattern sampling once a pattern exceeds a
  threshold (e.g. after 5,000 `/product/*` pages, sample the rest — template-level issues are
  already statistically established).
- **Streaming, not in-memory**: write page extracts + link edges to Postgres as crawled; frontier
  and dedup set in Redis/disk (Crawlee persists its queue), so RAM is flat with site size.
  Duplicate-content indexes (simhash tables) are DB-side.
- **Resumability**: persisted frontier ⇒ a crashed 100k crawl resumes, never restarts. Crawlee's
  autoscaled pool scales 1→200 concurrency based on system load by default [5]; cap it well below
  that per host (see §8).

### 5. Duplicate-crawl prevention (URL normalization)

Two distinct requirements — **schedule each resource once** but **record every variant as SEO
evidence** (www vs non-www, http vs https, trailing-slash and case variants are themselves
findings per SPEC §6). So: keep the raw discovered URL + the normalized dedup key.

Normalization pipeline (applied to produce the dedup key):

1. **RFC 3986 safe transforms** (guaranteed meaning-preserving): lowercase scheme + host; strip
   default ports (:80/:443); resolve dot-segments; uppercase→decode unreserved percent-encodings
   [38].
2. **Policy transforms** (safe for crawling, may change identity in theory): strip fragments
   (`#…`); sort query parameters; strip known tracking params (`utm_*`, `gclid`, `fbclid`,
   `msclkid`, `ref`); collapse duplicate slashes.
3. **Do NOT lowercase the path** by default — path case-sensitivity is server-dependent; instead
   *detect* case-variant duplicates via content hashing and report them.
4. **Trailing slash**: not guaranteed equivalent by the RFC [38]; learn per site — if
   `/alice` 301s to `/alice/` (or both 200 with identical content hash), fold them; otherwise
   treat as distinct and flag the duplicate-content pair.
5. **Param handling**: observe — if stripping a param never changes the content hash across a
   sample, add it to the site's ignorable-param list (this mirrors how commercial SEO crawlers
   build per-site URL rewrite rules).

Dedup structure: Redis SET (or Bloom filter above ~10M keys) of SHA-1(normalized URL) per crawl
job. Crawlee does this natively via each request's `uniqueKey`. A normalization miss costs a
duplicate fetch, not corruption — bias toward conservative normalization.

### 6. Crawl job queueing

- **Recommended: BullMQ (Redis)** for the job layer. Concurrency per worker + global group
  concurrency; delayed jobs (scheduled recrawls); repeatable jobs (daily agent runs); flows for
  crawl → analyze → report pipelines; rate limiting [30][31]. BullMQ Pro adds per-group
  concurrency/rate-limits that map 1:1 onto "per customer site" [30][31][32]; on open-source
  BullMQ the same effect needs a queue-per-site or a manual limiter — workable, more code.
- Job model: `crawl:full`, `crawl:incremental`, `crawl:verify-change` (fast, post-deployment
  verification of an applied SEO change — this product's special recrawl type), `perf:lighthouse`.
- Alternatives: RabbitMQ (better routing semantics, ops burden of another broker), Kafka
  (overkill; it's a log, not a job queue with retries/delays), Postgres-based queues like Graphile
  Worker (fine at small scale, Redis already present for politeness state). Since the stack
  already needs Redis and Node, BullMQ is the lowest-total-complexity choice — this matches the
  spec's §20 "BullMQ vs RabbitMQ" comparison expectation.
- **Frontier ≠ job queue** (see §3): page-level URLs live in Crawlee's request queue storage
  (pluggable; default disk, Apify cloud, or a custom Postgres/Redis adapter), BullMQ holds only
  site-level jobs — thousands, not hundreds of millions, of jobs.

### 7. Crawl result storage

Split by access pattern:

- **Postgres — structured extracts** (the working set): one row per (page, crawl_version):
  URL, normalized key, status, redirect chain (JSONB), title, meta description, H1/H2/H3 arrays,
  canonical, robots directives, hreflang, word count, depth, content hash (SHA-256), simhash64,
  image list + alts (JSONB or child table), structured-data blobs (JSONB), timing. Link graph as
  an edge table `(from_page, to_page, anchor, rel, position)` — this feeds the Website
  Understanding lane directly. A 100k-page site ≈ 100k rows + ~5–10M edge rows — comfortably
  Postgres-scale.
- **S3 — raw bodies** (the archive): store raw HTML (and rendered DOM when it differs),
  zstd-compressed. Zstd is the modern choice (better ratio + speed than gzip; the IIPC even
  standardized zstd-WARC, with per-site dictionaries yielding extra gains) [34]. Typical page
  ~100KB HTML → ~15–25KB compressed ⇒ 100k pages ≈ 2–2.5GB ⇒ **~$0.05/month** at S3 Standard
  $0.023/GB [35]. PUT requests dominate cost at small object sizes ($0.005/1k) ⇒ 100k PUTs ≈
  $0.50/crawl; batch small pages into bundled objects with byte-range reads (the Common Crawl
  pattern) if this matters [34].
- **Why keep raw HTML at all**: (a) re-extract without re-crawling when detection rules improve;
  (b) before/after evidence for the change-tracking engine (SPEC §16); (c) AI context — the
  optimization engine needs real page content; (d) diffing for change detection. Formal WARC is
  optional; a simple `{site}/{crawl_id}/{urlhash}.html.zst` scheme with metadata in Postgres is
  simpler than WARC unless archival interop is ever required.
- **Retention**: keep latest N versions per page + any version referenced by an applied change;
  lifecycle-transition older versions to S3 Infrequent Access/Glacier.

### 8. Politeness

- **robots.txt**: comply with RFC 9309 (group matching is case-insensitive; multiple matching
  UA groups merge; error handling: 4xx robots = allow all, 5xx = historically treat as disallow;
  cacheable) [16]. Google caches robots.txt up to 24h — mirror that TTL [17]. Crawlee enforces
  this via `respectRobotsTxtFile: true` [6]. Also parse `Sitemap:` directives from robots.txt [6].
- **Crawl-delay**: deliberately excluded from RFC 9309 and ignored by Googlebot, but honored by
  Bing/Yandex and by SEO tools [16 commentary][18-adjacent sources]. As a guest crawler, honor it
  (cap at something sane, e.g. 30s) — it costs little and signals good citizenship.
- **Defaults**: per-host concurrency 2–4, ~2–5 req/s ceiling, jittered delays. Identify honestly:
  a stable product UA string (`SEOPlatformBot/1.0 (+https://…/bot)`) + published bot page +
  support for site owners to control it via robots.txt.
- **Adaptive rate limiting** — model on Google's own documented behavior: Google's crawl
  infrastructure backs off when it sees elevated 429/500/503 rates, and treats 429/503 as
  temporary "slow down" signals (never 403/404 for rate limiting) [18][19]. Implement: on
  429/503 → honor `Retry-After`, halve per-host rate, exponential backoff; on rising TTFB
  (e.g. p50 > 2–3x baseline) → shed concurrency; AIMD-style recovery. Crawlee's autoscaled pool
  already reacts to system load [5]; the per-host governor is the piece to add.
- **The customer-consent advantage**: unlike an open-web crawler, the site owner is the customer.
  Offer verified-owner "fast crawl" mode (explicit opt-in rate, UA allowlisting in their WAF/CDN,
  or fetching through their provided sitemap+API). Domain-ownership verification (DNS TXT or GSC
  property linkage) should gate any above-default crawl rate — this also serves the SSRF/abuse
  story (§12).

### 9. Incremental / differential recrawl

- **Sitemap `lastmod` — trust but verify.** Google/Bing both use `lastmod` as a recrawl
  prioritization signal, and Google's stated model is **binary trust**: dates are trusted only
  while they prove "consistently and verifiably accurate" vs observed content changes; once a
  site emits always-fresh or wrong dates, the whole file's dates are ignored [39][40]. Implement
  the same: per-site `lastmod_trust` score computed by comparing claimed lastmod against observed
  content-hash changes; while trusted, `lastmod > last_crawl` pages go to the head of the
  incremental queue.
- **HTTP conditional GET**: send `If-None-Match` (ETag) / `If-Modified-Since` where the server
  provided validators; a 304 costs ~zero bandwidth and confirms freshness [41]. Support is
  inconsistent across the web (many dynamic sites emit no validators or unstable ETags) — treat
  as an optimization, never as the sole change signal; validate ETag stability per site before
  relying on it.
- **Change-rate estimation**: classic crawl literature (Cho & Garcia-Molina; Olston's WWW'08
  information-longevity work) models per-page change as a Poisson process estimated from
  consecutive-crawl content-hash comparisons, with the known censoring caveat (a page checked
  weekly that changes daily looks like it "changes every visit") [27]. Store per-page: last N
  content hashes + timestamps → estimated change interval.
- **Priority-based recrawl scheduling** — score each page:
  `priority = w1·importance + w2·staleness + w3·volatility + w4·pending_verification`, where
  importance comes from GSC clicks/impressions + internal-link centrality, staleness =
  time-since-crawl / estimated change interval, and `pending_verification` is the
  product-specific booster: **pages with recently applied automated changes recrawl within
  hours-to-daily** to confirm the change deployed and measure its effect (feeds SPEC §15–17).
  Practical tiers: changed/verified-pending: daily; high-traffic/money pages: 2–7 days;
  stable tail: 30 days; full re-discovery crawl (new/orphan/deleted detection): weekly-monthly.
- **Differential outputs**: every recrawl emits a diff (new pages, removed pages, changed fields,
  status transitions, new/lost links) rather than a fresh snapshot — the analyzer and
  rollback-monitoring lanes consume diffs.

### 10. Page-load / performance data capture

Three layers, cheapest first:

1. **Crawl-time signals (free, every page)**: TTFB, total download time, response bytes,
   compression, redirect hops, HTML size, count/weight of images/scripts/css referenced —
   sufficient for "large images / performance problem" detections in SPEC §6.
2. **Field data — CrUX API (free)**: real-Chrome-user LCP/INP/CLS at URL and origin level;
   150 queries/min/project; URL-level data exists only for pages with sufficient traffic
   (otherwise fall back to origin-level); CrUX History API gives ~6 months of weekly trend data —
   ideal for the monitoring/rollback lane [20][21].
3. **Lab data — Lighthouse**: via the **PageSpeed Insights API (free: 25,000 requests/day,
   240/min per key; no paid tier exists)** [22] or self-hosted Lighthouse (~30s/page, ~$0.0008
   per report on a ~$0.10/h instance; one audit per Node process — parallelize via multiple
   processes/containers, as Unlighthouse does) [23]. PSI practical concurrency is ~5–10 parallel
   before intermittent 500s [22].

**Strategy**: never Lighthouse every page. Audit template representatives (a few pages per URL
pattern) + top-traffic pages + any page touched by an applied change; the 25k/day PSI quota then
covers even large portfolios, with self-hosted Lighthouse as unmetered overflow. CrUX for
all-URL field coverage where traffic permits.

### 11. Duplicate-content detection

- **Exact duplicates**: SHA-256 over the *extracted main content* (post-boilerplate-removal),
  not the raw HTML — nav/footer noise otherwise masks true duplicates. Main-content extraction
  before hashing measurably improves near-dup precision [26].
- **Near-duplicates: simhash, 64-bit** (Charikar) — Google's own documented choice for crawl-time
  dedup; Manku et al. (WWW'07, Google) showed 64-bit fingerprints with Hamming distance ≤ 3
  identify near-dups across 8B pages [24]. Storage: 8 bytes/page. Fast lookup via the
  rotated-table/banding trick from the same paper (split 64 bits into 4 blocks; 4 sorted indexes;
  candidates share one exact block). Postgres implementation: 4 indexed bigint columns per
  page-version.
- **MinHash + LSH over shingles** (w-shingling, w≈5–9 words) is the higher-recall alternative for
  *similarity clustering* (e.g. grouping 60%-similar product variants); research shows minhash
  can outperform simhash on quality, at larger signature cost [25]. Use simhash as the always-on
  crawl-time detector; run minhash/LSH (or embedding similarity, which the Website Understanding
  lane will have anyway) as a batch job for "these 12 pages compete/cannibalize" clusters.
- Thresholds for the SEO report: Hamming ≤ 3 → duplicate (canonical/consolidation
  recommendation); shingle-Jaccard 0.5–0.85 → near-duplicate/cannibalization candidate.
- Bonus reuse: the same per-page content hashes drive change detection for incremental recrawl
  (§9) — one mechanism, two features.

### 12. SSRF and crawler security

The crawler fetches attacker-controllable URLs (customer input + every link found on crawled
pages + every redirect Location). Treat crawler workers as hostile-input processors:

- **Block private/reserved destinations**: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12,
  192.168.0.0/16, 169.254.0.0/16 (link-local incl. cloud metadata 169.254.169.254),
  100.64.0.0/10 (CGN), 0.0.0.0/8, ::1, fc00::/7, fe80::/10, and IPv4-mapped IPv6 forms [36][37].
- **Validate at the connection layer, not URL-parse time.** Resolve-then-check-then-refetch is
  bypassable via DNS rebinding (TTL-0 answers flipping public→internal between check and use);
  the guard must pin the vetted IP into the actual socket connect (custom `lookup`/agent in
  Node, or an egress proxy that enforces the ACL at CONNECT time) [36][37].
- **Re-validate every redirect hop** — redirects to internal IPs are the classic bypass; also cap
  redirect chains (which the SEO layer wants recorded anyway).
- **Browser workers are SSRF engines too**: a rendered page can `fetch()`/redirect anywhere.
  Route ALL browser traffic (Playwright `--proxy-server`) through the same enforcing egress
  proxy; disable `file://`; block non-http(s) schemes.
- **Network posture**: crawler workers in an isolated subnet/VPC with default-deny egress to
  internal ranges; **no ambient cloud credentials** on crawler nodes; IMDSv2 (session-token
  metadata) enforced where applicable [36][37].
- **Resource-abuse hardening**: response size caps (e.g. 10–20MB), content-type allowlist,
  global + per-request timeouts (tarpits), decompression-bomb limits, parser limits
  (HTML parsing of pathological markup), per-tenant crawl quotas.
- **Abuse-of-service**: require domain-ownership verification (DNS TXT / GSC property) before
  crawling any site at above-guest rates, so the platform can't be weaponized as a DDoS-for-hire
  or internal-network scanner against third parties.

---

## Options compared

| Option | Type | JS rendering | Robots/sitemaps built-in | Distributed story | Cost @ 100k pages/crawl | Fit for SEO field extraction | Verdict |
|---|---|---|---|---|---|---|---|
| **Crawlee JS (Cheerio + Playwright, adaptive)** | OSS framework (MIT), Node/TS | Yes — same API, auto-detected (predictor, ~10% sampling) [1][2] | Yes: `respectRobotsTxtFile`, `Sitemap`, `discoverValidSitemaps` [6][7] | RequestQueueV2 locking, multi-process/machine [3][4] | ~$1–5 compute (mostly static) | Full control; parse everything | **Recommended core** |
| Playwright (raw) | OSS browser lib | Always (that's all it does) | No | DIY | ~10x static cost if used for all pages [10] | Engine only — no crawler features | Use *inside* Crawlee |
| Puppeteer | OSS browser lib | Always | No | DIY | same as above | Chrome-centric; losing mindshare (10.7M vs 57.6M downloads/wk) [15] | No |
| Scrapy | OSS framework, Python | Bolt-on (scrapy-playwright) | Partial (RobotsTxtMiddleware; sitemaps via spider) | Mature (scrapyd/Frontera), self-managed | ~$1–5 compute | Full control; second runtime/language | Only for a Python-first team |
| fetch + Cheerio/parse5 | DIY, Node | No (add Playwright manually) | No | DIY | cheapest raw, highest eng cost | Full control, all plumbing self-built | PoC only |
| Firecrawl | Hosted API | Yes (managed) | Managed | Managed; concurrency 2–150 by tier [8] | 100k credits ⇒ $83+/mo *per site-crawl/mo* [8][9] | Markdown/LLM-oriented output; weaker raw SEO telemetry | Fallback for hostile sites |
| Apify platform | Hosted runtime for Crawlee | Yes | Yes (it's Crawlee) | Managed autoscaling | ~$8 static / ~$83 rendered per 100k pages [10][11] | Same as Crawlee | Burst/overflow deploy target |
| **Hybrid static-first (recommended design)** | Architecture pattern over Crawlee | Only where proven needed (~template-level) | Yes | As Crawlee above | ~90% static ⇒ near-static cost | Best of both; matches how rendering differences actually distribute (96% of sites / 56% of URLs) [28] | **Recommended** |

---

## Recommendation & why

1. **Crawlee (TypeScript) as the crawl engine**, `CheerioCrawler` default, `PlaywrightCrawler`
   escalation, with the adaptive rendering predictor deciding per template cluster. It is the
   only option that ships the whole checklist (robots, sitemaps, dedup, autoscale, shared
   lockable frontier, HTTP↔browser switching) in the platform's native language, at zero license
   cost, with a proven hosted escape hatch (Apify) if ops ever need outsourcing [1–7][10].
2. **Static-first is the core economic decision** — ~10x cost difference per page [10], and the
   rendering-difference distribution (template-clustered, 56% of URLs on affected sites [28])
   makes per-template escalation both safe and cheap. Record raw-vs-rendered deltas as SEO
   findings, not just routing metadata.
3. **BullMQ for site-level jobs, Crawlee queue for page-level frontier** — never conflate the
   two layers. BullMQ Pro groups give per-tenant fairness in one primitive [30][31][32].
4. **Postgres extracts + S3/zstd raw bodies** — pennies per site per month [34][35], full
   re-extraction and before/after evidence preserved for the change-tracking and AI lanes.
5. **Politeness modeled on Googlebot's documented behavior** (RFC 9309, 24h robots cache,
   429/503-driven backoff, Retry-After) [16][17][18][19] plus the product's unique
   verified-owner fast-crawl mode.
6. **simhash-64 always-on + minhash/embeddings batch clustering** for duplicate content [24][25][26].
7. **CrUX + PSI (both free, quota-bounded: 150 QPM / 25k per day) for performance**, Lighthouse
   only on template representatives and changed pages [20][22][23].
8. **SSRF guard at the socket layer + egress-restricted workers + ownership verification** —
   non-negotiable for a multi-tenant product fetching user-supplied URLs [36][37].

This directly answers SPEC §20's "Playwright vs Crawlee" question: it's a false dichotomy —
Crawlee *wraps* Playwright; the real decision is static-first hybrid vs always-render, and
static-first wins on cost 10:1 with no loss of SEO signal fidelity when escalation is automatic.

---

## Risks & limitations

- **Anti-bot walls (Cloudflare, Akamai) on customer sites**: even the owner's site may block the
  crawler at CDN level. Mitigations: documented UA + IP ranges for allow-listing during
  onboarding; Crawlee's fingerprint/session tooling; Firecrawl/Apify proxies as a paid fallback.
  Residential-proxy evasion should be a policy decision, not a default — the owner relationship
  makes allow-listing the correct fix.
- **Rendering predictor false negatives**: a template misclassified as static silently misses
  JS-injected metas. Mitigate with the ongoing ~5–10% re-detection sampling [1][2] and a
  scheduled full-render audit of template representatives.
- **PSI/CrUX quota ceilings are hard**: no paid PSI tier exists (25k/day) [22]; CrUX has no
  URL-level data for low-traffic pages [20]. Lab metrics for long-tail pages must come from
  self-hosted Lighthouse (compute cost ~$0.0008/page, wall-clock 30s/page [23]) — budget for it.
- **BullMQ Pro is commercial** — per-group concurrency/rate-limits are the paid tier [30][31];
  open-source workaround (queue-per-site) adds code and Redis keys. Cost is modest vs RabbitMQ
  ops burden, but it's a dependency decision to flag.
- **ETag/lastmod signals are unreliable in the wild**: unstable ETags and auto-updating lastmod
  are common; the trust-scoring layer (§9) is required, not optional — otherwise incremental
  crawls either miss changes or degrade to full recrawls [39][40][41].
- **Infinite URL spaces** (facets, calendars) can blow through crawl budgets before pattern caps
  kick in; per-pattern limits need good defaults *and* per-site tuning UI.
- **Hosted-price volatility**: Firecrawl restructured to subscription-only mid-2026 [9]; Apify
  effective CU rates vary by plan and promo [10][11]. Re-verify all vendor prices at contract
  time; treat the numbers above as August-2026 snapshots.
- **Legal/compliance**: even with owner consent, crawling third-party competitor pages (SPEC §10
  competitor analysis) re-enters guest-crawler territory — that lane must keep strict robots
  compliance and low rates, and its requirements should not be silently inherited from this
  owner-consented crawl design.

---

## Sources

1. https://crawlee.dev/js/api/playwright-crawler/class/AdaptivePlaywrightCrawler — AdaptivePlaywrightCrawler API (rendering-type detection, `renderingTypeDetectionRatio` default 0.1, limited context for mode switching)
2. https://crawlee.dev/python/docs/guides/adaptive-playwright-crawler — RenderingTypePredictor / DefaultRenderingTypePredictor behavior, learning from crawled pages
3. https://crawlee.dev/js/docs/experiments/experiments-request-locking — RequestQueueV2 request locking (`listAndLockHead`) for multi-client crawling
4. https://crawlee.dev/js/docs/guides/parallel-scraping — parallel/multi-process crawling on a shared queue
5. https://crawlee.dev/js/docs/guides/scaling-crawlers — autoscaled pool (default scaling to 200 concurrent), rate/concurrency controls
6. https://github.com/apify/crawlee/pull/2214 — robots.txt + sitemap utilities (`RobotsTxtFile`, `respectRobotsTxtFile`, sitemap discovery)
7. https://crawlee.dev/js/api/utils/class/Sitemap — Sitemap parsing utility (sitemap index traversal)
8. https://www.firecrawl.dev/pricing — Firecrawl plans, credits, 1 credit/page, concurrency tiers (fetched 2026-08-10)
9. https://www.eesel.ai/blog/firecrawl-pricing — Firecrawl 2026 pricing analysis; subscription-only since June 2026; no credit rollover
10. https://use-apify.com/docs/what-is-apify/apify-compute-units — Apify CU formula; ~3,000 pages/CU (Cheerio) vs ~300 pages/CU (browser)
11. https://scrapegraphai.com/blog/apify-pricing — Apify 2026 plan pricing and effective CU rates
12. https://scrapfly.io/blog/posts/best-open-source-web-scrapers — 2026 OSS scraper landscape (Scrapy/Crawlee/Playwright positioning)
13. https://hasdata.com/blog/web-crawling-with-python — 2026 benchmarks (Scrapy vs requests+bs4 ~4x; Crawlee-Python fingerprinting overhead)
14. https://www.firecrawl.dev/blog/playwright-vs-puppeteer — Playwright vs Puppeteer 2026 comparison
15. https://tech-insider.org/playwright-vs-puppeteer-2026/ — npm weekly downloads 57.6M vs 10.7M; Puppeteer Firefox via WebDriver BiDi
16. https://www.rfc-editor.org/rfc/rfc9309.html — Robots Exclusion Protocol standard (group matching, merging, caching, error handling; crawl-delay excluded)
17. https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec — Google robots.txt interpretation incl. up-to-24h caching
18. https://developers.google.com/crawling/docs/crawlers-fetchers/reduce-crawl-rate — Google reduces crawl rate on 429/500/503; guidance mirrors adaptive backoff design
19. https://developers.google.com/search/docs/crawling-indexing/troubleshoot-crawling-errors — 429/503 as temporary slow-down signals; never 403/404 for rate limiting
20. https://developer.chrome.com/docs/crux/guides/crux-api — CrUX API: free, 150 queries/min/project, URL + origin level, URL normalization behavior
21. https://developer.chrome.com/docs/crux/history-api — CrUX History API for trend data
22. https://unlighthouse.dev/learn-lighthouse/pagespeed-insights-api — PSI API quotas: 25,000/day, 240/min, no paid tier; practical concurrency 5–10
23. https://googlechrome-lighthouse.mintlify.app/advanced/running-at-scale — Lighthouse at scale: ~30s/audit, ~$0.0008/report, one audit per Node process
24. https://research.google.com/pubs/archive/33026.pdf — Manku et al. (Google, WWW'07): 64-bit simhash, Hamming ≤3, 8B-page dedup, banding lookup
25. https://arxiv.org/pdf/1407.4416 — "In Defense of MinHash Over SimHash" (quality/size trade-offs)
26. https://arxiv.org/pdf/2111.10864 — Impact of main-content extraction on near-duplicate detection
27. http://infolab.stanford.edu/~olston/publications/www08.pdf — Olston & Pandey: recrawl scheduling on information longevity (change-rate estimation, censoring caveat)
28. https://www.searchviu.com/en/javascript-crawling-study-rendered-html-vs-original-source-code/ — 200-domain study: 96% of domains / 56% of URLs differ raw-vs-rendered in SEO-relevant areas
29. https://dev.to/extractdata/how-to-tell-if-a-page-uses-javascript-rendering-and-what-to-do-about-it-5af8 — practical JS-rendering detection heuristics; AI crawlers don't execute JS
30. https://docs.bullmq.io/bullmq-pro/groups/concurrency — BullMQ Pro per-group concurrency (global across workers)
31. https://docs.bullmq.io/bullmq-pro/groups/rate-limiting — BullMQ Pro per-group rate limiting
32. https://docs.bullmq.io/bullmq-pro/groups/local-group-rate-limit — `setGroupRateLimit` per-group limits
33. https://www.hellointerview.com/learn/system-design/problem-breakdowns/web-crawler — URL frontier design: two-level queues, domain partitioning, politeness state in Redis
34. https://iipc.github.io/warc-specifications/specifications/warc-zstd/ — zstd-compressed WARC spec incl. per-crawl dictionaries
35. https://www.cloudzero.com/blog/s3-pricing/ — S3 Standard $0.023/GB-month (us-east-1, 2026), tiered rates
36. https://behradtaher.dev/DNS-Rebinding-Attacks-Against-SSRF-Protections/ — DNS rebinding vs resolve-then-check SSRF guards; connection-layer pinning
37. https://stytch.com/blog/securing-identity-apis-against-ssrf/ — SSRF defense in depth: blocked ranges, metadata endpoints, redirect re-validation, network egress controls
38. https://encyclopedia.pub/entry/29841 — URL normalization: RFC 3986 safe transforms vs semantics-changing transforms (trailing slash not guaranteed equivalent)
39. https://www.seroundtable.com/google-sitemap-lastmod-binary-trust-37554.html — Google's binary trust model for sitemap lastmod
40. https://yoast.com/lastmod-xml-sitemaps-google-bing/ — Google + Bing on lastmod as a crawl-prioritization signal
41. https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Last-Modified — Last-Modified / conditional request semantics (304 revalidation)
