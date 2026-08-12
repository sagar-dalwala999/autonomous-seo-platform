# Platform Architecture — Frontend, API, Platform Auth, Project Management, Cache

Gap-fill lane for SPEC §19 (the required chain *Frontend → API → Authentication → Project
Management → …*) and §20 (2–3 compared options per major component). This file covers the
platform's own customer-facing plane — the parts a paying customer logs into — plus the shared
cache. It deliberately does **not** re-cover customer-credential OAuth/secret storage
(`cost-security.md`), the queue itself (`crawling.md`, `orchestration.md`), or the database
(`data-model.md`). It builds on those lanes' settled picks: Node/TypeScript everywhere, Crawlee +
BullMQ workers, Temporal backbone, PostgreSQL 16+ (pgvector) as the single system of record.
All product names, versions, and prices verified against vendor pages as of **August 2026**.

## Summary

- **Frontend: Next.js 16 (App Router, TypeScript), self-hosted in Docker** — current stable is
  16.3 (Aug 3, 2026) with an Active-LTS/Maintenance-LTS line and a formal security-release
  program, and first-class self-hosting (Node server or Docker, "all features" supported — no
  Vercel lock-in) [1][2][3]. UI layer: Tailwind + headless component kit, TanStack Query for
  server state. Runners-up: React Router v8 framework mode (leaner, fine choice) [4] and
  TanStack Start (rejected for now — still Release Candidate, not 1.0) [5].
- **API: NestJS 11 running on the Fastify adapter.** The control-plane API is structurally
  complex (auth guards, RBAC, multi-tenant scoping, webhooks, OpenAPI for a future public API)
  but low-throughput — the heavy work lives in workers/Temporal. NestJS gives the module/DI/guard
  skeleton and OpenAPI generation; Fastify underneath (v5.11.x, ~30k req/s class performance,
  schema-compiled validation) removes the Express tax [6][7]. Hono 4.13 is the minimalist
  alternative; tRPC v11 is an optional internal layer for the dashboard only, never the public
  surface [8][9][10].
- **Platform auth: Clerk (managed)** — free tier now covers 50,000 monthly users, Pro is
  $25/mo + $0.02/user overage; **Organizations are the decisive feature**: memberships,
  roles/permissions, invitations, verified domains, SAML/OIDC enterprise connections at
  $75/mo/connection — cheaper per SSO connection than WorkOS ($125) and an order of magnitude
  cheaper than Auth0's B2B tiers at scale ($150/mo at 500 MAUs → $3,800/mo at 20k) [11][12][13][14].
  Documented exit path: Better Auth (open-source, TS-native, orgs/SSO/SCIM plugins, now
  Vercel-backed) if credential-sovereignty or cost ever forces self-hosting [15]; Keycloak 26.7
  (CNCF) only if an enterprise buyer mandates on-prem IdP [16].
- **Project management: build it — thin domain module on Postgres**, not a product to buy.
  Org/membership comes from Clerk; everything below (Project = one website property; its GitHub
  installation, GSC property, CMS connection, risk-tier approval policy, quotas, audit log) is a
  Postgres schema with `project_id` on every row (pool model) plus **Postgres RLS as
  defense-in-depth**, per the AWS tenant-isolation silo/pool/bridge framework and the
  session-variable RLS pattern [17][18].
- **Cache: Valkey 9 (BSD, Linux Foundation), one instance serving BullMQ + cache + rate-limit
  state; ElastiCache for Valkey when on AWS** (serverless is 33% cheaper than Redis OSS:
  $0.084/GB-hr + $0.0023/M ECPUs; node-based 20% cheaper) [19][20][21]. Redis 8's tri-license
  (RSALv2/SSPLv1/**AGPLv3**) makes Redis usable again, but Valkey is license-risk-free and
  cheaper managed [22]. Dragonfly is the documented scale-up path (officially BullMQ-tested, but
  requires `{hashtag}` queue naming + `--cluster_mode=emulated --lock_on_hashtags`) [23][24][25].
  Avoid per-command-billed Redis (Upstash PAYG at $0.20/100k commands) for queue workloads [26].

## Findings

### 1. Frontend

**What this frontend actually is.** An auth-gated B2B dashboard: project list → site health →
issue/opportunity feed → change review queue (diff view: old title vs AI title, confidence, risk
tier) → approval buttons → monitoring charts. Almost everything sits behind login, so the
dashboard's *own* SEO is irrelevant; SSR matters for perceived load speed and the public
marketing/login pages, not for indexing. The demanding UI pieces are diff review, large tables
(100k-page sites), and live status of running crawls/agent runs (SSE or polling against the API).

**Next.js 16 (App Router).** Current stable 16.3 released Aug 3, 2026; the 16.3 line advertises
90% less dev-mode memory and Turbopack persistent build caching [1]. Two facts matter for a
client deliverable more than features:

- **A real security posture now exists**: since July 2026 Next.js has a formal security-release
  program with patch lines for Active LTS (16.2.x) and Maintenance LTS (15.5.x) — the July 2026
  release patched 4 HIGH severity issues [2]. For a platform holding customers' GitHub access,
  a framework with an LTS + CVE process is a selection criterion, not a nicety.
- **Self-hosting is first-class**: Node server and Docker deployments support "all Next.js
  features"; static export and a verified-adapter API (Vercel, Bun verified; Cloudflare/Netlify
  in progress) cover the rest [3]. The lock-in objection to Next.js is materially weaker in 2026
  than it was in 2023–24.

**React Router v8 (the continuation of Remix).** Current version v8 is a non-breaking upgrade
from v7; baseline Node 22+, Vite 7+, React 19+, ESM-only [4]. Framework mode gives loaders/
actions/SSR with a much smaller conceptual surface than App Router. It is a legitimate pick; it
loses on ecosystem gravity — auth SDKs, examples, and hires all default to Next.js first.

**TanStack Start.** Router-first full-stack framework (typed server functions, SSR/streaming,
middleware; deploys to Node, Cloudflare, Netlify, Railway) — but it is still **Release
Candidate, not 1.0** as of Aug 2026 [5]. Wrong risk profile for a client deliverable.

**Vite SPA (no meta-framework).** Honest mention: because the app is behind login, a plain Vite
+ React SPA against the API would work and is the simplest to reason about. It costs SSR for the
public pages and forfeits the framework's file-based routing/code-splitting conventions. If the
implementing team is small and API-first, this is the acceptable minimum — but Next.js static
export can degenerate to nearly the same thing while keeping the upgrade path [3].

**Supporting picks** (stated for completeness, low controversy): Tailwind CSS + a headless
component library for the design system; TanStack Query for server-state (polling crawl/agent
status); SSE from the API for run progress. Charting for the monitoring views is covered by the
monitoring lane.

### 2. API layer

**Shape of the workload.** The API is a *control plane*: CRUD on projects/connections/policies,
read-heavy dashboards (aggregates come from Postgres, pre-computed by workers), webhook
receivers (GitHub App events, CMS callbacks), and command endpoints that enqueue Temporal
workflows / BullMQ jobs. It is not the hot path — crawling, AI generation, and validation all
run in workers. So the framework decision is about **structure, safety, and OpenAPI**, not raw
throughput.

**NestJS 11.** Actively maintained (v11.1.29 shipped Aug 10, 2026; monthly patch cadence)
[6]. Provides the things this specific API needs out of the box: modules + DI (clean seams for
`ProjectsModule`, `ConnectionsModule`, `ChangesModule`), guards/interceptors (where the
tenant-scoping and RBAC checks live — see §4), first-party OpenAPI generation, and first-party
queue integration (`@nestjs/bullmq`); its release notes show an actively maintained
`platform-fastify` adapter, i.e. Nest's HTTP layer can run on Fastify rather than Express [6].
Cost: learning curve and decorator ceremony.

**Fastify 5 (plain).** v5.11.x current; ~30k req/s class performance, 297-plugin ecosystem,
schema-compiled JSON validation and serialization, shipped TypeScript types [7]. A disciplined
team can build the same API on Fastify + Zod with less abstraction. The risk is architectural
drift: multi-tenant scoping enforced by convention instead of by a framework-level guard is
exactly where cross-tenant bugs are born.

**Hono.** Web-standards framework running on every JS runtime (Node, Bun, Cloudflare Workers,
Lambda…), current line 4.13.x [8][9]. Ideal for edge/lightweight services; for this platform its
edge-portability advantage is irrelevant (the API sits next to Postgres, Temporal, and Valkey in
one VPC) and its ecosystem for enterprise concerns (RBAC patterns, OpenAPI depth) is thinner.

**tRPC v11.** End-to-end type-safety with zero codegen between the Next.js dashboard and the
API; adapters for Next.js/Fastify; used by Netflix, PayPal, Cal.com [10]. Correct use here:
*optional internal BFF for the dashboard only*. The platform will need a REST/OpenAPI surface
anyway (webhooks, a future public API, CMS-plugin callbacks), so tRPC can never be the only
surface — adopt it later if dashboard/API type-drift becomes a real pain, not on day one.

### 3. Platform authentication (platform users — not customer credentials)

Scope: login, MFA, session management, org membership, enterprise SSO for the *platform's own
users* (agency staff, in-house marketers). The OAuth grants and secrets the platform holds *on
behalf of customers* (GitHub App tokens, GSC refresh tokens, WordPress app passwords) are a
separate trust domain covered in `cost-security.md` — deliberately isolated so a platform-auth
vendor breach cannot expose customer repo credentials.

**Scale reality check:** a B2B SEO platform has agencies and marketing teams as users — even 500
customers × 10 seats = 5,000 MAU. Every managed option's free/base tier covers that; the real
differentiators are **org modeling, enterprise SSO price per connection, and exit cost**.

- **Clerk** (managed, deep Next.js integration): Free tier up to 50,000 monthly users; Pro
  $25/mo with $0.02/user overage (volume-discounted to $0.012 at 10M+). B2B: 100 monthly
  retained organizations (MROs — orgs with 2+ active members) included free on all plans;
  enhanced B2B add-on $100/mo, then $1/org/mo (101–1,000) tapering to $0.60. Enterprise SSO:
  first SAML/OIDC connection included on Pro, additional **$75/mo each** (tapering to $15 at
  500+). Business plan $300/mo adds SOC2 report access + priority support [11]. Organizations
  provide memberships, app-level roles/permissions applied across all orgs, invitations,
  verified-domain auto-join, and per-org enterprise connections [12].
- **Auth0** (managed, most enterprise-proven): Free to 25,000 MAU incl. 1 enterprise connection
  and 5 organizations. But B2B paid tiers are punishing: Essentials **$150/mo at 500 MAUs
  scaling to $3,800/mo at 20,000**; Professional starts $800/mo; >20k MAU is contact-sales [13].
  For a startup platform this is the highest-TCO path by far.
- **WorkOS AuthKit** (managed, enterprise-SSO-first): **first 1M MAU free**, then $2,500/mo per
  additional million; SSO **$125/mo per connection** (volume discounts 20–60% above 15
  connections); Directory Sync same pricing; audit-log SIEM streaming $125/mo [14]. Best raw
  MAU economics; per-connection SSO is 1.7× Clerk's price, and the org/UI layer is thinner than
  Clerk's.
- **Better Auth** (self-hosted, open source): TypeScript auth framework — credentials, 34+
  social providers, passkeys/magic links, **multi-tenancy with teams/roles/invitations, SSO/
  SAML 2.0, SCIM/directory sync via plugins**, bring-your-own-database (i.e. our Postgres);
  fully open source with a paid cloud dashboard offering; announced it is **joining Vercel**,
  which resolves the sustainability question [15]. Zero per-MAU/per-connection fees; cost is
  owning security patches and building admin UI.
- **Keycloak 26.7.1** (self-hosted, CNCF incubating; released Aug 5, 2026): full OIDC/OAuth2/
  SAML IdP, MFA, LDAP/AD federation, fine-grained authz [16]. Heaviest ops burden (Java,
  clustering, upgrade treadmill); the right tool only when a buyer demands a self-hosted IdP.

### 4. Project / tenant management module

No off-the-shelf product covers this — it *is* the platform's domain model. What must exist,
mapped to the SPEC:

- **Tenancy hierarchy:** `Organization` (mirrors the Clerk org via webhook sync; agencies and
  in-house teams) → `Project` (one website property — the unit §19's whole pipeline hangs off)
  → per-project **connections**: GitHub App installation id + repo allowlist, GSC property,
  CMS/API credential *reference* (pointer into the secret vault from `cost-security.md`, never
  the secret itself), deployment target.
- **RBAC tied to §14 risk tiers:** roles (owner / admin / member / viewer) plus per-project
  grants; the critical permission is **who may approve MEDIUM-risk changes and who may alter a
  project's automation policy** (auto-apply thresholds, LOW-risk allowlist). Clerk's app-level
  roles/permissions cover the org layer [12]; the per-project approval matrix is our Postgres
  tables because it must join against changes/risk data.
- **Policy & quota:** per-project crawl budget, AI-token budget, concurrency class (feeds BullMQ
  Pro group caps from the crawling lane), plan entitlements.
- **Audit log:** append-only table capturing every human action (approve/reject/rollback/policy
  change) alongside the automated change ledger from §16 — a §22 requirement.
- **Isolation model:** AWS's canonical framing is **silo** (per-tenant stack), **pool** (shared
  infra, tenant-scoped rows), **bridge** (mix) [17]. This platform is a pool: one Postgres, one
  Valkey, shared workers — consistent with the data-model lane's `project_id`-on-every-row
  schema. Defense-in-depth: Postgres **RLS with a session variable** (`SET rls.org_id = …`;
  policies like `USING (org_id = NULLIF(current_setting('rls.org_id', TRUE),'')::uuid)`) keeps
  connection pooling viable while making cross-tenant reads a *database-enforced* impossibility
  rather than a code-review hope [18]. The API sets the variable per request in a NestJS
  interceptor; workers set it per job. (Caveats: superuser/`BYPASSRLS` connections skip
  policies; migrations must run through a separate role; the pattern needs the tenant column on
  every table — which the data-model lane already mandates.)
- **Compute isolation** for the truly dangerous shared surface — workers executing customer
  builds/tests during validation — is per-job sandboxing (containers), noted here as a boundary
  and owned by the github-validation lane.

### 5. Cache

**What "cache" actually is in this system.** Not an HTTP response cache — dashboard reads come
from Postgres aggregates. The Redis-protocol store carries: (a) **BullMQ job state** — the
load-bearing role; (b) crawl politeness/per-host rate state and URL-dedup sets (crawling lane
puts these in Redis) ; (c) API rate-limit counters and short-TTL lookups (session claims,
feature flags); (d) distributed locks. External-API response caching (GSC, SERP) belongs in
Postgres/object storage per the cost lane — it needs durability, not microseconds.

**The 2026 licensing landscape (why this comparison exists at all):**

- **Redis 8**: tri-licensed RSALv2 / SSPLv1 / **AGPLv3** — the AGPLv3 option (added with 8.0,
  after the March-2024 relicense backlash) makes Redis OSI-open-source again; 7.4–7.8 remain
  RSALv2/SSPLv1-only [22].
- **Valkey 9.1.1** (Jul 21, 2026): the Linux Foundation fork — BSD-3, "open source forever,"
  backed by AWS (ElastiCache) and Google (Memorystore) as first-class managed engines [19].
- **Dragonfly**: multithreaded Redis-compatible store; **officially tested by BullMQ** (one of
  the few vendors BullMQ names) [23], but with real integration constraints: queues must be
  named with hashtags (`{myqueue}`) so Dragonfly can pin each queue to a thread, and the server
  must run `--cluster_mode=emulated --lock_on_hashtags`; the fallback
  (`--default_lua_flags=allow-undeclared-keys`) "locks the entire data store for each Lua
  script" [24][25]. Cross-queue priorities/rate-limits may not function across split queues [24].

**BullMQ compatibility constraint:** BullMQ requires Redis ≥ 6.2 semantics and explicitly warns
that "not all the alternatives are going to work properly" — Dragonfly is the documented tested
vendor, and AWS MemoryDB/ElastiCache are the documented hosting paths [23]. Valkey forked from
Redis 7.2.4 (> 6.2) and is what ElastiCache now runs cheapest, and it is protocol-identical for
everything BullMQ uses; it is the pragmatic default even though BullMQ's docs don't yet list it
as a formally tested vendor — pin a version and run the queue test-suite in CI.

**Managed pricing anchors (Aug 2026):**

- **ElastiCache Serverless — Valkey**: $0.084/GB-hr storage + $0.0023 per million ECPUs, **33%
  below** Redis-OSS serverless ($0.125/GB-hr + $0.0034/M ECPUs); node-based Valkey is 20%
  below Redis OSS (e.g. cache.r7g.large $0.1752/hr ≈ $128/mo) [20][21].
- **Upstash Redis**: free 256 MB/500k commands; PAYG **$0.20 per 100k commands**; fixed tiers
  $10/mo (250 MB) – $1,500/mo (500 GB); prod pack (+$200/mo) for SLA/SOC2 [26]. The per-command
  meter is the trap: BullMQ workers poll and heartbeat continuously — a busy queue generates
  millions of commands/day, so PAYG pricing inverts (fine for a pure cache, wrong for a queue).
- Self-hosted Valkey on a small VM/container (1–2 GB) costs single-digit $/mo and is entirely
  adequate for MVP scale given the crawling lane keeps the page frontier out of BullMQ.

## Options compared

### Frontend framework

| Criterion | **Next.js 16 (App Router)** | React Router v8 (framework mode) | TanStack Start | Vite SPA + REST |
|---|---|---|---|---|
| Status (Aug 2026) | 16.3 stable, Active+Maintenance LTS, formal security releases [1][2] | v8 stable, non-breaking from v7 [4] | **Release Candidate** [5] | Stable tooling |
| SSR / public pages | Full, streaming | Full | Full (RC) | None (separate site needed) |
| Self-hosting | Node/Docker = all features; verified-adapter API [3] | Node/Docker | Node, CF, Netlify, Railway [5] | Any static host |
| Auth/ecosystem gravity | Highest (Clerk SDK first-class) | Medium | Small | Medium |
| Complexity tax | RSC/App Router learning curve | Low | Medium + churn risk | Lowest |
| Verdict | **Recommended** | Acceptable alternative | Too early | De-risked minimum |

### API framework

| Criterion | **NestJS 11 (+ Fastify adapter)** | Fastify 5 (plain) | Hono 4.13 | tRPC v11 |
|---|---|---|---|---|
| Version / cadence | v11.1.29, monthly patches [6] | v5.11.x [7] | 4.13.x [8][9] | 11.x [10] |
| Structure for RBAC/tenancy | Guards/interceptors/DI built-in | By convention | By convention | N/A (layer, not framework) |
| OpenAPI (public surface) | First-party generation | Via plugins | Via zod-openapi | None (internal only) |
| Raw perf | Fastify-class via adapter [6][7] | ~30k req/s class [7] | Comparable | N/A |
| Queue/Temporal integration | `@nestjs/bullmq`, DI-friendly workers | Manual wiring | Manual | N/A |
| Verdict | **Recommended** | Best for a tiny expert team | Edge-optimized, wrong fit | Optional dashboard BFF later |

### Platform authentication

| Criterion | **Clerk** | WorkOS AuthKit | Auth0 B2B | Better Auth (self-host) | Keycloak 26.7 |
|---|---|---|---|---|---|
| Free tier | 50k users [11] | 1M MAU [14] | 25k MAU [13] | Unlimited (OSS) [15] | Unlimited |
| Cost at ~5k B2B users | $0–25/mo [11] | $0 [14] | $150→$3,800/mo tiers [13] | Infra only | Infra + ops |
| Org/multi-tenant model | Best-in-class (MROs, roles, domains) [12] | Good | Good (5 orgs free) [13] | Plugin (teams/roles/invites) [15] | Realms (heavy) |
| Enterprise SSO price | $75/mo/conn [11] | $125/mo/conn [14] | Tier-gated [13] | $0 (SSO/SAML plugin) [15] | $0 |
| MFA, prebuilt UI | Yes, best UI kit | Yes | Yes | Yes, self-assembled | Yes, dated UX |
| Exit cost / lock-in | Medium (user export) | Medium | High | None — own Postgres | Low |
| Ops burden | None | None | None | Patching is on us | Highest (Java cluster) |
| Verdict | **Recommended MVP** | Best if SSO-count stays low & MAU huge | Avoid (TCO) | Documented exit path | Only if buyer mandates on-prem |

### Tenant isolation model (project management substrate)

| Criterion | **Pool + RLS (one Postgres, `project_id` rows)** | Schema-per-tenant (bridge) | DB/stack-per-tenant (silo) |
|---|---|---|---|
| Cross-tenant leak defense | RLS policy at DB level [18] | Schema boundary | Hard boundary |
| Ops at 500 tenants | One DB, one migration | 500 migrations per change | Fleet management |
| Cost | Lowest | Medium | Highest |
| Fit with data-model lane | Exact match (project_id everywhere) | Conflicts | Conflicts |
| Verdict | **Recommended** [17][18] | Only for an anchor tenant | Only for regulated buyers |

### Cache / Redis-protocol store

| Criterion | **Valkey 9 (self-host or ElastiCache)** | Redis 8 | Dragonfly | Upstash (managed) |
|---|---|---|---|---|
| License | BSD-3, Linux Foundation [19] | RSALv2/SSPLv1/AGPLv3 tri-license [22] | Source-available (BSL) | n/a (SaaS) |
| BullMQ status | Protocol-compatible (Redis 7.2.4 lineage; ≥6.2 req.) — not on BullMQ's tested-vendor list; verify in CI [23] | Native target [23] | **Officially tested**, needs `{hashtag}` queues + emulated cluster flags [23][24][25] | Works; per-command billing punishes queues [26] |
| Managed price anchor | Serverless $0.084/GB-hr, −33% vs Redis; nodes −20% [20][21] | Serverless $0.125/GB-hr [20] | Dragonfly Cloud / self-host | $0.20/100k cmds PAYG; $10–20/mo fixed tiers [26] |
| Scale ceiling | Vertical + cluster | Vertical + cluster | Multithreaded single node (25× claims) [25] | Tier-bound |
| Verdict | **Recommended** | Fine; no reason to prefer | Scale-up escape hatch | Cache-only niche; not for BullMQ |

## Recommendation & why

**The customer-facing plane is deliberately boring: Next.js 16 → NestJS 11 (Fastify) → Clerk →
in-house project module on Postgres+RLS → Valkey 9.** Every risky, novel part of this product
lives in the pipeline (AI changes to customer production sites); the plane customers log into
should maximize ecosystem maturity and minimize invented surface.

1. **Next.js 16** because it is the only frontend option combining stable-LTS + a formal CVE
   process [2] with full-featured self-hosting [3] and the deepest auth/UI ecosystem. React
   Router v8 is a respectable second; TanStack Start fails the "no RC dependencies in a client
   deliverable" bar [5].
2. **NestJS on Fastify** because the API's failure mode is not throughput, it is a
   *cross-tenant authorization bug*. Framework-level guards/interceptors give tenancy and RBAC a
   single enforced seam (paired with RLS below it), and first-party OpenAPI keeps the public
   surface honest [6][7].
3. **Clerk** because at B2B-SEO user counts the platform stays in free/low tiers for years
   ($25/mo Pro; 50k users included [11]), Organizations map 1:1 onto agency→client structure
   [12], and its $75/connection SAML is the cheapest managed enterprise-SSO path [11][14][13].
   Platform auth is kept in a separate trust domain from the customer-credential vault, so a
   vendor choice here never touches GitHub/CMS secrets. Better Auth is the pre-agreed exit
   (open-source, TS, same Postgres, Vercel-backed [15]) if sovereignty or price ever flips the
   calculus — and choosing that exit now, instead of Clerk, is a defensible alternative for a
   team that wants zero third parties in the login path.
4. **Build the project module** — it is the domain core (connections, §14 approval policy,
   quotas, audit), nothing off-the-shelf models "a website property with a GitHub installation,
   a GSC property, and a risk-tier automation policy." Pool tenancy + RLS is the only model
   consistent with the already-chosen single-Postgres schema, and RLS converts tenant isolation
   from convention to constraint [17][18].
5. **Valkey** because it is Redis-without-the-license-history at a 20–33% managed discount
   [19][20][21]; BullMQ's hard requirement is Redis ≥6.2 semantics [23], which Valkey satisfies.
   One instance carries queue + cache + limits at MVP scale; Dragonfly's documented BullMQ path
   (hashtag queues, emulated cluster [24][25]) is the pre-researched scale-up if a single-thread
   Valkey ever saturates — a distant concern given the crawling lane keeps page frontiers out of
   BullMQ.

## Risks & limitations

- **Clerk dependency risk:** login outage = platform outage; per-org MRO pricing can bite if the
  product pivots to thousands of tiny orgs ($1/org/mo beyond 100 [11]). Mitigations: session
  tokens are JWTs verifiable locally; keep a nightly user/org export; Better Auth exit path
  documented above.
- **Pricing volatility:** every number here (Clerk 50k free tier, WorkOS $2,500/M MAU, ElastiCache
  rates, Upstash meters) is Aug-2026 list price from vendor pages; re-verify at contract time.
  Clerk's page prices in "monthly retained users/organizations" — its retention-based metering
  definitions should be confirmed with sales before committing forecasts [11][12].
- **Valkey ≠ BullMQ-certified:** BullMQ's docs name Dragonfly (and Redis hosting on AWS) but do
  not yet list Valkey as a formally tested vendor [23]. Residual risk is low (Redis 7.2.4
  lineage) but non-zero across future BullMQ releases — pin versions and run BullMQ's behavior
  suite against Valkey in CI before every upgrade.
- **RLS is defense-in-depth, not a substitute:** policies are skipped by superuser/`BYPASSRLS`
  roles and mis-set session variables fail open to *empty* only if policies are written that way
  [18]; the application-layer guard remains mandatory, and RLS performance on the biggest tables
  (pages, GSC facts) needs an index-alignment pass.
- **App Router complexity:** RSC/server-actions are the steepest part of the stack; a team new to
  it should constrain itself to the "SPA-ish" subset (client components + TanStack Query) and buy
  SSR only where it pays.
- **Unverified small claims:** NestJS↔Fastify pairing and `@nestjs/bullmq` are documented
  first-party features, but the NestJS docs page fetch returned no body this session — verified
  indirectly via platform-fastify fixes in the v11 release notes [6]. Hono's release-page dates
  came back garbled in extraction (version 4.13.x is solid; treat exact dates as unconfirmed) [9].
- **Not covered here (owned elsewhere):** customer-credential OAuth/vault design and token
  encryption (`cost-security.md`); build/test sandboxing for validation workers
  (`github-validation.md`); queue topology and BullMQ Pro group fairness (`crawling.md`,
  `orchestration.md`); observability stack (`orchestration.md`).

## Sources

1. https://nextjs.org/blog — Next.js 16.3 released Aug 3, 2026; dev-memory and Turbopack build improvements
2. https://nextjs.org/blog/july-2026-security-release — formal security-release program; 16.2.x Active LTS / 15.5.x Maintenance LTS; 4 HIGH + 5 MEDIUM CVEs patched
3. https://nextjs.org/docs/app/getting-started/deploying — Node/Docker self-hosting "all features"; static export; verified adapters (Vercel, Bun)
4. https://reactrouter.com/ — React Router v8, non-breaking from v7; Node 22+/Vite 7+/React 19+ baseline
5. https://tanstack.com/start/latest — TanStack Start full-stack framework; Release Candidate status; deploy targets
6. https://github.com/nestjs/nest/releases — NestJS v11.1.29 (Aug 10, 2026); monthly patch cadence; platform-fastify maintenance
7. https://fastify.dev/ — Fastify v5.11.x; ~30k req/s claim; 297 plugins; schema-compiled validation; TS types
8. https://hono.dev/ — Hono web-standards framework; runtimes (Node, Bun, CF Workers, Lambda, Deno…)
9. https://github.com/honojs/hono/releases — Hono 4.13.x current line
10. https://trpc.io/ — tRPC v11; end-to-end typesafety without codegen; Next.js/Fastify adapters; adopters
11. https://clerk.com/pricing — free 50k users; Pro $25/mo + $0.02/user; 100 MROs free, B2B add-on $100/mo, $1/org overage; SAML $75/mo/connection; Business $300/mo
12. https://clerk.com/docs/organizations/overview — Organizations: memberships, app-level roles/permissions, invitations, verified domains, MRO definition (2+ active members)
13. https://auth0.com/pricing — free 25k MAU (1 enterprise connection, 5 orgs); B2B Essentials $150/mo @500 MAU → $3,800/mo @20k; Professional from $800/mo
14. https://workos.com/pricing — AuthKit first 1M MAU free, $2,500/mo per additional million; SSO & Directory Sync $125/connection/mo with volume discounts; audit-log SIEM $125/mo
15. https://www.better-auth.com/ — open-source TS auth framework; organizations/teams/roles, SSO/SAML/SCIM plugins, BYO-database; joining Vercel
16. https://www.keycloak.org/ — Keycloak 26.7.1 (Aug 5, 2026); CNCF incubating; OIDC/OAuth2/SAML, MFA, LDAP federation
17. https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/saas-tenant-isolation-strategies.html — silo / pool / bridge tenant-isolation models
18. https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres — RLS with `current_setting` session variable per tenant; pooling-friendly pattern
19. https://valkey.io/ — Valkey 9.1.1 (Jul 21, 2026); BSD-3; Linux Foundation; AWS ElastiCache + Google Memorystore managed support
20. https://aws.amazon.com/elasticache/pricing/ — Serverless Valkey $0.084/GB-hr + $0.0023/M ECPUs vs Redis OSS $0.125 + $0.0034 (−33%); node-based Valkey −20%; cache.r7g.large $0.1752/hr
21. https://aws.amazon.com/elasticache/pricing/ — node-based examples and reserved-rate application (same page, node section)
22. https://redis.io/legal/licenses/ — Redis ≥8.0 tri-license RSALv2/SSPLv1/AGPLv3; 7.4–7.8 dual source-available; ≤7.2 BSD
23. https://docs.bullmq.io/guide/redis-tm-compatibility — BullMQ requires Redis ≥6.2; "not all the alternatives are going to work properly"; Dragonfly officially tested; AWS MemoryDB/ElastiCache hosting
24. https://docs.bullmq.io/guide/redis-tm-compatibility/dragonfly — `{hashtag}` queue naming for thread assignment; cross-queue priority/rate-limit caveats
25. https://www.dragonflydb.io/docs/integrations/bullmq — required flags `--cluster_mode=emulated --lock_on_hashtags`; `allow-undeclared-keys` fallback locks whole store per Lua script
26. https://upstash.com/pricing — free 256 MB/500k cmds; PAYG $0.20/100k commands; fixed $10–$1,500/mo tiers; prod pack +$200/mo
