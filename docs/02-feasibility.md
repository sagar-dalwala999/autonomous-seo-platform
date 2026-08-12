# Feasibility — How Much SEO Work Can Be Automated Without a Human, and What Makes It Safe?

**Document 02 of 07 · Autonomous SEO Optimization Platform · Planning Package**

Answers SPEC §25.1 ("Can this product actually be automated to the desired level?") and SPEC §26
(the final question). Traces to the requirement IDs in Doc 01 (Requirements Analysis); consistent
with the decisions restated in Doc 03 (Architecture) and Doc 04 (Technology Comparison).

---

## 1. Executive answer

**Yes, the Platform is feasible — with boundaries, and the boundaries are the product.** The honest
split, defended line-by-line in Section 2:

- **Achievable autonomously today (no human in the loop):** the entire analysis side — crawling,
  site modeling, ~70-rule technical SEO detection, keyword discovery, GSC opportunity and decay
  detection, per-change impact measurement — plus roughly **14 fix types** that are mechanical,
  content-neutral, and trivially reversible (missing meta descriptions, missing alt text, broken
  internal links, invalid JSON-LD, sitemap `lastmod` correction, redirect-target link updates, and
  similar). These can run detect → generate → validate → apply → monitor → rollback end-to-end
  unattended. (§2.3 tabulates those 14 fixes plus one non-fix row — IndexNow pings, a notification
  protocol rather than a site change — for 15 numbered rows in total.)
- **Achievable with a human gate (one approval click, batched):** roughly **26 change types** that
  are ranking- or content-sensitive — title and H1 rewrites, heading restructures, new internal
  links, structured-data additions, single-page canonical and redirect fixes, XML sitemap
  regeneration, bounded content additions such as FAQ blocks. The machine does ~95% of the work (detection, generation,
  validation, application, measurement); a human merges a pre-validated pull request. For the
  single narrowest, highest-confidence pattern (exact-anchor internal links), the gate *can* be
  delegated to auto-merge after a site earns a clean track record — but that is a deliberate
  extension beyond FR-11.2, which fixes internal-link changes at MEDIUM (automated PR), so it is
  offered as a client-signed-off option and is off by default (§2.4 row 5).
- **Requires approval permanently (no score can override):** robots.txt edits, noindex changes,
  canonical changes above 10 pages, mass redirects and URL restructuring, page deletion, site-wide
  template edits, hreflang restructuring, server configuration. Not because generation is hard —
  because **verification of intent is impossible from crawl data alone**, and each of these can
  take down a site's search presence in one write (a bad robots.txt halts all Google crawling
  within 12 hours and stays cached up to 24 hours [2]).
- **Should remain manual:** SEO strategy and business priorities, publishing net-new AI pages,
  third-party/affiliate content, review/rating markup values, and manual-action recovery — because
  Google's scaled-content-abuse and site-reputation-abuse policies (March 2024, actively enforced
  through the June 2026 spam update) target exactly these behaviors, and recovery from a spam hit
  takes "a period of months" [3][4][56].

**The architecture that makes this safe, in one paragraph:** every proposed change is scored on two
independent axes — confidence (is it correct?) and risk (what does it cost if wrong?) — and gated
by a decision matrix with a hard deny-list no score can override. The AI is a typed-operation
emitter, not a content writer: it returns schema-enforced JSON operations carrying an `oldValue`
anchor verified against the live page before apply, so it physically cannot rewrite a page.
Deterministic code (AST codemods, CMS field writes) performs every edit; every change passes a
validation pipeline (lint, sandboxed build, preview deploy, SEO assertions) before production;
every change lands in an append-only ledger whose atomic rollback unit is the batch; guardrail
monitoring (days 0–7) auto-rolls-back catastrophes in minutes, and a statistical verdict
(day 14–60, counted from *verified Google recrawl*, judged against untouched control pages) decides
KEEP or ROLLBACK. Per-site change budgets, protected-page rules, and an automation freeze during
Google update rollouts bound the blast radius at all times.

The client's warning against overclaiming is well placed, and this document does not overclaim:
attribution of SEO outcomes is probabilistic, low-traffic pages cannot produce statistically honest
verdicts, prompt injection is mitigated rather than solved, and rollback is not undo (a reverted
page still needs a Google recrawl to recover). Each limit is stated where it binds.

---

## 2. The Automation Matrix (SPEC §26, FR-3.7, FR-11)

### 2.1 How the buckets are enforced — the gating mechanics

The buckets below are not policy prose; each maps to a concrete mechanism:

```
                     Detect (deterministic rulebook, ~70 rules)
                                      |
                     Generate (typed ops; LLM emits values only)
                                      |
        DECIDE: confidence (computed) x risk (formula, floored per type)
                                      |
   +------------------+---------------------+----------------------------+
   | risk < 25, conf  | 25 <= risk <= 60,   | risk > 60  OR  deny-list   |
   | >= 0.85          | conf >= 0.85        | (robots.txt=100, mass      |
   v                  v                     |  redirect=95, delete=95,   |
 AUTO-APPLY         AUTO-PR                 |  mass canonical=90)        |
 (Bucket 1)         human merges            v                            |
   |                (Bucket 2)          RECOMMEND-ONLY                   |
   |                  |                 (an execution state, not a       |
   |                  |                  bucket: Bucket-3 types live     |
   |                  |                  here permanently; escalated     |
   |                  |                  Bucket-2 instances visit)       |
   +------------------+---------------------+                            |
                      v                                                  |
        VALIDATE  (schema -> build -> preview -> SEO assertions)         |
                      v                                                  |
        APPLY     (batched; velocity caps; update-rollout freeze)        |
                      v                                                  |
        MONITOR   guardrails d0-7  --trip--> AUTO-ROLLBACK               |
                      v                                                  |
        MEASURE   verdict d14-60 post-recrawl vs control pages           |
                  KEEP / ROLLBACK / EXTEND / insufficient_data           |
```

**The decision matrix in full (both axes, all three confidence rows).** The diagram above draws
only the confidence ≥ 0.85 row, because that is the row in which autonomy exists at all; the
complete gate is:

| | **risk < 25** (LOW) | **25 ≤ risk ≤ 60** (MEDIUM) | **risk > 60** (HIGH) |
|---|---|---|---|
| **confidence ≥ 0.85** | **AUTO-APPLY** — direct commit / CMS write, still batched + monitored | **AUTO-PR** — human merges | **RECOMMEND-ONLY** — human implements, or approves an engine-drafted PR with a mandatory second reviewer |
| **0.60 ≤ confidence < 0.85** | AUTO-PR — a LOW-risk change the Platform is only moderately sure of never auto-applies | RECOMMEND-ONLY | RECOMMEND-ONLY |
| **confidence < 0.60** | Discard / regenerate (max 2 regenerations, then drop) | Discard | Discard |

Novel change types absent from the base-risk table default to MEDIUM minimum until 50 observations
of that type exist on that site.

**The risk formula, written out.** Risk is deterministic arithmetic, not model opinion:

```
risk_raw = B(type) × M_scope × M_traffic × M_velocity
risk     = clamp( risk_raw × (1 − trust) , tier_floor(type) , 100 )
```

`B(type)` is the base risk (0–100) tabulated per row in §2.3–2.5. The three modifiers:

| M_scope — blast radius (pages the change touches) | value |
|---|---|
| 1 page | 1.0 |
| 2–10 pages | 1.2 |
| 11–100 pages | 1.5 |
| >100 pages, or any single site-wide file (robots.txt, a template, `next.config` redirects) | 2.0 |

| M_traffic — share of the site's last-28-day organic clicks landing on the affected pages | value |
|---|---|
| <0.1% | 0.8 |
| 0.1–1% | 1.0 |
| 1–5% | 1.3 |
| >5% | 1.6 |

| M_velocity — rolling-7-day change pressure, per site | value |
|---|---|
| <2% of indexed pages changed | 1.0 |
| 2–10% changed | 1.2 |
| >10% changed | 1.5 **and** new LOW-tier items queue as MEDIUM (PR) until pressure drops |

`trust` runs 0 to 0.25 per (site × change type): after ≥50 applied changes at ≥95% KEEP rate with
zero guardrail rollbacks it grows +0.05 per further 50 kept changes; any rollback of that type
halves it. Worked examples: missing alt text on one low-traffic page = 5 × 1.0 × 0.8 × 1.0 = **4**
→ LOW → auto-apply if validated. A title change on a top-20 page = 30 × 1.0 × 1.6 = **48** →
MEDIUM → PR (and the protected-page rule bumps it a tier regardless). robots.txt anything → floor
100 → HIGH, always.

- **The clamp is one-sided, exactly as the researched model has it.** `tier_floor(type)` sets the
  band a type can never fall beneath; the upper bound stays 100, so a genuinely high-blast-radius
  instance is always free to escalate. There is deliberately **no per-type ceiling**. The one case
  that would have needed one — sitemap regeneration, B=35 on a single site-wide file, so
  `M_scope` = 2.0 puts `risk_raw` at 70 — is answered by placing the change where its blast radius
  says it belongs (MEDIUM, human-merged: §2.4 row 26), not by capping the arithmetic that flagged
  it.
- **Bucket membership is per-type policy, enforced as those tier floors — not raw arithmetic.** The
  formula moves an individual change only *upward* from its floor: a risky instance escalates (a
  protected page bumps one tier; velocity pressure queues LOW work as MEDIUM), and earned trust
  relaxes it back toward the floor — but no score moves a type *below* its floor, and no score moves
  a type onto or off the deny-list. The floors are what make the buckets real: eight Bucket-2 types
  with B<25 would compute LOW on a typical single low-traffic page but carry a MEDIUM floor, because
  they are content-bearing or visible-when-wrong (§2.4). Deny-list types floor at HIGH regardless of
  trust.
- **Confidence** is computed — **0.55 × soft-validator score + 0.25 × historical human acceptance
  rate + 0.20 × k-sample self-consistency** — and the model's self-reported number is **not a term
  in it at all**: it is recorded for audit and acts only as a regeneration flag (self-report < 0.8 ⇒
  regenerate or downgrade), because verbalized LLM confidence is systematically overconfident [26].
  The **k-sample self-consistency check** (generate the same operation k independent times at
  non-zero temperature and measure how far the samples agree — a proxy for how load-bearing the
  model's guess is) is therefore a weighted term in its own right; the cross-model judge (§3.3)
  enters through the soft-validator score.
- **Budgets bound everything:** auto-apply ≤ max(20, 2% of indexed pages) changes/site/day; one
  batch ≤ 50 pages; all auto-apply frozen during a confirmed Google update rollout; any page in the
  site's top-20 by clicks is "protected" and bumps one tier minimum. The 2%/day figure is a **burst
  ceiling, not a sustainable rate**: sustained at 2%/day a site changes 14% of its pages per rolling
  7 days, above the >10% velocity trip point, at which `M_velocity` = 1.5 and every new LOW item
  queues as a PR — i.e. the governor throttles the Platform out of auto-apply by design. Sustained
  unattended operation therefore runs at **≤1.4%/day** (just under the trip point) and typically
  nearer **0.3%/day**, the rate that keeps `M_velocity` at 1.0. §5 recomputes throughput on that
  basis.
- **Earned trust moves types rightward-to-leftward slowly and reversibly:** ≥50 applied changes of
  a type with ≥95% KEEP rate earns a risk discount (capped); a single rollback halves it.

### 2.2 Crosswalk — every SPEC §2 activity, placed

| SPEC §2 activity | Bucket | Placement logic |
|---|---|---|
| Detect technical SEO issues | **100% automatable** | Deterministic rulebook at industry-tool parity (Screaming Frog publishes exact thresholds for ~130 issues [1]); AI never decides issue-hood |
| Fix technical SEO issues | Split by fix type | See 2.3–2.5 — the safety class attaches to the *fix*, not the finding |
| Keyword research (discovery + prioritization) | **100% automatable** | GSC + keyword APIs + opportunity scoring are a pure read-only data pipeline on documented quotas (§3.7); bounded by the ~47% of clicks GSC hides behind anonymized queries [54][64], not by safety; which keywords *matter to the business* stays manual (Bucket 4) |
| Competitor analysis | **Mostly** | Analysis is fully automatable and priced at ≈$0.02–0.05/keyword (§3.8); competitor-driven content actions never auto-apply — five gates, then PR — because competitor pages are attacker-controlled input and volume publishing is a policy line [3] |
| Title optimization | **Mostly** (auto-PR) | Ranking + CTR surface; Google already rewrites 61.6%→76% of titles [12][13], so effect is real but bounded — PR lane |
| Meta descriptions | **100%** fill-missing · **Mostly** rewrite | Filling a missing description is additive with no ranking downside path; rewriting an existing one is opinion — PR |
| Headings (H1/H2 structure) | **Mostly** | Content-adjacent; SearchPilot runs heading changes as formal A/B tests because outcomes are genuinely uncertain [21] |
| Content gaps | Detect **100%** · draft **Requires approval** · publish net-new **Manual** | Drafting into a PR is safe; autonomous mass-publishing is the definition of scaled content abuse [3] |
| Internal links | **Mostly** (auto-PR); the T1 pattern reaches full automation only under the opt-in auto-merge exception (§2.4 row 5), which is off by default · retargeting broken links **100%** | Strongest "mostly automatable" candidate: deterministic inputs, surgical reversible edits, experimentally proven impact (+7% in controlled tests [32]) |
| Image optimization | **100%** alt/dimensions/lossless · **Mostly** format conversion/lossy | Lossless is bit-identical rendering; format conversion needs `<picture>` fallback plumbing |
| Structured data | **100%** fix-invalid · **Mostly** add/re-type · review/rating values **Never** | Fixing syntax restores what the site declared; wrong markup at scale is a manual-action category [3] |
| GSC monitoring | **100% automatable** | Nightly warehoused sync; fully API-driven [9] |
| Rank monitoring | **100%** within GSC bounds | GSC position data free; third-party SERP tracking is an optional paid add-on (Doc 05) |
| Finding pages losing traffic (decay) | **100% automatable** | Decay detector reproduces the SPEC's worked example (position 4→13, clicks 10,000→4,500 ⇒ investigate) |
| Updating old content | **Requires approval** | B=40, highest policy sensitivity — always a human-merged PR, velocity-capped [3] |
| Checking indexing | **100%**, quota-sampled | URL Inspection API is hard-capped at 2,000/day/property [9] — changed URLs + rotating sample, never full sweeps |
| Implementing changes on the website | Split by action type | The whole point of the matrix — see 2.3–2.6 |
| Monitoring whether changes improved or damaged SEO | **100%**, with honesty limits | Guardrails + counterfactual verdicts; pages under ~10 clicks/day get cohort-level verdicts or `insufficient_data`, never manufactured certainty |

### 2.3 Bucket 1 — 100% automatable (auto-apply; 14 fix types + 1 protocol action + all analysis)

Qualifying test: mechanical, content-neutral or purely additive, trivially verifiable, trivially
reversible. B(type) is the base-risk score (0–100) from the risk model. Placement here is per-type
policy (§2.1): every row's tier band is LOW, with per-instance escalation to the PR lane on
protected pages or under velocity pressure. The table has 15 numbered rows but **14 fix types**:
row 15 (IndexNow pings) changes nothing on the site — it notifies non-Google engines that a change
already applied — so it is counted as a protocol action, which is why the headline elsewhere in
this package reads "~14 fix types".

**Sitemaps split across two buckets, and the split is the honest reading of the blast radius.**
Re-*submitting* a sitemap the Platform has verified byte-identical to the live file is LOW — nothing
on the site changes and the call is a ping. *Regenerating or replacing* the file's contents is not:
it silently redefines the discovery set, so it is a MEDIUM, human-merged change (§2.4 row 26),
escalating to HIGH on any net removal of more than 5% of indexable URLs. The LOW half is an
extension to the client's fixed LOW list in SPEC §14, so it ships **off by default** and runs
through the MEDIUM gated path until the client signs it off.

| # | Action | B | Why it is safe (evidence) | Gate that still applies |
|---|---|---|---|---|
| 1 | Add missing meta description | 10 | Google substitutes its own snippet when absent; worst case is a rewritten snippet | Pixel-width + uniqueness + no-new-facts validators; batch monitored |
| 2 | De-duplicate duplicate metadata | 10 | Restores correctness; SPEC §14 names it LOW | String-diff validated |
| 3 | Add alt text where the attribute is missing | 5 | Invisible to layout; accessibility-positive; never overwrites intentional `alt=""` | ≤100 chars, no keyword lists (Google's own image guidance) |
| 4 | Fix broken internal link where target exists | 10 | Deterministic graph repair, verified by recrawl | Target must 200; ambiguous targets escalate to PR |
| 5 | Update internal links pointing at redirects → final URL | 10 | Content-neutral URL swap; experimentally positive [32] | Redirect terminus must be stable across 2 probes |
| 6 | Repair malformed hrefs / localhost links | 5 | Mechanical [1] | Round-trip parse check |
| 7 | Fix invalid JSON-LD (syntax only, no semantic additions) | 10 | Restores what the site already declared; SPEC §14 LOW | Schema parse + vocabulary check |
| 8 | Add self-referencing canonical where none exists | 10 | Additive; matches Google's recommendation | Only when no conflicting canonical signal exists |
| 9 | Normalize canonical annotations (relative→absolute, strip fragments) | 10 | Syntax-only [1] | Cluster-consistency check first |
| 10 | Correct `lastmod` to true content-modification dates | 10 | Restores the only sitemap field Google actually uses ("if it's consistently and verifiably accurate") [15] | Faking freshness is banned by validator — dates must map to real content changes; the URL-set diff must be empty, so any change to *which* URLs the sitemap lists routes to §2.4 row 26 |
| 11 | Add image width/height from measured intrinsic dimensions | 5 | Mechanical; CLS-positive | Measured, never guessed |
| 12 | Lossless image recompression | 5 | Bit-identical rendering | Byte-compare of decoded output |
| 13 | Remove internal `rel=nofollow` on ordinary editorial links | 10 | Attribute-only edit | Excludes sponsored/UGC contexts |
| 14 | Hreflang syntax normalization (`en_UK`→`en-GB`, absolute URLs) | 10 | Syntax-only; does not alter cluster semantics | Cluster restructuring stays in Bucket 3 |
| 15 | IndexNow pings on applied changes (*protocol action, not a site fix*) | 5 | Informational protocol (reaches Bing, Yandex, Naver, Seznam.cz, Yep and Amazon — Google is not a participant [16]); modifies nothing on the customer's site | None needed |

Everything analysis-side (crawl, detect, keyword intelligence, GSC/decay monitoring, impact
measurement) also lives here: it reads, never writes, so its automation ceiling is 100% by
construction — bounded only by API quotas, not by safety.

### 2.4 Bucket 2 — mostly automatable (automated PR, human merges; ~26 change types)

Qualifying test: correct well over 90% of the time, but ranking-sensitive, content-bearing, or
visible — a wrong one is embarrassing or costly enough that a human must stay the merge authority
until trust is earned. The machine does everything else: detection, generation, k-sample
self-consistency, cross-model judging, full validation, preview deploy, and post-merge measurement.
Every type in this bucket carries a **MEDIUM tier floor** (§2.1): the eight rows whose base B sits
below 25 — meta-description rewrite (15), anchor-text change (20), net-new JSON-LD (20), schema
re-type (20), image format conversion (20), lossy recompression (20), breadcrumb/Organization
schema rollout (20), `og:`/social-tag completion (15) — never auto-apply even though the raw
formula on a single low-traffic page would compute LOW, because they fail the content-neutrality
test above. Row 16's "Never LOW regardless of confidence" is the same floor stated at its
strongest; the arithmetic still operates within the band, and high-traffic instances of the B=45
rows (10, 11, 13, 19, 21) escalate into the recommend-only execution state for that instance
without joining the Bucket-3 deny-list (§2.5).

| # | Action | B | Why gated (evidence) | Gate mechanism |
|---|---|---|---|---|
| 1 | Title rewrite | 30 | Direct ranking + CTR surface; Google rewrites 61.6% (n=80,959) to 76% of titles, so even "improvements" may never display [12][13] | Auto-PR; SERP display check at day 3; verdict at 21–28 d |
| 2 | H1 change | 30 | Content-adjacent; genuinely uncertain outcomes — vendors A/B test it [21] | Auto-PR |
| 3 | Heading-structure restructure (H2/H3 hierarchy) | 30 | Alters document outline users see | Auto-PR |
| 4 | Meta-description rewrite (existing one replaced) | 15 | Opinion, not correctness; CTR-only surface | Auto-PR; CTR verdict at 21 d |
| 5 | Insert contextual internal links (≤3/page) | 25 | Link-graph + UX effects; at scale can resemble link schemes [3] | Tiered: T1 (exact anchor already in text, ≥2 channels agree, all caps pass) auto-PR; T2 one-click; anchors only from text already on the page; inbound cap ~40 links/target per the 23M-link correlation study [31]. **T1 auto-merge after 30 days of clean batches is an option, not a default** — see the note below |
| 6 | Anchor-text change on existing links | 20 | Visible copy edit; experimentally positive when contextual [21] | Auto-PR; per-target anchor-variation ledger (no string reused >2–3× — anchor variety is the strongest single correlation in the 23M-link study [31]) |
| 7 | Add links to orphan pages | 25 | Placement/anchor is editorial | Auto-PR |
| 8 | Add net-new JSON-LD block | 20 | Wrong/spammy structured data is a manual-action category [3] | Auto-PR; only marks up visible content; self-built validator (see §3.5) |
| 9 | Re-type incorrect schema | 20 | Type choice needs page-intent judgment | Auto-PR |
| 10 | Single-page canonical change (conflict resolution) | 45 | Wrong canonical silently de-indexes; effect visible only after recrawl | Auto-PR; URL Inspection verification post-merge |
| 11 | Canonical chain collapse (A→B→C ⇒ A→C) | 45 | Same class | Auto-PR |
| 12 | 302→301 conversion | 30 | Must verify the move is truly permanent — intent question | Auto-PR |
| 13 | Single-URL redirect creation for a dead page | 45 | Signal transfer is slow; redirects should persist ≥1 year [5] | Auto-PR; one URL per change |
| 14 | Image format conversion (WebP/AVIF) | 20 | Needs `<picture>`/fallback plumbing; Google's supported-format list bounds it | Auto-PR; rendered-diff check |
| 15 | Lossy image recompression | 20 | Visual quality judgment | Auto-PR with visual-diff artifact attached |
| 16 | Content update / FAQ block addition (bounded, additive) | 40 | Highest policy sensitivity — scaled content abuse targets at-volume AI content changes [3][55]; quality regression risk | **Never LOW regardless of confidence**; PR with evidence-cited draft; per-op ≤300 words; ≤15% of page text per cycle; velocity-capped |
| 17 | Content-gap section drafted from competitor analysis | 40 | Competitor pages are untrusted input (prompt-injection carrier); genuine-opportunity judgment needed | Five gates (intent, demand, consensus, relevance, cannibalization) then PR; never auto-applied |
| 18 | Sentence-scoped rewrite (`REWRITE_SPAN` with exact old-sentence anchor) | 40 | Content edit by definition | PR; length-ratio ≤2× validator |
| 19 | Duplicate-content canonical consolidation (≤10 pages per batch) | 45 | Same silent-de-index mechanism as rows 10–11, applied to a cluster: the "duplicates" stop being indexed on their own terms, and Google overrides 30–40% of declared canonicals anyway when its ~40 other signals disagree [14] | Auto-PR; canonical-cluster-first evaluation before the diff; **hard-blocked above 10 pages** — that instance is Bucket 3 row 3, not an escalation; URL Inspection verification of the cluster head post-merge |
| 20 | Breadcrumb / Organization schema rollout, per template | 20 | Net-new markup, and wrong or over-claiming structured data is a manual-action category [3]; a template rollout is a site-wide-scope change (`M_scope` = 2.0), so `risk_raw` lands at 40 — MEDIUM even though base B is LOW-band | Auto-PR, **one template per PR**; marks up only content already visible on the rendered page; self-built JSON-LD + schema.org validation (§3.5); rendered-diff on 3 sampled instances of the template |
| 21 | Redirect-map entry for content that moved (one source URL → one target) | 45 | Signal transfer through a redirect is slow and Google asks that redirects persist ≥1 year on moves [5]; a wrong target silently sends equity and users to the wrong page | Auto-PR, one URL per entry; target must 200 across 2 probes; **any batch that would exceed the mass-redirect threshold routes to Bucket 3 row 4** |
| 22 | `og:` / social-tag completion | 15 | No Google ranking surface, but it is visible copy the moment anyone shares the page, and it is generated text — it fails the content-neutrality test that defines Bucket 1 | Auto-PR; no-new-facts validator; values must derive from the page's own title/description/first image |
| 23 | Soft-404 content repair proposal | 40 | The fix is a content edit, and the trigger is Google's own soft-404 determination — a known false-positive class (thin-but-legitimate pages, out-of-stock products) that a crawler cannot adjudicate | Auto-PR with the URL Inspection verdict attached as evidence; per-op ≤300 words; never deletes or redirects the page (that is Bucket 3) |
| 24 | Thin-page content brief | 40 | Content-class by definition, and at volume it is precisely the pattern scaled-content-abuse enforcement targets [3][55] | **Never LOW regardless of confidence**; ships as a brief plus an evidence-cited draft in a PR, never an applied edit; velocity-capped with row 16 |
| 25 | Heading-keyword alignment (existing headings re-worded to the page's target query) | 30 | Same class as rows 2–3 — it edits copy users read, and heading outcomes are uncertain enough that vendors A/B test them [21] | Auto-PR; wording drawn from the page's own body text and GSC queries it already earns impressions for; length-ratio ≤2× validator |
| 26 | XML sitemap regeneration from the canonical indexable set (the file's contents change) | 35 | Replacing the contents of a site-wide file silently redefines what Google is invited to discover. The failure is bounded — Google ignores `priority`/`changefreq` and treats the file as advisory [15], so a wrong sitemap misleads discovery rather than de-indexing anything — but it is invisible on every page, which is exactly the class a human should merge | Auto-PR (MEDIUM), diffed against the crawl's canonical indexable set before submit; **any net removal of >5% of indexable URLs escalates the instance to HIGH** (recommend-only, human executes). Re-submitting a verified byte-identical file is the LOW protocol action in §2.3 |

**The one auto-merge exception, and why it needs a client decision.** Row 5's T1 pattern is the
strongest candidate in the whole matrix for removing the human: the anchor is a phrase already
present verbatim in the source paragraph, at least two independent candidate channels must agree,
and the edit is a surgical, reversible attribute-level insertion. The precision evidence is
Wikipedia's add-a-link recommendation model, whose published per-wiki tables report **75–89%
precision at 30–63% recall at threshold 0.5, rising to 88–99% precision at threshold 0.8, where
recall falls to 14–43%** [34]. Two honesty notes the client should have in front of them: (a) those
are the model's published precision/recall curves under default XGBoost parameters, not a
same-conditions production guarantee — and reaching the 88–99% band means **discarding 57–86% of
candidate links**, which is a trade the Platform deliberately makes (buy precision with recall,
because a missed link costs a few percent of unrealized uplift while a wrong one is visible in the
page copy); and (b) auto-merging T1 is a **deviation from FR-11.2**, which fixes internal-link
changes at MEDIUM = automated PR. It therefore ships **off by default**, is enabled per site only
on explicit client sign-off, requires 30 consecutive days of clean merged batches on that site, and
reverts to PR on the first rollback of the type.

The economics of this bucket are what make the Platform viable: a full 10,000-page metadata pass
costs roughly **$27.50–$82.50 in model spend for generation alone**, and **$33–$88 all-in** once
selective Opus-class judging is counted — modelled at 3,000 input / 500 output tokens per page and
batch rates (all three major providers discount batch 50% [29]). Nightly incremental cycles touch
only the 1–5% of pages that changed or show opportunity.

### 2.5 Bucket 3 — requires approval, permanently (deny-list; engine drafts, human decides)

Qualifying test: catastrophic blast radius or irreversibility; intent cannot be verified from crawl
data. These carry risk floors no confidence score, trust level, or configuration can lower:
**SPEC §14's HIGH list (rows 1, 3, 4, 5) plus six extensions this analysis adds on blast-radius
grounds** (rows 2, 6, 7, 8, 9, 10 — see the note under the table). The Platform still does real
work here — detects, diffs, drafts the exact change, explains it — but a human executes or approves
with a mandatory second reviewer.

**"Bucket 3" and "RECOMMEND-ONLY" are not synonyms.** RECOMMEND-ONLY is an *execution state* a
change can be in; Bucket 3 is the set of change *types* that can never be in any other one. A
high-traffic instance of a Bucket-2 type (say a canonical change on a top-20 page) is routed to
RECOMMEND-ONLY for that instance and returns to the PR lane on the next, ordinary-traffic instance.
It never joins the deny-list. The claim that Bucket 3 "will never move left" is a claim about the
ten types below, not about everything that passes through the same execution state.

| # | Action | B | Worst credible outcome (evidence) |
|---|---|---|---|
| 1 | robots.txt edit (any) | 100 | One bad line blocks the whole site; Google caches robots.txt up to 24 h and a 5xx robots.txt halts *all* crawling within 12 h — even an instant rollback leaves the bad file live up to a day [2] |
| 2 | noindex insertion or removal | 90 † | Page-scoped de-indexing (insertion) or index flooding (removal); silent until recrawl |
| 3 | Canonical changes >10 pages | 90 | Consolidates ranking signals to wrong URLs; de-indexes the "duplicates"; Google already overrides 30–40% of declared canonicals when signals conflict [14] |
| 4 | Mass redirects / URL restructuring | 95 | Site-move-class event: heaviest ranking fluctuation for 2–4 weeks, stabilization 4–6 weeks same-domain and 2–3+ months cross-domain; redirects must persist ≥1 year [5] |
| 5 | Page deletion (404/410) | 95 | Irreversible traffic loss until reindexed from scratch |
| 6 | Site-wide template edits (nav/footer/header) | 80 † | Every page's internal link graph changes at once (blast-radius multiplier 2.0); hydration/render breakage on JS frameworks |
| 7 | hreflang cluster restructuring | 70 † | Wrong pairs silently misroute entire countries; bidirectional-confirmation requirement means errors cascade |
| 8 | Host-level redirect policy (HTTP→HTTPS, www resolution) | 90 † | Server-config change with site-wide blast radius |
| 9 | Server-config / framework-config changes (.htaccess, next.config redirects/headers, middleware) | 90 † | Can 500 the whole site; interacts with robots and redirect handling |
| 10 | Navigation/architecture changes (crawl-depth fixes, link pruning) | 80 † | Structural; equity redistribution across the whole site |

**† — these six floors are the Platform's, not the client's.** SPEC §14's HIGH list names exactly
five items: robots.txt changes, large-scale canonical changes, mass redirects, URL restructuring,
and page deletion — rows 1, 3, 4 and 5 above. Rows 2, 6, 7, 8, 9 and 10 are extensions this
analysis adds, and the client should see the split rather than infer that its own list was longer
than it is. Of the six, four (rows 7–10) match the Platform's own detection-lane classification,
which independently places hreflang cluster restructuring, host-level redirect policy, server/CDN
config and navigation/architecture changes in the never-auto-deploy class. **Two are deliberate
overrides of that same analysis**, and are worth stating plainly:

- **Row 2, the *removal* half.** Adding a noindex is HIGH in every classification; *removing* one is
  classified MEDIUM (automated PR) in the detection lane, on the reasoning that removal is
  restorative. This document overrides that to HIGH because removal is the one direction whose
  failure mode is not recoverable by reverting: a noindex is very often deliberate (staging
  sections, thin faceted pages, legally restricted pages, paginated duplicates), the Platform cannot
  verify that intent from crawl data, and un-indexing something Google has already crawled and
  indexed at scale is a slow, partial process. Insertion and removal are kept on the same floor so
  the deny-list has no direction-dependent seam to argue about.
- **Row 6, site-wide template edits.** The detection lane classifies "sitewide template edits of any
  kind" as MEDIUM/auto-PR, which is defensible on a git channel where a preview deploy exists. This
  document overrides it to HIGH on blast radius: `M_scope` = 2.0 by definition (one file, every
  page), and on JS frameworks a template edit is also a hydration/render risk that SEO assertions on
  a preview only partially cover. The override follows §4 principle 2 — when the evidence disagrees,
  take the looser bound, because the Platform triggers actions rather than report rows.

"Requires approval" here is a **permanent design state, not a maturity milestone** — the honest
answer to SPEC §26 is that these ten types will never move left, because the failure cost
(weeks-to-months of recovery [4][5]) dwarfs any labor saved on an approval click.

### 2.6 Bucket 4 — should remain manual (the Platform informs; humans own)

| # | Activity | Why it must stay human |
|---|---|---|
| 1 | SEO strategy: target markets, keyword priorities, money pages | Business judgment; these are *inputs* to the Platform's scoring, not outputs |
| 2 | Brand voice, banned-claims lists, legal/YMYL constraints | Configuration the AI is validated against, not something it may set |
| 3 | Publishing net-new AI-generated pages | Autonomous mass-publishing of AI pages is the definition of scaled content abuse; enforcement is active (Aug 2025, June 2026 spam updates) and recovery takes months [3][4]. The Platform drafts; a human reviews, edits, takes ownership, publishes |
| 4 | Third-party / affiliate / sponsored sections | Site-reputation-abuse policy applies *regardless of first-party oversight* since Nov 2024 [56] — the Platform refuses this category entirely |
| 5 | Review/rating structured-data values | Fabricating them is a policy violation; never generated |
| 6 | Manual-action response and reconsideration requests | No public API even to detect manual actions (an operational gap: UI/email monitoring); months-scale stakes; human-authored narrative required |
| 7 | Domain migrations and information-architecture redesigns | Site-move class [5]; the Platform can plan and monitor, never execute |
| 8 | 5xx / infrastructure remediation | Out of SEO scope; alert-only |

---

## 3. Feasibility per subsystem

### 3.0 The binding external constraints (verified, load-bearing)

These are facts about the outside world the architecture cannot change — every verdict below is
conditioned on them.

| Constraint | Number | Design consequence |
|---|---|---|
| Google Rich Results Test has **no public API**; predecessor deprecated Dec 2020, never replaced; Google's own schemarama archived Oct 2025 [37][38] | — | Structured-data validation must be self-built (JSON-LD parse + schema.org vocabulary + maintained Google feature rule-pack) |
| URL Inspection API quota | **2,000/day + 600/min per property** [9] | Index verification is a budgeted sampling layer, never a full sweep (100k pages = a 50-day sweep); changed URLs first |
| GSC data lag | **2–3 days** (grew from 1 in 2025); incident delays 5–7 d [10] | Fresh-data guardrails use `dataState=all`/hourly; verdicts wait for final data |
| GSC retention / export ceiling | **16 months°; ~50k rows/day/site/search-type°** [11] | Warehouse every tenant's GSC data from day one — YoY controls need owned history; because neither figure is published, the pipeline detects row truncation empirically rather than trusting the constant |
| Google recrawl latency | "a few days to a few weeks" (recrawl request); indexing "a day or so… much longer"; change visibility "a few hours" to "several months" [6][7][8] | Evaluation clock starts at **verified recrawl**, not deploy; per-site latency measured in POC #8 |
| No push channel to Google | Indexing API restricted to JobPosting/BroadcastEvent, 200/day [17]; IndexNow excludes Google [16] | Freshness signaling = accurate sitemap `lastmod` only [15]; latency is bought, not commanded |
| Yoast REST surface is **read-only** [44] | — | WordPress adapter requires a shipped companion plugin (~50 lines) registering SEO meta with `show_in_rest` — mandatory, not optional |
| Shopify theme writes gated | `write_themes` + protected-scope exemption (SEO is a named qualifying category, ~2-week review) [48]; theme library capped at 20 (100 on Plus) [47] | MVP Shopify design avoids theme writes: first-class SEO title/description fields plus `global.title_tag`/`description_tag` metafields, `urlRedirectCreate`, and an app-embed block for JSON-LD together cover an estimated ~90% of the Platform's Shopify actions (a design estimate over the §2.3–2.4 action list, not a measured figure); staging themes need janitor logic |
| Client-side JS injection has **no detectable SEO effect** for internal links (controlled test) and server-side HTML is Google's stated preference [33][50] | — | All edits are server-side (repo, CMS field, or edge worker); the JS-snippet shortcut used by some tools is rejected |
| Title rewriting by Google | 61.6% (2021, n=80,959) → 76% (Q1 2025) [12][13] | Title-change verdicts must check what Google actually displays, or the Platform rolls back changes Google never showed |
| GSC anonymized queries | ~47% of click volume hidden [54] | Opportunity scoring works on the visible distribution; stated in reporting |

**° — community-measured, not a published Google limit.** Google's own documentation states only
that the Search Analytics API returns "top rows, not all rows" and does not publish the cut-off; the
~50,000 rows/day/site/search-type figure and the 16-month retention window are widely reported by
third parties and carried here as planning estimates, with empirical truncation detection designed
around them (Doc 05 §2.1). The quotas Google *does* publish — Search Analytics 1,200 QPM and URL
Inspection 2,000/day + 600/min per property [9] — carry no marker.

**The verdict vocabulary, defined once.** Per the engagement scope, POCs are *planned and
specified* in Doc 07 rather than executed in this phase (Doc 01 §8), so no verdict below means
"this team ran it and it worked." Read them as:

- **PROVEN** — every mechanism the verdict depends on is either a documented vendor capability
  (an API that exists, with its published limits) or a published third-party result, and no step in
  the chain rests on an unvalidated assumption. It is a claim about the *evidence*, not about a run
  on this engagement, and each one names the POC that must confirm it on customer sites.
- **FEASIBLE-WITH-CONSTRAINTS** — the capability is buildable and the evidence supports it, but a
  named external limit (a quota, a missing API, a platform gap, a policy) permanently bounds how far
  it goes. The constraint is stated in-line and carried into the product's own claims.
- **Requires approval / Manual** (§2.5–2.6) — not a feasibility verdict at all; a deliberate policy
  ceiling.

Gating POCs, per Doc 07: §3.1 → POC #1 (crawl); §3.2 → POC #2 (analyze/detect); §3.3 → POC #3
(generate optimization); §3.4 → POC #4 (modify a Next.js repo) and POC #6 (GitHub PR pipeline);
§3.5 → POC #5 (build + validate); §3.6 → POC #8 (measure impact); §3.7 → POC #7 (read GSC). §3.8
has no dedicated POC — it rides POC #2 and POC #3 and is called out as such in-section.

### 3.1 Crawl + understand — verdict: **PROVEN** (pending POC #1)

Every field SPEC §4–5 demands (title, metas, headings, links, images, structured data, directives,
content) is extractable from HTML; a browser is needed only when the HTML is a JS shell. The
static-first hybrid (HTTP crawl by default, Playwright escalation decided per-template by a learned
rendering-type predictor) is ~10× cheaper than browser-crawling everything — a ratio derived
directly from the published platform benchmark of ~3,000 pages per compute unit static vs ~300
rendered [53], not an independent measurement. Site understanding
(PageRank/importance, orphans, depth, cannibalization candidates, related pages) computes
in-process over the crawl graph in seconds at 100k-page scale and lands as columns — no graph
database required at MVP. Embedding the corpus for semantic similarity costs ~$0.30 per 10k pages
(`text-embedding-3-small` at $0.02 per million tokens, halved again in the Batch API [61]).
Two real constraints, both engineered around: React/Next sites (the SPEC's primary target) demand
rendered-DOM capture, since meta robots, canonicals, JSON-LD, and links are all JS-mutable — both
raw and rendered views are stored and diffed; and customer-supplied URLs are attacker-controlled
fetch targets, so crawl workers are egress-isolated with post-DNS IP validation — the defense
against **server-side request forgery (SSRF)**, in which a customer-supplied URL is used to make the
Platform's own workers fetch a private-network or cloud-metadata endpoint on the attacker's behalf.

### 3.2 Detect — verdict: **PROVEN** (pending POC #2)

Detection reaches industry-tool parity with a deterministic, versioned rulebook (~70 rules across
indexing, HTTP, on-page, links, images, structured data) computed from crawl data — the same model
as Screaming Frog's published per-issue thresholds [1]. AI never decides whether something is an
issue; it only generates fix content downstream, which is what keeps detection explainable
(NFR-3) and its output auditable. The two structural caveats:

1. **The biggest false-positive engine is Google itself.** Google rewrites most titles [12][13],
   overrides 30–40% of canonical declarations [14], ignores sitemap `priority`/`changefreq` [15],
   and treats 404 vs 410 near-identically. Every rule therefore carries an authored
   false-positive-trap list, and canonical-cluster-first evaluation removes the largest FP class
   (duplicate metadata across parameter variants) before any fix is queued.
2. **Ground-truth index state is quota-starved** (2,000 inspections/day/property [9]) — so
   Google-side verification is a prioritized sampling layer: changed URLs, conflict pages, and a
   rotating stratified sample. The Platform never promises per-page index verification on
   100k-page sites, because the quota makes that claim dishonest.

### 3.3 Generate (AI) — verdict: **FEASIBLE-WITH-CONSTRAINTS** (pending POC #3; evidence is strong for typed ops, thin for open-ended content)

The SPEC's core ask — reliable structured AI output — is largely solved at the syntax level:
all three major providers ship native constrained decoding (Anthropic `output_config.format`,
OpenAI `json_schema strict`, Gemini `responseSchema`) that makes non-conforming output
unproducible [22][23][24]. The real engineering is semantic: length/pixel-width, keyword coverage,
and no-new-facts are not expressible in JSON Schema, so every content constraint is a code
validator with one error-carrying retry (the re-ask pattern fixes ~95% of failures on the first
retry [25]). Three constraints bind:

- **Confidence must be computed, not asked for.** Verbalized LLM confidence clusters in the
  80–100% band regardless of correctness [26]; the Platform records the model's number but gates on
  validators + k-sample agreement + a cross-model judge, calibrated monthly against its own
  KEEP/ROLLBACK outcomes — the honest answer to "how do you know 0.94 means 94%."
- **Prompt injection is unsolved industry-wide** [27][28]. The Platform ingests arbitrary web
  content (including competitor pages) and can write to production — so containment is
  architectural: the generator has no tools and no write access; third-party text is sanitized and
  quarantine-summarized; output allowlists reject any URL not in the site's own inventory; external
  links never auto-apply. A successful injection can only produce a bad field value that must still
  survive validators and, for MEDIUM ops, a human.
- **Context is curated, not dumped**: each pack is a **>4K stable cached prefix** (rulebook, output
  schema, site-level brand constraints — deliberately sized above the 4,096-token minimum cacheable
  prefix of Haiku-class models, below which caching buys nothing) plus **2–4K volatile per-page
  blocks**, because reliability measurably degrades as input grows even on simple tasks [30] — and
  tokens are the COGS ($27.50–$82.50 per full 10k-page metadata pass for generation, $33–$88 all-in
  with judging, at batch rates and 3,000 in / 500 out per page [29]).

Open-ended content improvement is deliberately *not* claimed as automatable: it ships as bounded
additive operations plus human-reviewed drafts, both for quality and because Google's
scaled-content-abuse enforcement explicitly punishes unreviewed at-volume AI changes [3][55].

### 3.4 Apply — verdict per platform (pending POC #4 and POC #6)

One Change Application Layer, four adapters. The automation ceiling differs by platform and the
product must surface that honestly.

| Platform | Verdict | What works | Binding constraints |
|---|---|---|---|
| **Next.js / React (GitHub)** | **PROVEN** for the mechanism, ceiling set by the customer — every step is a documented GitHub/host capability, but the ceiling on a branch-protected repo is "PR open", not "change live" (POC #4, POC #6) | GitHub App auth (per-installation, per-repo, 1-hour down-scoped tokens [35]); deterministic AST codemods perform edits while the LLM supplies only values; commits via GraphQL `createCommitOnBranch` (auto-signed, `expectedHeadOid` concurrency guard so automation can never clobber a concurrent human push) [36]; one logical change per PR | Vanilla-LLM codemods are only ~45–55% correct in published evals [59] — which is exactly why codemods execute and LLMs only decide; customer branch protection caps automation at "PR open" (surfaced in the §26 buckets); Hobby-tier hosting caps validation throughput (100 deploys/day [40]) |
| **WordPress (REST)** | **FEASIBLE-WITH-CONSTRAINTS** | Application Passwords auth; posts/meta writable via REST; broadest market coverage | **Yoast's REST API is officially read-only** [44] and unregistered meta is silently dropped — a shipped ~50-line companion plugin registering SEO meta is mandatory; SEO meta does not participate in revisions [45], so the Platform's own ledger is the rollback source of truth; no cross-object transactions → per-object verify + partial-state handling |
| **Shopify (Admin GraphQL)** | **FEASIBLE-WITH-CONSTRAINTS** | SEO title/description first-class on products/collections; `global.title_tag`/`description_tag` metafields; `urlRedirectCreate`; theme staging pipeline fully API-expressible when needed | Theme writes need the protected-scope exemption (SEO is a named qualifying category; ~2-week review) [48]; theme library cap 20 (100 Plus) [47]; **no draft state exists for a published product's SEO fields** — data-field changes validate via simulated render + canary (see §3.5) |
| **Custom sites (edge worker)** | **FEASIBLE-WITH-CONSTRAINTS** | Cloudflare Worker/HTMLRewriter rewrites are just server-side HTML — fully processed by Google [50]; pure-function transform means pre-deploy validation is *exact*; per-version preview URLs exist before any deploy [49] | The Platform enters the customer's serving path (latency, SLA, trust) — an opt-in premium mode, not the default; client-side JS injection is rejected outright: no detectable SEO effect in controlled testing [33] |

### 3.5 Validate — verdict: **FEASIBLE-WITH-CONSTRAINTS** (pending POC #5)

On the git channel, SPEC §15's full chain is automatable today: static gates (changed-file
allowlist that always denies workflows/configs/lockfiles; per-change-type diff budgets) → lint +
`tsc` → sandboxed build in an ephemeral egress-restricted container (a customer's `npm install` is
remote code execution and is treated as hostile) → preview deploy (Vercel/Netlify APIs [40][41]) →
SEO assertions on the rendered preview: the meta-tag diff invariant ("intended change present,
nothing else changed"), Nu HTML Checker [42], self-built JSON-LD/schema.org validation, Lighthouse
CI regression budgets (baseline-relative, median of ≥3 runs — absolute scores false-positive)
[43], and link checking — all posted as GitHub Checks the customer can mark required.

Two honest limits:

1. **Structured-data validation is self-built forever**: no public Rich Results API exists, its
   predecessor died in 2020 without replacement, and Google's own validation framework was archived
   in 2025 [37][38]. Post-deploy, URL Inspection's `richResultsResult` is the Google-side truth,
   inside its 2,000/day budget [9].
2. **Direct-API channels (WordPress/Shopify data fields) have no preview artifact** — a successful
   API write *is* the deployment. The Platform closes this with a three-rung ladder: simulated
   render (apply the change to the fetched production DOM in memory and run the full validator
   suite, calibrated per site by a render-mapping probe that learns how stored fields project to
   the page); true staged renders where a primitive exists (Shopify duplicate-theme previews,
   WordPress autosaves for content edits [46], edge version-preview URLs [49]); and canary apply —
   one lowest-traffic URL applied and render-verified in seconds before the batch rolls. The
   truthful statement, carried into the matrix: on these channels, N−1 of N pages in a batch are
   **pre-validated by simulated render only** — no real staged artifact exists for them, so the
   validators run against an in-memory projection of the change onto the fetched production DOM,
   and that projection is only as good as the per-site render-mapping probe that calibrates it. The
   canary page is the **sole page with a true rendered verification**, and it is verified seconds
   after its own apply, not before. This is strictly weaker than the git channel, where every page
   in the batch is asserted against a real preview deploy. That is the platform-imposed ceiling, not
   an architecture defect — but it is a ceiling the product states rather than papers over.

### 3.6 Measure + rollback — verdict: **FEASIBLE-WITH-CONSTRAINTS** (pending POC #8; the hardest subsystem, and the one that makes the rest defensible)

The latency chain is structural: Google recrawls on its own schedule ("a few days to a few weeks"
after a request [6]; no per-tier numbers are published anywhere [60]), reprocessing settles over
weeks [5], and GSC data lands 2–3 days late [10]. Three design moves make measurement honest
despite it:

- **The evaluation clock starts at verified recrawl, not deploy** — first URL-Inspection-confirmed
  or log-verified Googlebot fetch after apply. A wrong latency assumption then costs polling
  efficiency, never verdict correctness. (Practitioner recrawl-tier constants are treated as
  unverified priors; POC #8 measures each site's real recrawl distribution and replaces them,
  following the instrument-real-Googlebot-traffic, report-percentiles methodology of the
  Vercel/MERJ indexing study [58].)
- **Two-phase monitoring separates catastrophe from judgment.** Guardrails (days 0–7): build/HTTP
  failures, crawl-diff regressions, robots/sitemap fetch errors, index-state drops, and **CUSUM
  (cumulative-sum change detection — a sequential test that accumulates small deviations from an
  expected level so a sustained modest decline trips an alarm that no single day's noise would)**
  on fresh GSC data — each trips an automatic rollback in minutes. Verdicts (day 14–60 by change type): KEEP or
  ROLLBACK decided against a counterfactual built from untouched control pages (CausalImpact-style
  Bayesian structural time series, or difference-in-differences with year-over-year checks) [20] —
  never naive pre/post, which Google's own traffic-debugging guidance disqualifies by listing six
  confounders including algorithm updates and seasonality [18]. This is how commercial SEO A/B
  testing works: control and variant cohorts experience updates and seasonality together, so those
  effects cancel [19].
- **Statistical honesty is enforced, not aspired to.** Page-level verdicts require ~10 clicks/day;
  below that, verdicts pool to the cohort; below cohort power, the verdict is `insufficient_data`
  with asymmetric defaults — correctness fixes default KEEP (rolling one back reintroduces a
  defect), opinion changes default ROLLBACK on inconclusive-negative (industry testing shows
  negative and inconclusive outcomes are routine [21]). Verdict windows overlapping a confirmed
  Google update auto-extend.

Rollback mechanics rest on documented per-channel primitives (PROVEN in the sense defined above —
each is a published vendor capability, none confirmed on customer sites until POC #8): Vercel
Instant Rollback / Netlify restore in seconds for emergencies [39][41], a GraphQL
`revertPullRequest` for durable git reversal [36], ledger-driven
inverse writes on CMS channels (WordPress revisions don't reliably carry SEO meta [45], so the
Platform's own before/after ledger is the source of truth). Two caveats the product must state
plainly: a **drift check** precedes every rollback (if the live value no longer equals the change's
`after` state, a human gets a 3-way diff instead of an automatic revert — the most common way naive
rollback systems corrupt sites), and **rollback is not undo** — the reverted page still needs a
Google recrawl, so SEO-state recovery is quoted in days-to-weeks, and the page/change-type pair is
frozen for 30 days to prevent flapping.

### 3.7 Keyword & GSC intelligence — verdict: **PROVEN** as a data pipeline (pending POC #7), **FEASIBLE-WITH-CONSTRAINTS** as a picture of demand

This subsystem covers FR-5 (keyword discovery + opportunity score), FR-6 (GSC integration,
opportunity and decay detection) and SPEC §8–§9. It is the only major subsystem that **writes
nothing** — it reads GSC, keyword APIs and the crawl warehouse and emits ranked work items — so its
automation ceiling is 100% by construction and the interesting question is not "can it run
unattended" but "how much of the truth can it see."

**Why the pipeline half is PROVEN.** Everything it needs is a documented API with published limits.
GSC Search Analytics gives per-property query/page/click/impression/CTR/position data at **1,200
queries per minute per site** [9] — enough headroom that a fleet of thousands of tenants fits in a
single GCP project's quota. The two ceilings are known and designed around rather than discovered
in production: the API returns "top rows, not all rows" and Google does not publish the cut-off [9],
so the Platform plans against a community-measured **~50,000 rows per day per site per search
type°** [11], sorted by clicks descending — an estimate the pipeline treats as such, detecting
truncation empirically (a response at the row ceiling is assumed truncated) rather than trusting the
constant. It works around the cap with date-partitioned pulls and, for enterprise tenants, the
BigQuery bulk export, which has no row cap and includes anonymized queries as aggregate rows so
totals reconcile [62]. The second ceiling is the **16-month rolling retention°** [11] — widely
reported but not primary-sourced — which is why every tenant's GSC data is warehoused from day
one: year-over-year decay controls are impossible on a 16-month window.

**Both algorithms the SPEC asks for are specified, and both reproduce its worked examples.** The
opportunity score is a two-component function — a CTR gap (impressions × the shortfall between
observed CTR and the expected CTR at the page's current position) plus a position-upside term
(impressions × the CTR that a realistic target position would earn), weighted 0.4/0.6, multiplied
by a commercial-value factor, and log-normalized to 0–100 against the site's own top-50 click
median so "HIGH" means *material for this site*. On the SPEC's example (position 8.7, 32,000
impressions, 2.1% CTR) it returns ≈96 → HIGH, and it correctly attributes the opportunity to
position upside rather than the title tag — the CTR gap is zero because the snippet already earns
its position. The expected-CTR baseline underneath it is a **six-study composite prior**
(position 1 ≈ 27.0%) rather than any single vendor's published curve, refit per site by
empirical-Bayes shrinkage as that site's own impression data accumulates [63]; the highest single
published curve puts position 1 at 39.8%, which would inflate every opportunity estimate by roughly
45%. The decay detector runs weekly per-page series against three baselines (prior 28 days,
same window one year earlier, best trailing-12-month window), requires a ≥30% click decline **and**
a ≥2.0 position worsening **and** a robust negative slope across ≥3 consecutive weekly evaluations,
and classifies the result — ranking decay, demand decay, cliff, cannibalization, or seasonality —
because the classification is what routes the work. The SPEC's example (position 4→13, clicks
10,000→4,500) lands as ranking decay at CRITICAL severity, routed to content investigation.

**The constraint that bounds the verdict, stated in the product.** GSC omits "anonymized queries" —
rare queries not issued by enough distinct users over a 2–3-month window — from any query-grouped
result. Across a 146k-site, 22-billion-click study that is **46.77% of all clicks**, and the
**per-site range runs 45–80%** [54][64]. So keyword-level opportunity scoring sees roughly half the
demand, and the hidden half is disproportionately long-tail. Three consequences are designed in
rather than disclaimed away: per-page metrics are always computed from page-grouped pulls (which
*include* anonymized traffic) and never by summing query rows, so page-level scoring is unaffected;
the visible-distribution caveat is stated in the product's own reporting, not just in this document;
and third-party keyword expansion (D-24's vendor, §3.8) is what recovers demand GSC will never
show. This is a limit on completeness, not on correctness — which is why the pipeline verdict stays
PROVEN while the demand-picture verdict does not.

### 3.8 Competitor analysis — verdict: **PROVEN** for the analysis, **permanently gated** for the actions

This subsystem covers FR-7 and SPEC §10. The split in the §2.2 crosswalk — "analysis is fully
automatable; competitor-driven content actions never auto-apply" — is the whole verdict, and each
half needs its own evidence. It has no dedicated POC; the acquisition and extraction path is
exercised by POC #2 and the gap-to-action path by POC #3.

**The analysis half is a priced, deterministic pipeline.** SERP acquisition runs through the
Platform's primary third-party data vendor at **$0.60 per 1,000 SERPs** on the standard queue [65],
behind a mandatory multi-vendor provider abstraction so the vendor is replaceable — a live
requirement in this category, where the largest SERP-API competitor is a named defendant in active
Google and Reddit litigation. Competitor page acquisition uses a **three-tier fetch ladder** that
tries the cheapest thing first and gives up rather than escalating indefinitely: basic HTML at
**$0.000125/page**, JS-rendered at **$0.00125/page**, and a commercial unlocker at ~$0.005–0.015
only on failure, with unfetchable pages dropped from the comparison and recorded as dropped [66].
Each fetched page gets one cheap-LLM structured pass (~$0.002/page) that returns entities, topics,
questions and claims together, with an open-source zero-shot NER model retained as a deterministic
regression baseline [67]. Gap detection is then set arithmetic over embeddings rather than model
opinion: customer and competitor main-content chunks are embedded, clustered at ~0.75 cosine, and a
cluster counts as a gap only if it is covered by competitors and absent from the customer page
[68]. **Fully analyzed, a keyword costs ≈$0.02–0.05** — ~$0.08–0.10 at the ceiling where JS
rendering and unlocker-grade fetching are needed throughout. That is what makes per-keyword
competitor analysis affordable enough to run unattended at all.

**The action half never auto-applies, for two independent reasons.** The first is quality: a raw
"they cover it, we don't" cluster is noise. Five gates run in cheap-to-expensive order, each
emitting a score that becomes part of the change's `reason` — (1) **search-intent match**, using a
vendor intent endpoint that classifies up to 1,000 keywords per call into informational /
navigational / commercial / transactional [69], and rejecting gaps whose intent does not match the
customer URL's (intent mismatch is the single largest false-positive source); (2) **consensus
breadth**, requiring the cluster on ≥3 of the top 10 or ≥2 of the top 5 ranked competitors,
position-weighted, so one competitor's tangent cannot become a recommendation; (3) **demand
evidence**, requiring the gap to map to an observable People-Also-Ask question, autocomplete
suggestion, nonzero keyword volume, or existing GSC impressions; (4) **business relevance**, scored
against a business-context embedding built from the site-understanding layer, which is what kills a
competitor's unrelated product line surfacing as a "gap"; and (5) **cannibalization**, which checks
whether a sibling URL already earns impressions for the gap queries — if so the correct action is an
internal link or a consolidation, never duplicate coverage. The second reason is policy and
security, and it is the one that makes the gate permanent rather than a maturity milestone:
competitor pages are **attacker-controlled text entering an LLM** (the prompt-injection carrier of
§3.3), and autonomously publishing competitor-derived content at volume is the pattern Google's
scaled-content-abuse policy targets [3][55]. So survivors ship as §2.4 row 17 — five gates, then a
human-merged PR with the per-gate evidence attached — and never as an applied change.

---

## 4. The asymmetric-loss principle (why every threshold is conservative)

The single most important design fact from the research: **the loss function is asymmetric.**

- A **missed optimization** costs a few percent of unrealized uplift. Controlled SEO experiments
  put well-executed single changes at single-digit to low-double-digit percentage effects — often
  negative or null [19][21][32].
- A **bad change** costs weeks to months. Google states spam-update recovery happens "over a
  period of months" [4]; site-move-scale disruptions fluctuate hardest for 2–4 weeks and take
  months to stabilize cross-domain [5]; a 5xx robots.txt halts all crawling within 12 hours and a
  bad one persists up to 24 hours after any fix because of caching [2]. And Google's index is not a
  guaranteed destination in the first place: on popular websites, **83% of new pages are indexed
  within a week but 16% of valuable, indexable pages never get indexed at all** [57] — a statistic
  about *initial* indexing, not about re-indexing after a de-indexing event, for which no public
  measurement exists. It is cited here only for what it does support: that "Google will just pick it
  back up" is an assumption, not a mechanism.

The design posture this forces, everywhere:

1. **Deny-list floors** — the highest-B actions can never be unlocked by confidence, trust, or
   configuration (Bucket 3 is permanent).
2. **When tools disagree on a threshold, take the looser bound** — because the Platform triggers
   *actions*, a false positive costs an unwanted PR or a wrong edit, not a wasted report row.
3. **Velocity caps and batch limits** — ≤max(20, 2% of pages)/day auto-applied, ≤50 pages/batch —
   both for attribution and because high-velocity automated modification is the exact signature
   Google's scaled-abuse enforcement targets [3]. The 2%/day figure is a **burst ceiling**: the
   velocity modifier itself trips at >10% of indexed pages changed in a rolling 7 days, so a site
   held at 2%/day (14% per 7 days) would sit permanently above the trip point and the governor would
   route all new LOW work into the PR lane. Sustained unattended operation runs below that — ≤1.4%
   /day, and typically nearer 0.3%/day (§2.1, §5). The asymmetry shows up here too: the cap that
   binds in practice is the conservative one.
4. **Update-rollout freeze** — no auto-apply while a confirmed Google update rolls out; applying
   mid-rollout destroys attribution and couples the Platform's changes to algorithmic volatility.
5. **Asymmetric verdict defaults** — inconclusive evidence keeps correctness fixes and rolls back
   opinions (§3.6).
6. **Protected pages** — the top-20 pages by clicks bump one risk tier minimum: they are where an
   error is most expensive and where measurement is most sensitive.
7. **Content changes can never auto-apply and net-new pages are never auto-published** — the two
   brightest policy lines [3][55][56].

This is also the direct answer to the client's overclaim test: the Platform's competitive posture
is not "automates more than anyone" but "automates everything whose worst case is affordable, and
proves it with a ledger."

## 5. Why a daily loop is still meaningful despite weeks-long measurement latency (FR-15, FR-14.3)

An apparent contradiction sits between SPEC §18 (a daily agent) and SPEC §17 (effects take weeks
to measure). It dissolves once the loop is understood as a **scheduler over many overlapping
per-change monitoring windows**, not a synchronous act-then-wait cycle:

```
Day:      0        7        14       21       28       35       42
Batch A   [G======][=========== verdict window ===========]V
Batch B            [G======][======= verdict window ======]V
Batch C                     [G======][===== window ==========]V
Batch D  (pages disjoint from A-C)   [G======][===== window ...
           ^ new work starts daily on pages NOT under evaluation
G = guardrail phase (auto-rollback on trip, minutes-days)
V = verdict fires (KEEP / ROLLBACK / EXTEND), clock started at verified recrawl
```

What the daily tick actually does:

1. **Finds new work on untouched pages.** A 10,000-page site with a 50-page batch cap has hundreds
   of eligible batches; the frontier of unevaluated opportunities is never empty in practice.
2. **Enforces do-not-touch locks.** Any page whose last change is still inside a monitoring window
   is locked — re-touching it would destroy attribution. The locks are rows in the change ledger;
   the daily planner simply excludes them. After a rollback, the page/change-type pair freezes for
   30 days.
3. **Advances every open window.** Guardrail signals are checked daily (or faster): crawl-diffs,
   index-state, CUSUM on fresh GSC data. The slow verdicts are not idle waiting — they are durable
   timers (in the orchestration backbone) that cost nothing while sleeping and fire exactly once
   per change, with the fast-failure path always armed.
4. **Refreshes detection and opportunity data.** GSC syncs nightly, crawls run incrementally, and
   new issues/opportunities enter the queue — detection latency is daily even when verdict latency
   is monthly.
5. **Emits verdicts whose clocks completed.** Each day, some windows close; KEEP outcomes feed the
   trust and calibration loops, ROLLBACK outcomes trigger reversal and freezes.

Throughput math makes it concrete — and the honest version of it is bounded by the Platform's own
velocity governor, not by the daily cap. The 2%/day auto-apply cap is a **burst ceiling**: sustained,
it means 14% of a site's pages changed per rolling 7 days, which is above the >10% trip point at
which `M_velocity` rises to 1.5 and every new LOW-tier item queues as a PR (§2.1). A site running at
the cap would therefore have throttled itself out of unattended auto-apply — so it is not the rate
to plan steady state around.

The sustainable rates, and what each yields with 21–28-day verdict windows:

| Sustained auto-apply rate | Rolling-7-day volume | `M_velocity` | Share of pages under evaluation at steady state |
|---|---|---|---|
| **2%/day** (burst ceiling) | 14% | 1.5 — LOW work forced into the PR lane | not a steady state; the governor ends it |
| **1.4%/day** (just under the trip point) | 9.8% | 1.2 | **~29–39%** |
| **0.3%/day** (keeps the modifier neutral) | 2.1% | 1.0 | **~6–8%** |

So the defensible claim is the middle row: a site sustaining ~1.4%/day carries roughly a third of
its pages under evaluation at any moment while new batches continue daily on the remainder — the
pipeline is full even though every individual change waits weeks for judgment. (These are shares of
pages *under evaluation*, not shares of pages improved; and the clock starts at verified recrawl, so
real-world occupancy sits above these figures by the recrawl latency of the site.) The 2%/day cap
still earns its place as a burst allowance for onboarding sweeps and post-freeze catch-up, where a
few days above the trip point is an accepted cost paid in PR volume rather than in risk. The
guardrail phase, meanwhile, gives the daily loop its safety payoff
immediately: the changes most likely to cause harm reveal it through technical signals
(build/4xx/5xx/crawl-diff/index drops) within hours to days, not weeks.

## 6. Assumptions and open client questions (refined from Doc 01 §10)

Answers change the design; each assumption below is the working default used across Docs 02–07.

| # | Question | Working assumption | What changes if the answer differs |
|---|---|---|---|
| 1 | **Multi-tenancy** — internal tool or SaaS onboarding third parties? | Multi-tenant SaaS (SPEC §22 references customer data and customer repos) | Internal-only would relax OAuth verification effort and tenant-isolation scope, not the safety architecture |
| 2 | **Approval surface** — who merges MEDIUM PRs: customer developers or a platform operator? | Customer's own reviewers, in their GitHub/CMS workflow | An operator-merges model concentrates the Bucket-2 gate in the Platform's UI and raises its liability posture |
| 3 | **Conversion data** — which analytics source exists? | GA4 where present, via the same OAuth consent; conversions are a **veto-only, last-priority** rollback signal (attribution is restated for up to 12 days [51], and page-level conversion power needs a baseline of **≥~3.6 key events/day — ≈120–360 organic sessions/day at a 1–3% conversion rate**, derived in Doc 05 §3; note this is a far higher bar than, and must not be conflated with, the ~10 organic clicks/day of page-level *verdict* power in §3.6) — its absence never blocks a verdict [52] | Shopify/WooCommerce native order attribution supersedes GA4 as revenue truth for e-commerce tenants |
| 4 | **Rankings source** — is third-party SERP data acceptable at MVP? | GSC position only at MVP; a SERP provider is an optional cost lever (Doc 05) | Third-party rank tracking would tighten position-decline guardrails from days to hours at added per-keyword cost |
| 5 | **Content authorship boundary** — may the system draft body content into PRs? | Yes, at the MEDIUM tier, always human-merged; net-new pages never auto-published (§2.6) | A "metadata-only" mandate removes the five content-bearing Bucket-2 rows (16, 17, 18, 23, 24) and shrinks policy exposure further |
| 6 | **Target hosting** — Vercel-first or arbitrary hosts? | Vercel/Netlify-first (instant-rollback + preview APIs [39][40][41]); generic hosts get the Platform's own sandbox-built preview stage | Hobby-tier hosting caps validation throughput (100 deploys/day [40]) — paid tiers or batched validation required |
| 7 | **WordPress plugin acceptance** — will customers install the companion plugin? | Yes; it is ~50 lines, auditable, and the only way to write SEO meta given Yoast's read-only REST surface [44] | Refusal downgrades WordPress SEO-meta writes from automatable to recommend-only on that site |
| 8 | **Shopify app distribution** — App Store (needs protected-scope exemption for theme writes, ~2-week review [48]) or per-store custom apps? | Custom apps for early customers; exemption filed before App Store distribution | Denial of the exemption removes theme-write features only; data-field automation is unaffected |
| 9 | **Server-log access** — will customers grant it? | Optional connector, never a dependency; where present it provides quota-free Googlebot recrawl verification | Without logs, recrawl verification rides the 2,000/day URL Inspection budget [9] |
| 10 | **GSC OAuth verification timeline** | Sensitive-scope review (privacy policy, justification, demo video — no CASA) budgeted into the MVP schedule | Delay pushes early tenants to the service-account-invite fallback |

## 7. Traceability

Doc 01 §11 requires that this document cover **each FR area** with an automation-level verdict. It
does; the map below is meant to be checkable in one pass.

| Requirement area | Where the verdict lives |
|---|---|
| FR-1 (crawling), FR-2 (site understanding) | §3.1 — PROVEN, pending POC #1 |
| FR-3 (technical SEO detection) | §3.2 — PROVEN, pending POC #2 |
| **FR-3.7** (safe-to-auto-fix classification) | §2.2–2.6 — the four buckets, every action type placed with a base risk, an evidence-cited why, and a gate |
| FR-4 (AI optimization engine) | §3.3 — FEASIBLE-WITH-CONSTRAINTS, pending POC #3 |
| **FR-5** (keyword discovery + opportunity score) | **§3.7** — PROVEN as a pipeline, FEASIBLE-WITH-CONSTRAINTS as a picture of demand (the ~47% anonymized-query ceiling), pending POC #7 |
| FR-6 (GSC integration, opportunity + decay detection) | **§3.7** for the data plane and both algorithms; §3.6 for the measurement use of the same data |
| **FR-7** (competitor analysis) | **§3.8** — PROVEN for the analysis, permanently gated for the actions; §2.4 row 17 is the shipped action path |
| **FR-8** (internal linking automation) | §2.4 row 5 (tiering, precision/recall evidence, the auto-merge exception and its FR-11.2 deviation), §2.3 rows 4–5 and 13 (the fully automatic link repairs), §2.2 crosswalk row "Internal links" |
| FR-9 (automated website modification), FR-10 (GitHub automation) | §3.4 — verdict per platform, pending POC #4 and #6 |
| **FR-11.1** (detailed scoring mechanism) | §2.1 — the full two-axis decision matrix (all three confidence rows), the risk formula with its one-sided clamp, its three modifier tables, the trust term, and the computed-confidence weights |
| **FR-11.2** (fixed tier semantics) | §2.3–2.5 place every action against the client's LOW/MEDIUM/HIGH definitions; the three deliberate departures — T1 internal-link auto-merge (§2.4 row 5), the six deny-list extensions (§2.5 †), and the LOW lane for byte-identical sitemap re-submission (§2.3, off pending client sign-off) — are flagged as such rather than absorbed silently |
| FR-12 (validation engine) | §3.5 — FEASIBLE-WITH-CONSTRAINTS, pending POC #5 |
| FR-13 (change tracking), FR-14 (automatic rollback) | §3.6 — FEASIBLE-WITH-CONSTRAINTS, pending POC #8 |
| FR-15 (autonomous scheduling) | §5 — the daily loop as a scheduler over overlapping windows, with the sustainable-throughput math |
| SPEC §26 (four-bucket mandate) | §2.2–2.6 |

The non-functional requirements:

- **NFR-1 (safe — never blindly modify production)** — §2.1's gate chain: computed confidence ×
  clamped risk, then validate → apply → monitor → rollback, with a deny-list no score overrides.
- **NFR-2 (scalable)** — §3.1 (100k-page graph analytics in-process, in seconds; static-first crawl
  at ~10× the page-per-compute-unit rate of full rendering) and §3.0's quota table, which is what
  actually bounds scale: URL Inspection at 2,000/day/property makes a 100k-page index sweep a
  50-day operation, so verification is a sampling layer by design rather than by shortfall.
- **NFR-3 (explainable)** — computed confidence, deterministic risk arithmetic whose every term is
  printed in §2.1, per-gate evidence scores on competitor-derived actions (§3.8), and the
  append-only ledger.
- **NFR-4 (autonomous)** — delivered exactly as far as Buckets 1–2 and no further, at the sustainable
  velocity §5 derives rather than the burst ceiling. That boundary is the answer to SPEC §25.1.
- **NFR-5 (secure)** — §3.1 (egress-isolated crawl workers with post-DNS IP validation against
  SSRF), §3.3 (the generator has no tools, no credentials and no write access; third-party text is
  sanitized and quarantine-summarized; output URL allowlists), §3.5 (a customer's `npm install`
  treated as hostile and sandboxed), §3.4 (per-installation, per-repo, 1-hour down-scoped GitHub
  App tokens — never OAuth apps or personal tokens).
- **NFR-6 (cost-bounded)** — §2.4 ($27.50–$82.50 per full 10k-page metadata pass for generation at
  batch rates, $33–$88 all-in with judging; nightly cycles touch only the 1–5% of pages that
  changed), §3.1 (~$0.30 per 10k pages embedded; static-vs-rendered crawl economics), §3.3 (curated
  context packs — a cached stable prefix plus small volatile per-page blocks — as a COGS control,
  not only a quality control), §3.8 (≈$0.02–0.05 per keyword fully analyzed).
- **NFR-7 (justified)** — this document states verdicts and the evidence behind them; the compared
  alternatives behind each technology pick live in Doc 04, which §3.0's constraints and §3.4's
  adapter table feed directly.
- **NFR-8 (policy-compliant)** — §2.6 (net-new AI pages never auto-published; third-party/affiliate
  sections refused outright; review/rating values never generated), §4 principles 3 and 7 (velocity
  caps as an anti-scaled-abuse measure, and the two bright content lines), §3.3 and §3.8 (bounded
  additive operations and the five-gate competitor filter as the containment for policy exposure).

Sections 4–5 resolve tensions 1–3 from Doc 01 §9 (autonomy vs safety; measurement latency vs the
daily loop; attribution in a noisy system); tension 4 (AI helpfulness vs AI risk) is resolved in
§3.3 and tension 5 (write-access depth vs blast radius) in §3.4–3.5. Section 6 carries Doc 01 §10
forward.

---

## Sources

1. Screaming Frog — SEO Spider issues catalog (per-issue thresholds and severities): https://www.screamingfrog.co.uk/seo-spider/issues/
2. Google Search Central — How Google interprets robots.txt (24 h caching, 5xx handling): https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
3. Google Search Central — Spam policies for Google web search (scaled content abuse, link spam, structured-data spam): https://developers.google.com/search/docs/essentials/spam-policies
4. Digital Applied — Google June 2026 spam update rollout guide (months-scale recovery): https://www.digitalapplied.com/blog/google-june-2026-spam-update-rollout-site-owner-guide
5. Google Search Central — Site moves with URL changes (settling windows; redirects ≥1 year): https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes
6. Google Search Central — Ask Google to recrawl your URLs ("a few days to a few weeks"): https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl
7. Google Search Console Help — About the URL Inspection tool (indexing "a day or so… much longer"): https://support.google.com/webmasters/answer/9012289
8. Google Search Central — SEO starter guide ("a few hours" to "several months"): https://developers.google.com/search/docs/fundamentals/seo-starter-guide
9. Google — Search Console API usage limits (URL Inspection 2,000/day + 600/min per property; Search Analytics 1,200 QPM): https://developers.google.com/webmaster-tools/limits
10. Google Search Central Community — Search Analytics API delay grew from 1 to 3 days: https://support.google.com/webmasters/thread/394920643
11. RankStudio — Google Search Console API guide (50k rows/day, 16-month retention): https://rankstudio.net/articles/en/google-search-console-api-guide
12. Zyppy (Cyrus Shepard) — Google title tag rewrite study (61.6% of 80,959 URLs): https://zyppy.com/seo/title-tags/google-title-rewrite-study/
13. SerpClix — Google rewrites title tags (Q1-2025: 76% rewrite rate): https://serpclix.com/blog/google-rewrites-title-tags-how-to-survive
14. Ahrefs — Canonicalization (~40 signals; 30–40% of rel=canonical overridden): https://ahrefs.com/blog/canonicalization/
15. Google Search Central — Build and submit a sitemap (`lastmod` trust condition; `changefreq`/`priority` ignored; 50k/50 MB limits): https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
16. IndexNow — FAQ (participating engines; Google absent): https://www.indexnow.org/faq
17. Google — Indexing API quickstart (JobPosting/BroadcastEvent only; 200/day default): https://developers.google.com/search/apis/indexing-api/v3/quickstart
18. Google Search Central — Debugging drops in Google Search traffic (six confounders; YoY guidance): https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops
19. SearchPilot — The math behind SearchPilot (control/variant bucketing; updates and seasonality cancel): https://www.searchpilot.com/resources/blog/the-math-behind-searchpilot-how-seo-a/b-testing-actually-works
20. CausalImpact — official documentation (BSTS counterfactual; validity assumptions): https://google.github.io/CausalImpact/CausalImpact.html
21. SearchPilot — SEO A/B test case studies (winning/negative/inconclusive all common): https://www.searchpilot.com/resources/case-studies
22. Anthropic — Structured outputs (constrained decoding; schema limits): https://platform.claude.com/docs/en/build-with-claude/structured-outputs
23. OpenAI — Introducing Structured Outputs in the API: https://openai.com/index/introducing-structured-outputs-in-the-api/
24. Google — Gemini structured output (`responseSchema`): https://ai.google.dev/gemini-api/docs/interactions/structured-output
25. Instructor — Re-ask validation (error-fed retries; ~95% fixed on first retry): https://python.useinstructor.com/concepts/reask_validation/
26. arXiv 2508.06225 — Overconfidence in LLM-as-a-Judge: https://arxiv.org/abs/2508.06225
27. OWASP GenAI Security Project — LLM01:2025 Prompt Injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
28. Zylos Research — Indirect prompt injection: attacks, defenses, 2026 state of the art: https://zylos.ai/research/2026-04-12-indirect-prompt-injection-defenses-agents-untrusted-content/
29. Anthropic — Batch processing (uniform 50% discount): https://platform.claude.com/docs/en/build-with-claude/batch-processing
30. Chroma Research — Context rot (reliability degrades with input length, 18-model study): https://research.trychroma.com/context-rot
31. Zyppy — internal linking study (23M links, 1,800 sites; inbound-link and anchor-variety correlations): https://zyppy.com/seo/seo-study/
32. SearchPilot — nearby-location internal links split test (+7% organic traffic): https://www.searchpilot.com/resources/case-studies/seo-split-test-lessons-nearby-location-links
33. SearchPilot — server-side vs client-side JS internal links (no detectable impact from JS-only links): https://www.searchpilot.com/resources/case-studies/server-side-rendering-internal-links
34. Wikimedia Research — Link recommendation model for add-a-link (production precision/recall): https://meta.wikimedia.org/wiki/Research:Link_recommendation_model_for_add-a-link_structured_task
35. GitHub — Create an installation access token for an app (per-repo, per-permission down-scoping; 1-hour expiry): https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
36. GitHub — public GraphQL schema (`createCommitOnBranch`, `revertPullRequest`, `expectedHeadOid`): https://docs.github.com/public/fpt/schema.docs.graphql
37. Google Search Central Blog — Structured Data Testing Tool update (deprecated Dec 2020, no API replacement): https://developers.google.com/search/blog/2020/12/structured-data-testing-tool-update
38. schemavalidator.org — No public Rich Results Test API; validator-vs-eligibility distinction: https://schemavalidator.org/guides/structured-data-testing-tool
39. Vercel — Instant Rollback (seconds; no rebuild; post-rollback promotion caveats): https://vercel.com/docs/instant-rollback
40. Vercel — Limits (deployments/day by tier; 45-minute build cap): https://vercel.com/docs/limits
41. Netlify — API (deploy restore; 3 deploys/min, 100 API deploys/day): https://docs.netlify.com/api/get-started/
42. Nu HTML Checker (v.Nu) — the validator.w3.org/nu engine, self-hostable: https://github.com/validator/validator
43. Lighthouse CI — configuration (assertions, budgets, median-run aggregation): https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md
44. Yoast — REST API documentation ("currently read-only, doesn't support POST or PUT"): https://developer.yoast.com/customization/apis/rest-api/
45. WordPress Core — Framework for storing revisions of post meta in 6.4 (opt-in only; SEO-plugin meta not reliably revisioned): https://make.wordpress.org/core/2023/10/24/framework-for-storing-revisions-of-post-meta-in-6-4/
46. WordPress.org — live WP REST route index (autosaves endpoints for staging content edits): https://make.wordpress.org/wp-json/wp/v2
47. Shopify — Adding themes (theme-library caps: 20 standard / 100 Plus; unpublished-theme preview links): https://help.shopify.com/en/manual/online-store/themes/adding-themes
48. Shopify — Asset legacy / theme-write protected-scope exemption (SEO a named qualifying category; ~2-week review): https://shopify.dev/docs/apps/build/online-store/asset-legacy
49. Cloudflare — Workers preview URLs (per-version, pre-deployment): https://developers.cloudflare.com/workers/configuration/previews/
50. Google Search Central — JavaScript SEO basics (server-side rendering preferred; client-side a fallback): https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
51. Google Analytics Help — GA4 data freshness (attribution restated up to 12 days; no SLA): https://support.google.com/analytics/answer/11198161
52. Google — GA4 Data API quotas (200k tokens/property/day; typical request ≤10 tokens): https://developers.google.com/analytics/devguides/reporting/data/v1/quotas
53. Apify — Compute units (~3,000 pages/CU static vs ~300 pages/CU browser): https://use-apify.com/docs/what-is-apify/apify-compute-units
54. Ahrefs — GSC anonymized queries (46.77% of clicks, 22B-click study): https://ahrefs.com/blog/gsc-anonymized-queries/
55. Google Search Central — Creating helpful, reliable, people-first content (AI-content guidance): https://developers.google.com/search/docs/fundamentals/creating-helpful-content
56. Google Search Central Blog — Updating our site reputation abuse policy (Nov 2024; applies regardless of first-party oversight): https://developers.google.com/search/blog/2024/11/site-reputation-abuse
57. Search Engine Journal — How long before Google indexes my new page (83% within a week; 16% of valuable pages never indexed): https://www.searchenginejournal.com/how-long-before-google-indexes-my-new-page/464309/
58. Vercel + MERJ — How Google handles JavaScript throughout the indexing process (measured crawl→render percentiles): https://vercel.com/blog/how-google-handles-javascript-throughout-the-indexing-process
59. Codemod — Iterative AI system evals (vanilla LLM codemods ~45% one-shot, ~54–55% after refinement): https://codemod.com/blog/iterative-ai-system
60. Google Search Central — Crawl budget management for large sites (recrawl frequency drivers; no numeric intervals published): https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget
61. embeddingcost.com — OpenAI embedding pricing (`text-embedding-3-small` $0.02/1M tokens; $0.01/1M batch): https://embeddingcost.com/openai
62. Google Search Console Help — Bulk data export (scope; anonymized-query aggregate rows; no daily row limit): https://support.google.com/webmasters/answer/12918484
63. theStacc — Organic CTR by position (six-study aggregate: FirstPageSage 39.8 / Backlinko 27.6 / Sistrix 28.5 / GrowthSrc 19.0 / Indexsy 26.4 / OuterBox 20.5; average ≈27%): https://thestacc.com/blog/organic-ctr-by-position/
64. Ziptie — GSC's search gap (per-site anonymization 45–80%; long-tail vocabulary gap): https://ziptie.dev/blog/gscs-huge-search-gap/
65. DataForSEO — SERP API pricing ($0.60/1k standard, $1.20 priority, $2.00 live; SERP = 10 results): https://dataforseo.com/apis/serp-api/pricing
66. DataForSEO — OnPage API per-page costs ($0.000125 base; $0.00125 JS-rendered; $0.00425 browser + Core Web Vitals): https://dataforseo.com/help-center/cost-of-onpage-api-parameters
67. GLiNER — generalist zero-shot NER (50–300M params; outperforms ChatGPT-class models on zero-shot NER benchmarks): https://arxiv.org/abs/2311.08526
68. iPullRank — Vector embeddings for content-gap analysis (cosine methodology; ~0.75 same-topic thresholds): https://ipullrank.com/vector-embeddings-is-all-you-need
69. DataForSEO Labs — Google search-intent endpoint (up to 1,000 keywords per call; four intent classes with probabilities): https://docs.dataforseo.com/v3/dataforseo_labs-google-search_intent-live/
