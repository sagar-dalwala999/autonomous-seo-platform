# Technology Comparison

Document 04 of 07 · Autonomous SEO Optimization Platform · Planning Package

---

## Executive summary

This document answers the problem statement's Section 20 mandate (NFR-7): no technology is
selected without comparing 2-3+ researched alternatives, and every recommendation carries a
reason. It covers 24 component decisions, from the runtime to the rollback platform, each with a
comparison table and a justification grounded in verified August 2026 pricing, quotas, and
benchmarks. All load-bearing external facts carry numbered citations resolved in the Sources
section; the few figures that are modelled rather than vendor-published are labelled as such
where they appear.

The selections form one coherent stack rather than 24 independent picks. Four cross-cutting
principles drove them:

1. **One runtime, with one named exception.** Node.js/TypeScript for every service in the
   request path and the change pipeline: crawler (Crawlee), workers (BullMQ), orchestration
   (Temporal TypeScript SDK), API (NestJS on Fastify), frontend (Next.js), codemods (ts-morph).
   The exception is the batch analysis worker: the recommended graph library (`rustworkx`, or
   igraph) ships Python/C bindings and has no Node package, and the open-source NER fallback
   (GLiNER) is a PyTorch model, so link-graph scoring and optional entity extraction run in one
   small Python worker. That is a deliberate, bounded polyglot boundary — one extra container
   image, one extra dependency set, no second customer-facing service, no second team — and
   Section 3.0 prices it and names the JS-native alternative that would remove it.
2. **One system of record.** PostgreSQL 16+ with pgvector holds pages, link edges, keywords, GSC
   facts, embeddings, and the change ledger. The Platform's hardest queries (cannibalization,
   "weakly linked but high-potential" pages, link-target suggestion) join relational facts, graph
   scores, and vector similarity in a single SQL statement; every alternative (MongoDB,
   Elasticsearch, a graph database, a dedicated vector store) fails at least one required
   capability or duplicates data into a second system to accelerate work an in-process library
   already does in seconds.
3. **Reliability is bought, not built.** The autonomous daily loop needs durable 14-60-day
   monitoring timers, mid-workflow human approval gates, and per-tenant fairness. Inngest and
   Hatchet genuinely cover the timer and approval primitives as well [41][46]; what makes Temporal
   the pick is that it is the only evaluated engine with first-class per-tenant fairness keys
   [35], and the only pricing model — roughly $0.00005 per action, with a sleeping workflow
   costing effectively nothing — that survives this product's shape: daily fan-out across every
   tenant plus thousands of concurrently sleeping 14-60-day monitors. The lighter engines bill per
   execution or per compute-second, which is billing aimed squarely at this load profile
   [40][42]. Its replayable event history is the second differentiator, because it doubles as the
   per-site audit trail NFR-3 requires. Hand-building the three primitives on cron + queues
   reconstructs a workflow engine without its test coverage.
4. **Cost strategies are architecture.** Static-first crawling (about 10x cheaper per page than
   browser rendering), model tiering with batch pricing (a full 10,000-page metadata pass costs
   roughly $27.50-82.50 in generation spend — the bracket runs from bulk-tier-only to
   judgment-tier-only routing — or ~$33-88 all-in once selective Opus judging is included, with
   repo code patches costed on top, Section 3.9), and
   pay-as-you-go data vendors (DataForSEO at $0.60/1k SERPs) are selection criteria, not
   afterthoughts, because NFR-2 and NFR-6 require the Platform to scale from 100 to 100,000+
   pages with bounded cost. Section 5 consolidates the three mandated tiers.

Where the problem statement posed a binary ("Playwright vs Crawlee", "MongoDB vs PostgreSQL"),
the comparison answers the binary and, where the research shows the binary is misframed, says so:
Crawlee wraps Playwright, so the real crawler decision is the rendering strategy; the real search
decision is when a second engine is warranted at all.

---

## 1. Method and evaluation criteria

Each component was researched in a dedicated lane (crawling, data model, orchestration, AI
optimization, keyword/GSC, competitor analysis, platform architecture, cost/security) against
current vendor documentation and pricing pages, dated August 2026. Selections were scored on:

| Criterion | Traces to |
|---|---|
| Functional fit against the requirement IDs of Doc 01 | FR-1 through FR-16 |
| Cost at MVP with an explicit scale trigger named per component; the three mandated tiers (100 / 10,000 / 100,000+ pages) are consolidated in Section 5 and modelled line-by-line in Doc 06 | NFR-2, NFR-6 |
| Reliability of the autonomous loop (durability, retries, recovery) | FR-15.2, NFR-1 |
| Security and tenant isolation posture | NFR-5 |
| Operational burden for a small team; explicit scale-up triggers | NFR-2 |
| Explainability and auditability of system behavior | NFR-3 |

Prices and quotas are list figures verified against the cited sources on the research date;
several vendors (Firecrawl, Anthropic intro pricing, Clerk) changed pricing within the last
year, so all figures should be re-verified at contract time.

---

## 2. Selection summary (Section 20 spine)

One row per component, in the problem statement's requested format. Each row expands into a
detailed comparison in Section 3.

| Requirement | Option 1 | Option 2 | Option 3 / others | Recommended | Reason |
|---|---|---|---|---|---|
| Runtime / language platform | Node.js 22 LTS + TypeScript | Python 3.12 (Scrapy-centric) | Go; deliberate polyglot split (Node edge + Python analytics) | **Node/TypeScript everywhere except one batch analysis worker in Python** | The product's dominant artifact is a TypeScript AST codemod against customers' Next.js repos, so the change pipeline must be Node [101][107]; Scrapy's ~4x static-throughput edge [102] does not pay for a second runtime in the crawl path, but the graph and NER libraries have no Node equivalent, so the split is drawn at the batch worker and nowhere else [31][32][73] |
| Crawler framework | Crawlee (TypeScript) | Playwright / Puppeteer (raw) | fetch+Cheerio (DIY); Firecrawl / Apify (managed) | **Crawlee** | Only option shipping frontier, dedup, robots.txt, sitemaps, autoscaling, and HTTP-to-browser switching in one MIT package in the Platform's language; managed per-page economics fail at 100k-page recrawl scale [6][7] |
| Rendering strategy | Static-first hybrid, auto-escalation | Always-render (browser every page) | Never-render (static only) | **Static-first hybrid** | Browser crawling costs ~10x per page [1]; rendering differences cluster by template (96% of domains, 56% of URLs) [9], so per-template escalation loses no SEO signal |
| Work queue | BullMQ (Redis protocol) | RabbitMQ | Amazon SQS | **BullMQ** | Delays, priorities, rate limits, repeatable jobs natively on infrastructure already present; RabbitMQ is a second broker without a needed capability; SQS caps delayed delivery at 15 minutes [12] |
| Primary database | PostgreSQL 16+ (with pgvector) | MongoDB Atlas (document-first) | Polyglot specialist stack (Postgres + Elasticsearch + graph DB + vector DB); Postgres + MongoDB hybrid (documents for crawl payloads, Postgres for facts) | **PostgreSQL** | The workload is joins across crawl, GSC, and link data; MongoDB's `$graphLookup` has a 100 MB no-spill stage limit, the worst fit for a link graph [16]; the polyglot stack buys capability the MVP does not use and pays for it in sync pipelines and lost joins; the hybrid adds a second store to hold JSONB that Postgres already holds; one engine covers relational + JSONB + FTS + vectors |
| Search / analytics engine | Postgres FTS (pg_search upgrade path) | OpenSearch | Elasticsearch | **Postgres FTS now; OpenSearch only at 100M+-row analytics** | Mention-search is covered in-database (BM25 via pg_search at ~20x `ts_rank` speed) [21]; a second cluster costs $60-350/mo and its joins disappear [24]; if ever added, OpenSearch's Apache-2.0 license beats Elastic's triple license for a SaaS [23] |
| Vector store | pgvector (halfvec + HNSW) | Qdrant | Pinecone | **pgvector** | MVP volume is 10^4-10^5 vectors per site, 2-3 orders below pgvector's ~10M comfort zone [25]; filtered similarity ("similar AND indexable AND same type") is one SQL query instead of a cross-database join |
| Graph analytics | In-process rustworkx / igraph (Python worker) | Neo4j (AuraDB) | Memgraph; graphology (JS-native, in-process) | **In-process rustworkx in a Python post-crawl analysis worker** | PageRank on a graph 50x larger than a 100k-page site takes 10.6 s in igraph [31]; a graph database adds a sync pipeline and $65/GB/mo or $25k/yr [33] to replace a nightly batch job. The cost is honest: rustworkx and igraph have no Node bindings, so this one worker is the stack's only non-Node service (Section 3.0); graphology is the JS-native fallback if that boundary is refused |
| Object storage | Cloudflare R2 | AWS S3 Standard | Backblaze B2; self-hosted MinIO | **Cloudflare R2 (S3-compatible API)** | Workers re-read stored HTML constantly for diffing and evidence, so egress is the dominant term: R2 is $0.015/GB-mo with zero egress vs S3's ~$0.023/GB-mo + ~$0.09/GB egress [103][104]; the S3-compatible API keeps MinIO or S3 as a drop-in for on-prem or AWS-native mandates |
| Workflow / orchestration | Temporal (Cloud, TypeScript SDK) | Inngest / Trigger.dev / Hatchet | cron+BullMQ / AWS Step Functions / LLM-agent frameworks | **Temporal** | Inngest and Hatchet also cover durable long timers and approval gates [41][46]; Temporal is the only engine with first-class per-tenant fairness keys [35], and the only pricing model (~$0.00005/action, sleeping workflows near-free) that survives this product's daily fan-out plus thousands of concurrent 14-60-day monitors — the alternatives bill per execution or per compute-second, aimed at exactly this profile [40][42]; the replayable event history is the audit trail NFR-3 needs [37] |
| AI provider + models | Anthropic (Haiku 4.5 / Sonnet 5 / Opus 5) | OpenAI (gpt-5-mini / gpt-5.6-terra) | Google (Gemini Flash-Lite / 3.6 Flash) | **Anthropic-first tiering behind a thin multi-provider adapter** | All three now meet the bar on structured outputs and 50% batch discounts [50][54][56]; the tiered cascade prices a full 10k-page metadata pass at ~$27.50-82.50 generation-only, ~$33-88 all-in with selective Opus judging; the adapter preserves fallback and price leverage |
| Embeddings | OpenAI text-embedding-3-small | text-embedding-3-large | Google text-embedding-005 / Cohere / Voyage / self-hosted SBERT | **text-embedding-3-small** | $0.02/M tokens = ~$0.30 per 10k pages; near-par retrieval quality at 6.5x less than 3-large; 1536 dims fit pgvector `halfvec` + HNSW [53][58] |
| SERP / keyword data vendor | DataForSEO | Serper | SerpApi / Semrush API / Ahrefs API | **DataForSEO primary + Serper secondary, behind a mandatory `SerpProvider` abstraction** | Cheapest verified full surface ($0.60/1k SERPs, ~$0.06/1k keyword volumes) [60][61]; SerpApi is a defendant in active Google and Reddit litigation [69][70]; Semrush caps data caching at 1 month and Ahrefs unit math is hostile at scale [65][66] |
| Entity extraction | Cheap-LLM structured pass | Google Cloud NL API | GLiNER (open source) | **Cheap-LLM, GLiNER fallback** | ~$0.002/page returns entities + topics + questions + claims in one pass; NL API charges ~7-30x for entities alone and v2 dropped salience [71][72]; GLiNER is the CPU-viable deterministic baseline, hosted in the same Python analysis worker as the graph library [73] |
| Code-modification engine | ts-morph (TypeScript compiler API) | jscodeshift (recast) | Babel transform only; free-form LLM diffs | **ts-morph codemods executing LLM-supplied values; LLM search/replace blocks only where no codemod can express the change** | LLM-written codemods are correct ~45% one-shot and only ~54% after four refinement rounds [105], so the LLM must never author syntax; ts-morph adds type information (a `Metadata` export can be verified to type-check) over jscodeshift's style-preserving print [106][107]; whole-file LLM rewrite risks silent content loss and is never used [108] |
| Validation toolchain | Nu HTML Checker (v.Nu) + self-built JSON-LD validator + Lighthouse CI + lychee, all on a rendered preview | html-validate (in-process JS) + raw PageSpeed Insights + crawler-based link check | Google Rich Results Test; Google schemarama | **v.Nu + in-house schema validator + Lighthouse CI + lychee, asserted against a per-page-class baseline** | v.Nu is the conformance reference behind validator.w3.org and self-hostable [109]; Rich Results Test has no public API and schemarama was archived Oct 22 2025, so structured-data validation must be self-built [110][111]; Lighthouse CI gives assertion config, budgets and `median-run` variance damping that raw PSI does not [112]; lychee checks anchor fragments, which crawler-based checkers miss [113] |
| Repo integration + preview deploy / rollback | GitHub App + Vercel preview deploys + Instant Rollback | OAuth App / fine-grained PAT + Netlify Deploy Previews + deploy restore | Self-hosted preview stage; git revert only | **GitHub App (1-hour down-scoped installation tokens) + Vercel/Netlify preview deploys, two-speed rollback** | Fine-grained PATs cannot call the Checks API and cap at 50 tokens per account, disqualifying for SaaS [114]; per-installation rate buckets isolate tenants [115]; preview deploys make the validation target a real rendered build [116][117]; platform instant rollback bounds harm in seconds while a `revertPullRequest` PR makes reversal durable and auditable [118][119] |
| Tenancy model | Pooled Postgres, `project_id` + row-level security | Schema-per-tenant | Database/stack-per-tenant (silo) | **Pooled + RLS** | Only model consistent with the single-Postgres system of record; RLS turns tenant isolation from a convention into a database constraint [120]; schema-per-tenant multiplies every migration by the tenant count, silo is fleet management — both reserved for a regulated anchor tenant |
| Frontend framework | Next.js 16 (App Router) | React Router v8 | TanStack Start | **Next.js 16, self-hosted Docker** | Only option combining an LTS line + formal CVE process [75] with full-featured self-hosting [76]; TanStack Start is still Release Candidate [78] |
| API framework | NestJS 11 on the Fastify adapter | Hono | Express / plain Fastify | **NestJS 11 + Fastify** | Guards/DI give tenancy and RBAC one enforced seam; the Fastify adapter removes the Express performance tax (~30k req/s class) [79][80]; OpenAPI generation is first-party |
| Platform auth | Clerk | Auth0 | WorkOS / Better Auth / Keycloak | **Clerk** | Free to 50,000 users, $25/mo Pro; Organizations map 1:1 onto agency-client structure; $75/mo per SAML connection is the cheapest managed enterprise SSO [82][84][85]; Better Auth is the documented exit path [86] |
| Cache / Redis-protocol store | Valkey 9 | Redis 8 | Dragonfly / Upstash | **Valkey 9** | BSD-3 under the Linux Foundation; 20-33% cheaper managed than Redis OSS on ElastiCache [89]; Redis-7.2 lineage satisfies BullMQ's >=6.2 requirement [91] |
| Observability | OTel -> Grafana Cloud + Sentry | Self-hosted LGTM stack (Prometheus/Loki/Tempo/Grafana) | CloudWatch (AWS-native) | **Grafana Cloud free tier + Sentry Team + Temporal Web UI** | ~$26/mo total at MVP [94][95]; OpenTelemetry instrumentation is portable to the self-hosted stack at scale; Temporal's event history is a free per-site audit trail [96] |
| Secret management | KMS envelope encryption (per-tenant data keys) | AWS Secrets Manager (per-tenant) | HashiCorp Vault (self-hosted) | **KMS envelope for customer tokens; Secrets Manager for ~20 platform secrets** | ~$1-5/mo vs ~$1,200/mo at 1,000 tenants in Secrets Manager [97][98]; every key use is CloudTrail-logged [99]; Vault's ops burden is unjustified at MVP scale |

---

## 3. Detailed comparisons

### 3.0 Runtime and language platform

Traces to FR-9.1, FR-10.1, FR-16.1, NFR-2. This decision is listed first because it silently
constrains six later ones (crawler, codemod engine, API, frontend, graph library, NER model), and
because the Platform cannot honestly claim "one runtime" without pricing the one place it breaks.

| Criterion | Node.js 22 LTS + TypeScript | Python 3.12 | Go | Deliberate split (Node pipeline + Python batch worker) |
|---|---|---|---|---|
| Generating changes to customers' Next.js/React repos (FR-9.1, the highest-value path) | Native: ts-morph and jscodeshift are the TypeScript AST toolchain, and the Platform shares types with the code it edits [106][107] | Would drive a Node toolchain as a subprocess, or hand-roll TS parsing | Same subprocess problem | Native (the codemod stays in Node) |
| Crawling throughput | Crawlee: full framework, HTTP + browser in one API [3] | Scrapy is the most mature static crawler, benchmarked ~4x faster than requests+BeautifulSoup, but JS rendering is a bolt-on (`scrapy-playwright`) [102] | Fast, thin ecosystem for SEO field extraction | Node (Crawlee) |
| Link-graph analytics | No maintained library at igraph/rustworkx performance class; graphology exists but the benchmarks in [31][32] are Python/Rust-ecosystem measurements and do not cover it | `rustworkx` (Rust core, Python bindings) and igraph (C core, Python/R bindings) — the measured options [31][32] | No | Python worker |
| Open-source NER fallback (GLiNER) | No maintained Node runtime | Native (PyTorch) [73] | No | Python worker |
| Team and hiring | One language across API, frontend, workers, codemods | One language, but the frontend is React regardless | Third language in practice | Two languages, one of them confined to a batch container |
| Ops surface | One image family, one dependency manager | One image family | One | Two images, two dependency manifests, one shared Postgres and object store |

**Selected: Node.js/TypeScript for the entire request path and change pipeline, with a single
Python batch worker for graph scoring and optional NER.** The deciding requirement is FR-9.1: the
product's most valuable and most dangerous artifact is an AST transformation of a customer's
TypeScript repository, and the toolchain that does that safely (ts-morph, with the TypeScript
compiler's own type information) is Node-only [106][107]. Scrapy's static-throughput advantage is
real [102] but buys speed in the one part of the pipeline that is already cheap (under $2 of
compute per 100k static pages, Section 3.1) at the price of splitting the crawl path from the
change path. The reverse is also true and is the honest half of this section: `rustworkx` ships
Python bindings from the Qiskit project and igraph's maintained bindings are C, Python and R, so
neither is importable from a Node worker, and GLiNER is a PyTorch model. **Cost of the exception:
one additional container image, one `pyproject.toml`, and a second language in CI.** It is
bounded deliberately — the Python worker owns no HTTP surface, no customer credentials, and no
schema ownership; it reads the `pages`/`links` tables after a crawl, writes score columns back,
and exits. If a client rejects any polyglot deployment, the documented alternative is graphology
in the Node analysis worker, accepted only behind a POC benchmark gate on a real 100k-page,
~10M-edge graph, because the performance evidence in [31][32] does not transfer to it.

### 3.1 Crawler framework

Traces to FR-1.1 through FR-1.7, NFR-2, NFR-6.

The problem statement asks "Playwright vs Crawlee." The research finding is that this is a false
dichotomy: Playwright is a browser automation engine with no frontier, no dedup, no politeness,
and no robots.txt handling; Crawlee is a crawler framework that uses Playwright as one of its
engines. The real comparison is framework vs raw engine vs DIY vs managed service.

| Requirement | Crawlee (TS) | Playwright (raw) | Puppeteer (raw) | fetch + Cheerio (DIY) | Firecrawl / Apify (managed) |
|---|---|---|---|---|---|
| Frontier, dedup, retries, politeness | Built in (`uniqueKey`, autoscaling 1-200) [3] | None | None | Build everything | Managed |
| robots.txt + sitemap discovery | `respectRobotsTxtFile`, `Sitemap` utilities [5] | No | No | Build | Managed |
| HTTP and browser crawling in one API | Yes: Cheerio / Playwright / Adaptive crawlers [3] | Browser only | Browser only (Chrome-centric) | HTTP only | Yes (opaque) |
| Distributed story | `RequestQueueV2` request locking, multi-process shared frontier [4] | DIY | DIY | DIY | Managed |
| Cost per 100k-page crawl | ~$1-5 compute, mostly static (*modelled* from AWS Fargate $0.0404/vCPU-hr + $0.0044/GB-hr, i.e. ~$0.10/hr for a 2 vCPU / 4 GB worker at 5-10 static pages/s [122]; full detail in Doc 06) | ~10x static if used for all pages [1] | Same | Cheapest raw, highest engineering cost | Firecrawl: 100k credits = entire $83/mo Standard plan per site per recrawl [6]; Apify ~$8 static / ~$83 rendered [1][8] |
| Ecosystem signal | v3.16, active (Apify team) | 57.6M npm downloads/week [2] | 10.7M/week, losing mindshare [2] | n/a | Subscription-only since June 2026, credits expire [7] |

**Selected: Crawlee (TypeScript), with Playwright as its rendering engine.** It is the only
evaluated option that ships the full checklist (frontier, dedup, robots, sitemaps, autoscaling, a
lockable shared queue, HTTP-to-browser switching) in one MIT-licensed package in the Platform's
native runtime [3][4][5]. Playwright is still used, but inside Crawlee, and it is the correct
engine choice over Puppeteer (tri-engine support, auto-waiting, ~5x the adoption) [2]. Plain
fetch+Cheerio is acceptable for the Doc 07 crawl POC but rebuilds undifferentiated plumbing as a
product. Managed services stay in the picture deliberately: Crawlee code runs unchanged on the
Apify platform, which makes Apify a zero-rework burst/overflow deployment target, and Firecrawl
remains an emergency fallback for hostile edge-case sites; neither survives as the core because
per-page pricing collapses at the 100,000-page monthly-recrawl scale FR-1.5 requires [6][7][8].

### 3.2 Rendering strategy

Traces to FR-1.2, FR-1.5, NFR-6.

| Requirement | Always-render | Never-render (static only) | Static-first hybrid (recommended) |
|---|---|---|---|
| Captures JS-injected titles/metas/links | Yes | No (misses CSR content) | Yes, on templates proven to need it |
| Cost per page | ~10x static (~300 vs ~3,000 pages per compute unit) [1] | Baseline | Near-static (~90% of fetches stay static) |
| 100k-page crawl duration | Multi-day (*modelled* at 0.5-2 pages/s per browser worker, ~2-5 s and 0.5-1 GB RAM per render [122]) | *Modelled* ~5.5 h at a polite 5 req/s single-worker rate | Close to static timing |
| Mechanism required | None | None | Rendering-type predictor + template clustering |

**Selected: static-first hybrid.** Every SEO field the SPEC demands (title, meta description,
H1-H3, canonical, robots meta, links, images and alt text, JSON-LD, word count) is extractable
from raw HTML unless the page is a JavaScript shell. A 200-domain study found 96% of domains show
some raw-vs-rendered difference in SEO-relevant areas, but only 56% of URLs are affected, and the
differences cluster by template, not by page [9]. So neither extreme is correct: always-render
pays 10x for nothing on most pages [1]; never-render silently misses client-rendered content. The
hybrid uses Crawlee's `AdaptivePlaywrightCrawler`, whose rendering-type predictor learns from
crawled pages and re-tests on a ~10% sample (`renderingTypeDetectionRatio` default 0.1),
persisting decisions per template cluster [3]. Two product bonuses: the raw-vs-rendered delta is
itself a reportable SEO finding, because AI search crawlers (GPTBot, ClaudeBot, PerplexityBot) do
not execute JavaScript [10]; and content-hash change detection from static fetches drives cheap
incremental recrawls, which is how the cost envelope at 100k pages holds.

### 3.3 Work queue

Traces to FR-1.6, FR-15.1.

The queue decision only makes sense alongside a structural rule from the orchestration research:
the Platform has three layers of "work," and conflating them is the main design failure mode.

```
Layer 1  Temporal workflows      ~12 coarse phases per site per day (O(10), never O(pages))
         (durable state)         approval gates, 14-60-day monitor timers
              |
              v
Layer 2  BullMQ on Valkey        page-level fetch / render / analyze jobs
         (job queue)             retries, rate limits, per-host politeness
              |
              v
Layer 3  Crawlee RequestQueueV2  the per-site URL frontier (up to 100k+ URLs)
         (crawl frontier)        dedup set, depth, lockable for scale-out
```

BullMQ is Layer 2 only: it never holds the crawl frontier (Layer 3, which would mean 100k queue
jobs per crawl) and never holds loop state (Layer 1, which needs durable timers and approvals no
queue provides).

| Requirement | BullMQ | RabbitMQ | Amazon SQS |
|---|---|---|---|
| Delayed / scheduled jobs | Native (delayed, repeatable jobs) [11] | TTL/DLX tricks or plugin [11] | Capped at 15 minutes [12] |
| Priorities, rate limits, flows | Native; per-group concurrency and rate limits in BullMQ Pro [14] | Via topology design | No job semantics |
| Per-tenant fairness | Pro groups map 1:1 to "per customer site" [14] | Hand-built | Hand-built |
| Operational cost | Runs on the Redis-protocol store already required | A second broker to operate [15] | Zero-ops; 1M free requests/mo, ~$0.40/M after [13] |
| Language / stack fit | Node-native, first-party NestJS integration | Polyglot AMQP (not a need here) | AWS-lock |

**Selected: BullMQ.** The comparison literature is consistent: BullMQ on Redis-protocol storage
is the pragmatic default for Node job workloads; RabbitMQ earns its keep only for cross-language
AMQP routing topologies this Platform does not have; SQS's 15-minute delay cap disqualifies it
for schedule-shaped work and it lacks job semantics entirely [11][12][15]. BullMQ Pro (commercial)
adds per-group concurrency and rate limits, which is per-tenant fairness at the queue layer; if
Temporal's fairness keys prove sufficient at the orchestration layer, open-source BullMQ suffices.
This is a flagged, low-cost dependency decision, not a blocker.

### 3.4 Primary database

Traces to FR-1.7, FR-2.1-2.3, FR-13.1-13.2, NFR-2.

The problem statement names this binary explicitly ("MongoDB vs PostgreSQL"), so both sides are
answered directly; two further options from the data-model lane's option matrix are carried in
because the interesting question is not document-vs-relational but "how many stores".

| Requirement | PostgreSQL 16+ (+ pgvector) | MongoDB (Atlas) | Polyglot specialist stack (Postgres + Elasticsearch + Neo4j + Qdrant) | Postgres + MongoDB hybrid (documents for crawl payloads) |
|---|---|---|---|---|
| Joins across crawl x GSC x links x issues (the dominant query shape) | Native, excellent | Weak (`$lookup`); document model buys nothing JSONB doesn't | Native in Postgres, but the graph/search/vector signals now live outside it, so the hard three-signal queries become application-side joins | Native for facts; crawl payloads sit across a process boundary |
| Link-graph storage and traversal | Edge table + batch worker; recursive CTEs benchmark 22.5K RPS vs Neo4j's 14.5K on an OLTP traversal mix [17] | `$graphLookup`: hard 100 MB per-stage memory cap, no disk spill, exponential degradation with depth [16] | Best-in-class traversal (Neo4j GDS) at the cost of a sync pipeline | Same as MongoDB column |
| Vector similarity with filters | pgvector HNSW + iterative index scans [18] | Atlas Vector Search competent (HNSW, quantization) [19], but doesn't rescue joins or graph | Best beyond ~100M vectors; needs cross-database filtering below that [27][28] | pgvector |
| Flexible crawl payloads | JSONB | Native documents | JSONB | Native documents — the only genuine advantage, and it is one Postgres already covers |
| Full-text "which pages mention X" | `tsvector` now; BM25 via pg_search later [21] | Atlas Search (Lucene) | Best-in-class (Lucene) | `tsvector` |
| Multi-tenancy | Row-level security + partitioning, mature | Workable | RLS in Postgres; index-per-tenant sprawl in the search cluster | Two tenancy models to keep consistent |
| Change ledger (FR-13) | Append-only tables + FK integrity | Workable | Postgres | Postgres |
| Stores to operate / sync pipelines to own | 1 / 0 | 1 / 0 | 4 / 3 | 2 / 1 |
| Answers all seven website-understanding questions (FR-2) in one engine | Yes, with the batch graph worker | No (graph) | Yes, across four systems | No (graph) |
| Cost at MVP | One managed instance ~$50-200/mo (Neon usage-based from $0; Supabase Pro $25/mo + compute) [123][124] | Atlas M10+ ~$60+/mo (*list estimate, not vendor-verified in this research pass — re-verify at contract time*) | +$100s/mo per additional cluster [24][27] | Postgres cost + Atlas cost |

**Selected: PostgreSQL 16+ with pgvector, as the single system of record.** The decisive fact is
what the website-understanding requirement (FR-2) actually computes: every question the client
lists (important pages, cannibalization, orphans, weak linking) reduces to a SQL join, a batch
graph computation, or a nearest-neighbor lookup, and the hard product queries need all three
signals in one query. Only Postgres puts the GSC fact table, the link-edge table, and the vectors
behind one query planner. MongoDB is rejected on its worst-fit workload: link-graph analytics
under `$graphLookup`'s 100 MB no-spill cap [16]. Industry precedent supports the shape: Botify
and Lumar model crawl output as tabular analytics data; none of the commercial crawl-analytics
leaders run customer link graphs in a document or graph database [20]. The polyglot specialist
stack is rejected on the same evidence read forward: it is the MVP's own scale-up path assembled
five years early, and it converts the Platform's hardest query — relational facts plus graph
score plus vector similarity in one statement — into a three-way application-side join. The
Postgres+MongoDB hybrid is rejected because JSONB already covers the only thing documents buy
here. Raw HTML bodies do not go in the database: they are zstd-compressed into S3-compatible
object storage (Section 3.19; HTML bodies only, one retained version: a ~100 kB page compresses to
~15-25 kB, so ~2-2.5 GB and roughly $0.03-0.04/month for a 100k-page site at R2's $0.015/GB-month
[103]), keyed by content hash, preserving before/after evidence
for the change ledger.

### 3.5 Search / analytics engine

Traces to FR-2.3, FR-8.1, FR-16.2.

The question here is not "OpenSearch vs Elasticsearch" but "when is a second data system
warranted at all." The MVP needs exactly one search capability: BM25-style mention search over
page content ("which pages mention 'Amazon keyword research'"), the internal-linking primitive.

| Requirement | Postgres FTS (+ pg_search) | OpenSearch | Elasticsearch |
|---|---|---|---|
| Mention search for link opportunities | `tsvector` adequate to ~10^5 pages; ParadeDB pg_search adds Tantivy BM25, ~20x faster ranking than `ts_rank` at 1M rows [21][22] | Best-in-class | Best-in-class |
| Joins to crawl/GSC facts | Same database, same query | None (denormalize everything) | None |
| Faceted analytics UI over 100M+ rows | Struggles | Right tool (the architecture OnCrawl exports into) [20] | Right tool |
| License for embedding in a SaaS | PostgreSQL license | Apache 2.0, Linux Foundation [23] | AGPLv3 / ELv2 / SSPL triple license [23] |
| Cost | $0 incremental | Managed ~$60-110/mo; Serverless floor $175-350/mo [24] | Comparable |
| Ops burden | None new | A second cluster | A second cluster |

**Selected: Postgres FTS now, with pg_search as the in-database upgrade; OpenSearch added only
if a 100M+-row faceted crawl-analytics UI becomes a product feature.** The MVP's one search
requirement is covered inside the system of record at zero marginal cost and with joins intact
[21][22]. A second engine forfeits the join surface (its most expensive hidden cost), adds
$60-350/month [24], and adds an ops burden the small-team constraint cannot absorb. When the
trigger fires, OpenSearch is preferred over Elasticsearch on licensing alone: Apache 2.0 under
the Linux Foundation is cleaner to embed in a commercial SaaS than Elastic's triple license [23].

### 3.6 Vector store

Traces to FR-2.2, FR-7.2, FR-8.1, FR-8.3.

| Requirement | pgvector (halfvec + HNSW) | Qdrant Cloud | Pinecone serverless |
|---|---|---|---|
| MVP volume fit (10k-100k vectors/site) | 2-3 orders below its ~10M-vector comfort zone [25] | Over-provisioned | Over-provisioned |
| Filtered similarity (project + indexable + page type) | One SQL statement; iterative index scans keep filtered ANN correct [18] | Payload filters, but joins to Postgres are application-side | Metadata filters burn 5-10 read units per query [28] |
| Storage at 100k pages (1536-dim halfvec) | ~310 MB + index; trivial | Fine | Fine |
| Cost | $0 incremental | ~$114/mo at 1M vectors, ~$456/mo at 10M [27] | $0.33/GB + $8.25/1M reads + $2/1M writes; real costs run 5-10x naive estimates on filtered workloads [28] |
| Known ceilings | HNSW build wants 8-16 GB `maintenance_work_mem` at 5M x 1536; degradation past ~10-20M vectors [25][26] | Scales further | Scales further |
| Scale-up path | pgvectorscale (StreamingDiskANN): 28x lower p95 and 16x throughput vs Pinecone s1 at 50M vectors, ~75% cheaper self-hosted [29] | The escape hatch if vector load must be isolated | — |

**Selected: pgvector, storing 1536-dim embeddings as `halfvec` with an HNSW cosine index.** The
Platform's most common similarity query is filtered ("similar pages that are indexable and in the
same category"), which pgvector answers in one SQL statement while a dedicated store forces a
cross-database join for every call [18]. At MVP scale the dedicated stores solve a problem the
Platform does not have, at $114+/month [27][28]. The scale triggers are explicit and monitored,
not discovered: past ~5-10M total vectors (roughly 50-100 large customer sites), add pgvectorscale
(StreamingDiskANN plus statistical binary quantization, still inside Postgres) [29][30] or split
vectors to Qdrant, whose resource-based pricing beats Pinecone's at 10M+ vectors (32% cheaper at
50M: $1,824 vs $2,700/mo) [27][29].

### 3.7 Graph analytics

Traces to FR-2.2, FR-3.4.

| Requirement | In-process rustworkx / igraph | graphology (JS-native, in-process) | Neo4j (AuraDB + GDS) | Memgraph (+ MAGE) |
|---|---|---|---|---|
| PageRank / CheiRank / HITS / BFS depth / components | All present; one pass in a post-crawl worker | PageRank, HITS, components and BFS available in the `graphology-metrics` / shortest-path packages; CheiRank is PageRank on the reversed edge list, so it is free either way | All present (GDS) | All present (MAGE) |
| Performance at site scale | PageRank on LiveJournal (4.8M nodes, 69M edges, ~50x a 100k-page site) takes 10.6 s in igraph; 2,720 s in NetworkX [31]; rustworkx runs 3-100x faster than NetworkX [32] | Unestablished for this workload: [31] and [32] are Python/Rust-ecosystem benchmarks and contain no JavaScript entry, so the claim would have to be re-measured on our own 10M-edge graph before it could be relied on | Interactive traversal is its strength, not batch scoring | Fastest graph DB in vendor benchmarks |
| Runtime / new infrastructure | No new datastore, but a **new runtime**: `rustworkx` is a Rust core with Python bindings (Qiskit project) and igraph's maintained bindings are C, Python and R — neither has a Node package, so this is the Platform's one Python worker (Section 3.0) | None — stays in the Node analysis worker, preserving a single runtime | Managed cluster + Postgres-to-graph sync pipeline | Same |
| Cost | $0 in licence and infrastructure; one extra container image and dependency manifest in CI | $0 | From ~$65/GB/month [33] | Enterprise ~$25k/yr (16 GB) [33] |
| Online multi-hop queries (UI) | Recursive CTEs: 22.5K RPS on an OLTP traversal mix [17] | Recursive CTEs (same — the UI path never touches the library) | Best-in-class | Best-in-class |

**Selected: in-process graph computation (`rustworkx`, igraph as the equivalent alternative) in a
post-crawl Python analysis worker, scores written back as columns on the pages table.** The
load-bearing observation from the data-model research: every graph question the SPEC asks
(importance, orphans, depth, weak linking) is a nightly batch analytics question over a
site-sized graph, recomputed after each crawl, never an interactive traversal. A 100k-page site's
graph (~10M edges) computes PageRank, CheiRank (PageRank on the reversed link graph, which
measures outbound authority), HITS, BFS depth, and connected components in seconds on one worker
[31][32]. A graph database would add a second query language, a data-sync pipeline, and a second
failure domain to replace a 50-line batch job, at $65/GB/month or $25k/year [33]. NetworkX is
explicitly rejected as the implementation (45-minute PageRank at benchmark scale [31]). Memgraph
is the pre-selected candidate if interactive graph exploration ever becomes a sold product
feature; that is a product trigger, not an MVP need.

**The honest cost of this pick, stated because it contradicts the one-runtime principle:** neither
recommended library is consumable from Node. This section is the reason the Platform ships one
Python container alongside the Node services — it runs the graph pass and, if the GLiNER fallback
of Section 3.12 is ever enabled, the NER model too. Section 3.0 defines the boundary and its
deployment cost, and names graphology as the JS-native alternative that eliminates it, gated on a
POC benchmark because the numbers in this table do not transfer to a JavaScript implementation.
An architect costing staffing or deployment off this document should plan for two runtimes, not
one: Node/TypeScript for everything customer-facing and everything that writes to a customer's
site, Python for one batch analytics worker with no HTTP surface and no credentials.

### 3.8 Workflow / orchestration backbone

Traces to FR-15.1-15.2, FR-14.3, FR-11.2, NFR-1, NFR-3.

This is the reliability-critical selection (FR-15.2 explicitly says optimize for reliability).
The daily loop demands three primitives most systems lack: durable 14-60-day post-change
monitoring timers that survive restarts and cost nothing while sleeping; mid-workflow human
approval gates for MEDIUM-risk changes (pausing hours to weeks); and per-tenant fairness so one
100,000-page customer cannot starve ten 500-page customers.

| Criterion | Temporal | Inngest | Trigger.dev v4 | Hatchet | cron + BullMQ | Step Functions | LLM-agent frameworks |
|---|---|---|---|---|---|---|---|
| Durability model | Event-sourced replay | Durable steps | Checkpointed runs (cloud only) [43] | Postgres event log [47] | None (jobs only) | State machine, 1-yr max | Checkpoints only; no failure detection, no distributed coordination [48] |
| 14-60-day timers | Durable sleep, near-zero cost [36] | Sleep <= 1 yr [41] | Cloud only; self-host holds resources [43] | Yes | Cron sweeps + hand-built dedupe | <= 1 yr | Process must survive |
| Human approval mid-flow | Signals + wait conditions [37] | `waitForEvent` | Waitpoints (cloud) | Durable events | Hand-built | Task tokens | `interrupt()` with replay risk |
| Multi-tenant fairness | Fairness keys + per-key RPS on one task queue [35] | Concurrency keys | Queues + concurrency | Concurrency/priority lanes | Hand-built | Hand-built | None |
| Fan-out cost trap | Coarse phases stay near the included 1M actions | Execution billing punishes fan-out (100k-page crawl as steps = 100k+ executions) [40] | Per-second compute on multi-hour runs [42] | 5-tenant cap on the $500/mo Team tier [46] | n/a | Transition-count trap (documented $450 -> $1 refactor) [44][45] | n/a |
| Cost at MVP (~100 sites) | $100/mo floor, 1M actions included [34] | $0-99/mo [40] | $10-50/mo + compute [42] | Free tier (100k runs) [46] | Infra only | ~$5-20/mo | n/a |
| Cost at ~5,000 sites | ~$800/mo at ~15M actions/mo (list: $100 incl. the first 1M + $50/M thereafter; no volume discount assumed) [34] | Execution-billing risk | Compute-billing risk | $500-1,000/mo or self-host [46] | High engineering cost | Transition risk | n/a |
| Self-host quality | MIT, real ops (~$400-900/mo infra) [39] | Second-class [40] | Loses checkpoints [43] | Best in field (Postgres-only) [47] | Fine | None | It's a library |
| Audit trail | Full replayable event history per workflow (feeds SPEC §16) | Good dashboard | Good dashboard | Postgres-backed, 3-7-day retention | DIY | CloudWatch | LangSmith ($39/seat) |

**Selected: Temporal (TypeScript SDK), consumed as Temporal Cloud at MVP ($100/mo floor including
1M actions) [34].** One `DailySiteRun` workflow per site per day; the workflow orchestrates ~12
coarse phases (crawl, GSC pull, analyze, competitor pass, link-candidate pass, prioritize,
generate, validate, apply among them; the concrete P1-P12 enumeration is Doc 03 §4.2) as
activities — O(10) phases, never O(pages);
MEDIUM-risk changes spawn approval-gate child workflows waiting on signals; every applied change
spawns a monitor workflow that durably sleeps through its 14-60-day evaluation window [36][37].
The structural rule that matters more than the engine: never model per-URL work as workflow steps.
That rule has a hard number behind it — a Temporal workflow history is capped at 51,200 events and
50 MB, so a loop over a 100,000-URL frontier in workflow code terminates the workflow rather than
merely costing money [38]; the coarse-phase design plus `continue-as-new` on long-running monitors
keeps histories two orders of magnitude below the ceiling. The same rule is what breaks the lighter
competitors for a different reason, since Inngest's execution billing and
Trigger.dev's per-second compute are priced exactly against this product's fan-out and multi-hour
crawl profile [40][42]. Hatchet (MIT, Postgres-backed) is the pre-selected fallback if a hard
self-host mandate emerges [47]. Cron+BullMQ is rejected because six months in, the team will have
hand-built durable timers, retry state machines, approval plumbing, and crash recovery, that is,
an untested workflow engine. LLM-agent frameworks (LangGraph, CrewAI, agent SDKs) are rejected as
the backbone on a structural finding: they checkpoint but do not durably execute (no automatic
failure detection, no distributed coordination, single-process) [48]. LLM calls run as plain
retryable activities inside Temporal workflows; where a bounded agentic loop is genuinely useful
(repo modification until the build passes), it runs inside one activity with a hard timeout.

### 3.9 AI provider and models

Traces to FR-4.1-4.4, NFR-1, NFR-6, NFR-8.

The AI engine is a typed-operation emitter, not a content writer: it returns schema-enforced JSON
operations (`UPDATE_TITLE`, `ADD_FAQ_BLOCK`, `ADD_INTERNAL_LINK`, ...), each carrying an
`oldValue` anchor verified against the live page before apply. That design makes two provider
capabilities load-bearing: native structured-output enforcement and batch pricing. All three
major providers now meet both.

Structured-output support (the FR-4.4 mechanism):

| Capability | Anthropic | OpenAI | Google |
|---|---|---|---|
| Constrained decoding to a JSON schema | `output_config.format` + strict tool use; SDK `messages.parse()` [50] | `response_format: json_schema, strict: true`; invalid tokens masked at decode time [54] | `responseSchema` constrained decoding [56] |
| Known limits | No `minLength`/`maxLength` or numeric bounds; schema compile cached 24h [50] | Optional fields as union-with-null | Structural constraint only; layer Zod/Pydantic downstream (Google's own guidance) [56] |

Because no provider can express length, pixel-width, or factual constraints in a schema, a
code-level validator + one error-carrying retry sits on top regardless of vendor; the provider
choice is therefore about model economics and ops maturity, not about a capability moat.

Model tiers and list prices (per 1M tokens in/out, standard tier, verified Aug 2026; all three
offer a uniform 50% batch discount and ~0.1x cached-input pricing — with the caveat that cached
pricing applies only above a per-model minimum cacheable prefix of 512 tokens on Opus 5, 1,024 on
Sonnet 5 and **4,096 on Haiku 4.5**, so a short shared site preamble silently fails to cache on
exactly the cheap tier that runs the most calls) [49][51][52][53][55]:

| Tier | Anthropic | OpenAI | Google |
|---|---|---|---|
| Frontier / judge | Claude Opus 5: $5 / $25 | gpt-5.6-sol: $5 / $30 | Gemini 3.1 Pro (preview): $2 / $12 |
| Workhorse | Claude Sonnet 5: $3 / $15 (intro $2 / $10 through 2026-08-31) | gpt-5.6-terra: $2 / $12 | Gemini 3.6 Flash: $1.50 / $7.50 |
| Bulk | Claude Haiku 4.5: $1 / $5 | gpt-5-mini: $0.25 / $2; gpt-5-nano: $0.05 / $0.40 | Gemini 3.5 Flash-Lite: $0.30 / $2.50 |

That 4,096-token floor fixes the shape of the context pack rather than conflicting with it: a
**>4K stable cached prefix** (site profile, rulebook, output schema, exemplars) **plus 2-4K
volatile per-page blocks**, with the bulk tier budgeted uncached if the prefix cannot clear 4K. The
3K in / 500 out per-page shape used for costing below prices the volatile half; cached-prefix reads
bill at ~0.1x on top [52].

**Selected: Anthropic-first model tiering behind a thin multi-provider adapter, with OpenAI and
Gemini adapters as fallback and price lever.** The routing has four lines plus a deterministic
floor:

| Workload | Tier | Token shape per call | Cost basis |
|---|---|---|---|
| Rule-shaped technical SEO (canonicals, redirects, sitemap, missing dimensions), pixel-width checks, dedup | **Tier 0: deterministic code, no LLM** | n/a | $0; an LLM here adds cost and failure modes |
| Alt text, meta descriptions at volume, intent classification, query-cluster labels | Haiku-class (bulk) | 3K in / 500 out per page | ~$27.50 per 10,000 pages batched [49][51] |
| Titles, H1/H2 restructuring, FAQs, internal-link anchors, content-gap summaries, schema | Sonnet-class (judgment) | 3K in / 500 out per page | ~$82.50 per 10,000 pages batched [49][51] |
| Cross-model judging on the ~15% of outputs that need it, escalated retries, injection-flagged review | Opus-class (judge) | 1K in / 100 out per judged page | ~$5.60 per 10,000-page pass [49][51] |
| **Repo code-patch generation for the GitHub path (FR-10, the highest-token call in the system)** | Opus-class | ~20K in (repo file slices + instructions) / 2K out per fix | **~$0.15 per fix live, ~$0.08 batched**; 100 auto-fixes/month ≈ $15 [49][51] |

Opus-class therefore carries two distinct jobs, and the reason is the same in both: a judge must be
stronger than its generator, and a model writing into a customer's production repository must be
the strongest available. The rule that bounds the code-patch line is architectural, not budgetary:
because change application is codemod-driven (Section 3.21), the model emits a JSON value payload
and not a diff for every change a codemod can express, so the 20K-token repo-context call fires
only for the minority of content-shaped edits — never per page, and never across a whole site.
Essentially all generation routes through the Batch API for the flat 50%, since the SEO cycle is a
nightly batch job, not interactive [51]. Worked economics for a full 10,000-page metadata pass
(3K in / 500 out per page): Haiku batch ~$27.50; Sonnet batch ~$82.50; Opus judging on the 15% of
pages that need it, at 1K in / 100 out each, ~$5.60. The headline **generation figure is ~$27.50-82.50
per full pass, bracketing the two routing extremes — Haiku-only ($27.50) to Sonnet-only ($82.50) —
and the all-in figure is ~$33-88 once selective Opus judging (~$5.60) is included; any code patches
are costed on top of both, never inside them**; k=3 self-consistency on the
~20% of MEDIUM-risk ops roughly doubles that slice, keeping a worst-case full pass in the low
hundreds. Incremental nightly cycles touch only the 1-5% of changed or opportunity pages
[49][51]. One further decision inherited from the research: confidence is never
the model's self-reported number, because verbalized LLM confidence is systematically
overconfident [57]; it is computed from deterministic validators, k-sample agreement, and a
cross-model judge, calibrated against the Platform's own keep/rollback outcomes.

### 3.10 Embeddings

Traces to FR-2.2, FR-7.2, FR-8.1.

| Model | $/M tokens | Dims | Cost per 10k pages | Notes |
|---|---|---|---|---|
| **OpenAI text-embedding-3-small** | $0.02 ($0.01 batch) | 1536 (MRL-truncatable to 512) | ~$0.30 ($0.15 batch) | Best mainstream price/quality [53][58] |
| OpenAI text-embedding-3-large | $0.13 ($0.065 batch) | 3072 | ~$1.95 | +2-3 MTEB points at 6.5x the cost [53][58] |
| Google text-embedding-005 | $0.006 | 768 | ~$0.09 | Cheapest API option [59] |
| Cohere embed v3 | $0.10 | 1024 | ~$1.50 | [58] |
| Voyage 3.5 / 3-large | $0.10-0.18 | 1024-2048 | ~$1.50-2.70 | Retrieval-tuned [58] |
| Self-hosted SBERT (bge/gte) | GPU cost only | 384-1024 | ~$0 marginal | Ops burden; loses API simplicity |

**Selected: text-embedding-3-small, 1536 dims, stored as pgvector `halfvec` with HNSW cosine
indexing.** Embedding cost is noise next to crawl compute and generation tokens (~$3 per 100k
pages, re-embedded only on content-hash change), so the pick optimizes quality-per-simplicity,
not price: near-par retrieval quality at 6.5x less than 3-large, one embedding space shared by
pages, keywords, and competitor chunks so page-to-keyword similarity is a single cosine operator,
and MRL truncation to 512 dims as a free storage lever if ever needed [53][58]. The known
lock-in risk is model deprecation invalidating stored vectors; mitigated by a version column and
the fact that full re-embedding costs ~$3 per 100k pages.

### 3.11 SERP / keyword data vendor

Traces to FR-5.1, FR-7.1, NFR-6. (GSC remains the primary, free, first-party data source per the
MVP scope; this vendor supplies competitor identity, SERP features, volumes, and intent.)

**Phase marker — read this row against Doc 01 before budgeting for it.** Doc 01 §6 lists
third-party keyword/SERP APIs under "explicitly deferred beyond MVP", and Doc 01 §10 open
question 4 records the working assumption as "GSC position data only; SERP APIs deferred" pending
a client answer on whether third-party SERP data is acceptable at MVP given cost and ToS
exposure. The selection below is therefore made **now so that the `SerpProvider` abstraction is
designed and built into the MVP from day one** — it is a seam, and seams are expensive to retrofit
— while **live vendor spend starts only when the client answers open question 4 in the
affirmative**. Until then the Platform runs on GSC alone and the provider adapter has one
implementation: a null provider. Section 5 carries the SERP line explicitly rather than silently:
its small-tier envelope is marked post-MVP inclusive and a GSC-only MVP total is published beside
it, so the MVP figure is never the one carrying vendor spend.

| Provider | Pricing model | SERP cost /1k | Keyword volumes | Dealbreakers / caveats |
|---|---|---|---|---|
| **DataForSEO** | Pay-as-you-go, $50 min deposit | $0.60 standard / $1.20 priority / $2.00 live [60] | ~$0.06-0.09 per 1,000 keywords (Google Ads-sourced) [61] | Standard queue is async (~5 min); broadest surface (SERP + volumes + intent + on-page parsing) |
| **Serper** | Prepaid credits, 2,500 free | $1.00 down to $0.50 (2.5M pack) [62][63] | n/a (autocomplete only) | Google-only, raw SERPs; ideal cheap live-SERP secondary |
| SerpApi | Subscription | $25 down to ~$9.17 [64] | n/a | 10-25x Serper's price; defendant in Google v. SerpApi (DMCA, Dec 2025) and Reddit's suit, which largely survived dismissal Jul 31, 2026 [69][70] |
| Semrush API | $549/mo plan + units (~$50/M) [65] | n/a (keyword DB) | ~$0.0005/row + plan | Cached API data may not be stored longer than 1 month without written consent: hostile to a warehouse-centric platform [65] |
| Ahrefs API v3 | Plan-bundled units: $129/mo (100k) to $1,499/mo (2M) [66] | n/a | Per-row x per-field units, min 50/request | Unit math expensive at programmatic scale; resale terms need an Enterprise conversation |
| Google Keyword Planner (Ads API) | Free but gated | n/a | Free | Keyword-planning services blocked at the auto-granted Explorer tier; Basic approval + a manager account required; bucketed ranges without ~$50-100 ad spend; policy gray zone for an SEO SaaS [67][68] |

**Selected: DataForSEO primary, Serper secondary, behind a mandatory multi-vendor `SerpProvider`
abstraction; Semrush/Ahrefs APIs skipped; Keyword Planner never a foundation.** DataForSEO's
pay-as-you-go economics match a per-customer COGS model: one vendor covers SERPs with
People-Also-Ask, search volumes, intent classification, and competitor-page parsing, putting full
competitor analysis at roughly $0.02-0.05 per keyword [60][61]. The abstraction layer is not
optional hygiene, it is risk management: every SERP feed is scraped (Google offers no official
SERP API, and Microsoft retired the Bing Search APIs on August 11, 2025, with the Azure-locked
replacement costing 40-483% more [121]), and active litigation against SerpApi shows a provider
can become radioactive inside a quarter [69][70]. Semrush's
1-month caching cap conflicts directly with the Platform's warehouse-first design [65], and
Keyword Planner's access gating plus bucketed volumes make it unusable as a product dependency
[67][68].

### 3.12 Entity extraction

Traces to FR-7.1.

| Criterion | Cheap-LLM structured pass | Google Cloud NL API | GLiNER / spaCy (open source) |
|---|---|---|---|
| Cost per ~3,000-word page | ~$0.0005-0.002 (Gemini Flash-Lite class: $0.10/$0.40 per M tokens) [71] | ~$0.015 (~$1.00/1k units after the free tier) [72] | ~$0 marginal (GLiNER is CPU-viable) [73] |
| What one pass returns | Entities + topics + questions answered + unique claims, in one schema-enforced call | Entities only; v2 dropped salience and Wikipedia metadata [72] | GLiNER: arbitrary types zero-shot; spaCy: fixed 18-type taxonomy |
| Quality on messy web text | Best; nondeterministic across model versions | Good on clean prose; product stagnant | GLiNER 50-300M outperforms ChatGPT-class models on zero-shot NER benchmarks [73] |
| Ops | API dependency; cheap models retire fast (2.5 Flash-Lite retires Oct 16, 2026 [71]) | API dependency | Model hosting |

**Selected: one cheap-LLM structured pass per competitor page, with GLiNER as the deterministic
open-source fallback; Google NL API skipped.** The LLM pass delivers four analyses (entities,
topics, questions, claims) for ~$0.002 per page, versus the NL API charging roughly 7-30x for
entities alone (~$0.015 against $0.0005-0.002) while having lost salience, its most SEO-relevant
field, in the current version [71][72]. GLiNER (a named-entity-recognition model that takes the
entity types to find as an argument instead of a fixed taxonomy) serves two roles: a regression
baseline to detect LLM drift across model versions, and a zero-cost path for high-volume re-scans
[73]. Its deployment cost is already paid: GLiNER is a PyTorch model and runs in the same Python
analysis worker that Section 3.7 introduces for the graph pass, so enabling the fallback adds a
dependency, not a runtime. spaCy's fixed taxonomy misses the
product/brand/domain entities that matter for SEO comparison. Model versions are pinned and
extraction outputs snapshotted per analysis run, because the change ledger (FR-13) needs stable
"before" evidence.

### 3.13 Frontend framework

Traces to FR-16.1.

| Criterion | Next.js 16 (App Router) | React Router v8 (framework mode) | TanStack Start |
|---|---|---|---|
| Status (Aug 2026) | 16.3 stable; Active + Maintenance LTS lines; formal security-release program (July 2026 release patched 4 HIGH CVEs) [74][75] | v8 stable, non-breaking from v7 [77] | Release Candidate, not 1.0 [78] |
| Self-hosting | Node/Docker supports all features; verified-adapter API; no Vercel lock-in [76] | Node/Docker | Node, Cloudflare, Netlify (RC) |
| Ecosystem gravity (auth SDKs, hiring, examples) | Highest; Clerk SDK first-class | Medium | Small |
| Complexity | RSC/App Router learning curve | Lowest of the three | Medium, plus churn risk |

**Selected: Next.js 16 (App Router, TypeScript), self-hosted in Docker, with Tailwind + headless
components and TanStack Query.** For a platform holding customers' GitHub write access, the
frontend framework's security process is a selection criterion: Next.js is the only candidate
with an LTS line and a formal CVE program [75], and first-class self-hosting removes the
historical lock-in objection [76]. The app is an auth-gated B2B dashboard (diff review queues,
large tables, live crawl status), so the deciding factors are ecosystem maturity and the
approval-surface UI, not public-page SEO. React Router v8 is a respectable second; TanStack
Start fails the "no Release Candidate dependencies in a client deliverable" bar [78].

### 3.14 API framework

Traces to FR-16.1, NFR-5.

| Criterion | NestJS 11 on Fastify | Hono 4.13 | Express | Plain Fastify 5 |
|---|---|---|---|---|
| Structure for RBAC / tenant scoping | Guards, interceptors, DI: one enforced seam [79] | By convention | By convention; middleware only | By convention |
| OpenAPI (future public API, webhooks) | First-party generation | Via zod-openapi | Via add-ons | Via plugins |
| Performance | Fastify-class via adapter (~30k req/s; schema-compiled validation) [79][80] | Comparable | Slowest of the set; no schema-compiled serialization | ~30k req/s class [80] |
| Queue/workflow integration | First-party `@nestjs/bullmq`, DI-friendly workers [79] | Manual | Manual | Manual |
| Maintenance cadence | v11.1.29, monthly patches [79] | Active [81] | Mature, slow-moving | Active [80] |

**Selected: NestJS 11 running on the Fastify adapter.** The API is a control plane, not a hot
path: CRUD on projects and connections, webhook receivers, command endpoints that enqueue
workflows. Its failure mode is not throughput but a cross-tenant authorization bug, so the
framework-level guard/interceptor seam, where tenant scoping and the risk-tier approval RBAC
live, paired with Postgres row-level security below it, is the decisive feature [79]. The Fastify
adapter removes the Express performance tax without giving up NestJS's structure [80]. Hono's
edge portability is irrelevant for an API that sits in one VPC next to Postgres and Temporal, and
its ecosystem for enterprise concerns is thinner [81]. Express is the weakest option on both
structure and performance and is included only as the well-known baseline. tRPC remains an
optional internal dashboard layer later; it can never be the only surface because webhooks and a
future public API require REST/OpenAPI.

### 3.15 Platform authentication

Traces to FR-16.1, NFR-5. Scope: the Platform's own users (agencies, marketing teams). Customer
credentials (GitHub App tokens, GSC refresh tokens, CMS secrets) live in a separate trust domain
(Section 3.18), so an auth-vendor breach can never expose customer repository access.

| Criterion | Clerk | Auth0 | WorkOS AuthKit | Better Auth (self-host) | Keycloak 26.7 |
|---|---|---|---|---|---|
| Free tier | 50,000 monthly users [82] | 25,000 MAU [84] | 1M MAU [85] | Unlimited (OSS) [86] | Unlimited (Apache-2.0, CNCF incubating) [87] |
| Cost at ~5k B2B users | $0-25/mo [82] | B2B Essentials $150/mo at 500 MAU scaling to $3,800/mo at 20k [84] | $0 [85] | Infra only | Infra + heavy ops |
| Org / multi-tenant model | Best in class: memberships, roles, invitations, verified domains [83] | Good (5 orgs free) | Good, thinner UI layer | Plugin (teams/roles/invites) [86] | Realms (heavy) |
| Enterprise SSO price | $75/mo per SAML/OIDC connection [82] | Tier-gated | $125/mo per connection [85] | $0 (SSO/SAML plugin) | $0 |
| Exit cost | Medium (user export; Better Auth path documented) | High | Medium | None; owns our Postgres | Low |
| Ops burden | None | None | None | Patching is ours | Highest (Java cluster) |

**Selected: Clerk, with Better Auth as the documented exit path and Keycloak reserved for
on-premises mandates.** At B2B SEO-platform user counts (even 500 customers x 10 seats = 5,000
MAU), Clerk stays in free/low tiers for years, its Organizations feature maps 1:1 onto the
agency-to-client structure the project model needs, and $75 per SSO connection is the cheapest
managed enterprise-SSO path, 1.7x cheaper than WorkOS per connection and an order of magnitude
below Auth0's B2B tiers at scale [82][83][84][85]. The dependency risk (login outage = platform
outage) is mitigated by locally verifiable JWT sessions, a nightly user/org export, and the
pre-agreed Better Auth exit (open source, TypeScript, same Postgres, Vercel-backed) [86].

### 3.16 Cache / Redis-protocol store

Traces to FR-16.2. This store carries BullMQ job state (the load-bearing role), crawl politeness
and dedup state, rate-limit counters, and distributed locks; it is not an HTTP response cache.

The store is a settled decision, not an open one: decision D-38 selects **Valkey 9** as the
concrete Redis-protocol store behind the queue layer's generic "BullMQ + Redis" (D-06), on the
licensing and price evidence below. Nothing about BullMQ changes — its hard requirement is Redis
>=6.2 semantics, which Valkey's Redis-7.2.4 lineage satisfies [91]. D-38's own compensating
control is carried in the build plan: Valkey is not on BullMQ's formally tested-vendor list, so
versions are pinned and CI-tested against them.

| Criterion | Valkey 9 | Redis 8 | Dragonfly | Upstash (managed) |
|---|---|---|---|---|
| License | BSD-3, Linux Foundation [88] | RSALv2 / SSPLv1 / AGPLv3 tri-license [90] | Source-available (BSL) | n/a (SaaS) |
| BullMQ compatibility | Redis-7.2.4 lineage satisfies BullMQ's >=6.2 requirement; not yet on the formally tested-vendor list, so pin versions and CI-test [91] | Native target [91] | Officially tested, but requires `{hashtag}` queue naming + emulated-cluster flags [91][92] | Works; per-command billing punishes polling queues [93] |
| Managed price anchor | ElastiCache Serverless $0.084/GB-hr, 33% below Redis OSS; node-based 20% below [89] | $0.125/GB-hr serverless [89] | Dragonfly Cloud / self-host | $0.20 per 100k commands PAYG [93] |
| Verdict | **Recommended** | Fine; no reason to prefer | Scale-up escape hatch | Cache-only niche; wrong for BullMQ |

**Selected: Valkey 9, one instance serving queue + cache + rate-limit state at MVP.** It is
Redis without the licensing history, at a 20-33% managed discount [88][89][90]. A busy BullMQ
deployment generates millions of commands per day from worker polling and heartbeats, which is
exactly what inverts Upstash's per-command pricing [93]. Dragonfly is the pre-researched
scale-up if a single-threaded instance ever saturates, a distant concern since the crawl
frontier stays out of BullMQ by design (Section 3.3).

### 3.17 Observability

Traces to FR-16.1, FR-16.2, NFR-3.

| Criterion | Grafana Cloud + Sentry (managed) | Self-hosted LGTM stack (Prometheus/Loki/Tempo/Grafana OSS) | CloudWatch (AWS-native) |
|---|---|---|---|
| MVP cost | Grafana Cloud free tier: 10k metric series, 50 GB each logs/traces, 14-day retention; Sentry Team $26/mo (50k errors, 5M spans) [94][95] | Infra + operations time | Usage-billed; weakest tracing UX of the three |
| Instrumentation | OpenTelemetry SDK everywhere; Temporal SDKs emit Prometheus/OTLP metrics and propagate one trace across workflow -> activities [96] | Same OTel data, portable | AWS SDK integrations |
| Workflow forensics | Temporal Web UI: full replayable event history per site per day | Same (Temporal UI is independent) | No equivalent |
| Ops burden | Near zero | The point of comparison: you run it | Low, but AWS-locked |

**Selected: OpenTelemetry instrumentation everywhere, shipped to Grafana Cloud (free tier at
MVP) for metrics/traces/logs/alerting, plus Sentry Team (~$26/mo) for error tracking, plus the
Temporal Web UI for workflow-level forensics.** Total monitoring spend at MVP is about $26/month
[94][95]. Because instrumentation is OTel-standard, the self-hosted LGTM stack is a
configuration change, not a rewrite, when free-tier limits pinch at scale [94]. The Temporal Web
UI is the third leg and is effectively free explainability: it answers "what exactly did the
system do to customer X's site on a given day" from the workflow event history, directly serving
the SPEC's change-tracking and explainability requirements (NFR-3) [96]. The alert set is
defined in advance: workflow-failure and schedule-miss rates, retry exhaustion on GitHub/CMS
writes, queue depth and oldest-job age per tenant, LLM validation-failure rate, approvals
waiting past SLA, and every ROLLBACK decision as page-worthy.

### 3.18 Secret management

Traces to NFR-5. The Platform holds write-capable credentials for customers' production
repositories and CMSs; token custody is the core security design problem.

| Criterion | KMS envelope encryption (per-tenant DEKs in Postgres) | AWS Secrets Manager (per-tenant secrets) | HashiCorp Vault (self-hosted) |
|---|---|---|---|
| Mechanism | One CMK per environment; KMS generates per-tenant data keys; tokens encrypted AES-256-GCM; encrypted DEK stored beside ciphertext; DEK decryption only inside KMS HSMs [99] | Managed secret store, per-secret billing | Full secret-management platform (dynamic secrets, leases) |
| Cost at 1,000 tenants x 3 credentials | ~$1/key/mo + $0.03/10k API calls: roughly $1-5/mo [97] | $0.40/secret/mo + $0.05/10k calls: ~$1,200/mo [98] | Infra + significant ops (HA cluster, unsealing, upgrades) |
| Audit | Every key use CloudTrail-logged: independent, tamper-resistant record [99] | CloudTrail | Own audit backend |
| Rotation | Re-wrap DEKs under a new CMK version; automatic annual rotation supported [99] | Built-in rotation lambdas | Built-in |
| Fit | Per-customer tokens at scale | The ~10-30 platform-level secrets (GitHub App private key, provider API keys, DB creds: ~$4-12/mo) [98] | Justified only with a dedicated ops function or multi-cloud dynamic-secret needs |

**Selected: KMS envelope encryption for all per-customer credentials, with AWS Secrets Manager
retained for the ~20 platform-level secrets, and Vault rejected at this scale.** The cost
asymmetry is decisive, $1-5/month versus $1,200/month at 1,000 tenants [97][98], but the design
reasons matter as much: per-tenant data keys under one CMK give cryptographic tenant isolation;
CloudTrail logging of every decrypt supplies the credential-access audit spine NFR-5 demands
[99]; and decrypted DEKs live only in memory with short TTLs, wiped on job completion. The
GitHub App private key, the highest-value secret in the system since it mints tokens for every
customer installation, stays in Secrets Manager and is read only by an isolated token-mint
service. Vault would add a second stateful HA system for capabilities (dynamic database
credentials, multi-cloud leases) the Platform does not yet need; it is the revisit option if an
enterprise compliance regime demands it.

### 3.19 Object storage

Traces to FR-13.1-13.2, FR-16.2, NFR-2. Raw HTML never goes in the database (Section 3.4); it is
zstd-compressed, content-hash-keyed, and written to object storage as the before/after evidence
the change ledger and any rollback drift-check depend on. "S3-compatible" is a protocol, not a
product, and the products differ by an order of magnitude on the term that dominates here.

| Criterion | Cloudflare R2 | AWS S3 Standard | Backblaze B2 | Self-hosted MinIO |
|---|---|---|---|---|
| Storage | $0.015/GB-month; Infrequent Access $0.01/GB-month [103] | ~$0.023/GB-month list [104] | Low, comparable to R2 class | Disk cost only |
| **Egress** (the dominant term: analysis, diffing and validation workers re-read stored HTML on every cycle) | **$0** [103] | ~$0.09/GB [104] | Free up to 3x stored volume, then billed | $0 internal, plus the bandwidth you buy |
| Operations | Class A writes $4.50/M, Class B reads $0.36/M [103] | Per-request pricing | Per-request pricing | None |
| Free tier | 10 GB + 1M writes + 10M reads/month [103] | 5 GB, 12 months | 10 GB | n/a |
| Durability / lifecycle tiering | 11-nines class; IA tier for old crawl versions [103] | 11 nines; the deepest lifecycle/Glacier ladder [104] | 11-nines class | Yours to operate and prove |
| Portability | S3-compatible API | The reference API | S3-compatible API | S3-compatible API |
| Ops burden | None | None | None | A stateful cluster, replication and backups the small-team constraint cannot absorb |

**Selected: Cloudflare R2 behind an S3-compatible client, with lifecycle transition of superseded
crawl versions to the Infrequent Access tier.** The access pattern decides it: this is not cold
archival, it is a working set that the analyzer, the diff engine, the validator and the monitoring
loop read repeatedly, and R2 charges nothing for egress while S3 charges roughly $0.09/GB [103]
[104] — enough that egress, not storage, would become the line item. Storage itself is a rounding
error at every tier, and the two figures quoted in this document measure different things: a
compressed HTML body alone is ~15-25 kB, so ~2-2.5 GB and $0.03-0.04/month for a 100k-page site at
one retained version (Section 3.4), while a full page-version including extract JSON and an
optional screenshot is ~250 kB, so ~100 GB and about $1.50/month at four retained crawl versions
[103]. That is exactly why retention is set generously rather
than trimmed. Because every candidate speaks the S3 API, the choice is reversible in a config
change: AWS-native customers or an on-premises mandate move to S3 or MinIO without touching
application code, which is the reason the abstraction is written against the protocol even though
the recommendation names a product.

### 3.20 Tenancy model

Traces to NFR-5, NFR-2. Included because tenant isolation appears in the consolidated stack and a
selection that appears there must have been compared.

| Criterion | Pooled: one Postgres, `project_id` on every row + RLS | Schema-per-tenant (bridge) | Database or stack per tenant (silo) |
|---|---|---|---|
| Cross-tenant leak defense | Row-level security enforced by the database under a non-owner app role — isolation becomes a constraint, not a convention [120] | Schema boundary | Hard boundary |
| Ops at 500 tenants | One database, one migration | 500 migrations per schema change | Fleet management |
| Fit with the single system of record (Section 3.4) | Exact match — `project_id` is already on every table | Conflicts: the graph and vector work spans tenants in one worker | Conflicts |
| Cost | Lowest | Medium | Highest |
| Noisy-neighbor blast radius | Real: one heavy crawl import can affect neighbors. Mitigated with a staging-schema ingest path, per-tenant partitions on the big tables, and statement timeouts | Contained | Contained |

**Selected: pooled Postgres with `project_id` + row-level security, under a non-owner application
role, with per-tenant partitioning on the large tables as the fleet grows.** It is the only model
consistent with the single-Postgres decision of Section 3.4, and RLS converts tenant isolation
from something every query must remember into something the database enforces [120]. The silo
model stays on the shelf as the answer to a regulated enterprise buyer, priced as a per-tenant
deployment rather than pretended to be free.

### 3.21 Code-modification engine

Traces to FR-9.1, FR-10.1, FR-10.2, FR-12.1. The client flagged automated website modification as
one of the most important parts of the system; this is the component that performs it on the
Next.js/React path, and the single highest-leverage safety decision in the document.

| Criterion | ts-morph codemod, LLM supplies values | jscodeshift codemod, LLM supplies values | Babel transform only | Free-form LLM patch (search/replace or unified diff) | Whole-file LLM rewrite |
|---|---|---|---|---|---|
| Determinism | Full: same input, same diff [106][107] | Full [106] | Full | Medium — an exact-match apply gate is the only guarantee [108] | Low |
| What the model is trusted to produce | A JSON value payload (title string, meta description, alt text, JSON-LD object) — never syntax | Same | Same | Code | Code and the surrounding content |
| Measured correctness of LLM-authored transforms | n/a — the LLM does not author the transform | n/a | n/a | LLM-written codemods measured at 45.29% correct one-shot, ~54% after four refinement iterations [105] | Worse; the same evidence class |
| Type awareness | Yes — wraps the TypeScript compiler API, so a generated `Metadata` export can be checked to actually type-check [107] | No — recast-based AST-to-AST printing, style-preserving but type-blind [106] | No | No | No |
| Formatting fidelity | Good; project Prettier/ESLint pass closes the gap | Best (recast preserves original printing) [106] | Poor without extra work | Whatever the model emits | Whatever the model emits |
| Failure mode | Loud: no AST match means no edit | Loud | Loud | Rejectable pre-apply if the search text no longer matches | **Silent content loss** |
| Cost at scale | O(pages), cents | O(pages), cents | O(pages) | One LLM call per change, ~20K in / 2K out for repo context (Section 3.9) | Highest |
| Expressiveness ceiling | Structural edits: `<title>`/`metadata` exports, meta description, canonical, OG tags, JSON-LD insertion, `alt` attributes, `<h1>` changes in JSX | Same | Same | The residue: rewriting a heading block, adding an FAQ section in MDX | n/a |

**Selected: ts-morph codemods execute every change a transform can express, with the LLM
restricted to emitting the values those codemods inject; LLM-generated search/replace blocks with
exact-match apply are the narrow second tier for content-shaped edits; whole-file rewrite is never
used.** The evidence that forces the split is direct: vanilla LLM-written codemods are correct
about 45% of the time one-shot and still only around 54% after four refinement rounds [105], so
the component that touches syntax must be the deterministic one and the component that is
probabilistic must never touch syntax. That inversion is what makes LOW-risk auto-apply defensible
at all — a codemod either matches and applies cleanly or fails loudly, and there is no partially
wrong state to detect after the fact. ts-morph is preferred over jscodeshift on type information:
it wraps the TypeScript compiler API, so the pipeline can assert that a generated Next.js
`Metadata` export type-checks before the build stage ever runs [106][107]; jscodeshift's
recast-based printing preserves original formatting slightly better, which a project Prettier pass
neutralizes, and it remains the fallback for plain-JavaScript repos. Babel alone is rejected as a
half-tool here: it can transform, but it carries no type layer and no project-model API, so the
Platform would rebuild what ts-morph already provides. Free-form LLM patches survive only for
changes no transform can express, applied as search/replace blocks that are rejected outright and
regenerated if the search text does not match the file at apply time — never fuzzy-matched into
production code [108]. Commits are written through the GitHub GraphQL `createCommitOnBranch`
mutation with a required `expectedHeadOid`, so a concurrent human push makes the mutation fail
instead of clobbering the customer's work, and the resulting commits are automatically signed and
marked Verified as the GitHub App [100][118].

### 3.22 Validation toolchain

Traces to FR-12.1, FR-12.2, FR-10.2. Every automated change must pass SEO validation, HTML
validation, schema validation, application tests, build, and a performance test before deployment
(FR-12.1), and each stage must itself be automated (FR-12.2). Each stage below runs against a
**rendered preview build**, not against the source diff.

| Stage | Selected | Alternative(s) compared | Why the selection |
|---|---|---|---|
| SEO assertion | In-house meta-tag diff on the rendered preview `<head>` + re-run of the Platform's own analyzer | Trusting the codemod's intent; third-party audit tools | The novel check the product needs: assert the intended change is present **and that nothing else moved** (canonical, robots meta, hreflang, OG/Twitter, H1 count, internal links) — this catches the classic framework failure where editing one metadata field silently drops an inherited one |
| HTML validation | **Nu HTML Checker (v.Nu)** self-hosted (`vnu.jar`, Docker image, npm package) [109] | `html-validate` (pure JS, in-process, faster) | v.Nu is the engine behind validator.w3.org and is the conformance reference; `html-validate` is retained as the fast in-process pre-filter, not as the authority |
| Structured data | **Self-built**: JSON-LD extraction from the rendered DOM, syntax validation, schema.org type checking, plus an in-house rule-pack for Google's rich-result feature requirements | Google Rich Results Test; Google schemarama; GSC URL Inspection API | Rich Results Test **has no public API** (the Structured Data Testing Tool API died in Dec 2020 and was never replaced) [110] and schemarama was archived Oct 22, 2025 and is explicitly not production-recommended [111]; URL Inspection returns real `richResultsResult` verdicts but only for **indexed** URLs, so it is the post-deploy verifier within its 2,000-inspections/day/property budget, never a preview gate |
| Performance / SEO scoring | **Lighthouse CI** (`lhci autorun`) against the preview URL, asserting category floors, audit-level assertions (`document-title`, `meta-description`, `canonical`, `is-crawlable`), `budgets.json`, and `median-run` over >=3 runs [112] | Raw PageSpeed Insights API | LHCI supplies the assertion config, resource budgets, per-URL-pattern `assertMatrix` and variance damping PSI has no equivalent for; the primary assertion is **no regression against a stored per-page-class baseline**, because absolute scores vary by site and absolute gates false-positive |
| Link checking | **lychee** (Rust, async, validates anchor fragments) scoped to links in the diffed pages [113] | linkinator (Node, site-crawl oriented); the Platform's own crawler | Fragment checking catches broken `#section` anchors that crawler-based checks miss; full-site link audits stay with the crawler, where they belong |
| Static + build gates | Changed-file allowlist, diff budget, ESLint, `tsc --noEmit`, then `npm install && npm run build` in an ephemeral, egress-restricted, single-tenant sandbox | Relying on the customer's own CI | A customer's `npm install` is arbitrary code execution (postinstall scripts), so the build must be sandboxed with no platform secrets mounted; the customer's CI is respected as *their* required check but cannot be the Platform's only gate, because it may not exist |

**Selected: v.Nu for HTML conformance, a self-built JSON-LD/schema.org validator, Lighthouse CI
with baseline-relative assertions, and lychee for links — every stage asserted on a rendered
preview and reported back as a named GitHub Check run** (`seo-platform/build`,
`seo-platform/seo-validation`, ...), so customers can mark the Platform's own validation as a
required check in branch protection and turn it into a server-enforced gate. The one stage that
had to be built rather than bought is structured-data validation, and that is a permanent
condition rather than a gap to revisit: with no Rich Results API and schemarama archived, the
in-house rule-pack needs a named maintenance owner and a scheduled diff against Google's
published feature requirements [110][111].

### 3.23 Repo integration, preview deployment, and rollback

Traces to FR-9.1, FR-10.1, FR-14.1-14.3, NFR-5.

| Decision | Selected | Compared against | Why |
|---|---|---|---|
| Repo credential model | **GitHub App**, per-installation, with a single-repo minimum-permission installation token minted per pipeline run (1-hour expiry) | OAuth App (all-or-nothing classic scopes, token lives until revoked); fine-grained PAT | Fine-grained PATs **cannot call the Checks API** and cap at 50 tokens per account with no multi-org access — disqualifying for a SaaS [114]; per-installation rate buckets mean one customer's PR burst cannot exhaust another's API budget [115]; only the App path yields auto-signed commits. An OAuth user token is retained for exactly one job: identifying the human who connects the repo |
| Preview target | **Vercel** `POST /v13/deployments` with `gitSource` for Next.js customers; **Netlify** Deploy Previews (`draft: true` builds that never touch the live site) where the customer is on Netlify | Building and serving previews on our own infrastructure | The customer's own host produces a build identical to what production will run; a self-hosted preview stage is real scope that becomes necessary only for custom hosts, and is flagged as such [116][117] |
| Throughput ceiling to plan around | Vercel: 100 deployments/day on Hobby, 6,000 on Pro, 45-minute build cap; Netlify: 3 deploys/min, 100 API deploys/day [116][117] | — | A customer on a Hobby plan caps the whole validation pipeline at ~100 changes/day for that site; the product must either require a paid hosting tier or batch validations, and must say so at onboarding |
| Rollback | **Two-speed**: platform instant rollback (Vercel Instant Rollback / Netlify deploy restore) for emergencies, always followed by a durable `revertPullRequest` git revert PR | Git revert only; platform rollback only | Instant rollback bounds harm in seconds but is a routing-level change that leaves stale env/cron state and disables production auto-assignment until undone; the revert PR runs the full check suite and leaves an auditable ledger entry, but takes CI minutes. Neither alone is sufficient [100][119] |

**Selected: GitHub App with per-run down-scoped installation tokens, preview deployment on the
customer's own host, and two-speed rollback.** The residual risks are named rather than smoothed
over: the Vercel instant-rollback endpoint is not in the public REST reference and must be wrapped
behind an adapter with the git-revert path as the guaranteed fallback [119]; a repo whose branch
protection requires human review turns "auto-apply" into "auto-PR", which caps the achievable
automation level per customer and must be surfaced honestly rather than reported as a platform
capability; and customers on non-Vercel, non-Netlify hosts require the Platform to ship its own
build-and-serve preview stage, which is scope the estimate must carry.

---

## 4. Consolidated chosen stack

| Layer | Component | Selection | Key parameters | Scale trigger / revisit condition |
|---|---|---|---|---|
| Runtime | Language/platform | Node.js / TypeScript for every service, **except one Python batch analysis worker** | One team, shared types across the pipeline; the codemod engine must be Node because it edits TypeScript ASTs | The Python worker exists only because `rustworkx`/igraph and GLiNER have no Node equivalent (§3.0, §3.7); it disappears if graphology clears a POC benchmark on a 10M-edge graph |
| Acquisition | Crawler | Crawlee (TS): CheerioCrawler default, PlaywrightCrawler escalation | Adaptive rendering predictor, ~10% re-sampling; static-first | Apify platform as zero-rework burst target; Firecrawl for hostile edge cases |
| Acquisition | Rendering strategy | Static-first hybrid | ~90% static fetches; per-template escalation | Full-render audit of template representatives on schedule |
| Work distribution | Orchestration backbone | Temporal (TS SDK), Temporal Cloud | $100/mo floor; coarse phases only; durable 14-60-day monitors; signal approval gates; fairness keys | Self-host evaluation only past ~$1.5-2k/mo; Hatchet if a self-host mandate lands |
| Work distribution | Job queue | BullMQ | Page-level jobs only; never the frontier, never loop state | BullMQ Pro groups if queue-layer tenant fairness needed |
| Work distribution | Redis-protocol store | Valkey 9 | One instance: queue + politeness + locks + rate limits | Dragonfly if single-thread saturates |
| Data | Primary database | PostgreSQL 16+ | System of record: pages, links, keywords, GSC facts, change ledger; RLS for tenancy | Partitioning per tenant on big tables as fleet grows |
| Data | Vector store | pgvector (halfvec 1536 + HNSW) | Filtered ANN in-SQL | pgvectorscale or Qdrant past ~5-10M total vectors |
| Data | Search engine | Postgres FTS | pg_search (BM25) as in-database upgrade | OpenSearch only at 100M+-row analytics UIs |
| Data | Graph analytics | rustworkx/igraph in the post-crawl **Python** analysis worker | PageRank, CheiRank, HITS, depth, components; written back as columns; the stack's only non-Node service | Memgraph only if interactive graph exploration ships as a feature; graphology if the polyglot boundary is refused (benchmark-gated) |
| Data | Object storage | **Cloudflare R2** via the S3-compatible API; zstd-compressed raw HTML | $0.015/GB-mo, **zero egress** (workers re-read constantly); ~$0.03-0.04/mo per 100k-page site for compressed HTML at one version, ~$1.50/mo at four retained page-versions with extracts and screenshots; before/after evidence [103] | Lifecycle-tier superseded crawl versions to Infrequent Access; swap to S3/MinIO for AWS-native or on-prem mandates (same API) |
| Intelligence | AI providers | Anthropic-first (Haiku 4.5 / Sonnet 5 / Opus 5), OpenAI + Gemini adapters | Schema-enforced typed ops; Batch API 50%; prompt caching (>4K cached prefix + 2-4K volatile blocks); ~$27.50-82.50 generation / ~$33-88 all-in per 10k-page pass | Re-verify pricing quarterly; adapter enables provider swap |
| Intelligence | Embeddings | OpenAI text-embedding-3-small | $0.02/M; ~$0.30/10k pages; re-embed on content-hash change | Version column guards model deprecation |
| Intelligence | Entity extraction | Cheap-LLM structured pass | ~$0.002/page; GLiNER as drift baseline | Pin model versions; snapshot outputs |
| External data | GSC (mandated, not selected) | Search Analytics API, nightly warehouse; BigQuery bulk export for enterprise | 1,200 QPM per site and per user [125]; **50,000 rows/day per site per search type**, returned top-by-clicks, so long-tail-heavy sites truncate [126]; 16-month rolling retention, escaped by warehousing every pull [126] | Bulk export for tenants hitting truncation (detect when row count equals the cap) |
| External data | SERP/keyword vendor (**post-MVP spend**; abstraction built day one) | DataForSEO + Serper behind `SerpProvider` abstraction | $0.60/1k SERPs; ~$0.06/1k volumes; ~$0.02-0.05 per keyword analyzed | Live spend gated on Doc 01 open question 4 (MVP runs GSC-only, null provider); litigation watch; multi-vendor failover wired from day one |
| Change application | Code-modification engine | ts-morph codemods executing LLM-supplied values; LLM search/replace blocks only where no codemod fits | LLM never authors syntax (LLM-written codemods are ~45% correct one-shot [105]); `createCommitOnBranch` + `expectedHeadOid`; one logical change per PR | jscodeshift for plain-JS repos; a new codemod per fix type, not a new engine |
| Change application | Repo integration | GitHub App, per-run single-repo installation tokens (1 h) | Checks API + auto-signed commits + per-installation rate isolation [114][115] | WordPress REST and Shopify Admin adapters sit behind the same Change Application Layer |
| Change application | Validation toolchain | v.Nu HTML checker + self-built JSON-LD/schema.org validator + Lighthouse CI + lychee, all on a rendered preview | Baseline-relative LHCI assertions, `median-run` >=3; results posted as required GitHub Checks [109][112][113] | Rich Results Test has no API — the in-house schema rule-pack needs a maintenance owner [110][111] |
| Change application | Preview deploy + rollback | Vercel `POST /v13/deployments` / Netlify draft deploys; two-speed rollback (instant + `revertPullRequest`) | Vercel 100/day Hobby vs 6,000/day Pro, 45-min build cap [116]; Netlify 100 API deploys/day [117] | Own build-and-serve preview stage required for custom hosts; instant-rollback endpoint is semi-documented, adapter-wrapped [119] |
| Platform | Frontend | Next.js 16 (App Router), self-hosted Docker | Tailwind + headless components; TanStack Query | None |
| Platform | API | NestJS 11 on Fastify | Guards for tenancy/RBAC; first-party OpenAPI | tRPC as optional internal BFF later |
| Platform | Auth | Clerk | Free to 50k users; orgs; $75/SSO connection | Better Auth exit path; Keycloak for on-prem mandates |
| Platform | Tenancy | Pooled Postgres, `project_id` + RLS (§3.20) | Non-owner app role; session-variable policies | Silo option for regulated enterprise tenants, priced as a per-tenant deployment |
| Operations | Observability | OTel -> Grafana Cloud + Sentry Team + Temporal Web UI | ~$26/mo at MVP | Self-hosted LGTM stack when free tier pinches |
| Operations | Secrets | KMS envelope (per-tenant DEKs) + Secrets Manager (platform secrets) | ~$1/mo CMK + $0.03/10k calls; CloudTrail audit | Vault only under enterprise compliance demands |

Every row above except two is the outcome of a comparison in Section 3. The two exceptions are
marked in the table and stated here so the distinction is not left to the reader: **GSC is
mandated, not selected** — Doc 01's MVP scope names it as the sole external data source, so its
quotas are a constraint to design against rather than a choice between vendors; and the
**SERP/keyword vendor is selected but not yet funded**, per the phase marker in Section 3.11.

---

## 5. Cost posture at the three mandated scale tiers

NFR-2 and NFR-6 require the Platform to run from 100 to 100,000+ pages with bounded cost, and
Section 1 scores every component against it. Section 3 argues cost per component at MVP; this
section is where the three tiers come together. Full line-by-line modelling, including onboarding
one-time costs, is in Doc 06 — the figures below are steady-state monthly per site, and the
component lines are *modelled* from the unit prices cited in Section 3 rather than quoted from a
vendor's bundle.

| Line | 100 pages | 10,000 pages | 100,000+ pages | Basis |
|---|---|---|---|---|
| Crawl compute | ~$0.10 | $2-20 | $20-150 (includes the headless subset) | Fargate unit prices, static-first [122] |
| Object storage | $0 (free tier) | $1-5 | $4-20 | R2 $0.015/GB-mo, zero egress; multi-version retention (~$1.50/mo storage at four page-versions) plus Class A/B operations [103] |
| Postgres + pgvector | $0-19 | $40-110 | $150-450 (dedicated) | Neon / Supabase [123][124] |
| AI (analysis + metadata + briefs) | $3-10 | $50-200 | $250-800 | Tiered routing + Batch API, §3.9 [49][51] |
| Embeddings | $0 | $0-2 | $4-12 per full re-index | text-embedding-3-small, §3.10 [53] |
| SERP + keyword data (**post-MVP**; not spent at MVP) | $3-8 | $20-60 | $90-400 | DataForSEO/Serper, §3.11 [60][62] |
| GSC | $0 | $0 | $0 | Free first-party API [125] |
| Workers, queue, API share | $10-30 | $75-150 | $300-800 | §3.3, §3.14, §3.16 |
| Search (optional OpenSearch) | $0 | $0 | $0-350 | Only past the 100M-row trigger, §3.5 [24] |
| Monitoring + validation CI | $0 | $25-75 | $50-200 | Grafana free tier + Sentry, §3.17 [94][95] |
| **Steady-state total (post-MVP inclusive — carries the SERP line)** | **~$20-70/mo** | **~$250-600/mo** | **~$900-2,800/mo** | |
| **MVP total, GSC-only (SERP line removed)** | **~$17-62/mo** | **~$230-540/mo** | **~$810-2,400/mo** | The row above minus the SERP line; pilot sites run GSC-only, §3.11 |

Three components carry essentially all of the tier scaling — crawl compute, AI spend, and
Postgres/vector storage — and each has a named architectural control rather than a hope: static-first
crawling (about 10x cheaper per page than rendering [1]), content-hash change detection so
steady-state nightly cycles touch 1-5% of a site rather than all of it, model tiering with the
flat 50% Batch discount [51], sampled recrawls by page importance, and per-tenant budget caps.
The remaining lines are close to flat across tiers: object storage stays under $20/month even at
100k+ pages with four retained versions, embeddings are noise at ~$3 per 100k pages re-embedded,
and GSC is free. Two totals are published rather than one because the SERP/keyword line is
post-MVP spend (§3.11): the **~$20-70/mo** small-tier figure is the steady-state envelope with that
line included, and the **~$17-62/mo** figure is what a GSC-only MVP pilot actually costs — the
number to check acceptance against while open question 4 is unanswered. Doc 06 carries
the sensitivity analysis and the onboarding one-time figures.

---

## 6. Glossary

Short definitions of terms used above, for readers coming to the stack cold.

| Term | Meaning in this document |
|---|---|
| ANN | Approximate nearest neighbour — vector search that trades exactness for speed |
| BFF | Backend-for-frontend — an API layer shaped for one client rather than for general use |
| BM25 | The standard relevance-ranking function for keyword search; what Elasticsearch and `pg_search` implement |
| CheiRank | PageRank computed on the reversed link graph; measures outbound authority rather than inbound |
| CMK / DEK | Customer master key / data encryption key — in envelope encryption, the CMK never leaves the KMS hardware and is used only to wrap per-tenant DEKs, which do the bulk encryption |
| Codemod | A programmatic, deterministic transformation of source code applied through its syntax tree |
| COGS | Cost of goods sold — here, the per-customer variable cost of running the Platform |
| CTE (recursive) | A SQL construct that walks a graph inside the database; used for the interactive link-path queries |
| GSC | Google Search Console — the Platform's primary, free, first-party performance data source |
| HITS | A link-analysis algorithm producing separate "hub" and "authority" scores per page |
| HNSW | Hierarchical Navigable Small World — the graph index pgvector uses for approximate nearest-neighbour search |
| `halfvec` | pgvector's 16-bit float vector type; half the storage of `vector` at negligible retrieval loss |
| MRL | Matryoshka Representation Learning — embeddings trained so a truncated prefix (e.g. the first 512 of 1,536 dimensions) remains usable |
| MTEB | Massive Text Embedding Benchmark — the standard public leaderboard for embedding quality |
| NER | Named-entity recognition — extracting people, products, brands and topics from text |
| RSC | React Server Components — the Next.js App Router rendering model |
| RLS | Row-level security — Postgres policies that filter every query by tenant at the database level |
| SERP | Search engine results page |
| `tsvector` | Postgres's built-in full-text search type |
| v.Nu | The Nu HTML Checker, the validation engine behind validator.w3.org |

---

## Sources

Entries [1]-[99] are ordered by first citation in the original draft; [100]-[126] were added with
the sections and figures noted against them and are appended rather than interleaved so that every
existing citation number remains stable.

1. https://use-apify.com/docs/what-is-apify/apify-compute-units — Apify compute-unit benchmark: ~3,000 pages/CU static vs ~300 pages/CU browser
2. https://tech-insider.org/playwright-vs-puppeteer-2026/ — npm weekly downloads 57.6M (Playwright) vs 10.7M (Puppeteer)
3. https://crawlee.dev/js/api/playwright-crawler/class/AdaptivePlaywrightCrawler — AdaptivePlaywrightCrawler rendering-type detection, `renderingTypeDetectionRatio` default 0.1
4. https://crawlee.dev/js/docs/experiments/experiments-request-locking — RequestQueueV2 request locking for multi-process crawling
5. https://github.com/apify/crawlee/pull/2214 — Crawlee robots.txt + sitemap utilities (`respectRobotsTxtFile`, sitemap discovery)
6. https://www.firecrawl.dev/pricing — Firecrawl plans: 1 credit/page; Standard $83/mo for 100k credits
7. https://www.eesel.ai/blog/firecrawl-pricing — Firecrawl subscription-only since June 2026; credits don't roll over
8. https://scrapegraphai.com/blog/apify-pricing — Apify 2026 plan pricing and effective CU rates
9. https://www.searchviu.com/en/javascript-crawling-study-rendered-html-vs-original-source-code/ — 200-domain study: 96% of domains / 56% of URLs differ raw-vs-rendered in SEO-relevant areas
10. https://dev.to/extractdata/how-to-tell-if-a-page-uses-javascript-rendering-and-what-to-do-about-it-5af8 — JS-rendering detection heuristics; AI crawlers do not execute JavaScript
11. https://www.dragonflydb.io/guides/bullmq-vs-rabbitmq — BullMQ features (delays, priorities, flows, rate limiting) vs AMQP
12. https://oneuptime.com/blog/post/2026-01-21-bullmq-vs-other-queues/view — queue comparison; SQS 15-minute delay cap
13. https://aws.amazon.com/sqs/pricing/ — SQS 1M free requests/mo, standard request pricing
14. https://docs.bullmq.io/bullmq-pro/groups/concurrency — BullMQ Pro per-group concurrency (global across workers)
15. https://oneuptime.com/blog/post/2026-03-31-redis-vs-rabbitmq-for-job-queues/view — Redis/BullMQ as pragmatic default; RabbitMQ delayed-message caveats
16. https://oneuptime.com/blog/post/2026-03-31-mongodb-what-is-graphlookup-and-when-to-use-it-in-mongodb/view — `$graphLookup` 100 MB per-stage limit, no disk spill
17. https://jaesolshin.com/posts/lightrag-pg-rcte/ — recursive CTE 22.5K RPS vs Neo4j 14.5K (GraphRAG OLTP mix)
18. https://github.com/pgvector/pgvector — pgvector types (vector/halfvec), HNSW, iterative index scans
19. https://www.mongodb.com/products/platform/atlas-vector-search — Atlas Vector Search capabilities
20. https://www.revolveagency.co.uk/post/enterprise-seo-tools-ranked-by-crawl-depth-and-data-export-flexibility — Botify/Lumar BigQuery-native; OnCrawl Elasticsearch export architecture
21. https://www.tigerdata.com/blog/you-dont-need-elasticsearch-bm25-is-now-in-postgres — BM25-in-Postgres landscape; pg_search ~20x ts_rank at 1M rows
22. https://www.paradedb.com/blog/elasticsearch-vs-postgres — pg_search (BM25/Tantivy) as Elasticsearch alternative in Postgres
23. https://pulse.support/kb/opensearch-vs-elasticsearch — licensing: Elastic AGPLv3/ELv2/SSPL vs OpenSearch Apache 2.0
24. https://aws.amazon.com/opensearch-service/pricing/ — managed OpenSearch instance pricing; Serverless OCU minimums
25. https://clickhouse.com/resources/engineering/scale-vector-search-postgres — pgvector memory limits, HNSW sizing at 10M x 1536, degradation thresholds
26. https://www.dbi-services.com/blog/pgvector-a-guide-for-dba-part-2-indexes-update-march-2026/ — HNSW index sizing at scale
27. https://leanopstech.com/blog/qdrant-cloud-pricing-2026/ — Qdrant vs Pinecone cost curves ($114/mo @1M, $456 @10M, 32% saving @50M)
28. https://spendark.com/blog/vector-database-pricing/ — Pinecone serverless units ($0.33/GB, $8.25/1M RU, $2/1M WU; filtered queries 5-10 RU)
29. https://www.tigerdata.com/blog/pgvector-is-now-as-fast-as-pinecone-at-75-less-cost — pgvectorscale 50M-vector benchmark: 28x lower p95, 16x throughput vs Pinecone s1, 75% cheaper
30. https://github.com/timescale/pgvectorscale — StreamingDiskANN + statistical binary quantization
31. https://graph-tool.skewed.de/performance.html — PageRank on LiveJournal (4.8M nodes/69M edges): igraph 10.6 s, NetworkX 2,720 s
32. https://www.rustworkx.org/benchmarks.html — rustworkx 3-100x vs NetworkX
33. https://www.puppygraph.com/blog/memgraph-vs-neo4j — Neo4j AuraDB from ~$65/GB/mo; Memgraph Enterprise ~$25k/yr (16 GB)
34. https://docs.temporal.io/cloud/pricing — Temporal Cloud pricing: Essentials $100/mo floor, 1M actions included, $50/M actions
35. https://github.com/temporalio/documentation/blob/main/docs/develop/task-queue-priority-fairness.mdx — Temporal fairness keys, weights, per-key RPS limits
36. https://arpitbhayani.me/blogs/temporal-primer/ — durable 30-day sleep semantics surviving restarts
37. https://temporal.io/blog/human-in-the-loop-approvals — signal-based approval pattern; durable approval timers
38. https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/workflow/workflow-execution/event.mdx — 51,200-event / 50 MB workflow history limits
39. https://automationatlas.io/answers/temporal-self-hosted-pricing-2026/ — MIT license; $400-900/mo small-production self-host infra estimate
40. https://www.inngest.com/pricing — Inngest Hobby free 50k executions; Pro $99/mo 1M executions, 100 concurrency, $25/25 additional
41. https://www.inngest.com/docs/features/inngest-functions/steps-workflows/sleeps — Inngest sleep up to 1 year
42. https://trigger.dev/pricing — Trigger.dev tiers, per-second compute, $0.25/10k runs, no task timeouts
43. https://trigger.dev/docs/self-hosting/overview — self-hosting loses checkpoints, warm starts, auto-scaling; v3 EOL
44. https://cloudburn.io/tools/aws-step-functions-pricing-calculator — Step Functions $0.025/1k state transitions, 4k free
45. https://medium.com/chronicles-of-a-cloud-engineer/from-450-to-1-part-0-5-intro-to-step-function-activities-2af295c4e89f — transition-count cost trap ($450 to ~$1 refactor)
46. https://hatchet.run/pricing — Hatchet free 100k runs, $10/M runs, Team $500/mo (5 tenants), Scale $1,000/mo
47. https://docs.hatchet.run/v1/architecture-and-guarantees — Hatchet Postgres-backed durability, self-host architecture
48. https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows — agent frameworks: no failure detection, no distributed coordination, single-process
49. https://platform.claude.com/docs/en/about-claude/models/overview — Anthropic model lineup and pricing (Opus 5 / Sonnet 5 / Haiku 4.5)
50. https://platform.claude.com/docs/en/build-with-claude/structured-outputs — Anthropic structured outputs (`output_config.format`, strict tool use, schema limits, 24h schema cache)
51. https://platform.claude.com/docs/en/build-with-claude/batch-processing — Anthropic Batch API 50% discount
52. https://platform.claude.com/docs/en/build-with-claude/prompt-caching — Anthropic prompt caching (~0.1x reads; per-model minimum prefixes)
53. https://developers.openai.com/api/docs/pricing — OpenAI API pricing (gpt-5.6 family, gpt-5-mini/nano, embeddings, batch 50%, cached 10%)
54. https://openai.com/index/introducing-structured-outputs-in-the-api/ — OpenAI structured outputs (json_schema strict, token masking)
55. https://ai.google.dev/gemini-api/docs/pricing — Gemini API pricing (3.6/3.5 Flash, Flash-Lite, 3.1 Pro preview, batch)
56. https://ai.google.dev/gemini-api/docs/interactions/structured-output — Gemini `responseSchema` constrained decoding; layer validation downstream
57. https://arxiv.org/abs/2508.06225 — Overconfidence in LLM-as-a-Judge (verbalized confidence clusters 80-100% regardless of correctness)
58. https://pecollective.com/tools/text-embedding-models-compared/ — embedding model specs/pricing comparison 2026 (OpenAI, Cohere, Voyage)
59. https://tokenmix.ai/blog/text-embedding-models-comparison — Google text-embedding-005 $0.006/M
60. https://dataforseo.com/apis/serp-api/pricing — DataForSEO SERP pricing ($0.60/$1.20/$2.00 per 1k; $50 minimum deposit)
61. https://docs.dataforseo.com/v3/keywords_data-google_ads-search_volume-live/ — search volumes: 1,000 keywords/request, $0.09 live / $0.06 standard
62. https://serper.dev/ — Serper credit packs, 2,500 free credits, endpoint list
63. https://apiserpent.com/blog/serp-api-pricing-comparison — cross-provider SERP pricing (Serper packs, SerpApi tiers)
64. https://costbench.com/software/web-scraping/serpapi/ — SerpApi plan grid ($25/1k to $275/30k, monthly reset)
65. https://thatmarketingbuddy.com/blog/semrush-api-pricing — Semrush $549/mo plan floor, ~$0.01/unit, 1-month caching limit
66. https://docs.ahrefs.com/api/docs/limits-consumption — Ahrefs API v3 unit budgets, min 50 units/request, per-row/field costs
67. https://developers.google.com/google-ads/api/docs/api-policy/access-levels — Google Ads API access tiers and permissible use
68. https://ppc.land/google-faces-developer-token-application-backlog-as-new-api-tier-debuts/ — Explorer tier blocks KeywordPlan services
69. https://almcorp.com/blog/google-sues-serpapi-lawsuit-analysis/ — Google v. SerpApi (Dec 19, 2025, DMCA §1201, SearchGuard)
70. https://cryptobriefing.com/reddit-serpapi-lawsuit-survives-dismissal/ — Reddit v. SerpApi/Oxylabs: motion to dismiss largely denied Jul 31, 2026
71. https://devtk.ai/en/models/gemini-2-5-flash-lite/ — Gemini 2.5 Flash-Lite $0.10/$0.40 per M tokens; retirement Oct 16, 2026
72. https://nlpcloud.com/google-cloud-natural-language-nlp-api.html — Google NL API entity pricing (~$1.00/1k units after free tier); v2 dropped salience/wikipedia_url
73. https://arxiv.org/abs/2311.08526 — GLiNER: 50-300M params, zero-shot NER outperforming ChatGPT-class models
74. https://nextjs.org/blog — Next.js 16.3 released Aug 3, 2026
75. https://nextjs.org/blog/july-2026-security-release — formal security-release program; Active/Maintenance LTS lines; HIGH CVEs patched
76. https://nextjs.org/docs/app/getting-started/deploying — Node/Docker self-hosting supports all features; verified adapters
77. https://reactrouter.com/ — React Router v8, non-breaking from v7
78. https://tanstack.com/start/latest — TanStack Start: Release Candidate status
79. https://github.com/nestjs/nest/releases — NestJS v11.1.29 (Aug 10, 2026); monthly patch cadence; platform-fastify maintenance
80. https://fastify.dev/ — Fastify v5.11.x; ~30k req/s class; schema-compiled validation
81. https://hono.dev/ — Hono web-standards framework, multi-runtime
82. https://clerk.com/pricing — Clerk free 50k users; Pro $25/mo + $0.02/user; SAML $75/mo/connection
83. https://clerk.com/docs/organizations/overview — Clerk Organizations: memberships, roles, invitations, verified domains
84. https://auth0.com/pricing — Auth0 free 25k MAU; B2B Essentials $150/mo @500 MAU to $3,800/mo @20k
85. https://workos.com/pricing — WorkOS AuthKit 1M MAU free; SSO $125/connection/mo
86. https://www.better-auth.com/ — Better Auth: open-source TS auth; orgs/SSO/SCIM plugins; joining Vercel
87. https://www.keycloak.org/ — Keycloak 26.7.1; CNCF incubating; OIDC/OAuth2/SAML
88. https://valkey.io/ — Valkey 9.1.1; BSD-3; Linux Foundation; AWS/Google managed support
89. https://aws.amazon.com/elasticache/pricing/ — ElastiCache Serverless Valkey $0.084/GB-hr (-33% vs Redis OSS); node-based -20%
90. https://redis.io/legal/licenses/ — Redis >=8.0 tri-license RSALv2/SSPLv1/AGPLv3
91. https://docs.bullmq.io/guide/redis-tm-compatibility — BullMQ requires Redis >=6.2; Dragonfly officially tested
92. https://www.dragonflydb.io/docs/integrations/bullmq — Dragonfly BullMQ integration flags and hashtag queue naming
93. https://upstash.com/pricing — Upstash PAYG $0.20/100k commands; fixed tiers
94. https://monitoringcost.com/grafana-cloud-pricing — Grafana Cloud free tier (10k series, 50 GB logs/traces, 14-day retention); Pro rates
95. https://sentry.io/pricing/ — Sentry Developer free / Team $26/mo (50k errors, 5M spans)
96. https://docs.temporal.io/develop/typescript/observability — Temporal Prometheus/OTLP metrics, OTel tracing interceptors
97. https://aws.amazon.com/kms/pricing/ — AWS KMS $1/key/mo, $0.03/10k requests, 20k free
98. https://aws.amazon.com/secrets-manager/pricing/ — AWS Secrets Manager $0.40/secret/mo, $0.05/10k calls
99. https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html — KMS envelope encryption, data keys, CloudTrail logging
100. https://docs.github.com/public/fpt/schema.docs.graphql — GitHub public GraphQL schema (`createCommitOnBranch`, `revertPullRequest`, `expectedHeadOid`) — the Node-side integration surface, §3.0
101. https://nextjs.org/docs/app/building-your-application/optimizing/metadata — Next.js `metadata` export: the structure the codemod edits, §3.0
102. https://scrapy.org/ — Scrapy: mature Python crawl framework, JS rendering via the `scrapy-playwright` bolt-on, §3.0
103. https://developers.cloudflare.com/r2/pricing/ — Cloudflare R2: $0.015/GB-month, Infrequent Access $0.01, Class A $4.50/M, Class B $0.36/M, **zero egress**, 10 GB free tier
104. https://aws.amazon.com/s3/pricing/ — AWS S3 Standard: ~$0.023/GB-month list plus ~$0.09/GB egress; lifecycle/Glacier tiers
105. https://codemod.com/blog/iterative-ai-system — LLM-written codemods measured at 45.29% correct one-shot (jscodeshift), rising only to ~54% after four refinement iterations
106. https://github.com/facebook/jscodeshift — jscodeshift: recast-based, style-preserving AST-to-AST transformation
107. https://carlrippon.com/codemods-for-react-typescript/ — ts-morph as a TypeScript compiler API wrapper: type-aware codemods for React/TypeScript
108. https://aider.chat/docs/more/edit-formats.html — LLM edit-format research: whole-file rewrite slow/lossy, search-replace blocks efficient, unified diff reduces lazy elision
109. https://github.com/validator/validator — Nu Html Checker (v.Nu): the engine behind validator.w3.org; `vnu.jar`, Docker image, npm package, self-hostable service
110. https://developers.google.com/search/blog/2020/12/structured-data-testing-tool-update — Structured Data Testing Tool API deprecated Dec 2020 and never replaced; Rich Results Test has no public API
111. https://github.com/google/schemarama — Google schemarama (ShEx/SHACL schema.org validation) archived Oct 22, 2025; explicitly not production-recommended
112. https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md — Lighthouse CI assertions, `budgets.json`, `assertMatrix`, `median-run` aggregation
113. https://github.com/lycheeverse/lychee — lychee: fast async link checker with anchor-fragment validation
114. https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens — fine-grained PATs: single org, 50-token cap, no Checks API
115. https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps — GitHub App rate limits: 5,000-12,500/hr **per installation** (per-tenant isolation)
116. https://vercel.com/docs/limits — Vercel deployment limits: 100/day Hobby, 6,000/day Pro, 45-minute build cap, concurrency
117. https://docs.netlify.com/deploy/deploy-types/deploy-previews/ — Netlify Deploy Previews per PR; `draft: true` builds that do not touch the live site; 100 API deploys/day
118. https://github.blog/changelog/2021-09-13-a-simpler-api-for-authoring-commits/ — `createCommitOnBranch`: `expectedHeadOid` concurrency guard, automatically signed/Verified commits
119. https://vercel.com/docs/instant-rollback — Vercel Instant Rollback: seconds to revert routing; disables production auto-assignment until undone; stale env/cron caveats
120. https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/ — Postgres RLS for multi-tenant isolation: policies, `current_setting`, `BYPASSRLS`, pooling caveats
121. https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement — Bing Search APIs retired **August 11, 2025**; Azure-locked replacement priced 40-483% higher
122. https://aws.amazon.com/fargate/pricing/ — AWS Fargate us-east-1 $0.0404/vCPU-hr + $0.0044/GB-hr (ARM ~20% cheaper, Spot to -70%) — the basis for all modelled crawl-compute figures
123. https://neon.com/pricing — Neon Postgres: free tier, Launch $0.106/CU-hr + $0.35/GB-month, Scale $0.222/CU-hr; scale-to-zero
124. https://supabase.com/pricing — Supabase Pro $25/mo plus compute add-ons; disk $0.125/GB
125. https://developers.google.com/webmaster-tools/limits — GSC API quotas: Search Analytics 1,200 QPM per site and per user; 40,000 QPM / 30M QPD per project; URL Inspection 2,000/day + 600/min per property
126. https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data — Search Analytics pagination: 25,000 rows per request, **~50,000 rows per day per site per search type**, returned top-by-clicks; 16-month rolling retention
