# Plan Review — POC-2 wave (A1-A5) — Round 2 (diff check, concurrent with fan-out)

Generators A1-A5 assumed already running. This is a diff check against Round 1's 5 must-fixes,
not a re-read of the whole plan. Anything Round 1 marked OK (A1/A2 seam, A5 fixture
representativeness) is NOT re-litigated here.

## Verdict: APPROVED

All 5 must-fixes verified landed correctly, with direct evidence (not just text search):

- **MF-1** (A2 owns `runStore.ts`, extend-only) — confirmed in spec.md line 207-209: A2's Owns
  line explicitly lists `src/storage/runStore.ts (EXTEND, don't rewrite — plan-review MF-1: add
  saveStaticRaw + saveExternalChecks; keep every existing method byte-compatible)`. The generic
  do_not_touch clause ("any directory owned by another slice") now protects it from A1/A3/A4/A5.
  Landed correctly.
- **MF-2** (v2 fields optional, undefined≠empty contract) — read `src/models/types.ts` directly
  (lines 174-202): `social?`, `hreflang?`, `metaRefresh?`, `metaKeywords?`, `pixelWidths?`,
  `pageStats?` are all optional, with an explicit contract comment ("readers MUST treat undefined
  as not captured... never conflate with an empty capture. New writes always populate them").
  `renderDivergence` on `CrawledPage` (line 217) is likewise optional with the same discipline.
  Confirmed `tsconfig.json` has `strict: true`, so this optionality is compiler-enforced, not just
  documentation — a rule author who forgets a presence guard on an optional v2 field gets a
  build error, not a runtime crash on old runs. This resolves MF-2 via approach (a) alone, which
  MF-1's own text allowed ("and/or"). Landed correctly, no residual gap.
- **MF-3** (canonical-target validity + broken internal links → A4) — confirmed spec.md line
  250-251: A4's site-rule scope now explicitly lists both, with the cross-page mechanism named
  (`canonical → 4xx/5xx/redirect/noindex`, `link targetNormalized → failure record / 4xx page`).
  Landed correctly.
- **MF-4** (A3 structured-data required-property checks) — confirmed spec.md line 229-232: A3's
  scope now lists `required-property checks for common @types — Product needs offers, Article
  needs headline, FAQ needs mainEntity` with an explicit call-out that seeded #11c must be
  detectable. Landed correctly.
- **MF-5 / MF-5b** (gate precision + severity discipline + A5 jump-link restriction) — confirmed
  all three sub-parts: (1) spec.md line 256-263, A4's gate now has an explicit
  manifest-item→ruleId→expected-minimum-severity table requirement and a programmatic "clean
  pages" derivation ("crawled 2xx pages ... whose source files carry ZERO `seeded:` comments,
  derived from the live grep") that matches brief.md's own line 165-168 acceptance-gate wording
  exactly — no drift between brief and spec. (2) spec.md line 233-236, A3's scope now states the
  severity floor explicitly ("heuristic/threshold rules... MUST default warning or notice").
  (3) spec.md line 271-274, A5's scope now restricts jump-links to fields with an existing display
  section and mandates inline rendering for social/hreflang/pageStats evidence. All three landed
  correctly.

## New findings this round (both non-structural — do not interrupt the running fan-out)

**F1 — NON-STRUCTURAL, integration-pass item.** Making the v2 `ExtractionResult` fields optional
(MF-2's fix) removes the compiler's ability to catch A2 silently dropping a v2 field when it
assembles `CrawledPage` from A1's `ExtractionResult` output. If A2's assembly code sets fields
individually rather than spreading A1's full `ExtractionResult` object, `pageStats`/`social`/
`hreflang` etc. could be silently omitted on new writes with no type error (optional fields make
omission legal) — quietly violating the "new writes always populate them" comment-only contract
in types.ts. Not a slice-boundary issue (A2 is the sole owner of the assembly code either way).
Fold into the integration pass: Main Claude should spot-check that A2's `CrawledPage` construction
spreads the full extraction result (or add one integration test asserting a fresh non-pre-v2 run's
stored page JSON has all v2 keys present).

**F2 — NON-STRUCTURAL, integration-pass item.** MF-5's addition makes A4's gate table more rigid
(an explicit manifest-item → exact-ruleId → expected-severity table), which means A4's gate
literally needs A3's final page-rule ID strings to compile a correct table — and no shared ruleId
naming convention is declared anywhere in spec.md. This dependency already existed in the
pre-MF-5 design (the gate always needed to map manifest items to rule ids across both A3's page
rules and A4's own site rules), and the gate has always been an integration-time artifact by
construction (A4 cannot fully verify PASS rows until A3's page rules are physically merged in) —
so this is not a new slice-boundary problem, just a reconciliation task. Fold into the integration
pass: Main Claude reconciles A4's gate ruleId string literals against A3's actual final page-rule
IDs once both land; this is a literal-string edit, not a re-slice.

No STRUCTURAL findings. No slice needs redirecting.
