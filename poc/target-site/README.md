# Target site — the seeded acceptance fixture

A purpose-built Next.js site carrying **18 deliberately seeded SEO issue classes**. It is the ground
truth the crawler (POC-1) and analyzer (POC-2) are graded against — not a demo, and not a site any
of its content should be taken seriously from.

Was create-next-app boilerplate until 2026-08-13; it told you to open port 3000, which the
acceptance harness has never used.

## Run it

```bash
npm run dev     # or: from ../seo-crawler-poc, npx tsx scripts/serve-target-site.ts
```

The bench harness serves it on **http://localhost:3105** (`../seo-crawler-poc/scripts/serve-target-site.ts`),
and every stored acceptance run points at that port. Use the harness rather than `npm run dev` when
reproducing a bench run.

## The seeded issues

Each defect is marked in source with a `seeded:` comment naming its manifest number, so the evidence
checker can re-derive the manifest by grepping this tree instead of trusting a hardcoded list.

18 distinct classes (#1–#18), expanded into 28 labelled sub-items (#3a/#3b, #6a/#6b/#6c, #10a–#10d,
#11a–#11c, #15a–#15c, plus the rest), marked across 46 commented lines in 27 files. Counted
2026-08-13 with:

```bash
grep -rhoE "manifest #[0-9]+"      app public next.config.ts | sort -u | wc -l   # -> 18
grep -rhoE "manifest #[0-9]+[a-z]?" app public next.config.ts | sort -u | wc -l  # -> 28
grep -rc  "seeded" app public next.config.ts | awk -F: '{s+=$2} END {print s}'   # -> 46 lines
```

One extra `seeded:` comment sits outside the manifest: `app/members/account/page.tsx:1`, part of the
members area below.

They cover: missing/duplicate/over-long/short titles and meta descriptions, broken heading
hierarchy, broken internal links, an orphan page, a weakly-linked page, image defects (missing alt,
oversized PNG, missing dimensions, BMP), structured-data defects (unparseable JSON-LD, wrong
`@type`, Product missing offers), an accidental `noindex`, a robots.txt block on a legitimate
section, sitemap omissions plus a 404 entry, a mismatched canonical, http/www link inconsistency, a
2-hop redirect chain, a redirect loop, thin content, and a near-duplicate content pair.

## The members area (not part of the 18)

`app/login/`, `app/members/**`, `app/api/session/`, `app/logout/` and `proxy.ts` exist to exercise
authenticated crawling. `lib/session.ts` holds the fixture credentials — **not real accounts, not
production auth**. `proxy.ts` (Next 16's renamed middleware) is the only place that returns a bare
401 before a page renders.

Two links there are deliberate bait for the crawler's safety guard rails:
`/api/session?action=logout` (a logout expressed as a query parameter — it once got followed for
real, see the crawler's `WORK_LOG.md` §B) and `/members/reports/q1/delete`.
