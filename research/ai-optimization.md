# AI SEO Optimization Engine — Research (SPEC §7)

Lane: how the LLM layer should generate SEO improvements (titles, meta descriptions, H1/H2
structure, image alt, content improvements, content gaps, FAQs, internal-link suggestions,
structured data) **without blindly rewriting content**. Research date: 2026-08-10. All prices
verified against official provider pages current as of this date.

---

## Summary

**Recommendation in one paragraph:** Build the AI engine as a *typed-operation emitter*, not a
content writer. The model never returns prose or HTML — it returns a JSON array of schema-enforced
operations (`UPDATE_TITLE`, `UPDATE_META_DESCRIPTION`, `ADD_FAQ_BLOCK`, `ADD_INTERNAL_LINK`,
`UPDATE_IMAGE_ALT`, `INSERT_SECTION`, `UPDATE_SCHEMA`, …), each carrying `oldValue` (an
optimistic-lock anchor verified against the live page before apply), `newValue`, `reason`,
`evidence[]` (pointers into the supplied context pack), and machine-checkable metadata. Schema
enforcement uses the providers' native structured-output features (Anthropic `output_config.format`
/ strict tool use; OpenAI `response_format: json_schema, strict: true`; Gemini `responseSchema`)
[1][2][6][8], with a Pydantic/Instructor-style semantic-validation + retry layer on top for
everything grammars cannot express (pixel width, keyword presence, no-new-facts) [10]. Confidence
is **never** the model's verbalized number — LLM self-reported confidence is systematically
overconfident [13] — it is a computed score from deterministic validators, k-sample
self-consistency agreement [14][26], and a cross-model judge, calibrated over time against the
platform's own keep/rollback outcomes. Model tiering: deterministic code for everything rule-shaped
(most technical SEO "fixes" need no LLM at all), Claude Haiku 4.5 / gpt-5-mini / Gemini Flash-Lite
class for bulk fields (alt text, meta descriptions), Claude Sonnet 5 class for titles, headings,
FAQs, and internal links, and Claude Opus 5 class reserved for judging, content-improvement
planning, and escalations — with essentially all generation routed through the providers' Batch
APIs (a uniform 50% discount at all three vendors [3][5][7]) because the SEO cycle is a nightly
batch job, not an interactive one. A full 10,000-page metadata pass costs roughly **$25–$85 in
model spend** at Haiku/Sonnet batch rates (worked example in §6). Crawled and competitor page text
is untrusted input — treat prompt injection as unsolved [16][19] and design for bounded blast
radius: the generator has no tools and no write access, outputs are typed values that pass
allowlist/diff/URL validators, and external-link operations sourced from third-party content are
never auto-applied.

---

## Findings

### 1. The structured input context pack

**How big.** The instinct to exploit 1M-token context windows is wrong here. Chroma's "context
rot" study across 18 frontier models (GPT-4.1, Claude 4, Gemini 2.5, Qwen3) shows reliability
degrades non-uniformly as input grows, *even on trivially simple tasks*, and that distractor
content and (surprisingly) coherent long documents actively hurt retrieval accuracy [9]. A per-page
optimization task should therefore get a **curated pack of roughly 2,000–8,000 tokens**, not the
raw crawl record. This also keeps unit economics sane: at 10k+ pages per site, every 1K tokens of
pack bloat is ~$30 per full-site pass at Sonnet-class list prices.

**Include (in stable-first order, for prompt caching):**

| Block | Content | Size guide | Cacheable? |
|---|---|---|---|
| System + task contract | Role, guardrails, op-schema semantics, output rules | 1–2K tok | Yes — byte-stable across all pages |
| Business context | One-paragraph brand brief, audience, banned claims list, voice rules (tone, person, reading level), legal constraints | 300–800 tok | Yes — per site |
| Site conventions | Title pattern (e.g. `{Primary} – {Brand}`), separator, brand suffix rules, existing taxonomy | 100–300 tok | Yes — per site |
| Page identity | URL, page type (product/category/blog), current `<title>`, meta description, canonical, H1–H3 outline | 200–500 tok | No |
| Main content | Boilerplate-stripped markdown of the main content region — headings + first ~1,500–3,000 words; full text only for content-improvement tasks | 500–4K tok | No |
| Target keyword + intent | Primary keyword, 3–10 secondary keywords, classified intent (informational/commercial/…), current avg. position | 100–200 tok | No |
| GSC slice | Top ~20 queries for this page over 90 days: clicks, impressions, CTR, position; the page's CTR-vs-expected delta (see §7) | 200–500 tok | No |
| Competitor digest | For top 3–5 ranking competitors: title, H1, H2 list, topics/entities covered, word count, FAQ questions present — **structured summaries, never raw pages** | 300–1K tok | No |
| Link context | Existing internal in/out links with anchors; candidate link targets (pre-computed by the linking algorithm, §11 of the SPEC) with their titles | 200–600 tok | No |
| Existing structured data | Current JSON-LD types + properties (compacted) | 100–400 tok | No |

**Exclude:** raw HTML/CSS/JS, nav/header/footer boilerplate, full competitor page text, full GSC
exports, crawl metadata (status codes, timings — the analyzer consumes those, not the LLM), and
anything the deterministic rules engine already decided. Rationale: distractors measurably degrade
output [9]; boilerplate is where injected instructions hide (§5); and tokens are money.

**Ordering matters for cost.** All three providers price cached input at ~10% of list
[4][5][7]. Put the byte-stable system + brand + site blocks first and mark the cache breakpoint
after them; volatile per-page blocks go last. Anthropic specifics: cache reads ~0.1×, writes 1.25×
(5-min TTL), minimum cacheable prefix 512 tokens on Claude Opus 5, 1024 on Sonnet 5, **4096 on
Haiku 4.5** — a short site preamble silently won't cache on the cheap tier, so size the shared
prefix above 4K tokens or accept uncached input there [4].

**One page-task per request.** Don't pack 50 pages into one call to "save overhead" — cross-page
bleed (facts from page A appearing in page B's meta description) is a real failure mode and
per-page requests are what the Batch API is for.

### 2. Enforcing reliable structured output

All three major providers now ship real schema enforcement (constrained decoding / grammar
masking), which makes the SPEC's core ask — "research how to enforce reliable structured AI
output" — largely a solved problem at the *syntax* level:

- **Anthropic** (current lineup verified 2026): `output_config: {format: {type: "json_schema",
  schema: ...}}` on `messages.create()`, or the recommended `client.messages.parse()` which
  validates responses against the schema automatically; plus **strict tool use** (`strict: true`
  on a tool definition with `additionalProperties: false` + `required`) which guarantees
  `tool_use.input` validates exactly. Supported on Claude Opus 5, Sonnet 5, Haiku 4.5 and up.
  Notable limits: no recursive schemas, no numeric `minimum`/`maximum`, **no
  `minLength`/`maxLength`** — the SDKs strip unsupported constraints and validate them
  client-side. New schemas pay a one-time compilation cost, then hit a 24-hour schema cache — so
  keep ONE stable op-schema for the whole platform rather than per-task schema variants [1][2].
- **OpenAI**: `response_format: {type: "json_schema", strict: true}`; the current engine masks
  invalid tokens at decode time so a non-conforming response cannot be produced; plain "JSON mode"
  is considered legacy. Same practical limits (optional fields modeled as union-with-null) [6].
- **Google Gemini**: `responseSchema` with constrained decoding at the token level; Google's own
  guidance is explicit that structural constraint ≠ logical validation and that you should layer
  Zod/Pydantic downstream [8].

**What schema enforcement does NOT give you** — and where the real engineering is:

1. **Semantic validity.** A schema-valid `UPDATE_TITLE` can still be 700px wide, keyword-free, or
   factually wrong. Because providers don't support `minLength`/`maxLength` (and pixel width isn't
   expressible in JSON Schema at all), *every* content constraint must be a code-level validator.
2. **Retry-on-invalid.** Use the Instructor "re-ask" pattern: run code validators
   (pixel width, keyword coverage, no-new-facts, anchor-match) over the parsed output; on failure,
   re-prompt the model **with the specific validation error** appended. Instructor's production
   data: models fix their output on the first retry 95%+ of the time; cap at `max_retries=2` and
   route persistent failures to the escalation tier or drop the op [10].
3. **Refusals/edge cases.** Handle `stop_reason: "refusal"` (Anthropic) and refusal fields
   (OpenAI) as first-class outcomes — on a refusal the output may not match the schema at all, so
   check stop reason before parsing [1][6].

**The operation schema** (extends the SPEC §7 example):

```json
{
  "action": "UPDATE_TITLE | UPDATE_META_DESCRIPTION | UPDATE_H1 | RESTRUCTURE_HEADINGS |
             UPDATE_IMAGE_ALT | ADD_FAQ_BLOCK | INSERT_SECTION | ADD_INTERNAL_LINK |
             UPDATE_SCHEMA | SUGGEST_CONTENT_GAP",
  "targetUrl": "https://site.com/page",
  "targetSelector": "css-or-xpath-or-field-id, for element-scoped ops",
  "oldValue": "exact current value — verified against live page before apply",
  "newValue": "proposed value",
  "reason": "one sentence, references evidence ids",
  "evidence": [{"source": "gsc|serp|competitor|page", "ref": "ctx-block-id", "quote": "…"}],
  "primaryKeyword": "…",
  "model_self_report": 0.9,
  "risk": "LOW | MEDIUM | HIGH"
}
```

`confidence` (the number the decision engine consumes) is deliberately **not** model-emitted — it
is computed downstream (§4); the model's own `model_self_report` is kept only as one weak feature.
Note the SPEC's §14 risk classes map onto `action` almost 1:1 (alt text/meta = LOW auto-apply,
title/H1/links/schema = MEDIUM PR, anything structural = HIGH), so `risk` can be assigned by a
lookup table in code, not trusted from the model.

**Tool-calling vs. output format:** for this pipeline, response-format enforcement
(`messages.parse()` / `response_format`) is the better fit than function calling — there is
exactly one "tool" (emit ops), no tool-choice ambiguity, and parse-mode composes cleanly with the
Batch API on all three providers. Use strict tool calling only if the engine later becomes an
agent that interleaves lookups with generation.

### 3. Guardrails: bounded diffs, not rewrites

The SPEC's hard requirement — *"AI must not blindly rewrite content"* — should be enforced
structurally, not by prompt begging:

- **The schema is the primary guardrail.** The model physically cannot rewrite a page because no
  operation type accepts a page body. `UPDATE_TITLE` can only change a title. Content
  improvements are decomposed into *additive* ops (`INSERT_SECTION`, `ADD_FAQ_BLOCK` with an
  insertion point) plus at most sentence-scoped `REWRITE_SPAN` ops that carry the exact old
  sentence as anchor. This mirrors the code-editing world's finding that anchor-based
  search/replace blocks are the reliable middle ground between whole-file rewrites (uncontrolled)
  and line-number diffs (brittle) — the `oldValue` anchor both scopes the edit and acts as a
  staleness check [11][12].
- **Anchor verification = optimistic locking.** Before apply, the deployment layer re-reads the
  live value (DOM/CMS field/repo file) and requires an exact match with `oldValue`. Mismatch means
  the page changed since the crawl → the op is stale → reject and re-analyze. This single check
  eliminates the classic "AI overwrote a human's fresh edit" incident class.
- **Max-change budgets (defense in depth, all enforced in code):**
  - per-op: content-bearing ops capped by token/character delta (e.g. `REWRITE_SPAN` new/old
    length ratio ≤ 2×; `INSERT_SECTION` ≤ 300 words);
  - per-page-per-cycle: e.g. ≤ 5 ops, ≤ 15% of visible text changed (measured by diff ratio);
  - per-site-per-day: e.g. ≤ 10% of indexed pages touched — this also directly de-risks Google's
    **scaled content abuse** policy, which explicitly targets mass AI page modification without
    editorial oversight; sites publishing at volume without review saw 50–80% traffic losses in
    the March 2026 core update [24][25]. The budget knobs should be product-visible settings.
- **Factual-claim restriction (closed-book rule).** System contract: *every factual claim in a
  generated value must be traceable to the context pack*; the `evidence[]` field forces the model
  to point at its source. A code validator then checks the cheap high-signal cases — any number,
  price, percentage, date, superlative ("#1", "best", "clinically proven") or named entity in
  `newValue` must appear in the pack or the op is rejected/downgraded to review. A judge-model
  pass (§4) covers the rest. Banned-claims lists (health/finance/guarantee language) are
  site-configurable regex/semantic filters.
- **Brand voice constraints** live in the cached brand block (tone, person, reading level,
  terminology do/don't) and are *scored* by the judge rather than assumed. Voice violations
  downgrade confidence rather than hard-fail, except banned-claim hits which hard-fail.
- **Idempotence/loop guard:** hash each applied op; never re-propose an op whose hash was applied
  or rolled back within N days — prevents the optimizer oscillating a title A→B→A across cycles.

### 4. Confidence estimation for generated changes

The SPEC's example (`"confidence": 0.94`) implies the model self-reports. The research is
unambiguous that this doesn't work: verbalized confidence from LLMs — including in judge roles —
is systematically overconfident, clustering in the 80–100% band regardless of actual correctness
[13]. Build confidence as a **computed, calibrated score**:

1. **Deterministic validator score** (dominant term): pixel-width pass, keyword coverage,
   uniqueness vs. site corpus, anchor match, schema validation (for JSON-LD ops, validated with a
   real schema.org/Rich-Results validator, which is fully automatable [29]). Binary gates first;
   what survives gets scored.
2. **Self-consistency agreement:** sample k=3–5 generations for the same op slot and measure
   agreement (exact for enums/links; embedding-similarity clusters for text). Agreement rate is
   an implicit confidence signal with real empirical backing; confidence-weighted variants (CISC)
   cut the sample budget ~40% for the same reliability, and recent work shows even two samples
   plus verbal confidence recovers most of the value — relevant because every extra sample is
   linear cost at 10k-page scale [14][26]. Reserve k≥3 for MEDIUM+ risk ops; k=1 for LOW-risk alt
   text.
3. **Cross-model LLM-as-judge:** a *different, stronger* model (Opus-class judging Haiku/Sonnet
   output) scores rubric dimensions: intent match, truthfulness-to-evidence, voice compliance,
   click-worthiness. Mitigate judge position bias by pairwise comparison with order swap. Judge
   scores are themselves overconfident, so use them as rank/features, not probabilities [13];
   conformal-prediction interval methods exist if you later need statistical coverage guarantees
   on judge scores [15].
4. **Calibration loop (the platform's unfair advantage):** the change-tracking + rollback system
   (SPEC §16–17) produces labeled outcomes (kept/rolled back, CTR delta) for every applied op.
   Fit a per-action-type calibration curve (isotonic/Platt) mapping raw score → empirical
   P(change kept and non-harmful), and recalibrate monthly. This converts an uncalibratable
   guess into a measured quantity — and is the honest answer to "how do you know 0.94 means 94%."

Thresholds then plug into SPEC §14: e.g. auto-apply requires calibrated ≥0.9 **and** risk=LOW;
0.7–0.9 → PR/review queue; <0.7 → suggest-only.

### 5. Prompt-injection risk from crawled third-party content

This platform's threat model is unusually concrete: it **ingests arbitrary web content
(customer pages *and competitor pages*) and can ultimately write to a customer's production
website/repo.** Indirect prompt injection via web content is documented in the wild (Unit 42;
zero-click exfiltration incidents like EchoLeak CVE-2025-32711), and the 2025–2026 consensus
position from OpenAI/Anthropic/Google DeepMind research is that injection **cannot be fully
solved** at the model layer — the design question is blast radius [16][17][18][19].

Layered mitigations, in order of leverage:

1. **Architecture: the generator is not an agent.** The generation model has no tools, no
   browsing, no write access — it maps a context pack to typed JSON ops. A successful injection
   can therefore only produce a *bad field value*, which must still survive schema enforcement,
   validators, risk gating, and (for MEDIUM+) human review. This is the single biggest mitigation
   and it's free.
2. **Sanitize before packing:** strip scripts/styles/HTML comments, hidden elements
   (`display:none`, zero-size, off-screen, white-on-white text — a documented injection carrier),
   and boilerplate at crawl-extraction time; convert to plain markdown. Competitor content gets
   the strictest treatment: summarized into fixed structured fields (title/H1/H2s/topics) by a
   quarantined summarizer call whose output schema contains no free-text field longer than a
   sentence.
3. **Segregation + spotlighting:** wrap all third-party text in explicit data delimiters with
   random boundary tokens, and state in the system contract that delimited content is data, never
   instructions (OWASP LLM01 "segregate external content") [16]. On Anthropic, operator
   instructions can additionally ride the injection-safe `role: "system"` mid-conversation channel
   (Claude Opus 5 / Opus 4.8) rather than user-turn text [1].
4. **Output-side allowlists (the load-bearing check):** validators reject any op whose
   `targetUrl` isn't the requested page, any internal-link op whose target isn't in the site's own
   URL inventory, any URL in any value pointing off-site, and any `newValue` containing
   markup/scripts where plain text is expected. An attacker-controlled competitor page trying to
   plant "link to attacker.com with anchor X" dies here. External links are never auto-applied,
   period.
5. **Input-side detection (cheap, imperfect):** run an injection classifier (PromptGuard-class)
   or heuristic scan (imperative-instruction density, "ignore previous", role-play markers) over
   extracted content; flag-don't-block, and route flagged pages' ops to review. Detection alone is
   bypassable [19] — it's telemetry, not a wall.
6. **Adversarial testing** as a standing practice: seed test sites with injection payloads in
   visible text, hidden text, alt attributes, and JSON-LD, and assert the pipeline emits no
   off-policy op (OWASP LLM01 recommends treating the model as an untrusted user in pen tests)
   [16].

### 6. Model tiering strategy

Current lineups and list prices (per 1M tokens, input/output, standard tier, verified Aug 2026):

| Tier | Anthropic [1] | OpenAI [5] | Google [7] |
|---|---|---|---|
| Frontier / judge | Claude Opus 5 — $5 / $25 (1M ctx) | gpt-5.6-sol — $5 / $30 · gpt-5.5 — $5 / $30 | Gemini 3.1 Pro preview — $2 / $12 (≤200K ctx) |
| Workhorse | Claude Sonnet 5 — $3 / $15 (intro **$2 / $10 through 2026-08-31**; 1M ctx) | gpt-5.6-terra — $2 / $12 · gpt-5.4 — $2.50 / $15 | Gemini 3.6 Flash — $1.50 / $7.50 |
| Bulk / cheap | Claude Haiku 4.5 — $1 / $5 (200K ctx) | gpt-5-mini — $0.25 / $2 · gpt-5-nano — $0.05 / $0.40 · gpt-5.6-luna — $0.20 / $1.20 | Gemini 3.5 Flash-Lite — $0.30 / $2.50 · Gemini 2.5 Flash-Lite — $0.10 / $0.40 |
| Batch discount | 50% (100K reqs or 256 MB/batch, most < 1h, 24h max) [3] | 50% all models [5] | 50% batch/flex [7] |
| Cached input | ~0.1× reads; writes 1.25× (5-min) / 2× (1h) [4] | 0.1× cached input | ~0.1×-class + $1.00/1M-tok/hr cache storage |

(Anthropic Claude Fable 5 at $10/$50 exists above Opus but is not economically justified for any
task in this pipeline.)

**Routing table:**

| Work | Tier | Why |
|---|---|---|
| Technical SEO fixes (canonical, redirects, sitemap, missing dimensions), pixel checks, dedup detection | **Tier 0: deterministic code, no LLM** | Rule-shaped; an LLM adds cost + failure modes. Most of SPEC §6 lives here. |
| Image alt text, meta descriptions at volume, intent classification, query clustering labels | Tier 1 (Haiku 4.5 / gpt-5-mini / Flash-Lite) | High volume, low ambiguity, LOW-risk auto-apply class; validators catch the misses |
| Titles, H1/H2 restructuring, FAQ generation, internal-link anchor text, content-gap summaries, schema generation | Tier 2 (Sonnet 5 / gpt-5.6-terra / 3.6 Flash) | Judgment + voice sensitivity; MEDIUM-risk class |
| LLM-as-judge scoring, content-improvement planning, escalated retries, injection-flagged review | Tier 3 (Opus 5) | Cross-model judging requires a stronger model than the generator; low volume |

**Cascade + batch is the cost story.** Generate cheap → validate in code → judge selectively →
escalate only failures. And because the whole Discover→Optimize cycle is a scheduled nightly job,
route effectively all generation through Batch APIs for the flat 50%. Worked example, 10,000-page
full metadata pass (3K in / 500 out per page = 30M in / 5M out):

- Haiku 4.5 batch: 30M × $0.50 + 5M × $2.50 = **$27.50**
- Sonnet 5 batch: 30M × $1.50 + 5M × $7.50 = **$82.50** (intro pricing: $55)
- Opus 5 judge on the 15% that needs it (1K in / 100 out each): ≈ **$5.60**
- k=3 self-consistency on the ~20% MEDIUM ops roughly doubles that slice's cost — still O($100)
  per full pass, and incremental nightly cycles touch only changed/opportunity pages, typically
  1–5% of the site.

Prompt caching stacks on interactive/escalation traffic; within batch, don't budget on cache hits
(hit timing across concurrently processed batch items isn't guaranteed) — treat cache savings in
batch as upside, not plan [3][4]. Multi-provider abstraction is worth it for negotiation and
fallback, but standardize on ONE op schema and keep provider adapters thin; per-provider schema
dialect differences (e.g. Anthropic's stripped length constraints) live in the adapter.

### 7. Quality evaluation of generated metadata

**Layer 1 — deterministic pre-deploy checks (every op, free):**

- **Pixel-width truncation, not character counts.** Google truncates titles by rendered pixel
  width — historically ~512px at 18px Arial per Screaming Frog's measurement, with current
  guidance clustering at ~580px desktop / ~525–535px observed truncation start; meta descriptions
  ~920px desktop / ~680px mobile (~158 / ~120 chars on average glyph mix) [20][27]. Implement an
  actual text-measurement check (server-side canvas/Pillow with Arial at SERP font sizes) and
  validate both desktop and mobile budgets; character counts are only a fallback heuristic.
- Keyword coverage and placement (primary keyword present, ideally front-loaded), brand-suffix
  pattern compliance, site-wide uniqueness (exact + near-duplicate via embedding similarity),
  no banned words/claims, sentence case/locale rules.
- For JSON-LD ops: schema.org validation + Google rich-result eligibility checks, automatable via
  validator APIs or an embedded validator in the pipeline [29].

**Layer 2 — pre-deploy ranking (candidate selection):** generate 2–3 candidate titles, have the
judge model pick pairwise (with order-swap to control position bias) against a rubric: intent
match, specificity, truthfulness-to-evidence, click-worthiness, voice. This selects the best
candidate but **cannot prove it beats the incumbent** — that requires Layer 3.

**Layer 3 — post-deploy measurement (the real test):**

- **Position-controlled CTR delta is the metric.** Raw CTR is confounded by rank. Fit the site's
  own CTR-vs-position curve from its GSC data (per device × query-intent bucket), then score each
  page as observed CTR ÷ expected CTR at its position, before vs. after the change. Public curves
  vary wildly and date quickly — FirstPageSage's 2026 table reports pos-1 = 39.8% → pos-10 = 1.6%
  [21], while multi-study aggregates put pos-1 nearer 27% [28] and a 200K-keyword 2025 study
  measured pos-1 *falling* 32% YoY (28% → 19%) as AI Overviews rolled out, with AI-Overview SERPs
  cutting top-position CTR by half or more [22]. Conclusion: use global curves only as priors;
  the site-specific fitted curve is the baseline. (This same curve powers the SPEC §9
  "high impressions + position 5–20 + low CTR" opportunity detector.)
- **Cohort A/B tests for template-level changes.** True SEO A/B testing splits *pages* (not
  users) into statistically similar control/variant buckets and evaluates with Bayesian
  counterfactual forecasting — the SearchPilot methodology; their published tests show title
  changes routinely swing traffic double-digit % in either direction, including *negative* results
  for keyword-stuffing variants — which is precisely why measurement + rollback must be built in
  [23][25]. For single high-value pages (no cohort available), fall back to interrupted
  time-series on position-controlled CTR with a holdout of untouched similar pages.
- **Wait windows:** re-crawl/re-index latency plus ranking settling means evaluating a metadata
  change needs ~2–4 weeks of post-index GSC data (GSC reports lag ~2 days); the rollback engine
  (SPEC §17) should gate KEEP/ROLLBACK decisions on "N days since Google re-indexed the change,"
  not N days since deploy.
- Feed every outcome back into the §4 calibration loop — this closes the
  generate→validate→deploy→measure→learn loop the SPEC's final question asks about.

---

## Options compared

**Structured-output enforcement approaches:**

| Option | Guarantee | Cost/latency | Weaknesses | Verdict |
|---|---|---|---|---|
| Prompt-only "return JSON" + parse | None | Cheapest | Breaks at scale; retry storms | Reject |
| Provider constrained decoding (Anthropic `output_config.format` / OpenAI `json_schema strict` / Gemini `responseSchema`) | Syntax + types guaranteed | Free (schema compile cached 24h on Anthropic) | No length/pixel/semantic constraints; refusal paths bypass schema | **Adopt as base** |
| Strict tool/function calling | Same guarantee, agent-composable | Same | Overkill for single-emitter pipeline | Only if engine becomes agentic |
| + Pydantic/Instructor semantic validators with re-ask | Semantics enforced; 95%+ fixed in 1 retry [10] | +1 retry on ~small % of ops | Needs good error messages | **Adopt on top** |
| Outlines/local constrained decoding on self-hosted models | Full grammar control | Infra burden | Loses frontier quality for judgment tasks | Revisit only at extreme scale |

**Confidence estimation approaches:**

| Option | Calibration | Cost | Verdict |
|---|---|---|---|
| Model verbalized confidence | Poor — overconfident 80–100% band [13] | Free | Feature only, never the number |
| Self-consistency k-sample agreement | Decent, task-dependent [14] | k× generation | Use k=3–5 on MEDIUM+ ops; CISC-style weighting to cut k |
| Cross-model LLM judge | Overconfident but discriminative [13] | ~$0.001–0.01/op at Opus batch | Use for ranking + rubric scores |
| Deterministic validators + outcome-calibrated composite | Measurably calibrated over time | Near-free | **Adopt — the platform's rollback data is the calibration set** |

**Model routing (primary stack):** Anthropic-first (Haiku 4.5 bulk / Sonnet 5 workhorse / Opus 5
judge) with an OpenAI (gpt-5-mini / 5.6-terra) or Gemini (Flash-Lite / 3.6 Flash) adapter as
fallback and price lever — capabilities are equivalent for this workload; the deciding factors are
ops maturity of batch + caching + structured outputs, which all three now meet [1][3][5][7].

---

## Recommendation & why

1. **Typed operations, not text** — the schema *is* the "don't rewrite content" guarantee, plus
   `oldValue` anchors verified at apply time (optimistic locking against stale crawls).
2. **Provider-native schema enforcement + code validators + one re-ask** — syntax from the
   provider, semantics (pixel width, keywords, no-new-facts, allowlists) from your code, retries
   carrying the validator error [1][6][8][10].
3. **Small curated context packs (2–8K tokens), cache-ordered** — context rot is real and tokens
   are the COGS; stable site blocks cached, volatile page blocks last [4][9].
4. **Computed, outcome-calibrated confidence** — validators + k-sample agreement + cross-model
   judge, calibrated monthly against keep/rollback labels; never ship the model's own number
   [13][14].
5. **Injection containment by architecture** — no-tool generator, sanitized packs, quarantined
   competitor summaries, output allowlists, never auto-apply external links [16][17][19].
6. **Tier 0 first, then Haiku→Sonnet→Opus cascade, everything through Batch (50%)** — a full 10K-page
   metadata pass is ~$30–$85 in model spend; incremental nightly cycles are dollars [3][5][7].
7. **Measure with position-controlled CTR against the site's own fitted curve, cohort A/B where
   possible, 2–4-week post-index windows** — global CTR tables disagree too much to be the
   baseline in the AI-Overviews era [21][22][23].

This design directly answers the SPEC's feasibility question for §7: metadata-level generation
(titles, metas, alt, schema, FAQ blocks, internal links) is **automatable to auto-apply/PR level
today** with the guardrail stack above; open-ended "content improvement" is **not** — it should
ship as bounded additive ops + human-reviewed suggestions, both for quality and because Google's
scaled-content-abuse enforcement in 2025–2026 explicitly punishes unreviewed at-volume AI page
changes [24].

## Risks & limitations

- **Prompt injection is mitigated, not solved** — all published 2025–2026 vendor research agrees;
  the containment architecture bounds damage but review gates must stay for MEDIUM+ ops [19].
- **Calibration cold start:** until enough keep/rollback outcomes accumulate (~hundreds of ops per
  action type), confidence thresholds are priors, so launch conservative (auto-apply only LOW-risk).
- **Attribution noise:** CTR deltas are confounded by seasonality, SERP-feature changes, and
  AI Overviews rollout (which alone moved pos-1 CTR by double digits in 2025 [22]); single-page
  conclusions are weak — prefer cohorts, treat single-page KEEP/ROLLBACK as low-confidence.
- **Pixel budgets drift:** Google changes SERP fonts/limits without notice (Screaming Frog's own
  figures carry an update disclaimer [20]) — pixel constants must be config, re-measured
  periodically against live SERPs.
- **Pricing volatility:** Sonnet 5 intro pricing ($2/$10) ends 2026-08-31; Gemini 3.1 Pro is
  "preview"; cost model should re-verify quarterly. All figures here are Aug-2026 list prices.
- **Provider schema dialects:** Anthropic strips length constraints, Gemini/OpenAI differ on
  unions/refs — the shared op schema must stay within the intersection, with the rest in code
  validators (which you need anyway).
- **Judge bias:** LLM judges show position/verbosity bias and overconfidence; order-swapping and
  rubric decomposition reduce but don't eliminate it [13][15].

## Sources

1. Anthropic — Models & pricing (Claude Opus 5 / Sonnet 5 / Haiku 4.5; verified via current
   platform docs): https://platform.claude.com/docs/en/about-claude/models/overview
2. Anthropic — Structured outputs (`output_config.format`, strict tool use, schema limits):
   https://platform.claude.com/docs/en/build-with-claude/structured-outputs
3. Anthropic — Batch processing (50% discount, 100K req/256MB, 24h):
   https://platform.claude.com/docs/en/build-with-claude/batch-processing
4. Anthropic — Prompt caching (0.1× reads, 1.25×/2× writes, per-model minimum prefixes):
   https://platform.claude.com/docs/en/build-with-claude/prompt-caching
5. OpenAI — API pricing (gpt-5.6-sol/terra/luna, gpt-5.4/5 families, batch 50%, cached 10%):
   https://developers.openai.com/api/docs/pricing
6. OpenAI — Introducing Structured Outputs in the API:
   https://openai.com/index/introducing-structured-outputs-in-the-api/
7. Google — Gemini API pricing (3.6/3.5 Flash, Flash-Lite, 3.1 Pro preview, batch, caching):
   https://ai.google.dev/gemini-api/docs/pricing
8. Google — Gemini structured output (`responseSchema`, constrained decoding):
   https://ai.google.dev/gemini-api/docs/interactions/structured-output
9. Chroma Research — Context Rot: How Increasing Input Tokens Impacts LLM Performance (18-model
   study): https://research.trychroma.com/context-rot
10. Instructor — Re-ask validation / retry mechanisms (Pydantic validators, error-fed retries):
    https://python.useinstructor.com/concepts/reask_validation/
11. Aider — Edit formats (whole-file vs. search/replace diff benchmarks):
    https://aider.chat/docs/more/edit-formats.html
12. Morph — AI code edit formats guide 2025 (diff vs whole-file vs semantic, "context tax"):
    https://www.morphllm.com/edit-formats
13. arXiv 2508.06225 — Overconfidence in LLM-as-a-Judge: Diagnosis and Confidence-Driven Solution:
    https://arxiv.org/abs/2508.06225
14. ACL 2025 Findings — Confidence Improves Self-Consistency in LLMs (CISC, −40% samples):
    https://aclanthology.org/2025.findings-acl.1030/
15. arXiv 2509.18658 — Analyzing Uncertainty of LLM-as-a-Judge: Interval Evaluations with Conformal
    Prediction: https://arxiv.org/pdf/2509.18658
16. OWASP GenAI Security Project — LLM01:2025 Prompt Injection (mitigation strategies):
    https://genai.owasp.org/llmrisk/llm01-prompt-injection/
17. Palo Alto Unit 42 — Fooling AI Agents: Web-Based Indirect Prompt Injection Observed in the
    Wild: https://unit42.paloaltonetworks.com/ai-agent-prompt-injection/
18. arXiv 2604.27202 — Indirect Prompt Injection in the Wild: An Empirical Study:
    https://arxiv.org/html/2604.27202v1
19. Zylos Research — Indirect Prompt Injection: Attacks, Defenses, and the 2026 State of the Art:
    https://zylos.ai/research/2026-04-12-indirect-prompt-injection-defenses-agents-untrusted-content/
20. Screaming Frog — Page Title & Meta Description by Pixel Width in SERP Snippet (512px title @
    18px Arial, ~920px description):
    https://www.screamingfrog.co.uk/blog/page-title-meta-description-lengths-by-pixel-width/
21. FirstPageSage — Google CTRs by Ranking Position 2026 (pos1 39.8% → pos10 1.6%):
    https://firstpagesage.com/reports/google-click-through-rates-ctrs-by-ranking-position/
22. GrowthSrc — Google Organic CTR 2025, 200K-keyword study (pos-1 −32% YoY; AI Overviews impact):
    https://growthsrc.com/google-organic-ctr-study/
23. SearchPilot — What is SEO split testing (page-bucket methodology, Bayesian analysis):
    https://www.searchpilot.com/resources/blog/what-is-seo-split-testing and
    https://www.searchpilot.com/resources/blog/the-math-behind-searchpilot-how-seo-a/b-testing-actually-works
24. Google Search Central — Guidance on AI-generated content (+ scaled content abuse policy):
    https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
25. SearchPilot — 10 SEO A/B tests with >10% impact (incl. negative title-test results):
    https://www.searchpilot.com/resources/blog/10-seo-ab-tests-with-an-impact-of-over-10-percent
26. OpenReview — Two Samples Are Enough: Verbal Confidence Meets Self-Consistency in Reasoning
    LLMs: https://openreview.net/forum?id=66D3rZrNjV
27. MRS Digital — Meta Length Checker / SERP preview 2026 (580px title guidance; 920/680px
    descriptions): https://mrs.digital/tools/meta-length-checker/
28. theStacc — Organic CTR by Google Position 2026 (multi-study aggregate, pos1 ≈ 27%):
    https://thestacc.com/blog/organic-ctr-by-position/
29. Apify — Schema.org validator / Rich Results checker API (programmatic JSON-LD validation, 17
    rich-result types): https://apify.com/pattonholdings/schema-validator/api/openapi
