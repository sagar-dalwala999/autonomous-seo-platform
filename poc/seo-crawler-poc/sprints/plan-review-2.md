# Plan Review — Round 2 — seo-crawler-poc (POC-1: Crawler)

> Concurrent with Phase 2 fan-out. S1-S7 are already running. This is a diff check against
> Round 1's 3 structural + 3 non-structural findings — not a re-read of the whole plan. Verified
> by reading `plan-review-1.md`, the revised `brief.md`/`spec.md`, and the three named
> contract/stub files (`src/models/types.ts`, `src/url/scope.ts`, `src/storage/runStore.ts`).

## STRUCTURAL FINDING — the Q4 fix is incomplete. Affected slices: S5 (primary), S4 (primary), S3 (secondary).

Round 1's Q4 was the highest-priority finding: without a host-alias mechanism, the sitemap
cross-reference and two seeded-evidence items would silently mismatch. The diff claims this landed
end-to-end, including "S5 sitemap cross-ref matches by pathname+search (host-agnostic)." That
specific claim does not hold up against the actual spec.md text — I grepped `spec.md` for
`pathname`, `host-agnostic`, `hostAliases`, `remap`, `alias` and the only hits are in S1's and S4's
scope blocks. **S5's scope block (the slice that owns `sitemapCrossRef`, the exact function Q4 was
about) contains zero mention of hostAliases, remapAliasedUrl, or any host-reconciliation logic.**
S3's scope block (sitemap fetch/parse) contains zero mention either.

What's actually solid:
- `CrawlScope.hostAliases` / `CrawlOptions.hostAliases` — landed correctly in `types.ts`.
- S1's `remapAliasedUrl` — landed correctly in `scope.ts`, including the www-variant match via
  `stripWww`/`matchesAlias`, and it rewrites scheme+host+port onto `seedOrigin` while leaving
  pathname/search/hash untouched (correct behavior for the function itself).
- S4's `--alias` CLI flag and "enqueue discovered in-scope links (alias-remapped via S1)" — this
  covers HTML-link discovery correctly (the target-site's embedded absolute links to
  `summittrailgear.example` found *during* extraction of an already-fetched page).

What's missing or ambiguous, tracing the pipeline forward:

1. **S4 — sitemap-URL seeding is ambiguous, and the ambiguous reading breaks the crawl, not just
   the evidence.** S4's scope says: *"seed queue (start URL + sitemap URLs w/ discoverySources)"*
   — no remap annotation — followed later by *"enqueue discovered in-scope links (alias-remapped
   via S1)"*, which does have one. A Generator reading this literally will seed the initial
   request queue with the raw sitemap-declared URLs (`https://summittrailgear.example/...`), and
   Crawlee will attempt to actually fetch them. `summittrailgear.example` does not resolve — every
   sitemap-only-seeded request fails with a DNS/connection error. This is not a cosmetic
   evidence-mismatch risk like the rest of Q4 was; if S4 reads the ambiguity the wrong way, real
   requests fail. (It's likely masked in practice because most sitemap URLs are presumably also
   reachable via the HTML-link path, which *is* correctly remapped — but the brief's own §6 flags
   4 "omitted-but-linked" pages, implying the reverse case, sitemap-only URLs, is also part of the
   seeded manifest, so it can't be assumed away.)

2. **S3 — no alias awareness at all, so the robots-declared sitemap URL will be attempted as
   fetched, not as reachable.** `fetchRobots(origin)` will correctly return
   `Sitemap: https://summittrailgear.example/sitemap.xml` as a declaration (robots.txt itself is
   fetched from `localhost:3105`, that part's fine). But `discoverSitemaps` has no `hostAliases`
   parameter in its signature per S3's scope — if it tries the declared URL literally, that fetch
   fails, and per S3's own scope ("fetch errors preserved as evidence, never thrown") that failure
   lands in `SitemapResult.errors` as a spurious entry sitting next to the *genuine* seeded 404
   (`/guides/gear-repair`) that brief §6 explicitly calls out as an acceptance item. Even if the
   `/sitemap.xml`-on-origin fallback recovers the actual sitemap, the spurious error pollutes the
   evidence S6's bench report reads.

3. **S5 — `sitemapCrossRef`'s contract doesn't mention hostAliases at all, and this is the one
   place Q4 was originally raised about.** Spec.md's S5 scope: *"plus `sitemapCrossRef`
   (in-sitemap-not-crawled, crawled-not-in-sitemap, sitemap-404s)"* — no `scope` parameter, no
   remap step, no host-agnostic pathname+search comparison stated. `RunStore` (which I read in
   full) doesn't carry the alias-reconciliation logic either — it's a pure storage class. Whatever
   Main Claude intended by "matches by pathname+search, host-agnostic" is real in the summary
   handed to me but **is not written into spec.md**, which is the document S5's Generator is
   actually coding against right now. Left as-is, S5 will most likely build a direct string/URL
   comparison between `CrawledPage.normalizedUrl` (localhost-remapped) and
   `SitemapResult.entries[].url` (still `summittrailgear.example`, since S3 doesn't remap either)
   — zero overlap, reproducing the exact original Q4 bug the fix was meant to close.

**This is squarely a cross-slice contract gap** (S1 owns the remap primitive; S3, S4, S5 each need
to call it or design around it, and currently none of S3/S5 do, and S4 only partially does) — not
a wording nit. It changes a function signature (`sitemapCrossRef` almost certainly needs to accept
`scope` or pre-remapped sitemap entries) and a seeding-order decision in S4, both of which are
build-time decisions a running Generator needs now, not a Phase-3 cleanup item.

**Fix, named per slice (pick one mechanism, apply consistently — this is a contract decision, not
an implementation detail I'm prescribing):**
- S4: change *"seed queue (start URL + sitemap URLs w/ discoverySources)"* to explicitly say
  sitemap-seeded URLs are alias-remapped via S1 before being added to the queue, same as the
  HTML-link bullet already states.
- S3: either accept `hostAliases`/`scope` into `discoverSitemaps` and remap the declared-sitemap
  URL before fetching it (falling back to `/sitemap.xml`-on-origin only on a genuine failure), OR
  have the caller (S4) pre-remap the declared URL before invoking S3 — whichever, name it in S3's
  scope so its Generator doesn't build a fetch-then-error-then-fallback path that pollutes
  `SitemapResult.errors`.
- S5: add to its scope explicitly — either `sitemapCrossRef(pages, sitemapResult, scope)` remaps
  each sitemap entry via S1's `remapAliasedUrl` before comparing, or the comparison is done by
  pathname+search only (host-agnostic) as intended. State which, and state the parameter.

## Verified — Round 1 fixes that DID land cleanly

- **Q2 (split `src/detection/**` out of S4 into S7)** — landed correctly. S4 now owns only
  `src/crawler/**` + `src/index.ts`; S7 owns `src/detection/**` + its own fixtures/tests; S4 calls
  `S7`'s `needsJsRendering` as a stubbed pure function, same calling pattern as its other
  dependencies. Slice count is 7, consistent with the >6-slices `qa_depth` trigger cited in
  brief.md. No new file-ownership overlap introduced by the split.
- **Q8 (`build_class`/`qa_depth` re-derivation)** — landed correctly and matches the Round-1
  re-derivation exactly: `build_class: port` (parity bar = plan §27 + 18 seeded-evidence items,
  90/150 min), `qa_depth: deep` (comment correctly cites the >6-slices trigger, not a
  reads-production-data or dangerous-actions trigger, which is the right reason on this spec).
  `capabilities:` unchanged and still correct (re-checked, no drift).
- **Q1 (non-structural — plan §25/§28 deviation flagged)** — landed. Brief §8's final bullet
  ("Milestone ordering (plan-review-1 Q1)") names the deviation and the reasoning.
- **Q2-addendum (non-structural — fixtures convention)** — landed. `tests/fixtures/html/**` (S2),
  `tests/fixtures/xml/**` (S3), `tests/fixtures/detection/**` (S7) are each nested under a
  distinct, non-colliding path.
- **Q7-nit (non-structural — `.gitignore` in `do_not_touch`)** — landed. Present in spec.md's
  `do_not_touch` list.

## Overall verdict

**REVISE** — but scoped narrowly: this is a continuation of the same Q4 contract that was already
Round 1's top item, now found incomplete on the leg that matters most (S5) plus a live break-risk
on the leg that partially landed (S4's sitemap seeding) and an evidence-pollution risk (S3). It is
not a new category of problem; it's the same fix needing to finish threading through 3 more call
sites.

**Structural pushbacks: 1** (spans S3/S4/S5 as one contract gap)
**Non-structural: 0** (all 3 from Round 1 verified landed; no new non-structural items found)
