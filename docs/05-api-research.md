# API Research — External Dependencies of the Platform

Document 05 of 07 · Autonomous SEO Optimization Platform · Planning Package

---

## Executive summary

This document answers one question: **does every stage of the Platform's loop — Discover → Analyze → Identify → Decide → Optimize → Validate → Deploy → Monitor → Measure → Re-optimize — have a workable external API behind it, and at what limits, latency, and cost?** The answer is yes, with no stage blocked, but six external constraints were strong enough to shape the architecture itself rather than merely its parameters:

1. **Google Search Console data lags 2–3 days, is retained only 16 months°, and hides ~47%° of clicks behind anonymized queries** [2][5][6]. Consequence: the Platform warehouses every tenant's GSC data permanently from day one, computes page-level metrics from page-grouped pulls (never by summing query rows), and starts every post-change evaluation clock at verified recrawl, not at deploy.
2. **The URL Inspection API is capped at 2,000 inspections/day per property** [1] — a 100,000-page site takes 50 days to sweep once. Consequence: index verification is a budgeted sampling layer prioritized by opportunity score, never a full-coverage guarantee.
3. **Google's Rich Results Test has no public API** (covered in Doc 03/06; the gap surfaces here because it removes an expected dependency). Consequence: structured-data validation is self-built, with URL Inspection's `richResultsResult` as the post-deploy ground truth within its quota [7].
4. **Yoast's REST surface is officially read-only, and WordPress REST silently drops unregistered SEO meta** [40][41]. Consequence: a small companion plugin that registers SEO meta for REST is a mandatory part of the WordPress adapter, not an optional convenience.
5. **Every SERP feed on the market is scraped** — Google offers no official SERP API and Microsoft retired the Bing Search APIs in August 2025 [70] — and the legal ground moved in 2025–2026 (Google v. SerpApi; Reddit v. SerpApi/Oxylabs) [67][68][69]. Consequence: all SERP/keyword calls sit behind a multi-vendor `SerpProvider` abstraction with at least two wired vendors, and GSC (first-party, fully legal) remains the primary rank/impression source.
6. **All three AI providers now offer schema-constrained decoding, a uniform 50% batch discount, and ~0.1× cached-input pricing** [81][82][83][85][87]. Consequence: the AI engine is designed as a nightly batch job with cache-ordered prompts; a full 10,000-page metadata pass costs roughly **$33–$88** in model spend — $27.50–$82.50 of generation plus ~$5.60 of selective Opus judging (§10.3). Scoping that claim honestly: batching plus cache-ordered prompts are worth roughly **2–5×** on their own (batch is a flat 2×; caching is ~10× but only on the cached prefix). The larger ~20–50× gap against a naive design is a *whole-stack* figure that also assumes live per-call inference, Opus everywhere, headless rendering of every page, re-analysis of unchanged pages, and per-keyword live SERP calls — it belongs to the full cost architecture (model tiering, static-first crawl, content-hash change detection, incremental analysis), which is set out in Doc 03's cost envelope and carried as a cost risk in Doc 06, not to these two levers alone.

Criticality is uneven, and "hard vs. degradable" is too coarse to describe how — there are four distinct tiers, matching the legend in §11:

- **Platform-wide hard dependencies (3).** **GSC** (the only irreplaceable data source — Identify, Monitor, and Measure all rest on it), **GitHub** (the entire code-change channel), and **at least one AI provider** (the Optimize stage; mitigated by a three-vendor adapter). Lose one and a loop stage stops for every tenant.
- **Per-site hard dependencies.** For a git-channel site on a host that sells instant rollback (Vercel or Netlify), that **deploy host** is hard for Validate and Rollback: preview URLs are the unit of validation, and instant rollback is the emergency brake. §12 spells out the consequence — when a site's normally-available instant-rollback path goes *transiently* unavailable the Platform **freezes new deploys to that site**, which is a stopped stage for that site, not graceful degradation. A host that structurally never had an instant lane (Amplify, Cloudflare Pages, Render, Fly, self-hosted Docker) is the other case and is never frozen: it onboards **git-revert-only** with a tightened risk policy (Doc 03 §5.3).
- **Channel-fatal dependencies.** **WordPress REST** and **Shopify Admin GraphQL** each carry exactly one site-platform channel; an outage stops changes on that channel while other channels continue. The **edge/custom-site channel** (§7.3) is the same shape, with the extra property that the Platform sits in the serving path.
- **Genuinely degradable.** GA4 is a veto-only signal whose absence never blocks a verdict; DataForSEO and Serper fail over to each other; Bing and IndexNow are free fire-and-forget bolt-ons; URL Inspection degrades to crawl-and-HTTP signals.

Section 11 gives the consolidated reference table; Section 12 maps API outages to loop stages.

**On evidence quality.** Quotas and prices are cited to primary vendor documentation and were verified in August 2026. Figures marked **°** derive from *secondary* sources — community-measured ceilings, semi-documented endpoints, and third-party pricing trackers — and carry correspondingly lower confidence; they are flagged inline at first use and marked in the Sources list. Where a vendor genuinely does not publish a number, this document says so rather than inventing one.

---

## 1. How to read this document

Each section covers one API family with the same template: what it provides, auth model (scopes and verification requirements), hard quotas with exact numbers, latency/freshness, cost, the constraints that shaped the architecture, and how the Platform uses it. Where a vendor does not publish a number the template calls for — OpenAI and Gemini per-tier rate limits (§10.2), Serper throughput (§8.2) — the section says so explicitly and names the POC measurement that will close it, rather than substituting a qualitative sentence. Requirement IDs (FR-x.y / NFR-x) refer to Doc 01. Architectural picks referenced here (adapter design, GSC-first data plane, model tiering) are presented with their justification; the full comparisons live in Doc 04 (Technology Comparison).

MVP scoping note (Doc 01 §6): GSC is the sole external *data* source at MVP; GA4, Shopify, the custom-site edge channel, Bing Webmaster Tools, and third-party SERP/keyword APIs are researched here in full because FR-14.1, FR-9.3, FR-9.4, and FR-5.1 require the design to accommodate them, but they ship post-MVP (conversion-based rollback signals are explicitly deferred — MVP verdicts run on GSC-only signals).

---

## 2. Google Search Console APIs

The backbone of the Platform's measurement layer (FR-6.1–6.3, FR-5.1, FR-14.1). Free, generous, and API-first — but with structural caveats that dictate a warehouse-first design.

### 2.1 Search Analytics API

**What it provides.** Per-property search performance: queries, pages, clicks, impressions, CTR, average position, sliced by `query`, `page`, `country`, `device`, `date`, `searchAppearance`, and (since April 2025) `hour` [2][4]. Search types: `web` (default), `image`, `video`, `news`, `googleNews`, `discover`. Filters support `contains`/`equals` and RE2 regex (`includingRegex`/`excludingRegex`) — the workhorse for brand/non-brand splits [2].

**Endpoint.** `POST https://searchconsole.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query`.

**Quotas** [1]:

| Quota | Value |
|---|---|
| Per-site | 1,200 queries/minute |
| Per-user | 1,200 queries/minute |
| Per-project | 40,000 QPM / 30,000,000 queries/day |
| All other GSC methods (per user) | 20 QPS / 200 QPM |

**Row limits.** `rowLimit` max 25,000 per request, paginated via `startRow` [2]. Google's own documentation states only that the API returns "top rows, not all rows" and does not publish the cut-off; the widely reproduced **~50,000 rows per day of data per site per search type°** ceiling (sorted by clicks descending) is a community-measured figure [3], not a documented one. The Platform therefore treats 50k as a planning estimate and detects truncation empirically — if a day's pull returns a row count at the observed ceiling, that day is flagged as truncated rather than assumed complete. Day-by-day pulls with `query`+`page` grouping capture the visible long tail for all but the largest properties.

**Latency and freshness** [2][4]:

| dataState | Delay | Use |
|---|---|---|
| `final` (default) | ~2–3 days | scoring, verdicts, the warehouse |
| `all` (fresh) | hours to ~1 day, subject to revision | post-deploy guardrail monitoring |
| `hourly_all` + `hour` | few hours, last ~10 days only | did CTR move after a title change? |

**Structural caveats (the load-bearing facts):**

- **Retention is a rolling 16 months°** [5]. The Platform's decay detection needs year-over-year baselines, so every tenant's data is synced nightly and warehoused permanently — the warehouse, not the API, is the system of record. (The 16-month figure is universally reported and matches the GSC UI, but the citation to hand is a third-party explainer rather than a Google reference page; the architectural response — warehouse everything — is correct at any retention window and does not depend on the exact number.)
- **~46.77%° of all clicks belong to anonymized queries** (Ahrefs, 146k-site study; per-site range 45–80%) [6]. This is a vendor study, not a Google-published statistic — treat the precise percentage as indicative and the *direction* as certain. Query-grouped pulls silently exclude anonymized clicks; page-grouped pulls include them. Per-page metrics must therefore come from page-grouped requests, never by summing query rows.
- An unpublished "load quota" penalizes wide `page`+`query` pulls over long ranges [1] — another reason the sync is one-day-at-a-time.

**Cost.** Free.

**How the Platform uses it.** Nightly per-tenant sync of yesterday's final data, day-granular, both page-grouped and query+page-grouped, into the Postgres warehouse (Doc 03). This feeds the opportunity score (FR-5.2), the decay detector (FR-6.3), and the rollback engine's CUSUM (cumulative-sum change detection) and counterfactual verdicts (FR-14.x). Fresh/hourly states are reserved for the days-0–7 guardrail window after a deploy. A single GCP project's 30M queries/day comfortably covers thousands of tenants at ~2–10 requests/tenant/night.

### 2.2 URL Inspection API

**What it provides.** Google's index-state record for one URL in a verified property: index verdict and `coverageState` ("Submitted and indexed", "Crawled — currently not indexed"), `robotsTxtState`, `indexingState` (noindex detection), `lastCrawlTime`, `pageFetchState`, `googleCanonical` vs `userCanonical`, `crawledAs` (MOBILE/DESKTOP), referring URLs, sitemap membership, plus `richResultsResult` (detected schema types and per-item issues), mobile-usability and AMP results [7].

**Three limitations bound it** [1][7]:

- **No live-test rendering.** The API returns Google's *stored* index state only. The "live test" in the Search Console UI — which fetches and renders the page on demand — has no API equivalent, so the Platform cannot ask Google to re-render a page and report what it saw. Post-deploy rendering checks run on the Platform's own validator instead (§7).
- **The URL must belong to a property the caller is verified on.** Arbitrary third-party URLs cannot be inspected, which is why competitor pages go through the SERP/fetch ladder (§8) rather than this API.
- **2,000 inspections/day per property**, plus 600 QPM per site; project-wide 10,000,000/day and 15,000 QPM.

Note what is *not* a limitation: unindexed URLs are fully supported and are in fact the interesting case — `coverageState` values such as "Crawled — currently not indexed" and "Discovered — currently not indexed" are precisely how the API reports them, and detecting that state is one of the Platform's primary uses for it.

**Quota.** **2,000 inspections/day per property** and 600 QPM per site; project-wide 10,000,000/day and 15,000 QPM [1]. A community workaround° multiplies the effective budget when a customer verifies URL-prefix sub-properties alongside the domain property [8] — reported in a Google product forum rather than documented by Google, so it is treated as an optimization to confirm per tenant, never as budgeted capacity.

**Cost.** Free.

**Constraint that shaped the architecture.** 2,000/day means a 100k-page site cannot be swept (50 days per pass). The Platform treats URL Inspection as a **budgeted sampling layer**: changed pages first (post-deploy verification — did Google pick up the new canonical/title, is the page still indexed?), then high-opportunity pages, then a rotating random sample. `lastCrawlTime` doubles as the trigger that starts each change's evaluation clock ("verified recrawl", FR-14.3), and `richResultsResult` is the post-deploy structured-data ground truth compensating for the absent Rich Results Test API.

### 2.3 Sitemaps API

`sitemaps.submit` / `delete` / `get` / `list` under the same v3 surface; requires the read-write `webmasters` scope [9]. `get`/`list` return per-sitemap status: last submitted/downloaded, error and warning counts, submitted-vs-indexed counts per content type. Quota falls under "all other methods" (20 QPS / 200 QPM per user) [1]. Google deprecated the sitemap ping endpoint in 2023; API submission is the supported path. Two different actions hide under "sitemap automation" and they do not carry the same risk. **Re-submitting a verified byte-identical sitemap** is a protocol action: it is reversible (`sitemaps.delete`), changes nothing on the rendered page and nothing in the indexable set, and **qualifies for LOW-risk auto-apply under the FR-11.2 criteria**. **Regenerating or replacing the sitemap's contents** does not qualify — the file declares which URLs the Platform asks Google to index, so it is **MEDIUM (gated), escalating to HIGH when the diff removes >5% of indexable URLs** (Doc 06 §11). Flagged explicitly as an *extension*: the client's enumerated LOW list in Doc 01 FR-11.2 (missing alt, missing meta description, duplicate metadata, broken internal link, invalid JSON-LD) is fixed and non-negotiable, and does not name sitemap submission. The Platform proposes adding the identical-resubmit case on the criteria above; it needs the client's sign-off before it ships as auto-apply, and defaults to the MEDIUM gated path until then.

### 2.4 BigQuery bulk export

For enterprise tenants, GSC can dump complete daily data — including anonymized queries as aggregate rows, with **no 50k row cap** — into the customer's own BigQuery project (`searchdata_url_impression`, `searchdata_site_impression`, `ExportLog` tables) [10][12]. Three onboarding facts matter: it requires property **Owner** permission, it can only be enabled in the GSC UI (**no API exists to enable it**), and there is **no backfill** — history starts the day it is switched on [11]. BigQuery storage/query costs land on the customer's billing account (small sites fit the free tier) [11]. Platform tiering: API-only below ~100k pages or ~50k daily query rows; guided bulk-export setup for enterprise tenants, read via a service-account grant on their dataset.

### 2.5 Auth: OAuth sensitive-scope verification vs service-account fallback

Two connection paths, both shipped:

**A. Per-customer OAuth 2.0 (default).** Scope `https://www.googleapis.com/auth/webmasters.readonly` for data; the read-write `webmasters` scope requested incrementally only for tenants using sitemap submission [9][13]. GSC scopes are classified **sensitive, not restricted**: publishing the app requires Google's verification review (registered domain, privacy policy and ToS URLs, per-scope justification, a demo video; typically days to weeks) — but **not the Cloud Application Security Assessment (CASA)** — Tier 2, ~$540 self-scan to $5k+ third-party°, renewed annually — that restricted scopes such as Gmail/Drive carry [13][14][16]. The *classification* comes from Google's own scope documentation [13][14]; only the dollar range is secondary, from a security vendor's guide [16], and it is a figure the Platform never has to pay on this scope set. This classification is confirmed against Google's enumerated restricted-scope list, which does not include Search Console [14]; it is re-verified on the project's own Cloud Console Data Access page (which labels each scope) at console setup, since that page — not the public docs — is authoritative for the review track the project actually gets. Until verified, the app is capped at **100 test users** with "unverified app" warnings [15]. Two operational facts: refresh tokens die if unused ~6 months or if more than 100 tokens are minted per account/client; and the granted token can see **every property the granting user can see**, so the Platform enforces a server-side allowlist of the one property the tenant connected — isolation is the Platform's job, not Google's.

**B. Service account by invitation (enterprise fallback).** The Platform generates a service account per tenant; the customer adds its `client_email` in Search Console → Users and permissions as a **Full** user [17]. No consent screen, no verification dependency, no refresh-token lifecycle — at the cost of a manual per-property step. This is a widely used pattern among SEO tooling and also unblocks pilots while OAuth verification is in review.

**Schedule risk worth flagging:** OAuth verification is a launch-blocking dependency with weeks of lead time; it starts at project kickoff, not at GA (NFR-5).

---

## 3. Google Analytics 4 — Data API + Admin API

The conversion-decline rollback signal (FR-14.1) and all-channel traffic discovery (FR-2.2). **Post-MVP** — Doc 01 §6 defers conversion-based rollback signals, so MVP verdicts run on GSC-plus-technical signals; the integration is researched in full now because the veto's constraints shape the warehouse and rollback engine from day one. Deliberately positioned as a **veto-only, last-priority signal**: the analysis below explains why nothing stronger would be honest.

**What it provides.** `runReport` (plus `batchRunReports`, `runRealtimeReport`) over any GA4 property: sessions, engaged sessions, key events (GA4's renamed conversions), revenue, sliced by landing page, channel group, date — up to 9 dimensions and 250,000 rows per request [18][20]. The Admin API's `accountSummaries.list` enumerates every account and property the caller can see (pageSize max 200) and drives the tenant's property picker [23].

**Auth.** `https://www.googleapis.com/auth/analytics.readonly` — a sensitive-not-restricted scope on the **same verification track as GSC**, requested on the same consent screen: one grant, one review, no CASA [13][20]. Fallback mirrors GSC: a service account added as property-level **Viewer** suffices for the Data API [24]. Caveat: GA4 "data restrictions" (No Cost / No Revenue Metrics) applied to the Platform's principal silently strip revenue from pulls — detected and surfaced at onboarding [24].

**Quotas (token-based, free)** [18]:

| Quota (core reports) | Standard | Analytics 360 |
|---|---|---|
| Tokens / property / day | 200,000 | 2,000,000 |
| Tokens / property / hour | 40,000 | 400,000 |
| Tokens / project / property / hour | 14,000 | 140,000 |
| Concurrent requests / property | 10 | 50 |

A typical report costs ≤10 tokens; the Platform's nightly 14-day trailing re-pull costs ≈140 tokens/night — under 0.1% of budget. The real constraint is that the per-property pools are **shared with every other tool the customer connects**; the sync treats `RESOURCE_EXHAUSTED` as retry-tomorrow, never as failure.

**Latency and the two honesty caveats:**

- Daily data lands ~12 hours after day close (intraday 2–6 h), **and attribution credit for key events is restated for up to 12 days** [19]. Every row younger than 12 days is provisional; the warehouse re-pulls a trailing 14-day window nightly and marks rows `is_final` only beyond that horizon. A conversion-based rollback veto evaluates final rows only — which is why conversions land at the back of the signal priority order (technical > indexing > clicks > position > CTR > conversions).
- **Consent-mode modeled data**: on sites using consent mode, GA4 blends ML-modeled behavior of cookie-decliners into API numbers; modeled data shifts when the model retrains and is **excluded from the BigQuery export** [22]. API totals and BQ totals legitimately disagree — the two sources are never mixed inside one before/after comparison.

One more silent data-killer: when a report's dimension cardinality exceeds table limits, GA4 collapses the tail into a literal `(other)` row — in API responses too [21]. Landing-page pulls on 100k-page sites will hit this; mitigations are single-day granularity, dimension filters scoped to the changed-URL set, and the customer-side BigQuery export (1M events/day standard cap, no backfill) for large tenants [21][25].

**Cost.** Free. API status: still v1beta as of mid-2026, actively developed, no announced deprecations [26].

**How the Platform uses it.** Nightly sync of landing page × channel × key events × revenue, organic-channel slice for the rollback veto, all channels for traffic discovery. The veto fires only on final data, versus control pages, on pages carrying **≥~3.6 conversions/day of baseline** — roughly **120–360 organic sessions/day** at a typical 1–3% session-to-key-event rate. That floor is derived, not assumed: detecting a 20% conversion drop at ~2σ over a 28-day window needs ≥~100 baseline conversions in the window (0.2·N ≥ 2·√N ⇒ N ≥ 100), i.e. ~3.6/day. Only head pages clear it; below the bar, conversions are evaluated cohort-pooled across the whole change batch, or not at all. (A "≥100 organic clicks/day" shorthand circulates for this threshold and appears in the underlying research summary; it is a rounded rule of thumb that implies a 3.6% conversion rate — above the researched 1–3% band — so this document uses the derived session range instead.) Signal absence never blocks a verdict — tenants without analytics get GSC-plus-technical rollback logic, by design.

---

## 4. GitHub — the code-change channel

Serves FR-9.1 and the full FR-10 pipeline for Next.js/React and any git-deployed site. The decision is **GitHub App only** — never OAuth Apps or personal access tokens — because, on GitHub's own comparison of the three integration models [27], it is the only one with all four properties the Platform needs: short-lived tokens, per-repo scoping, the Checks API, and per-customer rate isolation.

**Auth model.** A GitHub App is installed by the customer on selected repositories. The Platform mints **installation access tokens** via `POST /app/installations/{installation_id}/access_tokens`, authenticated by the App's JWT; the request body can down-scope to specific repositories (≤500) and specific permissions — the Platform mints a **single-repo, minimal-permission token per pipeline run** (`contents:write`, `pull_requests:write`, `checks:write`, `metadata:read`). Tokens **expire after 1 hour** [28]. Fine-grained PATs are disqualified outright: personal-use positioning, 50-token cap, single-org, and **no Checks API access** [35]. The App's private key is the highest-value secret in the system and lives in an isolated token-mint service (NFR-5; Doc 03).

**Key operations (GraphQL-first — several have no REST equivalent)** [31]:

| Operation | What it does | Safety property |
|---|---|---|
| `createCommitOnBranch` | commit `fileChanges` to a branch | requires `expectedHeadOid` — a concurrent human push fails the mutation instead of being clobbered; commits are auto-signed and marked Verified as the App [32] |
| `revertPullRequest` | opens a PR reverting a merged PR | the durable rollback path; runs the full check suite |
| `enablePullRequestAutoMerge` | auto-merge when requirements met | since March 25, 2026: callable only after all requirements are already fulfilled, else HTTP 422 — the pipeline enables it *after* checks pass [33] |
| `mergePullRequest` | merge | also accepts `expectedHeadOid` so a last-second push cannot slip in unreviewed |
| Checks API (REST) | post named check runs (`seo-platform/build`, `seo-platform/seo-validation`) on the PR head SHA | customers can mark them **required** in branch protection, turning Platform validation into a server-enforced gate [36] |
| Merge queue | `merge_group`-triggered CI for high-volume repos | ordering safety at scale [34] |

**Rate limits** [29][30]:

- Primary: **5,000 requests/hour per installation**, +50/h per repo beyond 20 and per user beyond 20, capped at **12,500/h** (15,000/h on Enterprise Cloud). Per-installation buckets give natural multi-tenant isolation — one customer's burst cannot exhaust another's budget.
- Secondary (the real constraint): **80 content-generating requests/minute and 500/hour** (commits, branches, PRs, comments). At ~3 writes per change-PR, that is a hard ceiling of roughly **150–160 PRs/hour per installation** — batching one logical SEO change per PR (with multiple pages of the same change type where appropriate) is a design requirement, not an optimization.

**Latency and freshness.** Writes are synchronous and immediately consistent for the Platform's purposes: `createCommitOnBranch` and the PR mutations return the new commit/PR in the call, typically well under a second. There is no data-freshness lag of the GSC/GA4 kind — the lag that matters on this channel is downstream and customer-controlled: CI and preview-build time (§7), plus human review time on repos with required approvals. The Platform therefore times the change ledger from the merge commit, and the *evaluation* clock from verified recrawl (§2.2), never from PR creation.

**Cost.** Free (API); customer-side CI minutes are theirs.

**How the Platform uses it.** The FR-10.1 pipeline: branch → **AST codemod** (a deterministic, parser-based code transform — the edit is performed by rule, with the LLM supplying only the *values* it injects) or, where a codemod cannot express the change, an LLM-authored patch applied search/replace with apply-or-reject → `createCommitOnBranch` → PR → validation gates posted as Checks → auto-merge (LOW risk, where branch protection allows) or reviewer-requested (MEDIUM) → deploy hook → `revertPullRequest` for durable rollback. The Platform reads each repo's branch protection at onboarding and adapts: required human review caps that repo's automation at "auto-PR", which the product surfaces honestly in the SPEC §26 bucketing. One honest limitation: automation level on the code channel is ultimately bounded by each customer's branch rules, not by the Platform.

---

## 5. WordPress REST API

The broadest-coverage CMS channel (FR-9.2). Near-everything is writable — with one hard exception that makes a companion plugin mandatory.

**Auth.** **Application Passwords** — in WordPress core since 5.6 (Nov 2020): per-user, individually revocable, HTTP Basic over HTTPS only [37][38]. Critical limitation: Application Passwords are **not scope-limited** — they inherit the full capabilities of their user [38]. The only real scope control is the user itself, so onboarding creates a dedicated least-privilege **Editor-role** user for the Platform (NFR-5). OAuth exists only via plugins and adds install burden for no server-to-server gain.

**Core writable surface.**

| Endpoint | Writable fields |
|---|---|
| `POST /wp/v2/posts/{id}`, `/pages/{id}` | `title`, `content`, `excerpt`, `slug`, `status`, `meta` (registered keys only) |
| `POST /wp/v2/media/{id}` | `alt_text`, `title`, `caption`, `description` [39] |
| `POST /wp/v2/posts/{id}/autosaves` | staged content changes without touching the live post (the staging primitive for content edits) |
| `/batch/v1` | up to 25 sub-requests |

No core rate limit exists; hosts and security plugins (WAFs) impose de-facto ceilings — the adapter paces at ~5–10 requests/second and carries 401/403/429 diagnostics ("your host is blocking REST writes, here is the fix").

**The Yoast problem — and the companion plugin requirement.** The single most consequential finding on this channel: **"The Yoast REST API is currently read-only, and doesn't currently support POST or PUT calls to update the data"** [40]. Yoast exposes `yoast_head_json` for cheap *reads* of current SEO state, but SEO titles and meta descriptions cannot be written through any official Yoast surface. Rank Math is the same shape: WordPress REST **silently drops** `rank_math_*` meta unless the keys are registered for REST [42]. The production-standard fix, used across the automation ecosystem, is to register the SEO meta keys (`_yoast_wpseo_title`, `_yoast_wpseo_metadesc`; `rank_math_title`, `rank_math_description`, `rank_math_canonical_url`) via `register_post_meta(..., show_in_rest: true)` and then write them through the normal `meta` object [41][42].

The Platform therefore ships a **~50-line companion plugin**, installed one-click at onboarding, that: (a) detects the active SEO plugin and registers its meta keys for REST with an `auth_callback`; (b) exposes a schema-injection hook (JSON-LD via Yoast's `wpseo_schema_*` filters); (c) provides a token-based public preview of autosaves (staging for content edits); (d) provides a cache-purge hook and a health/version endpoint; (e) (post-MVP) a `replace-file` endpoint for same-URL image replacement, which core REST cannot do [39]. Without the plugin, SEO titles and descriptions on WordPress are **not writable** — the honest capability statement the SPEC §26 bucketing requires.

**Rollback caveat.** Revisions endpoints support list/get/delete only — **there is no restore endpoint** — and SEO-plugin postmeta does not participate in revisions (WP 6.4's meta-revisioning framework is opt-in and SEO plugins have not opted in) [43][44]. Consequence: the Platform's own change ledger (before/after values, FR-13) is the rollback source of truth on WordPress; restore = re-apply the `before` value. WP revisions are a secondary net only.

**Latency and freshness.** Writes are synchronous and take effect on the next page request; there is no eventual-consistency window in core. The two real delays are customer-side and must be modelled, not assumed away: **page/object caching** (host-level, plugin, or CDN) can serve a stale page for minutes to hours after a successful write, which is why the companion plugin exposes a cache-purge hook; and **Googlebot recrawl**, which starts the evaluation clock (§2.2) days to weeks later. The adapter re-reads the live URL after every write and compares the rendered tag against the intended value before recording the change as applied.

**Cost.** Free.

**How the Platform uses it.** One write sequence per change type, all of them read-before-write (NFR-1) so the ledger records a true `before` value:

| Change type | Write sequence |
|---|---|
| SEO title / meta description | `GET /wp/v2/posts/{id}?_fields=meta,yoast_head_json` to capture `before` → `POST` the registered `meta` key (`_yoast_wpseo_title` / `rank_math_title`, etc.) → re-read to confirm the value round-tripped (the silent-drop symptom is a 200 with the old value still in place) |
| Image alt text | `POST /wp/v2/media/{id}` with `alt_text` [39]; attachment-level only — alt hardcoded inside `post_content` needs the content path instead |
| Body content / headings | `POST /wp/v2/posts/{id}/autosaves` to stage → validate on the plugin's token-preview URL (§7) → `POST /wp/v2/posts/{id}` to publish |
| JSON-LD | the companion plugin's schema-injection hook (Yoast `wpseo_schema_*` filters), not a REST field |
| Canonical | registered canonical meta key where the SEO plugin exposes one; otherwise refused and surfaced as an unsupported action |

**Batching and ordering.** `/batch/v1` takes up to 25 sub-requests and is used for same-type changes across posts (bulk alt text, bulk meta descriptions); it is *not* used to mix change types, because a partial failure inside a mixed batch is harder to unwind against the ledger. The adapter paces at ~5–10 requests/second regardless, since the binding limit is the host's WAF rather than WordPress core. Ordering follows the change ledger's batch boundary (D-14): one ledger batch = one CMS transaction, applied in ledger order, and a failure mid-batch stops the batch and marks the remainder unapplied rather than continuing — so the rollback unit and the apply unit are always the same set.

---

## 6. Shopify Admin GraphQL API

The e-commerce channel (FR-9.3; post-MVP but designed now). Integration is only possible as a **Shopify app** — a custom app per store for early customers (merchant-created token), a public OAuth app for scale. The REST Admin API is legacy; all work targets the GraphQL Admin API, current version **2026-07** [45]. The API ships quarterly dated versions, each supported for 12 months — every adapter pins a version and budgets a quarterly upgrade review.

**SEO-writable surface.**

| Resource | Mechanism | Scope |
|---|---|---|
| Products | `productUpdate` with `seo { title, description }` [45] | `write_products` |
| Pages, collections, blogs, articles | metafields `global.title_tag` / `global.description_tag` (`single_line_text_field`) [46] | resource write scopes |
| Per-resource noindex | metafield `seo.hidden = 1` [46] | same |
| Redirects | `urlRedirectCreate` (301s) [48] | `write_online_store_navigation` |
| Image alt + same-URL binary replacement | `fileUpdate` — `originalSource` replaces file content "while maintaining the same URL"; async processing [52] | `write_files` |
| Theme files | `themeFilesUpsert`, ≤50 files/request, async [50] | `write_themes` **+ exemption** (below) |

**Two verified gotchas that shaped the adapter:**

1. **Partial `seo` input nulls the omitted field** — updating `seo.title` without echoing `seo.description` silently wipes the description [47]. The adapter always reads before writing and echoes unchanged fields (this also aligns with the Platform-wide read-before-overwrite rule, NFR-1).
2. **Changing a handle does not auto-create a redirect** — any URL change must be paired with `urlRedirectCreate` or refused. Unpaired handle changes are HIGH risk and permanently human-gated (FR-11.2).

**The theme-write restriction.** The legacy Asset API has been restricted since Admin API 2023-04: theme writes for public apps require `write_themes` **plus a protected-scope exemption**, for which "apps providing search engine optimization" is an explicitly named qualifying category (Google-form request, ~2-week review) [49]. Shopify has been auditing and revoking unused theme-access grants through 2026 — assume this surface keeps tightening [49]. Design decision: **theme writes stay out of the core loop.** Metafields + `seo` fields + `urlRedirectCreate` + a theme app extension (app-embed block, the sanctioned no-exemption mechanism) for JSON-LD cover ~90% of actions; `themeFilesUpsert` with an exemption is reserved for rare structural fixes, always preceded by a duplicate-theme staged preview (Doc 04's validation ladder). Additionally, `read_orders` (used post-MVP for order-truth conversion cross-checks via `CustomerJourneySummary`) is **protected customer data** requiring Shopify app review [53].

**Rate limits.** Cost-based, not request-based: a **1,000-point bucket restoring at 50 points/second** (Shopify Plus: 2,000 / 100/s); any single query ≤1,000 points; mutations cost ~10 points, so sustained throughput is ~5 mutations/second — bulk SEO rewrites across thousands of products are paced or routed through `bulkOperationRunMutation` [51].

**Latency and freshness.** Field mutations (`productUpdate`, metafield writes, `urlRedirectCreate`) are synchronous and take effect on the storefront within seconds. Two operations are explicitly **asynchronous** and must be polled rather than assumed complete: `fileUpdate` returns while the replaced image is still `PROCESSING` [52], and `themeFilesUpsert` returns a job [50]. Both are modelled as pending states in the change ledger, and no change is marked applied until the resource reports ready and a storefront re-read confirms it. As on every channel, the evaluation clock still starts at verified recrawl (§2.2), not at write time.

**Cost.** Free (API).

**How the Platform uses it.** One write sequence per change type, every one of them read-before-write — mandatory here rather than merely good practice, because of the `seo` nulling behaviour above:

| Change type | Write sequence |
|---|---|
| Product SEO title / description | query `product { seo { title description } }` → `productUpdate` echoing **both** `seo` fields even when only one changes [45][47] |
| Page / collection / blog / article SEO title + description | read then write `global.title_tag` / `global.description_tag` metafields (`single_line_text_field`) [46] |
| Per-resource noindex | metafield `seo.hidden = 1` [46] |
| Handle change (URL change) | refused unless paired in the same ledger batch with `urlRedirectCreate` for the old path [48]; unpaired handle changes are HIGH risk and permanently human-gated (FR-11.2) |
| Image alt text / same-URL image replacement | `fileUpdate` — alt inline, binary via `originalSource`, then poll to `ready` [52] |
| JSON-LD | theme app extension (app-embed block), not a theme-file write |

**Batching and ordering.** Mutations are paced against the point bucket at ~5/second; anything above a few hundred products is routed through `bulkOperationRunMutation` [51], which the Platform treats as one ledger batch with one receipt. Ordering is load-bearing on this channel in a way it is not elsewhere: within a batch, **redirect creation precedes the handle change that needs it**, and metafield writes precede any publish step, so that no intermediate state is ever live where a URL has moved without its 301. Rollback is ledger-driven inverse writes (D-21) — there is no Shopify-side revision history to restore from — which is the second reason the `before` read is not optional.

---

## 7. Deploy hosts and the custom-site edge channel

Two related surfaces sit here. **§7.1–7.2** cover the deploy hosts that make the git channel's Validate and Rollback stages real (FR-12.1, FR-14.2): every generated change is validated against a **rendered preview URL** before production, and production can be repointed to a prior deployment in seconds. **§7.3** covers the fourth change-application channel — edge-worker injection for custom sites (FR-9.4), the adapter that reaches sites with no git repo, no supported CMS, and no Shopify store.

### 7.1 Vercel

- **Preview deployments:** `POST /v13/deployments` with `gitSource: {type, org, repo, ref}` builds a branch and returns a unique preview URL; states `QUEUED → INITIALIZING → BUILDING → READY|ERROR`; `skipAutoDetectionConfirmation=1` suppresses framework-mismatch 400s in automation [54]. Deployment Protection can gate preview URLs; a protection-bypass API lets the validator fetch protected previews [55].
- **Limits that size the pipeline** [55]: deployments/day **100 (Hobby) / 6,000 (Pro) / 24,000 (Enterprise)**; per-hour 100/450/1,800; build time cap **45 minutes**; build CPU billed from $0.0035/CPU-min on Pro. A customer on Hobby caps the Platform at ~100 validation deploys/day for that site — validation batching and plan-tier guidance are product requirements.
- **Instant Rollback:** repoints production domains to a previously aliased deployment at the routing layer — no rebuild, effective in seconds; Pro/Enterprise can roll back to any prior production deployment, Hobby only the immediately previous one [56]. The API endpoint (`POST /v9/projects/{projectId}/rollback/{deploymentId}`) is functional but **absent from the public REST reference°** — it is documented only in community write-ups [57], so the Platform treats it as semi-documented: wrapped behind an adapter, health-checked at onboarding, and always paired with the git-revert PR as the guaranteed fallback. Three operational traps are modeled as state, not hoped away [56]: env-var changes are not applied to the rolled-back build; cron jobs revert to the old deployment's state; and **after a rollback Vercel disables auto-assignment of production domains** until a promote "undoes" it — otherwise the customer's next push silently never ships.
- **Auth and scoping.** Requests carry a bearer access token (`Authorization: Bearer vcp_…`). Vercel offers three scope levels — **Full Account** (the user's personal account and every team they belong to), **Team** (one team, all its projects), and **Project** (a single project within a team) — chosen at creation, alongside a mandatory expiry; the value is shown once [92]. **The Platform requires a project-scoped token per customer site.** A project-scoped token denies any request to another project, to a team-level resource, or to a user-level resource, which is what bounds the blast radius of a token that holds production-deploy and production-rollback power over a live site (NFR-5). Two properties make this operationally clean: team- and project-scoped tokens infer the team from the token, so no `teamId` parameter can accidentally widen the target; and a project-scoped token **cannot mint further tokens** — only a full-account token can, so the Platform never stores one. Tokens are held per-tenant under KMS envelope encryption (D-32) and re-requested at expiry as part of onboarding health checks. Where a customer's team enforces 2FA or SAML before token creation, that is surfaced at onboarding as a prerequisite, not discovered at first deploy.

### 7.2 Netlify

- Automatic Deploy Previews per PR at `deploy-preview-<PR>--<site>.netlify.app` [59]; API deploys via file digest (upload only changed hashes) or ZIP (≤25,000 files); `draft: true` builds without touching the live site — a clean validation target [58].
- Limits: **500 API requests/minute; 3 deploys/minute; 100 API deploys/day** [58].
- Rollback: `POST /api/v1/sites/{site_id}/deploys/{deploy_id}/restore` republishes a prior immutable deploy as current — instant and fully documented [58].
- **Auth and scoping — the weaker of the two models, and it constrains the product.** Netlify offers personal access tokens (`Authorization: Bearer …`) and OAuth applications [58]. A **PAT reaches every site and resource the issuing user can access and cannot be scoped to one site** — there is no project-scoped equivalent to Vercel's. Expiry is mandatory at creation and the value is shown once; a password reset silently invalidates every PAT and OAuth token issued before it, which is a real support-load source and is health-checked rather than discovered on a failed deploy. Consequences the Platform accepts deliberately: (a) it asks the customer to create a **dedicated Netlify user** holding only the sites under management, so the un-scopable token is bounded by the *account* instead — the same pattern as the WordPress Editor-role user (§5); (b) it enforces a **server-side site allowlist**, refusing any call whose `site_id` is not the one the tenant connected, exactly as it does for GSC properties (§2.5) — with an account-wide token, isolation is the Platform's job, not Netlify's; and (c) for public/marketplace distribution, the **OAuth app** flow replaces the PAT so credentials are user-authorized rather than shared. Tokens are stored per-tenant under KMS envelope encryption (D-32).

**How the Platform uses both.** The preview URL is the unit of validation: meta-tag diff assertions, HTML validation, self-built JSON-LD checks, Lighthouse budgets, and link checks all run against the rendered preview, and results post back as GitHub Checks (Section 4). Rollback is two-speed: host-level instant rollback for emergencies (seconds), git revert PR for durable reversal (minutes). For customers on neither host, the Platform provides its own sandboxed build-and-serve preview stage — scope acknowledged in Doc 07.

### 7.3 Custom sites — the edge-worker channel (FR-9.4)

The fourth change-application adapter (D-17d), and the only one that reaches a site with no git repo, no supported CMS, and no Shopify store. It is also the only channel where the Platform enters the customer's **serving path**, which changes its risk profile more than its API surface does.

**Mechanism.** A CDN worker rewrites HTML in flight between origin and user. Cloudflare's **HTMLRewriter** is the reference implementation: a streaming, zero-copy HTML parser with CSS-selector handlers (`on('title')`, `on('meta[name=description]')`, `on('head')`) supporting `setInnerContent`, `setAttribute`, `append`/`prepend` and `remove`, with async handlers [93]. That covers titles, meta descriptions, canonicals, robots meta, hreflang, JSON-LD injection, `alt` attributes, internal-link insertion, and — at the worker level — redirects and response headers, with **zero changes to origin code**. Commercial precedent exists: SearchPilot runs this architecture for enterprise SEO A/B testing, with automatic fall-back to transparent-proxy mode on application error [95] — a failsafe the Platform copies rather than reinvents.

**External API surface and auth.** Unlike §7.1–7.2, this channel depends on two distinct customer-side surfaces:

| Surface | What the Platform needs it for | Auth |
|---|---|---|
| Edge platform deploy/config API (Cloudflare Workers, or Workers for Platforms) | upload and version the worker script, bind it to routes, enable/disable a rule | Customer-issued API token, **scoped to Workers Scripts edit + the specific zone** — never a Global API Key; the same least-privilege posture as §7.1 (NFR-5) |
| DNS / proxy mode | traffic must actually traverse the worker: the zone must be proxied (orange-cloud) or, in the managed-proxy model, DNS must point at the Platform | Customer-controlled; a change the Platform requests and verifies, never makes silently |

Three onboarding models, in ascending order of friction and trust: **(a)** the customer is already on Cloudflare and installs the Platform's worker on their own account — the default and the only model in scope at MVP; **(b)** DNS is repointed through a Platform-managed proxy — highest trust bar, enterprise-only; **(c)** the customer runs a different CDN (Fastly, Akamai, CloudFront) and needs a per-CDN worker build — out of scope until demand justifies it.

**Quotas and cost.** Cloudflare Workers free tier: **100,000 requests/day and 10 ms CPU per invocation**; the paid plan removes the daily request cap and raises CPU to 30 s (configurable to 5 min), 128 MB memory, and 10,000 subrequests [94]. An HTMLRewriter pass over a full page is typically sub-millisecond of CPU, so even the free tier carries small sites; the binding constraint is the customer's request volume, not the rewrite. Cost sits on the customer's Cloudflare account, which is deliberate — the Platform does not resell edge capacity.

**Two constraints that shape the design, and one of them is a business decision, not a technical one:**

1. **The Platform becomes an availability dependency.** Sitting in the serving path means a Platform outage is a *customer site* outage, not a paused pipeline. This is a categorically different exposure from every other channel in this document, and it is why the channel ships **after** the API adapters, with transparent-proxy failover from day one, an explicit SLA, and a security review before any enterprise deal. §12 records it as a channel-fatal dependency with an availability tail the others do not have.
2. **The cloaking line.** Edge rewrites are indistinguishable from origin HTML to Googlebot — no rendering caveats apply, which is the channel's main advantage over client-side JS injection. But rewrites **must be applied uniformly to every user agent**: serving different HTML to search engines than to users is cloaking and risks a manual action. The worker therefore has no UA branch at all, and the validation stage asserts byte-identical rewrites across a Googlebot UA and a browser UA before any rule goes live.

**Rollback.** The fastest of any channel: disabling a rule takes effect in seconds and needs no rebuild or recrawl. That makes the edge adapter attractive as an *instant-apply and instant-revert* lever even for sites that also have a git or CMS channel — but the change ledger remains the source of truth (D-14/D-21), and a rule is never the only record of a change.

**Client-side JS injection is explicitly rejected as a paid tier.** Google supports JS-set titles, meta descriptions and JSON-LD at render time, and warns against JS-set canonicals that differ from the raw HTML [96]. It is second-class regardless: render-delay, a noindex blind spot, and non-Google crawlers that never execute it. Offered as a trial/demo mode only.

---

## 8. Third-party SERP and keyword data — DataForSEO + Serper

Serves FR-5.1 (keyword discovery beyond GSC's anonymization gap), FR-7.1 (competitor identity and SERP features), and the SERP-feature multipliers in the opportunity score. Decision: **DataForSEO primary, Serper secondary**, both behind a mandatory multi-vendor `SerpProvider` abstraction; Semrush/Ahrefs APIs skipped; Google Keyword Planner rejected as a foundation.

### 8.1 DataForSEO (primary)

Pay-as-you-go, $50 minimum deposit. Verified pricing (Aug 2026):

| Product | Price | Notes |
|---|---|---|
| SERP API (Advanced parse) | **$0.60/1k** standard queue (~5 min) · $1.20/1k priority · $2.00/1k live (~6 s) | one "SERP" = 10 results; AI Overview capture +$0.0006/keyword [60] |
| People-Also-Ask depth | +$0.00015/click (depth 1–4), auto-refunded if absent [64] | question mining for content gaps |
| Keywords Data (Google Ads volume) | **$0.06/request standard** ($0.09 live) for up to 1,000 keywords ≈ $0.06/1k keywords [61] | the commercial replacement for gated Keyword Planner |
| Labs (intent, ideas, competitor domains) | $0.012/task + $0.00012/item; `search_intent` classifies 1,000 keywords/call [63] | intent gate for the competitor filter |
| OnPage Instant Pages / Content Parsing | $0.000125/page base · $0.00125 JS-rendered · $0.00425 full browser + Core Web Vitals (CWV); 20 URLs/request, cross-domain [62] | tier 1–2 of the competitor fetch ladder |

**Hard quotas** [97]: **2,000 API calls/minute** per account, and **≤100 tasks per POST call** — tasks beyond the hundredth in a single array are rejected with error `40006` rather than silently dropped. Per-endpoint ceilings are additionally returned on every response in the `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers, so the adapter reads its live budget rather than assuming one. Per-request task caps differ by product and are the practical batching unit: 1,000 keywords per Keywords Data request [61], 1,000 keywords per Labs `search_intent` call [63], 20 URLs per OnPage request [62].

**Latency.** Queue-dependent by design: standard queue ~5 minutes, priority ~1–2 minutes, Live ~6 seconds at 3.3× the standard price. Scheduled jobs never use Live.

**Commercial terms.** Pay-as-you-go from a $50 minimum deposit; **credits never expire** [60] — the opposite of Serper's 6-month expiry (§8.2), and a real procurement input when sizing a prepaid balance against uneven monthly usage.

One account covers SERPs, volumes, intent, and competitor-page parsing — a full competitor analysis lands at ~$0.02–0.05 per keyword, and daily rank tracking for a medium site at ~$18–54/month on the standard queue.

### 8.2 Serper (secondary / failover)

Google-only and fastest (1–2 s), on prepaid credits with **2,500 free** to start [65].

**Pricing.** This document uses the volume ladder **$50/50k ($1.00/1k) → $375/500k ($0.75/1k) → $1,250/2.5M ($0.50/1k)** [65][66], i.e. **$0.50/1k at the 2.5M-query tier** — the figure the Platform's own budgets assume, since failover volume sits at the low end of that ladder, not the top. A conflicting floor of **$0.30/1k°** circulates for the largest prepaid packs (up to $3,750) [66]; it is a third-party pricing tracker rather than a Serper price list, applies only at volumes well beyond the failover role, and is deliberately not used in any cost figure here. Both figures come from secondary sources — Serper does not publish a rate card at a stable URL — so treat the ladder as the planning basis and confirm at contract time.

**Commercial terms.** Prepaid credits **expire after 6 months** [66] — contrast DataForSEO, whose credits never expire (§8.1). The asymmetry is the reason Serper is bought in small top-ups sized to expected failover volume rather than in a large discounted pack that would likely expire unused.

**Rate limits.** **Not published by the vendor.** Serper documents neither a QPS ceiling nor a concurrency limit on its site or API pages; the only quantitative claims are 2,500 free credits and 1–2 s latency [65]. The adapter therefore treats throughput as unknown: it starts conservatively, backs off on 429, and the real ceiling is **measured during the POC** and recorded per account rather than assumed. This is a genuine gap in vendor documentation, not an omission in this research.

**Surface.** Endpoints include search, news, shopping, and **autocomplete** (cheap keyword-suggestion mining). No keyword database and no page fetching — it is the low-latency live-SERP lever and the failover vendor, nothing more.

### 8.3 Rejected options (and why)

- **SerpApi**: $25/1k down to ~$9.17/1k° — 10–25× Serper's price, and ~15–42× DataForSEO's standard queue — and now the named defendant in both active scraping suits [66][67]. (Pricing via a third-party comparison tracker; the *order of magnitude*, which is what the decision rests on, is not in doubt.)
- **Semrush API**: requires the $549/mo° Advanced plan plus separately purchased units, and its ToS caps cached API data at **1 month without written consent** — hostile to a warehouse-first platform [71]. (Both figures from a third-party pricing write-up rather than Semrush's own developer docs; the disqualifying constraint is the caching clause, which no pricing revision would change.)
- **Ahrefs API v3**: plan-bundled unit budgets (Lite $129/mo ≈ 100k units) with per-row × per-field costs that make programmatic scale expensive; resale terms need an Enterprise conversation [72].
- **Google Keyword Planner (Ads API)**: keyword-planning services are blocked at the auto-granted Explorer tier; Basic access needs an application and a manager account; without active ad spend, volumes come back as bucketed ranges; permissible-use policy is written for ads tooling — unusable as a SaaS dependency [73][74].

### 8.4 ToS and legal posture

Every SERP feed on the market is scraped: Google offers no official SERP API, and Microsoft retired the Bing Search APIs on August 11, 2025 (the Azure-locked replacement is reported 40–483% more expensive) [70]. The current landscape: Google deployed anti-bot defenses ("SearchGuard", Jan 2025) and sued SerpApi on December 19, 2025 under DMCA §1201 [67]; in 2026 the court dismissed Google's **copyright** claims (plain search results are "not works protected under the Copyright Act") while leaving non-copyright theories open [68]; Reddit's parallel suit against SerpApi/Oxylabs largely **survived a motion to dismiss on July 31, 2026** [69]. The Platform's posture, set accordingly: buy SERP data from providers rather than scraping in-house (the provider absorbs ToS/anti-bot risk and provides a contract surface); keep per-keyword SERP frequency low (weekly/monthly, event-triggered); lean on GSC — first-party and fully legal — for all rank/impression time series so SERPs are needed only for competitor identity and SERP features; never use customer Google credentials for anything SERP-shaped; and keep two vendors wired so a provider becoming unavailable inside a quarter is a config change, not an outage. Doc 06 carries the corresponding risk entry.

### 8.5 How the Platform uses them

These are **read-only** APIs — nothing here writes to a customer site, so unlike §4–§7 there is no ordering constraint against the change ledger. What there is instead is a spend and freshness discipline, since every call costs money and none of it is first-party data.

| Job | Vendor + endpoint | Cadence | Batching |
|---|---|---|---|
| Keyword universe / volumes | DataForSEO Keywords Data (standard) | onboarding, then monthly | 1,000 keywords per request [61] |
| Intent classification | DataForSEO Labs `search_intent` | once per new keyword, cached indefinitely | 1,000 keywords per call [63] |
| SERP snapshot + SERP features | DataForSEO SERP Advanced (standard queue) | weekly for tracked head terms, monthly for the tail, plus event-triggered on a decay alert | ≤100 tasks per POST [97], task-post then poll |
| Competitor page parsing | DataForSEO OnPage, escalating basic → JS-rendered → full browser | once per competitor page per analysis, re-fetched only on content-hash change | 20 URLs per request [62] |
| Low-latency spot check / failover | Serper search + autocomplete | interactive UI paths only, and whenever DataForSEO is degraded | single queries; no bulk path |

**Ordering and provider selection.** Every call goes through the `SerpProvider` abstraction, never a vendor SDK directly, so failover is a config change (D-24). Selection is by *latency requirement*, not by preference: scheduled work always takes DataForSEO's standard queue, and Serper is reached for only when a human is waiting or the primary is failing. Results are warehoused with the vendor and fetch timestamp attached, because a SERP is a point-in-time observation and two vendors' snapshots are never mixed inside one comparison — the same rule that governs GA4 API-vs-BigQuery totals (§3).

**Spend control.** Per-tenant budgets are enforced before the call, not reconciled after it (NFR-6): the scheduler prices a batch from the table above and refuses to exceed the tenant's monthly SERP allocation, degrading to a longer refresh interval rather than overspending. Because DataForSEO credits never expire and Serper's expire in six months (§8.1–8.2), prepaid balances are held mostly with the primary.

---

## 9. Bing Webmaster Tools, IndexNow, and the other change-notification levers

Free bolt-ons: corroboration data and non-Google index pings. Neither is in the MVP data path (FR-5.1 lists Bing as a source; deferred per Doc 01 §6).

**Bing Webmaster Tools API.** Auth is a per-account API key generated in the BWT dashboard [75]. Useful read endpoints: `GetQueryStats` (per-query clicks/impressions/position — one aggregate row per query over the **last ~6 months, updated weekly**), `GetQueryPageStats`, `GetRankAndTrafficStats`, and `GetKeywordStats` — historical weekly impressions for arbitrary keywords, effectively a free mini keyword-research API [77]. URL submission: `SubmitUrlBatch`, max **500 URLs/call**, site-dependent daily quota (commonly ~10k/day, discoverable via `GetUrlSubmissionQuota`) [76]. Weekly granularity and 6-month retention make Bing a secondary corroboration source, never a primary time series [77].

**IndexNow.** Open push protocol: host a key file at the site root, then `POST https://api.indexnow.org/indexnow` with up to **10,000 URLs per call**; one submission fans out to Bing, Yandex, Naver, Seznam.cz, Yep, and Amazon [78] — a roster that changes, so it is re-verified against indexnow.org/faq at contract time. Free, no meaningful rate limits at normal usage; engines score submission quality, so the Platform pings only genuinely changed URLs. **Google does not support IndexNow** (still true in 2026) [79] — for Google, the levers remain sitemaps (lastmod), organic recrawl, and URL Inspection (which reports but does not request indexing). Platform use: a fire-and-forget ping after every deployed change — zero cost, zero risk, immediate for the Bing family.

### 9.1 Rejected: the Google Indexing API

The obvious question, dismissed explicitly so it does not have to be asked twice. Google *does* publish an Indexing API that requests immediate (re)crawl of a URL — but it is **restricted to pages carrying `JobPosting` or `BroadcastEvent` structured data**, with a 200-publish/day default quota, and Google states plainly that other page types are out of scope [98]. Submitting general content pages through it is a policy violation, not a growth hack, and the API's own documentation says so. **Skipped entirely.** The consequence is worth stating rather than hiding: for Google there is *no* API that requests indexing of an ordinary page — sitemaps with accurate `lastmod` (§2.3), organic recrawl, and internal-link freshness are the only levers, and this is exactly why the evaluation clock starts at verified recrawl rather than at deploy (§2.2, D-15).

### 9.2 Optional post-MVP: the server-log connector

Named in D-23 as an optional connector and worth a line here because it solves a real quota problem. A **verified Googlebot GET of a changed URL is a direct, quota-free `recrawl_verified_at` trigger** — faster and cheaper than spending the 2,000/day URL Inspection budget (§2.2) to ask the same question, and verified against Google's published crawler IP list rather than trusting the user-agent string [99]. Logs also complete the orphan-detection union (sitemap ∪ GSC ∪ analytics ∪ logs).

It is an *optional* connector, never a dependency, because access is gated by the customer's hosting stack and the gates are steep:

| Stack | Mechanism | Availability and cost |
|---|---|---|
| Vercel | Drains (runtime/build/static request logs → an HTTPS endpoint) | **Pro or Enterprise plan**, billed **$0.50/GB** of uncompressed JSON [100] |
| Cloudflare | Logpush (HTTP requests dataset) | **Enterprise plan only** [101] — excludes most SMB tenants |
| AWS CloudFront | Standard logs (v2: S3 / CloudWatch / Firehose) | No CloudFront charge, S3 storage only; delivery is explicitly **best-effort** — entries can be late or missing [102] |
| Nginx / Apache (self-hosted WP) | Access logs via agent or rsync | Free; per-customer setup variance is high |

Budget note: a 1M-request/day site is roughly 1–3 GB/day of uncompressed JSON ≈ $15–45/month on Vercel Drains, which is why the drain endpoint filters to verified-bot and first-hit-per-URL events before storage — a >95% volume reduction. Because CloudFront delivery is best-effort and plan gates exclude most SMB tenants, logs may inform orphan detection and accelerate recrawl verification but must **never** be the sole evidence for deleting or redirecting a "dead" page. Everything degrades gracefully to URL Inspection if the connector is absent.

---

## 10. AI providers — Anthropic, OpenAI, Google

The Optimize stage (FR-4.1–4.4). The architecture is provider-plural by design: one operation schema, thin provider adapters, Anthropic primary with OpenAI and Gemini as fallback and price levers. Three provider capabilities are load-bearing; all three vendors now ship all three.

### 10.1 Structured output — the FR-4.4 enforcement mechanism

| Provider | Mechanism | Guarantee |
|---|---|---|
| Anthropic | `output_config: {format: {type: "json_schema"}}` / `messages.parse()`; strict tool use (`strict: true`) | schema-valid output via constrained decoding; 24-hour schema cache (keep ONE stable op schema platform-wide); no `minLength`/`maxLength` or recursive schemas — length constraints validate client-side [81] |
| OpenAI | `response_format: {type: "json_schema", strict: true}` | invalid tokens masked at decode time; a non-conforming response cannot be produced [86] |
| Google | `responseSchema` | token-level constrained decoding; Google explicitly advises layering semantic validation downstream [88] |

Schema enforcement solves *syntax*, not semantics: pixel width, keyword coverage, no-new-facts, and URL allowlists are code-level validators with one error-fed re-ask (95%+ of failures fix on the first retry) — the validator layer of Doc 03. Refusals (`stop_reason: "refusal"`) bypass the schema and are handled as first-class outcomes before parsing [81].

### 10.2 Batch APIs and prompt caching — the cost architecture

- **Batch: a uniform 50% discount at all three vendors** [82][85][87]. Anthropic's mechanics: up to 100,000 requests or 256 MB per batch; most batches complete within 1 hour, 24-hour maximum [82]. Because the loop is a nightly scheduled job, essentially all generation is batched; the orchestration layer tolerates up-to-24h batch latency, with live calls reserved for interactive UI paths.
- **Prompt caching: cached input reads at ~0.1× list price** (Anthropic writes 1.25× for 5-min TTL; Gemini adds ~$1.00/1M-tokens/hour cache storage) [83][87]. The context pack is cache-ordered: byte-stable system contract + brand + site blocks first, volatile per-page blocks last. One trap engineered around: Anthropic's minimum cacheable prefix is 512 tokens on Opus 5 and 1024 on Sonnet 5 but **4096 on Haiku 4.5** — a short site preamble silently fails to cache on exactly the high-volume tier, so the context pack is built as a **>4K stable cached prefix (system contract + brand + site blocks) plus 2–4K volatile per-page blocks**, which keeps the Haiku minimum and the pack budget consistent and is the same call shape §10.3 prices [83].
- **Rate limits.** All three vendors tier limits by cumulative spend, and the binding constraint for this Platform is the *batch* ceiling rather than the interactive one — but the numbers differ sharply in how well they are published, and that difference is itself a planning input.

**Anthropic (primary) — fully published** [103]. Interactive limits are per model class, per organization tier:

| Tier | RPM | Input tokens/min (ITPM) | Output tokens/min (OTPM) |
|---|---|---|---|
| Start | 1,000 | 2,000,000 | 400,000 |
| Build | 5,000 | 5,000,000 | 1,000,000 |
| Scale | 10,000 | 10,000,000 | 2,000,000 |

*(Figures for Claude Opus 5 / Sonnet 5 / Haiku 4.5, which share the same ceilings at each tier; Custom tier is negotiated. Start/Build/Scale carry monthly spend caps of $500 / $1,000 / $200,000.)* One property matters more than the raw numbers for a cache-ordered design: **cached input tokens do not count toward ITPM** on these models — only uncached input plus cache writes do — so the context-pack ordering in the previous bullet raises effective throughput as well as lowering cost.

Batch limits are shared across models and are the ones that actually bind here [103]:

| Tier | Batch RPM | Max batch requests in the processing queue | Max requests per batch |
|---|---|---|---|
| Start | 1,000 | 200,000 | 100,000 |
| Build | 2,000 | 300,000 | 100,000 |
| Scale | 4,000 | 500,000 | 100,000 |

Plus the per-batch payload cap of **256 MB** and the ≤24 h turnaround already noted [82]. A 10,000-page nightly pass is 10,000 batch requests — 5% of the Start-tier queue — so batch capacity is not a scaling constraint until roughly 20 concurrent 10k-page tenants on the lowest tier.

**OpenAI and Google — per-tier numbers are not published.** This is a documentation gap at the vendor, stated rather than papered over:

- **OpenAI** publishes the tier *qualification* thresholds and monthly spend caps (Free through Tier 5, $100/month up to $200,000/month) but not the RPM/TPM values, directing callers to the limits page in their own account settings and the per-model summary [104]. For Batch, it documents only the *mechanism* — queue limits are computed on the **total input tokens queued for a given model** — with no published per-model figure.
- **Google (Gemini)** likewise states that per-model RPM/TPM/RPD "can be viewed in Google AI Studio" rather than publishing them [105]. It *does* publish the batch-side limits that matter for a nightly job: **100 concurrent batch requests**, a **2 GB** maximum input file, **20 GB** of file storage, with enqueued-tokens-per-model varying by tier. Two further published facts affect planning: spend-based rate limits apply on a rolling 10-minute window ($10 at Tier 1, $200 at Tiers 2–3), and Priority Inference defaults to **0.3× the standard rate limit** for each model and tier.

**Consequence for the design.** Only Anthropic's ceilings can be capacity-planned from documentation; OpenAI's and Gemini's must be **read from the account console at onboarding and re-measured during the POC**, then recorded per environment. That asymmetry is one more reason Anthropic is primary and the other two are fallback/price levers rather than co-equal load-bearing paths — a fallback whose ceiling you cannot look up is fine; a primary whose ceiling you cannot look up is not. Per-tenant token metering with hard cutoffs (NFR-6) bounds runaway-loop spend on our side regardless of vendor.

### 10.3 Model lineup and pricing (list, per 1M tokens, verified Aug 2026)

| Tier | Anthropic [80][84] | OpenAI [85] | Google [87] |
|---|---|---|---|
| Frontier / judge | Claude Opus 5 — $5 / $25 (1M ctx) | gpt-5.6-sol — $5 / $30 | Gemini 3.1 Pro (preview) — $2 / $12 (≤200K ctx) |
| Workhorse | Claude Sonnet 5 — $3 / $15 (intro $2 / $10 through 2026-08-31; 1M ctx) | gpt-5.6-terra — $2 / $12 | Gemini 3.6 Flash — $1.50 / $7.50 |
| Bulk | Claude Haiku 4.5 — $1 / $5 (200K ctx) | gpt-5-mini — $0.25 / $2 · gpt-5-nano — $0.05 / $0.40 | Gemini 3.5 Flash-Lite — $0.30 / $2.50 |
| Batch | −50% | −50% | −50% |
| Cached input | ~0.1× | ~0.1× | ~0.1× (+cache storage/hr) |

Embeddings are cost-invisible: `text-embedding-3-small` at $0.02/1M tokens ($0.01 batched)° [89]; Voyage `voyage-4-lite` at $0.02/1M with 200M free tokens [90]. A 100k-page site embeds for ~$4. (The OpenAI embedding figure is from a third-party pricing tracker rather than OpenAI's own rate card; at ~$4 per 100k pages, no plausible revision changes a decision.) Model churn is a real operational line: Gemini 2.5 Flash-Lite ($0.10/$0.40), used in the competitor lane's per-page pass, is reported to retire **October 16, 2026°** with a pricier successor [91] — a secondary source, and the *only* dated commitment in this document taken from one, so the retirement date is re-checked against Google's own deprecation notices before it is relied on. Model IDs are pinned per analysis run and reviewed quarterly regardless, alongside the Sonnet 5 intro-pricing expiry (2026-08-31; all budgets in this package use standard $3/$15).

**How the Platform uses them (the tiering that sets the cost envelope).** Tier 0 is deterministic code — most technical SEO fixes never touch a model. Haiku-class handles bulk fields (alt text, meta descriptions), Sonnet-class handles judgment work (titles, headings, FAQs, link anchors), Opus-class is reserved for cross-model judging and escalations. Worked anchor: a full 10,000-page metadata pass at 3K input / 500 output tokens per page — the 2–4K volatile per-page blocks plus the ~0.1× effective read of the >4K cached prefix (§10.2) — costs **$27.50 on Haiku batch or $82.50 on Sonnet batch**, plus ~$5.60 of selective Opus judging — **$33.10–$88.10 all-in**, which is the figure quoted in the executive summary. *Register note:* DECISIONS D-10 records this pass as "≈$30–85", which is the generation-only range before judging is added; the two are reconciled here rather than silently deviated from — use $33–$88 when judging is included, $27.50–$82.50 when it is not, and never $30–85 for the all-in number. A deeper full-page analysis pass — a separate workload at 5K input / 0.8K output per page — runs **$4.50 (Haiku) to $13.50 (Sonnet) per 1,000 pages analyzed** on the same batch pricing. Incremental nightly cycles touch only the 1–5% of pages that changed. Security posture (Doc 06): models reading crawled or competitor content get no tools and no credentials, and emit only closed-vocabulary schema output — an injected page can at worst produce a bad field value that must still survive deterministic validation.

---

## 11. Consolidated reference table

Criticality legend: **Hard** = a loop stage stops platform-wide without it · **Hard (per-site)** = a loop stage stops for the sites that depend on it · **Channel** = one site-platform channel stops · **Degradable** = quality degrades, loop continues · **Optional** = additive signal only. "°" marks a figure from a secondary source (see the Sources list).

| API | Auth | Key quota / limit | Cost | Criticality |
|---|---|---|---|---|
| GSC Search Analytics [1][2] | OAuth `webmasters.readonly` (sensitive scope) or SA invite | 1,200 QPM/site; ~50k° rows/day/search type; 16-mo° retention | Free | **Hard** — Identify, Monitor, Measure |
| GSC URL Inspection [1][7] | same | **2,000/day/property**; 600 QPM | Free | Degradable — sampled verification |
| GSC Sitemaps [9] | OAuth `webmasters` (read-write) | 20 QPS / 200 QPM | Free | Degradable |
| GSC BigQuery export [10][11] | customer GCP grant | no row cap; UI-only enable; no backfill | customer-paid BQ | Optional (enterprise) |
| GA4 Data + Admin API [18][23] | OAuth `analytics.readonly` or SA Viewer | 200k tokens/property/day; 10 concurrent | Free | Optional — veto-only signal (post-MVP) |
| GitHub (App) [28][29][30] | GitHub App, 1-h installation tokens, per-run single-repo down-scope | 12,500 req/h/installation; **80 content-writes/min, 500/h** | Free | **Hard** (code channel) |
| WordPress REST [37][38] | Application Password on a dedicated **Editor-role user** (not scope-limited — the user *is* the scope) | none core; ~5–10 rps practical (host WAFs); `/batch/v1` ≤25 sub-requests | Free | Channel (WP) |
| Shopify Admin GraphQL [45][51] | custom-app token per store, or public OAuth app | 1,000-pt bucket @ 50 pts/s; mutation ≈10 pts (~5 mutations/s) | Free | Channel (Shopify, post-MVP) |
| Vercel [54][55][56][92] | Bearer access token — **Project-scoped** required (Full Account / Team / Project available); mandatory expiry | 100–24,000 deploys/day by plan; 100/450/1,800 per hour; 45-min build cap | build CPU $0.0035/min (Pro) | **Hard (per-site)** — Validate/Rollback on Vercel-hosted sites; the label scopes a *transient* loss of a rollback lane the site normally has (deploys freeze, §12), not hosts that never had one (git-revert-only, Doc 03 §5.3) |
| Netlify [58] | PAT (**account-wide — cannot be scoped to one site**; mandatory expiry) or OAuth app | 500 req/min; 3 deploys/min; **100 API deploys/day** | plan-based | **Hard (per-site)** — same, Netlify-hosted sites, with the same transient-vs-structural scoping |
| Edge worker / custom sites [93][94][95] | Cloudflare API token scoped to Workers-edit + the zone; **plus** proxied DNS | free tier 100k req/day + 10 ms CPU; paid: uncapped requests, 30 s CPU, 128 MB, 10k subrequests | customer's Cloudflare account | Channel (custom sites, post-MVP) — **and the Platform is in the serving path** |
| DataForSEO [60][61][97] | PAYG account credentials (HTTP Basic) | **2,000 API calls/min; ≤100 tasks per POST**; per-endpoint ceiling in `X-RateLimit-Limit` | $0.60/1k SERPs; $0.06/1k keyword volumes; **credits never expire** | Degradable |
| Serper [65][66] | API key | **no published rate limit** — measure at POC; prepaid credits, **6-mo expiry** | $0.50–1.00/1k (a $0.30/1k° floor is reported at the largest packs) | Degradable (failover vendor) |
| Bing Webmaster [75][76] | API key | 500 URLs/`SubmitUrlBatch`; weekly data, 6-mo window | Free | Optional |
| IndexNow [78] | site key file | 10,000 URLs/call | Free | Optional |
| Server-log connector [99][100][101][102] | per-host: Vercel Drains (Pro+), Cloudflare Logpush (Enterprise), CloudFront→S3, or agent | plan-gated per host; CloudFront delivery best-effort | Vercel $0.50/GB; others ~storage only | Optional (post-MVP) — quota-free recrawl signal |
| Anthropic [80][82][103] | API key | **batch queue 200k–500k requests by tier; ≤100k requests / 256 MB per batch; ≤24 h**; interactive 1,000–10,000 RPM, 2M–10M ITPM, 400k–2M OTPM | Haiku $1/$5 · Sonnet $3/$15 · Opus $5/$25 /MTok; batch −50% | **Hard** — Optimize (mitigated by fallback) |
| OpenAI [85][104] | API key | **per-tier RPM/TPM not published** (account console only); batch queue sized on total input tokens queued per model | see §10.3; batch −50% | Degradable (fallback provider) |
| Gemini [87][105] | API key | **per-model RPM/TPM/RPD not published** (AI Studio only); batch: 100 concurrent, 2 GB input file, 20 GB storage | see §10.3; batch −50% | Degradable (fallback provider) |
| Embeddings — OpenAI / Voyage [89][90] | API key | no published per-tier limit; batch path available | `text-embedding-3-small` $0.02/1M° ($0.01 batched) · `voyage-4-lite` $0.02/1M, 200M free | Degradable — D-03 runtime dependency (~$4 per 100k pages) |

---

## 12. Single points of failure — which outage stops which loop stage

```
 Loop stage        Primary external dependency          Behavior on outage
 ─────────────────────────────────────────────────────────────────────────────
 Discover        ─ (own crawler; no external API)       unaffected
 Analyze         ─ own rulebook; AI batch (bulk)        Tier-0 rules unaffected
 Identify        ─ GSC Search Analytics ─┐              runs on warehoused data;
 Decide          ─ internal matrix       │              new-day scoring pauses
 Optimize        ─ AI providers ─────────┼─ fallback: Anthropic → OpenAI/Gemini
 Validate        ─ Vercel/Netlify previews + GitHub     git channel blocks;
                   Checks                               CMS LOW-risk unaffected
 Deploy          ─ GitHub PR | WP REST | Shopify API    per-channel pause
                   | edge worker (custom sites)         (edge: note below)
 Monitor         ─ GSC fresh/hourly + URL Inspection    guardrails degrade to
                   (+ GA4 veto, + server logs opt.)     crawl/HTTP signals
 Measure         ─ GSC warehouse (+ GA4 final data)     verdicts FREEZE, never
                                                        guess on missing days
 Re-optimize     ─ (internal, feeds Identify)           follows Identify
```

**GSC is the one irreplaceable dependency.** No substitute exists for first-party impression/position data. The design absorbs outages two ways: the permanent warehouse keeps Identify/Decide running on history, and the pipeline's data-gap detection **freezes KEEP/ROLLBACK verdicts rather than evaluating against missing days** — the June 2025 multi-day GSC data stall is the design precedent; without gap detection it would have mass-triggered false decay alerts and rollbacks. Degradation is therefore "no new verdicts," never "wrong verdicts."

**GitHub down** stops Deploy, Validate, and revert-PR rollback on the code channel. The emergency path survives: Vercel Instant Rollback / Netlify restore act at the hosting layer, independent of GitHub [56][58]. CMS channels are unaffected.

**AI provider down** stops Optimize for generated content; the multi-provider adapter fails over (one op schema, three backends), and Tier-0 deterministic fixes — the bulk of technical SEO — continue unaffected.

**Vercel/Netlify down** blocks preview-based validation, which blocks MEDIUM-risk deploys on the git channel by policy (nothing ships unvalidated, NFR-1). A deliberate second policy follows from rollback dependence: **when a site's instant-rollback path is transiently unavailable, the Platform freezes new deploys to that site** until it is healthy — deploying without a working emergency rollback the site normally has would violate the safety contract. Note this is a *stopped stage for that site*, not graceful degradation, which is why §11 classifies the deploy hosts as **Hard (per-site)** and the executive summary lists them as per-site hard dependencies rather than folding them into "everything else degrades."

**The freeze rule covers case (a) only, and the distinction is load-bearing.** (a) A host rollback API the project normally has goes down ⇒ freeze new deploys to that site until it is healthy. (b) A host that *structurally never had* an instant lane — a git-deployed customer on Amplify, Cloudflare Pages, Render, Fly, or self-hosted Docker — is onboarded **git-revert-only** and keeps deploying, carrying a tightened risk policy instead: HIGH-visibility change types stay a tier higher and batches stay smaller (Doc 03 §5.3). Reading the freeze rule onto case (b) would freeze every non-Vercel/Netlify git customer permanently, which is not the policy.

**Edge channel down — the one asymmetric case.** For custom sites the Platform sits in the serving path, so the failure mode is not a paused pipeline but a customer-facing outage. Three mitigations are load-bearing rather than nice-to-have: transparent-proxy failover (on worker error, pass origin HTML through unmodified, losing the optimizations but not the site) [95]; a disable-rule path that takes effect in seconds and needs no rebuild; and a documented SLA, because this is the only channel where the Platform's availability becomes the customer's availability. A Platform outage that would merely pause a WordPress or Shopify tenant degrades a custom-site tenant's live pages — the reason §7.3 ships after the API adapters, not alongside them.

**DataForSEO/Serper down** degrades opportunity scoring to prior-based expected-CTR curves without SERP-feature multipliers and pauses competitor analysis; the GSC-first design means the core loop does not notice. This degradation is also the planned response if the SERP-provider legal situation (§8.4) makes vendors abruptly expensive or unavailable.

**GA4 down or absent** is a designed non-event: the conversion signal is veto-only, and its absence never blocks a verdict.

Three non-outage failure modes belong in the same register: **Google OAuth verification** is a schedule SPOF (100-user cap until verified; weeks of lead time — started at kickoff) [15]; the **GitHub App private key** is the security SPOF (it mints tokens for every customer installation; isolated in a dedicated token-mint service with KMS custody — Doc 06); and the **manual-action gap** is an open operational dependency — GSC exposes no manual-actions API, so the strongest stop-everything signal arrives by UI or email only. The Platform's mechanism is a tenant-added Platform-owned address as a GSC property user, so Google's notification email is parsed into a site-wide freeze signal, with a weekly operator check of the Manual Actions UI as the backstop; both paths sit outside the Platform's control, which is why this is carried as a dependency rather than a mitigation (Doc 06 TEC-10).

---

## Sources

1. https://developers.google.com/webmaster-tools/limits — GSC API quotas: Search Analytics 1,200 QPM/site; URL Inspection 2,000/day/property + 600 QPM; other methods 20 QPS/200 QPM
2. https://developers.google.com/webmaster-tools/v1/searchanalytics/query — dimensions, filters, rowLimit 25k, dataState values, "top rows not all rows"
3. https://www.analyticsedge.com/blog/download-over-25000-rows-from-google-search-console-api/ — pagination beyond 25k, ~50k rows/day ceiling **[secondary °]**
4. https://developers.google.com/search/blog/2025/04/san-hourly-data — hourly data in the Search Analytics API (Apr 2025), ~10-day window, few-hours delay
5. https://www.seo-stack.io/blog/why-does-google-search-console-have-a-16-month-data-limit — 16-month rolling retention **[secondary °]**
6. https://ahrefs.com/blog/gsc-anonymized-queries/ — 46.77% of clicks anonymized (146k+ sites, Apr 2025) **[secondary °]**
7. https://developers.google.com/webmaster-tools/v1/urlInspection.index/UrlInspectionResult — URL Inspection response schema incl. richResultsResult
8. https://support.google.com/webmasters/thread/286763491/increasing-the-2000-url-inspection-limit-per-website-for-the-google-search-console-api — multi-property quota workaround **[secondary °]**
9. https://developers.google.com/webmaster-tools/v1/sitemaps/submit — sitemaps submit/delete/get/list; webmasters scope
10. https://support.google.com/webmasters/answer/12918484 — bulk data export scope; anonymized queries as aggregate rows
11. https://support.google.com/webmasters/answer/12917675 — bulk export setup: Owner permission, customer GCP project + billing, UI-only, no backfill
12. https://developers.google.com/search/blog/2023/02/bulk-data-export — export tables, no daily row limit
13. https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification — sensitive-scope verification requirements
14. https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification — restricted scopes = CASA; GSC not on the restricted list
15. https://support.google.com/cloud/answer/13463073 — OAuth verification help; 100-user unverified cap
16. https://deepstrike.io/blog/google-casa-security-assessment-2025 — CASA Tier 2 cost range ($540 DAST → $5k+ pentest, annual) **[secondary °]**
17. https://support.google.com/webmasters/answer/7687615 — GSC users/permissions model (Owner/Full/Restricted); service-account invitation path
18. https://developers.google.com/analytics/devguides/reporting/data/v1/quotas — GA4 Data API token quotas (200k/day, 40k/h, 14k/h/project, 10 concurrent; ≤10 tokens typical)
19. https://support.google.com/analytics/answer/11198161 — GA4 freshness: intraday 2–6 h, daily ~12 h, key-event attribution restated up to 12 days, no SLA
20. https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport — runReport: scopes, 250,000-row max, pagination
21. https://support.google.com/analytics/answer/13331684 — the `(other)` row: cardinality limits apply to Data API responses
22. https://support.google.com/analytics/answer/11161109 — consent-mode behavioral modeling; modeled data excluded from BigQuery export
23. https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list — Admin API property enumeration, pageSize max 200
24. https://support.google.com/analytics/answer/9305587 — GA4 access roles (Viewer suffices); No Cost / No Revenue data restrictions
25. https://support.google.com/analytics/answer/9823238 — GA4 BigQuery export: 1M events/day standard cap, setup requirements, no backfill
26. https://developers.google.com/analytics/devguides/reporting/data/v1/changelog — API still v1beta (2026), active development
27. https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app — GitHub App vs alternatives
28. https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app — installation tokens: 1-hour expiry, per-token repo (≤500) + permission down-scoping
29. https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps — 5,000/h base per installation, scaling to 12,500/h cap
30. https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api — secondary limits: 80 content-generating requests/min, 500/h; 15,000/h Enterprise Cloud
31. https://docs.github.com/public/fpt/schema.docs.graphql — current public GraphQL schema: createCommitOnBranch, revertPullRequest, enablePullRequestAutoMerge, expectedHeadOid (verified directly)
32. https://github.blog/changelog/2021-09-13-a-simpler-api-for-authoring-commits/ — createCommitOnBranch auto-signed Verified commits
33. https://github.com/orgs/community/discussions/190610 — March 25, 2026 auto-merge behavior change (422 unless requirements already met)
34. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue — merge queue, merge_group triggers
35. https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens — fine-grained PAT limits; no Checks API
36. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches — protected branches, required status checks
37. https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/ — WP REST authentication (Application Passwords, HTTPS required)
38. https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/ — Application Passwords: core since 5.6, 24-char, revocable, not scope-limited
39. https://developer.wordpress.org/rest-api/reference/media/ — media endpoint: alt_text writable; no file-replace route
40. https://developer.yoast.com/customization/apis/rest-api/ — Yoast REST API "currently read-only, doesn't support POST or PUT"
41. https://kahunam.com/articles/wordpress/how-to-update-yoast-seo-titles-and-meta-descriptions-via-the-wordpress-rest-api/ — register_post_meta + show_in_rest write recipe for Yoast fields
42. https://github.com/Devora-AS/rank-math-api-manager — Rank Math meta registration for REST (title/description/canonical/focus keyword)
43. https://developer.wordpress.org/rest-api/reference/post-revisions/ — revisions: list/get/delete only, no restore endpoint
44. https://make.wordpress.org/core/2023/10/24/framework-for-storing-revisions-of-post-meta-in-6-4/ — post-meta revisioning is opt-in per registered key
45. https://shopify.dev/docs/api/admin-graphql/latest/mutations/productUpdate — productUpdate seo{title,description}; write_products; API 2026-07
46. https://shopify.dev/docs/apps/build/marketing-analytics/optimize-storefront-seo — global.title_tag / global.description_tag metafields; seo.hidden noindex
47. https://community.shopify.com/c/shopify-apis-and-sdks/bug-report-productupdate-meta-property/td-p/2011037 — partial seo input nulls the omitted field
48. https://shopify.dev/docs/api/admin-graphql/latest/mutations/urlRedirectCreate — urlRedirectCreate; write_online_store_navigation
49. https://shopify.dev/docs/apps/build/online-store/asset-legacy — Asset API restricted since 2023-04; protected-scope exemption; SEO a named qualifying category; 2026 audits
50. https://shopify.dev/docs/api/admin-graphql/latest/mutations/themeFilesUpsert — themeFilesUpsert ≤50 files/request; write_themes + exemption
51. https://shopify.dev/docs/api/usage/limits — cost-based rate limits: 1,000-point bucket at 50 pts/s (Plus 2,000/100)
52. https://shopify.dev/docs/api/admin-graphql/latest/mutations/fileUpdate — fileUpdate originalSource: replace file content at the same URL; async
53. https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerJourneySummary — per-order attribution; read_orders = protected customer data
54. https://vercel.com/docs/rest-api/deployments/create-a-new-deployment — POST /v13/deployments with gitSource; deployment states
55. https://vercel.com/docs/limits — deployments/day by plan (100/6,000/24,000), 45-min build cap, build CPU pricing, protection bypass
56. https://vercel.com/docs/instant-rollback — Instant Rollback semantics: seconds, env/cron caveats, disabled auto-promotion after rollback
57. https://dev.to/philw_/using-vercels-instant-rollback-feature-in-your-own-ci-cd-pipeline-57oi — rollback API endpoint (semi-documented) **[secondary °]**
58. https://docs.netlify.com/api/get-started/ — Netlify API: file-digest/ZIP deploys, draft deploys, restore endpoint; 500 req/min, 3 deploys/min, 100 API deploys/day
59. https://docs.netlify.com/deploy/deploy-types/deploy-previews/ — Deploy Previews per PR; deploy permalinks
60. https://dataforseo.com/apis/serp-api/pricing — SERP $0.60/$1.20/$2.00 per 1k; SERP = 10 results; $50 minimum deposit
61. https://docs.dataforseo.com/v3/keywords_data-google_ads-search_volume-live/ — search volume: 1,000 keywords/request, $0.09 live / $0.06 standard
62. https://dataforseo.com/help-center/cost-of-onpage-api-parameters — OnPage per-page costs ($0.000125 base / $0.00125 JS / $0.00425 browser)
63. https://docs.dataforseo.com/v3/dataforseo_labs-google-search_intent-live/ — Labs search_intent: 1,000 keywords/call, intent + probability
64. https://dataforseo.com/update/click-depth-for-paa-in-serp-api — PAA click depth 1–4, $0.00015/click, auto-refund
65. https://serper.dev/ — Serper: 2,500 free credits, endpoint list incl. autocomplete
66. https://apiserpent.com/blog/serp-api-pricing-comparison — 2026 cross-provider SERP pricing (Serper packs; SerpApi tiers) **[secondary °]**
67. https://almcorp.com/blog/google-sues-serpapi-lawsuit-analysis/ — Google v. SerpApi (filed Dec 19, 2025; DMCA §1201; SearchGuard context)
68. https://scrapebadger.com/blog/google-sued-a-scraper-under-copyright-law-and-lost-heres-what-the-serpapi-ruling-actually-says — 2026 dismissal of Google's copyright claims; non-copyright theories open
69. https://searchengineland.com/reddit-sues-perplexity-serpapi-scraping-google-463681 and https://cryptobriefing.com/reddit-serpapi-lawsuit-survives-dismissal/ — Reddit v. SerpApi/Oxylabs (Oct 2025); motion to dismiss largely denied Jul 31, 2026
70. https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement — Bing Search APIs retired Aug 11, 2025 (Azure-locked replacement)
71. https://thatmarketingbuddy.com/blog/semrush-api-pricing — Semrush $549/mo plan floor + units; 1-month data-caching limit without written consent **[secondary °]**
72. https://docs.ahrefs.com/api/docs/limits-consumption — Ahrefs API v3 unit budgets, min 50 units/request, per-row/field costs
73. https://developers.google.com/google-ads/api/docs/api-policy/access-levels — Google Ads API access tiers and permissible use
74. https://ppc.land/google-faces-developer-token-application-backlog-as-new-api-tier-debuts/ — Explorer tier blocks KeywordPlan services; Basic-access application required
75. https://learn.microsoft.com/en-us/bingwebmaster/getting-access — Bing Webmaster API access; API-key auth
76. https://blogs.bing.com/webmaster/june-2019/bingbot-Series-Introducing-Batch-mode-for-Adaptive-URL-submission-API — SubmitUrlBatch: 500 URLs/call
77. https://merj.com/blog/capturing-data-from-bing-webmaster-tools-api — Bing data: ~6-month retention, weekly updates, throttling behavior
78. https://www.indexnow.org/faq — IndexNow protocol: key file, 10,000 URLs/call, participating engines, free
79. https://www.indexernow.com/google-indexnow — Google non-adoption of IndexNow (2026 status)
80. https://platform.claude.com/docs/en/about-claude/models/overview — Anthropic model lineup (Opus 5 / Sonnet 5 / Haiku 4.5), context windows
81. https://platform.claude.com/docs/en/build-with-claude/structured-outputs — output_config.format, messages.parse(), strict tool use, schema limits, 24-h schema cache
82. https://platform.claude.com/docs/en/build-with-claude/batch-processing — Batch API: 50% discount, 100k requests / 256 MB, most <1 h, 24-h max
83. https://platform.claude.com/docs/en/build-with-claude/prompt-caching — caching: 0.1× reads, 1.25×/2× writes, per-model minimum prefixes (512/1024/4096)
84. https://platform.claude.com/docs/en/about-claude/pricing — Anthropic pricing incl. batch and cache multipliers; Sonnet 5 intro pricing through 2026-08-31
85. https://developers.openai.com/api/docs/pricing — OpenAI pricing (gpt-5.6 family, gpt-5-mini/nano; batch 50%; cached input 0.1×)
86. https://openai.com/index/introducing-structured-outputs-in-the-api/ — OpenAI structured outputs (json_schema strict, token masking)
87. https://ai.google.dev/gemini-api/docs/pricing — Gemini pricing (3.1 Pro preview, 3.6 Flash, 3.5 Flash-Lite; batch; context caching)
88. https://ai.google.dev/gemini-api/docs/interactions/structured-output — Gemini responseSchema constrained decoding
89. https://tokenmix.ai/blog/openai-embedding-pricing — text-embedding-3-small $0.02/M ($0.01 batch) **[secondary °]**
90. https://docs.voyageai.com/docs/pricing — Voyage embeddings: voyage-4-lite $0.02/M, 200M free tokens, batch discount
91. https://devtk.ai/en/models/gemini-2-5-flash-lite/ — Gemini 2.5 Flash-Lite $0.10/$0.40; retirement Oct 16, 2026; successor pricing **[secondary °]**
92. https://vercel.com/docs/accounts/access-tokens — Vercel access-token scoping: Full Account / Team / Project levels, mandatory expiry, `vcp_` prefix, project-scoped tokens cannot mint further tokens
93. https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/ — HTMLRewriter: streaming HTML parser, CSS-selector handlers, setInnerContent/setAttribute/append/remove, async handlers
94. https://developers.cloudflare.com/workers/platform/limits/ — Workers limits: free 100k requests/day + 10 ms CPU; paid uncapped requests, 30 s CPU (configurable to 5 min), 128 MB, 10k subrequests
95. https://www.searchpilot.com/engineers — SearchPilot proxy/edge SEO-testing architecture; transparent-proxy failover on application error
96. https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics — Google JS SEO: JS-set title/description supported at render time; warning against JS-set canonicals differing from the raw HTML
97. https://docs.dataforseo.com/v3/serp/google/organic/task_post/ — DataForSEO: 2,000 API calls/minute; maximum 100 tasks per POST (tasks beyond return error 40006)
98. https://developers.google.com/search/apis/indexing-api/v3/quota-pricing — Google Indexing API: JobPosting/BroadcastEvent pages only; 200 publish/day default quota
99. https://developers.google.com/search/docs/crawling-indexing/verifying-googlebot — Googlebot verification: published crawler IP list + reverse DNS; automated IP match recommended at scale
100. https://vercel.com/docs/drains — Vercel Drains: Pro/Enterprise plans, $0.50/GB uncompressed JSON, request-log schema
101. https://developers.cloudflare.com/logs/about/ — Cloudflare Logpush: Enterprise-plan only (HTTP requests dataset)
102. https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html — CloudFront standard logs: S3/CloudWatch/Firehose destinations, best-effort delivery, no CloudFront charge
103. https://platform.claude.com/docs/en/api/rate-limits — Anthropic rate limits by tier: RPM/ITPM/OTPM per model class; Message Batches RPM, processing-queue and per-batch request caps; cached input excluded from ITPM; Start/Build/Scale monthly spend caps
104. https://developers.openai.com/api/docs/guides/rate-limits — OpenAI: tier qualification and monthly spend caps published; per-tier RPM/TPM values **not** published (account settings only); Batch queue limits computed on total input tokens queued per model
105. https://ai.google.dev/gemini-api/docs/rate-limits — Gemini: per-model RPM/TPM/RPD **not** published (viewable in AI Studio); Batch = 100 concurrent requests, 2 GB input file, 20 GB storage; spend-based limits on a rolling 10-minute window; Priority Inference at 0.3× standard limits

*Sources marked **[secondary °]** are community measurements, third-party pricing trackers, forum threads, or semi-documented endpoints rather than primary vendor documentation. Every load-bearing figure taken from them is marked ° at first use in the body.*
