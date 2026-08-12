# Orchestration Backbone for the Autonomous SEO Loop (SPEC §18)

Research date: 2026-08-10. Scope: the execution backbone for the daily autonomous cycle
(check website → check GSC → check rankings → find opportunities → prioritize → generate →
validate → apply safe changes → monitor 14–30 days → measure → keep/rollback), evaluated against
long-running crawls, durable retries/idempotency, mid-workflow human approval, multi-week timers,
multi-tenant fairness, observability, small-team ops burden, and self-hosted vs cloud cost.

---

## Summary

**Recommendation: Temporal (TypeScript SDK) as the durable-execution backbone, consumed as
Temporal Cloud for MVP ($100/mo floor, 1M actions included), with BullMQ + Redis as the
high-volume page-level work queue *inside* crawl/render activities. LLM/agent frameworks
(LangGraph, CrewAI, Claude Agent SDK) are NOT the backbone — LLM calls run as plain activities
inside Temporal workflows.** This is the only option in the field that natively covers all five
hard requirements of this workload at once: multi-hour crawl activities with heartbeats, durable
14–30 day post-change monitoring timers that survive restarts and cost nothing while sleeping
[4][5], signal-based human-approval gates in the middle of a workflow (the MEDIUM-risk PR gate)
[4][6], per-tenant fairness keys with per-key rate limits on a single task queue [7][8], and a
complete, replayable per-workflow event history that doubles as the audit trail SPEC §16 requires.

The one structural rule that matters more than the engine choice: **never model per-URL crawl work
as workflow steps.** A 100k-page crawl expressed as engine steps is 100k+ billable actions/executions
per crawl in every cloud engine (it would blow through Inngest's 1M-included Pro quota in a day and
inflate Temporal actions ~100×). The workflow orchestrates ~10 coarse phases per site per day;
page-level fetch/render jobs go to BullMQ workers with an internal checkpoint cursor.

Runner-up for MVP simplicity: **Inngest** (fastest DX, sleeps up to 1 year, `waitForEvent` approval
gates, one-line per-tenant concurrency). Runner-up for an all-self-hosted mandate: **Hatchet**
(MIT, Postgres-only durability). Rejected as backbone: cron+BullMQ alone, custom state machine,
AWS Step Functions (unless the stack is already all-in AWS), and all LLM-agent frameworks.

Monitoring stack: **OpenTelemetry SDK everywhere → Grafana Cloud (free tier at MVP) for
metrics/traces/logs/alerting + Sentry Team ($26/mo) for error tracking + the Temporal Web UI for
workflow-level forensics.**

---

## Findings

### 1. What the daily loop actually demands from the backbone

Mapping SPEC §18's loop to orchestration primitives:

| Loop stage | Orchestration primitive needed |
|---|---|
| Daily trigger per site | Cron/schedule per tenant-site, with overlap protection |
| Full crawl (100–100k pages) | Multi-hour unit of work, heartbeats, resumable on worker death |
| GSC / rank / SERP pulls | Retried, rate-limited API activities (quota-aware backoff) |
| Opportunity finding + prioritization | Short compute steps; fan-out/fan-in over top-K pages |
| AI generation + validation | Retryable LLM activities with structured-output validation; idempotent |
| LOW-risk auto-apply | Side-effectful activity (CMS API write / GitHub commit) — needs idempotency keys |
| MEDIUM-risk PR approval | **Pause mid-workflow for hours-to-weeks awaiting a human decision** |
| Post-change monitoring | **A 14–30 day timer per applied change** (SPEC §17 explicitly requires a defined wait period), then measure → KEEP or ROLLBACK |
| Rollback | Compensation step (revert PR / restore previous value) — a saga |

Two of these — the mid-workflow approval gate and the 14–30 day monitoring timer — are what
disqualify plain queues. A queue job is fire-and-forget; state across a 30-day pause has to live
somewhere, and "somewhere" is either a durable-execution engine or a hand-built state machine in
Postgres plus a scheduler plus recovery logic plus dedupe — i.e., a rebuilt workflow engine.

### 2. Workflow engines (durable execution)

**Temporal** — the maturity benchmark; used by OpenAI, Stripe, and Uber [1].
- *Durable timers + approval gates:* a workflow can `sleep()` for 30 days consuming zero worker
  resources; if the server restarts a day later, the timer still fires on schedule 29 days later
  [5]. Human approval is a first-class pattern: the workflow calls `wait_condition()` /
  `condition()`, the worker releases the task and sits idle, and an external Signal (approve /
  reject from your dashboard) resumes it; timeouts on the approval are durable timers [4][6].
  This exactly implements the MEDIUM-risk PR gate and the KEEP/ROLLBACK evaluation delay.
- *Long crawls:* activities can run for hours with heartbeating; heartbeat details let a resumed
  activity restart from the last crawl cursor rather than page 1. Workflow event history is capped
  at 51,200 events / 50 MB (warning at 10,240) — `continue-as-new` resets it [9]; with the
  coarse-phase design (~10–30 events/day/site) the daily workflow never approaches the cap.
- *Multi-tenant fairness:* Task Queue **Priority & Fairness** is now a documented multi-tenant
  pattern: each tenant gets a fairness key on a single task queue; fairness weights control
  capacity share; per-fairness-key RPS limits cap individual tenants ("preventing any single
  tenant from consuming too much capacity"); weights/limits are adjustable at runtime via CLI
  without redeploys [7][8]. This solves "one 100k-page customer starves ten 500-page customers"
  without per-tenant worker fleets.
- *Scheduling:* Temporal Schedules replace cron, with overlap policies (skip/buffer) — the daily
  loop is one Schedule per site.
- *Observability:* Prometheus metrics endpoint or OTLP push from workers; OpenTelemetry tracing
  interceptors propagate one trace across client → workflow → activities → child workflows [10].
  The Web UI shows every workflow's full event history — effectively a free, replayable audit log
  per site per day (feeds SPEC §16 change tracking).
- *Cloud pricing:* Essentials = greater of **$100/mo or 5% of consumption**, includes **1M
  actions, 1 GB active storage, 40 GB retained storage**; Business = greater of $500/mo or 10%.
  Actions cost **$50 per million ($0.00005/action)** with volume discounts starting at 5M
  actions/mo; active storage $0.042/GB-hr, retained $0.00105/GB-hr [1][2][3].
- *Self-hosted:* MIT-licensed, free; realistic small production deployment (server + Postgres
  persistence + optional Elasticsearch visibility on k8s) ≈ **$400–900/mo infra** plus real
  operational attention (upgrades, DB tuning, dashboards, paging) [11][12]. Verdict for a small
  team: don't self-host until Cloud spend clearly exceeds that.
- *Cost model for this product (coarse-phase design):* ~50–100 actions/site/day (10 phases ×
  activities/timers/retries) + ~2 actions/day per open 30-day monitor. 500 sites ≈ 1–1.5M
  actions/mo ≈ **$100–130/mo**; 5,000 sites ≈ 15M actions/mo ≈ **$650–750/mo** before volume
  discounts. The engine is a rounding error next to crawl compute and LLM tokens.
- *Cons:* steepest learning curve of the field (determinism rules, replay semantics,
  `continue-as-new`); the standard advice is not to reach for Temporal unless you can articulate
  why the lighter tools don't fit [13]. Here, we can (fairness keys + 30-day timers + signals).

**Inngest** — best DX; durable steps over serverless or servers.
- Sleeps up to **1 year** (`step.sleep`/`sleepUntil`), and sleeping functions do not count
  against concurrency [14]. `step.waitForEvent` pauses a run until a matching event (e.g.
  `pr.approved` with matching `data.changeId`) or a timeout, returning `null` on timeout —
  a clean approval-gate primitive; caveat: events sent before the run reaches the wait are not
  matched [15].
- Multi-tenant flow control is its headline feature: per-tenant concurrency keys, throttling,
  rate limiting, priority and debouncing "with one line of code" [16][17]; used in production
  for exactly this shape of multi-tenant AI workload [18].
- Pricing: Hobby free = **50k executions/mo, 5 concurrent steps, 500k events/mo** (execution =
  run + each step; runs pause when quota exhausts). Pro **from $99/mo = 1M executions, 100
  concurrency included, then $25 per additional 25 concurrency**; extra executions metered
  (~$50/M at low volume, tiered down) [19][20].
- The trap for this product: **execution-count billing punishes fan-out.** One 100k-page crawl
  expressed as steps = 100k+ executions — one large site crawled daily ≈ 3M+ executions/mo on
  its own. Fixable with the same coarse-phase rule, but then a multi-hour crawl inside one step
  needs your own long-running worker anyway, eroding Inngest's serverless advantage.
- Self-hosting exists (single binary since 1.0; production needs external Postgres + Redis) but
  is second-class: no guaranteed support, no automatic cleanup of old rows [21].
- Concurrency included at Pro (100 steps) is thin for parallel crawling fleets; buying
  concurrency at $25/25 gets expensive relative to running your own BullMQ workers.

**Trigger.dev v4** — JS-native, strong DX, credible self-host path [13][22].
- No task timeouts — "tasks can run for as long as you need" [23]; **Waitpoints** provide
  human-in-the-loop: `wait.forToken()` checkpoints the run (zero compute while paused, on Cloud),
  returns a callback URL, resumes on completion — purpose-built for approval workflows [24][25].
- Pricing: Free ($5 credit/mo), Hobby $10/mo, Pro $50/mo + usage; concurrency 20/50/200+ (then
  $10/mo per 50); compute billed per second ($0.0000169/s micro → $0.00068/s large-2x) plus
  $0.25 per 10k run invocations [23]. A 4-hour crawl on a small machine ≈ $1.50–3.00/run —
  acceptable, but you're renting their compute for work you could run on your own crawl fleet.
- **Self-hosted loses checkpoints, warm starts, and auto-scaling** [26]. No checkpoints means a
  30-day wait holds resources instead of suspending — that kills the self-hosted variant for this
  workload's monitoring timers. Cloud-only if chosen.
- v3 is EOL; v4.5.1+ rejects v3 tasks — the platform moves fast; expect migration churn [26].

**AWS Step Functions** — enterprise-grade, serverless, but wrong ergonomics for this product.
- Standard workflows run up to **1 year**; the `waitForTaskToken` callback pattern pauses a state
  until `SendTaskSuccess`/`SendTaskFailure` — human approval and long waits both fit within the
  1-year execution quota [27][28].
- Pricing: **$0.025 per 1,000 state transitions** (4,000 free/mo) [29]. The loop's coarse phases
  are cheap, but iteration/Map states multiply transitions fast — a documented cost trap (one team
  cut a $450 workflow bill to ~$1 by moving looping work out of state transitions into activities)
  [30]. Express workflows are cheaper but capped at 5 minutes — useless for this loop.
- Cons: logic lives in ASL JSON, not code; testing/local dev is weak; deep AWS lock-in; per-tenant
  fairness must be hand-built. Only defensible if the whole platform is already committed to AWS.
- **SQS** (as its queue companion): 1M free requests/mo, then ~$0.40/M standard [31]; but delayed
  delivery caps at **15 minutes** [32] — useless for day-scale scheduling, fine as a dumb buffer.

**Hatchet** — MIT-licensed, Postgres-backed task orchestrator aimed at AI workloads [33][34].
- Postgres is the durability layer for runtime + observability — the easiest self-host story in
  the field (start Postgres-only, add RabbitMQ only for higher throughput) [33]. Every task/DAG/
  event lands in a durable event log and is replayable [34]. Fine-grained concurrency control,
  DAGs, priority lanes, streaming step outputs; strong fit for AI task orchestration [13].
  Claims >100M tasks/day across customers [35].
- Cloud pricing: free tier 100k runs then **$10 per 1M task runs**; Team **$500/mo** (10 users,
  **5 tenants**, 500 RPS, 3-day retention); Scale **$1,000/mo** (unlimited tenants, 7-day
  retention) [35]. The 5-tenant cap on Team is awkward for a multi-tenant SaaS — you're pushed
  to $1,000/mo or self-hosting quickly.
- Cons: much younger ecosystem/community than Temporal; short cloud data retention; fewer
  battle-tested HITL patterns in the docs.

### 3. Queue systems (the layer *below* the workflow engine)

The comparison literature is consistent: **BullMQ on Redis is the pragmatic default for Node.js
job workloads; RabbitMQ earns its place only for cross-language AMQP routing; SQS only inside an
all-AWS stack** [36][37][38].

- **BullMQ** (open source): native delayed jobs, priorities, job dependencies via FlowProducer,
  repeatable jobs/schedulers, built-in rate limiting — pull model on Redis [37]. Perfect as the
  per-URL crawl queue: per-host politeness via rate limiters, retries with backoff, and the crawl
  activity drains it while heartbeating to Temporal. **BullMQ Pro** (commercial, per-organization
  license, price on request) adds groups with per-group concurrency and per-group rate limiting —
  i.e., tenant fairness at the queue layer — plus batches and telemetry [39]. Note: if Temporal
  fairness keys handle tenant fairness at the orchestration layer, open-source BullMQ suffices at
  the crawl layer (group fairness only becomes interesting if many tenants share one crawl fleet
  redlined at capacity).
- **RabbitMQ**: delayed messages require TTL/DLX tricks or a plugin; a separate broker to operate;
  its advantages (AMQP routing topologies, polyglot consumers) are not needs this product has
  [36][37].
- **SQS**: zero-ops and cheap (1M free req/mo, ~$0.40/M after [31]) but the 15-minute delay cap
  [32] and lack of job semantics (priorities, rate limits per host) make it a poor crawl queue.
- None of the three can hold the loop's *state* — no approval gates, no 30-day timers, no
  multi-step recovery. A queue is a component, not the backbone.

### 4. LLM/agent frameworks — production reality in 2026

The sharpest finding of this lane: **agent frameworks checkpoint; they do not durably execute.**
A detailed 2026 analysis (Diagrid) of LangGraph/CrewAI/Google-ADK-class frameworks lands on three
structural gaps: (1) no automatic failure detection — "if your process crashes, no one knows";
(2) no distributed coordination — two processes resuming the same `thread_id` will both execute;
(3) single-process architecture — no worker pools, no rebalancing. Fixing this is not a maturity
issue but a rearchitecture [40].

- **LangGraph**: checkpointers + `interrupt()` give real pause/resume and human-approval gates
  [41], but code before an interrupt may run again on resume — approval boundaries must be placed
  with replay risk in mind [42][43]. Production deployments increasingly wrap LangGraph in an
  external durable runtime — which concedes the backbone argument [44]. LangSmith/Platform
  pricing: Dev free (5k traces/mo), Plus $39/seat/mo (10k traces), usage-billed compute (LCU
  $1.50) for hosted deployments [45].
- **CrewAI**: 2026 reporting shows a documented hierarchical-delegation bug, four 2026 security
  CVEs, high token cost from inter-agent chatter, weak OSS observability, and hard root-cause
  debugging; newer Flows are not yet battle-tested [46][47]. Not production backbone material.
- **Claude Agent SDK**: mature for what it is — the Claude Code agent loop as a library, with
  session persistence/resume, automatic context compaction for long-running agents, and
  first-class subagent orchestration [48][49]. Its own production guidance concedes the point
  that matters here: tasks that outlive a function ceiling or fan out heavily should run on
  dedicated workers [48] — i.e., inside a durable engine's activity, not instead of one.

**Conclusion:** the LLM layer (generation, competitor analysis, structured fix proposals — SPEC
§7) is a set of retryable activities with schema-validated outputs. Where a bounded agentic loop
is genuinely useful (e.g., "modify the Next.js repo until the build passes"), run the Claude Agent
SDK *inside* a Temporal activity with a hard timeout, heartbeats, and an idempotency key. The
backbone stays deterministic; the nondeterminism stays quarantined inside activities.

### 5. Custom state machine / plain cron + BullMQ

A Postgres `changes` table with a `status` column, cron sweeps, and BullMQ workers *can* express
this loop — it is how v0 of many systems ships. What you hand-build within six months: durable
timers (cron sweep + fire-guard dedupe), retry state machines per step, approval token plumbing,
crash recovery ("which sites half-finished last night?"), per-tenant throttling, and an audit
trail. Every one of those is a solved, tested primitive in Temporal/Inngest/Hatchet. The
maintenance cost lands on exactly the small team the client wants to protect. (DBOS — durable
execution as a Postgres library — is the intellectually honest version of this path and worth a
POC read [50], but it is a younger bet than Temporal for a client deliverable.) Rejected as the
recommendation; acceptable only as a deliberately throwaway 2-week POC scaffold.

### 6. Monitoring / alerting stack

- **OpenTelemetry** as the instrumentation standard: Temporal's SDKs emit worker/client metrics
  to Prometheus or an OTLP collector and propagate a single trace across workflow → activities →
  child workflows [10]. Instrument crawlers, LLM activities (tokens, latency, refusal rate), and
  API clients with the OTel SDK so one trace covers a site's full daily run.
- **Sentry** for error tracking + release health: Developer free (1 user, 5k errors, 5M spans);
  **Team $26/mo** (50k errors, 5M spans, unlimited users); Business $80/mo; logs $0.50/GB beyond
  5 GB [51]. Team tier is the MVP pick.
- **Grafana Cloud** for metrics/dashboards/alerting: free tier = **10k metric series, 50 GB each
  of logs/traces/profiles, 14-day retention, 3 users** — genuinely enough for MVP; Pro from
  $19/mo, $6.50 per 1k extra series, $0.45/GB logs/traces [52][53]. At scale or under a
  self-host mandate: Prometheus + Loki + Tempo + Grafana OSS (the same stack, self-run).
- **Temporal Web UI** is the third leg: per-workflow event histories answer "what exactly did the
  system do to customer X's site on Aug 9" without log spelunking — directly serving SPEC §16
  (change tracking) and §23 (explainability).
- Alert set (Grafana Alerting → Slack/PagerDuty): schedule-miss / workflow-failure rate,
  activity retry exhaustion (esp. GitHub/CMS writes), BullMQ queue depth + oldest-job age per
  tenant, crawl duration anomaly vs site baseline, LLM error/refusal/validation-failure rate,
  approvals waiting > SLA, and every ROLLBACK decision (page-worthy — SPEC §17).

---

## Options compared

| Criterion | Cron + BullMQ | Temporal | Inngest | Trigger.dev v4 | Step Functions | Hatchet | LangGraph/CrewAI as backbone |
|---|---|---|---|---|---|---|---|
| Durability model | None (jobs only) | Event-sourced replay, exactly-once workflow state | Durable steps, at-least-once | Checkpointed runs (cloud only) | State machine, 1-yr max [27] | Postgres event log, replayable [33] | Checkpoints, no failure detection [40] |
| Multi-hour crawl | ✔ (natural) | ✔ activities + heartbeats | ⚠ step model fights it | ✔ no timeouts [23] | ⚠ via activities/Lambda ceilings | ✔ | ✘ single-process risk |
| Human approval mid-flow | ✘ hand-built | ✔ signals + wait_condition [4][6] | ✔ waitForEvent [15] | ✔ waitpoints (cloud) [24] | ✔ task tokens [28] | ✔ durable events | ⚠ interrupt() + replay risk [42] |
| 14–30 day timers | ✘ cron sweeps | ✔ durable sleep, zero cost [5] | ✔ sleep ≤ 1 yr [14] | ✔ cloud only [26] | ✔ ≤ 1 yr | ✔ | ✘ process must survive |
| Multi-tenant fairness | ✘ (Pro groups only [39]) | ✔ fairness keys + per-key RPS [7][8] | ✔ concurrency keys [17] | ⚠ queues + concurrency | ✘ hand-built | ✔ concurrency/priority lanes [13] | ✘ |
| Observability | DIY | Web UI + Prom/OTel [10] | Good dashboard, 7-day traces (Pro) [19] | Good dashboard | CloudWatch | Postgres-backed UI, 3–7 day retention [35] | LangSmith ($39/seat) [45] |
| Ops burden (small team) | Low now, high later | Cloud: near-zero; self-host: high [11][12] | Cloud: near-zero | Cloud: low; self-host loses checkpoints [26] | Zero (AWS) | Low-moderate (Postgres) | High (you build the runtime) |
| Cost @ MVP (~100 sites) | infra only | **$100/mo floor** [1] | $0–99/mo [19] | $10–50/mo + compute [23] | ~$5–20/mo transitions | $0 (free tier) [35] | n/a |
| Cost @ ~5k sites | infra + eng time | ~$650–750/mo (est., pre-discount) | execution-billing risk on fan-out | compute-billing risk | transition-count risk [30] | $500–1,000/mo or self-host [35] | n/a |
| Self-host quality | ✔ | ✔ MIT, but real ops [11] | ⚠ second-class [21] | ⚠ loses key features [26] | ✘ | ✔ best-in-field [33] | ✔ (it's just a library) |
| Maturity / references | n/a | OpenAI, Stripe, Uber [1] | Growing | v4 GA, fast churn [26] | Very high | Young | High usage, low prod trust [40][46] |

---

## Recommendation & why

**MVP (first 6 months, ~1–200 customer sites):**
1. **Temporal Cloud Essentials** ($100/mo floor; the coarse-phase loop stays near the included 1M
   actions [1]) as the backbone. One `DailySiteRun` workflow per site per day, started by a
   Temporal Schedule; workflow ID = `{tenant}:{site}:{date}` gives free idempotent dedupe of the
   daily run. Phases (crawl, GSC pull, rank check, analyze, prioritize, generate, validate,
   apply) are activities. MEDIUM-risk changes spawn an `ApprovalGate` child workflow that waits on
   an `approve`/`reject` signal with a durable timeout; every applied change spawns a
   `ChangeMonitor` child workflow that durably sleeps in daily ticks for 14–30 days, then runs the
   KEEP/ROLLBACK decision activity (SPEC §17's "how long to wait" is just the timer parameter).
2. **BullMQ + Redis** for page-level crawl/fetch/render jobs, driven from inside the crawl
   activity (which heartbeats progress cursors to Temporal). Per-host rate limiting for
   politeness; retries local to the queue [36][37].
3. **LLM work as activities**; Claude Agent SDK only inside a bounded activity for the
   repo-modification POC [48]. No LangGraph/CrewAI in the execution path [40][46].
4. **Observability:** OTel instrumentation → Grafana Cloud free tier (10k series / 50 GB) [52]
   + Sentry Team $26/mo [51] + Temporal Web UI. Total monitoring spend at MVP: ~$26/mo.

**Scale (1k–10k sites, multi-tenant SaaS):**
- Same architecture — that is the point of choosing the heavy engine early; nothing gets
  rewritten. Turn on **fairness keys per tenant with per-key RPS limits** on the shared task
  queue [7][8]; autoscale crawl workers on BullMQ queue depth; move to Grafana Cloud Pro or a
  self-hosted LGTM stack when free-tier limits pinch [52].
- Stay on Temporal Cloud until the bill durably exceeds ~$1.5–2k/mo; only then evaluate
  self-hosting (infra floor $400–900/mo *plus* an SRE's attention [11][12]). At the estimated
  15M actions/mo for 5k sites (~$700/mo [1][3]), Cloud remains the right answer.
- If a hard "everything self-hosted / customer-VPC" requirement emerges from the client,
  **Hatchet** is the fallback backbone (MIT, Postgres-only durability [33]) — accept the younger
  ecosystem as the price of the deployment constraint.

**Why Temporal over the lighter favorites:** Inngest and Trigger.dev genuinely cover approval
gates and long sleeps [14][15][24], and either would ship a demo faster. But this product's load
profile — daily fan-out across all tenants, crawl-heavy long activities, and thousands of
concurrently-sleeping 30-day monitors — hits exactly their pricing and architecture weak points
(execution-count billing on fan-out [19][20]; per-second compute billing on multi-hour runs and a
self-hosted tier without checkpoints [23][26]). Temporal charges ~$0.00005 per action, treats a
sleeping workflow as nearly free, has the only first-class multi-tenant fairness story in the
field [7][8], and its event history doubles as the explainability/audit substrate the SPEC's
safety sections demand. The learning-curve tax is real and worth paying once, at the start.

---

## Risks & limitations

1. **Temporal learning curve / determinism traps.** Workflow code must be deterministic; naive
   patterns (loops over 100k pages in workflow code) hit the 51,200-event history cap [9].
   Mitigation: the coarse-phase rule, `continue-as-new` on long monitors, and code review gates
   on what runs in workflow vs activity context.
2. **Idempotency is on us, not the engine.** Activities are at-least-once; a retried
   "create GitHub PR" or "write CMS field" must carry an idempotency key (branch name =
   change-ID; read-before-write on CMS fields). No engine removes this obligation.
3. **Cloud dependency.** Temporal Cloud is a US-company SaaS holding workflow payloads
   (metadata, not necessarily page content — keep large blobs in object storage, pass
   references). Payload encryption via Data Converter mitigates; self-host remains the exit.
4. **Cost estimates are modeled, not measured.** The 50–100 actions/site/day figure is a design
   estimate; a POC (SPEC §25) should meter actual action counts for one real site-day before
   committing to per-customer pricing.
5. **Fairness is probabilistic.** Temporal's fairness weights apply at schedule time, not
   dispatch time, and are "harder to debug than strict isolation" [8]; a pathological tenant
   still needs a per-key RPS cap, and true isolation needs per-tenant task queues.
6. **Third-party comparison sources.** Several 2026 comparison articles ([13][53]-class) are
   SEO-farm-adjacent; every load-bearing number above was taken from vendor pricing/docs pages
   directly where possible.
7. **The 14–30 day monitor multiplies open workflows.** 5k sites × ~3 changes/day × 30 days ≈
   450k open monitor workflows. Temporal handles this (active storage billing applies [1]), but
   the design should batch monitors per site per day (one monitor workflow per site-day, not per
   change) to keep active-storage GB-hours down.
8. **Search-budget note:** this session's shared web-search quota capped at ~12 searches for this
   lane; remaining verification was done by fetching vendor pricing/docs pages directly. Sentry,
   Grafana, Inngest, Trigger.dev, Hatchet, LangChain and Temporal numbers come from their live
   pages as of 2026-08-10.

---

## Sources

1. https://docs.temporal.io/cloud/pricing — Temporal Cloud pricing (Essentials $100/mo floor, 1M actions, storage rates)
2. https://temporal.io/blog/temporal-cloud-pricing-update — pricing update; volume discounts from 5M actions
3. https://dev.to/beton/temporal-pricing-teardown-2026-2j11 — 2026 pricing teardown ($50/M actions, plan minimums)
4. https://temporal.io/blog/human-in-the-loop-approvals — signal-based approval pattern; durable timers for approval SLAs
5. https://arpitbhayani.me/blogs/temporal-primer/ — durable 30-day sleep semantics surviving server restarts
6. https://docs.temporal.io/ai-cookbook/human-in-the-loop-python — wait_condition + Signal HITL mechanics
7. https://github.com/temporalio/documentation/blob/main/docs/develop/task-queue-priority-fairness.mdx — fairness keys, weights, per-key RPS limits
8. https://github.com/temporalio/documentation/blob/main/docs/production-deployment/multi-tenant-patterns.mdx — single task queue + fairness multi-tenant pattern (pros/cons)
9. https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/workflow/workflow-execution/event.mdx — 51,200-event / 50 MB history limits; continue-as-new
10. https://docs.temporal.io/develop/typescript/observability — Prometheus/OTLP metrics, OTel tracing interceptors
11. https://automationatlas.io/answers/temporal-self-hosted-pricing-2026/ — MIT license; $400–900/mo small prod infra estimate
12. https://blog.taigrr.com/blog/setting-up-a-production-ready-temporal-server/ — production self-host walkthrough (ops surface)
13. https://www.pkgpulse.com/guides/hatchet-vs-trigger-dev-v3-vs-inngest-durable-workflows-2026 — 2026 field comparison (Hatchet concurrency/priority lanes; "don't reach for Temporal unless…")
14. https://www.inngest.com/docs/features/inngest-functions/steps-workflows/sleeps — sleep up to 1 year; sleeping excluded from concurrency
15. https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event — waitForEvent matching, timeouts, null-on-timeout, pre-arrival caveat
16. https://www.inngest.com/docs/guides/concurrency — per-key concurrency control
17. https://www.inngest.com/platform/flow-control — throttle/rate-limit/priority/debounce flow control
18. https://www.inngest.com/customers/otto — multi-tenant concurrency for AI workflows case study
19. https://www.inngest.com/pricing — Hobby 50k executions free / Pro $99 1M executions, 100 concurrency then $25/25
20. https://hokai.io/hub/tools/inngest — execution definition (run + each step), overage behavior
21. https://www.inngest.com/docs/self-hosting — single binary, Postgres+Redis for production, support caveats, no auto row cleanup
22. https://trigger.dev/blog/v4-beta-launch — v4 architecture
23. https://trigger.dev/pricing — Free/$10/$50 tiers, per-second compute rates, $0.25/10k runs, no task timeouts
24. https://trigger.dev/changelog/waitpoints — waitpoints for approval workflows; checkpoint = zero idle compute (cloud)
25. https://trigger.dev/docs/wait-for-token — wait.forToken callback URL + timeout mechanics
26. https://trigger.dev/docs/self-hosting/overview — self-host loses warm starts, auto-scaling, checkpoints; v3 EOL
27. https://www.dash0.com/knowledge/aws-step-functions-limits-use-cases-best-practices — 1-year Standard execution quota, limits
28. https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html — waitForTaskToken callback pattern
29. https://cloudburn.io/tools/aws-step-functions-pricing-calculator — $0.025/1k state transitions, 4k free
30. https://medium.com/chronicles-of-a-cloud-engineer/from-450-to-1-part-0-5-intro-to-step-function-activities-2af295c4e89f — transition-count cost trap ($450→$1)
31. https://aws.amazon.com/sqs/pricing/ — 1M free requests/mo; standard/FIFO request pricing
32. https://oneuptime.com/blog/post/2026-01-21-bullmq-vs-other-queues/view — BullMQ vs RabbitMQ vs SQS (SQS 15-min delay cap; feature table)
33. https://docs.hatchet.run/v1/architecture-and-guarantees — Postgres as durability layer; self-host architecture
34. https://github.com/hatchet-dev/hatchet — MIT license; durable event log, replay
35. https://hatchet.run/pricing — free 100k runs, $10/M runs, Team $500/mo (5 tenants, 500 RPS), Scale $1,000/mo
36. https://oneuptime.com/blog/post/2026-03-31-redis-vs-rabbitmq-for-job-queues/view — Redis/BullMQ pragmatic default; RabbitMQ delayed-message caveats
37. https://www.dragonflydb.io/guides/bullmq-vs-rabbitmq — BullMQ features (delays, priorities, FlowProducer, rate limiting) vs AMQP
38. https://pandastack.io/blog/choosing-a-message-queue-2026 — 2026 queue-selection guidance, migration path
39. https://docs.bullmq.io/bullmq-pro/introduction — BullMQ Pro groups, per-group concurrency/rate limits, per-org licensing
40. https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows — checkpoints ≠ durable execution (no failure detection, no coordination, single-process)
41. https://docs.langchain.com/oss/python/langgraph/interrupts — interrupt()/resume HITL mechanics
42. https://medium.com/@mehul_parmar/the-hidden-replay-risk-in-langgraph-how-durable-execution-can-burn-you-1d966141e71a — replay risk; code before interrupt may re-run
43. https://www.zenml.io/blog/langgraph-durable-runtime — wrapping LangGraph in an external durable runtime
44. https://aerospike.com/blog/langgraph-production-latency-replay-scale/ — LangGraph production latency/replay/scale constraints
45. https://www.langchain.com/pricing — LangSmith/Platform: Dev free 5k traces, Plus $39/seat 10k traces, LCU $1.50 usage billing
46. https://atlan.com/know/ai-agent/what-is-crewai/ — CrewAI limits: delegation bug, 4× 2026 CVEs, token cost
47. https://www.agilesoftlabs.com/blog/2026/06/crewai-in-production-2026-real-lessons — CrewAI production lessons (debugging, Flows maturity)
48. https://www.digitalapplied.com/blog/claude-agent-sdk-production-patterns-guide — Claude Agent SDK production patterns; "use workers past the function ceiling"
49. https://www.augmentcode.com/guides/claude-agent-sdk-agent-loops-tool-calls — session persistence/resume; agent loop mechanics
50. https://tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution — DBOS (Postgres-library durable execution) vs Temporal
51. https://sentry.io/pricing/ — Developer free / Team $26/mo (50k errors, 5M spans) / Business $80/mo; $0.50/GB logs
52. https://monitoringcost.com/grafana-cloud-pricing — free tier 10k series + 50 GB logs/traces, 14-day retention; $6.50/1k series, $0.45/GB
53. https://www.digitalapplied.com/blog/ai-workflow-orchestration-tools-2026-comparison — 2026 orchestration landscape tiers (context source)
