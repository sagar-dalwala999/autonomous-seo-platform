# SEO Dashboard

Next.js 16 (App Router, Tailwind v4) UI over the crawler's evidence. It reads
`../seo-crawler-poc/storage/` directly off disk — there is no database and no API between them.

Was create-next-app boilerplate until 2026-08-13; it told you to open port 3000, which this app has
never used.

## Run it

```bash
npm install
npm run dev                 # http://localhost:3100
# or
npm run build && npm run start   # also 3100
npm test                    # vitest
```

Port 3100 is pinned in `package.json` for both `dev` and `start`.

## What's here

Routes (`find app -name page.tsx` / `-name route.ts`, 2026-08-13 — **10 pages, 5 API routes**):

| Page | What it shows |
|---|---|
| `/` | Overview — KPIs, coverage, hex status matrix, HTTP/Playwright timeline, work queue |
| `/runs` | Every crawl run on disk |
| `/pages` | Page explorer — URL-state filters (`run`, `q`, `status`, `rendered`, `depth`, `sort`, `dir`, `group`, `section`) |
| `/pages/[id]` | Page evidence detail, 17 jump-nav sections |
| `/pages/[id]/preview` | Live page / stored screenshot / captured-HTML replay |
| `/issues` | Analyzer findings grouped by rule, severity + category filters |
| `/compare` | Crawl-over-crawl diff, computed on the fly |
| `/failures` | Failures, robots-blocked, and URLs skipped for safety |
| `/sitemap` | Sitemap + robots.txt cross-reference |
| `/new-crawl` | Trigger a crawl, including the Access (auth) panel |

API routes: `/api/crawls`, `/api/crawls/[runId]`, `/api/raw/[runId]/[pageId]`,
`/api/replay/[runId]/[pageId]`, `/api/screenshot/[runId]/[pageId]`.

## Known limitations

- **The committed tests are data-layer unit tests, not UI tests** — `tests/frameability.test.ts`,
  `tests/pages-cache.test.ts`, `tests/run-selection.test.ts` (3 files, 14 cases at 2026-08-13 16:03;
  run `npm test` for the current figure). Nothing drives the rendered UI. Build-time UI verification
  was ad-hoc Playwright driving, and what survives is screenshots in `qa-screenshots/`, not something
  you can re-run.
- **No CI** anywhere in this repo.
- `lib/types.ts` is a **hand-maintained duplicate** of the crawler's `src/models/types.ts`. There is
  no TypeScript project reference between the two apps, so the two drift silently.
- The Access panel supports Basic auth, a pasted cookie, and **one** custom header. It cannot do
  form login (CLI-only) and cannot send repeated headers, though the CLI can.
- Only one crawl runs at a time — `/api/crawls` returns 409 while one is in flight.
- Nothing here reads `graph.json` (PageRank); that pass has no UI surface.

Numbers above are dated and carry their command. See "Documentation accuracy" in the root
`README.md` before adding a new one.
