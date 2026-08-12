# Internal Linking Automation — Algorithm Design Research (SPEC §11)

Research lane deliverable for the autonomous SEO platform feasibility study. Covers candidate
generation, scoring, anchor selection, insertion mechanics, auto-insert criteria, prior art,
published algorithms, and post-change measurement. All claims cited; sources numbered at the end.

---

## Summary

**Recommended design: a three-channel candidate generator (exact-phrase mention scan → embedding
similarity → GSC-keyword matching), fused into a single opportunity score that weights target-page
need (internal PageRank deficit + GSC opportunity) and source-page relevance (cosine similarity +
source authority). Anchors are selected from text that ALREADY EXISTS verbatim in the source page
(never rewritten sentences in the auto path), with a per-target anchor-variation ledger to prevent
the "same anchor everywhere" failure mode. Links are inserted into source content via AST
manipulation (remark/remark-mdx for Markdown/MDX, parse5/cheerio for HTML) and shipped as GitHub
PRs / CMS API writes — never JavaScript injection, which SearchPilot testing shows has no
detectable SEO impact [3]. Per SPEC §14 internal-link changes are MEDIUM risk: the correct
autonomy level is "automated PR with batch approval," with a narrow full-auto tier only for the
highest-confidence pattern (exact phrase present + high semantic similarity + no existing link +
under link caps). Impact is measured per-change via GSC URL-level clicks/impressions/position with
a 2–4 week minimum wait and CausalImpact-style counterfactual analysis [20][22].**

This is one of the highest-ROI automations in the whole platform: internal links are among the few
SEO levers with real experimental (not just correlational) evidence of impact — SearchPilot
split-tests measured +7% organic traffic to pages receiving new internal links [4] and significant
positive impact from anchor-text improvements alone [2][29] — and the entire action space lives
inside the customer's own site, requiring no external dependencies.

---

## Findings

### 1. How much do internal links actually matter (current evidence)

The evidence base is unusually good for SEO — one large correlational study and a body of
controlled split-tests:

**Zyppy / Cyrus Shepard study — 23M internal links, 1,800 sites, ~520k URLs, correlated against
GSC traffic [1]:**
- URLs with **0–4 inbound internal links average ~2 clicks** from Google Search; pages with
  **40–44 inbound links get ~4× more** (~8 clicks).
- **Diminishing returns then reversal: after ~45–50 inbound internal links, traffic begins to
  decline.** This gives a principled per-target inbound cap for the algorithm.
- Pages with **at least one exact-match internal anchor had ~5× the traffic** of pages without
  one, "no matter how many ways we slice the data."
- **Anchor-text variety was the strongest correlation in the study** — so strong the authors
  re-ran the data three times. Only a tiny share of URLs have 25+ anchor variations.
- Naked-URL anchors correlated with ~50% more traffic; empty anchors made "no difference
  whatsoever." Authors stress correlation ≠ causation.

**SearchPilot controlled SEO A/B tests (control vs variant page cohorts) [2][3][4][29]:**
- Adding links to nearby location pages across ~8,000 regional pages: **+7% organic traffic to
  the pages receiving the links** [4].
- Expanding homepage footer links: **+5% organic traffic to destination pages** [2].
- **Changing anchor text of existing internal links to more contextual keywords was significantly
  positive for destination pages** [29] — anchor optimization alone moves rankings.
- **Internal links added only via client-side JavaScript: no detectable impact**; moving them into
  server-rendered HTML is what worked [3]. This is the decisive evidence against the
  InLinks-style JS-snippet insertion mechanism for our platform.
- Reducing link count in an over-stuffed link block improved rankings of the remaining linked
  pages (equity concentration) [2][29].
- Pointing internal links directly at final URLs instead of through 301s improved outcomes [2].

**Google's own statements:** John Mueller: internal linking is "super critical for SEO… one of the
biggest things you can do on a website to guide Google and visitors to the pages that you think
are important" [9]. Google's "reasonable surfer" patent family says link value varies with click
probability — **main-content links pass more value than nav/footer links**, and position on page
(above/below the fold, running text vs list) is an explicit patent feature [11][27].

**Structural facts the graph layer must expose:** ~25% of web pages are orphans (zero inbound
internal links, widely cited figure) [23]; pages 4+ clicks deep get materially less crawl
attention [23]; a JetOctopus case study saw crawl coverage go from 40% → 70% after linking
remediation [23].

### 2. Candidate generation

Three complementary channels; run all three and union the results (each catches what the others
miss):

**Channel A — exact-phrase mention scanning (highest precision, cheapest).**
For every target page, build a phrase set: title, H1, GSC queries the page already ranks for
(Ahrefs restricts to top-10 rankings [9][14]), and manually-set target keywords. Scan every other
page's main content for unlinked occurrences. This is exactly how Ahrefs' "Internal link
opportunities" report works: page A mentions a keyword page B ranks top-10 for, and doesn't yet
link to B → opportunity, with the mention offered as anchor [9]. Implementation is an
Aho-Corasick multi-pattern scan over extracted main content — O(content) per page, no API cost.
The Wikipedia "add-a-link" production system builds the equivalent as an **anchor dictionary**
of all existing anchor→target pairs on the site, and only keeps anchors with **link-probability
> 6.5%** (share of occurrences that are linked) to kill stopword-like phrases [5] — adopt both
ideas: seed the dictionary from the site's existing links, and use link-probability filtering.

**Channel B — embedding semantic similarity (recall channel).**
Embed each page's extracted main content (NOT nav/boilerplate — including it measurably degrades
embedding quality [16][18]); compute pairwise cosine similarity. Practitioner implementations
converge on **OpenAI text-embedding-3-small (1,536-dim)** with a tuned threshold in the
**0.78–0.85 cosine range** — below ~0.78 irrelevant pairs proliferate, above ~0.85 valid
relations get filtered; tune per site (elbow method) [16]. Screaming Frog now ships this exact
workflow natively (crawl → OpenAI embeddings → cosine-similarity related-pages mapping) [18].
Cost is negligible: text-embedding-3-small is **$0.02/1M tokens ($0.01/1M via Batch API)** in
2026 [19] — a 10,000-page site at ~1,500 tokens/page is ~15M tokens ≈ **$0.30** ($0.15 batch);
100k pages ≈ $3. Similarity search at our scale (≤100k pages) fits in pgvector/FAISS; exact
brute-force is fine below ~50k pages. Embedding similarity finds relationships keyword matching
misses ("content decay" page ↔ "declining organic traffic" page — LinkStorm markets exactly this
[14]) but proposes NO anchor by itself — pair it with paragraph-level similarity to find the best
insertion paragraph, then have the anchor stage find a linkable phrase there.

**Channel C — keyword/entity matching via GSC + optional NER.**
Use GSC query data as the semantic bridge: if source page P impresses/ranks for query Q and target
page T is the site's primary ranker for Q, propose P→T. Surfer's semantic internal linking
requires a GSC connection for exactly this reason [15]. Full entity-grounding (InLinks-style:
NER → Wikipedia/Wikidata IDs → entity graph → link pages sharing related entities [13]) is a v2
refinement; it mainly adds value on large sites with synonym-heavy vocabularies. Keep the door
open by storing entities per page in the site graph, but don't block MVP on it.

**Dedup/eligibility filters applied to all channels (learned from prior art):**
- Source already links to target anywhere on the page → drop (Ahrefs does this [9]); one link per
  source→target pair. (Practitioner consensus, historically supported by Moz "first anchor text
  counts" experiments, is that additional same-target links add little; Google has never
  confirmed the first-link rule — treat as a tie-breaker, not gospel.)
- Target is the source page itself, a noindex page, a redirect, or canonicalized elsewhere → drop
  (link the canonical final URL; SearchPilot showed de-chaining redirects is itself a win [2]).
- Anchor phrase equals the source page's own title/H1 → drop (Wikipedia model excludes
  anchor == source-title cases [5]).
- Negative-context guard: keyword matchers link "how NOT to do X" mentions to the X guide — a
  documented Link Whisper failure [24]. A cheap LLM classification pass on the surrounding
  sentence (does this sentence's meaning match the target page's topic?) removes these.

### 3. Scoring the opportunities

Composite score per candidate (source S, target T, anchor a, paragraph p):

```
opportunity(S,T,a,p) =
    w1 · target_need(T)        // how much T benefits from another inlink
  + w2 · target_value(T)       // how much the business benefits if T ranks
  + w3 · source_relevance(S,T) // semantic fit
  + w4 · source_authority(S)   // equity available to donate
  + w5 · placement_quality(p)  // main content, position in doc
  − penalties                  // caps, anchor repetition, dilution
```

- **target_need(T):** low inbound-internal-link count with steep marginal value at the bottom of
  the curve (Zyppy: 0–4 links ≈ 2 clicks; gains flatten toward 40–44 and reverse after ~45–50
  [1]) — so model marginal gain as concave with a hard stop at ~40 inbound links; orphan pages
  (25% of the web [23]) and pages >3 clicks deep [23] get the largest boosts. Compute internal
  PageRank over the site graph — Screaming Frog's Link Score (0–100 log scale, computed
  post-crawl; nofollow/redirect/canonical handling built in) [10] and Semrush's Internal LinkRank
  (pages <10 are "equity-starved") [14][23] are the reference implementations; a standard
  power-iteration PageRank over our crawl graph reproduces them.
- **target_value(T):** GSC opportunity score from the keyword lane — high impressions + position
  5–20 (SPEC §9's "opportunity" definition) means one more relevant inlink plausibly moves a
  striking-distance page; also business-priority flags (money pages) from project config.
- **source_relevance(S,T):** cosine similarity (normalized over the 0.78–0.85+ band [16]) plus a
  bonus when channels agree (phrase match AND high similarity AND shared GSC queries — channel
  agreement is the single best precision signal).
- **source_authority(S):** S's own internal PageRank and GSC traffic — the "donor–acceptor" model:
  route from strong donors to weak acceptors [23]. Penalize donors whose outlink count is already
  high (each added link dilutes what every existing link passes — reasonable-surfer logic
  [11][23]).
- **placement_quality(p):** main-content paragraph ≫ list/sidebar; earlier in document better
  (reasonable surfer: above-the-fold running-text links pass more [11][27]).
- **Penalties:** source over per-page outlink budget (§5 below); anchor a already used ≥2× for T
  sitewide (variation ledger, §4); T already at ~40+ inbound links [1].

Weights: start heuristic (w1..w5 ≈ 0.25/0.20/0.30/0.15/0.10), then learn from the measurement
loop (§10) — the platform's own before/after data becomes training data, which no off-the-shelf
tool has.

### 4. Anchor-text selection with variation

**The evidence sets two constraints in tension:** at least one exact-match anchor per target
correlates with ~5× traffic [1], but anchor VARIETY is the strongest single correlation in the
same study [1], repeating one exact anchor sitewide "appears manipulative" per practitioner
consensus [24][28], and Zyppy's later follow-up suggests over-engineered anchors can backfire
[28]. Resolution: **manage anchors per-TARGET, not per-link**, via a sitewide anchor ledger:

1. If target T has no exact-match inbound anchor yet, prefer the exact target phrase (when it
   occurs naturally in the source) — capture the 5× pattern once.
2. Every subsequent link to T must use a different surface form: partial match, synonym, longer
   natural phrase containing the keyword, title-case variant. Hard rule: no anchor string reused
   for T more than ~2–3 times sitewide. This is precisely what Link Whisper fails at ("every
   single link to your email-marketing guide uses the exact same words" [24]) and what InLinks
   advertises as differentiator ("varied, natural-looking anchor text" [13]).
3. Anchor must be text that already exists verbatim in the source paragraph (auto path). The
   LLM's role is SELECTION + boundary-trimming (which existing span reads best as an anchor), not
   generation. Rewriting a sentence to embed a better anchor is a content edit → MEDIUM risk,
   recommend-only path (SPEC §7 "AI must not blindly rewrite content").
4. Length: 2–6 words; avoid whole-sentence anchors and bare "click here" (Google: anchors should
   be descriptive [9]).

The Wikipedia add-a-link model is the reference for ML-scored anchor selection: features = ngram
length, anchor→target frequency in the dictionary, ambiguity (candidate targets per anchor),
kurtosis of the candidate distribution, Levenshtein(anchor, target-title), Wikipedia2Vec content
similarity; XGBoost with default params achieves **75–89% precision at ~30–63% recall at
threshold 0.5** (enwiki 81.3%P/45.0%R), rising to **88–99% precision at threshold 0.8** with
recall 14–43% [5]. Two portable lessons: (a) precision is tunable to near-human levels by
raising the score threshold and sacrificing recall — the right trade for an autonomous system;
(b) ambiguity of a phrase (how many pages it could point to) is a first-class feature — an
ambiguous anchor on our site (three pages about "keyword research") should route to the
disambiguation logic of the cannibalization lane, not get auto-linked.

### 5. Max links per page

- **Google:** no hard limit and no ideal number; the old "100 links" guideline is retired. Mueller's
  actual concerns: (a) with 20 links on a page, each carries less weight than if there were 1–2;
  (b) linking everything to everything destroys the crawler's ability to see site structure
  [8].
- **Inbound cap (per target):** stop adding once a target has ~40 inbound internal links; Zyppy
  shows decline beyond ~45–50 [1].
- **Outbound budget (per source):** practitioner baselines — ~3–5 contextual links per standard
  article (Ahrefs [9]); scaled by length: 2–4 for 300–500 words, 4–8 for 500–1,000, 8–12 for
  1,500+ [8]; pillar pages justifiably denser [23]; avoid 100+ total links per page [23].
  Implement as a density rule: **max 1 contextual link per ~100–150 words of main content**,
  counting existing links.
- **Per-run change budget (rollback safety, not SEO):** cap insertions per page per run (≤3–5)
  and pages touched per run (≤10% of site or N pages), so each batch is small enough to attribute
  and roll back (SPEC §16–17). SearchPilot's "fewer links can be better" result [2] argues for
  surgical additions over bulk stuffing anyway.

### 6. Insertion-point selection in HTML/MDX without breaking content

**Markdown/MDX (Next.js/React sites, SPEC §12–13):**
- Parse with unified/remark (+ `remark-mdx` for JSX/ESM/expression nodes, `remark-gfm`,
  `remark-frontmatter`) into mdast [26]. Locate the anchor phrase in `text` nodes; split the
  node and wrap the span in a `link` node.
- **Forbidden zones (skip the node if any ancestor is):** `heading`, `link` (never nest),
  `code`/`inlineCode`, `blockquote` (usually quoted text), `image` alt, frontmatter, MDX JSX
  attributes (`mdxJsxAttribute` — never inside a prop string), MDX expressions, import/export
  nodes. Only `paragraph` and (sparingly) `listItem` text is eligible.
- **Diff hygiene (critical for PR review):** naive parse → mutate → `remark-stringify` re-emits
  the whole file and normalizes unrelated formatting (bullets, emphasis markers, wrapping),
  producing noisy diffs that erode reviewer trust and can subtly alter MDX. Instead use mdast
  `position` offsets to compute a **surgical string splice** into the original source
  (`[text](/path)` inserted at exact offsets); the AST is used for locating and validating, the
  original bytes for editing. Round-trip validation gate: re-parse the edited file; assert the
  only tree difference is the added link node; MDX additionally must compile (`@mdx-js/mdx`) and
  the site must build (SPEC §15 validation engine).
- Phrases split across nodes by inline formatting (`the **best** keyword tool`) — v1: skip;
  pick another occurrence.

**HTML (WordPress via REST API, generic CMS):**
- Parse the post body with parse5/cheerio (or PHP DOMDocument server-side). Eligible: text nodes
  inside `<p>`/`<li>` within the main content container. Forbidden ancestors: `a`, `h1–h6`,
  `button`, `nav`, `header`, `footer`, `aside`, `figcaption`, `code`/`pre`, `script`/`style`,
  form elements, anything with `contenteditable` or template-y class patterns. Main-content-only
  placement is also the SEO-optimal choice (reasonable surfer [11][27]).
- WordPress: write via `POST /wp-json/wp/v2/posts/{id}` updating `content` [16]; respect Gutenberg
  block comments (`<!-- wp:paragraph -->`) — edit only inside paragraph blocks, never across
  block boundaries. Page builders (Elementor etc.) store content in meta as JSON — detect and
  fall back to recommend-only.
- **Idempotency + attribution:** ledger keyed by (source, target, anchor, content-hash-at-insert).
  Prefer a clean `<a href>` with no vendor attributes in the final content; the ledger, not DOM
  markers, is the source of truth (change-tracking per SPEC §16). If the paragraph's hash changed
  since analysis (author edited), re-analyze before touching.
- **Position preference:** first eligible occurrence in the main body; earlier occurrences carry
  more reasonable-surfer weight [11][27]; never more than one new link per paragraph.

**Never insert via client-side JavaScript.** InLinks' one-line-JS mechanism [13] is operationally
seductive (CMS-agnostic, instant) but: SearchPilot measured **no detectable impact** from
JS-only internal links [3]; Google explicitly recommends important links be server-side [3]; and
all links vanish if the subscription/script dies [13-review]. Our platform owns a Git/CMS write
path anyway (SPEC §12–13) — use it.

### 7. Auto-insert vs recommend-only

SPEC §14 already classifies internal-link changes as **MEDIUM risk = automated PR/deployment**,
broken internal-link fixes as LOW risk. Refine into three tiers:

| Tier | Conditions (ALL must hold) | Action |
|---|---|---|
| **T1 auto-PR, batch-approvable, optionally auto-merge after N clean batches** | Exact anchor phrase already present verbatim in an eligible paragraph · cosine sim ≥ tuned threshold (~0.80) · ≥2 channels agree · no existing S→T link · source under outlink budget · target under ~40 inlinks · anchor passes variation ledger · negative-context check passed · file round-trips + builds clean | Insert, open PR with per-link reason/confidence/risk JSON (SPEC §7 format) |
| **T2 recommend with one-click apply** | Semantically strong but anchor imperfect: phrase split by formatting, only fuzzy/partial match present, anchor would repeat a heavily-used string, target is a designated money page, or similarity in the gray zone (0.75–0.80) | Suggest with 2–3 anchor options; human picks; system inserts |
| **T3 recommend-only, never auto** | Requires writing/rewriting a sentence to host the anchor · template/nav/footer link changes (site-wide blast radius) · target has thin/ambiguous topical identity (cannibalization risk) · page builder / non-parseable content | Report with rationale |

Mirror of what the market converged on: Ahrefs = recommend-only [14]; Surfer = suggestions with
review before save, auto-insert up to 10 links only with GSC connected [15]; LinkStorm = per-link
approval or "accept all" [14]; Link Whisper auto-linking exists but its own users advise against
unreviewed use [24]. Nobody credible ships silent unreviewed insertion of contextual links; the
platform's edge is making T1 batches so trustworthy (validation engine + measurement loop) that
approval becomes a rubber stamp and can eventually be delegated per-project ("auto-merge T1 after
30 days of clean batches").

Broken-internal-link RETARGETING (link points at 404/redirect → point at final live URL) is LOW
risk per SPEC §14 and SearchPilot-positive [2] — fully automatic from day one.

### 8. Prior art survey (what shipping products actually do)

| Tool | Candidate method | Anchor handling | Insertion | Pricing (2026) |
|---|---|---|---|---|
| **Link Whisper** [12][24][25] | Keyword/NLP match; Aug-2025 LLM upgrade (GPT-4o-mini credits) for semantic scoring | Weak — notorious for repeating identical anchors | WP plugin; one-click + rule-based auto-linking ("link every mention of K to URL") | $77/yr 1 site – $187/yr 10 sites + AI credits |
| **InLinks** [13] | Entity graph: NER → Wikipedia/Wikidata grounding → link via entity relationships | Varied anchors from entity surface forms | **JS snippet injection** (or manual hard-code); approval workflow | $49/mo 100 pages; $196/mo 430 pages; enterprise 100k+ |
| **LinkStorm** [14] | Own crawler + semantic clustering/topic modeling + GSC data | Suggests preferred anchor + placement; flags anchor mix | Per-link approve or accept-all auto-injection; WP plugin 2025 | $30/$60/$120/mo by URL count, unlimited sites |
| **Surfer** [15] | LLM + content embeddings + GSC + Content Audit ("semantic" mode); basic keyword mode without audit | Auto-detects anchor; review/edit before save | Inserts up to 10 links into a draft article | Part of Surfer subscription |
| **Ahrefs Site Audit** [9][14] | Page mentions keyword another page ranks top-10 for, unlinked → opportunity | Suggests the mention as anchor | Recommend-only | $129–449/mo |
| **LinkBoss** [14] | NLP semantic; silo/topical-cluster builder | Auto-generated anchors (need review) | 3 modes incl. writing NEW paragraphs to host links; bulk to 2,000 links | credit-based ~$11/mo entry |
| **Internal Link Juicer** [14] | Pure keyword dictionary per target | Per-keyword config | Fully automatic on WP | $69.99–1,299/yr |
| **Semrush** [14] | No suggestions — diagnostics: Internal LinkRank, crawl depth, distribution | — | — | $139.95+/mo |

Takeaways: (1) the market splits into keyword-matchers (cheap, imprecise, anchor-repetition
disease), semantic/entity engines (InLinks/LinkStorm/Surfer), and pure recommenders (Ahrefs);
(2) GSC integration is table stakes for the serious tier; (3) no tool closes the loop with
per-change impact measurement + rollback — that plus Git-native insertion is our differentiator;
(4) LinkBoss's "write a new paragraph to host the link" mode is exactly what our T3 tier must
never auto-apply.

### 9. Published algorithms / papers

- **Wikimedia "add-a-link" production model** [5]: anchor dictionary with link-probability >6.5%
  filter; XGBoost on 6 features; P/R detailed in §4; deployed across 12+ language wikis;
  excludes disambiguation/date/unit targets and anchor==source-title. The single most complete
  public blueprint for production link recommendation.
- **"Predicting Links on Wikipedia with Anchor Text Information" (SIGIR 2021)** [6]: link
  prediction conditioned on anchor text; ATILP reduces false positives via candidate selection +
  LSA anchor representations; documents the core difficulty: most anchors are ambiguous.
- **"Anchor Prediction: A Topic Modeling Approach" (arXiv 2205.14631)** [7]: predicts WHERE in a
  source document a link should live via topic models — supports our paragraph-level (not just
  page-level) similarity for insertion-point choice.
- **"Link Detection with Wikipedia"** [30]: introduces the anchor likelihood ratio for anchor
  detection — the ancestor of the link-probability filter.
- Google patents: original PageRank; **reasonable surfer** (US 8,051,071 + 2016 update) —
  link value ∝ click probability, with position/font/section as features [11].

### 10. Measuring impact afterwards

Layered measurement, cheapest first:

1. **Structural deltas (immediate, deterministic):** re-crawl → target inlink count, internal
   PageRank/Link Score, crawl depth, orphan count. Verifies the change is live in served HTML
   (also catches CDN/render regressions). Screaming Frog documents this exact
   pre/post-crawl-comparison workflow [31].
2. **Crawl response (days):** GSC Crawl Stats / URL Inspection — did Googlebot refetch source and
   target? Practitioner guidance: allow **2–4 weeks for re-crawl/re-processing** before judging
   [31].
3. **Search performance (2–8 weeks):** GSC Search Analytics API at URL level for target pages:
   clicks, impressions, CTR, position, segmented by query. Rule of thumb from SEO-testing
   practice: **≥200 clicks in both windows** before trusting a verdict [20]; low-traffic pages
   need longer windows or cohort aggregation.
4. **Counterfactual inference:** CausalImpact (Google's Bayesian structural time-series library)
   with a control series — similar pages that received no links — to strip seasonality/algorithm
   updates; significant when the 95% credible interval excludes zero [20][22]. This is what
   Semrush SplitSignal uses under the hood [20]. For batches spanning ≥ ~40–50 similar pages,
   run a proper split-test (SearchPilot methodology): randomize which pages receive links, compare
   cohorts [2][4] — the platform controls insertion, so randomization is free.
5. **Rollback wiring (SPEC §17):** each batch carries its ledger entries; verdict at +28 days
   (configurable): KEEP if target metrics ≥ forecast; investigate/rollback if targets OR source
   pages decline beyond the credible interval. Internal-link rollback is trivially safe (remove
   the inserted anchors by ledger offset), which further justifies aggressive T1 automation.
   Important nuance: source pages should also be watched — links change the source's outlink
   dilution and topical focus [2][23].

Attribution honesty: individual link → ranking attribution is noisy; the platform should report at
BATCH level by default and only claim per-link effects when a split-test or CausalImpact interval
supports it. Anything else over-promises (SPEC §2 explainability).

---

## Options compared

**Candidate generation:**

| Option | Precision | Recall | Cost @10k pages | Anchor comes free? | Verdict |
|---|---|---|---|---|---|
| A. Exact-phrase / anchor-dictionary scan (Ahrefs/Wikipedia style) | High (with link-prob + context filters) | Low–medium | ~$0 (CPU) | **Yes — the mention IS the anchor** | Core of T1 auto path |
| B. Page+paragraph embeddings, cosine 0.78–0.85 (LinkStorm/Surfer/Screaming Frog style) | Medium (threshold-tunable) | **High** | ~$0.30 one-off ($0.02/1M tok [19]) + deltas | No — needs anchor stage | Core recall channel; drives T2 |
| C. GSC query-bridge (source impresses for Q, target ranks for Q) | High for striking-distance targets | Medium | $0 (GSC API free) | Query text ≈ anchor seed | Ties linking to revenue-bearing keywords |
| D. Entity graph w/ KB grounding (InLinks style) | High on entity-rich sites | Medium | NER pipeline cost | Entity surface forms | v2 — not MVP-blocking |
| E. LLM-only "find link opportunities" over page pairs | Variable, unauditable | High | ~$5–50 per full-site pass, recurring | Yes but hallucination-prone | Rejected as generator; LLM used only as ranker/verifier |

**Insertion mechanism:**

| Option | SEO effect | Blast radius | Fit |
|---|---|---|---|
| Git PR with AST-guided surgical edit (MDX/HTML in repo) | Full (server-rendered [3]) | Per-file, reviewable, trivially revertible | **Primary for Next.js/React (SPEC §13)** |
| CMS API write (WP REST, Shopify) | Full | Per-post; revert via ledger | **Primary for WP/Shopify** |
| JS snippet injection (InLinks) | **None detectable in controlled test [3]** | Site-wide script dependency | Rejected |
| Related-posts widget block (YARPP) | Weak (template links ≪ in-content [11]) | Template-level | Not a substitute for contextual links |

---

## Recommendation & why

1. **Ship channels A+B+C fused, in that order of trust.** A gives auditable, high-precision,
   anchor-included candidates (the entire T1 auto tier); B finds the non-obvious pairs that make
   the product feel smart; C aligns linking with the keyword-opportunity engine the platform
   already builds (SPEC §8–9). Combined cost is effectively zero at MVP scale (~$0.30 embeddings
   per 10k-page site [19]).
2. **Score with target-need × source-relevance × placement, capped by the Zyppy curve** (marginal
   value concave, stop ~40 inbound [1]) and per-page outlink density (~1 per 100–150 words,
   3–5/article baseline [8][9]). Prioritize orphans and >3-click-deep pages [23] — biggest
   measured crawl wins [23].
3. **Anchor policy: exact-match once per target, variation ledger after** — directly encodes the
   two strongest correlations in the 23M-link dataset [1] while avoiding the documented
   Link Whisper repetition failure [24]. Anchors only from existing text in the auto path.
4. **Insert server-side via AST-guided surgical edits → GitHub PR / CMS API.** The SearchPilot
   JS-links null result [3] makes this non-negotiable. Diff hygiene (offset splicing, round-trip
   validation, build gate) is what makes reviewers trust and eventually delegate approval.
5. **Autonomy = T1/T2/T3 tiers** consistent with SPEC §14 (MEDIUM risk → automated PR): auto-PR
   the exact-phrase/high-agreement pattern, one-click the gray zone, never auto-write new
   sentences. Auto-fix broken-link retargeting (LOW risk) from day one.
6. **Close the loop with GSC + CausalImpact at batch level, 28-day verdicts, ledger-driven
   rollback.** No commercial tool does this; it converts the platform from "suggestion engine"
   to the autonomous system the SPEC demands, and its accumulated before/after data becomes a
   proprietary training set for the scoring weights.

Feasibility verdict for synthesis: internal-linking is **"mostly automatable"** trending to
"100% automatable for the T1 pattern" — the strongest candidate among content-adjacent SEO
actions for genuine hands-off automation, because inputs are deterministic, edits are surgical
and reversible, and impact is experimentally provable.

---

## Risks & limitations

- **Correlation vs causation:** the headline Zyppy numbers (4× at 40–44 links, 5× exact-match) are
  correlational; the authors say so [1]. Mitigation: treat as priors, validate per-site with the
  measurement loop; the SearchPilot experimental results (+5–7%) are the safer effect-size
  anchor [2][4].
- **Over-optimization:** Google says there's no internal-anchor penalty in the Penguin sense, but
  repetitive exact anchors look manipulative and Zyppy's follow-up hints engineered anchors can
  backfire [28]. The variation ledger is the guard; keep it strict.
- **Bulk-insertion harm:** adding links to a page dilutes its existing links [8][11]; SearchPilot
  measured cases where REMOVING links helped [2]. Per-page and per-run budgets are load-bearing,
  not cosmetic.
- **Content edit collisions:** authors editing a paragraph between analysis and insertion →
  content-hash gate + re-analysis; Gutenberg/page-builder JSON content → detect and downgrade to
  T2/T3.
- **MDX serialization churn:** full re-stringify produces noisy PR diffs and can subtly change MDX
  semantics; offset-splice + round-trip assertion is required engineering, not optional polish.
- **Ambiguous targets / cannibalization:** an anchor phrase matching multiple internal pages must
  route to the cannibalization logic, not auto-link (Wikipedia treats ambiguity as a first-class
  negative feature [5][6]).
- **Small-site measurement floor:** pages with <200 clicks/window can't produce significant
  verdicts [20]; batch-level cohorts and longer windows are the honest fallback.
- **Anchor dictionary cold start:** a site with terrible existing linking gives a weak dictionary;
  bootstrap from titles/H1s/GSC queries instead, and lower T1 volume for the first cycles.
- **First-link-counts uncertainty:** the one-link-per-source→target rule rests on old practitioner
  experiments (Moz 2008 era), not Google confirmation; it costs nothing to follow but shouldn't
  be sold as fact.
- **Freshness:** embeddings and the anchor dictionary must be refreshed incrementally on every
  crawl delta or suggestions go stale; budget re-embedding of changed pages into the crawl
  pipeline (cost negligible at $0.02/1M tokens [19]).

---

## Sources

1. https://zyppy.com/seo/seo-study/ — 23M internal links / 1,800 sites study (link counts vs clicks, 45–50 decline threshold, 5× exact-match, anchor variety)
2. https://www.searchpilot.com/resources/case-studies/impact-of-internal-linking-seo — SearchPilot internal linking test roundup (+7% location links, +5% footer links, redirect de-chaining, link reduction)
3. https://www.searchpilot.com/resources/case-studies/server-side-rendering-internal-links — SSR vs client-side JS internal links (no detectable impact from JS-only links)
4. https://www.searchpilot.com/resources/case-studies/seo-split-test-lessons-nearby-location-links — nearby-location links split test (+7%)
5. https://meta.wikimedia.org/wiki/Research:Link_recommendation_model_for_add-a-link_structured_task — Wikimedia add-a-link model (anchor dictionary, 6.5% link-probability, XGBoost features, P/R tables)
6. https://dl.acm.org/doi/10.1145/3404835.3462994 — "Predicting Links on Wikipedia with Anchor Text Information" (SIGIR 2021)
7. https://arxiv.org/pdf/2205.14631 — "Anchor Prediction: A Topic Modeling Approach"
8. https://www.searchenginejournal.com/google-cautions-against-using-too-many-internal-links/412553/ — Mueller on link dilution and site structure; per-length link-count norms via https://inblog.ai/blog/how-many-internal-links-per-page-seo
9. https://ahrefs.com/blog/internal-links-for-seo/ — Ahrefs internal links guide (Mueller "super critical", 3–5 links/article, Site Audit opportunities method)
10. https://www.screamingfrog.co.uk/seo-spider/tutorials/link-score/ — Link Score internal-PageRank metric (0–100 log scale, nofollow/redirect handling)
11. https://www.seobythesea.com/2010/05/googles-reasonable-surfer-how-the-value-of-a-link-may-differ-based-upon-link-and-document-features-and-user-data/ — reasonable surfer patent analysis (link position/click-probability features)
12. https://www.flyingvgroup.com/seotools/link-whisper-pricing/ — Link Whisper pricing + AI-credit model
13. https://inlinks.com/internal-linking-tool/ and https://www.aiproductivitytools.io/tools/inlinks — InLinks entity-graph linking, JS injection, pricing ($49/mo 100 pages, $196/mo 430 pages)
14. https://linkstorm.io/resources/best-internal-linking-tools-for-seo — tool-by-tool mechanics + pricing (LinkStorm, Link Whisper, ILJ, AIOSEO, Yoast, RankMath, YARPP, Ahrefs, Semrush ILR, LinkBoss)
15. https://docs.surferseo.com/en/articles/9154320-automated-internal-linking-tool-beta — Surfer auto internal linking (GSC-required, semantic vs basic modes, up-to-10 auto inserts)
16. https://nikoalho.fi/writing/automating-internal-linking/ — embeddings pipeline (text-embedding-3-small, cosine 0.78–0.85, LLM anchor variation, CMS API injection)
17. https://www.oncrawl.com/on-page-seo/building-internal-linking-recommender-python-serp-api-semantic-similarity/ — hybrid SERP + embedding recommender pipeline
18. https://www.screamingfrog.co.uk/blog/map-related-pages-at-scale/ — crawl + OpenAI embeddings related-pages workflow (main-content-only extraction)
19. https://embeddingcost.com/openai — text-embedding-3-small $0.02/1M tokens, $0.01/1M batch (2026)
20. https://www.jcchouinard.com/causalimpact-for-seo/ — CausalImpact for SEO (methodology, SplitSignal usage, significance rules); ≥200-clicks rule via https://seotesting.com/
21. https://www.searchpilot.com/resources/case-studies/tag/internal-linking — SearchPilot internal-linking test index (incl. anchor-text change significantly positive)
22. https://www.womenintechseo.com/knowledge/measure-the-impact-of-your-seo-changes-with-causal-impact/ — CausalImpact how-to for GSC data
23. https://www.digitalapplied.com/blog/internal-linking-strategy-2026-large-site-architecture-guide — 2026 large-site guide (25% orphan figure, 3-click depth, donor–acceptor, JetOctopus 40→70% crawl coverage, Semrush ILR <10)
24. https://userp.io/link-building/link-whisper-review/ — Link Whisper failure modes (anchor repetition, context-blind matching, auto-link risk)
25. https://linkwhisper.com/scaling-seo-with-auto-linking-rules-settings/ — Link Whisper auto-linking rules (link-every-mention model)
26. https://mdxjs.com/packages/remark-mdx/ and https://github.com/remarkjs/remark — unified/remark/remark-mdx AST processing for Markdown/MDX
27. https://www.screamingfrog.co.uk/seo-spider/tutorials/how-to-analyse-link-position/ — link position analysis (content vs nav/footer link value)
28. https://seo.ai/blog/internal-linking-anchor-texts — anchor variety studies synthesis + over-optimization caveats (Zyppy 2023 vs 2024 follow-up)
29. https://www.searchpilot.com/resources/blog/internal-linking-tests — SearchPilot on how to test internal links (incl. anchor-text and link-density findings)
30. https://link.springer.com/chapter/10.1007/978-3-642-03761-0_37 — "Link Detection with Wikipedia" (anchor likelihood ratio)
31. https://www.screamingfrog.co.uk/blog/finding-and-testing-internal-link-changes/ — pre/post crawl comparison workflow, 2–4 week re-crawl window
