# Keyword Intelligence + Google Search Console Integration — Data-Layer Research

Lane deliverable for SPEC §8 (Keyword Intelligence) and §9 (GSC Integration). Researched August 2026; all quotas/prices verified against current sources cited inline as [n].

---

## Summary

**GSC is the backbone of the keyword-intelligence layer and it is free, generous, and API-first — build on it as the primary data source.** The Search Analytics API gives per-property query/page/click/impression/CTR/position data with 1,200 QPM per-site rate limits and a 50k-rows/day/search-type ceiling; the BigQuery bulk export removes that ceiling for larger customers. The two structural caveats to design around: (a) ~47% of click volume hides behind "anonymized queries" [10], and (b) data retention is a rolling 16 months [12] — so the platform must warehouse every customer's GSC data from day one to own history beyond 16 months and to enable decay detection year-over-year.

**Auth:** use per-customer **OAuth 2.0 (3-legged)** with `webmasters.readonly` as the default scope. Publishing the app requires Google OAuth verification (sensitive-scope review: privacy policy, scope justification, demo video — but *not* the expensive CASA assessment that restricted scopes like Gmail/Drive require) [16][17][18]. Offer a **service-account fallback** ("add `sa@project.iam.gserviceaccount.com` as a user on your property") for enterprise customers who dislike OAuth grants [15][46].

**Third-party data:** use **DataForSEO** as the primary SERP + search-volume provider ($0.60–2.00 per 1k SERPs; ~$0.06–0.09 per 1,000 keywords' search volume via its Google Ads endpoints) [25][26][27] and **Serper** ($0.50–1.00 per 1k) where raw low-latency Google SERPs suffice [29][30]. Avoid Semrush/Ahrefs APIs for the platform's data plane — both gate API access behind $129–549+/mo subscriptions with restrictive caching/resale terms [32][33][34]. Google Keyword Planner via the Google Ads API is *not* a reliable foundation for a SaaS: keyword-planning services are blocked at the new Explorer access level, require Basic access approval, and return bucketed ranges without active ad spend [36][37][38].

**Algorithms:** the file proposes a concrete two-component **Opportunity Score** (CTR-gap + position-upside, log-normalized to 0–100) that reproduces the spec's example (position 8.7 / 32,000 impressions / 2.1% CTR → score ≈ 96 → HIGH) — **note: the expected-CTR curve driving it was reconciled cross-lane in Aug 2026; the shipped default is now the six-study composite prior (pos-1 = 27.0%, not FirstPageSage's 39.8%) with empirical-Bayes per-site refit — see Addendum A** — and a **content-decay detector** (weekly per-page series, 28-day comparison windows vs prior period + YoY + trailing peak, with impression-stability used to separate lost-rankings from lost-demand) that classifies the spec's example (position 4→13, clicks 10,000→4,500) as severe decay.

---

## Findings

### 1. GSC Search Analytics API (`searchanalytics.query`)

**Endpoint:** `POST https://searchconsole.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query` (also exposed as `searchconsole.searchanalytics.query` in the v1 surface).

**Dimensions** (group by any combination, each at most once) [2]:
`query`, `page`, `country`, `device`, `date`, `searchAppearance`, `hour` (hour added April 2025 [5][6]).

**Search types** (`type` parameter): `web` (default), `image`, `video`, `news`, `googleNews`, `discover` [2].

**Filters:** `dimensionFilterGroups[].filters[]` with operators `equals`, `notEquals` (case-sensitive for page/query), `contains`, `notContains` (case-insensitive), `includingRegex`, `excludingRegex` (RE2 syntax) [2]. Regex filters are the workhorse for brand/non-brand splits and topic clustering.

**Aggregation:** `aggregationType` = `auto` | `byPage` | `byProperty` (position/CTR differ depending on aggregation — byProperty dedupes multiple URLs for one query) [2].

**Row limits & pagination** [2][4]:
- `rowLimit`: 1–25,000 per request (default 1,000).
- `startRow`: zero-based offset; paginate by incrementing in 25k steps until an empty response.
- **Hard ceiling: ~50,000 rows per day per site per search type**, sorted by clicks descending — the API "does not guarantee to return all data rows but rather top ones" [2]. For long-tail-heavy sites this truncates; workaround is date-by-date pulls (the 50k limit is per day of *data* when you group by `date`) and/or the BigQuery bulk export (below).
- A practical pattern to maximize completeness: query one day at a time, `query`+`page` grouped, 25k pages, paginating — this reliably captures the visible long tail for all but the largest properties.

**Quotas (load + QPS)** — official numbers [1]:

| Quota | Value |
|---|---|
| Search Analytics, per-site | 1,200 QPM |
| Search Analytics, per-user | 1,200 QPM |
| Search Analytics, per-project | 40,000 QPM / 30,000,000 QPD |
| All other GSC API methods, per-user | 20 QPS / 200 QPM |
| All other methods, per-project | 100,000,000 QPD |

Additionally there is an unpublished "load quota" measured in 10-minute and 1-day chunks; queries grouping/filtering by `page` AND `query` over long date ranges are the most expensive [1]. Design implication: a nightly per-tenant sync of yesterday's data (one day per request) is cheap; avoid re-pulling 16-month ranges repeatedly.

**Freshness** [2][5][6]:
- `dataState: "final"` (default) — finalized data only, typically **~2 days behind** (officially "2–3 days").
- `dataState: "all"` — includes *fresh* data, ~few hours to 1 day behind, subject to revision.
- `dataState: "hourly_all"` + `hour` dimension — **hourly breakdown for the last ~10 days**, delay of only a few hours (April 2025 launch) [5][6]. Useful for the platform's post-deploy monitoring loop (did CTR move after a title change?) but treat as provisional.
- Retention: **rolling 16 months**, older data permanently deleted [12]. The platform must persist pulls into its own warehouse to build multi-year baselines.

**Sampling / privacy filtering caveats** [3][10][11]:
- GSC data is **not sampled**, but it is **privacy-filtered**: "anonymized queries" (rare queries not issued by a sufficient number of users over a 2–3-month period) are omitted from query-grouped results.
- Ahrefs' April 2025 study across 146k+ sites: **46.77% of all clicks** belong to anonymized queries; per-site mode falls between **45% and 80%** hidden [10]. The *count of distinct hidden query strings* is far larger than the click share suggests (the long tail is mostly invisible) [11].
- Consequence: query-level totals ≠ page-level totals. Requests grouped only by `page`/`country`/`device`/`date` include anonymized-query traffic; adding `query` drops it. The scoring engine must compute per-page metrics from page-grouped pulls, never by summing query rows.

**BigQuery bulk export** [7][8][9]:
- Property **Owner** permission required to enable; configured in GSC UI (Settings → Bulk data export) — there is **no API to enable it**, so onboarding a customer to bulk export is a guided manual step [8].
- Data lands in the **customer's GCP project** (they pick project + dataset; billing account required — BigQuery storage/query costs are the customer's, though a small site fits in BigQuery's free tier) [8].
- Daily dumps into tables `searchdata_url_impression`, `searchdata_site_impression`, plus `ExportLog` [9].
- **Not subject to the 50k row/day limit** — full data, and anonymized queries are included as aggregate rows (null query) rather than silently dropped, so totals reconcile [7][9].
- **No backfill** — export starts from the day it's enabled. Another reason to enable it early for big customers.
- Recommended tiering: API-only for sites <~100k pages / <50k daily query rows; bulk export for enterprise tenants (platform reads the customer's BigQuery dataset via a service-account grant).

### 2. URL Inspection API

**Endpoint:** `urlInspection.index.inspect` — pass `inspectionUrl` + `siteUrl` (property).

**Quota** [1][45]: **2,000 queries/day per property** and 600 QPM per site; project-wide cap 10,000,000 QPD / 15,000 QPM. The 2k/day limit is per *property*, so a customer who verifies both a domain property and URL-prefix sub-properties effectively multiplies quota — a documented community workaround [45].

**Returns** (per `UrlInspectionResult`) [13][14]:
- `indexStatusResult`: `verdict`, `coverageState` (e.g. "Submitted and indexed", "Crawled — currently not indexed"), `robotsTxtState`, `indexingState` (noindex detection), `lastCrawlTime`, `pageFetchState`, `googleCanonical` vs `userCanonical`, `crawledAs` (MOBILE/DESKTOP), `referringUrls`, `sitemap` membership.
- `richResultsResult`: detected schema item types, per-item issues, verdict — free structured-data validation signal.
- `mobileUsabilityResult`, `ampResult`.
- Notably it does **not** return live-test rendering (that is the separate UI "live test"; API returns index-state data).

**Platform use:** post-deploy verification (did Google pick up the new canonical/title? is the page still indexed?) and indexing-issue detection at a budget of 2k URLs/day/property — prioritize by opportunity score; a 100k-page site cannot be fully swept (50 days per full pass), so inspect only changed + high-value + sampled URLs.

### 3. Sitemap API

Methods: `sitemaps.submit` (PUT, empty body), `sitemaps.delete`, `sitemaps.get`, `sitemaps.list` — all under `https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/sitemaps/{feedpath}`, requiring the read-write `webmasters` scope [14]. `get/list` return per-sitemap status: lastSubmitted, lastDownloaded, errors/warnings counts, and per-content-type submitted vs indexed counts. Quota falls under "all other resources" (20 QPS / 200 QPM per user) [1]. Note Google deprecated the ping endpoint (2023); API submission is the supported path. Sitemap submission is a safe, fully-automatable action (fits the spec's LOW-RISK auto-apply bucket).

### 4. Auth for a multi-tenant SaaS

Two viable patterns; ship both:

**A. Per-customer OAuth 2.0 (recommended default).**
- Scopes: `https://www.googleapis.com/auth/webmasters.readonly` for data pulls; request the read-write `webmasters` scope only for tenants using sitemap submission [14]. Request incremental authorization (readonly first, upgrade when needed) — verification reviewers penalize over-scoping [16][18].
- GSC scopes are treated as **sensitive** (not restricted) — verification requires: registered domain + homepage, privacy policy URL, ToS URL, scope-usage justification, demo video; review typically days-to-weeks [16][18]. The expensive **CASA security assessment (Tier 2, ~$540 DAST self-scan to ~$5k+ third-party pentest, annually renewed) applies only to *restricted* scopes** (Gmail/Drive/Fitness) — GSC is not on that list, so budget for verification effort but not a mandatory annual audit [17][19]. (Confidence: high that GSC scopes are sensitive-not-restricted; the restricted list is enumerated by Google and does not include Search Console. Verify at console setup time in the Cloud Console Data Access page, which labels each scope.)
- Unverified external apps are capped at **100 test users** and show "unverified app" warnings — fine for a pilot, not for GA [18].
- Store refresh tokens encrypted per-tenant; Google refresh tokens for published apps don't expire on a timer but die if unused ~6 months, if the user revokes, or if >100 tokens per account/client are minted.
- The token grants access to **every property the granting user can see** — the platform must let the tenant pick which verified property (siteUrl) it may touch and enforce that allowlist server-side (multi-tenant isolation is on us, not Google).

**B. Service-account by invitation (enterprise fallback).**
- Platform generates one service account per tenant (or per shard); customer adds the SA's `client_email` in Search Console → Settings → Users and permissions, as **Full** user for read + sitemap ops (Owner needed only for legacy Indexing API / some settings) [15][46].
- Pros: no OAuth consent screen, no verification dependency, no refresh-token lifecycle. Cons: manual step for the customer; SA must be added per property; can't be listed in a marketplace flow. Widely used by SEO tooling (e.g. SEO Utils pattern) [46].

### 5. Bing Webmaster Tools API + IndexNow

**Bing Webmaster API** [20][21][22][47]:
- Auth: **per-account API key** generated in the BWT dashboard (simple query-param auth; OAuth also available for delegated apps) [20].
- Relevant read endpoints: `GetQueryStats` (per-query clicks/impressions/position — one aggregate row per query over the **last ~6 months**, updated weekly [21][47]), `GetPageStats`, `GetQueryPageStats`, `GetRankAndTrafficStats`, `GetKeywordStats` (historical weekly broad/strict-match impressions for arbitrary keywords by country/language — a free mini keyword-research API), `GetCrawlStats`, `GetUrlSubmissionQuota`.
- URL submission: `SubmitUrlBatch` — max **500 URLs per call**, daily/monthly quota returned by `GetUrlSubmissionQuota` (site-dependent, commonly ~10k/day for established sites) [22].
- Rate limits are enforced but not published per-endpoint; MERJ reports throttling on rapid sequential calls [47]. Data is weekly-granularity and 6-month retention — treat Bing as a secondary corroboration source and a free keyword-suggestion source, not the primary time series.

**IndexNow** [23][24]:
- Open push-indexing protocol: host a key file at the site root, then `POST https://api.indexnow.org/indexnow` (or engine-specific endpoints) with up to **10,000 URLs per call**; one submission fans out to **Bing, Yandex, Seznam, Naver** (adoption also includes AI search crawlers) [23].
- Free, no meaningful published rate limits for normal usage; engines apply server-side quality scoring — spamming unchanged URLs degrades trust [23][24].
- **Google does not support IndexNow** (still true as of 2026) [24] — for Google, the only levers are sitemaps (lastmod), organic recrawl, and the URL Inspection API (which does *not* request indexing; the legacy Indexing API remains restricted to JobPosting/Broadcast content).
- Platform fit: fire-and-forget IndexNow ping after every deployed change — zero cost, low risk, immediate for Bing-family engines.

### 6. Third-party keyword / SERP data (2026 pricing)

See the comparison table below. Highlights:

- **DataForSEO** — pay-as-you-go, $50 minimum deposit [25]. SERP API: **$0.60/1k (Standard queue, ~5 min), $1.20/1k (Priority), $2.00/1k (Live)**; a "SERP" billing unit = 10 results [25]. Keywords Data API (Google Ads-sourced): search volume for **up to 1,000 keywords per request at $0.09 live / $0.06 standard per request** — i.e. as low as ~$0.06 per 1,000 keywords [26][27]. DataForSEO Labs (their own database): keyword ideas at $0.012/request + $0.00012/row [28]. Also sells On-Page, Backlinks, and Domain Analytics APIs — one vendor can cover SERP + volume + competitor gap.
- **Serper (serper.dev)** — Google-only, very fast (1–2 s), 2,500 free credits; credit packs: **$50/50k ($1.00/1k) → $375/500k ($0.75/1k) → $1,250/2.5M ($0.50/1k)** [29][30]. Endpoints: search, images, news, maps, places, videos, shopping, scholar, patents, **autocomplete** (cheap keyword-suggestion mining) [29].
- **SerpApi** — most polished parser coverage, but expensive: **$25/mo for 1,000 searches ($25/1k) down to ~$9.17/1k at 30k/mo**; free 250/mo; no pay-as-you-go; hourly throughput capped at 20% of monthly volume [30][31]. Now legally notable: **Google sued SerpApi (late 2025); in 2026 the court dismissed Google's copyright claims** — see legality below [39][40][41].
- **Semrush API** — requires the **$549/mo Advanced plan** plus separately purchased API units (~$0.01/unit, ≈$50/M units); e.g. Domain Organic Keywords = 10 units/row live, 50/row historical [32][33]. ToS restriction that matters for a SaaS: **cached API data may not be stored longer than 1 month without written consent** [33] — hostile to a warehouse-centric platform.
- **Ahrefs API v3** — included in paid plans since the 2025 repackaging: unit budgets ~**100k (Lite $129/mo) / 400k (Standard) / 1M (Advanced) / 2M (Enterprise $1,499/mo)**, min 50 units/request, per-row × per-field unit costs (expensive fields 5–10 units/row); row caps per request by tier (100 rows on Lite → uncapped Enterprise) [34][35]. Great data, but unit math makes large-scale programmatic pulls costly, and resale/derivative-product terms require an Enterprise conversation.

**Legality/ToS reality of SERP scraping (2026):** Scraping Google SERPs violates Google's ToS (a civil contract matter), but the current US case law does not make it criminal or copyright infringement: *hiQ v. LinkedIn* established that scraping public data likely doesn't violate the CFAA [39]; in **Google v. SerpApi (2026)** the court dismissed Google's copyright claims, holding that plain/aggregated search results (URLs, snippets, factual index data) are "not works protected under the Copyright Act," while leaving open non-copyright theories; DMCA circumvention claims failed because the barrier wasn't guarding Google-owned copyrighted works [39][40][41]. Practical posture for the platform: **buy SERP data from providers rather than scraping in-house** — the provider absorbs the ToS/anti-bot risk, cost is $0.50–2/1k, and contracts give you an indemnification surface. Do not use the customer's Google credentials for anything SERP-related. Flag in the client risk document: Google could still pursue contract/unfair-competition theories or escalate technical countermeasures (SearchGuard), which could raise provider prices or latency.

### 7. Google Keyword Planner API access restrictions

Keyword Planner data is only available through the **Google Ads API** (`KeywordPlanIdeaService`, `KeywordPlanService`, `GenerateKeywordHistoricalMetrics`) and is gated hard [36][37][38]:
- 2026 access ladder: Test (15k ops/day, test accounts only) → **Explorer** (2,880 ops/day, auto-granted; **keyword-planning services are BLOCKED at this level**) → **Basic** (15k ops/day, application, ~2 business days) → Standard (unlimited, ~10 days) [36][37].
- Calls to keyword-idea/search-volume endpoints return `DEVELOPER_TOKEN_NOT_APPROVED` until Basic access is approved; approval requires a Google Ads **manager account (MCC)**, linked active accounts, and a permissible-use classification [37][38].
- Even with access, accounts **without active ad spend get bucketed volume ranges** ("1K–10K") instead of precise monthly volumes; ~$50–100 of recent spend is the practical threshold for granular numbers [38].
- Permissible-use policy is written for advertising tooling; a pure-SEO SaaS reselling Keyword Planner metrics to tenants sits in a policy gray zone and risks token revocation.
- **Conclusion:** treat Keyword Planner as unusable as a product dependency. DataForSEO's Google Ads-sourced volume endpoints deliver the same metrics commercially at ~$0.06–0.09 per 1k keywords [26][27].

### 8. Proposed SEO Opportunity Score algorithm

**Inputs** per (page, query) pair, from a trailing 28-day GSC window (`dataState=final`, non-branded queries only — exclude via brand-term `excludingRegex`):
`I` = impressions, `C` = clicks, `ctr = C/I`, `P` = average position, `E(p)` = expected CTR at position p, `V` = commercial value multiplier (from CPC), optional `AIO` = AI Overview present on the SERP.

> **SUPERSEDED (Aug 2026 reconciliation — see Addendum A below).** The FirstPageSage-only default
> table and the AIO note in this subsection are replaced by the composite prior E₀(p) (pos-1 = 27.0%)
> + empirical-Bayes per-site refit defined in Addendum A. The scoring formulas (G, U, R, κ,
> normalization, bands) are unchanged and re-verified band-stable under the new curve (§A7).

**Expected-CTR curve** — interpolate linearly between anchor points (First Page Sage, May 2025 dataset [42]); extrapolate positions 11–20 geometrically (~0.85× per position):

| Pos | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | 15 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E(p) | 39.8% | 18.7% | 10.2% | 7.2% | 5.1% | 4.4% | 3.0% | 2.1% | 1.9% | 1.6% | ~1.2% | ~0.8% | ~0.4% |

If a SERP check (DataForSEO/Serper) finds an AI Overview, multiply E(p) for p ≤ 5 by **0.5** — position-1 CTR collapses from ~40% to ~19% under AI Overviews [42, notes]. Recalibrate the curve quarterly *per site* from the site's own (position-band → CTR) medians when ≥ 5k impressions of data exist; site-specific curves beat industry curves.

**Two opportunity components** (both in units of clicks/period):

1. **CTR-gap** (metadata/title/snippet fix — page ranks fine but under-clicks):
   `G = I × max(0, E(P) − ctr)`
2. **Position-upside** (content/link improvement — "striking distance"):
   target position `P* = 3` if `4 ≤ P ≤ 10`, else `P* = P − 5` if `10 < P ≤ 20`; zero outside band.
   `U = I × max(0, E(P*) − max(ctr, E(P)))`

**Raw score:** `R = (0.4·G + 0.6·U) × V × D`
- `V = min(2, 1 + log10(1 + CPC_usd))` — value-weights commercial queries (CPC from DataForSEO volume endpoint; default V=1).
- `D = 1 / (1 + KD/100)` — optional difficulty damping (KD 0–100 from keyword API; default D=1).

**Normalization to 0–100:** `Score = 100 × (1 − e^(−R/κ))` with κ = max(500, median monthly organic clicks of the site's top-50 pages) — makes HIGH mean "material for *this* site."
**Bands:** HIGH ≥ 60 · MEDIUM 25–60 · LOW < 25. Eligibility gate: `I ≥ 200/28d` and `4 ≤ P ≤ 20` (the spec's 5–20 band widened to 4 to catch page-1 upsides).

**Worked example — the spec's case (P = 8.7, I = 32,000, ctr = 2.1%):**
- E(8.7) = interpolate(2.1%, 1.9%) = **1.96%** → `G = 32,000 × max(0, 0.0196 − 0.021) = 0` (the snippet already earns its position — no metadata gap).
- `P* = 3`, E(3) = 10.2% → `U = 32,000 × (0.102 − 0.021) = 2,592` potential extra clicks/28d.
- `R = 0.4·0 + 0.6·2,592 = 1,555` (V = D = 1). `Score = 100 × (1 − e^(−1555/500)) = 95.5` → **HIGH** ✓ (matches the spec's expected classification; the driver is position-upside, correctly pointing the AI at content/links, not the title tag).
- Counter-example (small keyword): P = 6, I = 1,200, ctr = 1.0% → G = 1,200×(0.044−0.010) = 40.8; U = 1,200×(0.102−0.044) = 69.6; R = 58.1 → Score = 11 → **LOW**. The log-normalization correctly suppresses low-traffic noise.
- Mid example: P = 12, I = 8,000, ctr = 0.4% → E(12)≈1.2% → G = 64; P* = 7, U = 8,000×(0.030−0.012) = 144; R = 112 → Score = 20 → **LOW/MEDIUM** boundary — reasonable for a page-2 term needing sustained work.

Rank the queue by `Score`, aggregate to page level as `PageScore = max(query scores) + 0.1 × sum(others)` so one page with many mid opportunities can outrank one big-keyword page.

### 9. Content-decay detection algorithm

**Data model:** nightly ingest of page-grouped GSC rows into the warehouse; maintain per-page weekly aggregates of clicks, impressions, ctr, position (impression-weighted), plus per-(page, top-10-query) weekly position series. Non-branded only. Minimum history: 8 weeks to arm; YoY checks activate at 13 months.

**Windows:** current = trailing 28 days (ending at last final date); baselines = (a) prior 28 days ("momentum"), (b) same 28-day window one year earlier ("YoY", seasonality guard), (c) best trailing-12-month 28-day window ("peak").

**Trigger (all must hold, ≥ 3 consecutive weekly evaluations to defeat volatility):**
1. `clicks_current ≤ 0.70 × clicks_yoy` (or vs peak when < 13 months of history) — ≥ 30% decline;
2. impression-weighted position worsened ≥ 2.0 vs baseline on the page overall, or on ≥ 3 of the top-10 queries;
3. Theil–Sen slope of the 12-week click series < −2%/week (robust monotonic-decline test; cheaper and more robust than OLS p-values on noisy weekly counts).

**Classification** (decides the playbook, not just the alert):
- **Ranking decay** — clicks down, position down, impressions roughly stable (±15%): competitors overtook → route to content-refresh/competitor-gap investigation (SPEC §10). *This is the spec's example: position 4→13 with clicks 10,000→4,500 (−55%, Δposition −9) → severity CRITICAL (see below), playbook = content investigation.* ✓
- **Demand decay** — clicks and impressions both down ≥ 30%, position stable: topic demand shrank → deprioritize or retarget keyword.
- **Cliff** — > 40% drop within ≤ 14 days, especially across a cluster of pages sharing a template/topic: check against Google-update dates and indexing state (URL Inspection) before touching content; likely algorithmic or technical.
- **Cannibalization** — this page's decline mirrored by a sibling page's rise on the same queries in the same window: route to consolidation/canonical playbook, not refresh.
- **Seasonality** — decline vs prior 28d but within ±15% of YoY: suppress alert (guard (b) handles this automatically).

**Severity:** `Sev = lost_clicks_per_28d × V` (same value multiplier as the opportunity score); bands CRITICAL ≥ 2,000 weighted lost clicks, MAJOR ≥ 500, MINOR below. Spec example: lost = 5,500 → CRITICAL. Decay items enter the same prioritization queue as opportunities so the autonomous agent (SPEC §18) trades off "fix decaying winner" vs "push striking-distance page" on one scale.

**Why these thresholds:** 28-day windows smooth weekday cycles; 30%/2-position/3-week jointly hold the false-positive rate down on the ~±20% week-to-week noise typical of mid-traffic pages (industry practice: judge decay on 6–12-month rolling windows, YoY for seasonal categories [43][44]); Theil–Sen resists single-week outliers (holidays, GSC data gaps — e.g., the June 2025 GSC data-delay incident would otherwise have mass-triggered false decay alerts).

---

## Options compared

**Third-party SERP / keyword data providers (verified Aug 2026):**

| Provider | Pricing model | SERP cost /1k | Keyword volume cost | Free tier | Strengths | Dealbreakers / caveats |
|---|---|---|---|---|---|---|
| **DataForSEO** [25][26][27][28] | Pay-as-you-go, $50 min deposit | $0.60 std / $1.20 priority / $2.00 live | ~$0.06–0.09 per 1,000 kws (Google Ads-sourced, 1k kws/request) | $1 trial credit | Broadest surface (SERP + volume + Labs + On-Page + Backlinks), cheapest volume data, no subscription | Standard queue is async (~5 min); Labs DB smaller than Semrush/Ahrefs |
| **Serper** [29][30] | Prepaid credits | $1.00 → $0.50 (2.5M pack) | n/a (autocomplete only) | 2,500 credits | Fastest (1–2 s), cheapest live Google SERPs, autocomplete endpoint | Google-only; raw SERPs, no keyword DB |
| **SerpApi** [30][31] | Monthly subscription | $25 → ~$9.17 | n/a | 250/mo | Best parser coverage (many engines), legal precedent survivor | 10–25× Serper's price; throughput capped at 20% of monthly vol/hour; no PAYG |
| **Semrush API** [32][33] | $549/mo Advanced plan + units (~$50/M) | n/a (keyword DB, not live SERP) | 10 units/row (~$0.0005/row) + plan | none | Largest commercial keyword DB, difficulty scores | $549/mo floor; **1-month max data caching without written consent** — hostile to warehousing |
| **Ahrefs API v3** [34][35] | Plan-bundled units (Lite $129/mo 100k → Ent $1,499/mo 2M) | n/a | ≥50 units/request + 1–10 units/row/field | none | Best backlink data, clean v3 API | Unit math expensive at scale; row caps per tier; resale terms need Enterprise |
| **Google Keyword Planner (Ads API)** [36][37][38] | Free but gated | n/a | free | — | First-party volume data | Blocked at Explorer tier; Basic-access approval + MCC required; bucketed ranges without ~$50–100 ad spend; permissible-use risk for SEO SaaS |
| **Bing Webmaster `GetKeywordStats`** [20][21] | Free (API key) | n/a | free (weekly impressions) | free | Zero-cost corroboration + suggestion source | Bing-only volumes; 6-month retention; weekly granularity |

**GSC access methods:**

| Method | Row completeness | Freshness | Setup friction | Best for |
|---|---|---|---|---|
| Search Analytics API | top ~50k rows/day/search type; anonymized queries hidden in query-grouped pulls | final ≈2d; `all` ≈ hours; hourly last 10d | OAuth grant or SA invite | all tenants, default |
| BigQuery bulk export | complete incl. anonymized aggregate rows; no row cap | daily dump | Owner + customer GCP project + billing; no backfill; manual UI setup | enterprise tenants |
| UI CSV export | 1k rows | manual | n/a | not applicable |

---

## Recommendation & why

1. **GSC-first data plane.** Nightly per-tenant sync: yesterday's final data, day-granular, page-grouped AND query+page-grouped pulls, persisted forever in our warehouse (16-month Google retention makes warehousing non-optional). Use `dataState=all`/hourly only in the post-change monitoring loop. Per-site 1,200 QPM means even a 10k-tenant fleet fits comfortably in per-project quota (30M QPD) with a single GCP project; shard projects only for insurance.
2. **OAuth (readonly) as the default connection; service-account invite as enterprise fallback; BigQuery bulk export as the enterprise completeness upgrade.** Start Google OAuth verification early (weeks of lead time) with a minimal-scope consent screen; it is a launch-blocking dependency but not a CASA-level cost.
3. **DataForSEO as primary paid data vendor + Serper for cheap live SERPs.** ~$0.60/1k SERPs and ~$0.06/1k keyword volumes keep the marginal cost per tenant in single-digit dollars/month (e.g., 1k tracked keywords daily-checked ≈ $18/mo Standard queue; weekly ≈ $2.60/mo). Skip Semrush/Ahrefs for the data plane (subscription floors + caching restrictions); revisit Ahrefs only if backlink intelligence becomes a roadmap item.
4. **Do not build on Keyword Planner**; treat Bing Webmaster + IndexNow as free bolt-ons (Bing corroboration data, IndexNow pings after every deployed change).
5. **Ship the two algorithms above as v1**: opportunity score (CTR-gap + position-upside, site-normalized) and decay detector (28d windows, YoY guard, Theil–Sen slope, impression-based classification). Both reproduce the spec's worked examples and both emit *routable* diagnoses (metadata fix vs content investigation vs consolidation), which is what the downstream AI-action engine (SPEC §7) needs as structured input.

---

## Risks & limitations

- **~47% of clicks are anonymized in query-level GSC data** [10] — keyword-level opportunity scoring sees roughly half the demand; page-level scoring is unaffected. Mitigate with page-grouped metrics + third-party keyword expansion; disclose in the product.
- **GSC position is an average over impressions**, including deep-SERP impressions from low-intent queries; a page "at 8.7" may be position 3 for its head term and 40 for stragglers. Mitigate by scoring per-(page, query), never on page-average position alone.
- **CTR curves are now bimodal (AI Overviews on ~31% of SERPs; position-1 CTR ~19% vs ~40% clean)** [42] — a single expected-CTR curve misclassifies; the SERP-feature adjustment (0.5× for p≤5 under AIO) is coarse and needs per-vertical calibration during the POC.
- **OAuth verification is a schedule risk** (unverified cap: 100 users) and a compliance treadmill (annual re-verification for the app) [16][18]; scope classifications can change — if Google ever reclassifies GSC scopes as restricted, a CASA assessment (~$540–5k+/yr) lands on the roadmap [17][19].
- **Bulk export cannot be enabled via API and has no backfill** [8] — enterprise onboarding includes a manual customer step, and history starts at day 0.
- **URL Inspection 2k/day/property** [1] caps indexing verification on large sites; the multi-property workaround [45] depends on customers verifying sub-properties.
- **SERP-data supply risk:** Google v. SerpApi dismissed the copyright theory in 2026 [40][41], but Google is actively litigating and hardening anti-bot defenses (SearchGuard); provider prices/latency could shift. Multi-vendor abstraction (DataForSEO ⇄ Serper) hedges this.
- **Vendor ToS on data storage:** Semrush's 1-month caching limit [33] (and similar clauses elsewhere) must be checked before any provider's data is warehoused or shown to tenants as derived metrics; DataForSEO's PAYG terms are the most SaaS-friendly of the set, but the contract should still be reviewed for redistribution language.
- **June 2025-style GSC data outages** (multi-day final-data stalls) will stall the monitoring loop; the pipeline needs data-gap detection so decay/rollback logic never evaluates against missing days.
- Third-party price points cited are August 2026 list prices from vendor pages and recent comparison studies; several (marked in text) come from secondary sources and should be re-verified at contract time.

---

## Sources

1. https://developers.google.com/webmaster-tools/limits — official GSC API quotas (1,200 QPM/site; URL Inspection 2k QPD/site; 20 QPS other methods)
2. https://developers.google.com/webmaster-tools/v1/searchanalytics/query — dimensions, filters, rowLimit 25k, dataState values, "top rows not all rows"
3. https://developers.google.com/search/blog/2022/10/performance-data-deep-dive — official deep dive on filtering & limits
4. https://www.analyticsedge.com/blog/download-over-25000-rows-from-google-search-console-api/ — pagination beyond 25k, 50k/day ceiling
5. https://developers.google.com/search/blog/2025/04/san-hourly-data — hourly data in Search Analytics API (Apr 2025)
6. https://ppc.land/google-adds-hourly-data-support-to-search-analytics-api/ — HOURLY_ALL, 10 days hourly, few-hours delay
7. https://support.google.com/webmasters/answer/12918484 — bulk data export: scope, anonymized-query aggregate rows
8. https://support.google.com/webmasters/answer/12917675 — bulk export setup: Owner permission, customer GCP project + billing
9. https://developers.google.com/search/blog/2023/02/bulk-data-export — export tables (searchdata_url_impression etc.), no daily row limit
10. https://ahrefs.com/blog/gsc-anonymized-queries/ — 46.77% of clicks anonymized (Apr 2025, 22B clicks)
11. https://ziptie.dev/blog/gscs-huge-search-gap/ — per-site anonymization 45–80%, long-tail vocabulary gap
12. https://www.seo-stack.io/blog/why-does-google-search-console-have-a-16-month-data-limit — 16-month rolling retention, 2–6h UI delay
13. https://developers.google.com/webmaster-tools/v1/urlInspection.index/UrlInspectionResult — URL Inspection response schema
14. https://developers.google.com/webmaster-tools/v1/sitemaps/submit — sitemap submit/delete/get/list, webmasters scope
15. https://support.google.com/webmasters/answer/7687615 — GSC users/permissions model (Owner/Full/Restricted)
16. https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification — sensitive-scope verification requirements
17. https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification — restricted scopes = CASA assessment (GSC not listed)
18. https://support.google.com/cloud/answer/13463073 — OAuth verification help center; 100-user testing cap
19. https://deepstrike.io/blog/google-casa-security-assessment-2025 — CASA Tier 2 cost range ($540 DAST → $5k+ pentest)
20. https://learn.microsoft.com/en-us/bingwebmaster/getting-access — Bing Webmaster API access, API key auth
21. https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getquerystats — GetQueryStats semantics
22. https://blogs.bing.com/webmaster/june-2019/bingbot-Series-Introducing-Batch-mode-for-Adaptive-URL-submission-API — SubmitUrlBatch 500/call
23. https://www.indexnow.org/faq — IndexNow protocol: 10k URLs/call, participating engines, no fees
24. https://www.indexernow.com/google-indexnow — Google non-adoption of IndexNow (2026 status)
25. https://dataforseo.com/apis/serp-api/pricing — SERP $0.60/$1.20/$2.00 per 1k; $50 min deposit
26. https://dataforseo.com/pricing/keywords-data/google-ads — Google Ads volume endpoint pricing
27. https://docs.dataforseo.com/v3/keywords_data-google_ads-search_volume-live/ — 1,000 kws/request, $0.09 live / $0.06 standard
28. https://dataforseo.com/help-center/dataforseo-labs-api-vs-google-ads-api — Labs vs Ads endpoint cost comparison
29. https://serper.dev/ — 2,500 free credits; endpoint list incl. autocomplete
30. https://apiserpent.com/blog/serp-api-pricing-comparison — 2026 cross-provider SERP pricing (Serper packs, SerpApi tiers)
31. https://www.searchcans.com/blog/serpapi-pricing-alternatives-comparison-2026/ — SerpApi 2026 plan details
32. https://developer.semrush.com/api/v4/get-started/api-access/ — Semrush API access requirements
33. https://thatmarketingbuddy.com/blog/semrush-api-pricing — $549/mo plan floor, ~$0.01/unit, 1-month caching limit
34. https://docs.ahrefs.com/en/api/docs/introduction — Ahrefs API v3 overview
35. https://docs.ahrefs.com/api/docs/limits-consumption — min 50 units/request, per-row+field unit costs
36. https://developers.google.com/google-ads/api/docs/api-policy/access-levels — Ads API access tiers & permissible use
37. https://ppc.land/google-faces-developer-token-application-backlog-as-new-api-tier-debuts/ — Explorer tier (2,880 ops/day) blocks KeywordPlan services
38. https://www.get-ryze.ai/blog/google-ads-api-keyword-planner-claude — bucketed volumes without ad spend; DEVELOPER_TOKEN_NOT_APPROVED
39. https://almcorp.com/blog/google-sues-serpapi-lawsuit-analysis/ — Google v. SerpApi background; hiQ v. LinkedIn context
40. https://scrapebadger.com/blog/google-sued-a-scraper-under-copyright-law-and-lost-heres-what-the-serpapi-ruling-actually-says — 2026 dismissal analysis (copyright + DMCA reasoning)
41. https://www.seroundtable.com/google-lawsuit-serpapi-dismissed-41731.html — dismissal report
42. https://firstpagesage.com/reports/google-click-through-rates-ctrs-by-ranking-position/ — CTR-by-position table (pos1 39.8% … pos10 1.6%; AIO/local-pack variants)
43. https://ahrefs.com/blog/content-decay/ — decay patterns & detection practice
44. https://searchengineland.com/guide/content-decay — decay identification methodology (rolling windows, YoY)
45. https://support.google.com/webmasters/thread/286763491/increasing-the-2000-url-inspection-limit-per-website-for-the-google-search-console-api — per-property quota workaround via multiple properties
46. https://www.indexernow.com/fix/service-account-owner-gsc — service-account-added-as-user pattern
47. https://merj.com/blog/capturing-data-from-bing-webmaster-tools-api — Bing 6-month retention, weekly updates, throttling behavior

---

---

# Addendum A — Reconciling the §8 Expected-CTR Curve (cross-lane reconciliation, Aug 2026)

## A0. Why this addendum exists

Section 8 above shipped the FirstPageSage table (pos-1 = 39.8%) as the v1 default `E(p)` driving
the opportunity score. The AI-optimization lane (`ai-optimization.md`, Layer 3), citing the same
vendor plus two counter-studies, found pos-1 estimates ranging **19–40%** and a measured **−32%
YoY collapse** at pos-1 as AI Overviews rolled out, concluding *"global curves disagree too much
to be the baseline."* Both lanes independently recommended per-site fitted curves, but the shipped
v1 default constant and the cold-start guidance were inconsistent between the lanes. This addendum
re-verified every underlying study against the live sources (Aug 2026) and defines **one reconciled
position** for the synthesis. It supersedes the "Expected-CTR curve" paragraph of §8; the score
formulas themselves are unchanged and re-verified in §A7.

## A1. Summary — the reconciled position

1. **Drop FirstPageSage as the sole default.** Its 39.8% pos-1 figure is the extreme outlier of
   every study surveyed, comes from an undisclosed-size meta-analysis rather than measured GSC
   data, and its AI-Overview variant claim (pos-1 *with* AIO = 38.9–42.9%, i.e. no penalty) [42]
   is contradicted by four independent measured studies [48][49][50][51] (details §A3).
2. **v1 default = a conservative multi-study composite prior E₀(p)** — the per-position **median
   across six studies** (pos-1 = **27.0%**), monotone-smoothed (table in §A4). This is the
   "conservative multi-study prior" position; it is within 2% of the measured-GSC-study cluster
   (Backlinko 27.6% [54], Sistrix 28.5% [53], Indexsy 26.4%, OuterBox 20.5% [49]).
3. **The AIO multiplier stays, re-anchored and retuned: ×0.6 for p ≤ 5 when a SERP snapshot shows
   an AI Overview** (was ×0.5, mis-cited to FirstPageSage — see §A9). Cross-study impact range is
   ×0.42–×1.0 with median ≈ ×0.65 [48][49][50][51][52]; 0.6 is the rounded-conservative pick.
   Other feature multipliers in §A5.
4. **Per-site refit is not a switch at 5k impressions — it is empirical-Bayes shrinkage from day
   zero.** Per (position-band × device) bucket: `E_site = (clicks + n₀·E₀(p)) / (impressions + n₀)`
   with prior strength **n₀ = 1,000 impressions**. Both lanes' "≥5k impressions" guidance becomes
   emergent: at 5k observed impressions the site's own data carries ~83% of the weight; at 20k,
   ~95% (§A6). Refit **monthly** (not quarterly), monotone-projected, drift-alarmed.
5. **One shared curve service.** The opportunity scorer (§8), the decay detector (§9), the
   Layer-3 position-controlled CTR delta, and the rollback engine (SPEC §17) MUST consume the same
   fitted-curve object. Two baselines = the scorer can promise gains the rollback engine scores as
   harm (§A8).
6. **Band-stability verified:** all three §8 worked examples land in the same HIGH/LOW/boundary
   bands under the composite curve (§A7), so no downstream threshold retuning is required.

## A2. Evidence — what the studies actually say (verified against live sources, Aug 2026)

**Position-1 organic CTR, by study:**

| Study | Dataset / method | Data date | Pos-1 CTR | Notes |
|---|---|---|---|---|
| FirstPageSage [42] | Meta-analysis, size undisclosed (cites Backlinko, Sistrix, Wordstream, BrightLocal + own client data) | page "2026", **last updated 2025-05-28** | **39.8%** | Highest of all studies; skews to FPS's own B2B/high-intent client base; pos-1 w/ local pack 23.7% |
| Sistrix [53] | **80M keywords**, billions of SERPs, mobile-only, measured | Jul 2020 (page mod. Jul 2025) | **28.5%** avg | Pos-1 spans **13.7%–46.9% by SERP layout** (sitelinks 46.9, pure organic 34.2, featured snippet 23.3, knowledge panel 16.7, shopping 13.7) |
| Backlinko [54] | 4M SERPs / 1.31M pages / 12.17M queries via Semrush GSC data | updated 2025-04-16 | **27.6%** | Top-3 capture 54.4% of clicks; #2→#1 = +74.5% clicks |
| Indexsy (via [49]) | aggregate | 2025 | 26.4% | |
| OuterBox (via [49]) | aggregate | 2025 | 20.5% | |
| GrowthSrc [48] | **200k+ keywords**, 30+ sites (ecom/SaaS/B2B/EdTech), GSC-measured | 2024 vs 2025 | **19.0%** (2025; was 28.0% in 2024, **−32% YoY**) | Pos-2 20.83→12.60% (−39%); positions 6–10 CTR **+30.63% YoY** (clicks migrating down-SERP) |
| theStacc [49] | 6-study aggregate | updated Mar 2026 | **≈27% (six-study average)**; range 19.0–39.8% | The "multi-study aggregate ≈27%" cited by the AI-optimization lane |

**AI-Overview impact on top-position CTR (the contested adjustment):**

| Study | Method | AIO impact | Implied multiplier |
|---|---|---|---|
| Ahrefs [50] | 300k keywords (150k AIO / 150k control), informational intent, Mar-2024 vs Mar-2025, counterfactual forecast model | **−34.5%** pos-1 CTR (AIO-keyword CTR 7.3%→2.6% raw; 4.0% forecast vs 2.6% actual) | ×0.65 |
| Pew Research [51] | 900-adult panel, **68,879 real searches**, Mar 2025 | Link-click rate **8% with AI summary vs 15% without**; clicks on links *inside* the AIO: 1% of visits; session ends 26% vs 16% | ×0.53 (page-level) |
| GrowthSrc [48] | 200k keywords, GSC-measured | avg **−17.9%** across pos 1–5 post-AIO; MailOnline case: pos-1 13%→<5% desktop (−62%) | ×0.82 (avg), ×0.38 (worst case) |
| theStacc [49] | aggregate | pos-1 27.6%→≈11.6% when AIO present (**−58%**) | ×0.42 |
| Semrush [52] | Same-keyword before/after AIO gain, refreshed Dec 2025 | **Counter-study:** zero-click rate *fell* 33.75%→31.53% for keywords that gained an AIO — "people actually clicked slightly more" | ≈×1.0 |
| FirstPageSage [42] | meta-analysis | pos-1 "with snippet or AI overview" = **38.9–42.9%** (no penalty) | ×1.0+ (contradicted by all measured studies above) |

**AIO prevalence is itself a moving target** [52]: 6.49% of queries (Jan 2025) → 24.61% (Jul 2025
peak) → 15.69% (Nov 2025); ~30%+ per theStacc's Jul-2026 note [49]. Highest-prevalence verticals:
Science 25.96%, Computers & Electronics 17.92%, People & Society 17.29%; commercial-intent AIO
share rose 8.15%→18.57% and transactional 1.98%→13.94% in 2025 [52]. Any constant baked into the
base curve chases this volatility — which is why AIO belongs in a *runtime multiplier keyed to a
live SERP snapshot* (the platform already buys SERP snapshots from DataForSEO/Serper, §6), not in
the base table.

## A3. Why FirstPageSage cannot be the shipped default

1. **It is the extreme outlier**: 39.8% vs a measured-study cluster of 19.0–28.5% [48][53][54] and
   a six-study average of ≈27% [49]. Using it inflates every `G` and `U` estimate by ~45% at the
   top of the curve — the platform would systematically over-promise click gains that post-deploy
   measurement (Layer 3) then fails to find.
2. **Method opacity**: it is a meta-analysis with no disclosed dataset size, industry weights, or
   time window [42] — unauditable for a system that must explain its scores (SPEC §3 "explainable").
3. **Stale under a fresh label**: the page is titled "2026" but was last updated **May 28, 2025**
   [42] — pre-dating the full AIO-era measurements.
4. **Its AIO variant is contradicted by every measured study**: FPS reports pos-1 *with* AI
   Overview at 38.9–42.9% (no penalty / slight boost) [42], while Ahrefs measures −34.5% [50], Pew
   −47% page-level [51], GrowthSrc −18% to −62% [48], theStacc −58% [49]. Only Semrush's
   same-keyword study [52] supports a no-harm reading, and it measures zero-click share, not
   top-position CTR.

FPS remains *inside* the composite as one of six inputs — it is simply no longer the default alone.

## A4. The v1 default: composite prior E₀(p)

**Construction rule (auditable):** per-position **median** across all studies reporting that
position (FPS [42], Backlinko [54], Sistrix [53], GrowthSrc [48], Indexsy + OuterBox pos-1 via
[49]), then monotone-decreasing projection (pool adjacent violators — positions 9/10 pooled).
Positions 11–20 extrapolated geometrically at ~0.85×/position (unchanged from §8).

| Pos | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | 15 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **E₀(p)** | **27.0%** | 15.6% | 11.0% | 7.6% | 6.2% | 4.8% | 3.5% | 2.7% | 2.4% | 2.4% | ~1.7% | ~1.05% | ~0.47% |
| inputs (n) | 6 | 4 | 3 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | extrap. | extrap. | extrap. |

Properties that matter downstream:

- **Conservative where it counts**: pos-1–3 sit ~30% below the FPS table, so absolute
  predicted-click gains shrink accordingly; this is deliberate — under-promising is the correct
  bias for a platform whose rollback engine grades its own predictions (SPEC §17).
- **Represents a blended SERP** (features at average prevalence), because the studies it medians
  are blended. Feature multipliers (§A5) adjust it when a SERP snapshot is available; when no
  snapshot exists, use E₀(p) as-is.
- **Sensitivity**: excluding FPS entirely moves pos-1 from 27.0% to 26.4% — the composite is
  robust to the outlier either way (median, not mean).

## A5. SERP-feature multipliers (applied only when a live SERP snapshot exists)

| Condition | Multiplier on E₀(p) | Scope | Anchor evidence |
|---|---|---|---|
| AI Overview present | **×0.6** | p ≤ 5 | cross-study median ≈ ×0.65, range ×0.42–×1.0 [48][49][50][51][52]; rounded down for conservatism |
| AI Overview present | ×0.8 | 6 ≤ p ≤ 10 | GrowthSrc: positions 6–10 gained CTR YoY (+30.63%) even as 1–5 fell [48] — penalty attenuates down-SERP |
| Featured snippet (site not the snippet) | ×0.7 | p ≤ 3 | Sistrix: 23.3% vs 34.2% pure organic = ×0.68 [53] |
| Local pack present | ×0.6 | p ≤ 3 | FPS: 23.7% vs 39.8% = ×0.60 [42] (only FPS variant consistent with measured data) |
| Sitelinks on own result at pos-1 | ×1.35 (cap) | p = 1 | Sistrix: 46.9% vs 34.2% [53] — a *positive* adjustment; also a reason fitted brand-heavy curves must exclude branded queries |

Multipliers are **priors, not truth**: the AIO impact range spans ×0.42–×1.0 across credible
studies (§A2), so the platform must learn per-site multipliers once it can pair AIO-flagged SERP
snapshots with the site's own GSC deltas — the same shrinkage machinery of §A6, one level down.
Store each multiplier as a config constant with a quarterly review task attached.

## A6. Per-site refit: empirical-Bayes shrinkage (the cold-start reconciliation)

The two lanes agreed per-site curves beat global curves but disagreed on the handover. Reconciled:
**there is no handover moment — the prior and the site data blend continuously** via standard
beta-binomial empirical-Bayes shrinkage (posterior = sample/prior weighted average, weight ∝
sample size [56]):

```
bucket b = (position band × device [× intent class when available])
E_site(b) = (clicks_b + n₀ · E₀(p_b)) / (impressions_b + n₀),   n₀ = 1,000
site-data weight w(b) = impressions_b / (impressions_b + n₀)
```

- **Bands:** integer positions 1–10, then 11–15 and 16–20. Device split desktop/mobile — device
  curves measurably differ (AWR publishes them separately, from millions of GSC keywords,
  refreshed monthly — a free external sanity check for fitted curves) [55].
- **Input rows:** query+page-grouped GSC pulls, **non-branded only** (brand `excludingRegex`),
  impression-weighted (`Σclicks/Σimpressions` per bucket, never mean-of-ratios), trailing 3 months
  of `dataState=final`. Caveat: query-grouped data excludes anonymized queries (~47% of clicks,
  [10]), which skew long-tail; the fitted tail (p > 10) therefore reads slightly optimistic —
  acceptable because the scoring bands there are wide.
- **Post-fit:** monotone-decreasing projection across position bands (isotonic pooling), because
  sparse buckets go non-monotonic.
- **Cadence: monthly refit** (supersedes §8's "quarterly"): AIO prevalence moved 6.49%→24.61% in
  six months [52]; a quarterly curve is stale on arrival. Drift alarm when any bucket moves >25%
  relative between refits — this is exactly the signal that catches the next AIO-scale SERP-layout
  shift without a research cycle.
- **Cold-start policy (the single reconciled position for synthesis):**
  - **Day 0** (no GSC history): scores computed from E₀(p) + §A5 multipliers only; scores are
    valid for *ranking* the queue but MUST be labeled prior-based, and absolute "predicted +N
    clicks/mo" claims are suppressed in the UI.
  - **w(b) ≥ 0.5** (≥1k impressions in the bucket): absolute click forecasts may be shown, with
    the beta-posterior credible interval.
  - **w(b) ≥ 0.83** (≥5k impressions — both lanes' old threshold, now emergent): bucket is
    "site-calibrated"; global prior contributes ≤17%.
  - The rollback engine (SPEC §17) always uses the **lower credible bound** of expected CTR when
    judging KEEP/ROLLBACK, so thin-data buckets cannot trigger rollback whipsaw.

## A7. Band-stability check — §8 worked examples re-run under E₀(p)

The §8 formulas (G, U, R = 0.4G + 0.6U, κ-normalization, HIGH ≥ 60 / MEDIUM 25–60 / LOW < 25) are
unchanged. Re-running the three worked examples with the composite curve:

| Case | Under FPS curve (§8) | Under composite E₀(p) | Band change? |
|---|---|---|---|
| Spec example: P=8.7, I=32,000, ctr=2.1% | G=0; U=2,592; R=1,555 → score **95.5 HIGH** | E₀(8.7)=2.49% → G=125 (a small real metadata gap now registers); E₀(3)=11.0% → U=2,723; R=1,684 → score **96.6 HIGH** | No ✓ |
| Small keyword: P=6, I=1,200, ctr=1.0% | R=58.1 → score **11 LOW** | G=45.6; U=74.4; R=62.9 → score **11.8 LOW** | No ✓ |
| Page-2 term: P=12, I=8,000, ctr=0.4% | R=112 → score **20 LOW/MED boundary** | E₀(12)≈1.7% → G=104; U=144; R=128 → score **22.6 LOW/MED boundary** | No ✓ |

Two conclusions the synthesis can rely on: **(a)** the opportunity *ranking* is robust to the
curve dispute — ordering is driven by the curve's geometric shape, which all studies share, not
its absolute level; **(b)** what the curve level DOES change is the absolute predicted-click
number — which is exactly the number the platform reports to customers and grades itself against,
and why the conservative composite (not the 39.8% outlier) must be the default.

## A8. One curve service (architectural requirement)

Four consumers currently reference an expected-CTR baseline: the §8 opportunity scorer, the §9
decay detector, the AI-optimization lane's Layer-3 position-controlled CTR delta, and the SPEC §17
rollback engine. **These MUST resolve `E(p)` through a single versioned curve service** (per
tenant: prior table + fitted buckets + multipliers + fit metadata + version id), and every stored
score/verdict records the curve version that produced it. Otherwise the known failure mode:
scorer promises +2,700 clicks on a 39.8%-based curve, the deployment ships, and a 19%-based
rollback baseline scores the same page as underperforming — an autonomous system that undoes its
own correct work. Curve-version pinning also makes before/after comparisons legal across refits.

## A9. Corrections to this file (§8 as originally written)

1. **Misattribution fixed:** §8 claimed "position-1 CTR collapses from ~40% to ~19% under AI
   Overviews [42, notes]" citing FirstPageSage. The live FPS page claims the opposite (pos-1 with
   AIO = 38.9–42.9%, no penalty) [42]. The ~28%→19% figure is GrowthSrc's [48]. The AIO adjustment
   survives, but its evidentiary anchor is [48][49][50][51], not [42].
2. **Default curve replaced:** FPS-only table → composite E₀(p) (§A4).
3. **AIO multiplier retuned:** ×0.5 → ×0.6 for p ≤ 5 (cross-study median ≈ 0.65, conservative
   rounding), plus a new ×0.8 band for p 6–10 [48].
4. **Recalibration cadence:** quarterly → monthly, with EB shrinkage replacing the hard 5k
   switch (§A6).
5. The §8 "Recalibrate the curve quarterly per site … when ≥ 5k impressions" sentence and the
   risk-section bullet citing "pos-1 ~19% vs ~40% [42]" should be read as superseded by §A5–A6.

## A10. Risks & open questions (addendum-specific)

- **The AIO multiplier is the least-settled constant in the system** — credible measurements span
  ×0.42 [49] to ×1.0 [52]. The ×0.6 prior is defensible but must be treated as a learnable
  parameter, not a fact. The Semrush counter-finding [52] (same-keyword clicks slightly *up* after
  AIO gain) plausibly reflects selection effects (AIOs land on queries with growing demand), which
  is precisely the confound per-site measurement resolves and global studies cannot.
- **AI Mode is unmeasured:** all cited studies measure AI Overviews; Google's AI Mode (full
  conversational SERP) had no per-position CTR study as of this research. The drift alarm (§A6) is
  the designed detection path; expect another step-change.
- **Sistrix's layout finding generalizes to fitted curves** [53]: a per-site curve averaged across
  SERP layouts is still a blend; the bucket dimensions (device now, intent + feature-presence
  later) should grow as SERP-snapshot coverage grows.
- **Anonymized-query skew** [10] biases fitted tails optimistic (§A6); BigQuery-export tenants
  (§1) can fit unbiased curves and should.
- **Study freshness**: GrowthSrc/Backlinko/Ahrefs data end early-to-mid 2025; theStacc's Mar-2026
  aggregate is the most recent cross-study number. Re-verify the composite at each quarterly
  multiplier review; the EB machinery makes the prior progressively less load-bearing per tenant,
  which is the point.

## Addendum sources (continuing the file's numbering)

48. https://growthsrc.com/google-organic-ctr-study/ — 200k+ keywords, 30+ sites, GSC-measured; pos-1 28%→19% (−32% YoY); pos-2 −39%; pos 6–10 +30.63%; AIO avg −17.9% pos 1–5; AIO keyword count 10k (Aug 2024) → 172,855 (May 2025)
49. https://thestacc.com/blog/organic-ctr-by-position/ — six-study aggregate (FPS 39.8 / Backlinko 27.6 / Sistrix 28.5 / GrowthSrc 19.0 / Indexsy 26.4 / OuterBox 20.5, avg ≈27%); updated Mar 2026; AIO −58% claim; AIO on 30%+ of queries (Jul 2026 note)
50. https://ahrefs.com/blog/ai-overviews-reduce-clicks/ — 300k-keyword controlled study (Apr 2025): AIO presence → −34.5% pos-1 CTR (informational), counterfactual-forecast method
51. https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/ — 900-adult panel, 68,879 searches (Mar 2025): link clicks 8% w/ AI summary vs 15% without; AIO-link clicks 1%; session-end 26% vs 16%
52. https://www.semrush.com/blog/semrush-ai-overviews-study/ — AIO prevalence 6.49% (Jan 2025) → 24.61% (Jul 2025) → 15.69% (Nov 2025); vertical breakdown; counter-finding: zero-click rate fell 33.75%→31.53% for keywords gaining AIOs (refreshed Dec 2025)
53. https://www.sistrix.com/blog/why-almost-everything-you-knew-about-google-ctr-is-no-longer-valid/ — 80M-keyword mobile study: pos-1 28.5% avg but 13.7%–46.9% by SERP layout (sitelinks 46.9 / pure 34.2 / featured snippet 23.3 / knowledge panel 16.7 / shopping 13.7)
54. https://backlinko.com/google-ctr-stats — 4M SERPs via Semrush GSC data (updated Apr 2025): pos-1 27.6%, top-3 = 54.4% of clicks, #2→#1 = +74.5%
55. https://www.advancedwebranking.com/ctrstudy/ — live GSC-based CTR curves from "thousands of sites, millions of keywords" since 2015, segmented by device / SERP feature / intent / branded, updated Jul 2026 — external sanity-check reference for fitted per-site curves
56. https://en.wikipedia.org/wiki/Empirical_Bayes_method — beta-binomial empirical-Bayes shrinkage: posterior = sample/prior weighted average, weight ∝ sample size; the §A6 estimator
