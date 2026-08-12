# POC-1 Report — SEO Crawler

Generated: 2026-08-11T11:04:53.856Z
Node: v22.18.0 | Platform: win32

Bench run: `storage\bench\20260811-110248`

## Per-target coverage

| Target | Attempted | Successful | Failed | Blocked | JS-rendered | Duration | Coverage % |
|---|---|---|---|---|---|---|---|
| target-full | 25 | 21 | 4 | 0 | 1 | 3.9s | 84% |
| target-robots | 21 | 18 | 3 | 3 | 1 | 3.8s | 85.7% |
| redirect-chain | 5 | 5 | 0 | 0 | 0 | 2.8s | 100% |
| redirect-loop | 1 | 0 | 1 | 0 | 0 | 1.5s | 0% |
| books | 150 | 150 | 0 | 0 | 0 | 66.4s | 100% |
| quotes-js | 30 | 30 | 0 | 0 | 2 | 13.3s | 100% |
| example | 1 | 1 | 0 | 0 | 1 | 3.5s | 100% |

## Seeded-evidence checklist

# Seeded-evidence checklist (brief §6)

Runs used: target-full=20260811-110248-target-full, target-robots=20260811-110248-target-robots, redirect-chain=20260811-110248-redirect-chain, redirect-loop=20260811-110248-redirect-loop

| # | Expectation | Status | Evidence |
|---|---|---|---|
| 1 | /about record has title:null and metaDescription:null | PASS | pages/<id-for-/about>.json#title=null,metaDescription=null |
| 2 | /blog/rain-gear-care and /blog/layering-basics share an identical title | PASS | pages/*.json#title: rain-gear-care="Hiking Gear Tips \| Summit Trail Gear", layering-basics="Hiking Gear Tips \| Summit Trail Gear" |
| 3 | /guides/thru-hiking-gear-guide title >70 chars; /contact title <15 chars | PASS | guide title len=121; contact title len=7 |
| 4 | /about and /products/granite-hiking-boots both have metaDescription:null | PASS | about.metaDescription=null, granite.metaDescription=null |
| 5 | /blog/choosing-hiking-boots and /blog/backpack-fitting share an identical metaDescription | PASS | pages/*.json#metaDescription equal: true |
| 6 | /contact has 0 H1s; /products/cascade-rain-shell has 2+ H1s; /blog/trail-nutrition has H1+H3 but 0 H2s | PASS | contact.h1=0, cascade.h1=2, nutrition.h1/h2/h3=1/0/3 |
| 7 | /gear-sale, /blog/ultralight-tents, /products/alpine-tent recorded in failures.json as http-4xx | PASS | failures.json: /gear-sale=http-4xx, /blog/ultralight-tents=http-4xx, /products/alpine-tent=http-4xx |
| 8 | /gear-archive has zero inlinks -> report.orphanCandidates contains it (or is confirmed undiscoverable) | PASS | not crawled (zero inlinks + absent from sitemap = undiscoverable); sitemap absence confirmed = true |
| 9 | /products/summit-stove's only inlink is /guides/first-time-backpacking | PASS | inlink sources found: [/guides/first-time-backpacking] |
| 10 | missing-alt img on /products/switchback-trekking-poles; hero-large.png present on the guide; homepage hero img has no width/height; BMP img on /products/granite-hiking-boots | PASS | noAlt=true, largeImgPresent=true (byte-size not in schema — presence only), noDims=true, bmpFormat=true |
| 11 | /blog/choosing-hiking-boots has unparseable JSON-LD (parseError set); /blog/layering-basics has @type:Recipe on an article; /products/ridgeline-backpack-45l has Product JSON-LD missing offers | PASS | invalidJsonLd=true, recipeOnArticle=true, productMissingOffers=true |
| 12 | /products/switchback-trekking-poles has robots.noindex:true | PASS | robots.noindex=true |
| 13 | robots-on run: /guides/* URLs appear in blocked.json | PASS | blocked.json guides entries: [http://localhost:3105/guides/thru-hiking-gear-guide, http://localhost:3105/guides/first-time-backpacking, http://localhost:3105/guides/gear-repair] |
| 14 | sitemaps.json includes /guides/gear-repair (404); report.sitemap.sitemapEntriesFailed catches it; crawledNotInSitemap surfaces >=2 of [/contact,/blog/rain-gear-care,/products/summit-stove] | PASS | hasGearRepair=true, sitemapEntriesFailed catches it=true, crawledNotInSitemap omissions found=[/contact, /blog/rain-gear-care, /products/summit-stove] |
| 15 | /blog/rain-gear-care canonical points at /products/cascade-rain-shell; >=1 internal link authored as http://; both www and non-www absolute internal links preserved | PASS | canonicalMismatch=true, hasHttpLink=true, hasWwwLink=true, hasNonWwwLink=true |
| 16 | /old-gear run shows a 2-hop redirectChain ending at /products; /loop-a run has a redirect-loop failure | PASS | chain: redirectChain.length=2, finalUrl=http://localhost:3105/products; loop: failure found=true (reason=redirect-loop) |
| 17 | /blog/trail-snacks content.wordCount < 80 | PASS | wordCount=35 |
| 18 | /blog/winter-hiking-checklist and /blog/winter-day-hike-checklist have near-identical wordCount (~90% similar content) | PASS | wordCount a=176, b=177, contentHash a=0e0ccebaa5b10a836362e9b94df2cfaaae6616d8595e1a11b04dd9107677dec2, b=a4727897e3c1472f74d516ad04650e0ed509002a113ce0afdd0cc395b881a37e (schema has no similarity score — wordCount proximity is the crawler-level proxy; true near-dup scoring is POC-2's job) |

**18/18 PASS, 0 FAIL, 0 N/A**

## Seeded-comment source manifest (live grep of ../target-site)

Reconstructed at check-run time from `seeded` comments in app/, public/, next.config.ts — not hardcoded.

- `app\about\page.tsx:1` — seeded: no metadata export — page has no <title> and no meta description (manifest #1, #4)
- `app\about\page.tsx:24` — seeded: http:// (non-https) absolute internal link (manifest #15b)
- `app\blog\backpack-fitting\page.tsx:6` — seeded: duplicate meta description, shared with /blog/choosing-hiking-boots (manifest #5)
- `app\blog\choosing-hiking-boots\page.tsx:6` — seeded: duplicate meta description, shared with /blog/backpack-fitting (manifest #5)
- `app\blog\choosing-hiking-boots\page.tsx:14` — seeded: invalid JSON-LD — truncated, unparseable (manifest #11a)
- `app\blog\layering-basics\page.tsx:5` — seeded: duplicate title, shared with /blog/rain-gear-care (manifest #2)
- `app\blog\layering-basics\page.tsx:14` — seeded: wrong schema type — Recipe markup on an article page (manifest #11b)
- `app\blog\page.tsx:44` — seeded: broken internal link, article does not exist (manifest #7)
- `app\blog\page.tsx:49` — seeded: absolute non-www URL while the homepage uses www (manifest #15c)
- `app\blog\rain-gear-care\page.tsx:5` — seeded: duplicate title, shared with /blog/layering-basics (manifest #2)
- `app\blog\rain-gear-care\page.tsx:9` — seeded: canonical points at an unrelated product URL (manifest #15a)
- `app\blog\trail-nutrition\page.tsx:18` — seeded: broken heading hierarchy — H1 jumps to H3, no H2 on the page (manifest #6c)
- `app\blog\trail-snacks\page.tsx:3` — seeded: thin content — main content under 80 words (manifest #17)
- `app\blog\winter-day-hike-checklist\page.tsx:3` — seeded: near-duplicate content pair with /blog/winter-hiking-checklist, ~90% identical (manifest #18)
- `app\blog\winter-hiking-checklist\page.tsx:3` — seeded: near-duplicate content pair with /blog/winter-day-hike-checklist, ~90% identical (manifest #18)
- `app\contact\page.tsx:4` — seeded: very short title, under 15 chars (manifest #3b)
- `app\contact\page.tsx:13` — seeded: page has no H1 — starts at H2 (manifest #6a)
- `app\gear-archive\page.tsx:3` — seeded: orphan page — no other page links here, absent from sitemap.xml (manifest #8)
- `app\guides\page.tsx:28` — seeded: broken internal link, product does not exist (manifest #7)
- `app\guides\thru-hiking-gear-guide\page.tsx:5` — seeded: overlong title, well past 70 chars (manifest #3a)
- `app\guides\thru-hiking-gear-guide\page.tsx:16` — seeded: very large unoptimized image, multi-MB PNG (manifest #10b)
- `app\page.tsx:14` — seeded: img without width/height attributes (manifest #10c)
- `app\page.tsx:36` — seeded: broken internal link, /gear-sale does not exist (manifest #7)
- `app\page.tsx:41` — seeded: absolute www URL while other pages use non-www (manifest #15c)
- `app\products\cascade-rain-shell\page.tsx:14` — seeded: img missing alt attribute (manifest #10a)
- `app\products\cascade-rain-shell\page.tsx:21` — seeded: second H1 on the page (manifest #6b)
- `app\products\granite-hiking-boots\page.tsx:6` — seeded: no meta description on this page (manifest #4)
- `app\products\granite-hiking-boots\page.tsx:30` — seeded: BMP image — suboptimal format for the web (manifest #10d)
- `app\products\page.tsx:38` — seeded: http:// (non-https) absolute internal link (manifest #15b)
- `app\products\ridgeline-backpack-45l\page.tsx:13` — seeded: valid Product JSON-LD but missing offers/price/availability (manifest #11c)
- `app\products\ridgeline-backpack-45l\page.tsx:29` — seeded: img missing alt attribute (manifest #10a)
- `app\products\summit-stove\page.tsx:3` — seeded: weakly-linked page — its ONLY inlink is from /guides/first-time-backpacking (manifest #9)
- `app\products\switchback-trekking-poles\page.tsx:8` — seeded: accidental noindex robots meta (manifest #12)
- `app\products\switchback-trekking-poles\page.tsx:16` — seeded: img missing alt attribute (manifest #10a)
- `public\robots.txt:1` — # seeded: blocks the legitimate /guides/ section (manifest #13)
- `public\sitemap.xml:2` — <!-- seeded (manifest #14): omits /contact, /blog/rain-gear-care, /products/summit-stove, /gear-archive; includes the 404 URL /guides/gear-repair -->
- `next.config.ts:6` — seeded: 2-hop redirect chain /old-gear -> /gear-old -> /products (manifest #16)
- `next.config.ts:9` — seeded: redirect loop /loop-a <-> /loop-b (manifest #16)


## Not verified / known limitations

- None recorded — every matrix target produced a report.json.

This report is auto-assembled from `storage/bench/<stamp>/manifest.json` + `evidence.md`. It reports only what those files contain — it does not re-verify crawl correctness beyond the seeded-evidence checklist above.