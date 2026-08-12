# Technical SEO Detection Rules — Research Lane (SPEC §6, feeds §14)

Research date: 2026-08-10. All thresholds verified against current vendor documentation and
Google Search Central docs. Inline [n] citations map to the numbered Sources list.

---

## Summary

**Recommendation:** Build the detection engine as a deterministic rulebook (~70 rules across 6
categories) computed entirely from crawl data + HTTP responses, with severity and safety class
attached to every rule at authoring time — not decided by AI at runtime. Copy the threshold
posture of Screaming Frog (the de-facto industry reference; its issues catalog publishes exact
pixel/character/size thresholds [1]) but make every threshold a per-project config value, since
every major tool (Screaming Frog, Sitebulb, Semrush, Ahrefs) makes them configurable and their
defaults disagree (e.g. title "too long" = 60 chars in Screaming Frog vs 70 in Semrush [1][3]).

Three findings materially shape the platform architecture:

1. **Index-state verification is quota-starved.** The Google URL Inspection API allows only
   **2,000 inspections/day per property (600/min)** [7] — on a 100k-page site that is a 50-day
   full sweep. Index verification must therefore be a *sampling/prioritization* layer (verify the
   pages you changed + a rotating sample), never a full-site sweep. IndexNow does **not** reach
   Google at all [12]; Google's Indexing API is restricted to JobPosting/BroadcastEvent pages at
   200 requests/day [10]. Google-side freshness signaling is effectively limited to sitemap
   `lastmod` + GSC sitemap ping.

2. **The single biggest false-positive engine is Google itself.** Google rewrites 61.6%→76% of
   title tags (Zyppy 2021 study → Q1-2025 update) [25][26][27], ignores 30–40% of rel=canonical
   annotations when its ~40 other canonicalization signals disagree [15], ignores
   `<priority>`/`<changefreq>` in sitemaps [13], and treats 404 vs 410 near-identically [28][29].
   Every rule in the rulebook below carries an explicit false-positive-trap list; the decision
   engine must consume those, not just the raw flag.

3. **The safe-to-auto-fix boundary is narrower than the detect list.** Of ~70 detectable issue
   types, only ~15 are safely auto-appliable (LOW), ~25 belong in automated-PR-with-human-merge
   (MEDIUM), and the rest are detect-and-report-only (HIGH). The definitive mapping is the final
   section; it is consistent with SPEC §14's examples and extends them to the full catalog.

---

## Findings

### 0. What the industry tools actually flag (calibration baseline)

| Tool | Catalog size | Severity model | Thresholds configurable? |
|---|---|---|---|
| Screaming Frog SEO Spider | ~130 issues, published per-issue with exact thresholds [1] | Issue / Warning / Opportunity × High/Med/Low priority | Yes (title/desc pixel+char limits, link counts) |
| Semrush Site Audit | 140+ checks [3][33] | Errors / Warnings / Notices (Notices excluded from health score) [33] | Partially |
| Ahrefs Site Audit | 170+ issues [5] | Errors / Warnings / Notices | Yes |
| Sitebulb | 300+ "Hints", 15 categories [4] | Critical / High / Medium / Low + "Insight" | Yes (content thresholds tab) |

The union of these catalogs is the practical ceiling of "what a crawler can detect"; SPEC §6's
list is a proper subset of it. The rulebook below covers the SPEC list at Screaming-Frog-level
precision.

---

### 1. Indexing rules

#### 1.1 Noindex pages

- **Detection:** Parse `<meta name="robots">` / `<meta name="googlebot">` in `<head>` for
  `noindex`/`none` (`none` = `noindex,nofollow`); parse `X-Robots-Tag` HTTP response header.
  Both the raw-HTML and *rendered* DOM must be checked — JS frameworks can inject or remove the
  tag at render time. Screaming Frog classes `Noindex` and `None` as Warning/High [1].
- **Cross-signal rule (the actual issue):** noindex is only a *problem* when it contradicts
  intent — flag `noindex` pages that (a) are in the XML sitemap, (b) receive internal links from
  indexable pages, (c) get GSC impressions, or (d) are canonical targets of other pages.
  A bare noindex on a cart/login/filter page is correct behavior.
- **FP traps:** staging-tag left on launch (real issue, highest value catch); intentional noindex
  on faceted/thin pages (not an issue); meta tag outside `<head>` is ignored by Google (Screaming
  Frog flags "Outside <head>" separately as Issue/High [1]); a page blocked by robots.txt with a
  noindex tag — Google never sees the tag [20], so its index state is indeterminate, not "noindexed."
- **Safety:** *Removing* a noindex = MEDIUM (PR; wrong removal floods the index). *Adding*
  noindex = HIGH (never auto — it deindexes revenue pages on a bad classification).

#### 1.2 Robots.txt blocking

- **Detection:** Fetch and parse `/robots.txt` with a parser matching Google's spec: only
  `user-agent`, `allow`, `disallow`, `sitemap` are supported; longest-match-wins precedence;
  file limit 500 KiB — "content which is after the maximum file size is ignored" [19]. Evaluate
  every crawled URL against the Googlebot group. Flag: indexable pages disallowed; disallowed
  pages present in sitemap (Semrush "incorrect pages in sitemap" class [3]); blocked CSS/JS
  render resources (Semrush Warning [3], Screaming Frog "Blocked Resource" Warning/High [1]).
- **Status-code semantics (detection must model these):** 4xx robots.txt (except 429) = "as if a
  valid robots.txt file didn't exist" → everything crawlable; 5xx = Google stops crawling up to
  12h, serves a cached copy up to 30 days, then treats as nonexistent or stops crawling entirely;
  robots.txt redirects are followed "at least five hops" then treated as 404 [19].
- **`noindex`/`crawl-delay`/`nofollow` inside robots.txt:** unsupported by Google since
  2019-09-01 [20] — flag as a lint error (the site owner believes something false), and never
  emit them in any generated robots.txt.
- **FP traps:** robots.txt is UA-group scoped — a `Disallow: /` under `User-agent: SomeBot` is
  not a Google problem; a `Disallow` on a URL that is *also* noindexed is a conflict (Google
  can't see the noindex) — this specific combination deserves its own rule; wildcards `*`/`$` are
  supported by Google but not by all engines.
- **Safety:** ALL robots.txt writes = HIGH, never auto-deploy (SPEC §14 names this explicitly).
  One wrong line deindexes the site. Detection + proposed diff only.

#### 1.3 Canonical problems (conflict-detection logic)

Google's documented signal strengths: redirect = "strong signal", rel=canonical annotation =
"strong signal", sitemap membership = "weak signal" [14]. Google uses ~40 signals total and
overrides 30–40% of declared canonicals when signals conflict [15]. Detection is therefore a
**signal-consistency audit**, not a tag check. Per URL, collect the 6-signal tuple:

`(rel=canonical in HTML head, rel=canonical HTTP header, sitemap membership, redirect target,
internal-link target URL forms, hreflang references)` — and flag any disagreement:

| Rule | Detection | Industry framing | Safety |
|---|---|---|---|
| Missing canonical | no rel=canonical anywhere | SF Warning/Medium [1] | LOW (add self-referencing canonical) |
| Multiple conflicting canonicals | >1 rel=canonical with different hrefs (head + header) | SF Issue/High [1]; Semrush Error [3] | MEDIUM |
| Canonical → non-indexable target | target is noindex / 4xx/5xx / redirect / robots-blocked | SF Issue/High "Non-Indexable Canonical" [1]; Semrush Error "broken canonical" [3] | MEDIUM |
| Canonicalised page still linked/sitemapped | page canonicals elsewhere but sits in sitemap or gets strong internal links | SF Warning/High "Canonicalised" [1] | MEDIUM |
| Canonical chain | A→B, B→C | derived rule; Google resolves only one hop reliably | MEDIUM |
| Canonical is relative / contains fragment / outside head | string checks on the annotation | SF: relative = Warning/Low; fragment & outside-head = Issue/High [1] | LOW (normalize to absolute, strip fragment) |
| Cross-signal conflict | canonical says A, sitemap lists B, redirects point to C | root cause of GSC "Duplicate, Google chose different canonical" [15] | MEDIUM |

- **Google-side verification:** URL Inspection API returns both `userCanonical` and
  `googleCanonical` [8] — a mismatch is the definitive "Google overrode you" signal; budget
  inspections for pages where the crawler found signal conflicts.
- **FP traps:** parameter/tracking-URL canonicals to the clean URL are *correct*; paginated
  series canonicalizing page-2+ to page-1 is a real (common) misconfiguration but "fixing" it
  changes indexing behavior — MEDIUM; cross-domain canonicals (syndication) look "wrong" to a
  single-site crawler but are intentional.
- **"Large-scale canonical changes" = HIGH** per SPEC §14: any fix batch touching canonicals on
  >N pages (suggest N=25 or >2% of site) must escalate from MEDIUM to HIGH.

#### 1.4 Sitemap problems (validation rules)

- **Hard limits (validate mechanically):** ≤50,000 URLs and ≤50 MB *uncompressed* per sitemap
  file; must be UTF-8; URLs must be fully-qualified absolute [13]. Sitemap index files needed
  beyond that. Screaming Frog flags both limit breaches as Issue/High [1]; Semrush as Errors [3].
- **Content rules:** only canonical, indexable, 200-status URLs belong in a sitemap [13].
  Detect: non-indexable URLs in sitemap (noindexed / robots-blocked / redirecting / 4xx/5xx /
  canonicalised-away) — SF Issue/Medium, Semrush Error [1][3]. Detect indexable crawled URLs
  *missing* from the sitemap (SF Issue/Medium), URLs in multiple sitemaps (SF Warning/Low),
  sitemap not referenced in robots.txt (Semrush Warning [3]), missing sitemap entirely (Semrush
  Warning [3]).
- **`lastmod`:** Google uses it only "if it's consistently and verifiably accurate";
  `<priority>` and `<changefreq>` are ignored [13]. Rule: flag sitemaps where every lastmod is
  identical or equals generation time (the signature of an auto-stamper) — this destroys the one
  field Google actually reads.
- **FP traps:** an "orphan" URL found only via sitemap is often an intentional landing page;
  image/video/news sitemap extensions have separate schemas — don't validate them against the
  core urlset XSD.
- **Safety:** Sitemap regeneration from the crawl's canonical indexable set = **LOW** (fully
  mechanical, easily validated, easily reverted). This is the single highest-leverage auto-fix
  in the catalog.

#### 1.5 Duplicate URLs / HTTP-HTTPS / WWW

- **Detection:** URL-normalization clustering — group crawled URLs by
  (lowercased host sans `www.`, path sans trailing slash, sorted query params) and flag clusters
  where >1 variant returns 200 with substantially identical content. Specific probes: request
  `http://` variant of the canonical host (expect 301 to https); request the other www variant
  (expect 301 to the chosen host). Semrush: "WWW resolution issues — version preference not
  specified" and "Missing HTTPS redirect/canonical — both HTTP and HTTPS versions coexist" are
  Errors [3]. Content-level duplication: Semrush flags pages ≥85% identical [3]; Screaming Frog
  separates Exact Duplicates (Issue/High) from Near Duplicates (Warning/Medium) [1].
- **Google behavior:** "Google prefers HTTPS pages over equivalent HTTP pages as canonical,
  except when there are issues or conflicting signals" — e.g. an invalid TLS cert or
  HTTPS→HTTP redirects "cause Google to prefer HTTP very strongly" [14].
- **FP traps:** case-sensitive paths on some servers (normalizing case can break URLs);
  parameters that *do* change content (pagination, language) must be excluded from the
  "duplicate parameter" heuristic; trailing-slash pairs that both 200 but serve different
  content (rare, real).
- **Safety:** host-level redirect rules (HTTP→HTTPS, www policy) = **HIGH** (server-config,
  site-wide blast radius; SPEC §14 "mass redirects"). Adding a canonical annotation to duplicate
  clusters = MEDIUM.

---

### 2. HTTP status rules

| Rule | Detection | Thresholds / behavior facts | Safety of the fix |
|---|---|---|---|
| Internal 4xx (404) | any internally-linked URL returning 4xx | SF Issue/High [1]; Semrush Error [3] | Fixing the *link* = LOW; redirecting the dead URL = MEDIUM |
| 410 vs 404 | status distinction | Google treats them near-identically; 410 drops "on the order of a couple days" faster [28][29] | Converting 404→410 = negligible value; don't automate |
| Soft 404 | 200-status page whose content is an error/empty template — detect via template similarity to the site's real 404 page, thin content + "not found"/"no results" phrases; confirmable via URL Inspection `pageFetchState: SOFT_404` [8] | Google-side classification, no public threshold | Diagnosis only; the fix (real 404/410 vs content repair vs redirect) is a content decision = MEDIUM–HIGH |
| Internal 5xx | any internal URL returning 5xx during crawl | SF Issue/High [1]; Semrush Error [3]; also: 5xx on robots.txt halts Google crawling entirely [19] | Not code-fixable by an SEO bot; alert-only |
| 301 vs 302 misuse | permanent moves served as 302/307 | "Googlebot follows the redirect, but the indexing pipeline doesn't use [a temporary redirect] as a signal that the redirect target should be canonical" [16]; Semrush flags temporary redirects as Warnings [3] | 302→301 swap = MEDIUM (verify the move is truly permanent) |
| Redirect chains | follow each redirect to terminus, count hops | Google follows up to 10 hops before Search Console reports a redirect error [17]; Mueller: keep <5 [18]; Semrush errors at >3 [3]; recommend flagging at >2, hard-error at ≥5 | Updating internal links to point at the final target = **LOW**; collapsing the server-side chain = MEDIUM–HIGH |
| Redirect loops | terminus revisits a hop | SF Issue/High [1]; Semrush Error (chains & loops class) [3] | Loop break requires intent knowledge = MEDIUM |
| Meta refresh / JS redirects | `<meta http-equiv=refresh>`; rendered-vs-raw URL diff | Instant (0s) meta refresh is interpreted as permanent, delayed as temporary; JS redirects can be missed entirely when rendering fails [16] | Replace with 301 = MEDIUM |

- **FP traps:** transient 5xx/429 during an aggressive crawl (require 2 confirmations spaced in
  time before flagging — Semrush counts "couldn't be crawled" at >5s response [3], which conflates
  slow with broken); intentional 302s (A/B tests, geo-redirects); soft-404 classifiers
  false-positive on legitimately thin pages ("0 results" search pages, empty category pages);
  link-level 404s caused by the crawler hitting login-gated URLs.

---

### 3. On-page rules (title / meta description / headings)

Exact current thresholds by tool (the numbers an expert reviewer will ask for):

| Element | Screaming Frog default [1] | Semrush [3] | Google reality |
|---|---|---|---|
| Title too long | >60 chars or >561 px | >70 chars | No hard limit; SERP truncates by pixel width (~600px viewport); length is the #1 rewrite trigger [25] |
| Title too short | <30 chars or <200 px | ≤10 chars | — |
| Title missing/multiple/outside head | Issue/High | Missing = Error | Multiple titles: Google picks one |
| Title duplicate | Opportunity/Medium | Error | Signals template problems |
| Title same as H1 | Opportunity/Low | "Duplicate H1 and title" Warning | — |
| Meta description too long | >155 chars or >985 px | — | Google truncates ~920–985px and frequently replaces descriptions entirely |
| Meta description too short | <70 chars or <400 px | — | — |
| Meta description missing/duplicate | Opportunity/Low; Multiple = Issue/Medium | Missing = Warning; Duplicate = Error | Google generates its own snippet when absent/ignored |
| H1 missing | Issue/Medium | Warning | Not a ranking requirement; a hygiene/consistency check |
| H1 multiple | Warning/Medium | Notice | Google: multiple H1s are "fine" (Mueller, many statements) — hence low severities |
| H1 >70 chars | Opportunity/Low | — | — |
| Heading hierarchy skips (H1→H3) | "Non-sequential" Warning/Low [1] | — | Accessibility issue more than SEO |
| Low word count | "Low Content Pages" Opportunity/Medium (configurable) [1] | <200 words Warning [3] | No Google minimum; context-dependent |
| Text-to-HTML ratio | — | ≤10% Warning [3] | Widely considered a legacy metric; high FP rate on JS apps |

- **Detection notes:** compute pixel widths with the actual SERP font metrics (SF's approach:
  measure per-glyph at Google's SERP font sizes; their original calibration was 18px Arial for
  titles, 13px Arial for descriptions [2], with limits re-tracked over time to the current
  561/985px flags [1]). Titles/descriptions must be read from the *rendered* head; also detect
  the pathological "outside `<head>`" placement (a stray `<div>` before a meta tag silently
  closes the head in browser parsing — SF has explicit issues for this [1]).
- **FP traps (this category is FP-dense):**
  - Google rewrites 61.6% (2021, 80k titles) → 76% (Q1-2025) of titles [25][26][27]; rewrite
    likelihood is *lowest* (39–42%) at 51–60 chars [26]. So "title over 60 chars" is a real
    but *probabilistic* problem — the fix's value is capped, and post-fix "verification" by
    checking the SERP snippet measures Google's rewriter, not your tag.
  - Duplicate titles across paginated/faceted variants that are canonicalised together are not
    an issue — dedupe rules must group by canonical cluster first, or the count is inflated 5–10×.
  - Brand-suffix templates ("… | Brand") push many titles 3–8 chars over limits with no harm;
    apply thresholds to the pre-suffix segment or allow a brand-suffix allowance.
  - Multiple H1s in HTML5 sectioned markup are valid; severity Low is correct — do not let the
    scorer promote it.
- **Safety:** missing meta description = **LOW** (SPEC §14 names it); duplicate metadata
  de-duplication = **LOW**; title/H1 *changes* = **MEDIUM** (PR — titles are ranking-sensitive);
  heading-structure refactors = MEDIUM; content-length fixes = MEDIUM (content generation).

---

### 4. Link rules

| Rule | Detection | Thresholds | Safety |
|---|---|---|---|
| Broken internal links | edge list × status map: any `<a href>` to a 4xx/5xx/no-response internal URL | SF Issue/High; Semrush Error [1][3] | **LOW** when a redirect/replacement target exists (SPEC §14 names it); MEDIUM when target choice is ambiguous |
| Broken external links | same, external targets | SF Warning/Low; Semrush Warning [1][3] | LOW (remove link or swap to archived/alternate URL — content-neutral edit); flag-only if no replacement |
| Orphan pages | URL known from sitemap/GSC/analytics but with **zero incoming internal links** in the crawl graph [6] | Ahrefs/SF both require a non-crawl discovery source (sitemap, GSC) to even see them [1][6] | Adding links *to* orphans = MEDIUM (placement/anchor is editorial) |
| Weakly linked pages | inlink count ≤ K (Semrush notices "single internal link source" = 1 inlink [3]) | K=1 notice; rank-weighted internal PageRank percentile is the better metric | MEDIUM |
| Excessive links | outlink count per page | Google: "a few thousand at most" (the old 100-link guidance is dead) [32]; Semrush errors only at >3,000 [3]; SF "High Internal Outlinks" Warning/Low at a configurable default | Trimming links = MEDIUM–HIGH (navigation changes) |
| Deep pages | click depth from home | Semrush notices >3 clicks [3]; SF "High Crawl Depth" Opportunity/Medium [1] | Structural = HIGH |
| Nofollow anomalies | internal `rel=nofollow`; pages whose *only* inlinks are nofollow | SF Warning/Low & Warning/High respectively [1]; Semrush Warning [3] | Removing internal nofollow = LOW (attribute-only edit) |
| Anchor-text quality | empty anchors, "click here"-style generic anchors | SF Opportunity/Low; Semrush Notice [1][3] | Anchor rewrite = MEDIUM (visible copy) |
| Uncrawlable outlinks | hrefs that are JS pseudo-links (`javascript:`), malformed URLs, localhost | SF: "Outlinks to Localhost" Issue/High; "Uncrawlable outlinks" Warning/High [1]; Semrush "malformed links" Error [3] | Fixing malformed hrefs = LOW |

- **FP traps:** orphan detection is only as good as the discovery-source union — a page absent
  from sitemap+GSC+crawl is invisible, so "orphan count" is a lower bound; links rendered only
  after user interaction (accordion menus, infinite scroll) undercount inlinks unless the
  renderer scrolls/expands; e-commerce faceted URLs inflate "excessive links" counts; footer/nav
  links make raw inlink-count a weak importance signal (weight by link position/uniqueness).

---

### 5. Image rules

| Rule | Detection | Thresholds | Safety |
|---|---|---|---|
| Missing alt attribute vs empty alt | DOM: `img` without `alt` attr ≠ `alt=""` (decorative, valid) | SF splits "Missing Alt Text" and "Missing Alt Attribute", both Issue/Low [1]; Semrush Warning [3] | Adding alt on *missing* = **LOW** (SPEC §14); do not overwrite intentional `alt=""` |
| Alt text too long | >100 chars | SF Opportunity/Low [1] | LOW |
| Large images | file bytes over threshold | SF flags >100 KB (Opportunity/Medium) [1]; Lighthouse flags any image whose responsive-size savings ≥4 KiB ("properly size images") [23] | Recompression/resizing = LOW **only** via lossless or build-pipeline transforms; lossy recompress = MEDIUM |
| Unsupported / legacy formats | extension+MIME vs Google's support list: **BMP, GIF, JPEG, PNG, WebP, SVG, AVIF** [22] | Lighthouse "modern formats" audit flags ≥4 KiB potential savings from WebP/AVIF conversion [24] | Format conversion = MEDIUM (needs `<picture>`/fallback plumbing; Google explicitly recommends always keeping a fallback `src` [22]) |
| Missing width/height attributes | DOM check | SF "Missing Size Attributes" Opportunity/Low [1]; causes CLS | Adding measured intrinsic dimensions = **LOW** (mechanical, verifiable) |
| Incorrectly sized images | rendered size vs intrinsic size ≥4 KiB waste [23] | Lighthouse pass/warn/fail bands on total savings: <150 ms / 150–935 ms / >935 ms [23] | MEDIUM (srcset generation) |
| Broken images | `img src` → 4xx/5xx | Semrush: internal = Error, external = Warning [3] | Fix/remove = LOW |

- **FP traps:** decorative images *should* have empty alt — an "add alt everywhere" bot damages
  accessibility; CSS background images are invisible to `img` audits (SF tracks them as a
  separate Warning [1]); srcset/`<picture>` variants make "large image" per-URL counts
  misleading (audit the *selected* candidate at common viewports); SVG "dimensions" rules don't
  apply the same way; alt-text keyword stuffing is itself a violation of Google's guidance
  ("Dalmatian puppy playing fetch"-style descriptive text, no stuffing [22]) — cap generated alt
  at ~100 chars and ban keyword lists.
- **Fix application for the rows above** (re-encode pipeline, same-URL binary replacement per
  platform, srcset/dimension generation, CDN-level optimization) is researched in
  `site-modification.md` → "Addendum: Image optimization — fix application mechanics". Two
  detection-side consequences from that lane: (1) measure the **delivered** bytes/format, not the
  stored original — Shopify's CDN auto-serves WebP/AVIF and `next/image`/Cloudflare Polish
  rewrite delivery, so origin-file audits alone produce false positives; (2) Shopify `fileUpdate`
  officially replaces file content at the same URL, so same-URL recompression is a real LOW
  auto-apply channel there, not just on WordPress.

---

### 6. Structured data rules

- **Detection stack (three layers, run in order):**
  1. **Parse:** extract JSON-LD (also Microdata/RDFa) from rendered DOM; JSON syntax errors =
     SF "Parse Errors" Issue/High [1].
  2. **Vocabulary validation:** validate against schema.org definitions (unknown types/properties,
     bad value types) — the function of validator.schema.org; Semrush "invalid structured data —
     fields violating schema.org guidelines" is an Error [3].
  3. **Rich-result eligibility:** validate against *Google's* per-feature required/recommended
     property lists (Product needs offers/review/aggregateRating etc.) from the Search Gallery
     docs [30]. SF separates "Validation Errors" from "Rich Result Validation Errors" for exactly
     this reason [1].
- **Missing schema** (the opportunity side): page-type classifier (product/article/FAQ/recipe/
  org/breadcrumb) × schema-presence map → "missing schema" opportunities; SF classes Missing as
  Opportunity/Low [1].
- **Wrong-type detection:** page classified as X carries schema of type Y (e.g. `Article` on a
  product page); also mismatched content (schema price ≠ visible price) — that mismatch is a
  Google spam-policy risk, not just a bug.
- **Tooling reality (matters for the validation engine):** there is **no public Google API for
  the Rich Results Test**; the old Structured Data Testing Tool API was deprecated without
  replacement; the only programmatic Google-side signal is `richResultsResult` in the URL
  Inspection API — which works only for pages in a verified property [31][8]. So the platform
  must ship its own validator: JSON-LD parse + schema.org vocabulary + a maintained ruleset
  mirroring Google's feature docs [30]. (Screaming Frog embeds exactly this trio [1].)
- **FP traps:** schema.org-valid ≠ Google-eligible (two different rule sets — most confusion
  comes from conflating them [31]); Google's required-properties lists change several times a
  year (FAQ/HowTo rich results were deprecated for most sites in 2023 — generating them is
  wasted effort); JSON-LD injected by tag managers appears only in rendered HTML.
- **Safety:** fixing *invalid* JSON-LD (syntax, absolute-URL normalization, closing a bad date
  format) = **LOW** (SPEC §14 names invalid JSON-LD); adding/retyping schema = **MEDIUM**
  (wrong or content-mismatched markup risks manual actions); auto-generating review/rating
  values = **never** (policy violation).

---

### 7. Index-state verification: Google URL Inspection API (quota reality)

- **Quotas:** 2,000 queries/day **per property** + 600 queries/minute per property; per-project
  ceiling 10,000,000/day and 15,000/min [7]. The daily quota is a rolling 24h window and is
  shared across all users/tools inspecting that property [9]. Prefix properties each carry their
  own quota — verified subfolder/subdomain prefix properties multiply the effective budget [9][34].
- **Response payload worth consuming** [8]: `verdict` (PASS/PARTIAL/FAIL/NEUTRAL),
  `coverageState` (human-readable index status), `robotsTxtState` (ALLOWED/DISALLOWED),
  `indexingState` (INDEXING_ALLOWED / BLOCKED_BY_META_TAG / BLOCKED_BY_HTTP_HEADER /
  BLOCKED_BY_ROBOTS_TXT), `pageFetchState` (SUCCESSFUL / **SOFT_404** / NOT_FOUND / SERVER_ERROR
  / REDIRECT_ERROR …), `lastCrawlTime`, `googleCanonical` vs `userCanonical`, `sitemap[]`,
  `referringUrls[]`, `crawledAs` (DESKTOP/MOBILE), plus `richResultsResult`.
- **Design consequence:** at 2k/day/property → 100-page site = trivial; 10k-page = 5 days for a
  full pass; 100k-page = 50 days. Verification must be **budgeted**: (1) every changed URL gets
  inspected before/after a change window, (2) pages with crawler-detected signal conflicts get
  priority, (3) a stratified random sample (by template/section) tracks site-wide index health.
  Note the API **cannot request indexing** — it is read-only inspection [34].
- **Sitemaps API** (submit/list/delete sitemaps) falls under "all other resources": 20 QPS /
  200 QPM per user [7] — effectively unconstrained for this use.

### 8. IndexNow + Google Indexing API (change-notification layer)

- **IndexNow:** open protocol; one POST to `https://api.indexnow.org/indexnow` fans out to all
  participating engines; up to **10,000 URLs per POST**; ownership proven by a key file hosted at
  the site root [11]. Engines: **Bing, Yandex, Seznam, Naver, Yep** — **Google does not
  participate** (tested it in 2022, never adopted; still true as of 2026) [12]. Bing's index
  feeds ChatGPT Search/Copilot and partially Perplexity, so IndexNow is the cheap win for AI-search
  visibility [12]. Essentially free to implement: fire on every applied change. Safety: LOW.
- **Google Indexing API:** restricted to pages with **JobPosting or BroadcastEvent** structured
  data; default quota **200 publish requests/day** (180 read/min) [10]. Using it for ordinary
  pages violates its terms and Google has publicly cracked down — do not build on it for a
  general-purpose platform.
- **Net:** for Google, freshness signaling = accurate sitemap `lastmod` [13] + sitemap
  resubmission; there is no legitimate push channel.

### 9. Hreflang basics (detect-only in v1)

- **Three carriers:** HTML `<link rel="alternate" hreflang>` in head, HTTP `Link:` header (for
  PDFs etc.), XML-sitemap `<xhtml:link>` entries [21]. A site may use several; conflicting
  carriers = Semrush Error ("hreflang conflicts within page source code") [3].
- **Hard rules to validate:** codes = ISO 639-1 language + optional ISO 3166-1 Alpha-2 region
  (`en`, `en-GB`; script via ISO 15924); region-only values are invalid; `UK` is invalid (use
  `GB`) [21]. **Bidirectional confirmation is mandatory: "If two pages don't both point to each
  other, the tags will be ignored"** [21]. Each page must self-reference; `x-default` recommended
  for the fallback/selector page [21].
- **Detection set (Screaming Frog's is the completest — all Issue/High):** non-200 hreflang
  targets, missing return links, inconsistent language+region confirmations, non-canonical return
  links, noindexed return links, invalid codes, multiple conflicting entries, hreflang not using
  the canonical URL, annotations outside head; plus Warnings for missing self-reference and
  missing x-default [1].
- **FP traps:** `en` vs `en-US` pairs are both valid and *not* conflicting; hreflang clusters
  spanning domains can't be fully verified without crawling all of them; return-link validation
  requires crawling every alternate URL — expensive on large international sites (sample per
  template).
- **Safety:** syntactic normalization (fix `en_UK`→`en-GB`, absolute-ize URLs) = LOW; building
  or repairing cluster reciprocity = MEDIUM–HIGH (wrong pairs misroute whole countries).

---

## Options compared — threshold posture per rule family

| Rule family | Strictest tool default | Loosest tool default | Recommended platform default |
|---|---|---|---|
| Title length | SF: 30–60 chars / 200–561 px [1] | Semrush: 10–70 chars [3] | Flag <30 or >60 chars (px check 200–561 secondary); severity Opportunity only |
| Meta description | SF: 70–155 chars / 400–985 px [1] | (Semrush has no length check) | 70–155 chars; missing = auto-fix candidate |
| Redirect chain | flag ≥2 hops (SF reports all chains) [1] | Semrush error at >3 [3] | Warn ≥2, error ≥5 (Mueller guidance [18]), critical ≥10 (Google gives up [17]) |
| Links per page | SF configurable warning (low default) | Semrush 3,000 [3]; Google "a few thousand" [32] | Warn >1,000, error >3,000 |
| Low content | Semrush <200 words [3] | SF configurable | <200 words on *content* templates only; never on utility pages |
| Image weight | SF >100 KB [1] | Lighthouse ≥4 KiB savings [23] | >100 KB flag; >300 KB high; Lighthouse-style savings estimate for prioritization |
| Duplicate content | Semrush ≥85% similarity [3] | SF near-dup (configurable ~90%) | 90% simhash similarity within canonical clusters excluded |
| Crawl depth | Semrush >3 clicks [3] | SF configurable | >4 clicks for content pages, informational only |
| URL length | SF >115 chars [1] | Semrush notice >200 / warning >2,000 [3] | >115 informational; parameters >4 informational [3] |

Where tools disagree, the recommended default is the *looser* bound with severity capped at
Opportunity/Notice — because the platform (unlike an audit report) triggers downstream
*actions*, and FP cost is an unwanted PR, not a wasted row in a report.

---

## Recommendation & why

1. **Deterministic rules, versioned as data.** Encode each rule as
   `{id, category, detector fn over crawl-store, threshold params, severity, confidence-of-detection,
   safety class, FP-suppression conditions}`. AI never decides *whether* something is an issue;
   it only generates *fix content* for rules that request it (titles, alt text, schema bodies).
   This is what makes the system explainable (SPEC §3) and auditable (SPEC §16).
2. **Canonical-cluster-first evaluation.** Run URL normalization + canonical clustering *before*
   on-page dedupe rules; this single ordering decision removes the largest FP class (duplicate
   titles/descriptions across parameter variants).
3. **Two-source confirmation for negative states.** No 4xx/5xx/timeout finding enters the fix
   queue on a single observation; re-probe after ≥1h. (Semrush's ">5s = couldn't crawl" [3]
   shows how easily "slow" becomes "broken".)
4. **Budgeted Google-truth layer.** Use URL Inspection (2k/day/property [7]) only for
   (a) changed pages pre/post, (b) conflict pages, (c) a rotating stratified sample; use
   `googleCanonical` vs `userCanonical` and `pageFetchState=SOFT_404` as the ground-truth
   signals the crawler can't compute [8]. Create prefix properties per major section to multiply
   quota on large sites [9].
5. **Ship IndexNow day one; skip Google Indexing API entirely** [10][11][12].
6. **Safety classes are attached to the fix, not the finding** — the same finding can have a LOW
   fix (update the internal link pointing at a 301) and a HIGH fix (change the server redirect
   map). The final table below is authored on the fix.

## Risks & limitations

- **Google's opacity:** rendering, canonical choice, title rewriting and soft-404 classification
  are all Google-internal; the rulebook approximates them. Post-fix "success" measurement must
  use GSC performance data, not SERP-snippet string-matching (76% title-rewrite rate makes the
  latter meaningless [27]).
- **Quota wall:** 2k inspections/day/property [7] hard-bounds index-state freshness on
  100k+-page sites; architecture must not promise per-page index verification at that scale.
- **Rendered-DOM dependence:** meta robots, canonicals, JSON-LD and links are all mutable by JS;
  a raw-HTML-only detector materially mis-detects on React/Next sites (the SPEC's primary
  target). Both views must be stored and diffed; the diff itself is a detection signal.
- **Threshold drift:** Google changed pixel truncation multiple times (512px 2014 → 561px flag
  today [1][2]); vendor thresholds change too. Thresholds must live in config with a review
  cadence, not in code.
- **Catalog churn in structured data:** Google's eligible rich-result types and required
  properties change several times a year [30]; the schema ruleset needs a maintenance owner.
- **False-positive asymmetry:** a missed issue costs an opportunity; a false positive that
  auto-fixes costs trust and possibly rankings. All ambiguous cases must degrade to
  report-only — the classes below already encode that.

---

## The definitive list: what can be fixed automatically

Maps to SPEC §14. **LOW = auto-apply** (mechanical, content-neutral or additive, trivially
verifiable, trivially reversible). **MEDIUM = automated PR, human merges** (content- or
ranking-sensitive, correct >90% of the time but wrong is visible). **HIGH = never auto-deploy**
(site-wide blast radius or irreversibility).

### LOW — safe to auto-apply
| Fix | Why safe |
|---|---|
| Generate/add missing meta descriptions | Additive; Google already substitutes its own when absent; zero ranking downside |
| De-duplicate duplicate meta descriptions | Restores intent; validated by string diff |
| Add alt text where the attribute is missing (never overwrite `alt=""`) | Additive, accessibility-positive [22] |
| Fix broken internal links where the target 301s or an exact replacement exists | Pure graph repair; verifiable by re-crawl |
| Update internal links that point at redirects → final target | Content-neutral URL swap [16] |
| Repair malformed hrefs / localhost links | Mechanical [1] |
| Fix invalid JSON-LD (syntax, date/URL formats) — no semantic additions | Restores what the site already declared |
| Add self-referencing canonical where none exists | Additive, matches Google's recommendation [14] |
| Normalize canonical annotations (relative→absolute, strip fragments) | Syntax-only [1] |
| Regenerate XML sitemap from canonical indexable set; split at 50k/50MB [13] | Fully mechanical; sitemap is advisory [13] |
| Correct `lastmod` to true content-modification dates | Restores the only sitemap field Google uses [13] |
| Add width/height attributes from measured intrinsic dimensions | Mechanical; CLS-positive |
| Lossless image recompression | Bit-identical rendering |
| Remove internal `rel=nofollow` on normal editorial links | Attribute-only |
| Hreflang syntax normalization (`en_UK`→`en-GB`, absolute URLs) | Syntax-only [21] |
| IndexNow pings on applied changes | Informational protocol [11] |

### MEDIUM — automated PR, human approval to merge
Title rewrites; H1 changes; heading-structure changes; meta-description *rewrites* (vs filling
missing); adding new internal links (incl. to orphans) and anchor-text changes; adding or
re-typing structured data; canonical changes on individual pages (conflict resolution, chain
collapse); 302→301 conversions; single-URL redirect creation for dead pages; image format
conversion (WebP/AVIF with fallback [22][24]); lossy compression; content additions; removing
noindex; sitewide template edits of any kind.

### HIGH — never auto-deploy (detect, diff, human executes)
robots.txt edits (any) [SPEC §14]; adding noindex; host-level redirect policy (HTTP→HTTPS, www
resolution); canonical changes above batch threshold (>25 pages or >2% of site); mass redirects /
URL restructuring; page deletion (404/410-ing); hreflang cluster restructuring; navigation/
architecture changes (crawl-depth fixes, link pruning); anything touching server config or CDN
rules; 5xx remediation (infrastructure, out of SEO scope — alert only).

**Bottom line for SPEC §26:** detection is ~100% automatable at industry-tool parity; roughly
15 fix types are truly hands-off; the ranking-sensitive middle belongs in the PR lane; and the
catastrophic-blast-radius set must stay human-gated permanently — not because generation is
hard, but because verification of intent is impossible from crawl data alone.

---

## Sources

1. https://www.screamingfrog.co.uk/seo-spider/issues/ — Screaming Frog full issues catalog with thresholds & severities
2. https://www.screamingfrog.co.uk/blog/page-title-meta-description-lengths-by-pixel-width/ — SERP pixel-width methodology (512px/920px original calibration)
3. https://www.semrush.com/kb/542-site-audit-issues-list — Semrush Site Audit full checks list (140+) with thresholds
4. https://sitebulb.com/hints/ — Sitebulb 300+ hints, 15 categories, severity tiers
5. https://ahrefs.com/en/site-audit — Ahrefs Site Audit (170+ issues, errors/warnings/notices)
6. https://help.ahrefs.com/en/articles/2694175-orphan-page-error-in-site-audit — Ahrefs orphan-page definition
7. https://developers.google.com/webmaster-tools/limits — Search Console API quotas (URL Inspection 2,000 QPD / 600 QPM per site)
8. https://developers.google.com/webmaster-tools/v1/urlInspection.index/UrlInspectionResult — URL Inspection response schema (verdict/indexingState/pageFetchState enums)
9. https://similar.ai/guides/google-search-console-api/ — quota behavior: rolling 24h window, shared per property, per-prefix quotas
10. https://developers.google.com/search/apis/indexing-api/v3/quota-pricing — Indexing API: JobPosting/BroadcastEvent only, 200 publish/day default
11. https://www.indexnow.org/documentation — IndexNow protocol (key file, 10,000 URLs/POST, api.indexnow.org fan-out)
12. https://www.indexernow.com/google-indexnow — Google non-participation in IndexNow as of 2026; participating engines
13. https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap — sitemap limits (50k URLs / 50MB uncompressed), lastmod policy, priority/changefreq ignored
14. https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls — canonicalization methods & signal strength, HTTPS preference, mistakes
15. https://ahrefs.com/blog/canonicalization/ — ~40 canonicalization signals; 30–40% of rel=canonical ignored
16. https://developers.google.com/search/docs/crawling-indexing/301-redirects — 301/302/meta-refresh/JS redirect treatment & canonical signaling
17. https://searchengineland.com/guide/too-many-redirects — Googlebot 10-hop redirect ceiling
18. https://www.searchenginejournal.com/googles-john-mueller-recommends-less-than-5-hops-per-redirect-chain/344664/ — Mueller: <5 hops
19. https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt — robots.txt spec: 500 KiB limit, 4xx/5xx semantics, supported fields
20. https://developers.google.com/search/blog/2019/07/a-note-on-unsupported-rules-in-robotstxt — noindex/crawl-delay/nofollow in robots.txt retired 2019-09-01
21. https://developers.google.com/search/docs/specialty/international/localized-versions — hreflang: methods, bidirectional requirement, ISO codes, x-default
22. https://developers.google.com/search/docs/appearance/google-images — supported image formats (BMP, GIF, JPEG, PNG, WebP, SVG, AVIF), alt guidance
23. https://developer.chrome.com/docs/lighthouse/performance/uses-responsive-images — "properly size images" ≥4 KiB threshold; 150/935 ms bands
24. https://developer.chrome.com/docs/lighthouse/performance/uses-optimized-images — image encoding savings audit
25. https://zyppy.com/seo/google-title-rewrite-study/ — 61.6% of 80k titles rewritten; length = top trigger
26. https://www.searchenginejournal.com/google-changes-more-than-61-percent-of-title-tags/435618/ — SEJ coverage incl. 51–60-char sweet spot (39–42% rewrite floor)
27. https://serpclix.com/blog/google-rewrites-title-tags-how-to-survive — Q1-2025 update: 76% rewrite rate
28. https://www.seroundtable.com/404-410-google-15225.html — Google: 404 & 410 treated the same (410 marginally faster)
29. https://www.searchenginejournal.com/googles-john-mueller-clarifies-404-410-confusion-for-seo/513576/ — Mueller 404/410 clarification
30. https://developers.google.com/search/docs/appearance/structured-data — Google structured-data feature docs & testing guidance
31. https://schemavalidator.org/guides/structured-data-testing-tool — no public Rich Results Test API; validator-vs-eligibility distinction
32. https://linkstorm.io/resources/how-many-internal-links-per-page — Google guideline history: 100-link rule removed → "a few thousand at most"
33. https://www.semrush.com/kb/541-site-audit-issues-report — Semrush errors/warnings/notices severity model
34. https://www.screamingfrog.co.uk/seo-spider/tutorials/how-to-automate-the-url-inspection-api/ — URL Inspection API automation practice (2k/day, read-only, per-property)
