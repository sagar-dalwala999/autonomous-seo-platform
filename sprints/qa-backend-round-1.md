# QA-Backend — MVP Round 1

Contract: `D:\projects\seo-platform\sprints\brief.md`. Reviewed product: `D:\projects\autonomous-seo-platform`
(`poc/seo-crawler-poc` CLI crawler + analyzer, `poc/seo-dashboard` Next.js UI, `packages/db` Prisma/Supabase
layer). Note: there is a second, largely-empty scaffold at `D:\projects\seo-platform\apps\{web,api,worker}`
that DOES contain real Supabase-Auth wiring (`Login.tsx`, `RouteGuard.tsx`, `AuthCallback.tsx`) — its files
are all timestamped ~10:22 IST and total 79 files, vs. `autonomous-seo-platform`'s 224-file, all-day build
with commits as late as 14:14 and working-tree edits as late as ~20:21. That scaffold reads as an earlier,
abandoned attempt at the same brief; per the dispatch I graded `autonomous-seo-platform` as the actual
deliverable. Flagging this explicitly because it explains one of the findings below (auth exists in code,
just not in the thing that got shipped).

## Question selection
- qa_depth: deep (all 8 questions required regardless of capabilities)
- Ran: Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8 — all eight, per `qa_depth: deep`.
- Skipped: none. Q2's literal form (VPS/handover slug comparison) doesn't apply — this is a local-only
  deploy, no `vps_slug`/`supabase_slug`/`ownership` fields exist in `intake.json` — so Q2 was answered via
  its actual intent (does the code point at the real configured DB, are there hardcoded URLs) instead,
  folded together with Q5's secrets sweep. Q3's literal form (curl a `/api/login` with a wrong-domain email)
  doesn't apply either, because **no login endpoint exists at all** — answered by proving anonymous access
  to everything instead, which is the more serious version of the same question.

## Mental framework walkthrough

### Q1: Does what the brief promised actually exist?
**Verdict: DIVERGENCE (multiple, see below — this is the primary finding bucket for this round).**
Full detail in "Brief-vs-deployed divergence findings" below.

### Q2: Where do the slugs land? (adapted — local deploy, no VPS/Supabase slug pair)
**Verdict: PASS on secrets/URL hygiene, DIVERGENCE on capability wiring.**
- `packages/db/.env` holds a real `DATABASE_URL`/`DIRECT_URL`/`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
  matching `intake.json`'s described stack (project ref `jlmdsrrwfczgryilsjsy`). Filesystem-wide grep for
  the literal password (`<DB-PASSWORD-REDACTED>`) and the project ref found zero hits anywhere outside that one
  `.env` file — no hardcoded Supabase URL anywhere in source.
- But: `poc/seo-dashboard` (the thing actually served) has **zero** dependency on `packages/db` — confirmed
  via `grep -rl "PrismaClient|@prisma/client|packages/db"` across the whole dashboard: no hits. Its own
  `/api/ready` route says so explicitly in code: `db: "not-applicable", queue: "not-applicable"` with the
  comment "No DB/queue in this POC". The dispatch's capability block says `db: yes # live Supabase Postgres
  via Prisma, 34 models` — the 34 models are real (verified: `grep -c "^model " packages/db/prisma/schema.prisma`
  → 34) but they back nothing the dashboard reads. See "Brief-vs-deployed divergence" below.

### Q3: Can a non-org email log in? (adapted — there is no login at all)
**Verdict: CRITICAL DIVERGENCE.**
Started the dashboard on a spare port (4321, not 3100/3105) and curled every route with zero credentials:
```
GET /api/health   -> 200 {"ok":true}
GET /api/crawls   -> 200
GET /api/crawls/localhost-20260813-202100/issues -> 200
GET /api/queue    -> 200
GET /api/ready    -> 200 {"db":"not-applicable","storage":true,"queue":"not-applicable","ok":true}
```
No `Authorization` header, no cookie, nothing — every route answered normally. There is no login page, no
`middleware.ts`, and no `@supabase/supabase-js` dependency in `poc/seo-dashboard/package.json`. The brief's
own yaml declares `auth: yes` and `qa_user_test_creds: "Supabase Auth. Seed a qa-user account during
scaffold; creds recorded in .env.local.example"` — no such file exists anywhere in the repo (`find . -iname
".env*"` under `poc/seo-dashboard` returns nothing). This isn't "wrong-domain email gets let in" — it's
"there is no door." Server started/stopped by me on port 4321 only; confirmed killed after testing
(post-kill curl to 4321 timed out / connection refused).

### Q4: What's exposed?
**Verdict: CRITICAL — everything, unauthenticated, including crawl-control writes.**
`poc/seo-dashboard/app/api` has ~50 route folders (crawls, cancel, rerun, reanalyze, exports, mutes, etc.).
None have auth middleware (none exists in the repo at all — see Q3). `lib/crawl-runner.ts`'s `startCrawl()`
is reachable from `POST /api/crawls` with no gate, and it `spawn()`s a real child process that makes real
outbound HTTP requests to whatever `startUrl` is posted. Rate-limiting: no rate-limit middleware or package
found anywhere in `poc/seo-dashboard` (`grep -rl "rate-limit\|rateLimit"` → no hits). This matches the
"one crawl at a time" in-process guard (`CrawlConflictError`), which is a concurrency limit, not a
rate limit and not an auth gate.

### Q5: What's in source that shouldn't be?
**Verdict: PASS.**
- `packages/db/.env` (real DB password + service-role JWT) is gitignored (`.gitignore`: `.env`, `.env.*`,
  `!.env.example`) and untracked (`git ls-files | grep .env` → empty; `git log --all --diff-filter=A
  --name-only | grep .env` → empty history). `packages/` itself is entirely untracked in this working tree
  (`git status -s` shows `?? packages/`), so there's no path by which the secret could already be committed.
- Filesystem-wide grep (excluding `node_modules`) for the literal service-role JWT and the DB password:
  zero matches outside `packages/db/.env` itself.
- No `NEXT_PUBLIC_`/`VITE_` prefixed secret anywhere; the one `grep` hit for those prefixes was inside
  `packages/db/.env.example`'s own comment text ("never prefix with VITE_"), not a live var.
- `packages/db/src/storage/supabaseStorage.ts` has `assertServerContext()` (throws if `window` exists) as
  a second guard, and `poc/seo-dashboard` has no npm dependency or import path to `packages/db` at all —
  confirmed by grep, see Q2. The service-role key is architecturally unreachable from client code.
- One real, self-documented hazard (not a "shouldn't be in source" finding — the opposite: it's flagged
  loudly in-source): see "Live-write hazard" below. Not exercised.

### Q6: What happens at the scale the brief implies?
**Verdict: CRITICAL DIVERGENCE — directly threatens MVP acceptance criterion #9.**
`poc/seo-dashboard/lib/data.ts`'s `getPages()`/`readPagesDir()` reads **every** page JSON file for a run
into memory in one pass (a 64-way parallel `readdir`+`readFile`, `Promise.all`), then caches up to 8 runs'
worth simultaneously in an in-process LRU `Map`. `lib/data-pages.ts` builds the whole pages table by calling
`getPages(runId)` and only filters/sorts/paginates **after** that full load — there is no cursor, no
`LIMIT`, no streaming read anywhere in this path. Same pattern in the crawler side: `src/analysis/store.ts`
`readIssues()` does one `readFile` + `JSON.parse` of the whole `issues.json` (258KB for a 21-page run;
this scales linearly with page count and issue density). At the dispatch's stated ~130KB/page retained-heap
rate, a single 10,000-row run (brief's own acceptance-criterion #9 scale) already retains roughly 1.3GB just
for `getPages()`'s output, before the 8-run LRU multiplies it, before `issues.json`'s parse cost is added on
top. This is exactly the "hunt for any non-cursor `findMany` or load-all over pages" pattern I was asked to
check for — found on both the dashboard's pages-table path and the crawler's issues-report path.

### Q7: Did a sub-Generator break a foundation file?
**Verdict: MINOR — self-caught and resolved during the build; residual dead code, not damage.**
`poc/seo-crawler-poc/WORK_LOG.md` self-reports a real 3-way rule-id collision from concurrent slices
(`no-compression` landed in both `transport.ts` and `http.ts`; `page-buried-too-deep` in both `orphans.ts`
and `links.ts`; `long-content-no-subheadings` in both `content.ts` and `on-page.ts`), resolved before I
looked at it. I independently re-verified there are zero duplicate rule ids today: `grep -c 'id: "..."'`
across `src/analysis/rules` returns 105 raw matches and 105 unique matches — a clean match means no current
collision. `analysis.config.json`'s apparent "duplicate keys" (`titleMinChars` etc. appearing twice) is not
a bug — one occurrence is in a `_sources` documentation block, the other in the real `thresholds` block;
`JSON.parse` succeeds and both objects are distinct. One real orphan: the Prisma `CrawlJob` model (part of
the "34 models") is defined and migrated but has zero runtime references anywhere in `poc/` or `packages/db/src`
outside generated client types — dead schema left over from the merge, not actively harmful.

### Q8: Does the deploy actually serve what's in the code?
**Verdict: N/A by design (no deployed URL — `external_deploy: no`), ran the equivalent local checks.**
No git operations performed. Built my own instance on a spare port and confirmed it serves this exact
checkout:
- `cd poc/seo-crawler-poc && npx tsc --noEmit` → exit 0, clean.
- `cd packages/db && npx tsc --noEmit` → exit 0, clean.
- `cd poc/seo-dashboard && npx tsc --noEmit` → exit 0, clean.
- `cd poc/seo-dashboard && npm run build` → exit 0 (14 Turbopack warnings about `process.cwd()`-relative
  fs access forcing full-project tracing — informational, not failures; ~55 routes all built).
- Started `next start -p 4321` from this exact working tree; `/api/version` returned
  `{"dashboardVersion":"0.1.0","nodeVersion":"v22.18.0",...}` — served the code I read, not a stale build.
  Stopped afterward (verified port 4321 no longer answers).
- Did NOT touch ports 3100/3105 per hard rule.

## Brief-vs-deployed divergence findings (primary)

1. **[CRITICAL] No auth anywhere in the deployed product, despite `auth: yes` in the brief's own yaml and
   an explicit `qa_user_test_creds` note about a seeded Supabase-Auth account.** Every one of ~50 API
   routes (including crawl-start, crawl-cancel, rerun) answers anonymously. `.env.local.example` (where
   creds were supposed to be recorded) does not exist. Real Supabase-Auth wiring (`Login.tsx`, `RouteGuard.tsx`)
   exists in the sibling `seo-platform/apps/web` scaffold but was never carried into the shipped dashboard.
   Evidence: live curl tests above (Q3/Q4), `grep` for `@supabase/supabase-js` in `poc/seo-dashboard/package.json`
   (absent), no `middleware.ts` anywhere in the repo.

2. **[CRITICAL] `db: yes` / `background_jobs: yes` capabilities are not wired to the deployed product.**
   `packages/db` (34-model Prisma schema, real Supabase Postgres) is real, well-built infrastructure, but
   `poc/seo-dashboard` — the thing a user actually opens — has zero dependency on it (zero grep hits for
   `PrismaClient`/`@prisma/client`/`packages/db` anywhere under `poc/seo-dashboard`), and its own code says
   so out loud: `app/api/ready/route.ts` returns `db: "not-applicable", queue: "not-applicable"` with a
   comment "No DB/queue in this POC". The only Postgres write path is `POSTGRES_SYNC_ENABLED=true`
   (off by default) from the CLI crawler — additive, optional, explicitly "never a replacement for
   RunStore's flat JSON" per its own doc comment. The `CrawlJob` model (part of the "background_jobs"
   story) is entirely unused at runtime. Whether "additive, off-by-default Postgres sync" satisfies a brief
   that declares `db: yes` and `background_jobs: yes` as capabilities of the built product is a judgment
   call for main Claude, but as shipped, the live product a user interacts with runs on flat JSON files and
   a single spawned child process, not the database/queue infrastructure the brief's capability block claims.

3. **[CRITICAL] MVP Acceptance Criterion #11 fails outright.** Brief: "Artifact storage degrades visibly —
   with SUPABASE_SERVICE_ROLE_KEY empty the UI says 'artifact storage not configured' rather than rendering
   blank or crashing." `grep -rli "not configured"` across `poc/seo-dashboard/{app,components,lib}` returns
   zero hits. `app/api/screenshot/[runId]/[pageId]/route.ts` is 100% local-disk-based (`readFile`/`stat` on
   `runsDir()`), never references Supabase or `SUPABASE_SERVICE_ROLE_KEY` at all, and returns a generic
   `404 "No screenshot for this page"` whether the cause is "never captured" or "storage not configured" —
   the two cases are indistinguishable to the user, which is exactly the "renders blank" failure mode the
   criterion says not to reproduce. The degrade-cleanly mechanism the criterion describes exists only in
   `packages/db`'s `getServiceClient()`, which the dashboard never calls (see finding #2).

4. **[CRITICAL] Highest-Leverage Feature #19 ("structured-data validation across 41 Google rich-result
   profiles") ships 3 of 41.** `src/analysis/rules/page/structured-data.ts`'s `REQUIRED_PROPS` covers
   exactly `Product`, `Article`, `FAQPage` — the code's own comment calls it a "POC subset of Google
   rich-result required properties (not the full spec)". JSON-LD + microdata + RDFa extraction genuinely
   all exist (verified: `extractMicrodata`, RDFa term resolution in `src/extraction/schema.ts`), so that
   part of the claim holds — the "41 profiles" validation depth does not.

5. **[CRITICAL] Rules-engine count materially short of "~180 rules".** Brief's Highest-Leverage Feature #2
   and MVP Carve-out both say "~180 rules." Actual registry: 105 unique rule ids (`grep -c` and `sort -u`
   both return 105 — no undercounting from a bad regex). Cross-checked live: an existing analysis run
   (`storage/runs/localhost-20260813-202100/issues.json`) reports `rulesRun: 105`. 105/180 ≈ 58% of the
   promised rule count.

6. **[MINOR] Test-baseline drift.** Dispatch's known-good baseline: "npm test in poc/seo-crawler-poc should
   be 1273 passing." Actual, run live just now: **1272 passed, 1 failed** (1273 total).
   `tests/unit/crawler/imageMergers.test.ts`'s "computed-style sweep" test times out at the fixed 20000ms
   ceiling only under full-suite parallel load (many concurrent Playwright instances contending for
   resources); re-run in isolation it passes in 5.4s. This reads as flaky-under-load, not a logic
   regression, but it does not currently match the stated baseline as-is and the timeout is a real,
   unaddressed flakiness risk in CI.

7. **[MINOR] `packages/db` has zero automated test coverage; its `npm test` fails outright.** Ran it live:
   `vitest run` in `packages/db` → "No test files found, exiting with code 1". The RLS-bypass /
   `projectId`-scoping boundary I was asked to verify (`packages/db/src/test/tenantScope.ts`) is real in
   its logic — I read it end to end: it creates two projects/sites/crawls/pages, runs a `projectId`-scoped
   query that correctly returns 0 cross-tenant rows, then runs the identical query *without* the scope and
   asserts it DOES leak (1 row) — that's a legitimate, honest demonstration of "RLS won't save you, code
   must scope by projectId." But it is not a vitest test: it's a standalone script
   (`npm run tenant-scope-test`) requiring live production Supabase credentials, invoked manually, never in
   CI. I did **not** execute it — doing so performs real `INSERT`/`DELETE` against the real production
   Supabase Postgres instance in `packages/db/.env`, which is a live-write action I was told to characterize,
   not exercise.

## Live-write hazard (audited, not exercised, per instruction)

Confirmed exactly as the dispatch described. `src/artifacts/supabaseUpload.ts` (screenshot upload) and
`src/storage/supabaseSync.ts` (`POSTGRES_SYNC_ENABLED`) both dynamically `import()` a runtime-computed path
into `packages/db/dist/index.js`. That import transitively pulls in `@prisma/client`, whose own env-loading
auto-loads `packages/db/.env` into `process.env` **as an import side effect**, independent of whatever the
crawler process's own ambient env is set to. `packages/db/.env` in this checkout holds real production
Supabase credentials. Blast radius: any `--screenshots` run (default off, but a one-flag opt-in with no
other gate) that reaches `maybeUploadScreenshot()` will silently activate real credentials and upload to the
real `screenshots` bucket in the owner's live Supabase Storage the moment `getServiceClient()` sees
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` populated — which they are, in this checkout, unconditionally.
The building agents documented this loudly in-source (a CAUTION comment citing "verified live during this
work") and the crawler's own tests never perform the real dynamic import for exactly this reason
(`supabaseUpload.test.ts`) — so the hazard is self-aware and contained by convention, not by a code-level
kill-switch. I did not run `--screenshots` or set `POSTGRES_SYNC_ENABLED=true` at any point.

## Infrastructure issues
- Non-cursor load-all pattern on both the dashboard's pages-table read path and the crawler's issues-report
  read path — see Q6.
- `CrawlJob` Prisma model is dead schema (defined/migrated, zero runtime references).
- No rate-limiting middleware anywhere in `poc/seo-dashboard` (brief doesn't explicitly mandate this for
  the dashboard API, but it compounds finding #1 — an unauthenticated, unrate-limited crawl-start endpoint
  that spawns real outbound HTTP traffic).

## Security holes
- Finding #1 (no auth) is the headline security hole: an unauthenticated network client can start/cancel
  crawls and read every stored finding.
- Everything else under Q5 (secrets hygiene) is clean — no leaked credentials, no client-reachable
  service-role key, proper `.gitignore` coverage.

## Sustainability concerns
- The two-directory situation (`seo-platform` vs. `autonomous-seo-platform`) itself is a sustainability risk
  independent of any one bug: future engineers reading `intake.json`'s stack description ("React 19 + Vite
  + Express... Postgres crawl_jobs + FOR UPDATE SKIP LOCKED") will look for infrastructure that was never
  actually wired into what's running.

## Overall verdict
CRITICAL_ISSUES

## Proposed severities
- critical: 6 (no-auth / everything-exposed; db+background_jobs capability not wired to deployed product;
  acceptance criterion #11 fails; structured-data 3-of-41 profiles; rules-engine 105-of-~180; Q6 scale
  load-all pattern threatening acceptance criterion #9)
- minor: 3 (1272/1273 flaky test under load; `packages/db` npm test finds zero files / tenant-scope only
  manually verified; dead `CrawlJob` schema)
- owner-opinion: 1 (whether "additive, off-by-default Postgres dual-write" is an acceptable reading of
  `db: yes`/`background_jobs: yes` for this POC stage, vs. a hard divergence — I've given the evidence,
  the call on what the brief's yaml actually obligated is main Claude's)

## If CRITICAL_ISSUES: required fixes for main Claude
1. Decide and either wire real auth into `poc/seo-dashboard` or explicitly descope `auth: yes` from the
   brief for this round — the current state (fully open crawl-control + full data read, zero login) is not
   a partial miss, it's the capability's complete absence from the deployed product.
2. Reconcile the `db: yes`/`background_jobs: yes` capability claim against what's actually wired: either
   make the dashboard read from Postgres (per the original stack description) or correct the capability
   framing so future QA rounds don't re-flag infrastructure that was always meant to be additive-only.
3. Implement or explicitly cut acceptance criterion #11's "not configured" UI state — currently a clean
   FAIL against a numbered MVP acceptance criterion.
4. Either expand structured-data validation toward the promised 41 profiles or correct the brief/feature
   list to describe the shipped 3-type subset honestly.
5. Either expand the rules engine toward ~180 or correct the brief to describe the shipped 105.
6. Add cursor/paginated reads to `getPages()`/`readPagesDir()` (dashboard) and `readIssues()` (crawler)
   before this is exercised anywhere near the 10,000-row scale acceptance criterion #9 names, let alone the
   100,000-page target scale mentioned in the dispatch.
7. Investigate the `imageMergers.test.ts` timeout under full-suite load (raise the timeout or reduce
   parallel Playwright contention) so `npm test` reliably reports the stated 1273/1273.
8. Add automated coverage for `packages/db` (currently zero `.test.ts` files; `npm test` fails outright) or
   at minimum wire `tenant-scope-test` into a real CI path against a disposable/test database rather than
   leaving it as a manual, production-credentialed script.
