# GitHub Automation + Validation Engine (SPEC §13, §15)

Research lane: the code-change pipeline — repo connected → branch → analyze → generate modification →
apply patch → tests → build → SEO validation → PR → deploy → monitor → rollback.
All product facts verified against live docs, August 2026.

---

## Summary

**Recommended pipeline:** Authenticate as a **GitHub App** (never OAuth App or PATs) with
per-installation, per-repo down-scoped 1-hour tokens [1][3]. Generate changes with a **two-tier
generator**: deterministic AST codemods (ts-morph / jscodeshift) perform the *code edit*; the LLM only
produces the *values* (title strings, meta descriptions, alt text, JSON-LD objects) that the codemod
injects — free-form LLM diffs are reserved for the minority of changes a codemod cannot express, and
are applied via search/replace blocks with a strict apply-or-reject rule [12][13]. Commit via the
GraphQL `createCommitOnBranch` mutation (automatic verified/signed commits, `expectedHeadOid`
optimistic-concurrency guard) [6][7][8]. Every PR passes a **layered validation engine**: static gates
(changed-file allowlist, diff budget, lint, `tsc`) → sandboxed build in an ephemeral egress-restricted
container (customer `npm install` is remote code execution — treat it as hostile) [15][16] → deploy the
branch to a **preview URL** (Vercel `POST /v13/deployments` with `gitSource`, or Netlify deploy
previews) [26][30][31] → run SEO assertions against the rendered preview: meta-tag diff assertions, Nu
HTML Checker, in-house JSON-LD/schema.org validation (Google's Rich Results Test has **no public
API** — plan around it) [17][18], Lighthouse CI budget assertions [22], and lychee link checking [24].
Results are posted as GitHub **Checks**, the PR respects the customer's protected-branch rules, and
merge uses auto-merge/merge-queue APIs [9][10][11]. **Rollback is two-speed**: platform-level instant
rollback (Vercel Instant Rollback API / Netlify `restore` — seconds, no rebuild) for emergencies, plus
a git-level revert PR via the GraphQL `revertPullRequest` mutation for durable reversal [8][27][29][30].
One logical SEO change per PR keeps the blast radius revert-clean.

Feasibility verdict for this lane: **all pipeline stages are automatable with current (2026) public
APIs**, with two hard external constraints: (a) no programmatic Rich Results Test — structured-data
validation must be self-built or approximated via the GSC URL Inspection API post-deploy (2,000
inspections/day/property) [19][20]; (b) preview-based validation requires the customer's hosting to
expose preview deploys (Vercel/Netlify do; bare-metal/custom hosts need a self-managed preview stage).

**Part 2 of this document** (below the Part-1 sources) closes the remaining §15 gap: pre-deploy
validation for the **direct-API channels** — WordPress REST, Shopify Admin API, and edge workers —
which have no git/preview-deploy pipeline and would otherwise write straight to production.

---

## Findings

### 1. GitHub auth for a SaaS touching customer production repos

**GitHub App is the only defensible choice for a multi-tenant SaaS.** Current (2026) facts:

| Property | GitHub App | OAuth App | Fine-grained PAT |
|---|---|---|---|
| Identity | First-class app identity; survives if installing user leaves [1] | Acts only as a user [2] | A user's token |
| Token lifetime | Installation tokens expire in **1 hour** [3] | Long-lived until revoked [2] | Default 30 days; 1–366 days or non-expiring [5] |
| Repo scoping | Installer picks repos; token can be **further down-scoped per request** [3] | `repo` scope = all repos the user can reach [2] | Per-repo selection, single org only [5] |
| Rate limit | 5,000 req/h base per installation; +50/h per repo >20 and per user >20, **max 12,500 req/h per installation** [4] | User's 5,000 req/h | User's limit |
| Signed commits via API | Yes — `createCommitOnBranch` auto-signs as the app [6][7] | No | No |
| Checks API | Yes (required for posting validation results as PR checks) | Limited | **Cannot call the Checks API** [5] |
| Org control | Org admins approve installation, see audit log | Broad user-delegated access | Org can force approval; `pending` tokens read-only on public data [5] |

Load-bearing details:

- **Minting a scoped token:** `POST /app/installations/{installation_id}/access_tokens`,
  authenticated with the app's JWT. Body params `repositories` / `repository_ids` (up to 500) and
  `permissions` produce a token narrower than the installation grant — the platform should mint a
  **single-repo, minimal-permission token per pipeline run** (e.g. `contents:write`,
  `pull_requests:write`, `checks:write`, `metadata:read`) [3].
- **Per-installation rate buckets** give natural multi-tenant isolation: one customer's crawl/PR burst
  cannot exhaust another customer's API budget [4].
- Fine-grained PATs are explicitly positioned by GitHub for *personal* use; 50-token cap per account,
  no multi-org access, no Checks API — disqualifying for a SaaS [5].
- OAuth-app user tokens remain useful for one thing only: the **onboarding hand-shake** (identifying
  the human connecting the repo). Use the GitHub App's own user-authorization flow for that rather
  than a separate OAuth App [1][2].

### 2. Generating code changes safely

**Two-tier generation — deterministic transform first, LLM only where a transform cannot exist:**

- **Tier 1 — deterministic codemods** for everything structural: `<title>`/`metadata` export in
  Next.js, meta description, canonical tag, OG tags, JSON-LD insertion, `alt` attributes, `<h1>`
  changes in JSX. jscodeshift (Facebook; recast-based, style-preserving AST→AST printing) or ts-morph
  (TypeScript compiler API wrapper — can use *type information*, e.g. verify a `Metadata` export
  actually type-checks) [13][14]. The LLM's output for these changes is a **JSON value payload**
  (matching SPEC §7's structured-action format), never code. The codemod either applies cleanly or
  fails loudly — there is no "partially wrong" state, which is what makes LOW-risk auto-apply
  (SPEC §14) defensible. Codemods scale identically across 1 or 100,000 pages and are unit-testable.
- **Tier 2 — LLM-generated patches** only for content-shaped edits (rewriting a heading block, adding
  an FAQ section in MDX). Evidence from aider's edit-format research: whole-file output is slow/costly;
  search-replace "diff" blocks are efficient; unified-diff format measurably reduced "lazy coding"
  (elided `# ... original code ...` sections) in weaker models [12]. Adopt **search/replace blocks
  with exact-match apply**: if the search text does not match the file at apply time, the change is
  rejected and regenerated — never fuzzy-matched into production code.
- **Patch application & conflict handling:** commit through GraphQL `createCommitOnBranch` — inputs
  include the branch ref, `fileChanges`, and a **required `expectedHeadOid`** (verified in the current
  public schema), so a concurrent human push makes the mutation fail instead of clobbering [8]. On
  conflict: re-fetch head, re-run analysis on the fresh tree, regenerate. Never `force`-push, never
  rebase the customer's work. Bonus: commits authored this way are automatically GPG-signed and marked
  **Verified** as the GitHub App — satisfies repos with required signed commits without key
  management [6][7].
- **Protected branches & required checks:** never write to the default branch; always branch → PR.
  GitHub enforces required status checks/reviews on protected branches server-side [10]. The platform
  should *read* branch protection / rulesets during onboarding and adapt: if reviews are required,
  MEDIUM-risk changes stop at "PR open + reviewer requested" (matches SPEC §14). For merging:
  `enablePullRequestAutoMerge` (mutation confirmed in schema [8]) — note the **March 25, 2026 behavior
  change**: auto-merge can now only be enabled once all PR requirements are already fulfilled,
  otherwise HTTP 422 [9]; pipeline must enable auto-merge *after* checks pass, or use the **merge
  queue** (`Require merge queue` branch protection; CI workflows must also trigger on `merge_group`)
  for repos with high change volume [11].
- `mergePullRequest` also accepts `expectedHeadOid` ("OID that the pull request head ref must match to
  allow merge") — use it so a last-second human push can't be merged unreviewed [8].

### 3. Preventing AI from breaking functionality

Layered gates, cheapest first (every layer is a hard fail):

1. **Changed-file allowlist (path guardrail).** Derived per framework: e.g. for Next.js allow
   `app/**/page.{tsx,jsx,mdx}`, `app/**/layout.tsx` metadata regions, `content/**`, `public/sitemap*`;
   **deny always**: `.github/workflows/**`, `package.json`/lockfiles, `next.config.*`,
   `middleware.*`, `Dockerfile`, env/config files, dependency manifests, security/suppression files.
   Industry guardrail guidance is explicit that workflow files, build policy, deployment descriptors
   and dependency manifests "should not be ordinary edit surfaces" for agents [15]. This single rule
   removes the worst failure classes (supply-chain edit, CI takeover, config break).
2. **Diff budget.** Cap files-changed and LOC per change type (e.g. metadata fix: 1 file / ≤10 lines;
   content update: ≤3 files / ≤120 lines). Agents demonstrably produce 14-file diffs for 1-file asks
   without deterministic limits [15]. Budget violation → reject and regenerate, never trim.
3. **Static checks:** ESLint + `tsc --noEmit` on the changed tree. Cheap, catches malformed JSX/TS
   before any build spend.
4. **Sandboxed build.** `npm install && npm run build` of a *customer's* repo is arbitrary code
   execution (postinstall scripts, build scripts). Run in an **ephemeral container/microVM per build**:
   no platform secrets in env, filesystem scoped to the workspace, **egress-restricted network**,
   destroyed after the run [15][16]. Never build two tenants in one sandbox. (Options compared below.)
5. **Tests:** run the repo's own unit suite if present; plus platform-owned smoke E2E (Playwright)
   against the preview: page renders, status 200, no console errors, primary nav works, hydration
   completes. The platform cannot assume customer repos have good tests — its own render-level smoke
   suite is the floor.
6. **Checks API reporting:** every gate posts a named check run on the PR head SHA
   (`seo-platform/build`, `seo-platform/seo-validation`, …) so customers can mark them *required*
   in branch protection — turning our validation into a server-enforced gate [10]. (GitHub App
   required; fine-grained PATs cannot call the Checks API [5].)

### 4. SEO validation of the generated change

- **Meta-tag diff assertion (the core novel check).** Render the *built preview page* (Playwright,
  post-hydration), parse `<head>` + headings + JSON-LD, and diff against the same parse of the
  production page. Assert: (a) the intended change is present exactly as generated; (b) **nothing else
  changed** — canonical, `robots` meta, hreflang, OG/Twitter tags, H1 count, internal links unchanged
  unless targeted. This catches the classic framework failure where editing one metadata field drops
  another (e.g. a Next.js `metadata` export replacing inherited fields). It also *is* the SPEC's
  "re-run the SEO analyzer on the changed page": feed the rendered preview DOM back through the
  platform's own analyzer and require the target issue to be resolved with zero new issues introduced.
- **HTML validation:** Nu Html Checker (v.Nu) — the engine behind validator.w3.org/nu; ships as
  standalone `vnu.jar`, pre-compiled binaries, Docker image and npm package; deployable as a
  self-hosted service for batch checking [17]. A pure-JS alternative (`html-validate`) can run in-process
  for speed; v.Nu remains the conformance reference. Validate the *rendered* preview HTML, not the JSX.
- **Structured data:** **Google's Rich Results Test has no public API in 2026** — the old Structured
  Data Testing Tool API was deprecated (Dec 2020) and never replaced [18][35]. Google's own
  schemarama validation framework (ShEx/SHACL for schema.org) was **archived Oct 22, 2025**, explicitly
  not production-recommended [21]. Consequences:
  - Pre-deploy validation must be **self-built**: JSON-LD extraction from the rendered DOM → syntax
    validation → schema.org vocabulary/type checking (schema-dts TypeScript typings help at authoring
    time) → a maintained in-house rule-pack for Google's rich-result feature requirements
    (required/recommended properties per feature, from Google's documented feature specs) [18][35].
  - Post-deploy, the **GSC URL Inspection API** returns `richResultsResult` verdicts (PASS + detected
    items) for indexed URLs in a verified property — quota **2,000 inspections/day + 600/minute per
    property** [19][20][36]. Usable as the *monitoring-phase* ground truth, **not** for previews or
    staging (unindexed URLs unsupported) [19].
- **Lighthouse CI budgets:** `lhci autorun` against the preview URL; assert category floors
  (`categories:performance ["error",{"minScore":0.9}]`, same for SEO/accessibility categories),
  audit-level assertions (`document-title`, `meta-description`, `canonical`, `is-crawlable`,
  `uses-responsive-images`), `budgets.json` resource budgets, `assertMatrix` for per-URL-pattern
  thresholds, and `median-run` aggregation across ≥3 runs to damp variance [22][23]. LHCI presets:
  `lighthouse:recommended` warns on perf metrics below 90 [22]. Primary assertion for this platform:
  **no regression vs the production baseline** (store baseline runs per page class), since absolute
  scores vary by site.
- **Link checking:** lychee (Rust, async, checks anchor fragments — catches broken `#section` links)
  for the changed pages' outbound/internal links; linkinator (Node) as the site-crawl alternative
  [24][25]. Scope per-PR checks to links present in the diffed pages; full-site link audits belong to
  the crawler lane.

### 5. Preview deployments

- **Vercel** (reference host for Next.js):
  - Git integration auto-builds a preview per branch/PR; or drive it explicitly:
    `POST /v13/deployments` with `gitSource: {type, org, repo, ref}` (or `repoId`+`sha`) — cannot be
    combined with inline `files`; deployment states `QUEUED → INITIALIZING → BUILDING → READY|ERROR`;
    response contains the unique deployment URL; `skipAutoDetectionConfirmation=1` suppresses the
    framework-mismatch 400 in automated pipelines [26].
  - Limits that size the pipeline: deployments/day **100 (Hobby) / 6,000 (Pro) / 24,000 (Enterprise)**;
    per-hour 100/450/1,800; per-5-min 60/120/300; build time cap **45 min**; concurrent builds Pro up
    to 500 on-demand; static upload 100 MB Hobby / 1 GB Pro; build CPU billed from $0.0035/CPU-min on
    Pro [28]. A customer on Hobby caps the whole platform at ~100 validation deploys/day — plan tiers
    accordingly.
  - Deployment Protection can gate preview URLs; the API exposes project **protection-bypass**
    management (rate-limited endpoint family) so the validator can fetch protected previews [28].
- **Netlify:** auto Deploy Previews per PR at `deploy-preview-<PR>--<site>.netlify.app` [31]; API
  deploys via file-digest (SHA1 per file; upload only `required` hashes) or ZIP (≤25,000 files);
  `draft: true` deploys build without touching the live site — a clean validation target; poll
  `state: preparing → ready`. **API limits: 500 requests/min; 3 deploys/min; 100 API deploys/day**
  [30]. Deploy permalinks pin a specific immutable deploy [31].
- **Validation on preview before production** is the architectural keystone: nothing in §4 runs
  against production candidates directly; the preview URL is the unit of validation, and its check
  results are what the PR's required checks report on. For self-hosted/custom sites without preview
  infra, the platform must provide its own: build in the sandbox (§3.4) and serve the artifact from an
  internal ephemeral host — same validators, platform-owned URL.
- **Non-git channels have no preview deploy at all** — WordPress REST and Shopify Admin API writes go
  live the moment the request succeeds. Part 2 below defines the equivalent pre-deploy chain
  (simulated render → staged render where the channel supports one → canary apply) so §15 holds on
  those adapters too.

### 6. Deploy + rollback mechanics

Two-speed rollback, both automated:

- **Platform-level (seconds, emergency path):**
  - **Vercel Instant Rollback** — repoints production domains to a previously-aliased deployment at
    the routing layer, no rebuild, takes effect in seconds; Pro/Enterprise can roll back to *any*
    previously-production deployment, Hobby only the immediately previous one [27]. API:
    `POST /v9/projects/{projectId}/rollback/{deploymentId}` (functional; absent from the public REST
    reference — treat as semi-documented) [29]. Critical operational caveats from Vercel's docs:
    env-var changes are **not** applied to the rolled-back build; cron jobs revert to the old
    deployment's state; after rollback Vercel **disables auto-assignment of production domains** —
    new pushes won't go live until the platform "undoes" the rollback via promote (`vercel promote` /
    promote API) — the automation must model this state or the customer's next deploy silently never
    ships [27].
  - **Netlify:** `POST /api/v1/sites/{site_id}/deploys/{deploy_id}/restore` republishes a prior deploy
    as `state: current` — instant, API-documented [30].
- **Git-level (minutes, durable path):** GraphQL **`revertPullRequest`** mutation — "Create a pull
  request that reverts the changes from a merged pull request"; inputs `pullRequestId`, optional
  `title`/`body`/`draft`; returns the new revert PR (verified in the current public schema) [8]. The
  revert PR flows through the same required checks and auto-merge; platform rollback (above) covers
  the CI window. Because the platform authored the original PR as a single logical change, the revert
  is guaranteed conflict-free unless a human has since edited the same lines — in which case the
  system files the revert PR and escalates instead of forcing.
- **WordPress path (for the CMS side of §13's pipeline parity):** revisions REST endpoints support
  list/get/delete only — **there is no restore endpoint**; restoring = `POST /wp/v2/posts/{id}` with
  the revision's content [33]. Since WP 6.4 post meta can be stored on revisions, but only for meta
  registered with revisions enabled — SEO-plugin meta (titles/descriptions live in postmeta) is *not*
  reliably revisioned [32]. Therefore: **the platform's own change ledger (SPEC §16) is the rollback
  source of truth** — store exact before/after values per change and roll back by re-applying
  `before`, using WP revisions only as a secondary safety net.
- **Change-scoped blast-radius rules:**
  1. One logical change (or one change-type × one page cluster) per PR — revertability is a design
     input, not an afterthought.
  2. Rollback granularity must match change granularity: metadata change → git revert of that PR;
     bad deploy breaking the site → platform instant rollback first, then git revert; CMS change →
     ledger-based value restore.
  3. Never batch HIGH-risk-adjacent files (redirects, robots.txt, canonicals) with content changes
     in one PR (aligns with SPEC §14 risk tiers).
  4. An auto-revert triggered by monitoring must itself pass validation (a revert of a revert of a
     stale page can 404) — reverts run the same preview-validation pipeline, only with elevated
     priority and relaxed SEO-score gates.

---

## Options compared

### A. GitHub authentication

| Option | Scoping | Token life | Rate limit | Checks API | Signed commits | Verdict |
|---|---|---|---|---|---|---|
| **GitHub App** | Per-install repo pick + per-token down-scope [3] | 1 h [3] | 5,000→12,500/h **per installation** [4] | Yes | Auto via `createCommitOnBranch` [6] | **Recommended** |
| OAuth App | All-or-nothing classic scopes [2] | Until revoked | User's 5,000/h | Limited | No | Onboarding identity only |
| Fine-grained PAT | Per-repo, single org [5] | ≤366 d or none [5] | User's | **No** [5] | No | Dev/testing only |

### B. Change generation

| Option | Determinism | Scale | Failure mode | Use for |
|---|---|---|---|---|
| **AST codemod + LLM values** (jscodeshift/ts-morph) | Full — same input, same diff [13][14] | O(pages) cheap | Loud (no-match = no edit) | Titles, metas, alt, JSON-LD, canonicals, links — the LOW/MEDIUM tiers |
| LLM search/replace blocks | Medium — exact-match apply gate [12] | Per-call LLM cost | Rejectable pre-apply | Content/heading edits codemods can't express |
| LLM unified diff | Medium; reduces lazy elision on some models [12] | Same | Hunk-apply ambiguity | Fallback format |
| LLM whole-file rewrite | Low; violates "must not blindly rewrite content" (SPEC §7) | Costly [12] | Silent content loss | **Never** |

### C. Where to run builds/tests of customer code

| Option | Isolation | Cost | Notes |
|---|---|---|---|
| **Own ephemeral sandbox (container/microVM, egress-restricted)** | Strong, platform-controlled [15][16] | Own compute | Required for pre-flight build+tsc; no platform secrets mounted |
| Customer's GitHub Actions | Their compute/secrets boundary | Free to platform | Respect as *their* required checks; can't be platform's only gate (may not exist) |
| Preview host build (Vercel/Netlify) | Host-managed | Build minutes ($0.0035/CPU-min Vercel Pro [28]) | Produces the validation URL; 45-min cap [28] |
| **Recommendation: all three layered** — sandbox pre-flight → preview build → respect customer CI | | | |

### D. Structured-data validation

| Option | Pre-deploy? | Status 2026 | Verdict |
|---|---|---|---|
| Rich Results Test API | — | **Does not exist**; SDTT API dead since 2020 [18][35] | Unavailable |
| GSC URL Inspection API `richResultsResult` | No (indexed URLs only) | 2,000/day + 600/min per property [19][20] | Monitoring phase only |
| Google schemarama | Yes | **Archived 2025-10-22**, non-production [21] | Reference only |
| **In-house: JSON-LD extract + schema.org check + Google feature rule-pack** | Yes | Self-maintained | **Recommended** |

### E. Rollback mechanism

| Mechanism | Speed | Durability | Caveats |
|---|---|---|---|
| Vercel Instant Rollback API | Seconds [27] | Temporary (routing) | Endpoint semi-documented [29]; disables prod auto-assign until undone; stale env/crons [27] |
| Netlify deploy restore | Seconds [30] | Until next deploy | Clean, documented |
| **git revert PR** (`revertPullRequest`) | Minutes (CI) [8] | Permanent | Runs full checks; conflict → escalate |
| WP ledger-based value restore | Seconds | Permanent | Own before/after ledger; WP revisions unreliable for SEO meta [32][33] |
| **Recommendation: platform rollback for emergencies + git revert PR always; ledger restore on CMS** | | | |

---

## Recommendation & why

1. **GitHub App with per-run down-scoped installation tokens** — only option with 1-hour tokens,
   per-repo minting, Checks API, auto-signed commits, and per-customer rate isolation [1][3][4][5][6].
2. **Codemod-executes / LLM-decides split** — makes LOW-risk auto-apply (SPEC §14) actually safe:
   the risky component (LLM) never touches syntax; the component touching syntax is deterministic and
   testable. This is the single highest-leverage architectural decision in this lane.
3. **`createCommitOnBranch` + `expectedHeadOid` everywhere** (commit and merge) — eliminates the
   race class where automation clobbers concurrent human work [8].
4. **Preview URL as the unit of validation** — every assertion (HTML, schema, Lighthouse, links,
   meta-diff, re-analysis) runs on a real rendered build before production, and reports back as PR
   check runs that customers can mark required [10][22][26][31].
5. **Build our own structured-data validator now** — the absence of a Rich Results API is permanent
   enough to design around; URL Inspection API becomes the post-deploy verifier within its 2,000/day
   budget [18][19][20].
6. **Two-speed rollback with one-change-per-PR discipline** — instant platform rollback bounds harm
   in seconds; the revert PR makes reversal durable and auditable in the change ledger [8][27][30].

## Risks & limitations

- **Customer build = RCE.** The sandbox (no secrets, egress-restricted, ephemeral, single-tenant) is a
  security-critical component; a leak here exposes the GitHub App's private key ecosystem. Design it
  with the security lane [15][16].
- **Vercel rollback endpoint is undocumented** in the public REST reference — works today, could
  change without notice; wrap it behind an adapter and keep the git-revert path as the guaranteed
  fallback [29]. Post-rollback disabled auto-promotion is a state machine trap that must be modeled [27].
- **Hosting-tier ceilings:** Hobby-tier customers (100 deploys/day Vercel [28]; 100 API deploys/day
  Netlify [30]) throttle validation throughput; batch validations or require paid hosting tiers.
- **Structured-data validator drift:** Google's rich-result requirements change; the in-house
  rule-pack needs a maintenance owner and a scheduled diff against Google's feature docs [18].
- **No preview infra on custom hosts:** the platform must ship its own build-and-serve preview stage
  for non-Vercel/Netlify sites, expanding scope.
- **Protected-branch diversity:** repos requiring human review turn "auto-apply" into "auto-PR" —
  automation level is capped by each customer's branch protection, which the product must surface
  honestly (SPEC §26 bucketing).
- **Lighthouse variance:** absolute score gates false-positive; only baseline-relative assertions with
  `median-run` over ≥3 runs are reliable [22][23].
- **GraphQL-only mutations** (`revertPullRequest`, `createCommitOnBranch`, auto-merge) have no REST
  equivalents — client library choice must cover GraphQL first-class [8].
- **March-2026 auto-merge ordering change** (enable only after requirements met, else 422) breaks
  naive "open PR, enable auto-merge immediately" flows [9].

## Sources

1. https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app
2. https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps
3. https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
4. https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps
5. https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
6. https://github.blog/changelog/2021-09-13-a-simpler-api-for-authoring-commits/
7. https://github.com/orgs/community/discussions/44009
8. https://docs.github.com/public/fpt/schema.docs.graphql (current public GraphQL schema; `revertPullRequest`, `createCommitOnBranch`, `enablePullRequestAutoMerge`, `expectedHeadOid` fields verified directly)
9. https://github.com/orgs/community/discussions/190610
10. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
11. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
12. https://aider.chat/docs/more/edit-formats.html
13. https://github.com/facebook/jscodeshift
14. https://carlrippon.com/codemods-for-react-typescript/
15. https://www.the-main-thread.com/p/coding-agent-guardrails
16. https://code.visualstudio.com/docs/agents/concepts/trust-and-safety
17. https://github.com/validator/validator
18. https://developers.google.com/search/blog/2020/12/structured-data-testing-tool-update
19. https://developers.google.com/search/blog/2022/01/url-inspection-api
20. https://developers.google.com/webmaster-tools/limits
21. https://github.com/google/schemarama
22. https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md
23. https://unlighthouse.dev/learn-lighthouse/lighthouse-ci
24. https://github.com/lycheeverse/lychee
25. https://github.com/JustinBeckwith/linkinator
26. https://vercel.com/docs/rest-api/deployments/create-a-new-deployment
27. https://vercel.com/docs/instant-rollback
28. https://vercel.com/docs/limits
29. https://dev.to/philw_/using-vercels-instant-rollback-feature-in-your-own-ci-cd-pipeline-57oi
30. https://docs.netlify.com/api/get-started/
31. https://docs.netlify.com/deploy/deploy-types/deploy-previews/
32. https://make.wordpress.org/core/2023/10/24/framework-for-storing-revisions-of-post-meta-in-6-4/
33. https://developer.wordpress.org/rest-api/reference/post-revisions/
34. https://nango.dev/blog/github-app-vs-github-oauth/
35. https://schemavalidator.org/guides/structured-data-testing-tool
36. https://www.incremys.com/en/resources/blog/google-search-console-quota

---
---

# Part 2 — Pre-deploy validation for direct-API channels (WordPress / Shopify / Edge) — SPEC §15 gap-fill

Part 1 solves §15 only for git-deployed sites, where a preview URL exists before production. The two
highest-coverage adapters — **WordPress REST** and **Shopify Admin API** — write straight to
production: a successful `POST /wp/v2/posts/{id}` or `productUpdate` mutation *is* the deployment.
The post-deploy crawl-diff guardrail in the risk/rollback lane compensates for that but does not
fulfill §15's "every automated change validated **before** deployment." This part defines and
evidences the pre-deploy chain for those channels. Researched August 2026; all product facts
verified against live vendor docs (sources 37–57, continuing Part 1's numbering).

## Summary (Part 2)

**Adopt a three-rung validation ladder, applied per change-class per channel:**

1. **Rung 1 — Simulated render (always, all channels).** Fetch the target page's current
   *production* HTML (JS-rendered), apply the proposed change to that DOM **in memory** with the
   same deterministic projection the CMS will perform (title text, `meta[name=description]`,
   JSON-LD block, `img[alt]` are all 1:1 projections of the API fields being written), and run the
   *entire Part-1 §4 validator suite* on the patched DOM — meta-tag diff assertion, Nu HTML Checker,
   in-house JSON-LD rule-pack, link checks [17]. Because field→DOM projection is theme-dependent
   (SEO-plugin templates, Liquid overrides), calibrate it once per site with an onboarding
   **render-mapping probe**: write a sentinel value to a disposable object (WP draft post / Shopify
   `DRAFT` product), render it, and learn the exact stored-value→rendered-tag transformation.
2. **Rung 2 — True staged render, where the channel has a staging primitive.** They exist, but are
   change-class-specific, not universal:
   - **Shopify theme/template changes** stage perfectly: duplicate the live theme via
     `themeCreate`/`themeFilesCopy`, apply the edit to the duplicate with `themeFilesUpsert`,
     validate against an **unpublished-theme preview** (admin share links give unauthenticated
     "visitor preview" URLs that expire after 2 days) rendering *live store data*, then promote
     via `themePublish` or file-copy to the live theme [37][38][39][40].
   - **Shopify data changes** (product `seo`, `global.title_tag` metafields) **cannot be staged**
     on the same store — there is no draft state for a published product's fields. A
     `productDuplicate`-to-`DRAFT` + `onlineStorePreviewUrl` render is possible but heavyweight
     and lossy (metafields not always duplicated) [44][45] — use Rung 1 + Rung 3 instead.
   - **WordPress content changes** stage via the REST **autosaves** endpoint
     (`POST /wp/v2/posts/{id}/autosaves` stores proposed content without touching the live post —
     verified live on a WP 6.x install [46]) plus a token-based public preview implemented in our
     companion plugin (the 100k-install Public Post Preview plugin proves the pattern: anonymous
     nonce links, 48 h default [47]). **SEO-plugin meta does not participate in autosaves** — so
     this rung covers content/heading edits, not title/description meta.
   - **WordPress full-fidelity staging** exists only where the host exposes it by API: Kinsta
     (create staging / push staging to live / clone, 5 resource-creations/min) [51], WP Engine
     (copy full filesystem+DB install-to-install, backup+restore) [52]. Patchwork coverage —
     treat as a premium enhancement, never the required path.
   - **Edge workers have the best story of all channels**: Cloudflare per-version **preview URLs**
     minted on `wrangler versions upload` *before* any deployment [53], the
     `Cloudflare-Workers-Version-Overrides` header to smoke-test a version on the **production
     hostname** [55], **gradual deployments** for percentage canary [54], and Akamai's dedicated
     staging network on that CDN [57].
3. **Rung 3 — Canary apply with immediate render verification (data-field changes on WP/Shopify).**
   For a batch of N pages: apply to **one** low-traffic URL → re-fetch the live rendered page within
   seconds → run the same meta-diff assertion ("intended change present, nothing else changed") →
   only then roll the remaining N−1 at paced rate with sampled re-verification; on any failure,
   restore the ledger `before` value (single-field write, seconds). This makes the batch genuinely
   pre-validated — only the canary page is ever exposed unvalidated, for seconds.

Plus one cheap, load-bearing gate on every API write regardless of rung: **read-back verification**
— `GET` the resource after writing and byte-compare the stored value. This catches the two known
silent-failure classes: WP REST dropping unregistered meta keys, and Shopify's partial-`seo`-input
nulling.

**Feasibility verdict:** §15's "validate before deploy" is fully achievable on direct-API channels
for theme/template changes (real staged previews) and achievable *minus one canary page per batch*
for data-field changes — which is the honest maximum, because neither WordPress nor Shopify offers a
draft state for the SEO fields of already-published content.

---

## Findings (Part 2)

### 7. Why the GitHub pattern doesn't transfer

- A WP REST or Shopify Admin write has no intermediate artifact: no branch, no build, no preview
  URL. "Generate → validate → deploy" collapses into "generate → deploy" unless the platform
  inserts its own validation stage.
- §15's stage list maps onto API channels with substitutions, not omissions:

| §15 stage | Git channel (Part 1) | Direct-API channel (this part) |
|---|---|---|
| SEO validation | analyzer re-run on preview URL | analyzer re-run on **simulated render** (Rung 1) or staged preview (Rung 2) |
| HTML validation | v.Nu on preview HTML [17] | v.Nu on the patched DOM / staged preview HTML [17] |
| Schema validation | in-house JSON-LD rule-pack | same, on patched DOM |
| Application tests | repo test suite + smoke E2E | **adapter contract tests + read-back verification** (write→read→compare) |
| Build | sandboxed `npm run build` | **render-mapping probe** (does the stored field project to the DOM as expected?) |
| Performance test | Lighthouse CI on preview [22] | skip for metadata writes (no perf surface); **worker CPU-time budget** on edge (HTMLRewriter pass must stay sub-ms) |
| Deploy | merge → host deploy | paced batch apply after canary (Rung 3) |

### 8. Rung 1 — the simulated render ("shadow DOM validation")

- **Mechanism:** fetch the production URL with the platform's rendering crawler (JS-executing, per
  Part 1's streamed-metadata caveat), parse to DOM, apply the structured action to the DOM exactly
  as the CMS would (set `<title>` text, replace `meta[name=description]/@content`, insert/replace
  the JSON-LD `<script>`, set `img/@alt`), then run every Part-1 §4 assertion against the patched
  document, diffed against the unpatched one. The core meta-diff invariant — *intended change
  present, nothing else changed* — is computed identically to the git channel.
- **What it catches pre-deploy:** malformed/overlong values, HTML-entity and encoding bugs,
  duplicate-tag introduction, JSON-LD syntax/vocabulary errors, pixel/character length violations,
  broken URLs in canonicals/OG tags — i.e. the entire "the generated value is bad" failure class,
  which is the dominant class for LLM-generated metadata.
- **What it cannot catch:** the CMS transforming the stored value on render. Real examples the
  design must assume: SEO-plugin title *templates* (`%%title%% %%sep%% %%sitename%%` — the stored
  meta is a template input, not the final tag), Liquid themes that hardcode or truncate
  `title_tag`, plugins that append site names, themes that ignore the alt field on the attachment
  and use hardcoded markup. Hence:
- **Render-mapping probe (onboarding + on change of theme/plugin fingerprint):** write a sentinel
  value (`SEOPROBE-{nonce}`) to a disposable object — WP: a `draft` post (never published, deleted
  after); Shopify: a `DRAFT` product rendered via its preview URL [44] — and diff the rendered
  output against the stored value to learn the projection function (identity, template-wrapped,
  truncated-at-N, ignored). Cache per site + per field; invalidate when the crawler detects a theme
  change (Shopify `theme.id` change, WP theme/plugin version drift). A field whose probe shows
  "ignored" is **not auto-writable** on that site — surfacing that honestly is itself a §26
  bucketing input.
- **Edge special case — the simulation is exact.** The edge adapter's transform is a pure
  function `HTML → HTML` (HTMLRewriter handlers). Running the identical transform code in a local
  workerd/test harness against the fetched production HTML *is* the production render, bit-for-bit
  — no fidelity gap at all. The edge channel therefore reaches full §15 compliance with Rung 1
  alone, before even using its preview URLs.

### 9. Rung 2A — Shopify: what can genuinely be staged

**Theme/template changes — full staging pipeline exists (2026 facts):**

- **`themeCreate`** creates a theme from a ZIP source URL or staged upload; new themes default to
  the `UNPUBLISHED` role; only `UNPUBLISHED` and `DEVELOPMENT` roles can be created [37].
- **`themeFilesCopy`** copies files between themes ("Copying to existing theme files will
  overwrite them") — the primitive for "duplicate the live theme" without round-tripping a ZIP
  [38]. Combined flow: `themeCreate` (skeleton) → `themeFilesCopy` (live → staging theme) →
  `themeFilesUpsert` (apply the change, ≤50 files/request [24]) → validate → promote.
- **Preview of an unpublished theme renders against live store data** — exactly what validation
  wants for a template change. Admin "visitor preview" share links **require no authentication and
  expire 2 days after creation** (merchant previews: login, 30 days) [40]. Shopify CLI mints the
  same class of shareable preview link for development themes (`shopify theme dev` "a preview link
  that you can share with other developers"; `shopify theme share` uploads as a new unpublished
  theme and returns a preview link) [42][43]. The long-standing `?preview_theme_id={id}` storefront
  query parameter drives the same preview; it is community-standard but not formally documented —
  treat the admin/CLI share-link flow as the contracted mechanism and the query param as an
  implementation detail to confirm in POC.
- **Promotion:** `themePublish` makes the staged theme live [39]. Alternative promotion that
  preserves the merchant's published theme identity (some apps depend on the live theme ID):
  `themeFilesCopy` the validated files from staging theme → live theme.
- **Constraints that size this design:** every one of `themeCreate` / `themeFilesCopy` /
  `themeFilesUpsert` / `themePublish` sits behind `write_themes` **plus the protected-scope
  exemption** for App-Store-distributed apps ("search engine optimization" is a named qualifying
  category; ~2-week review) [37][38][39][58]; theme-library caps are **20 themes** on
  Basic/Grow/Advanced and **100 on Plus** [40] — the staging theme must be created, used, and
  deleted per validation run, with a janitor for leaked ones; Theme Access passwords are scoped to
  `write_themes` for CLI-style workflows and are delivered via one-view links expiring in 7 days
  [41] — usable for merchant-supervised onboarding, not for unattended SaaS automation (use the
  app token).

**Data changes (product `seo`, `global.title_tag`/`description_tag` metafields, `seo.hidden`) —
no staging primitive exists:**

- A published product's fields have no draft state; the unpublished-theme preview renders **live**
  data, so a metafield write is visible to the preview *and* production simultaneously — a
  duplicate theme stages nothing for data changes.
- The closest approximation: **`productDuplicate`** with `newStatus: DRAFT` → apply the SEO change
  to the duplicate → render it via **`Product.onlineStorePreviewUrl`** ("The preview URL for the
  online store"; `onlineStoreUrl` is null for unpublished products) [44][45] → assert → apply to
  the real product → delete the duplicate. Verified caveats: variants+inventory are duplicated,
  but "metafield values are not duplicated if the unique values capability is enabled"; images and
  translations only on request; large products risk timeouts (use `synchronous: false`) [45].
  Unverified (POC): whether `onlineStorePreviewUrl` is openable without an admin session. Verdict:
  admissible for high-stakes one-offs, too heavy and too lossy as the routine gate — Rungs 1+3
  are the routine gate for Shopify data fields.
- **No first-party staging store with API sync exists** for store data; duplicating a store's
  catalog into a dev store is a manual export/import or third-party-tool exercise — not a
  dependable automated validation substrate for a SaaS (unverified beyond absence of any vendor
  doc; flagged as a POC-confirmation item).

### 10. Rung 2B — WordPress: draft-state tricks, host staging, and the Playground sandbox

- **The autosave trick (REST-native "draft of a published post").** Core exposes
  `/wp/v2/posts/{id}/autosaves` and `/wp/v2/pages/{id}/autosaves` with GET+POST — verified live
  against a production WP 6.x install's route index [46]. POSTing an autosave records the proposed
  `content`/`title`/`excerpt` **without modifying the published post** — WordPress's own editor
  uses exactly this for "Preview changes." This is the correct staging primitive for **content and
  heading edits** (the MEDIUM-risk class): stage → validate → promote by re-POSTing to the post
  itself.
  - **Limitation 1 — previews are authenticated.** Native preview URLs
    (`?preview_id=…&preview_nonce=…`) require a logged-in cookie session; our headless validator
    would need cookie auth against wp-login — fragile across hosts/captchas/SSO. The proven
    workaround pattern is token-based public previews: the **Public Post Preview** plugin (100k+
    active installs) mints anonymous nonce links, 48 h default, filterable via `ppp_nonce_life`
    [47]. Recent reviews report breakage on some newer-WP setups [47] — so don't depend on that
    plugin; **fold the same ~50 lines (token param → render the autosave for anonymous requests)
    into the companion plugin** the WP adapter already requires for meta registration.
  - **Limitation 2 — SEO meta is outside autosaves.** Post meta participates in revisions only
    when registered with revisions support (WP 6.4 framework [32]), and SEO-plugin meta in the
    wild is not. Title/description meta changes therefore cannot be staged via autosaves —
    they take Rung 1 + Rung 3, or full staging below.
- **Host staging APIs (full fidelity, partial coverage):**
  - **Kinsta API:** "Create a new staging site, push a staging environment to live, and delete a
    staging environment," plus site cloning; rate limits 120 req/min per company, 1,000 req/min
    per IP, and **5 resource-creations/min** (staging creation falls here); limits are fixed [51].
  - **WP Engine API:** "Copy the full file system and database from one WordPress installation to
    another," create/restore backups, purge caches [52] — copy prod→staging install, apply the
    change to staging via REST, validate its rendered pages, then re-apply the same API write to
    prod (not a file-level push).
  - Coverage is host-by-host (SiteGround/GoDaddy/cPanel staging are UI-driven); this is a
    **premium enhancement** for customers on supported hosts, never the required path. A staging
    clone also drifts from prod the moment it's created — validate within minutes of cloning.
  - Cost note: a staging clone validates with production fidelity including the render-mapping
    problem (same theme+plugins), so for supported hosts it upgrades HIGH-risk WP changes
    (template edits via companion plugin, redirect-table changes) from "simulate + canary" to
    "true pre-deploy staged render."
- **WordPress Playground as an ephemeral validation sandbox:** `npx @wp-playground/cli@latest
  server` boots a full WP (WASM PHP, latest WP, PHP 7.4–8.5, Node ≥20.18, port 9400 default,
  blueprint-scriptable, can mount a full `wp-content`) in seconds [48][49]. Load times are
  5–10 s fresh and 30–60 s with heavy plugins like WooCommerce; WP-CLI support is partial [50].
  Use it for: (a) **companion-plugin CI** (test meta-registration + token-preview against every
  WP/Yoast/Rank Math release matrix); (b) **render-mapping probes without touching the customer
  site** when we can mirror their theme+plugin set; (c) rehearsing multi-step changes. Do **not**
  present it as a customer-site staging clone — it is not a fidelity substitute for the live
  site's DB, host config, and licensed plugins.

### 11. Rung 2C — Edge channel: previews, canary headers, staged networks

The edge adapter (Cloudflare Workers + HTMLRewriter, per the site-modification lane) is the only
direct-API channel with a *complete* first-party pre-deploy story:

- **Preview URLs per version, before deployment:** `wrangler versions upload` returns a preview
  URL per uploaded version, format `<VERSION_PREFIX_OR_ALIAS>-<WORKER_NAME>.<SUBDOMAIN>.workers.dev`
  (aliases give stable `staging-…` URLs); "public and available immediately after version
  creation" — explicitly usable **without deploying to production** [53]. Limitations that matter:
  no preview URLs for Workers using Durable Objects, none for Workers-for-Platforms user workers
  (relevant if we multi-tenant via dispatch namespaces — then we must stage in a dedicated staging
  namespace instead), no logs on preview URLs, workers.dev subdomain only [53].
- **Production-hostname smoke test:** the **`Cloudflare-Workers-Version-Overrides`** request
  header (RFC 8941 dictionary of worker→version-id) routes a single request on the *real* customer
  hostname to a specific version — precondition: the version must already be part of the current
  deployment, and a deployment carries at most **two** versions [55]. Flow: deploy new version at
  0%/100% split → validator hits the production URL with the override header → full §4 assertion
  suite on true production traffic path → shift percentages.
- **Gradual deployments:** split traffic by percentage between the (max two) versions via
  `wrangler versions deploy`; only the last **100** uploaded versions are eligible; storage state
  (KV/R2/DO/D1) is *not* versioned — rollback of the worker does not roll back data [54][56].
- **Akamai parity:** EdgeWorkers activate per-network — staging or production; one active version
  per network; staging is the documented validation surface before production activation [57].
  (Fastly Compute has no equivalent staged network; validation there = local harness + canary.)
- Because the transform is a pure function (§8), the edge channel's full ladder is: harness
  transform test (exact simulation) → version preview URL → override-header canary on production
  hostname → percentage ramp — the strongest §15 chain of any adapter, and an argument for routing
  HIGH-visibility changes through the edge channel when a customer has it enabled.

### 12. Rung 3 — canary apply + read-back: closing the loop on unstageable fields

For the change classes with no staging primitive (Shopify data fields; WP SEO meta):

1. **Read-back verification (every write, all channels):** after the API write, `GET` the resource
   and compare stored vs intended. Catches WP REST's silent drop of unregistered meta keys and
   Shopify's omitted-`seo`-subfield nulling *before* any renders are checked. Cost: one API call.
2. **Canary selection:** pick the lowest-traffic URL in the batch (GSC impressions ascending) —
   bounds the audience of the seconds-long unvalidated window.
3. **Render verification within seconds:** fetch the live URL (JS-rendered), run the meta-diff
   assertion against the pre-change snapshot: intended delta present, zero collateral deltas
   (canonical, robots, hreflang, OG, H1 count, link set unchanged). CDN/page-cache lag is the main
   false-negative source — the adapter must know the site's cache behavior (WP: purge hooks in the
   companion plugin; Shopify: storefront renders are origin-fresh for metadata) and poll with
   backoff up to a bounded window before judging.
4. **Verdict gate:** pass → roll the remaining N−1 pages paced (Shopify: ~5 mutations/s within the
   1,000-point bucket [19]; WP: ~5–10 rps under host WAF radar), re-verifying a random sample
   (e.g. 10% + every 50th) as they land. Fail → restore the ledger `before` value (single-field
   write, effective in seconds) and quarantine the change-type × site pair for human review.
5. **Ledger semantics (SPEC §16):** the canary page's change record carries
   `validation: canary-render`, the batch's records carry `validation: pre-verified-by-canary` —
   the honesty distinction §26 requires when bucketing "100% automatable" vs "mostly automatable."

---

## Options compared (Part 2)

### F. WordPress pre-deploy validation paths

| Option | Fidelity | Change classes covered | Latency/cost per validation | Coverage | Verdict |
|---|---|---|---|---|---|
| **Simulated render (Rung 1) + render-mapping probe** | High for calibrated fields | All metadata + alt + JSON-LD | Seconds; one crawl fetch | 100% of sites | **Default gate** |
| **Autosave + companion-plugin token preview** [46][47] | Production-true for content | Content/heading edits only (meta excluded [32]) | Seconds; zero risk to live post | 100% (with our plugin) | **Default for MEDIUM content edits** |
| Host staging API (Kinsta create/push-to-live [51]; WP Engine env-copy [52]) | Full site fidelity | Everything incl. template/redirect changes | Minutes; host API quotas (Kinsta 5 creations/min [51]) | Only supported hosts | Premium tier for HIGH-risk changes |
| WP Playground sandbox (`@wp-playground/cli`) [48][49][50] | Medium (WASM, SQLite-class, plugin gaps) | Probe/CI/rehearsal | 5–60 s boot [50] | Platform-side, any site | Companion-plugin CI + off-site probes; **not** a staging claim |
| Canary apply + read-back (Rung 3) | Production truth itself | SEO meta (the unstageable class) | Seconds; 1 page exposed | 100% | **Default for meta batches** |

### G. Shopify pre-deploy validation paths

| Option | Fidelity | Change classes covered | Constraints | Verdict |
|---|---|---|---|---|
| **Duplicate-theme staged preview** (`themeCreate`→`themeFilesCopy`→`themeFilesUpsert`→visitor-preview→`themePublish`) [37][38][39][40] | Production-true (live data) | Theme/template/`robots.txt.liquid`/JSON-LD-in-theme | `write_themes` + protected-scope exemption for App-Store apps [58]; 20-theme cap (100 Plus) [40]; preview links expire 2 d [40] | **Required gate for every theme write** |
| Simulated render (Rung 1) | High for calibrated fields | Product `seo`, `title_tag`/`description_tag` metafields, alt | none | **Default gate for data fields** |
| `productDuplicate`(DRAFT) + `onlineStorePreviewUrl` render [44][45] | High | Product-level changes, one product at a time | Metafields may not duplicate; timeouts on variant-heavy products [45]; preview-URL auth unverified (POC) | High-stakes one-offs only |
| Dev-store / store-copy staging | Full | Everything | **No first-party API sync exists**; manual/3rd-party — unautomatable today | Rejected for the product path |
| Canary apply + read-back (Rung 3) | Production truth | Data-field batches | 1 page exposed seconds; pacing within cost bucket [19] | **Default for data-field batches** |

### H. Edge pre-deploy validation paths (Cloudflare reference; Akamai parity)

| Option | What it proves | Constraints | Verdict |
|---|---|---|---|
| **Local harness transform test** (pure-function HTMLRewriter re-run on fetched prod HTML) | Exact output equivalence — full §4 suite pre-upload | none | **Always, first** |
| **Version preview URL** (`wrangler versions upload`) [53] | Worker runs in real runtime pre-deployment | No DO workers; not for WfP user workers; no logs; workers.dev only [53] | Stage 2 |
| **`Cloudflare-Workers-Version-Overrides` canary** [55] | Behavior on the true production hostname | Version must be in current deployment; max 2 versions/deployment [55] | Stage 3 |
| Gradual % ramp [54] | Behavior under real traffic | Last-100-versions window; storage not versioned [54][56] | Stage 4 for HIGH-visibility changes |
| Akamai staging network activation [57] | CDN-native staged validation | One active version per network [57] | Per-CDN equivalent |

---

## Recommendation & why (Part 2)

1. **Make the validation ladder a property of the change-class, not the channel.** Theme/template
   changes get true staged renders on every channel that can express them (Shopify duplicate
   theme, host staging, edge previews); data-field changes get simulated render + read-back +
   canary everywhere. This keeps §15 semantics uniform while using each channel's best primitive.
2. **Rung 1 + read-back is mandatory and universal** — it is cheap (two HTTP round-trips beyond
   the write), catches the dominant failure class (bad generated values, silent write drops), and
   requires nothing from the customer's stack.
3. **Calibrate, don't assume, the field→DOM projection.** The render-mapping probe converts the
   biggest fidelity risk of simulation (SEO-plugin templates, Liquid overrides) into a learned,
   cached per-site function — and doubles as an honest capability detector ("this site's theme
   ignores alt text; not auto-fixable here").
4. **Shopify theme writes never skip the duplicate-theme preview** — the staging pipeline is fully
   API-expressible ([37][38][39]) and the preview renders live data unauthenticated [40]; there is
   no excuse for a blind theme write. Budget the protected-scope exemption ([58]) into onboarding.
5. **Ship the WP staging tricks inside the companion plugin** (token public preview of autosaves +
   cache-purge hook + probe endpoint). The plugin is already mandatory for meta writes; +150 lines
   buys §15 coverage for content edits and reliable canary verification.
6. **Present Rung 3 honestly in the §26 bucketing:** batches are "validated before deployment" for
   N−1 of N pages; the canary page is validated seconds *after* its own apply. That is the true
   automation ceiling for WP meta and Shopify data fields — a limitation of the platforms, not of
   the architecture, and it should be written into the feasibility doc as such.

## Risks & limitations (Part 2)

- **Render-mapping drift:** a theme/plugin update silently changes the projection; probes must
  re-run on detected fingerprint change, and a canary meta-diff failure should trigger re-probing
  before quarantining the change-type.
- **Shopify exemption dependency for theme staging:** App-Store distribution requires the
  protected-scope exemption for *all four* theme mutations [37][38][39][58]; if denied, theme-write
  features are unavailable (data-field validation is unaffected). Custom (single-store) apps are
  outside the documented restriction [58] — the early-customer path — but Shopify's 2026 audits of
  theme-API access mean this asymmetry may narrow.
- **Theme-slot exhaustion:** stores near the 20-theme cap [40] can make `themeCreate` fail;
  the adapter needs slot-check + janitor logic and a fallback to Rung 1.
- **`preview_theme_id` is semi-documented:** the contracted preview mechanism is the admin/CLI
  share link (2-day visitor expiry [40][42][43]); the raw query param needs POC confirmation before
  any code depends on it.
- **`onlineStorePreviewUrl` auth is unverified** [44] — if it requires an admin session, the
  draft-duplicate path drops out (leaving Rungs 1+3, which are the recommendation anyway).
- **WP autosave meta gap is structural:** meta-revisioning exists only for opt-in registered keys
  [32]; SEO plugins haven't opted in — do not design as if a future WP release fixes this.
- **Public-preview fragility:** the Public Post Preview pattern shows breakage reports on newer WP
  [47]; owning the implementation in the companion plugin mitigates but inherits the maintenance
  burden across WP releases (Playground-based CI matrix [48][49] is the countermeasure).
- **Host-staging drift and quotas:** a Kinsta/WPE staging clone diverges from prod immediately;
  Kinsta caps resource creation at 5/min with no increases [51] — staging-per-change does not
  scale beyond a few changes/min/host; reserve for HIGH-risk changes.
- **Canary is still a production exposure:** seconds-long, lowest-traffic page, single field — but
  a purist reading of §15 counts it as post-deploy validation for that page. Documented as the
  automation ceiling rather than hidden.
- **Cache lag false-negatives:** render verification through a CDN can read stale HTML and
  wrongly fail (or wrongly pass) a canary; per-site cache knowledge (purge hooks, cache-busting
  query discipline, bounded polling) is load-bearing operational logic, not an afterthought.
- **Edge preview gaps:** no preview URLs for Workers-for-Platforms user workers [53] — if the
  edge adapter multi-tenants via dispatch namespaces, the staging story must run in a dedicated
  staging namespace, adding infra.

## Sources (Part 2 — continuing Part 1's numbering)

37. https://shopify.dev/docs/api/admin-graphql/latest/mutations/themeCreate — themeCreate: ZIP/staged-upload source; UNPUBLISHED default, UNPUBLISHED/DEVELOPMENT only; write_themes + exemption. Fetched 2026-08.
38. https://shopify.dev/docs/api/admin-graphql/latest/mutations/themeFilesCopy — themeFilesCopy: copy files between themes, overwrites existing; write_themes + exemption. Fetched 2026-08.
39. https://shopify.dev/docs/api/admin-graphql/latest/mutations/themePublish — themePublish: publish by theme GID; write_themes + exemption. Fetched 2026-08.
40. https://help.shopify.com/en/manual/online-store/themes/adding-themes — theme-library caps (20 Basic/Grow/Advanced, 100 Plus, 1 Starter); unpublished-theme preview; visitor preview links: no auth, expire 2 days (merchant: login, 30 days). Fetched 2026-08.
41. https://shopify.dev/docs/storefronts/themes/tools/theme-access — Theme Access app: passwords scoped to write_themes; delivery link expires 7 days / single view. Fetched 2026-08.
42. https://shopify.dev/docs/api/shopify-cli/theme/theme-dev — theme dev: development theme upload, localhost:9292, shareable preview link; auth via Theme Access password or Admin API token. Fetched 2026-08.
43. https://shopify.dev/docs/api/shopify-cli/theme/theme-share — theme share: uploads as new unpublished theme (randomized name) + preview link. Fetched 2026-08.
44. https://shopify.dev/docs/api/admin-graphql/latest/objects/Product — Product.onlineStorePreviewUrl ("The preview URL for the online store"); onlineStoreUrl null when unpublished. Fetched 2026-08.
45. https://shopify.dev/docs/api/admin-graphql/latest/mutations/productDuplicate — productDuplicate: newTitle required, newStatus, includeImages/includeTranslations default false, synchronous default true; variants+inventory copied; metafields not duplicated under unique-values capability; timeout guidance. Fetched 2026-08.
46. https://make.wordpress.org/wp-json/wp/v2 — live WP 6.x route index confirming `/wp/v2/posts/{id}/autosaves` and `/wp/v2/pages/{id}/autosaves` with GET+POST. Fetched 2026-08.
47. https://wordpress.org/plugins/public-post-preview/ — anonymous draft-preview links; 48 h default expiry; `ppp_nonce_life` filter; 100k+ installs; recent breakage reviews. Fetched 2026-08.
48. https://wordpress.github.io/wordpress-playground/ — Playground: WASM WordPress, blueprints (JSON setup files). Fetched 2026-08.
49. https://wordpress.github.io/wordpress-playground/developers/local-development/wp-playground-cli/ — @wp-playground/cli: npx start/server, mounts (plugin/theme/wp-content/full WP), port 9400, blueprints, PHP 7.4–8.5, Node ≥20.18. Fetched 2026-08.
50. https://wordpress.github.io/wordpress-playground/developers/limitations/ — Playground limits: 5–10 s fresh boot, 30–60 s with WooCommerce-class plugins; partial WP-CLI; iframe constraints. Fetched 2026-08.
51. https://kinsta.com/docs/kinsta-api/ — Kinsta API: create staging site, push staging→live, delete staging, clone site; rate limits 120/min/company, 1,000/min/IP, 5/min resource creation, not increasable. Fetched 2026-08.
52. https://developers.wpengine.com/docs/managed-hosting-platform/api — WP Engine API: copy full filesystem+DB between installs; backups create/restore; cache purge; install CRUD. Fetched 2026-08.
53. https://developers.cloudflare.com/workers/configuration/previews/ — Workers preview URLs: minted on version upload, `<prefix>-<worker>.<subdomain>.workers.dev`, public immediately, pre-deployment; exclusions (Durable Objects, WfP user workers, no logs). Fetched 2026-08.
54. https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/ — gradual deployments: percentage split via `wrangler versions deploy`; last-100-versions eligibility. Fetched 2026-08.
55. https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/ — `Cloudflare-Workers-Version-Overrides` header (RFC 8941 dictionary); version must be in current deployment; max two versions per deployment. Fetched 2026-08.
56. https://developers.cloudflare.com/workers/configuration/versions-and-deployments/ — versions vs deployments; KV/R2/DO/D1 state not tracked by versions (rollback ≠ data rollback). Fetched 2026-08.
57. https://techdocs.akamai.com/edgeworkers/docs/manage-edgeworkers — EdgeWorkers activation to staging vs production network; one active version per network; staging as validation surface. Fetched 2026-08.
58. https://shopify.dev/docs/apps/build/online-store/asset-legacy — theme-write exemption applies to App-Store-distributed apps; SEO named as qualifying category; ~2-week review. Fetched 2026-08.
