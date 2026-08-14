# Project Review — Autonomous SEO Optimization Platform

> Review generated 2026-08-14. Verified against the current repo state on branch `main`
> (working tree clean; last commit `070cc80`). Where a figure is volatile, this document follows
> the repo's own convention (README §"Documentation accuracy"): it names the command that produced
> the number and the date it was run, and prefers "run this" over freezing a value.

---

## 1. What this project is

An **Autonomous SEO Optimization Platform** — explicitly *not* an SEO audit tool. The client
(23-page problem statement, distilled into `SPEC.md`) wants a system that **closes the loop
itself**:

> Discover → Analyze → Identify → Decide → Optimize → Validate → Deploy → Monitor → Measure →
> Re-optimize

The product vision is to minimize or eliminate manual SEO work: crawl a website, understand it,
detect issues, decide what to fix, generate the fix safely, apply it, validate it, and measure
whether it helped or hurt — rolling back harm.

The repo is in the **research + proof-of-concept phase**. Two personalities live side by side:

| Layer | What it is | State |
|---|---|---|
| `docs/` + `research/` | Formal client-facing planning package (Docs 01–07, 40 binding decisions, 21 research lanes) | Complete |
| `poc/` + `packages/db` | Working implementation: crawler, analyzer, dashboard, seeded test site, Postgres sync | POC-1/POC-2 done; POC-3+ not started |

**POC status (verified 2026-08-13/14):**

| Deliverable | State |
|---|---|
| POC-1 — crawl a website | Complete; 18/18 seeded evidence classes captured |
| POC-2 — analyze SEO automatically | Complete; acceptance gate **needs a fresh bench** (see §10) |
| POC-3 — generate SEO optimizations (AI) | Not started |
| POC-4/5/6 — modify repo, validate, PR | Not started |
| POC-7 — read Google Search Console | Not started |
| POC-8 — measure optimization impact | Not started |

---

## 2. Repository layout

```
autonomous-seo-platform/
├─ SPEC.md                  # Distilled client problem statement — the binding contract
├─ README.md                # Overview + proof-of-correctness + known limitations
├─ RUNNING.md               # How to run everything (verified commands, Node 22)
├─ SESSION-HANDOVER.md      # Four-way team audit + merge + build session handover
├─ review.md                # THIS document
├─ docs/                    # Client deliverables 01–07 + DECISIONS.md (D-01…D-40)
├─ research/                # 21 research lanes behind the decisions
├─ poc/
│  ├─ seo-crawler-poc/      # POC-1 crawler + POC-2 analyzer (Node/TS, Crawlee + Playwright)
│  ├─ seo-dashboard/        # Next.js 16 dashboard — UI *and* API (:3100)
│  └─ target-site/          # Next.js test site with 18 seeded SEO defect classes
├─ packages/db/             # Prisma 6.19.3 + Supabase Postgres layer (34 models)
├─ gdocs/                   # Renders markdown deliverables into styled docs
└─ sprints/                 # QA round reports
```

---

## 3. The big picture — how the pieces fit

```
                    ┌──────────────────────────────────────────────┐
                    │              docs/ + research/               │
                    │  (what to build + why + 40 binding decisions)│
                    └───────────────┬──────────────────────────────┘
                                    │ operationalized as
                                    ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                       poc/target-site                            │
   │   purpose-built Next.js site, 18 seeded defect classes (#1–#18,  │
   │   28 sub-items) — the acceptance GROUND TRUTH                    │
   └───────────────────────────┬──────────────────────────────────────┘
                               │ crawled by
                               ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                    poc/seo-crawler-poc                           │
   │   CLI:  crawl → analyze → diff → graph → bench                   │
   │   writes flat JSON evidence under storage/runs/<runId>/          │
   │   optionally dual-writes to Postgres (POSTGRES_SYNC_ENABLED)     │
   └───────────────┬──────────────────────────────┬───────────────────┘
                   │ reads storage/ directly       │ optional sync
                   ▼                               ▼
   ┌────────────────────────────┐   ┌──────────────────────────────┐
   │      poc/seo-dashboard     │   │        packages/db           │
   │   Next.js 16 app + API     │──▶│   Prisma → Supabase Postgres  │
   │   (18 screens, 46 API      │   │   34 models, RLS, import:legacy│
   │    routes, auth, crawl     │   │   & prune CLIs                │
   │    trigger, SSE, replay)   │   └──────────────────────────────┘
   └────────────────────────────┘
```

Key architectural facts (from `RUNNING.md`):

- **Only one long-running service: the dashboard.** Its Next.js API routes *are* the backend.
- **The crawler is a CLI, not a server.** The dashboard `spawn()`s it as a child process when a
  crawl starts from the UI (`lib/crawl-runner.ts`). A dedicated crawl-worker process is *designed
  but not built* (PLAN-03) — today a crawl shares the dashboard's process tree.
- **Flat JSON on disk is the source of truth.** Postgres is an optional, additive dual-write.
- **The dashboard reads crawler storage directly** via `../seo-crawler-poc/storage`.

---

## 4. The planning layer — `docs/` + `research/`

### 4.1 `SPEC.md`
The distilled problem statement in 26 sections: objective, manual-SEO work to automate, the central
research question ("maximum level of SEO that can be automated safely"), the 8 POCs, required
architecture, security, safety, cost analysis, and the success criteria (the full autonomous loop).

### 4.2 `docs/` — the seven client deliverables

| Doc | One-paragraph summary |
|---|---|
| `01-requirements-analysis.md` | Decomposes the problem statement into numbered requirements; defines the 10-step operating loop as a *system behaviour*; frames the boundary question (100% automatable → mostly → requires approval → manual) |
| `02-feasibility.md` | Yes it can be automated — **boundaries are the product**. ~14 mechanical fix types auto-appliable end-to-end; ~26 in an automated-PR lane; a permanent deny-list; honest limits (probabilistic attribution, prompt injection mitigated not solved) |
| `03-architecture.md` | Full architecture for the SPEC §19 chain around seven theses (one runtime, Postgres single source of truth, Temporal orchestration, deterministic detection + typed AI, one Change Application Layer, safety as arithmetic, pooled multi-tenant security) |
| `04-technology-comparison.md` | 24 component decisions, each with 2–3+ alternatives and reasons (Crawlee, Postgres 16 + pgvector, Temporal, BullMQ+Valkey, Cloudflare R2, model tiering) |
| `05-api-research.md` | Every loop stage has a workable external API. Six constraints shaped the architecture (GSC lags 2–3 days & hides ~47% of clicks; URL Inspection capped 2,000/day; Rich Results Test has no public API; Yoast REST read-only; SERP feeds scraped/legal ground moved; AI providers offer constrained decoding + 50% batch discount) |
| `06-risk-assessment.md` | 66 risks across 8 categories; asymmetric-loss-function framing; top ten exposures with Exposure = L×I scores; honest residuals |
| `07-mvp-development-plan.md` | Phase-0 plan for the 8 POCs (~5 weeks, 4 parallel tracks) + MVP: 14 epics, ~108 person-weeks, ~26 weeks in six phases |

### 4.3 `DECISIONS.md` — the binding decision register (D-01…D-40)
Locked picks that writers must not re-litigate. The load-bearing ones:

- **Runtime/platform:** Node/TypeScript everywhere except one Python batch worker (D-01, D-39);
  Next.js 16 self-hosted + NestJS 11/Fastify API (D-28, D-29); Clerk auth with Better Auth exit
  path (D-30); Valkey 9 for Redis-protocol stores (D-38).
- **Crawler/queue/orchestration:** Crawlee hybrid static-first with Playwright escalation (D-02);
  BullMQ + Redis for page-level work, **never** the crawl frontier (D-06); **Temporal TS SDK** for
  durable orchestration with approval gates (D-07).
- **Data:** Postgres 16 + pgvector as the single system of record, raw HTML zstd in R2 (D-03);
  in-process graph analytics, no graph DB at MVP (D-04); GSC-first warehousing (D-22).
- **Detection/AI:** deterministic ~70-rule versioned rulebook, AI never decides issue-hood (D-08);
  typed-operation emitter with `oldValue` anchors + constrained decoding (D-09); model tiering
  Haiku→Sonnet→Opus with Batch API (D-10, ~$33–88 per 10k pages); prompt-injection firewall (D-34).
- **Risk/safety:** two independent axes confidence × risk (D-12); hard deny-list (robots.txt=100,
  mass redirects=95, deletion=95, mass canonicals=90…) (D-13); append-only change ledger (D-14);
  two-phase monitoring d0–7 guardrail then d14–60 verdict (D-15).
- **Change pipeline:** one Change Application Layer with 4 adapters — GitHub PR / WordPress /
  Shopify / edge-worker (D-17); GitHub App with 1-hour tokens (D-18); deterministic AST codemods +
  LLM supplies values only (D-19); two-speed rollback (D-21).
- **Keyword/competitor/linking:** GSC-based opportunity score + decay detector (D-25); DataForSEO
  SERP pipeline with 5 gates, never auto-applies (D-26); internal linking via AST insertion, never
  JS injection (D-27).
- **Cost/ops:** KMS envelope encryption (D-32); cost envelopes small ~$20–70/mo, medium
  ~$250–600/mo, large ~$900–2,800/mo (D-36).

### 4.4 `research/` — the 21 lanes
Key themes: Crawlee hybrid static-first economics (~10× cheaper than browser-rendering everything);
Temporal as the only engine covering all five hard orchestration requirements; Postgres as single
source of truth (Mongo rejected on `$graphLookup` spill limits); deterministic detection with the
biggest false-positive engine being Google itself (rewrites 61.6–76% of titles, ignores 30–40% of
canonicals); GSC as the ranking backbone (16-month retention, ~50k rows/day ceiling → warehouse
from day one); internal linking among the highest-ROI automations (+7% organic traffic per
SearchPilot); and a four-way competitor teardown (Semrush, Screaming Frog, claude-seo, Botify)
proving our title/description thresholds match Screaming Frog exactly.

---

## 5. `poc/target-site` — the seeded acceptance fixture

A purpose-built Next.js 16 site ("not a demo") carrying **18 deliberately seeded SEO issue classes,
expanded into 28 sub-items**, each defect marked with a `seeded:` comment naming its manifest
number. It is the **ground truth the crawler and analyzer are graded against**. The manifest is
re-derived by grepping the tree.

| # | Class | Where |
|---|---|---|
| 1 | Missing title/meta | `/about` |
| 2 | Duplicate titles | `rain-gear-care` + `layering-basics` |
| 3a/b | Overlong (>70) / too-short (<15) title | `/guides/thru-hiking-gear-guide` · `/contact` |
| 4 | Missing meta description | `/about`, `granite-hiking-boots` |
| 5 | Duplicate descriptions | `backpack-fitting` + `choosing-hiking-boots` |
| 6a/b/c | No H1 / double H1 / H1→H3 skip | `/contact` · `cascade-rain-shell` · `trail-nutrition` |
| 7 | Broken internal links | 3 pages link to non-existent routes |
| 8 | Orphan page | `/gear-archive` (no inlinks, absent from sitemap) |
| 9 | Weakly-linked page | `/products/summit-stove` (single inlink) |
| 10a–d | Missing alt / large PNG / no width-height / BMP | several products |
| 11a–c | Invalid JSON-LD / wrong @type (Recipe) / Product missing offers | blog + products |
| 12 | Accidental `noindex` | `switchback-trekking-poles` |
| 13 | robots.txt blocks legitimate `/guides/*` | `public/robots.txt` |
| 14 | Sitemap omissions + 404 entry | `public/sitemap.xml` |
| 15a/b/c | Canonical mismatch / http:// link / www-mix | blog + about + blog index |
| 16a/b | 2-hop redirect chain (`/old-gear`) + redirect loop (`/loop-a⇄/loop-b`) | `next.config.ts` |
| 17 | Thin content (<80 words) | `trail-snacks` |
| 18 | Near-duplicate pair (~0.824 Jaccard) | the two winter checklists |

It also carries a members/auth area to exercise authenticated crawling (not part of the 18), and
two bait URLs for the crawler's safety rails (`/api/session?action=logout`,
`/members/reports/q1/delete`). Served via `scripts/serve-target-site.ts` at **:3105**.

---

## 6. `poc/seo-crawler-poc` — the crawler + analyzer

### 6.1 CLI surface (`src/index.ts`)
| Command | Purpose |
|---|---|
| `npm run crawl -- <url>` | Run a crawl. Flags: `--max-pages` (200; 0=all), `--max-depth`, `--concurrency` (1–8), `--render auto\|never\|always`, `--no-robots`, `--screenshots` (bounded, budget 50), `--user-agent`, `--rps`, `--check-external` (≤50 HEAD probes), `--basic-auth`/`--cookie`/`--header`, `--exclude`, `--no-safety`, full form-login set, `--run-id` |
| `npm run analyze -- --run <id>` | Turn a completed run's evidence into findings |
| `npm run graph -- --run <id>` | Internal PageRank → `graph.json` (standalone; **no consumer**) |
| `npm run diff -- --base A --head B` | Crawl-over-crawl (or cross-site) comparison |
| `npm run bench` | Acceptance bench: crawls 7 targets (~90s) |
| `npx tsx scripts/analyzer-gate.ts` | 30-row acceptance gate (see §10) |
| `npx tsx scripts/evidence-check.ts` | 18 programmatic seeded-evidence checks |

Exit codes 0/1/2; SIGINT→130.

### 6.2 Module inventory (`src/`)

| Area | Files | Role |
|---|---|---|
| `crawler/` | `crawl.ts` (1914 lines — the pipeline), `safety.ts`, `formLogin.ts`, `renderDivergence.ts`, `imageUtils.ts` | Fetching, escalation, safety rails |
| `discovery/` | `http.ts`, `robots.ts`, `sitemap.ts`, `sitemap-header.ts`, `llmsTxt.ts`, `aiCrawlers.ts` | robots.txt, sitemaps (gzip via magic bytes, `lastmod`/`changefreq`/`priority`), feeds, AI-crawler table, llms.txt |
| `detection/` | `needsJsRendering.ts`, `renderGain.ts`, `calibration.ts` | Evidence-based JS-render escalation |
| `extraction/` | `index.ts` + 20 modules (metadata, headings, links, images, media, schema, content, social, contacts, hreflang, pixel-width, pageStats, head, fonts, favicons, resourceHints, readability, structure, shared) | Per-page field extraction |
| `url/` | `normalize.ts`, `scope.ts` | URL normalization + crawl-scope gating |
| `storage/` | `runStore.ts`, `supabaseSync.ts` | Flat-JSON run store + optional Postgres dual-write |
| `artifacts/` | `screenshotPolicy.ts`, `supabaseUpload.ts` | Bounded screenshot policy + storage upload |
| `queue/` `events/` | `queue.ts`/`runner.ts`, `eventLog.ts` | Durable job queue + `events.ndjson` log |
| `graph/` | `pagerank.ts`, `writeGraphReport.ts`, `cli.ts` | Internal PageRank |
| `diff/` | `crawlDiff.ts`, `competitorDiff.ts`, `cli.ts` | Run-over-run + cross-site diff |
| `analysis/` | `engine.ts`, `config.ts`, `score.ts`, `similarity.ts`, `store.ts`, `cli.ts`, `rules/page/**`, `rules/site/**`, `priority/`, `automation/`, `fixplan/`, `measurements/` | The rule engine + derived layers |
| `models/` | `types.ts` (1130 lines) | The shared `CrawledPage` contract |

### 6.3 The crawl pipeline, step by step (`src/crawler/crawl.ts`)

1. **Robots.txt pre-fetch** — one fetch (never two); parse `Crawl-delay` → clamps `--rps` and
   concurrency; records `robots.json` (with the 4-value AI-crawler verdicts + `llmsTxt`).
2. **Auth resolution** — optional form login in a throwaway Chromium (fails fatal, no anonymous
   fallback, before the run dir is created so a failed login leaves nothing).
3. **RunStore init** — creates `storage/runs/<runId>/`.
4. **Mode dispatch** by `--render`:
   - `never` → Cheerio-only static pass.
   - `always` → Playwright-only (self-enqueues).
   - `auto` (default) → alternating **static pass ⇄ escalation pass**. The static pass is a
     `CheerioCrawler`; each page runs a render-gain test; if evidence of a JS-dependent DOM
     (measured, not heuristic), the URL is re-rendered in Playwright (budget-neutral re-render; new
     links re-enter the static pass).
5. **Favicon + image-size probes** — ranged GETs with a byte cap; no-image-sizes flag to skip.
6. **Extraction** — each fetched page runs the 20 extraction modules → one `CrawledPage` record.
7. **Safety rails** (`safety.ts`) — logout/destructive URL patterns (word-boundary match on
   pathname+search), asymmetric defaults (only active when credentials present).
8. **Cancellation guards** — co-operative cancellation; exit code reflects completion.
9. **Summary + report** — `buildSummary()` → `report.json` (crawl metadata, histograms, totals).
10. **Optional `--check-external`** — HEAD pool, ≤50 unique targets, 2 rps, 10s timeout.
11. **Optional `POSTGRES_SYNC_ENABLED=true`** — dual-write adapter (see §8).

**Storage layout per run** (`storage/runs/<runId>/`):

```
report.json           crawl metadata + histograms + totals
pages/<pageId>.json   one CrawledPage per page (pageId = sha256(normalizedUrl)[:12])
raw/<pageId>.html     raw HTML (plus .static.html when render gain kept the static)
issues.json           analyzer output (findings, per-page)
graph.json            PageRank scores (graph pass)
fix-plan.json         generated fixes (applied always false — never applied)
automation-report.json  rule auto-safety classification
robots.json / sitemaps.json / failures.json / blocked.json / skipped.json
external-links.json / events.ndjson / crawl.log / .crawl-status.json / screenshots/
```

### 6.4 The analysis engine contract (`src/analysis/engine.ts`)

This contract is **load-bearing** — get it wrong and the score silently inflates.

- A rule returns **`null`** when its required data was not captured, **`[]`** when it checked and
  found nothing.
- Every rule declares `dataRequirements: string[]` and emits `IssueEvidence[]` with a
  **resolvable dot-path** into the stored record (e.g. `images[2].alt`). A gate asserts 100% resolve.
- Field access is guarded with `captured()` / `capturedList()` — older runs on disk lack fields
  that are typed non-optional on the latest run.
- **Page rules** run per page; **site rules** run once. Per-rule try/catch isolates rule errors
  into `rulesErroredDetail` — a rule crash never aborts the run.
- Output is written atomically (temp + rename — `issues.json` was once truncated at 8 MiB from a
  background task).

**Health score** (`score.ts`): 5 categories (Indexability 30 / Content 25 / Links 15 / Media 15 /
Performance 15). Damage = deduction points × √reach; score = `100 × k/(k + totalDamage)` with
`k = healthHalfScoreDamage = 10`. Passed checks never enter the arithmetic — this was the fix that
took a deliberately-broken site from an inflated **88.8/100 to 19.1/100** (the old model produced
89–97 across *every* site, an eight-point range that flagged the whole site as healthy).

**Priority** (Kishan's four-factor model, ported):
`priority = round(100 × severityWeight × reach × importance × confidence)`, all four factors
shipped on every finding as `priorityFactors`.

**Similarity** (`similarity.ts`): shingle(5) → FNV-1a MinHash 128-bit → LSH 16×8, threshold 0.75
(tuned from a measured 0.824 Jaccard on the seeded near-dup pair). ~608 ms on 1,195 pages.

**Rulebook size:** **69 page rules + 36 site rules = 105** (verified 2026-08-14 by grepping rule
`id:` fields). 4 are classified auto-safe, 18 auto-with-review, 83 human-only.

**Fix plans** (`fixplan/`): generated, **never applied** (`applied` is a literal `false`). Only the
4 auto-safe rules have builders. ITEM_CAP 500.

**Measurements** (`measurements/`): the 31-card dashboard grid — 24 computable / 5 version-gated /
2 never. Never writes to disk.

### 6.5 Tests
Vitest, `tests/**/*.test.ts`. The suite count is genuinely volatile — the README records
**622 cases / 55 files** (crawler) at 2026-08-13 16:03 and the handover records **1,273 passing**.
Run it yourself: `npm test`.

---

## 7. `poc/seo-dashboard` — the Next.js 16 app (UI *and* API)

### 7.1 Stack
Next.js **16.3.0** (App Router, `force-dynamic`), React 19.2.8, Tailwind v4, TypeScript strict,
`@supabase/ssr`, vitest, lucide-react. **Supabase is used for auth only — zero Postgres calls in
the dashboard.** All data is file reads of crawler storage. Port **3100**.

### 7.2 Screens (18 pages) and API (46 routes)
| Screen | Path |
|---|---|
| Overview / runs | `/`, `/runs`, `/new-crawl`, `/queue` |
| Findings | `/issues`, `/failures`, `/measurements` |
| Explore | `/pages`, `/pages/[id]`, `/pages/[id]/preview`, `/links`, `/images`, `/redirects`, `/sitemap` |
| Compare & history | `/compare`, `/activity` |
| Auth | `/login`, `/signup` |

The 46 API route files sit under `app/api/**` and cover: crawls (list/filter/PATCH label), per-run
evidence (blocked, duplicates, events via **SSE**, exports, failures, fix-plan, graph, issues +
instances, links, measurements, pages + page detail, progress, redirects, reanalyze, rerun,
rules-run, site-files + ai-access, sitemaps, summary), mutes, queue, raw HTML, replay, screenshot,
and public health/ready/version.

### 7.3 Auth flow
- `proxy.ts` (Next 16 renamed `middleware.ts`): **default-deny**. Public exact `/api/health`,
  `/api/ready`, `/api/version`; public prefixes `/login`, `/signup`, `/auth`. Signed-in users are
  bounced off `/login`/`/signup`.
- Verification uses `supabase.auth.getClaims()` (JWT round-trip), **never** `getSession()`; the
  `auth-guard` is a route-level re-check motivated by CVE-2025-29927 (the `x-middleware-subrequest`
  bypass).
- `lib/safe-next-path.ts` blocks `?next=` open redirects (URL-parser same-origin + backslash
  handling, 4/4 tests).
- Credentials live in gitignored `.env` files; the service-role key must never carry a
  `NEXT_PUBLIC_` prefix and is deliberately absent from the dashboard so artifact storage reports
  honest "not configured".

### 7.4 Data layer
- `lib/data.ts`: `STORAGE_ROOT` (env `CRAWLER_STORAGE_DIR` or `../seo-crawler-poc/storage`),
  `listRuns` (with cancelled-run fallback via `.crawl-status.json`), `getPages` (LRU keyed by
  report.json mtime), **`streamPages`** (64-wide bounded async generator for memory safety at
  100k-page scale), `getPage`.
- Per-domain readers: `data-overview` (status counts, hex matrix, timeline, KPIs), `data-issues`
  (+`data-issue-extras`: issues/automation/fix-plan/health history), `data-measurements`
  (+drilldown), `data-compare`, `data-export`, `data-pages`, `data-graph` (stored graph.json
  preferred), `data-explorer` (unifies pages+failures+blocked), `data-links`, `data-images`,
  `data-redirects`, `data-queue`, `data-sitefiles` (13-agent AI-crawler table), `mutes.ts`
  (storage/mutes sidecar), `events-log.ts` (durable events.ndjson primary), `run-selection.ts`,
  `api-shared.ts` (pagination default 50/max 200, `isSafeId`).

### 7.5 Crawl orchestration from the UI
- `lib/crawl-runner.ts`: `spawn()`s `node --import tsx src/index.ts` (single process, not detached
  — a deliberate win32 console rationale). Source of truth is `.crawl-status.json` (survives dev
  reloads); dead-pid "running" states are reconciled from disk.
- **One crawl at a time** — `CrawlConflictError` 409. Queue workerCount is always 1 by construction.
- Server-side re-validates URL/auth/safety; auth values live only in argv, never logged or
  persisted (the `authMethod` is recorded, never the secrets).
- On exit 0/2 the spawner **auto-analyzes** the run (`src/analysis/cli.ts --run`).
- `lib/crawl-control.ts`: cancel (win32 `taskkill /T /F`), rerun (replays config — **auth never
  persisted, so reruns drop auth**), reanalyze, read/write `.dashboard-meta.json` (label/notes/tags).

### 7.6 Tests
4 files, 14 cases (`safe-next-path`, `frameability`, `pages-cache`, `run-selection`). The UI has no
committed end-to-end suite — UI verification was ad-hoc Playwright driving captured in
`qa-screenshots/` and breadcrumbs.

---

## 8. `packages/db` — Prisma + Supabase persistence layer

### 8.1 Schema
**34 models / 32 enums**, derived from the external PLAN-02 data-model doc. Key models:

- **Tenancy:** `User` (mirrors `auth.users` via trigger), `Project`, `ProjectMember`.
- **Runs:** `Site` (PRIMARY/COMPETITOR role, aliases), `Crawl` (config snapshot + `configHash`,
  ~25 materialized totals/histograms, soft `previousCrawlId`), `CrawlJob` (durable queue with
  `FOR UPDATE SKIP LOCKED`, settings snapshot, credentials never stored), `CrawlSchedule` (cron).
- **Per-page:** `Page` (the ~150-column "wide record" + 9 JSONB evidence blobs; `pageKey` = first
  12 hex of sha256(normalizedUrl), stable across runs), `PageContent` (1:1, text split out),
  `PageLink` (13 `LinkKind` values), `PageImage` (`AltState` MISSING/EMPTY/DESCRIBED is
  load-bearing), `PageMedia`, `PageHeading`, `StructuredDataItem`, `PageRedirectHop`.
- **Per-crawl aggregates:** `LinkTarget`, `ImageAsset` (`isSiteTemplate`), `DuplicateGroup`(+Member),
  `Failure`, `BlockedUrl` (10 `BlockedReason`s), `SiteFile` + `AiCrawlerVerdict` (13 AI crawlers,
  "partly blocked" first-class), `SitemapFile`/`SitemapEntry`, `ActivityLogEntry`, `Measurement`.
- **Rulebook/findings:** `Rule` (global + per-project overrides), `Finding` (per-crawl per-rule
  rollup — this is what the Issues screen lists), `Issue` (per-page/per-instance with
  gate-asserted `evidencePaths`), `RuleMute`.
- **Diff/storage:** `RunComparison` + `RunDiffEntry`, `Artifact` (row exists only after upload).

**Column-vs-JSONB rule:** a field becomes a real indexed column iff a dashboard screen filters,
sorts, groups or tabulates it; everything else stays evidence.

### 8.2 Configuration and the critical Prisma/RLS interaction
- Prisma **pinned to 6.19.3** (v7 rejects `url`/`directUrl` in the datasource — P1012).
- `DATABASE_URL` (port 6543, transaction pooler, `pgbouncer=true`) for queries; `DIRECT_URL`
  (port 5432, session) for migrate/introspection/importer.
- `src/client.ts`: `POOL_PROFILES` (api:10 / crawler:3 / rollup:2 / importer:5) appended to the URL.
- **Prisma connects as table owner and BYPASSES RLS.** RLS (36 policies, 30 tenant tables,
  SELECT-only for `authenticated`) protects only browser/PostgREST access. The real enforcement
  boundary for server code is **`projectId` in every WHERE clause, by hand** — proven by
  `npm run tenant-scope-test`, which demonstrates the leak a missing scope produces.
- `packages/db` **auto-loads real credentials on import** (`process.loadEnvFile` of
  `packages/db/.env`) regardless of ambient env — a watchout flagged in the handover.

### 8.3 CLIs
| Script | Purpose |
|---|---|
| `import:legacy` | One-shot importer of **4 picked historical runs**; refuses findings/healthScore from runs generated before the scoring-model cutoff (era mismatch protection) |
| `prune` | Retention policy: keep N most recent crawls per site (`RETAIN_CRAWLS_PER_SITE` default 10), delete the rest — justified by `page_links` ≈3.5 GB per 100k-page crawl vs Supabase Pro's 8 GB |
| `migrate:deploy` / `generate` / `validate` | Prisma lifecycle |
| `tenant-scope-test` | Proves the RLS-bypass leak exists when scoping is forgotten |
| `roundtrip` | Syncs one real run and reports read-back row counts |

### 8.4 Dual-write path (crawler → Postgres)
`src/storage/supabaseSync.ts` — **off by default** (`POSTGRES_SYNC_ENABLED=true`). Additive, never
replaces flat JSON, can never fail or slow the JSON path. It dynamic-imports `packages/db` at a
runtime-computed path (zero build-time coupling). `syncRunToPostgres`:
`report.json` → `ensureProjectAndSite` (deterministic system user, one Project+Site per host,
idempotent) → crawl upsert → **cursor-based page import** (500-row buffers, never the whole run in
memory, idempotent resume) → secondary files (failures/blocked/skipped/robots/sitemaps) →
findings/issues (gated) → `runRollups` (set-based SQL: backfill `targetPageId`, inlink counts,
orphan flags, sitemap `crawled`, filterCounts). The importer and live-crawl adapter share this
function.

---

## 9. Data management — end to end

| Stage | Where data lives | How it's produced | How it's consumed |
|---|---|---|---|
| 1. Crawl | `storage/runs/<runId>/pages/*.json` + `raw/*.html` + sidecars | Crawler CLI (UI-spawned or direct) | Analyzer, dashboard, db import |
| 2. Analyze | `issues.json`, `graph.json`, `fix-plan.json`, `automation-report.json` in the run dir | `npm run analyze` / auto-analyze after UI crawl | Dashboard Issues/Explorer/Measurements, db sync, gates |
| 3. Diff | `issues.json` lifecycle of base+head | `npm run diff` | Dashboard `/compare` |
| 4. UI | none persisted | Dashboard reads files on every request | All 18 screens |
| 5. Postgres | Supabase (34 tables) | `import:legacy` (4 runs) or live dual-write | Trending, multi-tenant queries, retention |
| 6. Events | `events.ndjson` | Queue/runner writes appended lines | Dashboard activity stream (SSE) + replay |
| 7. Mutes | `storage/mutes/` | `RuleMute` sidecar (crawler + dashboard mirror) | Suppresses findings by rule+site |

**Source-of-truth rule:** flat JSON under `storage/runs/` is canonical; Postgres is a derived,
optional projection; the dashboard is a pure reader; fix plans are generated but **never applied**.

---

## 10. Verification — the acceptance gates

- **`analyzer-gate.ts`**: 30-row expectation table mapping the 18 manifest classes to rule IDs,
  categories, URLs, min severity, and forbidden-false-positive rules. Also runs an
  error-severity-false-positive check (clean pages derived by live grep of `../target-site/app`) and
  evidence-pointer resolution. **Known pitfall:** it prints "GATE PASSED" even when all rows are
  N/A (if bench runs were never analyzed) — read the counts, not the exit code. **Current status:
  needs a fresh bench.** Last recorded: 29/30 PASS, 0 FAIL, 1 N/A; a 2026-08-13 15:47 re-run was
  27/30 (2 FAILs on rules shipped after the bench crawl — plausibly stale evidence, unverified).
- **`evidence-check.ts`**: 18 programmatic checks against stored records (title/desc, dup,
  length, H1 hierarchy, broken links, orphans, weak links, images, structured data, noindex,
  robots block, sitemap, canonical/http/www, redirects, thin content, near-dup).
- **Bench**: `npm run bench` crawls 7 targets (~90s); the gates read those runs.
- **Tests**: `npm test` in both POCs; typecheck `tsc --noEmit`; dashboard build `npm run build`.

---

## 11. Known limitations (from `README.md`, verified 2026-08-13/14)

**Crawling:** no resumability (a fresh `RequestQueue` per pass; interrupted crawl loses its
frontier); user-agent is configurable but **not applied to main page fetches** (robots is
evaluated under one identity, traffic goes out under another — worth confirming, the file was
mid-edit); no proxy support; screenshots are POC evidence with no retention cap (thumb never read).
**Discovery:** external-link checking is a ≤50-URL sample, not a sweep; sitemap `lastmod` trust is
assessed separately; gzip sitemaps and `lastmod`/`changefreq`/`priority` are **fixed** 2026-08-13.
**Extraction:** structured data is JSON-LD-only (18-line selector); no microdata/RDFa parser.
**Auth:** form login has no MFA/CAPTCHA/CSRF/SSO, CLI-only, one attempt, no re-login; session-loss
warns once then continues anonymously; safety rails skip logout/destructive URLs (by design);
credentials visible in the process table.
**Analysis:** `graph.json` has **no consumer**; analyzer is batch-on-disk only (no incremental, no
DB). **Engineering:** no CI; no committed UI/E2E suite; `lib/types.ts` in the dashboard is a
hand-maintained duplicate of the crawler's `src/models/types.ts` (drift risk).

**Notable debt (from the handover):** `--screenshots` writes to the **live Supabase Storage**
bucket and `packages/db` auto-loads real credentials on import (no env gate); the dashboard's
`artifacts/status` route lacks the `requireApiSession()` re-check (proxy-only); README in the
dashboard is stale (claims 10 pages / 5 routes; actual 18 / 46).

---

## 12. The intended trajectory (not built)

The `docs/`/`research/` layer plans the rest of the autonomous loop: Temporal orchestration with
~12 coarse phases per site per day, BullMQ page-level jobs, the ~70-rule versioned rulebook, the
typed-operation AI emitter (structured actions with `oldValue` anchors + confidence + risk),
GSC-first keyword intelligence with the two-component opportunity score, the decision engine
(confidence × risk matrix + deny-list), the one Change Application Layer with 4 adapters (GitHub
PR / WordPress / Shopify / edge-worker), the validation pipeline (static → sandboxed build →
preview deploy → SEO assertions), the append-only change ledger with batch rollback, and two-phase
monitoring with counterfactual verdicts. POCs 3–8 build toward that.

---

## 13. How to run it (condensed from `RUNNING.md`)

```bash
# Crawler + analyzer
cd poc/seo-crawler-poc && npm install && npx playwright install chromium
npm run crawl -- https://example.com --max-pages 50     # 0 = whole site
npm run analyze -- --run <runId>
npm run bench                                            # acceptance bench (~90s)
npx tsx scripts/analyzer-gate.ts                         # read the counts, not the exit code

# Dashboard (reads crawler storage directly)
cd ../seo-dashboard && npm install && npm run build && npm start   # :3100

# Seeded test site (for acceptance runs)
cd ../seo-crawler-poc && npx tsx scripts/serve-target-site.ts      # :3105

# Optional Postgres sync
cd ../packages/db && npm install && npx prisma generate
POSTGRES_SYNC_ENABLED=true npm run crawl -- <url>
```

Verified on Node v22.18.0 / npm 11.5.2, Windows. There are 2 crawl runs on disk today, so the
dashboard has real data to show without crawling first.