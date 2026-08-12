# Analytics & Conversion Data Source — the Missing Pipe for the "Conversion Decline" Rollback Signal
### Lane: SPEC §17 (rollback signals — conversion decline) + SPEC §5 (traffic discovery — "which pages receive the most traffic", orphan detection)
### Research date: 2026-08-10 (gap-fill lane; complements `risk-rollback.md` Tier-2 veto and `data-model.md` orphan set algebra)

---

## Summary

**Recommendation in one paragraph.** Use the **GA4 Data API (free, quota-based)** as the platform's primary analytics/conversion source: it covers the overwhelming majority of sites that have any analytics at all, costs nothing, and its token quotas (200,000 core tokens/property/day standard; a typical report costs ≤10 tokens [1]) make a nightly per-tenant landing-page × channel × key-events sync essentially free. Connect it through the **same per-customer OAuth flow already planned for GSC** — add `https://www.googleapis.com/auth/analytics.readonly` (a sensitive-not-restricted scope, same verification track, no CASA [4][23]) to one consent screen, enumerate properties via the Admin API `accountSummaries.list` [8], and offer the **service-account-added-as-Viewer** fallback (GA4 lets any email, including a service account, be granted property-level Viewer access [7]). Warehouse the pull exactly like the GSC warehouse, re-pulling a trailing ~14 days nightly because **attribution credit for key events is restated for up to 12 days** [2][12]. Crucially, the research confirms the `risk-rollback.md` design decision to keep conversions as a **veto-only, last-priority signal**: the latency chain (GA4 daily processing ~12 h [2] + 12-day attribution settling [2] + statistical accrual) lands squarely in the 21–60-day window already assumed, and a power analysis shows page-level conversion verdicts are only statistically meaningful on pages with roughly **≥100 organic clicks/day** (at 1–3% conversion rates) — i.e., the site's head pages only. For everything else, conversions work as a **site-level/cohort-level guardrail**. For e-commerce tenants, **CMS-native order attribution** (Shopify `CustomerJourneySummary` [17], WooCommerce Order Attribution meta [18]) is a superior revenue-truth cross-check that requires no GA at all. Server-log ingestion is worth shipping as an **optional connector, not a requirement**: logs complete the orphan-detection union (sitemap ∪ GSC ∪ analytics ∪ logs [24]) and — underappreciated — give a **faster, quota-free recrawl-verification signal** (Googlebot sightings verified against Google's published IP ranges [22]) than the 2,000/day URL Inspection budget, but log access is gated by hosting stack (Cloudflare Logpush = Enterprise-only [19]; Vercel Drains = Pro+, $0.50/GB [21]; CloudFront standard logs = free to S3, best-effort [20]).

**The single most important design fact found:** the conversion-decline signal cannot be made fast or universal — it can only be made honest. GA4 restates attribution for 12 days [2], consent-mode sites blend *modeled* (ML-estimated) conversions into API numbers [13], and page-level conversion counts on the long tail are statistically invisible. The KEEP/ROLLBACK matrix must therefore never *wait* on conversions and never *block* on their absence — which is exactly how `risk-rollback.md` already positions the signal (priority: technical > indexing > clicks > position > CTR > conversions). This lane closes the gap by specifying the pipe; it does not change the matrix.

---

## Findings

### 1. What the signal must deliver (requirements traceback)

Three consumers in the existing sweep depend on an analytics source that no lane had researched:

1. **SPEC §17 / `risk-rollback.md` §3.2** — "Conversion decline" as a Tier-2 rollback veto, latency 21–60 d, "veto for high-traffic pages only (noisiest)". Needs: per-landing-page conversion counts + rates, joined to the change ledger's URL set, with a defensible noise model.
2. **SPEC §5 / `data-model.md` §4** — orphan detection = pages known from **sitemap ∪ GSC ∪ analytics ∪ server logs** minus crawl-reachable pages [24]; plus "which pages receive the most traffic" (GSC only sees *Google organic* — analytics sees all channels).
3. **`risk-rollback.md` §1.3 M_traffic** — traffic-value-at-stake modifier currently uses GSC clicks; an analytics source would let it also weight revenue at stake (e.g., a title change on a page driving $50k/mo of attributed revenue).

### 2. GA4 Data API — the primary candidate, in depth

**API surface.** `POST https://analyticsdata.googleapis.com/v1beta/properties/{PROPERTY_ID}:runReport` (plus `batchRunReports`, `runRealtimeReport`). The API is still **v1beta as of mid-2026** — no v1 stable has shipped; it receives active feature work (conversion-performance reporting added to v1alpha in April 2026) and no deprecations or quota reductions are announced [11][3].

**Quotas — token-based, free of charge** [1]:

| Quota (core reports) | Standard property | Analytics 360 |
|---|---|---|
| Tokens / property / day | 200,000 | 2,000,000 |
| Tokens / property / hour | 40,000 | 400,000 |
| Tokens / project / property / hour | 14,000 | 140,000 |
| Concurrent requests / property | 10 | 50 |
| Server errors / hour | 10 | 50 |

- "Most requests will charge 10 or fewer tokens, though more complex requests will consume more" [1]. Cost scales with rows, dimensions/metrics, filter complexity, date-range length, and cardinality; pass `"returnPropertyQuota": true` to get consumed/remaining counts in every response [1]. Realtime and funnel reports draw from separate, identically-sized token pools [1].
- **Capacity math for this platform:** a nightly sync that re-pulls the trailing 14 days as 14 single-day `runReport` calls costs ≈140 tokens/night against a 200,000/day property budget — under 0.1%. Even an hourly post-change monitoring loop (24 × ~10 tokens) is negligible. Quota is a non-issue for our access pattern. The real constraint is the **shared pool**: the per-property daily/hourly buckets are consumed by *every* API consumer of that property (the customer's other dashboards/tools), with only the per-project-per-property bucket (14,000/h) isolating us; the sync must treat `RESOURCE_EXHAUSTED` as retry-tomorrow, not as failure.
- Daily quotas reset at midnight PST [1].

**Row/report limits.** Max **250,000 rows per request** regardless of `limit` (default 10,000); paginate with `limit`/`offset`; up to 9 dimensions per request [3][4].

**Freshness / settling — the numbers that set the rollback clock** [2]:

- Intraday processing: **2–6 h** (standard), ~1 h (360). Daily processing: ~**12 h** after day close (standard normal tier).
- "Data in your reports and API queries may change after the daily data becomes available" — and specifically: **"Attribution credit for key events can change for up to 12 days after the key event is recorded"** [2]. GA4's attribution docs add that conversions "can be reattributed for up to 7 days" [12].
- Google explicitly disclaims SLA: "This is not a guarantee, nor an SLA or an SLO" [2].
- **Design consequence:** any conversion number younger than ~12 days is provisional. The warehouse must re-pull a trailing 12–14-day window nightly and mark rows `is_final` only beyond that horizon. A Tier-2 conversion veto must evaluate only `is_final` rows — this alone pushes the earliest honest conversion verdict to *apply + recrawl + 28-day window + 12-day settle* ≈ the 21–60-day latency `risk-rollback.md` already assumed.

**Conversions are "key events" now.** GA4 renamed conversions → **key events** (any collected event marked as key; "conversions" now means Google-Ads-synced conversions) [9]. The API metric is `keyEvents` (with per-event slicing, e.g. `keyEvents:purchase`); rate metrics like session key event rate exist [9]. The platform must let the tenant pick *which* key events count as "conversion" for rollback purposes (a newsletter signup and a purchase should not be pooled by default).

**The `(other)` row — the silent per-URL data killer** [5]. When a report's unique dimension-value count exceeds the table's row limit, GA4 collapses the tail into a literal `(other)` row — **in the UI, explorations, and Data API responses alike** [5]. Page path is the canonical high-cardinality dimension (guidance: >500 values = high-cardinality [5]). For a 100k-page site, a landing-page-grouped API pull *will* hit this: the long tail of pages merges into `(other)`, and per-URL joins against the change ledger silently lose rows. Mitigations, in order: (a) pull **single-day** granularity (cardinality per day ≪ cardinality per month); (b) filter the request to only the changed-URL set + control set when evaluating a specific batch (dimension filters reduce the table); (c) for large tenants, use the **BigQuery export**, which has no `(other)` row. This is the analytics twin of GSC's 50k-rows/day ceiling and needs the same warehouse-first posture.

**Realtime API — not useful for page-level guardrails.** `runRealtimeReport` covers only the last 30 min (60 for 360), with a restricted schema: `keyEvents` and `screenPageViews` metrics exist, but page dimension support is limited (`unifiedScreenName`; no full `pagePath`/landing-page reporting) [10]. Verdict: usable as a site-level "did conversions flatline after deploy" pulse at best; the fast post-deploy guardrails stay with the crawler/HTTP/CI signals from `risk-rollback.md` Tier-1.

**The concrete pull spec (v1):**

- Nightly, per tenant property, for each of the trailing 14 days:
  `runReport` — dimensions: `date`, `landingPagePlusQueryString`, `sessionDefaultChannelGroup`; metrics: `sessions`, `engagedSessions`, `keyEvents`, `totalRevenue`; `limit: 250000`, `returnPropertyQuota: true`.
- Filter to `sessionDefaultChannelGroup = "Organic Search"` for the rollback signal (the veto must not fire because a paid campaign ended), but store all channels for §5 traffic discovery.
- Warehouse table mirroring `gsc_page_daily`:

```sql
CREATE TABLE ga4_landing_daily (
  site_id      TEXT, landing_page TEXT, date DATE, channel_group TEXT,
  sessions     INT, engaged_sessions INT,
  key_events   NUMERIC,          -- tenant-selected key events only
  revenue      NUMERIC,
  is_final     BOOLEAN,          -- false until date < today - 12d (attribution settling [2])
  contains_other BOOLEAN,        -- true if the day's pull hit the (other) row [5]
  PRIMARY KEY (site_id, landing_page, date, channel_group)
);
```

### 3. Auth & multi-tenant property access

- **OAuth scopes:** `https://www.googleapis.com/auth/analytics.readonly` (read) or `.../auth/analytics` (full) [4]. Recommended: readonly only, requested **in the same consent screen as `webmasters.readonly`** — one grant, one verification review. Google Analytics scopes are in the *sensitive* class (verification: privacy policy, scope justification, demo video), not the *restricted* class — **no CASA assessment**, same as the GSC finding in `keyword-gsc.md` [23].
- **Property enumeration:** Admin API `GET https://analyticsadmin.googleapis.com/v1beta/accountSummaries` returns every account + property the caller can see (pageSize max 200) [8] — drive the tenant's property picker from this, then enforce a server-side allowlist of the one chosen property (the token itself grants access to *all* the user's properties — isolation is on us, same as GSC).
- **Service-account fallback:** GA4 access management grants roles (Administrator / Editor / Marketer / Analyst / Viewer) at account or property level to any email address — a service account's `client_email` added as property-level **Viewer** suffices for the Data API, no OAuth consent needed [7]. Optional data restrictions ("No Cost Metrics" / "No Revenue Metrics") exist and, if the customer applies them to our principal, silently remove revenue from our pulls — detect and surface this at onboarding [7].

### 4. GA4 BigQuery export — the completeness upgrade (same role as GSC bulk export)

- Free native export to the customer's BigQuery project. **Standard properties: 1,000,000 events/day daily-batch cap**; consistently exceeding it pauses the export (with prior email warning); **streaming export has no event cap** but bills BigQuery streaming ingest to the customer; "Fresh Daily" export is 360-only [6].
- Setup needs Analytics **Editor** + BigQuery project **OWNER** on the customer side — a guided manual onboarding step, and (like GSC bulk export) **no backfill**: history starts the day it's enabled [6].
- **Parity trap:** consent-mode **modeled** (behavioral-modeling) data appears in API/report numbers but is **not exported to BigQuery** [13] — API totals and BQ totals will legitimately disagree on consent-mode sites. Never mix the two sources inside one before/after comparison.
- Tiering recommendation: API-only below ~50k pages; offer BQ export to tenants where `contains_other` rows appear in >5% of days.

### 5. Noise sources that constrain the rollback signal (why "veto-only" is correct)

1. **Consent-mode modeling.** GA4 ML-models the behavior of cookie-decliners once thresholds are met (≥1,000 events/day with `analytics_storage='denied'` for 7+ days, ≥1,000 daily consented users on 7 of 28 days) and blends it in via the "Blended" reporting identity [13]. Modeled conversions shift when the model retrains — movement that has nothing to do with our change. EU-heavy sites carry the most modeling.
2. **Attribution restatement** — up to 12 days [2], 7-day reattribution [12] (§2 above).
3. **Sparsity.** Power analysis (own derivation, Poisson): to detect a 20% conversion drop at ~2σ over a 28-day window needs ≥~100 baseline conversions in the window (0.2·N ≥ 2·√N → N ≥ 100), i.e. ~3.6 conversions/day. At a typical 1–3% session-to-key-event rate that is **~120–360 organic sessions/day per page** — only head pages qualify. This independently confirms `risk-rollback.md`'s rule "conversions … act only as a veto on pages above ~1% of site clicks". For everything below that bar, evaluate conversions **pooled at cohort level** (all pages in the batch) or not at all.
4. **Cross-source incommensurability.** GA4 organic sessions ≠ GSC clicks (different counting: sessions vs clicks, timezone, consent loss, redirects). Rule: GSC decides *traffic* verdicts; GA4 decides only the *conversion layer*; never compute a ratio across the two sources within one verdict.
5. **Traffic-mix dilution.** A successful title change that grows clicks typically *lowers* conversion **rate** (new marginal visitors convert worse). The veto must therefore fire only on the pattern **sessions flat-or-up AND key events down** (absolute), or **rate down with interval excluding 0 vs control pages** — never on rate decline alone.

**Resulting veto rule (drop-in extension to `risk-rollback.md` Tier-2 table):**

| Evidence (final data only, vs control pages) | Verdict contribution |
|---|---|
| Changed pages: organic sessions ≥ baseline AND key events down >25% over 28 final days, 90% interval excludes 0, page ≥ ~3.6 conv/day baseline | **ROLLBACK veto** (overrides an inconclusive traffic KEEP for opinion-class changes) |
| Cohort-pooled key events down >25% (same conditions) where no single page is powered | ROLLBACK veto at batch level |
| Anything on non-final (<12-day-old) data, or on a `contains_other` day, or site lacks analytics connection | Signal **absent** — matrix proceeds on GSC signals alone (never blocks) |

### 6. Alternative & complementary conversion sources

**Plausible Analytics.** Privacy-first hosted analytics; Stats API v2 (`POST /api/v2/query`) with API-key auth, **600 requests/hour** default rate limit; metrics include visitors, pageviews, custom-event goals and revenue-goal conversions; page/source/UTM dimensions [14]. **Stats API requires the Business plan**; the Sites (provisioning) API is Enterprise-only [15]. Simple, no attribution restatement, no consent-mode modeling (cookieless by design) — but market share among SMB customers is small; treat as a supported connector, not a pillar.

**Matomo.** Reporting HTTP API (`token_auth`) included **in every plan including the free self-hosted Community edition** (unlimited hits) [16]; Matomo Cloud from **$29/mo at 50k hits** [16]. Self-hosted Matomo has no vendor rate limits and full raw data — the best fit for privacy-constrained/EU tenants; API modules cover page URLs, goals and e-commerce conversions.

**CMS-native order truth (e-commerce tenants) — the highest-fidelity conversion source, no analytics tool required:**

- **Shopify:** the Admin GraphQL `Order.customerJourneySummary` exposes per-order attribution — first/last visit (landing page, referrer, source, UTM), `daysToConversion`, `momentsCount`, plus a `ready` flag because "the order is still in the process of being attributed" [17]. Requires the `read_orders` scope, which is **protected customer data** (Shopify app-review approval needed) [17]. Joining `firstVisit.landingPage` where source = organic Google against the change ledger gives *revenue-true* organic conversion attribution.
- **WooCommerce:** built-in **Order Attribution** (toggle under WooCommerce → Settings → Advanced → Features) records per-order origin (direct/referral/**organic**/UTM), device, session page-view count and referrer, stored as order meta under the `_wc_order_attribution%` key prefix [18] — readable through the standard REST orders endpoint the WordPress connector already uses (meta fields ride on the order object). Zero extra auth.

Both are **last-click, order-scoped** models — cruder than GA4's data-driven attribution but immune to consent-mode modeling and restatement, and they measure the thing the customer actually cares about (orders/revenue). Recommended as the **cross-check and tie-breaker** for e-commerce tenants: if GA4 says conversions collapsed but Shopify orders from organic landing on that page are flat, trust the order data and do not roll back.

### 7. Server-log ingestion (SPEC §5's fourth set, plus a bonus signal)

**What logs are for here:** (a) completing the orphan-detection union — the industry method is sitemap ∪ GA ∪ GSC ∪ logs minus crawl-reachable [24]; logs are the *only* member that sees every URL any client or bot ever hit, including 404s and parameterized junk; (b) **Googlebot recrawl verification** — a verified Googlebot GET of a changed URL is a direct, quota-free `recrawl_verified_at` trigger for the evaluation clock, cheaper than burning the 2,000/day URL Inspection budget. Verification: match against Google's published crawler IP JSON (`common-crawlers.json`) or reverse-DNS to `googlebot.com`/`google.com` [22]; Google explicitly recommends the automated IP-list match at scale [22].

**Access reality by hosting stack (this is where the connector gets ugly):**

| Stack | Log access | Cost / gate |
|---|---|---|
| Cloudflare | Logpush (HTTP requests dataset, ~100–250 bytes/request compressed) | **Enterprise plan only** [19] — excludes most SMB tenants |
| AWS CloudFront | Standard logs (v2: S3, CloudWatch, Firehose destinations) | No CloudFront charge — pay S3 storage only; delivery is **best-effort**, entries can be late or (rarely) missing [20] |
| Vercel (the MVP's Next.js hosts) | Drains (runtime/build/static request logs → custom HTTPS endpoint) | **Pro or Enterprise plan**; billed **$0.50/GB** of uncompressed JSON [21] |
| Nginx/Apache (self-hosted WP) | Access logs via agent/rsync | Free; per-customer setup variance is high |

**Recommendation:** ship logs as an *optional* connector (Vercel Drains first — it matches the MVP's Next.js focus and is a managed HTTPS push), never as a dependency: orphan detection already works on sitemap ∪ GSC ∪ GA4 alone [24], and the recrawl-verification bonus degrades gracefully to URL Inspection. Budget note: a 1M-requests/day site ≈ 1–3 GB/day uncompressed JSON ≈ $15–45/mo on Vercel Drains [21] — pass through or cap by sampling to bot traffic only (filter user-agent at the drain endpoint; store only verified-bot + first-hit-per-URL events, which cuts volume >95%).

---

## Options compared

**Conversion/analytics source for the §17 rollback signal:**

| Option | Cost | Per-URL conversion data | Freshness / settling | Quota | Setup friction | Coverage of tenant base | Verdict |
|---|---|---|---|---|---|---|---|
| **GA4 Data API** [1][2][4] | Free | Yes (landing page × channel × key events), `(other)`-row risk at scale [5] | Daily ~12 h; attribution final at +12 d [2] | 200k tokens/property/day; req ≤10 tokens; 10 concurrent [1] | OAuth already built for GSC; +1 scope [4][23] | Very high (default analytics of the web) | **Primary** |
| GA4 BigQuery export [6] | Free export; customer pays BQ storage/query | Complete, no `(other)` row | Daily batch; no modeled data [13] | 1M events/day (standard) [6] | Manual customer setup, Editor+BQ OWNER, no backfill [6] | Large tenants only | **Completeness upgrade** |
| Plausible Stats API [14][15] | Business plan (tenant's) | Yes (goals by page) | Near-realtime, no restatement | 600 req/h [14] | API key paste | Low | Supported connector |
| Matomo API [16] | Free self-host / Cloud $29+/mo | Yes (goals, e-commerce) | Near-realtime | None published (self-host: none) | token_auth paste | Low-mid (EU/privacy segment) | Supported connector |
| Shopify `customerJourneySummary` [17] | Free (API) | Per-order landing page + source (last-click) | Attribution `ready` flag; order-time truth | Standard Admin API limits | Protected-data app approval [17] | All Shopify tenants | **E-comm cross-check / tie-breaker** |
| WooCommerce Order Attribution [18] | Free | Per-order origin incl. organic, meta on REST orders | Order-time truth | n/a | Feature toggle | All Woo tenants | **E-comm cross-check** |
| Server logs [19][20][21] | $0–45/mo/site | No (hits, not conversions) | Minutes–hours | n/a | High, stack-dependent | Partial | Not a conversion source — §5 + recrawl verification only |

**Access-path comparison for GA4 specifically:** per-customer OAuth (`analytics.readonly`, sensitive scope, one combined consent with GSC — recommended default) vs service-account-as-Viewer (no consent screen, manual add, enterprise fallback) [4][7][23] — identical trade-off profile to the GSC decision in `keyword-gsc.md`, so the same dual-path product design applies.

---

## Recommendation & why

1. **GA4 Data API as the primary conversion/traffic-mix pipe**, joined to the platform through the existing Google OAuth flow with one added readonly scope, with the Admin API driving property selection and a service-account fallback [1][4][7][8][23]. Why: free, near-universal among customers who measure conversions at all, and quota headroom is ~1000× our access pattern [1].
2. **Warehouse-first, finality-aware ingestion**: nightly 14-day trailing re-pull, `is_final` gate at +12 days, `(other)`-row detection per day, organic-channel slice for the rollback signal [2][5]. Why: every number younger than 12 days is legally provisional per Google's own docs [2]; evaluating on it would manufacture false rollbacks.
3. **Keep conversions as a veto, exactly as `risk-rollback.md` designed — now with the mechanism specified**: fire only on final data, vs control pages, on pages ≥ ~3.6 conversions/day (else cohort-pooled), only when sessions are flat-or-up while key events fall; signal absence never blocks a verdict. Why: the power analysis and the noise inventory (modeling, restatement, mix-dilution) show anything stronger would be statistically dishonest.
4. **E-commerce tenants get order-truth cross-checks from the CMS connector they already granted** (Shopify `customerJourneySummary`, WooCommerce `_wc_order_attribution%`) [17][18], and order data wins ties against GA4. Why: last-click order attribution is immune to the two biggest GA4 noise sources and measures revenue, which is the client's actual loss function.
5. **BigQuery export offered, not required, for large properties** [6]; **Plausible/Matomo connectors** for the privacy segment [14][15][16]; **server logs as an optional connector** (Vercel Drains first) for orphan-set completeness and quota-free Googlebot recrawl verification [19][20][21][22][24].

---

## Risks & limitations

- **Not every customer has analytics — and the system must not degrade.** The conversion signal is designed as optional-veto for this reason; sales/docs must set the expectation that rollback decisions on analytics-less tenants rest on GSC + technical signals alone (which the priority ordering already prefers).
- **The `(other)` row silently corrupts per-URL joins on big sites** [5]; the `contains_other` flag mitigates detection but the cure (BigQuery export) needs customer-side setup with no backfill [6]. Enable it early for any tenant above ~50k pages, or per-batch dimension filters keep tables small.
- **Modeled data is invisible in exports and mutable in the API** [13]; consent-mode-heavy (EU) tenants will show API-vs-BQ discrepancies and retroactive drift that support must be able to explain.
- **Attribution settling (12 d) makes conversions the slowest signal in the system** [2][12] — a conversion-triggered rollback will always land 3–8 weeks after apply; the guardrail phase must never wait for it.
- **Quota pools are shared with the customer's other tools** [1]; the sync needs `returnPropertyQuota` monitoring and graceful `RESOURCE_EXHAUSTED` deferral rather than alerting.
- **GA4 API remains v1beta** [11] — stable in practice and actively developed, but Google reserves breaking-change room; pin client-library versions and watch the changelog.
- **Shopify's `read_orders` is protected customer data** [17] — app review, data-protection requirements, and EU data-residency questions land on the roadmap the moment the cross-check ships; store only aggregates (per-page order counts/revenue), never customer PII.
- **Server-log access is plan-gated on the two most relevant stacks** (Cloudflare Enterprise [19]; Vercel Pro+ at $0.50/GB [21]) and CloudFront delivery is explicitly best-effort [20] — logs can inform orphan detection but must never be the sole evidence for deleting/redirecting a "dead" page.
- **Prices/plans cited are August 2026 list values** from vendor docs (Vercel doc last updated 2026-07-22 [21]); re-verify at contract time. Plausible per-tier prices were not machine-readable at research time — only the plan gating (Stats API = Business+) is confirmed [15].
- **Unverified detail flagged:** exact GA4 key-event lookback-window options (30/60/90 d) were not extractable from the attribution doc fetched [12]; only the 7-day reattribution and 12-day restatement figures are sourced [2][12]. Confirm lookback options during POC #8 (measure optimization impact).

---

## Sources

1. https://developers.google.com/analytics/devguides/reporting/data/v1/quotas — GA4 Data API token quotas (200k/day, 40k/h, 14k/h/project standard; 10 concurrent; ≤10 tokens typical; returnPropertyQuota)
2. https://support.google.com/analytics/answer/11198161 — GA4 data freshness: intraday 2–6 h, daily ~12 h, key-event attribution restated up to 12 days, no SLA
3. https://developers.google.com/analytics/devguides/reporting/data/v1/basics — Data API basics: property ID form, pagination, 9 dimensions
4. https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport — runReport reference: scopes (`analytics.readonly`/`analytics`), 250,000-row max per request, offset semantics
5. https://support.google.com/analytics/answer/13331684 — the `(other)` row: cardinality limits apply to Data API responses; page path = high-cardinality; avoidance strategies
6. https://support.google.com/analytics/answer/9823238 — BigQuery export: 1M events/day standard daily cap, unlimited streaming, pause behavior, Editor + BQ OWNER setup
7. https://support.google.com/analytics/answer/9305587 — GA4 access management: 5 roles, account/property levels, No Cost / No Revenue data restrictions
8. https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list — Admin API property enumeration, pageSize max 200, readonly scope
9. https://support.google.com/analytics/answer/9267568 — key events: any event markable, key-events metrics/reports, Google Ads conversion linkage
10. https://developers.google.com/analytics/devguides/reporting/data/v1/realtime-basics — Realtime API: 30-min window (60 for 360), limited schema (`keyEvents` yes, full page dimensions no)
11. https://developers.google.com/analytics/devguides/reporting/data/v1/changelog — API still v1beta (2026); Apr 2026 conversion-reporting addition; no quota reductions
12. https://support.google.com/analytics/answer/10596866 — GA4 attribution: data-driven model, conversions reattributed up to 7 days, configurable key-event lookback
13. https://support.google.com/analytics/answer/11161109 — behavioral modeling for consent mode: thresholds (1,000 events/day denied for 7 d), blended identity, modeled data excluded from BigQuery export
14. https://plausible.io/docs/stats-api — Plausible Stats API v2: /api/v2/query, Bearer key, 600 req/h default, goals + revenue metrics
15. https://plausible.io/docs/subscription-plans — Stats API gated to Business plan; Sites API Enterprise-only
16. https://matomo.org/pricing/ — Matomo Cloud from $29/mo (50k hits); Community self-host free unlimited; HTTP APIs in all plans
17. https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerJourneySummary — per-order attribution (first/last visit, daysToConversion, ready flag); `read_orders` protected scope
18. https://woocommerce.com/document/order-attribution-tracking/ — WooCommerce Order Attribution: origin types incl. organic, device, referrer; `_wc_order_attribution%` order meta
19. https://developers.cloudflare.com/logs/about/ — Logpush availability: Enterprise-only (HTTP requests dataset ~100–250 B/request)
20. https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html — CloudFront standard logs: S3/CloudWatch/Firehose (v2), best-effort delivery, no CloudFront charge
21. https://vercel.com/docs/drains — Vercel Drains: Pro/Enterprise plans, $0.50/GB uncompressed JSON, request-log schema (doc updated 2026-07-22)
22. https://developers.google.com/search/docs/crawling-indexing/verifying-googlebot — Googlebot verification: reverse-DNS method + published crawler IP JSON; automate at scale
23. https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification — sensitive-scope verification track (shared with GSC lane; Analytics scopes are sensitive, not restricted → no CASA)
24. https://www.screamingfrog.co.uk/seo-spider/tutorials/find-orphan-pages/ — industry orphan-detection method: sitemap ∪ GA ∪ GSC (∪ logs) minus link-reachable set
