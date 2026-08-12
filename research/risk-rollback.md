# Safety Core Research — Confidence Scoring, Change Ledger, Automatic Rollback
### Lane: SPEC §14 (Confidence-Based Automation) + §16 (Change Tracking) + §17 (Automatic Rollback) + §23 (Safety Requirements)
### Research date: 2026-08-10 · Revised 2026-08-10 (gap-fill pass): recrawl-latency constants re-sourced against primary Google documentation and measured studies; POC #8 measurement protocol added — see §3.4

---

## Summary

**Recommendation in one paragraph.** Score every proposed change on **two independent axes — confidence ("is this change correct?") and risk ("what is the cost if it is wrong?")** — and gate automation with a decision matrix, not a single blended number. Risk is computed deterministically: a base-risk value per change type, multiplied by blast-radius, traffic-value-at-stake, and change-velocity modifiers, dampened by an *earned-trust* factor built from that site's historical KEEP rate — with a **hard deny-list that no score can override** (robots.txt, mass canonicals, mass redirects, URL restructuring, page deletion are always HIGH per SPEC §14). Confidence is dominated by **deterministic validation results, not the LLM's self-reported number**. Every change lives in an **append-only, event-sourced change ledger** whose atomic rollback unit is the *batch* (one PR / one CMS transaction), with content-addressed before/after blobs and a drift check before any rollback. Monitoring is **two-phase**: a *guardrail phase* (days 0–7: crawl-diff, URL Inspection verdicts, HTTP/build errors, CUSUM on fresh GSC data — catches catastrophes and rolls back fast) and a *verdict phase* (day 14–60 depending on change type: KEEP/ROLLBACK decided against a **counterfactual built from untouched control pages** — CausalImpact-style BSTS or simpler difference-in-differences with year-over-year checks — never a naive pre/post comparison). The evaluation clock **starts at verified recrawl, not at deploy**, because Google itself commits only to wide recrawl/reprocessing ranges — crawling after a recrawl request takes "a few days to a few weeks" [29], indexing "typically … a day or so, but can take much longer in some cases" [30], and site changes take "a few hours" to "several months" to show in results [31] — and this, plus GSC's 2–3-day data lag [10][12], means calendar-from-deploy windows systematically under-measure. (Practitioner tier constants of 6 h – 14+ days [20][21] are unverified priors, downgraded and scheduled for empirical measurement in POC #8 — see §3.4.) Policy risk (scaled content abuse, site reputation abuse — March 2024 policies, actively enforced through spam updates in Aug 2025 and June 2026 [3][24][26]) is handled *by construction*: per-site change budgets, no autonomous mass-publishing of net-new pages, and full AI-change audit trails.

**The single most important design fact found:** the loss function is asymmetric. A missed optimization costs a few percent of potential uplift; a bad site-wide change or a spam-policy violation costs months — Google states spam-update recovery happens "over a period of months" [24], site-move-scale disruptions take weeks-to-months to stabilize [1][27], and a broken robots.txt stops all crawling within 12 hours [2]. Every threshold below is tuned conservative because of this asymmetry.

---

## Findings

### 1. Confidence / risk scoring mechanism (SPEC §14)

#### 1.1 Two axes, not one

Blending "how sure is the AI" and "how dangerous is the action" into one number is a design error: a 0.99-confidence robots.txt rewrite must still never auto-apply, and a 0.55-confidence alt-text suggestion is harmless but useless. Keep the axes separate and combine them only in the final decision matrix.

- **Confidence** answers: *will this change achieve its intent without breaking anything?* Sources: deterministic validators (dominant), historical acceptance rate, AI self-report (weak signal).
- **Risk** answers: *if this change is wrong, what is the worst credible outcome and how many pages/clicks does it touch?* Sources: change-type base risk, blast radius, traffic value, velocity.

A note on AI self-reported confidence: the SPEC's example output (`"confidence": 0.94`) should be recorded in the ledger but must **never be the primary gate** — LLM self-assessed confidence is not a calibrated probability and is trivially inflatable by prompt phrasing. Treat it as a *tie-breaker/regeneration trigger* (below 0.8 → regenerate or downgrade to suggestion-only), and let hard validation gates carry the real weight. This is a design position, not a cited finding, but it is consistent with how production SEO-testing vendors work: SearchPilot reports *statistical* credible intervals from observed data, not model self-belief [13].

#### 1.2 Base risk per change type — B(type), 0–100

Anchored to the SPEC §14 tiers, extended with evidence-based reasoning:

| Change type | B | Rationale / evidence |
|---|---|---|
| Add missing image alt text | 5 | Invisible to layout; no ranking downside path. SPEC LOW. |
| Add missing meta description | 10 | Google rewrites snippets freely anyway; worst case is a rewritten snippet [22]. SPEC LOW. |
| Fix duplicate metadata | 10 | Restores correctness. SPEC LOW. |
| Fix broken internal link (target exists) | 10 | Deterministic correctness fix. SPEC LOW. |
| Fix invalid JSON-LD (syntax only) | 10 | Validated by parser; only removes an error state. SPEC LOW. |
| Add net-new JSON-LD block | 20 | Wrong/spammy structured data is a manual-action category [3]. |
| Insert internal links (≤3/page, contextual) | 25 | UX + link-graph effects; at scale can resemble link schemes [3]. SPEC MEDIUM. |
| Title tag change | 30 | Direct ranking + CTR surface. Note: Google already rewrites 61.6% of titles (n=80,959 URLs), and 99.9% of titles >70 chars [22] — effect is real but bounded. SPEC MEDIUM. |
| H1 / heading structure change | 30 | Content-adjacent; SearchPilot has run "H2→H1" as a formal A/B test because outcomes are genuinely uncertain [14]. SPEC MEDIUM. |
| Content update (body copy, FAQ add) | 40 | Highest policy sensitivity (scaled content abuse [3][4]); quality regression risk. SPEC MEDIUM. |
| Single-page canonical change | 45 | Wrong canonical silently de-indexes the page; effect only visible after recrawl. |
| Single redirect (one URL) | 45 | Signal transfer takes time; Google recommends redirects stay ≥1 year on migrations [1]. |
| Sitemap regeneration | 35 | Wrong sitemap misleads discovery, but sitemaps are a hint, not a directive — Google ignores `<changefreq>`/`<priority>` and trusts `<lastmod>` only when verifiably accurate [36]; recoverable. |
| **Mass canonical changes (>10 pages)** | **90** | SPEC HIGH — hard deny-list. |
| **Mass redirects / URL restructuring** | **95** | Site-move-class event: "a few weeks for most pages" on a medium site, longer for large; ranking fluctuation heaviest first 2–4 weeks; stabilization 4–6 weeks same-domain, 2–3 months+ cross-domain [1][27][28]. SPEC HIGH — deny-list. |
| **Page deletion (404/410)** | **95** | Irreversible traffic loss until reindex; SPEC HIGH — deny-list. |
| **robots.txt change** | **100** | One bad line can block the whole site; Google caches robots.txt up to 24 h (bad file lives ~a day even after instant rollback), and a 5xx robots.txt halts *all* crawling within the first 12 hours [2]. SPEC HIGH — deny-list. |
| noindex add/remove | 90 | Same de-indexing class as robots.txt, but page-scoped. Deny-list. |
| hreflang restructuring | 70 | Cross-page consistency required; errors break international targeting silently. |
| Site-wide template edit (nav/footer links) | 80 | Every page's internal link graph changes at once — blast radius is the whole site. |

#### 1.3 Modifiers

```
risk_raw = B(type) × M_scope × M_traffic × M_velocity
risk     = clamp( risk_raw × (1 − trust) , tier_floor(type) , 100 )
```

**M_scope — blast radius (how many pages the change touches):**

| Pages affected | M_scope |
|---|---|
| 1 | 1.0 |
| 2–10 | 1.2 |
| 11–100 | 1.5 |
| >100, or any single site-wide file (robots.txt, templates, next.config redirects) | 2.0 |

**M_traffic — traffic value at stake** (share of the site's last-28-day organic clicks, from warehoused GSC data, landing on the affected pages):

| Share of site clicks | M_traffic |
|---|---|
| <0.1% | 0.8 |
| 0.1–1% | 1.0 |
| 1–5% | 1.3 |
| >5% | 1.6 |

Also track an absolute per-page tier: any page in the site's top-20 by clicks is "protected" — protected pages bump one tier minimum (LOW→MEDIUM) regardless of score, because they are where an error is most expensive *and* where measurement is most sensitive.

**M_velocity — cumulative change pressure per site.** Two purposes: (a) many concurrent changes make attribution impossible; (b) high-velocity automated modification is exactly the pattern Google's scaled-abuse enforcement targets [3][26].

| Condition (rolling 7 days, per site) | M_velocity |
|---|---|
| <2% of indexed pages changed | 1.0 |
| 2–10% changed | 1.2 |
| >10% changed | 1.5 **and** new LOW-tier items queue as MEDIUM (PR) until pressure drops |

Hard budget caps (not score-based): auto-apply ≤ max(20, 2% of indexed pages) changes/site/day; a single batch ≤ 50 pages; **freeze all auto-apply during a confirmed Google ranking/spam update rollout** (poll the Google Search Status dashboard; the June 2026 spam update rolled out over "a few days" [24] — applying changes mid-rollout destroys attribution and risks coupling your change to an algorithmic drop).

**trust — earned autonomy (0 to 0.25).** Per (site × change_type): after ≥50 applied changes with ≥95% KEEP rate and zero guardrail rollbacks, trust grows +0.05 per additional 50 kept changes, capped at 0.25. Any rollback of that type halves trust. `tier_floor` guarantees deny-list types can never leave HIGH regardless of trust.

#### 1.4 Confidence score

```
confidence = 0.6 × validation_score + 0.3 × historical_acceptance + 0.1 × ai_self_report
```

- `validation_score`: hard validators are *gates*, not score inputs — any failure blocks (schema parses, HTML diff confined to the expected node, build passes, rendered-DOM diff clean, length windows: titles 51–60 chars per the rewrite study's optimal band [22], no keyword-stuffing lexical score, no factual-claim insertion beyond source content). Soft validators contribute the score (readability delta, intent-match rating from a second independent model, SERP-pixel-width check).
- `historical_acceptance`: human merge rate of past MEDIUM PRs of this change type on this site — a free, honest calibration signal the platform gets from its own PR workflow.
- `ai_self_report`: the model's structured-output confidence, deliberately weighted lowest.

#### 1.5 Decision matrix (the actual gate)

| | risk < 25 (LOW) | 25 ≤ risk ≤ 60 (MEDIUM) | risk > 60 (HIGH) |
|---|---|---|---|
| **confidence ≥ 0.85** | **AUTO-APPLY** (direct commit / CMS write, still batched + monitored) | **AUTO-PR** — human merges | **RECOMMEND-ONLY** — human implements outside the engine or approves an engine-drafted PR with mandatory second reviewer |
| **0.60 ≤ confidence < 0.85** | AUTO-PR | RECOMMEND-ONLY | RECOMMEND-ONLY |
| **confidence < 0.60** | Discard / regenerate (max 2 regens, then drop) | Discard | Discard |

Novel change types not in the base-risk table default to MEDIUM minimum until 50 observations exist. Worked examples: missing alt text, 1 low-traffic page → 5×1.0×0.8×1.0 = 4 → LOW → auto-apply if validated. Title change on a top-20 page → 30×1.0×1.6 = 48 → MEDIUM → PR (plus protected-page bump). robots.txt anything → floor 100 → HIGH, always.

---

### 2. Change-ledger data model (SPEC §16)

**Pattern: append-only event log + current-state head rows + content-addressed blobs.** Never UPDATE history; a rollback is a *new* change that points at the original. This gives audit-grade explainability (SPEC §3 "explainable") and makes the ledger the substrate for trust scores, velocity caps, and policy audits.

```sql
-- One batch = one PR merge or one CMS transaction = the atomic rollback unit
CREATE TABLE change_batch (
  batch_id        TEXT PRIMARY KEY,          -- ULID
  site_id         TEXT NOT NULL,
  apply_channel   TEXT NOT NULL,             -- github_pr | wp_rest | shopify_api
  pr_url          TEXT, merge_sha TEXT,      -- github channel
  cms_revision_ids JSONB,                    -- wp/shopify channel (per-object revision ids)
  deploy_id       TEXT,                      -- host deploy that shipped it
  status          TEXT NOT NULL,             -- open|applied|monitoring|closed|rolled_back
  rollback_batch_id TEXT REFERENCES change_batch(batch_id),
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE change (
  change_id       TEXT PRIMARY KEY,          -- ULID
  batch_id        TEXT NOT NULL REFERENCES change_batch(batch_id),
  site_id         TEXT NOT NULL,
  url             TEXT NOT NULL,
  change_type     TEXT NOT NULL,             -- UPDATE_TITLE | ADD_ALT | FIX_JSONLD | ...
  field_path      TEXT,                      -- e.g. head.title, img[src=...]@alt
  before_hash     TEXT NOT NULL,             -- content-addressed blob (SHA-256)
  after_hash      TEXT NOT NULL,
  diff            TEXT,                      -- human-readable unified diff
  reason          TEXT NOT NULL,             -- the AI's explanation (SPEC §7)
  source_issue_id TEXT,                      -- detector finding that triggered it
  ai_model        TEXT, prompt_version TEXT,
  ai_confidence   NUMERIC,                   -- self-report, recorded not trusted
  confidence      NUMERIC NOT NULL,          -- computed (§1.4)
  risk_score      NUMERIC NOT NULL,
  risk_tier       TEXT NOT NULL,             -- LOW|MEDIUM|HIGH
  decision        TEXT NOT NULL,             -- auto_apply|auto_pr|recommend|discard
  validations     JSONB NOT NULL,            -- each validator: pass/fail + payload
  status          TEXT NOT NULL,             -- proposed→validated→pending_approval→applied
                                             --  →monitoring→kept|rolled_back|superseded|failed
  applied_at      TIMESTAMPTZ,
  recrawl_verified_at TIMESTAMPTZ,           -- URL Inspection: first crawl AFTER apply
  eval_start_at   TIMESTAMPTZ,               -- = recrawl_verified_at (not applied_at!)
  eval_window_days INT,
  verdict         TEXT,                      -- keep|rollback|extend|insufficient_data
  verdict_reason  TEXT,
  metrics_baseline JSONB,                    -- 28d pre: clicks, impr, ctr, position (+YoY)
  metrics_observed JSONB,
  effect_estimate  JSONB,                    -- point est + credible interval + method
  rollback_of     TEXT REFERENCES change(change_id),  -- set on ROLLBACK-type changes
  rolled_back_by  TEXT REFERENCES change(change_id),  -- set on the original
  policy_flags    TEXT[],                    -- e.g. {velocity_capped, update_freeze_delayed}
  group_id        TEXT,                      -- logical campaign ("Q3 title refresh")
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE change_event (                  -- append-only audit spine
  event_id  TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES change(change_id),
  ts        TIMESTAMPTZ NOT NULL,
  type      TEXT NOT NULL,                   -- proposed|validated|approved|applied|
                                             -- recrawl_seen|guardrail_trip|verdict|...
  actor     TEXT NOT NULL,                   -- system|model:<id>|user:<id>
  payload   JSONB
);

CREATE TABLE blob ( hash TEXT PRIMARY KEY, bytes BYTEA, size INT );  -- dedup before/after

CREATE TABLE site_trust (
  site_id TEXT, change_type TEXT,
  applied_count INT, kept_count INT, rolled_back_count INT,
  trust NUMERIC, PRIMARY KEY (site_id, change_type)
);

-- GSC warehouse: required because Search Console only retains ~16 months and caps
-- exports at ~50k rows/day/search-type/property [8][9] — YoY controls need OWNED history.
CREATE TABLE gsc_page_daily (
  site_id TEXT, url TEXT, date DATE,
  clicks INT, impressions INT, ctr NUMERIC, position NUMERIC,
  data_state TEXT,                           -- fresh|final; fresh rows get overwritten
  PRIMARY KEY (site_id, url, date)
);
```

**Rollback pointer semantics.** A rollback creates a new `change` row with `change_type='ROLLBACK'`, `rollback_of=<original>`, and before/after inverted; the original gets `rolled_back_by` and status `rolled_back`. **Precondition — drift check:** the current live value must equal the original's `after` blob. If a later change or a human edit moved it (`live ≠ after`), automatic rollback is forbidden — escalate to a human with a 3-way diff. This is the single most common way naive rollback systems corrupt sites.

**Batch as rollback unit.** GitHub channel: rollback = `git revert` of the batch's merge SHA on a new branch → auto-PR (auto-merge allowed only if every member change was LOW). CMS channel: replay stored pre-image writes per object via the same API, in reverse order, verifying each write. Partial-failure state (some pages reverted, some not) is recorded per-change, and the batch stays `rolled_back:partial` with an alert — never silently "done."

---

### 3. Automatic rollback — signals and the evaluation-window question (SPEC §17)

#### 3.1 The latency chain (why "wait how long?" has a structural answer)

A change cannot show SEO effect before Google has recrawled and reprocessed the page, and you cannot *see* the effect before GSC data lands:

1. **Recrawl latency:** Google's primary documentation gives ranges, not constants: "Crawling can take anywhere from a few days to a few weeks" after a recrawl request [29]; "Indexing typically takes only a day or so, but can take much longer in some cases" (bulk submissions "up to a week or two") [30]; change visibility spans "a few hours" to "several months" [31]. Per-URL recrawl frequency is a function of "perceived inventory", "popularity" and "staleness" — Google deliberately publishes no per-tier numbers [32]. Practitioner tiers (high-authority 6–48 h / typical 3–7 d / low-authority 10–14+ d [20][21]) are consistent with these brackets but are **unmeasured priors — see §3.4**. "Request indexing" encourages but does not guarantee a fast recrawl, and repeated requests for the same URL "won't get it crawled any faster" [29][30].
2. **Processing/settling:** ranking "fluctuations while Google recrawls and reindexes" are expected after significant changes; on site-move-class changes, most pages take "a few weeks" (medium site) and fluctuation is heaviest for 2–4 weeks [1][27][28]. Same-domain migrations typically stabilize in 4–6 weeks; domain changes 2–3 months, up to a year for large sites [27].
3. **Measurement lag:** GSC performance data is ~2 days delayed and final at ~3 days (the API's delay grew from 1 to 3 days in 2025 [12]); delays occasionally stretch to 5–7 days during Google-side incidents [10]. Fresh (revisable) data is available with `dataState=all`, and since April 2025 hourly data exists for the trailing 8 days [11].

**Design consequence:** the evaluation clock starts at `recrawl_verified_at` (first URL Inspection-confirmed crawl after apply, or log-file sighting of Googlebot), **not** at deploy. Note the URL Inspection API quota — 2,000 inspections/day/property [8] — is a real constraint on a 100k-page site: inspect *changed* URLs only, on a decaying schedule (day 1, 2, 4, 8...).

#### 3.2 Signal inventory, fastest → slowest

| Signal | Latency | Source | Role |
|---|---|---|---|
| Build/deploy failure, HTTP 4xx/5xx on changed URLs, broken render | minutes | CI + synthetic checks | Guardrail: instant auto-rollback |
| Crawl-diff regression (own crawler): unexpected noindex/canonical/robots change, title on wrong pages | minutes–hours | own post-deploy crawl | Guardrail: instant auto-rollback |
| robots.txt / sitemap fetch errors | hours (Google halts crawling within 12 h of a 5xx robots.txt [2]) | synthetic monitor | Guardrail: page the operator + auto-restore last-good file |
| Indexing state change (page dropped from index; "Crawled – currently not indexed") | 1–7 days | URL Inspection API | Guardrail: rollback if it persists 48 h and page was indexed pre-change |
| CTR crash with stable impressions | 3–10 days | GSC fresh/hourly data + CUSUM | Early metadata-regression alarm — Google's own debugging framework: stable impressions + falling clicks ⇒ snippet/title problem, not indexing [5] |
| Position decline on tracked queries | 1–14 days | GSC position + optional rank tracker | Verdict input (noisy early) |
| Organic clicks decline vs counterfactual | 14–45 days | GSC + control pages | Primary verdict metric |
| Conversion decline | 21–60 days | analytics | Veto for high-traffic pages only (noisiest) |

#### 3.3 Recommended evaluation windows per change type

Grounded in: Google's documented recrawl/indexing ranges (days-to-weeks [29][30], hours-to-months for change visibility [31]; practitioner tier priors 1–14 d [20][21] pending POC #8 measurement — §3.4), GSC lag 2–3 d [12], SERP settling 2–4 wk [1][27], and industry SEO-test practice of 4–6-week runtimes [13][15]. Guardrails run continuously from apply; the verdict fires at window end (or earlier on decisive negative evidence).

| Change type | Guardrail phase | Verdict at (post-recrawl) | Rationale |
|---|---|---|---|
| Alt text, JSON-LD fix, broken-link fix | 0–3 d | 14 d (correctness fixes: verdict is "no harm?", not "uplift?") | No ranking mechanism to wait on |
| Meta description | 0–7 d | 21 d | CTR-only surface; needs CTR sample |
| Title / H1 | 0–7 d | 21–28 d | Ranking + CTR; SERP display check at day 3 (did Google keep the title? 61.6% base rewrite rate [22]) |
| Content update / FAQ add | 0–7 d | 28–42 d | Content reprocessing is slower; quality systems are periodic |
| Internal links (batch) | 0–7 d | 28 d | Needs propagation through the link graph (multiple recrawls of linking + linked pages) |
| Canonical / single redirect | 0–14 d | 42–60 d | Signal consolidation is slow [1][6] |
| Anything site-wide (human-approved HIGH) | 0–14 d | 60–90 d | Site-move-class settling [1][27] |

**Anti-flapping rules:** a rollback is itself a change that needs a recrawl to take effect — after any rollback, freeze the page/change-type pair for ≥30 days; never re-apply a rolled-back change automatically; maximum one EXTEND per evaluation; pause verdicts (extend windows) that overlap a confirmed Google update rollout, since both groups move but attribution is polluted [5][24].

#### 3.4 Evidence quality behind the recrawl constants — and how POC #8 must close the gap

**Status of the 6–48 h / 3–7 d / 10–14+ d tiers.** These figures came from two practitioner blogs [20][21], not from Google and not from any published measurement. Because they are the single most load-bearing numbers in this lane, this gap-fill pass re-grounds the latency chain in primary and measured sources and formally downgrades the blog tiers to *planning priors* to be replaced by per-site measurement in POC #8 (SPEC §25, "measure optimization impact").

**What Google actually commits to (primary sources — all ranges, no constants):**

| Claim | Exact wording | Source |
|---|---|---|
| Recrawl after a recrawl request | "Crawling can take anywhere from a few days to a few weeks." | Google, *Ask Google to recrawl your URLs* [29] |
| Indexing after a request | "Indexing typically takes only a day or so, but can take much longer in some cases"; bulk submissions: "up to a week or two" | Google Search Console Help, URL Inspection tool [30] |
| Change visibility in results | "Some changes might take effect in a few hours, others could take several months." | Google, SEO starter guide [31] |
| What drives recrawl frequency | Per-URL function of "perceived inventory", "popularity", "staleness" — **no numeric intervals are published anywhere in Google's crawl documentation** | Google, crawl-budget guide [32] |
| Healthy-site expectation | "If your pages seem to be crawled the same day that they are published, you don't need to read this guide." (Crawl-budget concern thresholds: 1M+ pages changing weekly, or 10k+ pages changing daily.) | Google, crawl-budget guide [32] |
| Acceleration limits | A quota applies to individual URL submissions and "requesting a recrawl multiple times for the same URL won't get it crawled any faster." | Google [29] |

**What has actually been measured (adjacent quantities — not update-recrawl itself):**

- **Initial-indexing distribution** (Rudzki/Onely research, reported via Search Engine Journal): on average **83% of pages are indexed within the first week** of publication; stragglers take up to 8 weeks; **16% of valuable, indexable pages on popular websites never get indexed at all** [34]. John Mueller's stated range: "several hours to several weeks," with "most good content … picked up and indexed within about a week" [34].
- **Crawl→render latency** (Vercel + MERJ, 100,000+ verified Googlebot fetches, April 2024, 37,000+ matched render pairs): p50 **10 s**, p75 26 s, p90 ~3 h, p95 ~6 h, p99 **~18 h** between initial crawl and render; query-parameter URLs are slower (p90 ~8.5 h vs ~2.5 h without) [33]. This measures a *stage inside* the pipeline, not deploy→recrawl, but it is the methodological template POC #8 should copy: instrument real Googlebot traffic, report percentiles.
- **Update-recrawl latency (an existing indexed page is modified → Googlebot refetches it) has no public measured study that this research pass could locate.** The gap is in the public literature itself, not merely in our citations — which is precisely why the platform must measure it on its own sites rather than import anyone's constants.

**Why the priors are not load-bearing for correctness (but still matter operationally).** The design already survives wrong priors: the evaluation clock starts at `recrawl_verified_at`, an *observed event*, so a mistaken constant cannot corrupt a verdict. The priors size only three operational knobs: (1) the URL Inspection polling schedule (decaying 1, 2, 4, 8, 16 d), (2) the guardrail alarm "recrawl not observed after X days → nudge (sitemap lastmod bump / request indexing) or escalate," and (3) capacity/UX expectations for how long changes sit in `monitoring`. Bias analysis: the blog tiers and all measured studies above skew toward **new-page first indexing**, while this platform overwhelmingly modifies **already-indexed pages** that are in Google's crawl scheduler with a nonzero revisit rate driven by popularity/staleness [32]; verdict statistical power also concentrates in high-traffic pages, which are exactly the most frequently recrawled. Net: the priors likely **overstate** latency for the pages that matter most to verdicts and **understate** it for orphan/long-tail pages.

**POC #8 measurement protocol (deliverable: a per-site recrawl-latency CDF that replaces the priors).**

1. **Cohort:** ≥50 changed URLs per site, stratified into top-20-traffic / mid / long-tail pages (per warehoused GSC clicks), so the output is a latency distribution *per stratum*, not one number.
2. **Instruments:**
   - *Ground truth:* server/CDN access logs — first verified-Googlebot GET (reverse-DNS/IP-range verified) of each changed URL after deploy.
   - *No-log-access fallback:* URL Inspection API `lastCrawlTime`, polled on the decaying schedule; budget fits the quota — 2,000 queries/day + 600/min per property [8].
   - *Reindex ≠ recrawl:* a crawl event does not prove the new version reached the index. Confirm content-version pickup with a fingerprint (the changed title/meta value) checked against the inspection result's indexed-version data; record `recrawl_seen` and `reindex_confirmed` as separate ledger events, and start the evaluation clock at the latter for metadata changes.
3. **Accelerator arm (A/B inside the POC):** treatment = sitemap `<lastmod>` bump on changed URLs (Google uses `<lastmod>` "if it's consistently and verifiably accurate" and ignores `<changefreq>`/`<priority>` [36]) plus request-indexing for small batches [30]; control = passive discovery. Measures how much latency the platform can actually buy.
   **Ruled-out accelerators (verified):** Google's Indexing API is restricted to `JobPosting`/`BroadcastEvent` pages (default quota 200/day) and is not usable for general SEO changes [35]; IndexNow's participating engines are Bing, Naver, Seznam.cz, Yandex, Amazon, and Yep — **Google is not a participant**, so IndexNow buys nothing on Google [37].
4. **Outputs wired into config:** per-site, per-stratum p50/p90 for deploy→recrawl and deploy→reindex_confirmed. These replace the priors in the polling schedule, the guardrail timeout, and the ETA the ledger surfaces to users ("verdict expected ~day N").
5. **Prior-acceptance test:** if measured p50 for top-traffic pages falls inside Google's "a day or so … a few days" bracket [29][30], adopt measured values and retire the priors; if p90 exceeds 14 d for pages requiring verdicts, auto-extend evaluation windows rather than emitting `insufficient_data` — and flag the site as slow-crawl (a real segment: sites needing the crawl-budget guide by Google's own definition [32]).

---

### 4. Separating change impact from noise and seasonality

**Naive pre/post is disqualified.** Google's own traffic-drop debugging guidance names six confounders — algorithm updates, technical issues, security, spam actions, seasonality, shifting interests — and explicitly recommends 16-month ranges and year-over-year comparisons to expose seasonality [5]. Google also cautions "there's no guarantee that changes you make to your website will result in noticeable impact" [5] — i.e., expect many true nulls.

**The method stack (in order of preference, degrade gracefully):**

1. **Control-page counterfactual (primary).** The platform's structural advantage: it changes *some* pages and leaves similar pages untouched — those are natural controls. This is exactly how SEO A/B testing vendors work: SearchPilot "smart-buckets" statistically similar page groups on traffic level, variability and seasonality, then models the variant group's expected traffic from live control behavior; algorithm updates and seasonality "cancel out in the comparison" because both groups experience them [13]. Effects are reported as credible intervals (e.g., 90% probability the true effect lies in the range) [13].
2. **CausalImpact-style BSTS (the open-source workhorse).** Bayesian structural time series builds the counterfactual from pre-period relationships between the treated series and control series, handling trend + seasonality + covariates, and yields posterior intervals [16][17]. Validity requirements that the platform must enforce mechanically: control series *not affected by the intervention* (enforce: controls must be pages with no ledger entries in the window, not linked from/to changed pages) and a *stable pre-period relationship* [16]. Use ≥90 days of pre-period from the GSC warehouse; treat "model fit poor in pre-period" as `insufficient_data`, never as a verdict.
3. **Year-over-year delta-of-deltas (fallback when no good controls exist):** compare the change cohort's post-window vs its own prior-year same-window, minus the site-wide YoY drift — crude but robust to annual seasonality [5]. Requires the owned GSC warehouse (Google only retains ~16 months [9]).
4. **CUSUM for the early-warning loop (not for verdicts).** Run CUSUM on standardized residuals of daily clicks/CTR vs a seasonal-naive or control-based forecast; classic SPC parameters — slack k ≈ 0.5σ, decision threshold h ≈ 4–5σ — balance sensitivity vs false alarms; parameters must be tuned per series and re-tuned as baselines shift [18][19]. CUSUM's virtues here are exactly what the guardrail phase needs: early detection of small sustained drifts, trivial compute, online operation [18].

**Minimum-data thresholds (power floor).** A 20% click drop over a 14-day verdict window is detectable (~2.4σ under a Poisson approximation) at a baseline of ~10 clicks/day, and is *not* detectable (~1.3σ) at 3 clicks/day. Therefore:

- Page-level verdicts require ≥ ~10 clicks/day (≈300 clicks over the 28-day baseline). 
- Below that, **evaluate at cohort level**: pool all pages that received the same change type in the batch/group and test the pooled series — this is also how testing vendors get power from long-tail pages [13].
- Below ~1 click/day even for the cohort: use impressions + position (higher-volume series) instead of clicks; if still underpowered, verdict = `insufficient_data` → default KEEP for correctness-class fixes, default ROLLBACK-on-request only.

**Exogenous-event calendar.** Maintain a machine-readable calendar of: confirmed Google updates (Search Status dashboard — e.g., June 2026 spam update, June 24 2026, "a few days" rollout [24]; August 2025 spam update [26]), the site's own deploys (from the ledger's deploy_ids), and known seasonal peaks. Verdict windows overlapping a confirmed update auto-extend by the rollout duration + 7 days.

---

### 5. KEEP vs ROLLBACK decision rules (concrete defaults, all per-site configurable)

**Tier 1 — Guardrails (any time, no statistics needed):**

| Trigger | Action |
|---|---|
| Changed URL returns 4xx/5xx, or build/deploy fails | Auto-rollback batch immediately |
| Post-deploy crawl-diff shows unintended noindex/canonical/robots/meta change, or change bled onto unintended pages | Auto-rollback batch immediately |
| robots.txt or sitemap unfetchable (Google halts crawling within 12 h of robots 5xx [2]) | Auto-restore last-known-good file + page operator |
| Previously-indexed changed page reported not indexed for >48 h (URL Inspection) | Auto-rollback that change |
| GSC structured-data / enhancement errors spike on changed pages | Auto-rollback the schema changes |
| Manual action appears in GSC | Freeze ALL automation site-wide + human escalation (no public API for manual actions — requires UI/email monitoring; flag as an operational gap) |

**Tier 2 — Statistical verdicts (at window end; effect vs counterfactual):**

| Evidence | Verdict |
|---|---|
| Clicks effect ≥ 0, or interval includes 0 with point estimate ≥ −5% | **KEEP** |
| Clicks down >20% vs counterfactual, 90% credible interval excludes 0, no overlapping exogenous event | **ROLLBACK** |
| Impressions stable but CTR down >15% relative for ≥14 d (metadata changes) | **ROLLBACK** (snippet regression [5]) |
| Position worsened >3.0 absolute on the page's top-5 queries while control pages' positions stable | **ROLLBACK** |
| Interval includes 0, point estimate between −5% and −20%, trend worsening | **EXTEND** once (+50% window), then apply class default |
| Underpowered after pooling | `insufficient_data` → class default |

**Class defaults (the asymmetry rule):** *correctness-class* changes (alt text, valid schema, fixed links, de-duplicated metadata — objectively right by external standards) default **KEEP** on inconclusive evidence; *opinion-class* changes (titles, H1s, content edits, added internal links) default **ROLLBACK** on inconclusive-negative and KEEP only on inconclusive-flat. Rationale: rolling back a correct fix reintroduces a defect; rolling back an opinion costs nothing but the forgone (unproven) uplift — and SEO testing practice shows a large share of well-intended changes are negative or inconclusive (SearchPilot publishes winning/negative/inconclusive case-study categories precisely because all three are common [14]).

**Priority ordering when signals conflict:** technical > indexing > clicks > position > CTR > conversions. Conversions are the noisiest and act only as a veto on pages above ~1% of site clicks.

---

### 6. Dangerous-actions inventory (SPEC §23)

| # | Action | Worst credible outcome | Evidence/mechanism | Handling |
|---|---|---|---|---|
| 1 | robots.txt edit | Entire site blocked from crawling; 24 h cache means even instant rollback leaves a bad file live up to a day; 5xx serves halt all crawling within 12 h [2] | Google robots.txt spec | HIGH, deny-list; synthetic monitor + last-known-good auto-restore |
| 2 | noindex insert/remove | Silent de-indexing of pages/sections | Indexing directives | HIGH, deny-list |
| 3 | Mass canonical rewrite | Consolidates signals to wrong URLs; de-indexes the "duplicates" | [1][6] | HIGH, deny-list |
| 4 | Mass redirects / URL restructuring | Site-move-class event: weeks of fluctuation, months to stabilize, redirects must persist ≥1 year [1][27] | Google site-move doc | HIGH, deny-list |
| 5 | Page deletion (404/410) | Permanent traffic loss; recovery requires reindexing from scratch | — | HIGH, deny-list |
| 6 | Sitemap replacement | Wrong/partial discovery signals; masks real URLs | [36] | MEDIUM-HIGH; diff-validated against crawl |
| 7 | Site-wide template edits (nav/footer/header) | Every page's internal-link graph changes at once; hydration/render breakage on JS frameworks | Blast radius | HIGH via M_scope=2.0 |
| 8 | Mass internal-link injection | Link-scheme appearance; UX damage | Link spam policy [3] | Cap ≤3 added links/page, velocity-capped |
| 9 | Structured data at scale | "Spammy structured markup" manual action | [3] | Validate against schema.org + Google rich-result tests; only mark up visible content |
| 10 | Content rewriting at scale / mass page generation | **Scaled content abuse** — "many pages generated for the primary purpose of manipulating search rankings and not helping users," explicitly including AI-generated pages [3]; enforcement active (Aug 2025, June 2026 spam updates [24][26]); recovery takes months [24] | Google spam policies | Velocity caps; net-new pages NEVER auto-published (draft → human) |
| 11 | Publishing third-party/affiliate sections | **Site reputation abuse** — applies regardless of first-party involvement since Nov 2024 [7][23] | Google policy | Out of scope for automation entirely |
| 12 | Faking freshness (touching dates/lastmod without substantive change) | Deceptive-practice signal; Google uses `<lastmod>` only "if it's consistently and verifiably accurate" — inflating it burns the site's lastmod trust [3][36] | Prohibited by validator |
| 13 | hreflang restructuring | Broken international targeting, silent | — | HIGH |
| 14 | Server-config changes (.htaccess, next.config redirects/headers) | Can 500 the whole site; interacts with robots/redirect handling | [2] | HIGH; only via PR with CI smoke tests |
| 15 | Partial batch application (CMS API fails mid-batch) | Inconsistent site state; canonical/link graphs half-updated | WP/Shopify REST have no cross-object transactions | Per-object verify + recorded partial state + auto-repair queue |
| 16 | Applying during a Google update rollout | Attribution destroyed; change coupled to algorithmic volatility | [5][24] | Auto-freeze window |
| 17 | Exhausting GSC quotas (1,200 QPM/site; URL Inspection 2,000/day/site [8]) | Monitoring blackout — flying blind post-change | API limits | Quota budgeter; changed-URLs-only inspection |
| 18 | Git force-push / history rewrite on customer repo | Destroys customer work | — | Prohibited token scope; PR-only workflow |

---

### 7. Google policy risk and how the design avoids it

**The policy landscape (verified current to mid-2026):**

- **March 2024:** three spam policies added — *scaled content abuse* ("many pages generated for the primary purpose of manipulating search rankings and not helping users" — explicitly including "using generative AI tools… to generate many pages without adding value"), *site reputation abuse*, *expired domain abuse* [3].
- **AI content per se is allowed.** Google's helpful-content guidance permits AI/automation "to assist content creation" for people-first purposes, asks that automation use be self-evident/disclosed, and draws the line at: "If you use automation, including AI-generation, to produce content for the primary purpose of manipulating search rankings, that's a violation of our spam policies" [4].
- **November 2024:** site reputation abuse tightened — third-party content exploiting host signals violates *regardless of first-party involvement or oversight*; enforced by both manual actions and algorithmic systems [7][23].
- **2025:** August 2025 spam update strengthened SpamBrain against thin/near-duplicate/programmatic content sets [26].
- **2026:** June 24 2026 spam update — SpamBrain improvement pass; explicitly does *not* target link spam or site reputation abuse; no new categories; a May 2026 clarification added AI-answer/citation manipulation as spam; Google's recovery language: improvement comes "over a period of months" of demonstrated compliance [24]. Nov 2025 EU DMA probe into the site-reputation-abuse policy creates EU-enforcement uncertainty but the policy remains active [23].

**Exposure analysis for this platform:**

1. **Metadata at scale (titles, descriptions, alt) — low policy risk.** These are not "pages generated"; they optimize existing pages users already visit. The scaled-content policy targets page *generation* without value [3]. Residual risk is quality (templated, keyword-stuffed metadata) — handled by lexical validators and the velocity cap.
2. **Content updates / FAQ insertion — the real exposure.** Auto-writing body content across many pages at high velocity is structurally similar to what SpamBrain targets [3][26]. Mitigations built into the scoring system: content changes are B=40 (never LOW ⇒ never auto-applied — always a human-merged PR); per-site 7-day change budget; FAQs only "where genuinely useful" (SPEC §7) with a relevance validator; content must derive from the page's existing topic + verified sources, never free generation.
3. **Net-new page creation (content gaps) — never autonomous.** The platform drafts; a human reviews, edits, takes ownership, publishes. This is the single brightest policy line: autonomous mass-publishing of AI pages is the *definition* of scaled content abuse [3].
4. **Site reputation abuse — architecturally out of scope.** The platform must refuse to create/optimize third-party sponsored/affiliate sections on customer sites; post-Nov-2024, "we supervised it" is no defense [7][23].
5. **Auditability as a policy asset.** The change ledger *is* the disclosure mechanism [4]: every AI change carries model, prompt version, reason, and human-approval trail — exactly what a site owner needs if they ever face a manual-action review.
6. **Asymmetric loss, again:** a spam-update hit costs months of recovery [24] and some penalties (link schemes) are described as permanent [24]. This justifies the conservative default: when policy exposure is uncertain, the action is MEDIUM minimum and velocity-capped.

---

## Options compared

### A. Risk-scoring architecture

| Option | How it works | Pros | Cons | Verdict |
|---|---|---|---|---|
| Static rule table only | Change type → tier, done | Simple, explainable, matches SPEC tiers | Ignores blast radius/traffic; a title change on the homepage scores like one on a dead page | Insufficient alone |
| **Deterministic formula + deny-list + earned trust (recommended)** | §1.3 formula; hard overrides; trust decay | Explainable (auditable arithmetic), tunable, encodes blast radius + value-at-stake + velocity; safe by floor | Hand-set weights need periodic calibration | **Recommended for v1** |
| ML-learned risk model | Train on ledger outcomes (kept/rolled-back) | Learns real risk from data | Cold start (no ledger yet); unexplainable to clients; drifts | Revisit after ~1k labeled outcomes |

### B. Impact-measurement method

| Method | Data needs | Sensitivity | Confounder handling | Cost | Verdict |
|---|---|---|---|---|---|
| Naive pre/post | 2 windows of GSC | Poor | None — fails on seasonality/updates [5] | Free | Rejected |
| YoY delta-of-deltas | 13+ months warehoused GSC | Fair | Annual seasonality only | Free | Fallback |
| **Control pages + BSTS/CausalImpact (recommended)** | 90 d pre-period + untouched similar pages [16] | Good | Seasonality, trends, site-wide shocks cancel via controls [13][16] | Open-source, cheap compute | **Recommended** |
| Proprietary NN counterfactual (SearchPilot-style) | Large traffic; vendor | Best-in-class claimed (detects smaller uplifts) [13] | Trained-in seasonality/update handling | Build cost high / vendor lock | Aspirational v3 |
| CUSUM on residuals | Daily series only | Early but coarse | None by itself — run on *residuals* vs forecast [18][19] | Trivial | **Adopt for guardrails only** |

### C. Rollback mechanism per channel

| Channel | Mechanism | Gotchas |
|---|---|---|
| GitHub (Next.js/React) | `git revert` of the batch merge SHA → auto-PR → CI → deploy | Merge conflicts if later commits touched the same lines ⇒ drift check + human escalation; revert PR of an all-LOW batch may auto-merge |
| WordPress REST | Replay stored pre-image per object (posts/meta via revisions API where available) | No cross-object transactions ⇒ per-object verify + partial-state ledger |
| Shopify API | Pre-image writes to metafields/pages/theme assets | Theme asset edits may be blocked on newer themes; API version pinning |
| All | Rollback is a new ledger change; takes a recrawl to take SEO effect; 30-day page freeze after | [29][30] |

---

## Recommendation & why

1. **Two-axis confidence×risk decision matrix** (§1.5) with the deterministic risk formula, hard deny-list floors for the SPEC §14 HIGH list, per-site velocity budgets, and earned-trust decay. Why: it is *explainable* (client requirement, SPEC §3), it directly encodes the client's tier taxonomy, and every input is auditable arithmetic — no black box between "AI proposed" and "system applied."
2. **Append-only, event-sourced change ledger with batch-level rollback units, content-addressed before/after, and a mandatory drift check before rollback** (§2). Why: the ledger is simultaneously the audit trail, the trust-score substrate, the velocity governor, and the policy-compliance record.
3. **Two-phase monitoring: guardrails (0–7 d; crawl-diff, URL Inspection, HTTP/CI, CUSUM on fresh GSC) + statistical verdicts (14–90 d by change type) with the clock starting at verified recrawl.** Why: the latency chain (Google-documented recrawl/indexing of days-to-weeks [29][30], change visibility hours-to-months [31] + GSC 2–3 d lag [12] + SERP settling 2–4 wk [1][27]) makes any single fixed window wrong in both directions; catastrophes must be caught in hours, uplift verdicts need weeks. Per-tier latency constants are priors only until POC #8 measures each site's real recrawl CDF (§3.4).
4. **Counterfactual measurement via untouched control pages + BSTS (CausalImpact), cohort-pooled for long-tail pages, with YoY fallback and an exogenous-event calendar.** Why: it is the only open-source-feasible method that survives seasonality and Google updates [5][13][16], and the platform gets control pages for free by construction.
5. **Asymmetric KEEP/ROLLBACK defaults** (correctness fixes default KEEP; opinion changes default ROLLBACK on inconclusive-negative). Why: rollback of an objectively-correct fix reintroduces a defect; industry testing shows negative/inconclusive outcomes are routine [14].
6. **Policy compliance by construction**: content changes can never auto-apply; net-new pages are never auto-published; per-site change budgets; automation freeze during update rollouts; full AI disclosure trail. Why: enforcement is active and recovery costs months [24][26]; the March 2024 scaled-content policy names AI page generation explicitly [3].

---

## Risks & limitations

- **Attribution is fundamentally probabilistic.** Even with controls, page-level verdicts on <10 clicks/day pages are underpowered; the system must be honest about `insufficient_data` verdicts rather than manufacturing certainty. Google itself warns changes may produce no noticeable impact [5].
- **Rollback ≠ undo.** A rolled-back page returns to its prior HTML, but Google must recrawl it (same days-to-weeks latency [29][30]), and any interim ranking loss may persist for weeks; on redirects/canonicals, signal consolidation may not cleanly reverse [1][6]. The ledger must set expectations ("rollback applied; SEO state recovery expected in N–M days").
- **The recrawl-latency tiers are planning priors, not established facts.** Google publishes only wide ranges (days-to-weeks for crawling [29], "a day or so … much longer" for indexing [30], hours-to-months for change visibility [31]) and explicitly no per-tier intervals [32]; no public study measures update-recrawl latency for modified already-indexed pages (§3.4). Any document downstream of this one must not quote 6–48 h / 3–7 d / 10–14 d as fact — they are placeholders until POC #8 produces per-site measured CDFs. Design consequence already absorbed: the clock starts at observed recrawl, so wrong priors cost polling efficiency, never verdict correctness.
- **GSC is the only ranking ground truth and it is lagged, quota-bound, and occasionally broken** (2–3-day lag that grew in 2025 [12]; incident delays of 5–7 days [10]; 50k rows/day export cap and ~16-month retention forcing a warehouse [8][9]; URL Inspection 2,000/day/site [8]). A third-party rank tracker is a partial hedge at extra cost.
- **Title-change effects are attenuated by Google's rewriting** (61.6% base rate; length-dependent up to 99.9% [22]) — the platform must verify what Google actually displays before judging a title test, or it will roll back changes Google never showed.
- **CUSUM/threshold tuning is per-site work**; a single global configuration will either page constantly or miss drifts [18][19]. Ship conservative defaults + per-site auto-tuning from the first 60 days of baseline.
- **Policy environment is moving** (site-reputation-abuse under EU DMA investigation since Nov 2025 [23]; May 2026 AI-answer-manipulation clarification [24]). The dangerous-actions inventory and content-velocity caps need a quarterly review cadence, not a one-time design.
- **Self-reported LLM confidence is recorded but untrusted by design**; if the client insists on using it as a primary gate, that is a documented disagreement.
- **No public API for GSC manual actions** — the strongest "stop everything" signal requires UI/email monitoring; this is an operational gap to surface in the architecture doc.

---

## Sources

1. Google Search Central — Site moves with URL changes: https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes
2. Google Search Central — How Google interprets robots.txt (caching, 5xx handling): https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
3. Google Search Central — Spam policies for Google web search: https://developers.google.com/search/docs/essentials/spam-policies
4. Google Search Central — Creating helpful, reliable, people-first content (AI guidance): https://developers.google.com/search/docs/fundamentals/creating-helpful-content
5. Google Search Central — Debugging drops in Google Search traffic: https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops
6. Google Search Central — Redirects and Google Search: https://developers.google.com/search/docs/crawling-indexing/301-redirects
7. Google Search Central Blog — Updating our site reputation abuse policy (Nov 2024): https://developers.google.com/search/blog/2024/11/site-reputation-abuse
8. Google — Search Console API usage limits (re-verified 2026-08-10: URL Inspection 2,000 QPD + 600 QPM per property; Search Analytics 1,200 QPM): https://developers.google.com/webmaster-tools/limits
9. RankStudio — Google Search Console API guide (50k rows/day, 16-month retention, dataState): https://rankstudio.net/articles/en/google-search-console-api-guide
10. GSC Wizard — Search Console data delay FAQ: https://www.gscwizard.com/faq/google-search-console-data-delay.html
11. ThatWare — Search Console API hourly data (April 2025): https://thatware.co/search-console-api-gets-a-power-boost/
12. Google Search Central Community — API data delay grew from 1 day to 3 days: https://support.google.com/webmasters/thread/394920643
13. SearchPilot — The math behind SearchPilot (smart bucketing, NN counterfactual, credible intervals): https://www.searchpilot.com/resources/blog/the-math-behind-searchpilot-how-seo-a/b-testing-actually-works
14. SearchPilot — SEO A/B test case studies (winning/negative/inconclusive): https://www.searchpilot.com/resources/case-studies
15. ConvertMate — SEO A/B testing best practices (4–6-week runtimes): https://www.convertmate.io/blog/seo-ab-testing
16. CausalImpact — official documentation (assumptions for valid inference): https://google.github.io/CausalImpact/CausalImpact.html
17. Brodersen et al. — Inferring causal impact using Bayesian structural time-series models: https://arxiv.org/abs/1506.00356
18. SignalSharp — CUSUM algorithm documentation (parameters, tuning): https://emmorts.github.io/SignalSharp/docs/detection/cusum.html
19. Towards Data Science — Probabilistic CUSUM for change point detection: https://towardsdatascience.com/probabilistic-cusum-for-change-point-detection-121f793ab3a1/
20. MasterSEOTool — Google reindex time in 2026 (6–48 h / 3–7 d / 10–14+ d; trigger strengths) — **low-authority practitioner blog; figures downgraded to planning priors, see §3.4 and [29]–[34]**: https://www.masterseotool.com/blog/google-reindex-time-2026/
21. CrawlWP — How long before Google indexes a new website/page — **low-authority practitioner blog; same downgrade as [20]**: https://crawlwp.com/how-long-before-google-index-new-website-page/
22. Zyppy (Cyrus Shepard) — Google title tag rewrite study (61.6% of 80,959 URLs): https://zyppy.com/seo/title-tags/google-title-rewrite-study/
23. Myoho Marketing — Site reputation abuse policy vs EU DMA probe (Nov 2025; 2026 status): https://myohomarketing.com.au/googles-site-reputation-abuse-spam-policy-vs-eu-antitrust-what-the-dma-probe-means-for-seo-in-2026/
24. Digital Applied — Google June 2026 spam update rollout guide (targets, non-targets, months-scale recovery): https://www.digitalapplied.com/blog/google-june-2026-spam-update-rollout-site-owner-guide
25. Practical Ecommerce — Google's spam updates explained (Aug 2025 update context): https://www.practicalecommerce.com/googles-spam-updates-explained
26. RebelMouse — Understanding the impact of Google's August 2025 spam update: https://www.rebelmouse.com/google-spam-update-2025
27. Webnode — Website migration SEO checklist (4–6-wk same-domain stabilization; 2–3-month domain change): https://www.webnode.com/blog/website-migration-seo-checklist/
28. Search Engine Journal — Migration hangover traffic drops (first 2–4 weeks heaviest): https://www.searchenginejournal.com/what-is-a-migration-hangover-traffic-drop-how-do-you-avoid-it/575102/
29. Google Search Central — Ask Google to recrawl your URLs ("Crawling can take anywhere from a few days to a few weeks"; recrawl requests quota-limited; repeat requests don't accelerate): https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl
30. Google Search Console Help — About the URL Inspection tool ("Indexing typically takes only a day or so, but can take much longer in some cases"; bulk "up to a week or two"; shows Last crawl timestamp): https://support.google.com/webmasters/answer/9012289
31. Google Search Central — SEO starter guide, "How long until I see impact in search results?" ("Some changes might take effect in a few hours, others could take several months"): https://developers.google.com/search/docs/fundamentals/seo-starter-guide
32. Google Search Central — Crawl budget management for large sites (recrawl frequency = perceived inventory × popularity × staleness; no numeric intervals published; "crawled the same day that they are published" healthy-site test; 1M+/weekly and 10k+/daily concern thresholds): https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget
33. Vercel + MERJ — How Google handles JavaScript throughout the indexing process (100k+ verified Googlebot fetches, Apr 2024; crawl→render p50 10 s / p90 ~3 h / p99 ~18 h; query-string URLs slower): https://vercel.com/blog/how-google-handles-javascript-throughout-the-indexing-process
34. Search Engine Journal — How long before Google indexes my new page (Mueller: "several hours to several weeks", most good content "within about a week"; Rudzki/Onely: 83% of pages indexed within first week on average, stragglers to 8 weeks, 16% of valuable indexable pages never indexed): https://www.searchenginejournal.com/how-long-before-google-indexes-my-new-page/464309/
35. Google — Indexing API quickstart (restricted to JobPosting/BroadcastEvent pages; default quota 200/day — not usable to accelerate general SEO recrawl): https://developers.google.com/search/apis/indexing-api/v3/quickstart
36. Google Search Central — Build and submit a sitemap (`<lastmod>` used "if it's consistently and verifiably accurate"; `<changefreq>`/`<priority>` ignored): https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
37. IndexNow — FAQ (participating engines: Amazon, Bing, Naver, Seznam.cz, Yandex, Yep — Google absent, so IndexNow cannot accelerate Google recrawl): https://www.indexnow.org/faq
