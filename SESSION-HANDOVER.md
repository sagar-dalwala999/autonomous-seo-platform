# Session handover — Autonomous SEO Platform: four-way merge, audit, and UI build

> Generated 2026-08-13 23:44 local · Saved to `~/.claude/handovers/2026-08-13-2344-seo-platform-four-way-merge.md`
> Also copied to `D:\projects\seo-team-audit\SESSION-HANDOVER.md` and rendered as `SESSION-HANDOVER.docx`

## 0. BOOTSTRAP — read these BEFORE doing anything

The next Claude is starting cold. Read in this exact order:

1. **`C:\Users\VA-007\.claude\CLAUDE.md`** — Sagar's global operating contract. §0 git safety and §0-B live-system safety are load-bearing on this project: **no commits, branches, or pushes without explicit instruction**, and no live/paid/destructive action without a per-run go-ahead.
2. **`C:\Users\VA-007\.claude\projects\D--projects\memory\MEMORY.md`** — **your persistent memory for this cwd.** Not a read-once file: Sagar expects context to compound across sessions through it. Four entries matter here: `autonomous-seo-poc1-state`, `seo-four-way-team-audit`, `seo-platform-test-accounts`, `crawlee-shared-requestqueue-trap`.
3. **`D:\projects\autonomous-seo-platform\poc\seo-dashboard\AGENTS.md`** — **this is NOT the Next.js you know.** Next.js 16 renamed `middleware.ts` → `proxy.ts` and changed APIs. Read `node_modules/next/dist/docs/` before writing any Next code.
4. **The "Key files" in §9 below**, in the order listed.
5. **This entire document.** The TL;DR is not a substitute.

Only then act on §13.

---

## 0.5. The user's verbatim last message before this handover

> okay so now handover everything properly with each and every details -> with docx and md file in project properly because for this session i need each and everything documented properly so can do this

---

## 1. TL;DR

Four people independently built SEO crawlers for the same client brief. This session **audited all four**, **ran them head-to-head against a shared seeded test site**, **planned a merged product**, and then **built that merge into our existing codebase** — followed by two QA rounds and a UI/UX pass driven by Sagar's own design references.

Headline result: **our tool scored a deliberately-broken test site at 88.8/100 before this session and 19.1/100 after.** Three independent tools scored the same site 20, 61 and 65. The old model produced 89–97 across *every site ever crawled* — an eight-point range. That miscalibration was the single most important defect found and fixed.

Current state: the merged product runs at **http://localhost:3982**, with 105 rules (was 78), 1,273 crawler tests (was 901), 19 screens (was 10), ~46 API route files (was 5), a live Supabase Postgres layer alongside flat JSON, authentication, and a redesigned login screen with a continuously-animating honeycomb. **Nothing is committed — 345 files sit uncommitted on branch `extraction-correctness`.**

---

## 2. Where it started — original ask + framing

### The original ask

Sagar provided three teammate zips and asked, in his words:

> "this are the same project which my teammates have made 1st folder is from kishan and 2nd folder is from jemish so we have to listdown all the feature from them along with your, so list down all the feature, then listdown common feature that we all 4 have made and then listdown unique feature that we 4 have made and then missing feature from us"

Later extended to a fourth teammate (Nayan), then to a full E2E verification, then to a merge, then to a build.

### The project's goal (the whole project, not this session)

The client wants an **Autonomous SEO Optimization Platform** — explicitly *not* an SEO audit tool. The requirement documents (`D:\projects\autonomous-seo-platform\docs\01-requirements-analysis.md`) state the differentiator is the system **closing the loop itself**: generate changes, validate them, apply the safe ones, measure outcomes, roll back harm. Detection and reporting are table stakes.

The operating loop, restated three times in the client statement:
`Discover → Analyze → Identify → Decide → Optimize → Validate → Deploy → Monitor → Measure → Re-optimize`

This session's work covers **Discover / Analyze / Identify** (POC-1 crawler + POC-2 analyzer) and the merge of four teams' attempts at it. FR-4 onward (AI optimization, keyword intelligence, GSC, competitor analysis) are later phases and were explicitly out of scope.

### Constraints Sagar set

| Constraint | Where it came from |
|---|---|
| React + Vite / Express + Node / Supabase + Prisma | stated mid-session, then **superseded** — see §4 |
| BMW M design system (`design.md`) | stated, then **withdrawn** — see §4 |
| Light + dark mode | explicit |
| Bounded screenshots, not every page | explicit, after being shown 27.5 GB vs 0.6 GB |
| Store **all** links, internal and external | explicit, after being shown the storage risk |
| Import 4 historical runs, not 109 | explicit, took the recommendation |
| No commits without instruction | CLAUDE.md §0 |
| "do not miss anything from any project" | explicit |
| "we are UI expert so we have to take care of each and every small details" | explicit |

---

## 3. Current state of the world

### Live / running

| Service | URL | Notes |
|---|---|---|
| **Merged dashboard (current build)** | **http://localhost:3982** | The one to test. Started by an agent; production build. |
| Old dashboard build | http://localhost:3100 | Pre-existing, **not started by us**, stale build. Do not kill. |
| Seeded target site | http://localhost:3105 | 29 routes with deliberately planted SEO defects. **Do not restart** — shared crawl target. |
| Kishan's tool | http://localhost:5173 (UI) + :3400 (API) | From the E2E audit |
| Jemish's tool | http://localhost:3500 | From the E2E audit |
| Nayan's tool | http://127.0.0.1:3600 + :3700 | From the E2E audit |

Login: `admin@gmail.com` (password in MEMORY.md + gitignored .env.local.example) — credentials are in `MEMORY.md` (`seo-platform-test-accounts`) and the gitignored `poc/seo-dashboard/.env.local.example`.

### Repo state

- **Repo:** `D:\projects\autonomous-seo-platform`
- **Branch:** `extraction-correctness`
- **Last commit:** `e1e8a64` — "Make the dashboard's typecheck actually cover its tests"
- **345 files uncommitted.** This is the single biggest risk in the handover. Sagar was asked five times for a commit checkpoint and never gave one; per CLAUDE.md §0 nothing was committed.
- Untracked additions include: `poc/seo-dashboard/app/signup/`, `components/auth/SignupForm.tsx`, `lib/safe-next-path.ts`, `tests/safe-next-path.test.ts`, `packages/db/`, `src/queue/`, `src/events/`, `src/artifacts/`, `src/analysis/priority/`, `src/analysis/automation/`, `src/analysis/fixplan/`, `src/analysis/measurements/`

### Supabase (live production project)

- Project ref `jlmdsrrwfczgryilsjsy`, region `ap-south-1`
- **34 models, 182 indexes, 36 RLS policies deployed** via two migrations (`20260813180000_init`, `20260813180001_rls_and_indexes`)
- Currently holds **2,524 pages, 206,577 links, 99,233 images, 27,070 headings** from 4 imported runs
- Two auth users: `admin@gmail.com`, `qa-user@seo-platform.test`
- Prisma pinned to **6.19.3** — Prisma 7 rejects `url`/`directUrl` in the datasource block with P1012

### Known-broken / degraded

| Item | Status |
|---|---|
| `--screenshots` writes to **live Supabase Storage** | Importing `packages/db` auto-loads real credentials regardless of ambient env. Nobody has run it. **Needs Sagar's decision.** |
| Light theme on the new login/signup | Never verified — only dark |
| Signup form end-to-end | Route builds, Supabase behaviour verified by script, **form never submitted in a browser** |
| `/login?next=/issues` while signed in | Redirect implemented, that specific case unverified |
| 2 lint errors | Pre-existing in `components/explorer/image-thumb.tsx`, `media-panel.tsx` — deliberate patterns, left alone |
| `lib/data-issues.ts` | A **third** independent load-all of `issues.json`, found but out of scope |

---

## 4. Decisions locked — with rationale + rejected alternatives

1. **Merge into the existing repo, keep Next.js.**
   **Why:** our codebase was 27k LOC with 901 tests and a working 10-screen dashboard; rebuilding in Vite would discard it. **Rejected:** the React+Vite/Express rewrite that PLAN-00 through PLAN-04 specify (~4 weeks vs ~2). Those plans remain valid for everything non-visual.

2. **BMW M design system withdrawn; port our own.**
   **Why:** Sagar — *"our UI is far better then that design.md file"*. **Rejected:** the full BMW M token system, already designed with corrected contrast ratios in `PLAN-04`.

3. **Kishan's 107 rules ported as DATA into our engine contract.**
   **Why:** he had the coverage and zero tests; we had the contract (`dataRequirements`, `null`-means-unavailable, evidence pointers) and half the coverage. **Rejected:** adopting his engine wholesale.

4. **Scoring split by question.** Site health = our post-fix model; per-finding ranking = Kishan's four-factor priority.
   **Why:** they answer different questions and Kishan's priority model was independently judged strongest of the four. **Rejected:** one unified score.

5. **Our image extraction deleted, replaced with Kishan's + Nayan's network inventory.**
   **Why:** ours was `<img src>` only and scored 3/10. **Rejected:** incrementally improving ours.

6. **Our MinHash/LSH kept over Nayan's SimHash.**
   **Why:** our 0.75 threshold was derived from a measured 0.824 Jaccard; his 0.9 default misses that exact seeded pair by 0.0094. **Rejected:** porting SimHash, shipping both.

7. **Queue is a Postgres table with `FOR UPDATE SKIP LOCKED`. No Redis.**
   **Why:** jobs are minutes-to-hours at single digits/min; `SKIP LOCKED` is orders of magnitude above need and keeps one source of truth. **Rejected:** Redis/BullMQ.

8. **Bounded screenshots** (top-N by importance + all error pages).
   **Why:** 27.5 GB vs 0.6 GB per 100k-page crawl — 45×. **Rejected:** screenshot every page.

9. **Store all links, internal and external.** Sagar's explicit call after being shown the risk (`page_links` is 3.5 GB of 6.5 GB per crawl; two crawls exceed Supabase Pro's 8 GB). Mitigation shipped as a retention/pruning policy knob rather than a wall.

10. **Import 4 historical runs, not ~109.**
    **Why:** the scoring model changed mid-session (same runs: 89–97 old vs 20–41 new); importing old scores would poison every trend line. The importer auto-detects era mismatch and refuses.

11. **No social login on the auth screens.** Sagar: *"for now we have to ignore all of that as we have simple auth."* All three of his references show Google/Apple/GitHub; shipping dead buttons is the "AI slop" he explicitly rejected.

12. **Login honeycomb uses continuous "Drift"**, chosen by Sagar from a live prototype of four options. Colours migrate cell to cell forever; lit-count is invariant by construction.

13. **Slice isolation by directory ownership, not git worktrees.**
    **Why:** CLAUDE.md §0 forbids branches without instruction. **Rejected:** the `new-tool-building` skill's worktree model. Ran 13 concurrent agents this way with no clobbering.

14. **Fix plans are generated, never applied.** No write-back, no CMS calls. A wrongly-labelled auto-safe fix is the one mistake that could damage a customer's site.

---

## 5. What shipped — full inventory

### 5a. The audit phase (deliverables in `D:\projects\seo-team-audit\`)

| File | Contents |
|---|---|
| `00 - FULL REPORT - Four-Way Team Audit.docx` | 169 tables, 2,037 rows — exec summary + Parts A–E |
| `01 - Kishan - SEO Crawler Audit.docx` | 9,506 LOC · 216 fields · **107 rules** · 20 endpoints · 11 screens · **0 tests** |
| `02 - Jemish - SEO Crawler Audit.docx` | 9,531 LOC · 76 fields · 42 deduction codes · SSE · 182 assertions |
| `03 - Nayan - SEO Crawler Audit.docx` | 3,499 + 5,944 LOC · 97 fields · 26 client-side rules · 20 tests |
| `04 - Our Team - SEO Platform Audit.docx` | 27,162 LOC · 162 leaf fields · 54 rules · 519 tests |
| `PLAN-00-Implementation-Plan.docx` | Master plan, 6 phases, exit gates, defect blocklist |
| `PLAN-01-Feature-Merge-Map.docx` | **492 features**, source-attributed, 328 P0 |
| `PLAN-02-Data-Model.docx` | CLI-validated `schema.prisma`, 34 models, 32 enums, 130 indexes |
| `PLAN-03-Backend-Architecture.docx` | 74 endpoints, queue, escalation heuristic |
| `PLAN-04-Frontend-Architecture.docx` | 29 screens, tokens, contrast ratios |
| `PLAN-05-FR2-Site-Understanding.docx` | The layer no team built — 33 pd design |
| `COVERAGE-TRACKER.md` | 492 features tracked; 154 NOT-COVERED at time of writing |

### 5b. Crawler changes (`poc/seo-crawler-poc/`)

- `src/analysis/rules/page/**` — **69 page rules** (was 34). New: `transport.ts`, `head.ts`, `fonts.ts`, `structured-data-report.ts`, plus additions to `indexability.ts`, `http.ts`, `on-page.ts`, `content.ts`, `images.ts`, `social.ts`, `security.ts`, `render-divergence.ts`
- `src/analysis/rules/site/**` — **36 site rules** (was 20). New: `favicons.ts`, plus additions to `redirects.ts`, `robots.ts`, `sitemap.ts`, `links.ts`, `duplicates.ts`, `orphans.ts`
- `src/analysis/engine.ts` — **rewritten scoring** + per-rule try/catch (`rulesErrored[]`) + graph wiring
- `src/analysis/priority/` (NEW) — page importance, four-factor priority, worst-pages, `muteStore`
- `src/analysis/automation/` (NEW) — FR-3.7 classification, 105 rules classified (4 auto-safe / 18 auto-with-review / 83 human-only), derived effort + confidence
- `src/analysis/fixplan/` (NEW) — per-URL fix plan generator, `applied: false` always
- `src/analysis/measurements/` (NEW) — the 31-card grid, 24 computable / 5 version-gated / 2 never
- `src/discovery/aiCrawlers.ts` (NEW) — 13-agent AI-crawler table, four verdicts, matched rule + line number
- `src/discovery/llmsTxt.ts` (NEW) — llms.txt fetch, **no score field by design**
- `src/discovery/sitemap.ts` — gzip via magic bytes, `lastmod`/`changefreq`/`priority`, image/video/news extensions, feed discovery, cross-host fallthrough
- `src/discovery/robots.ts` — `Crawl-delay` parsed and enforced
- `src/queue/` (NEW) — job states, priority, real cancellation of running jobs, disk retention
- `src/events/` (NEW) — durable `events.ndjson`, live tail + replay
- `src/crawler/crawl.ts` — evidence-based escalation, render gain test, bounded screenshots, single robots fetch, honest UA on every path
- `src/detection/needsJsRendering.ts` — rewritten to two evidence signals
- `src/detection/renderGain.ts`, `calibration.ts` (NEW)
- `src/artifacts/` (NEW) — bounded screenshot policy + Supabase upload with graceful degradation
- `src/extraction/readability.ts`, `resourceHints.ts` (NEW); `images.ts`, `schema.ts` extended (microdata + RDFa + 40 profiles)
- `src/diff/competitorDiff.ts` (NEW) — cross-site comparison with an explicit `notComparable` list
- `src/graph/pagerank.ts` — full-URL node identity; `runGraph.ts` (NEW)
- `src/storage/supabaseSync.ts` (NEW) — dual-write, no-op unless `POSTGRES_SYNC_ENABLED=true`

### 5c. Dashboard changes (`poc/seo-dashboard/`)

- **19 screens** (was 10). New: `/activity`, `/measurements`, `/sitefiles`, `/queue`, `/links`, `/images`, `/redirects`, `/login`, `/signup`
- **46 API route files** (was 5)
- `proxy.ts` (NEW) — Next 16 middleware, default-deny, public list `/api/health|ready|version`, `/login`, `/signup`, `/auth/*`
- `lib/auth-{browser,server,middleware,guard,service-role-guard}.ts` (NEW)
- `lib/safe-next-path.ts` (NEW) + `tests/safe-next-path.test.ts` — open-redirect fix, 4/4 passing
- `components/auth/{AuthVisual,LoginForm,SignupForm,SignOutButton}.tsx`
- `components/shell/{sidebar,app-shell,nav-config,run-selector,sign-out-item}.tsx`
- `lib/data.ts` — `streamPages()` bounded at 64 concurrent
- `lib/data-overview.ts` — `buildStatusCounts`, the chip-count fix
- `lib/crawl-runner.ts` — cancelled-state race fix
- `app/layout.tsx` — shell gated on session (no run data fetched for anonymous visitors)
- `app/globals.css` — scrollbar tokens, `auth-hex` keyframes, `auth-glass`

### 5d. Commits

**None.** 345 files uncommitted, per CLAUDE.md §0.

---

## 6. Data model + schema — the contracts

### The engine contract (load-bearing — get this wrong and the score silently inflates)

- A rule returns **`null`** when its required data was not captured, **`[]`** when it checked and found nothing.
- `dataRequirements: string[]` declares the fields a rule needs.
- Every finding carries `IssueEvidence[]` with a **resolvable dot-path** into the stored record (`images[2].alt`). A gate asserts 100% resolve.
- Guard every field access with `captured()` / `capturedList()` from `rules/page/shared.ts` — fields typed non-optional are absent on older runs (1,190 pages across 38 runs lack `videos`).

### Health score (rewritten this session)

```
damage_per_check = weight(worstSeverity) × sqrt(affectedPages / evaluatedPages)
weights: error 10 · warning 3 · notice 1
score = 100 × k / (k + totalDamage)     where k = healthHalfScoreDamage = 10
```
Passed checks never enter the arithmetic (that was the 88.8 dilution). Reach is measured against pages a rule **actually read**, so a rule blind on some pages is still scored on the rest; only a rule that ran on zero pages is excluded. Calibration anchors were fixed **before** any score was observed: one site-wide error → 50, warning → 77, notice → 91.

### Priority (Kishan's model, ported)

```
priority = round(100 × severityWeight × reach × importance × confidence)
reach = scope==='site' ? 1 : sqrt(min(1, affected/evaluated))
```
All four factors ship on every finding as `priorityFactors` — a priority number nobody can decompose is a magic number.

### Storage layout

`storage/runs/<runId>/` — `report.json`, `pages/*.json`, `issues.json`, `robots.json` (now carries `aiCrawlers[]` + `llmsTxt`), `sitemaps.json`, `failures.json`, `blocked.json`, `skipped.json`, `events.ndjson`, `raw/<id>.html` + `<id>.static.html`, `graph.json`, `fix-plan.json`, `automation-report.json`.

**125 runs on disk.** Useful ones: `phase2-final` (25p seeded), `books-full-site` (1,195p), `ui-20260812-145824` (1,051p real site), `ui-20260813-220341` (recent seeded).

### Postgres (34 models)

Key: `Project`, `Site`, `Crawl`, `CrawlJob`, `Page` (~95 indexed scalar columns + 9 JSONB), `PageContent`, `PageLink`, `PageImage`, `PageMedia`, `PageHeading`, `StructuredDataItem`, `PageRedirectHop`, `Rule`, `Finding`, `Issue`, `RuleMute`, `Measurement`, `ActivityLogEntry`, `SiteFile`, `Failure`, `BlockedUrl`, `RunComparison`, `Artifact`.

**Column-vs-JSONB rule:** a field becomes a real indexed column iff a dashboard screen filters, sorts, groups or tabulates it. Everything else is evidence read once on a detail screen.

### The AI-crawler verdict vocabulary — FOUR values

`allowed` · `blocked` · **`partly blocked`** · `ignores robots.txt`

The fourth exists because ChatGPT-User / Google-Agent / Google-NotebookLM fetch on behalf of a person who asked. **Never collapse this to a boolean** — Jemish's UI headlined "AI crawlers blocked: 0" on a site that partly blocked 10 of 13 agents.

---

## 7. Verification status

### ✅ Verified

| Gate | How |
|---|---|
| Crawler tests **1,273 passing** | `npm test` in `poc/seo-crawler-poc`, real output |
| Typecheck clean, both packages | `npx tsc --noEmit`, exit 0 |
| Dashboard build clean | `npm run build`, exit 0, all routes compile |
| **Acceptance gate 29/30 PASS, 0 FAIL** | `npx tsx scripts/analyzer-gate.ts` after a fresh bench |
| **0 error-severity false positives on clean pages** | same gate |
| **748 evidence pointers, 0 unresolved** | same gate |
| Seeded site scores **19.1** | fresh crawl + analyze, confirmed 3× independently incl. by QA-User |
| Escalation: **0/21 pages escalated, 3,015 ms** | live crawl; old heuristic would escalate 4, proven to gain nothing by force-rendering the disputed page and diffing |
| Cancellation genuinely stops fetching | fixture server request log + 18s post-stop polling |
| robots.txt fetched **once**, not twice | fixture server request count |
| Concurrency 1 vs 4: **4,002 ms → 1,838 ms** | real crawls |
| RLS bypass proven | scoped query returns 0 for another tenant, unscoped returns 1 |
| Service-role key absent from client bundle | grep across `.next/static` |
| Artifact round-trip | 57 real bytes uploaded → signed URL → fetched back byte-identical |
| Open-redirect fix | `tests/safe-next-path.test.ts`, 4/4 |
| **Drift: 1,200 hexes, lit 903 at 0s and 903 at 5s, 109 cells changed** | live JS sampling in-browser |
| Chip counts match destinations | all 6 clicked through: 27/18/0/3/0/2 |
| Sidebar active state | blue icon + blue label, 5.17:1 light / 6.00:1 dark |
| Run-selector dropdown | opens inside viewport, text readable |
| Signed-in reload stays in app | reloaded `/` on :3982 |
| Anonymous login page leaks nothing | 10 DOM patterns searched, 0 hits; zero non-static network requests |

### 🟡 Trust-but-verify

- Postgres dual-write adapter — verified standalone on a 12-page run, but never run through a full crawl with `POSTGRES_SYNC_ENABLED=true` (deliberately, live-write rule)
- Cancelled-run state end-to-end — verified by the fixing agent, not re-verified after
- Sign-out — verified by the fixing agent

### ❌ NOT verified

- **Light theme** on the new login/signup screens
- **Signup form submitted in a browser** — route builds, Supabase behaviour verified by script only
- **`/login?next=/issues` while signed in** landing on `/issues`
- **`--screenshots`** — never run, writes to live Supabase Storage
- **100k-page scale** — unproven above ~1,500 pages
- QA-User deep-tier items: settings walk, concurrent-session race, mobile breakpoint on authenticated screens

---

## 8. Conventions + style + patterns

- **Comments: 1–2 lines max, why-only.** No banners, no changelog notes, never narrate an edit in the file (CLAUDE.md §13).
- **TypeScript strict**; crawler also has `noUncheckedIndexedAccess: true`.
- **Types are additive/optional** — older runs on disk must still parse. Never restructure existing types.
- **Never fabricate a value.** `unavailable` with a reason beats a fake zero. This is the single most repeated principle of the session.
- **Never ship a rule that cannot fire honestly on real data.** Six rules were declined as extraction gaps rather than faked.
- **Spot-check new findings against real stored records.** Five false-positive classes were caught this way that code review missed.
- **Thresholds derived from measurement, never guessed.**
- Tabular numerals on aligned digits; rows that navigate are real `<a>`, never `<tr onClick>`.
- Filter chip counts and their destinations must derive from **one query**.
- Sagar's communication style: direct, decision-first, lists over prose, first line answers the question. He wants pushback when something conflicts with a known-good pattern.

---

## 9. Key files for the next session (read in this order)

1. `D:\projects\seo-team-audit\PLAN-00-Implementation-Plan.md` — master plan + §8 defect blocklist
2. `D:\projects\seo-team-audit\COVERAGE-TRACKER.md` — 492 features, what's NOT-COVERED
3. `D:\projects\autonomous-seo-platform\poc\seo-crawler-poc\src\analysis\engine.ts` — the contract everything depends on
4. `D:\projects\autonomous-seo-platform\poc\seo-crawler-poc\src\models\types.ts` — `CrawledPage` shape
5. `D:\projects\autonomous-seo-platform\poc\seo-dashboard\AGENTS.md` — Next 16 warning
6. `D:\projects\autonomous-seo-platform\poc\seo-dashboard\proxy.ts` — the auth gate
7. `D:\projects\autonomous-seo-platform\poc\seo-dashboard\components\auth\AuthVisual.tsx` — drift animation
8. `D:\projects\autonomous-seo-platform\poc\seo-crawler-poc\sprints\qa-user-round-2.md` + `qa-backend-round-1.md` — outstanding QA findings
9. `D:\projects\seo-team-audit\PLAN-05-FR2-Site-Understanding.md` — the unbuilt layer

---

## 10. Active todos

No TodoWrite state was maintained this session. The live backlog is §13 plus the COVERAGE-TRACKER's NOT-COVERED list.

---

## 11. Open questions / deferred items

1. **Commit the 345 files?** Asked five times, never answered. This is the highest-risk open item.
2. **`--screenshots` writes to live Supabase Storage.** Options: gate behind an env flag, point at a dev bucket, or accept. Sagar has not chosen.
3. **105 of ~170 rules.** Sagar was asked "ship at 105 or run another porting wave" and did not answer. ~40–60 checks remain, several blocked on extraction we don't do (cache headers, `<html lang>`, image bytes on legacy runs).
4. **Public signup is now live.** Flagged twice as an exposure on a dashboard holding client crawl data; Sagar asked for it anyway. First thing to gate if this leaves POC.
5. **`<ADMIN-PASSWORD-REDACTED>` is a weak password on a live project.** Test-only, but rotate before anything real.
6. **The DB password and service-role key were shared in chat.** Rotate if the transcript is shared.
7. **FR-2 site understanding** — designed (33 pd), not built. No team built it.
8. **The 5 requirements nobody met** — FR-1.5 (100k scale), FR-1.6 (queue/schedule/distribute), FR-2.1, FR-2.2, FR-3.4.

---

## 12. Watchouts / known traps

- **`packages/db` auto-loads real Supabase credentials on import**, regardless of ambient env, because `@prisma/client` reads `packages/db/.env`. Any script importing it touches the live project. This is why `--screenshots` is unrun.
- **Prisma bypasses RLS** — it connects as table owner. RLS is *not* the API's enforcement boundary. **Every server-side query must scope by `projectId` in code.**
- **Prisma must stay pinned at 6.19.3.** v7 rejects `url`/`directUrl` in the datasource block (P1012).
- **Next.js 16 renamed `middleware.ts` → `proxy.ts`.** Read `node_modules/next/dist/docs/` before writing Next code.
- **`next dev` holds a project-wide singleton lock** — a second instance won't start even on a different port. Use `next start` against a build for parallel verification.
- **Two concurrent `next build`s fight over `.next`.** Use `NEXT_DIST_DIR` for a parallel build.
- **The Playwright MCP browser is a shared, real Chrome.** Parallel agents hijacked each other's tabs repeatedly. Use isolated tab groups.
- **`issues.json` was observed truncated at exactly 8 MiB** when written from a background task. Run large analyses in the foreground. `writeIssues` is now atomic (temp + rename).
- **Don't collapse the AI-crawler verdicts to a boolean.** Four values, always show all four counts.
- **Extracting a password with `tr -d '"\\ '` mangles it.** This cost a whole QA round — the seeded password silently differed from the documented one. Always verify with a real `signInWithPassword` after seeding.
- **A CSS-only "colour migration" is impossible.** The drift is inherently stateful; `AuthVisual` must stay a client component.
- **The login field's initial render must stay deterministic** (seeded hash, never `Math.random`) or hydration mismatches.
- **`readIssues` via stream-json is ~10× slower in wall-clock** (124 ms → 1,204 ms on 12.4 MB) in exchange for 35–40% less peak heap. All callers are CLI/batch. Do not put it in a request handler.
- **Three separate load-all implementations of `issues.json` exist.** Two fixed, `lib/data-issues.ts` is the third and untouched.

---

## 13. Pick up from here — concrete next actions

```
1. Get a commit checkpoint — 345 files are uncommitted with no rollback point.
   Ask Sagar explicitly; do NOT commit without his word (CLAUDE.md §0).
   How to verify: `git log --oneline -1` shows a new SHA; `git status --short | wc -l` drops.

2. Finish the unverified UI checks on http://localhost:3982.
   Files to touch: none expected — this is verification, not code.
   How to verify: light theme on /login and /signup screenshotted; signup form
   submitted with a throwaway account and then deleted via the admin API;
   /login?next=/issues while signed in lands on /issues.

3. Decide and implement the --screenshots storage policy.
   Files to touch: `poc/seo-crawler-poc/src/artifacts/`, `packages/db/src/client.ts`
   How to verify: a crawl with --screenshots writes to a dev bucket (or is blocked
   by an explicit flag), and packages/db no longer auto-loads prod creds on import.

4. Run the remaining rule-porting wave if Sagar wants 170 rather than 105.
   Files to touch: `src/analysis/rules/**`, `analysis.config.json`
   How to verify: rule count rises; acceptance gate still 29/30 with 0 false positives;
   every new rule spot-checked against a real stored record.

5. Close the COVERAGE-TRACKER's NOT-COVERED list.
   Files to touch: per the tracker's absorb-target column
   How to verify: re-run the tracker agent; NOT-COVERED count drops; all 59
   owner-named must-haves read DONE.
```
