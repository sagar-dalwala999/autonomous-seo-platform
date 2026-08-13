# Competitive teardown — Semrush Site Audit

**Researched:** 2026-08-12 · **Method:** primary sources only (Semrush KB, Semrush bot docs, Wayback snapshots of Semrush KB). Every substantive claim carries a source URL.

**Legend**
- **[V]** Verified — read directly on the cited Semrush page.
- **[I]** Inferred — reasoning from cited primary text, not stated outright.
- **not published** — Semrush does not publish the number. Never guessed.

**Headline caveat on the brief's premise:** there is **no published Semrush "Site Health 2.0"**. A search for the exact phrase returns zero results, and no Semrush page uses it. What *is* real and evidence-backed is an **unbranded model change between Oct 2019 and Aug 2020**, when the metric was renamed *Total Score* → *Site Health Score* and moved from a pure issue-count model to a check-weighted one. Documented with archive diffs in §3.

---

## 1. Crawl mechanics & configuration

Primary source: <https://www.semrush.com/kb/539-configuring-site-audit> unless noted.

### 1.1 Crawl sources — 4 options [V]
| Source | Behaviour |
|---|---|
| **Website** | Breadth-first search following links in page code, starting from the homepage. Semrush explicitly warns this "finds the pages most accessible from your homepage, which aren't always your most important ones." |
| **Robots.txt sitemap** | Crawls only URLs in the sitemap linked from `robots.txt`. |
| **Sitemap by URL** | One sitemap URL at a time. **Multiple sitemaps are not supported** — Semrush tells you to use the file-upload source instead. |
| **Import URLs from file** | `.csv` or `.txt`, 1 URL per line. Wizard echoes the detected URL count back for confirmation. |

Note: crawl source is BFS, **not** priority/importance-ordered. Semrush recommends a sitemap source to prioritise by importance. [V]

### 1.2 Quotas and page limits [V]
| Tier | Price | Pages/month | Pages per audit | Simultaneous audits | Results per report (export cap) |
|---|---|---|---|---|---|
| Free | — | not published | not published | 1 | not published |
| **Pro** | $139.95/mo | 100,000 | 20,000 | 2 | 10,000 |
| **Guru** | $249.95/mo | 300,000 | 20,000 | 2 | 30,000 |
| **Business** | $499.95/mo | 1,000,000 | 100,000 | 5 | 50,000 |

Sources: pages/audit + pages/month <https://www.semrush.com/kb/539-configuring-site-audit>; price, pages/month, results-per-report <https://www.semrush.com/kb/1547-seo-toolkit-pricing-limits>; simultaneous audits <https://www.semrush.com/kb/681-site-audit-troubleshooting>.

Other quota mechanics:
- Going over the monthly crawl budget requires buying extra limits or waiting for the monthly refresh. [V — kb/681]
- Crawl budget is visible at Profile → Subscription Info → "Pages to crawl". [V — kb/681, kb/543]
- Stopping a crawl mid-run offers **stop-and-save** (partial results become the current audit) or **discard** (budget preserved). [V — <https://www.semrush.com/kb/540-site-audit-overview>]
- Single-page re-audit is available from the Crawled Pages report and does **not** spend a full audit. [V — kb/543]
- **Data retention: 1 year after the last crawl.** Campaigns not re-run within 12 months are deleted along with their settings. [V — kb/540]

### 1.3 JS rendering [V]
- **Gated to Guru and Business tiers only.** Pro cannot render JS. <https://www.semrush.com/kb/539-configuring-site-audit>, <https://www.semrush.com/kb/1109-only-few-of-my-pages-are-crawled>
- Renderer: **Chromium** — "We use a similar technology stack as Googlebot (Chromium)". <https://www.semrush.com/kb/1369-js-impact-report>
- With JS off, only raw HTML is read. Performance checks on JS/CSS files still run on every tier. [V — kb/1109]
- Enabling JS rendering **changes the Site Health score** because more content is visible, so more issues are found. [V — <https://www.semrush.com/kb/114-total-score>]
- Structured data injected after render (e.g. via GTM) is only recognised with JS rendering on — i.e. Guru/Business only. [V — <https://www.semrush.com/kb/1084-structured-data-items-site-audit>]

**JS Impact report** (a genuinely differentiated feature): diffs pre-render vs post-render HTML and reports which pages changed **titles, descriptions, word count, markups, canonicals, links, client-side redirects, and meta robots**. Semrush admits it cannot localise *where* word-count or link changes occurred — you must inspect manually. <https://www.semrush.com/kb/1369-js-impact-report>, <https://www.semrush.com/kb/1370-using-js-impact-report-to-review-page> [V]

### 1.4 User agents [V]
Three options only: **SiteAuditBot (Desktop)**, **SiteAuditBot (Mobile)**, **OpenAI-Search**.
- Default is **SiteAuditBot (Mobile)** — audits as Google's mobile crawler would.
- **Googlebot Desktop/Mobile were removed** from the dropdown; existing campaigns keep it until changed.
- `OpenAI-Search` lets you crawl as OpenAI's search bot sees the site — an AI-era addition (§5).
- The UI shows the literal UA string so it can be replayed in a cURL request.

Bot blocking tokens (separate products, from <https://www.semrush.com/bot/>): `SemrushBot` (webgraph), `SiteAuditBot` (Site Audit), `SemrushBot-BA` (Backlink Audit), `SemrushBot-SI` (On Page SEO Checker), `SemrushBot-SWA`, `SplitSignalBot`, `SemrushBot-OCOB`, `SemrushBot-FT`, `SemrushBot-ESI`, `RyteBot`. [V]

**Site Audit bot IP range: `85.208.98.128/25`** — a subnet used by Site Audit only; ports 80/443. <https://www.semrush.com/kb/681-site-audit-troubleshooting> [V]

### 1.5 Crawl delay — 3 modes [V]
| Mode | Behaviour |
|---|---|
| **Minimum** (default) | ~1 second between pages; **ignores `Crawl-delay` in robots.txt**. Fastest. |
| **1 URL per 2 seconds** | Fixed 0.5 req/s. |
| **Respect robots.txt** | Honours the `Crawl-delay` directive. |

**Maximum honoured crawl delay is 30 seconds** — anything above 30 is clamped to 30. <https://www.semrush.com/kb/1056-optimize-site-audit-crawl-speed> [V]
(For the *Backlink Analytics* `SemrushBot`, the cap is 10 seconds — different bot, different cap. <https://www.semrush.com/bot/>) [V]

### 1.6 robots.txt status-code semantics [V] — <https://www.semrush.com/bot/>
- `4xx` on robots.txt → treated as **no robots.txt, no restrictions**.
- `5xx` on robots.txt → **entire site crawl is blocked**.
- `3xx` → followed and handled.
- robots.txt changes take **up to 1 hour or 100 requests** to be picked up.
- Subdomains each need their own robots.txt, or the bot assumes everything is allowed.

### 1.7 Scope, allow/disallow, parameters [V]
- **Scope**: root domain / subdomain / subfolder, plus a `Crawl all subdomains` checkbox. Default = root domain including all subdomains and subfolders.
- **Allow/disallow subfolders**: path entered after the TLD. Trailing-slash sensitivity is a documented trap — `/shoes` also excludes `/shoes-men`, whereas `/shoes/` does not. Multiple subfolders supported; **no published cap on rule count**.
- **URL parameter rules**: named parameters are *stripped* while crawling, collapsing `/shoes` and `/shoes/?page=1` into one URL. This is a crawl-budget saver, not just a filter.

### 1.8 Restrictions to bypass — 3 mechanisms [V]
1. **Bypass disallow rules in robots.txt and meta robots** — requires uploading a Semrush-provided verification `.txt` to the site root. Bypasses *both* robots.txt disallow *and* the robots meta tag.
2. **Crawl with my credentials** — username/password for basic-auth / gated areas.
3. **Crawl with Web Bot Auth signature** — Signature Agent URL + Signature Input + Signature. Explicitly aimed at hosts that block unknown bots by default (Shopify named). Semrush auto-detects the block and prompts in-product.

### 1.9 Scheduling & diffing [V]
- Schedule: **Weekly** (any weekday), **Daily**, or **Once**; manual re-run anytime. <https://www.semrush.com/kb/539-configuring-site-audit>
- **Compare Crawls**: side-by-side of any two audits back to the first ever, with per-issue **Fixed** and **New** counts. **Progress**: interactive time-series of issue counts across General / Errors / Warnings / Notices. <https://www.semrush.com/kb/545-site-audit-compare-crawls-progress>
- Changing crawler settings raises an explicit in-product warning that results are not comparable. [V — kb/681]

### 1.10 Crawled vs discovered vs blocked [V]
Overview breaks crawled pages into: **healthy · broken · have issues · redirects · blocked**. <https://www.semrush.com/kb/540-site-audit-overview>

Statistics tab reports (<https://www.semrush.com/kb/544-site-audit-statistics>): HTTP status codes (5xx/4xx/3xx/2xx/1xx + "no status code"); **Sitemap vs Crawled Pages**; **Pages Crawl Depth**; Incoming Internal Links distribution; **Markup Types** (Schema.org Microdata, Schema.org JSON-LD, Open Graph, Twitter Cards, Microformats); AMP Links; Canonicalization; Hreflang Usage.

Crawled Pages columns (<https://www.semrush.com/kb/543-site-audit-crawled-pages>): ILR, Page URL, **Blocked AI Search Bots**, Title, Description, Status Code, Issues, Crawl Depth, Pageviews (needs GA), Load Time, Markup, Structured data, Canonicalization, Sitemap, Incoming/Outgoing Int. Links, Outgoing Ext. Links, AMP link, Hreflang, JS and CSS files, JS and CSS size, Reaudit.

**Site Structure** view groups subdomains/subfolders by URL and issue count, with an explicit caveat that it reflects only what was crawled, not the real site. [V]

### 1.11 Hard size limits [V]
- **Homepage** parsed up to **4 MB**; **all other pages up to 2 MB**. <https://www.semrush.com/kb/1109-only-few-of-my-pages-are-crawled>
- kb/681 states the limit more bluntly: landing page **or total JS/CSS size** over **2 MB** cannot be processed "due to technical limitations of the tool". <https://www.semrush.com/kb/681-site-audit-troubleshooting>
- Server response **>5 seconds** → page reported as "couldn't be crawled". <https://www.semrush.com/kb/542-site-audit-issues-list>
- A stuck audit is only considered abnormal after **24 hours**. <https://www.semrush.com/kb/1111-how-long-does-it-take-to-crawl-a-website>

---

## 2. The complete check catalogue

Source for every row unless otherwise noted: **<https://www.semrush.com/kb/542-site-audit-issues-list>** ("What Issues Can Site Audit Identify?"). All rows **[V]** — names, tiers and thresholds transcribed from that page.

**Count reconciliation.** Semrush markets "140+ checks". The public page documents **100 discrete entries: 41 Errors, 34 Warnings, 25 Notices.** The gap is explicit on the page — *"Some of the checks are combined to ease your routine"*, and AMP alone is described as **"over 40 of the most common AMP-related issues"** collapsed into 4 catalogue entries. So 100 documented entries ≈ 140+ underlying checks. **Do not treat "140 checks" as 140 distinct rules.**

### 2.1 Errors (41) — "most harmful"

| # | Check name | Tier | Trigger condition | Threshold |
|---|---|---|---|---|
| 1 | Hreflang conflicts within page source code | Error | Conflicting hreflang vs `rel=canonical` URLs; conflicting hreflang URLs; no self-referencing hreflang | boolean |
| 2 | Pages returning 5XX status code | Error | Server returns 5xx | — |
| 3 | Pages don't have title tags | Error | `<title>` missing or empty | — |
| 4 | Issues with duplicate title tags | Error | Duplicate titles across pages | **exact match only** |
| 5 | Pages with duplicate content issues | Error | Two pages' content is ≥85% identical | **85%** |
| 6 | Broken internal links | Error | Internal link target errors | — |
| 7 | Pages couldn't be crawled | Error | Server response time >5 s, or server refused access | **5 s** |
| 8 | Pages couldn't be crawled (DNS resolution issues) | Error | Hostname unresolvable | — |
| 9 | Pages couldn't be crawled (incorrect URL formats) | Error | Non-standard URL scheme / stray characters / typos | — |
| 10 | Broken internal images | Error | Internal `<img>` not loadable | — |
| 11 | Pages with duplicate meta descriptions | Error | Duplicate descriptions across pages | **exact match only** |
| 12 | Format errors in Robots.txt file | Error | robots.txt syntax errors | — |
| 13 | Format errors in sitemap.xml files | Error | sitemap syntax errors | — |
| 14 | Incorrect pages found in sitemap.xml | Error | Sitemap URLs that duplicate content, redirect, or return non-200 | — |
| 15 | Pages with a WWW resolve issue | Error | Both www and non-www resolve with no declared preference | — |
| 16 | Pages with no viewport tag | Error | Viewport meta tag absent | — |
| 17 | Size of HTML on a page is too large | Error | Page HTML exceeds 2 MB | **2 MB** |
| 18 | AMP pages with no canonical tag | Error | AMP page has no `rel=canonical` | — |
| 19 | Issues with hreflang values | Error | Country code not ISO 3166-1 alpha-2, or language not ISO 639-1 | **ISO 639-1 / ISO 3166-1 alpha-2** (scripts: ISO 15924) |
| 20 | Pages returning 4XX status code | Error | 4xx | — |
| 21 | Issues with incorrect hreflang links | Error | Broken hreflang URLs, hreflang redirects, relative URLs — must be absolute + HTTP 200 | — |
| 22 | Non-secure pages | Error | HTTP page containing `<input type="password">` | — |
| 23 | Issues with expiring or expired certificate | Error | Cert expired or expiring soon | "soon" **not published** |
| 24 | Issues with old security protocol | Error | SSL, or TLS version 1.0 | **TLS 1.0** |
| 25 | Issues with incorrect certificate name | Error | Cert domain ≠ address-bar domain | — |
| 26 | Issues with mixed content | Error | HTTPS page loads non-HTTPS elements | — |
| 27 | No redirect or canonical to HTTPS homepage from HTTP version | Error | HTTP homepage lacks 301 or canonical to HTTPS | — |
| 28 | Redirect chains and loops | Error | Chain or infinite loop detected | guidance: **"do not use more than three redirects in a chain"** |
| 29 | AMP HTML issues | Error | AMP HTML fails AMP validation | aggregate of 40+ AMP checks |
| 30 | AMP style and layout issues | Error | AMP style/layout fails validation | aggregate |
| 31 | AMP templating issues | Error | AMP page contains templating syntax | aggregate |
| 32 | Pages with a broken canonical link | Error | `rel=canonical` points to a non-existent page | — |
| 33 | Pages with multiple canonical URLs | Error | More than one `rel=canonical` with different URLs | **>1** |
| 34 | Pages with a meta refresh tag | Error | Meta refresh present | — |
| 35 | Issues with broken internal JavaScript and CSS files | Error | Self-hosted JS/CSS returns error | — |
| 36 | Subdomains don't support secure encryption algorithms | Error | Old/deprecated ciphers detected on connect | — |
| 37 | Sitemap.xml files are too large | Error | Uncompressed sitemap >50 MB **or** >50,000 URLs | **50 MB / 50,000 URLs** |
| 38 | Pages with slow load speed | Error | HTML-only load time (excludes images/JS/CSS) | **not published**. Report buckets are 0–0.5 s / 0.5–1 s / 1–3 s / >3 s; guidance "under 1 second" (kb/959) |
| 39 | Invalid structured data items | Error | Fields not described in schema.org, or required Google properties missing | — |
| 40 | Malformed links | Error | Invalid URL syntax — bad/missing protocol, backslashes, stray characters | — |
| 41 | Missing the viewport width value | Error | Viewport meta lacks `width` or `initial-scale` | — |

### 2.2 Warnings (34) — "harmful"

| # | Check name | Tier | Trigger condition | Threshold |
|---|---|---|---|---|
| 1 | Pages with too much text within the title tags | Warning | Title longer than 70 characters | **70 chars** |
| 2 | Pages without enough text within the title tags | Warning | Title of 10 characters or fewer | **10 chars** |
| 3 | Pages with low text-HTML ratio | Warning | Text-to-HTML ratio is 10% or less | **10%** |
| 4 | Pages without meta descriptions | Warning | Description missing | — |
| 5 | Pages with duplicate H1 and title tags | Warning | `<title>` content == `<h1>` content | — |
| 6 | Pages without an h1 heading | Warning | `<h1>` missing or empty | — |
| 7 | Pages with an underscore in the URL | Warning | `_` used as word separator | — |
| 8 | Sitemap.xml not indicated in robots.txt | Warning | Both files exist, no `Sitemap:` line | — |
| 9 | Pages with a low word count | Warning | Fewer than 200 words on the page | **200 words** |
| 10 | Pages with temporary redirects | Warning | 302 or 307 | — |
| 11 | Images without alt attributes | Warning | `<img>` missing `alt` | — |
| 12 | Broken external images | Warning | External `<img>` not loadable | — |
| 13 | Pages with too many parameters in their URLs | Warning | Guidance: "use no more than four parameters" | **4 params** |
| 14 | Pages with no hreflang and lang attributes | Warning | Page has neither `lang` nor `hreflang` | — |
| 15 | Pages without character encoding declared | Warning | No charset in `Content-Type` header **and** no `<meta charset>` | — |
| 16 | Pages without doctype declared | Warning | No `<!DOCTYPE>` | — |
| 17 | Incompatible plugin content | Warning | Flash, JavaApplet, or Silverlight content | — |
| 18 | Pages containing frames | Warning | `<frame>` present | — |
| 19 | Broken external links | Warning | Outbound link errors | — |
| 20 | Internal links containing nofollow attribute | Warning | `rel="nofollow"` on an internal `<a>` | — |
| 21 | Pages with too many on-page links | Warning | Page contains more than 3,000 links | **3,000 links** |
| 22 | Sitemap.xml not found | Warning | No sitemap found | — |
| 23 | Subdomains don't support SNI | Warning | Server lacks Server Name Indication | — |
| 24 | Homepage does not use HTTPS encryption | Warning | Homepage served over HTTP | — |
| 25 | HTTP URLs in sitemap.xml for HTTPS site | Warning | Sitemap lists http:// URLs on an HTTPS site | — |
| 26 | Links on HTTPS pages leading to HTTP page | Warning | HTTPS page links to http:// | — |
| 27 | Uncompressed pages | Warning | `Content-Encoding` absent from the response header | — |
| 28 | Issues with blocked internal resources in robots.txt | Warning | Own CSS/JS/images disallowed in robots.txt | — |
| 29 | Issues with uncompressed JavaScript and CSS files | Warning | Compression not enabled in the HTTP response | — |
| 30 | Issues with uncached JavaScript and CSS files | Warning | Browser caching not specified in the response header | — |
| 31 | Pages have a JavaScript and CSS total size that is too large | Warning | Total JS+CSS transfer size exceeds 2 MB | **2 MB** |
| 32 | Pages use too many JavaScript and CSS files | Warning | Page uses more than 100 JS+CSS files | **100 files** |
| 33 | Issues with unminified JavaScript and CSS files | Warning | JS/CSS not minified | — |
| 34 | Too long link URLs | Warning | Link URL longer than 2,000 characters | **2,000 chars** |

### 2.3 Notices (25) — "least harmful"; **do not affect Site Health** (§3)

| # | Check name | Tier | Trigger condition | Threshold |
|---|---|---|---|---|
| 1 | Llms.txt not found *(AI Search)* | Notice | No `llms.txt` in the site root | — |
| 2 | Llms.txt file has formatting issues *(AI Search)* | Notice | `llms.txt` malformed per llmstxt.org | — |
| 3 | Too much content *(AI Search)* | Notice | Page long enough that AI engines may truncate it | **not published** |
| 4 | Outdated Content *(AI Search)* | Notice | `Last-Modified` response header older than six months | **6 months** |
| 5 | Low Semantic HTML Usage *(AI Search)* | Notice | Low ratio of semantic HTML tags to other HTML tags | ratio **not published** |
| 6 | Content not optimized *(AI Search)* | Notice | Composite of three sub-errors: poor heading hierarchy, paragraphs too long, low readability | **not published** |
| 7 | Pages with only one incoming internal link | Notice | Page has exactly one inlink | **1 inlink** |
| 8 | Links to external pages or resources returned a 403 HTTP status code | Notice | Outbound target returns 403 | — |
| 9 | Links with non-descriptive anchor text | Notice | Anchor matches a stop-list (see below) | stop-list, 11 languages |
| 10 | Pages that need more than 3 clicks to be reached | Notice | Crawl depth greater than 3 | **3 clicks** |
| 11 | Outgoing external links containing nofollow attributes | Notice | `rel="nofollow"` on outbound links | — |
| 12 | Subdomains don't support HSTS | Notice | No HSTS header | — |
| 13 | URLs longer than 200 characters | Notice | URL length >200 | **200 chars** |
| 14 | Pages with more than one H1 tag | Notice | More than one `<h1>` | **>1** |
| 15 | Robots.txt not found | Notice | No robots.txt | — |
| 16 | Pages with hreflang language mismatch issues | Notice | hreflang language ≠ page language **determined by semantic analysis** | — |
| 17 | Pages that were blocked from crawling | Notice | Blocked by robots.txt or a noindex meta tag | — |
| 18 | Orphaned pages (from Google Analytics) | Notice | Page in GA but not reached by the crawl. **Requires a connected GA account** | — |
| 19 | Orphaned pages (in sitemap) | Notice | Page in sitemap.xml with no internal links | — |
| 20 | Pages blocked by X-Robots-Tag: noindex HTTP header | Notice | `X-Robots-Tag: noindex` in response headers | — |
| 21 | Issues with blocked external resources in robots.txt | Notice | Third-party CSS/JS blocked by *their* robots.txt | — |
| 22 | Issues with broken external JavaScript and CSS files | Notice | Third-party JS/CSS returns error | — |
| 23 | URLs with a permanent redirect | Notice | 301 or 308 | — |
| 24 | Links with no anchor text | Notice | Empty anchor, naked-URL anchor, or symbols only | — |
| 25 | Resources formatted as page link | Notice | `<a href>` pointing at a resource (e.g. an image) rather than a page | — |

**Doc bug worth knowing:** in Semrush's own HTML, entry #7's title renders as *"Pages with only one incoming internal linksource formatted as page link"* — two check names concatenated by a CMS fault (anchor `id="page-link"`). The body text confirms the real check is "only one incoming internal link". [V — inspected raw HTML of kb/542]

**Non-descriptive anchor stop-list** [V — <https://www.semrush.com/kb/1060-unoptimized-anchors-site-audit>]: `click here`, `click this`, `go here`, `this`, `start`, `right here`, `more`, `learn more`, `read more`, `page`, `article`, "etc." Additionally detected in **French, German, Italian, Spanish, Portuguese, Chinese, Japanese, Danish, Russian and Norwegian** — 11 languages including English. The full list is **not** exhaustively published ("etc.").

**One check that appears only in the Performance report and not in the issues catalogue:** *Slow average document interactive time*. [V — <https://www.semrush.com/kb/959-site-audit-thematic-reports>]

### 2.4 Structured-data coverage [V] — <https://www.semrush.com/kb/1084-structured-data-items-site-audit>
- Formats recognised: **Microdata and JSON-LD only. RDFa is explicitly not supported.**
- Properties set via the `itemref` attribute are **not recognised** (Google does recognise them) — a documented false-negative.
- Two validation modes: (a) no fields undefined in schema.org, (b) all Google-required properties present.
- Recognised item types (mapped to schema.org `@type`): Article (`NewsArticle`/`BlogPosting`/`Article`), Book, Breadcrumb (`BreadcrumbList`), Carousel (`ItemList`), Course, COVID-19 announcements (`SpecialAnnouncement`), Dataset, Employer Aggregate Rating, Estimated salary (`MonetaryAmountDistribution`), Event, Fact Check (`ClaimReview`), FAQ (`FAQPage`), How-to, Job posting, **Local Business (incl. 148 specific subtypes)**, Logo (`Organization` + `logo`), Movie, Merchant listings (`Product`), Organization, Product, Product Group, Product Snippets, Q&A (`QAPage`), Guided recipe, Recipe on search, Review snippet (`Review`/`AggregateRating`), Sitelinks search box (`WebSite` + `SearchAction`), Site names, Software App, Vehicle Listing, Video (`VideoObject`).
- Scope claim: "identifies the majority of the top-level Structured Data items defined by Google, excluding those in beta or with limited access."

---

## 3. The Site Health scoring model

Primary sources: <https://www.semrush.com/kb/114-total-score> (the formula page), <https://www.semrush.com/kb/540-site-audit-overview>, <https://www.semrush.com/kb/541-site-audit-issues-report>.

### 3.1 What is actually published [V]

Range: **0–100%**, higher is better. [V — kb/540]

kb/540 verbatim:
> "Your Site Health Score (a percentage between 0% and 100%) takes into account **the number of errors and warnings found during the crawl in relation to the number of performed checks**. … Errors will have a higher impact on your Site Health Score than warnings."

kb/114 verbatim — the load-bearing paragraph:
> "Site Audit has over 140 checks — types of issues the tool checks for. **The type of check found on the site, the number of unique checks found on the site, and the number of issues fixed for one check matter. Fixing all issues related to the same check (for example, all Broken links fixed) will have an effect on the overall health of your site higher than fixing two errors from two different types of checks** (for example, Duplicate content issues and Broken links)."

And, critically:
> "**The Site Health Score doesn't depend on the number of pages crawled on the site**, since the frequency of each error's occurrence is what accounts for the score."

### 3.2 The mechanism, decoded

Reading the three statements together, the model is **check-level, not instance-level** [I, but tightly constrained by the quoted text]:

- The denominator is the **number of performed checks** (~140), not pages and not issues.
- Each *check* carries a weight by severity: **errors > warnings**.
- A check contributes penalty when it is *triggered at all*; the penalty **saturates** — which is why clearing one check entirely beats halving two checks. Instance frequency modulates within a check but does not scale linearly, otherwise "fixing all of one check" could not outrank "fixing two errors across two checks".
- **Not normalised by pages crawled** — stated outright. A 50-page site and a 50,000-page site with the same triggered-check profile score similarly.

**Per-check numeric weights are NOT PUBLISHED.** No Semrush page gives an error/warning coefficient. Anyone quoting one is guessing.

### 3.3 Do notices count? — resolved [V]

The two pages conflict on their face, and one is decisive:

- kb/114 (loose): "errors will have more weight on your Site Health Score compared to warnings **and notices**" — implies notices carry *some* weight.
- kb/541 (explicit): "Notices are considered less severe than errors or warnings. Notices contain information that some people might consider useful for fixing a site, but **they don't impact your overall site health score**."
- kb/540 (explicit on inputs): the score "takes into account the number of **errors and warnings**".

**Verdict: notices do not affect Site Health.** Two of three pages state the inputs as errors+warnings only, and kb/541 says so in as many words. kb/114's phrasing is sloppy drafting. <https://www.semrush.com/kb/541-site-audit-issues-report>

This matters for us: **all 6 AI Search checks are Notices**, so Semrush's flagship AI-era checks contribute **zero** to the headline Site Health number. They feed the separate AI Search Health score instead (§5).

### 3.4 The benchmark element [V]

There **is** an industry benchmark, but it is a *comparison display*, not part of the computation:
> "You can compare your Site Health Score to the average in your industry. To do so, select the corresponding industry from the 'Top-10% websites' drop-down. 'Top-10% websites' reflects the average Site Health score among the top 10% of sites (in terms of Site Health score) across all industries." — kb/114 [V]

No score bands (good/poor cutoffs) are published. **not published.**

### 3.5 User-controllable denominator [V] — a real design lesson

Excluding or hiding a check **removes it from the score entirely, permanently, and for future crawls**:
> "the audit will no longer take into account any of the instances of excluded checks when calculating your Site Health in future crawls." — kb/114
> "if you hid '897 outgoing internal links contain nofollow attribute,' the audit would no longer take into account any of the 897 instances of this issue when calculating your score." — kb/541

Three granularities: hide an entire issue · hide specific pages · exclude checks in bulk. Re-run required for the score to update. This makes the headline score **trivially gameable** — worth mirroring as a feature but disclosing in the UI.

### 3.6 Was there a "Site Health 2.0"? — evidence

**No such Semrush branding exists** (zero search results for the exact phrase; no Semrush page uses it). But the model *did* change, and the archive proves it:

| Snapshot | Metric name | Model |
|---|---|---|
| [2019-10-23](https://web.archive.org/web/20191023030507/https://www.semrush.com/kb/114-total-score) | **"Total Score"** | "based on the number of your total errors and total warnings found on the pages crawled". Errors > warnings. Notices "don't have as much of an impact on the Total Score as errors and warnings have" — i.e. **notices did count**. **No mention of checks.** |
| [2020-10-07](https://web.archive.org/web/20201007051933/https://www.semrush.com/kb/114-total-score) | **"Site Health Score"** | Check-level model appears verbatim: "over **130** checks … the number of unique checks found on the site … fixing all issues related to the same check will have a higher effect". Adds "doesn't depend on the number of pages crawled". |
| [2022-05-22](https://web.archive.org/web/20220522145209/https://www.semrush.com/kb/114-total-score) | Site Health Score | Identical to 2020; still "over 130 checks". |
| 2026-08 (live) | Site Health Score | "over **140** checks"; adds the Top-10% industry benchmark, the JS-rendering caveat, and the AI Search Health cross-link. |

**So: the rename + move from instance-count to check-weighted happened between 2019-11-20 and 2020-08-01.** [V] Magnitude of score shift at rollout: **not published**.

### 3.7 Is our Health Score defensible?

Yes, and Semrush's own model gives us two concrete arguments:
1. **A check-weighted denominator is the industry-standard defensible shape.** If ours is instance-count-driven, it is *behind* Semrush's 2020 model and will behave pathologically on large sites (one templated bug = thousands of instances = score floor).
2. **Semrush explicitly does not normalise by page count.** If ours does normalise, that is a *defensible divergence*, not an error — but we should say so out loud, because it makes our numbers non-comparable to theirs.
3. Their weights are unpublished, so we cannot be accused of deviating from a public standard. Publishing ours is a differentiator, not a risk.

---

## 4. Thematic reports and their unique metrics

Primary source: <https://www.semrush.com/kb/959-site-audit-thematic-reports>. **Eight** widgets on the Overview: Robots.txt, Crawlability, HTTPS, International SEO, Performance, Internal Linking, Markups, Core Web Vitals. [V]

### 4.1 Robots.txt
Change-detection on the robots.txt file plus file-related issues. Unique value: **diffing robots.txt between crawls** and surfacing that a change occurred. [V]

### 4.2 Crawlability
Feeds: crawl depth distribution, HTTP status codes, **sitemap vs crawled-pages comparison**. Guidance: keep crawl depth under 3 clicks. A sitemap-vs-crawled mismatch is interpreted as a crawlability signal. [V]

### 4.3 HTTPS Implementation
Three groups: **certificate registration**, **server support**, **website architecture**. Draws on checks 22–27, 36 (Errors) and 23–26 (Warnings), plus HSTS (Notice). Notably this requires **TLS-layer inspection**, not just HTTP: expiry, CN/SAN mismatch, protocol version, cipher strength, SNI, HSTS. [V]

### 4.4 International SEO
Unique metrics: a donut of pages with hreflang correct / with issues / absent, plus **a table of pages with *missing* hreflang values**, derived by comparing each page's declared language set against **the total set of language versions found across the whole crawl**. Semrush hedges this hard: "the information we provide should not be used as a guide to action. It is provided solely for informative purposes." [V]

**Documented scope limit: "At this time, Semrush only checks the HTML of your site to look for these tags."** — hreflang in **XML sitemaps and HTTP headers is not checked**. [V] This is a real, citable gap.

### 4.5 Performance
Checks feeding it (verbatim list): large HTML page size · redirect chains and loops · slow page load speed · uncompressed pages · uncompressed JS/CSS · uncached JS/CSS · too-large JS/CSS total size · too many JS/CSS files · unminified JS/CSS · **slow average document interactive time**.

Unique metrics: **Avg. Page (HTML) Load Speed** trended over time; load-time histogram with buckets **0–0.5 s / 0.5–1 s / 1–3 s / >3 s**; JS+CSS **file-count** histogram; JS+CSS **size** histogram. Explicit caveat repeated twice: HTML load speed **excludes images, JS and CSS**. [V]

### 4.6 Internal Linking — the most differentiated report
Five sections: **Pages Crawl Depth · Internal Links (incoming and outgoing distributions) · Internal Link Distribution · Internal Link Issues · Pages passing most Internal LinkRank.** [V]

**Internal LinkRank (ILR) — the actual published definition** [V — <https://www.semrush.com/kb/543-site-audit-crawled-pages>]:
> "Internal Link Rank. How accessible a page is, based on **its incoming internal links and crawl depth**. Higher ILR means more internal links and lower crawl depth."

**This is not PageRank.** It is a two-factor accessibility heuristic (inlink count + crawl depth), not an eigenvector over the link graph. The exact combining function is **not published**. Our PageRank implementation is a *stronger* metric on the merits — but ILR is more explainable to a customer, and Semrush exposes it as a **filterable, sortable column** (e.g. "issues + ILR above 70"), which is the genuinely valuable product move.

**Crawl budget waste:** there is **no metric named "crawl budget waste"** in Site Audit. The phrase appears only as prose justification inside issue descriptions (broken canonicals, permanent redirects, orphaned pages in sitemap). **not published as a metric.** [V]

### 4.7 Markups
Graded on **the ratio of invalid to valid structured data items**. Breakdown by page count, markup type, and the actual items found. Markup Types histogram covers Schema.org Microdata, Schema.org JSON-LD, Open Graph, Twitter Cards, Microformats. [V]

### 4.8 Core Web Vitals — the weakest report
- **Lab data only, via Google Lighthouse.** No CrUX/field data. [V — <https://www.semrush.com/kb/1102-how-do-you-collect-data-to-measure-core-web-vitals-in-site-audit>]
- Metrics: **LCP, CLS, and TBT**. TBT is used as a lab proxy because FID cannot be recreated in a lab. **The docs still reference FID** — superseded by INP in Google's own model since March 2024, so this page is stale. [V]
- Emulation profiles: **Mobile** 360×640 px, Slow 4G, 4× CPU slowdown (2 vCPU @ 2.20 GHz). **Desktop** 1350×940 px, 10 Mbps, no CPU throttling.
- **Servers are US-based**, with an acknowledged latency skew for non-US sites; Semrush recommends PageSpeed Insights instead.
- **Only 10 pages are analysed per campaign.** [V — <https://www.semrush.com/kb/1140-how-does-site-audit-select-pages-to-analyze-for-cwv>] Selection: the **first ten pages returning 200 OK** — for a website crawl, usually the homepage plus pages linked from it; for sitemap/URL-list sources, literally the first ten in order. The set is **frozen across crawls** to preserve trend continuity. Manually overridable to a list of **up to 10 URLs**; if a page becomes unavailable its historical data is deleted.

---

## 5. AI-era checks — what is actually inside Site Audit

### 5.1 The six AI Search checks — all Notices [V] — kb/542

| Check | Tier | Trigger | Threshold |
|---|---|---|---|
| Llms.txt not found | Notice | No `llms.txt` in site root | — |
| Llms.txt file has formatting issues | Notice | Malformed per llmstxt.org conventions | — |
| Too much content | Notice | Page long enough to be truncated by AI models | **not published** |
| Outdated Content | Notice | `Last-Modified` header older than **six months** | **6 months** |
| Low Semantic HTML Usage | Notice | Low ratio of semantic HTML tags to other tags | **not published** |
| Content not optimized | Notice | Composite: poor heading hierarchy + paragraphs too long + low readability | **not published** |

Filterable in the Issues tab via an **"AI Search" filter**. [V — kb/1601]

### 5.2 AI bot access checks — exactly 8 bots [V]

<https://www.semrush.com/kb/1571-blocked-from-ai-search-site-audit> — the **"AI Crawlers/Bots Semrush Site Audit Checks For"** table contains exactly these 8, and kb/1601 independently confirms the count ("out of 8 major AI crawlers"):

| Bot | Type per Semrush |
|---|---|
| `ChatGPT-User` | On-demand fetcher |
| `OAI-SearchBot` | AI search crawler |
| `Googlebot` | Traditional SEO bot + AI search crawler |
| `Google-Extended` | AI training bot + AI search crawler |
| `Perplexity-User` | On-demand fetcher |
| `PerplexityBot` | AI search crawler |
| `Claude-User` | On-demand fetcher |
| `Claude-SearchBot` | AI search crawler |

**Precision that matters: `GPTBot` and `ClaudeBot` are discussed in the page's prose as AI *training* bots but are NOT in the checked table.** `Bytespider`, `CCBot`, `Applebot-Extended`, `Meta-ExternalAgent`, `Amazonbot`, `cohere-ai`, `Diffbot`, `Timpibot` are **not mentioned anywhere** — do not attribute them to Semrush.

**Detection method is robots.txt only.** Repeatedly: "blocked from any specific AI search engine bots **via robots.txt**". There is **no** WAF/status-code/server-level AI-bot block detection in Site Audit. [V] — a clear gap we can beat.

Surfaced in two places: the **Blocked from AI Search** widget on Overview, and a **Blocked AI Search Bots** column + filter in Crawled Pages. [V — kb/543]

### 5.3 AI Search Health score [V] — <https://www.semrush.com/kb/1601-ai-search-health-audit>

A **separate score from Site Health**, shown as its own widget on the Site Audit Overview. Published inputs — three factors, **no weights given**:
1. **AI search checks in Site Audit** — "crawlability, structured data, internal linking, etc."
2. **AI bot access** — whether AI crawlers are blocked by robots.txt.
3. **Technical readiness** — "schema markup, crawlable navigation, internal links, llms.txt".

Formula: **not published.** Range: **not published** (described only as "higher is better"). Re-running an audit produces "new Site Health **and AI Search Health** scores". [V — kb/540]

Note the design: because AI checks are Notices and Notices don't count toward Site Health, Semrush needed a second score to make them visible. That is a coherent pattern worth copying.

### 5.4 The `OpenAI-Search` user agent [V]
A crawler-settings option (not a check) letting you run the entire audit as OpenAI's search bot — "to view your site as ChatGPT search sees it". This is the only AI-specific *crawl* capability. <https://www.semrush.com/kb/539-configuring-site-audit>, kb/1601

### 5.5 The product boundary — in Site Audit vs sold separately

| Capability | Where it lives |
|---|---|
| 6 AI Search checks, AI Search Health score, Blocked from AI Search widget/column, `OpenAI-Search` user agent | **Inside Site Audit**, all SEO Toolkit tiers [V — kb/542, kb/1601, kb/1571, kb/539] |
| Brand mentions/citations in ChatGPT, Perplexity, AI Overviews; share-of-voice in LLM answers | **Separate "AI Visibility" toolkit** — its own KB category tree (`Semrush Toolkits → AI Visibility`) [V — kb/1626 listed under AI Visibility; kb/1601 is filed under AI Visibility despite being a Site Audit feature] |
| Enterprise AIO | **Separate enterprise product** (footer nav, distinct from SEO Toolkit) [V — semrush.com footer] |
| Content Optimizer (the recommended fix for "Content not optimized") | **Content Toolkit** — separate subscription [V — kb/542 links to kb/1540-content-optimizer] |

Ship dates for the AI checks: **not published.** kb/1571 and kb/1601 carry no publication dates. [V]

---

## 6. Documented weaknesses

### 6.1 Self-admitted false positives — PRIMARY, and unusually candid

- **Working pages reported broken.** Four named causes: robots.txt/noindex blocking; **hosting providers blocking Semrush bots as suspected DDoS**; DNS failure at re-crawl time; **server cache serving stale data to bots**. <https://www.semrush.com/kb/1088-why-do-working-pages-appear-broken> [V]
- **Crawling too fast manufactures issues.** Verbatim: "The crawler crawls the website too fast and as a result the pages don't load properly. Then, **Semrush presents 'false positives,'** or reports issues in your audit results that would not have been reported if the Audit crawled at a slower rate." <https://www.semrush.com/kb/1056-optimize-site-audit-crawl-speed> [V] — and *Minimum* (the fastest, robots.txt-ignoring mode) is the **default**.
- **Broken-link checks** carry a standing disclaimer: "our crawler may detect a working link as broken … if the server hosting the website you're referring to blocks our crawler." [V — kb/542, on both Broken internal links and Broken external links]
- **hreflang language mismatch** self-disclaims: "our crawler may report your webpage to have a 'hreflang language mismatch' issue even if the hreflang value shows the correct language. This usually happens if your webpage is multilingual or has too little content." [V — kb/542]
- **Duplicate content false positives are structural.** The 85% threshold fires on http/https and www/non-www pairs by design, and on thin pages where shared header/footer chrome alone exceeds 85% similarity. <https://www.semrush.com/kb/119-duplicate-content> [V]
- **Structured data:** `itemref`-set properties are missed although Googlebot reads them; RDFa unsupported. [V — kb/1084]

### 6.2 Coverage gaps — evidence-backed

| Gap | Evidence |
|---|---|
| **Core Web Vitals on only 10 pages**, lab-only, US servers, frozen page set | kb/1140, kb/1102 [V] |
| **No INP** — still documents FID/TBT | kb/1102, kb/959 [V] |
| **hreflang checked in HTML only** — not XML sitemaps, not HTTP headers | kb/959 verbatim [V] |
| **RDFa structured data unsupported** | kb/1084 [V] |
| **AI-bot blocking detected via robots.txt only** — no WAF/status-code detection | kb/1571 [V] |
| **Only 4 crawl sources; one sitemap URL at a time** | kb/539 [V] |
| **No log-file analysis in Site Audit** — Log File Analyzer is a separate tool in the KB nav tree | Semrush KB nav [V] |
| **No custom extraction (XPath/regex) and no user-defined rules** — absent from every configuration page | kb/539, kb/541 [I — argument from documented absence] |
| **No accessibility/WCAG auditing** — no such check in the 100-entry catalogue | kb/542 [I — absence] |
| **No meta-description length check at all** — only *missing* and *duplicate* | kb/542 [V — verified absence across the full catalogue] |
| **Duplicate title/description are exact-match only** — no fuzzy/near-duplicate detection for metadata | kb/542 verbatim [V] |
| **Duplicate-content 85% threshold is not user-configurable** — no configuration surface documents it | kb/119, kb/539 [I — absence] |
| **API access is Business-tier only** | kb/1547 [V] |

### 6.3 Quota and operational constraints
- Export/report row caps: **10,000 (Pro) / 30,000 (Guru) / 50,000 (Business)** results per report — a hard ceiling on getting your own data out. [V — kb/1547]
- **JS rendering requires Guru ($249.95/mo) minimum.** On Pro, a JS-heavy site can silently yield a 4–6 page crawl. [V — kb/1109]
- **Page-size ceilings:** 4 MB homepage / 2 MB other pages — larger pages simply are not parsed. [V — kb/1109]
- **Data deleted after 12 months** without a re-run. [V — kb/540]
- Site Structure view is explicitly not the real site structure when limits or scope were applied. [V — kb/543]

### 6.4 Opacity
- **No published weights** for errors vs warnings. [V — kb/114 omits them]
- **No published formula or range** for AI Search Health. [V — kb/1601]
- **No published threshold** for "Pages with slow load speed", "Too much content (AI Search)", "Low Semantic HTML Usage", "Content not optimized", or certificate "expiring soon". [V — kb/542]
- **No published ILR formula.** [V — kb/543 gives only a prose definition]
- Score is **user-gameable via hide/exclude**, permanently and silently, with no published audit trail. [V — kb/114, kb/541]

*(No third-party/forum criticism is cited here: the session's web-search budget was exhausted before that sweep could run, and I will not paraphrase complaints I did not read. Everything above is Semrush's own documentation — which is stronger evidence anyway.)*

---

## 7. Ranked gaps — checks we should add

Mapped against our current **47 rule IDs** (`poc/seo-crawler-poc/src/analysis/rules/`) and thresholds (`poc/seo-crawler-poc/analysis.config.json`).

### 7.0 Threshold conflicts to resolve first — these contradict what we ship today

| Our threshold | Our value | Semrush published | Verdict |
|---|---|---|---|
| `titleMaxChars` | 60 (Screaming Frog) | **70** | Two defensible standards. Semrush is char-based at 70; we also carry `titleMaxPx` 561 which is the better signal. **Keep 60/561, document the divergence.** |
| `titleMinChars` | 30 (Screaming Frog) | **10** | We are **3× stricter**. Semrush only flags titles ≤10 chars. Our 30 will generate far more warnings on short-but-valid titles. Consider severity downgrade below 30, error below 10. |
| `descMinChars` / `descMaxChars` | 70 / 155 | **no check exists** | Semrush does not check description length at all. Ours is a genuine superset — keep it, but it means we cannot claim parity-by-count against their catalogue. |
| `thinContentWords` | 80 | **200** | We are **2.5× more lenient**. Semrush's 200-word floor is the industry-visible number. Our 80 was fixture-tuned, not standards-derived — this is the weakest-justified threshold we ship. **Recommend raising to 200** (or making 200 the default and 80 a fixture override). |
| `lowTextRatio` | 0.10 | **10%** | **Exact match.** Our config comments call this a "judgment call at the low end" — it is not; it is exactly Semrush's published threshold. Update the `_sources` note to cite kb/542. |
| `slowPageMs` | 2000 | not published; guidance "**under 1 second**", buckets 0–0.5/0.5–1/1–3/>3 s | Semrush's *uncrawlable* cut-off is **5 s**. Our 2000 ms sits mid-bucket. Consider aligning to their bucket edges (1000 / 3000 ms) for comparability. |
| `redirectChainMax` | 1 | guidance "**no more than three**" | We are stricter. Defensible (Screaming Frog-aligned) but expect 3× the issue volume vs Semrush on the same site. |
| `nearDupSimilarity` | 0.75 (MinHash/Jaccard) | **85% identical** | We are **more aggressive** and will cluster pairs Semrush ignores. Note the mechanisms differ (their 85% is undefined as to algorithm). Given the known extraction bug flagged in memory that invalidates our threshold, **re-derive after the fix and consider 0.85 as the defensible public default with 0.75 as an aggressive mode.** |
| `weakInlinkCount` | 1 | **1** | **Exact match** with Semrush's "only one incoming internal link" Notice. |

### 7.1 Ranked additions

**Tier 1 — high value, data we ALREADY extract (cheapest wins)**

| # | Check to add | Semrush tier + threshold | Data needed | Have it? |
|---|---|---|---|---|
| 1 | Crawl depth > 3 clicks | Notice, **3** | Link graph + BFS depth from homepage | ✅ have graph (PageRank) — just need depth |
| 2 | Too many on-page links | Warning, **>3,000** | Link count per page | ✅ links |
| 3 | Title == H1 (duplicate H1 and title) | Warning | title + h1 | ✅ both |
| 4 | URL length > 200 chars | Notice, **200** | URL | ✅ |
| 5 | Link URL > 2,000 chars | Warning, **2,000** | Links | ✅ |
| 6 | Underscore in URL | Warning | URL | ✅ |
| 7 | Too many URL parameters | Warning, **>4** | URL | ✅ |
| 8 | Temporary redirect (302/307) vs permanent (301/308) split | Warning / Notice | Status codes + redirect chains | ✅ have both, not split by type |
| 9 | hreflang value validity — ISO 639-1 lang, ISO 3166-1 alpha-2 country | Error | hreflang | ✅ hreflang extracted |
| 10 | hreflang → non-200 / redirect / relative URL | Error | hreflang + status codes | ✅ |
| 11 | hreflang ↔ canonical conflict; missing self-reference | Error | hreflang + canonical | ✅ both |
| 12 | Multiple canonical URLs on one page | Error, **>1** | canonical (all instances) | ✅ if we capture all, not just first |
| 13 | Sitemap too large | Error, **>50 MB or >50,000 URLs** | Sitemap parse + byte size | ✅ sitemap parsed |
| 14 | Sitemap not referenced in robots.txt · robots.txt not found · sitemap not found | Warning / Notice | robots.txt + sitemap | ✅ |
| 15 | HTTP URLs in sitemap on an HTTPS site | Warning | Sitemap + scheme | ✅ |
| 16 | Blocked from crawling (robots.txt or meta noindex) as an explicit issue | Notice | robots + meta robots | ✅ (have `robots-blocked`, `noindex`) |

**Tier 2 — high value, NEW extraction required (small additions)**

| # | Check to add | Semrush tier + threshold | New data to capture |
|---|---|---|---|
| 17 | **AI bot access** — 8 named bots blocked in robots.txt | (Semrush: widget + column) | Parse robots.txt per-UA for `ChatGPT-User`, `OAI-SearchBot`, `Googlebot`, `Google-Extended`, `Perplexity-User`, `PerplexityBot`, `Claude-User`, `Claude-SearchBot`. **Beat them: also detect server/WAF/403-level blocks, which they do not do.** |
| 18 | **llms.txt** present + well-formed | Notice ×2 | Fetch `/llms.txt`, validate against llmstxt.org structure |
| 19 | Viewport tag missing · viewport missing width/initial-scale | **Error ×2** | `<meta name="viewport">` content parse |
| 20 | Character encoding not declared | Warning | `<meta charset>` + `Content-Type` header charset |
| 21 | Doctype not declared | Warning | Raw HTML prologue |
| 22 | HTML size too large | **Error, 2 MB** | Response body byte length |
| 23 | Uncompressed page | Warning | `Content-Encoding` response header |
| 24 | `X-Robots-Tag: noindex` | Notice | Response headers |
| 25 | Nofollow on internal links · nofollow on outgoing external links | Warning / Notice | `rel` attribute per link |
| 26 | Links with no anchor text (empty / naked URL / symbols only) | Notice | Anchor text per link |
| 27 | **Non-descriptive anchor text** | Notice | Anchor text + stop-list. Semrush publishes the English list and covers 11 languages — we can ship a superset and publish it (they hide theirs behind "etc.") |
| 28 | Resources formatted as page link (`<a href>` → image/resource) | Notice | Link target extension/content-type |
| 29 | Malformed links | Error | URL syntax validation during link extraction |
| 30 | Page has neither `lang` nor `hreflang` | Warning | `<html lang>` attribute |
| 31 | Frames · Flash/JavaApplet/Silverlight | Warning ×2 | Tag presence |
| 32 | Mixed content · HTTPS page linking to HTTP | Error / Warning | Subresource URLs + link schemes |
| 33 | Non-secure page (HTTP + `<input type="password">`) | Error | Form input types |
| 34 | **`Last-Modified` older than 6 months** (AI freshness) | Notice, **6 months** | `Last-Modified` response header |
| 35 | **Semantic HTML ratio** (AI) | Notice | Count semantic tags (`article`,`section`,`nav`,`header`,`footer`,`main`,`aside`,`figure`) vs total. **Publish our threshold — they don't** |

**Tier 3 — needs new crawler capability (subresource fetching / TLS inspection)**

| # | Check to add | Semrush tier + threshold | Capability needed |
|---|---|---|---|
| 36 | JS/CSS: too many files · total size too large · uncompressed · uncached · unminified · broken (internal + external) | Warning ×5, Error, Notice — **>100 files, >2 MB** | **Fetch and inspect subresources**: count, transfer size, `Content-Encoding`, `Cache-Control`, minification heuristic |
| 37 | Broken external links · external 403 · broken external images | Warning ×2, Notice | **Outbound HEAD/GET fetching** with the false-positive disclaimer Semrush uses |
| 38 | Blocked internal/external resources in robots.txt | Warning / Notice | Resource URLs + robots.txt matching (incl. third-party robots.txt) |
| 39 | TLS suite: expiring/expired cert · cert name mismatch · old protocol (TLS 1.0) · weak ciphers · SNI · HSTS | Error ×4, Warning, Notice | **TLS handshake inspection** — entirely new capability, and the whole HTTPS thematic report depends on it |
| 40 | WWW resolve issue · HTTP homepage without redirect/canonical to HTTPS · homepage not HTTPS | Error ×2, Warning | Probe all four host/scheme variants of the homepage |
| 41 | Core Web Vitals (LCP/CLS/**INP**) | — | Lighthouse run. **Beat them trivially: they do 10 lab-only pages with no INP.** Even 50 pages with INP is a decisive win |
| 42 | Structured data: required-property validation against Google's rich-result requirements | Error | Google requirement tables per type. We have `structured-data-missing-required-property` — verify type coverage vs their 31-type list, and **support RDFa + `itemref`, which they explicitly do not** |
| 43 | JS-impact diff (pre-render vs post-render: title, description, word count, canonical, links, meta robots, markup) | — | We already run a Cheerio pass **and** a Playwright escalation — **we are one diff away from matching their JS Impact report for free.** Highest leverage item on this list. |

### 7.2 Strategic notes

1. **#43 is the standout.** Our two-pass architecture (static Cheerio + Playwright escalation) already produces both HTML states. Diffing them replicates a premium Semrush report at near-zero marginal cost, and Semrush's own version admits it cannot localise word-count/link changes — we can.
2. **Publish what they hide.** Unpublished: error/warning weights, AI Search Health formula, ILR formula, slow-page threshold, semantic-HTML ratio, "too much content" limit. Every one is a place where "here is our exact threshold and why" is a differentiator.
3. **Their Notices are free real estate.** All 6 AI checks are Notices and contribute nothing to Site Health — so a Semrush user optimising the headline number is actively ignoring AI readiness. A single score that weights AI checks properly is a positioning wedge.
4. **Copy the two-score pattern** (Site Health + AI Search Health) rather than one blended number — it is how they solved the "new checks would destabilise the historical score" problem.
5. **Copy hide/exclude, but disclose it.** Their score is silently gameable. Showing "Health 87 (3 checks excluded)" is strictly better and costs nothing.
6. **Beat the CWV report.** 10 lab-only pages, frozen set, US servers, no INP, stale FID docs. This is their softest surface.

---

## Source index

| Topic | URL |
|---|---|
| Full issues catalogue | <https://www.semrush.com/kb/542-site-audit-issues-list> |
| Crawl config, sources, limits, UA, crawl delay, JS rendering, bypass | <https://www.semrush.com/kb/539-configuring-site-audit> |
| Overview report, Site Health inputs, retention, re-run | <https://www.semrush.com/kb/540-site-audit-overview> |
| **Site Health formula, benchmark, excluded checks** | <https://www.semrush.com/kb/114-total-score> |
| Issues report; **notices excluded from Site Health**; hide/exclude | <https://www.semrush.com/kb/541-site-audit-issues-report> |
| Crawled Pages, **ILR definition**, columns, Site Structure | <https://www.semrush.com/kb/543-site-audit-crawled-pages> |
| Statistics: status codes, crawl depth, markup types | <https://www.semrush.com/kb/544-site-audit-statistics> |
| Compare Crawls / Progress | <https://www.semrush.com/kb/545-site-audit-compare-crawls-progress> |
| Thematic reports (all 8) | <https://www.semrush.com/kb/959-site-audit-thematic-reports> |
| Duplicate content **85%** | <https://www.semrush.com/kb/119-duplicate-content> |
| Unoptimized anchor stop-list + 11 languages | <https://www.semrush.com/kb/1060-unoptimized-anchors-site-audit> |
| Structured data types, RDFa/itemref limits | <https://www.semrush.com/kb/1084-structured-data-items-site-audit> |
| **False positives** | <https://www.semrush.com/kb/1088-why-do-working-pages-appear-broken> |
| CWV data collection, Lighthouse, emulation profiles | <https://www.semrush.com/kb/1102-how-do-you-collect-data-to-measure-core-web-vitals-in-site-audit> |
| **CWV = 10 pages only** | <https://www.semrush.com/kb/1140-how-does-site-audit-select-pages-to-analyze-for-cwv> |
| Page-size limits 4 MB / 2 MB; JS tier gating | <https://www.semrush.com/kb/1109-only-few-of-my-pages-are-crawled> |
| Crawl-delay max 30 s; **self-admitted false positives from fast crawling** | <https://www.semrush.com/kb/1056-optimize-site-audit-crawl-speed> |
| Stuck-audit 24 h | <https://www.semrush.com/kb/1111-how-long-does-it-take-to-crawl-a-website> |
| Troubleshooting, bot IP range, simultaneous-audit caps | <https://www.semrush.com/kb/681-site-audit-troubleshooting> |
| JS Impact report; Chromium renderer | <https://www.semrush.com/kb/1369-js-impact-report> |
| JS Impact usage + admitted limits | <https://www.semrush.com/kb/1370-using-js-impact-report-to-review-page> |
| Pricing, monthly crawl budgets, export caps | <https://www.semrush.com/kb/1547-seo-toolkit-pricing-limits> |
| **8 AI bots checked** | <https://www.semrush.com/kb/1571-blocked-from-ai-search-site-audit> |
| AI Search Health score | <https://www.semrush.com/kb/1601-ai-search-health-audit> |
| SemrushBot tokens, robots.txt status-code semantics | <https://www.semrush.com/bot/> |
| Archive: "Total Score" (2019, pre-change) | <https://web.archive.org/web/20191023030507/https://www.semrush.com/kb/114-total-score> |
| Archive: "Site Health Score" (2020, check-weighted) | <https://web.archive.org/web/20201007051933/https://www.semrush.com/kb/114-total-score> |
| Archive: 2022 snapshot ("over 130 checks") | <https://web.archive.org/web/20220522145209/https://www.semrush.com/kb/114-total-score> |
