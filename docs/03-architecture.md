# Architecture Document — Autonomous SEO Optimization Platform

Document 03 of 07 · Autonomous SEO Optimization Platform · Planning Package

Status: Draft for review · Traces to requirement IDs in Doc 01 (Requirements Analysis) · Technology
selections are justified by compared alternatives in Doc 04 (Technology Comparison); this document
states each pick and the load-bearing reason, not the full comparison.

---

## 1. Executive summary

This document answers SPEC §19: the complete system architecture that runs the loop
**Discover → Analyze → Identify → Decide → Optimize → Validate → Deploy → Monitor → Measure →
Re-optimize** autonomously and safely, across the required chain of Frontend, API, Authentication,
Project Management, Crawler, Queue, SEO Analyzer, AI Engine, Decision Engine, Optimization Engine,
Validation Engine, Deployment Engine, and Monitoring.

Seven architectural theses define the design:

1. **One runtime, with one named exception.** Node.js/TypeScript end to end: frontend (Next.js 16),
   API (NestJS 11 on Fastify), crawler (Crawlee), workers, and codemods share one language, one type
   system, one team. The exception is a single **Python batch analysis worker** (graph scoring via
   rustworkx/igraph, GLiNER NER fallback — neither has Node bindings), so anyone costing staffing or
   deployment off this document should plan for two runtimes, not one (D-39; §2.7, §8).
2. **One system of record.** PostgreSQL 16+ with pgvector holds pages, link edges, keywords,
   topics, GSC/GA4 facts, embeddings, and the change ledger; raw HTML lives zstd-compressed in
   Cloudflare R2 (S3-compatible; chosen for zero egress, §3.2). No graph database, no separate
   vector database, no search cluster at MVP: every SPEC §5 question reduces to a SQL join, a
   batch graph computation (in-process,
   seconds at 100k pages [16]), or a nearest-neighbor lookup, and only Postgres puts all three
   behind one query planner.
3. **Durable orchestration, coarse phases.** Temporal (TypeScript SDK, Temporal Cloud at MVP,
   $100/mo floor including 1M actions [1]) runs the daily loop as ~12 coarse phases per site per
   day, never per-URL steps. Temporal is the only engine that natively covers all five hard
   requirements at once: multi-hour crawl activities with heartbeats, durable 14–60-day
   post-change timers that cost nothing while sleeping [3], signal-based human-approval gates for
   MEDIUM-risk changes [2], per-tenant fairness keys [4], and a replayable event history that
   doubles as the audit trail SPEC §16 demands.
4. **Deterministic detection, typed AI.** The SEO Analyzer is a versioned rulebook (~70
   deterministic rules); AI never decides whether an issue exists. The AI Engine emits
   schema-enforced JSON operations (`UPDATE_TITLE`, `ADD_INTERNAL_LINK`, …), each anchored to an
   `oldValue` verified against the live page before apply. The AI proposes values; deterministic
   code performs every edit.
5. **One Change Application Layer, four adapters.** GitHub PR (Next.js/React), WordPress REST plus
   a mandatory ~50-line companion plugin, Shopify Admin GraphQL app, and an edge-worker adapter
   for custom sites. All four consume the same action format and return the same receipt, which
   makes change tracking (SPEC §16) and rollback (SPEC §17) platform-uniform.
6. **Safety as arithmetic, not judgment.** The Decision Engine combines two independent axes,
   confidence ("is it correct?") and risk ("cost if wrong?"), in a decision matrix with a hard
   deny-list no score can override, per-site change budgets, and earned-trust dampening. Every
   change lives in an append-only, event-sourced ledger whose atomic rollback unit is the batch.
7. **Pooled multi-tenancy with layered security.** One Postgres with `project_id` on every row and
   Row-Level Security as defense-in-depth [53]; customer credentials under KMS envelope encryption
   (~$1/mo + $0.03/10k calls [48]); GitHub access only via a GitHub App with 1-hour, per-run
   down-scoped tokens [21]; an egress-isolated crawler with socket-layer SSRF validation [51]; and
   a prompt-injection firewall: models that read crawled content get no tools and no credentials
   and can only emit closed-vocabulary structured output [52].

### 1.1 Full-system diagram (SPEC §19 chain)

```
                          CUSTOMER USERS (agency staff / in-house marketers)
                                              |
                                              v
 +--------------------+      +------------------------------------------------+
 |  AUTHENTICATION    |<---->|  FRONTEND  --  Next.js 16 (App Router, TS)     |
 |  Clerk: orgs,      |      |  project list . site health . issue feed .     |
 |  roles, invites,   |      |  change review (diff, confidence, risk) .      |
 |  SAML/OIDC SSO     |      |  approve / reject . monitoring charts          |
 +--------------------+      +-----------------------+------------------------+
                                                     |  HTTPS + SSE
                                                     v
 +----------------------------------------------------------------------------+
 |  API  --  NestJS 11 on the Fastify adapter                                 |
 |  OpenAPI surface . webhook receivers (GitHub App events, CMS callbacks) .  |
 |  per-request tenant guard (sets Postgres RLS context) . enqueues workflows |
 +--------------+---------------------------------------------+---------------+
                |                                             |
                v                                             v
 +---------------------------+     +----------------------------------------------+
 |  PROJECT MANAGEMENT       |     |  ORCHESTRATION + SCHEDULER  --  Temporal     |
 |  (thin domain module)     |     |  1 Schedule per site (overlap: skip)         |
 |  Project = one website:   |     |  DailySiteRun  |  ChangeLifecycle  |         |
 |  GitHub installation,     |     |  ApprovalGate workflows; durable 14-60 d     |
 |  GSC/GA4 property, CMS    |     |  timers; per-tenant fairness keys;           |
 |  credential *reference*,  |     |  event history = replayable audit log        |
 |  risk policy, quotas,     |     +------+--------------------------------+------+
 |  audit log                |            | activities                     |
 +---------------------------+            v                                v
 +-----------+   +------------------------+---+   +----------------+   +------------------+
 |  CRAWLER  |   |  QUEUE                     |   |  SEO ANALYZER  |   |  AI ENGINE       |
 |  Crawlee, |<--|  BullMQ on Valkey 9        |   |  ~70-rule      |-->|  typed-operation |
 |  static-  |   |  page-level fetch/render   |   |  deterministic |   |  emitter; Haiku/ |
 |  first,   |   |  jobs; per-host politeness |   |  rulebook over |   |  Sonnet/Opus     |
 |  Playwright|  |  (crawl frontier stays in  |   |  crawl + GSC   |   |  tiering; Batch  |
 |  escalation|  |  Crawlee RequestQueueV2)   |   |  facts; graph  |   |  API + caching;  |
 |  egress-  |   +----------------------------+   |  batch worker  |   |  no tools, no    |
 |  isolated |                                    +----------------+   |  credentials     |
 +-----+-----+                                            ^            +--------+---------+
       |                                                  |                     |
       v                                                  |                     v
 +--------------------------------------+                 |            +------------------+
 |  DATA PLANE                          |-----------------+            |  DECISION ENGINE |
 |  Postgres 16+ / pgvector:            |                              |  confidence x    |
 |  pages, links, templates, keywords,  |<-----------------------------|  risk matrix .   |
 |  topics, GSC/GA4 facts, issues,      |                              |  hard deny-list .|
 |  change ledger, embeddings           |                              |  per-site budgets|
 |  R2 (zstd raw HTML, blobs)           |                              |  earned trust    |
 +--------------------------------------+                              +--------+---------+
                                                                                |
                                                                                v
 +----------------------+   +-------------------------+   +--------------------------------+
 |  MONITORING          |   |  DEPLOYMENT ENGINE      |   |  OPTIMIZATION ENGINE           |
 |  guardrail 0-7 d:    |   |  Change Application     |   |  ts-morph/jscodeshift codemods |
 |  crawl-diff, URL     |<--|  Layer, 4 adapters:     |   |  execute edits; LLM supplies   |
 |  Inspection, HTTP,   |   |  GitHub PR . WP REST +  |   |  values only; one logical      |
 |  CUSUM on fresh GSC  |   |  companion plugin .     |   |  change per batch/PR           |
 |  verdict 14-60 d:    |   |  Shopify Admin GraphQL. |   +---------------+----------------+
 |  control-page        |   |  edge worker            |                   | change batches
 |  counterfactual ->   |   +-----------+-------------+                   v
 |  KEEP / ROLLBACK     |               ^                 +---------------+----------------+
 +----------+-----------+               |                 |  VALIDATION ENGINE             |
            |                           |                 |  static gates -> sandboxed     |
            |                           |  validated      |  egress-restricted build ->    |
            |                           |  batches        |  preview deploy (host preview  |
            |                           +-----------------|  or platform-owned) ->         |
            |                           |                 |  rendered SEO assertions:      |
            +---------------------------+                 |  meta-diff, v.Nu, JSON-LD      |
              rollback verdict = a NEW change batch       |  pack, LHCI, lychee            |
              (re-validated, then re-applied)             |  -> GitHub Checks              |
                                                          +--------------------------------+

 Nothing reaches the Deployment Engine except through the Validation Engine: the only two edges
 into it are validated batches and a re-validated rollback batch (NFR-1).

 Two further components feed the SEO ANALYZER / AI ENGINE leg and are drawn out of line for
 space: COMPETITOR INTELLIGENCE (§2.14, SERP + competitor pages -> gap evidence) and the
 INTERNAL-LINK ENGINE (§2.15, link candidates -> ADD_INTERNAL_LINK ops). Both write to the DATA
 PLANE and emit into the same ledger and Decision Engine path as every other change.

 Cross-cutting: OpenTelemetry SDK in every service -> Grafana Cloud (metrics/logs/traces)
 + Sentry (errors) + Temporal Web UI (per-workflow forensics).

 Legend: SSE = Server-Sent Events . CUSUM = cumulative-sum change-point detection .
 LHCI = Lighthouse CI . v.Nu = Nu HTML Checker . RLS = Postgres Row-Level Security.
```

---

## 2. Component architecture

Each component below states: responsibility, technology (per the settled selections presented in
Doc 04), key interfaces, the Doc 01 requirements it serves, and the failure mode the component must
contain (the specific way it fails that the architecture bounds). §2.1–§2.13 are the thirteen
components SPEC §19 names, in its order; §2.14 and §2.15 are two further components the
requirements need but the SPEC chain does not name — competitor analysis (FR-7) and internal
linking (FR-8) are substantial subsystems with their own data and their own phase in the daily
run, and leaving them implicit inside "the AI Engine" would hide them.

### 2.1 Frontend

- **Responsibility:** the auth-gated B2B dashboard: project list, site health, issue/opportunity
  feed, the change-review queue (old value vs AI value, reason, confidence, risk tier), approval
  buttons for MEDIUM-tier changes, and monitoring charts. The approval click is a real control
  surface: it emits the Temporal signal that resumes a paused `ApprovalGate` workflow (§4.3).
- **Technology:** Next.js 16 (App Router, TypeScript), self-hosted in Docker (all features
  supported without Vercel lock-in [55]); Tailwind + headless components; TanStack Query for
  server state; SSE (Server-Sent Events — a one-way HTTP stream, no WebSocket needed) from the API
  for live crawl/run progress. Next.js 16 carries an Active/
  Maintenance LTS line with a formal security-release program, a selection criterion for a
  platform holding customers' repository access [55].
- **Key interfaces:** REST/OpenAPI to the API; SSE stream for run status; no direct database or
  worker access.
- **Serves:** FR-16.1; the approval surface for FR-11.2 (MEDIUM tier).
- **Failure mode to contain:** a dashboard outage must never block the pipeline or strand a
  change; approval state lives in Temporal workflows and Postgres, not in the browser, so the UI
  is stateless and restartable.

### 2.2 API

- **Responsibility:** the control plane: CRUD on projects/connections/policies, read-heavy
  dashboard aggregates (pre-computed by workers), webhook receivers (GitHub App events, CMS
  callbacks, deploy-status callbacks), and command endpoints that start Temporal workflows or
  enqueue BullMQ jobs. It is not the hot path; crawling, AI generation, and validation run in
  workers.
- **Technology:** NestJS 11 on the Fastify adapter [56]: modules/DI give clean seams
  (`ProjectsModule`, `ConnectionsModule`, `ChangesModule`); guards/interceptors are the single
  enforced seam where tenant scoping and RBAC live; first-party OpenAPI generation keeps the
  public surface honest.
- **Key interfaces:** OpenAPI REST for the frontend and future public API; webhook endpoints with
  signature verification; a per-request interceptor that resolves the caller's organization and
  sets the Postgres RLS session variable before any query.
- **Serves:** FR-16.1; the enforcement point for NFR-5 (access isolation).
- **Failure mode to contain:** the cross-tenant authorization bug. The API's failure mode is not
  throughput; it is a request reading another tenant's data. Containment is the framework-level
  guard plus database-level RLS beneath it (§7.1), so a missed check in one handler cannot leak
  rows.

### 2.3 Authentication

- **Responsibility:** login, MFA, session management, organization membership, and enterprise SSO
  for the Platform's own users. Deliberately a separate trust domain from the customer-credential
  vault (§7.2): a platform-auth vendor breach must not expose GitHub or CMS secrets.
- **Technology:** Clerk (managed). Organizations map 1:1 onto agency-to-client structure:
  memberships, app-level roles/permissions, invitations, verified domains; free tier covers 50,000
  monthly users, Pro is $25/mo, SAML/OIDC connections $75/mo each [54]. Documented exit path:
  Better Auth (open source, TypeScript, same Postgres); Keycloak only for an on-prem mandate.
- **Key interfaces:** Clerk SDK in the frontend; JWT verification in the API (locally verifiable,
  so a Clerk outage degrades logins, not active sessions); webhook sync of org/membership rows
  into Postgres for joins against project data.
- **Serves:** FR-16.1; NFR-5 (OAuth, access isolation for platform users).
- **Failure mode to contain:** vendor outage and vendor lock-in. Locally verifiable JWTs bound the
  outage; a nightly user/org export plus the pre-agreed Better Auth exit bound the lock-in.

### 2.4 Project Management

- **Responsibility:** the Platform's domain core, built not bought: `Organization` (synced from
  Clerk) → `Project` (one website property, the unit the entire SPEC §19 pipeline hangs off) →
  per-project connections (GitHub App installation id + repo allowlist, GSC property, GA4
  property, CMS credential *reference* into the vault, deployment target), the per-project
  automation policy (risk-tier thresholds, LOW-risk allowlist, who may approve MEDIUM changes),
  per-project quotas (crawl budget, AI token budget, concurrency class, and `deploys_per_day` —
  the customer's *host* deploy ceiling, derived at onboarding from their Vercel/Netlify plan and
  used to pace batches, §6.4), and the append-only human audit log
  (approve/reject/rollback/policy changes).
- **Technology:** a thin NestJS domain module on Postgres; no off-the-shelf product models "a
  website with a GitHub installation, a GSC property, and a risk-tier automation policy."
- **Key interfaces:** consumed by every workflow (the `DailySiteRun` workflow's first activity
  loads the project's connections and policy); the approval matrix joins directly against the
  change ledger.
- **Serves:** FR-16.1; the policy substrate for FR-11.1/11.2; NFR-5 (audit logs).
- **Failure mode to contain:** policy drift. Automation thresholds are data, versioned in
  Postgres with an audit row per edit, so "who loosened the auto-apply threshold and when" is
  always answerable.

### 2.5 Crawler

- **Responsibility:** discover and fetch every page of a connected site (FR-1.1), extract the full
  SEO field set (FR-1.2: status, redirect chain, canonical, title, metas, H1–H3, images + alt,
  links, structured data, robots directives, content, word count, depth, load timing), fingerprint
  each page for duplicate detection (FR-1.3), and emit page facts plus link edges to the data
  plane. Duplicate detection is two mechanisms on one extraction pass: SHA-256 over the *extracted
  main content* (post-boilerplate-removal — hashing raw HTML lets nav/footer noise mask true
  duplicates) for exact duplicates, and a 64-bit **simhash** fingerprint for near-duplicates
  (§2.7 clusters them) [14].
- **Technology:** Crawlee (TypeScript), hybrid static-first: `CheerioCrawler` (plain HTTP + parse)
  is the default engine, escalating to `PlaywrightCrawler` only for templates proven to need JS
  rendering, with the `AdaptivePlaywrightCrawler` rendering-type predictor learning per site
  (~10% re-detection sampling) [6]. Static crawling is roughly 10x cheaper per page than browser
  crawling (~3,000 vs ~300 pages per compute unit in Apify's own benchmark [7]), and rendering
  differences cluster by template, not by page (a 200-domain study found 96% of domains differ
  somewhere between raw and rendered HTML, but only 56% of URLs [8]), so per-template escalation
  is both safe and cheap. Robots.txt compliance per RFC 9309 with Google-matched 24h caching
  [10][11]; politeness defaults of 2–4 concurrent per host with adaptive backoff on 429/503.
  Firecrawl/Apify remain fallback-only: per-page economics fail at 100k-page recrawl scale.
- **Key interfaces:** consumes **page-level fetch/render jobs** from BullMQ — a Temporal activity
  seeds the frontier and enqueues them, crawler workers only ever consume (site-level sequencing
  is Temporal's, §2.6); writes page extracts and edge rows to Postgres (streaming, flat RAM at any
  site size) and raw HTML to object storage; the page frontier lives in Crawlee's `RequestQueueV2`
  (lockable, shareable across worker processes for one giant site [9]), never in BullMQ.
- **Serves:** FR-1.1 through FR-1.7; feeds FR-2 and FR-3.
- **Failure mode to contain:** two. (a) SSRF: the crawler fetches attacker-influenceable URLs by
  design; containment is the egress-isolated worker segment with socket-layer IP validation
  (§7.4). (b) Runaway URL spaces (facets, calendars): per-pattern caps, max depth, and per-plan
  crawl budgets, with honest "crawl truncated at N" reporting.

### 2.6 Queue

- **Responsibility:** page-level work distribution: fetch/render/analyze jobs inside a site crawl,
  post-deploy verification recrawls (`crawl:verify-change`), and Lighthouse jobs. Site-level
  sequencing belongs to Temporal, not the queue; a queue job is fire-and-forget and cannot hold
  approval gates or 30-day timers.
- **Technology:** BullMQ on Valkey 9 (BSD-3, Linux Foundation; protocol-compatible with BullMQ's
  Redis ≥6.2 requirement [57][59]; managed ElastiCache Valkey runs 20–33% below Redis OSS pricing
  [58]). One Valkey instance also carries per-host politeness state, URL dedup sets, API
  rate-limit counters, and distributed locks at MVP scale.
- **Key interfaces:** one direction only — a Temporal activity enqueues page-level jobs, crawler
  and analyzer workers consume them; workers heartbeat progress cursors back to the owning
  activity so a resumed crawl restarts from its cursor, not page 1. Workers never enqueue
  site-level work.
- **Serves:** FR-1.5, FR-1.6 (queued, schedulable, distributed crawling).
- **Failure mode to contain:** queue loss must never lose pipeline state. All durable state
  (frontier checkpoints, phase progress, approvals, timers) lives in Temporal and Postgres;
  Valkey contents are reconstructible.

### 2.7 SEO Analyzer

- **Responsibility:** turn crawl facts into detected issues (FR-3.1–3.6) and classify each by
  auto-fix safety (FR-3.7). Two parts: (a) the deterministic rulebook, ~70 versioned rules across
  indexing, HTTP, on-page, links, images, and structured data, with Screaming-Frog-aligned default
  thresholds that are per-project configurable; (b) the post-crawl graph/analytics worker that
  computes PageRank, CheiRank and HITS (reverse-PageRank, and hub/authority scores — the same
  link-graph family as PageRank, measuring what a page *points at* and how well it serves as a
  hub or an authority), BFS depth, orphan sets, and connected components in-process
  (rustworkx/igraph; a 4.8M-node/69M-edge graph takes ~10 s in igraph, so a 100k-page site
  computes in seconds [16]) and writes scores back as columns; (c) near-duplicate clustering over
  the crawler's 64-bit simhash fingerprints — Hamming distance ≤ 3 marks a duplicate pair
  (Manku et al.'s Google-scale threshold), and the same paper's banding trick (split the 64 bits
  into 4 blocks, keep 4 sorted indexes, candidates must share one exact block) avoids the O(n²)
  all-pairs comparison that naive dedup would need at 100k pages [14]. Clusters are evaluated
  canonical-cluster-first, so paginated/faceted variants that already share a canonical never
  surface as duplicates.
- **Technology:** TypeScript rule engine over Postgres rows for (a) and (c). Part (b), the
  graph/analytics worker, is the Platform's **one Python service** — rustworkx and igraph have no
  Node bindings (D-39) — packaged as its own container image with its own `pyproject.toml`: no HTTP
  surface, no customer credentials, no schema ownership; it reads `pages`/`links` after a crawl,
  writes score columns, and exits. A JS-native swap to graphology removes the second runtime only
  behind a POC benchmark on a ~10M-edge graph, since the igraph/rustworkx numbers do not transfer.
  Canonical-cluster-first evaluation;
  two-source confirmation for negative states (a "missing title" is only an issue when both the
  static and rendered parses agree); URL Inspection API as a budgeted sampling layer for index
  state (2,000 inspections/day/property [18]), never a full-site sweep. AI never decides
  issue-hood; it only generates fix content downstream.
- **Key interfaces:** consumes page/edge/GSC rows; emits `issue` rows carrying rule id, rule
  version, severity, safety class, and the false-positive traps the Decision Engine must consume
  (e.g. Google rewrote 61.6% of titles in the 2021 Zyppy study of n=80,959 titles [66], rising to
  ~76% by Q1-2025 [74][75] — so a "bad title" flag is weaker evidence than it looks, and the
  rewrite floor sits at 39–42% even in the 51–60-character sweet spot [74], which also caps the
  measurable value of any title fix).
- **Serves:** FR-3.1–3.7; FR-2.2 (importance, orphans, weak linking via the graph worker);
  FR-5.2/FR-6.2/FR-6.3 (opportunity and decay detectors run in this component over GSC facts).
- **Failure mode to contain:** false positives at scale. Every rule is versioned; a rule change
  re-evaluates against stored crawl data (no recrawl needed, thanks to the R2 raw-HTML archive —
  and, per §3.2, no egress bill for reading all of it back),
  and issue rows carry the rule version so a bad rule release is diffable and reversible.

### 2.8 AI Engine

- **Responsibility:** generate fix *content* for issues the Decision Engine routed to generation:
  titles, meta descriptions, H1/H2 structure, alt text, FAQ blocks, internal-link anchors,
  JSON-LD (FR-4.1), under the hard constraint that AI must not blindly rewrite content (FR-4.2).
- **Technology:** a typed-operation emitter, not a content writer. Input is a curated context pack
  (a **>4K-token stable cached prefix** — system contract, business context, site conventions —
  plus **2–4K volatile per-page blocks**: page identity, main content extract, GSC signals,
  competitor evidence; FR-4.3), ordered stable-first because Haiku 4.5's minimum cacheable prefix
  is 4,096 tokens, so a shorter shared preamble silently fails to cache on exactly the bulk tier. Output is a JSON array of schema-enforced operations, each carrying `action` (closed
  enum), `oldValue` (an optimistic-lock anchor verified against the live page before apply),
  `newValue`, `reason`, `evidence[]`, and self-reported confidence (recorded, never trusted as
  the gate; below 0.8 triggers regeneration or downgrade). Schema enforcement uses provider-native
  constrained decoding (Anthropic `output_config.format`, OpenAI `json_schema` strict, Gemini
  `responseSchema`) plus a validator/re-ask layer for what grammars cannot express: pixel width,
  keyword coverage, no-new-facts, URL allowlists. Model tiering: Haiku-class for bulk fields,
  Sonnet-class for judgment surfaces (titles, headings, FAQs, links), Opus-class reserved for
  judging and escalations; essentially all generation goes through the Batch API (uniform 50%
  discount) with prompt caching (cache hits at 0.1x input price) [63]. At 3,000 input / 500 output
  tokens per page, a full 10k-page metadata pass costs **$27.50–$82.50 of generation** (Haiku-only
  to Sonnet-only) and **$33–$88 all-in** once selective Opus judging is added — the all-in number is
  never $30–85, which is the generation-only range (Doc 05 §10.3). A deeper full-page analysis pass
  is a separate workload at $4.50–13.50 per 1,000 pages analyzed [63].
- **Key interfaces:** invoked as plain Temporal activities (LLM/agent frameworks are explicitly
  not the orchestration backbone); reads sanitized structured extracts, never raw crawled HTML
  with ambient authority; emits operation records into the ledger pipeline.
- **Serves:** FR-4.1–4.4; the generation half of FR-7.2 and FR-8.2.
- **Failure mode to contain:** prompt injection and hallucination. The generator has no tools, no
  credentials, and no deploy path; injected text in a crawled page cannot add action types or
  side effects because the output vocabulary is closed and everything passes deterministic
  validation before any deploy path (§7.5) [52].

### 2.9 Decision Engine

- **Responsibility:** decide, for every proposed operation: auto-apply, auto-PR (human merges),
  recommend-only, or discard. Detailed in §6.
- **Technology:** deterministic arithmetic over ledger data: two independent axes (confidence x
  risk) combined in a matrix; hard deny-list floors; per-site velocity budgets; earned-trust
  dampening from the site's own KEEP/ROLLBACK history.
- **Key interfaces:** consumes operations + validator results + ledger history; annotates each
  ledger row with `risk_score`, `risk_tier`, `confidence`, `decision`; routes to the Optimization
  Engine (auto paths) or the approval queue (MEDIUM).
- **Serves:** FR-11.1, FR-11.2; NFR-1, NFR-3 (every decision is auditable arithmetic).
- **Failure mode to contain:** score gaming and drift. No single blended number exists to game; the
  deny-list is score-proof; novel change types default to MEDIUM until 50 observations exist.

### 2.10 Optimization Engine

- **Responsibility:** turn an approved operation into a concrete, appliable edit: a git patch, a
  CMS field write, or an edge-rule update. This is where the two-tier generation rule lives:
  deterministic AST codemods (ts-morph/jscodeshift) perform every structural edit (metadata
  exports, canonicals, alt props, sitemap/robots files, JSON-LD components); the LLM supplies only
  the values the codemod injects. Free-form LLM diffs are reserved for edits a codemod cannot
  express, applied as exact-match search/replace blocks with an apply-or-reject rule: no fuzzy
  matching into production code, ever.
- **Technology:** ts-morph codemod library (type-aware, unit-tested once, deterministic at any
  scale); measured evidence justifies the split: vanilla-LLM codemod generation is correct only
  45.29% one-shot, ~54–55% after four refinement iterations [25], never good enough to auto-merge
  without deterministic gates.
- **Key interfaces:** consumes decision-approved ledger rows; resolves the correct write target
  first (a Next.js route whose `generateMetadata` reads a headless CMS is CMS-owned; patching the
  repo would be wrong); emits change batches to the Validation Engine.
- **Serves:** FR-9.1–9.4 (generation side), FR-10.1/10.2 (how changes are generated and kept from
  breaking functionality).
- **Failure mode to contain:** silent partial edits. A codemod either applies cleanly or fails
  loudly; there is no partially-wrong state, which is what makes LOW-tier auto-apply defensible.

### 2.11 Validation Engine

- **Responsibility:** SPEC §15 verbatim: every automated change passes SEO validation, HTML
  validation, schema validation, application tests, build, and performance test before deployment
  (FR-12.1/12.2). Layered, cheapest first, every layer a hard fail:
  1. Static gates: changed-file allowlist (deny always: workflows, lockfiles, `next.config.*`,
     middleware, env files), diff budget per change type, ESLint, `tsc --noEmit`.
  2. Sandboxed build: `npm install && npm run build` of a customer repo is remote code execution;
     it runs in an ephemeral, egress-restricted, single-tenant container with no platform secrets.
  3. Preview deploy: Vercel `POST /v13/deployments` with `gitSource` [33] or Netlify deploy
     previews (`draft: true` builds without touching the live site) [36]; the preview URL is the
     unit of validation. Where the preview URL is gated by Vercel Deployment Protection, the
     validator fetches it through the project's **protection-bypass** token rather than
     degrading to a source-level check [35]. **Git-deployed sites whose host has no preview
     primitive** (AWS Amplify, Cloudflare Pages, Render, Fly, self-hosted Node/Docker — the same
     deployment mode this Platform uses for its own frontend, §2.1) get a fourth path: a
     **platform-owned ephemeral preview** — the PR artifact is built in the same sandbox as
     rung 2 and served from an internal ephemeral host, identical assertion suite, platform-owned
     URL. Validate-before-deploy (NFR-1) is therefore host-independent; only its *speed* and the
     instant-rollback path of §5.3 are host-conditional.
  4. Rendered-preview SEO assertions: the meta-tag diff assertion (the intended change is present
     exactly, and *nothing else changed*: canonical, robots meta, hreflang, OG, H1 count, link set
     untouched), Nu HTML Checker on rendered HTML [37], the in-house JSON-LD/schema.org rule-pack
     (Google's Rich Results Test has no public API; the old testing-tool API died in 2020 and was
     never replaced [38], so this validator must be self-built, with the URL Inspection API's
     `richResultsResult` as post-deploy ground truth within its 2,000/day budget [39][18]),
     Lighthouse CI budget assertions relative to a stored production baseline (median of ≥3 runs)
     [40], and lychee link checking scoped to changed pages [41].
  5. Results posted as named GitHub Checks on the PR head SHA, so customers can mark them required
     in branch protection, turning our validation into a server-enforced gate.
  For the non-git adapters (no preview deploy exists: a WordPress or Shopify write goes live when
  the request succeeds), the engine substitutes a three-rung ladder: simulated render (apply the
  change to the fetched production DOM in memory and run the identical assertion suite), true
  staged render where the channel has a staging primitive (Shopify duplicate-theme previews, WP
  autosaves + companion-plugin token previews, edge-worker version preview URLs), and canary apply
  (one lowest-traffic URL first, render-verified within seconds, then the paced remainder), plus
  read-back verification on every API write.
- **Technology:** ESLint + `tsc --noEmit` for the static tier; an ephemeral, egress-restricted,
  single-tenant container (one per build, destroyed after) as the sandbox runner; Playwright for
  post-hydration rendering of the preview; Nu HTML Checker (v.Nu, self-hosted service) [37]; an
  in-house JSON-LD/schema.org rule-pack (self-built because Google's Rich Results Test has no
  public API [38]); Lighthouse CI [40]; lychee [41]; the Vercel/Netlify deploy APIs [33][36] or
  the Platform's own ephemeral preview host; results published through the GitHub Checks API
  (GitHub App only — fine-grained PATs cannot call it [21]).
- **Key interfaces:** consumes change batches from the Optimization Engine (§2.10) plus the
  project's validation policy (path allowlist, diff budget, LHCI baseline); emits, per `change`
  row, a `validations` JSONB payload recording every validator's pass/fail and its payload
  (§3.3), and, on the git channel, one named GitHub Check run per gate on the PR head SHA so the
  customer can mark them required in branch protection. It hands only fully-passed batches to the
  Deployment Engine; there is no other edge into §2.12.
- **Serves:** FR-12.1, FR-12.2; FR-10.2 (testing generated changes).
- **Failure mode to contain:** validation that passes on the wrong artifact. Assertions run only
  against the rendered preview (or patched DOM), never against source; and the sandbox contains
  the RCE risk of building customer code.

### 2.12 Deployment Engine (Change Application Layer)

- **Responsibility:** apply validated batches to the customer's site through exactly one of four
  adapters, and record the uniform receipt (`applied_change_id`, before/after, revert handle).
  Detailed in §5.
- **Technology:** four adapters behind one interface — a GitHub GraphQL App client
  (`createCommitOnBranch` with `expectedHeadOid`, `enablePullRequestAutoMerge`,
  `revertPullRequest` [23], on 1-hour down-scoped installation tokens [21]); WordPress REST plus
  the mandatory ~50-line companion plugin [26][65]; Shopify Admin GraphQL (`productUpdate`,
  `global.title_tag`/`description_tag` metafields, `urlRedirectCreate`) [27][28]; and a
  Cloudflare Worker using `HTMLRewriter` for the edge channel [31]. Each adapter is a pure
  function of the action format plus the tenant's credential handle; none of them holds a
  credential itself (§7.2).
- **Key interfaces:** consumes only validated batches from §2.11 (no other caller may reach an
  adapter). Writes the ledger before it writes the site: a `change_batch` row moves to `applied`
  carrying the channel-specific handle (`merge_sha` / `deploy_id` / `cms_revision_ids`) plus
  per-`change` before/after blob hashes, which is what makes the batch the atomic rollback unit
  (§3.3). Emits `applied` events that start a `ChangeLifecycle` monitor (§4.4) and returns the
  same receipt shape on every channel regardless of adapter.
- **Serves:** FR-9.1–9.4, FR-10.1; the "automatically apply safe changes" success criterion.
- **Failure mode to contain:** the unrecorded mutation. No code path may write to a customer site
  except through an adapter, and every adapter write creates a ledger row first (FR-13.2).

### 2.13 Monitoring (post-change + platform observability)

- **Responsibility:** two distinct jobs. (a) *Post-change monitoring* (FR-14): the two-phase
  design in §4.2: a guardrail phase (days 0–7) catching catastrophes in minutes-to-days, and a
  verdict phase (day 14–60 by change type) deciding KEEP/ROLLBACK against a counterfactual built
  from untouched control pages. (b) *Platform observability*: OpenTelemetry SDK in every service
  feeding Grafana Cloud (free tier at MVP: 10k metric series, 50 GB logs/traces [61]) plus Sentry
  Team ($26/mo [60]) for errors, plus the Temporal Web UI, whose per-workflow event history
  answers "what exactly did the system do to customer X's site on date Y" without log spelunking
  [62].
- **Technology:** for (a), the Platform's own crawl-diff worker over the changed URLs, the GSC URL
  Inspection API (2,000/day/property [18][39]), CUSUM (cumulative-sum change-point detection) over
  fresh GSC daily rows for the guardrail signal, and CausalImpact-style Bayesian structural time
  series or difference-in-differences over the owned GSC warehouse for the verdict [45][47]; for
  (b), the OpenTelemetry SDK → Grafana Cloud (Loki/Mimir/Tempo) [61][62], Sentry [60], and the
  Temporal Web UI.
- **Key interfaces:** triggered *only* by the ledger — a `ChangeLifecycle` workflow starts on the
  Deployment Engine's `applied` event and drives the whole schedule from durable timers (§4.4), so
  monitoring is never a cron guessing what changed. It consumes `applied` events plus GSC/GA4
  facts and crawl-diff results, and emits its findings back as `change_event` rows
  (`recrawl_seen`, `guardrail_trip`, `verdict`) plus a `verdict`/`verdict_reason` on the `change`
  row; a guardrail trip or a ROLLBACK verdict is emitted as a new rollback batch (never an in-place
  update) and pages the operator.
- **Serves:** FR-14.1–14.3, FR-6.2/6.3 (the same GSC pipeline feeds detection), NFR-3.
- **Failure mode to contain:** flying blind after a change. Quota budgeting (URL Inspection
  2,000/day [18]) inspects changed URLs only on a decaying schedule; alert rules page on every
  ROLLBACK decision and on approvals waiting past SLA.

### 2.14 Competitor Intelligence

- **Responsibility:** FR-7: for each tracked keyword, find who ranks, fetch and structure their
  pages, and turn the comparison into *gap* evidence the AI Engine and Decision Engine can
  consume. It is an evidence producer, never an actor: competitor-derived content changes never
  auto-apply (D-26), so this component's output enters the pipeline only as `evidence[]` on an
  operation and as candidate `ADD_SECTION`/`UPDATE_TITLE`/`ADD_SCHEMA` proposals routed to
  RECOMMEND-ONLY or AUTO-PR.
- **Technology:** a five-stage pass per keyword. (1) SERP acquisition — DataForSEO SERP Advanced
  ($0.60/1k, top-10/20 organic + People-Also-Ask + related searches in one call [64]) behind the
  mandatory `SerpProvider` abstraction (§8), because SERP vendors are a live legal-risk surface
  and must be swappable. (2) A three-tier fetch ladder — DataForSEO OnPage Instant Pages /
  Content Parsing first ($0.000125/page basic, $0.00125 JS-rendered, 20 URLs per request) [86],
  escalating only failed fetches to an anti-bot vendor, dropping what stays unfetchable; the
  Platform deliberately does *not* run a stealth browser fleet. (3) Deterministic parsers for
  title/H1/H2/H3, JSON-LD types and required properties, internal-link anchors and counts, and
  word counts. (4) One cheap-LLM structured pass per competitor page (~$0.002/page) for topics,
  entities, questions answered and unique claims, with GLiNER (Apache-2.0 zero-shot NER) as the
  open-source fallback [90]. (5) Gap detection by embedding set-arithmetic: chunk both sides
  (200–400 tokens), embed with the same `text-embedding-3-small` model as §3.1 [17], cluster the
  competitor chunks, and flag clusters carried by ≥3 of the top 10 whose maximum cosine similarity
  to any customer chunk is below ~0.75 [88]. Full analysis costs ≈$0.02–0.05 per keyword.
- **The five gates (the component's real value).** A raw "they cover it, we don't" cluster is
  noise. Cheapest-first, each gate emitting an explainable score: **intent match** (DataForSEO
  Labs `search_intent` [87] cross-checked against SERP shape — an informational gap against a
  transactional URL is a new-page candidate, not an on-page fix; this is the single biggest
  false-positive source), **consensus/breadth** (≥3 of top-10 or ≥2 of top-5, position-weighted),
  **demand evidence** (PAA question, autocomplete, nonzero volume, or existing GSC impressions),
  **business relevance** (cluster centroid scored against a business-context embedding built from
  the §3.1 site model), and **cannibalization** (same query, ≥2 of the customer's own URLs with
  impressions over a 6–12-month window [89] — if a sibling page already owns the topic, the
  correct action is *internal link or consolidate*, never duplicate coverage).
- **Key interfaces:** consumes `keywords` + the site's own page/embedding rows; writes
  `serp_results` and `competitor_pages` (§3.1); emits gap records that become `evidence[]` in the
  AI Engine's context pack (§2.8) and `issue` rows of the opportunity class. Runs as phase P6 of
  `DailySiteRun` (§4.2), on its own refresh cadence (monthly per keyword by default), not every
  night.
- **Serves:** FR-7.1–7.2; feeds FR-4.3 (competitor evidence in the context pack).
- **Failure mode to contain:** two. (a) *Acting on noise* — bounded by the five gates and by the
  hard rule that competitor-driven content never auto-applies. (b) *Vendor discontinuity* — SERP
  scraping is under active litigation; containment is the `SerpProvider` abstraction with at least
  two interchangeable vendors and treating SERP data as replaceable, never foundational.

### 2.15 Internal-Link Engine

- **Responsibility:** FR-8: propose, place, and measure internal links — the Platform's
  highest-evidence lever (SearchPilot split tests measured +7% organic traffic to pages receiving
  new internal links [83]) and the only action space that lives entirely inside the customer's own
  site.
- **Technology:** three candidate channels, fused. (a) **Exact-phrase mention scan** over the
  Postgres FTS index — the target's phrase already present verbatim in a source page's main
  content; highest precision, fully auditable. (b) **Embedding similarity** between source
  paragraph and target page in the 0.78–0.85 cosine band (the same `pages.embedding` column as
  §3.1). (c) **GSC query bridge** — source and target both earn impressions on the same query.
  Channel *agreement* is the strongest precision signal and is what promotes a candidate into the
  auto tier. Scoring is a weighted sum, `w1·target_need + w2·target_value + w3·source_relevance +
  w4·source_authority + w5·placement_quality − penalties` (heuristic start ≈
  0.25/0.20/0.30/0.15/0.10, then re-learned from the Platform's own KEEP/ROLLBACK outcomes —
  training data no off-the-shelf tool has). `target_need` is the internal-PageRank deficit from
  §2.7's graph worker — the same metric Screaming Frog exposes as Link Score on a 0–100 log scale,
  which a standard power-iteration PageRank over our own crawl graph reproduces [85] — modeled as
  a concave marginal gain with a hard stop at ~40 inbound internal links, since Zyppy's 23M-link
  study shows gains flattening toward 40–44 and reversing after ~45–50 [82]; orphans and
  >3-click-deep pages get the largest boost. `target_value` is the GSC opportunity score;
  `source_authority` implements the donor–acceptor rule (route equity from strong donors to weak
  acceptors, penalizing donors already dense in outlinks); `placement_quality` prefers
  main-content running text over list/sidebar and earlier-in-document over later. Penalties cover
  link-density and anchor-repetition caps. Anchor text is taken **only from text already present
  verbatim on the source page** (the auto path never rewrites a sentence), governed by an
  anchor-usage ledger
  encoding the study's two findings in tension: one exact-match anchor per target, then forced
  variation [82]. Insertion is server-side AST manipulation (remark/remark-mdx for Markdown/MDX,
  parse5/cheerio for HTML) shipped through the same adapters as every other change — **never
  JavaScript injection**, which split-testing shows has no detectable SEO effect [84].
- **Autonomy tiers (D-27):** T1 auto-PR for the highest-confidence pattern (exact phrase present +
  high semantic similarity + no existing link + under both caps); T2 one-click approval; T3
  recommend-only; broken-link retargeting is the one fully automatic case (it restores a link that
  is already broken). Per-run budgets — **≤3 contextual insertions per page per cycle** (5 only as a
  documented per-project override), ≤1 contextual link per ~100–150 words of main content counting
  existing links — exist for rollback attributability and to keep the pattern editorial rather than
  schematic, not for SEO.
- **Key interfaces:** consumes `pages` (PageRank, depth, orphan flags), `links`, `page_keywords`
  and GSC facts; writes `link_candidates` and `anchor_usage` (§3.1); emits `ADD_INTERNAL_LINK`
  operations into the same ledger and Decision Engine path as every other change type. Runs as
  phase P7 of `DailySiteRun` (§4.2). Verdicts are measured at batch level with the §4.4
  counterfactual machinery on a 28-day window.
- **Serves:** FR-8.1–8.3; FR-2.2 (weak-linking and orphan remediation).
- **Failure mode to contain:** the link farm inside the customer's own site — sitewide identical
  anchors, over-linked targets, diluted donors. Containment is arithmetic, not taste: the
  ~40-inbound cap, the per-source density budget, and the anchor-usage ledger that makes
  "same anchor everywhere" structurally impossible.

---

## 3. Data architecture

### 3.1 One Postgres, ten schema domains

PostgreSQL 16+ with pgvector is the single system of record. Every tenant-scoped table carries
`project_id` (the pool tenancy model, §7.1). The domains:

| Domain | Core tables | Notes |
|---|---|---|
| Tenancy & projects | `organizations`, `projects`, `connections`, `automation_policies`, `quotas`, `human_audit_log` | Clerk org rows synced by webhook; credential rows hold vault references, never secrets |
| Pages & crawl facts | `pages`, `page_versions`, `templates` | One row per canonicalized URL; per-crawl version rows; computed columns (depth, PageRank, hub/authority, `is_orphan` generated from `depth IS NULL`); `page_type` with provenance + confidence columns; `content_hash bytea` (exact dup, incremental-recrawl gate) and `simhash bigint` (64-bit near-dup fingerprint, 8 bytes/page) stored as 4 indexed 16-bit band columns so near-dup lookup is 4 index probes, not an all-pairs scan [14] |
| Link graph | `links (project_id, from_id, to_id, anchor_text, rel, placement, first_seen, last_seen)` | ~100 edges/page ⇒ ~10M rows at 100k pages, comfortably Postgres-scale; placement column enables weighted PageRank |
| Keywords & topics | `keywords`, `topics`, `page_keywords` | Keywords from GSC queries ∪ keyword APIs, clustered by embedding (UMAP dimensionality reduction feeding HDBSCAN density clustering — no preset cluster count, and outliers stay unclustered rather than being forced into a topic); `page_keywords` maps observed vs assigned targets with provenance |
| Search facts | `gsc_query_page_daily` (partitioned by month), `gsc_page_daily`, `ga4_page_daily` | The join surface for cannibalization and opportunity scoring; GSC warehoused permanently to escape Google's ~16-month° retention (widely reported and matching the GSC UI, but sourced to a third-party explainer, not a Google reference page [91]); GA4 landing-page × channel × key-events facts re-pulled for a trailing 14 days nightly because attribution restates for up to 12 days [73] |
| Issues & detections | `issues` | Rule id + rule version + severity + safety class + false-positive flags |
| Competitor & SERP facts (§2.14) | `serp_results (project_id, keyword_id, captured_at, position, competitor_url, result_type)`, `competitor_pages (url, fetched_at, fetch_tier, title, headings JSONB, jsonld_types text[], word_count, chunk embeddings)` | The SERP snapshot is time-series (rankings move); competitor page bodies are cached to object storage on the same retention rules as customer HTML. Gap clusters carry their five gate scores so the `reason` is reconstructable |
| Link candidates & anchors (§2.15) | `link_candidates (source_page_id, target_page_id, channel, anchor_text, paragraph_ref, score components, state)`, `anchor_usage (project_id, target_page_id, anchor_text, exact_match bool, times_used, first_used_at)` | `anchor_usage` is the ledger that enforces exact-match-once-then-vary; `link_candidates` persists rejected candidates too, so "why was this link not proposed" is answerable |
| Change ledger | `change_batch`, `change`, `change_event`, `blob`, `site_trust` | §3.3 |
| Embeddings | `pages.embedding halfvec(1536)`, `keywords.embedding` | text-embedding-3-small, 1536-dim, HNSW cosine index [15][17]. `halfvec` = pgvector's half-precision vector type (2 bytes/dimension instead of 4, halving index memory at negligible recall cost); HNSW = Hierarchical Navigable Small World, the graph index that makes approximate nearest-neighbour search sub-linear |

Design invariants:

- **The graph is data, not a database engine requirement.** Every SPEC §5 question (importance,
  cannibalization, orphans, weak linking) is a batch analytics question over a site-sized graph,
  recomputed after each crawl by an in-process worker in seconds [16]; scores land as columns.
  No graph database at MVP (D-04); the commercial crawl-analytics leaders (Botify, Lumar, OnCrawl)
  likewise treat the site model as tabular analytics data, not a graph DB.
- **Embeddings live beside the facts.** The Platform's most common similarity query is filtered
  ("similar pages that are indexable and in the same category"); pgvector's iterative index scans
  answer it in one SQL statement [15]. Cost is noise: ~$0.30 per 10k pages embedded at
  text-embedding-3-small's $0.02/M tokens [17], re-embedded only on `content_hash` change.
- **GSC ingestion is dual-path, one schema.** Search Analytics API for small/medium sites (25k
  rows/request; published quotas 1,200 QPM and URL Inspection 2,000/day + 600/min [18]). The
  **~50,000 rows/day/site/search-type° ceiling is a community-measured planning estimate, not a
  published Google quota** [92] — Google's own documentation says only that the API returns "top
  rows, not all rows" — so truncation is detected empirically (a day returning row counts at the
  observed ceiling is flagged truncated, per Doc 05 §2.1). The free GSC Bulk Export to BigQuery,
  ELT'd into the same fact table, serves sites where the daily ceiling truncates the tail [19].
- **GA4 is veto-only.** The Data API is free and quota-cheap (200k tokens/property/day; a nightly
  14-day re-pull costs ≈140 tokens [20]), but conversions enter the KEEP/ROLLBACK matrix only as
  a last-priority veto on head pages carrying **≥~3.6 key events/day of baseline (≈120–360 organic
  sessions/day at a 1–3% rate)** — the floor derived in Doc 05 §3, not the "≥100 organic clicks/day"
  shorthand, which implies a 3.6% conversion rate above the researched band. Never a blocking
  signal. (Distinct from the ~10 organic clicks/day page-level *verdict power* floor in §4.4.)

### 3.2 Object storage: raw HTML archive

Raw HTML (and the rendered DOM when it differs from static) is stored zstd-compressed in
**Cloudflare R2** — S3-compatible API, so any S3-compatible store is a drop-in, but R2 is the
named default — keyed `{site}/{crawl_id}/{urlhash}.html.zst`. A typical ~100 KB page compresses to
~15–25 KB [13]; **counting raw HTML only, at one retained version**, a 100k-page site is ~2–2.5 GB
≈ **$0.03–0.04/month at R2's $0.015/GB-month**, and the first 10 GB are free [76]. The
all-artifacts figure measures something different and must not be compared with this one: ~250 kB
per page-version including extract JSON and an optional screenshot ⇒ ~100 GB at four retained
versions ⇒ ~$1.50/month (Doc 04 §3.19).

**Egress, not storage, is the deciding term.** Every reason to keep raw bodies is a re-read
reason: (a) re-extract without recrawling when detection rules improve — a full re-extraction
reads the entire archive; (b) before/after evidence for the change ledger; (c) AI context for the
optimization engine; (d) content-hash diffing drives incremental recrawl scheduling. Workers
therefore re-read stored HTML constantly, and on S3 Standard that traffic bills at ~$0.09/GB
egress on top of ~$0.023/GB-month storage [12], which can exceed the storage line by an order of
magnitude in a re-extraction month. R2 charges **zero egress** [76], so a rule-version replay
across the whole archive costs nothing beyond its Class B read operations ($0.36/M). Write
operations dominate the remaining bill at small object sizes (Class A $4.50/M ⇒ ~$0.45 per
100k-page crawl [76]); bundling small pages into range-readable objects is the pre-researched
mitigation.

**Retention:** latest N versions per page, plus any version referenced by an applied change
(ledger references pin blobs indefinitely); older versions lifecycle-transition to Infrequent
Access/Glacier. GSC/GA4 facts: permanent (that is the point of the warehouse). Ledger rows and
`change_event` rows: never deleted; the ledger is append-only by definition.

### 3.3 The event-sourced change ledger (SPEC §16)

The ledger is the Platform's spine: simultaneously the audit trail, the rollback substrate, the
trust-score input, the velocity governor, and the policy-compliance record. Design rules:

```
change_batch  -- one PR merge or one CMS transaction = the atomic rollback unit
   batch_id, site_id, apply_channel (github_pr|wp_rest|shopify_api|edge),
   pr_url/merge_sha | cms_revision_ids, deploy_id,
   status: open|applied|monitoring|closed|rolled_back, rollback_batch_id

change        -- one field-level change on one URL
   change_id, batch_id, url, change_type, field_path,
   before_hash, after_hash          -> content-addressed blobs (SHA-256, dedup table)
   reason, source_issue_id, ai_model, prompt_version,
   ai_confidence (recorded, not trusted), confidence, risk_score, risk_tier, decision,
   validations JSONB (each validator: pass/fail + payload),
   status: proposed -> validated -> pending_approval -> applied -> monitoring
           -> kept | rolled_back | superseded | failed,
   applied_at, recrawl_verified_at, eval_start_at (= recrawl_verified_at, NOT applied_at),
   verdict, verdict_reason, metrics_baseline/observed, effect_estimate,
   rollback_of / rolled_back_by (paired pointers), policy_flags, group_id

change_event  -- append-only audit spine: proposed|validated|approved|applied|
                 recrawl_seen|guardrail_trip|verdict|... with actor (system|model:<id>|user:<id>)
```

- **Append-only.** History is never UPDATEd. A rollback is a *new* change with
  `change_type='ROLLBACK'` and inverted before/after; the original gets `rolled_back_by`.
- **Batch as rollback unit.** GitHub channel: `git revert` of the batch's merge SHA. CMS channel:
  replay stored pre-image writes per object, in reverse order, verifying each. Partial failure is
  recorded per change and the batch stays `rolled_back:partial` with an alert, never silently done.
- **Drift check before any rollback.** Automatic rollback requires the live value to equal the
  original's `after` blob; if a human or later change moved it, the system escalates with a 3-way
  diff instead of writing. This closes the most common corruption path in naive rollback systems.
- **The evaluation clock starts at verified recrawl**, not deploy: Google commits only to wide
  ranges (recrawl "a few days to a few weeks" [42]; change visibility "a few hours" to "several
  months"), and GSC data itself lags 2–3 days, so calendar-from-deploy windows systematically
  under-measure.
- **Temporal event history is the second ledger.** Every workflow's replayable history records
  what the system did and when, independently of application tables; the two records
  cross-validate (D-14).

---

## 4. The autonomous loop as Temporal workflows

### 4.1 The one structural rule

**Never model per-URL work as workflow steps.** A 100k-page crawl expressed as engine steps is
100k+ billable actions per crawl and would blow the 51,200-event workflow history cap [5]. The
workflow orchestrates ~12 coarse phases per site per day — O(10) phases, never O(pages);
page-level jobs go to BullMQ workers with an internal checkpoint cursor, heartbeated back to the
owning activity. With this design a
site-day costs ~50–100 Temporal actions; 500 sites ≈ 1–1.5M actions/month ≈ $100–130/month, and
the engine stays a rounding error next to crawl compute and LLM tokens [1].

### 4.2 `DailySiteRun` — the daily site workflow

One Temporal Schedule per site (overlap policy: skip); workflow ID `{tenant}:{site}:{date}` gives
free idempotent dedupe of the daily run.

```
DailySiteRun (per site, per day)                          ~12 phases, each one activity
--------------------------------------------------------------------------------------
 P1  load project config + connections + policy      (Postgres)
 P2  crawl wave                                      (activity drains BullMQ; heartbeats
                                                      frontier cursor; hours-long is fine)
 P3  ingest search facts                             (GSC nightly sync; GA4 sync)
 P4  analyze                                         (rulebook + graph worker + near-dup
                                                      clustering + embeddings, changed
                                                      pages only)
 P5  detect opportunities & decay                    (opportunity score; decay detector)
 P6  competitor pass                                 (§2.14; only keywords whose refresh
                                                      window is due - SERP + fetch ladder
                                                      + gap clusters through the 5 gates;
                                                      no-op on most site-days)
 P7  link-candidate pass                             (§2.15; 3 channels -> scored
                                                      candidates -> anchor-ledger check)
 P8  prioritize                                      (rank issues x traffic value x policy)
 P9  generate                                        (AI engine, Batch API; top-K only)
 P10 decide                                          (Decision Engine matrix)
 P11 apply LOW tier                                  (spawn ChangeLifecycle per batch)
     route MEDIUM tier                               (spawn ApprovalGate per batch)
 P12 report + reconcile                              (dashboard aggregates; budget burn;
                                                      close out stale monitors)
```

Phases are activities: retried, idempotent (idempotency keys on every side-effectful call: branch
name = change id, read-before-write on CMS fields), and quota-aware (GSC/GitHub/Shopify budgets
enforced per activity).

### 4.3 `ApprovalGate` — the MEDIUM-tier human gate

A MEDIUM-tier batch spawns an `ApprovalGate` child workflow that opens the PR (or stages the CMS
change), notifies the approver, and then waits on a durable condition. The dashboard's
approve/reject button sends a Temporal **signal**; the workflow resumes instantly, whether the
human answered in four minutes or three weeks. A durable timer implements the approval SLA
(reminder at day 3, escalation at day 7, expiry per policy). The waiting workflow consumes no
worker resources and survives any restart [2][3]. This is the exact mechanism SPEC §14's
"automated PR/deployment" tier requires: automation up to the gate, a human decision at it.

### 4.4 `ChangeLifecycle` — one workflow per applied batch

```
ChangeLifecycle (per applied change batch)
------------------------------------------------------------------------------
 generate -> validate -> apply (adapter) -> verify recrawl -> guardrail -> verdict
                                            |                |            |
                                            |                |            +-- day 14-60 by
                                            |                |                change type:
                                            |                |                counterfactual vs
                                            |                |                control pages ->
                                            |                |                KEEP | ROLLBACK |
                                            |                |                EXTEND (once) |
                                            |                |                insufficient_data
                                            |                +-- days 0-7: crawl-diff,
                                            |                    URL Inspection verdicts,
                                            |                    HTTP/build errors,
                                            |                    CUSUM on fresh GSC
                                            +-- URL Inspection on changed URLs, decaying
                                                schedule (day 1,2,4,8...); eval clock
                                                starts at recrawl_verified_at
```

- **Guardrail phase (days 0–7):** catastrophe detection with no statistics needed: changed URL
  4xx/5xx, unintended crawl-diff deltas (noindex/canonical/robots appearing where not intended),
  robots.txt/sitemap fetch failures (Google halts all crawling within ~12h of a 5xx robots.txt
  [11]), index-state loss persisting 48h, structured-data error spikes, and — the one signal that
  is statistical — a CUSUM (cumulative-sum change-point detection) trip on the changed URLs' fresh
  GSC clicks, which flags a sustained level shift far sooner than a fixed threshold would. Any
  trip auto-rolls back the batch and pages the operator.
- **Verdict phase (day 14–60 by change type):** KEEP/ROLLBACK decided against a counterfactual
  from untouched control pages: CausalImpact-style Bayesian structural time series [45], or
  difference-in-differences with year-over-year checks from the owned GSC warehouse; never naive
  pre/post, which Google's own traffic-debugging guidance disqualifies (seasonality, algorithm
  updates, shifting interests [47]). This is how commercial SEO A/B testing works: control and
  variant experience updates and seasonality together, so those cancel [46]. Underpowered pages
  are pooled into cohort verdicts; below ~10 clicks/day a page-level verdict is not statistically
  honest and is not issued.
- **Timers are durable and free while sleeping** [3]; to bound open-workflow counts, monitors are
  batched per site-day (one monitor workflow covering the day's batches, ticking daily), not one
  per change.
- **Verdict asymmetry:** correctness-class fixes (alt text, valid schema, fixed links) default
  KEEP on inconclusive evidence; opinion-class changes (titles, content, added links) default
  ROLLBACK on inconclusive-negative. Rolling back a correct fix reintroduces a defect; rolling
  back an unproven opinion costs only unproven upside.
- **Anti-flapping:** after any rollback, the page/change-type pair freezes ≥30 days; a rolled-back
  change never re-applies automatically; verdicts overlapping a confirmed Google update rollout
  auto-extend (the update calendar is machine-read from the Search Status dashboard).

### 4.5 Per-tenant fairness

All sites share one Temporal task queue with a **fairness key per tenant**: fairness weights
control capacity share and per-key rate limits cap any single tenant, adjustable at runtime
without redeploys [4]. This solves "one 100k-page customer starves ten 500-page customers"
without per-tenant worker fleets. At the queue layer, BullMQ per-tenant concurrency caps mirror
the same policy for crawl jobs. Fairness weights are probabilistic, not strict isolation; a
pathological tenant is additionally bounded by its per-key RPS cap and its project quotas.

---

## 5. The Change Application Layer

### 5.1 One abstraction, four adapters

Every adapter consumes the same structured action format and returns the same receipt
(`applied_change_id`, before/after hashes, revert handle). The adapter choice is per project,
resolved at onboarding; the correct write target is resolved per route (a CMS-owned Next.js route
gets a CMS write, not a code patch).

| Adapter | Target sites | Auth | Writable SEO surface | Hard constraints the design absorbs |
|---|---|---|---|---|
| **GitHub PR** | Next.js/React; git-deployed sites on Vercel/Netlify, **or any git host via the platform-owned ephemeral preview** (§2.11 rung 3) | GitHub App; 1-hour installation tokens, down-scoped per run [21] | Everything in the repo: metadata, canonicals, sitemap/robots, alt, JSON-LD, content, redirect config | Secondary rate limits: 80 content-writes/min, 500/h per installation [70] ⇒ batch changes per PR; protected branches respected; GraphQL-first client (`createCommitOnBranch`, `revertPullRequest` have no REST equivalents [23]); **the customer's own host deploy quota bounds throughput** (§5.2) and off Vercel/Netlify the instant-rollback lane of §5.3 does not exist |
| **WordPress REST + companion plugin** | WordPress (largest market share) | Application Passwords (core since WP 5.6), dedicated Editor-role user [65] | Post/page title, content, slug, media `alt_text`; Yoast/Rank Math title + description + canonical **only via meta keys the companion plugin registers** | Yoast's REST surface is officially read-only [26]; WP REST silently drops unregistered meta ⇒ the ~50-line companion plugin (registers SEO meta with `show_in_rest`, token preview of autosaves, cache-purge hook, replace-file endpoint) is mandatory, not optional |
| **Shopify Admin GraphQL app** | Shopify | Custom-app token (early) / public app OAuth (scale) | `productUpdate.seo{title,description}` [28]; `global.title_tag`/`description_tag` metafields on pages/collections/blogs/articles; `seo.hidden` noindex [27]; `urlRedirectCreate`; media alt | Partial `seo` input nulls the omitted field ⇒ read-before-write and echo both fields, always [29]; cost-based limits: 1,000-point bucket at 50 pts/s ⇒ ~5 mutations/s pacing [30]; **no theme writes in the core loop** (protected-scope exemption is an enhancement, JSON-LD ships via an app-embed block) |
| **Edge worker** | Custom sites with no API and no repo | Customer's Cloudflare zone (or managed proxy) | Any HTML in flight: title, metas, canonical, robots meta, JSON-LD, alt, internal links, headers, redirects via HTMLRewriter [31] | We enter the serving path ⇒ opt-in premium mode with transparent-proxy failover on error (the commercially proven SearchPilot model [32]); rewrites must be UA-uniform (cloaking line) |

### 5.2 GitHub PR path — sequence with preview-deploy validation

```
 Decision   Optimization    GitHub App API      Sandbox        Preview host      Validation
 Engine     Engine          (per-tenant)        builder        (Vercel/Netlify)  Engine
    |            |                |                |                 |               |
 1. |--approved batch             |                |                 |               |
    |  (typed ops)--> |           |                |                 |               |
 2. |            |--mint installation token: 1 h, this repo only,    |               |
    |            |  contents:write + pull_requests:write + checks:write [21]         |
 3. |            |--create branch  seo/<batch-id>  |                 |               |
 4. |            |--createCommitOnBranch           |                 |               |
    |            |  (fileChanges, expectedHeadOid concurrency guard; |               |
    |            |   commit auto-signed as the App [23][24])         |               |
 5. |            |--------------- static gates: path allowlist, diff budget,         |
    |            |                lint, tsc  ------------------------------------->  |
 6. |            |                |--npm install + build in ephemeral,               |
    |            |                |  egress-restricted, secretless container         |
 7. |            |--open PR ----->|                |                 |               |
 8. |            |                |--POST /v13/deployments {gitSource} [33]          |
    |            |                |                |     QUEUED->BUILDING->READY     |
    |            |                |                |     -> unique preview URL       |
 9. |            |                |                |                 |<--rendered-   |
    |            |                |                |                 |   preview     |
    |            |                |                |                 |   assertions: |
    |            |                |                |                 |   meta-diff,  |
    |            |                |                |                 |   v.Nu [37],  |
    |            |                |                |                 |   JSON-LD     |
    |            |                |                |                 |   rule-pack,  |
    |            |                |                |                 |   LHCI vs     |
    |            |                |                |                 |   baseline    |
    |            |                |                |                 |   [40], lychee|
10. |            |<--post results as GitHub Checks on the PR head SHA ------------|  |
11. |  LOW tier: enable auto-merge only after all checks pass                        |
    |  (post-March-2026 GitHub rule: enabling earlier returns 422 [77])              |
    |  MEDIUM tier: ApprovalGate workflow waits for the human's signal (§4.3)        |
12. |            |--merge (expectedHeadOid guard) -> production deploy               |
13. |            |--ledger: batch applied; spawn ChangeLifecycle monitor (§4.4)      |
```

One logical SEO change per PR is a design input, not a habit: it keeps every batch revert-clean
and maps the rollback unit exactly onto the ledger's batch.

**The customer's host deploy quota is a first-class constraint on this path.** Steps 8 and 12
spend two deploys per batch — one preview, one production — on the *customer's own* hosting plan,
not ours. Vercel allows 100 deployments/day on Hobby, 6,000 on Pro, 24,000 on Enterprise, with
per-hour ceilings of 100/450/1,800, per-5-minute ceilings of 60/120/300, and a 45-minute build
cap [35]; Netlify is tighter — 3 deploys/minute and **100 API deploys/day** [36]. Read against
§6.4's budget (auto-apply ≤ max(20, 2% of indexed pages)/site/day, batch ≤ 50 pages), a 100k-page
site at the cap is ~2,000 changes/day ⇒ ~40 batches ⇒ **~80 deploys/day**, which fits a Vercel Pro
plan and does not fit Hobby or Netlify's 100/day at all. So:

- `deploys_per_day` is a project quota (§2.4), read from the customer's plan at onboarding, and
  `max_batches_per_day = floor((deploys_per_day − headroom) / 2)` becomes a hard input to the
  §6.4 budget — the binding constraint is whichever of the two is lower.
- The per-5-minute and per-minute ceilings are pacing inputs, not just daily caps: batches are
  spaced by the orchestrator rather than fired as a burst at the end of P11.
- A customer on a free/entry host tier is onboarded with the ceiling stated in writing ("your plan
  supports N validated changes/day"), because it caps the product, not just the pipeline.
- Rung 3's platform-owned preview moves the *preview* deploy onto platform infrastructure and off
  the customer's quota, halving the per-batch spend to one deploy — which is the escape hatch when
  the host plan is the binding constraint.

### 5.3 Two-speed rollback

| Speed | Mechanism | Latency | Role |
|---|---|---|---|
| **Platform instant** | Vercel Instant Rollback (repoints production domains to a prior deployment, no rebuild) [34]; Netlify deploy `restore` [36] | Seconds | Emergency path while the durable path runs; caveats modeled: post-rollback Vercel disables production auto-assignment until explicitly promoted, and env/cron state reverts with the build [34] |
| **Git durable** | GraphQL `revertPullRequest` creates the revert PR [23]; it flows through the same required checks and auto-merge | Minutes (CI) | Permanent, auditable reversal; conflict (a human edited the same lines) ⇒ file the revert PR and escalate, never force |
| **CMS ledger restore** | Re-apply the ledger's `before` values per object, reverse order, verifying each write | Seconds | The source of truth on WP/Shopify: WordPress revisions do not reliably capture SEO-plugin meta, so the Platform's own before-images are the rollback substrate |
| **Edge** | Disable the rule / roll back the worker version | Seconds | Plus gradual-deployment ramps for HIGH-visibility changes |

**The "seconds" column is host-conditional.** Platform-instant rollback exists only where the host
sells it: Vercel Instant Rollback and Netlify deploy restore. A git-deployed customer on Amplify,
Cloudflare Pages, Render, Fly, or self-hosted Docker degrades to **git-revert-only**, i.e. the
durable lane at CI latency (minutes), with no seconds-grade emergency path. That is stated at
onboarding, and it shifts the risk policy for that project: with no instant lane, HIGH-visibility
change types stay a tier higher and batches stay smaller, because mean-time-to-revert is the
denominator of the whole safety argument. (Non-git channels are unaffected — the CMS ledger
restore is the Platform's own mechanism and is seconds-grade everywhere.)

**Structural absence and transient failure are two different conditions, with two different
policies.** The paragraph above is case (b): a host that *structurally never had* an instant lane.
Those projects are onboarded git-revert-only and keep deploying, under the tightened risk policy
just described. Case (a) is a project whose host *does* sell instant rollback but whose rollback
path is unavailable right now — there the Platform **freezes new deploys to that site until the
path is healthy** (Doc 05 §12), because deploying with a broken emergency brake is a different risk
from deploying with a known-slower one. Doc 05's **Hard (per-site)** dependency label on the deploy
hosts scopes to case (a) only; it is not a permanent freeze on every non-Vercel/Netlify customer.

Reverts run the same validation pipeline as forward changes (a revert of a stale page can 404),
only at elevated priority. And a rollback only restores the HTML: Google must still recrawl it
(days-to-weeks [42]), which the ledger surfaces honestly ("rollback applied; SEO state recovery
expected in N–M days").

---

## 6. The Decision Engine

### 6.1 Two axes, never one number

Blending "how sure is the AI" and "how dangerous is the action" into one score is a design error:
a 0.99-confidence robots.txt rewrite must still never auto-apply, and a 0.55-confidence alt-text
suggestion is harmless. The axes stay independent and meet only in the final matrix.

**Risk** is deterministic arithmetic:

```
risk_raw = B(type) x M_scope x M_traffic x M_velocity
risk     = clamp( risk_raw x (1 - trust), tier_floor(type), 100 )
```

- `B(type)`: base risk per change type, anchored to SPEC §14 (alt text 5, meta description 10,
  title 30, content update 40, single canonical 45 … robots.txt 100).
- `M_scope` (blast radius): 1.0 for one page up to 2.0 for >100 pages or any site-wide file.
- `M_traffic`: 0.8–1.6 by share of the site's last-28-day organic clicks at stake; any top-20
  page by clicks is "protected" and bumps one tier minimum.
- `M_velocity`: 1.0–1.5 by the share of the site changed in the rolling 7 days; above 10%, new
  LOW items queue as MEDIUM until pressure drops. Velocity capping is also the scaled-content-
  abuse defense: high-velocity automated modification is the exact pattern Google's March-2024
  policies target, and spam-update recovery takes months [44].
- `trust` (earned autonomy, 0–0.25): per site x change type, grown only by ≥50 applied changes at
  ≥95% KEEP with zero guardrail rollbacks; any rollback halves it. `tier_floor` guarantees
  deny-list types can never leave HIGH regardless of trust.

**Confidence** is dominated by deterministic validators, not model self-belief:

```
confidence = 0.55 x soft_validator_score + 0.25 x historical_acceptance
           + 0.20 x k_sample_self_consistency
```

Hard validators are gates (any failure blocks); soft validators score. The human merge rate of
past MEDIUM PRs per change type per site is a free, honest calibration signal, and k-sample
self-consistency (agreement across k independent generations of the same operation) is the third
term. The model's self-reported number is **not a term in the formula at all**: it is recorded in
the ledger as an audit column and used only as a regeneration flag (below 0.8 ⇒ regenerate or
downgrade). That is exactly what D-11's "recorded but never the gate" requires — perturbing the
self-report leaves the computed score unchanged.

### 6.2 The decision matrix (the actual gate)

| | risk < 25 (LOW) | 25–60 (MEDIUM) | > 60 (HIGH) |
|---|---|---|---|
| **confidence ≥ 0.85** | **AUTO-APPLY** (batched + monitored) | **AUTO-PR**, human merges | **RECOMMEND-ONLY** |
| **0.60–0.85** | AUTO-PR | RECOMMEND-ONLY | RECOMMEND-ONLY |
| **< 0.60** | Discard / regenerate (max 2) | Discard | Discard |

### 6.3 The hard deny-list (no score can override)

Ten change types carry risk floors no confidence score, trust level, or configuration can lower.
**Four are the client's**, from SPEC §14's HIGH list (recorded as D-13); **six are this Platform's
own extensions**, added on blast-radius grounds and marked † so the provenance stays visible rather
than being inferred as part of the client's list (Doc 02 §2.5 carries the full justification):

| Change type | Floor `B` | Provenance |
|---|---|---|
| robots.txt edit (any) | 100 | SPEC §14 / D-13 |
| Mass redirects / URL restructuring | 95 | SPEC §14 / D-13 |
| Page deletion (404/410) | 95 | SPEC §14 / D-13 |
| Canonical changes >10 pages | 90 | SPEC §14 / D-13 |
| noindex insertion **or removal** | 90 † | Platform extension |
| Site-wide template edits (nav/footer/header) | 80 † | Platform extension |
| hreflang cluster restructuring | 70 † | Platform extension |
| Host-level redirect policy (HTTP→HTTPS, www resolution) | 90 † | Platform extension |
| Server-/framework-config changes (`.htaccess`, `next.config` redirects/headers, middleware) | 90 † | Platform extension |
| Navigation/architecture changes (crawl-depth fixes, link pruning) | 80 † | Platform extension |

Mass redirects are a site-move-class event (weeks of fluctuation, months to stabilize [43]); a wrong
robots.txt line can block the whole site, and Google caches robots.txt up to 24h, so even an instant
rollback leaves a bad file live for up to a day [11]. Every floor is enforced structurally by
`tier_floor(type)`, never by threshold tuning — including the two rows where the floor deliberately
*overrides* the arithmetic rather than following it: site-wide template edits (which the ordinary
matrix would route through `M_scope` = 2.0) and the removal half of noindex. These ten never move
left; that is a permanent design state, not a maturity milestone.

### 6.4 Per-site change budgets

Hard caps outside the score: auto-apply ≤ max(20, 2% of indexed pages) changes/site/day; a single
batch ≤ 50 pages; all auto-apply frozen during a confirmed Google update rollout (attribution is
polluted and a change can couple to an algorithmic drop). Novel change types default to MEDIUM
until 50 observations exist. A fourth cap is external and easy to forget: on the GitHub PR path
the effective ceiling is `min(change budget, host deploy budget)` — two deploys per batch against
the customer's own plan quota (Vercel 100/6,000/24,000 per day by tier, Netlify 100 API
deploys/day [35][36]), tracked as the `deploys_per_day` project quota and derived in §5.2.
These budgets, plus "net-new pages are never auto-published," are the
policy-compliance-by-construction posture (D-16).

---

## 7. Multi-tenancy and security architecture

### 7.1 Pooled Postgres with RLS

One Postgres, one Valkey, shared workers (the AWS pool model): `project_id` on every tenant row,
plus Row-Level Security as defense-in-depth: policies of the form
`USING (project_id = current_setting('app.current_tenant')::uuid)`, the app connecting as a
**non-owner role without BYPASSRLS** (table owners silently bypass policies), and the tenant GUC
(Grand Unified Configuration — a Postgres session variable, here `app.current_tenant`) set per
transaction with `SET LOCAL` so transaction pooling stays safe [53]. The NestJS
interceptor sets it per request; workers set it per job. RLS converts tenant isolation from a
code-review hope into a database-enforced constraint; the application-layer guard remains
mandatory above it (two independent layers).

### 7.2 Customer credentials: KMS envelope encryption

Two trust domains, deliberately separate: platform-user auth (Clerk) and the customer-credential
vault. The vault: one KMS customer master key per environment ($1/key/month + $0.03/10k calls
[48]); per-tenant data keys generated via `GenerateDataKey`, the plaintext DEK encrypting that
tenant's tokens (AES-256-GCM) and then discarded; only the encrypted DEK is stored beside the
ciphertext, and DEK decryption happens only inside KMS HSMs, every use CloudTrail-logged [49].
At 1,000 tenants x 3 credentials this costs single-digit dollars a month versus ~$1,200/month in
per-secret managed storage ($0.40/secret/month [50]); Secrets Manager is reserved for the ~10–30
platform-level secrets (GitHub App private key, provider API keys, DB credentials). Decrypted
DEKs are cached in memory only, short TTL, wiped on job completion. Even if RLS failed, per-tenant
keys make cross-tenant credential data useless: two independent isolation layers.

**Google (GSC/GA4) OAuth is the third credential class, and it carries a go-live gate.** Each
customer grants the Platform `webmasters.readonly` (plus `analytics.readonly` for GA4) through
3-legged OAuth; the resulting **refresh tokens live in the same per-tenant KMS envelope as CMS
credentials**, with revocation propagated on disconnect and re-consent required on scope upgrade
(sitemap submission needs the read-write `webmasters` scope, requested incrementally, never
up-front — over-scoping is penalised in review). Those scopes are classified **sensitive**, so
publishing the app requires Google OAuth verification: registered domain and homepage, privacy
policy and ToS URLs, scope-usage justification, and a demo video, with review typically running
days to weeks and an annual re-verification treadmill [78][80]. Until verification completes the
app is capped at 100 test users [80] — a real schedule dependency that must start weeks before
launch, not a post-launch formality. Sensitive is *not* restricted: the CASA security assessment
(~$540 self-scan to $5k+ third-party pentest, annually renewed) applies only to restricted scopes
such as Gmail and Drive, and Search Console is not on that list [79] — so budget verification
effort, not a mandatory annual audit. **Fallback (D-22):** enterprise tenants who decline an OAuth
grant, and any tenant blocked by verification timing, are onboarded via the service-account invite
path — the Platform mints a per-tenant service account and the customer adds its `client_email` as
a user on the GSC property [81]. Same data, no consent screen, no refresh-token lifecycle, at the
cost of a manual step per property.

### 7.3 GitHub App token flow

```
 +--------------------+      1. JWT (app id, signed        +------------------+
 |  Token-mint        |         with App private key)      |  GitHub          |
 |  micro-service     |----------------------------------->|  POST /app/      |
 |  (only holder of   |                                    |  installations/  |
 |  the App private   |      2. installation access token, |  {id}/access_    |
 |  key, via KMS/     |<-----------------------------------|  tokens          |
 |  Secrets Manager)  |         expires in 1 HOUR,         +------------------+
 +---------+----------+         down-scoped per request:
           |                    repositories=[this repo],
           | 3. short-lived     permissions={contents:write,
           |    token only      pull_requests:write, checks:write,
           v                    metadata:read}   [21]
 +--------------------+
 |  Pipeline workers  |   4. branch / commit / PR / checks calls; per-installation
 |  (never see the    |      rate buckets isolate tenants (5,000/h base, 12,500/h cap
 |  private key)      |      [22]); commits auto-signed + Verified as the App [24]
 +--------------------+
```

GitHub App only, never OAuth Apps or PATs (D-18): per-installation repo selection, 1-hour tokens
minted per pipeline run and scoped to a single repo and minimal permissions [21], Checks API
access (fine-grained PATs cannot call it), and per-installation rate buckets that make one
customer's burst invisible to another [22]. The App private key is the highest-value secret in
the system; it lives in the vault and is read by exactly one small token-mint service.

### 7.4 Egress-isolated crawler (SSRF)

The crawler fetches attacker-influenceable URLs by design (customer input, every discovered link,
every redirect Location). Controls, per the OWASP SSRF guidance [51]:

- Validate the **resolved IP, not the hostname**, and pin the vetted IP into the actual socket
  connect (custom lookup/agent or an enforcing egress proxy at CONNECT time); resolve-then-check
  alone is bypassable via DNS rebinding.
- Block RFC1918, loopback, link-local (including cloud metadata 169.254.169.254), CGN, and
  IPv6 equivalents; scheme allowlist http/https; port allowlist 80/443.
- Disable automatic redirect following; re-validate every hop.
- Browser workers are SSRF engines too: all Playwright traffic routes through the same enforcing
  proxy; `file://` disabled.
- Network posture: crawler workers in an egress-only segment with no route to internal services
  or the database, and **no ambient cloud credentials** on crawler nodes; only the API layer talks
  to Postgres. Domain-ownership verification (DNS TXT or GSC property) gates any above-guest crawl
  rate, so the Platform cannot be weaponized against third parties.
- The build sandbox (§2.11) inherits the same posture: customer `npm install` is treated as
  hostile code in an ephemeral, secretless, egress-restricted, single-tenant container.

### 7.5 Prompt-injection firewall

Crawled and competitor page text is untrusted input flowing into LLM prompts: indirect prompt
injection, OWASP LLM01 [52]. The firewall is architectural, not prompt-level:

1. **Privilege separation:** models that read crawled content have no tools, no credentials, and
   no deploy path. Deployment is deterministic code consuming validated action records; models
   with GitHub/CMS access never see raw crawled HTML.
2. **Closed-vocabulary output:** every response is constrained to the action schema (closed
   `action` enum, bounded field lengths); injected text cannot invent action types or side
   effects.
3. **Content segregation:** untrusted page text is delimited and labeled as data; instructions
   live only in the cached system prefix.
4. **The Validation Engine as firewall:** independent non-LLM checks on every action; inserted
   links must target the tenant's own verified domain; generated values are rejected if they
   contain URLs, domains, or phone numbers absent from the tenant's own site data (the classic
   link-exfiltration payload).
5. **Human approval for MEDIUM/HIGH** (the OWASP human-in-the-loop control), and full
   prompt/output logging per action for forensics.

### 7.6 Audit surface

Three interlocking records: the human audit log (every approve/reject/rollback/policy change),
the change ledger + `change_event` spine (every mutation the system ever made, with model,
prompt version, reason, and validation payloads), and Temporal's replayable per-workflow event
histories. Together they satisfy NFR-3 and NFR-5 and double as the disclosure trail a site owner
would need in a manual-action review.

---

## 8. Named stack (SPEC §19)

| Slot | Selection | One-line reason | Detail |
|---|---|---|---|
| Database | PostgreSQL 16+ with pgvector | Facts, graph edges, vectors, and the ledger behind one query planner; RLS tenancy [15][53] | Doc 04 §DB |
| Cache | Valkey 9 (self-host MVP; ElastiCache Valkey managed) | Redis-compatible, BSD-licensed, 20–33% cheaper managed [57][58] | Doc 04 §Cache |
| Queue | BullMQ (on Valkey) for page-level jobs; Temporal owns site-level state | Queues can't hold approval gates or 30-day timers; the split is load-bearing [59][1] | Doc 04 §Queue |
| Object storage | Cloudflare R2 (S3-compatible API, so any S3-compatible store is a drop-in), zstd-compressed raw HTML | Zero egress fees at $0.015/GB-month — decisive because workers re-read the archive constantly (rule-version replays, before/after evidence, AI context), and on S3 that re-reading bills at ~$0.09/GB on top of storage; ~$0.03–0.04/month per 100k-page site for raw HTML at one retained version (~$1.50/month for all artifacts at four versions, §3.2) [76][12][13] | Doc 04 §Storage |
| Search engine | Postgres FTS (`tsvector`; ParadeDB `pg_search` BM25 when ranking demands) | Covers mention-search for anchors at MVP; OpenSearch deferred to 100M+-row analytics (D-05) [69] | Doc 04 §Search |
| AI providers | Anthropic Claude tiering (Haiku 4.5 bulk / Sonnet 5 judgment / Opus 5 judging), Batch API + prompt caching; multi-provider structured-output capable; OpenAI text-embedding-3-small for embeddings | ~$4.50–13.50 per 1k pages analyzed; embeddings ~$0.30/10k pages [63][17] | Doc 05 |
| Batch analysis worker | Python (rustworkx/igraph graph scoring; GLiNER NER fallback) | The one non-Node service in the stack — those libraries have no Node bindings and a 100k-page graph scores in seconds [16]; no HTTP surface, no credentials, no schema: reads `pages`/`links`, writes score columns, exits (D-39). Removed only if a graphology POC benchmarks acceptably at ~10M edges | Doc 04 §3.7 |
| External APIs | GSC Search Analytics + URL Inspection (`webmasters.readonly` [72], a sensitive scope requiring Google app verification before launch, §7.2 [78][80]; published quotas are 1,200 QPM and URL Inspection 2,000/day + 600/min [18] — the ~50k rows/day/site/search-type ceiling is a community-measured estimate° [92], not a Google quota); GA4 Data API (free [20]); GitHub App API; WordPress REST; Shopify Admin GraphQL; Vercel/Netlify deploy APIs; DataForSEO (SERP $0.60/1k [64], Content Parsing [86], Labs search-intent [87]) + Serper behind a SerpProvider abstraction; PSI/CrUX (free) | Each quota-budgeted per §2 components; the host deploy quota is budgeted per *customer plan* (§5.2) | Doc 05 |
| Scheduler | Temporal Schedules (one per site, overlap-skip) | Cron with overlap protection, inside the same engine that owns the run [1] | Doc 04 §Orchestration |
| Logging | OpenTelemetry SDK everywhere → Grafana Cloud Loki; Sentry for errors ($26/mo Team [60]) | One trace spans client → workflow → activities [62] | Doc 04 §Observability |
| Monitoring | Grafana Cloud (free tier at MVP [61]) + Temporal Web UI for workflow forensics | Alert set includes every ROLLBACK decision (page-worthy) | Doc 04 §Observability |

---

## 9. Scale path (what changes at 100 vs 10k vs 100k+ pages)

The architecture is sized so that nothing is rewritten between tiers; components change
parameters, then (on named triggers) gain named escape hatches. Cost envelopes per tier
(steady-state, from the cost model): small ~$20–70/mo, medium ~$250–600/mo, large
~$900–2,800/mo; onboarding one-time <$5 / $60–150 / $700–1,500 (D-36; full breakdown in Doc 04's
cost section and Doc 02).

| Concern | 100 pages | 10,000 pages | 100,000+ pages |
|---|---|---|---|
| Crawl | Single worker, one wave, minutes | Static-first waves; sitemap-first seeding; incremental recrawl by priority score | Shared lockable frontier (Crawlee RequestQueueV2) across multiple workers [9]; per-pattern sampling caps; ~5.5 h static at a polite 5 req/s; rendered-only-where-proven |
| Rendering | Rarely triggered | Template-level escalation (~10% detection sampling [6]) | Same mechanism; browser workers scale as a separate, ~10x-heavier worker class [7] |
| GSC ingestion | Search Analytics API only | API; watch the ~50k rows/day° truncation, detected empirically [92] | Bulk Export → BigQuery → ELT into the same fact table [19]; BigQuery holds deep history, Postgres holds rolling aggregates |
| Analysis | All pages every run | Changed-pages-only re-analysis (content-hash gate) | Same; graph batch still seconds in-process [16]; per-project partial indexes on hot tables |
| AI spend | <$2 onboarding, $3–10/mo | Haiku triage all + Sonnet deep on top ~30%: $50–200/mo | Haiku triage (~$450 one-time) + Sonnet deep on ~20k: $250–800/mo; Batch + caching mandatory [63] |
| Vectors | Trivial | Trivial (10⁵ vectors) | Still inside pgvector comfort; **trigger (D-05): >5–10M vectors platform-wide → pgvectorscale (StreamingDiskANN) or split to Qdrant** [67][68][71] |
| Graph | In-process | In-process | In-process; **trigger (D-05): interactive multi-hop graph exploration as a sold product feature → add Memgraph, Postgres stays canonical** |
| Search/analytics UI | Postgres | Postgres (+ pg_search if BM25 quality needed) | **Trigger (D-05): faceted crawl-analytics UI over 100M+ rows → add OpenSearch as a read-only projection** [69] |
| Orchestration | Temporal Cloud, ~$100/mo floor [1] | Same; fairness keys on | Same architecture; ~15M actions/mo at ~5k sites ⇒ **~$800/mo at list price** ($100 including the first 1M actions + $50/M thereafter [1]); no volume discount is assumed, so no lower figure is published. Self-hosting becomes the question only when Cloud spend durably exceeds ~$1.5–2k/mo (self-host floor is $400–900/mo infra plus real ops attention) — at $800, ~5k sites is roughly half-way to that line, so the trigger is nearer ~10k sites |
| Queue/cache | One small Valkey | Same | Dragonfly is the pre-researched scale-up if a single-threaded Valkey saturates (requires `{hashtag}` queue naming + emulated-cluster flags [59]) |
| Index verification | URL Inspection covers everything | Budgeted sampling | 2,000/day/property is a 50-day full sweep [18] ⇒ changed-URLs-only on a decaying schedule, plus optional server-log Googlebot sightings as a quota-free recrawl signal |

The triggers are monitored, not discovered: vector counts, per-query graph latencies, analytics
row counts, and Temporal spend are standing dashboard series with the D-05 thresholds drawn on
them.

---

## 10. Requirements traceability

| Doc 01 requirement | Architecture element |
|---|---|
| FR-1.x (crawling) | §2.5 Crawler, §2.6 Queue, §3.2 raw-HTML store |
| FR-2.x (website understanding) | §3.1 data plane, §2.7 graph worker, embeddings |
| FR-3.x (detection) | §2.7 SEO Analyzer rulebook |
| FR-4.x (AI engine) | §2.8 typed-operation emitter, §7.5 firewall |
| FR-5.x / FR-6.x (keywords, GSC) | §3.1 search facts, §2.7 opportunity/decay detectors |
| FR-7.x (competitor analysis) | §2.14 Competitor Intelligence (SERP + fetch ladder + gap set-arithmetic + the five gates), `serp_results`/`competitor_pages` in §3.1, phase P6 in §4.2; evidence feeds §2.8 |
| FR-8.x (internal linking) | §2.15 Internal-Link Engine (three-channel candidates, PageRank-deficit scoring, anchor-usage ledger), `link_candidates`/`anchor_usage` in §3.1, phase P7 in §4.2; link ops flow the same ledger and Decision Engine path as every other change |
| FR-9.x / FR-10.x (site modification, GitHub) | §5 Change Application Layer, §5.2 sequence |
| FR-11.x (confidence-based automation) | §6 Decision Engine |
| FR-12.x (validation) | §2.11 Validation Engine |
| FR-13.x (change tracking) | §3.3 event-sourced ledger |
| FR-14.x (rollback) | §4.4 ChangeLifecycle, §5.3 two-speed rollback |
| FR-15.x (autonomous scheduling) | §4 Temporal workflows and Schedules |
| FR-16.x (platform surface, named stack) | §2 components, §8 named stack |
| NFR-1 (safe) | §4.4 guardrails, §6 matrix + deny-list, §5.3 rollback |
| NFR-2 (scalable) | §9 scale path |
| NFR-3 (explainable) | §3.3 ledger, §7.6 audit surface |
| NFR-4 (autonomous) | §4 loop; autonomy bounded per tier by §6 |
| NFR-5 (secure) | §7 entire section |
| NFR-6 (cost-bounded) | §9 cost rows; cost strategies are architecture requirements (static-first, hash-gated re-analysis, tiering, Batch, caching) |
| NFR-7 (justified selections) | Every pick in §2 and §8 states one load-bearing reason; the full compared alternatives, with the runners-up and why they lost, are Doc 04's subject — this document deliberately does not restate them |
| NFR-8 (policy-compliant) | §6.4 budgets, §4.4 update-freeze, never auto-publishing net-new pages |

---

## Sources

"°" marks a figure from a secondary source — a community measurement or third-party explainer,
not vendor documentation.

1. https://docs.temporal.io/cloud/pricing — Temporal Cloud pricing: Essentials $100/mo floor, 1M actions included, $50/M actions
2. https://temporal.io/blog/human-in-the-loop-approvals — signal-based approval pattern; durable timers for approval SLAs
3. https://arpitbhayani.me/blogs/temporal-primer/ — durable sleep semantics surviving restarts, zero cost while sleeping
4. https://github.com/temporalio/documentation/blob/main/docs/develop/task-queue-priority-fairness.mdx — task-queue fairness keys, weights, per-key RPS limits
5. https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/workflow/workflow-execution/event.mdx — 51,200-event / 50 MB workflow history limits
6. https://crawlee.dev/js/api/playwright-crawler/class/AdaptivePlaywrightCrawler — adaptive rendering-type detection, ~10% re-detection sampling
7. https://use-apify.com/docs/what-is-apify/apify-compute-units — ~3,000 pages/CU static vs ~300 pages/CU browser (≈10x)
8. https://www.searchviu.com/en/javascript-crawling-study-rendered-html-vs-original-source-code/ — 200-domain study: 96% of domains / 56% of URLs differ raw vs rendered
9. https://crawlee.dev/js/docs/experiments/experiments-request-locking — RequestQueueV2 request locking for multi-process crawling
10. https://www.rfc-editor.org/rfc/rfc9309.html — Robots Exclusion Protocol standard
11. https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt — robots.txt caching up to 24h; 5xx handling halts crawling
12. https://www.cloudzero.com/blog/s3-pricing/ — S3 Standard $0.023/GB-month
13. https://iipc.github.io/warc-specifications/specifications/warc-zstd/ — zstd-compressed web-archive practice
14. https://research.google.com/pubs/archive/33026.pdf — Manku et al. (WWW'07): 64-bit simhash near-duplicate detection
15. https://github.com/pgvector/pgvector — pgvector types (halfvec), HNSW, iterative index scans
16. https://graph-tool.skewed.de/performance.html — PageRank on 4.8M nodes / 69M edges: igraph 10.6 s
17. https://developers.openai.com/api/docs/pricing — text-embedding-3-small $0.02/M tokens
18. https://developers.google.com/webmaster-tools/limits — GSC quotas: 1,200 QPM, 50k rows/day/search-type, URL Inspection 2,000/day + 600/min per property
19. https://developers.google.com/search/blog/2023/02/bulk-data-export — GSC Bulk Data Export to BigQuery
20. https://developers.google.com/analytics/devguides/reporting/data/v1/quotas — GA4 Data API token quotas (200k/property/day; ≤10 tokens typical)
21. https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app — installation tokens: 1-hour expiry, per-request repo/permission down-scoping
22. https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps — per-installation rate buckets (5,000/h base, 12,500/h cap)
23. https://docs.github.com/public/fpt/schema.docs.graphql — GraphQL schema: createCommitOnBranch, revertPullRequest, expectedHeadOid, auto-merge mutations
24. https://github.blog/changelog/2021-09-13-a-simpler-api-for-authoring-commits/ — API-authored commits auto-signed and Verified
25. https://codemod.com/blog/iterative-ai-system — LLM codemod accuracy: 45.29% one-shot; ~54–55% after 4 refinement iterations
26. https://developer.yoast.com/customization/apis/rest-api/ — Yoast REST API is read-only (no POST/PUT)
27. https://shopify.dev/docs/apps/build/marketing-analytics/optimize-storefront-seo — global.title_tag/description_tag metafields; seo.hidden noindex
28. https://shopify.dev/docs/api/admin-graphql/latest/mutations/productUpdate — productUpdate seo{title,description}; write_products
29. https://community.shopify.com/c/shopify-apis-and-sdks/bug-report-productupdate-meta-property/td-p/2011037 — partial seo input nulls the omitted field
30. https://shopify.dev/docs/api/usage/limits — cost-based limits: 1,000-point bucket at 50 pts/s (Plus 2,000/100)
31. https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/ — HTMLRewriter streaming HTML rewriting
32. https://www.searchpilot.com/engineers — proxy/edge SEO architecture with transparent-proxy failover
33. https://vercel.com/docs/rest-api/deployments/create-a-new-deployment — POST /v13/deployments with gitSource; deployment states
34. https://vercel.com/docs/instant-rollback — instant rollback semantics; disabled auto-assignment caveat
35. https://vercel.com/docs/limits — deployment/day and build-time limits by plan
36. https://docs.netlify.com/api/get-started/ — Netlify API deploys and restore; API limits
37. https://github.com/validator/validator — Nu Html Checker (v.Nu)
38. https://developers.google.com/search/blog/2020/12/structured-data-testing-tool-update — SDTT deprecation; no Rich Results Test API
39. https://developers.google.com/search/blog/2022/01/url-inspection-api — URL Inspection API richResultsResult verdicts
40. https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md — LHCI assertions, budgets, median-run aggregation
41. https://github.com/lycheeverse/lychee — async link checker incl. anchor fragments
42. https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl — recrawl "a few days to a few weeks"
43. https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes — site-move settling: weeks to months; redirects ≥1 year
44. https://developers.google.com/search/docs/essentials/spam-policies — scaled content abuse, site reputation abuse (March 2024 policies)
45. https://google.github.io/CausalImpact/CausalImpact.html — BSTS counterfactual inference; validity assumptions
46. https://www.searchpilot.com/resources/blog/the-math-behind-searchpilot-how-seo-a/b-testing-actually-works — control-page counterfactual methodology; updates/seasonality cancel
47. https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops — confounders; YoY comparison guidance
48. https://aws.amazon.com/kms/pricing/ — KMS $1/key/month + $0.03/10k requests
49. https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html — envelope encryption, data keys, CloudTrail logging
50. https://aws.amazon.com/secrets-manager/pricing/ — $0.40/secret/month + $0.05/10k calls
51. https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html — SSRF: resolved-IP validation, DNS rebinding, metadata IPs, redirect re-validation
52. https://genai.owasp.org/llmrisk/llm01-prompt-injection/ — OWASP LLM01: indirect injection; privilege separation, segregation, HITL
53. https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/ — pooled RLS pattern: current_setting policies, BYPASSRLS caveat, SET LOCAL with pooling
54. https://clerk.com/pricing — free 50k users; Pro $25/mo; SAML $75/mo/connection
55. https://nextjs.org/docs/app/getting-started/deploying — Next.js self-hosting (Node/Docker, all features); LTS/security-release program at https://nextjs.org/blog/july-2026-security-release
56. https://github.com/nestjs/nest/releases — NestJS 11 release cadence; platform-fastify maintenance
57. https://valkey.io/ — Valkey 9, BSD-3, Linux Foundation
58. https://aws.amazon.com/elasticache/pricing/ — ElastiCache Valkey 20–33% below Redis OSS pricing
59. https://docs.bullmq.io/guide/redis-tm-compatibility — BullMQ requires Redis ≥6.2 semantics; Dragonfly officially tested
60. https://sentry.io/pricing/ — Sentry Team $26/mo
61. https://monitoringcost.com/grafana-cloud-pricing — Grafana Cloud free tier: 10k series, 50 GB logs/traces
62. https://docs.temporal.io/develop/typescript/observability — Temporal metrics + OTel tracing across workflow/activities
63. https://platform.claude.com/docs/en/about-claude/pricing — Claude pricing; Batch API 50% off; prompt-cache hits 0.1x input
64. https://dataforseo.com/apis/serp-api — DataForSEO SERP Advanced $0.60/1k
65. https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/ — Application Passwords (core since WP 5.6, HTTPS-only, per-app revocable)
66. https://zyppy.com/seo/title-tags/google-title-rewrite-study/ — Google rewrites 61.6% of titles (n=80,959)
67. https://github.com/timescale/pgvectorscale — StreamingDiskANN scale-up path for pgvector
68. https://leanopstech.com/blog/qdrant-cloud-pricing-2026/ — Qdrant resource-based pricing at 1M–50M vectors
69. https://pulse.support/kb/opensearch-vs-elasticsearch — OpenSearch Apache-2.0 licensing vs Elastic triple license
70. https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api — secondary limits: 80 content-writes/min, 500/h
71. https://clickhouse.com/resources/engineering/scale-vector-search-postgres — pgvector memory/scale ceilings (~10–20M vectors)
72. https://developers.google.com/webmaster-tools/v1/how-tos/authorizing — GSC OAuth scopes (webmasters.readonly)
73. https://support.google.com/analytics/answer/11198161 — GA4 data freshness; key-event attribution restated up to 12 days
74. https://www.searchenginejournal.com/google-changes-more-than-61-percent-of-title-tags/435618/ — SEJ coverage of the Zyppy title study; rewrite floor 39–42% at 51–60 characters
75. https://serpclix.com/blog/google-rewrites-title-tags-how-to-survive — Q1-2025 update: title-rewrite rate ~76%
76. https://developers.cloudflare.com/r2/pricing/ — Cloudflare R2: $0.015/GB-month, **zero egress**, Class A writes $4.50/M, Class B reads $0.36/M, 10 GB free tier
77. https://github.com/orgs/community/discussions/190610 — March 25 2026 behavior change: auto-merge can only be enabled once all PR requirements are already met, otherwise HTTP 422
78. https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification — sensitive-scope verification: domain, privacy policy, ToS, scope justification, demo video
79. https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification — restricted scopes require a CASA assessment; Search Console scopes are not on that list
80. https://support.google.com/cloud/answer/13463073 — OAuth verification help center; 100-user cap while unverified; annual re-verification
81. https://www.indexernow.com/fix/service-account-owner-gsc — service-account-added-as-a-GSC-user pattern (the no-OAuth fallback)
82. https://zyppy.com/seo/seo-study/ — 23M internal links across 1,800 sites: inbound-link curve (gains flatten 40–44, decline after ~45–50), exact-match anchor ~5x, anchor variety
83. https://www.searchpilot.com/resources/case-studies/impact-of-internal-linking-seo — SearchPilot internal-linking split tests (+7% organic traffic to linked pages)
84. https://www.searchpilot.com/resources/case-studies/server-side-rendering-internal-links — JavaScript-injected internal links show no detectable SEO impact vs server-rendered
85. https://www.screamingfrog.co.uk/seo-spider/tutorials/link-score/ — Link Score: internal-PageRank metric on a 0–100 log scale
86. https://docs.dataforseo.com/v3/on_page-content_parsing-live/ — DataForSEO Content Parsing Live: headings, text, anchors/urls arrays; 20 URLs per request
87. https://docs.dataforseo.com/v3/dataforseo_labs-google-search_intent-live/ — Labs search-intent: 4 intent classes + probabilities, up to 1,000 keywords per call
88. https://ipullrank.com/vector-embeddings-is-all-you-need — embedding/cosine methodology for content-gap analysis (~0.75 same-topic threshold)
89. https://www.advancedgsc.com/blog/keyword-cannibalization-google-search-console — GSC-native cannibalization detection: same query, ≥2 URLs with impressions, 6–12-month window
90. https://arxiv.org/abs/2311.08526 — GLiNER: zero-shot NER, Apache-2.0, CPU-viable (the open-source entity-extraction fallback)
91. https://www.seo-stack.io/blog/why-does-google-search-console-have-a-16-month-data-limit — GSC 16-month rolling retention **[secondary °]**
92. https://www.analyticsedge.com/blog/download-over-25000-rows-from-google-search-console-api/ — pagination beyond 25k rows; ~50k rows/day/site/search-type ceiling **[secondary °]**
