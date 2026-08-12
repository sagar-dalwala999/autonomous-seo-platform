# Plan Review — Round 1 — seo-crawler-poc (POC-1: Crawler)

Reviewed: `sprints/brief.md`, `sprints/spec.md`, `sprints/intake.json`, `sprints/phase-state.json`,
source plan `docs/phase 1_POC_crawler.md`, `SPEC.md` §4, and the actual `poc/target-site/` fixture
tree (all 18 seeded-manifest pages, `next.config.ts`, `public/robots.txt`, `public/sitemap.xml`).

Tier A (greenfield), so Q6 (qa_user_test_creds) and Q7 (Tier-B do_not_touch.json) are adapted
rather than applied literally — noted below.

## Per-question verdicts

### Q1: Is the MVP-prototype scope actually carved out?
- **Verdict:** PUSH BACK
- **Class:** NON-STRUCTURAL
- Relative to the full platform (SPEC.md), the carve-out is real: brief §7 correctly defers 90%+
  of the eventual system (Postgres/Redis/queues/AI/GSC/competitor analysis/GitHub PRs/deploy).
  That part is fine — not a relabeled full inventory.
- But relative to the plan doc's OWN internal recommendation, the brief silently overrides it. The
  plan doc is explicit and repeated: §25 "our first milestone should be extremely small... don't
  try to finish all of this before seeing results," and §28 "Let's start with Phase 1 + Phase 2
  only... run it against one small real website, inspect every output, fix the crawler, and only
  then add sitemap/robots/Playwright." The brief instead treats the plan's full §27 checklist
  (all 8 phases: discovery, URL processing, HTTP, extraction, browser/JS-render, reliability,
  storage, benchmark) as this build's single-pass MVP (brief §6: "The plan doc §27 checklist IS
  the acceptance contract").
- This is a defensible call given this workflow parallelizes independent slices instead of building
  sequentially — the plan's incremental "prove it small, then expand" discipline exists to protect
  a *solo sequential* builder from wasted rework, which a 6-way parallel fan-out doesn't need in
  the same way. But brief §8 ("Phase 0 assumptions... correct anything wrong at review") lists six
  assumptions and omits this one. Since the brief's own header states the plan doc "IS the
  requirements spec," a methodological override of an explicit, repeated recommendation in that
  doc should be a named, flagged assumption, not a silent one.
- **Fix:** Add to brief §8: "Deviates from plan §25/§28's incremental single-milestone-first
  approach — full §27 scope is built in one parallel pass because slices are independent, not
  sequential; the plan's 'prove small first' discipline is replaced by 6-way parallel fan-out +
  Main Claude integration."

### Q2: Is every sub-Generator slice independent?
- **Verdict:** PUSH BACK
- **Class:** STRUCTURAL
- File ownership is clean — no two slices write the same path (S1 `src/url/**`, S2
  `src/extraction/**`+`tests/fixtures/**`, S3 `src/discovery/**`, S4 `src/crawler/**`+
  `src/detection/**`+`src/index.ts`, S5 `src/storage/**`+`src/report/**`, S6 `scripts/**`). No
  file-conflict pushback needed there.
- **S4 is too coarse and it's the wrong kind of coarse.** It bundles three concerns that don't need
  to travel together: (1) CLI arg parsing, (2) Crawlee orchestration (RequestQueue + CheerioCrawler
  + PlaywrightCrawler wiring, robots gate, redirect capture, enqueue logic, failure classification
  integration), and (3) the JS-detection heuristic (tiny-body / app-shell markers / text-to-markup
  ratio / framework-markers-with-empty-roots / zero-same-domain-links). Spec.md itself calls S4
  "the integrator's biggest risk" — that's the tell that its surface is too large for one parallel
  Generator to land cleanly in one pass.
- Answering the question directly asked: **splitting JS-detection out helps, it doesn't just create
  a seam inside one runtime flow.** The calling pattern S4→detection would be identical to the
  calling pattern S4 already uses for S1/S2/S3/S5 (call a stubbed pure function, get a typed
  result) — no new kind of integration risk is introduced, because `needsJsRendering(html, url,
  meta)` is a pure function over already-fetched data, structurally no different from S2's
  extractors. What it buys: (a) it gets the same fixture-driven unit-testing rigor S2 gets for its
  seeded-issue shapes (S2's scope explicitly enumerates ~13 HTML fixture shapes; S4's scope gives
  JS-detection zero dedicated fixtures, it's folded into the orchestration slice's general test
  effort); (b) it shrinks the owned surface of the single highest-risk slice, which is exactly what
  you want to do when a slice is self-flagged as the integration risk; (c) the workflow targets 4+
  parallel agents — going from 6 to 7 slices is not a scaling problem.
- **Fix:** Split `src/detection/**` (+ its own `tests/unit/detection/**`) out of S4 into its own
  slice with `depends_on: []`, `parallel_safe_with: [all]`, coding against a foundation stub
  `needsJsRendering(html, url, meta): { needsRender: boolean; reasons: string[] }`. S4 keeps CLI +
  orchestration and calls the stub exactly as it already calls S1/S2/S3/S5.
- **Non-structural addendum (fold in, don't block):** `tests/fixtures/**` is owned solely by S2, but
  S3's scope also needs fixture XML (urlset/index/malformed/gzip) and has no shared fixtures
  directory of its own — it will presumably nest fixtures under its own `tests/unit/discovery/**`,
  which is not a collision but is an inconsistent convention vs. S2's top-level shared-looking
  folder. Clarify in spec.md that `tests/fixtures/**` is HTML-only (S2's), and each other slice
  nests its own format-specific fixtures under its own owned tree.

### Q3: Are the stub interfaces sufficient as the cross-slice contract?
- **Verdict:** OK
- The shared data contract (`src/models/*.ts`) is fully enumerated in Foundation and is the right
  thing to nail down first. Per-slice prose is unusually precise for a POC brief (explicit
  null-return rules on `normalizeUrl`, explicit alt null-vs-empty distinction, explicit sync/async
  implications from context) — a Generator can derive an unambiguous signature from it in most
  cases.
- **Nice-to-have, not blocking:** spec.md never states the sync/async-ness of `extractPage` and the
  detection function explicitly (both are inferable — pure/no I/O — but "inferable" is not "stated
  once, referenced everywhere"). Since Main Claude writes all stub files pre-fan-out from this
  prose in one pass, one explicit line per function ("sync, pure" / "async") in spec.md would remove
  the single point of translation risk. Optional.

### Q4: Are dependencies declared correctly?
- **Verdict:** PUSH BACK
- **Class:** STRUCTURAL
- Every sprint declares `depends_on: []` and `parallel_safe_with: [all others]` — correct on paper,
  since no slice consumes another's runtime output (all code against stubs). No spurious
  sequential dependencies to flag.
- **But there is a real, undeclared cross-slice contract gap, and it is not cosmetic — it breaks
  acceptance-criteria verifiability.** I read the actual `target-site` fixtures (not just the
  brief's description of them). The seeded site's content bakes in a fictional *production* hostname
  that is different from the *actual bench-run transport*:
  - `public/robots.txt` declares `Sitemap: https://summittrailgear.example/sitemap.xml`
  - `public/sitemap.xml` lists every URL as `https://summittrailgear.example/...`
  - Seeded manifest items #15b/#15c are literal `<a href="http://summittrailgear.example/contact">`
    and `<a href="https://www.summittrailgear.example/guides">` absolute links embedded in page
    content (confirmed in `app/about/page.tsx`, `app/page.tsx`, `app/blog/page.tsx`,
    `app/products/page.tsx`).
  - But S6's bench harness serves this site locally on **port 3105**, and neither brief.md nor
    spec.md states what `startUrl` the bench run actually passes to the CLI. The only sane choice
    is `http://localhost:3105`.
  - Under S1's `deriveScope`/`isInScope` (registrable domain via tldts), `localhost` and
    `summittrailgear.example` are **different registrable domains**. That means:
    1. **Manifest #15b/#15c are unverifiable as evidenced.** Brief §2 point 2 and §6 both frame
       these as links whose "crossing is preserved in evidence" as an internal/same-site
       phenomenon (www/non-www, http/https) — but under a `localhost:3105` scope root they will be
       classified `type: "external"`, not evidence of an in-scope protocol/subdomain crossing.
    2. **The sitemap cross-reference (§27 checklist "Sitemap discovered" / brief §6 manifest #14 —
       the 404 entry + 4 omitted-but-linked pages) cannot match anything.** S5's
       `sitemapCrossRef` compares crawled-page normalized URLs (all under `localhost:3105`) against
       sitemap-declared URLs (all under `summittrailgear.example`) — zero overlap by construction,
       so `in-sitemap-not-crawled` / `crawled-not-in-sitemap` would report the wrong sets on the
       one target designed specifically to test this feature.
  - (Manifest #15a, canonical pointing at an unrelated product URL, is unaffected — canonical is
    stored as an opaque string, no scope-matching involved.)
  - (robots.txt's `Disallow: /guides/` is also unaffected — it's a path rule against whatever
    origin robots.txt was fetched from, host-agnostic.)
  - This is a genuine three-way contract gap: S1 owns scope logic, S4 owns what `startUrl` the CLI
    accepts, S6 owns what `startUrl` the bench run passes — and none of the three currently owns
    "how does a bench run against a fixture whose content is written as if it were a different
    production host reconcile identity with the host it's actually served on." It is silent
    failure, not a crash — the run will complete, the report will look plausible, and 3 of 18
    seeded-evidence items will simply be wrong without anyone noticing until a human reads them.
- **Fix (pick one, assign explicit ownership in spec.md — this is a structural/contract decision,
  not an implementation detail I'm prescribing):**
  - (a) Add a `CrawlOptions` field / CLI flag that lets a crawl treat a declared "canonical host"
    (from robots.txt/sitemap/absolute links) as scope-equivalent to the actually-crawled host for
    bench runs, with S1 and S4 both aware of it, OR
  - (b) Document as an explicit brief §8 assumption that these specific manifest items (#14 sitemap
    cross-ref, #15b, #15c) will show as `external`/non-matching under a `localhost` bench run, and
    that this is accepted as a known POC-vs-fixture limitation rather than a verified pass, OR
  - (c) Have S6 map the fixture's declared hostname to `127.0.0.1` (hosts-file or equivalent) and
    serve/crawl under `http://summittrailgear.example:3105` instead of `localhost:3105` — if chosen,
    this must be stated as S6's scope, since it's currently undocumented and mildly risky
    (hosts-file edits) for an unattended run.
  Whichever is chosen, it must be named in spec.md/brief.md before the fan-out, because it changes
  what S1's scope function must accept and what S6 must pass — a contract both slices need at
  build time, not something Main Claude can patch invisibly at Integration.

### Q5: Is `surface:` declared?
- **Verdict:** OK — `surface: cli` present in brief.md header.

### Q6: `qa_user_test_creds:` for handover multi-user tools
- **Verdict:** OK / N/A — correctly single-user CLI, `qa_user_test_creds: n/a (single-user CLI)`
  stated explicitly in brief.md header.

### Q7: `do_not_touch:` completeness (Tier B)
- **Verdict:** OK — adapted, Tier A per intake.json (not a Tier-B retrofit, no `do_not_touch.json`
  formally required). Checked spec.md's `do_not_touch` section for hygiene anyway, since it's
  protecting a pre-existing sibling project (`target-site`) that this build does not own:
  `sprints/**`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/models/**`,
  `../target-site/**` source, plus implicit per-slice directory exclusivity. Reasonably complete.
- **Non-structural nit:** `.gitignore` (a Foundation-owned file) isn't explicitly named in
  `do_not_touch` — negligible risk (nobody has a reason to touch it) but cheap to add for
  completeness alongside the other three named config files.

### Q8: `build_class`, `qa_depth`, `capabilities:` present and correctly derived?
- **Verdict:** PUSH BACK
- **Class:** STRUCTURAL
- All three fields are present in brief.md and match spec.md's implied scope (no drift between the
  two docs) — that part is fine.
- **`capabilities:` — re-derived, correct as declared.** Checked `package.json` deps (crawlee,
  playwright, cheerio, robots-parser, fast-xml-parser, tldts — no DB/auth/secrets client anywhere)
  and the actual scope: no persistence beyond flat files this tool writes itself (not a `db`
  capability), no auth, no API routes exposed by this tool itself (target-site's Next server is a
  test *fixture* it crawls, not this tool's own API surface), no deploy, no secrets, no background
  jobs. All six `no` values check out.
- **`qa_depth: standard` — re-derived, currently self-consistent, but fragile.** None of the hard
  `deep` triggers fire on the CURRENT 6-slice spec: `dangerous_actions: []` (correct, read-only
  GETs), single-user, Tier A not Tier B, exactly 6 slices (not >6). "Reads production data" is a
  judgment call — this crawls real public sandbox sites (`books.toscrape.com`,
  `quotes.toscrape.com`, both purpose-built for scraping practice) — I read that as NOT
  "production data" in the sense the rule means (a real business's live data), so `standard` holds
  as declared, on the spec as currently sliced. **But this is contingent on slice count staying
  ≤6.** If Q2's split (pulling `src/detection/**` out of S4 into its own slice) is adopted, slice
  count becomes 7, which crosses the literal ">6 slices → deep" trigger. Main Claude must re-check
  `qa_depth` against the FINAL slice count after resolving Q2, not against the current draft.
- **`build_class: greenfield-crud` — mis-derived. This is the actual pushback.** Re-deriving from
  the brief: this tool has zero create/read/update/delete operations on any user-facing persisted
  record — no forms, no user-editable data model, nothing a user "manages." It is a one-shot batch
  pipeline (discover → fetch → extract → classify → store → report) fronted by a CLI, built from 6
  parallel algorithmic slices (URL normalization, cheerio extraction, robots/sitemap parsing,
  hybrid Crawlee+Playwright orchestration, evidence storage/reporting, a benchmark harness against
  a live ~1000-page site). None of that is "CRUD." Labeling it `greenfield-crud` pulls in whatever
  this workflow's CRUD-shaped time envelope is — brief's own stated target/ceiling (40 min / 100
  min) reads like a CRUD-scaffold number, not a number that was derived from the actual described
  scope (hybrid static+headless-browser crawler, URL/sitemap/robots edge cases, JS-heuristic
  detection, redirect-loop classification, a 6-slice integration, plus a real benchmark run against
  ~150–1000 live external pages). Whatever this workflow's correct enum value is for a CLI/batch
  data-processing build (not a CRUD app, not a UI app), it should be re-derived and the
  target/ceiling re-justified against the actual scope, not inherited from a mismatched category.
- **Fix:** Change `build_class` off `greenfield-crud` to whatever this workflow's taxonomy calls a
  CLI/batch/data-pipeline build, and re-justify (or explicitly widen) the 40/100 min target/ceiling
  against the real 6-slice scope. Re-check `qa_depth` against the final slice count once Q2 is
  resolved.

## Overall verdict

**REVISE** — 3 STRUCTURAL pushbacks (Q2, Q4, Q8), 3 NON-STRUCTURAL (Q1, Q2-addendum, Q7-nit).
Main Claude resolves the STRUCTURAL items in spec.md/brief.md, then fans out. The
NON-STRUCTURAL items should be folded into the same edit pass since it's cheap, but they don't
independently justify a second review round.

## If REVISE: priority order of fixes

1. **Q4 — host/canonical-domain contract gap.** Highest priority: this is the only finding that
   fails silently. Without a fix or an explicit documented acceptance, the bench run will complete,
   look successful, and produce a POC-1-REPORT.md that misrepresents 3 of 18 seeded-evidence items
   (#14 sitemap cross-ref, #15b, #15c) as untested/failed when the actual crawler logic may be
   correct — or as passed when it isn't. Assign ownership (S1/S4/S6) before fan-out.
2. **Q2 — split `src/detection/**` out of S4** into its own slice, reducing the owned surface of
   spec.md's self-flagged highest-risk slice and giving JS-detection the same fixture-driven test
   rigor S2 already gets.
3. **Q8 — re-derive `build_class`** off `greenfield-crud`, re-justify the 40/100 min target/ceiling
   against real scope, and re-check `qa_depth` once final slice count is known.
4. **Q1 — non-structural** — add the plan-§25/§28 deviation as a named brief §8 assumption.
5. **Q2-addendum / Q7-nit — non-structural** — clarify `tests/fixtures/**` is S2/HTML-only; add
   `.gitignore` to the `do_not_touch` list for completeness.
