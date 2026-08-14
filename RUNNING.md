# Running the SEO Platform

Verified on Node **v22.18.0** / npm **11.5.2**, Windows. Every command below was run for real.

---

## 0. One-time setup

There is no workspace root — each package installs separately.

```bash
cd D:/projects/autonomous-seo-platform

cd poc/seo-crawler-poc  && npm install && cd ../..
cd poc/seo-dashboard    && npm install && cd ../..
cd poc/target-site      && npm install && cd ../..
cd packages/db          && npm install && npx prisma generate && cd ../..
```

`poc/seo-crawler-poc`'s `postinstall` patches Crawlee so it stops spawning a visible PowerShell
window every second on Windows. If you ever see console windows flashing during a crawl, that patch
did not apply — re-run `npm install` there.

### Playwright browser

The crawler escalates to a real browser for JS-dependent pages. Once:

```bash
cd poc/seo-crawler-poc && npx playwright install chromium
```

### Environment

Real values live in gitignored files. Copies of the shape are committed as `.env.example`.

| File | Holds |
|---|---|
| `packages/db/.env` | `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `poc/seo-dashboard/.env` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `poc/seo-dashboard/.env.local` | the same, plus the QA account pointer |

**The service-role key bypasses RLS entirely.** It is server-only, must never carry a
`NEXT_PUBLIC_` prefix, and must never be imported into client code.

---

## 1. What actually runs

**Only one long-running service: the dashboard.** Everything else is a CLI or a library.

| Module | Type | How it runs |
|---|---|---|
| `poc/seo-dashboard` | **The app — UI *and* API** | `npm run dev` → :3100 |
| `poc/target-site` | Test fixture to crawl | `npm run dev` → :3000 (optional) |
| `poc/seo-crawler-poc` | CLI, no server | `npm run crawl` / `analyze` / `diff` / `graph` |
| `packages/db` | Library + 2 CLIs | `import:legacy`, `prune` — no server |

**There is no separate backend process.** The dashboard's Next.js API routes *are* the backend.

**There is no crawl-worker daemon.** Starting a crawl from the UI makes
`lib/crawl-runner.ts` `spawn()` the crawler CLI as a child process; `src/queue/` is a library
consumed in-process. `PLAN-03` specified a separate worker so a crawl that OOMs cannot take the API
down — that split is **designed but not built**, so today they share a process tree.

## 2. Development mode

```bash
cd poc/seo-dashboard
npm run dev          # http://localhost:3100
```

Optionally, a local site to crawl:

```bash
cd poc/target-site
npm run dev          # http://localhost:3000
```

There are already **125 crawl runs on disk**, so every screen has real data without crawling
anything first.

## 3. Production mode

```bash
cd poc/seo-dashboard
npm run build
npm start            # http://localhost:3100
```

Log in with the account recorded in `.env.local.example` / `MEMORY.md`.

There are already **125 crawl runs on disk** under `poc/seo-crawler-poc/storage/runs/`, so every
screen has real data immediately — you do not need to crawl anything first.

> `next dev` holds a **project-wide singleton lock**: a second instance will refuse to start even on
> a different port. For a second server, build once and use `npx next start -p <port>`.

---

## 4. Run a crawl

The test site with deliberately planted SEO defects (29 routes):

```bash
# terminal 1 — the target site
cd poc/target-site && npm run build && npm start      # http://localhost:3000

# terminal 2 — crawl it
cd poc/seo-crawler-poc
npm run crawl -- http://localhost:3000 --max-pages 40
```

Against a real site, just swap the URL. `npm run crawl -- --help` lists every flag.

### Flags worth knowing

| Flag | Default | Notes |
|---|---|---|
| `--max-pages N` | 200 | `0` = whole site |
| `--max-depth N` | unlimited | `0` = start URL only |
| `--concurrency N` | 5 | clamped 1–8; never outruns robots.txt `Crawl-delay` |
| `--render MODE` | `auto` | `auto` escalates only on evidence of a JS-dependent DOM |
| `--no-robots` | off | ignores robots.txt; the override is still recorded in the evidence |
| `--user-agent UA` | `seo-crawler-poc/0.1` | sent on **every** request path — pages, robots, sitemaps, probes |
| `--rps N` | 10 local / 2 remote | requests per second |
| `--screenshots` | **off** | see the warning below |

> **`--screenshots` writes to the live Supabase Storage bucket.** Importing `packages/db` auto-loads
> the real credentials regardless of ambient env. Do not use it casually — gate it or point it at a
> dev bucket first.

---

## 5. Analyze a crawl

Crawling stores evidence; analysis turns it into findings. The dashboard auto-analyzes UI-started
crawls, but a CLI crawl needs this step:

```bash
cd poc/seo-crawler-poc
npm run analyze -- --run <runId>
```

`<runId>` is a directory name under `storage/runs/`. Output:

```
rulebook: 1.0.0 | pagesAnalyzed: 21 | healthScore: 19.1
issues: 12 error, 44 warning, 175 notice (231 total)
rulesRun: 105 | skipped (data unavailable): ...
```

Writes `issues.json`, `graph.json`, `fix-plan.json` and `automation-report.json` into the run
directory.

> Run large analyses in the **foreground**. A 12 MB `issues.json` was once observed truncated at
> exactly 8 MiB when written from a background task.

### Other analysis commands

```bash
npm run graph -- --run <runId>                       # PageRank
npm run diff  -- --base <runA> --head <runB>         # same site, two runs
npm run diff  -- --base <ours> --competitor <theirs> # cross-site
```

---

## 6. Tests and gates

```bash
cd poc/seo-crawler-poc
npm test            # 1,273 tests
npm run typecheck   # tsc --noEmit

cd ../seo-dashboard
npm test            # 14 tests
npm run build
npm run lint        # 2 pre-existing errors, deliberate — see WORK_LOG.md
```

The acceptance gates are the ones that actually matter. They need a fresh bench first:

```bash
cd poc/seo-crawler-poc
npm run bench                          # crawls 7 targets, ~90s
npx tsx src/analysis/cli.ts --run 20260813-112000-target-full   # and the other bench runs
npx tsx scripts/analyzer-gate.ts       # expect 29/30 PASS, 0 FAIL
npx tsx scripts/evidence-check.ts      # seeded-evidence gate
```

`analyzer-gate.ts` exits 0 with a misleading "GATE PASSED" if the bench runs have **not** been
analyzed — it reports `1/30 PASS, 29 N/A`. Always read the counts, not the exit code.

---

## 7. Database (optional)

The crawler writes flat JSON by default and works fully without Postgres.

```bash
cd packages/db
npm run migrate:deploy      # applies migrations to Supabase
npm run tenant-scope-test   # proves projectId scoping (Prisma bypasses RLS)
npm run import:legacy       # imports 4 historical runs
npm run prune               # retention policy
```

To dual-write a crawl into Postgres:

```bash
POSTGRES_SYNC_ENABLED=true npm run crawl -- <url>
```

Off by default. Flat JSON remains the source of truth either way.

> **Prisma is pinned to 6.19.3.** v7 rejects `url`/`directUrl` in the datasource block (P1012).
> `DATABASE_URL` is the transaction pooler (6543) for queries; `DIRECT_URL` is the session pooler
> (5432) and is used only by `migrate`.

---

## 8. Ports

| Port | What | Notes |
|---|---|---|
| 3100 | dashboard | `npm start` default |
| 3000 | target-site | `npm start` default |
| 3105 | target-site (harness) | what `scripts/serve-target-site.ts` uses |

If a port is busy, build once and run `npx next start -p <other>`.

---

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| `next dev` refuses to start | Project-wide singleton lock — another instance is running. Use `next start`. |
| Two builds corrupt each other | Concurrent `next build` shares `.next`. Use `NEXT_DIST_DIR=.next-alt`. |
| Every route redirects to `/login` | Expected — auth is default-deny. Log in. |
| API returns 401 to curl | Same. Public routes are `/api/health`, `/api/ready`, `/api/version`. |
| Console windows flash on Windows | The Crawlee postinstall patch did not apply. Re-run `npm install`. |
| Screenshot tab shows "not configured" | `SUPABASE_SERVICE_ROLE_KEY` missing. Correct, honest degradation. |
| Analyzer reports many "skipped — data unavailable" | The run predates newer extraction fields. Re-crawl. |
| Gate says "GATE PASSED" but 29 N/A | The bench runs were never analyzed. Analyze them first. |
