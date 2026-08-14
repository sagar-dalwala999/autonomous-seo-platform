# claude-seo (AgriciDaniel) — capability gap analysis

> **Target:** `https://github.com/AgriciDaniel/claude-seo` @ `main`, v2.2.4, MIT, 14,045 stars,
> 2,039 forks, 379 files. Read from a shallow clone on 2026-08-13 (`pushed_at 2026-07-27`).
> **Method:** every substantive claim below cites a real file path that was opened and read.
> Claims are labelled **[V]** verified-from-source or **[I]** inferred. README marketing is
> quoted only where the repo's own code contradicts or confirms it.
> **Comparison baseline:** our POC-1 crawler + 51-rule deterministic analyzer
> (`poc/seo-crawler-poc/src/analysis/`).

---

## 1. What it architecturally IS

**Blunt verdict: claude-seo is a prompt library with an API-client toolbelt bolted on. It is not
a crawler and it is not an analyzer.** The SEO analysis is performed by Claude reading HTML with
its eyes, guided by ~16,000 lines of very good markdown domain knowledge. Almost none of the
"51-rule-equivalent" logic is executable.

### 1.1 The line-count proof [V]

| Layer | Lines | What it is |
|---|---|---|
| `skills/**/*.md` (SKILL.md + references + assets) | **14,534** | Prompts + encoded domain knowledge |
| `agents/*.md` (18 files) | **1,421** | Subagent prompt definitions w/ tool allowlists |
| `scripts/*.py` (57 files) | **20,941** | Python |
| `tests/*.py` (37 files) | 5,444 | Tests |

The Python number is misleading until you split it by purpose [V, `wc -l` on the named files]:

| Python bucket | Lines | % of scripts/ |
|---|---|---|
| External-API clients (Google, Moz, Bing, DataForSEO, CommonCrawl, PSI/CrUX, GA4, YouTube…) | **9,770** | 47% |
| Reporting + auth + SSRF plumbing (`google_report.py` alone is 99 KB) | **5,355** | 26% |
| **On-page HTML analysis with no external API** | **4,468** | **21%** |
| Drift baseline/compare (SQLite) | 1,166 | 6% |

And that 4,468-line "analysis" bucket is itself mostly infrastructure: `render_page.py` (601),
`fetch_page.py` (289), `url_safety.py` (SSRF hardening). **The entire HTML extraction layer is
`scripts/parse_html.py` — 273 lines of BeautifulSoup.**

### 1.2 There is no crawler [V] — the single most important finding

`skills/seo-audit/SKILL.md:3` advertises "Crawls up to 500 pages" and `:42-48` gives a crawl config
(`Max pages: 500 / Concurrent requests: 5 / Delay between requests: 1 second`). **No such code
exists.**

- No file in `scripts/` matches `crawl|spider|queue|frontier` except `commoncrawl_graph.py`
  (which queries the *Common Crawl* index for backlinks — unrelated).
- Zero occurrences of `ThreadPool`, `asyncio`, `concurrent.futures`, or `multiprocessing`
  anywhere in `scripts/`.
- There is no URL frontier, no dedup set, no robots-aware scheduler, no per-host rate limiter,
  no crawl state persisted anywhere.

The "crawl" is Claude, in conversation, calling `render_page.py` on one URL at a time and holding
the results in its context window. The 500-page cap and the 1-second delay are *instructions to a
language model*, not enforced by any scheduler.

The repo's own README concedes this in the competitor section
(`README.md:461`) [V]: *"**Screaming Frog** crawls deeper and faster at the link-graph level; it is
purpose-built as a crawler and **Claude SEO does not attempt to replace it**."* Multi-page discovery
is instead delegated to the **paid Firecrawl MCP** (`skills/seo/SKILL.md:79`: *"If Firecrawl MCP
available, use `firecrawl_map` to discover all site URLs before analysis"*).

### 1.3 Skills are markdown; agents are prompts with tool allowlists [V]

`docs/ARCHITECTURE.md` states it plainly: *"Skills are markdown files with YAML frontmatter that
define capabilities and instructions."* An agent (`agents/seo-technical.md`) is frontmatter
(`model: sonnet`, `maxTurns: 20`, `tools: Read, Bash, Write, Glob, Grep`) plus a "You are a
Technical SEO specialist" body whose step 1 is literally *"Fetch the page(s) and **analyze HTML
source**"*. Neither layer contains a scoring engine. **Every score in this repo is a language model
filling in a rubric.**

### 1.4 The determinism ledger

| | claude-seo | ours |
|---|---|---|
| Who decides an issue exists | **Claude**, per a markdown rubric | The rulebook (D-08) |
| Reproducible across two identical runs | **No** | Yes |
| Finding carries a rule ID | No | Yes (51 IDs) |
| Finding carries an evidence pointer | No — `audit-data.json` findings are `{title, severity, description, recommendation}`, all free text (`skills/seo-audit/SKILL.md:76-84`) | Yes |
| Finding carries the threshold it breached | No | Yes |
| Persistent state | **Only** `~/.cache/claude-seo/drift/baselines.db` (SQLite) | Full crawl store |

**Fair credit where due:** the *knowledge* encoded in those 14.5k lines of markdown is
excellent, current (verified against Google primary sources through June 2026), and unusually
honest about uncertainty. That is the part worth taking. See §7.

---

## 2. The 25-skill table

Legend: **⚑ = invokes zero executable code (pure prompt).** Line counts are `wc -l` on the
SKILL.md itself. [V] — every row read in full.

### 2.1 Core skills (`skills/`)

| # | Skill | Lines | What it actually does | Scripts invoked | Data source | Output |
|---|---|---|---|---|---|---|
| 1 | `seo` (orchestrator) | 286 | Routing table, subagent spawn rules, health-score weights | credential probes only (`google_auth --check`, `backlinks_auth --check`) | mixed | LLM |
| 2 | `seo-audit` | 182 | Delegation list + `audit-data.json` envelope schema. Tells Claude to crawl; ships no crawler | `render_page`, `google_report`, `drift_history` | local fetch | hybrid |
| 3 | `seo-page` ⚑ | **94** | **Pure prompt.** 94-line on-page checklist. The flagship single-page analyser runs zero code | **NONE** | LLM over fetched HTML | LLM |
| 4 | `seo-technical` | 224 | 9-category checklist + heavy Google-doc knowledge (crawler taxonomy, JS-SEO Dec-2025) | `sitemap_discovery`, `agent_ux_check`, `render_page`, `pagespeed_check`, `crux_history`, `gsc_inspect` | local + Google API | hybrid |
| 5 | `seo-content` ⚑ | 209 | **Pure prompt.** E-E-A-T rubric, word-count floors, Who/How/Why test | **NONE** | LLM | LLM |
| 6 | `seo-content-brief` ⚑ | 247 | **Pure prompt.** Tells Claude to WebSearch SERPs and score competitors 1–10 by eye | **NONE** | LLM / WebSearch | LLM |
| 7 | `seo-schema` ⚑ | 173 | **Pure prompt.** Deprecation rule table + 3 JSON-LD templates. Note `scripts/schema_generate.py` exists but is never wired in | **NONE** | LLM | LLM |
| 8 | `seo-sitemap` | 155 | Protocol-limit validation rules + generation prose | `sitemap_discovery` | local fetch | hybrid |
| 9 | `seo-images` | 434 | Largest core skill. Image checklist + a real shell toolchain (exiftool/cwebp/ImageMagick/ffmpeg) | `parse_html`, `iptc_ai_label` | local files + DataForSEO (opt) | hybrid |
| 10 | `seo-geo` ⚑ | 314 | **Pure prompt.** 314 lines of AI-search knowledge + citability rubric | **NONE** | LLM | LLM |
| 11 | `seo-plan` ⚑ | 126 | **Pure prompt.** 6-phase template + 6 industry playbooks in `assets/` | **NONE** | LLM / user input | LLM |
| 12 | `seo-programmatic` ⚑ | 178 | **Pure prompt.** Quality-gate threshold tables for pages-at-scale | **NONE** | LLM | LLM |
| 13 | `seo-competitor-pages` ⚑ | 220 | **Pure prompt.** Comparison-page templates + 3 JSON-LD blocks | **NONE** | LLM | LLM |
| 14 | `seo-hreflang` ⚑ | 272 | **Pure prompt.** 8 validation rules + ISO code error catalogue. No validator code at all | **NONE** | LLM | LLM |
| 15 | `seo-local` ⚑ | 315 | **Pure prompt.** 315 lines of local ranking-factor statistics + rubric | **NONE** | LLM | LLM |
| 16 | `seo-maps` ⚑ | 268 | **Pure prompt.** 3-tier router naming DataForSEO/Overpass/Geoapify endpoints Claude must call by hand | **NONE** | DataForSEO (paid) / free APIs | LLM |
| 17 | `seo-google` | 356 | Most script-dense skill. Thin prose over 11 real API clients | 11 scripts (GSC, PSI, CrUX, GA4, Indexing, NLP, YouTube, Keyword Planner…) | **Google API (OAuth/key)** — free but auth-gated | **deterministic** |
| 18 | `seo-backlinks` | 267 | Multi-source fallback cascade with explicit per-source confidence weights | `backlinks_auth`, `moz_api`, `commoncrawl_graph`, `bing_webmaster`, `verify_backlinks` | Moz/Bing/CommonCrawl (free tiers), DataForSEO (paid) | hybrid |
| 19 | `seo-cluster` | 322 | SERP-overlap clustering **described in prose** for Claude to execute by counting shared URLs | `dataforseo_costs`, `render_page` | WebSearch / DataForSEO | LLM |
| 20 | `seo-sxo` | 254 | 7-step SERP-backwards pipeline; all scoring is Claude's judgment | `render_page`, `parse_html` | WebSearch + local | hybrid |
| 21 | `seo-drift` | 219 | **The one genuinely deterministic skill.** SQLite baseline/diff engine, 17 coded rules | `drift_baseline`, `drift_compare`, `drift_history`, `drift_report`, `fetch_page`, `parse_html` | local + SQLite | **deterministic** |
| 22 | `seo-ecommerce` | 379 | Free product-page checklist (prompt) + paid marketplace intel (scripts) | `render_page`, `parse_html`, `ucp_check`, `dataforseo_merchant`, `dataforseo_normalize` | local + **DataForSEO (paid)** | hybrid |
| 23 | `seo-flow` | 136 | Prompt-library router over 41 bundled prompt files. **CC BY 4.0, not MIT** | `sync_flow` | LLM | LLM |
| 24 | `seo-dataforseo` (mirror) | 401 | MCP command catalogue: 23 commands → 79+ MCP tool names | `dataforseo_costs` | **DataForSEO (paid) — required** | deterministic |
| 25 | `seo-image-gen` (mirror) | 173 | **Pure prompt.** Use-case → aspect-ratio table, then MCP calls | **NONE** | Gemini/nanobanana MCP (paid) | LLM |

### 2.2 Extension skills (`extensions/*/skills/`)

| Skill | Lines | Reality | Dep | Fails without it? |
|---|---|---|---|---|
| `seo-dataforseo` | 401 | Twin of the core mirror (2-line diff) | DataForSEO (paid) | **HARD FAIL** |
| `seo-image-gen` | 176 | Twin, but ships Python fallbacks (`generate.py`, `batch.py`…) | Gemini key | degrades |
| `seo-firecrawl` | 202 | MCP command doc for 4 tools + credit-cost prose | **Firecrawl (paid)** | degrades → `fetch_page.py`/WebFetch |
| `seo-ahrefs` | 53 | **Thin routing card**, 4 commands | Ahrefs API (paid) | **HARD FAIL** |
| `seo-seranking` | 51 | **Thin routing card**, 4 commands | SE Ranking (paid) | **HARD FAIL** |
| `seo-profound` | 42 | **Thin routing card, zero scripts.** Smallest file in repo | Profound (paid) | **HARD FAIL** |
| `seo-bing` | 47 | Thin card, but every row maps to a real script | Bing Webmaster (free signup) | HARD FAIL on missing key |
| `seo-unlighthouse` | 47 | Wrapper over a local Lighthouse runner. **Only extension with no paid dep** | local Node + `unlighthouse` npm | n/a |

### 2.3 Headline counts [V]

- **12 of 25 core skills invoke zero executable code** (48%): `seo-page`, `seo-content`,
  `seo-content-brief`, `seo-schema`, `seo-geo`, `seo-plan`, `seo-programmatic`,
  `seo-competitor-pages`, `seo-hreflang`, `seo-local`, `seo-maps`, `seo-image-gen`.
  Add `seo-profound` → **13 of 33 SKILL.md files run nothing.**
- Three more (`seo`, `seo-cluster`, `seo-sxo`) invoke scripts *only* as credential probes or page
  fetchers — the analysis is still Claude reasoning.
- **Only 25 of 57 scripts are referenced by any SKILL.md or agent.** 15 are orphans, including
  `preload_check.py`, `schema_generate.py`, `content_quality.py`, `consistency_check.py`,
  `schema_ecommerce_validate.py`, `parasite_risk.py`, `gbp_deprecation_lint.py`. Several of the
  *best* pieces of code in the repo are not wired into any skill.
- Typical SKILL.md composition [I, from reading all 33]: ~40% workflow instructions to Claude,
  ~50% encoded domain knowledge (threshold tables, deprecation lists, checklists), ~5% script
  invocations, ~5% YAML frontmatter + error-handling table.

### 2.4 Internal threshold contradictions [V]

Because thresholds live in prose across many markdown files instead of one config, they disagree:

| Threshold | `seo/references/quality-gates.md` | `seo-page/SKILL.md` | `seo-content-brief/SKILL.md` | ours (`analysis.config.json`) |
|---|---|---|---|---|
| Title min chars | **30** (`:73`) | **50** (`:22`) | **50**, "never under 50" (`:133`) | 30 |
| Title max chars | 60 (`:74`) | 60 (`:22`) | 60 (`:133`) | 60 |
| Meta desc min | **120** (`:95`) | **150** (`:23`) | — | 70 |
| Meta desc max | 160 (`:96`) | 160 (`:23`) | **150** (`:205`) | 155 |

Three different title minimums in one repo. This is the direct, predictable cost of encoding
rules as prose rather than data — and it is the strongest single argument for our D-08 decision.

---

## 3. External dependency map

### 3.1 Headline findings [V]

1. **`commoncrawl_graph.py` does NOT return backlinks.** The skill framing ("free backlink data")
   is false. It parses `*-domain-ranks.txt.gz` for **PageRank + harmonic centrality only**.
   `EDGES_SUFFIX = "-domain-edges.txt.gz"` (`:62`) is declared and never used; `_stream_gz_lines()`
   (`:130`) is dead code; `--top-referrers` is documented in-code as *"Legacy no-op; referring
   domains are not extracted"* (`:408`); and the cache path actively strips legacy referrer data
   (`data.pop("top_referring_domains", None)`, `:262`).
2. **Two "extensions" are vapour.** `extensions/profound/` (42-line SKILL.md) and
   `extensions/seranking/` (51 lines) ship **no script, no MCP server, no HTTP client**. Their
   `install.sh` writes an API key into the user's settings file and copies a markdown file.
   Grepping `PROFOUND_API_KEY|SERANKING_API_KEY` across the repo hits only those dirs and
   `PRIVACY.md` — **zero code consumes them.** The documented commands route to nothing.
3. **PageSpeed Insights runs anonymously.** `scripts/pagespeed_check.py:134` —
   `headers = google_api_key_headers(api_key) if api_key else None`. A **full Lighthouse audit**
   (4 category scores, lab metrics, `opportunities` ranked by `overallSavingsMs`, 15 named
   diagnostics, per-resource detail) **plus PSI's embedded `loadingExperience` CrUX field data**
   needs **zero credentials**. This is their strongest free asset and it is underplayed in the docs.
4. **Security note to relay, not act on:** the extension installers (`ahrefs`, `seranking`,
   `profound`, `bing-webmaster`) write plaintext API keys into the user's global Claude settings
   file via an identical Python heredoc. Worth knowing before running any installer from this repo.

### 3.2 The dependency table

| Service | Auth | Paid/Free | What dies without it | Degrade or hard-fail |
|---|---|---|---|---|
| **PageSpeed Insights v5** | key **optional** | Free (240 QPM / 25k QPD keyed) | nothing | Degrades — key only raises quota |
| **CrUX API** | API key required | Free, 150 QPM | `/seo google crux`, real field CWV | Silently skipped in combined run (`pagespeed_check.py:471`); `sys.exit(1)` in `--crux-only` |
| **CrUX History** | API key | Free | 25-week CWV trends, `lcp_subparts.py` | Hard-fail (`crux_history.py:290-293`) |
| **Search Console API** | OAuth / service account | Free (30M QPD; URL-Inspect 2k/day/site) | `gsc_query.py`, `gsc_inspect.py` — all indexation truth | Soft-fail with structured error |
| **Indexing API v3** | OAuth `auth/indexing` | Free, 200/day | `indexing_notify.py` | Soft-fail; self-limits to JobPosting/BroadcastEvent |
| **GA4 Data API** | OAuth/SA + property id | Free (~25k tokens/day) | `ga4_report.py` | Soft-fail |
| **Google Ads (Keyword Planner)** | OAuth + **developer token** | API free, needs Ads account; bucketed volumes without spend | `keyword_planner.py` (Tier 3) | Soft-fail |
| **Cloud Natural Language** | API key | 5k units/mo free, then **$0.001/1k chars** | `nlp_analyze.py` | Soft-fail |
| **YouTube Data v3** | API key | Free, 10k units/day (~100 searches) | `youtube_search.py` | Soft-fail |
| **Knowledge Graph / Web Risk** | API key | Free | `/seo google entity`, `/seo google safety` | **No implementation at all** — documented in prose only; Claude is expected to hand-roll the HTTP call |
| **Common Crawl webgraph** | **none** | Free | `commoncrawl_graph.py` (PageRank, *not* backlinks) | Returns "domain not found" |
| **WHOIS** | none | Free | `domain_history.py` | Degrades twice: system binary → raw TCP/43 → note |
| **Moz Link Explorer v2** | API key | Free tier 2,500 rows/mo (card required) | `moz_api.py` | Hard-fail at CLI; skill degrades to Common Crawl |
| **Bing Webmaster** | API key | **Free** | `bing_webmaster.py` | Hard-fail at CLI; verified properties only |
| **IndexNow** | publish `<key>.txt` at webroot — **no account** | **Free** | `indexnow_submit.py` | Hard-fail without key; pre-flights key publication |
| **DataForSEO MCP** | HTTP Basic | **Paid, prepaid credits** | 23 commands: live SERP, backlinks, AI-visibility, merchant | Skill checks tool availability first |
| **Firecrawl MCP** | `FIRECRAWL_API_KEY` | Free 500 credits/mo → $16/$83/$333 per month | **Multi-page site discovery** | Degrades → `fetch_page.py`/WebFetch |
| **Ahrefs MCP** | token | **Paid**, metered units | `seo-ahrefs` | Hard-fail |
| **Gemini (nanobanana MCP)** | `GOOGLE_AI_API_KEY` | Free tier then paid | `seo-image-gen` | Degrades to direct-REST stdlib fallback |
| **SE Ranking / Profound** | key written to settings | Paid | — | **No consumer exists** |
| **Unlighthouse** (npx) | none | **Free, MIT** | site-wide Lighthouse (200 routes) | Degrades if npx missing |
| **Playwright Chromium** | none | Free | rendered mode, screenshots | Degrades to raw HTML (`render_page.py:79-84`); installer exit code 10 = "core OK, Chromium missing" |

### 3.3 What works with zero API keys [V]

~36 of 57 scripts run with no credentials. The useful ones:

- `pagespeed_check.py` — full anonymous Lighthouse + PSI field data (**the standout**)
- `unlighthouse_run.py` — site-wide Lighthouse, 200 routes, local, free
- `commoncrawl_graph.py` — domain PageRank + harmonic centrality, 90-day disk cache
- `domain_history.py` — WHOIS heritage + expired-domain-abuse risk scoring
- `verify_backlinks.py` — real backlink liveness crawler (HEAD+GET, anchor/rel extraction)
- `render_page.py` / `fetch_page.py` / `parse_html.py` / `sitemap_discovery.py`
- **Fully offline analyzers** over supplied HTML: `preload_check.py`, `agent_ux_check.py`,
  `content_quality.py`, `content_verify.py`, `schema_generate.py`, `schema_ecommerce_validate.py`,
  `ucp_check.py`, `parasite_risk.py`, `consistency_check.py`, `gbp_deprecation_lint.py`,
  `iptc_ai_label.py`, `google_report.py` (PDF/XLSX), `seo_updates.py`
- `indexnow_submit.py` — free, no account, fans out to Bing/Naver/Seznam/Yandex/Yep

### 3.4 What is behind the paywall

Everything keyword, SERP, backlink-list, competitor, and AI-visibility. DataForSEO prices from
`extensions/dataforseo/skills/seo-dataforseo/references/cost-tiers.md` + `scripts/dataforseo_costs.py`:

| Capability | Cost |
|---|---|
| Live SERP (organic) | $0.002/call advanced, $0.001 regular |
| Keyword search volume | **$0.05**/batch |
| Backlinks (full `/seo dataforseo backlinks` = 6 sub-calls) | **≈$0.11–0.13** |
| Domain intersection | $0.05 |
| On-page instant / hosted Lighthouse | $0.01 / $0.02 |
| **AI visibility (ChatGPT scraper, LLM mention tracking)** | **$0.05/call — the most expensive tier; all 6 `ai_opt_*` tools** |

Budget presets: Conservative $2/day, Standard $10/day, Aggressive $50/day. Enforced by
`dataforseo_costs.py` (`COST_TABLE`, `DEFAULT_CONFIG = {"mode":"threshold","threshold":0.50,"daily_limit":10.00}`)
with a ledger at `~/.config/claude-seo/dataforseo-ledger.json` and 5 always-confirm endpoints.
**Note:** the cost table is duplicated in code and markdown with no consistency test — a drift hazard.

---

## 4. ⭐ Technical-SEO checks it has that we do NOT — the actionable list

This is the section to act on. Our 51 rules are listed at the end of §6. Everything below is a
check claude-seo performs (or specifies precisely enough to implement) that our rulebook does not.

**Column "Form"**: `CODE` = they ship working deterministic code we can port ·
`SPEC` = precisely specified in markdown, no implementation, but mechanically implementable ·
`API` = requires an external API we would have to add.

### 4.1 Tier 1 — deterministic, portable, no new dependency (do these first)

| # | Check | Form | Source | Note |
|---|---|---|---|---|
| 1 | **Speculation Rules present** (`<script type="speculationrules">` inline block or `Speculation-Rules` response header), and which actions (`prefetch`/`prerender`) | **CODE** | `scripts/preload_check.py:66-111` | Whole script is 237 lines, regex + JSON parse. Orphaned — not wired to any skill |
| 2 | **bfcache disqualifiers**: `Cache-Control: no-store`, `unload` listener, `beforeunload` listener | **CODE** | `preload_check.py:83-88,118-126` | Directly actionable LCP/nav win |
| 3 | **Deprecated `<link rel="prerender">`** (sunset Chrome 120) → migrate to speculation rules | **CODE** | `preload_check.py:73-75` | |
| 4 | **LCP image marked `fetchpriority="high"`** on `img/video/source`; count of all `fetchpriority=high` | **CODE** | `preload_check.py:76-82` | We check image dimensions but not priority hints |
| 5 | **`decoding="async"` on non-LCP images** | SPEC | `skills/seo-images/SKILL.md:134-140` | Trivial extension of our image extractor |
| 6 | **Above-fold image lazy-loaded** = harmful (never `loading="lazy"` on the LCP image) | SPEC | `seo-images/SKILL.md:132`, `seo-page/SKILL.md:55` | We have `image-missing-dimensions` but nothing on lazy-loading *correctness* |
| 7 | **JS lazy-loader classification** — `native \| perfmatters \| ewww \| js-generic \| none` via `data-perfmatters-src`, `data-ewww-src`/`data-eio`, `data-src`/`data-lazy-src`/`data-original`/`data-srcset`, and class markers | **CODE** | `scripts/parse_html.py:41-73` | **Prevents a false positive**: WP optimizer plugins strip `loading="lazy"` and use placeholders. A "not lazy-loaded" finding on those sites is wrong |
| 8 | **Accessibility-tree agent-UX audit** — Playwright `page.accessibility.snapshot(interesting_only=False)`, then count unnamed interactive nodes, `role=generic` ratio, `<div onclick>` widgets, inputs without `label[for]`/`aria-label`, semantic landmark presence | **CODE** | `scripts/agent_ux_check.py` (243 lines) + `render_page.py:441-448` | **We already run Playwright** — this is a cheap bolt-on and an entire new deterministic rule family. Deduction ladder: `div[onclick] −min(20,n*5) · no landmarks −10 · unlabelled inputs −min(20,n*4) · unnamed interactive −min(20,n*3) · role=generic>0.5 −10` |
| 9 | **Interactive targets < 24×24px** flagged as agent-invisible (vision pipelines discard elements under ~8 unobscured square px) | SPEC | `skills/seo-technical/references/agent-friendly-pages.md:55-62` | We already capture pixel widths — same machinery |
| 10 | **Back-button hijacking** via `history.pushState`/`replaceState` — Google spam policy added 2026-04-13, **enforcement live 2026-06-15**, treat as Critical | SPEC | `skills/seo-technical/SKILL.md:93` | New, high-severity, purely static-detectable |
| 11 | **Googlebot 2 MB HTML fetch cap** — flag pages whose HTML exceeds it (critical content / JSON-LD pushed past the cap is invisible). Also 64 MB PDF, 15 MB general crawler default | SPEC | `seo-technical/SKILL.md:30` | We already have byte counts. One-line rule, real consequence |
| 12 | **AI crawler robots.txt policy** — 14-crawler table with owner / purpose / obeys-robots boolean: `GPTBot✓ OAI-SearchBot✓ ChatGPT-User✗ ClaudeBot✓ PerplexityBot✓ CCBot✓ anthropic-ai✓ Bytespider✓ cohere-ai✓ Google-Extended✓ Google-CloudVertexBot✓ Google-Agent✗ Google-NotebookLM✗ Google-Messages✗` | SPEC | `skills/seo-geo/SKILL.md:151-172`, `seo-technical/SKILL.md:38-74` | We parse robots.txt already. Pure lookup table. **Key nuance:** blocking `Google-Extended` does NOT affect Search or AI Overviews (those use Googlebot) |
| 13 | **IndexNow support detection** (key file at webroot) | SPEC | `seo-technical/SKILL.md:144-147` | |
| 14 | **`llms.txt` presence** — report it, assign **zero** ranking weight | SPEC | `skills/seo-geo/references/llmstxt-evidence.md` | See §5.1 — their evidence file is the asset, not the check |
| 15 | **SPA / hydration-shell detection** — 8 shell signatures (`<div id="root"></div>`, `<div id="__next">`, `<div id="app"></div>`, `<div id="__nuxt">`, `data-svelte-h=`, `<astro-island `, "you need to enable javascript"), plus builder fingerprint groups (Wix/Webflow/Squarespace) requiring ≥2 markers AND <400 chars visible body text, plus a <100-char visible-body fallback | **CODE** | `scripts/render_page.py:124-150,255-277` | We escalate to Playwright already; this is a better-tuned trigger and a *reportable finding* |
| 16 | **`unverifiable_js` guard** — before declaring content/link missing, check for SPA shell markers OR `len(content) > 5000 and word_count < 50`; report "unverifiable" rather than a false negative | **CODE** | `scripts/verify_backlinks.py:211-231` | **Anti-false-positive pattern applicable across our whole analyzer** |
| 17 | **Dynamic-rendering / prerender-service detection** — refetch with Googlebot UA and diff response size | **CODE** | `scripts/fetch_page.py:41-48,229-230` | Cheap, catches Prerender.io/Rendertron setups |
| 18 | **Console errors captured during render** | **CODE** | `render_page.py:410-414` | We run Playwright but do not collect console output |
| 19 | **Publication / last-modified date extraction** (`htmldate`) + boilerplate-free main-content extraction (`trafilatura`) | **CODE** | `render_page.py:457-474` | Feeds a content-freshness rule we lack entirely |
| 20 | **Suspicious headings** — h1–h3 that are ≤3 chars or purely numeric (`1,234+`, `98%`) are counters/stats, not headings | **CODE** | `parse_html.py:153-163` | Reduces false positives in our heading-hierarchy rules |
| 21 | **JSON-LD `@graph` flattening** — treat each `@graph` member as its own typed entity | **CODE** | `parse_html.py:207-215`; failure mode called out in `validate_backlink_report.py` | If we don't flatten, `@graph`-wrapped sites look like they have no schema |
| 22 | **JSON-LD parse hardening** — bounded extraction: max 50 blocks, 256 KB/block, 1 MB total, 10,000 nodes, depth 40, iterative (non-recursive) `@type` walk | **CODE** | `render_page.py:152-252` | DoS-resistance for our structured-data rules |
| 23 | **Deprecated schema types as a rule** — `HowTo` (Sept 2023), `FAQPage` rich results **fully retired 2026-05-07**, `SpecialAnnouncement` (2025-07-31), `VehicleListing`/`ClaimReview`/`EstimatedSalary`/`LearningVideo`/`CourseInfo` carousel (June 2025), `PracticeProblem` (Jan 2026). **`Dataset` is NOT discontinued** — don't advise removal | **SPEC+CODE** | `skills/seo-schema/references/deprecated-types-2024-2026.md`; enforced in `scripts/schema_ecommerce_validate.py` | We have `structured-data-type-mismatch` but no deprecation awareness. Also: flag FAQPage at **Info**, never recommend removal |
| 24 | **Product schema policy validation** — `offers.@type` must be `Offer` **not** `AggregateOffer` (High) · `hasMerchantReturnPolicy` needs `applicableCountry`+`returnPolicyCategory` · `shippingDetails` needs `shippingDestination`+`deliveryTime` · missing `hasMemberProgram` · `--eu` makes missing `energyEfficiencyClass` High (EPREL) | **CODE** | `scripts/schema_ecommerce_validate.py` (311 lines) | A drop-in rule engine in exactly our style |
| 25 | **Sitemap `<lastmod>` quality** — must be valid W3C Datetime AND reflect last *significant* content change; warn when values are suspiciously uniform or newer than real content | SPEC | `skills/seo-sitemap/SKILL.md:37-41` | We check sitemap membership, not lastmod credibility |
| 26 | **`<priority>` / `<changefreq>` present** → Info, ignored by Google | SPEC | `seo-sitemap/SKILL.md:42,62` | |
| 27 | **Sitemap 50 MB uncompressed cap** (we check the 50,000-URL cap; the byte cap is the other half of the protocol limit) | SPEC | `seo-sitemap/SKILL.md:34` | Our config has `sitemapMaxBytes` — confirm the rule reads it |
| 28 | **News sitemap: 1,000-entry cap (not 50,000) + articles from last 2 days only**; required `news:publication/name/language/publication_date/title`. Override the generic 50k check when the `news:` namespace is detected | SPEC | `seo-sitemap/SKILL.md:77-81` | |
| 29 | **Image sitemap**: only `<image:image>` + `<image:loc>` remain valid, max **1,000 per `<url>`**; `image:caption/geo_location/title/license` deprecated 2022 → Info-removable | SPEC | `seo-sitemap/SKILL.md:67-71` | |
| 30 | **Video sitemap**: required `video:thumbnail_loc` + `video:title` + `video:description` + (`content_loc` or `player_loc`); flag removed tags | SPEC | `seo-sitemap/SKILL.md:72-76` | |
| 31 | **Sitemap discovery hardening** — reject `<!DOCTYPE` in sitemap XML, `resolve_entities=False`/`no_network=True`/`load_dtd=False` XXE-safe parser, accept RSS/Atom + text sitemaps, cross-host `Sitemap:` declarations validated independently, 16-declaration cap, 1 MiB robots cap, 50 MiB sitemap cap, and **"a robots.txt declaration is not a pass unless the fetch validates"** | **CODE** | `scripts/sitemap_discovery.py` (292 lines) | The "declared but broken ≠ found" distinction is a real finding class we lack |
| 32 | **Hreflang: x-default** presence/uniqueness | SPEC | `skills/seo-hreflang/SKILL.md:36-40` | We only have `hreflang-not-reciprocal` |
| 33 | **Hreflang language-code validity** — ISO 639-1 only (`eng`✗, `jp`✗ for Japanese); optional ISO 15924 script subtag (`zh-Hant`/`zh-Hans`, `zh-Hans-US` valid) | SPEC | `seo-hreflang/SKILL.md:42-50` | |
| 34 | **Hreflang region-code validity** — ISO 3166-1 alpha-2 (`en-uk`✗ → `en-GB`; `EU`/`UN`✗; `es-LA`✗); **a region without a language is invalid** (Google's own bad example `be` is the Belarusian *language*) | SPEC | `seo-hreflang/SKILL.md:52-62` | |
| 35 | **Hreflang on a non-canonical URL** → the whole set is ignored | SPEC | `seo-hreflang/SKILL.md:74-78` | High-severity, we don't check it |
| 36 | **Hreflang protocol + trailing-slash consistency** across the set | SPEC | `seo-hreflang/SKILL.md:80-83,102` | We have `internal-link-scheme-mix` but not within hreflang sets |
| 37 | **Hreflang self-reference must equal the canonical exactly** | SPEC | `seo-hreflang/SKILL.md:26-29` | |
| 38 | **UCP (`/.well-known/ucp`) discovery + capability validation** — 7 known capability IDs, endpoint HEAD-probe, and the rule that **UCP versions are date-based (`2026-04-08`), so a literal `"1.0"` is invalid**. 404 = opportunity, never a failure | **CODE** | `scripts/ucp_check.py` (249 lines) | Forward-looking agentic-commerce surface |
| 39 | **Site-reputation-abuse ("parasite SEO") section scan** — per-first-path-segment rates of third-party bylines / commerce CTAs / affiliate params, with thresholds `third_party_rate ≥1.0 → high · commerce_rate ≥2.0 · affiliate_rate ≥3.0 · both → high · section commerce_rate > 2× site mean → drift` | **CODE** | `scripts/parasite_risk.py` (252 lines) | **Needs a site-wide crawl — which we have and they don't.** Strong fit for our site-scope rules |
| 40 | **GBP deprecation lint** — GBP chat CTAs (sunset 2024-07-31) → Critical; `*.business.site` links → Medium | **CODE** | `scripts/gbp_deprecation_lint.py` (138 lines) | Small, self-contained |
| 41 | **Content-quality deterministic scorer** — 26 filler phrases + 46 LLM-tell phrases; `information_density = min(1, ((entities+numbers)*100/tokens)/10)`; `repetition = repeated_bigrams/distinct_bigrams`; `overall = (100−filler)*.25 + (100−ai)*.25 + density*100*.25 + (100−rep)*.15 + min(100,tokens/10)*.10`. Flags: filler ≥50 · ai-patterns ≥40 · low-density <0.20 · repetitive ≥30 · thin <300 tokens | **CODE** | `scripts/content_quality.py` (292 lines) | Deterministic, no LLM. Orphaned in their repo |
| 42 | **Uncited-claim detection** — 11 claim regexes (statistic / quantity / authority / temporal / comparative) + citation search in a **±200-char window** (markdown link, `<a href>`, footnote, schema `Citation`, `source:`/`per`/`according to`); `uncited_ratio` threshold 0.4 | **CODE** | `scripts/content_verify.py` (194 lines) | A real E-E-A-T signal computed without an LLM |
| 43 | **Page-type classification + "wrong page type" finding** — 8 types with a deterministic tie-break ladder: `interactive tool → Tool · address+map → Local · comparison table+"vs" → Comparison · price+buy button → Product · CTA-heavy+minimal nav → Landing · service process+case studies → Service · educational+CTA → Hybrid · default → Blog Post` | SPEC | `skills/seo-sxo/references/page-type-taxonomy.md:176-187` | **Runs entirely on our existing DOM parse.** Unlocks a new finding class with no LLM and no SERP data |
| 44 | **Per-page-type thin-content thresholds** instead of one global number — Homepage 500 / Service 800 / Blog 1,500 / Product 400 / Category 400 / About 400 / Landing 600 / FAQ 800, each with a unique-content % floor | SPEC | `skills/seo/references/quality-gates.md:5-16` | We have a single `thinContentWords`. Pairs directly with #43 |
| 45 | **Per-page-type internal-link floors** — blog 1,500w → 5-10 links · service 3-5 · product 2-4; anchor-text variety rule "no single anchor for >40% of links to a page" | SPEC | `quality-gates.md:127-138`, `seo-cluster/references/hub-spoke-architecture.md` | We have `weakly-linked` (a flat count) |
| 46 | **Mobile/desktop content parity** — equivalent primary content, matching robots meta, matching titles/descriptions, equivalent structured data, crawlable resources | SPEC | `seo-technical/SKILL.md:108` | Requires two fetches; we already have viewport machinery |
| 47 | **Intrusive interstitials / ad density**; **"read more" deep-link** rule (key content must be visible on load, not behind tabs/accordions) | SPEC | `seo-technical/SKILL.md:109-110` | |
| 48 | **Touch targets ≥48×48px with 8px spacing; base font ≥16px** | SPEC | `seo-technical/SKILL.md:104-105` | We capture pixel widths already |
| 49 | **JS-SEO canonical/noindex conflict rules (Google, Dec 2025)** — if raw-HTML canonical ≠ JS-injected canonical, Google may use *either*; if raw HTML has `noindex` and JS removes it, Google **may still honour the raw noindex**; Google does **not** render JS on non-200 responses | SPEC | `seo-technical/SKILL.md:133-142` | **We fetch both raw and rendered HTML — we can diff them today.** This is the highest-value SPEC item in the table |
| 50 | **Crawl depth / clicks-from-homepage ≤3** | SPEC | `seo-technical/SKILL.md:26` | We have the link graph; we don't compute depth |
| 51 | **Trailing-slash consistency** across the site | SPEC | `seo-technical/SKILL.md:100` | |
| 52 | **HSTS preload-list inclusion** (beyond just the HSTS header) | SPEC | `seo-technical/SKILL.md:92` | Our `security-headers-missing` is coarser |
| 53 | **Mixed-content detection** on HTTPS pages | SPEC | `seo-technical/SKILL.md:85` | |
| 54 | **Tiered image file-size thresholds** — thumbnails <50/100/200 KB · content <100/200/500 KB · hero <200/300/700 KB (target/warning/critical) | SPEC | `seo-images/SKILL.md:43-47` | Requires fetching image bytes; we currently judge format only |
| 55 | **Alt-text length band 10–125 chars** + descriptiveness (filename-as-alt, keyword stuffing, "click here") | SPEC | `quality-gates.md:103-111` | We have `image-missing-alt`/`image-empty-alt`, no quality band |
| 56 | **`srcset`/`sizes` responsive-image presence** and `<picture>` AVIF→WebP→JPEG fallback chain | SPEC | `seo-images/SKILL.md:80-92,62-74` | |
| 57 | **Descriptive image filenames** (`blue-running-shoes.webp` not `IMG_1234.jpg`) | SPEC | `seo-images/SKILL.md:158-161` | |
| 58 | **Image CDN / edge-cache detection** | SPEC | `seo-images/SKILL.md:163-166` | |
| 59 | **IPTC `DigitalSourceType` on AI-generated images** — Merchant Center **requires** `trainedAlgorithmicMedia` for generative product imagery; feeds missing it can be disapproved | **CODE** | `scripts/iptc_ai_label.py`, `seo-images/SKILL.md:309-338` | Policy requirement, not a ranking factor |
| 60 | **Licensable-image signals** — `ImageObject.license` + `acquireLicensePage`, or embedded IPTC licensor metadata | SPEC | `seo-images/SKILL.md:371-375` | |

### 4.2 Tier 2 — needs a new external API

| # | Check | API | Source |
|---|---|---|---|
| 61 | **LCP subpart decomposition** — TTFB / resource-load-delay / resource-load-duration / element-render-delay at p75, flag any subpart ≥40% of total LCP, with a targeted recommendation per dominant subpart | CrUX (free, key required) | `scripts/lcp_subparts.py` (212 lines) |
| 62 | **Full Lighthouse audit anonymously** — 4 category scores, `opportunities` ranked by `overallSavingsMs`, 15 diagnostics, failing SEO/a11y audits, top-5 offending resources per audit | **PSI v5 — no key needed** | `scripts/pagespeed_check.py:134` |
| 63 | **Real field CWV** (LCP/INP/CLS p75, good/NI/poor distribution, 25-week history) | CrUX | `crux_history.py`, `pagespeed_check.py` |
| 64 | **Site-wide Lighthouse** across 200 routes, local and free | Unlighthouse (npx, MIT) | `scripts/unlighthouse_run.py` |
| 65 | **Real indexation status per URL** (Google-selected vs user-declared canonical, coverage state, rich-result validity) | GSC URL Inspection (2,000/day/site) | `scripts/gsc_inspect.py` |
| 66 | **Domain heritage / expired-domain-abuse risk** | WHOIS (free, stdlib TCP/43 fallback) | `scripts/domain_history.py` |
| 67 | **Lighthouse `agentic-browsing` category** — fractional pass-ratio (X of N), **not** exposed by the PSI REST API; CLI `--only-categories=agentic-browsing` only | Lighthouse CLI 13.3.0+, Chrome 150+ | `references/agent-friendly-pages.md:105-129` |

### 4.3 Where our extraction is already deeper [V]

Their entire HTML extractor is `parse_html.py` (273 lines). It extracts title, meta description,
meta robots, canonical, h1/h2/h3 (**h4–h6 not captured at all**), images, links, JSON-LD
(**microdata and RDFa are named in the skill but never parsed**), OG, Twitter, hreflang, word count.

It does **not** extract, and has no code anywhere for: head-boundary detection, charset resolution,
`<base href>`, favicon resolution, document structure (paragraphs/lists/tables/landmarks), fonts /
third-party font origins, contacts, videos, pixel widths, text ratio, response times, or
OG/Twitter ordering. Confirmed by repo-wide grep: `parse5`, `head boundary`, `pixel`, `text ratio`,
`561`, `985` → **zero hits in `scripts/`**.

---

## 5. Whole categories we lack — and how much of each is real

| Category | Real computation? | What it actually is |
|---|---|---|
| **Drift detection** | ✅ **100% deterministic, no LLM** | SQLite + 17 coded rules. The single best thing in the repo |
| **Reporting (PDF/Excel)** | ✅ **100% deterministic** | 2,707-line weasyprint + matplotlib + openpyxl engine |
| **E-E-A-T** | ⚠️ **Partial** | 3 real regex/statistics scripts; the E-E-A-T *score* is an LLM rubric |
| **Backlinks** | ⚠️ **Partial** | Verification crawler + report-validator are real; scoring is an LLM rubric |
| **E-commerce** | ⚠️ **Partial** | `schema_ecommerce_validate.py` + `ucp_check.py` real; marketplace intel is paid API |
| **GEO / AEO** | ❌ **Prompt** | 314-line SKILL.md, zero scripts. `agent_ux_check.py` is adjacent, not GEO scoring |
| **Semantic clustering** | ❌ **Prompt** | No embeddings, no set math, no vector store. Claude counts overlapping URLs by hand |
| **SXO** | ❌ **Prompt** | Zero computation, but the best-*designed* prompt in the repo |
| **Local + Maps** | ❌ **Prompt** | Geo-grid is a formula in markdown. No geocoder, no grid generator, no Maps client |
| **Programmatic SEO** | ❌ **Prompt** | One 178-line markdown file |
| **Content briefs** | ❌ **Prompt** | Zero scripts |
| **Planning** | ❌ **Prompt** | ~28 KB of markdown boilerplate. Lowest-value item in the repo |

### 5.1 The four that matter to us

**Drift detection** (`scripts/drift_baseline.py`, `drift_compare.py`) — the closest thing to our
crawl-over-crawl diffing, and **it is strictly single-URL**. `parser.add_argument("url", ...)`,
one positional, no `nargs`. No site-wide diff, no "pages appeared/disappeared", no link-graph
delta. Storage: `~/.cache/claude-seo/drift/baselines.db`, SQLite WAL, two tables
(`baselines` 17 cols, `comparisons` with severity counts).
URL normalisation worth copying verbatim (`drift_baseline.py:46-84`): lowercase scheme+host, strip
default ports, sort query params, drop the 5 UTM params, `path.rstrip("/") or "/"`,
`url_hash = sha256(normalized)[:16]`.

The **17 rules with exact thresholds** (`drift_compare.py:145-418`) — this is the asset:

| Sev | Rule | Trigger |
|---|---|---|
| CRIT | `schema_removed` | old>0, new==0. **Auto-downgrades to WARNING if every removed type ∈ {FAQPage, HowTo, Dataset}** |
| CRIT | `canonical_changed` / `canonical_removed` | both non-null and differ / had value now null |
| CRIT | `noindex_added` | `"noindex" not in old.lower() and "noindex" in new.lower()` |
| CRIT | `h1_removed` / `h1_changed` | list emptied / **`difflib.SequenceMatcher(None, old, new).ratio() < 0.5`** |
| CRIT | `title_removed` | had value, now empty |
| CRIT | `status_code_error` | `200 <= old < 400 and new >= 400` |
| WARN | `title_changed` / `meta_description_changed` | `.strip()` differ |
| WARN | `cwv_regressed` | **`(new-old)/old > 0.20`** on p75 LCP/INP/CLS; p75 lookup falls back `url_{metric}` → `origin_{metric}` → `{metric}` |
| WARN | `perf_score_dropped` | **`old − new >= 10`** Lighthouse points |
| WARN | `og_tags_removed` / `schema_modified` | all OG gone / `schema_hash` differs |
| INFO | `schema_added` / `h2_structure_changed` / `content_hash_changed` | 0→N / list inequality / full-HTML SHA-256 differs |

Output shape worth copying: **every rule always emits a finding**, split into
`triggered_findings` / `untriggered_findings` — so passed checks are reportable, not silent.

**Reporting** (`scripts/google_report.py`, 2,707 lines) — matplotlib charts (`Agg`) + weasyprint
PDF + openpyxl XLSX, every import guarded so it degrades instead of crashing. 4 report types
(`cwv-audit`, `gsc-performance`, `indexation`, `full`). Two patterns worth stealing outright:
- **`_review_pdf` self-QA gate** — after rendering, checks page count, empty `<img src="">`,
  any `div.section` whose stripped text is <50 chars, duplicate `<table>` blocks. Docstring:
  *"RULE: Always review the PDF before presenting to the user."*
- **XLSX conventions** — `auto_filter.ref`, `freeze_panes="A2"`, 500-row cap, auto column width
  `min(max_len+4, 60)`.
- Executive-summary logic: **Quick Wins = GSC queries at positions 4–10 with high impressions**
  + top-3 PSI opportunities as `"{title}: save ~{savings_ms}ms"`, capped at 5.

**Semantic clustering** — the methodology is good and trivially implementable; they just didn't.
`skills/seo-cluster/references/serp-overlap-methodology.md:29-34`:
`overlap_score = |top10(A) ∩ top10(B)|` → **7–10 = same page (merge) · 4–6 = same cluster ·
2–3 = interlink · 0–1 = separate**. Anti-pattern #5 is a real algorithmic instruction nobody
implemented: *"filter out ubiquitous domains (top 5 most common) before scoring"* — i.e. IDF
down-weighting. Architecture constants: pillar 2,500–4,000 words, spokes 1,200–1,800, every post
≥3 incoming internal links, reachable from pillar in ≤2 clicks, **"no single anchor text for more
than 40% of links to a page."**

**GEO/AEO** — a prompt, but with unusually well-sourced numbers and one genuinely valuable
epistemic asset. `skills/seo-geo/references/llmstxt-evidence.md` **kills the llms.txt hype with
evidence**: Google's docs (2026-06-29) say *"Google Search ignores them"*; SE Ranking's 300k-domain
study found that among the 50 most AI-cited domains **only one had `/llms.txt`**; OtterlyAI server
logs show **0.1% of AI-bot traffic targets `/llms.txt` (84 of 62,100 requests)**. Policy: report
presence, **assign zero citation-ranking weight**. That is exactly the posture we should adopt.
Citable constants: optimal citable passage **134–167 words**; **~44% of AI citations come from the
first 30% of a page**; content <3 months old ~3× more likely to be cited; brand mentions correlate
~3× more strongly with AI visibility than backlinks (YouTube mentions r≈0.737 vs Domain Rating
r≈0.266); AI Mode and AI Overviews cite the **same URLs only 13.7%** of the time.

---

## 6. What WE do that it does NOT

Verified by repo-wide grep across `scripts/`, `skills/`, `agents/`, `hooks/`, `schema/`:
`minhash`, `simhash`, `shingle`, `parse5`, `head boundary`, `head-boundary`, `levenshtein`,
`tfidf`, `tf-idf`, `embedding`, `cosine`, `internal link graph`, `pixel`, `text ratio`, `561`,
`985` → **zero hits.** (`pagerank` appears only in the *external* backlink context — Common
Crawl's precomputed domain rank — never as an internal site link-graph computation.)

| Capability | Us | claude-seo |
|---|---|---|
| **A real crawler** (frontier, dedup, concurrency, robots-aware scheduling, per-host rate limiting) | ✅ Crawlee | ❌ **None.** Claude fetches URLs one at a time in-context; multi-page discovery is delegated to paid Firecrawl |
| **Near-duplicate detection** (MinHash/LSH, Jaccard) | ✅ `near-duplicate-content`, `similarity.ts` | ❌ Nothing. The term appears in 4 markdown files as advice; zero implementation |
| **Internal PageRank** on the site's own link graph | ✅ | ❌ Only external domain PageRank looked up from Common Crawl |
| **Orphan / weakly-linked detection** from a real crawl graph | ✅ `orphan-page`, `weakly-linked` | ❌ Named as a target in cluster docs; no graph, so uncomputable |
| **Head-boundary detection (parse5)** | ✅ | ❌ No concept of it |
| **Pixel-width measurement** for title/description | ✅ 561px / 985px, Screaming-Frog-aligned | ❌ Character counts only |
| **Text ratio** | ✅ `low-text-ratio` | ❌ |
| **Crawl-over-crawl diffing at site scope** | ✅ | ⚠️ Per-URL only (see §5.1) |
| **Evidence pointers into stored records** | ✅ every issue | ❌ Findings are `{title, severity, description, recommendation}` free text |
| **Rule IDs + threshold strings on every issue** | ✅ 51 IDs, one config | ❌ No IDs; thresholds live in prose and **contradict each other** (§2.4) |
| **Determinism** | ✅ Same crawl → same issues | ❌ Same page → whatever Claude says this time |
| **Single source of truth for thresholds** | ✅ `analysis.config.json` | ❌ e.g. the deprecated-schema-type list exists in **three places with different contents**: `hooks/validate-schema.py::deprecated` (7 entries, incl. `HowTo`/`CourseInfo`), `schema_ecommerce_validate.py::_DEPRECATED_TYPES` (7 entries, incl. `Vehicle`/`Course`, **excl. `HowTo`**), `drift_compare.py::_RETIRED_OR_UNSUPPORTED_SCHEMA_TYPES` (3 entries). `CWV_THRESHOLDS` is copy-pasted verbatim into two files |
| **Charset resolution / `<base href>` / favicon probing / document structure / fonts + GDPR third-party origin / videos / contacts / OG-Twitter ordering / response times / h4–h6** | ✅ | ❌ None extracted |
| **Auth'd crawling** (basic/cookie/form-login) | ✅ | ❌ `seo-page/SKILL.md:93` tells the user to paste the HTML in manually |
| **Safety denylist** | ✅ | ⚠️ Different concern — they have excellent **SSRF/DNS-rebinding** hardening we should look at (`url_safety.py`, 597 lines of tests) |
| **Check-weighted health score from computed checks** | ✅ | ⚠️ Weights exist (Technical 22% / Content 23% / On-Page 20% / Schema 10% / CWV 10% / AI 10% / Images 5%) but the per-category scores feeding them are LLM guesses |

**One correction to note:** `scripts/consistency_check.py` is **not** a NAP-consistency checker —
it is a repository linter (dead reference links, orphan scripts, routing-table drift, lockfile
integrity). Its docstring line 1: *"Repository consistency checker: dead references, orphans,
routing, lock integrity."* **There is no NAP consistency code anywhere in the repo.**

**Also note:** `skills/seo-page/SKILL.md:33` and `seo-content/SKILL.md` promise "Flesch Reading
Ease score" — but `content_quality.py` contains **no readability formula at all**: no Flesch, no
Gunning-Fog, no syllable counting. The skill promises a metric the code does not compute, because
the *skill* expects Claude to estimate it. Perfect miniature of the whole architecture.

---

## 7. MIT-reusable assets (with attribution)

License is **MIT** (`LICENSE`, © 2026 agricidaniel) for everything **except `skills/seo-flow/`**,
which is **CC BY 4.0**, synced from `github.com/AgriciDaniel/flow` (`references/bibliography.md:1`).
Keep that boundary. Per-skill `LICENSE.txt` files restate MIT and point at the repo URL — that URL
is the attribution string to use.

### 7.1 Real encoded knowledge — high reuse value

| Asset | File | Why |
|---|---|---|
| **17 drift rules + thresholds** | `scripts/drift_compare.py:145-418` | Directly portable; extend to site scope |
| **`data/google-updates.json`** | 32 dated Google algorithm/product events, `2024-03-05 → 2026-06-30`, `kind` histogram `core:8 product:8 policy:4 spam:4 schema:3 qrg:2 core+spam:1 cwv:1 discover:1`, `unverified: []` | **Enforced provenance**: `tests/test_content_quality.py` asserts every `source` is on a Google-owned domain. Genuinely rare |
| **Deprecated schema types + retirement dates** | `skills/seo-schema/references/deprecated-types-2024-2026.md` | Take *this* file, not the three contradictory code copies. Includes the "Dataset is NOT discontinued" correction |
| **Google merchant required/recommended field lists** | `scripts/schema_ecommerce_validate.py:_REQUIRED_PRODUCT_FIELDS` etc. | The `offers.@type` must be `Offer` not `AggregateOffer` rule alone is worth it |
| **`CWV_THRESHOLDS`** incl. FCP ≤1800/3000 and TTFB ≤800/1800 | `scripts/pagespeed_check.py:51-58` | We cover LCP/INP/CLS; FCP + TTFB bands are additions |
| **Curated Lighthouse audit-ID lists** | `pagespeed_check.py` `lab_audit_ids` (6) + `diagnostic_ids` (15) | Saves picking them ourselves |
| **`_AI_PATTERNS` (46) + `_FILLER_PHRASES` (26) + the weighted formula** | `scripts/content_quality.py` | Deterministic AI-slop detector. Sourced from Wikipedia "AI Cleanup", **CC BY-SA 4.0 — attribute separately** |
| **`_REPLACEMENTS` 49-row phrase→rewrite table** | `scripts/content_humanize.py` | Hand-curated, unique. Directly useful for POC-3 fix drafting |
| **Claim + citation regex corpora** | `scripts/content_verify.py` (11 claim, 5 citation, ±200-char window) | Deterministic E-E-A-T signal |
| **Parasite-SEO pattern corpora + thresholds** | `scripts/parasite_risk.py` | Needs site-wide crawl — plays to our strength |
| **Page-type taxonomy + 8-step tie-break ladder** | `skills/seo-sxo/references/page-type-taxonomy.md:176-187` | Mechanically implementable on our existing DOM parse |
| **Quality gates: word-count + unique-% by page type** | `skills/seo/references/quality-gates.md:5-16` | Upgrade our flat `thinContentWords` |
| **SERP-overlap cluster thresholds** | `seo-cluster/references/serp-overlap-methodology.md:29-34` | If/when we get SERP data |
| **AI crawler table (14 crawlers, obeys-robots boolean)** | `skills/seo-geo/SKILL.md:151-172` | Pure lookup table |
| **GBP 25-field rubric + industry multipliers** | `skills/seo/references/maps-gbp-checklist.md` | If we ever do local |
| **Geo-grid math + SoLV formula** | `skills/seo/references/maps-geo-grid.md:22-30` | `SoLV = points_in_top_3 / total_points × 100` |
| **30 toxic-backlink patterns + industry anchor ratios** | `skills/seo/references/backlink-quality.md` | If we ever do backlinks |
| **`excluded-domains.md`** competitor blocklist | `skills/seo-content-brief/references/` | Drop-in for any SERP-competitor extraction |
| **GSC anomaly window** `2025-05-13 → 2026-04-27` (impressions/CTR/position corrupted, **clicks unaffected, not backfilled**) | `scripts/gsc_query.py` | Saves us shipping a wrong chart |
| **GSC quick-win rule** `4 <= position <= 10 and impressions > 50` | `scripts/gsc_query.py` | |
| **`llmstxt-evidence.md`** | `skills/seo-geo/references/` | Adopt the *posture*: report presence, zero ranking weight |

### 7.2 Real code worth porting

`preload_check.py` (237 ln) · `agent_ux_check.py` (243) · `sitemap_discovery.py` (292) ·
`schema_ecommerce_validate.py` (311) · `parasite_risk.py` (252) · `gbp_deprecation_lint.py` (138) ·
`ucp_check.py` (249) · `content_quality.py` (292) · `content_verify.py` (194) ·
`drift_compare.py` (610) · `google_report.py` (2,707, the reporting layer we don't have) ·
`url_safety.py` (SSRF/DNS-rebinding hardening, 597 lines of tests behind it).

### 7.3 Patterns worth stealing (not code — discipline)

1. **`unverifiable_js` instead of a false negative** (`verify_backlinks.py:211-231`) — before
   declaring something missing, detect an SPA shell or `len(content)>5000 and word_count<50` and
   report *"unverifiable"*. Applies across our whole analyzer.
2. **Refuse to emit a score on insufficient data** (`validate_backlink_report.py`) — *"a numeric
   score with fewer than 4 data sources is misleading"*; `factors_with_data < 4` → print
   `INSUFFICIENT DATA (X/7)` instead of a number.
3. **A meta-validator that lints the report before a human sees it** — six checks including
   "social domain returning 200 but marked link_removed = error" and "Common Crawl absence must
   NOT be read as low authority."
4. **Report untriggered checks, not just triggered ones** (`drift_compare.py`).
5. **Forbidden-phrase tests over your own docs** (`tests/test_schema_v2.py`) — asserts strings
   like `"still aids ai"` and `"valid ai/entity signal"` appear nowhere in the repo. The author
   polices unverifiable SEO claims in his own documentation with CI. We should copy this.
6. **Provenance test on the knowledge base** — every `google-updates.json` source must be a
   Google-owned domain, enforced in CI.
7. **`_review_pdf` self-QA gate** before showing a deliverable.
8. **Allowlist-dispatch sandbox** (`runtime.py`) — basename regex + frozenset allowlist +
   resolved-parent-equality, plus a 4-rule credential `REDACTIONS` table on every log path.

### 7.4 Not worth taking

`skills/seo-plan/` (28 KB of boilerplate) · `pdf/google-seo-reference.md` (self-declared
deprecated and unwired) · `consistency_check.py` (repo linter, not SEO) · every "thin routing card"
extension · the FLOW prompt library (CC BY 4.0, and it's 41 prompt files) · the health-score
weights (they weight LLM guesses).

---

## 8. Blunt verdict

**claude-seo is the best *SEO knowledge base* on GitHub wearing the costume of an SEO tool.**

### Where it is genuinely strong

1. **Domain knowledge currency.** 27 releases in ~6 months. It tracks Google primary sources to
   June 2026 — FAQ rich results retired 2026-05-07, back-button hijacking enforcement 2026-06-15,
   Lighthouse `agentic-browsing` category, LCP subparts in CrUX, the GSC impressions anomaly window.
   Our rulebook has none of this.
2. **Epistemic honesty, enforced in CI.** Anti-hallucination guards ("there is no Visual Stability
   Index, no CWV 2.0"), forbidden-phrase tests, a provenance test on the update log, an explicit
   refusal to score on <4 data sources, and the llms.txt evidence file that argues *against* the
   feature it documents. This is better intellectual discipline than most commercial tools.
3. **Free-data exploitation.** Anonymous PSI (full Lighthouse, no key), Common Crawl streaming,
   IndexNow, Bing Webmaster free tier, Unlighthouse. Real engineering.
4. **Security.** `url_safety.py` DNS-pinning + Playwright route interception against rebinding,
   with 597 lines of tests. Better than ours, probably.
5. **The drift subsystem** — genuinely deterministic, well-thought-out, immediately portable.

### Where it is thin

1. **It cannot crawl.** The headline "crawls up to 500 pages" is a sentence in a prompt. No
   frontier, no concurrency, no state. Its own README concedes Screaming Frog's territory.
2. **48% of its skills run no code.** `seo-page` — the flagship single-page analyser — is a
   94-line checklist. `seo-hreflang` is 272 lines of validation rules with no validator.
3. **Non-determinism is total.** Run it twice on one page, get two different issue lists and two
   different scores. There is no rule ID, no evidence pointer, no threshold string on any finding.
4. **Its thresholds contradict each other** (three title minimums; three different deprecated-type
   lists; `CWV_THRESHOLDS` copy-pasted). Unavoidable when rules are prose.
5. **15 of 57 scripts are orphaned** — including `preload_check.py`, the best deterministic
   technical check in the repo, wired to nothing.
6. **Tests measure the wrong thing.** 250 tests, and the heaviest suites are SSRF safety and
   repo-manifest consistency. Very little tests SEO analysis correctness — because there is very
   little SEO analysis code to test.
7. **Two extensions are vapour** (`profound`, `seranking` — no consuming code), and the flagship
   "free backlink data" is PageRank, not backlinks.

### The actual weakness

**It has no memory and no ground truth.** Everything except drift is stateless and per-URL. Without
a crawl store it cannot compute anything that requires the site as a whole — no near-duplicate
clusters, no orphan detection, no internal PageRank, no link-graph delta, no site-scope
parasite-SEO analysis (despite shipping the scorer). And because findings carry no evidence
pointers, **you cannot audit its output** — you have to trust that Claude read the page correctly.
That is precisely the failure mode our D-08 decision was made to avoid, and this repo is the
14k-star proof of what the alternative looks like at scale.

**Strategically:** it is not a competitor to our crawler+analyzer. It is a competitor to our
*POC-3 fix-drafting layer*, and it is the reference implementation for the knowledge we should be
encoding into rules. We should treat it as a **knowledge donor, not an architecture model.**

### Ranked: what we should adopt

| # | Action | Effort | Payoff |
|---|---|---|---|
| 1 | **Port `preload_check.py`** → Speculation Rules, bfcache killers, deprecated `rel=prerender`, LCP `fetchpriority` (§4.1 #1-4) | S | 4 new deterministic rules, zero new deps |
| 2 | **Add the lazy-loader classifier** (`native\|perfmatters\|ewww\|js-generic\|none`) + the "don't lazy-load the LCP image" rule | S | Kills a false-positive class and adds a real rule |
| 3 | **Diff raw vs rendered HTML** for canonical/noindex/schema conflicts (§4.1 #49) — we already fetch both | S | Highest-value new rule in the whole list |
| 4 | **Bolt `agent_ux_check.py` onto our existing Playwright pass** — a11y-tree snapshot + deduction ladder + console-error capture | M | An entire new rule family, GEO-relevant, deterministic |
| 5 | **Adopt the 17 drift rules + thresholds** into our crawl-over-crawl diffing, then do what they couldn't: site-scope it (URL set delta, orphan emergence, link-graph delta) | M | Turns our diffing into a severity-classified product |
| 6 | **Harden hreflang** — x-default, ISO 639-1/3166-1 validation, non-canonical hreflang, protocol/trailing-slash consistency (§4.1 #32-37) | M | 6 rules; they specify them precisely and implement none |
| 7 | **Extend sitemap rules** — lastmod credibility, 50 MB cap, priority/changefreq Info, news 1,000/2-day, image/video subtypes, "declared but broken ≠ found" | M | 7 rules |
| 8 | **Page-type classifier + per-type thin-content and internal-link thresholds** (§4.1 #43-45) | M | Replaces one flat threshold with a real model |
| 9 | **Import the knowledge tables** — deprecated schema types, `google-updates.json`, AI-crawler table, CWV FCP/TTFB bands, quality gates | S | Currency we simply don't have |
| 10 | **Adopt the four discipline patterns** — `unverifiable_js` guard, refuse-to-score-on-thin-data, report untriggered checks, forbidden-phrase CI tests over our own docs | S | Directly reinforces D-08 |
| 11 | **Port `schema_ecommerce_validate.py` + `parasite_risk.py` + `gbp_deprecation_lint.py`** as-is | M | Three self-contained rule engines in our exact style |
| 12 | **Steal the reporting layer** (`google_report.py`: weasyprint PDF + openpyxl XLSX + `_review_pdf` self-QA) when we need client deliverables | L | We have no reporting at all |
| 13 | **Add anonymous PSI** (`pagespeed_check.py:134` — no key needed) for real Lighthouse + field CWV | M | Closes our biggest data gap for free |

**Attribution string for anything adopted:**
`Adapted from claude-seo (https://github.com/AgriciDaniel/claude-seo), MIT © 2026 agricidaniel.`
Add `Wikipedia "AI Cleanup" catalogue, CC BY-SA 4.0` if the `_AI_PATTERNS` list is used, and do
**not** take from `skills/seo-flow/` (CC BY 4.0).

