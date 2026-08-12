# MVP Development Plan

Document 07 of 07 · Autonomous SEO Optimization Platform · Planning Package

---

## Executive summary

This document answers two questions: **what must be proven before committing to a build** (Part 1, the Phase-0 proof-of-concept plan for the 8 POCs named in the problem statement §25.5), and **what exactly gets built for the MVP, in what order, by whom, and with what acceptance criteria** (Part 2, decomposed Epic → Module → Task → Acceptance Criteria as §25.7 demands, scoped strictly to §24).

**Part 1 in brief.** The 8 POCs run in four parallel tracks over roughly 5 calendar weeks of active work (~41 person-days, 2 engineers), each with measurable exit criteria and an explicit link to the risk it retires in Doc 06 (Risks). The core method is a **sandbox target site with seeded defects**: fixture Next.js and WordPress sites (~300 pages each) carrying a ground-truth manifest of ~120 planted SEO defects, against which the analyzer is graded on **precision and recall** — the analyzer must reach precision ≥ 0.95 and recall ≥ 0.90 before any automation is trusted downstream. **POC 8 (measure optimization impact) is the long pole**: it needs a live site and 8–10 elapsed weeks of Google Search Console data, because Google commits only to "a few days to a few weeks" for recrawl [28] and "a day or so … much longer" for indexing [29], and no public study measures update-recrawl latency for modified pages. POC 8 therefore starts in week 1 with manually applied changes, runs the measurement protocol defined in the risk research (recrawl-latency CDFs per traffic stratum, control-page counterfactual verdicts), and its clock runs concurrently with everything else.

**Part 2 in brief.** The MVP is 14 epics in dependency-forced order — foundation/tenancy → crawler+storage → detection rulebook → GSC sync → site model/scoring → AI engine → GitHub change layer → validation pipeline → WordPress adapter → decision engine+ledger → monitoring/rollback → internal-linking engine → autonomous loop → dashboard — totalling **108 person-weeks**, built by a ~6-FTE team over **~26 weeks in six phases** (durations in weeks, no calendar dates; the person-week roll-up and the phase × role loading table that reconcile the two numbers are in §2.4). Shopify, the edge adapter, SERP/competitor data — and with it competitor-derived content gaps — GA4, Bing as a data source, and content-writing at scale are explicitly deferred, each with a stated reason. **MVP-done** is defined as the problem statement's Success Criteria flow demonstrated end-to-end on **one real Next.js site and one real WordPress site**: connect → crawl → understand → find problems and opportunities → AI generates typed changes → validate → auto-apply LOW-risk changes → PR-gate MEDIUM changes → monitor GSC → measure against control pages → keep winners → roll back a harmful change → surface the next opportunity — with every mutation present in the change ledger.

---

## Conventions and traceability

- Requirements are cited as FR-x.y / NFR-x from Doc 01 (Requirements Analysis). Architecture and technology positions follow the decisions established across Docs 02–05; this document restates each decision where it drives a task, with its justification, and does not re-litigate them. The full **FR/NFR × epic traceability matrix is §2.8**.
- Risk cross-references point at Doc 06 (Risks) **by risk ID** — the `TEC-` / `SEO-` / `AI-` / `SEC-` / `API-` / `CST-` / `SCL-` / `POL-` taxonomy, which maps 1:1 onto the SPEC §25.6 categories (technical / SEO / AI / security / API limitations / cost / scalability / policy). Every POC names the IDs it retires; **§1.6 is the Phase-0 risk-coverage matrix**, including the risks Phase 0 deliberately does *not* retire.
- Risk tiers LOW / MEDIUM / HIGH carry exactly the SPEC §14 semantics: LOW may auto-apply, MEDIUM ships as an automated PR a human merges, HIGH is never auto-deployed.
- "The Platform" refers to the product; "pilot sites" refers to the two real sites (Next.js + WordPress) used for POC 8 and the final MVP demonstration.

**Glossary of load-bearing terms** (used throughout; defined once here rather than at each use):

| Term | Meaning in this document |
|---|---|
| CDF | Cumulative distribution function — "what share of changes were recrawled within N days"; the form POC 8's latency results take |
| CUSUM | Cumulative-sum control chart — flags small *sustained* drifts far earlier than a threshold alarm; used as an early warning, never as a verdict |
| BSTS / CausalImpact | Bayesian structural time-series — builds a counterfactual "what would traffic have done without the change" from control pages, and reports a credible interval rather than a point claim |
| DiD | Difference-in-differences — simpler counterfactual (change in the treated group minus change in the control group over the same period); the fallback when BSTS fits poorly |
| Credible interval | The Bayesian analogue of a confidence interval: the range the true effect lies in with stated probability. "Excludes zero" = a real effect |
| Theil–Sen slope | A trend estimator that ignores outliers, so one holiday week or one GSC data gap cannot manufacture a decay alert |
| Isotonic calibration | Fitting a monotone curve that maps a raw score onto an *observed* success rate, so "0.9" comes to mean "90% of these were kept" |
| Empirical-Bayes refit (n₀ = 1,000 impressions) | Blending a site's own measured CTR with the global prior, weighted by how much data the site has; n₀ is the impression count at which the two carry equal weight |
| AIMD | Additive-increase / multiplicative-decrease — the TCP-style backoff rule: halve the request rate on a 429, then creep back up |
| PageRank / CheiRank / HITS | Link-graph importance scores. PageRank = importance from inbound links; CheiRank = the same computed on reversed edges (outbound importance); HITS = paired hub/authority scores |
| simhash-64 | A 64-bit fingerprint where near-identical pages produce near-identical values, so near-duplicates are found by bit distance instead of pairwise comparison |
| halfvec / HNSW | pgvector's 16-bit vector storage (half the memory of 32-bit) and its approximate-nearest-neighbour index — what makes similarity search fast in Postgres |
| RLS | Row-level security — Postgres enforcing "tenant A can only see tenant A's rows" inside the database, beneath the application |
| SSRF | Server-side request forgery — tricking our crawler into fetching an internal address (e.g. the cloud metadata service) on the attacker's behalf |
| AST / codemod | Abstract syntax tree — the parsed structure of source code; a codemod is a deterministic program that edits that tree, as opposed to an LLM editing text |
| `expectedHeadOid` | GitHub's optimistic lock: "only commit if the branch still points at the commit I read." A concurrent human push makes the write fail instead of overwriting |
| apply-or-reject | An edit is applied only on an exact match of the anchor text; a near-miss is rejected and regenerated, never fuzzy-applied |
| Cannibalization | Two or more of a site's own pages competing for the same query, splitting signals between them |

---

# Part 1 — Proof-of-Concept Plan (Phase 0)

## 1.1 Purpose and posture

The SPEC is explicit: *"find the most reliable technical approach, validate risky parts through POCs, then propose the implementation roadmap."* Phase 0 exists to convert the planning package's paper claims into measured numbers before the build commits to them. Every POC has (a) an objective phrased as a falsifiable claim, (b) the specific Doc 06 risk it retires, (c) a method with concrete setup, (d) measurable exit criteria, (e) an effort estimate in person-days (pd), and (f) declared dependencies.

**Requirement coverage of Phase 0.** The eight POCs are not evenly spread across Doc 01: they concentrate on the requirements whose feasibility is genuinely uncertain. POC 1 → FR-1 (and NFR-2's crawl economics); POC 2 → FR-3, above all FR-3.7 (false positives); POC 3 → FR-4.1/4.4 and NFR-6 (the cost gate) and NFR-5 (injection containment); POC 4 → FR-9.1 and FR-10.2's "how is AI prevented from breaking the site"; POC 5 → FR-12 and NFR-5 (the build-sandbox boundary); POC 6 → FR-10.1 end to end; POC 7 → FR-6; POC 8 → FR-14.2 and NFR-3 (a verdict that carries a credible interval rather than a claim). FR-8 (internal linking), FR-11 (the scoring mechanism), FR-13 (change tracking) and FR-15 (autonomous operation) are deliberately *not* POC'd — none of them has an open feasibility question, only design and build work, which Part 2 schedules. §2.8 carries the full requirement × epic matrix.

Two structural rules:

1. **POC 8 starts first, not last.** Its elapsed time is bounded by Google's recrawl behavior and GSC's 2–3-day data lag, not by our effort. Changes for its first cohort are applied *manually* to the pilot sites in week 1 so the measurement clock runs while POCs 1–7 execute.
2. **POCs produce reusable artifacts, not throwaway demos.** The sandbox fixture sites, the ground-truth manifest, the grading harness, and the codemod test fixtures all graduate into the MVP's CI as permanent regression gates (Part 2, E3.13, E7.7/E7.8).

## 1.2 The sandbox: target sites with seeded defects

The centerpiece of POCs 1–5 is a controlled environment where ground truth is known by construction:

| Component | Content |
|---|---|
| Fixture Next.js site | ~300 pages, App Router + a Pages Router section; template families (product, category, blog, utility); one deliberately client-side-rendered template cluster; deployed to a Vercel preview-capable project |
| Fixture WordPress site | ~300 posts/pages on WP 6.x with Yoast active; standard theme; hosted where REST writes are unblocked |
| Ground-truth manifest | Machine-readable file: one row per seeded defect — `{url, rule_id, defect_class, expected_severity, expected_safety_class, notes}` — ~120 defects spanning all 6 SPEC §6 categories (indexing, HTTP, on-page, links, images, structured data), including deliberate false-positive traps (intentional `noindex` on a cart page, decorative `alt=""`, canonicalized parameter variants, a brand-suffixed 63-char title) |
| Injection corpus | ~20 pages carrying prompt-injection payloads in visible text, hidden text (`display:none`, white-on-white), image alt attributes, and JSON-LD — used by POC 3 |
| Defect seeder | Script that plants and removes defects idempotently, so the manifest and the sites can never drift apart |

**Grading methodology.** The analyzer's output is joined against the manifest: true positive = flagged defect matching `{url, rule_id}`; false positive = flag with no manifest row (minus documented intentional-trap rows, which count as FP if flagged); false negative = manifest row not flagged. Precision and recall are computed per category and overall. This is the same harness the MVP later runs in CI on every rulebook change.

## 1.3 POC dependency graph

```
 Week 1 ─────────────────────────────────────────────────────────────────────►

 Track A   POC 1 (crawl) ────► POC 2 (analyze) ────► POC 3 (generate)
                                                        │ ops feed Track B
 Track B   POC 4 (modify Next.js repo) ─► POC 5 (build+validate) ─► POC 6 (GitHub PR)
                                                                        │
 Track C   POC 7 (read GSC) ────────────────────────────────────────────┤
                                                                        ▼
 Track D   POC 8 (measure impact) — manual-change cohort from week 1;
           absorbs automated changes from Tracks B+C when POC 6 lands;
           8–10 elapsed weeks of GSC observation (THE LONG POLE)
```

Tracks A, B, C, D start in parallel in week 1. POC 3 consumes POC 2's findings as generation input; POC 5 consumes POC 4's patches; POC 6 closes the pipeline; POC 8 consumes everything but does not block on it.

## 1.4 The eight POCs

### POC 1 — Crawl a website

- **Objective (falsifiable claim):** a Crawlee-based hybrid static-first crawler (CheerioCrawler default, PlaywrightCrawler escalation via the adaptive rendering predictor [1]) captures the full SPEC §4 field set at parity with a reference desktop crawler, at near-static cost, and resumes cleanly from a crash.
- **Doc 06 risks retired:** **TEC-9** — crawler mis-detection, rendered-vs-raw DOM divergence silently missing JS-injected metadata; **SCL-1** — 100k-page crawl economics, i.e. the ~10× static-vs-browser cost ratio [2] that is the economic foundation of Doc 02's cost envelope; **CST-3** — anti-bot walls forcing managed browsers and residential proxies, the one crawl line that can genuinely blow up.
- **Method / setup:** crawl the fixture Next.js site (including its CSR template cluster), the fixture WordPress site, and two real consenting sites (one ~10k pages). Run a Screaming Frog reference crawl on the same targets. Compare URL inventories and field extractions. Kill the worker mid-crawl on the 10k-page run and restart. Verify the rendering predictor escalates the CSR templates and only those (template-level, per the 96%-of-domains / 56%-of-URLs rendering-difference distribution that motivates the hybrid design [3]).
- **Exit criteria (all must pass):**
  1. URL discovery parity ≥ 99% vs the reference crawl (after normalization); every discrepancy explained.
  2. Field agreement ≥ 98% on title, meta description, canonical, robots directives, H1–H3, image alt, status/redirect chains across matched URLs.
  3. CSR template cluster detected and escalated to rendering; ≤ 15% of total fetches rendered on the fixture site.
  4. Crash-resume: crawl completes after mid-crawl kill with zero lost pages and < 1% duplicate fetches.
  5. 10k-page static-dominant crawl completes in < 2 h at politeness defaults (2–4 concurrency/host) with flat worker memory.
  6. Measured cost per 1k pages recorded (static and rendered) and within 2× of the planning estimate.
- **Effort:** 5 pd. **Depends on:** fixture sites (sandbox build task).

### POC 2 — Analyze SEO automatically

- **Objective:** a deterministic rulebook subset (~30 of the planned ~70 rules, covering all 6 SPEC §6 categories) run over POC 1's crawl store finds the seeded defects with production-grade precision/recall, with canonical-cluster-first evaluation suppressing the dominant false-positive class.
- **Doc 06 risks retired:** **SEO-4** — false-positive detection triggering a harmful "fix" (intentional `noindex`, decorative `alt=""`, canonical patterns that only look wrong); the single most consequential quality risk, since a false positive here becomes an unwanted PR or a bad auto-apply downstream. **TEC-9** (second half) — two-source confirmation before any negative finding enters the fix queue. Also settles the threshold-disagreement question that sits underneath SEO-4: tools disagree on the same rule (title "too long" = 60 chars in Screaming Frog vs 70 in Semrush [4]), so the Platform's defaults are declared, versioned and graded rather than inherited.
- **Method / setup:** implement rules as data (`{id, detector, thresholds, severity, safety_class, FP-suppressions}`); run against the fixture manifest; grade precision/recall per §1.2. Include the FP-trap rows: intentional noindex, decorative alt, canonicalized duplicate titles, the 2-hop redirect that is intentional. Run twice with a transient 5xx injected to verify two-source confirmation for negative states.
- **Exit criteria:**
  1. Precision ≥ 0.95 and recall ≥ 0.90 overall against the manifest; no category below precision 0.90.
  2. Zero FP-trap rows flagged at severity above "informational".
  3. Canonical-cluster-first ordering demonstrably removes parameter-variant duplicate-title FPs (run with ordering disabled must show the FP class appearing).
  4. A transient 5xx observed once is not flagged; observed twice ≥ 1 h apart is.
  5. Every finding carries a safety class on the *fix* (LOW/MEDIUM/HIGH per SPEC §14) assigned by lookup, not by model.
- **Effort:** 5 pd (+ 4 pd sandbox build shared across POCs). **Depends on:** POC 1.

### POC 3 — Generate SEO optimization

- **Objective:** an LLM constrained to schema-enforced typed operations (`UPDATE_TITLE`, `UPDATE_META_DESCRIPTION`, `UPDATE_IMAGE_ALT`, `ADD_INTERNAL_LINK`, `UPDATE_SCHEMA`, each carrying an `oldValue` anchor) produces valid, validator-passing ops at predictable cost, and a seeded prompt-injection corpus cannot make it emit an off-policy operation.
- **Doc 06 risks retired:** **AI-3** — structured-output failure modes (refusals bypassing the schema, schema-valid but semantically invalid values), the SPEC's explicit research question; **AI-1** — hallucinated facts (invented prices, dates, superlatives) entering customer pages; **AI-2** — indirect prompt injection from crawled customer/competitor content steering the generator; **CST-7** — token-per-page estimates are engineering estimates until measured, and content-heavy sites run 2–3× higher input.
- **Method / setup:** build the context-pack assembler (> 4K stable cached prefix + 2–4K volatile per-page blocks, cache-ordered, sanitized — the prefix must clear Haiku's 4,096-token minimum cacheable length) and the validator layer (pixel-width text measurement, keyword coverage, no-new-facts, URL allowlists). Generate ops for 200 fixture pages needing metadata fixes using provider-native structured output (Anthropic `output_config.format` / OpenAI `json_schema strict` [7][8]) with one validator-error re-ask (Instructor pattern: models fix output on first retry 95%+ of the time [9]). Feed the 20 injection-corpus pages through the full path. Measure per-page token cost at Haiku-class batch rates.
- **Exit criteria:**
  1. Schema-validity 100% on non-refusal responses (constrained decoding guarantees syntax); refusals handled as first-class outcomes, not parse errors.
  2. ≥ 90% of ops pass all code validators within ≤ 1 re-ask; persistent failures are dropped, never trimmed into compliance.
  3. Pixel-width validator rejects a seeded 700-px title candidate; no delivered title exceeds the desktop budget.
  4. No-new-facts validator rejects a seeded op containing a number absent from the context pack.
  5. **Injection corpus: zero off-policy ops** — no op targeting a URL other than the requested page, no off-site URL in any value, no markup where plain text is expected, across all 20 payload pages.
  6. **Measured generation cost ≤ $0.0085/page at bulk-tier batch pricing — equivalently ≤ $85 for a full 10k-page metadata pass**, which is the researched envelope this gate exists to defend (generation $27.50–$82.50 per 10k-page pass, $33–88 all-in once selective Opus judging is included, modelled at 3,000 input / 500 output tokens per page; the Haiku-class batch worked example lands at ≈ $27.50, i.e. ~$0.00275/page, so the gate carries ~3× headroom over the modelled case). A breach is a go/no-go event, not a note — see §1.5.
- **Effort:** 4 pd. **Depends on:** POC 2 (findings as input; ~1-day overlap acceptable).

### POC 4 — Modify a Next.js repository

- **Objective:** deterministic ts-morph codemods, driven by LLM-produced *values only*, apply metadata/canonical/alt/sitemap/robots/JSON-LD edits to real Next.js repos with zero collateral diff — the "codemod executes, LLM decides" split that makes LOW-risk auto-apply defensible, given measured evidence that vanilla LLM-written codemods are correct only ~45% one-shot and ~54–55% even after iterative refinement [11].
- **Doc 06 risks retired:** **TEC-1** — an AI-generated change breaking the customer build or rendering wrong, flagged by the client as one of the most important parts (FR-9, FR-10.2); this POC also settles TEC-1's metadata-merge blast radius sub-case, since Next.js metadata resolves via shallow merge along the layout chain and editing the wrong file clobbers sibling pages. **TEC-5** — automation clobbering concurrent human edits, in its *content* form: the `oldValue` optimistic-lock anchor is verified against the live node at apply time (its *repo* form is POC 6's `expectedHeadOid` race test).
- **Method / setup:** build 6 codemods (add/update `metadata` field; add `alternates.canonical`; add `alt` to `next/image` usages; create `app/sitemap.ts`; insert JSON-LD component; MDX frontmatter edit) plus the route→metadata-source resolver (code-owned vs content-file-owned vs CMS-owned classification). Test across 3 fixture repos: App Router, Pages Router with a custom `<SEO>` component, and an MDX blog. Include the blast-radius case: fix one page's title where the title is set in a shared layout. **Scope note:** this POC proves the codemod approach on Next.js, which is where the metadata-resolution machinery is hardest; the non-Next React profiles (Remix, Gatsby, react-helmet) are not POC'd because they raise no new feasibility question — they are head-tag edits on the same AST tooling — and are built with their own fixture repos and blast-radius tests in E7.5/E7.8.
- **Exit criteria:**
  1. All 6 codemod types apply cleanly on all applicable fixtures; on inapplicable targets they **fail loudly** (no-match = no edit), never fuzzy-apply.
  2. `git diff` confined to the intended node: zero changes outside the target expression on every application (asserted mechanically, not by eyeball).
  3. Blast-radius test: the resolver walks the segment chain, edits the page file (not the layout), and sibling pages' rendered metadata is byte-identical before/after.
  4. `tsc --noEmit` and `next build` pass on every modified fixture.
  5. Pages Router custom-component case correctly routes to the LLM search/replace path with exact-match apply-or-reject (per the edit-format evidence that anchored search/replace is the reliable middle ground [56]).
- **Effort:** 5 pd. **Depends on:** fixture repos (sandbox build); independent of Track A.

### POC 5 — Run build and validation

- **Objective:** the layered validation pipeline — static gates → sandboxed egress-restricted build → preview deploy → SEO assertions on the rendered preview — catches every seeded bad change at the correct gate, and the sandbox demonstrably contains a hostile `npm install`.
- **Doc 06 risks retired:** **SEC-4** — supply-chain RCE: `npm install` + build of a customer repo executes arbitrary postinstall code against the Platform; **TEC-1** (validation half) — validation blind spots shipping regressions that the static gates alone would miss; **API-1** — no public Rich Results Test API, since Google's structured-data test API was deprecated without replacement [18], so the in-house JSON-LD validator must carry pre-deploy schema validation.
- **Method / setup:** wire the POC 4 output into: changed-file allowlist + diff budget + ESLint/tsc → ephemeral container build (no secrets, egress-restricted) → Vercel preview deploy via `POST /v13/deployments` with `gitSource` [20] → rendered-preview assertions: meta-tag diff ("intended change present, nothing else changed"), Nu HTML Checker [17], in-house JSON-LD validation, Lighthouse CI baseline-relative with median of 3 runs [19], lychee link check. Seed 6 bad changes: broken JSX, a metadata edit that drops the canonical, an off-allowlist edit to `next.config.js`, a 14-file diff for a 1-file ask, invalid JSON-LD, a hostile postinstall script that attempts to reach the cloud metadata IP and an external exfiltration host.
- **Exit criteria:**
  1. Each of the 6 seeded bad changes is rejected at its intended gate, 10/10 repeated runs (no flaky verdicts).
  2. The hostile postinstall's egress attempts are blocked and logged; no platform secret is present in the build environment (asserted by scanning the container env/filesystem).
  3. Meta-tag diff catches the dropped-canonical case (the classic Next.js shallow-merge failure) on the rendered preview.
  4. End-to-end pipeline wall-clock < 15 min for a single-page metadata change; per-run compute cost recorded.
  5. Lighthouse assertions are baseline-relative (no absolute-score gate), median-run over ≥ 3 runs [19].
- **Effort:** 5 pd. **Depends on:** POC 4.

### POC 6 — Create a GitHub PR

- **Objective:** the full PR lifecycle works under a GitHub App identity with per-run down-scoped installation tokens: signed commit via `createCommitOnBranch` with the `expectedHeadOid` concurrency guard, validation results as Checks, auto-merge enabled only after checks pass (the March-2026 behavior change returns HTTP 422 otherwise [16]), and a one-click durable revert via `revertPullRequest` [15].
- **Doc 06 risks retired:** **TEC-5** — automation clobbering concurrent human work, in its repo form (`expectedHeadOid` on every commit and merge); **API-9** — GitHub rate limits capping throughput, where the binding constraint is the secondary limit of 80 content-generating requests/min and 500/h per installation [14], a hard input to batching design; **SEC-1** — GitHub App private-key blast radius, contained by 1-hour, per-repo, down-scoped installation tokens [13].
- **Method / setup:** register a GitHub App; run the POC 5 pipeline output through branch → commit → PR → checks → auto-merge on the fixture repo. Race test: push a human commit to the branch between analysis and commit. Revert test: merge a change, then execute `revertPullRequest` and verify the revert PR passes the same checks. Meter API writes per PR.
- **Exit criteria:**
  1. PR created with a Verified (app-signed) commit; token scopes limited to `contents:write`, `pull_requests:write`, `checks:write`, `metadata:read` on the single target repo.
  2. Race test: the concurrent human push causes the mutation to fail on `expectedHeadOid`; the pipeline re-fetches, re-analyzes, and succeeds on retry — the human commit is never overwritten.
  3. Auto-merge enabled only after all checks pass; the premature-enable path reproduces the 422 and is handled.
  4. Revert PR generated, passes checks, and merges; ledger linkage recorded.
  5. Measured writes/PR ≤ 4, confirming **≥ 125 PRs/hour** headroom within the 500 content-generating requests/hour secondary limit (500 ÷ 4) [14]; at the ≤ 3 writes/PR the batching design targets, the ceiling is ~166 PRs/hour. E7.12's write-rate budgeter sizes its queueing off the same division.
- **Effort:** 3 pd. **Depends on:** POC 4 (content), POC 5 (checks to report).

### POC 7 — Read GSC data

- **Objective:** per-property OAuth-connected Search Analytics sync lands day-granular, page-grouped and query+page-grouped data in a warehouse; the opportunity score and decay detector reproduce the SPEC's worked examples on real data; quota and data caveats are measured, not assumed.
- **Doc 06 risks retired:** **API-10** — Google OAuth verification lead time blocking launch: GSC scopes are sensitive-class, requiring verification (privacy policy, scope justification, demo video) but not a CASA assessment [45]; unverified apps cap at 100 test users [52], fine for the POC. **API-4** — GSC's ~16-month retention and ~50k-rows/day/search-type export cap, which is what makes permanent warehousing non-optional; together with the ~47% anonymized-query click share [35], both change how metrics must be computed. **API-2** — the 2,000/day/property URL Inspection budget, measured here against a real property rather than assumed.
- **Method / setup:** OAuth in test mode with `webmasters.readonly`; nightly sync job pulling one day per request; backfill 16 months (the retention wall that makes warehousing non-optional [36]); compute page-level metrics from page-grouped pulls only (never by summing query rows). Run the two-component opportunity score with the composite expected-CTR prior (pos-1 = 27.0%, six-study median [53]) and the decay detector on the pilot property.
- **Exit criteria:**
  1. 16-month backfill completes within quota (Search Analytics 1,200 QPM/site [5]) with a per-property quota budget report.
  2. The SPEC's opportunity example (position 8.7, 32,000 impressions, 2.1% CTR) scores HIGH; the decay example (position 4→13, clicks 10,000→4,500) classifies as ranking decay / severity CRITICAL.
  3. Anonymized-click share measured on the pilot property and page-level vs query-level totals reconciled with the discrepancy documented.
  4. URL Inspection integration returns `lastCrawlTime`, `googleCanonical` vs `userCanonical`, and `richResultsResult` for 50 sampled URLs within the 2,000/day/property budget [5][51].
  5. Hourly-data path (`dataState=hourly_all` [50]) exercised for the monitoring loop.
  6. **Google OAuth verification submission drafted and filed** — the lead time is weeks and it is launch-blocking, so Phase 0 starts it.
- **Effort:** 4 pd. **Depends on:** none (starts week 1); pilot property access.

### POC 8 — Measure optimization impact (THE LONG POLE)

- **Objective:** produce, on a live site, the Platform's first measured **recrawl-latency CDF** and its first **counterfactual KEEP/ROLLBACK verdicts** — replacing the unverified practitioner priors (6–48 h / 3–7 d / 10–14+ d) that the public literature cannot substantiate. Google publishes only ranges ("a few days to a few weeks" for crawling [28]; "a day or so, but can take much longer" for indexing [29]; recrawl frequency driven by "perceived inventory, popularity, staleness" with no numeric intervals [30]), and no public study measures update-recrawl latency for modified, already-indexed pages.
- **Doc 06 risks retired:** **SEO-6** — verdicts firing before Google has even recrawled the change, i.e. measurement latency making the daily loop unverifiable (Doc 01 §9's central tension #2); **SEO-2** — wrong KEEP/ROLLBACK verdicts from confounders, since naive pre/post comparison is disqualified by Google's own traffic-drop debugging guidance (algorithm updates, seasonality, shifting interests [57]); **TEC-4** — "rollback is not undo": the evaluation *and* recovery clock must start at verified recrawl, not deploy; **API-8** — no legitimate Google push channel exists, which the accelerator A/B arm tests the practical consequences of. Partially informs **SEO-3** (title verdicts measure Google's rewriter) — the day-3 SERP display check that fully retires SEO-3 needs SERP data, which is post-MVP (see §2.1 and E11.11).
- **Method / setup — the protocol (per the risk-lane measurement design):**
  1. **Cohort:** ≥ 50 changed URLs per pilot site, stratified into top-20-traffic / mid / long-tail strata by warehoused GSC clicks. Week-1 changes applied manually (metadata-level, LOW-class fixes); later cohorts applied by the POC 4–6 pipeline as it comes online.
  2. **Instruments:** ground truth = first verified-Googlebot GET (reverse-DNS/IP-verified) of each changed URL in server/CDN logs; fallback where logs are unavailable = URL Inspection `lastCrawlTime` polled on a decaying schedule (day 1, 2, 4, 8, 16), fitting the 2,000/day/property quota [5].
  3. **Recrawl ≠ reindex:** confirm content-version pickup with a fingerprint (the changed title/meta value) against the inspection result's indexed-version data; record `recrawl_seen` and `reindex_confirmed` as separate events; the evaluation clock starts at the latter for metadata changes.
  4. **Accelerator A/B arm:** treatment = sitemap `<lastmod>` bump (the one sitemap field Google reads, when "consistently and verifiably accurate" [34]) + request-indexing for small batches; control = passive discovery. This measures how much latency the Platform can actually buy. Ruled out by verification: Google's Indexing API (restricted to JobPosting/BroadcastEvent, 200/day [32]) and IndexNow (Google is not a participant [33]).
  5. **Impact verdicts:** at window end (14–28 days post-`reindex_confirmed` for metadata changes), compute the effect vs a control-page counterfactual — untouched similar pages, CausalImpact-style BSTS with ≥ 90 days of pre-period from the warehouse, falling back to difference-in-differences + year-over-year where model fit is poor [37]; report credible intervals, never point claims. Method template: the Vercel/MERJ Googlebot study (100k+ verified fetches, percentile reporting) [31].
- **Exit criteria:**
  1. Per-site, per-stratum p50/p90 for deploy→recrawl and deploy→reindex-confirmed delivered and wired into config (polling schedules, guardrail timeouts, user-facing verdict ETAs).
  2. ≥ 80% of changed URLs reach `reindex_confirmed` within the observation window, or are explicitly flagged slow-crawl with the evidence.
  3. Accelerator arm reports a measured latency delta (even if ≈ 0 — a null result is a finding that removes an assumption).
  4. ≥ 5 change-cohort verdicts produced with credible intervals; at least one demonstrates the full KEEP path and one the insufficient-data path handled honestly (defaulting per class: correctness fixes KEEP, opinion changes not auto-kept).
  5. Prior-acceptance test executed: measured p50 for top-traffic pages compared against Google's published bracket; priors retired or evaluation windows auto-extended accordingly.
- **Effort:** 6 pd of engineering spread across the phase. **Elapsed: 8–10 weeks minimum** — this is why it starts in week 1. **Depends on:** pilot-site access + GSC history (POC 7 warehouse); absorbs POC 4–6 output when available.

## 1.5 Phase-0 roll-up

| POC | Effort (pd) | Elapsed | Parallel track | Hard external dependencies |
|---|---|---|---|---|
| Sandbox fixture build | 4 | wk 1 | shared | none |
| 1 — Crawl | 5 | wk 1–2 | A | consenting 10k-page site |
| 2 — Analyze | 5 | wk 2–3 | A | — |
| 3 — Generate | 4 | wk 3–4 | A | LLM API keys |
| 4 — Modify repo | 5 | wk 1–2 | B | — |
| 5 — Build + validate | 5 | wk 2–3 | B | Vercel project |
| 6 — GitHub PR | 3 | wk 3–4 | B | GitHub App registration |
| 7 — Read GSC | 4 | wk 1–2 | C | pilot property owner grant |
| 8 — Measure impact | 6 | wk 1 → wk 10+ | D | live pilot sites, server logs |
| **Total** | **41 pd** | ~5 wk active + POC 8 tail | 2 engineers | |

**Phase-0 staffing, stated explicitly.** The four tracks are parallel *lanes of work*, not four people. Two engineers cover all 41 pd inside the 5-week window (2 × 5 wk ≈ 50 pd of capacity), split by skill domain rather than by track:

| Engineer | Owns | Load |
|---|---|---|
| Platform engineer A (repo/build/infra domain) | POC 1 (5 pd) · POC 4 (5) · POC 5 (5) · POC 6 (3) — the whole of Track B plus the crawler | 18 pd of 25 available |
| AI/data engineer (analysis/data domain) | Sandbox fixture build (4 pd) · POC 2 (5) · POC 3 (4) · POC 7 (4) · POC 8 (6, spread across the phase and its tail) | 23 pd of 25 available |

The ~7 pd of slack per engineer is the buffer for POC 8's operational tail (log access, polling runs, cohort bookkeeping) and for the fractional tech-lead time reviewing exit criteria. Note that Track A's POC 2/3 and Track B's POC 4/5 do run concurrently in weeks 2–3 across different skill domains — which is exactly why the split above is by domain and not by track.

**Go/no-go consequences.** Phase 0 is not ceremonial; specific failures change the plan:

| Result | Consequence for Part 2 |
|---|---|
| POC 2 precision < 0.95 | Rulebook thresholds retuned; auto-apply lane narrowed until the grading harness passes; E3 scope grows |
| POC 3 injection corpus produces any off-policy op | Generator architecture re-reviewed; MEDIUM+ review gates widened; launch posture stays PR-only |
| POC 3 measured cost > $0.0085/page (> $85 per 10k-page pass) | Escalating response, in order: (1) re-tier the model routing (push more classes to Tier-0 deterministic and bulk-tier, E6.13/E6.14); (2) cut context-pack size and pack-per-request scope (E6.4/E6.6); (3) if both fail to close the gap, Doc 02's medium-site cost envelope ($250–600/mo) is re-issued with the measured number before any pricing is committed. This is a commercial gate, not an engineering note |
| POC 4 codemod collateral diffs ≠ 0 | Affected change types demoted from LOW to MEDIUM (PR lane); codemod library hardened before E7 |
| POC 5 sandbox egress not fully contained | Build sandboxing re-architected (microVM); E8 blocked until re-proven — this is a security gate, not a quality gate |
| POC 7 OAuth verification friction exceeds plan | Service-account-invite fallback promoted to the primary onboarding path for early customers |
| POC 8 p90 recrawl > 14 d on verdict-bearing pages | Evaluation windows auto-extend; product messaging adjusts verdict ETAs; daily-loop cadence unaffected (the clock design already absorbs this) |

## 1.6 Phase-0 risk-coverage matrix (POC × Doc 06 risk ID)

What Phase 0 measurably retires, and — equally important for an honest reading — what it does not.

| Doc 06 ID | Risk (short) | Retired by | Status after Phase 0 |
|---|---|---|---|
| TEC-1 | AI change breaks the build or renders wrong | POC 4, POC 5 | Retired for codemod-expressible edits; the LLM-patch path stays MEDIUM+ by design |
| TEC-4 | Rollback is not undo (recrawl latency, interim signal loss) | POC 8 | Quantified — the recovery clock is measured, not assumed |
| TEC-5 | Automation clobbers concurrent human edits | POC 4 (`oldValue` anchor), POC 6 (`expectedHeadOid`) | Retired for tracked fields |
| TEC-9 | Rendered-vs-raw DOM divergence, streamed-metadata false flags | POC 1, POC 2 | Retired at fixture scale; re-run in CI at full catalog (E3.13) |
| SEO-2 | Confounded KEEP/ROLLBACK verdicts | POC 8 | Method proven on ≥ 5 real verdicts; residual attribution noise is inherent |
| SEO-4 | False-positive detection triggers a harmful fix | POC 2 | Retired at P ≥ 0.95 on the seeded manifest, incl. FP traps |
| SEO-6 | Verdicts fire before Google recrawled | POC 8 | Retired — `reindex_confirmed` clock with measured CDFs |
| AI-1 | Hallucinated facts in generated values | POC 3 (no-new-facts validator) | Retired for numeric/date/entity classes |
| AI-2 | Indirect prompt injection from crawled content | POC 3 (20-page injection corpus) | Retired at zero off-policy ops; becomes a permanent CI fixture (E6.5) |
| AI-3 | Structured-output failure modes | POC 3 | Retired — constrained decoding + refusal-as-outcome |
| SEC-1 | GitHub App key blast radius | POC 6 | Retired — down-scoped 1-hour per-repo tokens proven in tests |
| SEC-4 | Supply-chain RCE via customer `npm install` | POC 5 | Security gate: must pass, or E8 is blocked and the sandbox is re-architected |
| API-1 | No Rich Results Test API | POC 5 | Constraint confirmed; in-house validator carries the load |
| API-2 | URL Inspection 2,000/day budget | POC 7, POC 8 | Retired as a *design input* (budgeter), not removed |
| API-4 | 16-month retention / 50k-row export cap | POC 7 | Retired by permanent warehousing |
| API-8 | No legitimate Google push channel | POC 8 (accelerator arm) | Confirmed; measured what `lastmod` + request-indexing actually buys |
| API-9 | GitHub rate limits | POC 6 | Retired — measured writes/PR against the 500/h secondary limit |
| API-10 | OAuth verification lead time | POC 7 (filed in Phase 0) | De-risked by starting early; outcome is external |
| CST-3 | Anti-bot walls force proxies/managed browsers | POC 1 | Measured per site class; priced, not absorbed |
| CST-7 | Token-per-page estimates unmeasured | POC 3 | Retired by the measured cost gate above |
| SCL-1 | 100k-page crawl economics | POC 1 | Measured at 10k; extrapolation stated, not proven at 100k |
| SEO-3 | Title verdicts measure Google's rewriter | *Partially* — POC 8 | **NOT retired**: the day-3 SERP display check needs SERP data, deferred post-MVP (E11.11 ships the degraded path) |

**Not addressed by Phase 0 — carried into the build with their Doc 06 mitigations, not proven by a POC:** TEC-2 (no preview primitive on direct-API writes → E9.7–E9.10), TEC-3 (partial batch application → E9.6), TEC-6 (Vercel rollback trap → E7.12), TEC-7 (orchestration misuse → E13.1/E13.4), TEC-8 (cache lag false canaries → E9.10), TEC-10 (no manual-action API → E11.5), SEO-1 (a shipped change harms traffic → E11 in full), SEO-5 (change velocity → E10.4), SEO-7 (flapping → E11.13), SEO-8 (freshness-trust burn → E3.4), AI-4 (miscalibrated confidence → E6.10–E6.12), AI-5 (model deprecation/pricing → E6.2), AI-6 (context rot → E6.4), AI-7 (judge bias → E6.11), SEC-2 (token custody → E1.14/E1.15), SEC-3 (cross-tenant blast radius → E1.12), SEC-5 (SSRF → E2.18/E2.19), SEC-6 (source-code exposure → E6.4/E6.5), SEC-7 (unrecorded mutation → E10.6), API-3 (GSC 2–3-day lag → E4.5), API-5 (Yoast read-only REST → E9.1), API-6 (Shopify protected scopes → deferred with the adapter), API-7 (host deploy quotas → E8.5), CST-1/CST-2 (cost erosion, runaway spend → E1.10/E6.3), CST-4/CST-5/CST-6, SCL-2 (per-URL-workflow trap → E13.1), SCL-3 (monitor multiplication → E13.4), SCL-4–SCL-7, POL-1–POL-7 (policy lane → E10.4, E11.5, §2.1 content deferral). Phase 0 is a *technical-feasibility* gate; the security, scalability and policy families are retired by construction and by the CI suites named above, not by a five-week POC.

---

# Part 2 — MVP Build Plan

## 2.1 Scope boundary (strictly SPEC §24)

**In scope:**

| Dimension | MVP scope | Where it is built |
|---|---|---|
| Site platforms | **Next.js** (App Router + Pages Router) and **other React frameworks with a server-rendered head** — Remix `meta` exports, Gatsby Head API, Vite/CRA builds that pre-render — via the git/GitHub path; **WordPress** (REST + companion plugin). Client-only React SPAs with no pre-render are detected and capped (see the deferral table) | E7.4–E7.8, E8.5, E8.7; E9 |
| SEO surface | Technical SEO detection; titles; meta descriptions; headings; image alt; internal links; schema/structured data; sitemap; canonical; broken links | E3 (detect), E6 (generate), E12 (internal links), E7/E9 (apply) |
| Data | Google Search Console (sole external data source) | E4 |
| Automation | GitHub integration, automated PRs, validation pipeline, deployment, rollback | E7, E8, E10, E11 |
| AI | SEO analysis; **content-gap analysis — GSC query-coverage only, detection + recommend-only output** (competitor-derived gaps are deferred with SERP data; see below); metadata optimization; internal-link optimization | E6, E5.10–E5.12, E12 |

**Explicitly deferred post-MVP, with reasons:**

| Deferred item | Reason |
|---|---|
| Shopify adapter | Outside SPEC §24. Research is complete (Admin GraphQL `productUpdate.seo`, `global.title_tag` metafields, `urlRedirectCreate`); the protected-scope exemption for theme writes adds an external approval dependency (~2-week review, 2026 audits tightening) that must not sit on the MVP critical path. |
| Edge-worker adapter (custom sites) | Outside §24. Entering the customer's serving path creates SLA/operational exposure that demands a security story and failover engineering disproportionate to MVP goals. |
| SERP / competitor data (DataForSEO, Serper) — **and, with it, competitor-derived content gaps (FR-7.1, and the competitor half of FR-7.2)** | §24 names GSC as the data source. Competitor analysis adds per-keyword cost (~$0.60/1k SERPs [55]) and a five-gate content pipeline whose output never auto-applies anyway — it accelerates nothing in the MVP's automation demonstration. Shipped behind the multi-vendor provider abstraction post-MVP. **Consequence, stated so this row and the in-scope AI row cannot be read as contradicting each other:** the MVP's content-gap capability is the half GSC alone can evidence — query-coverage gaps computed from GSC query×page facts against on-page topic embeddings (E5.10–E5.12) — and it is recommend-only. "What competitors cover that our page does not" ships with the SERP providers, not in the MVP. Two further MVP paths inherit the same limit and say so where they are built: E11.11 (title verdicts cannot check the displayed SERP title) and E5.6 (no SERP-feature multipliers). |
| Auto-apply on client-only React SPAs (Vite/CRA + react-helmet with no pre-render) | Supported for *detection and recommendation*, but not for automated application. Metadata that exists only after client-side hydration cannot be asserted on a rendered preview the way E8.6 requires without a JS-rendering pass on every check, and Google treats JS-set metadata as a fallback that is honoured with caveats rather than the preferred path [67]. E7.4 detects the render mode and caps such projects at MEDIUM (PR with human merge), which is an honest capability ceiling rather than a silent failure. Full auto-apply arrives with pre-render adoption on the customer's side, or post-MVP when the preview-assertion path runs rendered by default. |
| GA4 / conversion signals | Conversion decline as a rollback signal requires analytics integration; even when present, conversions are a veto-only, last-priority signal (12-day attribution restatement; page-level power only at ≥ ~3.6 key events/day of baseline, i.e. ≈ 120–360 organic sessions/day at a 1–3% conversion rate — the derivation is Doc 05 §3). That conversion floor is a different quantity from the ~10 organic clicks/day *verdict* power floor in E11.10 and must not be conflated with it. GSC signals carry the MVP verdicts. |
| Bing Webmaster Tools as a data source | Secondary corroboration data (weekly granularity, ~6-month retention) that adds an integration without changing any MVP decision. **The IndexNow ping itself ships in MVP** — it is nearly free, LOW-risk, and reaches the Bing/Yandex/Naver family on every applied change [33]. |
| Content-writing at scale (long-form generation, net-new pages) | The brightest policy line: autonomous mass-publishing of AI pages is the definition of scaled content abuse, enforced through 2025–2026 spam updates with months-scale recovery [39]. MVP content ops are bounded and additive (FAQ block, section insert ≤ 300 words), always MEDIUM (human-merged); net-new pages are drafted, never auto-published. |
| BigQuery bulk export tier | Enterprise completeness upgrade; cannot be enabled via API and has no backfill [44] — a guided manual onboarding step that belongs in the enterprise tier, not the MVP path. |
| Third-party rank tracking | GSC average position is the MVP's ranking signal; a rank tracker is a paid hedge to revisit with SERP data. |
| Scale-triggered datastore upgrades (pgvectorscale/Qdrant, Memgraph, OpenSearch) | Trigger-based, not preemptive: pgvector is 3–4 orders of magnitude below its comfort zone at MVP volumes; a 100k-page PageRank runs in seconds in-process [49]. |

## 2.2 Build order and why the dependencies force it

```
E1 Foundation/Tenancy
   ├─► E2 Crawler + Storage ──► E3 Detection Rulebook ─┐
   ├─► E4 GSC Sync ────────────────────────────────────┼─► E5 Site Model + Scoring
   │                                                   │          │
   │                             ┌─────────────────────┘          ▼
   │                             │                        E6 AI Engine
   │                             ▼                                │
   ├─► E7 Change Layer (GitHub) ─► E8 Validation Pipeline ◄───────┤
   │                             │                                │
   │                             ▼                                ▼
   ├─► E9 WordPress Adapter ──► E10 Decision Engine + Ledger ──► E11 Monitoring + Rollback
   │                             ▲                                │
   │        E12 Internal-Linking Engine ────────────────┘         │
   │        (E5 graph+embeddings → E6 anchors →                   │
   │         E7/E9 AST insertion → E11 batch verdicts)            │
   │                                                              │
   └─────────────────────────────► E13 Autonomous Loop ◄──────────┘
                                          │
                                          ▼
                                   E14 Dashboard (starts early, finishes last)
```

Detection needs crawl data (E2→E3). Scoring needs both crawl-derived graph data and GSC facts (E3+E4→E5). The AI engine consumes findings and scores (E5→E6). The change layer needs something to apply (E6→E7/E9) and the validation pipeline wraps the change layer (E7→E8). The decision engine gates what the change layers may do and the ledger records it (→E10). Monitoring consumes the ledger and GSC (→E11). The internal-linking engine (E12) is the one capability that spans the stack rather than sitting in a layer — it needs E5's link graph and embeddings to find candidates, E6's validators to pick anchors, E7/E9 to insert server-side, and E11 to grade a batch — which is why it is scheduled after E5/E6 exist and lands in two slices across Phases C and D. The autonomous loop composes all of it under Temporal (→E13). The dashboard reads everything and hosts the approval surface (→E14, built incrementally alongside — it starts in Phase A and appears in every phase's Content column in §2.5, not only at the end).

## 2.3 Epics

Effort is given in person-weeks (pw) and totals **108 pw** across the 14 epics; the per-epic roll-up and the phase × role loading table that reconcile that figure with the timeline in §2.5 are in §2.4. Each task's acceptance criteria (AC) are measurable assertions or Given/When/Then; each epic ends with an exit gate. Each epic preamble states the requirements it traces to — §2.8 is the complete matrix.

---

### Epic E1 — Foundation & Tenancy (6 pw)

Goal: the multi-tenant substrate every other epic assumes. Trace: FR-16 (16.1 and 16.2 — the concrete stack picks below *are* FR-16.2's answer), NFR-5, NFR-6 (per-project budgets), NFR-7 (each pick below carries its comparison in Doc 04). Positions applied: Node/TypeScript monorepo with exactly one runtime exception — the Python batch analysis worker of D-39, packaged in E1.18 and used by E5.1; NestJS 11 on Fastify; Next.js 16 dashboard shell; Clerk for platform auth (free to 50k users, Organizations for org/role modeling [60]); pooled Postgres 16 + pgvector with RLS defense-in-depth [61]; **Valkey** as the Redis-protocol implementation behind BullMQ and cache; Temporal Cloud namespace ($100/mo floor, 1M actions included [40]); KMS envelope encryption for customer secrets; OpenTelemetry → Grafana Cloud free tier [59] + Sentry Team [58].

**Why Valkey, per the decision register.** D-38 settles the Redis-protocol store as **Valkey 9** — the same Redis protocol and semantics, under a BSD-3 license held by the Linux Foundation, at a 20–33% discount across managed offerings — refining D-06's generic "Redis" rather than deviating from it. BullMQ requires Redis ≥ 6.2 semantics, which Valkey satisfies, but Valkey is not on BullMQ's formally tested-vendor list [62]; E1.3's pinned-version behaviour suite in CI is the compensating control D-38 itself calls for. The queue engine (BullMQ) is unchanged — only the server implementation behind it.

**Module 1.1 — Infrastructure skeleton**

| # | Task | Acceptance criteria |
|---|---|---|
| E1.1 | Monorepo + CI (lint, typecheck, test, build) | CI green on empty-feature skeleton; a failing test blocks merge |
| E1.2 | Postgres 16 + pgvector, migration tooling | Migrations run via a dedicated role; app role is non-owner and subject to RLS |
| E1.3 | Valkey + BullMQ wiring | BullMQ behavior test-suite passes against the pinned Valkey version in CI (Valkey is not on BullMQ's formally tested-vendor list — the CI suite is the compensating control [62]) |
| E1.4 | Temporal Cloud namespace + TS SDK worker skeleton | A hello-workflow survives a worker restart mid-timer; event history visible in Temporal Web UI |
| E1.5 | S3-compatible object storage buckets | Raw-body write/read round-trip with zstd compression |
| E1.18 | **Python batch analysis worker packaging** (D-39): its own container image and `pyproject.toml` (rustworkx/igraph, GLiNER NER fallback) plus a dedicated CI lane — lint, dependency lock, unit tests, image build — alongside the Node lanes | The image builds and the lane is green in CI; the worker owns no HTTP surface and receives no customer credentials, asserted by a config test. Second-runtime cost is stated once here (one extra image + one dependency manifest) so deployment planning is off two runtimes, not one. **Escape hatch:** if the graphology POC benchmark on a ~10M-edge graph meets E5.1's < 60 s target, this task and the image are deleted and E5.1 folds back into Node |

**Module 1.2 — Platform auth & organizations**

| # | Task | Acceptance criteria |
|---|---|---|
| E1.6 | Clerk integration + org webhook sync | Given an org created in Clerk, when the webhook fires, then an `organizations` row exists and membership roles are queryable |
| E1.7 | API auth guard (JWT verification, org context) | Requests without a valid session are 401; org context is injected into every handler; verified locally (no Clerk round-trip per request) |

**Module 1.3 — Project management module (build, don't buy)**

| # | Task | Acceptance criteria |
|---|---|---|
| E1.8 | Project entity + connections (GitHub installation id + repo allowlist, GSC property, WP credential *reference*) | A project stores pointers to credentials, never secrets; deleting a project revokes/cleans its connections |
| E1.9 | RBAC + approval policy | Only roles granted "approve MEDIUM" can approve; policy edits (auto-apply thresholds, budgets) are themselves audit-logged |
| E1.10 | Per-project quotas (crawl budget, AI-token budget, concurrency class) | Exceeding a quota queues rather than executes, and emits a visible event |
| E1.11 | Human-action audit log (append-only) | Every approve/reject/rollback/policy change writes an immutable row with actor + timestamp |

**Module 1.4 — Tenant isolation**

| # | Task | Acceptance criteria |
|---|---|---|
| E1.12 | `project_id` on every tenant-scoped table + RLS policies via session variable | A query issued with tenant A's session variable returns zero tenant-B rows — proven by an automated cross-tenant test that runs in CI against every new table [61] |
| E1.13 | Interceptor/worker context propagation | API sets the RLS variable per request; workers set it per job; a job missing tenant context fails closed |

**Module 1.5 — Secrets vault**

| # | Task | Acceptance criteria |
|---|---|---|
| E1.14 | KMS envelope encryption, per-tenant data keys | No plaintext token at rest (verified by scanning storage); decrypt requires the tenant's data key; key usage is logged |
| E1.15 | Token lifecycle (store, rotate, revoke GSC refresh tokens, WP app passwords, GitHub installation state) | Revoking a connection invalidates cached tokens within 60 s |

**Module 1.6 — Observability**

| # | Task | Acceptance criteria |
|---|---|---|
| E1.16 | OTel SDK across API + workers; Grafana dashboards; Sentry | One trace spans API request → Temporal workflow → activity → BullMQ job; error in a worker appears in Sentry with release tag |
| E1.17 | Alert baseline (workflow failure rate, queue depth/age, quota nearing) | Firing alert reaches the on-call channel with runbook link |

**Exit gate:** cross-tenant isolation test green; a demo project can be created, connected (stub), quota'd, and audited.

---

### Epic E2 — Crawler & Storage (10 pw)

Goal: FR-1 complete. Trace: FR-1.1–1.7 (1.6 queued/distributed work is E2.9–E2.10; 1.7 durable persistence is E2.11–E2.12), NFR-2 (the 10k-page exit gate and the static-first economics are where "scalable" is proven, not asserted), NFR-5 (E2.18–E2.19 are the SSRF boundary), NFR-6 (static-first *is* the cost strategy). Positions applied: Crawlee (TS) hybrid static-first with the adaptive rendering predictor (~10% re-detection sampling) [1]; BullMQ carries page-level fetch/render/analyze work (D-06), entered through site-level `crawl:*` jobs that fan it out — the crawl *frontier* (the URL dedup/depth set) lives in Crawlee's RequestQueueV2 and never becomes queue jobs; Postgres extracts + link edges; S3 zstd raw bodies; simhash-64 duplicate detection; SSRF guard at the socket layer.

**Module 2.1 — Crawl engine**

| # | Task | Acceptance criteria |
|---|---|---|
| E2.1 | CheerioCrawler default + PlaywrightCrawler escalation via rendering predictor | On the fixture site, CSR templates escalate; rendered share ≤ 15%; predictor decisions persist across runs [1] |
| E2.2 | robots.txt compliance (RFC 9309 semantics, 24 h cache TTL mirroring Google [43]) + honest UA + bot page | Disallowed URL is never fetched; robots 4xx treated as allow-all, 5xx as disallow, matching the documented semantics |
| E2.3 | Politeness governor (per-host 2–4 concurrency, 429/503 → honor Retry-After, halve rate, AIMD recovery) | Synthetic 429 storm produces measured backoff curve; no host exceeds its ceiling across multiple workers |
| E2.4 | Sitemap-first seeding (robots `Sitemap:` lines, sitemap index traversal) | 10k-URL sitemap ingested before link discovery; BFS depth computed from homepage afterwards |
| E2.5 | Verified-owner fast-crawl mode gated on domain ownership (DNS TXT or GSC property linkage) | Above-default rates are impossible without verified ownership |

**Module 2.2 — Frontier, normalization, dedup**

| # | Task | Acceptance criteria |
|---|---|---|
| E2.6 | URL normalization pipeline (RFC 3986 safe transforms; param sorting; tracking-param strip; no path lowercasing) | Property-based tests: normalization is idempotent; raw variant is preserved alongside the dedup key (www/http variants are SEO evidence, not noise) |
| E2.7 | Trailing-slash and ignorable-param learning per site | Given `/a` 301s to `/a/`, the pair folds; given a param that never changes content hash across a sample, it joins the site's ignorable list |
| E2.8 | Frontier resumability + URL-space traps (max depth, per-pattern caps with sampling) | Kill/resume mid-crawl loses zero pages; a synthetic faceted-URL trap stops at the pattern cap and reports "truncated at N" honestly |

**Module 2.3 — Job layer**

| # | Task | Acceptance criteria |
|---|---|---|
| E2.9 | BullMQ job types: site-level entry jobs `crawl:full`, `crawl:incremental`, `crawl:verify-change`, `perf:lighthouse`, each fanning out page-level fetch/render/analyze jobs | One `crawl:*` job = one site crawl and is the only entry point; the crawl frontier never appears as BullMQ jobs — it stays in Crawlee's RequestQueueV2, so dedup and depth are never split across two systems |
| E2.10 | Per-tenant crawl concurrency enforcement | Two tenants crawling concurrently: neither exceeds its concurrency class; starvation test passes |

**Module 2.4 — Storage & extraction**

| # | Task | Acceptance criteria |
|---|---|---|
| E2.11 | Page-extract rows (full FR-1.2 field set) + link-edge table `(from, to, anchor, rel, position)` | Fixture-site extraction matches the manifest 100% on seeded values; a 10k-page crawl produces edge rows queryable for the graph worker |
| E2.12 | S3 raw bodies, zstd, raw + rendered variants when they differ | Storage cost telemetry per site; raw-vs-rendered delta recorded as a reportable finding (AI crawlers do not execute JS — the delta is product signal) |
| E2.13 | simhash-64 + SHA-256 over extracted main content (post-boilerplate) | Seeded near-duplicate pair detected at Hamming ≤ 3; nav/footer noise does not mask true duplicates |
| E2.14 | Crawl-time performance signals (TTFB, bytes, redirect hops, asset counts/weights) | Populated for every fetched page; feeds image/performance rules in E3 |
| E2.15 | Differential recrawl outputs (new/removed/changed/status transitions/link deltas) | A recrawl after a seeded change emits exactly the expected diff, consumed downstream as events |

**Module 2.5 — Incremental recrawl scheduling**

| # | Task | Acceptance criteria |
|---|---|---|
| E2.16 | Priority score: importance (GSC clicks + link centrality) × staleness × volatility × `pending_verification` boost | Pages with applied changes recrawl within hours-to-daily; stable tail on ~30-day cadence; ordering is unit-tested |
| E2.17 | `lastmod` trust scoring + conditional GET (ETag/If-Modified-Since) | A site emitting always-fresh lastmod loses trust and falls back to hash-based scheduling; 304s short-circuit refetch where validators are stable |

**Module 2.6 — Crawler security (SSRF)**

| # | Task | Acceptance criteria |
|---|---|---|
| E2.18 | Socket-layer IP validation (pin vetted IP into connect; block RFC1918/link-local/metadata ranges; re-validate every redirect hop) | DNS-rebinding test harness (TTL-0 flip) fails to reach an internal address; redirect-to-metadata-IP is blocked and logged |
| E2.19 | Egress-isolated crawl workers, no ambient cloud credentials; response caps (size, content-type, timeouts, decompression limits) | Worker cannot reach internal ranges by policy; a tarpit/zip-bomb fixture is contained |

**Exit gate:** fixture + 10k-page real crawl green with POC 1 criteria re-run as CI; SSRF harness green.

---

### Epic E3 — Detection Rulebook (8 pw)

Goal: FR-3 complete, FR-3.7 (false-positive control) in particular. Trace: NFR-3 (a finding without its rule version and evidence is not explainable), NFR-7 (thresholds are declared and sourced, not inherited). Positions applied: deterministic, versioned rulebook (~70 rules) — AI never decides issue-hood, only generates fix content; Screaming-Frog-aligned defaults, per-project configurable [4]; canonical-cluster-first evaluation; two-source confirmation for negative states; URL Inspection as a budgeted sampling layer (2,000/day/property [5]); safety class attached to the fix, not the finding.

**Module 3.1 — Rule engine core**

| # | Task | Acceptance criteria |
|---|---|---|
| E3.1 | Rule-as-data schema `{id, category, detector, thresholds, severity, safety_class, FP-suppressions}`, versioned; per-project threshold overrides | Rulebook version recorded on every finding; changing a threshold requires no code deploy |
| E3.2 | Canonical-cluster-first evaluation ordering | With ordering disabled, the parameter-variant duplicate-title FP class appears; enabled, it does not (regression-tested) |
| E3.3 | Two-source confirmation for 4xx/5xx/timeout findings (re-probe ≥ 1 h) | Single-observation negatives never enter the fix queue |

**Module 3.2 — Rule families** (each lands with fixture defects + unit tests; thresholds are the Platform's defaults established in research)

| # | Task | Acceptance criteria (representative) |
|---|---|---|
| E3.4 | Indexing rules: noindex cross-signal (flag only when contradicting sitemap/links/GSC/canonical intent); robots.txt evaluation incl. 4xx/5xx semantics; canonical 6-signal consistency tuple; sitemap validation (50k/50 MB limits, non-indexable entries, lastmod auto-stamper signature [34]); duplicate URL clustering (HTTP/HTTPS, www) | Intentional cart-page noindex NOT flagged; canonical-says-A/sitemap-says-B conflict flagged; auto-stamped lastmod detected |
| E3.5 | HTTP rules: 4xx/5xx, 301-vs-302 misuse, chains (warn ≥ 2, error ≥ 5, critical ≥ 10), loops, meta-refresh/JS redirects | Seeded 3-hop chain warns; seeded loop errors; transient 5xx suppressed by E3.3 |
| E3.6 | On-page rules: title/meta length in chars AND pixel width (measured with SERP font metrics, thresholds in config because Google shifts them); missing/duplicate/multiple; H1 rules at low severity (multiple H1s are valid HTML5); hierarchy skips | 63-char brand-suffixed title flags at Opportunity severity only; pixel measurement within ±2 px of reference |
| E3.7 | Link rules: broken internal/external, orphans (union of sitemap+GSC+crawl sources — reported as a lower bound), weakly linked, excessive (warn > 1,000, error > 3,000), nofollow anomalies, malformed hrefs | Orphan detection requires a non-crawl discovery source; count is labeled a lower bound in output |
| E3.8 | Image rules: missing alt attribute vs decorative `alt=""` (never conflated), > 100 KB flags, unsupported formats vs Google's list, missing dimensions, broken images | Decorative empty-alt is never a finding; delivered (not stored) bytes measured where a CDN transforms delivery |
| E3.9 | Structured-data rules: JSON-LD parse → schema.org vocabulary → Google rich-result feature rule-pack (in-house — there is no public Rich Results Test API [18]); wrong-type and content-mismatch detection | Seeded invalid JSON-LD caught at parse layer; schema-price ≠ visible-price mismatch flagged as policy-risk severity |

**Module 3.3 — Google-truth sampling & freshness signaling**

| # | Task | Acceptance criteria |
|---|---|---|
| E3.10 | URL Inspection budgeter: changed URLs (pre/post) > conflict pages > rotating stratified sample; per-property daily budget ledger [5] | Budget never exceeded; `googleCanonical` ≠ `userCanonical` recorded as the definitive override signal; `pageFetchState=SOFT_404` consumed |
| E3.11 | IndexNow ping on applied changes + sitemap resubmission via Sitemaps API | Ping fires within 60 s of an applied change; Google-side freshness relies on accurate lastmod only [33][34] |

**Module 3.4 — Fix-safety classification & grading**

| # | Task | Acceptance criteria |
|---|---|---|
| E3.12 | Safety class attached per fix (LOW ~15 types / MEDIUM ~25 / HIGH) with batch escalation — **canonical fixes > 10 pages ⇒ HIGH (deny-list, per SPEC §14 and D-13)**, permanently human-gated rather than routed to the MEDIUM PR lane | The same finding can carry a LOW fix (update link to redirect target) and a HIGH fix (change server redirect map), independently classed |
| E3.13 | Fixture grading harness in CI (precision/recall vs manifest) | Every rulebook PR reports P/R; merge blocked below P 0.95 / R 0.90 |

**Exit gate:** full ~70-rule catalog green on the grading harness; POC 2 criteria hold at full catalog size.

---

### Epic E4 — GSC Sync (4 pw)

Goal: FR-6, FR-5.1 (GSC-sourced part). Trace: FR-6.1, NFR-2, NFR-5 (token custody via E1.14). Positions applied: GSC-first, nightly per-tenant syncs, day-granular, page-grouped AND query+page-grouped, warehoused permanently (escaping the 16-month retention wall [36]); per-customer OAuth `webmasters.readonly` (sensitive scope — verification filed in Phase 0 [45]) with service-account-invite fallback.

**Module 4.1 — Connect & authorization**

| # | Task | Acceptance criteria |
|---|---|---|
| E4.1 | OAuth connect flow (incremental authorization; property allowlist enforced server-side) | The tenant selects exactly which verified property the Platform may read; tokens stored via E1.14; the token's broader visibility is never exercised |
| E4.2 | Service-account invite fallback | Documented onboarding path works end-to-end on a property where the SA was added as Full user |

**Module 4.2 — Sync workers**

| # | Task | Acceptance criteria |
|---|---|---|
| E4.3 | Nightly sync worker: yesterday's final data, one day per request; page-grouped and query+page-grouped pulls | 16-month backfill on connect completes within quota (1,200 QPM/site [5]); page-level metrics computed from page-grouped rows only (anonymized-query share ~47% makes query-row summation wrong [35]) |
| E4.5 | Monitoring-loop freshness path: `dataState=all` + hourly (trailing ~10 days) [50] | Post-change CTR series available at hourly granularity for guardrails, labeled provisional |

**Module 4.3 — Warehouse**

| # | Task | Acceptance criteria |
|---|---|---|
| E4.4 | Warehouse tables (`gsc_page_daily`, query facts) with `data_state` fresh/final handling | Fresh rows are overwritten by final ones; a data-gap detector flags missing days so downstream verdicts never evaluate against holes |

**Module 4.4 — Quota governance**

| # | Task | Acceptance criteria |
|---|---|---|
| E4.6 | Quota governor per property | Sync + inspection consumption visible per tenant; alerts at 80% budget |

**Exit gate:** POC 7 criteria re-run as CI against a live property; opportunity/decay inputs land nightly.

---

### Epic E5 — Site Model & Scoring (9 pw)

Goal: FR-2, FR-5.2, FR-6.2/6.3, and the GSC-evidenced half of FR-7.2 (content-gap detection). Trace: NFR-2 (the 100k-page targets in E5.1/E5.3 are where "scalable" is made concrete). Positions applied: no graph database — in-process graph analytics (rustworkx/igraph; a 100k-page graph computes in seconds [49]) with scores written back as columns, running in the one Python batch analysis worker D-39 carves out of the Node runtime (packaged in E1.18); pgvector `halfvec` + HNSW embeddings (text-embedding-3-small, $0.02/M tokens ≈ $0.30 per 10k pages [46]); the researched two-component opportunity score and decay detector, both reproducing the SPEC's worked examples; one versioned expected-CTR curve service shared by every consumer.

**Module 5.1 — Graph analytics worker**

| # | Task | Acceptance criteria |
|---|---|---|
| E5.1 | Nightly PageRank/CheiRank/HITS, BFS depth, orphan set, connected components over the edge table; write-back columns. Runs as the **Python batch analysis worker** (rustworkx/igraph — no Node bindings exist; image and CI lane in E1.18): reads pages/links after a crawl, writes score columns, exits | 100k-page graph completes < 60 s; orphan set consistent with E3.7's union-of-sources definition. The worker holds no credentials and exposes no HTTP surface. The graphology POC benchmark on a ~10M-edge graph is the one condition that removes the second runtime — if it clears < 60 s, this task moves to Node and E1.18 is deleted |
| E5.2 | "Which pages should receive more links" scoring — the `target_need(T)` term (PageRank deficit vs traffic, concave marginal gain, ~40-inbound cap per the 23M-link evidence [47]) | Output ranks candidate targets; pages at/above the inbound cap are excluded. This is one of three factors E12.4 multiplies — it is not by itself an internal-linking engine |

**Module 5.2 — Embeddings & similarity**

| # | Task | Acceptance criteria |
|---|---|---|
| E5.3 | Page + paragraph embeddings, batched; HNSW index | 10k-page embedding pass ≤ $1 at batch rates; similar-page query returns in < 100 ms with filters (indexable, same section) in one SQL statement |
| E5.4 | Cannibalization candidates (embedding clusters ~0.75 cosine + GSC query×page overlap) | Seeded competing-page pair detected; output routes to consolidation playbook, not content refresh |

**Module 5.3 — Page-type classifier**

| # | Task | Acceptance criteria |
|---|---|---|
| E5.5 | Layered classifier: platform ground truth → structured-data signals → learned URL rules → DOM-template clustering → LLM labels *templates*, not pages; provenance + confidence columns | Every page has `page_type` with provenance; low-confidence classifications gate downstream automation (no auto-apply on unclassified templates) |

**Module 5.4 — Opportunity score, decay detector, curve service**

| # | Task | Acceptance criteria |
|---|---|---|
| E5.6 | Curve service: composite expected-CTR prior E₀(p) (six-study median, pos-1 = 27.0% [53]) + empirical-Bayes per-site refit (n₀ = 1,000 impressions), monthly refit, monotone projection, drift alarm, versioned. **MVP degradation, stated explicitly: SERP-feature multipliers are NOT in MVP scope.** The researched multiplier table (AI Overview ×0.6 at p ≤ 5, featured snippet ×0.7, local pack ×0.6, own-sitelinks ×1.35) applies only when a live SERP snapshot exists, and SERP providers are deferred (§2.1). MVP therefore ships E₀(p) + per-site refit only, and the refit absorbs a site's *average* SERP composition implicitly. The residual error is surfaced, not hidden: the AI-Overviews caveat — a measured −34.5% on position-1 CTR in a 300k-keyword controlled study [54] — is rendered as a standing caveat on every prior-based forecast, because a site whose queries are AIO-heavy will sit below its own fitted curve until enough impressions accumulate to shrink toward truth | All consumers (scorer, decay, measurement, rollback) resolve E(p) through this one service; every stored score records curve version *and* a `serp_features_unknown` flag — divergent baselines are the documented failure mode this prevents. Cold-start policy enforced: with no site history, scores rank the queue but absolute "predicted +N clicks/mo" claims are suppressed in the UI; absolute forecasts unlock only at ≥ 1,000 impressions in the bucket, with the credible interval shown |
| E5.7 | Two-component opportunity score (CTR-gap + position-upside, log-normalized per site) | SPEC example (pos 8.7 / 32k impressions / 2.1% CTR) scores HIGH with position-upside as the driver; low-traffic counter-example scores LOW; both are permanent unit tests |
| E5.8 | Content-decay detector (28-day windows vs prior/YoY/peak; Theil–Sen slope; 3-week persistence; ranking/demand/cliff/cannibalization/seasonality classification) | SPEC example (pos 4→13, clicks 10k→4.5k) classifies ranking-decay CRITICAL; a seeded seasonal dip within ±15% of YoY is suppressed |
| E5.9 | Unified prioritization queue (opportunities + decay on one scale) | The daily loop consumes one ranked queue; ordering is explainable per item (inputs shown) |

**Module 5.5 — Content-gap analysis (GSC query-coverage; detection + recommend-only)**

Scope note, because this is the module most at risk of being over-read: FR-7.2 asks for "what competitors cover that our page does not." The competitor half of that question needs SERP data and competitor page parsing, both deferred (§2.1). What GSC alone can evidence — and what ships in MVP — is **query-coverage gaps: demand the site already demonstrably receives, against topics its own page does not cover.** Every output of this module is recommend-only; no gap finding may reach an auto-apply or auto-PR path (FR-7.2's "judge whether the gap is genuine" is a human decision at MVP, and NFR-8's policy line makes net-new content human-gated regardless).

| # | Task | Acceptance criteria |
|---|---|---|
| E5.10 | Query-coverage extraction: for each page, the GSC query×page fact set it earns impressions on, split into (a) queries the page covers on-page, (b) queries it ranks for but whose topic is absent from its extracted main content, (c) queries better served by a *different* page on the site (routes to E5.4 cannibalization, not to a gap) | On the fixture site, a page seeded with impressions for an uncovered sub-topic produces exactly one gap row in class (b); the seeded cannibalization pair produces zero gap rows and one cannibalization row |
| E5.11 | Gap scoring and set-arithmetic: cluster class-(b) queries by embedding (~0.75 cosine, the same threshold family as E5.4 [73]), score each cluster by impressions × expected-CTR-upside from the E5.6 curve service, and attach evidence (query list, impression counts, current position band) | Every gap carries numeric evidence — no gap is emitted from an LLM's opinion; clusters below the power floor (E11.10's ~10 clicks/day equivalent) are labeled low-evidence rather than dropped silently |
| E5.12 | Honest-coverage labeling and recommend-only routing: each gap is stamped `evidence_source=gsc_only`, carries the anonymized-query caveat, and emits a `CONTENT_GAP` recommendation object consumed by the dashboard review queue (E14.2) — never by E6's op emitter | A gap can never become an applied change: an adapter-level test asserts no change-application path accepts a `CONTENT_GAP` object. The UI states plainly that GSC hides ~47% of clicks behind anonymized queries [35] and that per-site anonymization runs 45–80% [75], so a gap list built on GSC alone is a lower bound on demand, never a complete picture — and that competitor-derived gaps ship post-MVP |

**Exit gate:** SPEC worked examples reproduced in CI; site-model questions of FR-2.2 each answerable by a documented query; a seeded query-coverage gap surfaces with its evidence and cannot be auto-applied.

---

### Epic E6 — AI Optimization Engine (9 pw)

Goal: FR-4 complete. Trace: FR-4.1–4.4, NFR-6 (E6.3/E6.13/E6.14 are where cost-boundedness is enforced), NFR-8 (bounded, additive content ops only). Positions applied: typed-operation emitter, never a content writer — schema-enforced JSON ops with `oldValue` anchors verified against the live page before apply; provider-native constrained decoding + validator/re-ask layer [7][8][9]; confidence computed from validators + k-sample self-consistency + cross-model judge, never the model's self-report; Haiku-class bulk → Sonnet-class judgment → Opus-class judging, Batch API (uniform 50% off) throughout; prompt-injection containment by architecture (no-tool generator, output allowlists).

**Module 6.1 — Operation schema & providers**

| # | Task | Acceptance criteria |
|---|---|---|
| E6.1 | One platform-wide op schema (action enum, targetUrl, targetSelector, oldValue, newValue, reason, evidence[], model_self_report, risk) | Schema stable across providers (dialect differences live in adapters); risk assigned by lookup table in code, never trusted from the model |
| E6.2 | Anthropic primary adapter (`messages.parse()`), OpenAI + Gemini fallback adapters; refusal handling as first-class outcome | Provider switch requires zero schema change; refusal never reaches the parser |
| E6.3 | Batch API integration + per-site AI budget caps | Nightly generation runs as batches; a site hitting its token budget queues remaining work and emits an event |

**Module 6.2 — Context packs**

| # | Task | Acceptance criteria |
|---|---|---|
| E6.4 | Pack assembler: **> 4K stable cached prefix + 2–4K volatile per-page blocks**, stable-first ordering for prompt caching, per-block size budgets. The prefix floor is not stylistic — Haiku's minimum cacheable prefix is 4,096 tokens, so a shorter shared prefix is never cached and the tiering economics of E6.14 do not hold | Pack size distribution monitored; oversized packs truncated by priority, never silently (context-rot evidence is the design driver [10]) |
| E6.5 | Sanitization: strip scripts/comments/hidden elements (incl. white-on-white, off-screen); third-party text in delimited data blocks; competitor digests via quarantined summarizer with no free-text field > 1 sentence | Injection corpus from Phase 0 runs in CI: zero off-policy ops, permanently |
| E6.6 | One page-task per request (no multi-page packing) | Cross-page bleed test: facts from page A never appear in page B's output across a 200-page batch |

**Module 6.3 — Validators & re-ask**

| # | Task | Acceptance criteria |
|---|---|---|
| E6.7 | Deterministic validators: pixel width (desktop + mobile budgets, config constants), keyword coverage/placement, site-wide uniqueness, no-new-facts (numbers/dates/superlatives/entities must appear in pack), URL allowlists (internal-link targets from site inventory only; no off-site URLs), banned-claims lists | Each validator has positive + negative unit fixtures; any allowlist failure hard-fails the op |
| E6.8 | Re-ask loop (validator error appended, max 2 retries, then drop or escalate) | ≥ 90% validator pass within 1 retry on the fixture corpus [9]; persistent failures never trimmed into compliance |
| E6.9 | Op-hash idempotence guard (never re-propose an applied/rolled-back op within N days) | Title oscillation A→B→A across cycles is impossible by construction |

**Module 6.4 — Confidence**

*Named reconciliation of two research lanes.* The safety-core lane proposed `0.6 × validation + 0.3 × historical acceptance + 0.1 × AI self-report`. The AI lane measured why that last term cannot be there: verbalized LLM confidence is systematically overconfident, clustering in the 80–100% band regardless of actual correctness, in judge roles as much as in generator roles. The decision register settles it — self-report is *recorded but never the gate* — so the earlier weighting is superseded here rather than silently averaged. The 0.1 weight is redistributed to the two terms that are measurable: the deterministic soft-validator score and the k-sample self-consistency agreement the earlier formula omitted entirely. The self-report column survives for one honest reason: once enough KEEP/ROLLBACK outcomes exist (E6.12), it can be *tested* as a feature against real labels instead of assumed to work.

| # | Task | Acceptance criteria |
|---|---|---|
| E6.10 | Computed confidence: **0.55 × soft-validator score + 0.25 × historical acceptance (this site × this change type) + 0.20 × k-sample self-consistency agreement (E6.11)**; hard validators are gates, not score inputs. The model's `model_self_report` field is stored on the op as an audit column and is **not a term in the formula** | The number the decision engine consumes is never model-emitted — asserted by a unit test that perturbs `model_self_report` across its whole range and requires the computed confidence to be byte-identical. Self-report is used only as a *flag*: a value < 0.8 raises a review marker and, on MEDIUM+ ops, triggers one regenerate — it can never raise a score, only draw attention |
| E6.11 | k-sample self-consistency (k = 3 for MEDIUM+ ops; k = 1 for LOW alt-text — agreement measured exactly for enums/URLs, by embedding cluster for text) + cross-model judge (stronger model, pairwise with order swap) | Agreement is emitted as the 0.20-weight term E6.10 consumes; where k = 1 the term is unavailable and the weight is redistributed to the validator score, which is recorded on the op so the two populations are never compared as if identical. Judge scores are used as rank features, not probabilities |
| E6.12 | Calibration pipeline (isotonic per action type, monthly, fed by KEEP/ROLLBACK outcomes; conservative priors until ~hundreds of labeled ops exist) | Cold-start posture enforced: auto-apply only LOW risk until calibration data accumulates; calibration curves versioned |

**Module 6.5 — Tiering**

| # | Task | Acceptance criteria |
|---|---|---|
| E6.13 | Tier-0 router: rule-shaped fixes (canonicals, redirects targets, sitemap, dimensions) bypass the LLM entirely | Zero LLM tokens spent on deterministic fix classes (metered) |
| E6.14 | Model routing (bulk-tier alt/meta; workhorse-tier titles/headings/FAQ/anchors/schema; frontier-tier judging/escalation) | Per-tier cost telemetry; a full 10k-page metadata pass lands within the researched envelope at 3,000 input / 500 output tokens per page — **$27.50–$82.50 generation-only, $33–88 all-in once selective Opus judging is counted** (the all-in figure is the one to quote for a pass; the bare "$30–85" is neither) |

**Exit gate:** POC 3 criteria at production scale (10k-page batch), injection CI green, cost telemetry within envelope.

---

### Epic E7 — Change Application Layer: GitHub adapter (11 pw)

Goal: FR-9.1 (**both halves — Next.js *and* other React frameworks**), FR-10. Trace: NFR-1 (nothing reaches a repo except through E8), NFR-5 (token custody). Positions applied: GitHub App only — per-installation, per-repo, 1-hour down-scoped tokens [12][13]; two-tier generation (ts-morph codemods execute, LLM supplies values; free-form LLM diffs only where codemods can't express the change, applied search/replace apply-or-reject [11][56]); commits via GraphQL `createCommitOnBranch` (signed, `expectedHeadOid` guard) [15]; one logical SEO change per PR.

**Module 7.1 — GitHub App & onboarding**

| # | Task | Acceptance criteria |
|---|---|---|
| E7.1 | App registration, installation flow, webhook receiver (installation, push, PR events) | Install → project connection recorded with repo allowlist; uninstall revokes cleanly |
| E7.2 | Per-run token minting (single-repo, minimal permissions) | Token scopes verified in tests: `contents:write`, `pull_requests:write`, `checks:write`, `metadata:read`, 1-h expiry [13] |
| E7.3 | Branch-protection/ruleset read at onboarding; automation level adapted | If reviews are required, MEDIUM changes stop at "PR open + reviewer requested" and the project's automation ceiling is surfaced honestly |

**Module 7.2 — Repo analysis**

| # | Task | Acceptance criteria |
|---|---|---|
| E7.4 | **Framework-profile detection** (the first thing the adapter does on a repo): Next.js App Router · Next.js Pages Router · Remix · Gatsby · generic React build (Vite/CRA) — plus the *render mode* for the last three (pre-rendered/SSR vs client-only), read from build config and confirmed against a rendered-vs-raw fetch of a live route | Each of the five profiles is detected correctly on its fixture repo; an unrecognised stack yields "unsupported profile — recommend-only", never a guess. A client-only render mode caps the project's automation ceiling at MEDIUM and says so in the connection health state (E14.1), matching the §2.1 deferral row |
| E7.5 | Effective-metadata resolver, per profile: Next.js segment-chain walk with shallow-merge semantics; **Remix `meta` export resolution up the route hierarchy [65]; Gatsby `Head` export per page/template [66]; react-helmet / `react-helmet-async` `<Helmet>` element resolution including the nearest-provider and last-write-wins rules [64]** | For every route, the resolver names the file *and the mechanism* owning each metadata field; the layout-vs-page blast-radius test from POC 4 runs in CI for Next.js and has a matching sibling test per React profile (a shared `<Helmet>` in a layout component must not be edited to fix one route) |
| E7.6 | Metadata-source classification: code-owned / content-file-owned / CMS-owned | CMS-owned routes are refused by the GitHub adapter with an explanatory event (wrong write target — patching code would be overwritten) |

**Module 7.3 — Codemod library**

| # | Task | Acceptance criteria |
|---|---|---|
| E7.7 | Next.js production codemods: `metadata` field upsert, `alternates.canonical`, `metadataBase` precheck, `next/image` alt, `app/sitemap.ts` / `app/robots.ts` creation, JSON-LD component insert, MDX frontmatter | Each codemod has its own fixture suite; apply-or-fail-loudly semantics; zero collateral diff asserted mechanically on every application |
| E7.8 | **React (non-Next) codemods**: `<Helmet>`/`<Head>` child upsert (title, `<meta name="description">`, `<link rel="canonical">`) for react-helmet-async [64]; Remix `meta` return-array entry upsert [65]; Gatsby `Head` export upsert [66]; `<img alt>` attribute fill; static `sitemap.xml`/`robots.txt` emission where the build serves a public directory | Each has its own fixture repo (Vite + react-helmet-async, Remix, Gatsby) and the same zero-collateral-diff assertion as E7.7; where a page has no head mechanism at all, the codemod refuses and the finding routes to recommend-only rather than inventing one |
| E7.9 | LLM patch path for long-tail edits (custom `<SEO>` components, content-shaped edits): search/replace blocks, exact-match apply | Non-matching search text rejects and regenerates — never fuzzy-applied; this path is always MEDIUM+ |

**Module 7.4 — PR mechanics**

| # | Task | Acceptance criteria |
|---|---|---|
| E7.10 | Branch → `createCommitOnBranch` (+`expectedHeadOid`) → PR; one logical change per PR; HIGH-adjacent files never batched with content changes | Concurrent-push race test green (POC 6 criterion as CI); commit shows Verified badge |
| E7.11 | Auto-merge after checks (handling the 422-before-requirements behavior [16]) + merge-queue support; `mergePullRequest` with `expectedHeadOid` | A last-second human push cannot be merged unreviewed |
| E7.12 | Write-rate budgeter (≤ 80 content-writes/min, 500/h per installation [14]); change batching per PR | Sustained load test stays under secondary limits with queueing, not errors. Sizing is the same division as POC 6 criterion 5: at ≤ 4 writes/PR the ceiling is 125 PRs/h, at ≤ 3 it is ~166 — the budgeter is configured from the *measured* writes/PR, never from the target |

**Module 7.5 — Deploy & rollback plumbing**

| # | Task | Acceptance criteria |
|---|---|---|
| E7.13 | `revertPullRequest` integration; revert PRs run the full validation pipeline at elevated priority | Merged batch reverts cleanly; conflict (human edited same lines) → revert PR filed + human escalation, never forced |
| E7.14 | Vercel Instant Rollback adapter (incl. the post-rollback disabled-auto-promotion state machine [22]) + Netlify restore [23]; both behind a host-adapter interface | Emergency rollback takes effect in seconds on the pilot host; the "next deploy silently never ships" trap is modeled and tested |

**Exit gate:** POC 4/6 criteria as CI; end-to-end: finding → op → codemod → PR → checks → merge → deploy on the fixture repo — run twice, once on the Next.js fixture and once on a non-Next React fixture (Vite + react-helmet-async pre-rendered), so FR-9.1's "React" half is demonstrated and not assumed.

---

### Epic E8 — Validation Pipeline (8 pw)

Goal: FR-12 complete (git channel; the CMS equivalent ships in E9). Trace: FR-12.1–12.2, NFR-1 (this epic *is* "never blindly modify production"), NFR-5 (E8.4 is the RCE boundary). Positions applied: static gates → sandboxed egress-restricted build (customer `npm install` treated as hostile) → preview deploy → SEO assertions on the rendered preview → results as GitHub Checks.

**Module 8.1 — Static gates**

| # | Task | Acceptance criteria |
|---|---|---|
| E8.1 | Changed-file allowlist per framework profile; deny-always list (workflows, lockfiles, `next.config.*`, `vite.config.*`, `gatsby-*.js`, `remix.config.*`, middleware, env, manifests) | Off-allowlist diff is rejected before any build spend; deny-list is not project-overridable below admin role |
| E8.2 | Diff budgets per change type (metadata: 1 file/≤10 lines; content: ≤3 files/≤120 lines) | Violation → reject and regenerate, never trim |
| E8.3 | Static checks: ESLint + `tsc --noEmit` on changed tree | Malformed JSX caught pre-build |

**Module 8.2 — Sandboxed build**

| # | Task | Acceptance criteria |
|---|---|---|
| E8.4 | Ephemeral build sandbox: per-build container/microVM, no platform secrets, egress-restricted, single-tenant, destroyed after run | Phase-0 hostile-postinstall test is a permanent CI fixture; two tenants never share a sandbox |

**Module 8.3 — Preview deploy**

| # | Task | Acceptance criteria |
|---|---|---|
| E8.5 | Preview deploy adapters: Vercel `POST /v13/deployments` with `gitSource` [20]; Netlify draft deploys [23]; self-hosted preview fallback (build artifact served internally — the path Vite/CRA/Gatsby fixtures use) | Preview URL produced for all three paths; host tier ceilings respected (100 deploys/day on Vercel Hobby caps validation throughput — surfaced per project [21]) |

**Module 8.4 — SEO assertions on the rendered preview**

| # | Task | Acceptance criteria |
|---|---|---|
| E8.6 | Meta-tag diff assertion on the rendered preview (post-hydration): intended change present, **nothing else changed** (canonical, robots, hreflang, OG, H1 count, link set) | Dropped-canonical regression caught; assertion diffs are attached to the PR check |
| E8.7 | **Per-profile validation profiles**, keyed to E7.4's framework detection: Next.js asserts on the server-rendered HTML; Remix/Gatsby/pre-rendered React assert on the pre-rendered output; client-only React additionally asserts on a JS-executed render, and its verdict is stamped `rendered_only` | A client-only React fixture whose title is set solely by `<Helmet>` passes the rendered assertion and is still refused auto-apply by E10 (its profile carries the MEDIUM ceiling from §2.1). The assertion harness never reports "metadata present" from a raw fetch of a client-rendered page — the raw/rendered pair is compared and a raw-empty head is reported as such |
| E8.8 | Analyzer re-run on preview: target issue resolved, zero new issues | The Platform's own rulebook is the SEO validation of record (FR-12.1) |
| E8.9 | Nu HTML Checker (self-hosted v.Nu service) on rendered HTML [17] | Conformance errors fail the check with pointered messages |
| E8.10 | In-house JSON-LD validator (parse → schema.org vocabulary → Google feature rule-pack, maintained with a named owner) [18] | Seeded invalid/ineligible schema caught pre-deploy; rule-pack diffs against Google's feature docs on a scheduled job |
| E8.11 | Lighthouse CI: baseline-relative assertions, median of ≥ 3 runs, per-page-class baselines [19] | No absolute-score gates; regression vs stored baseline fails the check |
| E8.12 | lychee link check scoped to the diffed pages [63] (full-site link auditing remains the crawler's job, E3.7) | Broken link introduced by a change is caught pre-merge |

**Module 8.5 — Checks reporting**

| # | Task | Acceptance criteria |
|---|---|---|
| E8.13 | Checks reporting: named check runs per gate (`seo-platform/build`, `seo-platform/seo-validation`, …) | Customers can mark platform checks required in branch protection, making validation server-enforced |

**Exit gate:** POC 5 criteria as CI; 10/10 deterministic verdicts on the seeded-bad-change suite, run against both the Next.js and the non-Next React fixture.

---

### Epic E9 — WordPress Adapter (7 pw)

Goal: FR-9.2 complete, plus FR-12 for the CMS channel, with §15-grade pre-deploy validation despite the channel writing straight to production. Trace: NFR-1 (this is the channel where "never blindly modify production" is hardest to honour and therefore most load-bearing), NFR-5 (least-privilege Application Passwords). Positions applied: WordPress REST + a mandatory ~50-line-core companion plugin (Yoast's REST surface is officially read-only [24]; Rank Math meta is silently dropped unless registered [25]) — grown with the staging/preview/probe features; three-rung validation ladder (simulated render → autosave staging where possible → canary apply) plus read-back verification on every write.

**Module 9.1 — Companion plugin**

| # | Task | Acceptance criteria |
|---|---|---|
| E9.1 | Meta registration for Yoast/Rank Math/AIOSEO (`show_in_rest`, auth callback), detecting the active SEO plugin | Title/description/canonical writable via core `meta` object on `POST /wp/v2/posts/{id}`; without the plugin the adapter reports "not writable" honestly |
| E9.2 | Token-based public preview of autosaves (own implementation of the anonymous-nonce pattern); cache-purge hook; health/version endpoint; render-mapping probe endpoint | Anonymous preview link renders staged content; purge fires on every write |
| E9.3 | Plugin CI matrix on WordPress Playground (WP × Yoast × Rank Math release grid) | Matrix green before any plugin release; breakage on a new WP/Yoast version is caught by CI, not by customers |

**Module 9.2 — REST write path**

| # | Task | Acceptance criteria |
|---|---|---|
| E9.4 | Application Passwords onboarding (dedicated least-privilege Editor user; HTTPS enforced); host/WAF block diagnostics | 401/403/429 patterns produce a "your host is blocking us, here's the fix" diagnostic, not a silent failure |
| E9.5 | Writes: post/page meta (registered keys), media `alt_text` [26], content edits | **Read-back verification on every write** — `GET` and byte-compare stored vs intended; the silent-drop failure class (unregistered meta) is detected on the spot |
| E9.6 | Batch pacing (~5–10 rps under WAF radar) + partial-failure ledger state | Mid-batch failure leaves per-object state recorded and an auto-repair queue entry — never a silent half-applied batch |

**Module 9.3 — Pre-deploy validation ladder**

| # | Task | Acceptance criteria |
|---|---|---|
| E9.7 | Rung 1 — simulated render: patch the fetched production DOM in memory with the same projection the CMS will perform; run the full E8 assertion suite on the patched DOM | The dominant failure class (bad generated values) is caught before any write; identical meta-diff invariant as the git channel |
| E9.8 | Render-mapping probe at onboarding + on theme/plugin fingerprint change (sentinel value on a disposable draft; learn the stored-value→rendered-tag projection) | A field whose probe shows "ignored by theme" is marked not auto-writable for that site — an honest capability detection surfaced to the user |
| E9.9 | Rung 2 — autosave staging for content/heading edits (`/wp/v2/posts/{id}/autosaves` [27]) + token preview validation | Staged content validated on a real render without touching the live post; SEO meta correctly excluded from this rung (structural WP limitation, documented) |
| E9.10 | Rung 3 — canary apply for meta batches: lowest-traffic URL first → live render meta-diff within seconds (cache-aware polling) → roll remaining N−1 paced with sampled re-verification → on failure, restore ledger `before` value and quarantine the change-type × site pair | Ledger marks canary vs pre-verified-by-canary records distinctly — the honesty distinction the §26 bucketing requires |

**Module 9.4 — Rollback**

| # | Task | Acceptance criteria |
|---|---|---|
| E9.11 | Ledger-based before-value restore (the source of truth — WP revisions do not reliably capture SEO plugin meta); reverse-order replay with per-write verification | Rollback of a 50-page batch restores every value with read-back confirmation; partial rollback states alert, never silently complete |

**Exit gate:** full flow on the fixture WP site: finding → op → simulated render → canary → batch → read-back → ledger; forced-failure drill restores cleanly.

---

### Epic E10 — Decision Engine & Change Ledger (6 pw)

Goal: FR-11, FR-13, the SPEC §14 "detailed scoring mechanism". Trace: NFR-1 (nothing reaches a site without passing this epic), NFR-3 (auditable arithmetic on both axes), NFR-8 (E10.4's velocity caps and update-rollout freeze). Positions applied: two independent axes — confidence ("is it correct?") × risk ("cost if wrong?") — combined in a decision matrix, never one blended score; risk = B(type) × blast-radius × traffic-value × velocity, dampened by earned trust; a hard deny-list no score can override (robots.txt B=100, mass redirects/URL restructuring 95, page deletion 95, mass canonicals > 10 pages 90 — permanently human-gated); append-only event-sourced ledger with batch-level rollback units and a mandatory drift check.

**Module 10.1 — Risk & decision**

| # | Task | Acceptance criteria |
|---|---|---|
| E10.1 | Base-risk table B(type) + modifiers M_scope (1.0→2.0), M_traffic (0.8→1.6, from warehoused GSC), M_velocity (1.0→1.5), trust dampener (0→0.25, halved on any rollback), tier floors | Worked examples reproduce as unit tests: alt-text on a low-traffic page → LOW auto-apply; title on a top-20 page → MEDIUM PR with protected-page bump; robots.txt → HIGH always. A golden test pins the mass-canonical constant: a canonical batch of 10 pages routes normally, 11 pages ⇒ HIGH — the threshold is enforced by test, not by prose |
| E10.2 | Hard deny-list enforcement (robots.txt, mass redirects/URL restructuring, page deletion, **mass canonicals > 10 pages** [D-13]) | A 0.99-confidence robots.txt op cannot reach any auto path — proven by test; the same test covers an 11-page canonical batch, so the > 10-page constant is enforced by the deny-list goldens rather than by prose; deny-list is not configurable below platform-admin level |
| E10.3 | Decision matrix — the full 3 × 3 below, implemented as data, not as branching code | Every decision row logged with both axis values and all modifier inputs — auditable arithmetic, no black box (NFR-3). **Golden tests cover all nine cells**, each with a worked example, plus the two boundary rows (confidence exactly 0.85 and exactly 0.60) so the band edges cannot drift silently |
| E10.4 | Budget caps: auto-apply ≤ max(20, 2% of indexed pages)/site/day; batch ≤ 50 pages; automation freeze during confirmed Google update rollouts (status-dashboard poller) | Cap breach queues as MEDIUM; freeze window verifiably blocks auto-apply and stamps `policy_flags` |
| E10.5 | Protected-page rule (site's top-20 by clicks bump one tier minimum) | Enforced independently of score |

**The decision matrix in full** (this is the artifact SPEC §14 calls "a detailed scoring mechanism"; risk bands are the computed risk score of E10.1, confidence is the computed number of E6.10):

| | **risk < 25 — LOW** | **25 ≤ risk ≤ 60 — MEDIUM** | **risk > 60 — HIGH** |
|---|---|---|---|
| **confidence ≥ 0.85** | **AUTO-APPLY** — direct commit / CMS write, still batched, ledgered and monitored | **AUTO-PR** — human merges | **RECOMMEND-ONLY** — a human implements it, or approves an engine-drafted PR with a mandatory second reviewer |
| **0.60 ≤ confidence < 0.85** | **AUTO-PR** — *not* auto-apply: correct-looking but less-certain LOW work still earns a human merge | **RECOMMEND-ONLY** | **RECOMMEND-ONLY** |
| **confidence < 0.60** | Discard / regenerate (max 2 regens, then drop) | Discard | Discard |

Two properties of this table are load-bearing and are the ones most easily lost when the matrix is summarised in prose: the middle confidence band exists (routing is not "≥ 0.85 or discard"), and **risk tier alone never determines routing** — a MEDIUM-risk op at confidence 0.61 is recommend-only, not an automated PR, and a LOW-risk op at 0.70 gets a human merge rather than an auto-apply. The deny-list (E10.2) sits above the whole table: no cell can be reached by a deny-listed change type at any confidence. Novel change types with no base-risk entry default to MEDIUM minimum until 50 observations exist.

**Module 10.2 — Change ledger**

| # | Task | Acceptance criteria |
|---|---|---|
| E10.6 | Schema: `change_batch` (atomic rollback unit = one PR / one CMS transaction), `change` (full FR-13.1 field set incl. `recrawl_verified_at`, `eval_start_at`, verdict fields), `change_event` (append-only spine), content-addressed `blob` store, `site_trust` | No UPDATE on history — verified by DB privileges; every mutation of a customer site has a ledger row (FR-13.2), enforced by making the adapters ledger-writing by construction (no side-channel write API exists) |
| E10.7 | Drift check before rollback: live value must equal the original `after` blob; else 3-way diff + human escalation | The classic naive-rollback corruption path is impossible; test seeds an interim human edit and asserts escalation |
| E10.8 | Trust accounting (≥ 50 applied + ≥ 95% KEEP + zero guardrail rollbacks before trust grows) | Trust changes are events; any rollback halves trust for that (site × change_type) |
| E10.9 | Approval queue API (review, approve/reject with reason; approval → Temporal signal) | Approval permission honors E1.9's RBAC; every human action lands in the audit log |

**Exit gate:** decision matrix goldens green; ledger completeness proven by an adapter-level audit test (no write path bypasses it).

---

### Epic E11 — Monitoring & Rollback (10 pw)

Goal: FR-14 complete. Trace: NFR-1 (the rollback half of "safe"), NFR-3 (every verdict carries its evidence). Positions applied: two-phase monitoring — guardrail (days 0–7: crawl-diff, URL Inspection verdicts, HTTP/build errors, CUSUM on fresh GSC) then verdict (day 14–60 by change type: counterfactual from untouched control pages, CausalImpact-style BSTS or DiD + YoY — never naive pre/post [37][38][57]); the evaluation clock starts at **verified recrawl**, not deploy; two-speed rollback (platform instant + git revert PR; WP ledger restore); asymmetric class defaults.

**Module 11.1 — Guardrail phase**

| # | Task | Acceptance criteria |
|---|---|---|
| E11.1 | Post-deploy `crawl:verify-change` diff: intended delta present, zero collateral deltas, no bleed onto unintended pages | Seeded bleed (change appearing on a sibling page) triggers auto-rollback of the batch within minutes |
| E11.2 | Synthetic checks: HTTP status on changed URLs, robots.txt/sitemap fetchability monitor with last-known-good auto-restore (a 5xx robots.txt halts all Google crawling within ~12 h [43]) | Unfetchable robots.txt pages the operator AND restores last-good within 5 min |
| E11.3 | Indexing-state guardrail: previously-indexed changed page reported not indexed > 48 h → auto-rollback that change | URL Inspection budget honored; verdict recorded with evidence |
| E11.4 | CUSUM early-warning on residuals vs forecast (fresh/hourly GSC), guardrail-only (never verdicts); per-site tuning from first 60 days | Seeded sustained CTR drop trips CUSUM; parameters are per-site config with conservative defaults |
| E11.5 | Manual-action detector (no public API — UI/email monitoring hook, operational gap surfaced) | A manual-action signal freezes ALL automation site-wide + pages a human |

**Module 11.2 — Recrawl verification (the clock)**

| # | Task | Acceptance criteria |
|---|---|---|
| E11.6 | `recrawl_seen` / `reindex_confirmed` events (log-based where available; URL Inspection fingerprint fallback); decaying polling schedule from POC 8's measured CDFs | `eval_start_at` = reindex confirmation, never deploy time; "recrawl not observed after X days" → lastmod nudge, then escalate |

**Module 11.3 — Verdict phase**

| # | Task | Acceptance criteria |
|---|---|---|
| E11.7 | Control-page selection: untouched similar pages, no ledger entries in window, not linked from/to changed pages | Control validity rules enforced mechanically; poor pre-period model fit yields `insufficient_data`, never a verdict |
| E11.8 | Effect estimation: BSTS/CausalImpact primary (≥ 90 d pre-period), DiD + YoY fallback; credible intervals stored on the change row | The rollback engine consumes the lower credible bound of expected CTR from the shared curve service — thin data cannot whipsaw |
| E11.9 | Per-change-type windows (alt/JSON-LD/links 14 d; meta description 21 d; title/H1 21–28 d; content 28–42 d; internal-link batches 28 d; canonical/redirect 42–60 d) with one EXTEND max | Windows overlapping a confirmed Google update auto-extend by rollout + 7 d (exogenous-event calendar) |
| E11.10 | Power floor: page-level verdicts need ~10 clicks/day; below → cohort pooling; below ~1 click/day pooled → impressions+position; else `insufficient_data` | No verdict is manufactured from underpowered data — asserted on synthetic low-traffic fixtures |
| E11.11 | KEEP/ROLLBACK rules incl. asymmetric class defaults (correctness-class KEEP on inconclusive; opinion-class ROLLBACK on inconclusive-negative). **Title verdicts carry a declared MVP degradation.** Google rewrites 61.6% of titles (n = 80,959) [6], so a title verdict can measure Google's rewriter rather than the change. The full mitigation is a day-3 check of what Google actually *displays*, and GSC exposes no displayed-title field — that check needs a live SERP snapshot from the providers deferred in §2.1. In MVP, every title verdict is therefore stamped **`display_unverified`** and evaluated under the conservative asymmetric default (a title change that cannot be shown to have taken effect is not credited with a win; an inconclusive-negative on an opinion-class edit still rolls back). The GSC-side proxy — a shift in the page's branded-vs-non-branded query mix and impression distribution after the change — is computed as *supporting* evidence and labeled a proxy in the UI, never as confirmation of the displayed title | Decision table implemented as data with golden tests; every ROLLBACK decision is page-worthy alerting. A test asserts that no title verdict can be issued as a KEEP-with-effect-claim while `display_unverified` is set — it can only be `KEEP (unverified display)` or `ROLLBACK`. The task carries an explicit post-MVP hook: when a SERP provider ships, the day-3 display check drops in behind the same interface and clears the flag (this is what fully retires Doc 06 SEO-3) |

**Module 11.4 — Rollback executor**

| # | Task | Acceptance criteria |
|---|---|---|
| E11.12 | Two-speed: host instant rollback (emergency) + revert PR (durable) on git; ledger restore on WP; rollback is itself a ledger change requiring its own recrawl | Guardrail trip → live in seconds via host adapter; durable revert lands through the same validation pipeline |
| E11.13 | Anti-flapping: ≥ 30-day freeze on the page/change-type pair post-rollback; rolled-back changes never auto-re-applied | Verified by attempting an immediate re-propose (blocked by E6.9 + freeze) |

**Module 11.5 — Batch-level verdicts for internal-link cohorts**

| # | Task | Acceptance criteria |
|---|---|---|
| E11.14 | Internal-link batch verdict path (serves E12): the unit of evaluation is the **batch**, not the individual link — CausalImpact/BSTS on the cohort of *receiving* (target) pages against untouched control pages, at a **28-day** window, with the *source* pages watched as a second series because adding links changes their outlink dilution and topical focus. Where a batch spans ≥ 40–50 similar targets, insertion is randomized at generation time so the cohort is a true split test rather than an observational one | A seeded link batch produces one batch verdict with a credible interval, and per-link effect claims are impossible by construction — the API exposes no per-link effect field. Randomization is recorded on the batch so a split-test verdict is distinguishable from an observational one. Source-page regression beyond the credible interval trips the same rollback path as a target regression |

**Exit gate:** a seeded harmful change travels the full path — guardrail trip → auto-rollback → ledger → trust decay; a seeded neutral change reaches a KEEP verdict with a credible interval.

---

### Epic E12 — Internal-Linking Engine (7 pw)

Goal: **FR-8 complete** (FR-8.1 opportunity detection, FR-8.2 anchor proposal with variation, FR-8.3 the constraint set, FR-8.4 the auto-vs-recommend boundary). Trace: NFR-3 (every proposed link renders its three score factors), NFR-4 (this is the strongest genuinely-automatable action class the Platform has), NFR-8 (POL-3, link-scheme adjacency, is what the caps and the variation ledger exist to prevent).

Why this is its own epic rather than a few tasks inside E6: internal linking is the one capability with real *experimental* evidence behind it — controlled split tests measured **+7% organic traffic to pages receiving new internal links** [48] — and it is the action class the automation-boundary analysis calls the strongest "mostly automatable" candidate. It is also the one capability that spans four layers (graph → embeddings → anchor selection → AST insertion → batch verdict), so its pieces would otherwise scatter into fragments that each look complete in their own epic and add up to no engine: a target-need score in E5.2, an action enum value in E6.1, a URL allowlist in E6.7. Owning them under one epic with one exit gate is what makes FR-8 verifiable.

Positions applied: three-channel candidate generation; score = target-need × source-relevance × placement quality; anchors only from text already present on the source page, with an exact-match-once-then-vary ledger per target; per-page and per-target link caps; **server-side AST insertion via the E7 (git) and E9 (CMS) adapters — never JavaScript injection**, because JS-only internal links measured **no detectable SEO impact** in controlled testing [71]; T1/T2/T3 autonomy tiers; batch-level 28-day verdicts through E11.14.

**Module 12.1 — Candidate generation (three channels, unioned)**

| # | Task | Acceptance criteria |
|---|---|---|
| E12.1 | **Channel A — exact-phrase / anchor dictionary.** Build the site's anchor dictionary from its existing links (anchor → target pairs); keep only anchors whose link-probability (share of occurrences that are already linked) exceeds ~6.5%, the filter the Wikimedia production model uses to kill stopword-like phrases [68]; then Aho-Corasick scan every page's extracted main content for unlinked occurrences of each target's phrase set (title, H1, GSC queries the target already ranks top-10 for, operator-set keywords) [69] | Runs in O(content) with no API cost; on the fixture site, a seeded unlinked mention of a target's exact phrase is proposed with that mention as the anchor. Link-probability filtering demonstrably removes generic phrases (run with the filter disabled must show the stopword class appearing). Cold-start handled: a site with weak existing linking bootstraps the dictionary from titles/H1s/GSC queries and runs at reduced T1 volume for its first cycles |
| E12.2 | **Channel B — page + paragraph embeddings.** Reuse E5.3's embeddings (main content only — including nav/boilerplate measurably degrades embedding quality); pair-score at cosine **0.78–0.85**, tuned per site by elbow method [74]; paragraph-level similarity selects the *insertion paragraph*, not just the page pair | Threshold is per-site config with the researched band as the default; below ~0.78 irrelevant pairs proliferate and above ~0.85 valid relations are filtered — both failure modes are demonstrated on the fixture site as regression tests. This channel proposes no anchor by itself and is never allowed to: it hands its paragraph to E12.3 |
| E12.3 | **Channel C — GSC query bridge.** If source page P earns impressions for query Q and target T is the site's primary ranker for Q, propose P→T, carrying Q as the anchor seed | Ties linking to revenue-bearing queries; requires an E4 connection and degrades to channels A+B without one, stated in the UI rather than silently |
| E12.4 | Fusion, eligibility filters and scoring: union the three channels; drop candidates where the source already links the target, the target is the source itself / `noindex` / a redirect / canonicalized elsewhere (link the final URL), or the anchor equals the source's own title. Negative-context guard: a cheap-LLM sentence-level check that the surrounding sentence's meaning actually matches the target's topic. Score = **target_need (E5.2) × source_relevance × placement_quality**, with channel agreement as a precision bonus and penalties for cap pressure | The documented keyword-matcher failure — linking "how *not* to do X" to the X guide — is caught by the negative-context guard on a seeded fixture. Every emitted candidate renders its three factors and its penalties; an ambiguous anchor (a phrase that could point at three of the site's pages) routes to E5.4's cannibalization logic instead of being linked |

**Module 12.2 — Anchor selection and the variation ledger**

| # | Task | Acceptance criteria |
|---|---|---|
| E12.5 | Anchor selection from existing text: the anchor must occur verbatim in the chosen source paragraph; the model's role is span *selection and boundary trimming*, never generation. Length 2–6 words; no whole-sentence anchors, no "click here" | An op whose `newValue` anchor text does not appear verbatim in the source paragraph is rejected by a hard validator (E6.7's family), not by review. Rewriting a sentence to host an anchor is not this task — it is T3, recommend-only |
| E12.6 | Sitewide **anchor-variation ledger, keyed per target**: the first inbound link to a target may take the exact-match phrase (the pattern correlated with ~5× traffic in the 23M-link study [47]); every subsequent link to that target must use a different surface form, and no anchor string may be reused for one target more than ~2–3 times sitewide | The documented Link Whisper failure mode — every link to a page using identical anchor text [72] — is impossible by construction; a test attempts a fourth identical anchor to one target and is refused. Anchor variety is also the strongest single correlation in the same study [47], so the ledger is a quality feature, not only a spam guard |

**Module 12.3 — Caps and placement**

| # | Task | Acceptance criteria |
|---|---|---|
| E12.7 | Cap enforcement: **inbound cap** ~40 links per target (traffic rises to ~40–44 inbound and declines after ~45–50 [47]); **outbound density** max ~1 contextual link per 100–150 words of main content, counting existing links; **per-run budgets** ≤ 3 contextual insertions per page per cycle (5 only as a documented per-project override — the tighter default is what keeps the pattern editorial rather than schematic under POL-3) and a bounded share of the site per run, so each batch stays attributable and rollback-sized | Caps are enforced before generation, not after — a candidate that would breach any cap never reaches the model. A synthetic over-linked page proposes zero new links. Per-run budgets are the same mechanism as E10.4's velocity caps, not a parallel one |
| E12.8 | Placement scoring: main-content paragraphs rank far above lists/sidebars; earlier-in-document ranks above later; nav/header/footer/template regions are ineligible entirely | Placement factor is visible per candidate; a seeded candidate whose only occurrence is in a footer template is refused rather than downgraded |

**Module 12.4 — Insertion (server-side, through the existing adapters)**

| # | Task | Acceptance criteria |
|---|---|---|
| E12.9 | **MDX/Markdown insertion via AST-located, offset-spliced edit**: parse with unified/remark (+`remark-mdx`) to locate the anchor span and validate eligibility, then splice the link into the *original bytes* at the mdast position offsets rather than re-stringifying the file [70]. Forbidden ancestors are refused outright: headings, existing links (never nest), code/inline-code, blockquotes, image alt, frontmatter, MDX JSX attributes and expressions, import/export nodes | Round-trip gate: re-parse the edited file and assert the **only** tree difference is the added link node; MDX must additionally compile; then the normal E8 build gate runs. Diff hygiene is asserted mechanically — a full re-stringify that normalises unrelated bullets or emphasis markers fails the test, because noisy diffs are what erode reviewer trust and can subtly alter MDX semantics |
| E12.10 | **HTML/CMS insertion via E9**: parse the post body, restrict to text nodes inside `<p>`/`<li>` in the main content container, respect Gutenberg block boundaries (edit inside a paragraph block, never across one); detect page-builder content stored as JSON in meta and downgrade to recommend-only | Insertion goes through E9's write path and read-back verification like any other CMS write; an Elementor-style fixture is detected and refused rather than corrupted. Idempotency key = (source, target, anchor, content-hash-at-insert); if the paragraph hash changed since analysis (an author edited it), the candidate is re-analysed before anything is written |
| E12.11 | Broken-internal-link **retargeting** (a link pointing at a 404 or through a redirect chain → repoint at the final live URL) | This is the one fully automatic path from day one: it is a LOW-risk correctness fix, and pointing links at final URLs instead of through 301s is itself a measured win [48]. It is also the capability §2.6 step 9 cites as evidence of auto-applied LOW-risk changes, so it ships as an auto-apply class with its own fixture and ledger rows |

**Module 12.5 — Autonomy tiers and measurement**

| # | Task | Acceptance criteria |
|---|---|---|
| E12.12 | **T1 / T2 / T3 tiering**, implemented as data in the E10 decision path rather than as a separate gate. **T1 (auto-PR, batch-approvable, optionally auto-merge after N clean batches):** exact anchor present verbatim in an eligible paragraph · cosine ≥ the site's tuned threshold · ≥ 2 channels agree · no existing S→T link · source under outlink budget · target under the inbound cap · anchor passes the variation ledger · negative-context check passed · file round-trips and builds clean. **T2 (recommend with one-click apply):** semantically strong but the anchor is imperfect — phrase split by inline formatting, partial match only, anchor would repeat a heavily-used string, target is a designated money page, or similarity in the 0.75–0.80 gray zone. **T3 (recommend-only, never auto):** requires writing or rewriting a sentence to host the anchor · template/nav/footer changes with site-wide blast radius · ambiguous or thin target identity · non-parseable content | Each tier has golden fixtures; a candidate failing any single T1 condition demonstrably lands in T2, not T1. Internal links are MEDIUM risk per SPEC §14, so T1's ceiling is an automated PR a human merges — **auto-merge is unlocked per project only after a configured run of clean batches**, and that unlock is an audited policy change (E1.9), never a default |
| E12.13 | Batch assembly and verdict wiring: group insertions into evaluation batches, register each batch with E11.14 for a 28-day CausalImpact verdict against control pages, and make rollback a ledger-offset removal of the inserted anchors | A batch reaches a verdict with a credible interval and reports at batch level by default; per-link effect claims are refused unless a randomized split test backs them. Rollback of an internal-link batch is exercised in the drill and restores the source files/posts byte-exactly |

**Exit gate:** on the fixture Next.js site and the fixture WordPress site — candidates generated by all three channels, anchors selected under the variation ledger, caps enforced, a T1 batch inserted server-side through a PR (git) and a write batch (WP), the round-trip and build gates green, a T3 case correctly refused, one batch registered for a 28-day verdict, and a full batch rollback restoring the originals.

---

### Epic E13 — Autonomous Loop (5 pw)

Goal: FR-15 complete. Trace: **NFR-4** — this epic is where "autonomous" stops being an adjective and becomes a scheduled, metered, interlocked workflow. Positions applied: Temporal (TypeScript SDK) as the backbone; coarse-phase workflows (~12 coarse phases per site per day — the P1–P12 enumeration in Doc 03 §4.2; the load-bearing property is O(10), never O(pages), since per-URL steps would inflate actions ~100× and blow event-history limits); signal-based approval gates [41]; durable multi-week monitors; per-tenant fairness keys with per-key rate limits [42].

**Module 13.1 — Workflows**

| # | Task | Acceptance criteria |
|---|---|---|
| E13.1 | `DailySiteRun` workflow: crawl → GSC pull → analyze → prioritize → generate → validate → apply-safe, as activities; workflow id `{tenant}:{site}:{date}` | Duplicate daily starts dedupe by id; a worker crash mid-phase resumes without repeating side effects (idempotency keys on all writes: branch name = change id, read-before-write on CMS) |
| E13.4 | `ChangeMonitor` per site-day batch (not per change — keeps open-workflow count and active-storage bounded), daily ticks, `continue-as-new` | A 30-day monitor survives worker restarts; monitors never approach the 51,200-event history cap |

**Module 13.2 — Schedules**

| # | Task | Acceptance criteria |
|---|---|---|
| E13.2 | Temporal Schedules per site with overlap-skip | A long-running crawl day never overlaps the next day's run |

**Module 13.3 — Approval gates**

| # | Task | Acceptance criteria |
|---|---|---|
| E13.3 | `ApprovalGate` child workflow: waits on approve/reject signal with durable timeout | Approval delivered days later resumes the exact workflow; timeout path downgrades to recommend-only |

**Module 13.4 — Fairness & metering**

| # | Task | Acceptance criteria |
|---|---|---|
| E13.5 | Per-tenant fairness keys + per-key RPS on the shared task queue [42] | A 100k-page tenant cannot starve ten 500-page tenants — demonstrated under synthetic load |
| E13.6 | Action metering vs the Temporal Cloud budget (~50–100 actions/site/day design target [40]) | Dashboard reports actions/site/day; alarm on 2× design estimate |

**Module 13.5 — Safety interlocks**

| # | Task | Acceptance criteria |
|---|---|---|
| E13.7 | Loop-level safety interlocks: velocity caps consulted before generation; update-rollout freeze honored; pages under open evaluation are not re-touched | The Doc 01 tension "daily loop vs weeks-long measurement" is resolved by construction: monitors run in parallel, touched pages are locked |

**Exit gate:** 7 consecutive unattended nightly runs on both pilot sites with zero manual intervention and a clean action-count audit.

---

### Epic E14 — Dashboard (8 pw)

Goal: FR-16.1 surface; **NFR-3** explainability made visible; NFR-4's controls (automation level, freeze) live here. Positions applied: Next.js 16 App Router, Tailwind + headless components, TanStack Query; SSE/polling for run progress; the dashboard's own SEO is irrelevant (auth-gated B2B). Delivery shape: this epic is **spread across every phase** (§2.5), not built at the end — each surface lands as the data behind it lands.

**Module 14.1 — Onboarding**

| # | Task | Acceptance criteria |
|---|---|---|
| E14.1 | Onboarding flows: GitHub App install, GSC OAuth (+ SA-invite instructions), WP plugin + application password; connection health states incl. the detected framework profile and its automation ceiling (E7.4) | A non-engineer completes Next.js-site onboarding in < 15 min following only on-screen guidance; a client-only React project is told plainly that its changes will ship as PRs rather than auto-apply, and why |

**Module 14.2 — Analysis surfaces**

| # | Task | Acceptance criteria |
|---|---|---|
| E14.2 | Site health: issues/opportunities feed with rule/severity/safety filters; site-model views (orphans, depth, weak pages, duplicate clusters); **content-gap recommendations (E5.12) and internal-link candidates (E12) with their score factors** | Every FR-2.2 question has a visible answer; findings deep-link to evidence (crawl snapshot, rule version); gap rows carry their `gsc_only` provenance and link candidates render target-need / relevance / placement rather than a single opaque number |

**Module 14.3 — Review & ledger**

| # | Task | Acceptance criteria |
|---|---|---|
| E14.3 | Review queue: per-op diff (old vs new value), reason, evidence pointers, confidence + risk with their inputs, batch approve/reject; internal-link batches reviewed as one unit with per-link expansion | Approving fires the Temporal signal (E13.3); the SPEC's explainability demand is visible on every row: no naked scores |
| E14.4 | Change ledger UI: full history, filters, before/after blobs, verdict status + ETA ("verdict expected ~day N" from measured CDFs), rollback button with confirmation flow | Rollback requires an explicit typed confirmation; drift-check escalations render the 3-way diff |

**Module 14.4 — Monitoring**

| # | Task | Acceptance criteria |
|---|---|---|
| E14.5 | Monitoring charts: guardrail status, GSC series with change markers, counterfactual vs observed, credible intervals | Charts consume the same curve-service version as the verdicts they display; a `display_unverified` title verdict (E11.11) is labeled as such on the chart, never rendered as a clean win |
| E14.7 | Run console: live crawl/agent status (SSE), Temporal run links for forensics | An operator can answer "what exactly did the system do to site X yesterday" in < 2 min |

**Module 14.5 — Settings & policy**

| # | Task | Acceptance criteria |
|---|---|---|
| E14.6 | Policy/settings: automation level per risk tier, budgets, allowlists, freeze status, internal-link T1 auto-merge unlock | Deny-list items render as permanently human-gated — not as toggles; the T1 auto-merge unlock states its precondition (N clean batches) and writes an audit-log row when changed |

**Exit gate:** full demo script executable by a non-developer through the UI alone.

---

## 2.4 Team shape

| Role | FTE | Delivery pw per week | Owns |
|---|---|---|---|
| Tech lead / architect | 1.0 | 0.5 | Architecture holds, decision-register conformance, E1/E10/E13 design, code review gates. Half the role is review and design supervision, which is why only 0.5 pw/week is counted as deliverable capacity |
| Platform engineer A | 1.0 | 1.0 | E2 crawler, E3 rulebook (with AI/data eng), E8 sandbox/infra side, E12 link-graph/insertion side |
| Platform engineer B | 1.0 | 1.0 | E7 GitHub adapter (incl. the React framework profiles), E8 pipeline, E9 WordPress adapter + companion plugin, E3 rule families in Phase B |
| AI/data engineer | 1.0 | 1.0 | E4 GSC, E5 site model/scoring + content gap, E6 AI engine, E11 measurement/statistics, E12 candidate scoring |
| Full-stack engineer | 1.0 | 1.0 | E14 dashboard (from Phase A onward), E1 auth surface, approval flows |
| DevOps/SRE | 0.5 | 0.5 | Sandboxing, egress controls, Temporal/queue ops, observability, secrets |
| QA / test engineering | 0.5 | 0.5 | Fixture sites, grading harness, E2E demo harness, drill scripts |
| **Total** | **6.0 FTE peak** | **5.5 pw/week** | |

**Phase 0 staffing** is 2 engineers plus fractional lead time, split by skill domain — the per-engineer allocation is stated in §1.5. The team ramps to full strength at build start.

### Person-week roll-up

The epics total **108 pw**. Stating this explicitly is the only way the phase durations below can be checked rather than trusted:

| Epic | pw | Epic | pw |
|---|---|---|---|
| E1 Foundation & tenancy | 6 | E8 Validation pipeline | 8 |
| E2 Crawler & storage | 10 | E9 WordPress adapter | 7 |
| E3 Detection rulebook | 8 | E10 Decision engine & ledger | 6 |
| E4 GSC sync | 4 | E11 Monitoring & rollback | 10 |
| E5 Site model & scoring | 9 | E12 Internal-linking engine | 7 |
| E6 AI optimization engine | 9 | E13 Autonomous loop | 5 |
| E7 Change layer (GitHub) | 11 | E14 Dashboard | 8 |
| | | **Total** | **108 pw** |

### Phase × capacity loading

Delivery capacity is 5.5 pw per calendar week at full strength (the FTE column above, with the tech lead at 0.5). Committed work is the epic slices scheduled in that phase:

| Phase | Weeks | Capacity (pw) | Committed (pw) | Epic slices committed | Headroom and what it absorbs |
|---|---|---|---|---|---|
| A — Foundation | 4 | 22.0 | 18 | E1 6 · E2 5 · E4 4 · E7 2 · E14 1 | 4.0 — team ramp, environment and account setup |
| B — Data plane | 6 | 33.0 | 28 | E2 5 · E3 8 · E5 9 · E7 4 · E14 2 | 5.0 — observability build-out, fixture maintenance |
| C — Change plane | 7 | 38.5 | 35 | E6 9 · E7 5 · E8 8 · E10 6 · E12 5 · E14 2 | 3.5 — integration between four concurrent epics |
| D — CMS & safety | 5 | 27.5 | 20 | E9 7 · E11 10 · E12 2 · E14 1 | 7.5 — pilot onboarding, drills, and the measurement soak's operational load |
| E — Autonomy & surface | 2 | 11.0 | 7 | E13 5 · E14 2 | 4.0 — the 7-day unattended run is elapsed time, not effort |
| F — Hardening & demo | 5 | 27.5 | 0 epic pw | — | Entirely non-epic: verdict-window soak, security review, calibration review, demo rehearsal, and slip absorption |
| **Total** | | | **108** | | |

Per-role, the same commitments resolve as follows (demand / available, in pw). This is the table that proves no role is over-committed in any phase — every cell's demand is at or below its availability, which is the check a phase plan usually skips. Cells well below availability are named slack, explained after the table, not padding:

| Phase | Tech lead | Platform A | Platform B | AI/data | Full-stack | DevOps | QA | Total |
|---|---|---|---|---|---|---|---|---|
| A (4 wk) | 2 / 2 | 4 / 4 | 2 / 4 | 4 / 4 | 3 / 4 | 2 / 2 | 1 / 2 | 18 / 22 |
| B (6 wk) | 3 / 3 | 6 / 6 | 6 / 6 | 6 / 6 | 4 / 6 | 0 / 3 | 3 / 3 | 28 / 33 |
| C (7 wk) | 3.5 / 3.5 | 7 / 7 | 7 / 7 | 7 / 7 | 3.5 / 7 | 3.5 / 3.5 | 3.5 / 3.5 | 35 / 38.5 |
| D (5 wk) | 2 / 2.5 | 5 / 5 | 5 / 5 | 5 / 5 | 1 / 5 | 0 / 2.5 | 2 / 2.5 | 20 / 27.5 |
| E (2 wk) | 1 / 1 | 2 / 2 | 0 / 2 | 1 / 2 | 2 / 2 | 1 / 1 | 0 / 1 | 7 / 11 |

Three properties of that table are deliberate, and each is the kind of thing a phase plan usually gets wrong:

1. **No role sits idle waiting for its epic.** Platform engineer B carries E7's GitHub App and repo-analysis groundwork from Phase A (2 pw there, 4 pw in B) and rule families in E3, rather than waiting for the change plane in Phase C. The naive reading of the ownership column — one role, one epic, starting when that epic starts — is what leaves a full FTE unassigned for six weeks while other phases are over-subscribed.
2. **E14 (dashboard) starts in Phase A and appears in every phase's Content column** in §2.5, which is what "starts early, finishes last" has to mean if it is true. Its 8 pw are spread 1/2/2/1/2 across A–E rather than compressed into the final phase.
3. **Phase lengths are derived from the loading, not chosen first.** Phases B and C are 6 and 7 weeks because 28 and 35 pw of committed work cannot be done in less at 5.5 pw/week — the arithmetic sets the duration. A phase plan that compresses those into 5 and 6 weeks is committing 1.6–2.8× its own team table, which is a schedule that fails in the second month rather than in the plan review.

The visible slack is real and accounted for, not padding. Full-stack sits below capacity in Phases B–D so the dashboard can pull surfaces forward whenever its upstream data lands early. DevOps shows 0 epic pw in Phases B and D because its work there is operational rather than epic: queue and Temporal operations, observability, and pilot-site onboarding. Platform engineer B shows 0 in Phase E because the change plane and the CMS adapter are complete by then — that capacity goes to the Phase F hardening and security review, which carries no epic pw at all.

## 2.5 Timeline (phases in weeks — no calendar dates)

Durations are in weeks with no calendar dates. The **cumulative week** column carries the overlaps, so the total is checkable at a glance rather than requiring the reader to redo the addition: raw phase lengths sum to 4+6+7+5+2+5 = 29 weeks, three of which are recovered by overlaps (B over A, D over C, E over D), giving **26 weeks post-POC**.

| Phase | Weeks | Runs (cumulative wk) | Content | Exit test |
|---|---|---|---|---|
| Phase 0 — POCs | 5 active (+POC 8 tail to ~wk 10) | pre-build | All 8 POCs; fixture sites; OAuth verification filed | POC exit criteria; go/no-go table §1.5 |
| Phase A — Foundation | 4 | wk 1 → 4 | E1 complete; E2 + E4 started; **E7 GitHub App groundwork; E14 dashboard shell + onboarding skeleton** | Tenancy/isolation gate; first crawl + first GSC sync land |
| Phase B — Data plane | 6 (overlaps A by 1) | wk 4 → 9 | E2, E3, E4 complete; E5 complete (incl. content-gap module); E7 repo analysis + framework profiles; **E14 site-health surface** | Grading harness at full catalog; SPEC worked examples in CI; a seeded content gap surfaces recommend-only |
| Phase C — Change plane | 7 | wk 10 → 16 | E6, E7, E8 complete; E10 complete; **E12 internal linking — candidate generation, anchors, caps**; **E14 review queue** | Findings→op→PR→checks→merge on both a Next.js and a non-Next React fixture; decision goldens across all nine matrix cells |
| Phase D — CMS & safety | 5 (overlaps C by 1) | wk 16 → 20 | E9 complete; E11 complete; **E12 insertion + tiers complete**; **E14 ledger UI**; **pilot sites onboarded and generating real changes** (starts the measurement soak) | WP drill; guardrail auto-rollback drill; internal-link batch registered for a verdict |
| Phase E — Autonomy & surface | 2 (overlaps D by 1) | wk 20 → 21 | E13 complete; **E14 complete** (monitoring charts, run console, policy) | 7 unattended nightly runs; UI-only demo script |
| Phase F — Hardening & MVP demo | 5 | wk 22 → 26 | Verdict-window soak completes on pilot changes; calibration cold-start review; security review of sandbox + vault; definition-of-done demo | §2.6 checklist, in full, on both pilot sites |
| **Total post-POC** | **29 raw − 3 overlapped = ~26 weeks** | **wk 26** | | |

The critical calendar dependency is not engineering: **verdict-bearing evidence needs 4–8 weeks of post-recrawl GSC data**, which is why pilot sites go live with real changes in Phase D, not Phase F, why Phase F is five weeks of mostly-elapsed time rather than five weeks of coding, and why POC 8's measured CDFs (not assumptions) set the verdict ETAs the demo reports.

## 2.6 Definition of MVP-done

MVP-done = the SPEC Success Criteria flow demonstrated **end-to-end on one real Next.js site and one real WordPress site**, with every step evidenced:

| # | Success-criteria step | Demonstrable evidence required |
|---|---|---|
| 1 | Connect website | Both pilot sites onboarded through the dashboard (GitHub App + GSC OAuth; WP plugin + app password), by a non-engineer, < 15 min each |
| 2 | System crawls | Full crawl completes within politeness limits; extract rows + link graph + raw bodies stored; incremental recrawl running on schedule |
| 3 | Understands website | FR-2.2 questions answered live in the UI: important pages, similar-keyword pages, cannibalization candidates, orphans, top-traffic, weakly linked, link-target candidates |
| 4 | Finds SEO problems | Detection at grading-harness quality (P ≥ 0.95 / R ≥ 0.90 maintained in CI); real findings on both pilots with rule version + evidence attached |
| 5 | Finds opportunities | Opportunity queue populated from real GSC data; SPEC worked examples reproduced; decay detector armed; **≥ 3 query-coverage content-gap recommendations** surfaced with their GSC evidence, each stamped `gsc_only` and recommend-only (competitor-derived gaps are out of MVP scope by §2.1, and the UI says so); **≥ 10 internal-link opportunities** ranked with their target-need / relevance / placement factors visible |
| 6 | AI determines improvements | Typed ops with `oldValue` anchors, reasons, evidence pointers; zero off-policy ops on the standing injection CI; internal-link anchors verified to occur verbatim in the source paragraph, and the per-target variation ledger demonstrably refusing a repeated anchor |
| 7 | Generates changes | ≥ 1 codemod-generated Next.js PR, **≥ 1 codemod-generated PR on a non-Next React project** (the FR-9.1 "React" half — a pre-rendered Vite/Remix/Gatsby fixture or pilot), ≥ 1 WP write batch, and **≥ 1 internal-link T1 batch** produced from real findings |
| 8 | Validates | Every change through the full pipeline (git: sandbox build + preview + assertions; WP: simulated render + canary); seeded-bad-change suite still 10/10 |
| 9 | **Automatically applies safe changes** | ≥ 10 LOW-risk changes auto-applied across both pilots with zero human touch — missing meta descriptions, alt text, **broken-link retargets (E12.11, the one fully-automatic internal-link class)** (sitemap *regeneration* is not on this list: replacing a sitemap's contents is MEDIUM and gated, escalating to HIGH on any net URL removal > 5%; only re-submitting a verified-identical sitemap is LOW) — and ≥ 1 MEDIUM change merged through the approval gate (PR reviewed and merged by a human via the dashboard signal), with the internal-link T1 batch as an acceptable instance of that MEDIUM path |
| 10 | Monitors search data | Guardrail phase live on every applied change; recrawl verified (`reindex_confirmed`) on ≥ 80% of changed URLs within the measured window |
| 11 | Measures results | ≥ 5 verdicts issued against control-page counterfactuals with credible intervals, **including ≥ 1 batch-level internal-link verdict at the 28-day window (E11.14)**; power floor respected (`insufficient_data` where honest); any title verdict rendered with its `display_unverified` flag rather than as a clean win |
| 12 | Keeps successful changes | ≥ 1 KEEP verdict recorded with its effect estimate |
| 13 | **Rolls back harmful changes** | ≥ 1 demonstrated rollback: a seeded harmful change (planted deliberately on a pilot, with owner consent) trips a guardrail → instant host rollback + durable revert PR (git) or ledger restore (WP) → freeze + trust decay recorded. A staged drill is acceptable evidence; waiting for an organic failure is not required |
| 14 | Finds the next opportunity | The nightly loop re-prioritizes and surfaces new queue items after the above, unattended, for 7 consecutive days |
| 15 | Complete change history | Ledger audit: 100% of mutations on both pilot sites during the demo period have ledger rows with before/after, reason, confidence, risk, decision, and outcome (FR-13.2) |

Additionally: the cross-tenant isolation suite, sandbox-egress suite, and injection corpus are green in CI on the release commit; and the cost telemetry for the demo period lands within the researched envelope for the pilots' size class (~$20–70/mo steady-state for a small site).

## 2.7 Plan-level risks (delivery risks, distinct from Doc 06's product risks)

| Risk | Mitigation in this plan |
|---|---|
| Google OAuth verification lead time blocks GA | Filed in Phase 0 (POC 7 exit criterion); SA-invite fallback is a full onboarding path, not a stub |
| POC 8's elapsed time slips the demo | Started week 1; pilot changes flow from Phase D; verdict ETAs come from measured CDFs, and windows auto-extend rather than fabricate verdicts |
| Calibration cold start weakens confidence gating | Launch posture is conservative by design: auto-apply only LOW risk until ~hundreds of labeled outcomes exist; the demo does not depend on calibrated thresholds |
| Vercel-specific rollback endpoint is semi-documented | Wrapped behind a host adapter; git revert PR is the guaranteed durable path [22][15] |
| Companion-plugin maintenance across WP/Yoast releases | Playground CI matrix (E9.3) catches breakage pre-release |
| Sonnet-class intro pricing and vendor list prices shift | Cost telemetry per tier from day one; multi-provider adapters keep a price lever; all prices re-verified at contract time |
| One customer's hosting tier throttles validation (100 deploys/day on Hobby [21]) | Per-project deploy budgeting + batching; surfaced in onboarding as a plan requirement |

## 2.8 Traceability matrix — Doc 01 requirements × epics

Doc 01 §11 promises that this document decomposes the requirements FR-by-FR. This is where that promise is checkable. A "deferred" cell names the §2.1 row that carries the reason.

**Functional requirements**

| FR | Subject | Where it is built |
|---|---|---|
| FR-1 | Website crawling (1.1–1.7) | **E2** in full — E2.1–E2.5 (engine, robots, politeness, sitemap seeding), E2.11–E2.15 (field set, storage, dedup, diffs), E2.16–E2.17 (incremental); **1.6** (queued/distributed work) → E2.9–E2.10, **1.7** (durable persistence) → E2.11–E2.12 |
| FR-2 | Site understanding / site model (2.1–2.3) | **E5.1–E5.5** (graph, embeddings, page types); every FR-2.2 question is answered in **E14.2** and re-asserted in §2.6 step 3; **2.3** (justify the storage choice) is answered by Doc 04 §3.4/§3.7 and applied here as E1.2/E5.3 (Postgres 16 + pgvector `halfvec`/HNSW, no graph database) |
| FR-3 | SEO problem detection (3.1–3.7) | **E3** in full — E3.4–E3.9 are the six SPEC §6 categories; E3.12 the fix-safety class; E3.13 the P/R gate. FR-3.7 (false positives) is the SEO-4 risk retired by POC 2 |
| FR-4 | AI optimization (4.1–4.4) | **E6** in full. FR-4.1's list maps to E6.1's action enum plus **E12** (internal links) and **E5.10–E5.12** (content-gap fills — detection only in MVP). FR-4.2 is enforced by E6.7's no-new-facts and diff budgets; FR-4.3 by E6.4; FR-4.4 by E6.1/E6.2 |
| FR-5 | Keyword & query analysis (5.1–5.2) | **E4** (GSC-sourced facts), **E5.6–E5.7** (curve service, opportunity score) |
| FR-6 | GSC integration (6.1–6.3) | **E4** in full; 6.2/6.3 scoring in **E5.7–E5.9** |
| FR-7 | Competitor analysis (7.1, 7.2) | **FR-7.1 deferred** — needs SERP/competitor data (§2.1 deferral row). **FR-7.2 split**: the GSC-evidenced half (query-coverage gaps, recommend-only) ships in **E5.10–E5.12**; the competitor-comparison half is deferred with FR-7.1 |
| FR-8 | Internal linking (8.1–8.4) | **E12** in full — 8.1 → E12.1–E12.4 (three channels + fusion), 8.2 → E12.5–E12.6 (anchor selection + variation ledger), 8.3 → E12.4/E12.7/E12.8 (similarity, importance, equity, existing links, caps), 8.4 → E12.12 (T1/T2/T3) |
| FR-9 | Site modification (9.1–9.4) | 9.1 Next.js **and** other React frameworks → **E7** (profiles E7.4–E7.5, codemods E7.7–E7.8); 9.2 WordPress → **E9**; 9.3 Shopify **deferred**; 9.4 custom sites → researched and **deferred** (edge-worker row in §2.1) |
| FR-10 | GitHub automation (10.1–10.2) | **E7** (10.1 pipeline end to end) + **E8** (10.2's "how is it tested / validated" answer) + **E11.12/E7.13–E7.14** (10.2's rollback answer) |
| FR-11 | Confidence-based automation (11.1–11.2) | **E10.1–E10.5**; the "detailed scoring mechanism" is the 3×3 matrix in E10; the tier semantics are E3.12's safety classes |
| FR-12 | Validation engine (12.1–12.2) | **E8** for the git channel; **E9.7–E9.10** for the CMS channel (the three-rung ladder that substitutes for a preview primitive) |
| FR-13 | Change tracking (13.1–13.2) | **E10.6–E10.8**; completeness proven by the adapter-level audit test in E10's exit gate and §2.6 step 15 |
| FR-14 | Monitoring & rollback (14.1–14.3) | **E11** in full, plus **E11.14** for batch-level link verdicts |
| FR-15 | Autonomous operation | **E13** in full |
| FR-16 | Multi-tenancy & product surface (16.1–16.2) | **16.1** → **E1** (tenancy, RBAC, quotas, audit) + **E14** (the surface). **16.2** (name concrete choices for database, cache, queue, object storage, search engine, AI providers, external APIs, scheduler, logging, monitoring) → the named stack in **Doc 03 §8**, made concrete here as **E1.2** (Postgres 16 + pgvector), **E1.3** (Valkey behind BullMQ — cache and queue), **E1.5** (S3-compatible object storage), **E1.4** (Temporal Cloud — the scheduler, with **E13.2** Schedules), **E1.16–E1.17** (OpenTelemetry → Grafana Cloud + Sentry — logging and monitoring), **E2.13/E5.3** (search/similarity in Postgres — no separate search engine at MVP), **E6.2** (AI providers: Anthropic primary, OpenAI + Gemini fallback), **E4** (external APIs: GSC) and **E7.1–E7.2** (GitHub) |

**Non-functional requirements** — each names the tasks that make it true, not merely the intent:

| NFR | Subject | Where it is made true |
|---|---|---|
| NFR-1 | Safe — never blindly modify production | **E8** (every git change passes static gates → sandboxed build → preview → SEO assertions), **E9.7–E9.10** (the CMS ladder + canary), **E10** (nothing applies without passing the matrix and the deny-list), **E11** (guardrails + rollback). §2.6 step 13 demonstrates it |
| NFR-2 | Scalable — 100 → 10k → 100k+ pages | **E2** (10k-page crawl in the exit gate; static-first economics), **E5.1** (100k-page graph < 60 s), **E5.3** (10k-page embedding pass ≤ $1), **E13.4–E13.5** (bounded monitors, per-tenant fairness) |
| NFR-3 | Explainable | **E10.3** (auditable arithmetic, both axes logged), **E10.6** (append-only ledger), **E14.3** (no naked scores in the review queue), **E12.4** (link candidates render their factors), **E11.8** (credible intervals, not point claims) |
| NFR-4 | Autonomous | **E13** in full (scheduled loop, durable approval gates, interlocks), **E10.4** (what may run unattended), **E12.11** (the fully-automatic link-retarget class) |
| NFR-5 | Secure | **E1.12–E1.15** (RLS isolation, KMS envelope encryption, token lifecycle), **E2.18–E2.19** (SSRF, egress isolation), **E7.2** (down-scoped 1-hour tokens), **E8.4** (build sandbox — the RCE boundary), **E6.5** (injection containment) |
| NFR-6 | Cost-bounded | **E1.10** (per-project crawl/token/concurrency quotas), **E6.3** (per-site AI budget caps + Batch API), **E6.13–E6.14** (Tier-0 routing and model tiering, with the per-10k-page envelope as the gate — $27.50–$82.50 generation-only, $33–88 all-in with selective judging, at 3,000 in / 500 out per page), **E2.1** (static-first crawl), **E13.6** (Temporal action metering) |
| NFR-7 | Justified — 2–3 alternatives compared | Carried by Doc 04; in this document, every epic preamble names the position applied and its reason, and the one place this plan *supersedes* the register — the confidence formula reconciled in E6.4/E6.10 — is flagged in the open rather than substituted silently. (Valkey is not a departure: D-38 settles it, and E1.3's pinned-version CI suite is the compensating control that decision calls for.) |
| NFR-8 | Policy-compliant | **§2.1** (content-writing at scale deferred — the scaled-content-abuse line), **E10.4** (velocity caps + freeze during confirmed Google update rollouts), **E12.6–E12.7** (anchor variation and link caps against link-scheme adjacency), **E3.9** (structured data must match visible content), **E10.6** (the full AI-change audit trail) |

---

## Sources

1. https://crawlee.dev/js/api/playwright-crawler/class/AdaptivePlaywrightCrawler — AdaptivePlaywrightCrawler rendering-type predictor, ~10% re-detection sampling
2. https://use-apify.com/docs/what-is-apify/apify-compute-units — ~3,000 pages/CU static vs ~300 pages/CU browser (the ~10× cost ratio)
3. https://www.searchviu.com/en/javascript-crawling-study-rendered-html-vs-original-source-code/ — 96% of domains / 56% of URLs differ raw-vs-rendered in SEO-relevant areas
4. https://www.screamingfrog.co.uk/seo-spider/issues/ — Screaming Frog issues catalog with exact thresholds and severities
5. https://developers.google.com/webmaster-tools/limits — GSC API quotas: URL Inspection 2,000/day + 600/min per property; Search Analytics 1,200 QPM/site
6. https://zyppy.com/seo/google-title-rewrite-study/ — Google rewrites 61.6% of title tags (n = 80,959)
7. https://platform.claude.com/docs/en/build-with-claude/structured-outputs — Anthropic structured outputs (`output_config.format`, strict tool use, schema limits)
8. https://openai.com/index/introducing-structured-outputs-in-the-api/ — OpenAI `json_schema` strict mode (token-level masking)
9. https://python.useinstructor.com/concepts/reask_validation/ — validator-error re-ask pattern; models fix output on first retry 95%+ of the time
10. https://research.trychroma.com/context-rot — context-rot study: reliability degrades with input size across 18 models
11. https://codemod.com/blog/iterative-ai-system — LLM-written codemods: 45.29% one-shot (jscodeshift), 26% → ~54% after 4 refinement iterations
12. https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app — GitHub App identity model
13. https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app — down-scoped, 1-hour installation tokens (per-repo, per-permission)
14. https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api — installation limits 5,000→12,500 req/h; secondary limits 80 content-generating req/min, 500/h
15. https://docs.github.com/public/fpt/schema.docs.graphql — GraphQL schema: `createCommitOnBranch` (signed commits, `expectedHeadOid`), `revertPullRequest`, `enablePullRequestAutoMerge`
16. https://github.com/orgs/community/discussions/190610 — March 2026 auto-merge change: enable only after requirements met, else HTTP 422
17. https://github.com/validator/validator — Nu HTML Checker (v.Nu), self-hostable conformance validator
18. https://developers.google.com/search/blog/2020/12/structured-data-testing-tool-update — SDTT deprecation; no public Rich Results Test API
19. https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md — Lighthouse CI assertions, budgets, median-run aggregation
20. https://vercel.com/docs/rest-api/deployments/create-a-new-deployment — `POST /v13/deployments` with `gitSource`
21. https://vercel.com/docs/limits — deployments/day by tier (100 Hobby / 6,000 Pro), 45-min build cap
22. https://vercel.com/docs/instant-rollback — Instant Rollback semantics; disabled production auto-assignment after rollback
23. https://docs.netlify.com/api/get-started/ — Netlify deploy restore endpoint; API limits (3 deploys/min, 100 API deploys/day)
24. https://developer.yoast.com/customization/apis/rest-api/ — Yoast REST API is read-only (no POST/PUT)
25. https://github.com/Devora-AS/rank-math-api-manager — Rank Math meta registration for REST writes (the companion-plugin pattern)
26. https://developer.wordpress.org/rest-api/reference/media/ — `alt_text` writable via `POST /wp/v2/media/{id}`
27. https://make.wordpress.org/wp-json/wp/v2 — live WP route index confirming `/wp/v2/posts/{id}/autosaves` GET+POST
28. https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl — "Crawling can take anywhere from a few days to a few weeks"
29. https://support.google.com/webmasters/answer/9012289 — "Indexing typically takes only a day or so, but can take much longer in some cases"
30. https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget — recrawl frequency = perceived inventory × popularity × staleness; no numeric intervals published
31. https://vercel.com/blog/how-google-handles-javascript-throughout-the-indexing-process — 100k+ verified Googlebot fetches; percentile-based measurement methodology
32. https://developers.google.com/search/apis/indexing-api/v3/quota-pricing — Indexing API restricted to JobPosting/BroadcastEvent, 200 requests/day
33. https://www.indexnow.org/faq — IndexNow participating engines (Bing, Yandex, Naver, Seznam, Yep, Amazon); Google absent
34. https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap — 50k URLs / 50 MB limits; `lastmod` trusted only when "consistently and verifiably accurate"; priority/changefreq ignored
35. https://ahrefs.com/blog/gsc-anonymized-queries/ — 46.77% of clicks belong to anonymized queries (146k+ sites)
36. https://www.seo-stack.io/blog/why-does-google-search-console-have-a-16-month-data-limit — GSC 16-month rolling retention
37. https://google.github.io/CausalImpact/CausalImpact.html — CausalImpact/BSTS assumptions for valid counterfactual inference
38. https://www.searchpilot.com/resources/blog/the-math-behind-searchpilot-how-seo-a/b-testing-actually-works — control-bucket SEO testing methodology; credible intervals
39. https://developers.google.com/search/docs/essentials/spam-policies — scaled content abuse policy (explicitly includes AI page generation at volume)
40. https://docs.temporal.io/cloud/pricing — Temporal Cloud Essentials: $100/mo floor, 1M actions included
41. https://temporal.io/blog/human-in-the-loop-approvals — signal-based mid-workflow approval pattern with durable timers
42. https://github.com/temporalio/documentation/blob/main/docs/develop/task-queue-priority-fairness.mdx — task-queue fairness keys, weights, per-key rate limits
43. https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt — robots.txt caching up to 24 h; 5xx handling halts crawling
44. https://support.google.com/webmasters/answer/12917675 — BigQuery bulk export: Owner permission, manual UI setup, no backfill
45. https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification — sensitive-scope OAuth verification requirements (GSC scopes; no CASA)
46. https://developers.openai.com/api/docs/pricing — text-embedding-3-small $0.02/M tokens; model pricing and batch discounts
47. https://zyppy.com/seo/seo-study/ — 23M internal links study: traffic rises to ~40–44 inbound links, declines after ~45–50; exact-match anchor ~5× effect
48. https://www.searchpilot.com/resources/case-studies/seo-split-test-lessons-nearby-location-links — controlled internal-linking test: +7% organic traffic to receiving pages
49. https://graph-tool.skewed.de/performance.html — PageRank on 4.8M-node/69M-edge graph: ~10.6 s in-process (igraph)
50. https://developers.google.com/search/blog/2025/04/san-hourly-data — hourly Search Analytics data (trailing ~10 days)
51. https://developers.google.com/webmaster-tools/v1/urlInspection.index/UrlInspectionResult — URL Inspection response schema (`googleCanonical`, `pageFetchState`, `richResultsResult`)
52. https://support.google.com/cloud/answer/13463073 — unverified OAuth apps capped at 100 test users
53. https://thestacc.com/blog/organic-ctr-by-position/ — six-study CTR aggregate (pos-1 ≈ 27% median; range 19.0–39.8%)
54. https://ahrefs.com/blog/ai-overviews-reduce-clicks/ — AI Overviews reduce position-1 CTR by −34.5% (300k-keyword controlled study)
55. https://dataforseo.com/apis/serp-api/pricing — SERP data pricing ($0.60/1k standard) — deferral economics for competitor/SERP scope
56. https://aider.chat/docs/more/edit-formats.html — edit-format evidence: anchored search/replace vs whole-file rewrites
57. https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops — Google's traffic-drop confounders; year-over-year comparison guidance
58. https://sentry.io/pricing/ — Sentry Team tier ~$26/mo
59. https://monitoringcost.com/grafana-cloud-pricing — Grafana Cloud free tier (10k series, 50 GB logs/traces, 14-day retention)
60. https://clerk.com/pricing — Clerk free tier 50k users; Pro $25/mo; Organizations
61. https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres — session-variable RLS pattern for pooled multi-tenant Postgres
62. https://docs.bullmq.io/guide/redis-tm-compatibility — BullMQ requires Redis ≥ 6.2 semantics; tested-vendor caveats
63. https://github.com/lycheeverse/lychee — lychee, the fast async link checker used for diff-scoped link validation (E8.12)
64. https://github.com/staylor/react-helmet-async — `react-helmet-async` head management for React apps: `<Helmet>` element resolution, nearest-provider and last-write-wins semantics
65. https://remix.run/docs/en/main/route/meta — Remix `meta` export: route-hierarchy metadata resolution and merge rules
66. https://www.gatsbyjs.com/docs/reference/built-in-components/gatsby-head/ — Gatsby Head API: per-page/template `Head` export for metadata
67. https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics — Google JS SEO: JS-set title/description supported, JS canonicals picked up with warnings, HTML preferred over JS as the metadata source
68. https://meta.wikimedia.org/wiki/Research:Link_recommendation_model_for_add-a-link_structured_task — Wikimedia "add-a-link" production model: anchor dictionary, >6.5% link-probability filter, feature set, precision/recall at threshold
69. https://ahrefs.com/blog/internal-links-for-seo/ — internal-link opportunity method (page mentions a keyword another page ranks top-10 for, unlinked), 3–5 contextual links/article baseline
70. https://mdxjs.com/packages/remark-mdx/ — unified/remark/remark-mdx AST processing for Markdown/MDX, incl. node `position` offsets used for surgical splicing
71. https://www.searchpilot.com/resources/case-studies/server-side-rendering-internal-links — controlled test: internal links added only via client-side JavaScript showed no detectable impact; server-rendered links did
72. https://userp.io/link-building/link-whisper-review/ — documented anchor-repetition and context-blind matching failure modes in automated internal linking
73. https://ipullrank.com/vector-embeddings-is-all-you-need — embedding/cosine methodology for content-gap and topical-coverage analysis (~0.75 same-topic threshold family)
74. https://nikoalho.fi/writing/automating-internal-linking/ — embeddings pipeline for internal linking: text-embedding-3-small, cosine 0.78–0.85 tuned per site by elbow method
75. https://ziptie.dev/blog/gscs-huge-search-gap/ — per-site GSC query anonymization measured at 45–80%, and the resulting long-tail vocabulary gap
