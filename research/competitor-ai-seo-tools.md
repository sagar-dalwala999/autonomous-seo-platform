# seocrawl.ai and the AI-SEO tool category — competitive research

> Scope: what seocrawl.ai actually is; the AI-SEO category's real mechanisms; the
> auto-implementation (JS pixel / edge proxy) pattern and whether search engines honour it;
> AI-visibility measurement and its limits; content-scoring internals and what is reproducible
> from crawl data alone; a blunt substance-vs-wrapper verdict; and a ranked POC-3 build list.
>
> Companion to `crawler-advanced-competitive.md` (crawl-engine gap analysis, incl. the OTTO
> crawl mechanics lane). This report deliberately does **not** re-derive that; it covers the
> **AI layer** on top.
>
> Evidence labelling used throughout: **[V]** = verified, read on the primary source and quoted;
> **[I]** = inferred/deduced; **[VC]** = vendor claim only, not independently substantiated;
> **[N/D]** = not disclosed anywhere I could find (itself a finding).
>
> Research date: 2026-08-12. Constraint: web *search* budget was exhausted early in the session,
> so discovery was done by fetching vendor sites and following their own links. Where a
> methodology page could not be located, it is marked **[N/D]** rather than guessed.

---

## 1. seocrawl.ai — factual profile

### 1.1 What it is

**SEOcrawl AI is a Search-Console/GA4 analytics-and-reporting SaaS that has bolted on an
LLM-prompt-tracking module.** It is not primarily a crawler company. The crawler ("SEO Audit")
is one of about nine modules, and it is the least technically documented one on the whole site.

- Operated by **SEOcrawl SL, Andorra** [V] — footer: "© 2026 SEOcrawl SL · Andorra"
  (<https://seocrawl.ai/team>).
- Team page names co-founders **David Kaufmann (CEO)** and **Marta Adell (CFO)**, plus a CTO,
  CPO and a small specialist team [V] (<https://seocrawl.ai/team>). Investors listed include
  Erik Allebest and Danny Rensch (Chess.com) [V, vendor-stated].
- **Not a new company.** `seocrawl.com` 301-redirects to `https://seocrawl.ai/es` [V], and the
  app shell still carries a "SEOcrawl © 2020-2021" footer [V]
  (<https://app.seocrawl.ai/dashboard/demo-project/llm_tracker_page>). This is a ~2020-era
  Spanish-market SEO SaaS that rebranded onto the `.ai` domain and repositioned around GEO.
- Current positioning headline: **"Be the answer AI gives"** [V] (<https://seocrawl.ai/>).

### 1.2 Module list (verified from their own pages)

Source: <https://seocrawl.ai/seo-tools>, <https://seocrawl.ai/prompt-tracking>,
<https://seocrawl.ai/ai-tracker>, <https://seocrawl.ai/integrations>, <https://seocrawl.ai/mcp>.

| Module | What it actually does | Data source |
|---|---|---|
| SEO Dashboard | GSC + GA4 performance, MoM/YoY, traffic prediction | GSC + GA4 APIs |
| Rank Tracker | "Unlimited keywords", daily updates, clusters/tags/heatmaps | own SERP scraping [I] |
| SEO Audit | Cloud crawl, "~28 on-page & technical checks across six categories", global Audit Health Score | own crawler |
| SEO Monitor | Watches 12 signals on chosen URLs (title, canonical, meta desc, indexing, robots.txt, sitemap.xml, headings, status codes, hreflang, OG, Twitter, GA/GTM code) | own fetcher |
| Keyword cannibalisation | URLs competing for the same GSC queries | GSC |
| Task Manager | Kanban for SEO work | internal |
| Annotations | Site-change annotations overlaid on GSC curves | internal + GSC |
| Reporting | White-label client reports, CNAME support | internal |
| Chrome extension | Free; metadata, headings, canonical, hreflang, link audit | client-side |
| **Prompt Tracking** | Runs user-defined prompts against LLMs, extracts brand mentions | LLM querying |
| **GA4 AI Dashboard / "AI Tracker"** | Classifies GA4 referrals from LLM hosts into an "AI traffic channel" | GA4 |
| MCP server | 74 tools / 17 groups over GSC, GA4 and their own data | internal |
| REST API | Read-only, `sca_live_` bearer tokens | internal |

### 1.3 The crawler — what is and is not documented

This is the crux for us, and the honest answer is that **there is almost nothing there.**

- **"~28 on-page & technical checks across six categories"** (On-Page, Crawlability,
  Indexability, Technical SEO, International SEO, Social Tags) [V]
  (<https://seocrawl.ai/seo-tools/seo-audit>). **The individual rules are never enumerated
  anywhere on the site.** Illustrative examples given are only "canonical tags pointing to the
  wrong URL" and "internal links returning 4xx errors".
- **JavaScript rendering: [N/D].** Not mentioned on the home page, the SEO-tools page, the
  SEO-audit page, the Monitor page, or anywhere in the changelog. No statement either way.
- **Crawl limits (max URLs per crawl): [N/D].** The pricing page meters *number of crawls per
  month* (25 / 100 / 400 / 1,000 / unlimited) but publishes **no page-count ceiling per crawl**
  [V] (<https://seocrawl.ai/pricing>).
- **Crawler user-agent: [N/D].** **Crawl rate / politeness: [N/D].** **Health-score formula:
  [N/D].**
- **No help centre, docs site, or knowledge base exists.** `help.seocrawl.ai` and
  `seocrawl.ai/api` both return 404 [V], and the sitemap index
  (<https://seocrawl.ai/sitemap.xml>) contains only `sitemap-pages`, `sitemap-authors` and 22
  language blog sitemaps — **no docs/help sitemap at all** [V].
- The one hard crawler fact in the changelog is infrastructural, not algorithmic: **4 Nov 2025
  — "Cloud Crawler", "100% in the cloud", parallel URL processing, replacing a desktop-bound
  legacy system** [V] (<https://seocrawl.ai/changelog>). That tells us the crawler was a
  *desktop* tool until late 2025 — i.e. this is a young cloud crawl engine.
- Weak signal that a headless renderer exists *somewhere* in their stack: the MCP server exposes
  a tool group called **"Visual rendering"** [V] (<https://seocrawl.ai/mcp>). That implies
  screenshotting, not necessarily render-based crawling. **[I], low confidence.**

**Verdict on the crawler: undocumented and probably shallow.** ~28 checks against our 29 page
rules + 18 site rules is a comparable or smaller rulebook, with no published rule list, no
render story, and no crawl-scale numbers. There is no evidence here of a serious crawl engine,
and no evidence to the contrary — they simply do not say.

### 1.4 What the "AI" actually is

Two entirely different things share the "AI" label, and only one of them involves an LLM:

1. **"AI Tracker" = GA4 referrer classification.** It connects to GA4 by OAuth and "identifies
   referrals from ChatGPT, Claude, Perplexity, Gemini, Copilot and other LLMs, normalizes
   hostnames and UTM variations, and reconstructs the AI traffic channel for you" [V]
   (<https://seocrawl.ai/ai-tracker>). "No extra tracking code is needed." **This is a
   referrer-parsing feature, not AI.** It is also the most defensible thing they ship, because
   it is measuring real, first-party, hard data.
2. **"Prompt Tracking" = scheduled LLM querying.** "SEOcrawl runs your prompts against ChatGPT
   on a recurring schedule, the way a real user would, then captures the full response and
   extracts brand mentions" [V] (<https://seocrawl.ai/prompt-tracking/chatgpt>). "Prompts run
   daily or weekly, depending on your plan." "Every response is stored with its full citation
   list, prompt, and timestamp indefinitely." Metrics: mention rate, share of voice, citation
   rate, sentiment mix, topic coverage [V] (<https://seocrawl.ai/prompt-tracking>).

**Critically, there is no AI fix-generation, no AI content generation, and no
auto-implementation.** The integrations page is explicit that everything is **read-only**:
REST API (read-only), MCP (read-only), CLI (read-only), with **no WordPress plugin, no CMS
integration, no CDN/Cloudflare app, and no JS snippet** [V]
(<https://seocrawl.ai/integrations>). The only write surface is their own internal Task Manager.

So: seocrawl.ai is **not** an OTTO competitor. It cannot change your site.

### 1.5 Prompt-tracking methodology

**[N/D] on every question that determines whether the numbers mean anything.** Across
`/prompt-tracking`, `/prompt-tracking/chatgpt`, `/ai-tracker` and their own methodology blog
post `/blog/how-to-track-ai-visibility`, they never state:

- whether they call the official OpenAI/Anthropic/Google APIs or drive the consumer web UI;
- logged-in vs logged-out state; whether web search / browsing is enabled;
- which model version is queried;
- how many samples per prompt (i.e. whether they average over LLM non-determinism at all);
- any accuracy, variance or confidence figure.

The phrase **"the way a real user would"** [V] hints at browser automation against the consumer
UI rather than the API, but they never say so **[I, low confidence]**. They do configure
per-country and per-language querying: "each model is queried independently from the country
and language you configure" [V] (<https://seocrawl.ai/prompt-tracking>).

Their own methodology blog post contains **no discussion of non-determinism at all** [V]
(<https://seocrawl.ai/blog/how-to-track-ai-visibility>) — notable, because a direct competitor
(Surfer) does address it explicitly and quantitatively (§4).

### 1.6 Pricing and published limits [V] — <https://seocrawl.ai/pricing>

| Plan | €/mo | €/yr | GSC clicks/mo | GA4 sessions/mo | Projects | Users |
|---|---|---|---|---|---|---|
| Starter | 33 | 396 | <100k | <200k | 5 | 1 |
| Growth | 66 | 792 | 100k–1M | 200k–2M | 25 | 5 |
| Pro | 133 | 1,592 | 1–10M | 2–20M | 100 | 10 |
| Agency | 266 | 3,192 | 10–100M | 20–200M | 200 | 25 |
| Enterprise | custom | custom | unlimited | unlimited | unlimited | unlimited |

| Allowance (per month) | Starter | Growth | Pro | Agency | Enterprise |
|---|---|---|---|---|---|
| Crawls | 25 | 100 | 400 | 1,000 | unlimited |
| Sitemap analyses | 25 | 100 | 250 | 1,000 | unlimited |
| Monitor checks | 25 | 100 | 250 | 1,000 | unlimited |
| Link audits | 25 | 100 | 250 | 1,000 | unlimited |
| Alerts | 4 | 10 | 25 | 50 | unlimited |
| LLMs tracked | 1 (ChatGPT) | all | all | all | all + private |
| AI credits | 10 | 50 | 100 | 250 | unlimited |
| MCP credits | 3,000 | 10,000 | 30,000 | 100,000 | unlimited |

Note the **pricing axis is GSC clicks and GA4 sessions, not pages crawled.** That is the pricing
model of an analytics product, not a crawler product — further evidence about where their
engineering actually is. Rank tracking is sold as "unlimited keywords" on all paid plans [V]
(<https://seocrawl.ai/seo-tools/rank-tracker>); the FAQ does not define what a "credit" is,
what "clicks" measures, or state any fair-use ceiling [V].

### 1.7 Genuinely interesting things they do (worth stealing)

- **Unlimited GSC history.** "Google Search Console only stores 16 months of data … With
  SEOcrawl, you have unlimited data stored for life" [V]
  (<https://seocrawl.ai/seo-tools/seo-dashboard>). Trivial to build (daily GSC API pull into
  our own store), high perceived value, and it compounds — a genuine moat by patience.
- **MCP server as a product surface.** 74 tools / 17 groups, OAuth, endpoint
  `https://mcp.seocrawl.ai`, metered in credits (1–6 per call, 3k–100k/mo by plan) [V]
  (<https://seocrawl.ai/mcp>). Shipped 11 Jun 2026 [V]. This is a smart, cheap distribution
  move: it makes the SaaS the data layer for whatever agent the customer already uses.
- **Free ungated micro-tools as a link/SEO engine:** SERP simulator (incl. a Perplexity preview),
  sitemap checker, schema validator, llms.txt generator, title-tag pixel checker, canonical
  checker, and a **robots.txt AI-bot checker** (GPTBot/ClaudeBot/Google-Extended/PerplexityBot)
  [V] (<https://seocrawl.ai/free-seo-tools>). All of these are things our rulebook already
  computes internally — packaging them as free tools is nearly free marketing.
- **Annotations tied to ranking curves** — change-log-as-a-feature. We already have crawl
  diffing; joining diffs to GSC curves is the same idea with better evidence.

### 1.8 One-line verdict on seocrawl.ai

**A competent, unglamorous GSC/GA4 analytics-and-reporting SaaS with a thin, undocumented
crawler and an LLM-prompt-tracking module whose methodology is entirely unstated.** It is not a
technical threat to our crawl engine. Its threat is packaging and distribution (MCP, free tools,
white-label reporting, unlimited GSC history), not engineering depth. Anyone comparing it to us
on crawl/analysis substance would be comparing our documented 29+18 rulebook against a "~28
checks" black box.

---

## 2. The AI-SEO category map — concrete mechanisms

### 2.0 Scorecard

All rows verified from vendor-owned docs unless marked.

| Product | Own site crawler | JS rendering | Writes to live site | Verdict |
|---|---|---|---|---|
| **Screaming Frog** | Yes | **Headless Chromium, all tiers incl. free** | No | Real engineering; BYO-key AI hook, not a wrapper |
| **SearchAtlas / OTTO** | Yes, two engines | **User-selectable: Chrome / static / Googlebot mimic** | **Yes — pixel, DNS, CF Worker, CMS, GitHub/Vercel** | Real engineering, best-documented in the category |
| **Semrush** | Yes | **Yes — gated to Guru/Business** | Yes (Content Toolkit → WP, 100 sites) | Real infrastructure, AI bolted on |
| **Ahrefs** | Yes | **Yes — opt-in, OFF by default** | No | Real infrastructure, AI bolted on |
| **Alli AI** | Yes (UA + IP list published) | **[N/D] — documentation gap** | **Yes — JS snippet, DNS A-record, nameserver proxy, CF Worker** | Real deployment infra; rendering and worker logic opaque |
| **Surfer** | SERP only | Yes (near-certain); tight budget + HTML-paste fallback | WordPress (6k installs), drafts by default | Real fetch infra, unglamorous NLP |
| **Frase** | **Yes — crawls the customer's site** | [N/D] | Yes — FraseCMS + WP/Webflow/Sanity/Wix | Mid; broadened well beyond briefs |
| **MarketMuse** | SERP only; site crawl [N/D] | [N/D], inferred no | **No** — a "Copy for Publishing" button | Real pre-LLM NLP, trivial scoring; absorbed by Siteimprove |
| **Clearscope** | SERP only (top 30 × desktop+mobile) | Unproven; inferred no | **No** — read-only overlay | Thin layer over IBM Watson + GCP NLP + OpenAI |
| **seocrawl.ai** | Yes (undocumented) | **[N/D]** | **No** — read-only | Analytics SaaS + prompt tracker (§1) |
| **SEO.ai** | **No evidence one exists** | Unanswerable | Yes — CMS auto-publish | All marketing, zero technical docs |
| **WriterZen** | SERP scrape only | [N/D], inferred no | **No** | Thin wrapper over 4 rented layers; unmaintained |

### 2.1 The two structural findings

**(a) Nobody in the content-optimization tier crawls the customer's own site.** Surfer and
Clearscope both punt site-level discovery to the **Google Search Console API** — Surfer's Content
Audit pulls "the top 100 pages" from GSC; Clearscope rescans monthly off GSC. **That means
neither can see orphan pages, non-indexed pages, broken internal links, or anything with zero
impressions.** A crawler that actually crawls is not competing with them on features; it is in a
category they declined to enter. MarketMuse's customer-site crawler is entirely undocumented
(Inventory Settings offers three options: default country, competitor domains, network domains —
no crawl config, no sitemap field, no include/exclude, no frequency).

**(b) JS rendering is a paid gate or off-by-default almost everywhere.** Semrush: "**JS rendering
is available with a Guru or Business SEO Toolkit subscription**"
(<https://www.semrush.com/kb/539-configuring-site-audit>). Ahrefs: "**The crawler will not render
javascript when checking any pages**" in the default config
(<https://help.ahrefs.com/en/articles/9082329-how-should-i-configure-my-site-audit-settings>).
Screaming Frog ships headless Chromium to everyone including the free tier. **Our render-escalation
architecture is on the right side of the sharpest capability line in the category.**

### 2.2 SearchAtlas / OTTO — real engineering, best-documented

- **Crawler**: three user-selectable modes — **Chrome Desktop** ("renders pages the way a real
  browser does"), **Search Atlas Bot** ("A lightweight crawler that **does not render
  JavaScript**. It is faster but will miss dynamically loaded content"), and **Googlebot** mimic
  [V] (<https://help.searchatlas.com/en/articles/16238467-site-audit-crawl-settings-and-analysis-timeline>).
  **Two-tier rendering with the fast path as default is the correct cost/fidelity trade-off — and
  it is what we already do.**
- **OTTO's crawler is budget-managed**: prioritises pages already receiving organic traffic,
  filters near-dupes and thin content, runs overnight, and warns that "pages more than three to
  four clicks from the homepage are harder for any crawler to reach" — with a worked example of
  **16,000 of 65,000 pages** covered [V]
  (<https://help.searchatlas.com/en/articles/16277503-fix-low-otto-crawl-volume-and-schedule>).
- **AI role**: issue detection is **rules-based crawl checks, not AI** [V]. AI does generation
  (titles, metas, H1s, alt, schema), bulk "up to 100 tasks per batch", and deployment.
  **This is the same architecture we have chosen** — rules decide, AI drafts. The category leader
  independently arrived at it.
- **The dangerous bit**: an "I'm Feeling Lucky" button "skips the manual review step — OTTO
  automatically selects and deploys all high-confidence recommendations in a single action" [V]
  (<https://help.searchatlas.com/en/articles/16239095-otto-deployment-lucky-button-dynamic-indexing>).
  **"High-confidence" is never defined anywhere.** They gate the most dangerous feature in the
  product on an unspecified threshold. Our confidence scoring must be published and reproducible.
- **Their "content score" measures obedience, not content** [V]
  (<https://help.searchatlas.com/en/articles/15465791-why-your-content-score-isn-t-improving-in-otto>):
  "The content score reflects **how many of OTTO's content recommendations you have approved and
  deployed** across your site." A positioning gift.
- **Pricing** [V] (<https://searchatlas.com/pricing/>): Starter $99 / Growth $199 / Pro $399 /
  Agency $999. **Pages per site is capped at 10,000 until the $999 tier** even though "Pages
  crawled/mo" reads 10,000,000 on the $399 tier — a spec-sheet number that can only be spent
  10k at a time. API access appears on no listed tier despite a full public OpenAPI reference.
- **ToS** [V] (<https://searchatlas.com/terms-of-service/>): "we **can not guarantee results**";
  "**your revenue and search engine traffic may not increase**"; liability capped at six months
  of fees. No cloaking-risk article for OTTO itself — a deliberate omission.

### 2.3 Surfer SEO

- **AI role**: generation is real and the models are named — **GPT-4 Turbo, GPT-4o, GPT-4o-mini**,
  ~20–30 min per long-form draft, **no documented fact-check step** [V]
  (<https://docs.surferseo.com/en/articles/7869670-surfer-ai>). Issue detection is statistical,
  not AI: it counts your attributes against competitor averages.
- **Auto-Optimize** is the nearest thing to autonomous fixing: "Adding relevant NLP terms and
  enriching your content while preserving its original meaning", capped at 100/day, runs inside
  the editor, human must save [V]
  (<https://docs.surferseo.com/en/articles/9172781-auto-optimize>). **It does not publish.**
- **A public walk-back worth internalising** [V]
  (<https://surferseo.com/updates/auto-optimize-june2026/>): "Auto-Optimize now makes **fewer,
  more targeted edits** — intervening only where it actually moves the needle."
  **Naive term-stuffing auto-optimisation degrades content, and the market leader admitted it.**
- **Competitor set is N=5**, auto-selected from a pool of the top 10–20. That is the entire
  statistical basis of a $299/mo product. Extracted signals are 2019-era counting: word count,
  H1–H6, bolded words, exact/partial keywords via a **three-letter-prefix stem match** — a
  genuinely bad stemmer [V] (<https://docs.surferseo.com/en/articles/7434130-audit-glossary>).
- **Their ToS undercuts the product**: "Most of the analyses … are pulled from a **previously
  precalculated database**", and "**The analyses are not meant to serve as clues or
  recommendations** … some of them can be inaccurate or incomplete" [V]
  (<https://surferseo.com/legal/regulations/>).
- **"Unlimited Documents" means 500/month** [V]
  (<https://docs.surferseo.com/en/articles/12944161-fair-usage-policy>). Also: "**We don't
  currently offer a sandbox environment. All API requests you send will consume actual limits
  from your account.**"
- **The one genuinely good pattern to steal — "Facts"** [V]
  (<https://docs.surferseo.com/en/articles/10717145-facts>): "SERPs are the primary source of
  facts" from "up to the Top 20 search results pages", supplemented by AI models. Scrape top-20 →
  LLM-extract atomic facts → diff against draft → flag what is missing. Cheap, defensible, and
  it is what their AI Search Score is built on.

### 2.4 Clearscope — a well-executed thin layer over three rented NLP APIs

The single most revealing sentence on their site [V]
(<https://www.clearscope.io/product/optimize>):

> "Streamline your workflow with guided recommendations from NLP algorithms and LLM technologies,
> including **Google Cloud, OpenAI, and IBM Watson**."

Entity/term extraction is **bought, not built**. The grade mechanism is stated just as plainly:
"**Including more of these suggested terms will increase your Content Grade**". Readability is
Flesch-Kincaid. Pricing: Essentials $129 / Business $399 — and **drafts are capped at 20/month on
both paid tiers**, i.e. tripling spend buys zero extra AI articles, which is a vendor telling you
the AI writer is a cost centre. No public API (`/api` → 404); the Integrations category in their
support centre has **zero articles**. WordPress plugin has ~200 active installs against Surfer's
6,000. **Everything Clearscope does technically is reproducible in weeks; the moat is brand.**

### 2.5 MarketMuse — real pre-LLM NLP, trivial scoring, and the company is absorbed

- **Siteimprove acquired MarketMuse, announced 8 Oct 2024** [V]
  (<https://www.siteimprove.com/press/marketmuse/>). Hardest evidence of absorption:
  <https://www.marketmuse.com/terms/> **is Siteimprove's ToS**. The pricing page has **no dollar
  figures anywhere** and the CTA on every tier including Free is "Book a demo". Newest blog post
  is Sep 2025; newest platform update is Feb 2024.
- **The topic model is real** [V]
  (<https://help.marketmuse.com/support/solutions/articles/80001167785-how-marketmuse-determines-related-topics>):
  "an **ensemble of algorithms that include phrase extraction (comprising a Bayesian statistical
  ensemble), graph analyses, and natural language processing**", with topics "determined based on
  **semantic relevancy (their meaning), independent of how often they occur**", producing **50
  topics**. Explicitly contrasted against "TF-IDF or correlation SEO".
- **The score on top is embarrassingly crude** [V]: "**One point is awarded for every mention of
  a topic, up to a maximum of two points per topic (50 topics × 2 = 100).**" All the sophistication
  is in *selecting* the topics; the headline number is a capped mention count. **You can
  reproduce MarketMuse's Content Score exactly from their own published formula.**
- **Patent: NOT VERIFIED.** The About page claims one "awarded in November 2019" but publishes no
  patent number. Treat "patented AI" as marketing.
- **No technical SEO auditing at all** — no broken links, status codes, CWV, or schema validation
  anywhere in their KB. Not a crawler competitor.

### 2.6 WriterZen — thin wrapper, visibly unmaintained

- **`support.writerzen.net` no longer resolves** [V] — their own documentation domain is dead,
  and in-KB links point at it. ToS last updated **May 2021**, predating every AI feature they
  sell. Roadmap link 404s.
- Their KB names **GPT-3.5 Turbo, Curie and Davinci** — Curie and Davinci were deprecated by
  OpenAI in January 2024 — while the marketing site advertises GPT-4o-mini [V].
- **They resell Google Cloud NLP and say so** [V]
  (<https://writerzen.freshdesk.com/support/solutions/articles/69000793885>): they scan "the top
  20 web pages" and return **Entity / Salience / Entity-Level Sentiment** (verbatim GCP NL
  response fields), because "**Since this is a cost-incurring function from our end, we need to
  charge it back to our customers**". They also killed their own algorithm: "TF-IDF is an 8 years
  old technology", replaced by "Integration directly with Google NLP".
- **The "Golden Filter"** is a random forest over "a data set with **20 million keywords**"
  producing a threshold of **1.6176**, which they rounded to **1.618 — the golden ratio — and
  named the product after it** [V]
  (<https://writerzen.freshdesk.com/support/solutions/articles/69000773363>). Numerology
  retrofitted onto a model output, with the math withheld for "IP sensitivity". The one
  differentiated component is unauditable by design.
- **All four intelligence layers are rented**: Keyword Planner (volume) + scraped SERPs
  (allintitle/clustering) + GCP NLP (scoring) + OpenAI (writing). **No site crawler exists.**
- Worth stealing anyway: **SERP-overlap clustering** with a tunable **Cluster Level 3–7** = how
  many shared top-10 URLs two keywords must share to group. That is their entire clustering
  product, and it is cheap.

### 2.7 Alli AI — the most aggressive write-back in the category

Covered mechanically in §3.0. Additional verified facts:

- **The crawler is real**: published UA `…Chrome/122.0.6261.0 Safari/537.36 AlliAI/1.0`, a
  published IP list, and a Cloudflare firewall guide. "**Obeys robots.txt: Yes**" /
  "**Obeys crawl delay: No**" [V]
  (<https://help.alliai.com/en/articles/9924602-what-is-alliai-bot>).
- **Whether it renders JS is undisclosed** [N/D] across the bot article, the UA-customisation
  article and the recrawl article — ironic for a vendor whose homepage markets JS-heavy sites
  returning "0 words readable" to AI.
- **"LLM mode"** [V] (<https://help.alliai.com/en/articles/14668257-how-to-activate-llm-mode>):
  "Flip it off, and you see the site the way a human does … **Flip it on, and you see what an AI
  crawler receives: structured markdown.**" **The engine serves materially different content to
  AI crawlers than to humans, and the docs never address the cloaking question.** Against
  Google's spam-policy definition (§3.1) that is the exact shape of the risk.
- **Pricing and page caps are the clearest in the category** [V]
  (<https://www.alliai.com/pricing>): Business $249/mo = **1,250 pages**; Agency $499 = 5,000;
  Enterprise = 20,000. Overages priced per 250 pages.
- **Their ToS never addresses responsibility for modifications made to customer websites, and
  never addresses search-engine penalties** [V] — notable for a product whose entire function is
  rewriting live pages.

### 2.8 SEO.ai — all marketing, no technical detail

Stated plainly because it is the finding: **SEO.ai publishes no technical documentation
whatsoever.** No API docs, no crawler or rendering specs, no developer guides. `help.seo.ai`
fails DNS; `/features` returns 401; the support page is an FAQ that routes technical questions to
an email address. Their blog has articles about *Google's* StoreBot and nothing about their own
crawler. **No evidence a crawler exists.**

What they actually sell: content generation + auto-publishing to WordPress/Webflow/Wix/
Squarespace/Shopify/Magento, plus an **automatic backlink-exchange network** ("Exchange backlinks
with relevant websites in the network") — a link scheme presented as a feature. Their own FAQ
concedes the model: "**The AI performs the research and writes, but our SEO specialists
continuously review and make spot checks**" — services-plus-software, not an autonomous engine.
Pricing $149/$299 per month with **no quantitative limits published at all**. Liability capped at
**the greater of DKK 500 (~$70) or 3 months of fees** [V] (<https://seo.ai/terms>) — the lowest
cap encountered anywhere in this research.

### 2.9 The incumbents — two features worth copying

**Semrush's JS Impact Report** is the single most differentiated technical feature in the
category and it is a straightforward dual-fetch diff [V]
(<https://www.semrush.com/kb/1369-js-impact-report>): "insights about your site **before and
after its JavaScript is rendered**", diffing titles, links and metas (e.g. "Page title is missing
before the JS renders"). **We already fetch both static and rendered in the escalation path — we
are one diff away from shipping this.** Semrush also lets you crawl as user-agent
**`OpenAI-Search`**. Crawl limits: Pro 100k pages/mo (20k max/audit), Guru 300k/20k, Business
1M/100k.

**Screaming Frog runs two distinct similarity systems, and keeps them separate** [V]
(<https://www.screamingfrog.co.uk/seo-spider/user-guide/configuration/>): near-duplicates use "a
**minhash algorithm**" at a **default 90% similarity threshold**, adjustable; "Semantically
Similar" and "Low Relevance" are a **separate embeddings-based filter** requiring an AI provider
connection. **Minhash finds syntactically near-identical content; embeddings find conceptually
similar pages. Two methods, two filters — worth mirroring rather than conflating**, and directly
relevant to the known near-dup threshold bug in our extraction code.

Screaming Frog's AI architecture is also the right one and is not a wrapper at all: they shipped
**Custom JavaScript Snippets** and first-class OpenAI/Gemini/Ollama/Anthropic connections where
**the user supplies their own API key** — an execution hook, zero LLM cost on their P&L,
headless Chromium rendering available even in the free tier (500-URL limit; £199/yr unlimited).

**Ahrefs publishes the most concrete AI-visibility methodology of anyone** [V]
(<https://help.ahrefs.com/en/articles/11064852-what-is-brand-radar-and-how-to-use-it>): they
extract **People Also Ask questions** from their keyword index, then "**enter those questions
into the web version of each AI chatbot using the default model**" — driving the **chatbot web
UIs**, not APIs, except Claude which is via API. Refresh: AI Overviews every few days, chatbots
**monthly**. See §4.

Ahrefs crawl credits are also a model worth copying [V]
(<https://help.ahrefs.com/en/articles/3119402-how-are-crawl-credits-in-site-audit-spent>): "Only
**internal HTML pages that return the 200 (OK) HTTP status code** consume your monthly Crawl
Credits" — resources, 3xx, 4xx, 5xx and external URLs are free, and **JS rendering costs no extra
credits**. Bot: `AhrefsSiteAudit/6.1`, obeys robots.txt and crawl-delay by default, max 30
URLs/min.

---

## 3. Auto-implementation via JS snippet / edge proxy — and whether search engines honour it

This is the highest-stakes section for us, because it is the one place where a competitor
(OTTO, Alli AI) claims a capability we do not have, and where the *marketing claim and the
engineering reality diverge most*.

### 3.0 The architectural fork — the only distinction that matters

Two completely different products wear the same "auto-implement your SEO" label:

- **(a) Client-side JS injection.** A `<script>` in `<head>` mutates the DOM at runtime. The tag
  exists **only in the rendered DOM, only for clients that execute JavaScript**. `view-source`
  is unchanged.
- **(b) Edge / origin HTML rewriting.** The HTML response body is rewritten before it leaves the
  CDN. The tag exists **in the actual HTTP response**. Googlebot, Bingbot, GPTBot, ClaudeBot,
  `curl`, and a JS-disabled browser all see it. No render queue, no AI-crawler blindness, and
  zero cloaking risk **if the rewrite is uniform across user-agents**.

Cloudflare's `HTMLRewriter` is the reference primitive for (b): "The `HTMLRewriter` class allows
developers to build comprehensive and expressive HTML parsers inside of a Cloudflare Workers
application" [V] (<https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/>) —
streaming, CSS-selector targeted, with `setAttribute`/`replace`/`append`.

**Everything damning in §3.1–§3.4 applies to (a). Almost none of it applies to (b).**

**OTTO's deployment paths** [V] (<https://searchatlas.com/otto-seo/>,
<https://help.searchatlas.com/en/collections/19670960-plugin-installation>): OTTO Pixel (script
"just before the closing `</head>` tag"), via GTM, Cloudflare Worker, Cloudflare DNS, WordPress
plugin, CMS connectors (HubSpot/Webflow/Shopify/Contentful/Duda), GitHub/Vercel. Their own doc
"Front-End vs. Back-End Changes" is explicit [V]
(<https://help.searchatlas.com/en/articles/9834724-front-end-vs-back-end-changes>):

> "**JavaScript injection** — used for preview mode and non-WordPress sites. **Changes are
> injected directly in your browser session.**"
> "**SA WordPress plugin** — applies changes at the **server/plugin level**."

So on non-WordPress sites without the Worker, **OTTO is client-side DOM mutation, by their own
documentation.** Their Cloudflare Worker article does **not** state whether the Worker rewrites
HTML at the edge or merely injects the pixel [N/D] — that is the single most important
undocumented question about the product.

**Alli AI** [V] (<https://help.alliai.com/en/collections/2372727-installation>): "the Alli **code
snippet**… No more code after that", works "on any site, regardless of CMS". Their own debugging
doc tells users to open the Network tab, find `v1.js`, and search for "**recommendations**" to
confirm "the approved Recommendations are live" [V]
(<https://help.alliai.com/en/articles/5581580-how-to-check-if-alli-snippet-api-is-working-on-your-site>)
— i.e. **a third-party API round-trip on every pageview, then DOM mutation** [I, high confidence].

Alli's "Full Integration" is not an edge option — it is **nameserver delegation**: add a DNS TXT
record, then "**change your name servers to the ones provided by Alli AI**", point A records,
SSL via Let's Encrypt [V]
(<https://help.alliai.com/en/articles/14490130-ai-visibility-engine-full-integration>). That is
a full reverse proxy with the vendor holding authoritative DNS and terminating your TLS. Their
docs never explain the functional difference between "Easy" and "Full" [N/D], and their
marketing name-drops Nginx/Apache/Akamai/CloudFront install paths for which **no documentation
exists** [V — verified absence].

### 3.1 Google's documented position — primary sources

All of the following are **[V]**, quoted from Google's own developer documentation.

**Google renders, and uses the rendered DOM.**
<https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics>
- Three phases: "Crawling, Rendering, Indexing". "Googlebot queues pages for both crawling and
  rendering." "Once Google's resources allow, a **headless Chromium** renders the page and
  executes the JavaScript."
- <https://developers.google.com/search/docs/fundamentals/how-search-works>: "During the crawl,
  Google renders the page and runs any JavaScript it finds using a recent version of Chrome."
- "Googlebot queues all pages with a `200` HTTP status code for rendering" unless a robots meta
  tag prevents indexing.
- Render latency: **"The page may stay on this queue for a few seconds, but it can take longer
  than that."** — i.e. rendering is real but *not synchronous and not guaranteed-fast*.
- **Do not lead with the render-delay objection.** The old "two-wave indexing kills JS SEO"
  argument is outdated — Martin Splitt's much-quoted "5 seconds" was the *median queue time
  before rendering begins*, not a JS execution budget, and practitioner testing finds API
  responses delayed 6–12s still make it into rendered output. A well-informed vendor will win
  that argument. The real objections are §3.1 canonical/robots and §3.3 AI crawlers.
  [I / second-hand — the primary Chrome Dev Summit source was not reachable.]

**Title and meta description via JS: explicitly supported — the one place this genuinely works.**
Same page: **"You can use JavaScript to set or change the meta description as well as the
`<title>` element."** Unqualified, no warning. This is the single strongest piece of evidence
*for* the OTTO/Alli pattern, and it comes from Google itself.

But temper the upside — both are *inputs*, not outputs [V]:
- <https://developers.google.com/search/docs/appearance/title-link>: Google draws title links
  from `<title>`, the visual title, `<h1>`, `og:title`, prominent text and anchor text, and
  "**If we've detected an issue on the page, we may try to generate an improved title link**".
- <https://developers.google.com/search/docs/appearance/snippet>: "Google **sometimes** uses the
  meta description HTML element…" — "Snippets are primarily created from the page content
  itself."

→ Even the best-supported use case delivers a *suggestion Google may discard*. Any product that
promises "we rewrite your titles and your SERP listing changes" is overselling.

**Canonical via JS: Google explicitly says don't. This kills the core product premise.**
Same page:
> "You can use JavaScript to set the canonical URL, but keep in mind that **you shouldn't use
> JavaScript to change the canonical URL to something else than the URL you specified as the
> canonical URL in the original HTML**."
> "**The best way to set the canonical URL is to use HTML**, but if you have to use JavaScript,
> make sure that you always set the canonical URL to the same value as the original HTML."
> "When using JavaScript to inject the `rel="canonical"` link tag, make sure that this is the
> **only** `rel="canonical"` link tag on the page."

And <https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls>:
> "If you're using client-side rendering with JavaScript… **The best way to do this is to specify
> the canonical URL in the HTML source code and make sure that JavaScript doesn't change the
> canonical link element.**"

Plus: rel=canonical is a **"strong signal"**, not a directive; **"Don't specify different URLs as
canonical for the same page using different canonicalization techniques"**; "using both methods
at the same time is more error prone."

→ **Read literally, a JS tool may only set the canonical to the value that is already in the
HTML.** Changing a canonical is precisely what an SEO-fixing tool wants to do. And because these
tools *inject* rather than *replace*, on any site whose CMS already emits a canonical the
near-inevitable result is **two conflicting `rel=canonical` tags** — the exact state Google warns
against. Google does not document which wins; the likely outcome is that Google ignores the
signal and picks its own, **while the vendor dashboard reports the fix as deployed.** That silent
failure mode is the #1 risk in this whole pattern. [I, high confidence]

**robots meta / noindex via JS: documented to possibly not work at all.**
Same page: **"When Google encounters the `noindex` tag, it may skip rendering and JavaScript
execution, which means using JavaScript to change or remove the robots `meta` tag from `noindex`
may not work as expected."** Google's advice: **"If you _do_ want the page indexed, don't use a
`noindex` tag in the original page code."**

<https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag> adds two more nails:
> "Google typically renders pages in order to index them, however **rendering is not guaranteed**."
> "In the case of conflicting robots rules, **the more restrictive rule applies**."
> "**do not add or remove the `data-nosnippet` attribute of existing nodes through JavaScript**."

→ **Chicken-and-egg: a tool cannot rescue an accidentally-noindexed page via JS, because the
noindex is what stops Google running the JS that would remove it.** And "most restrictive wins"
means an injected `index,follow` can never override an existing `noindex` — client-side robots
changes can only ever make things *more* restrictive. **Never automate robots directives.**
(Asymmetry worth noting: Google *does* endorse JS-injected `noindex` as a soft-404 fallback for
SPAs [V] — <https://developers.google.com/search/docs/crawling-indexing/javascript/fix-search-javascript>.
Adding noindex by JS is fine; removing it is not.)

**JSON-LD structured data via JS: supported, with caveats.**
<https://developers.google.com/search/docs/appearance/structured-data/generate-structured-data-with-javascript>
- "Google Search can understand and process structured data that's available in the DOM when it
  renders the page."
- Google explicitly lists Google Tag Manager as one of "the most common" methods, but cautions
  that duplicating information in GTM "increases the risk of having a mismatch between page
  content and the structured data inserted using GTM."
- E-commerce caveat: "dynamically-generated markup can make Shopping crawls less frequent and
  less reliable, which can be an issue for fast-changing content like product availability and
  price."

**Serving different HTML to bots (the edge/proxy channel) — Google's stance.**
<https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering>
- **"Dynamic rendering was a workaround and not a recommended solution, because it creates
  additional complexities and resource requirements."** Google recommends server-side rendering,
  static rendering or hydration instead.
- Not automatically cloaking *if the content is equivalent*: serving "completely different
  content to users and crawlers can be considered cloaking".
<https://developers.google.com/search/docs/essentials/spam-policies> defines cloaking as
**"the practice of presenting different content to users and search engines with the intent to
manipulate search rankings and mislead users."**
The spam-policies page lists as an example of cloaking: **"Inserting text or keywords into a page
only when the user agent that is requesting the page is a search engine, not a human visitor."**

→ **Intent and equivalence are the test.** An edge worker that rewrites a title tag for
Googlebot *and* for users is not cloaking. One that rewrites only for Googlebot is the textbook
example in Google's own policy. **Design rule for us: never branch on user-agent.**

Also note Google's tense on dynamic rendering — "**was** a workaround". Prerender.io-style
bot-facing pre-rendering sits on a pattern Google has formally demoted.

**Bing is materially weaker, and its guidance is the opposite of the pixel pattern.**
[V] <https://blogs.bing.com/webmaster/october-2018/bingbot-Series-JavaScript,-Dynamic-Rendering,-and-Cloaking-Oh-My>
(Fabrice Canel & Frédéric Dubut, 31 Oct 2018 — **stale, treat with care**):
> "bingbot is **generally able to render JavaScript**" but "it is **difficult for bingbot to
> process JavaScript at scale on every page of every website**".
> Bing recommends detecting the crawler and "**prerender the content on the server side and
> output static HTML**".
> On cloaking: "**as long as you make a good faith effort to return the same content to all
> visitors**… this is acceptable and not considered cloaking."

Bing's index underpins Copilot; weak JS rendering there propagates into AI-search surfaces [I].

### 3.2 The scorecard: what is safely automatable client-side

Derived directly from the quotes above. This is the table that should drive our product
decision.

| Element | JS-injected, Google | Verdict |
|---|---|---|
| `<title>` | Explicitly supported [V] | **Safe** (after render delay) |
| `<meta name="description">` | Explicitly supported [V] | **Safe** (after render delay) |
| JSON-LD structured data | Supported when in rendered DOM [V] | **Safe**, with mismatch/Shopping caveats |
| OG / Twitter tags | Not covered by Google's docs; social scrapers (Facebook, Slack, X) do **not** render JS [I, high confidence] | **Unsafe** — the consumers of these tags don't render |
| `rel=canonical` | Supported but "best way … is HTML"; must not point elsewhere; conflicting signals warned against [V] | **Risky — do not automate** |
| robots meta / noindex | Google "may skip rendering" when noindex is present [V] | **Unsafe — never automate** |
| hreflang | Not documented as JS-settable; is a cross-page reciprocal contract | **Unsafe** [I] |
| Headings / body copy | Rendered DOM is indexed [V] | Works for Google; invisible to non-rendering AI crawlers |
| Internal links | Rendered DOM links are extracted [V] | Works for Google; invisible to non-rendering AI crawlers |
| Image `alt` | Rendered DOM [V] | Works for Google |
| Redirects / status codes | Impossible client-side — the response is already sent | **Cannot be done in JS at all** |
| `robots.txt`, XML sitemaps | Server-side artefacts | **Cannot be done in JS at all** |

**Every "unsafe" and "cannot" row above becomes safe under the edge-rewrite model (§3.0b)**,
because the change lands in the response body rather than the DOM. That asymmetry — 4 safe
elements client-side vs the full set at the edge — is the whole argument for building (b) and
never (a).

### 3.3 The AI-crawler problem — the decisive argument

The entire *selling point* of a 2026 AI-SEO tool is being visible to LLMs. And the measurement
evidence says client-side injection is invisible to exactly that audience.

**Vercel, "The rise of the AI crawler" (17 Dec 2024), based on their own edge-network traffic**
[V] (<https://vercel.com/blog/the-rise-of-the-ai-crawler>):

> "**none of the major AI crawlers currently render JavaScript.** This includes: OpenAI
> (OAI-SearchBot, ChatGPT-User, GPTBot), Anthropic (ClaudeBot), Meta (Meta-ExternalAgent),
> ByteDance (Bytespider), Perplexity (PerplexityBot)"

- GPTBot/OAI-SearchBot fetch JS files on ~11.5% of requests but "**don't execute them. They
  can't read client-side rendered content.**" ClaudeBot fetches JS on ~23.8%, does not execute.
- **AppleBot is the exception** — renders JS via a browser-based crawler. **Gemini** rides
  Googlebot's infrastructure and therefore does render.
- Caveat: this data is Dec 2024 and crawler behaviour changes. **Re-verify before betting on
  it** — but no contrary evidence has surfaced.

**Every operator's own documentation is silent on rendering** [V — verified absence]:
OpenAI (<https://developers.openai.com/api/docs/bots>), Anthropic
(<https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler>),
Perplexity (<https://docs.perplexity.ai/guides/bots>) all document user-agents and purposes only.

**This is the argument that should decide the build.** A client-side tool produces SEO changes
that are structurally invisible to every major AI crawler. Shipping that in 2026, into a market
buying "AI visibility", is strategically terminal. The irony is exact: **Alli AI markets an "AI
Visibility Engine" whose easy-integration mechanism is the one thing AI crawlers cannot see** —
which is presumably why their "full integration" resorts to taking over nameservers.

**And the market leader has published the receipt.** SearchAtlas — the vendor most identified
with the JS pixel — states on its own help centre that bots which do not execute JS "such as
GPTBot (ChatGPT), ClaudeBot (Anthropic), and PerplexityBot — **would never see those changes**"
[V]
(<https://help.searchatlas.com/en/articles/16081885-search-atlas-cloudflare-worker-server-side-html-rewriting-explained>).
Their Worker "runs **server-side** using the **HTMLRewriter API** … parses and rewrites the HTML
response in a streaming fashion before it is delivered to the requester … **HTMLRewriter operates
on the raw HTML bytes at the network level**" [V].

**That is the vendor with the most to lose telling you the pixel does not reach AI crawlers, and
shipping the edge replacement.** They paid the tuition; we should not pay it again.

Two more corroborating pieces:
- **OTTO's own crawler cannot verify OTTO's own output** [V]
  (<https://help.searchatlas.com/en/articles/9833904-understanding-javascript-rendering-and-search-atlas-site-auditor>):
  "When OTTO is deployed via the **pixel (manual script)** installation, the crawler may
  currently display the **original source titles** rather than the OTTO-deployed titles, **even
  when JS rendering is active**." A deployment mechanism you cannot confirm with a `curl` is a
  deployment mechanism you cannot operate.
- **Documented Flash of Original Content** [V]
  (<https://help.searchatlas.com/en/articles/16256377-otto-h1-rendering-lag-cache-issues>):
  "the original H1 appears for a split second before switching."
- Their pixel docs are explicit that nothing persists: "OTTO applies meta tag changes **at the
  rendering stage** … may not be reflected in the raw static HTML" and "**OTTO changes are
  client-side rendered and won't appear in your CMS**" [V]
  (<https://help.searchatlas.com/en/articles/16245133-otto-meta-edits-view-source-vs-browser-inspect>,
  <https://help.searchatlas.com/en/articles/11880172-otto-setup-functionality-and-deployment>).

### 3.4 Operational risks of the pixel pattern

- **Rented, not owned.** Pixel-applied fixes revert when the subscription lapses or the script
  is removed — nothing was ever written to the CMS. (Documented in our lane-A research as a
  help-doc statement that contradicts the marketing claim of permanence; SearchAtlas's own docs
  also confirm the Content Assistant does not write to your CMS.) The nameserver variant is
  worse: cancelling means a DNS migration under time pressure with TTL propagation and SSL
  re-issuance. Only the CMS-plugin and GitHub/Vercel paths persist. **The client-side
  architecture makes churn catastrophic for the customer, which is excellent for vendor
  retention and terrible for customer trust** — a deliberate choice we should make consciously.
- **Render-delay exposure.** Google's own wording — "a few seconds, but it can take longer" —
  means the change is not live in the index at deploy time, and there is no SLA.
- **Conflicting-signal risk on canonical/robots**, per Google's explicit warnings above.
- **Third-party JS single point of failure**: a script in `<head>` that must complete a network
  round-trip to fetch its "recommendations" before applying them is a hard availability
  dependency on the vendor's CDN. **If it fails to load, every SEO change silently vanishes** —
  no error, no alert, and SERP titles revert on Google's next render. Neither vendor documents
  `async`/`defer` behaviour or page-speed impact [N/D].
- **CLS exposure on the visible-DOM changes.** Head-only injection (title/meta/canonical/schema)
  should not shift layout. But **heading rewrites, internal-link insertion and content changes
  are post-paint visible-DOM mutations** — exactly the mechanism web.dev names: layout shifts
  happen when "DOM elements are dynamically added to the page before existing content" [V]
  (<https://web.dev/articles/cls>). OTTO documents changing headings and internal links; Alli
  markets "AI Internal Linking Automation". Real Core Web Vitals risk. [I]
- **Supply chain — and this is not theoretical.** The Polyfill.io attack: a Chinese company
  bought the project in Feb 2024 and injected malware affecting **100,000+ sites** including
  JSTOR, Intuit and the World Economic Forum, with evasion logic that skipped admins and delayed
  when analytics were detected [V] (<https://sansec.io/research/polyfill-supply-chain-attack>).
  **An SEO pixel is strictly more dangerous than Polyfill.io was**: Polyfill only had script
  execution; these vendors have script execution *plus a mandate to rewrite your `<head>` and
  your links*, so malicious canonical or link injection would look like normal product
  behaviour. Alli's nameserver-delegation mode escalates further — TLS termination at the vendor
  means a compromise is not an SEO incident, it is a total domain compromise.
- **Cloaking exposure only in the edge/proxy variant**, and only if bot and user output diverge.
  The mitigation is simple and non-negotiable: **serve identical rewritten HTML to everyone,
  never branch on user-agent.**
- **Auditability collapse.** Once a pixel is live, the site's source of truth is split between
  the CMS and the vendor's overlay. Diffing, rollback and incident response all get harder.

### 3.4b The evidence gap — state this honestly

**There is no credible independent controlled test showing that OTTO's or Alli's JS-injected
changes get indexed by Google.** Not "the evidence is mixed" — the public evidence base is
essentially absent. What exists is vendor case studies (uncontrolled, no holdout) and adoption
numbers (the SearchAtlas WordPress plugin has 8,000+ active installs [V] —
<https://wordpress.org/plugins/search-atlas/> — which proves adoption, not efficacy).

Reasoning from Google's docs instead: JS-set titles and meta descriptions **should** be indexed
(§3.1 blesses them); JS canonicals and JS noindex-removal **should** be unreliable (§3.1 warns
against them). **The vendors' claims are partly supported and partly contradicted by Google's
own documentation — and the contradicted parts are the ones that de-index sites.**

**Cheap decisive experiment (one day):** deploy the pattern on a throwaway domain, then use
Search Console **URL Inspection → "View crawled page" / rendered HTML** to see exactly which
injected tags Google actually captured. That converts the biggest gap in this document into our
own primary data, and it beats every case study in existence.

### 3.5 What this means for us

**Do not build a client-side pixel that rewrites canonicals or robots directives. Ever.**
If we ever ship auto-implementation, the defensible order is:

1. **Patch artefacts first** (a diff / PR / CMS-ready payload the customer applies) — zero risk,
   fully auditable, and it makes the change *theirs*, permanently.
2. **Native CMS write** (WordPress/Shopify/Webflow API) — real source-of-truth changes, visible
   to every crawler including non-rendering AI bots.
3. **Edge/origin HTML rewrite** (Cloudflare Worker or equivalent), identical for all agents —
   the only overlay approach that reaches non-rendering AI crawlers.
4. **Client-side JS** — last resort, and restricted to `title`, `meta description` and JSON-LD
   only, which is exactly the set Google explicitly blesses.

That ordering is the opposite of how OTTO is marketed, and it is defensible from Google's own
documentation line by line.

---

## 4. AI-visibility / LLM-citation tracking — methods and honest limits

### 4.1 There are only two architectures, and vendors blur the line

| | **Synthetic panel** | **Observational / log** |
|---|---|---|
| What it is | Vendor invents a basket of prompts, runs them on a schedule, parses the answers | Reads real traffic: CDN/server logs (AI bot hits), GA4 referrals, clickstream |
| Ground truth? | **No** — it measures the vendor's basket | **Yes**, but tiny volumes and heavy attribution loss |
| Sold by | Profound (Answer Engine Insights), Peec, Otterly, Scrunch, SE Ranking, Conductor, Evertune, Surfer, Clearscope, seocrawl.ai | Profound (Agent Analytics), Scrunch (Agent Traffic), Semrush/Similarweb clickstream, seocrawl.ai's GA4 AI Tracker |

**Every headline metric in this market — "AI Visibility", "Share of Voice" — comes from column
one.** There is no vendor selling a genuine measurement of how often real users see your brand in
ChatGPT. [I, high confidence]

### 4.2 Collection method — the vendors flatly contradict each other

- **Peec AI**: "Peec AI uses advanced **UI scraping technology to interact with AI models exactly
  as real users do**", because "**API responses often differ from what users see in the actual
  interface**" [V] (<https://docs.peec.ai/intro-to-peec-ai>).
- **SE Ranking**: "retrieves results through **direct UI-based monitoring** … captures the
  responses as a real user would see them" [V]
  (<https://seranking.com/ai-visibility-tracker.html>).
- **Conductor**: "We use an **official API-first approach** for data collection wherever
  possible, ensuring our insights are more accurate, reliable, and compliant than scraper-based
  tools" [V] (<https://www.conductor.com/platform/intelligence/>).
- **Ahrefs Brand Radar** — the most concrete published method of anyone: extract People Also Ask
  questions from their keyword index, then "**enter those questions into the web version of each
  AI chatbot using the default model**"; Claude via API. Refresh: AI Overviews every few days,
  **chatbots monthly** [V]
  (<https://help.ahrefs.com/en/articles/11064852-what-is-brand-radar-and-how-to-use-it>).
- **Scrunch**: "**including browser automation and official platform APIs**" [V]
  (<https://scrunch.com/faqs/how-does-scrunch-track-ai-search-visits-to-my-website>) — mixing
  both inside one product, which makes their cross-engine numbers incommensurable.
- **Profound**: **[N/D]** — the market leader documents a Prompt × Model × Region × Persona ×
  Category data model but never states API vs UI [V — verified absence]
  (<https://docs.tryprofound.com/cookbook/setup/data-model.md>).
- **seocrawl.ai / Surfer**: **[N/D]** (§1.5).

**Peec says UI-scraping is more accurate because the API is not what users see. Conductor says
API-first is more accurate than scrapers. Both sell "AI visibility". They cannot both be
measuring the same construct.** That is not a nuance — it is proof the category has no agreed
methodology.

### 4.3 Non-determinism — the numbers that invalidate single-run rank tracking

**The mechanism is understood and it is not the usual folklore.** Thinking Machines Lab shows
individual forward passes *are* deterministic; the cause is **lack of batch invariance** —
kernels return different numerics at different batch sizes, and server load varies per request.
Their experiment: Qwen3-235B, identical prompt, temperature 0, **1000 completions → 80 unique
completions**, diverging at token 102 [V]
(<https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/>).

OpenAI's own words: "our system will make a **best effort** to sample deterministically …
**Determinism is not guaranteed**" [V]
(<https://developers.openai.com/cookbook/examples/reproducible_outputs_with_the_seed_parameter>).

**And retrieval is non-deterministic too, which is far worse.** Profound, 10,000 prompts over 14
days [V] (<https://www.tryprofound.com/blog/what-ai-engines-actually-search-for>):

| Engine | Share of retrieval queries unique run-to-run |
|---|---|
| **ChatGPT** | **91%** |
| Copilot | 47% |
| Perplexity | 14% |

Their conclusion, verbatim: "**any one check only captures one of many possible retrieval
paths**." A single question produces an average of **2.4 underlying queries**.

**The single most important figure in this section** — Evertune, the only vendor that publishes
the maths [V] (<https://www.evertune.ai/platform/methodology>): they sample **each prompt 100
times per model**, giving **±1 point overall and ±2 at topic level**, versus **±9 points when
sampling a unique prompt once**.

> **Every competitor running a prompt once a day is publishing a metric with roughly a ±9-point
> margin of error, and reporting it to one decimal place.**

Profound's counter-figure (±0.68pp at 1×/day) is not a contradiction — theirs is the standard
error of an *aggregate* over 753 prompts × 14 days; Evertune's is the error on *a single
prompt's* estimate [I, reconciliation]. **The practical rule that falls out of both: portfolio-level
visibility is measurable with modest sampling; prompt-level "rank" is not. Any UI showing a
per-prompt rank moving day to day is displaying noise as signal.**

### 4.4 The other structural limits

- **API ≠ the consumer product.** Model routing, memory, custom instructions, the search
  retrieval layer, logged-in state, geo and A/B tests all differ. **No vendor documents
  logged-in vs logged-out, account age, memory state, or custom instructions** [V — verified
  absence]. Inferred: they run fresh/logged-out automation, i.e. **they measure the answer given
  to a brand-new anonymous user** — a population that barely exists among heavy ChatGPT users.
- **Retrieval often does not fire at all.** Otterly estimates only "about **20–35% of all ChatGPT
  prompts lead to live internet searches**", and concedes it is modelled: "OpenAI does not
  disclose any specific data regarding how frequently the web search feature is triggered" [V]
  (<https://otterly.ai/blog/how-often-does-chatgpt-trigger-a-web-search/>). Citation metrics
  therefore describe only the minority of answers that retrieved anything.
- **Geo and language rewrite the whole answer.** Profound, 3.25B citations across 7 models and 14
  countries: Portuguese prompts pushed YouTube to **65%** of social citations; Arabic queries
  nearly eliminated Reddit (**4.9% vs 21%** in English) — "the language of the query can rewire
  the entire citation graph" [V]
  (<https://www.tryprofound.com/blog/how-query-language-reshapes-ai-citations>). Meanwhile
  Profound's Starter tier is **1 language, 1 region**; Peec's Gemini tracking is US-only.
- **Model version churn.** No vendor publishes a model-version pinning policy or a changelog of
  which snapshot backed which date. **Every time series spanning a model upgrade contains an
  undisclosed discontinuity.** [I, follows directly]
- **Prompt-panel selection bias — the deepest flaw.** "Share of voice" is share of a basket the
  vendor chose. There is no denominator. And the baskets are demonstrably wrong: Otterly compared
  real prompts against tool-estimated ones [V]
  (<https://otterly.ai/blog/real-vs-estimated-chatgpt-prompts/>) — real prompts average **15.1
  words vs 8.8** (71% longer), **52.1% vs 18.8%** personal pronouns, **21.1% vs 7.1%**
  problem-oriented. **Keyword-derived panels systematically fabricate commercial "best X for Y"
  queries that real users do not type** — exactly the query class where brand mentions are dense,
  so the whole category's numbers are biased upward.
- **Never blend AI Overviews with AI Mode.** Otterly, 100 German queries: **AI Mode triggered on
  100/100; AI Overviews on 49/100**; when both fired, AI Mode averaged **310 citations vs 51**,
  from **3,621 unique domains vs 615** [V]
  (<https://otterly.ai/blog/google-ai-mode-vs-ai-overviews/>). Several vendors list them as
  sibling engines anyway.
- **Two vendors' own datasets disagree by an order of magnitude.** Brand-owned vs community share
  of citations: Profound reports 54% brand-owned / 5% community for ChatGPT; Otterly reports
  47.5% / **52.5%** [V] (<https://www.tryprofound.com/blog/enhanced-citation-categories>,
  <https://otterly.ai/blog/the-ai-citations-report-2026/>). **The panel determines the answer.**
  Treat any absolute citation-share figure as a property of the basket, not of the internet.
- **The undisclosed-panel integrity problem.** Profound's "400M+ real conversations" and
  Evertune's "150M-conversation EverPanel" are load-bearing claims with **zero disclosed
  provenance** — not on product pages, not in methodology posts, and in Profound's case not in
  the privacy policy either [V — verified absence]. Unfalsifiable by construction.

### 4.5 The only hard signals

1. **Referral traffic — real but tiny.** Ahrefs, 3,000 anonymised sites, seven chatbots:
   "**0.12% of a site's views, and 0.17% of its visitors come from AI**" [V]
   (<https://ahrefs.com/blog/ai-traffic-study/>). Their own caveats: some AI traffic resolves as
   "direct"; Copilot/Mistral/Jasper appear to withhold referrer data. And it misses the entire
   no-click majority, which is the thing brands actually worry about.
2. **Your own server/CDN logs** for `GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`,
   `ClaudeBot`. This is what Profound's Agent Analytics and Scrunch's Agent Traffic productise —
   Profound's docs state the platform "doesn't use third-party data sources — it monitors the
   customer's own network traffic" [V]
   (<https://docs.tryprofound.com/agent-analytics/overview.md>). **It is real, it is the
   customer's, and it is verifiable. It measures retrieval, not citation.** This is the one
   honest, falsifiable product in the whole category.
3. **Possibly Search Console.** Google's blog index lists "Introducing Search Generative AI
   performance reports in Search Console" (June 2026) at
   <https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports> — **body not
   retrieved, NOT VERIFIED**, and the Performance report help page still lists only web/image/
   video/news search types. **Chase this: if Google now reports first-party AI Mode
   impressions and clicks, it is the first real ground truth in the category and it reprices
   every vendor above.**

### 4.6 What actually drives LLM citation — the public evidence

- **The academic base case**: "GEO: Generative Engine Optimization", KDD 2024 [V]
  (<https://arxiv.org/abs/2311.09735>). Measured lift on position-adjusted word count: Quotation
  Addition **+41%**, Statistics **+33%**, Cite Sources **+30%**, Fluency **+29%**, Technical
  Terms +18%, Authoritative tone +13%; **Keyword Stuffing was negative.**
  **But the caveat is decisive**: the main evaluation ran on a generative engine *the authors
  built themselves* (Google top-5 retrieval + **GPT-3.5-turbo** synthesis), with real-engine
  validation on Perplexity limited to **200 samples**. Directionally useful, not a law.
- **Google indexation is a necessary-but-insufficient gate.** Profound's 250M-response analysis:
  "ChatGPT's chosen sources overlap with Google only **39 percent**", but also "**If you are not
  indexed by Google, your AI visibility is dead**" [V]
  (<https://www.tryprofound.com/blog/josh-blyskal-tech-seo-connect-deck-2025>). **Classic
  technical SEO — crawlability, indexability, canonical hygiene — is the price of entry to AI
  visibility. That is our existing rulebook, and it is the honest version of this pitch.**
- **A rare controlled experiment that came back null, and credit to the vendor for publishing
  it**: Profound A/B tested serving Markdown vs HTML to AI bots — 381 pages, 21 days — result
  "~1 extra median bot visit over three weeks", not statistically significant, with the treatment
  group showing +12% lift *before Markdown was even deployed* [V]
  (<https://www.tryprofound.com/blog/does-markdown-increase-ai-bot-traffic>).

### 4.7 llms.txt — ship it, expect nothing

**Google's own documentation kills both the llms.txt and the special-schema theories, verbatim**
[V] (<https://developers.google.com/search/docs/appearance/ai-features>):

> "There are no additional requirements to appear in AI Overviews or AI Mode, nor other special
> optimizations necessary."
> "**You don't need to create new machine readable files, AI text files, or markup to appear in
> these features. There's also no special schema.org structured data that you need to add.**"

"AI text files" is llms.txt. Separately: AI labs *publish* llms.txt for their own developer docs
(OpenAI, Anthropic, Gemini all do) [V] — but that is them being a *source*, not them being a
*consumer*. **No primary evidence exists that any major provider's answer generation reads a
site's llms.txt.** OpenAI's crawler documentation never mentions it [V — verified absence].

**Cheap first-party answer available to us:** grep our own and customers' access logs for
`/llms.txt` requests by `GPTBot`, `OAI-SearchBot`, `ClaudeBot`, `PerplexityBot`. One line of
first-party data beats every blog post on the subject.

### 4.8 Pricing reality check

Profound Starter **$99/mo — ChatGPT only, 50 prompts, 1 language, 1 region**; Growth $399 (3
engines, 100 prompts) [V] (<https://www.tryprofound.com/pricing>). Otterly Lite **$29 — 15
prompts**, Standard $189 — 100, Premium $489 — 400 [V] (<https://otterly.ai/pricing>). Scrunch
Starter $250/mo — 350 prompts; Growth $417 — 700 [V] (<https://scrunch.com/pricing>).

**Sit with that: $99/month buys 50 prompts on one engine in one region, run once a day — which
by Evertune's arithmetic is a ±9-point measurement.** That is the actual resolution behind the
word "visibility" in this category.

---

## 5. Content-quality scoring — what these tools actually compute

### 5.1 Surfer SEO "Content Score" [V]

<https://docs.surferseo.com/en/articles/5700365-content-score-in-the-editor-explained>

- **"Content Score is a value from 0 to 100 that reflects how well your content is optimized for
  both traditional search engines and AI-powered search."**
- It is now **two sub-scores**:
  - **SEO Score** — term coverage vs the SERP: **"We prioritize meaningful, high-impact terms —
    those that appear consistently across top-performing pages for your target query."**
  - **AI Search Score** — "Facts Coverage" and "Upfront Intent Alignment" (does the page answer
    the primary question early). Notably: **"the AI Search Content Score doesn't take your
    competitors' scores into account."**
- Structural factors are secondary: **"word count, number of headings, and images still
  contribute, but they're not the primary drivers."**
- Disclaimer present: **"It's usually impossible to reach a perfect 100"**, with a warning
  against over-optimisation.
- **The formula is not published** — only the input categories. [V]
- Marketing claim to treat with suspicion: **"content optimized with Surfer is 25% more likely
  to get cited by AI"** [VC] (<https://surferseo.com/>) — no methodology, sample, or control
  group is published anywhere I could find. Classify as unsubstantiated.

### 5.2 Clearscope "Content Grade" [V]

- Report construction: **"Pulls the top 30 desktop and mobile pages Google ranks for your
  query"** [V] (<https://www.clearscope.io/support/getting-started-content-reports>).
- Term weighting: terms are prioritised by **"how frequently they appear, how many competitors
  use them, and their overall significance in the topic"** [V]. That is document-frequency +
  term-frequency across a 30-document SERP corpus — **a TF-IDF-family method under a different
  name**, whatever the marketing says. [I, high confidence]
- Word-count target is **"the typical word count range for the top-ranking pages"** [V] — i.e.
  a SERP average, nothing more.
- The grade itself: **"a real-time indicator of how well your content covers the topic and
  addresses user intent. It reflects the comprehensiveness and relevance of your writing in
  relation to the analyzed top-ranking content"**, top grade A++, and **"Including more of these
  suggested terms will increase your Content Grade"** [V]
  (<https://www.clearscope.io/support/getting-started-editor>).
- **No disclaimer** that an A++ does not cause rankings appears in their docs. [V — verified
  absence.]
- They have added AI-visibility ("Expand"): "Get a complete picture of your discoverability on
  Google and AI-powered platforms like ChatGPT and Gemini" [VC] (<https://www.clearscope.io/>).

### 5.3 MarketMuse [N/D on method]

- Markets **"patented topic modeling technology"** and "patented AI" [VC]
  (<https://www.marketmuse.com/>) — **no patent numbers, no methodology page, and no formula are
  published on the site**, and their own help centre does not explain Content Score. [V —
  searched <https://help.marketmuse.com/>, the Recommendations section, and the Optimize Pages
  article.]
- The one telling line, from their own help doc: **"Use the topic model to ensure you create a
  comprehensive section, ignoring the Content Score and Word Count targets"** [V]
  (<https://help.marketmuse.com/support/solutions/articles/80001167829-optimize-pages>).
  **MarketMuse's own documentation tells users to ignore MarketMuse's headline score.** That is
  the most damning sentence in this entire report about content-score methodology.

### 5.4 Google's own documented position — the reality check [V]

<https://developers.google.com/search/docs/fundamentals/creating-helpful-content>

- Word count: **"Are you writing to a particular word count because you've heard or read that
  Google has a preferred word count? (No, we don't.)"**
- **"People-first content means content that's created primarily for people, and not to
  manipulate search engine rankings."**
- **"If the 'why' is that you're primarily making content to attract search engine visits,
  that's not aligned with what our systems seek to reward."**
- E-E-A-T: **"experience, expertise, authoritativeness, and trustworthiness … trust is most
  important. The others contribute to trust, but content doesn't necessarily have to demonstrate
  all of them."**
- And from the spam policies, keyword stuffing is **"the practice of filling a page with
  keywords or numbers in an attempt to manipulate rankings"**
  (<https://developers.google.com/search/docs/essentials/spam-policies>).

**Read those two sets of quotes together.** Every SERP-term-coverage score is, mechanically, a
gradient pointing toward "include more of the terms your competitors use." Google's documented
position is that word-count targets are meaningless and that writing to please the algorithm is
the thing they are trying *not* to reward. These scores are correlational proxies dressed as
targets. They are useful as a *checklist of concepts a domain expert might have forgotten*; they
are not a ranking model, and no vendor publishes a formula or a validation study.

### 5.5 What is reproducible from our crawl data alone

**BUCKET A — computable from our own crawl, no external data, no SERP scraping.**
These are the honest, evidence-backed metrics. Most of them we already have or are one step away.

| Metric | Status for us | Notes |
|---|---|---|
| Thin / low-word-count pages | have (wordCount) | Deterministic, evidence-cited |
| Near-duplicate clusters | have (MinHash) | Already better than most tools ship |
| Heading hierarchy validity (H1 count, skipped levels) | have | |
| Internal link graph: PageRank, orphans, depth, anchor-text diversity | have | This is our strongest asset |
| Anchor-text/target mismatch, generic anchors | cheap add | Pure graph + text |
| Canonical/robots/hreflang consistency | have | |
| Schema completeness vs schema.org required/recommended fields | cheap add | Deterministic, validatable |
| Readability (Flesch-Kincaid etc.) | cheap add | **Not a Google ranking factor** — report as a writing aid only, never as an "issue" |
| Entity extraction over our own corpus (spaCy / NER / Wikidata linking) | medium add | Own-corpus only, no SERP needed |
| Embedding-based topical clustering + intra-site cannibalisation | medium add | Cosine similarity between our own pages — no external data |
| Topic-coverage gaps **within the customer's own site** | medium add | "You have 14 pages on X and none on Y, which every page on X links out for" |
| Title/meta pixel-width truncation | cheap add | Deterministic |
| Content freshness / staleness (dateModified vs crawl diff) | have (diffing) | |

**BUCKET B — fundamentally requires external data.** No amount of crawling produces these.

| Metric | External source needed | Cost note |
|---|---|---|
| Competitor term coverage (Surfer/Clearscope core) | SERP scraping (top 10–30 results per query) | The whole cost centre — per-query, recurring |
| Search volume, keyword difficulty | keyword API (Semrush/Ahrefs/DataForSEO) | Licensed data, per-seat or per-call |
| Rank tracking | SERP API, daily | Scales with keywords × days |
| Competitor content gaps | SERP + competitor crawling | |
| AI Overview presence | SERP scraping with AIO parsing | Fragile, changes constantly |

**The one free, first-party, high-value external source: the Google Search Console API.** It
gives real query→page clicks/impressions/CTR/position for the customer's own site, at no cost,
with their authorisation. It does **not** give competitor data, search volume, or
above-position-1 SERP composition, and it truncates history at 16 months (which is exactly why
seocrawl.ai sells "unlimited history" as a feature). **GSC + our crawl covers the majority of
genuinely actionable on-site work without buying a single SERP call.** That should be our
Bucket-B strategy for POC-3: GSC first, SERP data only if a specific rule demands it.

---

## 6. Blunt verdict: substance vs wrapper

### 6.1 What is genuine, defensible engineering

| Thing | Why it is real |
|---|---|
| **Edge/origin HTML rewriting** (Cloudflare Workers `HTMLRewriter`) | Streaming HTML parse + mutate in the response path. Hard to build well, works for every consumer including non-rendering AI crawlers, zero cloaking risk if uniform. This is the only auto-implementation approach that is engineering rather than theatre. |
| **Native CMS writes** (WordPress/Shopify/Webflow/HubSpot APIs) | Real source-of-truth changes. Unglamorous, per-platform grind, permanent. |
| **Large-scale SERP/citation sampling infrastructure** (Surfer: 34,000 prompts/day) | Genuinely expensive to run, and the only way to separate model drift from noise. |
| **GA4 / GSC referrer + query pipelines** (seocrawl's AI Tracker; unlimited GSC history) | First-party, hard, verifiable data. Boring and correct. |
| **Crawl engines with render escalation, link graphs, near-dup detection** | What we already have — and better than seocrawl.ai's documented "~28 checks". |
| **MCP servers over your own data** | Cheap to build, real distribution value. |

### 6.2 What is a thin wrapper or an unsubstantiated claim

- **Client-side "auto-fix" pixels.** A DOM mutation loop over a recommendations API. Google
  blesses 3 of the ~12 things they claim to change, warns against 2 of them by name, and the
  entire output is invisible to every major AI crawler (§3.3). Sold far ahead of its evidence.
- **Content scores presented as ranking models.** Clearscope's grade is term frequency +
  competitor document frequency over a top-30 SERP corpus — a TF-IDF-family method with a
  letter grade on it. Surfer publishes inputs but no formula. **MarketMuse's own help docs tell
  users to ignore the Content Score** (§5.3). None of the three publishes a validation study.
- **"X% more likely to get cited by AI"** (Surfer) and similar quantified efficacy claims —
  no methodology, sample, or control published anywhere I could find. Treat as marketing.
- **Single-run prompt "rank tracking".** By Evertune's own published arithmetic that is a
  **±9-point** measurement reported to one decimal place, over a system where **91% of ChatGPT's
  retrieval queries are unique run-to-run** (§4.3). seocrawl.ai never states its sampling at all,
  and its own methodology blog post does not mention non-determinism (§1.5). Most of this
  category is charting noise.
- **Undisclosed panels presented as privileged access.** "400M+ real conversations" (Profound),
  "150M-conversation EverPanel" (Evertune) — load-bearing claims with zero disclosed provenance
  (§4.4). Unfalsifiable by construction.
- **Absolute citation-share statistics.** Two vendors' own datasets disagree by an order of
  magnitude on brand-owned vs community share (§4.4). The panel determines the answer.
- **"Patented AI"** as a substitute for a published method (MarketMuse — patent claimed,
  **no patent number published**).
- **llms.txt generators.** Every vendor ships one. Google's own docs say: "**You don't need to
  create new machine readable files, AI text files, or markup**" to appear in AI Overviews or AI
  Mode (§4.7). It is a free-tool marketing asset, not a mechanism.
- **"Content scores" that measure obedience.** SearchAtlas's content score literally counts how
  many of SearchAtlas's own recommendations you deployed (§2.2).

### 6.3 Where the category is structurally weak — and where our determinism wins

Every content score, every AI-visibility number, and every pixel "fix" shares one defect: **you
cannot audit it.** No formula, no sample size, no evidence trail, no way to reproduce the number
tomorrow. That is the exploitable gap.

Our differentiator is not "we also have AI". It is: **every issue we raise is a deterministic
rule with a cited piece of crawl evidence, and every fix we propose names the rule that
triggered it and the exact bytes it changes.** That is the one claim in this entire market that
is falsifiable — which is precisely why it is defensible.

Three specific openings fall out of the research:

1. **The unoccupied intersection.** Nobody crawls the customer's own site *and* closes the loop
   to a verifiable server-side deployment. Surfer, Clearscope and MarketMuse punt site discovery
   to the GSC API and cannot see orphan or zero-impression pages at all (§2.1). Alli and
   SearchAtlas deploy but under-document rendering, and SearchAtlas's own crawler cannot confirm
   its own pixel's output (§3.3).
2. **Verifiability as a feature.** SearchAtlas auto-deploys on a "high-confidence" threshold that
   is **defined nowhere** (§2.2). Every AI-visibility vendor charts a number whose sampling is
   undisclosed. **Publishing our thresholds, our sampling and our evidence trail is a product
   differentiator in a category where nobody discloses anything.**
3. **The honest AI-visibility pitch already belongs to us.** Profound's own analysis: "**If you
   are not indexed by Google, your AI visibility is dead**" (§4.6). Crawlability, indexability
   and canonical hygiene are the price of entry to AI visibility — and that is exactly what our
   existing rulebook measures deterministically. We can make an AI-era claim without inventing a
   single unfalsifiable metric.

---

## 7. What we should build for POC-3 — ranked

Given the hard architectural rule (**rules decide what is an issue; the AI only drafts fixes for
issues the rulebook already found**), and given §7 of the SPEC's typed-operation-emitter design
(`UPDATE_TITLE`, `UPDATE_META_DESCRIPTION`, `ADD_FAQ_BLOCK`, … each with `oldValue` optimistic
lock, `reason`, `evidence[]`).

**Tier 1 — build these. High value, fully defensible, no external data.**

1. **Typed fix-operation emitter over existing rule hits, with evidence provenance.**
   Every operation carries the rule ID that produced it plus the crawl evidence pointer. The
   product claim becomes "29+18 auditable rules, and every AI draft is traceable to one" — the
   exact thing no competitor can say. This is the POC-3 core; everything else is optional.
2. **Patch artefacts as the primary deliverable** — a downloadable diff / PR-ready payload /
   CMS-shaped JSON per fix. Zero risk, fully auditable, and the change becomes the customer's
   permanently. This is the honest answer to OTTO, not an imitation of it.
3. **Confidence tiering wired to §3.2's Google-derived scorecard, not to model self-reports.**
   The SPEC's risk tiers already align with the documentation: titles/meta/alt/JSON-LD are
   low-risk; **canonicals, robots directives, hreflang, redirects and URL changes are
   never-auto-apply**, and now we can cite Google's own wording for why in the UI. Confidence
   must come from deterministic validators + k-sample self-consistency, never from the model's
   verbalised number.
4. **Validation-before-apply on every operation**: pixel-width check on titles, length bounds on
   meta descriptions, no-new-facts check against source content, URL-resolves check on any
   proposed link, JSON-LD schema validation. A fix that fails validation is never surfaced.
5. **GSC integration + unlimited history archive.** Free, first-party, compounding. It converts
   our rule hits from "this page has a weak title" into "this page has a weak title and 4,200
   impressions at position 11" — which is the prioritisation everyone actually wants. Cheap to
   build, and it is the axis the whole category prices on.

**Tier 2 — build if there is room.**

6. **Own-corpus semantic layer**: embeddings over our crawled pages for intra-site
   cannibalisation, topical clustering, and internal-link target suggestion. Fully Bucket A
   (§5.5) — no SERP data, no third-party API, and it feeds internal linking, which is our
   strongest existing asset (PageRank + link graph).
7. **Entity extraction over the customer's own corpus** (NER + Wikidata linking) → schema
   completeness and coverage gaps *within their own site*. Defensible because the comparison set
   is their content, not a scraped SERP.
8. **Free ungated micro-tools** built from rulebook internals — SERP/pixel simulator, schema
   validator, canonical checker, robots AI-bot checker. Near-zero marginal cost, real acquisition
   value. seocrawl.ai ships exactly these (§1.7).
9. **MCP server over our crawl + rule data.** Cheap, and it makes us the data layer inside
   whatever agent the customer already runs.

**Tier 3 — only with explicit go-ahead, and only in this form.**

10. **Auto-implementation, edge-first.** If we ever ship it: order is (a) patch artefact,
    (b) native CMS write, (c) **edge HTML rewrite, uniform for all user-agents**, (d) client-side
    JS restricted to `title`, `meta description`, JSON-LD only. **Never** canonical, robots,
    hreflang, or redirects client-side. Run the one-day Search Console URL-Inspection experiment
    (§3.4b) before committing a line of code.

**Do not build.**

- A "rank tracker for ChatGPT" without published sampling methodology — see §4. If we do
  AI-visibility at all, publish the method, the model version, the sample size per prompt, and
  the variance, and report a confidence interval rather than a rank. That honesty *is* the
  product differentiator in a category where nobody discloses anything.
- A SERP-term-coverage content score. It is a TF-IDF proxy with a letter grade, it contradicts
  Google's own published guidance on word count and writing-for-engines, and MarketMuse's own
  docs tell users to ignore theirs.
- A client-side pixel. See §3 in full.

---

## Sources

Primary sources are cited inline at each claim. Principal ones:

**seocrawl.ai** — <https://seocrawl.ai/>, `/pricing`, `/changelog`, `/seo-tools`,
`/seo-tools/seo-audit`, `/seo-tools/seo-monitor`, `/seo-tools/seo-dashboard`,
`/prompt-tracking`, `/prompt-tracking/chatgpt`, `/ai-tracker`, `/integrations`, `/mcp`,
`/free-seo-tools`, `/team`, `/blog/how-to-track-ai-visibility`, `/robots.txt`, `/sitemap.xml`.

**Google** — JavaScript SEO basics, consolidate-duplicate-urls (canonical),
generate-structured-data-with-javascript, dynamic-rendering, spam-policies,
creating-helpful-content.

**AI crawler operators** — OpenAI bots documentation; Anthropic ClaudeBot support article.

**Content scoring** — Surfer docs (Content Score, AI Tracker, AI Volatility), Clearscope support
(content reports, editor), MarketMuse help centre.
