# Botify, AI-Crawler Analytics & the AI Bot Landscape — Research

Lane scope: the AI/LLM crawler-bot landscape as a factual reference (verbatim user-agent tokens,
purpose, verification mechanism), what Botify measures about those bots and what data each metric
requires, Botify's crawler/log architecture, and an honest boundary between what our crawler can
determine alone versus what fundamentally requires server-log ingestion.

Research date: **2026-08-12**. Every user-agent token and IP-range URL below was fetched from the
vendor's own page or endpoint during this research pass unless explicitly marked otherwise. All 14
published IP-range files were fetched **and parsed** (not eyeballed) — prefix counts in §5 are from
`Invoke-RestMethod` + `.prefixes.Count`, not from a summarizer.

**Status legend** — **[V]** verified: vendor's own page/endpoint fetched and read this session.
**[NC]** not confirmed — no primary source reachable; do not ship as vendor-backed. **[I]** inferred.

---

## Summary

**The single most useful correction this research produced:** two of the tokens everyone treats as
"AI crawlers" — `Google-Extended` and `Applebot-Extended` — **are not crawlers at all**. They issue
no HTTP requests and carry no user-agent. They are robots.txt *control tokens* only. Google states
it plainly: *"Google-Extended doesn't have a separate HTTP request user agent string."* [3] Apple
likewise: *"Applebot-Extended does not crawl webpages."* [8] **They can never appear in a log file.**
Any log-based AI-bot classifier that looks for them finds zero, forever — while a robots.txt
analyzer detects them perfectly. This inverts the usual assumption that logs are strictly richer
than crawling, and it is the strongest argument for the robots.txt-first feature we can ship now.

**What we can build immediately, with zero log data:** an AI-bot *accessibility* audit. Our
`robots.ts` already persists the **raw robots.txt body verbatim** into every run [23], and
`robots-parser` already supports per-user-agent group matching — we simply never pass a UA other
than our own. That means a per-AI-bot allow/deny verdict can be recomputed **offline across all 80
existing runs with no re-crawl** (§7 rank 1). Add meta-robots/`X-Robots-Tag` directive checks
(`noarchive` = Amazon training opt-out [10]; `nosnippet` = Apple *retrieval* opt-out [8]) and a
JS-dependency check, and we have a differentiated deliverable that is entirely crawl-side.

**What fundamentally requires logs:** anything with the word *actual* in it — actual bot visit
frequency, actual pages crawled vs ignored, actual crawl budget, orphan-page discovery,
bot-hit-to-conversion. A crawler observes what a bot *could* do; only logs observe what it *did*.
There is no clever workaround (§6).

**On Botify specifically:** the `insight/ai-crawler-bots` page is an SEO glossary article, **not a
data product** — no metrics, no methodology, no numbers [16]. The real machinery lives on
`support.botify.com` and `developers.botify.com` (`docs.botify.com` and `help.botify.com` do not
resolve). Botify's moat is **not the crawler**: it is (a) the precomputed URL-keyed join across
crawl + logs + GSC + analytics into one dated dataset, (b) CDN log-ingestion plumbing with ~10 named
connectors, and (c) a rigorous published field schema (§4).

**Botify's own integrity hole, which they document themselves and we should not repeat:**
*"Botify can only authenticate bots that share their IP addresses. The following supported bots do
not share their IP addresses…we cannot validate crawls from them: Bytespider, CCBot, ClaudeBot,
Claude-Web"* [17]. That list is **partly out of date** — Common Crawl publishes
`index.commoncrawl.org/ccbot.json` and Anthropic publishes `claude.com/crawling/bots.json`, both
fetched and parsed successfully today (§5a). A verification layer built now on current endpoints is
materially better than the incumbent's, which is a rare thing to be able to say.

**Biggest single build opportunity:** SiteCrawler's page states *"most AI bots cannot render
JavaScript"* [19], and Botify sells an entire module (SpeedWorkers) on that premise. Our existing
Crawlee-static + Playwright-escalation architecture **already writes both** `raw/<id>.static.html`
and `raw/<id>.html` for every escalated page [23]. Diffing them yields an **"AI-bot-visible content
ratio"** per page — no logs required, and we are unusually well-positioned to compute it (§7 rank 2).

---

## 1 — AI crawler bot reference table

Three cautions before any of this is copied into code:

1. **Match on the product token, not the full UA string.** OpenAI labels its strings *"Example
   user-agent string (the version number may change)"* [1]. Apple says it *"will update the browser
   version that it advertises"* [8]. Google's `Chrome/W.X.Y.Z` is a **literal placeholder** in the
   docs, and Google explicitly instructs: *"use wildcards for the version number rather than
   specifying an exact version number"* [3]. Amazon uses the same placeholder [10].
2. **robots.txt user-agent matching is case-insensitive** (RFC 9309). Casing below is the vendor's.
3. **Anthropic publishes no user-agent strings at all.** Its article contains zero occurrences of
   `Mozilla` [5]. Match Anthropic bots on the bare token only.

### 1a — Training-data collection

| Bot / token | Company | UA string (vendor-published) | robots.txt? | Verification | Src |
|---|---|---|---|---|---|
| `GPTBot` | OpenAI | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot` | Yes | `openai.com/gptbot.json` | [1] |
| `ClaudeBot` | Anthropic | **none published [NC]** | Yes | `claude.com/crawling/bots.json` | [5] |
| `Google-Extended` | Google | **none — control token, never on the wire** | Control only | N/A — undetectable in logs | [3] |
| `Applebot-Extended` | Apple | **none — does not crawl** | Control only | N/A — undetectable in logs | [8] |
| `meta-externalagent` | Meta | `meta-externalagent/1.1` | Yes | **none published** | [9] |
| `Amazonbot` | Amazon | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1) Chrome/W.X.Y.Z Safari/537.36` | Yes | HTML page (no JSON) | [10] |
| `CCBot` | Common Crawl | `CCBot/2.0 (https://commoncrawl.org/faq/)` | Yes | `index.commoncrawl.org/ccbot.json` + FCrDNS | [7][11] |
| `Bytespider` | ByteDance | **[NC] — no vendor docs found** | Widely reported to ignore | none | [16] |
| `GoogleOther` | Google | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GoogleOther) Chrome/W.X.Y.Z Safari/537.36` | Yes | `common-crawlers.json` | [3] |
| `PetalBot` | Huawei | [NC] — named by Botify as training-class | — | — | [16] |

`Google-Extended` is broader than "training". Google's wording covers training **and grounding**:
*"…may be used for training future generations of Gemini models that power Gemini Apps and Vertex AI
API for Gemini and for grounding (providing content from the Google Search index to the model at
prompt time…)"* [3]. Blocking it removes you from Gemini's RAG-time grounding too — not just from
future model weights. Note the original 2023 announcement was narrower ("Bard and Vertex AI
generative APIs") [14]; the scope has widened.

Common Crawl matters disproportionately for its size relative to its footprint: it is a single
crawler whose corpus is a standard input to many third-party model builds, so `CCBot` is a one-token
proxy for a long tail of downstream trainers.

### 1b — Live retrieval for a user query (user-triggered)

This is the class where blocking has immediate, visible cost. Note how many explicitly reserve the
right to ignore robots.txt — because the fetch is attributed to a user, not to a crawler.

| Bot / token | Company | UA string | robots.txt? | Verification | Src |
|---|---|---|---|---|---|
| `ChatGPT-User` | OpenAI | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot` | *"robots.txt rules may not apply"* | `openai.com/chatgpt-user.json` | [1] |
| `Claude-User` | Anthropic | **none published [NC]** | **Yes — no carve-out stated** | `claude.com/crawling/bots.json` | [5] |
| `Perplexity-User` | Perplexity | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)` | *"generally ignores robots.txt rules"* | `perplexity.ai/perplexity-user.json` | [12] |
| `meta-externalfetcher` | Meta | `meta-externalfetcher/1.1` | *"may bypass robots.txt rules"* | none published | [9] |
| `Amzn-User` | Amazon | `…compatible; Amzn-User/0.1) Chrome/W.X.Y.Z…` | *"may not follow all robots.txt directives"* | HTML page | [10] |
| `Google-Agent` | Google | `…(KHTML, like Gecko; compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)…` | Ignores by design | `user-triggered-agents.json` | [4] |
| `Google-GeminiNotebook` | Google | `…(compatible; Google-GeminiNotebook; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-gemininotebook)` | Ignores by design | `user-triggered-fetchers-google.json` | [4] |

⚠️ **`Google-NotebookLM` is being retired this month.** Google's page states: *"Former agent
(supported until August 2026): `Google-NotebookLM`"* [4]. Any matcher keyed only on the old string
breaks now. Match both.

Anthropic is the notable exception in this class: it makes **no** "user-initiated, so robots.txt may
not apply" carve-out, and explicitly frames `Claude-User` as controllable [5]. This is a real,
citable behavioural difference between vendors, not a nuance.

### 1c — Search-index building (powers AI answer citations)

| Bot / token | Company | UA string | robots.txt? | Verification | Src |
|---|---|---|---|---|---|
| `OAI-SearchBot` | OpenAI | `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot` | Yes | `openai.com/searchbot.json` | [1] |
| `Claude-SearchBot` | Anthropic | **none published [NC]** | Yes | `claude.com/crawling/bots.json` | [5] |
| `PerplexityBot` | Perplexity | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)` | Yes | `perplexity.ai/perplexitybot.json` | [12] |
| `meta-webindexer` | Meta | `meta-webindexer/1.1` | Yes | none published | [9] |
| `Amzn-SearchBot` | Amazon | `…compatible; Amzn-SearchBot/0.1) Chrome/W.X.Y.Z…` | Yes | HTML page | [10] |
| `Applebot` | Apple | `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)` | Yes | rDNS `*.applebot.apple.com` + CIDR JSON | [8] |
| `Googlebot` | Google | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36` | Yes | `common-crawlers.json` + rDNS | [3] |

**On `meta-*` tokens**: Meta's page publishes the parenthetical as a *relative* path — literally
`(+/documentation/sharing/webmasters/web-crawlers)` — which is a bug on Meta's side. The absolute
form that appears in real traffic is **[NC]**. Prefix-match the token only; do not hardcode the
parenthetical [9].

**A robots.txt parsing trap, verbatim from Apple:** *"If robots instructions don't mention Applebot
but mention Googlebot, the Apple robot will follow Googlebot instructions."* [8] A site with a
`Googlebot` disallow and no `Applebot` group is blocking Apple too. Any per-bot accessibility
verdict we compute **must model this fallback** or it will be wrong on exactly the sites that care.

### 1d — Other bots named in the brief

| Bot / token | Company | Status |
|---|---|---|
| `OAI-AdsBot` | OpenAI | **[V]** — not in the original brief. Validates ad landing pages. *"the data collected by OAI-AdsBot is not used to train generative AI foundation models."* Ranges: `openai.com/adsbot.json` [1] |
| `cohere-ai` | Cohere | In the community aggregate [15] and in Botify's supported-bot list [17]; **[NC]** against Cohere's own docs |
| `Diffbot` | Diffbot | In the community aggregate [15]; **[NC]** vendor page not reached this pass |
| `Timpibot` | Timpi | In the community aggregate [15]; **[NC]** |
| `YouBot` | You.com | In the community aggregate [15] and Botify's supported list [17]; **[NC]** vendor docs |
| `anthropic-ai`, `Claude-Web` | (legacy) | **[NC] — zero vendor documentation.** Both appear in the community aggregate [15] and in Botify's supported-bot list [17], but occur **0 times** in Anthropic's own article [5]. Ship as "legacy/community-sourced", never as vendor-confirmed |

**Community aggregate as a cross-check.** `ai-robots-txt/ai.robots.txt` publishes a machine-readable
`robots.json` — **163 tokens** at fetch time [15]. Good *breadth* source and a reasonable default
blocklist, but community-maintained and it mixes vendor-confirmed tokens with unverifiable ones (it
lists both `Claude-Web` and `anthropic-ai`, neither of which Anthropic documents). **Use it for
coverage; use vendor docs for truth.**

```
https://raw.githubusercontent.com/ai-robots-txt/ai.robots.txt/main/robots.json
```

---

## 2 — Blocking consequences by bot type

**The thesis in the brief holds and is vendor-attestable** for OpenAI, Anthropic, Perplexity and
Apple — but it needs two corrections before it goes into any client-facing advice.

### 2a — The evidence, in vendors' own words

OpenAI states the independence of the levers outright:

> *"OpenAI uses OAI-SearchBot and GPTBot robots.txt tags to enable webmasters to manage how their
> sites and content work with AI. **Each setting is independent of the others** – for example, a
> webmaster can allow OAI-SearchBot in order to appear in search results while disallowing GPTBot to
> indicate that crawled content should not be used for training…"* [1]

And the sharp consequence, which is the single best citation for the whole argument:

> *"Sites that are opted out of OAI-SearchBot **will not be shown in ChatGPT search answers**, though
> can still appear as navigational links."* [1]

Anthropic says the same thing for both of its non-training bots:

> `Claude-User` — *"prevents our system from retrieving your content in response to a user query,
> **which may reduce your site's visibility for user-directed web search**."*
> `Claude-SearchBot` — *"prevents our system from indexing your content for search optimization,
> which may reduce your site's visibility and accuracy in user search results."* [5]

Perplexity has **no training bot at all** in its published list — both its bots are retrieval, so
blocking `PerplexityBot` is a pure visibility cost with zero training upside [12].

### 2b — Correction 1: drop the "GPTBot also improves search" claim

The brief hypothesised that OpenAI states GPTBot data may also feed search. **It does not.** The
actual sentence is narrower and is about crawl efficiency, not data reuse:

> *"**If your site has allowed both bots**, we may use the results from just one crawl for both use
> cases to avoid duplicative crawling."* [1]

That says one *fetch* can serve two purposes when **both** bots are already allowed. Substituting
the weaker true claim costs nothing rhetorically and protects the argument from being dismantled.
Also useful operationally: *"it can take ~24 hours from a site's robots.txt update for our systems
to adjust"* [1] — so a robots.txt fix has a measurable lag before it can possibly show effect.

### 2c — Correction 2: Google breaks the framework entirely

For Google there is **no retrieval-bot opt-out**. AI Overviews and AI Mode ride on Googlebot and the
snippet controls, not on `Google-Extended`:

> *"**AI is built into Search and integral to how Search functions, which is why robots.txt
> directives for Googlebot is the control for site owners to manage access to how their sites are
> crawled for Search.** To limit the information shown from your pages in Search, use `nosnippet`,
> `data-nosnippet`, `max-snippet`, or `noindex` controls. To limit AI training and grounding in some
> of Google's other systems, read more about Google-Extended."* [13]

> *"To be eligible to be shown as a supporting link in AI Overviews or AI Mode, **a page must be
> indexed and eligible to be shown in Google Search with a snippet**… There are no additional
> technical requirements."* [13]

> *"**Google-Extended does not impact a site's inclusion in Google Search nor is it used as a ranking
> signal in Google Search.**"* [3]

So: blocking `Google-Extended` costs nothing in Search or AI Overviews and only forgoes Gemini-app /
Vertex training **and grounding**. Anyone applying "block training, allow retrieval" logic to
`Google-Extended` gets the right answer for the wrong reason. Conversely, there is no way to appear
in Google Search while opting out of AI Overviews — blocking Googlebot removes you from both.

### 2d — Apple's hidden third tier

Apple is the only vendor with a genuine three-tier model, and the third tier is the one most
practitioners miss:

1. `Applebot` — crawl for Spotlight/Siri/Safari. Blocking = removal from Apple search surfaces.
2. `Applebot-Extended` — pure use-control token for foundation-model **training**. Verbatim:
   *"Applebot-Extended does not crawl webpages. Webpages that disallow Applebot-Extended can still be
   included in search results."* [8]
3. **`nosnippet`** — controls **retrieval grounding**, which `Applebot-Extended` does *not* cover:
   *"Web publishers can opt out of their content being used in these broad world knowledge answers by
   applying the `nosnippet` meta tag."* [8] Apple also supports `X-Robots-Tag: applebot: nosnippet`
   and `isAccessibleForFree: false`.

**A site that blocks `Applebot-Extended` and believes it has opted out of Siri answers is mistaken.**
That is a checkable misconfiguration and a genuinely good audit finding.

### 2e — The matrix

| Vendor | Training lever | Cost of blocking training | Retrieval lever | Cost of blocking retrieval (vendor's words) | robots.txt honored on user-triggered fetch? |
|---|---|---|---|---|---|
| OpenAI | `GPTBot` | future model weights only | `OAI-SearchBot` | **"will not be shown in ChatGPT search answers"** | **No** — *"may not apply"* |
| Google | `Google-Extended` | Gemini Apps / Vertex training **+ grounding** | *(none separable)* — Googlebot gates Search **and** AI Overviews | n/a | n/a |
| Anthropic | `ClaudeBot` | future training datasets | `Claude-SearchBot`, `Claude-User` | *"may reduce your site's visibility"* (both) | **Yes** — all bots honor it |
| Perplexity | *(none published)* | n/a | `PerplexityBot`, `Perplexity-User` | recommends allowing "to ensure your site appears" | **No** — *"generally ignores"* |
| Apple | `Applebot-Extended` | foundation-model training only | `Applebot` (+ `nosnippet` for grounding) | out of Spotlight/Siri/Safari | n/a |
| Amazon | `Amazonbot` (or `noarchive`) | Amazon AI model training | `Amzn-SearchBot`, `Amzn-User` | out of Alexa search experiences | **No** — *"may not follow all"* |
| Meta | `meta-externalagent` | foundation-model training | `meta-webindexer`, `meta-externalfetcher` | out of Meta AI citations | **fetcher may bypass** |

**The enforceability caveat that must survive into any recommendation:** OpenAI, Perplexity, Amazon
and Meta all state that a robots.txt block on the user-triggered fetcher **may simply not take
effect**. Where that is true, WAF/IP-level blocking is the only real mechanism — a materially
different and more expensive decision than editing a text file. Anthropic is the one vendor that
says it honors robots.txt on user-triggered fetches.

### 2f — Third-party measurement (secondary; 2024–2025 data read in 2026)

Label these clearly as measurement, not vendor policy, and refresh before publishing.

- **Crawl-to-refer ratio.** Cloudflare, June 19–26 2025: *"the ratios range from **Anthropic's
  70,900:1** down to **Mistral's 0.1:1**"* [20]. Always carry Cloudflare's own caveat: *"traffic
  referred by Claude's native app does not include a `Referer:` header… these calculations **may
  overstate the respective ratios, but it is unclear by how much**."* [20] The widely-repeated
  "1,500:1 / 60,000:1" figures were **not found** in the press release they are usually attributed
  to — do not cite them.
- **Crawler traffic growth**, May 2024→May 2025 [21]: GPTBot requests **+305%** (share 2.2%→7.7%);
  ChatGPT-User **+2,825%**; ClaudeBot **−46%**; Bytespider **−85%**. Among AI-only crawlers in May
  2025: GPTBot 30%, ClaudeBot 21%, Meta-ExternalAgent 19%, Amazonbot 11%, Bytespider 7.2%.
- **Who blocks what.** Of top-10,000 domains with a robots.txt, *"**546 (about 14%)** had 'allow' or
  'disallow' … directives targeting AI bots"*; most-blocked was **GPTBot (312 domains)**, then CCBot
  and Google-Extended [21]. Among **news publishers** specifically, Palewire's continuously-updated
  tracker reads **624 of 1,149 (54.3%)** blocking OpenAI, Google AI or Common Crawl [22] — a
  population far more likely to block than the general web, and it tracks *training* tokens only.
- **Academic.** Longpre et al. audited 14,000 domains and found *"~5%+ of all tokens in C4, or 28%+
  of the most actively maintained, critical sources in C4, fully restricted"* [24]. Predates the
  retrieval/training split becoming widespread, so it says nothing about retrieval blocking.

**Honest gap:** no credible published *causal* study measuring whether blocking a retrieval bot
reduces AI citation rates was found. The design would require randomized blocking across matched
sites plus a citation panel, which nobody is positioned to run. **The strongest evidence for the
retrieval-blocking consequence remains the vendor statements themselves** (§2a) — a policy
commitment from the operator, which is arguably better than a correlational study, but is a
statement of intent rather than an independent measurement of outcome. Say so plainly rather than
dressing up vendor GEO content as evidence.

---

## 3 — What Botify measures, and the data each metric requires

First, the correction that reframes this whole section: **`botify.com/insight/ai-crawler-bots` is a
glossary article in a "DEFINITIONS" content series.** It contains no proprietary statistics, no
methodology, no charts, and no interactive index — it names ~13 AI bots, splits them into "training"
vs "live retrieval and citation", tells you to *"use log file analysis to understand how AI bots are
exploring your website"*, and ends in a demo CTA [16]. It is SEO content, not a product. The real
mechanism is on `support.botify.com` and `developers.botify.com`.

Botify tracks **60+ bots**, grouped as OpenAI bots (GPTBot, ChatGPT-User, OAI-SearchBot, OAI-AdsBot)
vs "Other AI bots" (AmazonBot, Anthropic-ai, Bytespider, CCBot, ClaudeBot, Claude-SearchBot,
Claude-User, Claude-Web, FacebookBot, Meta-ExternalAgent, MistralAI-User, PerplexityBot,
Perplexity-User, YouBot) [17].

### 3a — Metric → required data source

| Metric | Data source required |
|---|---|
| URLs crawled by AI bot, by segment, by day | **Server/CDN logs only** |
| URLs crawled by AI bot user-agent, by day | **Logs only** |
| Crawl volume / unique URLs / frequency / good-vs-bad HTTP status per bot | **Logs only** |
| "High-impression pages not retrieved by ChatGPT" (Discoverability report) | **Logs ∩ Google Search Console** |
| ChatGPT-referred *visits* | **Logs** — via referrer and `?utm_source=chatgpt.com` |
| Active pages / organic visits | **Logs or analytics integration** |
| Crawl ratio, crawl budget, orphan pages | **Crawl ∩ logs** |
| AI Visibility (share of voice, citations, brand mentions in ChatGPT/Perplexity/AI Overviews) | **Not logs** — *"API integrations and advanced web scraping through trusted partners"*; weekly refresh |

Note the architectural split hiding inside one marketing story: **AI *bot* analytics comes from
logs; AI *visibility* (answer/citation tracking) comes from scraping the LLMs.** Two entirely
different pipelines. Only the second is reproducible without a customer's server logs — and it is a
scraping problem, not a crawling one.

### 3b — Botify's own stated verification limitation

> *"Botify can only authenticate bots that share their IP addresses. The following supported bots do
> not share their IP addresses…we cannot validate crawls from them: **Bytespider, CCBot, ClaudeBot,
> Claude-Web**"* [17]

Two things follow. First, Botify's verification is **IP-list-based only** — no reverse DNS. Second,
**the list is partly stale**: Common Crawl publishes `index.commoncrawl.org/ccbot.json` (and
recommends FCrDNS in the file's own `notes`), and Anthropic publishes `claude.com/crawling/bots.json`
— both fetched and parsed successfully today (§5a). Only Bytespider and the legacy `Claude-Web` are
genuinely unverifiable. A verification layer built against current endpoints beats the incumbent's.

### 3c — Botify's precise terminology

Worth adopting verbatim where it is good, and worth diverging from deliberately where it is not.

- **Active Page** — *"A page that has received **at least one organic visit** over a specific
  period."* [18] Note this is **visit**-defined, not bot-defined — it needs analytics/logs.
- **Crawl Budget** — *"The amount of crawling resources that search engines allocate to a site."*
  Operationalized as *Known Pages Crawled by Google ÷ total Known Pages* [18].
- **Crawl Ratio** — *"The percentage of URLs in your website structure crawled by a search engine
  robot."* "Structure" = Botify's own crawl. This is the crawl↔log join expressed as one number.
- **Frequency** — the only published formula: *"number of crawls / number of URLs"* over the period.
- **Orphan Pages** — operationally *"pages **crawled by Google but not internally linked** to on your
  site."* This definition is only computable with logs (§6).
- **Compliant** (`compliant.is_compliant`) — four criteria, verbatim: *"returns a 200 HTTP status
  code, is not blocked by robots.txt, has no noindex directive, and self-canonicalizes."* Failure
  enum: `http_code_3xx, http_code_4xx, http_code_5xx, noindex, canonical_not_self, robots_blocked`
  [18]. **This is 100% crawl-derived and we can compute it today** — a clean, defensible definition
  worth copying outright.
- **Internal PageRank** — they compute it *"considering only pages in your analysis scope"*, exposed
  as a 0–10 score with one decimal, a rank position, and a raw value where *"the sum … for all pages
  in the analysis is 1"*, plus "Internal PageRank Waste" for links to external/unanalyzed pages [18].
  **We already have PageRank over the internal link graph** — matching their three-field presentation
  is cosmetic work, not new algorithm work.
- **Click Potential** — proprietary: take the average CTR of your own pages ranking 1–3, apply it to
  impressions of pages ranking 4–10, subtract current clicks. Needs GSC.

One genuinely clever log-only field worth remembering as a north star:
`visits.google.ages.visited_crawl_first_seen.age_by_day` — **days between first bot crawl and first
user visit**. That "time-to-value" metric is only producible by the join.

**A Botify-sourced benchmark, cited with its caveat:** approximately **51% of enterprise clients'
pages are not crawled by Google** [18]. No sample size, window, or definition of "enterprise client"
is published — treat as marketing-grade, but it is their own data rather than a third-party citation
(unlike the "47% of internet traffic is bots" figure on their AI-bot page, which is Imperva's, 2022).

---

## 4 — Botify architecture & log ingestion

### 4a — The crawler

- Cloud-based; *"crawl millions of pages in a single crawl with no crawl budget limitations"* [19].
  **No published max-URL or URLs/second figure exists** — "millions" is as specific as it gets.
- JS rendering: *"the same rendering engine as Googlebot"* [19]. Engine not named (**[I]** headless
  Chromium). Rendering is instrumented as **first-class data**, not a toggle: `js.rendering.exec`,
  `js.rendering.ok`, `js.rendering.status`, `js.rendering.time_ms`, `js.rendering.device`,
  `total_crawl_and_render_time`, plus real browser timers `js.timers.fp_ms / fcp_ms / fmp_ms /
  dom_ms / loaded_ms`. **It explicitly diffs raw HTML (pre-JS) against rendered DOM (post-JS)** [17].
- *"Over 1,000 data points"* per crawl [19].
- Adaptive throttling with a published safety threshold: *"20% of 5xx HTTP status code responses
  within a 10-minute window"* [17].

**How it really differs from a desktop tool** (**[I]**, not a Botify claim): not the crawling. It is
that every crawl is persisted as a **dated, queryable dataset** (`crawl.YYYYMMDD`) that other data
sources join onto. Screaming Frog is a stateless desktop snapshot; Botify is a warehouse with a
crawler attached. That is an architecture decision we can copy without copying their scale.

### 4b — The crawl ↔ log join (the actual moat)

> *"Botify compares this set of pages with your site's Log Files to find which pages are crawled and
> rendered by Google."* [18]

**Join key is the URL.** No URL-normalization rules are publicly documented — no protocol,
trailing-slash, case, or query-param handling. That is the single most important detail for anyone
replicating this, and it is **absent from public docs**. (We already have normalization logic in the
crawler; this is where our existing work is directly relevant.)

The join is materialized as a **5-stage funnel**, each stage a filter on the previous [18]:

| Stage | Definition | Sources |
|---|---|---|
| **Known Pages** | *"Pages that are accessible through internal linking"* | Botify crawl |
| **Crawl & Render** | *"Known Pages Crawled by Google divided by the total number of Known Pages"* | crawl **+ logs** |
| **Index** | *"Indexable Pages are Known Pages crawled by Google compliant with search indexation rules"* | crawl + logs |
| **Rank** | *"Percentage of Known pages crawled by Google that are indexable and receive impressions"* | + GSC |
| **Convert** | *"Percentage of pages ranking in search results that receive Google organic visits"* | + analytics |

**What the join produces that neither dataset gives alone:**
- **Orphans** — *"pages crawled by Google but not internally linked to on your site."* Dedicated BQL
  collection `searchenginesorphans.YYYYMMDD`.
- **Uncrawled** — pages internally linked but never fetched by the bot.
- **Cross-source diagnosis** — *"pages with high average load time and low proportion of URLs crawled
  may indicate pages take too long for Google to crawl"* (crawl-measured load time × log-derived
  crawl rate).
- **AI-specific gap** — GSC impressions × AI-bot log hits = *"your most strategic pages that received
  Google impressions, but were not retrieved by ChatGPT."*

**[I] An architectural inference worth acting on:** the public BQL collection list includes
`crawl.YYYYMMDD`, `search_console`, `visits.*`, `sitemaps`, `searchenginesorphans.YYYYMMDD` — but
**no `logs` collection**, while log data surfaces as fields like `crawls.google.count`. That strongly
suggests log data is **denormalized into the crawl analysis at build time**, not joined at query
time. It explains why log data is scoped to an analysis and why LogAnalyzer reports cap at 3 months.
If we ever ingest logs, precomputing the join per crawl-run — rather than building a general-purpose
log warehouse — is the cheaper and evidently sufficient design.

### 4c — Log ingestion mechanics

Fully documented, and the most directly reusable part of this research [25].

- **Required fields:** date (preferably with timezone) · full URL incl. query params · Referer ·
  user agent · HTTP status code · domain (if multi-subdomain) · protocol. Optional: client IP
  (*"for crawl lines"*), comments prefixed `#`.
- **Sharp finding: bytes and response time are NOT required.** Botify measures load time with its own
  crawler, not from logs. Everything log-side is **event counting**. That materially lowers the bar
  for a log format we would need to accept.
- **Format:** *"For non-IIS servers, we recommend using the Apache Combined Log Format without any
  change"* — `%h %l %u %t "%r" %>s %b "%{Referer}i" "%{User-agent}i"`.
- **Delivery, two directions:** *push* via FTP/FTPS/SFTP to `.upload.botify.com` in `/logs/`; or
  *pull* from a customer-owned AWS S3 / Azure / GCP bucket (S3 needs a dedicated IAM user with
  `s3:List*` + `s3:Get*`, plus key pair, region, bucket, prefix, retrieval time-of-day).
- **Naming / compression / cadence:** `YYYYMMDD.log`, e.g. `logs/20150130.webserver1.log.gz`.
  Accepts gzip, bzip2, zip, xz; **rejects** multi-file zips, tar.gz, 7zip, rar. *"We take your new
  log files into account **every six hours**."*
- **Volume:** >**200GB/day** requires advance notice; individual files up to **8GB**.
- **Completeness at ingestion, sampling at query:** *"We need **all** your CDN log files"* and *"all
  your front-end web servers"* — but *"Quick View mode is enabled in LogAnalyzer by default"*,
  toggling between sampled and full data.
- **CDN connectors** (~10 named): Akamai, Cloudflare, Fastly, CloudFront, Azure, Google Cloud
  Storage, Datadog, Fasterize, Salesforce Commerce Cloud, AWS S3. Cloudflare specifically supports
  **Logpush → customer S3** or Botify pulling via the **LogPull API**, with required fields
  `ClientIP, ClientRequestBytes, ClientRequestHost, ClientRequestMethod, ClientRequestPath,
  ClientRequestProtocol, ClientRequestReferer, ClientRequestScheme, ClientRequestSource,
  ClientRequestUri, ClientRequestUserAgent, EdgeResponseStatus, EdgeResponseTimestamp`.
- **Pre-ingestion filtering is the customer's job**: strip non-crawl/non-visit lines, strip IPs from
  visit lines, strip PII. Botify hands customers literal UA filter strings like
  `AdsBot|Googlebot|Mediapartners-Google|bingbot|bing|google`.
- **Retention by plan:** 13 months (Essential/Accelerate/Growth) → 24 (Pro) → 36 (Enterprise).

### 4d — Activation modules, and why they exist

- **SpeedWorkers** — dynamic rendering at the CDN edge. The CDN pings Botify's servers; Botify
  returns fully-rendered, JS-free HTML **to bots only** at *"<300ms/page"*; humans hit origin
  unchanged. Their cloaking defence, verbatim: *"Googlebot doesn't consider this type of rendering to
  be cloaking, and in fact encourages large websites to adopt the practice."* The AI angle, stated
  even more strongly on this page than on SiteCrawler's: *"**Currently, AI bots cannot understand
  JavaScript, making your content very difficult (if not impossible) for them to interpret.**"* —
  so prerendering is now sold as **AI-readiness** rather than crawl-budget [19][26]. Note this is a
  vendor claim in support of a product they sell; treat the strong form ("cannot") as marketing and
  the SiteCrawler form ("most AI bots cannot render JavaScript") as the defensible version.
- **PageWorkers** — a client-side JS tag (async, 40–60ms, CDN-hosted) that mutates titles, metas,
  canonicals, internal links, hreflang and structured data without touching site code. **Structural
  weakness worth noting:** being client-side, it only works for bots that execute JS — i.e. Google,
  **not** the AI bots Botify is now marketing to. SpeedWorkers is what closes that hole, which is
  precisely why the two are sold together [26].

### 4e — Pricing / positioning

Five tiers (Essential, Accelerate, Growth, Pro, Enterprise). **No prices published anywhere.** Limits
are expressed as **data retention and crawl history, not URL counts** — consistent with the "no crawl
budget limitations" marketing. No URL-count caps, crawl-volume caps or seat limits appear in the plan
table [27]. **[I]** pricing is negotiated per contract on site size; no public basis exists to state
a figure and none is stated here. Positioning is unambiguously enterprise/ecommerce (Levi's, Parts
Town, Rail Europe, GAME, Smartbox).

---

## 5 — Bot verification mechanics

A user-agent string is a self-declaration and nothing more. Common Crawl says so on its own page:
*"we are aware of crawlers falsely identifying themselves as CCBot. We recommend verifying UserAgent
strings to ensure authenticity."* [11] Three mechanisms exist, in descending order of practicality.

### 5a — Published IP ranges (the primary mechanism)

Every file below was fetched **and parsed** on 2026-08-12. Counts are real, from `.prefixes.Count`.

| Owner | URL | Prefixes | v4 / v6 | `creationTime` at fetch |
|---|---|---|---|---|
| OpenAI GPTBot | `https://openai.com/gptbot.json` | 21 | 21 / 0 | `2025-10-30T11:00:00.000000` |
| OpenAI OAI-SearchBot | `https://openai.com/searchbot.json` | 35 | 35 / 0 | `2026-01-02T11:00:00.000000` |
| OpenAI ChatGPT-User | `https://openai.com/chatgpt-user.json` | 244 | 244 / 0 | `2026-08-11T23:03:59.144319` |
| OpenAI OAI-AdsBot | `https://openai.com/adsbot.json` | 2 | 2 / 0 | `2026-05-12T03:00:00.000000` |
| Anthropic (all 3 bots) | `https://claude.com/crawling/bots.json` | 21 | 21 / 0 | `2026-08-12T01:43:14Z` |
| Apple Applebot | `https://search.developer.apple.com/applebot.json` | 12 | 12 / 0 | `2023-10-27T10:00:00.000000` |
| Common Crawl CCBot | `https://index.commoncrawl.org/ccbot.json` | 6 | 5 / 1 | `2026-08-04T12:40:20Z` |
| Perplexity PerplexityBot | `https://www.perplexity.ai/perplexitybot.json` | 8 | 8 / 0 | `2025-02-07T16:56:00.000000` |
| Perplexity Perplexity-User | `https://www.perplexity.ai/perplexity-user.json` | 4 | 4 / 0 | `2025-10-17T10:17:00.000000` |
| Google common crawlers | `https://developers.google.com/static/crawling/ipranges/common-crawlers.json` | 315 | 169 / 146 | `2026-08-11T14:45:51.000000` |
| Google special crawlers | `…/static/crawling/ipranges/special-crawlers.json` | 270 | 135 / 135 | `2026-08-11T14:47:00.000000` |
| Google user-triggered fetchers | `…/static/crawling/ipranges/user-triggered-fetchers.json` | 1056 | 528 / 528 | `2026-08-11T14:45:53.000000` |
| Google user-triggered (Google) | `…/static/crawling/ipranges/user-triggered-fetchers-google.json` | 494 | 247 / 247 | `2026-08-11T14:47:18.000000` |
| Google user-triggered agents | `…/static/crawling/ipranges/user-triggered-agents.json` | 20 | 12 / 8 | `2026-08-11T14:45:53.000000` |

**Schema.** Near-universal:
`{"creationTime": ..., "prefixes": [{"ipv4Prefix": "..."} | {"ipv6Prefix": "..."}]}`.
Parse defensively — the shape varies more than it looks:
- Common Crawl adds two extra top-level fields, `synctoken` and `notes`. Its `notes` reads:
  *"IP ranges used by CCBot. For verification of IPv4 addresses, FCrDNS is also recommended."* [11]
- `creationTime` formats are **inconsistent**: Google/OpenAI/Apple use naive
  `YYYY-MM-DDTHH:MM:SS.ffffff` with no timezone; Anthropic and Common Crawl use a `Z` suffix.
- OpenAI, Anthropic, Apple and Perplexity publish **IPv4 only**. Google publishes both.

**Gotchas that will bite an implementation:**
- **Google moved these files.** Canonical path is now `/static/crawling/ipranges/`. The old
  `/static/search/apis/ipranges/` paths still resolve, and the old name `googlebot.json` is now
  `common-crawlers.json` — confirmed byte-identical (same `creationTime` `2026-08-11T14:45:51.000000`,
  same leading prefix `2001:4860:4801:10::/64`). Use the new paths [4].
- **Anthropic publishes one flat file for all three bots.** No per-bot breakdown, so an IP match
  proves *"this is Anthropic"* but **cannot** distinguish `ClaudeBot` (training) from `Claude-User`
  (retrieval) [6]. Since that is exactly the distinction driving the SEO advice, Anthropic
  classification falls back to the UA token — which is spoofable. Report it as such.
- **Apple's file is ~3 years stale** (`2023-10-27`, 12 prefixes). Weak allowlist; prefer rDNS [8].
- **Perplexity's files are small and old** (8 and 4 prefixes; Feb 2025 / Oct 2025). Expect false
  negatives. Docs cite `www.perplexity.com/...`, which 302s to `www.perplexity.ai/...` [12].
- **Amazon publishes no JSON.** Three HTML pages, confirmed `text/html` at ~360KB each with IPs
  embedded in markup — scraping required, and it will break [10]:
  `developer.amazon.com/amazonbot/{ip-addresses,searchbot-ip-addresses,live-ip-addresses}/`
- **Meta publishes nothing.** No IP list, no ASN, no verification method of any kind [9].
- **OpenAI's `gptbot-ranges.txt` is dead** — 403 and unreferenced in current docs. Note `openai.com`
  returns 403 for *any* nonexistent path, so 403 ≠ "retired"; the reason to drop it is that current
  docs point only at the `.json` files [1].

### 5b — Forward-confirmed reverse DNS (FCrDNS)

Stronger where offered, because it needs no list maintenance. Four steps, per Google:

> *"Run a reverse DNS lookup on the accessing IP address from your logs"* → *"Verify that the domain
> name is either `googlebot.com`, `google.com`, or `googleusercontent.com`"* → *"Run a forward DNS
> lookup on the domain name retrieved in step 1"* → *"Verify that it's the same as the original
> accessing IP address from your logs."* [4]

The forward step is not optional — reverse DNS alone is attacker-controlled.

| Vendor | rDNS suffix / mask | Src |
|---|---|---|
| Google — common crawlers | `crawl-***-***-***-***.googlebot.com`, `geo-crawl-***-***-***-***.geo.googlebot.com` | [4] |
| Google — special-case | `rate-limited-proxy-***-***-***-***.google.com` | [4] |
| Google — user-triggered | `***-***-***-***.gae.googleusercontent.com`, `google-proxy-***-***-***-***.google.com` | [4] |
| Apple | `*.applebot.apple.com` — worked example `17.58.101.179` ↔ `17-58-101-179.applebot.apple.com` | [8] |
| Common Crawl | FCrDNS recommended for IPv4 (per the file's own `notes`) | [11] |
| **OpenAI** | **not mentioned anywhere in its docs** | [1] |
| **Anthropic** | **not mentioned anywhere in its docs** | [5] |
| **Amazon / Meta / Perplexity** | **[NC]** — no vendor-published method | [9][10][12] |

Google and Apple support both mechanisms; OpenAI, Anthropic and Perplexity are IP-list-only; Amazon
is scrape-only; **Meta is unverifiable from vendor documentation.**

### 5c — Web Bot Auth (emerging, cryptographic)

The direction of travel: HTTP message signatures proving bot identity with no IP list at all.
Cloudflare names it as one of three ways it verifies bots, alongside IP validation and reverse DNS
[31]. Google confirms it is *"experimenting with the Web Bot Auth protocol, using the
`https://agent.bot.goog` identity"* for `Google-Agent` [4]. Worth tracking; not worth building
against today.

### 5d — Practical verification order

1. **UA token match** → a *claim*, never proof. Cheap prefilter only.
2. **FCrDNS** where the vendor publishes a suffix (Google, Apple, Common Crawl) → strongest, no list
   maintenance, costs a DNS round-trip. Cache aggressively.
3. **IP-range membership** via a refreshed CIDR trie (OpenAI, Anthropic, Perplexity, Apple fallback).
   Refresh daily — several files change daily, and Anthropic's changed the day it was fetched.
4. Anything left claiming an AI-bot UA but failing 2 and 3 → **impostor**. Meta and Bytespider
   traffic lands here permanently and must be reported as **"unverifiable"**, not "fake".

---

## 6 — The honest boundary: crawler-alone vs needs-logs

The dividing line is simple and worth stating in exactly these terms to anyone who asks:

> **A crawler observes what a bot _could_ do. Only logs observe what it _did_.**

Everything downstream follows from that. There is no clever workaround — no amount of crawling
reveals whether GPTBot actually fetched a URL, because that event happened on the customer's server
and was recorded only there.

### 6a — Computable by our crawler alone, today

| Capability | Why it works without logs |
|---|---|
| Per-AI-bot robots.txt allow/deny verdict for any URL | robots.txt is a public document; `robots-parser` already does per-UA groups |
| Detection of `Google-Extended` / `Applebot-Extended` | **Only** detectable this way — they never appear in logs |
| Googlebot-fallback trap (Apple follows Googlebot rules absent an Applebot group) | Pure robots.txt reasoning [8] |
| `noindex` / `nofollow` / `noarchive` / `nosnippet` / `max-snippet` per bot | Already parsed from meta + `X-Robots-Tag` [23] |
| `isAccessibleForFree: false` (Apple grounding opt-out) | Already in structured-data extraction [23] |
| JS-dependency of content ("AI-bot-visible ratio") | We retain both static and rendered HTML [23] |
| Botify's `compliant` definition (200 + not robots-blocked + no noindex + self-canonical) | 100% crawl-derived [18] |
| Internal PageRank, orphan-*relative-to-sitemap*, near-duplicate clusters | Already built |
| Crawl-over-crawl diffing of any of the above | Already built |
| Blocking-consequence advice per bot class | Derived from vendor docs (§2), not from data |

### 6b — Fundamentally requires log ingestion

| Capability | Why a crawler cannot do it |
|---|---|
| Bot crawl frequency / volume / unique URLs per bot | The visit happened on the customer's server |
| Pages crawled vs ignored by a given bot; crawl budget; crawl ratio | Requires the set of URLs a bot actually fetched |
| **Orphan pages as Botify defines them** ("crawled by Google but not internally linked") | The "crawled by Google" half is log-only |
| Bot-hit-to-conversion paths; ChatGPT-referred visits | Referrer + session data |
| "Active pages" (≥1 organic visit) | Visit data |
| AI-bot vs traditional-search-bot ratio | Both sides are log-derived |
| Time-from-first-crawl-to-first-visit | Both sides log-derived |
| Bot **verification** (IP/FCrDNS) in any meaningful sense | You can only verify a hit you observed |

**An important nuance on that last row.** We can build and ship the *verification library* — CIDR
tries, FCrDNS resolution, the refresh job — with no logs at all, and unit-test it against the real
published ranges. It just has nothing to classify until a log line exists. That makes it a sensible
thing to build **ahead** of ingestion, not a reason to defer it.

### 6c — The partial-credit middle ground (be careful here)

Two things look like log substitutes and are not:

- **Orphan detection against the sitemap** is real and we can do it (URLs in sitemap.xml not reachable
  by internal links). But it is **not** Botify's orphan metric, which is log-defined. Naming ours
  "orphan pages" without qualification would be the kind of overclaim that erodes trust. Call it
  *"sitemap-orphaned"*.
- **AI Visibility / citation tracking** (does ChatGPT cite this brand?) needs neither logs nor our
  crawler — it needs LLM scraping, which is what Botify does for that module [17]. It is a separate
  product line, and worth deciding on deliberately rather than drifting into.

**There is no substrate to plug logs into today.** The crawler has no log parser, no external API
client, and no OAuth; storage is flat JSON files on disk, with Postgres/GSC only as recorded
decisions, not code [23]. Log ingestion is net-new infrastructure, not an increment.

---

## 7 — What we could build now, ranked

Ranked by (value to the SEO story) ÷ (build cost), given the code that exists today [23].

**1. Per-AI-bot robots.txt accessibility matrix — highest value, near-zero cost.**
`src/discovery/robots.ts` persists the **raw robots.txt body verbatim** as `content` in
`runs/<runId>/robots.json`, and `robots-parser` already implements per-user-agent group matching. We
currently call `isAllowed(url, ua)` with exactly one UA — our own. Passing a list of ~30 AI-bot
tokens instead produces a full allow/deny matrix. Because the raw body is stored, **this can be
backfilled across all 80 existing runs with no re-crawl.** Ship it as a site rule
(`SiteRuleContext.robots` already carries what is needed — *"an AI-bot-blocking site rule needs no
new crawl data at all"*), classifying each verdict by bot **purpose** so the output is advice, not a
table: "you are blocking `OAI-SearchBot`, which per OpenAI means you *will not be shown in ChatGPT
search answers*." Must model the Apple→Googlebot fallback rule (§1c).

**2. "AI-bot-visible content ratio" — the differentiated metric.**
Botify asserts *"most AI bots cannot render JavaScript"* [19] and sells a whole module on it. We
already write both `raw/<id>.static.html` and `raw/<id>.html` for escalated pages. Today
`computeRenderDivergence` emits only **7 scalars** (`titleChanged`, `linkCountDelta`,
`wordCountDelta`, …) — no content-text delta. Adding a real text diff is a small change *inside an
existing function*, and `PageContent.contentHash` plus the retained `staticExtraction` give us the
inputs. Output: per-page % of content invisible without JS, rolled up site-wide. Two honest caveats
to carry: only **17** `.static.html` files exist across the 80 stored runs, so the historical
baseline is sparse and this mostly applies going forward; and under `render: "always"` no static
baseline is produced at all.

**3. AI-directive extraction beyond noindex.**
`extractRobotsMeta` already merges `<meta name="robots">`, `<meta name="googlebot">` and
`X-Robots-Tag`, but it **discards the agent prefix** (`googlebot: noindex` → `noindex`) and does not
recognise `noarchive`, `nosnippet`, `max-snippet` or `noai`. Those now carry real, vendor-documented
AI meaning: `noarchive` is Amazon's training opt-out [10]; `nosnippet` is Apple's *retrieval*
grounding opt-out and Google's AI-Overview snippet control [8][13]. Retaining the prefix and adding
the tokens turns an existing parser into an AI-policy detector. This also unlocks the audit finding
in §2d — sites that block `Applebot-Extended` believing it stops Siri grounding, when only
`nosnippet` does.

**4. Bot-verification library, built ahead of ingestion.**
A CIDR trie over the 14 published range files (§5a) plus an FCrDNS resolver for Google/Apple/Common
Crawl, with a daily refresh job. Fully unit-testable against real endpoints **with no logs**. Build
it now and log ingestion becomes a data problem rather than a data-plus-trust problem. Worth doing
because it is where we can beat Botify outright: their own docs say they cannot authenticate CCBot
or ClaudeBot [17], and both now publish ranges.

**5. Adopt Botify's `compliant` definition as a first-class field.**
*"Returns a 200 HTTP status code, is not blocked by robots.txt, has no noindex directive, and
self-canonicalizes"* [18], with the six-value failure enum. Every input is already extracted. It is
a rigorous, defensible, industry-recognisable rollup metric for near-zero work — and it gives the
dashboard a headline number that means something.

**6. Dashboard plumbing to surface 1–3.**
`seo-dashboard/lib/types.ts` is a **hand-duplicated copy** of the crawler contract and is already
behind — it has no `renderDivergence` and none of the v2/v3 fields. `rawHtmlPath()` hardcodes
`${pageId}.html`, so `.static.html` is unreachable from the UI. A static-vs-rendered view needs a
path variant plus a route param, and the type copy synced. Small, but it is the gate between
computing these metrics and anyone seeing them.

**7. Persist crawls as dated, queryable datasets (architecture, not a feature).**
Botify's real advantage is that every crawl is a dated dataset other sources join onto (§4a), and
that the log join appears to be **precomputed per analysis** rather than served from a general log
warehouse (§4b). If we ever ingest logs, copy that shape — it is cheaper and evidently sufficient.
Recording it now prevents building a general-purpose log warehouse we do not need.

**Explicitly not now:** log ingestion itself (net-new infrastructure with no substrate today, §6c),
and AI-visibility/citation tracking (a scraping product, not a crawling one, §6c).

---

## Sources

1. https://developers.openai.com/api/docs/bots — OpenAI "Overview of OpenAI Crawlers" (`platform.openai.com/docs/bots` 301s here). Raw markdown: https://developers.openai.com/api/docs/bots.md. Four bots, UA strings, per-bot range files, independence-of-settings statement, "will not be shown in ChatGPT search answers", ~24h robots.txt propagation
2. https://openai.com/gptbot.json · /searchbot.json · /chatgpt-user.json · /adsbot.json — OpenAI IP ranges (fetched + parsed 2026-08-12)
3. https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers — Googlebot/GoogleOther/Google-Extended tokens + UA strings; "Google-Extended doesn't have a separate HTTP request user agent string"; "does not impact a site's inclusion in Google Search nor is it used as a ranking signal"; `Chrome/W.X.Y.Z` wildcard instruction
4. https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests + .../google-user-triggered-fetchers + .../google-special-case-crawlers — five IP-range files at `/static/crawling/ipranges/`, rDNS masks per category, Google-Agent + Google-GeminiNotebook (former `Google-NotebookLM`, "supported until August 2026"), Web Bot Auth `agent.bot.goog`
5. https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler — Anthropic's three bots (dated 2026-04-07; `support.anthropic.com` 301s here). No UA strings published; `Crawl-delay` supported; per-bot "what happens when you disable it"
6. https://claude.com/crawling/bots.json — Anthropic IP ranges; one flat file for all three bots
7. https://commoncrawl.org/ccbot — CCBot UA string, spoofing warning, robots.txt block example
8. https://support.apple.com/en-us/119829 — About Applebot (published 2026-06-08). Applebot / Applebot-Extended, `*.applebot.apple.com` rDNS with worked example, `nosnippet` retrieval opt-out, `isAccessibleForFree`, Googlebot-fallback rule, no crawl-delay, `iTMS`. CIDRs: https://search.developer.apple.com/applebot.json
9. https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/ — Meta's five crawlers (updated 2026-05-21): facebookexternalhit, meta-webindexer, meta-externalads, meta-externalagent, meta-externalfetcher. No IP/ASN verification published; parenthetical URL published as a broken relative path
10. https://developer.amazon.com/amazonbot — Amazonbot / Amzn-SearchBot / Amzn-User; `noarchive` = training opt-out; no crawl-delay; per-host robots.txt. IP pages (HTML, not JSON, ~360KB each): /amazonbot/ip-addresses/, /searchbot-ip-addresses/, /live-ip-addresses/
11. https://index.commoncrawl.org/ccbot.json — CCBot ranges; extra `synctoken` + `notes` fields; notes recommend FCrDNS for IPv4
12. https://docs.perplexity.ai/guides/bots — PerplexityBot vs Perplexity-User; "Since a user requested the fetch, this fetcher generally ignores robots.txt rules"; no training bot published. Ranges: perplexity.ai/perplexitybot.json, /perplexity-user.json
13. https://developers.google.com/search/docs/appearance/ai-features — AI Overviews / AI Mode gated by Googlebot + snippet controls, not Google-Extended; "a page must be indexed and eligible to be shown in Google Search with a snippet"
14. https://blog.google/technology/ai/an-update-on-web-publisher-controls/ — original Google-Extended announcement (2023-09-28), narrower "Bard and Vertex AI generative APIs" scope
15. https://raw.githubusercontent.com/ai-robots-txt/ai.robots.txt/main/robots.json — community aggregate, 163 tokens at fetch time. Breadth source, not a truth source
16. https://www.botify.com/insight/ai-crawler-bots — Botify's AI-crawler glossary article. No metrics/methodology/numbers; training vs live-retrieval split; recommends log analysis + "nuanced bot governance"; demo CTA
17. https://support.botify.com/en/articles/10139856-understanding-ai-bot-data-in-botify + .../9108633-supported-bots + .../12384203-about-the-discoverability-report + .../15656344-javascript-crawl-fields — 60+ bots tracked; "Botify can only authenticate bots that share their IP addresses… Bytespider, CCBot, ClaudeBot, Claude-Web"; AI Visibility via partner scraping; JS rendering fields incl. raw-vs-rendered diff
18. https://support.botify.com/en/articles/9108639-about-the-analytics-overview + .../9108635-botify-glossary + .../15650049-main-crawl-fields + .../9108667-understanding-loganalyzer-reports + .../15650054-crawl-and-visit-fields-logs — the 5-stage funnel and the URL join; ~51% of enterprise pages not crawled by Google; Active Page / Crawl Budget / Crawl Ratio / Frequency / Orphan definitions; `compliant` 4-criteria definition + failure enum; Internal PageRank fields; `crawls.<bot>.*` schema
19. https://www.botify.com/platform/visibility/sitecrawler-feature + https://support.botify.com/en/articles/9108646-sitecrawler-overview + .../9108579-performance-impact-of-robot-crawls — "crawl millions of pages in a single crawl with no crawl budget limitations"; "same rendering engine as Googlebot"; "most AI bots cannot render JavaScript"; 1,000+ indicators; 20%-5xx-in-10-min throttle
20. https://blog.cloudflare.com/ai-search-crawl-refer-ratio-on-radar/ — crawl-to-refer ratios, Anthropic 70,900:1 → Mistral 0.1:1 (Jun 19–26 2025), with the Referer-header caveat. Related: https://blog.cloudflare.com/content-independence-day-no-ai-crawl-without-compensation/
21. https://blog.cloudflare.com/from-googlebot-to-gptbot-whos-crawling-your-site-in-2025/ — crawler traffic growth May 2024→May 2025; top-10k robots.txt blocking analysis (14% target AI bots; GPTBot most-blocked at 312 domains); the Google-Extended "not a user-agent substring" caveat
22. https://palewi.re/docs/news-homepages/openai-gptbot-robotstxt.html — news-publisher robots.txt tracker: 624/1,149 (54.3%) blocking OpenAI, Google AI or Common Crawl (read 2026-08-12)
23. Our own codebase: `D:\projects\autonomous-seo-platform\poc\seo-crawler-poc\src\discovery\robots.ts` (robots-parser, raw body persisted, single-UA today) · `...\src\extraction\metadata.ts:96-121` (`extractRobotsMeta`, agent prefix discarded) · `...\src\crawler\crawl.ts` (Cheerio/Playwright passes, `computeRenderDivergence` 7 scalars, `raw/<id>.static.html`) · `...\src\analysis\rules\site\` + `...\src\models\types.ts` (rule/`Issue` shapes) · `...\src\storage\runStore.ts` (flat JSON, 80 runs) · `D:\projects\autonomous-seo-platform\poc\seo-dashboard\lib\types.ts` (stale duplicated contract) · `...\lib\data.ts:228` (`rawHtmlPath` hardcodes `.html`)
24. https://arxiv.org/abs/2407.14933 — Longpre et al., "Consent in Crisis: The Rapid Decline of the AI Data Commons" (MIT Data Provenance Initiative, Jul 2024). 14,000-domain audit; ~5%+ of C4 tokens / 28%+ of critical sources fully restricted
25. https://support.botify.com/en/articles/9108604-integrating-web-traffic-data + .../9108612-integrating-cloudflare-log-data + .../9108606-filtering-log-data — required log fields (bytes and response time NOT required), Apache Combined format, FTP/SFTP push vs S3/Azure/GCP pull, `YYYYMMDD.log` + gzip/bzip2/zip/xz, 6-hour ingestion cadence, 200GB/day and 8GB/file limits, Cloudflare Logpush/LogPull field list, customer-side pre-filtering
26. https://www.botify.com/platform/ai-readiness/speedworkers + https://www.botify.com/platform/activation/pageworkers — edge prerendering to bots at <300ms/page with the cloaking defence; PageWorkers client-side JS tag and its AI-bot blind spot
27. https://support.botify.com/en/articles/9108632-botify-subscription-plans — five tiers, no published prices, limits expressed as retention/crawl-history not URL counts; log retention 13/24/36 months
28. https://www.botify.com/platform — module map (AI Readiness / AI Visibility / AI Activation); LogAnalyzer positioned as "AI agent & bot analytics". Note `docs.botify.com` and `help.botify.com` do not resolve (NXDOMAIN)
29. https://www.botify.com/platform/visibility/loganalyzer-feature — LogAnalyzer ingests "raw web server log files, accessible via your content delivery network (CDN)", daily refresh; names GPTBot, ChatGPT-User, OAI-SearchBot, PerplexityBot, ClaudeBot, Meta-ExternalAgent
30. https://developers.botify.com/docs/bql-introduction + .../periods + .../querying-seo-data — BQL JSON DSL, `POST https://api.botify.com/v1/projects/<username>/<project_slug>/query`, `Authentication: Token <TOKEN>`, max 2000 rows/call; collection list notably contains no `logs` collection
31. https://developers.cloudflare.com/bots/concepts/bot/verified-bots/ — three verification methods (Web Bot Auth, IP validation, reverse DNS); crawl-delay compliance as verified-bot policy

**Link-check note (2026-08-12):** all URLs above were resolved this session. `www.botify.com/*`
returns **403 to non-browser clients** (plain `curl`/PowerShell) while serving fine to a browser-like
fetch — so a 403 against those paths is UA blocking, not a dead link. Any link-checker we point at
Botify needs a realistic UA or it will report false failures.
