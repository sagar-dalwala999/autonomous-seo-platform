# Risk Assessment

Document 06 of 07 · Autonomous SEO Optimization Platform · Planning Package

---

## 1. Executive summary

This document answers one question: **what can go wrong when a machine is given write access to
customer websites and told to optimize them for Google, and does the planned design already
contain each failure mode?** It registers 66 risks across the eight categories the problem
statement mandates (technical, SEO, AI, security, API limitations, cost, scalability, and
Google/search-engine policy), maps every dangerous action to its designed control (SPEC §23), and
closes with the ten largest exposures ranked.

The single fact that governs every threshold in the design is that **the loss function is
asymmetric**. A missed optimization costs a few percent of unrealized uplift. A bad site-wide
change or a spam-policy violation costs months. Google's spam policies require demonstrated,
sustained compliance before a site recovers and publish no recovery timeline [5]; the widely
repeated "over a period of months" characterization comes from trade reporting on the June 2026
spam update [1], not from a Google commitment. A site-move-class disruption takes 4-6 weeks to
stabilize on the same domain and 2-3 months or more across domains [2][3]. And robots.txt has two
distinct failure modes, both slow to undo: a bad `Disallow` line blocks the matched paths as soon
as Google refetches the file, while a robots.txt that returns 5xx halts *all* crawling within 12
hours — and because Google caches robots.txt for up to 24 hours, even an instant rollback leaves
the bad file live for up to a day [4]. The Platform is therefore tuned conservative everywhere:
hard deny-lists that no confidence score can override, per-site change budgets, and rollback as a
first-class outcome rather than an exception path.

The largest exposures cluster into five themes. §12 ranks the individual risks strictly, and the
ranking is reproducible from the **Exposure** column carried in every register table below.

1. **Google's scaled-content-abuse policy** (POL-1 — §12 #1), which since March 2024 explicitly
   names AI-generated pages produced "for the primary purpose of manipulating search rankings"
   [5] and has been enforced through spam updates in August 2025 and June 2026 [6][69]; contained
   by construction, because content-class changes can never auto-apply and net-new pages are never
   auto-published.
2. **Write-access blast radius** (SEC-3, SEC-4 — §12 #2-#3; SEC-1 and SEC-2 carry the same impact
   at lower likelihood), from the GitHub App private key down to a single WordPress credential;
   contained by 1-hour down-scoped tokens, KMS envelope encryption, per-tenant row- and key-level
   isolation, and egress-isolated sandboxes that treat every customer `npm install` as hostile
   code.
3. **Wrong or hostile AI output reaching production** (AI-2, AI-1, TEC-1 — §12 #4, #5, #9):
   crawled customer and competitor pages are untrusted input, hallucinated facts are the
   non-adversarial version of the same failure, and a generated code change can break the build;
   contained by a generator with no tools and no credentials, a closed-vocabulary operation
   schema, closed-book evidence validation in code, and a sandboxed build + preview gate.
4. **Measurement risk** (SEO-1, SEO-5, SEO-2 — §12 #6, #7, #10): a shipped change harms rankings,
   cumulative change velocity destabilizes the site, or the verdict that should catch either is
   wrong because rankings move for reasons unrelated to the Platform's changes; contained by
   counterfactual measurement against untouched control pages — never naive pre/post comparison —
   plus hard velocity caps.
5. **Cost blowout** (CST-2 — §12 #8; CST-1 is the same failure in slow motion and falls just
   outside the top ten under the ranking rule): a naive implementation of this product costs an
   estimated 20-50x the designed one — the Platform's own modelled figure, derived in §8 from the
   five compounding levers over Anthropic's published Batch and prompt-caching mechanics [7][71].
   The cost strategies (static-first crawling, change detection, model tiering, batch pricing) are
   therefore architecture requirements in Doc 03, not optimizations.

Three residual risks cannot be engineered away and are stated plainly rather than papered over:
attribution remains probabilistic below ~10 organic clicks/day per page; prompt injection is
mitigated, not solved — the security literature and observed in-the-wild attacks treat indirect
injection as a blast-radius problem rather than a solvable model-layer one (OWASP LLM01, Unit 42's
in-the-wild cases, and the 2026 empirical and survey work on deployed agents) [8][9][25][70]; and
Google Search Console is the only ranking ground truth, and it is lagged, quota-bound, and
occasionally down. The design absorbs all three honestly: underpowered verdicts return
`insufficient_data` instead of manufactured certainty, injection containment bounds blast radius
rather than claiming prevention, and the fast guardrail layer is built from signals that do not
depend on GSC at all.

---

## 2. Method

**Scoring.** Each risk carries likelihood (L/M/H) and impact (L/M/H). Impact is judged on the
worst credible outcome for a customer site or the Platform's viability, with the recovery
asymmetry above weighting any months-scale outcome as H. **Exposure** is shown as its own column
in every table: L and I are scored 1 (L) / 2 (M) / 3 (H) and multiplied, giving 1-9. Exposure is
the sole primary key for the §12 ranking, and §12 states the tie-breaks it applies on top of it,
so the ranking is reproducible from these tables without any unstated editorial judgment.
**Mitigation** names the control that is already part of the planned design and ends with the
owning component and the architecture section that specifies it (`— <Component>, Doc 03 §x`),
plus `Doc 05 §x` where an external API's limits are the substance of the risk, and Doc 04 where a
technology selection is the rationale. **Residual** states what remains after the control,
honestly; "low" is a judgment, not zero. Every risk references the Doc 01 requirement it
threatens (FR-x.y / NFR-x); §2.1 gives the reverse map so the client can confirm no requirement
area is unexamined.

**Where the controls sit.** SPEC §23 fixes the safety loop; each stage carries a specific
control layer. Every risk in this document maps to one or more of these placements:

```
 Detect ──► Analyze ──► Decide ──► Confidence ──► Generate ──► Validate ──► Apply ──► Monitor ──► Rollback
    │           │           │         check           │            │           │          │           │
    ▼           ▼           ▼           ▼             ▼            ▼           ▼          ▼           ▼
 two-source  canonical-  two-axis   computed       typed JSON   static      oldValue   guardrails  drift check
 confirm of  cluster-    risk       score from     ops only;    gates →     anchor     (days 0-7:  before any
 negative    first       matrix +   validators +   no tools,    sandboxed   check;     crawl-diff, revert; batch
 states;     dedupe;     hard       consistency +  no creds;    build →     per-site   HTTP, CUSUM) = rollback
 FP-trap     rendered    deny-list  judge; never   closed-book  preview →   budgets;   + verdict   unit; 30-day
 suppression DOM diff    + velocity the model's    evidence     SEO         idempotency vs control  page freeze;
 per rule                budgets    self-report    rule         assertions  keys       pages 14-60d two-speed
```

**Terms used in the tables** (each is also glossed on first use in prose):

- **CUSUM** — cumulative-sum change-point alarm; flags small sustained drifts fast.
- **BSTS / CausalImpact** — Bayesian structural time-series counterfactual modelling.
- **DiD** — difference-in-differences; changed pages vs untouched control pages, before vs after.
- **Isotonic / Platt calibration** — maps raw scores onto observed outcome frequencies.
- **k=3-5 self-consistency** — generate the same value 3-5 times and score the agreement.
- **Op-hash idempotence ledger** — a hash per applied operation, so nothing is re-proposed twice.
- **Tenant GUC via `SET LOCAL`** — the tenant id as a transaction-scoped Postgres setting that
  row-level security reads, so it cannot leak across a pooled connection.
- **IMDSv2** — the session-token-protected cloud instance-metadata endpoint (blocks naive SSRF).
- **microVM** — a hardware-isolated lightweight VM (Firecracker-class), stronger than a container.
- **°** — a figure from a *secondary* source (community measurement, third-party tracker) rather
  than primary vendor documentation, carrying correspondingly lower confidence; same convention as
  Doc 05, and the source is marked in §13 too.

### 2.1 Reverse traceability (requirement → risks)

Doc 01 §11 promises that risks reference the requirement they threaten. This is the inverse view:
every FR group and NFR, and the risks that threaten it. No requirement area is unexamined.

| Requirement | Risks that threaten it |
|---|---|
| FR-1 Crawling & discovery | TEC-9, SEC-5, CST-3, SCL-1, SCL-2, SCL-6, SCL-7 |
| FR-2 Website understanding | CST-5, SCL-4 |
| FR-3 Technical SEO detection | TEC-9, SEO-4, SEO-8, API-1, API-2, SCL-5, POL-5 |
| FR-4 AI optimization engine | TEC-5, SEO-3, AI-1, AI-3, AI-4, AI-6, API-12, POL-4 |
| FR-5 Keyword intelligence | API-11 |
| FR-6 GSC integration | API-3, API-4, API-10, SEC-8 |
| FR-7 Competitor analysis | API-11 |
| FR-8 Internal linking | POL-3 |
| FR-9 Automated site modification | TEC-2, API-5, API-6 |
| FR-10 GitHub automation | TEC-1, TEC-5, TEC-6, SEC-1, API-7, API-9 |
| FR-11 Confidence-based automation | SEO-5, AI-4, AI-7 |
| FR-12 Validation engine | TEC-2, SEC-4, API-1, API-7 |
| FR-13 Change tracking | TEC-3, SEC-7 |
| FR-14 Automatic rollback | TEC-4, TEC-8, TEC-10, SEO-1, SEO-2, SEO-3, SEO-6, SEO-7, API-2, API-3, API-8, SCL-3 |
| FR-15 Autonomous scheduling | TEC-7, SCL-2, CST-6, POL-6 |
| FR-16 Platform surface & named stack | CST-5, SCL-4 |
| NFR-1 Safe | TEC-1, SEO-1, SEO-5, AI-2 |
| NFR-2 Scalable | CST-7, SCL-1, SCL-4, SCL-5, SCL-6, SCL-7 |
| NFR-3 Explainable | SEC-7 |
| NFR-4 Autonomous | SEO-5, API-7 |
| NFR-5 Secure | AI-2, SEC-1, SEC-2, SEC-3, SEC-4, SEC-5, SEC-6, SEC-8, API-10 |
| NFR-6 Cost-bounded | AI-5, API-12, CST-1, CST-2, CST-3, CST-4, CST-5, CST-6, CST-7 |
| NFR-7 Justified | TEC-6, AI-5 |
| NFR-8 Policy-compliant | TEC-10, POL-1, POL-2, POL-3, POL-4, POL-5, POL-6, POL-7 |

Two readings of this table matter. **AI-7 (judge-model bias) threatens no single functional
requirement directly** — it is a second-order risk to the confidence score, so it is mapped to
FR-11.1 because that is where its damage lands, not because the requirement names a judge.
And the FR-14 row is by far the longest, which is the correct shape: rollback is the requirement
that carries the product's entire safety promise.

---

## 3. Technical risks

| ID | Risk (requirement) | L | I | Exp | Mitigation designed in | Residual |
|---|---|---|---|---|---|---|
| TEC-1 | AI-generated change breaks the customer build or renders wrong (FR-10.2, NFR-1) | M | H | 6 | Codemods execute, LLM supplies values only; changed-file allowlist + diff budgets; lint/tsc; sandboxed build; preview-deploy + meta-diff assertion; smoke E2E — Validation Engine, Doc 03 §2.11 | Content-shaped search/replace edits can build clean yet read wrong; caught at PR review (MEDIUM tier) |
| TEC-2 | Direct-API writes deploy the instant the request succeeds; no preview primitive exists. Applies to WordPress at MVP and to the Shopify adapter when it lands (Shopify is deferred beyond MVP per Doc 01 §6) (FR-9.2, FR-9.3, FR-12.1) | M | M | 4 | Three-rung ladder: simulated render + per-site render-mapping probe; staged render where the channel has one; canary apply + read-back — Change Application Layer, Doc 03 §5.1; channel limits in Doc 05 §5-§6 | One canary page per batch is exposed for seconds; the honest automation ceiling on these channels |
| TEC-3 | Partial batch application: CMS APIs have no cross-object transactions (FR-13.2) | M | M | 4 | Per-object write verification; partial state recorded in ledger, never marked done; auto-repair queue — Change Ledger, Doc 03 §3.3 | Brief inconsistent site state until repair completes |
| TEC-4 | Rollback is not undo: recrawl latency + interim signal loss (FR-14.2, FR-14.3) | H | M | 6 | Drift check (live value must equal the change's `after` blob, else human 3-way diff); two-speed rollback (host instant + git revert PR); user-facing recovery ETA — Change Application Layer, Doc 03 §5.3 | SEO-state recovery still takes days-to-weeks [10][11]; canonical/redirect consolidation may not reverse cleanly [2] |
| TEC-5 | Automation clobbers concurrent human edits (FR-4.4, FR-10.1) | M | M | 4 | `oldValue` optimistic-lock anchor verified at apply; `expectedHeadOid` on every commit and merge [12]; PR-only, force-push prohibited — Change Application Layer, Doc 03 §5.2; Doc 05 §4 | Near zero for tracked fields |
| TEC-6 | Vercel Instant Rollback trap: endpoint is semi-documented; rollback disables production auto-assignment until promoted [13] (FR-10.2, NFR-7) | M | M | 4 | Adapter-wrapped host rollback; git revert PR is the guaranteed durable path; post-rollback state modeled explicitly — Change Application Layer, Doc 03 §5.3; Doc 05 §7.1 | Endpoint may change without notice; fallback path always available |
| TEC-7 | Orchestration misuse: non-deterministic workflow code, 51,200-event history cap, at-least-once activity duplicates [14] (FR-15.2) | M | M | 4 | Coarse-phase workflow rule (~12 phases/site/day, O(10) and never O(pages)); `continue-as-new` on monitors; idempotency keys (branch name = change ID; read-before-write on CMS) — Orchestrator (Temporal), Doc 03 §4.1 | Idempotency is an implementation obligation, not an engine guarantee; enforced by review |
| TEC-8 | CDN/page-cache lag causes false canary verdicts (FR-14.1) | M | M | 4 | Per-site cache knowledge (purge hooks in the WordPress companion plugin); bounded polling with backoff before judging — Monitoring, Doc 03 §2.13 | Occasional re-runs; quarantine on repeat failure |
| TEC-9 | Crawler mis-detection: rendered vs raw DOM divergence, streamed metadata false-flags on Next.js 15.2+ (FR-1.2, FR-3.1) | M | M | 4 | Both raw and rendered HTML stored and diffed (the diff is itself a signal); two-source confirmation before any negative finding enters the fix queue — SEO Analyzer, Doc 03 §2.7 | Google-internal classifiers (soft-404, canonical choice) are approximated, never replicated |
| TEC-10 | A GSC manual action has no API; the strongest stop-everything signal arrives by UI/email only (FR-14.1, NFR-8) | L | H | 3 | Named mechanism, not a placeholder: at onboarding the tenant adds a Platform-owned address as a GSC property *user* so Google's manual-action notification email is delivered to it directly, parsed against a documented contract (property, action type, date) and mapped to a site-wide `FREEZE_ALL_AUTOMATION` signal; a weekly operator check of the Manual Actions UI is the backstop. Owner: the Monitoring component, named in Doc 03 §2.13 and carried as an open operational dependency in Doc 02 §2.6 row 6 | **Honestly scored as partially mitigated.** Both paths are outside the Platform's control: email delivery depends on the customer keeping the notification user in place, and the UI check is human-cadence. Detection delay is hours if the email path holds and up to a week if it silently breaks; the parse contract is unverifiable until a real manual action occurs |

**TEC-4 deserves emphasis** because it breaks a common client assumption. Rolling back restores
the prior HTML in seconds, but Google must recrawl the page before the SEO state recovers, and
Google commits only to "a few days to a few weeks" for crawling after a recrawl request [10] and
"a day or so, but can take much longer" for indexing [11]. The ledger therefore reports rollback
as "applied; SEO recovery expected in N-M days," and after any rollback the page/change-type pair
freezes for 30 days to prevent flapping.

---

## 4. SEO risks

| ID | Risk (requirement) | L | I | Exp | Mitigation designed in | Residual |
|---|---|---|---|---|---|---|
| SEO-1 | A shipped change harms rankings, CTR, or traffic (NFR-1, FR-14.1) | M | H | 6 | Two-phase monitoring: guardrails days 0-7 (crawl-diff, HTTP/build errors, URL Inspection verdicts, CUSUM — a cumulative-sum change-point alarm — on fresh GSC) auto-roll back catastrophes; statistical verdict at day 14-60 vs control-page counterfactual — Monitoring & Rollback Engine, Doc 03 §4.4 | Days of degraded performance before a non-catastrophic harm is confirmed; industry A/B data shows negative and inconclusive outcomes are routine [15][66] |
| SEO-2 | Wrong KEEP/ROLLBACK verdicts from confounders: algorithm updates, seasonality, competitors (FR-14.2) | H | M | 6 | Counterfactual from untouched control pages — CausalImpact-style BSTS (Bayesian structural time series) or DiD (difference-in-differences) plus year-over-year [16][17]; exogenous-event calendar; verdict windows auto-extend across confirmed Google updates; naive pre/post disqualified — Monitoring & Rollback Engine, Doc 03 §4.4 | Attribution is fundamentally probabilistic; Google itself warns changes may show no measurable impact [18] |
| SEO-3 | Title-change verdicts measure Google's rewriter, not the change: 61.6% of titles rewritten (n=80,959), 76% by Q1-2025 [19][20] (FR-4.1, FR-14.2) | H | M | 6 | Day-3 SERP display check confirms what Google actually shows before any verdict; generated titles target the 51-60-char band where rewrite rates bottom out at 39-42% [21] — Monitoring & Rollback Engine, Doc 03 §4.4; Doc 05 §2.2 | Rewrite behavior caps the measurable value of title optimization |
| SEO-4 | False-positive detection triggers a harmful "fix" (intentional noindex, decorative `alt=""`, canonical patterns that look wrong) (FR-3.7) | M | M | 4 | Deterministic ~70-rule rulebook with authored FP-suppression conditions per rule; canonical-cluster-first evaluation; looser-of-tools default thresholds severity-capped; safety class attached to the fix, not the finding — SEO Analyzer, Doc 03 §2.7 | Ambiguous cases degrade to report-only by design; some real issues surface as suggestions rather than fixes |
| SEO-5 | Cumulative change velocity destabilizes the site and destroys attribution (FR-11.1, NFR-1, NFR-4) | M | H | 6 | Velocity modifier in the risk formula; hard caps: auto-apply ≤ max(20, 2% of indexed pages)/site/day, single batch ≤ 50 pages; above 10% weekly churn, LOW items queue as MEDIUM — Decision Engine, Doc 03 §6.4 | Throughput ceiling on very active sites; deliberate, and it directly bounds NFR-4 autonomy |
| SEO-6 | Verdicts fire before Google has even recrawled the change (FR-14.3) | M | M | 4 | Evaluation clock starts at `recrawl_verified_at` (observed via URL Inspection or log sighting), never at deploy; POC #8 measures each site's real recrawl-latency distribution to replace planning priors — Monitoring & Rollback Engine, Doc 03 §4.4; Doc 05 §2.2 | Slow-crawl sites (a real segment; 16% of valuable pages on popular sites never get indexed at all [22]) delay or void verdicts |
| SEO-7 | Optimization flapping: A→B→A oscillation across cycles (FR-14.3) | L | M | 2 | 30-day freeze after any rollback; rolled-back changes never auto-re-applied; op-hash idempotence ledger (a hash per applied operation, so the same edit is never re-proposed) — Decision Engine, Doc 03 §6.4 | Low |
| SEO-8 | Freshness-trust burn: auto-stamped `lastmod` teaches Google to ignore the one sitemap field it reads [23] (FR-3.1) | L | M | 2 | Validator prohibits date changes without substantive content change; `lastmod` set only from true modification events — Validation Engine, Doc 03 §2.11; Sitemaps API in Doc 05 §2.3 | Low |

**SEO-2 is the intellectually hardest risk in the system** and the reason the Monitoring &
Rollback Engine is built around controls rather than thresholds. Google's own traffic-drop
debugging guide lists six confounders and recommends 16-month, year-over-year views [18]; the
Platform gets control pages for free by construction (it changes some pages and not their
statistical siblings), which is the same mechanism commercial SEO A/B vendors use to make
seasonality and algorithm updates cancel out [24]. Below ~10 clicks/day, page-level verdicts are
statistically underpowered; the design pools cohorts by change type, falls back to
impressions/position, and otherwise returns `insufficient_data` with an asymmetric default: keep
correctness-class fixes, roll back opinion-class changes.

---

## 5. AI risks

| ID | Risk (requirement) | L | I | Exp | Mitigation designed in | Residual |
|---|---|---|---|---|---|---|
| AI-1 | Hallucinated facts in generated values: invented prices, dates, superlatives, medical/finance claims (FR-4.2) | M | H | 6 | Closed-book rule: every factual claim must trace to the context pack via mandatory `evidence[]`; code validator rejects any number, price, percentage, date, superlative, or named entity absent from the pack; site-configurable banned-claims lists; cross-model judge pass — AI Engine, Doc 03 §2.8 | Subtle semantic errors can pass lexical validators; MEDIUM-tier human review is the backstop; LOW tier is limited to claim-free fields (alt text, descriptions) |
| AI-2 | Indirect prompt injection from crawled customer and competitor pages (NFR-1, NFR-5) | M | H | 6 | Generator has no tools, no credentials, no deploy path; hidden-text/comment stripping at extraction; delimited data-vs-instruction segregation; closed-vocabulary op schema; output allowlists (target URLs must be on the requested page; link targets must be in the site's own inventory; off-site URLs rejected); external links never auto-applied; injection classifier as telemetry; standing adversarial test suite — AI Engine + Validation Engine, Doc 03 §7.5 [8][9][25][70] | Injection is not solved at the model layer: OWASP treats it as a design/blast-radius problem [8], Unit 42 documents web-based indirect injection in the wild [25], the 2026 empirical study finds evaluated defenses degrade under adaptive attack [70], and the 2026 defense survey reaches the same containment-over-prevention conclusion [9] (EchoLeak CVE-2025-32711 class). A successful injection is bounded to one bad field value that must still survive validators and, for MEDIUM+, a human |
| AI-3 | Structured-output failure modes: refusals bypass the schema; schema-valid but semantically invalid values; providers strip `minLength`/`maxLength` constraints; cross-page content bleed (FR-4.4) | M | M | 4 | Provider-native constrained decoding as the base [26]; `stop_reason` checked before parse; all length/pixel/keyword/no-new-facts constraints enforced as code validators with one error-carrying re-ask (models fix output on first retry 95%+ of the time [27]); one page per request; one stable platform-wide op schema — AI Engine, Doc 03 §2.8; Doc 05 §10.1 | Persistent failures are dropped or escalated, costing coverage, never correctness |
| AI-4 | Miscalibrated confidence: LLM self-reported confidence clusters at 80-100% regardless of correctness [28] (FR-4.4, FR-11.1) | H | M | 6 | Confidence is a computed score dominated by deterministic evidence, not by the model's opinion of itself: `confidence = 0.55 × soft_validator_score + 0.25 × historical_acceptance + 0.20 × k_sample_self_consistency`. Hard validators are gates before the score is even computed; the site's own historical human-merge rate carries 0.25; k=3-5 self-consistency (the same value generated 3-5 times, agreement scored) carries 0.20 as a term in the formula rather than a separate gate. The model's self-report is **not in the formula at all** — it is recorded for audit and used only as a regeneration flag (self-report < 0.8 ⇒ regenerate/downgrade), which is D-11's binding rule that self-reported confidence is never the gate. Plus cross-model judge as a rank input, and monthly isotonic/Platt recalibration (mapping raw scores onto observed frequencies) against the Platform's own KEEP/ROLLBACK outcomes — Decision Engine, Doc 03 §6.1 | Cold start: until ~hundreds of outcomes per action type exist, thresholds are priors; launch posture is conservative (auto-apply LOW only). Perturbing the recorded self-report cannot move the score, by construction |
| AI-5 | Model deprecations and price moves (Sonnet-class intro pricing ends 2026-08-31 [7]; a price change of that size moves the AI line an estimated ±30-50%) [29] (NFR-6, NFR-7 — provider churn can invalidate a technology selection made on today's lineup) | H | M | 6 | Multi-provider abstraction with thin adapters over one shared op schema (Anthropic/OpenAI/Gemini all ship equivalent constrained decoding and 50% batch discounts [26][71]); budgets computed at standard, not intro, pricing; quarterly re-verification cadence — AI Engine, Doc 03 §2.8; Doc 05 §10.3 | Provider churn is external; migration cost bounded by the adapter design. The ±30-50% figure is the Platform's own sensitivity estimate against the §8 cost model, not a vendor-published number |
| AI-6 | Context rot: oversized prompts degrade output quality non-uniformly even on simple tasks [30] (FR-4.3) | M | L | 2 | Curated 2-8K-token context packs; raw HTML, boilerplate, and full competitor pages excluded; stable blocks cache-ordered first — AI Engine, Doc 03 §2.8 | Low |
| AI-7 | Judge-model bias (position, verbosity, overconfidence) [28] (FR-11.1 — see §2.1: this is a second-order risk to the confidence score, not a direct threat to a functional requirement) | M | L | 2 | Pairwise comparison with order swap; rubric decomposition; judge scores used as ranks/features, never probabilities — Decision Engine, Doc 03 §6.1 | Subtle bias persists; acceptable at this decision weight |

Two design positions matter for the client's confidence in this category. First, the AI never
decides whether something is an issue (that is the deterministic rulebook's job) and never emits
prose or HTML: it emits typed JSON operations whose schema physically cannot express "rewrite the
page," which is how the SPEC §7 mandate "AI must not blindly rewrite content" is enforced
structurally rather than by prompt instruction. Second, the model that reads untrusted crawled
content and the code that holds credentials are never the same component; deployment is
deterministic code consuming validated action records (OWASP LLM01's privilege-separation
control, mapped one-to-one onto this architecture [8]).

**On the strength of the injection claim.** This document does not assert an industry consensus it
cannot cite. What the sources here actually support is narrower and sufficient: OWASP's LLM01
entry treats indirect injection as a risk to be contained by privilege separation and human
review rather than eliminated at the model layer [8]; Unit 42 documents web-based indirect
injection against deployed agents in the wild [25]; and the 2026 empirical study finds the
defenses it evaluates degrade under adaptive attack rather than holding [70]. That is a security
literature converging on blast-radius containment — which is the design position taken here — not
a vendor-published consensus statement. AI-2's mitigation is built for that weaker, better-sourced
claim, so nothing in the design depends on the stronger one.

---

## 6. Security risks

| ID | Risk (requirement) | L | I | Exp | Mitigation designed in | Residual |
|---|---|---|---|---|---|---|
| SEC-1 | GitHub App private key compromise: the key mints tokens for every customer installation (FR-10.1, NFR-5) | L | H | 3 | Key lives only in the platform secret store; JWTs signed inside an isolated token-mint service nothing else can reach; per-job installation tokens down-scoped to one repo and minimal permissions, self-expiring in 1 hour [31]; org-visible audit and customer-side revocation — Token-mint service, Doc 03 §7.3; token flow in Doc 05 §4 | Highest-value secret in the system; SOC2-lite control set from day one |
| SEC-2 | Customer token custody breach: GSC OAuth, WordPress Application Passwords, Shopify app tokens (NFR-5) | L | H | 3 | KMS envelope encryption, per-tenant data keys under one CMK (~$1/mo + $0.03/10k calls vs $0.40/secret/mo per tenant in a secrets manager) [32][33]; every decrypt CloudTrail-logged; plaintext keys memory-only with short TTL; GSC scope is `webmasters.readonly` only [34] — Credential custody, Doc 03 §7.2; scope and auth paths in Doc 05 §2.5, §5 | WordPress Application Passwords cannot be scoped; they inherit the full user's capabilities [35], so the dedicated least-role (Editor) user is the only real scope control there |
| SEC-3 | Multi-tenant blast radius: cross-tenant read/write via RLS bypass or connection-pool state leak (NFR-5) | M | H | 6 | Pooled Postgres with row-level security on every tenant table, non-owner app role without BYPASSRLS, tenant GUC set via `SET LOCAL` inside the transaction so the tenant id cannot outlive it on a pooled connection [36]; per-tenant encryption keys as an independent second layer; per-tenant object-storage prefixes and queue fairness — Tenancy layer, Doc 03 §7.1 | RLS + pgBouncer session-variable reuse is a silent-bug class; a dedicated connection-reuse integration test in CI is load-bearing, not optional |
| SEC-4 | Supply-chain RCE: `npm install` + build of a customer repo executes arbitrary code (postinstall scripts) (FR-12.1, NFR-5) | M | H | 6 | Every build runs in an ephemeral, single-tenant, egress-restricted container or microVM (a hardware-isolated lightweight VM) with no platform secrets mounted, destroyed after the run [37]; generated patches secret-scanned before PR; never two tenants in one sandbox — Validation Engine build sandbox, Doc 03 §2.11, isolated from the token-mint service of §7.3 | The sandbox is a security-critical component; an escape would expose the token-mint boundary, hence its isolation from SEC-1's key service |
| SEC-5 | SSRF: the crawler fetches customer-supplied URLs by design (FR-1.1, NFR-5) | M | M | 4 | Post-DNS-resolution IP validation pinned for the actual connection (rebinding/TOCTOU defense); RFC1918, loopback, link-local, and cloud-metadata ranges blocked; automatic redirect-following disabled with per-hop re-validation; scheme/port allowlists; per-tenant domain allowlist; egress-only network segment [38] — Crawler, Doc 03 §7.4 | Low with layered controls; IMDSv2 (the session-token-protected instance-metadata endpoint) enforced as a second layer on cloud hosts |
| SEC-6 | Customer source code exposure through prompts, logs, or traces (NFR-5) | M | M | 4 | Minimal file slices to the LLM, never whole repos; `.env`-pattern stripping from anything model-bound; ephemeral shallow clones on encrypted scratch disks; no repo content in logs or error reports (scrubbing rules); provider no-training default confirmed in the DPA — AI Engine context packer, Doc 03 §2.8, audit surface §7.6; provider terms in Doc 05 §10 | Retention configuration is contractual; verify per provider agreement |
| SEC-7 | Unrecorded mutation: a write to a customer site that the audit trail missed (FR-13.1, FR-13.2, NFR-3) | L | M | 2 | Append-only change ledger + event spine is the only path to any write adapter; Temporal per-workflow event history doubles as an independent record; KMS/CloudTrail reconciles credential use against application logs — Change Ledger + audit surface, Doc 03 §3.3, §7.6 | Low; reconciliation jobs alert on divergence |
| SEC-8 | Customer data protection in the permanent warehouse: the Platform warehouses every tenant's GSC search data indefinitely to escape Google's 16-month retention (D-22), and page content passes to third-party AI providers — so retention, deletion-on-offboarding, sub-processor exposure, and the DPA position are live obligations, not paperwork (FR-6.1, NFR-5) | M | M | 4 | Four named controls. (1) **Retention policy per data class**: GSC/GA4 facts retained for the life of the tenancy because YoY verdicts require it, raw HTML archives on a rolling 4-version window, model prompts/completions retained 30 days for debugging then purged. (2) **Deletion on offboarding**: a documented tenant-erasure job that drops the tenant's warehouse partitions, object-storage prefix, and per-tenant KMS data key — destroying the data key renders any residual ciphertext unreadable, which is the practical backstop for backups that cannot be selectively purged. (3) **Sub-processor register** published at onboarding, naming every party that can see tenant content (AI providers, hosting, error tracking) — the same list the DPA annexes. (4) **DPA position with the AI providers**: no-training default confirmed and zero-retention or short-retention modes requested where offered, since these are the only sub-processors that see customer *page content* rather than metadata — GSC Sync + tenancy layer, Doc 03 §3.1, §7.1, §7.6; provider terms in Doc 05 §10 | The erasure job is designed but unbuilt at MVP and is the kind of control that is only proven by running it — it needs a rehearsal on a test tenant before the first enterprise contract. GDPR/DPA sufficiency is a legal review the Platform has not had; the SOC2-lite control set is a posture, not a certification |

---

## 7. API-limitation risks

| ID | Risk (requirement) | L | I | Exp | Mitigation designed in | Residual |
|---|---|---|---|---|---|---|
| API-1 | No Rich Results Test API exists; the old Structured Data Testing Tool API died in Dec 2020 and Google's schemarama validator was archived Oct 2025 [39][40] (FR-3.6, FR-12.1) | H | M | 6 | Self-built pre-deploy validator: JSON-LD extraction from the rendered DOM → syntax → schema.org vocabulary → maintained rule-pack mirroring Google's per-feature required properties; GSC URL Inspection `richResultsResult` as post-deploy ground truth [41] — Validation Engine, Doc 03 §2.11; Doc 05 §2.2 | Rule-pack drifts as Google changes feature requirements several times a year; needs a named maintenance owner |
| API-2 | URL Inspection budget: 2,000/day + 600/min per property; a 100k-page full sweep would take 50 days [42] (FR-3.1, FR-14.3) | H | M | 6 | Inspection is a budgeted sampling layer: changed URLs on a decaying schedule (day 1, 2, 4, 8), conflict pages, and a rotating stratified sample; verified prefix properties per site section multiply the effective quota [43] — Monitoring, Doc 03 §2.13; quota mechanics in Doc 05 §2.2 | Per-page index verification at 100k scale is not promised, by design honesty |
| API-3 | GSC data lags 2-3 days (grew from 1 day in 2025), with incident delays of 5-7 days, against a rollback loop that wants to react in hours [44][45] (FR-6.1, FR-14.1) | H | M | 6 | The guardrail layer is GSC-independent: build/deploy errors, HTTP checks, own crawl-diff, URL Inspection verdicts react in minutes-to-hours; CUSUM runs on fresh/hourly GSC data (hourly available for a trailing ~10 days since April 2025 [75]) for the 3-10-day metadata-regression alarm; statistical verdicts simply wait — Monitoring, Doc 03 §4.4; freshness tiers and outage behaviour in Doc 05 §2.1, §12 | Metadata regressions surface in days, not hours; a GSC outage blinds only the slow loop |
| API-4 | GSC retains ~16 months° and caps exports at ~50k° rows/day/site/search-type; YoY controls need older data [46] (FR-6.1, FR-6.3) | H | M | 6 | Nightly per-tenant Search Analytics sync warehoused permanently from onboarding; BigQuery bulk export for enterprise tenants past the row cap — GSC Sync, Doc 03 §3.1; row-cap and export mechanics in Doc 05 §2.1, §2.4 | Pre-onboarding history is capped at the 16-month backfill; YoY verdicts mature after year one. **Both figures are ° secondary**: Google publishes neither, stating only that the API returns "top rows, not all rows", so the row cap is a community-measured planning estimate that Doc 05 §2.1 pairs with empirical truncation detection rather than a documented quota. Google's limits page [42] is cited only for what it does publish (1,200 QPM; URL Inspection 2,000/day + 600/min) |
| API-5 | Yoast's REST surface is officially read-only, and unregistered meta keys are silently dropped by the WordPress REST API [47] (FR-9.2) | H | M | 6 | Mandatory ~50-line companion plugin registers SEO meta with `show_in_rest`; read-back verification (GET after write, byte-compare) catches silent drops on every write — Change Application Layer, Doc 03 §5.1; WordPress surface in Doc 05 §5 | Plugin install is onboarding friction; some managed hosts disable Application Passwords entirely |
| API-6 | Shopify protected scopes: theme writes require an exemption review (~2 weeks; "SEO" is a named qualifying category); theme library caps at 20 (100 on Plus) [48][49] (FR-9.3) | M | M | 4 | The Shopify adapter — post-MVP per Doc 01 §6, where Shopify is explicitly deferred beyond the MVP scope boundary — is designed to not need theme writes: product/collection `seo` fields, `global.title_tag`/`description_tag` metafields, `urlRedirectCreate`, app-embed JSON-LD cover ~90% of actions; staged-theme janitor for the slot cap — Change Application Layer, Doc 03 §5.1; Doc 05 §6 | Theme-dependent features are unavailable if the exemption is denied; data-field automation unaffected |
| API-7 | Hosting deploy quotas throttle validation: Vercel Hobby 100 deployments/day (Pro 6,000), 45-min build cap; Netlify 3 deploys/min, 100 API deploys/day [50][51] (FR-10.1, FR-12.1, NFR-4) | M | M | 4 | Batched validations; per-customer throughput derived from their hosting tier and surfaced at onboarding — Validation Engine, Doc 03 §2.11; per-host limits in Doc 05 §7 | The customer's plan, not the Platform, sets the automation ceiling; must be communicated, not hidden |
| API-8 | No legitimate Google push channel: the Indexing API is restricted to JobPosting/BroadcastEvent at 200/day; IndexNow's engines (Bing, Naver, Seznam, Yandex, Amazon, Yep) do not include Google [52][53] (FR-14.3) | H | M | 6 | Freshness signaling via verifiably accurate sitemap `lastmod` + resubmission and request-indexing for small batches [10][23]; IndexNow shipped day one for the non-Google engines — Monitoring, Doc 03 §2.13; Doc 05 §2.3, §9 | Google recrawl remains Google-paced: days to weeks [10]; absorbed by SEO-6's observed-recrawl clock |
| API-9 | GitHub rate limits: 5,000/hr per installation (cap 12,500), secondary limit ~80 content-creating requests/min [54][55] (FR-10.1) | L | L | 1 | Per-installation buckets naturally isolate tenants; PR-creation workers paced under secondary limits — Change Application Layer, Doc 03 §5.2; Doc 05 §4 | Monorepo-heavy customers may need pacing |
| API-10 | Google OAuth verification for the GSC scope (brand verification, demo video, scope justification) adds weeks of lead time [56] (FR-6.1, NFR-5) | H | L | 3 | Verification started early in the build phase; service-account-invite fallback path for early customers — Authentication, Doc 03 §2.3; both connection paths in Doc 05 §2.5 | Launch-timing risk only |
| API-11 | Third-party SERP/keyword vendors carry legal, commercial, and single-vendor exposure. Every SERP feed on the market is scraped — Google offers no official SERP API — and the vendors are actively litigated: Google sued SerpApi in Dec 2025 under DMCA §1201, and although the court dismissed the **copyright** claims in 2026, non-copyright theories remain open [72][73]. The alternative vendors are gated by contract rather than law: Semrush's terms cap cached API data at one month without written consent [74], which is structurally incompatible with a warehouse-first platform. A vendor that becomes expensive, rate-limited, or unavailable inside a quarter takes competitor analysis and SERP-feature scoring with it (FR-5.1, FR-7.1) | M | M | 4 | Three layers. (1) **GSC-first by design**: all rank, impression, and position time series come from the customer's own first-party GSC data, so third-party SERP data is never load-bearing for the core loop or for any KEEP/ROLLBACK verdict — it supplies competitor identity and SERP features only. (2) **Mandatory multi-vendor `SerpProvider` abstraction** (D-24): DataForSEO primary, Serper secondary, switching vendors is a config change rather than a migration. (3) **Buy, never scrape**: the Platform never scrapes SERPs in-house and never uses customer Google credentials for anything SERP-shaped, so the ToS and anti-bot risk sits with the vendor, who provides a contract and indemnification surface — Doc 03 §8 (named stack); full legal posture and the two-vendor failover in Doc 05 §8.4, §12 | Litigation outcomes are outside the Platform's control and could raise prices or reduce coverage industry-wide. Degraded mode is defined and survivable: opportunity scoring falls back to prior-based expected-CTR curves without SERP-feature multipliers, and competitor analysis (FR-7) pauses — the core optimize/validate/monitor loop does not notice |
| API-12 | AI-provider capacity, not just price: per-provider TPM/RPM rate limits are tiered by spend, batch queues have finite capacity and a documented 24-hour ceiling, and a provider outage lands on a nightly loop whose entire generation stage is batched [71] (FR-4.1, NFR-6) | M | M | 4 | The same multi-provider adapter that answers AI-5 doubles as the availability control: one op schema, three interchangeable backends (Anthropic primary, OpenAI and Gemini as failover), so an outage or a throttle is a routing decision. Batch is the default path precisely because its published envelope — 100k requests / 256 MB per batch, most complete within an hour, 24-hour maximum [71] — is wider than any single night's work, and the nightly loop is designed to tolerate up-to-24h latency rather than assume minutes. Interactive rate limits bind only the UI paths, which are a small minority of volume. Degraded mode: Tier-0 deterministic fixes (most technical SEO) need no model at all and continue unaffected — AI Engine multi-provider adapter, Doc 03 §2.8; batch envelope and outage behaviour in Doc 05 §10.2, §12 | A same-night outage across all three providers would pause generation for that cycle; nothing is lost, the queue simply carries. Batch capacity at multi-thousand-tenant scale is modelled from the published per-batch limits, not measured — POC #2 meters the real per-night request volume |

---

## 8. Cost risks

The controlling number for this category: the designed platform runs at roughly **$20-70/mo
(100-page site), $250-600/mo (10k pages), $900-2,800/mo (100k+ pages)** steady-state, while a
naive implementation of the identical product costs an estimated **20-50x more**.

**What is cited and what is modelled.** Source [7] is Anthropic's pricing page and [71] its Batch
API documentation; between them they publish the per-model token prices, the uniform 50% Batch
discount, the 0.1x cache-read multiplier, and the ~2,500-tokens-per-10 kB-page reference. Those
are cited facts. Everything derived from them — the 20-50x multiplier, the per-1k-page figures,
and the sensitivity ranges below — is **the Platform's own model, not a vendor claim**. The model
has two inputs, stated here so the arithmetic is checkable: a full page-analysis call is assumed
at **5,000 input / 800 output tokens**, and a metadata-generation call at **3,000 input / 500
output** (the same call Doc 05 §10.3 prices at $27.50–$82.50 per 10k pages generation-only, $33–$88
all-in with selective Opus judging). At batch pricing, 1,000 pages analyzed therefore costs ~$4.50 on Haiku-class,
~$13.50 on Sonnet-class, ~$22.50 on Opus-class. The 20-50x range is the compounding of the five
levers below (30-100x crawl compute × 5-10x re-analysis × ~3-5x tiering × 2x+ batch/caching,
applied to the differing mix at each tier), not a measured comparison — no naive implementation
was built to benchmark against. Treat it as a design argument with visible arithmetic, and POC #2
as the step that replaces the token assumptions with `count_tokens` measurements.

The delta comes from five compounding levers, so the cost strategies are stated in Doc 03 as
architecture requirements:

| Lever | Naive design | Designed in | Factor (modelled) |
|---|---|---|---|
| Crawling | Headless-render every page (~$50-200 per 100k pages) | Static-first, render only JS-dependent templates (<$2 per 100k) | 30-100x on crawl compute |
| Re-analysis | Re-run AI on every page every cycle | Content-hash change detection; only changed pages re-enter the AI pipeline | 5-10x steady-state |
| Model choice | Frontier model everywhere | Tiering: Haiku-class bulk (~$4.50/1k pages) → Sonnet-class judgment (~$13.50/1k) → Opus-class judging only — Platform estimate at 5k in / 0.8k out per page over list batch prices [7] | ~3-5x |
| Inference mode | Live API calls | Batch API for all scheduled work (uniform 50% off [7][71]); prompt caching (0.1x on the shared prefix [7]) | 2x+, stacking |
| SERP data | Live endpoints per query | Standard queue for everything scheduled ($0.60/1k vs $2.00/1k live) [57] | 3.3x on SERP spend |

| ID | Risk (requirement) | L | I | Exp | Mitigation designed in | Residual |
|---|---|---|---|---|---|---|
| CST-1 | Cost architecture erodes: a convenient live call here, a full-site re-analysis there, until COGS breaks pricing (NFR-6) | H | M | 6 | The five levers above are requirements with owners in Doc 03; cost per tenant metered and dashboarded from day one — cost envelope and tier triggers, Doc 03 §9; metering in Doc 03 §2.13 | Requires design-review enforcement; regression is gradual and quiet |
| CST-2 | Runaway autonomous spend: a retry loop or misconfigured schedule burns tokens/SERP calls unattended (NFR-6) | M | H | 6 | Per-tenant hard budget caps on tokens, SERP calls, and browser-seconds with cutoffs + alerting. The design position behind the control: an autonomous agent that meters nothing has no upper bound on spend by construction, so metering is a correctness requirement rather than an operational nicety — Decision Engine budgets, Doc 03 §6.4; cost envelope Doc 03 §9 | A tripped cap pauses that tenant's optimization work until reviewed; availability trade-off accepted |
| CST-3 | Anti-bot walls force managed browsers + residential proxies at $10-12/GB, the one crawl line that can genuinely blow up [58] (FR-1.5, NFR-6) | M | M | 4 | Static-first crawling and per-template render pinning keep proxy traffic minimal; managed browsers only where anti-bot friction demands — Crawler, Doc 03 §2.5 | A minority of sites are structurally expensive to crawl; priced per tenant |
| CST-4 | Model price volatility: Sonnet-class intro pricing expires 2026-08-31 [7], and a move of that size swings the AI line an estimated ±30-50% (NFR-6) | H | L | 3 | Budgets computed at standard pricing; multi-provider adapter doubles as a price lever; quarterly re-verification — AI Engine adapter, Doc 03 §2.8; current list prices in Doc 05 §10.3 | External; bounded by tiering (the AI line is a minority of large-tier cost). The ±30-50% band is the Platform's sensitivity estimate against the §8 model, not a published figure |
| CST-5 | Premature fixed-floor infrastructure: dedicated search carries a hard monthly floor before it serves a single query — OpenSearch Serverless runs ~$175/mo at the 1-OCU dev minimum and **~$350/mo at the 2-OCU production minimum**, which alone exceeds an entire small-tier budget [59] (FR-2.3, FR-16.2, NFR-6) | M | M | 4 | Postgres-only data plane (FTS + pgvector) until a **measured trigger** fires, never on tier alone: per D-05 the trigger is a faceted analytics UI over **100M+ rows**, or a demonstrated Postgres FTS/pgvector ceiling — site page count is explicitly not the trigger, because a 100k-page site can sit far below the row threshold. When it fires, provisioning starts with one ~$60/mo managed node, not Serverless — data plane, Doc 03 §3.1 and the D-05 trigger row in Doc 03 §9; selection rationale in Doc 04 | None if trigger discipline holds; the failure mode is provisioning on anticipation rather than measurement |
| CST-6 | Batch API latency: most batches complete within 1 hour but the documented maximum is 24 hours [71] (FR-15.1, NFR-6) | M | L | 2 | The nightly loop tolerates batch latency by design; live pricing reserved for interactive UI paths — Orchestrator, Doc 03 §4.2; batch envelope in Doc 05 §10.2 | Minor |
| CST-7 | Token-per-page figures are engineering estimates, not measurements: the §8 model assumes 5k input / 0.8k output per analyzed page, anchored on Anthropic's ~2,500-tokens-per-10 kB-page reference [7]; content-heavy sites are estimated to run 2-3x higher input (NFR-2, NFR-6) | M | L | 2 | POC #2 validates real token counts (`count_tokens`) before customer pricing is committed — POC #2 in Doc 07; per-model pricing in Doc 05 §10.3 | Open until measured; every per-page dollar figure in this document inherits this uncertainty |

---

## 9. Scalability risks

Three cliffs dominate this category; each has a named trigger in the design rather than a hope.

| ID | Risk (requirement) | L | I | Exp | Mitigation designed in | Residual |
|---|---|---|---|---|---|---|
| SCL-1 | 100k-page crawl economics: rendering everything makes large sites unprofitable (FR-1.5, NFR-2) | H | M | 6 | Hybrid static-first crawler: cheap static fetch by default, headless escalation decided per template by a rendering-type predictor (~10% sampling learned per site); importance-weighted sampled recrawls (high-value weekly, long-tail monthly, full re-index quarterly) — Crawler, Doc 03 §2.5 and the scale-path table in Doc 03 §9; selection rationale in Doc 04 | JS-heavy sites cost more; measured and priced, not absorbed silently |
| SCL-2 | The per-URL-workflow-step trap: 100k pages expressed as workflow steps = 100k+ billable actions per crawl and a blown 51,200-event history cap [14][60] (FR-1.5, FR-15.2) | M | M | 4 | Structural rule in Doc 03: workflows orchestrate ~12 coarse phases per site per day — O(10), never O(pages), which is the property the history cap rests on; page-level fetch/render/analyze jobs live in BullMQ with an internal checkpoint cursor, never as workflow steps — Orchestrator, Doc 03 §4.1 | Design discipline enforced by code review; violation is a cost bug, not a correctness bug |
| SCL-3 | Monitor multiplication: 5k sites × ~3 changes/day × the 14-60-day verdict windows of D-15 ≈ **210k-900k** concurrently open monitoring workflows (210k at the 14-day floor, 900k at the 60-day end) (FR-14.3) | M | M | 4 | Monitors batched one-per-site-day, not one-per-change — which collapses the count to ~5k × 60 ≈ 300k at the 60-day end regardless of change volume; sleeping workflows cost near zero compute (storage billing only) [60]; POC meters real action counts before pricing — Orchestrator, Doc 03 §4.4 | Modeled, not yet measured. The >4x spread between the 14-day floor (alt/JSON-LD/links) and the 60-day end (canonical/redirect) is why the batching rule is structural rather than an optimization |
| SCL-4 | Vector growth past pgvector's comfort zone (~5-10M embeddings) (FR-2.3, FR-16.2, NFR-2) | M | L | 2 | Trigger-based migration path to pgvectorscale/Qdrant named in Doc 04 and drawn on the D-05 trigger row in Doc 03 §9; embeddings keyed by content hash so re-crawls do not re-embed — data plane, Doc 03 §3.1 | A migration project when the trigger fires; not a redesign |
| SCL-5 | URL Inspection sampling degrades index-state freshness on 100k+-page sites (see API-2) (FR-3.1, NFR-2) | H | L | 3 | Budgeted stratified sampling + prefix-property multiplication [42][43] — Monitoring, Doc 03 §2.13; quota mechanics in Doc 05 §2.2 | Accepted; surfaced in the product as sampled index health, not per-page claims |
| SCL-6 | Tenant starvation: one 100k-page tenant monopolizes shared workers (FR-1.6, NFR-2) | M | M | 4 | Per-tenant fairness keys with per-key rate limits on the shared task queue; tenant-tagged queue concurrency at the crawl layer [61] — Orchestrator + Queue, Doc 03 §4.5 | Fairness is probabilistic; pathological tenants get explicit caps |
| SCL-7 | GSC warehouse growth: permanent daily page+query rows across all tenants (FR-1.7, NFR-2) | M | L | 2 | Day-granular aggregates, partitioned tables; raw HTML lives in object storage at $0.015/GB, never in Postgres [62] — data architecture, Doc 03 §3.1, §3.2 | Storage is a rounding error at every tier |

---

## 10. Google and search-engine policy risks

This is the category with the worst loss profile: enforcement is algorithmic and site-wide, and
recovery is slow — Google's spam policies condition recovery on demonstrated, sustained compliance
and publish no timeline [5], while trade reporting characterizes it as months [1]. The register
first, then the mandated deep-dive.

**A note on sourcing this section.** Google's own documentation is the anchor for every policy
*statement*: the spam policies page [5] for what is prohibited, the Search Status Dashboard [69]
for update dates and rollout durations, and Google's gen-AI content guidance [65] for the
people-first line. Third-party commentary — principally [1] and [64] — is used to corroborate and
to date events, and is labelled as interpretation wherever it carries a claim Google does not
state itself.

| ID | Risk (requirement) | L | I | Exp | Mitigation designed in | Residual |
|---|---|---|---|---|---|---|
| POL-1 | Scaled content abuse: at-volume AI content changes classified as "many pages generated for the primary purpose of manipulating search rankings and not helping users" [5] (NFR-8) | M | H | 6 | By construction: content-class changes carry base risk 40, which can never reach the LOW tier, so they are always human-merged PRs; net-new pages are never auto-published; per-site velocity budgets; FAQ relevance validator; closed-book sourcing — Decision Engine deny-list and budgets, Doc 03 §6.3, §6.4 | Enforcement is a classifier (SpamBrain); even compliant sites carry nonzero exposure; quarterly policy review is a standing control |
| POL-2 | Site reputation abuse: third-party/sponsored content exploiting host signals, violating "regardless of first-party involvement" since Nov 2024 [63] (NFR-8) | L | H | 3 | Architecturally out of scope: the Platform refuses to create or optimize third-party/affiliate sections — product scope boundary enforced at the Decision Engine, Doc 03 §6.3 | Near zero for the Platform; customers can still act outside it |
| POL-3 | Link-scheme adjacency: automated internal linking at scale resembling manipulation [5] (FR-8.4, NFR-8) | M | M | 4 | Caps ≤3 added links per page per cycle; anchors only from text already on the page, exact-match-once-then-vary ledger; targets selected by PageRank deficit with a ~40-inbound cap; server-side insertion via PR/CMS; tiered autonomy (auto-PR / one-click / recommend-only) — Optimization Engine internal-linking design, Doc 03 §2.15 | Internal linking is a site-owner prerogative Google tolerates; the caps keep the pattern editorial rather than schematic |
| POL-4 | AI-metadata-at-scale exposure (titles, descriptions, alt) (FR-4.1, NFR-8) | L | M | 2 | Analysis: metadata edits optimize existing pages users already visit; they are not "pages generated," which is what the policy targets [5]. Residual quality risk (templated, stuffed metadata) handled by uniqueness/lexical validators and velocity caps — Validation Engine, Doc 03 §2.11 | Low; the audit trail (below) is the defense-in-depth |
| POL-5 | Structured-data spam: markup not matching visible content, generated review/rating values (a manual-action category) [5] (FR-3.6, NFR-8) | L | H | 3 | Only visible content is marked up; review/rating generation is prohibited outright; three-layer validation (syntax → vocabulary → Google feature rules) — Validation Engine, Doc 03 §2.11 | Low |
| POL-6 | Changes applied during a Google update rollout couple the Platform's change to algorithmic volatility (FR-15.1, NFR-8) | M | M | 4 | Auto-apply freeze during confirmed rollouts, driven by polling Google's own Search Status Dashboard for rollout start and end timestamps [69] — the June 2026 spam update's multi-day rollout is the sizing case [1]; overlapping verdict windows auto-extend by rollout + 7 days — Orchestrator + Decision Engine, Doc 03 §4.2, §6.4 | Dashboard polling is an operational dependency |
| POL-7 | The policy environment itself moves: EU DMA probe into the site-reputation policy (Nov 2025) [64], AI-answer/citation manipulation added as spam (May 2026) [1][69] (NFR-8) | H | L | 3 | Quarterly review cadence for the dangerous-actions inventory, velocity caps, and policy analysis; policy constants live in config, not code — policy configuration, Doc 03 §6.3 | Inherent to operating against a moving policy target |

### 10.1 Enforcement history 2024-2026 (why this is not theoretical)

Dates and rollout durations below are the ones Google publishes on its Search Status Dashboard
[69]; the policy content is from Google's spam-policies page [5] and its policy blog posts [63];
third-party items are marked as such.

| Date | Event | Relevance to the Platform |
|---|---|---|
| Mar 2024 | Three spam policies added: **scaled content abuse** (explicitly including "using generative AI tools… to generate many pages without adding value"), **site reputation abuse**, expired domain abuse [5] | Defines the exact behavior an unconstrained version of this product would exhibit |
| Nov 2024 | Site reputation abuse tightened: violation "regardless of first-party involvement or oversight"; enforced both manually and algorithmically [63] | "We supervised the third-party content" is no defense; hence POL-2's hard exclusion |
| Aug 2025 | Spam update strengthening SpamBrain against thin, near-duplicate, programmatic content sets [69]; characterized as targeting programmatic content sets by trade coverage [6] | Programmatic near-duplicate output is what templated metadata degenerates into without uniqueness validators |
| Nov 2025 | EU DMA probe into the site-reputation-abuse policy; policy remains active — third-party reporting, not a Google statement [64] | Enforcement uncertainty in the EU, not relief |
| May 2026 | Clarification that AI-answer/citation manipulation is spam [69], as reported in [1] | The policy surface is still expanding around AI behaviors |
| Jun 24, 2026 | Spam update (SpamBrain improvement pass), rollout duration published on the Search Status Dashboard [69] and described as "a few days" in trade coverage [1]; the same coverage reports Google's recovery language as improvement "over a period of months" of demonstrated compliance [1] — Google's own spam-policies page states the compliance requirement but publishes no timeline [5] | Anchors POL-6's freeze window and the recovery asymmetry below |

### 10.2 Where the Platform actually sits, surface by surface

**Metadata at scale is the safe end.** Titles, descriptions, and alt text on existing pages are
not "pages generated"; the scaled-content policy targets page generation without value [5].
The residual risk is quality (templated or keyword-stuffed output), which the lexical and
uniqueness validators plus velocity caps address. Google's own AI guidance permits AI assistance
for people-first content and draws the line at generation "for the primary purpose of
manipulating search rankings" [65].

**Body-content updates are the real exposure.** Auto-writing content across many pages at high
velocity is not merely adjacent to the scaled-content-abuse policy — it is a close structural
match for the behaviour the policy describes, and for what the August 2025 SpamBrain pass was
aimed at: thin, near-duplicate, programmatically produced content sets [5][6][69]. Google's own
gen-AI guidance draws the line at generation "for the primary purpose of manipulating search
rankings" rather than at AI use itself [65], which means the distinguishing variable is editorial
review and per-page value — exactly the variable an unconstrained autonomous writer removes.

No quantified traffic-loss figure is asserted here. Public post-update loss percentages circulate
widely in SEO commentary but are not traceable to a controlled study, and this document will not
carry a number it cannot source; the qualitative argument above is what the primary documentation
actually supports. What can be stated without a citation problem is the shape of the downside:
enforcement is site-wide rather than page-wide, and recovery is conditioned on demonstrated
sustained compliance with no published timeline [5] — which is precisely why the design treats
this as an unrecoverable-class risk rather than a tunable one.

The design's response is therefore categorical rather than probabilistic: content changes can
never auto-apply (base risk 40 keeps them out of the LOW tier permanently), FAQs require a
relevance validator and a "genuinely useful" gate, and generated content must derive from the
page's existing topic and supplied evidence, never free generation.

**Net-new page creation is never autonomous.** Autonomous mass-publishing of AI pages is the
definition of scaled content abuse [5]. The Platform drafts; a human reviews, owns, and
publishes. This is the brightest line in the product, and it is permanent, not a maturity phase.

**Automated internal linking sits adjacent to the link-spam policy, deliberately inside it.**
Google's link-spam concern is manipulation patterns at scale [5]. The controls in POL-3 (per-page
caps, anchors drawn only from existing on-page text with enforced variation, need-based
targeting, human tiers for anything beyond mechanical retargets) keep the Platform's output
indistinguishable from careful editorial linking, which is the standard Google actually applies.

**The audit trail is itself a policy asset.** Google's guidance asks that automation use be
self-evident and accountable [65]. The change ledger records model, prompt version, reason,
evidence, and approval trail for every AI-touched change; if a customer ever faces a manual
action review, the disclosure record already exists.

### 10.3 The recovery asymmetry (why every threshold is conservative)

Recovery times are the reason "roll it back if it goes wrong" is not a sufficient safety story:

- Spam-update recovery: Google's spam policies condition recovery on demonstrated, sustained
  compliance and set no timeline [5]; the "over a period of months" characterization comes from
  trade coverage of the June 2026 update [1]. The claim that some penalty classes (link schemes)
  are effectively permanent appears only in that third-party commentary [1] and is carried here as
  interpretation, not as Google's stated position — the design does not rely on it, since the
  months-scale case is already enough to justify the deny-list.
- robots.txt, two failure modes: a bad `Disallow` line blocks the matched paths from the moment
  Google refetches the file, and a robots.txt that returns 5xx stops site-wide crawling within 12
  hours. Because the file is cached up to 24 hours, either way an instant rollback still leaves
  the bad file live for up to a day [4].
- Site-move-class changes (mass redirects, URL restructuring): ranking fluctuation heaviest for
  2-4 weeks, stabilization 4-6 weeks same-domain and 2-3 months or more cross-domain [2][3];
  redirects must persist at least a year [2].
- Ordinary changes: Google commits only to ranges: crawling "a few days to a few weeks" after a
  request [10], indexing "a day or so… can take much longer" [11], visible effect "a few hours"
  to "several months" [67].

The design consequence, stated once and applied everywhere: **when the downside is months and the
upside is percentage points, the system defaults to the slower, gated path.** That is why the
deny-list exists, why content never auto-applies, and why the §26 automation boundary in Doc 02
treats "requires approval" as a legitimate permanent state.

---

## 11. Dangerous-actions inventory (SPEC §23)

Every action the Platform could take that is potentially dangerous, with its worst credible
outcome and the specific designed control. Tier names are SPEC §14's. "Deny-list" means the
action is permanently human-gated: no confidence score, trust level, or configuration can
authorize it autonomously (Decision Engine hard floor, Doc 03).

| # | Action | Worst credible outcome | Tier / handling | Designed control |
|---|---|---|---|---|
| 1 | robots.txt edit | Bad `Disallow` blocks matched paths on next fetch; a 5xx halts site-wide crawling within 12 h; 24 h cache outlives rollback [4] | HIGH, deny-list | Detection + proposed diff only; synthetic robots.txt monitor with last-known-good auto-restore |
| 2 | noindex add/remove | Silent de-indexing of revenue pages (add); exposure of staging, thin, duplicate, or deliberately suppressed pages to indexing (remove) | **HIGH, deny-list in both directions** | Never auto-added *and* never auto-removed. Removal is drafted as a HIGH-tier recommendation with cross-signal justification and executed by a human, because an existing noindex is an intentional state until proven otherwise — the same premise as row 20 and SEO-4 |
| 3 | Mass canonical rewrite (>10 pages) | Signals consolidated to wrong URLs; "duplicates" de-indexed [68] | HIGH, deny-list | Batch threshold escalation; single-page canonical fixes stay MEDIUM |
| 4 | Mass redirects / URL restructuring | Site-move-class event: weeks of fluctuation, months to stabilize [2][3] | HIGH, deny-list | Human-executed with Platform-generated plan; redirects flagged to persist ≥1 year |
| 5 | Page deletion (404/410) | Permanent traffic loss until reindex | HIGH, deny-list | Recommend-only with traffic evidence attached |
| 6 | Sitemap replacement | Wrong/partial discovery signals site-wide; a dropped URL set silently removes discovery for those pages | **MEDIUM, escalating to HIGH at >5% URL removal**: MEDIUM by default (human-gated PR/approval), escalating to HIGH when the diff removes more than 5% of known indexable URLs | Regenerated only from the crawl's canonical indexable set; diff-validated against the crawl before submission [23]; auto-submission blocked on any net URL removal. **The LOW-tier action is re-submitting a sitemap whose content is byte-identical to the verified current one** — a no-op ping. Replacing the file's contents is never LOW |
| 7 | Site-wide template edit (nav/footer/header) | Every page's link graph changes at once; render breakage | **HIGH, deny-list (hard floor, B=80)** | Hard tier floor that overrides the arithmetic — the blast-radius multiplier would reach HIGH anyway, but the floor means no confidence score or trust level can lower it; PR with CI smoke tests when human-approved |
| 8 | Mass internal-link injection | Link-scheme appearance; UX damage [5] | MEDIUM, capped | ≤3 added links/page/cycle; anchor rules; velocity caps (POL-3) |
| 9 | Structured data at scale | "Spammy structured markup" manual action [5] | MEDIUM | Three-layer validation; visible-content-only rule; review/rating generation prohibited |
| 10 | Content rewriting at scale / mass page generation | Scaled-content-abuse classification; months-scale recovery [1][5] | MEDIUM floor (content B=40); net-new pages never auto-published | Velocity budgets; human merge always; drafts only for new pages |
| 11 | Third-party/affiliate section publishing | Site-reputation-abuse violation regardless of oversight [63] | Excluded | Not built; refused at the product level |
| 12 | Faking freshness (touching dates/`lastmod` without change) | Burns the site's lastmod credibility with Google [23] | Prohibited | Validator blocks date-only diffs |
| 13 | hreflang restructuring | Broken international targeting, silently | HIGH, deny-list for *cluster* restructuring | Syntax normalization only at LOW; cluster changes human-gated |
| 14 | Server-config changes (.htaccess, next.config redirects/headers) | Whole-site 500s; robots/redirect interactions | HIGH, deny-list | Changed-file allowlist denies these paths to the generator outright [37]; PR + CI smoke tests when human-driven |
| 15 | Partial batch application (CMS API fails mid-batch) | Half-updated canonical/link graphs | Guarded | Per-object verify; partial state recorded, alerting, auto-repair queue (TEC-3) |
| 16 | Applying during a Google update rollout | Attribution destroyed; change coupled to an algorithmic drop | Frozen | Auto-freeze window from the Search Status dashboard (POL-6) |
| 17 | Exhausting GSC quotas (1,200 QPM; URL Inspection 2,000/day) [42] | Monitoring blackout: flying blind post-change | Guarded | Quota budgeter; changed-URLs-only inspection on a decaying schedule |
| 18 | Git force-push / history rewrite on a customer repo | Destroys customer work | Prohibited | Token permissions never include force capability; PR-only workflow; `expectedHeadOid` on all writes [12] |
| 19 | Editing CI workflows, lockfiles, dependency manifests | Supply-chain/CI takeover via the automation path | Prohibited | Changed-file allowlist deny-always set for the code generator [37] |
| 20 | Overwriting intentional states (decorative `alt=""`, deliberate noindex, parameter canonicals) | "Fixes" that damage accessibility or indexing intent | Suppressed | FP-suppression conditions authored per rule; cross-signal intent checks (SEO-4) |
| 21 | Host-level redirect policy (HTTP→HTTPS, www resolution) | Server-config change with site-wide blast radius: a wrong host rule can 301 an entire domain to a broken origin | **HIGH, deny-list (hard floor, B=90)** | Detection + proposed plan only; never generated as an applied change — the same allowlist that denies row 14's config paths denies these |
| 22 | Navigation/architecture changes (crawl-depth fixes, link pruning) | Structural: link equity redistributed across the whole site at once, and crawl paths to long-tail pages can disappear silently | **HIGH, deny-list (hard floor, B=80)** | Recommend-only with the affected-URL set and PageRank delta attached; human executes; overlaps row 7 when delivered as a template edit |

**Tier alignment.** Every tier in this table matches or exceeds the tier assigned in the binding
safety research, with no downward deviations. Two rows are worth calling out because a looser
reading is tempting and would be wrong. Row 2 (noindex) is deny-listed in **both** directions:
removing a noindex is not the safe inverse of adding one, because an existing noindex is an
intentional editorial or legal state — staging, thin, duplicate, or deliberately suppressed pages —
and "the crawler thinks this page should be indexed" is not evidence that its owner agrees. Row 6
(sitemap) is MEDIUM, escalating to HIGH at >5% URL removal, rather than LOW, because a sitemap is a
site-wide discovery signal: the LOW-risk auto-appliable action is re-submitting a verified-identical
file, which is what a "sitemap submission is safe" reading actually refers to; replacing the file's
*contents* changes what Google is told exists, and gets a human.

**Deny-list membership and its provenance.** Ten action types carry a permanent hard tier floor —
rows 1-5, 7, 13, 14, 21 and 22 — and Doc 02 §2.5 is the canonical enumeration with the split the
client asked to see: four come from SPEC §14 and D-13 (robots.txt, mass redirects/URL restructuring,
page deletion, mass canonicals >10 pages) and six are the Platform's own extensions (noindex in
either direction, site-wide template edits, hreflang cluster restructuring, host-level redirect
policy, server/framework config, navigation/architecture changes). "Hard floor" is the operative
word: for every one of the ten the tier is set by the floor and not by the risk arithmetic, so no
blast-radius multiplier, confidence score, or earned-trust level can move any of them left.

---

## 12. Top-10 risks by exposure

**Ranking rule, applied literally.** Primary key: the **Exposure** column carried in every
register table (L × I, each scored 1/2/3 — so 1 to 9). Tie-break 1: higher **impact** wins, since
the loss function is asymmetric. Tie-break 2: **irreversibility** — worst-case recovery time for a
customer site, months beating weeks beating days beating minutes. Tie-break 3: how load-bearing
the single control is. Nothing else enters the ordering, and a reader can reproduce this table
from the eight registers above.

**Why tie-breaks do the real work.** 22 of the 66 risks score Exposure 6, and no risk scores
higher — Exposure alone cannot select ten of them. Of those 22, nine carry impact H and take slots
1-9 on tie-break 1; slot 10 goes to the most irreversible of the impact-M group. This is stated
rather than hidden, because a ranking that looks like arithmetic but is actually judgment is worse
than either.

| # | ID | Risk | L×I | Exp | Why this rank (tie-break) | Single most load-bearing mitigation |
|---|---|---|---|---|---|---|
| 1 | POL-1 | Scaled-content-abuse classification | M×H | 6 | Impact H; the only failure mode whose recovery Google conditions on months of demonstrated compliance | Content-class changes can never reach the auto-apply tier; a human merges every content PR |
| 2 | SEC-3 | Cross-tenant read/write via RLS bypass or pooled-connection state leak | M×H | 6 | Impact H; a disclosure cannot be un-disclosed — permanently irreversible, and it damages every tenant at once, not one site | Tenant id set per transaction via `SET LOCAL` under RLS with a non-owner app role, backed by per-tenant encryption keys as an independent second layer |
| 3 | SEC-4 | RCE via customer `npm install` in the build path | M×H | 6 | Impact H; a successful escape is permanent and would reach the token-mint boundary. Ranked below SEC-3 only because the sandbox is single-tenant by construction, so first blast radius is one tenant | Ephemeral, egress-restricted, single-tenant sandbox with zero platform secrets mounted |
| 4 | AI-2 | Prompt injection from crawled content reaching a customer site | M×H | 6 | Impact H; individually reversible (one bad field value) but it is the one risk that can *chain* into the security category, so it ranks above the purely content-side failures | The generating model has no tools and no credentials; output survives only as schema-bound values through allowlist validators |
| 5 | AI-1 | Hallucinated facts published to customer pages | M×H | 6 | Impact H; the HTML reverts in minutes, but a published false price or health claim leaves reputational and potentially legal residue that rollback does not erase | Closed-book rule: any number, claim, or entity absent from the evidence pack is rejected in code before any deploy path |
| 6 | SEO-1 | A shipped change harms rankings before detection | M×H | 6 | Impact H; recovery is days-to-weeks because it waits on Google's recrawl, not on our rollback | The day-0-7 guardrail layer (crawl-diff, HTTP, build, URL Inspection) auto-rolls back catastrophes in minutes-to-hours, independent of lagged GSC data |
| 7 | SEO-5 | Cumulative change velocity destabilizes the site and destroys attribution | M×H | 6 | Impact H; ranks below SEO-1 on blast radius but above CST-2 because the lost measurement window cannot be recovered at any price — the evidence for what happened is simply gone | Hard per-site budgets outside the score: ≤ max(20, 2% of indexed pages)/day and ≤50 pages/batch, with LOW items queuing as MEDIUM above 10% weekly churn |
| 8 | CST-2 | Runaway autonomous spend | M×H | 6 | Impact H; spend is irreversible but bounded by the cap, and it threatens the Platform rather than a customer site | Per-tenant hard budget caps on tokens, SERP calls, and browser-seconds with automatic cutoff |
| 9 | TEC-1 | AI-generated change breaks the customer build or renders wrong | M×H | 6 | Impact H, lowest irreversibility of the nine: caught pre-deploy by CI in the normal case, and reverted in minutes when it is not | Codemods execute and the LLM supplies values only; sandboxed build + preview deploy + meta-diff assertion gate every code change |
| 10 | SEO-2 | Wrong KEEP/ROLLBACK verdicts from confounded measurement | H×M | 6 | The most irreversible of the impact-M ties: a wrong verdict compounds — a wrong ROLLBACK costs a second recrawl cycle plus a 30-day page freeze, and both directions silently poison the trust scores that later automation depends on | Counterfactual verdicts against untouched control pages; naive pre/post is disqualified outright |

**What the rule excludes, and why that is honest.** Three risks that a reader might expect here
are absent by arithmetic, not by oversight:

- **SEC-1 (GitHub App private key compromise)** scores L×H = 3. It is the highest-*impact* single
  secret in the system — the key mints tokens for every installation — but its likelihood is
  genuinely low given the isolated token-mint service, and inflating a likelihood to force a
  ranking would defeat the point of having one. It is called out in §1 by name for exactly this
  reason: highest consequence, lowest probability, and therefore a control question rather than a
  ranking question. SEC-2 sits in the same position.
- **CST-1 (cost architecture erosion)** and **API-3 (GSC lag blinds the loop)** both score H×M = 6
  and lose tie-break 1 to the nine impact-H risks. Both remain top-ten *concerns* operationally;
  neither is a top-ten *exposure* under a rule applied consistently.
- **TEC-4 (rollback is not undo)**, H×M = 6, likewise: high likelihood, but the damage is a wrong
  expectation rather than a wrong site state, and the drift check bounds the site-state case.

Two near-misses deserve a sentence. SCL-2 (the per-URL-workflow-step trap) scores 4 only because
it is fully preventable by a structural rule already fixed in Doc 03; if that rule were ever
relaxed, its likelihood and cost impact would both rise and it would enter this table. And POL-6
(applying changes during update rollouts) is individually modest at 4 but multiplies SEO-2's
likelihood when it fires, which is why the freeze is automatic rather than advisory.

---

## 13. Sources

1. Digital Applied — Google June 2026 spam update rollout guide (third-party commentary; source of the "a few days" rollout characterization, the May 2026 AI-answer clarification, and the months-scale recovery language): https://www.digitalapplied.com/blog/google-june-2026-spam-update-rollout-site-owner-guide
2. Google Search Central — Site moves with URL changes: https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes
3. Webnode — Website migration SEO checklist (4-6-week same-domain stabilization; 2-3-month domain change): https://www.webnode.com/blog/website-migration-seo-checklist/
4. Google Search Central — How Google interprets robots.txt (24 h caching, 5xx handling): https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
5. Google Search Central — Spam policies for Google web search (scaled content abuse, link spam, structured-data spam): https://developers.google.com/search/docs/essentials/spam-policies
6. RebelMouse — Understanding the impact of Google's August 2025 spam update: https://www.rebelmouse.com/google-spam-update-2025
7. Anthropic — Claude API pricing. Cited **only** for what this page publishes: per-model input/output token prices, the uniform Batch −50% discount, the 0.1× prompt-cache-read multiplier, the Sonnet-class intro-pricing expiry date (2026-08-31), and the ~2,500-tokens-per-10 kB-page reference. All per-1k-page costs, the 20-50x naive-vs-designed multiplier, and the ±30-50% price-sensitivity band in this document are the Platform's own model built on those inputs (§8), not claims from this source: https://platform.claude.com/docs/en/about-claude/pricing
8. OWASP GenAI Security Project — LLM01:2025 Prompt Injection (indirect injection, privilege control, segregation, human-in-the-loop): https://genai.owasp.org/llmrisk/llm01-prompt-injection/
9. Zylos Research — Indirect Prompt Injection: Attacks, Defenses, and the 2026 State of the Art: https://zylos.ai/research/2026-04-12-indirect-prompt-injection-defenses-agents-untrusted-content/
10. Google Search Central — Ask Google to recrawl your URLs ("a few days to a few weeks"; repeat requests don't accelerate): https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl
11. Google Search Console Help — About the URL Inspection tool ("Indexing typically takes only a day or so, but can take much longer in some cases"): https://support.google.com/webmasters/answer/9012289
12. GitHub — public GraphQL schema (`createCommitOnBranch`, `revertPullRequest`, `expectedHeadOid`, auto-merge mutations): https://docs.github.com/public/fpt/schema.docs.graphql
13. Vercel — Instant Rollback (routing-layer rollback; env/cron caveats; disabled auto-assignment after rollback): https://vercel.com/docs/instant-rollback
14. Temporal — Workflow event history limits (51,200 events / 50 MB; continue-as-new): https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/workflow/workflow-execution/event.mdx
15. SearchPilot — SEO A/B test case studies (winning/negative/inconclusive outcomes all routine): https://www.searchpilot.com/resources/case-studies
16. CausalImpact — official documentation (assumptions for valid counterfactual inference): https://google.github.io/CausalImpact/CausalImpact.html
17. Brodersen et al. — Inferring causal impact using Bayesian structural time-series models: https://arxiv.org/abs/1506.00356
18. Google Search Central — Debugging drops in Google Search traffic (six confounders; 16-month/YoY guidance): https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops
19. Zyppy (Cyrus Shepard) — Google title tag rewrite study (61.6% of 80,959 URLs): https://zyppy.com/seo/title-tags/google-title-rewrite-study/
20. SerpClix — Google rewrites title tags (Q1-2025 update: 76% rewrite rate): https://serpclix.com/blog/google-rewrites-title-tags-how-to-survive
21. Search Engine Journal — Google changes more than 61% of title tags (51-60-char band, 39-42% rewrite floor): https://www.searchenginejournal.com/google-changes-more-than-61-percent-of-title-tags/435618/
22. Search Engine Journal — How long before Google indexes my new page (Rudzki/Onely: 83% within a week; 16% of valuable indexable pages never indexed): https://www.searchenginejournal.com/how-long-before-google-indexes-my-new-page/464309/
23. Google Search Central — Build and submit a sitemap (`lastmod` used only "if it's consistently and verifiably accurate"; priority/changefreq ignored): https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
24. SearchPilot — The math behind SearchPilot (control bucketing; updates and seasonality cancel in comparison): https://www.searchpilot.com/resources/blog/the-math-behind-searchpilot-how-seo-a/b-testing-actually-works
25. Palo Alto Unit 42 — Fooling AI Agents: web-based indirect prompt injection observed in the wild: https://unit42.paloaltonetworks.com/ai-agent-prompt-injection/
26. Anthropic — Structured outputs (`output_config.format`, strict tool use, stripped length constraints): https://platform.claude.com/docs/en/build-with-claude/structured-outputs
27. Instructor — Re-ask validation / retry mechanisms (95%+ fixed on first error-carrying retry): https://python.useinstructor.com/concepts/reask_validation/
28. arXiv 2508.06225 — Overconfidence in LLM-as-a-Judge: Diagnosis and Confidence-Driven Solution: https://arxiv.org/abs/2508.06225
29. Anthropic — Models overview (current lineup and pricing terms): https://platform.claude.com/docs/en/about-claude/models/overview
30. Chroma Research — Context Rot: How Increasing Input Tokens Impacts LLM Performance (18-model study): https://research.trychroma.com/context-rot
31. GitHub Docs — Installation access tokens (1-hour expiry; per-token repo/permission down-scoping): https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
32. AWS KMS pricing ($1/key/mo, $0.03/10k requests): https://aws.amazon.com/kms/pricing/
33. AWS Secrets Manager pricing ($0.40/secret/month): https://aws.amazon.com/secrets-manager/pricing/
34. Google Search Console API — authorization scopes (webmasters.readonly): https://developers.google.com/webmaster-tools/v1/how-tos/authorizing
35. WordPress Core — Application Passwords integration guide (no scoping; full-user capabilities): https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/
36. AWS Database Blog — Multi-tenant data isolation with PostgreSQL RLS (BYPASSRLS, pooling caveat, SET LOCAL): https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/
37. The Main Thread — Coding agent guardrails (path allowlists; workflow files and manifests are not edit surfaces; diff budgets): https://www.the-main-thread.com/p/coding-agent-guardrails
38. OWASP — SSRF Prevention Cheat Sheet (resolved-IP validation, DNS rebinding, metadata IPs, redirect handling): https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
39. Google Search Central Blog — Structured Data Testing Tool update (deprecation without API replacement): https://developers.google.com/search/blog/2020/12/structured-data-testing-tool-update
40. Google schemarama — archived Oct 22, 2025, non-production: https://github.com/google/schemarama
41. Google Search Central Blog — URL Inspection API (richResultsResult; verified-property requirement): https://developers.google.com/search/blog/2022/01/url-inspection-api
42. Google — Search Console API usage limits (URL Inspection 2,000/day + 600/min per property; Search Analytics 1,200 QPM): https://developers.google.com/webmaster-tools/limits
43. Similar.ai — Google Search Console API guide (rolling 24 h quota window; per-prefix-property quotas): https://similar.ai/guides/google-search-console-api/
44. Google Search Central Community — API data delay grew from 1 day to 3 days (2025): https://support.google.com/webmasters/thread/394920643
45. GSC Wizard — Search Console data delay FAQ (incident delays of 5-7 days): https://www.gscwizard.com/faq/google-search-console-data-delay.html
46. RankStudio — Google Search Console API guide (50k rows/day export cap; ~16-month retention) **[secondary °]** — Google publishes neither figure (its documentation says only that the API returns "top rows, not all rows"), so both are community-measured planning estimates; see Doc 05 §2.1 for the truncation-detection design that compensates: https://rankstudio.net/articles/en/google-search-console-api-guide
47. Yoast developer docs — REST API ("currently read-only, doesn't support POST or PUT"): https://developer.yoast.com/customization/apis/rest-api/
48. Shopify — Asset API restrictions and protected-scope exemption (SEO a named qualifying category; ~2-week review): https://shopify.dev/docs/apps/build/online-store/asset-legacy
49. Shopify Help — Adding themes (theme library caps: 20 standard plans, 100 Plus): https://help.shopify.com/en/manual/online-store/themes/adding-themes
50. Vercel — Limits (deployments/day by tier; 45-minute build cap): https://vercel.com/docs/limits
51. Netlify — API get started (500 requests/min; 3 deploys/min; 100 API deploys/day): https://docs.netlify.com/api/get-started/
52. Google — Indexing API quickstart (JobPosting/BroadcastEvent only; 200/day default quota): https://developers.google.com/search/apis/indexing-api/v3/quickstart
53. IndexNow — FAQ (participating engines: Amazon, Bing, Naver, Seznam.cz, Yandex, Yep; Google absent): https://www.indexnow.org/faq
54. GitHub Docs — Rate limits for GitHub Apps (5,000/h base per installation; 12,500/h cap): https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps
55. GitHub Docs — REST API rate limits (secondary limits incl. ~80 content-creating requests/min): https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
56. Google — OAuth app verification requirements for sensitive/restricted scopes: https://support.google.com/cloud/answer/13464321
57. DataForSEO — SERP API pricing ($0.60/1k standard queue, $2.00/1k live): https://dataforseo.com/apis/serp-api
58. Browserbase — pricing (browser hours; residential proxies $10-12/GB): https://www.browserbase.com/pricing
59. Amazon OpenSearch Service — pricing (Serverless OCU minimums; ~$350/mo classic floor): https://aws.amazon.com/opensearch-service/pricing/
60. Temporal — Cloud pricing (Essentials $100/mo floor; $50 per million actions; active-storage billing): https://docs.temporal.io/cloud/pricing
61. Temporal — Task queue priority & fairness (per-tenant fairness keys, per-key rate limits): https://github.com/temporalio/documentation/blob/main/docs/develop/task-queue-priority-fairness.mdx
62. Cloudflare R2 — pricing ($0.015/GB-month, zero egress): https://developers.cloudflare.com/r2/pricing/
63. Google Search Central Blog — Updating our site reputation abuse policy (Nov 2024; "regardless of first-party involvement"): https://developers.google.com/search/blog/2024/11/site-reputation-abuse
64. Myoho Marketing — Site reputation abuse policy vs EU DMA probe (Nov 2025; 2026 status): https://myohomarketing.com.au/googles-site-reputation-abuse-spam-policy-vs-eu-antitrust-what-the-dma-probe-means-for-seo-in-2026/
65. Google Search Central — Guidance on AI-generated content and scaled content abuse (people-first line; manipulation threshold): https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
66. SearchPilot — 10 SEO A/B tests with >10% impact (incl. negative results): https://www.searchpilot.com/resources/blog/10-seo-ab-tests-with-an-impact-of-over-10-percent
67. Google Search Central — SEO starter guide ("Some changes might take effect in a few hours, others could take several months"): https://developers.google.com/search/docs/fundamentals/seo-starter-guide
68. Google Search Central — Consolidate duplicate URLs (canonicalization signals and failure modes): https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
69. Google — Search Status Dashboard (primary record of ranking and spam update announcements, with rollout start and end timestamps; polled by the Platform for POL-6's freeze window): https://status.search.google.com/
70. arXiv 2604.27202 — Indirect Prompt Injection in the Wild: An Empirical Study (evaluated defenses degrade under adaptive attack): https://arxiv.org/html/2604.27202v1
71. Anthropic — Message Batches API (uniform 50% discount; up to 100,000 requests / 256 MB per batch; most batches complete within 1 hour, 24-hour documented maximum): https://platform.claude.com/docs/en/build-with-claude/batch-processing
72. ALM Corp — Google v. SerpApi analysis (suit filed 19 Dec 2025 under DMCA §1201; "SearchGuard" anti-bot context): https://almcorp.com/blog/google-sues-serpapi-lawsuit-analysis/
73. ScrapeBadger — What the 2026 SerpApi ruling actually says (Google's copyright claims dismissed — plain search results held "not works protected under the Copyright Act"; non-copyright theories left open): https://scrapebadger.com/blog/google-sued-a-scraper-under-copyright-law-and-lost-heres-what-the-serpapi-ruling-actually-says
74. That Marketing Buddy — Semrush API pricing and terms ($549/mo plan floor plus units; cached API data capped at one month without written consent): https://thatmarketingbuddy.com/blog/semrush-api-pricing
75. Google Search Central Blog — Search Analytics hourly data (April 2025; `hourly_all` data type and `hour` dimension over a trailing ~10 days): https://developers.google.com/search/blog/2025/04/san-hourly-data
