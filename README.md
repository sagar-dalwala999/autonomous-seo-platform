# Autonomous SEO Optimization Platform

Research and proof-of-concept work for an autonomous SEO platform: crawl a website, understand
it, detect issues, generate optimizations, validate them, apply them safely, and measure the
result.

The contract every deliverable is graded against is [`SPEC.md`](SPEC.md) (distilled from the
client's problem statement).

## Repository layout

| Path | What it is |
|---|---|
| `SPEC.md` | The problem statement, distilled — the binding requirements |
| `docs/` | Client deliverable documents 01–07 (requirements, feasibility, architecture, technology comparison, API research, risk, MVP plan) + `DECISIONS.md`, the binding decision register (D-01…D-40) |
| `research/` | The research lanes behind the decisions, including `crawler-advanced-competitive.md` (SearchAtlas/OTTO, Ahrefs, Screaming Frog, Sitebulb, Botify/Lumar/Oncrawl/JetOctopus teardown + our roadmap) |
| `poc/seo-crawler-poc/` | **POC-1 (crawler) + POC-2 (analyzer)** — Node/TypeScript, Crawlee + Playwright |
| `poc/seo-dashboard/` | Next.js dashboard — dynamic crawl trigger, evidence explorer, Issues view, crawl-over-crawl Compare, page preview/replay |
| `poc/target-site/` | Purpose-built Next.js test site with **18 deliberately seeded SEO issues** — the acceptance ground truth |
| `gdocs/` | Tooling that renders the markdown deliverables into styled documents |

## Proof of correctness

The POCs are graded against the seeded test site, not against claims. **Every figure below is dated
and carries the command that produced it — see [Documentation accuracy](#documentation-accuracy).**

- **Crawler (POC-1):** 18/18 seeded evidence classes captured
  (`storage/bench/20260811-110248/evidence.md`, re-run 2026-08-12). Note that
  `poc/seo-crawler-poc/POC-1-REPORT.md` was generated 2026-08-11 and has not been regenerated since —
  it opens with a staleness banner listing what has changed.
- **Analyzer (POC-2):** `npx tsx scripts/analyzer-gate.ts`. The gate checks 30 rows (the 18 seeded
  classes, several split into sub-items, plus one derived bonus row).
  - Last recorded green result: **29/30 PASS, 0 FAIL, 1 N/A**, with zero error-severity false
    positives and 709/709 evidence pointers resolving to a real stored field (WORK_LOG §C3, and the
    gate artifact as of 2026-08-13 10:51).
  - **A re-run on 2026-08-13 15:47 returned 27/30 PASS, 2 FAIL, 1 N/A and exited non-zero.** The two
    failures are `internal-link-scheme-mix` (15b) and `internal-link-www-mix` (15c). Both rules
    shipped *after* the 2026-08-11 bench crawl the gate reads, so this is plausibly stale bench
    evidence rather than a code regression — but that is **UNVERIFIED**: distinguishing the two needs
    a fresh `npm run bench`, which was not safe to run mid-audit while the analysis code was being
    changed. Treat the gate as "needs a fresh bench" until someone re-runs it.
- **Test suite:** run it, don't trust a printed figure —
  `cd poc/seo-crawler-poc && npm test` and `cd poc/seo-dashboard && npm test`.
  Snapshot at **2026-08-13 16:03 +0530**: **622 cases across 55 files** in the crawler (606 passing,
  16 failing in files that were being edited at that moment) and **14 across 3 files** in the
  dashboard — 636 repo-wide. This figure is genuinely volatile: over the two hours of the
  2026-08-13 audit the crawler suite went 519 → 622 as slices landed. The README previously said
  "296", which had been stale for a long time.
- **Rulebook size:** also volatile — **50 page rules + 21 site rules** at the same timestamp
  (`grep -rhE '^\s*id: "' poc/seo-crawler-poc/src/analysis/rules/page/*.ts | wc -l`, and the same for
  `site/`). It was 34 + 20 two hours earlier.

## Quick start

```bash
# 1. Crawler + analyzer
cd poc/seo-crawler-poc
npm install
npx playwright install chromium
npm run crawl -- https://example.com --max-pages 50   # --max-pages 0 = whole site
npm run analyze -- --run <runId>

# Optional passes over a completed run
npm run graph -- --run <runId>                        # internal PageRank -> graph.json
npm run diff -- --base <runId> --head <runId>         # crawl-over-crawl comparison

# 2. Dashboard (reads the crawler's storage/ directly)
cd ../seo-dashboard
npm install
npm run build && npm run start                        # http://localhost:3100

# 3. The seeded test site (for acceptance runs)
cd ../seo-crawler-poc
npx tsx scripts/serve-target-site.ts                  # http://localhost:3105
```

## Status

| Deliverable | State |
|---|---|
| Docs 01–07 + decision register | Complete |
| POC-1 — crawl a website | Complete; 18/18 seeded evidence classes captured |
| POC-2 — analyze SEO automatically | Complete; acceptance gate **needs a fresh bench** — see "Proof of correctness" above before calling it verified |
| POC-3 — generate SEO optimizations (AI) | Not started |
| POC-4/5/6 — modify repo, validate, open PR | Not started |
| POC-7 — read Google Search Console data | Not started |
| POC-8 — measure optimization impact | Not started |

"Not started" verified 2026-08-13: no AI-provider client and no Search Console client exists in
either app —
`grep -rlE "anthropic|openai|@anthropic-ai|googleapis|search-console" poc/*/src poc/*/lib poc/*/app poc/*/package.json`
returns only unrelated prose matches (a research citation, and `fonts.googleapis.com` in the font
extractor).

## Known limitations

Honest list of what the shipped POCs do **not** do. Each item names where to check.

**Verified 2026-08-13 16:04 +0530, and this section is more perishable than most.** Three items that
were true two hours earlier — gzipped sitemaps unsupported, no sitemap `lastmod`/`changefreq`/
`priority`, no user-agent flag — were fixed by a concurrent slice while this section was being
written, and are recorded below as fixed. Re-check before relying on any line here.

**Crawling**

- **No resumability.** `src/crawler/crawl.ts` constructs Crawlee with `persistStorage: false` and
  opens a fresh named `RequestQueue` per pass. An interrupted crawl loses its frontier entirely —
  pages already written to `storage/runs/<runId>/pages/` survive, but nothing reads them back to
  seed a restart. There is no `resume` or `checkpoint` code anywhere
  (`grep -rniE "\bresume\b|checkpoint" src/` → 0).
- **The user agent is now configurable via `--user-agent` (fixed 2026-08-13), but is still not
  applied to the page fetches.** `DEFAULT_USER_AGENT` and the flag are threaded to the robots.txt
  fetch, the robots allow/deny match, the manual redirect walk and the asset fetcher — but neither
  `CheerioCrawler` nor `PlaywrightCrawler` is given it, so the main page requests still go out with
  Crawlee/Chromium defaults. The flag's own help text says "sent on every request — pages,
  robots.txt, sitemaps, feeds", which overstates it. Robots is therefore evaluated under one identity
  and the crawl traffic goes out under another. **This one is worth confirming before acting on it —
  the file was mid-edit when checked.**
- **No proxy support of any kind.** No `proxyConfiguration`, no `--proxy`, no `HTTP_PROXY` handling
  (`grep -rniE "proxyconfiguration|--proxy|HTTP_PROXY" src/` → 0 matches).
- **Screenshots are a POC evidence feature, not a production path**, and the code says so.
  `--screenshots` forces browser rendering for every page and adds a second full page load per page
  *outside* the rps throttle. The thumbnail it writes is currently never read by anything. Error
  pages (4xx/5xx) are not captured except under `--render always`. There is no retention policy or
  size cap — roughly 272 KB per page for the full capture.

**Discovery**

- **Gzipped sitemaps: FIXED 2026-08-13.** They used to be detected and rejected with the recorded
  error `"gzip not supported in POC"`. `src/discovery/sitemap.ts` now gunzips them
  (`gunzipSync` with a `MAX_GUNZIP_BYTES` output cap), keyed off the magic bytes rather than the
  `.gz` suffix — because undici transparently decodes `Content-Encoding: gzip`, so a `.gz` URL can
  arrive already plain and a plain URL can serve a gzip body.
- **Sitemap `lastmod` / `changefreq` / `priority`: FIXED 2026-08-13.** `SitemapUrlEntry` now carries
  them (plus `images`, `videos`, `news`, and a `sourceKind` tag separating feed-discovered URLs).
  `lastmod` is stored raw exactly as authored, with trust assessed separately rather than inferred at
  parse time.
- **External link checking is a sample, not a sweep.** `--check-external` HEAD-checks **at most 50**
  unique external targets, sequentially at 2 rps with a 10s timeout. There is no GET fallback, so a
  host that rejects HEAD is recorded as that rejection. The 50 are whichever the crawl-order
  iteration reaches first — not sampled, not prioritized — and the request carries no user agent.

**Extraction**

- **Structured data is JSON-LD only. No microdata, no RDFa.** `src/extraction/schema.ts` is 18 lines
  and selects `script[type="application/ld+json"]` and nothing else. Every record's `type` field is
  the hardcoded literal `"application/ld+json"`, so the record shape implies a multi-format support
  that does not exist. (`src/extraction/headMeta.ts` does read the `itemprop` attribute on head
  meta tags — that is head-metadata capture, not a microdata item parser, and it does not feed
  `structuredData`.)

**Authenticated crawling**

- Form login handles **no** MFA/2FA, CAPTCHA, CSRF-token extraction, SSO/OAuth redirects, multi-step
  (email-then-password) forms, iframed or shadow-DOM forms, or re-login after expiry. It is one
  attempt with operator-supplied selectors and no retry, and it is **CLI-only** — the dashboard's
  Access panel offers Basic / cookie / custom-header, never form login.
- Session-loss detection warns **once** and then continues; it never re-authenticates and never
  aborts, so the tail of a run can silently be anonymous.
- The safety guard rails **skip** logout and destructive-looking URLs rather than handling them, and
  that costs coverage by design: on an authenticated crawl a legitimate article at
  `/how-to-cancel-a-subscription` is skipped as `destructive`. This is asserted by a test that names
  it as a deliberate tradeoff.
- Credentials are passed to the crawler as process arguments, so they are visible to anything that
  can read the process table. They are kept out of run evidence and out of logs by convention
  (`authLabel` names the method, never the value), not by a redaction layer.

**Analysis**

- `graph.json` (internal PageRank) **has no consumer.** Nothing in the analyzer, the report pipeline
  or the dashboard reads it. `npm run graph` is a standalone CLI pass.
- The analyzer reads a completed run off disk. There is no incremental or streaming mode, and no
  database — storage is flat JSON files under `storage/runs/<runId>/`.

**Engineering**

- **No CI.** There is no `.github/workflows`, `.gitlab-ci.yml`, `Jenkinsfile` or `azure-pipelines*`
  anywhere in the repo. Every "tests pass" claim in this repo was produced by a human or an agent
  running `npm test` locally.
- **No committed UI or end-to-end test suite.** The dashboard's tests are unit tests over its data
  layer (3 files, 14 cases at 2026-08-13 16:03; it was 1 file / 7 cases an hour earlier). Nothing
  drives the UI. All UI verification during the build was ad-hoc Playwright driving; what survives is
  screenshots under `poc/seo-crawler-poc/sprints/breadcrumbs/*-screens/` and
  `poc/seo-dashboard/qa-screenshots/`, not a suite anyone can re-run.
- `poc/seo-dashboard/lib/types.ts` is a **hand-maintained duplicate** of the crawler's
  `src/models/types.ts` — there is no TypeScript project reference between the two apps, so the two
  files are kept in sync manually and drift silently.

## Documentation accuracy

Every stale number this repo has shipped came from the same bug: a count typed into prose by hand
and then never revisited. The convention, binding on every markdown file here:

1. **A number in a doc must carry the command that produced it, and the date it was run.** If you
   cannot name the command, do not write the number.
2. **Prefer "run this" over a printed figure** for anything that moves — rule counts, test counts,
   run counts, issue counts. Point the reader at `npm test` / `analyzer-gate.ts` rather than freezing
   a value that starts rotting immediately.
3. **Never copy a number from another document.** Re-derive it from the code. Three of the stale
   counts found in the 2026-08-13 audit had been copied forward between files.
4. **Work logs are historical and are not rewritten.** A per-slice entry records what that slice
   shipped at the time. When a later slice changes the number, annotate the old entry with a pointer
   rather than editing the figure — and keep the currently-true value in one dated block (see
   "Current counts" at the top of `poc/seo-crawler-poc/WORK_LOG.md`).
5. **Generated documents get a generator, not a hand edit.** `POC-1-REPORT.md` is assembled by
   `scripts/poc-report.ts`. The only acceptable hand edit is a clearly-labelled staleness banner that
   says it will be removed by the next generation.
6. **Prefer a limitation you can trust to a feature list you can't.** A clearly-reported partial
   result beats a vaguely-reported complete one.
