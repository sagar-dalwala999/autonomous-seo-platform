# Extraction completeness — R&D

> Goal (Sagar, 2026-08-12): make the crawler extract **everything** a page can tell us — fonts,
> full metadata, all heading levels, paragraph structure, SSL certificate, favicon, initial
> loaders, and whatever else we're currently blind to. Plus a visual preview of each crawled URL
> so we can eyeball a page against its record and spot what's missing.
>
> **Research first. No code changes until the gap analysis is agreed.**

## 0. Honest baseline — what we extract TODAY (verified against source, not memory)

| Area | Captured now | Known gap |
|---|---|---|
| Title | first `<title>` + all instances + char count + pixel-width estimate | — |
| Meta description | first + all instances + counts | — |
| Headings | **h1, h2, h3 only** (`extractHeadings`) | **h4/h5/h6 missing entirely**; no document order across levels; no nesting/outline |
| Content | flattened text, wordCount, sha256 hash, text ratio | **no paragraphs, lists, tables, blockquotes**; no per-block structure; no sentence stats or readability |
| Meta tags | robots/googlebot, description, keywords, refresh, x-robots-tag header | **no complete tag inventory**; no viewport, charset, theme-color, author, publisher, article:*, etc. |
| Links | `<a href>` w/ anchor, rel, target, internal/external, authored + normalized | no link position (nav/content/footer); no `<link>` relations beyond canonical/hreflang/sitemap |
| Images | src, alt (null vs empty), width/height attrs, format from extension | **no byte size**, no natural dimensions, no srcset/sizes, no loading attr, no `<picture>` sources |
| Video | `<video>` files, YouTube/Vimeo/iframe embeds, poster, providerId | no duration/dimensions |
| Structured data | JSON-LD raw + parsed + parse errors | **no Microdata, no RDFa**; no validation against Google requirements |
| Social | og:* and twitter:* raw maps | — |
| hreflang | `<link rel=alternate hreflang>` | not from HTTP headers or sitemap |
| Canonical | resolved absolute | no HTTP-header canonical |
| Page stats | htmlBytes, textRatio, domNodes, contentEncoding, httpVersion | no resource counts/sizes, no render-blocking analysis |
| Transport | status, redirect chain w/ per-hop codes, response time, a few security headers | **no SSL/TLS certificate data**, no TLS version, no cookies set, no full header capture |
| Rendering | renderedWith, renderSignals, raw + rendered HTML, render divergence | **no screenshot**, no loader/splash detection, no console errors, no failed requests |
| Favicon | **nothing** | all variants missing |
| Fonts | **nothing** | @font-face, families in use, web-font providers, font-display |
| Tech stack | **nothing** | framework/CMS/CDN/analytics detection |

## 1. Research lane A — head metadata, favicons, link relations

### 1a. ⭐ THE ARCHITECTURAL FINDING: the `<head>` closes early

Per the HTML tree-construction algorithm, the "in head" insertion mode accepts only `base`,
`basefont`, `bgsound`, `link`, `meta`, `title`, `noscript`, `noframes`, `style`, `script`,
`template`. **Anything else** — a `<div>`, `<img>`, `<iframe>`, `<svg>` — implicitly closes the
head. Google confirms verbatim: *"Once Google detects one of these invalid elements, it assumes
the end of the `<head>` element and stops reading any further elements."*

> **CORRECTION (verified 2026-08-13, implementation):** this lane originally also listed
> `<noscript>` *containing* an `<img>` as head-closing. **That is wrong for scripting-enabled
> parsers.** Measured against parse5: with scripting enabled (what browsers and Googlebot do),
> `<noscript>` content in head is treated as raw text, so the `<img>` is never an element and the
> head stays open — a canonical after it is still in head. It only closes the head with scripting
> *disabled*. We must not emit a finding for this case. See `tests/unit/extraction/head.test.ts`.

**Consequence: every metadata field we extract can be silently wrong** unless we track where the
head actually ended. This requires a spec-compliant tree builder (parse5 — not regex, not a lenient
scan) and recording, per element, whether it landed in head or body, plus the byte offset of the
first head-invalidating element. Screaming Frog ships this as *"Invalid HTML Elements In `<head>`"*
(High) and calls it out as the usual root cause behind "outside head" findings.

**And "outside head" means different things per signal — never emit one verdict:**
| Signal | Honoured outside head? |
|---|---|
| `rel=canonical` | **NO** — Google: *"only accepted if it appears in the `<head>`"* |
| `meta robots` | **YES** — Google: *"doesn't enforce placement… will respect robots meta tags in the body"* |
| `hreflang` | **NO** — must be in a well-formed head |
Both SF and Sitebulb flag directives-outside-head as High/Critical, but Google's own docs say it
honours them there. We should report that as a robustness warning, not an indexing claim.

### 1b. Parsing rules that make naive extraction wrong

- **Open Graph is an ordered stream, not a dictionary.** Per ogp.me, structured properties attach
  to the *preceding* root: three `og:image` tags with interleaved `og:image:width` bind by
  position. **A `{property → value}` hash map is incorrect by construction** — it needs a state
  machine over `<meta>` in document order.
- **Conflict rules invert between vocabularies**: OG = *first* wins; `twitter:card` = **last** wins
  (X, verbatim). Capture both first and last occurrence.
- **`twitter:*` must be read from BOTH `name=` and `property=`** — X's parser falls back to
  `property`. Key on the token, read both attributes.
- **Metadata arrives on five surfaces**: raw head · raw body · rendered DOM · HTTP `Link:`/
  `X-Robots-Tag` headers · HTTP 103 Early Hints. Most clients silently swallow 1xx — if ours does,
  say so rather than reporting "no early hints".
- **`<base href>` silently rewrites every relative canonical, hreflang, icon, alternate and
  preload on the page** — a top-10 real-world SEO bug and the reason Google advises absolute
  canonicals. Multiple `<base href>`: all but the first ignored. OG tags do *not* respect it.
- **Charset must serialize within the first 1024 bytes** — a `<meta charset>` at byte 1100 is valid
  HTML that does not work, producing mojibake. Record the byte offset. Almost no tool checks this.
  Detection precedence: BOM > HTTP header > meta prescan.

### 1c. Directives — the per-engine reality

Google supports exactly 12 robots values (`robots-tags.json`); `none` must be **expanded** to
`noindex,nofollow` before evaluation or a parser string-matching "noindex" misses it; `max-snippet`
and `unavailable_after` are **silently ignored when unparseable**; conflicts resolve to the *more
restrictive* rule. Only three name tokens are honoured: `robots`, `googlebot`, `googlebot-news`.

**Never emit blanket "this tag is dead" findings** — the engines disagree:
- `keywords`: dead for Google, **live for Yandex**.
- `noarchive`/`nocache`: dead for Google, **load-bearing for Bing** — they're Bing's Copilot and
  AI-training opt-out.
- **Yandex inverts the conflict rule**: *"Allow directives take priority when combined with
  prohibiting ones"* — the opposite of Google/Bing. Never compute one global effective directive.

**AI crawler opt-out, definitively**: no vendor (Google-Extended, GPTBot, ClaudeBot, PerplexityBot,
CCBot, Applebot-Extended) documents an HTML meta opt-out — all are robots.txt-only. `meta noai` has
**zero documented honouring parties**; report it as present-but-ineffective, never recommend it.
Bing is the exception that puts AI opt-out in the meta tag. An accurate AI-visibility report
therefore needs robots.txt + meta + headers.

### 1d. Favicons — harder than it looks

Twelve declaration forms (icon, shortcut icon, apple-touch-icon(+precomposed), mask-icon,
msapplication-*, manifest icons, implicit `/favicon.ico`, implicit `/apple-touch-icon.png`,
browserconfig.xml). Spec resolution: *"If there are multiple equally appropriate icons, user agents
must use **the last one declared in tree order**"* — the opposite of most authors' intuition — and
*"if that icon is inappropriate [404], try the next-most-appropriate"*, **so every candidate must be
probed, not just the winner**.

Practical checks nobody ships: declared `sizes` vs **actual decoded pixels**; CSP `img-src` blocking
the icon (a crawler reporting "200 OK" is a false pass); the **ICO-before-SVG ordering rule** (both
Evil Martians and the Kyoto guide agree: declare ICO first with explicit `sizes`, SVG last).
**SVG favicons are now at 90.5% support including Safari 26** — the well-known guides saying Safari
doesn't support them are out of date.

**Google SERP favicon requirements**: home page only · one per hostname · **both Googlebot AND
Googlebot-Image must be able to crawl** (two distinct robots.txt checks) · square, ≥8×8 · stable URL
(content-hashed filenames are an anti-pattern *specifically for Google*) · manifest `icons[]` is
**ignored** — a site whose only icons are in the manifest has no SERP favicon. **Correction to
widely-repeated folklore: the "multiple of 48px" rule is NOT in the current Google docs** — don't
implement it.

### 1e. The clearest product opening in the whole research

**Neither incumbent extracts social metadata natively.** Screaming Frog's own tutorial tells users
to scrape OG and Twitter tags with custom XPath; Sitebulb's published On Page hints cover only
title/description/H1. Neither surfaces favicon resolution, charset validation, or resource-hint
checks (`preload` without `as`, font preload without `crossorigin` → guaranteed double download).

Also worth stealing: **pixel width, not character count** — SF flags titles >561px and descriptions
>985px, because SERP truncation is by rendered width ("IIIIIIIIII" and "WWWWWWWWWW" are the same
character count). Sitebulb uses characters only, so this is a genuine SF differentiator.

**Architectural warning from both tools**: hreflang return-links, canonical loops, isolated URLs and
duplicate clustering are **whole-crawl graph passes, not per-page checks**. Our analyzer already has
a site-rule phase, which is the right shape — but this confirms it cannot be bolted on later.

## 2. Research lane B — content structure + typography/fonts

### 2z. TWO CONFIRMED BUGS IN SHIPPED CODE (verified by Main Claude, not just reported)

**Bug 1 — we delete article titles and bylines from the content corpus.**
`src/extraction/content.ts:6` strips `header, footer` unconditionally. Per W3C, those map to the
`banner`/`contentinfo` landmarks **only when scoped to `<body>`**. A scoped
`<article><header><h1>…</h1><p class="byline">…</p></header>` is article furniture, not page chrome.
Live proof run: given an article whose `<header>` holds its `<h1>` and byline, our extractor keeps
only *"The actual article body text goes here…"* — **the title and byline are gone**. This hits every
well-marked-up blog and news site.

Downstream blast radius: `content.text`, `wordCount`, `textRatio`, `contentHash`, and the **MinHash
near-duplicate scores**. Our `nearDupSimilarity` default of 0.75 was tuned against a measured 0.824
on the seeded pair — **measured over this corrupted corpus**. Fixing the corpus will shift those
numbers, so the threshold must be re-measured, not assumed still valid.

**Bug 2 — stripping `[aria-hidden="true"]` is wrong.** That attribute hides content from assistive
technology while leaving it **visible to sighted users and indexed by Google**. Stripping it
under-counts real content. It should be counted, and separately flagged (visible-but-aria-hidden is
itself an accessibility defect).

**Blocker for any font work** — `src/crawler/crawl.ts:607` aborts every `font` request
(`if (type === "image" || type === "font" || type === "media") return route.abort();`). With fonts
aborted, `document.fonts` statuses collapse to `error`/`unloaded` and CDP reports only fallback
system fonts. **Any font extraction added today would silently produce wrong data.** Lifting the
font abort (keeping image/media blocked) is a prerequisite, and it costs crawl speed — make it a flag.

### 2b. Content structure — what to capture and how

**Main-content extraction**: don't swap the tag-strip for Readability.js — its measured recall is
0.764 (Trafilatura's 990-doc benchmark), meaning it *discards real content*, which is the expensive
error for us. Build a layered resolver instead: `<main>` → single `<article>` → `role="main"` →
class/ID heuristics for div-soup → Readability only as fallback **and as a divergence signal**
(when landmark-scoped text and Readability text disagree sharply, that's itself a reportable
"unclear main content" finding). Emit `contentAreaMethod` provenance on every page so every derived
metric is auditable. Precedent: Screaming Frog makes the content area configurable by tag/class/ID
and recomputable without a re-crawl — and notably does **not** strip `<header>` by default.

**Structural inventory worth capturing** (as counts/flags, not issues): paragraphs (count + avg
words — a real thin-content signal), lists, tables **with `th`/`caption`/`scope` flags** (the only
reliable data-vs-layout-table discriminator), blockquotes, `pre`/`code` (also a **readability kill
switch** — code destroys syllable counts), `figure`/`figcaption`, `dl`, forms/buttons.

**Verified: Google indexes accordion/tab content** — its mobile-first docs actively recommend
"moving content into accordions or tabs to save space". So `<details>` text **must** be counted.

**Do not ship** a "add lists/tables to win featured snippets" rule. Google's own page answers the
question "how do I mark my page as a featured snippet?" with: *"**You can't.**"*

### 2c. Text metrics — honest positioning

Word count is **not** a ranking factor (Google: *"Are you writing to a particular word count because
you've heard Google has a preferred word count? No, we don't."*) — keep it for thin-content and
near-dup work, which is how our rule already frames it.

Readability: no evidence it's a ranking factor. Flesch-Kincaid was derived on **531 US Navy
enlistees**; ARI on USAF typewriter manuals. Traps if we implement it: Flesch RE is **not** bounded
0–100 (max 121.22, goes negative — never clamp); syllable counting is the whole ballgame and
hyphenation libraries systematically **undercount**; Gunning Fog and SMOG degrade *discontinuously*
on syllable errors; SMOG's ×30/sentences extrapolation is invalid on short pages — exactly the pages
a crawler cares about. Best pattern to copy: `retext-readability` runs 7 formulas and flags only
when ≥4 agree. Report as descriptive, never as a defect, and never auto-recommend "shorten your
sentences" (the standing critique: simplifying only word/sentence length can make text *harder*).

**Language detection is genuinely actionable** — Google states outright it does **not** use
`hreflang` or `<html lang>` to detect language. So detected-vs-declared mismatch is a real defect
class invisible to declaration-only checkers, and it pairs with our existing hreflang rules.

### 2d. Fonts — the mechanisms and what matters

**Declared ≠ used.** `getComputedStyle().fontFamily` returns the *authored stack*, not what
rendered, and font matching is **per-character** — one paragraph can render in three physical fonts.

Four extraction channels, each answering a different question: **(A)** network capture → real URLs,
byte sizes, formats, **wrong-MIME detection** (6–7% of font files ship
`application/octet-stream`); **(B)** `document.fonts` → declared faces with `font-display`,
`unicodeRange`, and `status` — and because browsers download faces **lazily**, `status === "loaded"`
is a strong signal the face was *actually used*; note it exposes **no `src`**, and Google-Fonts
subsetting produces many FontFace entries per family (dedupe on `family` or report 30 fonts on a
2-font page); **(C)** CSSOM → gives `src` but **throws SecurityError on cross-origin sheets**;
**(D)** CDP `CSS.getPlatformFontsForNode` → `isCustomFont` and **`glyphCount`**, the metric nothing
else provides ("your brand font rendered 40 glyphs, Arial rendered the rest").

**Highest value-to-cost finding in the whole report**: third-party font origins
(`fonts.googleapis.com`, `use.typekit.net`) are detectable from **raw HTML alone**, and the Munich
Regional Court ruled (2022) that remotely loading Google Fonts violates GDPR by transmitting visitor
IPs — with a demand-letter wave following. For EU-facing clients that's a **compliance finding**,
not a performance nitpick.

Also raw-HTML-cheap and zero-false-positive: **`rel=preload as=font` missing `crossorigin`** causes
a guaranteed double download (fonts must be fetched in anonymous CORS mode even same-origin).

**Grade `font-display` by value, not presence** — Lighthouse's own audit passes `font-display:
block`, which is precisely the FOIT-causing value (open issue #15771). Beating that is a real
differentiator.

Architectural note: `extractPage($, artifact)` is a pure Cheerio function with no page handle, so
font data **cannot** flow through the existing pipeline. It needs a separate `renderedSignals`
channel populated inside the Playwright handler, and it will only ever exist for escalated pages —
design the field as `fonts: FontReport | null` from day one.

### 2a. Heading structure — what's actually true (sub-lane, complete)

**Google's own position, verbatim from the SEO Starter Guide, under a section titled "Things we
believe you shouldn't focus on"**: *"Having your headings in semantic order is fantastic for screen
readers, but from Google Search perspective, it doesn't matter if you're using them out of order…
There's also no magical, ideal amount of headings a given page should have."* Mueller: sites rank
fine "with no H1 tags or with five H1 tags."

**No WCAG success criterion at any level requires an H1, forbids multiple H1s, or forbids skipped
levels.** Proper nesting appears only in *advisory* technique G141. axe tags `heading-order`,
`empty-heading` and `page-has-heading-one` as **"Deque Best Practice"**, not WCAG-mapped. Calling a
skipped level a "WCAG violation" is factually wrong.

**The asymmetry that matters for implementation**: per MDN and W3C/WAI, **downward jumps are
legitimate** — an h4 followed by an h2 simply closes a subsection. Only **upward** jumps (h2 → h4)
are the defect. A rule flagging any level delta > 1 in either direction floods users with false
positives. The WHATWG living standard states it as: each heading "must have a heading level that is
less than, equal to, or 1 greater than" the preceding one.

**Don't compute levels from `<section>` nesting.** The HTML5 outline algorithm was removed from the
standard on 1 July 2022 (whatwg/html PR #7829) and was never implemented by any browser or screen
reader. Flat h1–h6 rank in DOM order is the only correct model.

**What the incumbents actually do** — both stop at H1/H2 for SEO data. Screaming Frog: *"By default,
the SEO Spider will only extract the first two `<h1>`'s"* — no H3–H6 tabs; full h1–h6 validation
exists only inside its axe accessibility module, requires JS rendering, and is pass/fail. Sitebulb:
*"collects the content of the first two H1s and first two H2s"*, no hierarchy view. **Neither renders
a document outline. Neither segments boilerplate headings from main-content headings.** That is the
largest unserved surface.

Threshold conventions disagree and none are authoritative: SF flags >70 **characters**; Sitebulb
flags <3 or >10 **words**; Semrush suggests 50–60 characters. Google states no limit.

**Concrete implications for our shipped analyzer** (verified against `src/analysis/rules/page/on-page.ts`):
- Our severities are already right — `h1-multiple` and `heading-hierarchy-skip` are both `notice`,
  matching the evidence that these aren't ranking factors. **Keep them there; never promote to error.**
- But `heading-hierarchy-skip` can only detect one narrow case — *"H3 present with no H2"* — because
  we capture only h1–h3. It cannot see an h2→h4 skip at all, and it is a crude proxy for the real
  document-order sequence check.
- Category is `on-page`, which implies SEO/ranking. Reframe as accessibility-best-practice /
  content-quality per the evidence above.
- Once h1–h6 are captured in DOM order, replace the proxy with a real sequence check that flags
  **upward jumps only**, computed over main content with boilerplate reported separately.

## 3. Research lane C — transport, TLS/certificate, tech-stack fingerprinting

> Note: the lane delivered its *fingerprinting* section (§5) in full depth as a correcting
> addendum; the TLS-certificate mechanics arrived only as references. Those are well-established
> (`tls.connect` + `getPeerCertificate(true)`, `response.securityDetails()` in Playwright) and can be
> confirmed cheaply at build time — the decision-relevant material below came through complete.

### 3a. Tech fingerprinting — measured over the live 7,575-technology corpus (2026-08-12)

**Where the signal actually is** (% of technologies detectable by each field):
`scriptSrc` **51.0%** · `js` globals 43.9% (browser required) · `dom` 21.2% · inline `scripts` 10.4% ·
`meta` **10.0%** · `headers` 8.8% · `cookies` 4.9% · `certIssuer` 0.1% · **`probe` 0.04%**.

**78.9% is reachable from raw HTML + headers + cookies alone**; 20.5% requires a browser and is
weighted toward analytics/martech/chat/Shopify-apps. Two decisions fall out:
- **Lead with `scriptSrc`, not `meta generator`.** Folklore over-weights the generator tag (10%);
  script sources touch half the corpus and are free on the static path.
- **Zero active probing.** Only 3 of 7,575 technologies need a probe request (Magento's
  `/magento_version`, Sitecore, TYPO3) and 1 uses robots.txt. 0.04% coverage isn't worth the
  WAF-block and reputational cost.

**Rule craft worth copying**: `requires`/`implies` gating (keeps 260 WordPress-plugin and 183
Shopify-app rules dormant until the platform matches — the difference between evaluating 7,575 rule
sets per page and a few hundred); `confidence:` scores summing to 100 (surface as a score, not a
boolean); version-capture ternaries that double as variant discriminators (GA4 vs Universal
Analytics from one pattern; Magento Enterprise vs Community). Best single fingerprint in the corpus:
Drupal's `Expires: 19 Nov 1978` header — Dries' birthday, hardcoded in core, zero false positives.

### 3b. Licensing — corrected with primary evidence

The widely-repeated framing is wrong in two ways, and both matter:
- **The operative event was repository DELETION, not relicensing.** Wayback CDX: last HTTP 200 on
  2023-08-22, first 404 on 2023-08-26. Wappalyzer never published the dataset under a proprietary
  licence — they stopped publishing and removed the repo.
- **The "surviving forks are MIT" claim is flatly wrong.** The repo was GPL-3.0; only the
  `wappalyzer-core` npm package was tagged MIT, which is the likely origin of the confusion. Every
  live fork (enthec 7,575 techs, HTTP Archive 4,000) is **GPL-3.0**. GPL grants on
  already-distributed versions are perpetual and irrevocable, so the forks are legally clean — the
  residual risk isn't being sued, it's **inheriting copyleft**.

**The MIT-wrapper trap**: `simple-wappalyzer` (MIT code) downloads the GPL enthec ruleset at
postinstall; `wappalyzergo` (MIT code) commits enthec-derived JSON; `httpx -tech-detect` inherits it.
**An MIT badge on the wrapper does not launder GPL on the data** — the most common mistake in this
space. `simple-wappalyzer` additionally swallows postinstall fetch errors, so CI silently gets a
stale ruleset — the worst failure mode.

**GPL-3.0 for a hosted SaaS**: obligations trigger on *distribution*, not use — fine server-side
(that's why HTTP Archive and ProjectDiscovery operate as they do). But it bites the moment we ship a
Chrome extension, desktop crawler, npm package, or bundle the JSON client-side. For a platform that
might plausibly do any of those, that's a **foreseeable** trap that closes quietly.

**Cleanly usable**: `retire.js` — Apache-2.0, 241k weekly downloads, maintained. Only 76 libraries
(a JS-version detector, not a stack ruleset), but its `filecontent` technique is the most
transferable idea: fetch the actual JS asset and regex its banner comment for an exact version no
HTML parsing yields — one extra request per *unique* script URL, which caches well across a site.
`nuclei` also ships an independent MIT ruleset. **WhatWeb is ambiguous** (GPL-2.0 file, but every
plugin carries commercial-restriction notices) — reference for logic, not a dependency.

### 3c. Paid APIs — rejected on TERMS, not price

Wappalyzer API ($250–850/mo) terms state the data *"may not be … **embedded in a customer-facing
product**"* — which is precisely what a tech-stack panel in our dashboard would be. BuiltWith
($295–995/mo) is more permissive but forbids "duplicate functionality", vague enough to need written
clarification before building a headline feature on it.

**The decisive argument is capability, not cost**: both vendors price **per domain**, not per page.
That makes them affordable — and also means they can never give us **per-page detection**, which is
where the real SEO signal lives: a headless storefront on `/shop` but WordPress on `/blog`, an AMP
template, a legacy subsection, a migration in progress. That's the argument for owning it.

### 3d. Lane C recommendation

Build our own ruleset (~60 must-never-be-wrong + ~40 second-tier, including **Yoast/RankMath — high
value for an SEO tool specifically**), **adopt enthec's schema but not its data** (field names,
confidence/version tag syntax, requires/implies semantics — the schema is good design, the content
carries the copyleft), use enthec **internally as a recall-grading corpus** (analysis, not
distribution), bolt on retire.js, and run a static lane on every page plus a browser lane on the
homepage and one page per detected template. Estimated 2–3 weeks, ~85–90% of enthec's recall on
mainstream sites — the right trade, since nobody churns over a missed obscure review widget but
people do churn over a wrong "this site is WordPress".

## 4. Research lane D — visual preview, screenshots, loaders, resource profile

**Method note**: figures below marked *(measured)* were produced by live runs on this machine
(Playwright 1.62.1, 1366x768, Windows), not quoted from docs.

### 4.1 The iframe question — answer is NO, with evidence

Live header survey of 26 real hosts: **20 of the 24 that responded (83%) block third-party
framing** via `X-Frame-Options` or CSP `frame-ancestors`. Blocked included google, amazon,
nytimes, github, bbc, linkedin, walmart, target, moz, ahrefs, semrush, hubspot — **and a stock
Shopify storefront (`allbirds.com`: `DENY` + `frame-ancestors 'none'`)**, which matters because
client sites are often Shopify. Framable: wix, squarespace, wikipedia.

Real Chromium test confirmed the failure mode: the browser refuses the load, the frame lands on
`chrome-error://chromewebdata/`, and **the user sees a silent blank box** — the error appears only
in the console. Worse, even the sites that DO allow framing give `contentDocument === null`
(cross-origin), so we could not measure, annotate, scroll, or screenshot the frame.

`X-Frame-Options: ALLOW-FROM` is obsolete — modern browsers ignore it entirely. Population data
(HTTP Archive Web Almanac 2024): 37% of sites send XFO; `frame-ancestors` is the most-used CSP
directive at 56% of CSP sites.

Header-stripping proxy: technically possible, rejected. It requires rewriting every relative URL,
srcset, CSS url(), fetch base and postMessage origin; it defeats a security control the site owner
deliberately enabled (the same mechanism clickjacking uses); it republishes third-party content
from our origin; and it makes us an SSRF/open-proxy surface. The only legitimate iframe path is a
consenting client adding our origin to their own CSP — useless for competitors/prospects.

**Verdict: build preview on stored screenshots + an "open live in new tab" link.**

### 4.2 Screenshots — measured benchmarks

**WebP q75 was smallest on all 12 measurements**, 1.9–4.8x smaller than PNG. Counter-intuitively
**JPEG was LARGER than PNG on flat-UI pages** (example.com 17 vs 11 KB) — web-page screenshots are
mostly flat colour, so the "JPEG for photos" instinct gives the wrong answer. Never JPEG here.

The thumbnail trick worth keeping: set `deviceScaleFactor: 0.25` on the browser **context** (not a
screenshot option). CSS layout stays byte-identical (content column measured 853.328px at every
scale — no mobile breakpoints triggered), only raster density drops:
**342x192 WebP q75 = ~5 KB in ~69ms**, zero image-processing dependencies.

Storage for 1,000 pages *(measured medians)*: thumbnails 5–15 MB · viewport shots ~50 MB ·
full-page WebP 200–600 MB · **full-page PNG 0.6–2.9 GB**. At 10k pages full-page PNG is 6–29 GB —
the number that kills the feature.

Both leaders ship screenshots and both hedge: Screaming Frog stores rendered-page shots
(JS-rendering mode only, temporary unless the project is saved, default viewport 411x731 mobile /
1024x768 desktop, resized up to 8192px); Sitebulb's is opt-in with a literal
"THIS WILL TAKE UP A LOT OF DISK SPACE" warning. **Nobody stores full-page PNGs for every URL.**

Gotcha *(measured)*: lazy-loaded images below the fold are missing unless you scroll first
(smashingmagazine 16 → 21 images). Our crawler already scrolls during the Playwright pass, so a
shot taken after that gets it free — but see the LCP ordering constraint in §4.5.

### 4.3 The replay idea — a legitimate near-pixel-perfect alternative

We already store rendered HTML per page. Replaying it from OUR origin in a
`sandbox="allow-same-origin"` iframe with an injected `<base href>` measured near-identical to the
live page: books.toscrape 2549px vs **2549px**, 20/20 images; moz.com 11185 vs **11233px**, 50/50
images, screenshot 260 vs 247 KB. Scripts are blocked by the sandbox (safe). This is legitimate —
we render our own stored evidence, strip nobody's headers, and nothing executes. Caveats:
subresources still fetch live (drifts over time, leaks a request), some fonts fail CORS.
**Phase-2 "inspect the DOM we captured" feature, not the default preview.**

### 4.4 Loader / splash detection — no standard exists, four heuristics

1. **DOM mutation quiet period** via `MutationObserver` (`addInitScript`). Works well; the decay
   curve is itself the finding (gymshark: 3800 mutations, still going at 10s). Trap: at
   `document_start` `document.documentElement` may be null and `observe()` fails **silently** —
   first run reported 0 mutations everywhere. Retry via `requestAnimationFrame`.
2. **Pixel stability** — hash consecutive screenshots. **`animations: 'disabled'` is mandatory**:
   with animations allowed a pulsing skeleton produced 6 different hashes (never stabilises); with
   it disabled, one stable hash that flips cleanly at content swap.
3. **Semantic/class heuristics** — `aria-busy="true"` is high-precision but almost nobody complies
   (Web Almanac doesn't even chart it); framework classes are hard-codable (Tailwind
   `animate-pulse`, Bootstrap `.spinner-border`, MUI `.MuiSkeleton-root`, shadcn
   `[data-slot="skeleton"]`, NProgress). **Measured false positive**: gymshark's
   `<i class="icon-spinner">` — an icon glyph, 0.2% of viewport. Gate on visible area >15% and no
   text. Next.js `loading.tsx` emits no signature class at all.
4. **Content growth** — `document.body.innerText.length` over time; ~0 text after `load` means a shell.

Emit a timing record, not a boolean. The valuable number: **`t_content - t_load`** = "this page
told the browser it was done 1.8s before it showed anything" — defensible, and no mainstream
crawler surfaces it. (Don't build on First Meaningful Paint or TTI — both removed from Lighthouse.)

### 4.5 Rendering signals — all verified directly exposed by Playwright/CDP

Free once a browser is on the page: console errors + `pageerror` exceptions; failed requests with
`errorText` (moz.com showed a real `ERR_BLOCKED_BY_ORB`; books.toscrape a `mixed-content` block);
request count + bytes by resource type (moz.com 81 req / 1986 KB); **`renderBlockingStatus ===
'blocking'`** — natively on `PerformanceResourceTiming`, no Lighthouse needed (moz.com 6/59 named
blocking resources, smashingmagazine 0/23); LCP **element selector**; CLS + shift source nodes;
`Nodes` + `JSHeapUsedSize`.

CWV in-crawl works *(measured on 6 sites)*. Three rules that fail silently if broken:
- **One `observe()` per entry type** with `{type, buffered: true}` — `entryTypes` + `buffered` is
  illegal per MDN and silently loses every pre-attach entry.
- **Order: read vitals → scroll → screenshot.** LCP stops updating at the first scroll — **our
  crawler currently scrolls to bottom, which would freeze LCP if we added vitals naively.**
- CDP `Performance.enable` must be called BEFORE navigation or ScriptDuration/Layout metrics
  return 0 (measured).

**Do not emit INP** — impossible unattended; Lighthouse itself reports TBT as the lab proxy. Label
it "INP proxy (lab)". Lab CLS only covers load-time above-fold shifts — label it `load_cls`, never
`cls`. Unthrottled numbers measure our machine, not the site: apply Lighthouse's mobileSlow4G
constants (150ms RTT / 1638.4 kbps / 4x CPU) for cross-site comparison.

Market split: **Screaming Frog = PSI/CrUX API only** (real INP from field data, hits quota walls);
**Sitebulb = in-crawl lab only**, throttled like Lighthouse, **sampling every 10th URL by default**,
no field data. Both sample; so should we.

### 4.6 Lane D recommendation

Thumbnail (342x192 WebP, ~5 KB, ~69ms) on every rendered page unconditionally · viewport shot
(~51 KB) on click, shown beside extracted data in Screaming Frog's picture-plus-blocked-resources
layout · full-page **on demand only** · retention policy from day one · never run Lighthouse
per-URL in the crawl.

## 5. Gap analysis — the verdict

### 5a. Three confirmed defects in shipped code (fixes, not features)

These were found by evaluating our own source, and two were reproduced live. They come first
because they mean **data we have already collected is partly wrong**.

| # | Defect | Evidence | Blast radius |
|---|---|---|---|
| **D1** | `content.ts` strips `header`/`footer` unconditionally, but per W3C those are page chrome **only when scoped to `<body>`**. An article's own `<header><h1>` is deleted. | Live run: article title + byline vanished from the extracted corpus | `content.text`, `wordCount`, `textRatio`, `contentHash`, **and the MinHash near-dup scores** — whose 0.75 threshold was calibrated against this corrupted corpus and must be re-measured |
| **D2** | Stripping `[aria-hidden="true"]` removes content that is visible to users and indexed by Google | W3C/MDN semantics | Under-counts real content; should be counted *and* flagged as an a11y defect |
| **D3** | We never detect where the `<head>` actually ended, so metadata after an invalid element is reported as present when Google cannot see it | Google: *"stops reading any further elements"* | Every head-derived field on affected pages |

Plus one **prerequisite**: `crawl.ts:607` aborts all font requests, so any font extraction built
today would silently produce wrong data.

### 5b. What we're missing, ranked by value-to-cost

**Tier 1 — cheap, raw-HTML only, high value** (no rendering, works on every page)
1. Head-boundary detection via a spec-compliant parser (D3) — unblocks trustworthy everything-else
2. **h1–h6 in document order** + real hierarchy check (upward jumps only) — beats SF, which caps at h1/h2
3. `<base href>` capture + re-resolution of every relative URL through it
4. Charset: meta + header + BOM + **byte-offset ≤1024** check
5. Full `<meta>` inventory: viewport (with `user-scalable=no` WCAG flag), theme-color, color-scheme, referrer, generator, verification tokens by regex family
6. **Open Graph + Twitter cards** via an ordered state machine — *neither incumbent does this natively*
7. Favicon: all declaration forms + "last declared wins" resolution + probe every candidate
8. **Third-party font origin detection** (GDPR/Munich-ruling compliance finding — highest value-to-cost item found)
9. `preload as=font` missing `crossorigin` (guaranteed double download, zero false positives)
10. Title/description **pixel width** alongside character count
11. Landmark-aware content area with `contentAreaMethod` provenance (fixes D1)
12. Structural inventory: paragraphs, lists, tables (+`th`/`caption` = data-vs-layout), code blocks

**Tier 2 — needs the rendered browser** (escalated pages only; we already render a subset)
13. **Page screenshots**: 342×192 WebP thumbnail, ~5 KB, ~69 ms — the answer to the preview question
14. Rendering signals, all free once the browser is on the page: console errors, failed requests, bytes by resource type, `renderBlockingStatus`, LCP element selector, CLS sources
15. Loading-state timing (`t_content − t_load` — "told the browser it was done 1.8s before showing anything"; no mainstream crawler surfaces this)
16. Fonts: declared-vs-used via `document.fonts` status + CDP `glyphCount`; `font-display` graded **by value** (Lighthouse's own audit wrongly passes `block`)
17. Core Web Vitals in-crawl — **with the ordering constraint: read vitals → scroll → screenshot**, because our existing scroll freezes LCP

**Tier 3 — larger builds**
18. TLS certificate + protocol facts (`tls.connect` / `securityDetails()`)
19. Tech-stack fingerprinting: own ruleset (~100 rules), lead with `scriptSrc` (51% of signal), `requires` gating from day one, **zero active probing**, retire.js bolted on
20. Manifest fetch/parse with credentials-mode mirroring

### 5c. Decisions already settled by the evidence

- **iframe previews: no.** 83% of tested sites block framing; the failure is a silent blank box; even success gives `contentDocument: null`. **Screenshots instead**, plus "open live in new tab". A sandboxed replay of *our own stored HTML* is a legitimate phase-2 inspector.
- **Tech-stack: build, don't buy.** Wappalyzer's terms forbid embedding data in a customer-facing product; both vendors price per-domain and so can never do per-page detection, which is where the SEO signal is. The GPL forks are usable server-side but become a trap the day we ship an extension or desktop app.
- **No active probing** (0.04% coverage benefit, real WAF-block risk).
- **Never claim heading order or missing-H1 is a ranking factor** — Google files it under "things you shouldn't focus on", and no WCAG criterion requires an H1. Report as accessibility/quality on a separate axis.
- **Never emit blanket "dead tag" findings** — `keywords` lives for Yandex; `noarchive`/`nocache` are Bing's AI opt-out.

## 6. Recommended build plan (for approval — nothing started)

**Phase 1 — Correctness (fixes D1–D3 + the prerequisite).** Landmark-aware content area with
provenance, stop stripping aria-hidden, head-boundary detection via parse5, lift the font abort
behind a flag. **Then re-measure the near-duplicate threshold**, since Phase 1 changes the corpus it
was calibrated on. Nothing new is trustworthy until this lands.

**Phase 2 — Raw-HTML extraction v3** (Tier 1 items 2–12). All static-path, so it applies to every
crawled page at near-zero cost, and it includes the two competitive openings (social metadata,
favicon resolution) and the GDPR font finding.

**Phase 3 — Rendered signals + preview** (Tier 2). Screenshots first — that is what the user asked
for and it makes every other finding eyeball-verifiable next to the extracted data.

**Phase 4 — Deep/optional** (Tier 3). TLS, tech-stack, manifest.

Rule additions follow the extraction, not the other way round: capture first, then write rules over
the captured evidence, each with an honest axis (SEO / accessibility / quality / compliance) and a
severity the evidence actually supports.
