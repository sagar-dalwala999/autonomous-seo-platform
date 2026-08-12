# Automated Competitor Analysis (SPEC §10) — Research

Lane scope: how the platform automatically analyzes SERP competitors for a target keyword and
compares title, H1/H2, content, topics, entities, questions, internal links, structured data, and
content depth against the customer page — and how it decides which gaps are genuine opportunities.

Research date: August 2026. All prices/quotas verified against current sources; the SERP-data
legal landscape changed materially in Dec 2025–Jul 2026 (see §Legal).

---

## Summary

**Recommended pipeline (per important keyword):**

1. **SERP acquisition**: DataForSEO SERP API (Advanced endpoint, standard queue, $0.60/1k SERPs)
   with `people_also_ask_click_depth: 2` (+$0.0003/keyword) to pull top-10/20 organic results +
   People-Also-Ask questions + related searches in one call [1][2][9].
2. **Competitor page acquisition**: tiered fetching — DataForSEO OnPage *Instant Pages* /
   *Content Parsing* first ($0.000125/page basic, $0.00125 with JS rendering; 20 URLs per
   request, cross-domain) [6][7][8]; escalate only failed fetches to an anti-bot vendor
   (Firecrawl stealth ≈ $0.003/page, Zyte $0.13–$16/1k dynamic) [23][24]. Do **not** build a
   stealth Playwright fleet: out-of-the-box headless success is now <20% on protected targets and
   the arms race is a full-time job [22].
3. **Comparison layer**: deterministic parsers for title/H1/H2/H3, JSON-LD, internal-link and
   word counts; **one cheap-LLM structured pass per page** (Gemini Flash-Lite class,
   $0.10/$0.40 per M tokens [15]) for topics, entities, questions answered, and unique claims —
   this replaces Google Cloud NL API (≈25× more expensive per page for entities, and its v2
   dropped salience + Wikipedia metadata) [12]. GLiNER (Apache-2.0, 50–300M params, zero-shot
   NER that beats ChatGPT-class models on NER benchmarks, CPU-viable) is the deterministic
   open-source fallback [13].
4. **Gap detection**: chunk both sides (200–400 tokens), embed with `text-embedding-3-small`
   ($0.02/M tokens — cost-negligible) [14], cluster competitor chunks, and flag clusters covered
   by ≥3 of the top 10 competitors whose max cosine similarity to any customer chunk is below
   ~0.75 [26].
5. **The genuine-opportunity filter** (the client's crucial ask): a gap survives only if it
   passes five gates — intent match, demand evidence, consensus weighting, business relevance,
   and a cannibalization check against the site graph + GSC (§Findings F6).

**Cost: ≈ $0.02–$0.05 per keyword fully analyzed** (SERP + 10 pages fetched + entities + gap
analysis), i.e., ~$35/month for 1,000 keywords with monthly refresh. Live-mode SERPs, browser
rendering, and unlocker-grade fetching push the ceiling to ~$0.10/keyword (§Costs).

**Top risk**: SERP-provider legal exposure. Google deployed anti-bot "SearchGuard" in Jan 2025
and sued SerpApi on **DMCA §1201** grounds on **Dec 19, 2025**; Reddit's parallel DMCA suit
against SerpApi/Oxylabs (filed Oct 22, 2025) **largely survived a motion to dismiss on
Jul 31, 2026** [17][18]. Architect a provider-abstraction layer with at least two interchangeable
SERP vendors and treat SERP data as replaceable, not foundational.

---

## Findings

### F1 — Getting competitor pages: SERP APIs (who ranks for the keyword)

The SERP API market is commoditized on price but now bifurcated on legal risk:

- **DataForSEO SERP API**: $0.60/1k SERPs standard queue (task-post, minutes of latency),
  $1.20/1k priority, $2.00/1k live; a "SERP" = 10 results; pay-as-you-go, $50 minimum deposit,
  credits never expire [1][2]. The *Advanced* endpoint returns parsed SERP features including
  People-Also-Ask, related searches, AI Overviews (AI Overview capture +$0.0006/keyword via
  `load_async_ai_overview`) [2]. `people_also_ask_click_depth` (1–4) expands PAA by simulating
  clicks at **+$0.00015 per click**, refunded if PAA is absent [9].
- **Serper.dev**: $0.30–$1.00/1k queries (prepaid packs $50–$3,750; credits expire after
  6 months; 2,500 free credits; 11–100 results = 2 credits) [3][4]. Fastest/cheapest; returns
  PAA and related searches; no page-content fetching.
- **SerpApi**: $9–$25/1k searches depending on plan ($25/mo = 1,000 searches … $275/mo =
  30,000); unused searches expire monthly [5]. 10–30× DataForSEO's price; its differentiator was
  a "Legal US Shield" — now the named defendant in both the Google and Reddit suits (§Legal).
- **Bright Data SERP API**: $1.50/1k pay-as-you-go ($1.30/1k on the $499/mo Scale plan),
  5,000 records/mo free tier, billed on successful requests only [30].
- **Firecrawl /search**: 2 credits per 10 results (≈$0.0013–$0.0064 per search depending on
  plan) — attractive because the same vendor also fetches/renders the result pages [24].

Context that matters for vendor strategy: **Microsoft retired the official Bing Search APIs on
Aug 11, 2025** (replacement is Azure-locked "Grounding with Bing Search", reported 40–483% more
expensive) [29], and Google offers no official SERP API. So *every* SERP feed is scraped and
carries the §Legal provider risk — multi-vendor abstraction is mandatory, not optional.

### F2 — Getting competitor pages: fetching/rendering HTML and the anti-bot wall

What actually blocks a fetcher in 2026:

- **Cloudflare fronts 23.4% of all websites** (83.5% of sites with a known reverse proxy,
  W3Techs Aug 2026) [20]. Since July 2025 Cloudflare **blocks AI crawlers by default for new
  domains** and runs pay-per-crawl; from **Sept 15, 2026** new/updated zones default to "allow
  search, block AI-training/agent use on pages with ads", and mixed-use crawlers get blocked on
  ad-carrying pages [21]. AI-related bot traffic grew >300% Jan 2025→Mar 2026, hardening
  defenses everywhere [21].
- Measured success rates: out-of-the-box Playwright/Puppeteer has fallen **below 20%** on
  high-value protected targets; stealth-patched browsers reach 50–70% against basic Cloudflare
  configs but fail against high-security modes; the best current open stack (Camoufox +
  rotating residential proxies) measured 91% on Cloudflare standard / 78% on Enterprise in
  Apr 2026; commercial unlockers claim 94–98% [22].
- **The saving grace for this use case**: competitor pages come *from the SERP* — they rank in
  Google, therefore they must serve Googlebot and near-universally allow search-shaped, polite
  crawling. Ordinary blog/e-commerce/content pages (the overwhelming majority of SEO
  competitors) are fetchable with a plain rendered fetch; the hard 10–20% are big marketplaces
  (Amazon-class), news paywalls, and Cloudflare-Enterprise storefronts.

Practical fetch options and prices:

- **DataForSEO OnPage Instant Pages / Content Parsing**: purpose-built for exactly this — pass
  up to 20 arbitrary URLs (different domains) per request and get back parsed structure:
  headings, main text, anchors + URLs of embedded links, tables [6][7]. $0.000125/page base;
  +$0.000375 to load resources; **$0.00125/page with JavaScript rendering**; $0.00425/page for
  full browser rendering with Lighthouse/CWV [8]. This is the "SERP-provider-parsed content"
  path the client asked about: same vendor, no separate anti-bot stack, and the parsing
  (headings/anchors/text) is already SEO-shaped.
- **Firecrawl**: 1 credit/page (≈$0.0006–$0.0032 depending on plan), stealth mode 5 credits;
  returns markdown/HTML/structured JSON [24].
- **ZenRows** ≈$4.05/1k basic, $7.47/1k protected; **ScrapingBee** $49/mo for 250k credits with
  multipliers (JS ×5, premium residential ×25 → a hard page ≈ 75 credits ≈ $0.015);
  **Zyte API** dynamic pricing $0.13–$16+/1k by domain difficulty [23].

**Design: a 3-tier fetch ladder with caching.** Tier 1 basic HTML ($0.000125) → Tier 2 JS-rendered
($0.00125) → Tier 3 unlocker vendor (~$0.005–0.015) only on failure; cache competitor page
parses 30 days, SERPs 7–30 days depending on keyword priority. Pages that still fail Tier 3 get
dropped from the comparison set (log it) rather than fought — with 10 candidates per keyword,
losing 1–2 does not change the gap statistics.

### F3 — Entity extraction: LLM vs Google NL API vs open-source NER

| Criterion | Cheap LLM (structured output) | Google Cloud NL API | Open-source NER (GLiNER / spaCy) |
|---|---|---|---|
| Cost per 3,000-word page | ≈$0.0005–0.002 (Flash-Lite class: $0.10/M in, $0.40/M out) [15] | ≈$0.015 (≈15 units × $1.00/1k units after 5k free units/mo) [12] | ≈$0 marginal (self-host; GLiNER runs on CPU) [13] |
| Entity types | Arbitrary + topics + questions + claims in one pass | Fixed taxonomy; v1 has salience + Wikipedia URLs; **v2 (PaLM-based) dropped salience and wikipedia_url** [12] | GLiNER: arbitrary types via natural-language labels, zero-shot; spaCy: fixed 18-type OntoNotes |
| Quality | Best on messy web text; nondeterministic | Good on clean prose | GLiNER 50–300M outperforms ChatGPT-class models on zero-shot NER benchmarks; ≈UniNER-13B at 140× smaller [13] |
| Ops burden | API dependency; model retirements (2.5 Flash-Lite retires Oct 16, 2026 → 3.1 Flash-Lite $0.25/$1.50) [15] | API dependency; product stagnant | Model hosting, batching, updates |

**Verdict**: LLM-first. One structured-output call per page returns entities *and* topics *and*
questions *and* unique data points — four analyses for ~$0.002, versus the NL API charging ~7×
that for entities alone and losing salience in its current version. GLiNER is the right
deterministic/cheap fallback for high-volume re-scans and for validating LLM drift; skip spaCy's
fixed taxonomy (misses product/brand/domain entities that matter for SEO comparison).

### F4 — Topic & question mining (People-Also-Ask, autocomplete)

- **PAA via the SERP call itself**: DataForSEO Advanced returns the PAA block, and
  `people_also_ask_click_depth` 1–4 expands it (+$0.00015/click, auto-refunded when absent) [9].
  Serper returns PAA at no extra credit; autocomplete costs 1 credit [3][4].
- **AlsoAsked** (dedicated PAA-tree tool): $12/mo (100 credits), $23/mo (300), $47/mo (1,000);
  API on all tiers; Deep Search returns ~150 questions/query [11]. Good depth, but at
  ~$0.05–0.12/query it is 100–300× the marginal cost of PAA-in-SERP; use only for flagship
  keywords or content-brief generation.
- **Question harvesting from competitor pages**: headings ending in "?", FAQPage JSON-LD, and
  the LLM page-pass ("questions this page answers") — free by-products of F2/F3.
- Aggregate all questions per keyword into a deduplicated cluster set (embed + cluster);
  "questions competitors answer that we don't" is one of the highest-precision gap types because
  each question is an atomic, verifiable coverage unit and often maps directly to an
  `ADD_FAQ`/`ADD_SECTION` action (SPEC §7).

### F5 — Embedding-based content-gap analysis + content-depth metrics

Method (validated as current SEO practice by multiple sources [26]):

1. Extract main content only (strip nav/boilerplate — the DataForSEO content-parsing output or
   trafilatura/readability locally); chunk at 200–400 tokens along heading boundaries.
2. Embed customer chunks + all competitor chunks. `text-embedding-3-small` at $0.02/M tokens
   ($0.01/M via Batch API) makes this cost-invisible: ~11 pages × ~4k tokens ≈ 44k tokens ≈
   **$0.0009 per keyword** [14].
3. Cluster the competitor chunks (agglomerative/HDBSCAN over cosine distance; in-practice
   thresholds ≈0.75 for "same topic" [26]).
4. For each cluster, compute (a) **coverage breadth** = how many distinct competitor pages have
   a chunk in it, weighted by rank position; (b) **our coverage** = max cosine similarity of any
   customer chunk to the cluster centroid. Clusters with breadth ≥3-of-10 and our-coverage
   <0.75 are candidate gaps → labeled by the LLM (topic name, representative questions/entities).
5. **Direction matters**: also compute the reverse (covered-by-us-not-by-them) — that is the
   customer's differentiation, which the optimizer must *preserve*, not homogenize away.

**Content-depth metrics** — word count alone is a known-weak signal; use a vector:
topic-cluster count covered (from step 4), heading-structure depth (H2/H3 counts), distinct
entities, questions answered, tables/media counts, schema types present, internal-link counts
(from parsed anchors [6]), and an **information-gain score**: the share of a page's content that
is *not* semantically present in the union of competitor pages — the concept traces to Google's
"Contextual Estimation of Link Information Gain" patent, and a 150-page measurement study found
the median top-3 page is only moderately original, while pages with ≥3 unique data points were
4× more likely to be cited [25]. Consequence for the decision engine: recommendations must not
converge the page onto the competitor consensus; close *demanded* gaps while keeping/raising
unique material.

### F6 — The crucial filter: genuine opportunity vs noise

A raw "they cover it, we don't" cluster is noise-prone (boilerplate, tangents, different page
types). Five gates, applied in order (cheap → expensive), each producing an explainable score
for the SPEC §7 structured-action output:

1. **Search-intent match.** Classify the keyword's intent — DataForSEO Labs `search_intent`
   endpoint returns intent + probability for up to 1,000 keywords per call (informational /
   navigational / commercial / transactional), priced at ~$0.01/task + $0.0001/item [10][28] —
   and cross-check against SERP shape (shopping ads, PAA presence, result page types). Then
   check the *gap's* intent: if the gap cluster lives on competitors' informational blog posts
   but the customer URL is transactional (or vice versa), it is **not** an on-page opportunity
   for this URL — reroute it as a candidate *new-page* opportunity or drop it. Intent mismatch
   is the single biggest source of false-positive gaps.
2. **Consensus/breadth threshold.** Require the cluster to appear on ≥3 of the top-10 (or ≥2 of
   the top-5) ranked competitors, weighted by position. One competitor's tangent is noise; the
   consensus of what ranks is the signal.
3. **Demand evidence.** The gap must map to observable search demand: PAA questions [9], Google
   autocomplete [3], nonzero keyword volume, or existing GSC impressions on related queries.
   A topic no one searches for adds words, not clicks.
4. **Business relevance.** Score the gap-cluster centroid against a *business-context embedding*
   built from the site-understanding layer (SPEC §5: products, services, categories) plus a
   cheap-LLM yes/no with the customer's business description ("does covering X serve this
   business and this page's conversion goal?"). Kills the classic failure: a competitor's
   unrelated product line surfacing as a "gap".
5. **Cannibalization check.** Before recommending a new section/page, query the site graph and
   GSC: does another customer URL already rank or earn impressions for the gap queries? The
   GSC-native detection method — same query, ≥2 URLs with impressions, position/CTR split over a
   6–12-month window — is well-established and automatable at scale [27]. If a sibling page
   already owns the topic, the correct action is *internal link or consolidate*, never *duplicate
   coverage* (which would create the cannibalization the platform is supposed to fix).

Survivors become structured actions with the per-gate scores attached as the `reason` and
`confidence` inputs (SPEC §7/§14), e.g. `ADD_SECTION {topic, evidence: {breadth: 6/10,
intent_match: 0.92, demand: [queries], relevance: 0.88, cannibalization: none}}`.

### F7 — Comparing the structured elements

Deterministic, no AI needed: **titles/H1/H2** (length, keyword/entity presence, modifier
patterns across the top 10); **structured data** (parse JSON-LD/microdata from fetched HTML —
`extruct`-class libraries — and diff schema *types* and *required properties* against the
customer page: FAQPage, Product, HowTo, Article, Review counts across competitors); **internal
links** (competitor outbound-internal anchor counts and anchor texts come free in the
content-parsing `urls`/anchors arrays [6]; compare link density and anchor patterns). These
feed the same action generator (UPDATE_TITLE, ADD_SCHEMA, internal-link suggestions).

---

## Options compared

### SERP acquisition

| Provider | Price /1k queries | PAA | Latency | Legal posture (Aug 2026) | Notes |
|---|---|---|---|---|---|
| DataForSEO (standard) | **$0.60** | Yes, +$0.15/1k clicks depth 1–4 [9] | minutes (task queue) | Not currently a named defendant | Advanced parse incl. AI Overviews (+$0.60/1k) [1][2] |
| DataForSEO (live) | $2.00 | same | seconds | same | for on-demand UI flows [1] |
| Serper.dev | $0.30–$1.00 | Yes | ~1–2 s | Not currently named | credits expire 6 mo [3][4] |
| Bright Data | $1.30–$1.50 | Yes | seconds | Won Meta case (public-data scraping) [16]; named in Reddit-adjacent actions? No — Oxylabs is | billed on success [30] |
| SerpApi | $9–$25 | Yes | ~1–2 s | **Defendant: Google (DMCA, Dec 2025) + Reddit (Oct 2025, MTD denied Jul 2026)** [17][18] | "Legal US Shield" for customers; monthly quota resets [5] |
| Firecrawl /search | ~$1.30–$6.40 (2 credits/10 results) | partial | seconds | Not currently named | same vendor fetches pages [24] |

### Competitor-page fetching

| Option | Price/page | JS render | Anti-bot strength | Fit |
|---|---|---|---|---|
| DataForSEO Instant Pages/Content Parsing | $0.000125 base / $0.00125 JS / $0.00425 browser+CWV [8] | optional | moderate | **Tier 1–2 default**; SEO-shaped parse, 20 URLs/request [6][7] |
| Firecrawl | ~$0.0006–0.0032; stealth ×5 [24] | yes | good | Tier 2 alternative; markdown out |
| ScrapingBee | ~$0.001 base; hard page ≈ 75 credits ≈ $0.015 [23] | ×5 credits | good | Tier 3 |
| ZenRows | $4.05–$7.47/1k [23] | yes | good | Tier 3 |
| Zyte API | $0.13–$16+/1k, per-domain dynamic [23] | yes | excellent | Tier 3 for the hardest 1–2% |
| Own Playwright fleet | ~infra only | yes | **<20% stock; 50–70% stealth; 91% Camoufox+resi** [22] | Not recommended (maintenance + §Legal DMCA-circumvention optics) |

### Entity/topic extraction — see F3 table. Recommendation: LLM-first, GLiNER fallback, skip Google NL API.

---

## Recommendation & why

1. **DataForSEO as the primary data vendor** (SERP Advanced + PAA depth + Labs search-intent +
   OnPage Instant Pages/Content Parsing): one account covers SERP, questions, intent, and
   competitor-page parsing at the lowest verified prices in the market [1][2][6][8][9][10], with
   pay-as-you-go economics that match a per-customer SaaS COGS model. **But wrap every SERP call
   behind an internal `SerpProvider` interface with a second wired-up vendor (Serper or Bright
   Data)** — the Google-v-SerpApi and Reddit-v-SerpApi cases prove a provider can become
   radioactive or disappear inside a quarter [17][18].
2. **Tiered fetching with graceful degradation** (F2): never fight a wall; drop unfetchable
   competitors from the stats and record it. This keeps cost at ~$0.0015/page average and keeps
   the platform out of the DMCA-§1201 "circumvention" fact pattern that Reddit is currently
   winning on [17].
3. **One cheap-LLM structured pass per page + embeddings for the gap math** (F3/F5): the LLM
   does the *semantics* (entities, topics, questions, unique claims), embeddings do the
   *set arithmetic* (covered-by-them-not-by-us). This split is auditable, cheap
   (~$0.02–0.05/keyword), and every gap ships with numeric evidence — which the SPEC's
   confidence/risk engine (§14) needs.
4. **The five-gate genuine-opportunity filter (F6) is the product.** Everything upstream is
   commodity data; intent-match + demand + consensus + business-relevance + cannibalization is
   what separates "autonomous optimizer" from "noisy audit tool", and every gate is
   independently automatable with the data already purchased.

---

## Risks & limitations

1. **SERP-provider legal risk (existential, external).** Google deployed SearchGuard (JS
   challenges) in Jan 2025, disrupting even Semrush-class tools, then sued SerpApi on
   **Dec 19, 2025** (N.D. Cal., 5:25-cv-10826) under DMCA §1201 — statutory damages $200–$2,500
   *per act of circumvention* [18][19]. Reddit's suit (filed Oct 22, 2025 v. SerpApi, Oxylabs,
   AWMProxy, Perplexity; subpoenaed Google logs showed SerpApi alone accessed ~1.8B
   Reddit-containing SERPs in two weeks of Jul 2025) **largely survived dismissal on
   Jul 31, 2026** [17]. If these theories hold, every SERP vendor's cost/availability can change
   abruptly. Mitigations: provider abstraction + failover; keep per-keyword SERP frequency low
   (weekly/monthly, event-triggered); lean on GSC (first-party, fully legal) for
   rank/impression data so SERPs are only needed for *competitor identity and features*, not
   daily rank tracking; contractually pass provider risk to vendors; do not archive raw SERP
   HTML beyond the processing window.
2. **Scraping competitor sites — legal/ToS.** U.S. law is favorable for public, logged-out
   pages: hiQ v. LinkedIn established CFAA doesn't cover public pages (though hiQ ultimately
   lost on *contract* for logged-in scraping), and Meta v. Bright Data (Jan 2024) upheld
   logged-out public scraping because ToS bind account holders, not visitors [16]. Hard rules
   for the platform: never authenticate, never bypass paywalls, honor robots.txt (also required
   by Google's own ToS framing of "machine-readable instructions" [19]), respect blocks rather
   than escalating stealth (the Reddit case turns exactly on circumvention of technical
   measures [17]), store competitor text transiently for analysis only, and never let generated
   content copy competitor phrasing (copyright + the information-gain penalty [25]). EU: the
   DSM Art. 4 TDM exception permits mining *unless opted out* — Cloudflare-style machine-readable
   opt-outs are exactly such reservations, so honoring them is both prudent and cheap [21].
3. **Fetchability erosion.** Cloudflare's default AI-crawler blocking (Jul 2025) and its
   Sept 15, 2026 ads-page expansion [21] mean the fetchable share of competitor pages will keep
   shrinking at the margin. The SERP-provider-parsed-content path (Instant Pages) inherits the
   provider's evasion — and its legal risk. Budget for the Tier-3 share of fetches growing from
   ~10% toward ~25% over 2–3 years, and design gap statistics to be valid on partial competitor
   sets.
4. **LLM nondeterminism & drift.** Entity/topic extraction varies across model versions (and
   cheap models get retired fast — 2.5 Flash-Lite dies Oct 16, 2026 [15]). Pin model versions,
   snapshot extraction outputs per analysis run (SPEC §16 change history needs stable "before"
   evidence), and keep GLiNER as a regression baseline.
5. **False gaps despite the filter.** Intent classifiers are probabilistic (Labs returns
   probabilities, not certainty [10]); business relevance depends on the quality of the SPEC §5
   site model; PAA availability fluctuates per query. The filter reduces noise — it cannot zero
   it. Keep competitor-driven *content additions* in the MEDIUM-risk (PR-reviewed) band of the
   SPEC §14 automation ladder, never auto-applied; only metadata-level competitor insights
   (title patterns, schema-type adoption) belong in the auto-apply band.
6. **Unverified fine print.** DataForSEO minute-level rate limits and some Labs per-endpoint
   surcharges were not independently re-verified this cycle; the $0.10/$0.001 domain-batch
   pricing for Labs competitor endpoints comes from vendor docs [28]. Re-verify at contract time.

## Cost per keyword analyzed (worked estimate)

| Component | Cheap path | Premium path |
|---|---|---|
| SERP (Advanced, PAA depth 2) | $0.0009 (standard) [1][9] | $0.0023 (live) |
| Intent (batched 1,000/call) | ~$0.0001 [10][28] | ~$0.0001 |
| Fetch+parse 10 competitor pages | $0.00125–$0.0125 (basic→JS) [8] | ~$0.03 (browser render + 20% unlocker share) [8][23] |
| Embeddings (~44k tokens) | $0.0009 ($0.0004 batch) [14] | $0.0009 |
| LLM page passes + gap synthesis | ~$0.01–$0.02 [15] | ~$0.05 (larger model) |
| **Total / keyword** | **≈$0.02–$0.035** | **≈$0.08–$0.10** |

At scale (monthly refresh, cached pages): 100 keywords ≈ **$2–4/mo**; 1,000 ≈ **$20–50/mo**;
10,000 ≈ **$200–500/mo**. Caching competitor parses across keywords (the same top-10 URLs recur
heavily within a topic cluster) typically cuts the fetch line 40–60%.

## Sources

1. https://dataforseo.com/apis/serp-api/pricing — DataForSEO SERP pricing ($0.60/$1.20/$2.00 per 1k; SERP = 10 results)
2. https://nextgrowth.ai/dataforseo-api-guide/ — DataForSEO 2026 guide (queue prices, AI Overview surcharge, $50 minimum, credits never expire)
3. https://serper.dev/ — Serper pricing model, 2,500 free credits, PAA/autocomplete 1 credit
4. https://apiserpent.com/blog/serper-pricing-credits-explained — Serper $0.30–$1.00/1k, 6-month credit expiry, 2-credit tiers
5. https://costbench.com/software/web-scraping/serpapi/ — SerpApi plan grid ($25/1k … $275/30k, monthly reset)
6. https://docs.dataforseo.com/v3/on_page-content_parsing-live/ — Content Parsing Live (headings, text, anchors, urls arrays, table_content)
7. https://docs.dataforseo.com/v3/on_page-instant_pages/ — Instant Pages (up to 20 URLs/request, cross-domain)
8. https://dataforseo.com/help-center/cost-of-onpage-api-parameters — OnPage per-page costs ($0.000125 base; $0.000375 resources; $0.00125 JS; $0.00425 browser)
9. https://dataforseo.com/update/click-depth-for-paa-in-serp-api — PAA click depth 1–4, $0.00015/click, auto-refund
10. https://docs.dataforseo.com/v3/dataforseo_labs-google-search_intent-live/ — Labs search-intent endpoint (1,000 keywords, 4 intent classes + probabilities)
11. https://alsoasked.com/pricing — AlsoAsked $12/$23/$47 for 100/300/1,000 credits, API on all tiers; ~150 questions per Deep Search
12. https://nlpcloud.com/google-cloud-natural-language-nlp-api.html + https://cloud.google.com/natural-language — NL API entity pricing (~$1.00/1k units after 5k free) and v2 changes (no salience/wikipedia_url)
13. https://arxiv.org/abs/2311.08526 + https://arxiv.org/html/2605.10108v1 — GLiNER (50–300M params, zero-shot NER > ChatGPT-class; 2026 GLiNER-Relex extension)
14. https://tokenmix.ai/blog/openai-embedding-pricing — text-embedding-3-small $0.02/M, -large $0.13/M, Batch API half price
15. https://devtk.ai/en/models/gemini-2-5-flash-lite/ — Gemini 2.5 Flash-Lite $0.10/$0.40 per M tokens; retirement Oct 16, 2026; successor 3.1 Flash-Lite $0.25/$1.50
16. https://www.promptcloud.com/blog/is-web-scraping-legal/ + https://www.lection.app/blogs/hiq-labs-vs-linkedin-case-explained — hiQ v. LinkedIn, Meta v. Bright Data (Jan 2024), public-vs-ToS distinction
17. https://searchengineland.com/reddit-sues-perplexity-serpapi-scraping-google-463681 + https://cryptobriefing.com/reddit-serpapi-lawsuit-survives-dismissal/ — Reddit v. Perplexity/SerpApi/Oxylabs/AWMProxy (Oct 22, 2025; DMCA §1201; ~1.8B Reddit SERP accesses in 2 weeks; MTD largely denied Jul 31, 2026)
18. https://almcorp.com/blog/google-sues-serpapi-lawsuit-analysis/ — Google v. SerpApi (Dec 19, 2025, N.D. Cal. 5:25-cv-10826, DMCA §1201, SearchGuard, $200–$2,500 statutory damages per act)
19. https://policies.google.com/terms + https://wpseoai.com/blog/is-web-scraping-against-google/ — Google ToS automated-access prohibition; machine-generated traffic = spam-policy violation
20. https://w3techs.com/technologies/details/cn-cloudflare — Cloudflare on 23.4% of all websites; 83.5% of known reverse-proxy sites (Aug 2026)
21. https://techcrunch.com/2026/07/01/cloudflares-new-policy-pushes-ai-companies-to-pay-for-publishers-content/ + https://www.coronium.io/blog/closing-web-ai-crawler-blocking-pay-per-crawl-2026 + https://www.technology.org/2026/07/03/cloudflare-blocks-mixed-use-ai-crawlers/ — default AI-crawler blocking (Jul 2025), Sept 15 2026 ads-page defaults, pay-per-crawl → pay-per-answer, +300% AI bot traffic
22. https://nerdbot.com/2026/04/28/bypass-cloudflare-turnstile-in-2026-headless-browser-scaling-and-deep-dive-into-native-chromium-patching/ + https://blog.send.win/cloudflare-bypass-methods-2026/ + https://scrapfly.io/blog/posts/how-to-bypass-anti-bot-protection — measured headless success rates (<20% stock; 50–70% stealth; Camoufox 91%/78%)
23. https://www.zenrows.com/blog/best-web-scraping-apis-in-2026-benchmarked/ + https://www.scraperapi.com/comparisons/zenrows-vs-scrapingbee/ — ZenRows $4.05–$7.47/1k; Zyte $0.13–$16+/1k; ScrapingBee credit multipliers
24. https://affinco.com/firecrawl-pricing/ + https://fastcrw.com/blog/firecrawl-pricing-explained — Firecrawl 1 credit/page, stealth ×5, search 2 credits/10 results, plan grid
25. https://searchengineland.com/what-is-information-gain-seo-why-it-matters-429763 + https://api.on-page.ai/research/information-gain-study + https://www.semrush.com/blog/information-gain/ — information-gain patent lineage, 150-page originality study, ≥3 unique data points → 4× citation likelihood
26. https://ipullrank.com/vector-embeddings-is-all-you-need + https://www.screamingfrog.co.uk/seo-spider/tutorials/how-to-identify-semantically-similar-pages-outliers/ + https://sitebulb.com/resources/guides/beyond-cosine-similarity-testing-advanced-algorithms-for-seo-content-analysis/ — embedding/cosine methodology for gap analysis, ~0.75 same-topic thresholds
27. https://www.advancedgsc.com/blog/keyword-cannibalization-google-search-console + https://n8n.io/workflows/7237-detect-cannibalized-keywords-and-competing-pages-with-google-search-console/ — GSC cannibalization detection method (same query, multiple URLs, 6–12-month window) + automation template
28. https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api — Labs pricing (~$0.01/task + $0.0001/item; clickstream ×2; domain batches $0.1 + $0.001/domain)
29. https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement + https://ppc.land/microsoft-ends-bing-search-apis-on-august-11-alternative-costs-40-483-more/ — Bing Search APIs retired Aug 11, 2025; Azure-locked replacement 40–483% costlier
30. https://docs.brightdata.com/scraping-automation/serp-api/pricing-and-billing + https://costbench.com/software/web-scraping/bright-data/ — Bright Data SERP $1.50/1k PAYG, $1.30/1k Scale, success-only billing, 5k/mo free
