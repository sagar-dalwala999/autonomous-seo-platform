# QA-User — MVP Round 1

## Variant: ui
## Depth: deep (items 12-17 partially covered — see NOT TESTED notes; run truncated by a 600s watchdog)

**Tooling note:** No Playwright MCP tools were exposed to this agent (only Read/Write/Bash/WebFetch).
Equivalent coverage was achieved by driving real Playwright (headless Chromium) via a small local
HTTP control server (`qa-driver.mjs`, deleted after the run) invoked through `curl`, capturing the
same four signals: screenshot, DOM query, console messages, network requests. Server: built fresh
(`npm run build`) and started with `npx next start -p 3950` against
`D:\projects\autonomous-seo-platform\poc\seo-dashboard`. Screenshots referenced below are at
`C:\Users\VA-007\AppData\Local\Temp\claude\D--projects\6df8fb06-cc7b-4855-8884-6884eb3a1cfd\scratchpad\qa\shots\`.

**Run interrupted:** the coordinator flagged a 600s watchdog stall while I was mid-way through the
Stop-control investigation. That investigation is now conclusively finished (see Q1 / Practical
Issue #1). Everything below items 1-6 of the coordinator's priority list is reported from what I
actually completed; anything I did not get to is marked **NOT TESTED**, not inferred.

---

## Mental framework walkthrough

### Q1: Can I do the thing the brief said?

**Verdict: FAIL** (one specific, critical step of the described workflow is unreachable — everything
else in the workflow passes).

Walked the real workflow end to end against the sanctioned live target `http://localhost:3105`:
New Crawl form → filled Start URL, selected "Entire site", selected render mode → **Start crawl** →
live progress panel → completion → **View run** → Overview (health score) → Activity (per-request
log) → Issues (grouping/filtering/evidence) → Page detail (evidence dot-paths) → Images.

Every one of those steps worked correctly and is evidenced below (Practical Issues / Positives).
The one step that does **not** work: **there is no reachable Stop control anywhere in the UI while
a crawl is running.** See Practical Issue #1 (critical) for full evidence — this directly breaks
MVP Acceptance Criterion #2 ("Pressing Stop halts outbound requests") and Core Element #1 ("watch
it live, stop it, and have it genuinely stop").

Score sanity (AC#3, coordinator priority #2): my own fresh crawl of the seeded site
(`ui-20260813-203032`, Auto render mode, Entire site) scored **19.1/100** on load
(screenshot `08-run-overview.png`) — squarely inside the brief's target ("scores in the 20s";
external tools scored 20/61/65; predecessor scored 88.8 and that's called a failed build). This is
the single most important number in the brief and the deployed build gets it right.

### Q2: First-login empty state

**NOT FULLY TESTED.** Navigating to `http://localhost:3950/` landed directly in a populated
dashboard (113 runs already on file) with no login screen encountered at any point in this session.
The brief specifies Supabase Auth with a seeded `qa-user` account; I saw no auth gate at all. Per
the coordinator's note, another agent is adding authentication concurrently — this could be
"not wired yet" rather than a defect I'm entitled to flag against this round's build. Recorded as
an **observation, not a bug** — flag for a follow-up round once auth lands.

I could not test a genuine first-crawl / zero-runs empty state without deleting existing run data,
which is outside my permitted actions (`dangerous_actions` explicitly lists deleting a crawl run and
its artifacts). The New Crawl page's own sub-panel empty state ("No crawl running — Fill out the
form and submit to see live progress here.") is friendly and appropriate (screenshot `03-new-crawl.png`).

### Q3: What breaks on weird input?

**PARTIAL.** Tested: compound filter combinations (severity + area on Issues), a 1,195-row table at
full scale (sort, scroll, keyboard nav), an "Entire site" + "Always" (force-Chromium-per-page) crawl
configuration end to end (twice). All handled cleanly, no console errors, no crashes.

**NOT TESTED** (ran out of time before the watchdog interrupt): empty/blank Start URL submit, huge
(10KB) URL input, emoji/special-char input, browser back/forward mid-crawl, rapid double-click on
Start crawl (concurrent-submit race).

### Q4: Does output match what was generated?

Not a media tool (`imagery: no` in brief — the audited site's own screenshot is the imagery, and
screenshot capture defaults OFF). Data-output check: my fresh crawl's Activity log line items
(real per-request timestamps, real status codes) matched the Overview summary counts exactly
(18 success / 4 failed / 2 blocked = 22 attempted) and matched the Issues screen's evidence text
verbatim (e.g. `http://localhost:3105/ links to http://localhost:3105/gear-sale, which fails (404)`
appears identically in the Activity log, the Issues finding, and the Page Detail evidence panel).
Real, consistent, cross-referenced data — pass.

### Q5: Intuition bucket

- Two different things are both labeled "Confidence" on the Issues "By priority" view: the
  aggregate priority-model score (e.g. "Confidence 90%") vs. the per-finding automation-classifier
  confidence ("Confidence —", not computed this run). Same word, two different meanings, same
  screen. — **[owner-opinion]** Would a distinct label for one of them (e.g. "Model confidence" vs
  "Classifier confidence") read more clearly?
- Reaching the Pages table via keyboard alone takes roughly 80 Tab presses from page load (full
  sidebar, then up to 51 depth-filter chips 0–50, before the table). No "skip to content" link. —
  **[owner-opinion]** Worth a skip-link, or is this an acceptable cost given the sidebar is small
  next to the value of exhaustive depth filters?
- The "Since last crawl" comparison table's Area column is always "—" even though every rule shown
  has a known, static area (visible correctly one tab over, on "By area"). Reads like missing data
  even though it isn't. — **[owner-opinion]** worth populating since the data is already known.

### Q6: Design DNA

**Not applicable as specified.** brief.md explicitly overrides the standard design-system checklist:
`design_system: port-from-predecessor` — "NOT BMW M... ports the predecessor dashboard's own design
system... Tailwind v4 @theme tokens, light/dark/system theming, hand-rolled primitives... with its
alignment defects corrected rather than reproduced." The dark-stage/glow/Manrope your-design-system
checklist in my standing instructions is for a different design system than this brief specifies, so
I did not run it. General visual impression: clean, consistent light theme throughout every screen
visited, no layout breakage, no FOUC, tables and cards align consistently screen to screen.

### Q7: What's good?

- Fresh crawl scored **19.1/100** — matches the brief's core success measurement precisely.
  (`08-run-overview.png`)
- Honest "unavailable" vs. fake-zero handling, seen repeatedly and consistently: "Not available"
  measurement cards with real, specific reasons ("No per-page byte-weight field is stored on
  CrawledPage yet — awaiting crawler §8 asset/page-size instrumentation"); "5 rules skipped — data
  not captured in this run: canonical-changed-by-js, ..." disclosure on Issues; "Not classified for
  this run — run `npm run analyze:automation`" instead of silently faking a fix-type value.
  (`12-measurements-bottom.png`, `14-issues.png`)
- Evidence trail is real and resolves: Page Detail shows genuine dot-paths
  (`links[14].targetNormalized`) tied to actual stored data, with plain-language fix guidance under
  every finding. (`22-page-detail.png`)
- Issues screen's "By area" / "By priority" / "Worst pages" tabs (3 of the 4 required groupings all
  work correctly on the first, default view) including a real computed priority-score breakdown
  (Severity 100% / Reach 100% / Page importance 57% / Confidence 90%). (`16-issues-priority-recheck.png`,
  `17-issues-worstpages.png`)
- Filter chips are accurate everywhere tested except one tab (see Practical Issues): Activity
  4xx(9) matched exactly, Images "Missing alt (3)" matched exactly, Issues "Error (12)" on the
  default "By area" tab matched, and severity+area chips compose correctly together (AND logic).
- Keyboard access to the 1,195-row Pages table works end to end: real `<a href>` per row (not a
  `<tr onClick>` anti-pattern), a visible focus ring on the link once reached, and Enter genuinely
  navigates to Page Detail. Verified via real keyboard `Tab`/`Enter`, not just DOM inspection.
  (`30-row-focus-ring.png`)
- Sort works correctly on the full 1,195-row table, verified ascending and descending on two
  different columns (Words, Response). (`26-pages-sort-words.png`, `28-pages-sort-response.png`)
- Activity log gives real per-request evidence at both small (22 rows) and larger scale: genuine
  wall-clock timestamps, real status codes (200/404/401), clickable URLs, filterable by status and
  event kind, counts match "N of 30 events" exactly. (`09-activity.png`, `10-activity-4xx.png`)
- Zero console errors or 4xx/5xx from the dashboard's own app shell across ~10 screens visited; the
  only 404s seen in the console were the target site's own deliberately-broken image asset, which
  the dashboard correctly surfaces as evidence rather than hiding.
- Both the small (22-row) and large (1,195-row) datasets render instantly with no visible jank.

### Q8: Would I use this tomorrow?

Yes for the audit/analysis side — Issues, Page Detail, Measurements, and Activity are all strong
enough that a consultant could act on findings without editing them, which is the brief's core
success measurement. But the missing Stop control is a real trust problem, not a cosmetic one: a
consultant pointing this at a live, unfamiliar client site has no way to abort a crawl from the UI
once it starts, which is exactly the scenario the brief calls out as a make-or-break Core Element.
**That is the single biggest blocker to using this tomorrow.**

---

## Practical issues: reproducible bugs

1. **No reachable Stop/Cancel control anywhere in the UI during a running crawl.** — **[critical]**
   Breaks MVP Acceptance Criterion #2 verbatim ("Pressing Stop halts outbound requests — asserted by
   a test, not by the UI going quiet") and Core Element #1 ("watch it live, stop it, and have it
   genuinely stop").
   **Repro:** New Crawl → `http://localhost:3105` → Entire site → Render mode "Always" (forces
   per-page Chromium so the run takes 20-40s, long enough to observe the running state) → Start
   crawl. While the "Running" badge is showing (screenshots `33-crawl-running-top.png`,
   `35-crawl-running-check-stop.png`), ran two independent verification passes:
   - Text-based scan of every `<button>`/`<a>` on the page for "stop|cancel|abort" (case-insensitive):
     zero matches — only the "Up to a limit" radio button's own label text matched the regex on
     "Stop after a set number of pages" (a false positive from the page-limit control, not a
     control that stops a crawl).
   - Full-document scan of every `<button>`/`<a>`/`<svg>` for an `aria-label` or `title` attribute
     (to catch an icon-only control my text search would miss): 18 results, all identified —
     sidebar nav items, the three ON/OFF toggle switches (Respect robots.txt / Capture screenshots /
     This site needs a login), and "Open navigation". None relate to stopping a crawl.
   - Repeated on a second, independent live run (`ui-20260813-204325`) with the same result: the
     only enabled buttons anywhere in `<main>` while a crawl is running are the (disabled) form
     radios/switches; after completion, the only new buttons are "Start another crawl" and "View
     run".
   - Also checked the Crawl Queue screen (`34-queue.png`) — job history table shows `done`/`failed`
     state per run with no in-flight stop affordance either.
   The build output (`npm run build`) lists a working `/api/crawls/[runId]/cancel` route, so the
   capability likely exists server-side — it is simply not wired to anything a user can click. An
   unreachable cancel endpoint fails this acceptance criterion exactly as surely as a broken one.
   **NOT TESTED:** whether the Overview or Activity screens specifically show a stop affordance
   *only* during a run (I checked those screens after completion, not mid-run) — but since the
   sidebar/header is shared layout across all routes and showed no stop control on New Crawl (where
   a "watch it live" panel actually renders), I have high confidence the answer is the same
   elsewhere. Flagging this residual gap explicitly rather than asserting full certainty.

2. **Issues screen "Since last crawl" tab ignores the active severity filter.** — **[minor]**
   The default "By area" tab (and "By priority", "Worst pages") correctly apply the SEVERITY chip
   filter — verified: selecting "Error 12" on "By area" shows only error-severity rows summing to
   12 (screenshot `20-issues-byarea-error.png`). But on the "Since last crawl" tab, with "Error 12"
   selected, the comparison table shows rows whose Severity column reads `notice` (e.g.
   `auth-required-link | notice | 0 | 21 | -21 | resolved`) — confirmed by direct row-text
   extraction, not just a screenshot glance. Core default workflow is unaffected since "By area" is
   the landing tab and works correctly; this is isolated to one of four tabs.

3. **Raw ANSI escape codes leak into the New Crawl "Log tail" panel.** — **[minor]**
   Visible literally as `␛[32mINFO␛[39m ␛[33mPlaywrightCrawler:␛[39m Starting the crawler.` instead
   of being stripped or rendered as color (screenshot `33-crawl-running-top.png`). Cosmetic only —
   the log content itself is legible and real.

4. **"Since last crawl" tab's Area column always shows "—".** — **[minor]** Every rule in that
   comparison table has a known, static area (correctly shown on the "By area" tab for the same
   rules), but the comparison view doesn't populate it. Doesn't block the core workflow, just reads
   like missing data.

5. **No parallel-requests (1–8) control exposed on the New Crawl form.** — **[minor]** Brief's
   Highest-Leverage Feature #1 explicitly names "Crawl queue + parallel requests (1–8)". The New
   Crawl form has no concurrency control at all (confirmed via full form text dump — TARGET / LIMITS
   / ENGINE / ACCESS sections only). The underlying crawler does run with real concurrency — the log
   tail shows `concurrency: 5` — it's just not user-adjustable from the UI. Core Element #1 itself
   (start/watch/stop) doesn't strictly require this knob, so calling it minor rather than critical,
   but flagging since it's named explicitly in the ranked feature list.

6. **All Measurements screen ships 30 of the promised 31 cards and self-labels as interim.** —
   **[minor]** A banner states: "Showing the current measurements endpoint's response (30 figures,
   every number real). The richer 31-card grid with plain-language explainers and per-measurement
   drill-downs activates automatically once `/api/crawls/:id/measurements` is wired to the new
   computation layer — no change needed on this page when that happens." (screenshot
   `11-activity-blocked-filter.png`, which landed here by a mis-click but captured the banner).
   Counted all 30 cards across Coverage/Content/Indexability/Links/Performance sections — every one
   has a real value and a real plain-language explainer sentence underneath it (e.g. "Pages the
   crawler successfully fetched and extracted this run."). This touches MVP Acceptance Criterion #7
   ("31 measurement cards... each carries a plain-language explainer") directly — as literally
   worded, one card short and self-admittedly interim. Calling minor rather than critical because
   what's shipped is solid (real values, real explainers, honest disclosure of the gap) and a
   consultant would get real value from it today.

7. **Fix-type/effort/confidence classification is "Not classified"/"—" for all 231 findings on a
   fresh crawl, and requires a terminal command outside the UI to populate.** — **[minor]** The
   Issues screen shows "FIX TYPE (not classified for this run — run `npm run analyze:automation`)"
   and every row's Effort/Confidence read "—"/"Not classified". Priority (a separate, genuinely
   computed model) works correctly and doesn't depend on this step. But the brief's persona is
   explicitly "technical enough to act on findings, not technical enough to read a JSON dump" — such
   a user has no way to trigger this classification from the dashboard itself. Not calling this
   critical because the Issues screen is otherwise fully functional and the classification gap is
   honestly disclosed rather than hidden, but it's a real gap against Highest-Leverage Feature #3
   ("priority / effort / confidence / auto-fix class").

8. **Response-time field: self-disclosed risk on the §7 defect, not independently confirmed or
   refuted.** — **[minor, NOT FULLY TESTED]** The Performance card for Response Time (P50) states:
   "responseTimeMs is wall-clock on the Playwright path for rendered pages (PLAN-03 M4) — the
   `http.ttfbMs` / `render.wallMs` namespace split has not shipped in this run's stored records."
   This is the exact defect brief §7 says must not be reproduced ("Browser wall-clock stored as
   response time"). Values I actually observed (23–260ms range across both HTTP-only and one
   Always-render-mode crawl) looked like plausible transport times, not suspicious multi-second
   wall-clock values, which is a good sign — but I did not get to specifically drill into a
   Playwright-rendered page's raw stored `responseTimeMs` field before the watchdog interrupt to
   confirm the split is genuinely absent vs. just not yet labeled. **Flagging for explicit
   follow-up** rather than asserting pass or fail.

---

## Positives: what's good (see Q7 above for full list with evidence)

Core workflow (crawl → score → issues → evidence) all works and is internally consistent across
three independent surfaces (Activity, Issues, Page Detail) that all agree with each other on the
same specific findings. Score sanity is exactly right. Honesty pattern (unavailable vs. zero) is
used correctly and repeatedly, unprompted, in multiple unrelated parts of the app. Filter chips,
sort, and keyboard access all hold up under real stress-testing on a 1,195-row table.

---

## Overall verdict

**CRITICAL_ISSUES**

## If issues: required fixes for main Claude

1. **Wire a Stop control to the existing `/api/crawls/[runId]/cancel` route** on the New Crawl live
   progress panel (and ideally Overview/Activity while a run is in-flight) — this is the single
   required fix; MVP Acceptance Criterion #2 cannot be verified true today because there is nothing
   in the UI to press.
2. Fix the Issues "Since last crawl" tab to respect the active SEVERITY filter chip (currently
   ignored — shows notice rows when Error is selected).
3. Strip ANSI escape codes from the New Crawl log-tail display.
4. Follow-up items for a deeper pass once time allows (all minor, not blocking): populate the Area
   column on "Since last crawl"; expose a parallel-requests control or confirm it's intentionally
   deferred; confirm the 31st measurement card / wire the "richer grid" the banner refers to; confirm
   whether `npm run analyze:automation` needs a UI trigger for MVP or is intentionally a separate
   pipeline step; independently confirm/refute the response-time wall-clock-vs-transport defect on a
   Playwright-rendered page's raw stored field.

## NOT TESTED (explicit — do not infer pass/fail on these)

- Empty/huge/emoji boundary input on the New Crawl form.
- Browser back/forward mid-crawl; rapid double-click / concurrent submit race.
- Genuine first-login empty state (no auth gate was encountered at all this session — a sibling
  agent is reportedly adding auth concurrently; re-test once that lands).
- Whether Overview/Activity screens show a stop affordance specifically during an in-flight run
  (checked New Crawl and Queue exhaustively; did not check those two screens mid-run).
- Direct confirmation/refutation of the wall-clock-vs-transport-time defect on a Playwright-rendered
  page's raw stored field (§7, Practical Issue #8).
- Mobile breakpoint pass, loading/error state screenshots, concurrent-session race testing (deep-tier
  items 12-17) beyond what was incidentally covered above — run was interrupted before reaching these.
