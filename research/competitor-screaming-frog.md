# Screaming Frog SEO Spider — teardown

> **Scope note.** The agent assigned this teardown died on an API limit and produced nothing.
> This is a **partial, main-loop pass** covering the highest-value questions, with every claim
> verified live against Screaming Frog's own documentation on 2026-08-13. It is NOT the
> exhaustive tab-by-tab inventory originally scoped — the remaining work is listed in §5.

## 1. ⭐ Our title/description thresholds match Screaming Frog exactly

This is the most important finding, and it reframes the Semrush comparison.

| Threshold | Ours | Screaming Frog | Semrush |
|---|---|---|---|
| `titleMinChars` | 30 | **30** ✅ | 10 |
| `titleMaxChars` | 60 | **60** ✅ | 70 |
| `titleMaxPx` | 561 | **561** ✅ | — |
| `descMinChars` | 70 | **70** ✅ | no length check |
| `descMaxChars` | 155 | **155** ✅ | no length check |
| `descMaxPx` | 985 | **985** ✅ | — |

**Six for six.** Earlier the Semrush teardown framed our numbers as "3× stricter than Semrush" on
title-min and generally out of step. The correct read is the opposite: **we are aligned with
Screaming Frog — the industry-standard technical crawler — and Semrush is the outlier.** Do not
"fix" these to match Semrush.

Note SF also flags titles/descriptions that are **too short in pixels** (<200px title, <400px
description); we only check the max. That's a genuine missing check, not a threshold disagreement.

## 2. Thresholds SF publishes that we do not check at all

Verified from their issues catalogue. Each is cheap and static-path:

| Check | SF threshold | Priority |
|---|---|---|
| Title below minimum pixel width | < 200 px | Medium |
| Description below minimum pixel width | < 400 px | Low |
| URL too long | > 115 characters | Low |
| H1 / H2 too long | > 70 characters | Low |
| Image file size | > 100 KB | Medium |
| Image alt text too long | > 100 characters | Low |
| Sitemap too large (URLs) | > 50,000 | High |
| Sitemap too large (bytes) | > 50 MB | High |

The two sitemap limits are **protocol hard limits**, not opinions — a sitemap over either is
invalid and silently ignored by search engines. We parse sitemaps already, so this is near-free.

## 3. Their issue taxonomy — 23–24 categories

Response Codes · Security · URL · Page Titles · Meta Description · H1 · H2 · Content · Images ·
Canonicals · Pagination · Directives · Hreflang · JavaScript · Links · AMP · Structured Data ·
Sitemaps · PageSpeed · Mobile · Accessibility · Analytics · Search Console · Validation.

Severity is a three-tier High/Medium/Low, distributed roughly as: **High** = response codes,
security, canonicals, hreflang, AMP validation, structured-data errors, sitemaps; **Medium** =
meta descriptions, content quality, images, pagination, JS rendering, PageSpeed, links;
**Low** = URL formatting, heading length, minor mobile, accessibility.

Categories we have no coverage for at all: **Pagination, AMP, Mobile, Accessibility, PageSpeed,
Analytics, Search Console, Validation, Spelling/Grammar**.

## 4. ⭐ Crawl Analysis validates our site-rule architecture

Screaming Frog has an explicit **post-crawl "Crawl Analysis" phase**. **13 items** cannot be
computed during the crawl and require it. Confirmed members:

- **Link Score** — their internal PageRank, shown in the Internal tab
- **Orphan URLs** — three separate filters, under Sitemaps, Analytics and Search Console

Their own documentation states these "can only be viewed at the end of a crawl and require post
'Crawl Analysis' for them to be populated", and the UI marks such filters **"Crawl Analysis
Required"** in the overview pane.

**Why this matters to us:** we independently arrived at the same architecture — a site-rule phase
plus a separate `npm run graph` PageRank pass, with orphan detection living there. This is
confirmation the shape is right, and confirmation that these checks genuinely **cannot be bolted
on per-page later**. Worth copying: their UI honestly labels which findings need the second pass,
rather than silently showing an empty result.

## 5. Not yet covered — remaining work

Re-run as a full agent teardown when subagent capacity returns:

- The complete column/field inventory per tab (the exhaustive extraction list)
- Memory vs database storage mode and its scale implications
- JS rendering config (AJAX timeout, rendered-vs-raw DOM handling)
- Their near-duplicate implementation and default similarity threshold — directly comparable to
  our MinHash 0.75
- The full 13-item Crawl Analysis list (only 4 confirmed above)
- Log File Analyser, scheduling, comparison/change detection, segments, custom JS snippets
- Documented weaknesses and user complaints

**Already established elsewhere and not re-litigated here:** SF does **not** natively extract
Open Graph, Twitter card, favicon or manifest metadata — its own tutorial tells users to write
custom XPath for social tags. That remains our clearest product opening.

## Sources

- https://www.screamingfrog.co.uk/seo-spider/issues/ — issue categories, priorities, thresholds
- https://www.screamingfrog.co.uk/seo-spider/tutorials/find-orphan-pages/ — orphan URL filters requiring Crawl Analysis
- https://www.screamingfrog.co.uk/blog/11-little-known-features/ — Crawl Analysis phase, link score, the 13-item list
- https://www.screamingfrog.co.uk/seo-spider/user-guide/general/ — general user guide
