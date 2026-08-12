# Advanced Crawler — competitive research + gap analysis

> Purpose: define "advanced" for our crawl engine by studying SearchAtlas/OTTO, Ahrefs,
> Screaming Frog, Sitebulb, and the enterprise platforms (Botify, Lumar, Oncrawl, JetOctopus) —
> then a prioritized roadmap. The crawler is the data foundation for everything downstream
> (analyzer, AI optimization, OTTO-style automation). Started 2026-08-12; competitor sections
> filled from the four research lanes (sources cited inline there).

## 0. Our engine today (POC-1, verified baseline — the gap analysis compares against THIS)

**Discovery & frontier**: seed + HTML links + robots-declared sitemaps + 4-path sitemap
fallback ladder; sitemap-index recursion; per-URL discoverySources merging; depth + parent
tracking; maxPages + maxDepth guards; URL normalization (tracking params, query sort,
trailing slash) + registrable-domain scope + host-alias remapping (staging crawls).

**Fetching**: static-first (Crawlee CheerioCrawler) with JS-detection → headless Chromium
escalation (7 named signals incl. script-dominant); `--render auto|never|always`; Chromium
retry on blocked fetches (403/429/timeout/network) with exponential 429 backoff; real per-hop
redirect chains (manual hop walk); politeness (rps caps, concurrency, per-host); robots.txt
respected by default w/ off switch (evidence still recorded either way).

**Per-page record (CrawledPage)**: status, redirect chain, final URL, headers subset, response
time, title, meta description, canonical (resolved), robots meta + googlebot + x-robots-tag
(noindex/nofollow), H1/H2/H3, links (authored + normalized, internal/external, anchor,
rel/nofollow/sponsored/ugc), images (alt null-vs-empty, dims, format), videos (file/
YouTube/Vimeo/iframe + poster + providerId), JSON-LD (raw always + parsed/parseError),
content text + wordCount + sha256 contentHash, renderedWith + renderSignals, crawl meta.
Raw HTML stored per page.

**Run outputs**: failures classified (timeout/dns/4xx/5xx/redirect-loop/parse-error/other w/
extracted blocked-status), blocked.json (robots), robots + sitemap evidence, CrawlSummary
(coverage %, status histogram, orphan candidates, sitemap 3-way cross-ref, maxDepthSeen,
jsRendered, link totals).

**Surfaces**: CLI + dashboard (dynamic crawl w/ live progress, evidence drill-down, media
previews, filtered explorer, failures/blocked, sitemap/robots views, runs).

**Known deliberate gaps (from POC-1 scope)**: no resume, single worker, no scheduling/recrawl,
no change detection between runs, no performance/CWV capture, no log-file ingestion, no
segmentation, no internal PageRank, no hreflang, no mobile-parity, no accessibility checks,
no custom extraction, no DB (filesystem storage), no near-dup clustering beyond contentHash,
gzip sitemaps unsupported, no external-link checking (recorded, not fetched).

## 1. SearchAtlas / OTTO — research lane A (sources in lane report; KB-snippet items flagged unverified)

**Collects per page**: title/desc/status, robots+hreflang+canonical directives, headings,
OG/Twitter tags, thin/dup content signals + DOM size, images (alt/weight/format), links incl.
broken/redirect chains + orphans, CWV (LCP/INP/CLS, Lighthouse lab) mobile+desktop, sitemap/
robots validation, GSC+GA4 cross-referenced "Content Pruning" (low-value pages), internal
PageRank in their "Site Lens" viz. Site Health 0-1000 scale. Issue emails configurable.

**Crawl mechanics**: **NO JS rendering** (help center: JS-nav sites strand the crawler; it
cannot see OTTO's own pixel-applied fixes!). Default 20 p/s; 100-1M URL range; daily/weekly/
manual schedules; per-page recrawl; frequent WAF-blocking troubleshooting corpus (Cloudflare
Bot Fight Mode etc). No true log ingestion — a "Crawl Monitoring" bot-visibility feature
(mechanism undocumented). Quotas: 10k-100k pages/audit, 50k-100M crawled/mo by tier.

**OTTO mechanics (the strategic part — this is our SPEC §12/D-17 productized)**:
- OTTO Pixel = one script → reads pages AND deploys fixes as runtime JS DOM-rewrites
  (seen by users + JS-rendering bots).
- Edge channel = Cloudflare Worker raw-HTML modification (seen by non-JS AI bots — ChatGPT/
  Perplexity/Claude — their explicit AI-search positioning).
- Persistence channels = native CMS writes (WP/Shopify/Webflow/HubSpot/Contentful/Duda) +
  code pipelines (GitHub, Vercel). WP plugin writes real fields, bulk 100 pages.
- Approval workflow: fix dashboard → per-item Deploy + master toggle → rollback; pixel fixes
  REVERT when subscription ends (marketing claims permanence; help doc contradicts — the
  "rented overlay" criticism is competitors' main attack).
- Auto-fix types: titles, descriptions, headings, canonicals, broken/redirect links, OG/
  Twitter, schema, image alt, internal links, custom HTML; plus content gen, link building,
  GBP, "Dynamic Indexing" re-index pings.

**Implication for OUR crawler** (lane A's synthesis): design the crawl schema backwards from
"what can we rewrite" — store ORIGINAL values verbatim for every rewritable element (we do:
raw HTML + authored titles/meta/OG-gap/headings/anchors/schema) so patch generation + rollback
are possible; stable URL identity for overlay matching; fix list refreshes per recrawl.
**Gap they have that we already beat: JS rendering.** Gaps we lack vs them: OG/Twitter tag
extraction, DOM size, image byte-weight, CWV, GSC/GA4 joins, schedules, Site Health score.

## 2. Ahrefs (AhrefsBot + Site Audit) — research lane B (sources inline)

**Scale of checks**: help-center reality = "100+ pre-set issues", ~150 stored fields/URL
(launch post); marketing = "170+ issues / 250+ data points" (ahrefs.com/site-audit).
Categories: performance, HTML tags, content quality/duplicates, links, indexability, social
tags (OG/Twitter), hreflang, redirects, images, JS, CSS, robots.txt, sitemaps, structured data.

**Check catalog highlights beyond ours** (help.ahrefs.com/en/collections/1539899-issues):
canonical→4xx/5xx/redirect, canonical-no-inlinks, double-slash URLs, meta-refresh redirect,
redirect-chain-too-long, HTTPS/HTTP mixed content (page→image/js/css), multiple title/desc
tags, SERP-title mismatch, page-has-links-to-broken/redirect, nofollow-only inlinks,
external 4xx/3xx (they FETCH external links), broken/oversized images + image redirects,
broken JS/CSS + CSS size, HTML size/compression, "slow page", full hreflang validation suite
(self-ref, reciprocity, non-canonical targets, lang mismatch), sitemap hygiene (noindex/
non-canonical/3xx/4xx/5xx in sitemap), custom user-defined issues, and traffic-cross-referenced
issues ("noindex page receives organic traffic" — needs ranking data, their moat).

**Crawl mechanics**: JS rendering opt-in (headless Chrome, render→wait 3s→snapshot; stores raw
AND rendered HTML, both full-text searchable); default 30 URLs/min, verified owners up to
30k/min; robots.txt disobey allowed ONLY for verified owners; 5 seed sources (project URL,
auto sitemaps, specific sitemaps, custom CSV list, backlink index) with per-URL discovery
Source column; include/exclude regex + URL rewrites; hard caps depth≤16, ≤12 query params;
scheduled recrawls (daily/weekly/monthly) + "Always-on audit" incremental recrawl prioritized
by traffic/backlinks/indexability/age; mobile + desktop UA selectable; HTTP-auth staging crawls;
crawl-vs-crawl diff marks issues new/fixed/persisting.

**Link intelligence**: Page Rating = internal PageRank (iterative, log-scaled 1-100, post-crawl
pass); orphans = seed/sitemap-discovered with zero inlink edges; Internal Link Opportunities =
top-10 ranking keywords per page scanned as unlinked mentions across all other pages' text
(needs rank data). **CWV**: bring-your-own PSI API key → Lighthouse lab (perf score, LCP, CLS,
TBT) + CrUX field (LCP/CLS/FID/INP + distributions) per URL; drives "poor LCP/CLS" issues.

**Severity/UX model**: Error/Warning/Notice, user-editable per issue + toggleable + custom
issues; Health Score = URLs without Errors ÷ total × 100; issues list → affected-URL count +
trend vs last crawl → filtered URL table → add ANY stored field as evidence column → CSV
export "with fixing instructions"; Site Audit API exposes it all.

**AhrefsBot web-scale context** (marketing): ~8B pages/day, 5M pages/min, ~80M pages/day JS-
rendered, 3PB RAM / 502PB SSD. Confirms: web-scale indexing is a different business; the
Site Audit per-site queue model is our reference architecture.

**Their "what we'd need" list (lane B's synthesis)**: wide per-URL record with issues derived
as queries; declarative rule engine w/ overridable severities + health score; two-phase
crawl→post-process (PageRank, dup clustering, orphans, hreflang reciprocity are graph passes);
multi-source discovery with provenance; opt-in JS rendering storing raw+rendered; politeness +
ownership verification unlocks; PSI-key CWV; scheduled + incremental recrawls with crawl
diffing; traffic-cross-referenced issues deferred (needs rank data).

## 3. Screaming Frog + Sitebulb — research lane C (sources in lane report)

**SF per-page record (~70+ columns)**: beyond ours — Title/Desc/H1 instances 1-2 + lengths +
PIXEL WIDTHS (SERP truncation), meta keywords/refresh, rel prev/next, size/transferred/text
ratio, Link Score (internal PR 0-100), unique vs total in/outlinks + JS-link variants,
closest-similarity + near-dup count (minhash, 90% threshold, adjustable) + exact-dup hash,
spelling/grammar (40 langs), Flesch readability, language, HTTP version, security headers
(HSTS/CSP/X-Frame...), response time, last-modified. v22 adds EMBEDDING-based semantic dups
(cosine 0.95), topical-outlier detection, semantic search, content clusters. Content-area
config (exclude nav/footer). N-grams.

**SF issues taxonomy**: ~300 issues = Issue/Warning/Opportunity × High/Med/Low + affected
URLs + % coverage + per-issue doc page. JS category = raw-vs-rendered divergence checks
(noindex only in raw, title updated by JS...). ~47 axe-core accessibility rules. 15 AMP
checks. Schema validated against Schema.org vocab AND Google rich-result requirements.
v24: uncrawlable-link-type flags, MCP server, auto-compare scheduled crawls + email diffs.

**SF integrations**: PSI (75+ metrics: CrUX field + Lighthouse lab), GSC + URL INSPECTION API
(2k/day: index status, Google-selected canonical, last crawl), GA4, Majestic/Ahrefs/Moz,
OpenAI/Gemini/Ollama per-page prompts, custom extraction (100 XPath/CSS/regex extractors +
visual builder), custom JS per page, custom search. Orphans via GA+GSC+sitemap vs crawl.

**SF ops**: database storage mode (~2M URLs @4GB RAM → ~10M @16GB, crash-recoverable, no
crawl credits); compare mode Added/New/Removed/Missing + element-level Change Detection tab +
URL mapping (staging vs prod); scheduling headless + CLI + Sheets/Looker exports; force-
directed crawl maps (3D to 100k URLs), SERP snippet + rendered screenshot + raw-vs-rendered
source view per URL.

**Sitebulb adds**: 300+ Hints w/ Critical→Low + Issue/Opportunity/Potential + % coverage +
consultant-grade why/how-fix prose (the product IS the narrative); crawl maps (award-winning
viz); URL Rank + link POSITION classification (header/nav/footer/content) + anchor analysis +
links-to-noindexed (equity waste); axe-core 95+ checks in-crawl; **lab Web Vitals measured by
ITS OWN Chrome during crawl (LCP/CLS/TBT/TTI/FCP/TTFB, configurable sampling %, no PSI
quota)** + Lighthouse opportunities on every URL; hreflang from head+header+sitemap w/ ISO
validation + cross-domain alternate crawling; Response-vs-Render first-class report; Code
Coverage (unused CSS/JS); white-label PDF; Evergreen Chromium free; desktop ~500k / cloud
~10M URLs.

**Lane C's top-15 gaps list** (full in report): issue taxonomy engine; raw-vs-rendered diff;
crawl comparison; near-dup + semantic-dup; internal link scoring; hreflang suite; schema
validation vs Google requirements; multi-source orphans; in-crawl Web Vitals; URL Inspection
overlay; custom extraction; DB-backed storage; visualizations; accessibility; scheduled
auto-compare crawls.

## 4. Enterprise: Botify / Lumar / Oncrawl / JetOctopus — research lane D (sources in lane report)

**Scale architecture**: all four are distributed cloud crawlers (Lumar serverless "450 URLs/s
raw / 350 rendered"; Botify "250/s HTML, ~100/s rendered, 25M pages/crawl, 500+ KPIs/URL";
Oncrawl on GKE autoscaling 10→750 pods, "25M URLs/day/site"; JetOctopus "250 p/s" — all
vendor-published). Rendering is BUDGETED (always slower tier, per-crawl toggle) — Botify's
"render budget" framing; raw-vs-rendered diffing (JS-only content/links/redirects) is the
advanced capability, not always-on rendering.

**Log-file analysis = the moat**: CDN/streaming ingestion (Cloudflare/CloudFront/Fastly/NGINX),
daily refresh, verified-bot classification (UA + reverse-DNS, incl. AI bots — GPTBot,
ClaudeBot, PerplexityBot...). Data model: URL-keyed row joining crawl attrs × log attrs (bot
hits, crawl frequency, last-crawl) × GSC × analytics. Derived entities: crawl ratio, active
page (≥1 organic visit), orphan (bot-hit/traffic but zero inlinks), crawl waste / zombie
pages. Canonical viz: Botify's crawled-by-us/crawled-by-Google Venn. The sold funnel:
in-structure → bot-hit → indexed/impressions → active, per segment.

**Segmentation**: page-type groups via regex/breadcrumb/query-language (Oncrawl OQL) applied
uniformly across every dataset — "no meaningful analysis without segmentation"; at scale the
actionable unit is the template, not the URL.

**Change detection**: crawl-over-crawl diffs at URL level (incl. staging-vs-prod, mobile-vs-
desktop), trend alerting; **Lumar Protect gates CI/CD** — crawls staging per deploy, 350+
tests w/ thresholds, can fail the build (GitHub/Jenkins/CircleCI/Azure DevOps).

**Link equity**: Botify Internal PageRank; Oncrawl Inrank (damping, log-fit 0-10, random-
surfer vs REASONABLE-surfer mode weighting links by page zone; 3xx passes full rank; nofollow
passes 0; only <a href> counts).

**Data joins**: GSC beyond 1k-row UI limit (Botify RealKeywords continuous pull); GA4/Adobe;
CrUX 28-day field data; generic JSON/CSV per-URL ingestion (price/margin/stock into crawl
schema); custom extraction (CSS/regex) into the per-URL record; Lumar Universal Crawl merges
SEVEN URL sources with per-URL set membership (linked-not-visited, traffic-not-linked, ...).

**Politeness/access engineering**: mid-crawl speed control + server-impact awareness (session
creation, cache pollution, GZIP load); published static crawl IPs for WAF whitelisting;
staging auth; custom UA/headers; Lumar "Stealth Mode" (1 URL/3s, randomized IP+UA) for
bot-protected sites; fake-Googlebot detection via reverse DNS. Parity audits: mobile/desktop
+ JS parity diffs; hreflang from tags+headers+sitemaps with reciprocity at scale (Lumar: 13
reports).

**Lane D's 10 separators** (full list in lane report): distributed elastic crawling; budgeted
parallel rendering w/ raw-vs-rendered diff; first-class log ingestion; URL-keyed unified data
model; multi-source set reconciliation; segmentation as cross-cutting dimension; whole-graph
link equity per crawl; crawl-over-crawl + CI regression gating; politeness/access engineering;
exhaustive variant validation (hreflang/parity/fake-bot). **Cross-cutting: the crawler is the
acquisition layer — the defensible product is the join.**

## 5. Capability gap matrix (synthesis over all four lanes)

**Validated — our POC-1 architecture already matches the industry's correct shape**: wide
per-URL record w/ originals verbatim (the patch-generation prerequisite OTTO's model demands),
discovery provenance per URL (Ahrefs' Source column), static-first w/ budgeted rendering
(everyone), robots/sitemap evidence, orphan-by-set-difference, JS rendering (which SearchAtlas
LACKS entirely). "Issues derived as queries over the record" = exactly our POC-2 plan.

| Capability | Who has it | We have | Gap size |
|---|---|---|---|
| Issue/rule engine (severity, coverage %, fix prose, health score) | ALL (their core product) | evidence only — **this IS POC-2** | build next |
| OG/Twitter tags, multi-instance titles/desc/H1, pixel widths | Ahrefs, SF, SearchAtlas | ✗ | small (extraction) |
| hreflang (head+header+sitemap, reciprocity, ISO) | Ahrefs, SF, Sitebulb, Lumar | ✗ | medium |
| Page/HTML size, text ratio, compression, security headers, HTTP ver | SF, Ahrefs, Sitebulb | headers subset only | small |
| Raw AND rendered HTML kept + divergence detection | SF, Sitebulb, Botify | rendered REPLACES raw on escalation | small-medium |
| Near-dup (minhash) + semantic dup (embeddings) | SF (both), Ahrefs | exact contentHash only | medium |
| Internal PageRank / link scoring + link position + anchor aggregation | ALL | link edges stored, no scores | medium (post-crawl pass; D-04) |
| Crawl-over-crawl diff (new/fixed/persisting, element-level) | ALL | runs stored, no differ | medium |
| Scheduled + incremental recrawls | Ahrefs (always-on), SearchAtlas, SF, Lumar | ✗ | medium |
| Lab Web Vitals in-crawl (own Chrome, sampling) + BYO PSI/CrUX | Sitebulb (in-crawl), Ahrefs/SF (PSI) | responseTime only | medium |
| External-link checking (fetch external 4xx) | Ahrefs, SF | recorded, not fetched | small |
| Custom extraction (CSS/XPath/regex) | SF, Sitebulb, Botify, Lumar | ✗ | medium |
| Multi-source URL reconciliation (crawl×sitemap×GSC×logs×analytics) | Lumar 7-source, Botify Venn | crawl×sitemap only | grows with POC-7 |
| Log ingestion + verified-bot classification | Botify, Oncrawl, JetOctopus | ✗ | large (enterprise moat, later) |
| Segmentation (page-type groups over every dataset) | enterprise ALL | ✗ | medium (dashboard-side first) |
| DB-backed store, resume, millions of URLs | SF db mode, all cloud | filesystem | large (MVP; D-03 Postgres) |
| Ownership verification unlocks (speed, robots-off) | Ahrefs | switch w/o verification | product decision |
| Accessibility (axe-core), spelling/readability | SF, Sitebulb | ✗ | optional tier |
| CI/CD regression gating (crawl staging per deploy, fail build) | Lumar Protect | ✗ | later (fits SPEC §13-15!) |
| Fix-deployment loop (pixel/edge/CMS/code + approval + rollback) | OTTO (the whole pitch) | SPEC §12-17 + D-17 design it | POCs 3-6 |

## 6. Recommended advanced-crawler roadmap

**Strategic read**: (a) every competitor's PRODUCT is the rule engine over the crawl — POC-2
is the single highest-leverage next build and the research hands us its design (severity
tiers, health score, affected-URLs + % coverage, fix prose, per-issue evidence columns,
crawl-diff issue lifecycle). (b) OTTO proves the client's autonomous-fix premise is a real
shipping product category — and its crawler blindness to JS is a wedge for us. (c) The
enterprise lane's lesson: architect toward the URL-keyed join (crawl × GSC × logs) — our
D-03 Postgres decision already points there.

**Tier 1 — Record completeness (feeds POC-2 rules; small, do with/before POC-2):**
OG/Twitter extraction; multi-instance title/desc/H1 capture; title/desc pixel-width calc;
hreflang extraction (head first); meta refresh/keywords; HTML size + text ratio + compression
+ security headers + HTTP version; DOM node count; keep BOTH raw + rendered HTML on
escalation + divergence fields (title/meta/canonical/robots/links changed-by-JS); optional
external-link HEAD checks (capped, polite).

**Tier 2 — Graph & similarity post-pass (the "understanding" layer, plan §2/D-04):**
internal PageRank over stored link edges (log-scaled 1-100); near-dup minhash clustering w/
adjustable threshold; anchor-text aggregation per target + link-position classification
(nav/content/footer via DOM ancestry); multi-source orphan set algebra formalized.

**Tier 3 — Operations:** crawl-over-crawl differ (two run dirs → added/removed/changed URLs,
element-level diffs, issue new/fixed/persisting once POC-2 lands) + dashboard compare view;
scheduled recrawls (start simple: dashboard-managed schedule); crawl resume.

**Tier 4 — Performance:** lab vitals via our own Chromium during escalation + a sampling mode
(Sitebulb model — no API quota); optional BYO PSI key → CrUX field data (Ahrefs/SF model).

**Tier 5 — Platform-scale (MVP phase, already in DECISIONS):** Postgres store (D-03), queue/
workers (D-06), log ingestion + verified-bot classification, segmentation, custom extraction,
ownership verification, GSC join (POC-7), CI gating (fits SPEC §13-15 validation pipeline).

**Recommended sequence**: Tier 1 + POC-2 analyzer together (rules consume the new fields) →
Tier 2 (graph pass; feeds link-related rules + later internal-linking POC) → Tier 3 diff
(unlocks issue lifecycle + monitoring story) → Tier 4 → Tier 5 with the MVP build-out.
