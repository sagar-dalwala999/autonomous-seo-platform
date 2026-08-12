# Plan Review — POC-2 wave (A1-A5) — Round 1

Scope: brief.md §6b + spec.md "POC-2 wave (A1-A5)" section, reviewed as a Tier-B-style extension
of a shipped, verified POC-1. Grounded against: src/models/types.ts (the extended contract),
src/analysis/** stubs, src/crawler/crawl.ts + src/storage/runStore.ts + src/extraction/index.ts
(current shipped state), scripts/evidence-check.ts (the 18-item ground truth), SPEC.md §6,
DECISIONS.md D-08, research/crawler-advanced-competitive.md §5-6, sprints/fixtures/issues-sample.json.

## Verdict: REVISE

5 must-fix (structural) items, 6 nice-to-have items. None of the must-fixes require re-slicing
the wave (A1-A5 boundaries stay as drawn) — they are ownership gaps, contract-honesty gaps, and
scope-completeness gaps inside the existing slices. All are cheap to fix in spec.md text before
fan-out; none should be discovered mid-build.

---

## Point 1 — A1/A2 seam (extraction vs crawler-capture)

**A1 vs A2 direct file/FetchArtifact seam: OK, genuinely parallel-safe.** A2 only ever *calls*
`extractPage()` (owned/edited by A1) through its existing stable signature
`(FetchArtifact, CrawlScope) => ExtractionResult`; it never edits `src/extraction/**`. The fields
`RenderDivergence` diffs (title, metaDescription, canonical, robots.noindex, links.length,
content.wordCount) are all **pre-existing v1 fields** that already work correctly in the
*current, shipped* `extractPage` — they are not placeholder v2 fields A1 has yet to build. So A2
does not actually need A1's v2 work to land for renderDivergence to compute correctly. Verified
by reading both files directly. `FetchArtifact.httpVersion` is optional in the type, so even if
A2 lands before/after A1 there's no breaking dependency either direction.

**MF-1 (must-fix, STRUCTURAL, HIGH) — `src/storage/runStore.ts` is unowned in this wave, and two
real A2 requirements land there.**
- A2's scope says external-link check results go "into a new `external-links.json` via RunStore
  stub extension" — no such stub exists (read the full file: `RunStore` has `saveRaw`, `savePage`,
  `saveFailure`, `saveBlocked`, `saveRobots`, `saveSitemaps`, `saveReport`, `loadAllPages`; nothing
  for external links).
- A2's dual-storage requirement (`raw/<pageId>.static.html` alongside the existing
  `raw/<pageId>.html`) also needs a new/extended save path in the same file.
- `src/storage/**` is not listed in **any** A1-A5 "Owns" line, and the generic do_not_touch clause
  ("any directory owned by another slice") does not protect it either way — it's simply not
  claimed. If the fan-out tooling diffs each slice's changes against its declared Owns list, A2's
  legitimate, necessary edit to `runStore.ts` will look like an out-of-scope change.
- **Fix**: add `src/storage/runStore.ts` explicitly to A2's Owns line (A2 is the only wave slice
  that needs to write to it). See MF-2 below — the same file is also the right place to fix the
  old-run read-compatibility problem, so one owner for both makes sense.
- **Affected slice: A2.**

---

## Point 5 (folded in here because it's the same file/owner problem as MF-1) — old-run compatibility

**MF-2 (must-fix, STRUCTURAL, HIGH) — the v2 contract is silently violated on every one of the
~50 pre-v2 stored runs, and nothing catches it.**

Checked `src/models/types.ts` directly: every v2 `ExtractionResult` field is declared
**non-optional** — `social: SocialTags`, `hreflang: HreflangEntry[]`, `pixelWidths: PixelWidths`,
`pageStats: PageStats`, `titles: string[]`, `metaDescriptions: string[]`, `metaKeywords: string |
null`. Pre-v2 stored `pages/*.json` files on disk genuinely do not have these keys at all (they
were serialized before these fields existed).

`RunStore.loadAllPages()` does `JSON.parse(await readFile(...)) as CrawledPage` — a bare type
assertion, not a runtime validation. Nothing backfills the missing keys. So `page.pageStats
.textRatio` (or `page.social.og`, or `page.hreflang.length`) on an old record throws
`Cannot read properties of undefined`, it does not gracefully return `undefined`/`null`.

A3's own scope text promises "rules degrade gracefully when a field is absent (old runs): finding
skipped + rule marked 'data-unavailable', never false fire" — but the **type system actively lies
to every rule author** that these fields are always present, so nothing forces the defensive
check `RuleMeta.dataRequirements` implies. It only takes one of A3's ~15 page rules forgetting an
explicit presence guard to crash the whole analyzer run on an old run directory — which is exactly
the scenario the acceptance gate and any real usage against POC-1's existing 50 runs will hit
immediately.

- **Fix**: assign this explicitly, don't leave it implicit. Two acceptable shapes: (a) Main Claude
  marks the v2 `ExtractionResult` fields optional in `types.ts` (foundation-v2, since types.ts is
  do-not-touch for all A-slices) so every rule author gets a compiler-enforced reminder, and/or
  (b) add a single read-time normalization/backfill in `RunStore`'s page-read path (the same file
  as MF-1) that fills v2 defaults for pre-v2 JSON once, at the choke point, so every downstream
  reader (A3 rules, A4 site rules, A5 dashboard) sees a consistently-shaped record without each
  one re-deriving the guard.
- **Affected slices: A2 (owns the file per MF-1's fix), A3 (reader — page rules), A4 (reader —
  site rules + the gate itself will run against old runs if pointed at one), Main Claude
  (types.ts / foundation-v2).**

---

## Point 2 — A3 vs A4 rule ownership vs SPEC §6

Walked every SPEC §6 sub-category against A3's page-rule list and A4's site-rule list.
Most map cleanly (on-page, indexability self-checks, images, sitemap hygiene, duplicate
title/desc/content clusters, orphans, weak-inlinks, redirect chains/loops, robots-blocked
inventory — all unambiguous, all correctly page- vs site-scoped). Two classes are **not owned by
either**, and both fail structurally as page rules because `PageRule.evaluate(page, config)` only
ever sees one page — they need a full run's page set + failures.json, i.e. they belong in A4's
site-rule inventory but aren't listed there:

**MF-3 (must-fix, STRUCTURAL, MEDIUM) — two SPEC §6 rule classes have no owner:**
1. **Canonical validity beyond self-mismatch** (SPEC §6 "canonical problems"): A3's page rule can
   only compare `page.canonical` against the page's own URL. Whether the canonical TARGET actually
   resolves cleanly (200, not itself redirected, not 404, not chained) needs a cross-page lookup —
   nobody owns it.
2. **Broken internal links** (SPEC §6 Links: "broken links, broken internal links"): this is a
   link-integrity finding attributed to the *linking* page, not a status check on the dead page
   itself. It is directly relevant to gate manifest item #7 (`/gear-sale`,
   `/blog/ultralight-tents`, `/products/alpine-tent` — evidence-check.ts's own wording is "broken
   internal hrefs recorded as http-4xx failures"). A3's page-scope "http (status-based...)" rule
   can only flag the dead target page as "this page 404s" — it cannot, from a single-page view,
   identify which OTHER pages link to it. Without a site-scope pass cross-referencing every page's
   outbound links against failures.json/4xx statusCodes, the actually-actionable SEO finding
   (fix the link on the source page) never gets built, even though a gate-adjacent 404-on-itself
   finding might exist as a decoy.
- **Fix**: add both to A4's site-rule inventory (same shape as the other cross-page checks A4
  already owns — full pages[] + failures[] in `SiteRuleContext`).
- **Affected slice: A4.**

**MF-4 (must-fix, STRUCTURAL, MEDIUM) — A3's structured-data rule pack is missing 1/3 of what
manifest item #11 actually requires.**

A3's scope: `"structured-data (parseError, type-vs-context where derivable)"`. Manifest item #11
(evidence-check.ts, already shipped) bundles THREE sub-checks: invalid JSON-LD (parseError ✓
covered), Recipe-on-article (wrong type — "type-vs-context" ✓ probably covers this), and
**Product JSON-LD on `/products/ridgeline-backpack-45l` missing `offers`** — a *valid* schema
missing a required property for its own declared type. That's not "type-vs-context," it's
required-property-by-type, and it is not mentioned anywhere in A3's scope text. If A3 builds
exactly what's written, this sub-check silently never becomes a detected issue, and the hard
acceptance gate (brief §6b: ALL 18 classes must map to a detected issue) fails on a class that was
entirely foreseeable right now, at spec time.
- **Fix**: add "required-property-by-type checks (e.g. Product schema missing `offers`)"
  explicitly to A3's structured-data scope line.
- **Affected slice: A3.**

---

## Point 3 — acceptance-gate well-definedness

**MF-5 (must-fix, STRUCTURAL, MEDIUM) — two real ambiguities in `scripts/analyzer-gate.ts`'s
false-positive bar, both cheap to close now.**

1. **"Pages with no seeded issue" is never defined.** Brief §6b's false-positive clause needs a
   precise "clean" set. A4's scope only says the gate does "manifest live-grep → expected rule
   hits per URL" (mirroring evidence-check.ts) — good instinct, but it should be stated explicitly
   that the clean set = *all crawled pages in the run MINUS the union of every seeded item's
   attributed URL(s)*, computed programmatically (same live-grep discipline evidence-check.ts
   already uses for the manifest itself), not a hand-maintained allowlist that silently goes stale
   as target-site fixtures change.
2. **The false-positive bar is only safe if "soft"/heuristic rules default to warning or notice,
   never error.** Brief text exempts warnings/notices from the false-positive check, which
   implicitly requires A3/A4 to choose non-error severity for anything heuristic — weakly-linked
   (1-inlink), near-dup, thin-content, slow-page, security-header notices, missing-OG/Twitter. This
   constraint is never stated as a requirement anywhere in spec.md. If A4's weakly-linked rule (or
   any other heuristic rule) is left at error-severity and fires broadly across the *real*
   (non-seeded) link graph of target-site — plausible, since nothing guarantees every other page
   has >1 inlink — the gate fails unpredictably, driven by the site's organic shape rather than a
   real regression, and the failure will look like a bug hunt instead of a one-line severity fix.
- **Fix**: state explicitly in spec.md (A3+A4 scope) that heuristic/soft-signal rule categories
  default to warning/notice, never error, and that the gate's clean-page set is derived
  programmatically as above.
- **Affected slices: A3, A4.**

Confirmed by direct fixture math (not asserted, computed): the target-site's actual near-dup pair
(`/blog/winter-hiking-checklist` vs `/blog/winter-day-hike-checklist`, read directly from
`app/blog/.../page.tsx`) differs by ~1 word out of ~170 (~0.6%) — comfortably under both the 5%
default in A4's scope text and evidence-check.ts's own 20% pass-bar for the same pair. So this
specific pair is not at risk — see NTH-1 below for the smaller cleanup item this surfaced.

---

## Point 4 — A5's fixture representativeness

Fixture (`sprints/fixtures/issues-sample.json`) checked field-by-field against A5's scope
requirements: has page-scope issues, a site-scope cluster issue with evidence on another page
(`title-duplicate`, evidence[].pageId differs from the primary url's page), a pure site-scope
issue with `pageId: null` (`redirect-loop`, `sitemap-404-entry`), a populated `threshold` string,
and a populated `rulesSkippedDataUnavailable`. That's a good spread of the *shapes* A5 needs to
handle. Verdict: representative enough to build against — **no must-fix** — but one real testing
gap, filed as NTH-2 below since it doesn't change any slice boundary.

**MF-5 (see Point 1 section above for the companion finding) also applies here**: A5's own scope
promises "jump links to the evidence section" for every issue in the page-detail Issues section.
Checked the existing page-detail view's section list (spec.md's original S10 scope, still the
current page-detail contract): metadata, headings, links, images, structured data, content,
redirect chain, headers, raw HTML actions — **no section for social tags, hreflang, or
pageStats-derived fields anywhere**. Security headers are fine (they land for free in the existing
"Captured headers subset" section since A2 just adds keys to the same `headers` map). But an issue
whose evidence field is `social.og.title` or `pageStats.textRatio` or `hreflang[0].href` has
nowhere to jump to — no slice in this wave is assigned to add those sections.
- **Fix**: either narrow A5's "jump to evidence" promise to fields that already have a display
  home (metadata/headings/links/images/structured-data/content/redirects/headers), or explicitly
  assign the missing v2 evidence sections (social/hreflang/pageStats) to a slice — recommend A5,
  surgically, same file it's already touching.
- **Affected slice: A5.**

---

## Point 6 — SPEC §6 items with no owner anywhere

Beyond MF-3's two items (canonical validity, broken internal links), swept the rest of SPEC §6:

- **WWW/non-WWW problems, HTTP/HTTPS problems** — evidence is preserved (mixed http/www links
  captured verbatim per POC-1), but no rule flags e.g. "internal links point at the non-canonical
  host variant." Not gate-relevant (not one of the 18 seeded classes) — nice-to-have, not blocking.
- **Excessive links** (page outbound-link count over threshold) — trivially page-scope-computable
  from `page.links.length`, not listed in A3. Not gate-relevant. Nice-to-have.
- **301 vs 302 semantic checks** — folded into A4's generic redirect-chain/loop pass; no explicit
  distinction. Not gate-relevant. Nice-to-have.
- **"Large images" / image performance problems** — genuinely undetectable with the current
  schema: `ImageRecord` has no byte-size field, and neither Tier 1 (brief §6b) nor the research
  roadmap's Tier-1 list adds one. This is an inherited, already-made scope decision, not a new
  slicing defect — but it's currently just *silently* absent rather than documented as deferred.
  NTH-6 below.
- **`renderDivergence`** (computed by A2) is consumed by no rule in A3 or A4's inventory anywhere.
  Likely intentional "record now, rule later" Tier-1 scoping (matches the brief's framing exactly)
  — flagged as NTH-5, not a must-fix, but worth one confirming line in spec.md so it doesn't read
  as an oversight later.

---

## Must-fix summary (priority order)

1. **MF-1** — `src/storage/runStore.ts` unowned; A2 needs it for external-links.json write +
   dual static-HTML storage. → add to A2's Owns.
2. **MF-2** — v2 ExtractionResult fields are non-optional in types.ts but absent on ~50 pre-v2
   stored runs; `loadAllPages()`'s bare type-cast means any rule/reader that skips its own presence
   guard throws instead of degrading. → Main Claude (types.ts optionality and/or a RunStore
   read-time backfill), affects A2/A3/A4.
3. **MF-3** — canonical-target-validity and broken-internal-links (SPEC §6) have no owner; both
   need cross-page lookups A3's per-page rules structurally cannot do. → add both to A4.
4. **MF-4** — A3's structured-data scope omits required-property-by-type checks, silently dropping
   1/3 of seeded manifest item #11 (Product JSON-LD missing `offers`). → add to A3.
5. **MF-5** — analyzer-gate's "clean pages" false-positive universe is undefined, and nothing
   requires heuristic rules to default to non-error severity, which is the only thing keeping the
   false-positive bar safe; separately, A5 promises evidence jump-links that have no display target
   for social/hreflang/pageStats fields. → define the clean-page derivation + severity-floor rule
   in A3/A4's scope; narrow or extend A5's jump-link promise.

## Nice-to-have (fold into spec.md text, non-blocking)

- NTH-1 — reconcile A4's 5% near-dup default against evidence-check.ts's existing 20% pass-bar for
  the same seeded pair; pick one canonical number (real fixture delta is ~0.6%, so no live bug
  today, just drift risk).
- NTH-2 — `issues-sample.json` fixture: every issue uses a distinct ruleId; add 1-2 more sharing an
  existing page-scope ruleId across different pageIds so A5's group-by-rule → affected-count →
  expand-to-URL-table UI gets exercised before A4 lands.
- NTH-3 — A1 owns the entire `src/extraction/**` tree (not just new v2 files); add an explicit line
  that the full existing extraction test suite must pass, not just new v2 fixtures.
- NTH-4 — A2's renderDivergence paragraph undersells that the current crawl.ts architecture
  discards the static pass's HTML/extraction (only a `signals: string[]` survives into the
  escalation pass) — real engineering, confined to A2's own file, worth flagging up front.
- NTH-5 — confirm `renderDivergence` is intentionally record-only (no consuming rule) for this
  wave.
- NTH-6 — document "large images / per-image byte size" as an explicit deferred gap (schema has no
  field for it) rather than a silent absence.
