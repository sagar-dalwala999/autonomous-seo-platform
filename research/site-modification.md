# Automated Website Modification per Platform (SPEC §12)

Research lane: how the autonomous SEO platform can programmatically apply changes to customer
websites, per platform — Next.js/React (GitHub flow), WordPress (REST), Shopify (Admin API),
and custom/other sites (edge injection, headless CMS). Researched August 2026; all API
capabilities verified against current vendor documentation where possible.

---

## Summary

**Build one "Change Application Layer" abstraction with four adapters, in this priority order:**

1. **WordPress adapter (REST API + a small companion plugin we ship)** — broadest market coverage,
   simplest auth (Application Passwords, core since WP 5.6), near-everything writable. The one hard
   fact that shapes the design: **Yoast's REST surface is officially read-only** [8], and Rank Math
   meta is silently dropped by the WP REST API unless registered [12] — so a ~50-line companion
   plugin that registers the SEO meta keys with `show_in_rest` is **mandatory**, not optional. This
   is standard industry practice (n8n automation templates do exactly this [10][13]).
2. **Shopify adapter (custom/public app on the Admin GraphQL API)** — SEO title/description are
   first-class writable fields on products/collections and metafield-writable
   (`global.title_tag` / `global.description_tag`) on pages/blogs/articles [15][16]. Theme code
   writes are gated behind a **protected-scope exemption** for which "SEO tooling" is an explicit
   qualifying category [18] — apply for it, but design the MVP to not need theme writes
   (metafields + `urlRedirectCreate` + an app-embed block for JSON-LD cover ~90% of actions).
3. **GitHub PR adapter (Next.js/React and any git-deployed site)** — highest effort, highest
   differentiation. Use **deterministic codemods (ts-morph) for the repetitive structured edits**
   (metadata objects, alt attributes, sitemap/robots files) and **LLM-generated diffs only for
   free-form content, always gated by build + tests + a preview-deploy crawl**. Published evals
   justify this split: vanilla-LLM jscodeshift codemods are correct only 45.29% of the time,
   improving to ~54–55% with iterative refinement [21][22] — never good enough to auto-merge
   without a deterministic validation gate.
4. **Edge adapter (Cloudflare Worker / reverse proxy with HTMLRewriter)** — the universal fallback
   for custom sites with no API and no repo access. Commercially proven at enterprise scale by
   SearchPilot (proxy/edge SEO testing platform) [25]. Google fully processes server-side/edge
   rewrites (they're just HTML), unlike client-side JS injection which works but is explicitly a
   "fallback strategy" in Google's own docs [27]. The trade: we enter the customer's serving path
   (SLA, latency, trust), so it's an opt-in premium mode, not the default.

Headless CMS write paths (Contentful/Sanity/Strapi) are not a fifth adapter but a **redirect of
the Next.js adapter**: when `generateMetadata` sources its data from a CMS, the correct write
target is the CMS entry, not the repo.

---

## Findings

### 1. Next.js / React — the GitHub-based flow

#### 1.1 Where SEO data lives in a Next.js codebase (App Router)

Verified against the current Next.js docs (v16.3.0, updated 2026-06-09) [1]:

- **Static metadata**: `export const metadata: Metadata = {...}` in `layout.tsx` / `page.tsx`.
  Server Components only. Supports `title` (string or `{default, template, absolute}`),
  `description`, `alternates.canonical`, `alternates.languages` (hreflang), `robots`
  (index/follow + googleBot granular), `openGraph`, `twitter`, `verification`, `other` for
  arbitrary tags [1].
- **Dynamic metadata**: `export async function generateMetadata({params}, parent)` — fetches data
  (product, CMS entry) and returns the same `Metadata` shape. Cannot coexist with a static
  `metadata` export in the same file [1].
- **Merging semantics matter for safe patching**: metadata resolves root layout → nested layouts
  → page, with *shallow* merge — a `title` set in `app/blog/page.tsx` replaces the layout's; an
  `openGraph` object set anywhere replaces the parent's entire `openGraph` [1]. An automated
  patcher must resolve the *effective* metadata for a route (walk the segment chain) before
  deciding which file to edit — editing the layout to fix one page is a classic blast-radius bug.
- **File conventions**: `app/sitemap.ts` (dynamic XML sitemap), `app/robots.ts`,
  `app/opengraph-image.tsx` — file-based metadata **overrides** the `metadata` object [1][2].
- **Canonicals are not inferred** — `alternates.canonical` must be set explicitly per page [2],
  which makes "missing canonical" one of the most common auto-fixable findings on Next.js sites.
- **`metadataBase`** in the root layout is required for relative canonical/OG URLs; a missing one
  causes a build error when relative paths are used [1] — the patcher must check for it before
  introducing `alternates`.
- **Streaming metadata** (v15.2+): for JS-executing bots (Googlebot) metadata may be appended to
  `<body>` after initial UI; HTML-limited bots still get blocking `<head>` metadata [1]. Practical
  consequence: our own validation crawler must execute JS or spoof an HTML-limited UA, or it will
  false-flag "missing title" on streamed pages.
- **Images**: `next/image` requires `alt` as a prop; missing/empty alt is a per-JSX-usage code
  fix, not a central registry — codemod territory.

#### 1.2 App Router vs Pages Router

| Concern | App Router | Pages Router |
|---|---|---|
| Title/meta | `metadata` / `generateMetadata` exports | `<Head>` from `next/head` inline in JSX; commonly the `next-seo` package |
| Canonical | `alternates.canonical` | manual `<link rel="canonical">` in `<Head>` |
| Sitemap | `app/sitemap.ts` built-in | no built-in — `next-sitemap` package or a custom API route |
| Robots | `app/robots.ts` | static `public/robots.txt` |
| Structured data | JSON-LD `<script>` rendered in page/layout | same, in `<Head>` or body |
| Detection | `app/` directory present | `pages/` directory present |

The patcher needs **two code-understanding profiles**. Pages Router edits are harder to do
deterministically (metadata is arbitrary JSX inside `<Head>`, often behind custom components like
`<SEO title={...}/>`), so expect a higher share of LLM-generated patches — and correspondingly
more validation — on Pages Router repos.

#### 1.3 Deterministic codemods vs LLM-generated patches

The best available evidence (Codemod.com's published evals of their AI codemod pipeline) [21][22]:

- Vanilla GPT-4o asked to write a **jscodeshift** codemod from before/after examples: correct
  **45.29%** of cases; 24.71% type/syntax errors, 11.76% execution errors, 18.24% ran clean but
  made the wrong transformation [21].
- End-to-end vanilla LLM codemod generation: **26%** accuracy, rising to **~54–55%** after 4
  iterations of automated refinement (compile → run → diff-check → retry) [21][22].
- Codemod.com added **ts-morph** support specifically because its higher-level API is easier for
  both humans and LLMs to get right than raw AST manipulation [22].

Implications for our system:

1. **The 6–8 repetitive SEO change types get hand-written, tested ts-morph codemods** — add/update
   a `metadata` export field, add `alternates.canonical`, add `alt` to `next/image` usages, create
   `app/sitemap.ts` / `app/robots.ts`, insert a JSON-LD component, update MDX frontmatter. These
   are deterministic, reviewable once, and safe at scale.
2. **LLM-generated unified diffs are reserved for long-tail edits** (custom `<SEO>` component
   internals, content rewrites) and are *never* trusted raw: every patch must pass
   `tsc`/ESLint → `next build` → unit tests → preview-deploy crawl of affected URLs before a PR
   is opened (SPEC §13/§15 pipeline).
3. **Hybrid pattern**: LLM *plans* the change ("set title of route X to Y"), a deterministic
   executor applies it. The LLM never free-hands AST surgery for structured fields.

#### 1.4 MDX / CMS-sourced content

- MDX/Markdown content: frontmatter (`title`, `description`) edits via `gray-matter`-style
  parsing are deterministic and low-risk; body edits are content changes (medium risk per SPEC
  §14). These flow through the same PR pipeline.
- **The most important repo-analysis step**: trace `generateMetadata` to its data source. If it
  reads Contentful/Sanity/Strapi/a database, the repo is the *wrong* write target — patching code
  would be overwritten or ineffective. The adapter must classify each route as
  `code-owned | content-file-owned | CMS-owned` and route the change accordingly (see §4.3).

#### 1.5 GitHub mechanics and quotas

Verified against GitHub's current REST docs [23]:

- Integration as a **GitHub App** (not PATs): fine-grained per-repo permissions — `contents:
  write` + `pull_requests: write` (+ `checks: read` to observe CI) — short-lived installation
  tokens, org-auditable.
- **Primary rate limits**: 5,000 req/h base per installation; +50 req/h per repo beyond 20 and per
  org user beyond 20, capped at **12,500 req/h**; **15,000 req/h** on Enterprise Cloud [23].
- **Secondary limits are the real constraint for us**: max **80 content-generating requests/min**
  and **500 content-generating requests/h** (creating commits, branches, PRs, comments) [23].
  At ~3 API writes per change-PR (branch ref + commit + PR), that's a hard ceiling of roughly
  **150–160 PRs/hour per installation** — batching multiple changes per PR is therefore a design
  requirement, not an optimization.
- Flow (matches SPEC §13): create branch ref → create blob/tree/commit (Git Data API) → open PR →
  CI (build, tests, SEO validation crawl on the preview deployment, e.g. Vercel preview URL) →
  auto-merge low-risk PRs via merge API when checks are green → deploy hook. Rollback = `git
  revert` PR, which is trivially automatable — the strongest rollback story of all four platforms.

### 2. WordPress — REST API

#### 2.1 Auth

- **Application Passwords** — in core since WP 5.6 (Nov 2020), the canonical machine auth: per-user
  passwords, revocable individually, HTTP Basic over HTTPS (refuses plain HTTP) [4][5]. Create a
  dedicated least-privilege user (Editor role) for the platform [3].
- OAuth exists only via plugins (WP OAuth Server, the old OAuth1 plugin) — extra install burden
  for no real gain in a server-to-server integration. **Recommendation: Application Passwords**,
  with a guided onboarding screen (user pastes site URL + app password).
- Practical hazards: security plugins (Wordfence etc.) and managed hosts sometimes block REST
  write patterns or unauthenticated REST enumeration; the adapter needs 401/403/429 detection with
  a "your host is blocking us, here's the fix" diagnostic.

#### 2.2 Core writable surface

- `POST /wp/v2/posts/{id}` and `/pages/{id}`: `title`, `content`, `excerpt`, `slug`, `status`,
  `meta` (only meta registered with `show_in_rest`) [3][6].
- **Media/alt text**: `POST /wp/v2/media/{id}` with `alt_text` (also `title`, `caption`,
  `description`) — directly writable, no plugin needed [7].
  - **Caveat to verify in POC**: the block editor copies the alt text into the post's `<img>`
    markup at insert time; updating the attachment's `alt_text` does **not** retroactively change
    the hardcoded `alt` inside existing `post_content`. Full alt coverage therefore needs a
    second pass that rewrites `alt=""` occurrences inside `content.raw` of posts that embed the
    image. (Widely reported WP behavior; not vendor-documented — treat as POC item.)
- Batching: WP ships `/batch/v1` (default 25 sub-requests); no core rate limit exists, but treat
  hosts as ~5–10 rps to stay under WAF radar.

#### 2.3 SEO plugin fields — what is actually writable in 2026

- **Yoast (largest installed base)**: the official REST surface is **read-only** — "The Yoast REST
  API is currently read-only, and doesn't currently support `POST` or `PUT` calls to update the
  data" [8]. It exposes `yoast_head` (rendered HTML blob) and `yoast_head_json` (structured
  values) on every post/page response [8][9] — excellent for *reading* current state cheaply.
- **The write path everyone uses**: register Yoast's post-meta keys for REST yourself —
  `_yoast_wpseo_title` and `_yoast_wpseo_metadesc` via `register_post_meta(..., show_in_rest:
  true, auth_callback: current_user_can('edit_posts'))` — then write them through the normal
  `meta` object on `POST /wp/v2/posts/{id}` [10]. Community plugins exist that do exactly this
  (e.g. `yoast-rest-meta` adds title/description/focus keyword to REST) [11].
- **Rank Math**: identical situation — WP REST silently drops `rank_math_*` meta unless
  registered. The open-source **Rank Math API Manager** plugin registers `rank_math_title`,
  `rank_math_description`, `rank_math_canonical_url`, `rank_math_focus_keyword` (posts +
  WooCommerce products) for REST writes [12]; Rank Math itself ships a "Headless CMS Support"
  toggle for *reading* meta via REST [14]. n8n automation templates for both plugins confirm this
  is the production-standard pattern in 2026 [10][13].
- **Consequence — ship a companion plugin**: a single small "connector" plugin we maintain that
  (a) registers Yoast/Rank Math/AIOSEO meta keys for REST (detecting which SEO plugin is active),
  (b) optionally exposes a schema-injection hook and a health/version endpoint. One-click install
  from our onboarding flow. Without it, SEO titles/descriptions on WP are **not writable**.
- **Schema/structured data**: Yoast/Rank Math auto-generate their schema graphs (readable via
  `yoast_head_json`). Injecting *additional* JSON-LD via pure REST is not supported by either —
  either write it into post content (an HTML block, ugly) or via the companion plugin using
  Yoast's `wpseo_schema_*` filter API. Companion plugin again.
- **Redirects**: no core redirect API. The dominant Redirection plugin exposes its own REST routes
  (used by CLI/automation tools); alternatively the companion plugin can manage a redirect table.
  Verify the exact Redirection endpoints in POC.

### 3. Shopify — Admin GraphQL API (via an app)

#### 3.1 Integration path

The only path is a **Shopify app**: a custom app per store (merchant creates it, hands us the
Admin token — fastest for early customers) or a public app (OAuth install flow + app review —
required to scale). REST Admin API is legacy; all new work targets **GraphQL Admin API**
(current version 2026-07) [15][19].

#### 3.2 SEO-writable resources

- **Products**: `productUpdate` accepts `product.seo { title, description }` — the two supported
  SEO fields — plus `metafields` inline; requires `write_products` [15].
  - **Gotcha (verified via community bug thread)**: when updating `seo`, send **both** `title`
    and `description` — an omitted field is set to `null`, silently wiping the other value [17].
    Read-before-write is mandatory (aligns with our §0-B-style safety rules).
  - Variant-heavy stores: above 50,000 variants a throttle caps updates at 1,000 new variants/day
    [15] — irrelevant for SEO fields but relevant if we ever touch variants.
- **Collections/pages/blogs/articles**: search-engine listing (title tag + meta description) is
  writable on "a product, page, collection, blog, or article" via metafields — namespace
  `global`, keys `title_tag` / `description_tag` (`single_line_text_field`) [16]. Noindex/nofollow
  per resource: metafield `seo.hidden = 1` (`number_integer`) [16].
- **Redirects**: `urlRedirectCreate` (`write_online_store_navigation`) creates 301s [20] — the
  safe remediation for handle/URL changes. Note: changing a product/page `handle` via API does
  **not** auto-create a redirect; any handle change must be paired with `urlRedirectCreate` or
  refused (HIGH risk per SPEC §14).
- **Image alt text**: product media alt is writable (`productUpdateMedia` / `fileUpdate` on
  MediaImage `alt`); theme-hardcoded images are theme territory. **Resolved 2026-08** — `fileUpdate`
  is the mutation, and it also replaces file *content* at the same URL; see Addendum §B.2 [35].

#### 3.3 Theme code — the restricted zone (2026 status)

- The legacy **Asset API is restricted since Admin API 2023-04**: `PUT`/`DELETE` on theme assets
  requires `write_themes` **and** an approval/exemption for public apps; reading theme files
  remains open [18]. Exemption categories explicitly include "apps providing **search engine
  optimization**, content locking, or developer tooling" [18] — we qualify on paper, with a
  Google-Form request and a ~2-week review [18].
- The GraphQL replacement is **`themeFilesUpsert`** — batch create/update up to **50 theme files
  per request**, async job tracking; needs `write_themes` and, for public apps, an "Online Store
  Protected Scope Exemption" [24]. As of March 2026 Shopify is actively auditing apps holding
  Asset API access and revoking unused grants [18-changelog] — assume this surface keeps
  tightening.
- **Design decision**: keep theme writes out of the core loop. JSON-LD/schema injection goes
  through a **theme app extension (app embed block)** — the sanctioned mechanism that survives
  theme updates and needs no exemption [18]. Reserve `themeFilesUpsert` (with exemption) for the
  rare structural fixes (e.g. duplicate H1 in a template, `robots.txt.liquid` edits), and treat
  every theme write as MEDIUM+ risk with a theme-duplicate backup first.

#### 3.4 Rate limits

Cost-based, not request-based: standard plans get a **1,000-point bucket restoring at 50
points/s** (Shopify Plus: 2,000 / 100 pts/s); any single query is capped at 1,000 points [19].
Mutations cost 10 points each — bulk SEO rewrites across thousands of products need pacing
(~5 mutations/s sustained) or the `bulkOperationRunMutation` path.

### 4. Custom / other sites

#### 4.1 Edge injection ("edge SEO")

- **Mechanism**: a CDN worker or reverse proxy rewrites HTML in-flight between origin and user.
  Cloudflare's **HTMLRewriter** is the reference implementation: zero-copy *streaming* HTML
  parser with CSS-selector handlers (`on('title')`, `on('meta[name=description]')`,
  `on('head')`), supporting `setInnerContent`, `setAttribute`, `append`/`prepend`, `remove`;
  handlers can be async [26]. This covers titles, meta descriptions, canonicals, robots meta,
  hreflang, JSON-LD injection, alt attributes, internal-link insertion, and (at the worker
  level) redirects and headers — with zero origin code changes.
- **Capacity/cost envelope** (verified): Workers free tier 100k requests/day, 10 ms CPU/invocation
  — HTML rewriting of full pages fits comfortably; paid plan removes the daily cap and allows up
  to 30 s (configurable to 5 min) CPU, 128 MB memory, 10k subrequests [28]. An HTMLRewriter pass
  is typically sub-millisecond CPU, so even the free tier handles small sites.
- **Commercial precedent**: SearchPilot runs exactly this architecture (reverse proxy behind the
  customer's CDN, or native edge deployment on the customer's CDN) for enterprise SEO A/B testing,
  with automatic **fall-back to transparent proxy mode on application error** [25] — copy that
  failsafe. Their positioning confirms both viability and the operational bar (SLA, security
  review) for sitting in the serving path.
- **Onboarding models**: (a) customer already on Cloudflare → they install our Worker (or we use
  Workers for Platforms); (b) DNS points through our managed proxy → highest friction/trust; (c)
  customer's own CDN (Fastly/Akamai/CloudFront) → per-CDN worker builds. Start with (a).
- **Search-engine validity**: edge rewrites are indistinguishable from origin HTML to Googlebot —
  no rendering caveats apply. One policy caution: serving *different* HTML to search engines than
  to users would be cloaking; rewrites must be applied uniformly to all user agents.

#### 4.2 Client-side JS injection (tag-manager style) — works, but last resort

Google's own JS SEO documentation (current) [27]:

- Titles and meta descriptions: "You can use JavaScript to set or change the meta description as
  well as the `<title>` element" — processed at render time.
- Canonicals: injected canonicals are picked up at render, **but** Google warns against changing
  the canonical to a different URL than the one in raw HTML (conflicting signals across the
  crawl-then-render pipeline) [27][29]; if JS must set it, it should be the *only* canonical on
  the page.
- Structured data: JS-generated JSON-LD is supported, "make sure to test" [27].
- Hard failure mode: a `noindex` in raw HTML may cause Google to **skip rendering entirely**, so
  JS can't reliably *remove* noindex [27].
- Systemic drawbacks: render-queue delay before changes are seen, no effect on non-rendering
  bots/AI crawlers, and Google explicitly frames HTML as preferred and JS as fallback [27].
- Verdict: acceptable only as a stop-gap for prospects who can install nothing but a `<script>`
  tag; never the recommended integration.

#### 4.3 Headless CMS write paths (for CMS-driven sites incl. Next.js frontends)

- **Contentful (CMA)**: REST management API; default rate limit **7 requests/second** per
  organization (429 + `X-Contentful-RateLimit-Reset` on breach; higher on premium plans)
  [30][31]. Updates are optimistic-locked — `PUT` an entry with the `X-Contentful-Version`
  header; a separate **publish** step promotes the draft. Clean fit for our
  generate → validate → publish pipeline; the version header gives free conflict detection
  against concurrent human edits.
- **Sanity**: writes go through the proprietary **Mutations API** (`POST
  /{apiVersion}/data/mutate/{dataset}`, bearer token) — `patch.set` for field updates,
  **transactional**: an array of mutations either fully succeeds or fully fails [32]. Note the
  GraphQL API has no mutations — don't plan on GraphQL tooling for writes [33]. Free/growth plans
  hard-stop API access at quota (no throttle-through) [33].
- **Strapi 5**: REST API with API tokens; Document Service semantics — published versions are
  read-only, you update the **draft** and publish (`status: 'published'` to do both at once)
  [34]. Self-hosted instances mean no vendor rate limit but wildly variable capacity.
- Pattern for all three: the CMS entry is the source of truth for a route's SEO fields; the
  Next.js adapter must detect CMS-owned metadata (§1.4) and emit CMS mutations instead of code
  patches. Draft + publish workflows give us a natural staging/validation hook.

---

## Options compared

### A. Change-application mechanism per platform

| Option | Auth | Writable SEO surface | Throughput limits | Rollback story | Effort |
|---|---|---|---|---|---|
| **GitHub PR (Next.js/React)** | GitHub App, fine-grained (`contents`, `pull_requests`) | Everything in the repo: metadata, canonicals, sitemap/robots, alt, JSON-LD, content, redirects (config) | 5k–12.5k req/h primary; **80/min & 500/h content-creation** secondary [23] | Best-in-class: `git revert` PR | High (code understanding, per-repo variance) |
| **WordPress REST + companion plugin** | Application Passwords (core) [4][5] | Post/page title, content, slug, media `alt_text` [7]; Yoast/RM title+description+canonical **only via registered meta** [8][10][12]; schema via plugin hook | No core limit; host WAFs; `/batch/v1` = 25 ops | Good: we store before-values; per-field restore | Medium (plugin + plugin-zoo variance) |
| **Shopify app (GraphQL Admin)** | Custom-app token or OAuth (public app) | `productUpdate.seo` [15]; `global.title_tag`/`description_tag` metafields on page/collection/blog/article [16]; `seo.hidden` noindex [16]; `urlRedirectCreate` [20]; alt on media; JSON-LD via app embed | 1,000-pt bucket @ 50 pts/s (Plus 2k/100) [19] | Good for fields (before-values); theme writes need theme-duplicate backups | Medium; **protected-scope exemption** for theme files [18][24] |
| **Edge worker / reverse proxy** | Cloudflare account access or DNS change | Any HTML: title, meta, canonical, robots, JSON-LD, links, alt; headers + redirects [26] | Workers free 100k req/day, 10 ms CPU; paid uncapped [28] | Instant: disable rule (seconds) | Medium build, **high operational** (serving path, SLA) [25] |
| **Client-side JS snippet** | Script tag install | Title/meta/canonical/JSON-LD at render time [27] | n/a | Instant (remove rule) | Low — but render-delay, noindex blind spot, non-Google bots miss it [27] |
| **Headless CMS APIs** | Vendor tokens | Whatever the content model exposes (SEO fields must exist in the model) | Contentful 7 rps [30]; Sanity txn API [32]; Strapi self-hosted [34] | Good: entry versioning / draft-publish | Low–Medium per vendor |

### B. Code-change generation for the GitHub adapter

| Approach | Measured reliability | Best for | Gate required |
|---|---|---|---|
| Hand-written ts-morph codemods | Deterministic (write once, test once) | The repetitive 80%: metadata fields, canonical, alt props, sitemap/robots files, frontmatter | Unit tests on the codemod itself |
| LLM writes the codemod | 26% vanilla → ~54% with 4 refinement iterations [21][22]; jscodeshift one-shot 45.29% [21] | Never in production unattended | — |
| LLM writes the diff directly | Unmeasured on this task; assume comparable failure modes | Long-tail/custom components, content edits | Full pipeline: typecheck → build → tests → preview-deploy crawl → PR (human merge for MEDIUM+) |
| Hybrid (LLM plans, codemod executes) | Deterministic execution of a validated plan | Default architecture | Plan schema validation + same pipeline |

---

## Platform recommendation matrix

| Platform | Integration mechanism | Safely auto-writable (LOW risk) | PR/approval-gated (MEDIUM+) | Not writable / avoid |
|---|---|---|---|---|
| **Next.js (App Router)** | GitHub App → codemod/LLM patch → PR → CI + preview crawl → auto-merge LOW | meta description, missing canonical, missing alt, sitemap.ts/robots.ts creation, JSON-LD component, redirects config | titles, H1s, content, internal links, URL changes | anything failing build/tests; routes with CMS-owned metadata (route to CMS adapter) |
| **Next.js (Pages Router)** | Same, but expect custom `<SEO>` components → more LLM patches, more validation | same list, lower automation rate | same | deep refactors of bespoke head components |
| **WordPress** | REST (App Passwords) + **our companion plugin** | Yoast/RM meta description, media `alt_text` [7], missing canonical (RM) [12] | titles, slugs (+redirect), content, schema filters, redirects | anything when companion plugin absent (SEO fields read-only [8]); sites whose host blocks REST writes |
| **Shopify** | Custom/public app, GraphQL Admin | `seo.title`+`seo.description` (always both fields! [17]), `title_tag`/`description_tag` metafields [16], media alt, `urlRedirectCreate` [20] | `seo.hidden` noindex [16], theme writes via `themeFilesUpsert` (≤50 files, exemption) [24], app-embed JSON-LD config | handle/URL changes without paired redirects; checkout; theme writes pre-exemption |
| **Custom site, on Cloudflare** | Worker + HTMLRewriter [26] | meta description, canonical, JSON-LD, alt, og tags | title, robots meta, redirects, internal links | rewrites that diverge per user-agent (cloaking risk) |
| **Custom site, no CDN/API** | Managed reverse proxy (SearchPilot model [25]) or JS snippet (last resort [27]) | as above via proxy | all | JS-based noindex removal (Google may not render [27]) |
| **Contentful/Sanity/Strapi-backed** | CMS management APIs [30][32][34] | SEO fields that exist in the content model; draft-first | publish step for content changes | fields absent from the content model (schema change = human) |

---

## Recommendation & why

1. **One abstraction, four adapters.** Every adapter consumes the same structured action format
   (SPEC §7: `UPDATE_TITLE {old,new,reason,confidence,risk}`) and returns the same receipt
   (`applied_change_id`, before/after, revert handle). This makes SPEC §16 change tracking and
   §17 rollback platform-uniform: revert = `git revert` PR / restore meta value / restore
   metafield / disable edge rule.
2. **WordPress first, Shopify second** for market coverage and lowest time-to-value; both are
   API-writable within days of work *given the companion plugin (WP) and app scaffold (Shopify)*.
   The companion plugin is the critical path on WP — build and security-review it early.
3. **GitHub adapter is the MVP showpiece** (SPEC §24 names Next.js + GitHub explicitly): invest in
   the route→metadata-source resolver and the ts-morph codemod library; use LLM diffs only behind
   the full validation pipeline. The measured ~45–55% LLM codemod accuracy [21][22] is the
   strongest argument in the whole study for "deterministic where possible, LLM where necessary,
   validate always."
4. **Edge adapter as the universal fallback and the instant-apply channel.** It is also
   strategically interesting beyond custom sites: even for WP/Shopify customers it enables
   minutes-latency experiments and instant rollback without touching the site — SearchPilot has
   validated the model commercially [25]. But it makes us a serving-path dependency; ship it
   after the API adapters, with transparent-proxy failover from day one.
5. **Never client-side JS injection as a paid tier.** Google-supported but explicitly second-class
   [27]; offer it only as a trial/demo mode.

---

## Risks & limitations

- **WP plugin zoo & drift**: Yoast/RM internals (meta keys, filters) are stable but unversioned
  guarantees; the companion plugin needs CI against new plugin releases. Hosts/WAFs blocking REST
  writes will generate support load.
- **WP alt-text dual location**: attachment `alt_text` vs hardcoded alt in `post_content` — full
  fix requires content rewriting; scope this in the POC (flagged §2.2).
- **Shopify approval risk**: theme-file writes for public apps hinge on a protected-scope
  exemption; Shopify is auditing/revoking access through 2026 [18][24]. Mitigation: MVP works
  metafields-only; exemption is an enhancement, not a dependency.
- **Shopify `seo` nulling bug-class** [17]: any adapter that writes partial objects must
  read-before-write and echo unchanged fields.
- **GitHub secondary limits** (80/min, 500/h content-creation [23]) cap per-installation PR
  volume; batch changes per PR and queue per-repo.
- **LLM patch reliability**: 45–55% one-shot correctness on codemod-style tasks [21][22] means an
  unvalidated LLM patch pipeline would break customer sites weekly at scale. The build/test/crawl
  gate is load-bearing, not ceremonial.
- **Edge adapter operational exposure**: we become an availability dependency (DNS/proxy mode) —
  needs SLA, fallback-to-transparent-proxy [25], and a security story before any enterprise deal.
- **Cloaking line**: edge/JS rewrites must be UA-uniform; per-bot HTML variation risks manual
  action.
- **Rendering caveats cut both ways**: Next.js streamed metadata [1] and JS-injected tags [27]
  can fool our *own* validation crawler — the validator must render JS.

### Open questions (for POC / next lanes)

1. Do 2026-07 `pageUpdate`/`articleUpdate`/`collectionUpdate` mutations accept an inline `seo`
   input like `productUpdate`, or is `global.title_tag` metafield the only path for non-products?
   (Docs verified only for products [15] + metafield route [16].)
2. Exact Redirection-plugin REST endpoints (WP redirect automation) — verify or fold redirects
   into the companion plugin.
3. WP block-editor alt-text propagation behavior — confirm the dual-location problem and cost the
   content-rewrite pass.
4. Will Shopify grant a *new* SEO app the protected-scope exemption in 2026's tightened regime,
   and on what timeline beyond the stated 2-week review [18]?
5. Contentful current per-plan CMA limits (docs rate-limited during research; 7 rps default is
   community/legacy-doc sourced [30][31]).
6. Coverage for Wix/Squarespace/Webflow (meaningful SMB share; Webflow has a Data API v2 —
   unresearched in this lane).

---

## Addendum (2026-08, gap-fill lane): Image optimization — fix application mechanics (SPEC §2/§6/§14)

Detection of large/legacy-format/missing-dimension images is covered in `seo-detection.md` §5;
"lossless image recompression" sits on the LOW auto-apply list there. This addendum researches
the **application** side: the re-encoding pipeline, replacing a media binary at the same URL per
platform, srcset/`<picture>`/dimension generation, and CDN-level optimization as an alternative.
Sources [35]–[57] continue the numbering below.

### Addendum summary

**Apply image fixes down a four-rung decision ladder, cheapest-safest rung first:**

0. **Classify the delivery pipeline before proposing any image fix.** On three of our four
   platforms the "legacy format / oversized" problem may already be solved at delivery time:
   Shopify's CDN "automatically detects which image formats are supported by the client (e.g.
   WebP, AVIF, etc.) and selects a file format for optimal quality and file size" [46], and
   Shopify's `image_tag` auto-generates `srcset` + `width`/`height` + lazy-loading [47];
   `next/image` auto-generates `srcset` and serves WebP by default (AVIF opt-in) [42]; a
   Cloudflare-proxied site may already run Polish [41]. **The detector must therefore measure
   *delivered* bytes/format (what Googlebot receives), not the stored original** — otherwise we
   file false positives and "fix" images the CDN already optimizes.
1. **Delivery-layer optimization first** where a knob exists (enable Polish; enable
   `formats: ['image/avif','image/webp']` in `next.config.js`; theme uses `image_url` width
   params). Config-level change, instant rollback, no binaries touched.
2. **Same-URL in-place binary replacement** for origin-heavy files — the only auto-apply path
   for binaries. **Lossless-only recompression (jpegtran `-copy none` progressive [53], oxipng
   `--strip safe` [54]) = LOW auto-apply; lossy re-encode/downscale = MEDIUM**, gated by an
   SSIM/size/dimensions validation gate. Mechanics per platform: Shopify `fileUpdate` with
   `originalSource` officially "replace[s] image or generic file content while maintaining the
   same URL" [35] (the former "verify in POC" item — resolved); WordPress core REST has **no**
   replace-in-place (confirmed [7]) so our companion plugin grows a `replace-file` endpoint
   replicating what Enable Media Replace (600k+ installs) has done for years [36]; GitHub-hosted
   images are a normal blob-replace commit through the existing PR pipeline [51].
3. **Markup modernization** (add `width`/`height`, generate `srcset`/`<picture>`, migrate `<img>`
   → `next/image`) rides the existing adapters (PR / theme / companion plugin) at MEDIUM.
4. **Never swap an image to a new URL as a "fix."** Google: "consistently reference the image
   with the same URL, so that Google can cache and reuse the image" [39]. New-URL migrations
   (e.g. moving media to a CDN domain) are HIGH-risk restructuring, out of auto-apply scope.

### A. The re-encoding pipeline (platform-neutral worker)

**Engine: sharp (libvips).** The de-facto Node standard; current benchmark: decompress a
2725×2225 JPEG, Lanczos-3 resize to 720×588, re-encode q80 at **~88–90 ops/s on a 4-vCPU AMD
EPYC instance** (~26× faster than pure-JS jimp) [40]. Order-of-magnitude: a single 4-vCPU worker
re-encodes a 100k-image site in ~20 minutes for JPEG-class work; AVIF budgets ~50% more encode
time than WebP [42].

**Two output tiers mapped to SPEC §14 risk:**

- **Lossless tier (LOW, auto-apply)** — bit-identical rendering:
  - JPEG: `jpegtran` progressive + "jpegrescan" optimization "can be applied to any JPEG file …
    to losslessly reduce file size" (mozjpeg) [53]; metadata stripping via `-copy none`.
  - PNG: oxipng — "multithreaded lossless PNG/APNG compression optimizer", default `-o 2`,
    `--strip safe` removes only non-critical chunks [54]. Note: oxipng's `--alpha` flag is
    *technically lossy* [54] — keep it off the LOW tier.
  - Metadata policy: strip "safe" only. Blanket EXIF/IPTC stripping can delete copyright/license
    metadata (Google Images licensing features read IPTC) — treat full-strip as MEDIUM.
- **Lossy tier (MEDIUM)** — downscale to rendered size and/or modern-format re-encode:
  - Expected wins: WebP is 25–34% smaller than JPEG at equal SSIM (Google WebP study) [52];
    AVIF "can be up to 50% smaller than JPEGs" [43]; in a controlled quality-matched test, AVIF
    averaged **36% smaller** and WebP **15% smaller** than equivalent JPEGs [49]; Next.js docs:
    AVIF "takes 50% longer to encode but … compresses 20% smaller" than WebP [42].
  - Encoder defaults (quality-equivalence, from the same test): **JPEG q60 ≈ AVIF q51 ≈ WebP
    q64**; JPEG q80 ≈ AVIF q64 ≈ WebP q82 [49].
  - **Validation gate before any lossy apply**: (1) output bytes strictly smaller, (2) intrinsic
    dimensions unchanged (or intentionally downscaled with markup updated in the same change),
    (3) SSIM/Butteraugli above threshold vs source, (4) format actually supported by Google
    Search (BMP, GIF, JPEG, PNG, WebP, SVG, AVIF [39]) *and* by the platform (WP AVIF sub-size
    generation needs Imagick/GD AVIF support on the host — varies by hoster [43]).

### B. Same-URL binary replacement per platform

#### B.1 WordPress

- **Core REST cannot do it.** `POST /wp/v2/media` creates a *new* attachment (new URL);
  `POST /wp/v2/media/<id>` updates only fields (`alt_text`, `caption`, `title`, `description`,
  `meta`, …) — no route replaces the underlying file [7]. (The block editor's image-edit route
  also produces new files, not in-place swaps — POC-verify if ever relevant.)
- **The in-place pattern is proven by Enable Media Replace** (ShortPixel; 600k+ installs,
  v4.2.2, updated 2026-06): replace "an image or file in your Media Library by uploading a new
  file in its place", keeping name+URL, with an optional rename mode that rewrites links; but it
  exposes **no REST or WP-CLI surface** [36] — it is admin-UI only, so we can't drive it.
- **Therefore: the companion plugin (already mandatory for Yoast/Rank Math meta, §2.3) gains a
  `replace-file` endpoint**: input = attachment ID + new binary (same MIME); steps = backup
  original to our object storage → overwrite the file on disk → regenerate sub-sizes
  (`wp_create_image_subsizes()`; operationally same as `wp media regenerate <id>` [48]) →
  refresh attachment metadata → purge page/CDN caches. Rollback = POST the backed-up bytes
  through the same endpoint.
- **WP-specific traps the endpoint must handle:**
  - **`-scaled` indirection (WP ≥5.3)**: uploads over the 2560px `big_image_size_threshold` get
    a `-scaled` derivative that *becomes* the "full size" URL; the true original is kept under
    the `original_image` meta key [50]. Replacement must rewrite original + `-scaled` + every
    registered sub-size, or dimensions drift.
  - **Hardcoded sub-size URLs in `post_content`**: posts embed specific files
    (`foo-768x512.jpg`). In-place replacement **keeping identical dimensions** keeps every
    hardcoded URL valid — this is exactly why same-URL replacement is the safe primitive and
    dimension-changing replacement is MEDIUM+ (requires a content-rewrite pass, same machinery
    as the alt-text dual-location problem in §2.2).
  - **srcset/dimensions come free at render**: WP has auto-generated `srcset`/`sizes` at render
    since 4.4 and back-fills `width`/`height` on `img` tags since 5.5 — *provided* the image is
    an attachment with the `wp-image-{id}` class and intact metadata [45]. So on WP, "missing
    dimensions" and "no srcset" are usually **metadata/class repairs, not markup edits**.
- **Format conversion on WP: don't move binaries at all.** The Performance Team's **Modern Image
  Formats** plugin (100k+ installs, v2.7.1) generates WebP/AVIF on upload (AVIF preferred when
  the server supports it) with an optional `<picture>` output mode; existing images convert via
  regeneration [44]. WP core itself accepts AVIF uploads since 6.5, dependent on the host's
  Imagick/GD build [43]. Alternative for customers who want managed optimization: ShortPixel
  optimizes **in place with unchanged URLs**, keeps restorable backups, converts WebP/AVIF, and
  bulk-processes existing media (300k+ installs; ~$9.99/mo unlimited tier) [55]. **Positioning:
  the WP image-optimization market is commoditized — our platform should detect + orchestrate
  (install/configure one of these via the companion flow), not re-implement conversion serving.**

#### B.2 Shopify — former POC item, now resolved from vendor docs

- **`fileUpdate` (2026-07 API) is the exact mutation.** `FileUpdateInput` = `id` (required),
  `alt`, `filename` (extension must match original), `originalSource`, `previewImageSource`,
  `productReferences`. The docs state: "File content: Replace image or generic file content
  **while maintaining the same URL**." Scopes: `write_files` (or `write_themes`); files must be
  in `ready` state; `originalSource` and `previewImageSource` cannot be updated in the same
  call; content replacement applies to images and generic files (videos/3D models: alt +
  references only); processing is async (`fileStatus: PROCESSING`) [35].
- **Remaining POC residue (small)**: confirm `originalSource` accepts our staged-upload URL for
  a *product-attached* MediaImage, and observe cache behavior on the CDN URL after replacement
  (Shopify's CDN appends version numbers to asset URLs for cache-busting [56] — expect a new
  `?v=` on the same path).
- **But on Shopify, binary replacement is rarely the right fix**: the CDN already auto-negotiates
  WebP/AVIF per client [46], `image_url` resizes on the fly (width/height up to 5760px, crop,
  `format: pjpg|jpg`) [46], and `image_tag` emits `srcset` + `width`/`height` + lazy-loading by
  default [47]. Legacy-format and responsive-size findings on Shopify are therefore **theme
  findings** (a template using raw `img.src` instead of `image_url`/`image_tag`) → theme-write
  territory (§3.3, MEDIUM+), or **origin-weight findings** (a 20 MB source PNG the CDN must
  derive from) → `fileUpdate` replacement per above.

#### B.3 GitHub / Next.js

- **Repo-stored images** (`public/`, imported assets): replacement is a normal blob-replace
  commit through the existing PR pipeline (§1.5) — the Git Data API takes base64 blobs; limits:
  Git warns at 50 MiB, blocks at 100 MiB, and GitHub recommends repos stay "ideally less than
  1 GB" [51]. Sites with heavy media typically use LFS or external storage — the adapter must
  detect LFS pointers and route those files to the storage backend instead of the repo.
- **The durable fix is usually markup/config, not binaries**: `next/image` requires
  `alt`, and `width`/`height` (unless static-import or `fill`) — enforcing the
  missing-dimensions fix by construction — auto-generates `srcset`/`src`, and serves WebP by
  default with AVIF opt-in via `formats: ['image/avif','image/webp']`; static imports get
  dimensions automatically; SVG passes through `unoptimized` [42]. So the codemod set from §1.3
  gains two members: **`<img>` → `<Image>` migration** and **`formats` config enablement**.
- **Cost coupling to disclose in the change proposal**: on Vercel, image optimization is billed
  per transformation — Hobby includes 5K transformations/mo; on-demand **$0.05–$0.0812 per 1K
  transformations**, plus image cache reads $0.40–$0.64/1M and cache writes $4.00–$6.40/1M
  (billed on cache MISS/STALE); source images capped at 8192px; only JPEG/PNG/WebP/AVIF sources
  are optimized; transformed output max 10 MB [37]. Auto-enabling AVIF also doubles format cache
  storage [42]. An "enable next/image everywhere" PR changes the customer's bill — the action
  payload must say so (mirrors our §0-B-style paid-action gating).

### C. srcset / `<picture>` / dimensions generation — who owns it per platform

| Platform | srcset | `<picture>` fallback | width/height | Our action |
|---|---|---|---|---|
| WordPress | Core, at render, since 4.4 [45] | Modern Image Formats plugin option [44] | Core back-fill since 5.5 (needs `wp-image-{id}` class + metadata) [45] | Repair attachment metadata/class; install/enable plugin; regenerate sub-sizes [48] |
| Shopify | `image_tag` default widths [47] | CDN format negotiation makes it unnecessary [46] | `image_tag` default [47] | Theme fix only where raw `<img>` bypasses filters (MEDIUM, §3.3) |
| Next.js | `next/image` automatic [42] | `getImageProps()` for art direction [42] | Required props / static import [42] | `<img>`→`<Image>` codemod + `formats` config (PR) |
| Custom/edge | HTMLRewriter can inject `srcset`/dimensions [26] | HTMLRewriter `<picture>` wrapping possible but needs variant URLs to exist | HTMLRewriter `setAttribute` [26] | Only when an image CDN provides the variants (D) |

**Missing-dimensions fix mechanics** (LOW per detection lane): read intrinsic size from the
binary during crawl → write `width`/`height` attributes + `height:auto` CSS guidance. On WP and
Shopify this is normally the platform's job (table above) — prefer repairing the platform path
over patching HTML.

### D. CDN-level image optimization as the alternative

- **Cloudflare Polish** (Pro+ plans): "strips metadata … and reduces image size through lossy or
  lossless compression", keeps the same image URLs, requires no markup change, and never touches
  the origin file — optimization happens in Cloudflare's cache [41]. For customers already on
  Cloudflare this is a **zero-binary-touch, instantly-reversible** fix: flip a zone setting.
- **Cloudflare Images transformations** (for sites where we control the zone): first 5,000
  unique transformations/month free, then **$0.50 per 1,000 unique transformations**; storage
  $5/100k images and delivery $1/100k only apply when images are stored in Cloudflare's bucket —
  "transform images stored elsewhere" bills transformations only [38].
- **Vercel** is this same class for Next.js sites (pricing in B.3 [37]); **Shopify's CDN** is
  this class built-in and free [46].
- **Cache purge is part of the apply step**: any same-URL replacement behind a CDN must purge the
  URL — Cloudflare purge-by-single-file takes exact URLs (path is case-sensitive, wildcards not
  supported) [57]. The WP companion endpoint should call the host/CDN purge hook it detects.
- **Do not stack optimizers**: origin-side lossy recompression + Polish lossy = two generations
  of quality loss; detect Polish/equivalent (response headers) and pick **one** layer.

### E. Options compared — applying the "large/legacy-format image" fix

| Mechanism | Platforms | URL stable? | SPEC §14 tier | Latency to live | Rollback | Marginal cost |
|---|---|---|---|---|---|---|
| Enable delivery-layer optimization (Polish [41], `next/image` formats [42], Shopify native [46]) | CF-proxied, Next.js, Shopify | Yes (or handled by framework) | LOW (config) / MEDIUM (PR for Next.js) | Minutes | Instant (config revert) | Polish: plan feature; Vercel: $0.05–0.08/1K transforms [37]; Shopify: $0 |
| Lossless in-place recompression (jpegtran/oxipng [53][54]) via B.1/B.2/B.3 channels | All | Yes | **LOW auto-apply** | Minutes (WP/Shopify) / PR cycle (GitHub) | Restore backed-up bytes | Compute only (~90 img/s per 4 vCPU [40]) |
| Lossy re-encode / downscale in place | All | Yes | MEDIUM (SSIM gate + sampled visual approval) | Same | Restore backed-up bytes | Compute; AVIF +50% encode time [42] |
| Markup modernization (srcset/picture/dimensions/`<Image>`) | All | n/a | MEDIUM (PR/theme/plugin) | PR cycle | git revert / theme restore | Dev-pipeline only |
| Install existing optimizer plugin (WP: ShortPixel [55] / Modern Image Formats [44]) | WordPress | Yes | LOW (operational) | Hours (bulk) | Plugin's own backups [55] | ShortPixel ~$9.99/mo unlimited [55]; MIF free |
| New-URL image migration (e.g. to external CDN) | All | **No** | HIGH — never auto | — | Hard | — |

### F. Addendum recommendation

1. **Ship the lossless in-place recompression path as the only auto-apply binary action**, on
   the three channels that keep URLs stable: WP companion `replace-file` endpoint, Shopify
   `fileUpdate.originalSource` [35], GitHub blob-replace PR. Every apply stores the original
   bytes in our object storage first (receipt = revert handle), satisfying §16/§17 uniformly.
2. **Gate lossy work behind the SSIM/size/dimension gate + sampled human approval** (MEDIUM),
   consistent with the detection lane's tiering.
3. **Prefer the delivery layer wherever it exists** — and teach the detector to measure
   delivered bytes/format first (rung 0). On Shopify, image-format findings are almost always
   theme findings, not binary findings [46][47].
4. **On WordPress, orchestrate the existing ecosystem** (Modern Image Formats / ShortPixel) for
   format conversion instead of building serving infrastructure [44][55]; reserve our endpoint
   for recompression and rollback.
5. **POC list for this addendum**: (a) WP `replace-file` endpoint on a `-scaled` attachment —
   verify hardcoded `post_content` sub-size URLs survive and sub-sizes regenerate [48][50];
   (b) Shopify `fileUpdate` `originalSource` on a product-attached MediaImage — verify same-URL
   claim end-to-end + `?v=` cache behavior [35][56]; (c) verify "bit-identical rendering" for
   the exact jpegtran/oxipng flag sets we ship [53][54]; (d) measure delivered-vs-origin bytes
   on a Polish-enabled and a Shopify site to calibrate rung-0 detection [41][46].

### G. Addendum risks & limitations

- **Host variance on WP**: AVIF sub-size generation depends on the host's Imagick/GD build —
  real-world hosts fail silently (missing thumbnails reported on major hosts) [43]; the
  companion endpoint must verify server capability (Site Health "Media Handling") before
  promising format conversion.
- **Dimension-changing replacements are a different risk class**: same-URL + same-dimensions is
  LOW; any downscale changes intrinsic size and can shift layout on pages that relied on it —
  keep downscales MEDIUM and pair them with the markup pass.
- **Shopify async replacement**: `fileUpdate` content replacement is async (`PROCESSING`) [35] —
  the apply step must poll to `ready` before writing the change receipt, and the `filename`
  extension must match the original (no format conversion via replacement) [35].
- **Vercel/Cloudflare metering**: image optimization is metered per transformation
  [37][38] — bulk-enabling optimization on a 100k-image site has a real recurring cost that
  must appear in the customer-facing change proposal.
- **Optimizer stacking** (origin recompress + Polish + plugin) degrades quality and wastes
  compute; the pipeline classifier (rung 0) is load-bearing.
- **Metadata stripping vs image licensing**: full EXIF/IPTC strip can remove licensing signals
  Google Images surfaces; default to safe-strip [54].
- **Purge correctness**: a replaced binary hidden behind a stale CDN copy looks like a failed
  apply and would confuse the §17 monitor — purge (case-sensitive exact URL on Cloudflare [57])
  and re-fetch verification belong inside the apply transaction, not after it.

---

## Sources

1. https://nextjs.org/docs/app/api-reference/functions/generate-metadata — Next.js v16.3 Metadata API reference (fields, merging, streaming metadata, metadataBase). Fetched 2026-08.
2. https://nextjslaunchpad.com/article/nextjs-seo-metadata-api-sitemaps-json-ld-og-images — Next.js SEO & Metadata API guide 2026 (sitemap.ts, canonical-not-inferred).
3. https://smartwp.com/wordpress-rest-api/ — WordPress REST API practical 2026 guide (auth, meta writes, least-privilege user).
4. https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/ — WP REST authentication handbook (Application Passwords, HTTPS requirement).
5. https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/ — Application Passwords integration guide (core since 5.6).
6. https://learn.wordpress.org/tutorial/wp-rest-api-custom-fields-authentication-and-testing/ — WP REST custom fields + `show_in_rest`.
7. https://developer.wordpress.org/rest-api/reference/media/ — WP Media REST endpoint (`alt_text` writable on POST /media/{id}).
8. https://developer.yoast.com/customization/apis/rest-api/ — Yoast REST API: "currently read-only, doesn't support POST or PUT". Fetched 2026-08.
9. https://yoast.com/features/rest-api/ — Yoast REST feature page (`yoast_head`/`yoast_head_json` for headless reads).
10. https://kahunam.com/articles/wordpress/how-to-update-yoast-seo-titles-and-meta-descriptions-via-the-wordpress-rest-api/ — `_yoast_wpseo_title`/`_yoast_wpseo_metadesc` registration + REST write recipe. Fetched 2026-08.
11. https://github.com/Websual/yoast-rest-meta — plugin adding Yoast fields to WP REST.
12. https://github.com/Devora-AS/rank-math-api-manager — Rank Math API Manager plugin (rank_math_title/description/canonical/focus keyword via REST).
13. https://n8n.io/workflows/7180-automate-seo-title-and-description-updates-for-wordpress-with-yoast-seo-api/ — production automation pattern for Yoast REST writes.
14. https://rankmath.com/kb/headless-cms-support/ — Rank Math headless CMS support toggle.
15. https://shopify.dev/docs/api/admin-graphql/latest/mutations/productUpdate — productUpdate (seo{title,description}, write_products, 2026-07, variant throttle). Fetched 2026-08.
16. https://shopify.dev/docs/apps/build/marketing-analytics/optimize-storefront-seo — SEO via metafields: `global.title_tag`/`global.description_tag` on product/page/collection/blog/article; `seo.hidden` noindex. Fetched 2026-08.
17. https://community.shopify.com/c/shopify-apis-and-sdks/bug-report-productupdate-meta-property/td-p/2011037 — partial `seo` input nulls the omitted field.
18. https://shopify.dev/docs/apps/build/online-store/asset-legacy — Asset API restrictions since 2023-04, exemption categories incl. SEO, theme app extensions as alternative. Fetched 2026-08. (Changelog: https://shopify.dev/changelog/upcoming-changes-to-asset-api-approval-scope — 2026 audits.)
19. https://shopify.dev/docs/api/usage/limits — Shopify API limits (cost points: 1,000-pt bucket @ 50 pts/s standard; Plus 2,000/100; 1,000-pt single-query cap).
20. https://shopify.dev/docs/api/admin-graphql/latest/mutations/urlRedirectCreate — urlRedirectCreate, `write_online_store_navigation`. Fetched 2026-08.
21. https://codemod.com/blog/iterative-ai-system — Codemod AI evals: vanilla LLM codemods 26% → 54% after 4 refinement iterations; GPT-4o jscodeshift 45.29% one-shot.
22. https://codemod.com/blog/ts-morph-support — Codemod AI ts-morph support rationale.
23. https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api — GitHub App installation limits: 5,000/h base, +50/h per repo/user >20, 12,500/h cap, 15,000/h GHE Cloud; secondary 80 content-creating/min, 500/h. Fetched 2026-08.
24. https://shopify.dev/docs/api/admin-graphql/latest/mutations/themeFilesUpsert — themeFilesUpsert (≤50 files/request, async job, write_themes + protected-scope exemption).
25. https://www.searchpilot.com/engineers — SearchPilot proxy/edge architecture, transparent-proxy failover. (Also https://www.searchpilot.com/resources/blog/edge-seo)
26. https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/ — HTMLRewriter streaming parser, selectors, setInnerContent/setAttribute/append. Fetched 2026-08.
27. https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics — Google JS SEO: JS-set title/description supported; JS canonicals picked up with warnings; noindex may skip rendering; HTML preferred. Fetched 2026-08.
28. https://developers.cloudflare.com/workers/platform/limits/ — Workers limits: free 100k req/day + 10 ms CPU; paid uncapped requests, 30 s default CPU, 128 MB, 10k subrequests. Fetched 2026-08.
29. https://searchengineland.com/google-documents-how-to-inject-canonical-tags-using-javascript-386187 — Google's JS-canonical guidance coverage.
30. https://www.contentful.com/developers/docs/references/content-management-api/overview/ — Contentful CMA (versioned updates, publish step; 7 rps default per community/legacy docs — page rate-limited during fetch).
31. https://timmarsh.co.uk/2025/05/25/contentful-api-limits-and-strategies-of-how-to-protect-itself/ — Contentful API limit behavior (429 + X-Contentful-RateLimit-Reset).
32. https://www.sanity.io/docs/http-mutations — Sanity Mutations API (POST /data/mutate, bearer token, transactional patch/set). Fetched 2026-08.
33. https://dredyson.com/fix-headless-cms-api-limits-a-cms-developers-step-by-step-guide-to-managing-contentful-strapi-and-sanity-io-usage-quotas/ — Sanity GraphQL has no mutations; free-plan hard caps.
34. https://docs.strapi.io/cms/api/document-service — Strapi 5 Document Service (published read-only, update draft + status:'published', API tokens). Fetched 2026-08.

**Addendum sources (image fix application; all fetched 2026-08):**

35. https://shopify.dev/docs/api/admin-graphql/latest/mutations/fileUpdate — fileUpdate mutation (API 2026-07): `originalSource` "Replace image or generic file content while maintaining the same URL"; `write_files`/`write_themes`; `ready`-state requirement; async PROCESSING; filename extension must match; images+generic files only for content replacement.
36. https://wordpress.org/plugins/enable-media-replace/ — Enable Media Replace (ShortPixel): in-place replacement keeping name+URL, rename mode rewrites links; 600k+ installs, v4.2.2, updated 2026-06-28; no REST/WP-CLI surface documented.
37. https://vercel.com/docs/image-optimization/limits-and-pricing — Vercel image optimization pricing (updated 2026-02-23): Hobby 5K transformations/mo included; $0.05–$0.0812/1K transformations; cache reads $0.40–$0.64/1M, writes $4.00–$6.40/1M; billed on MISS/STALE; 8192px source cap; JPEG/PNG/WebP/AVIF sources; 10 MB transformed max.
38. https://developers.cloudflare.com/images/pricing/ — Cloudflare Images: 5,000 unique transformations/mo free, then $0.50/1,000; $5/100k stored + $1/100k delivered only for Cloudflare-stored images; transform-elsewhere bills transformations only.
39. https://developers.google.com/search/docs/appearance/google-images — Google Images best practices: "consistently reference the image with the same URL"; srcset with fallback `src`; image sitemaps may reference other domains (CDN); supported formats BMP/GIF/JPEG/PNG/WebP/SVG/AVIF.
40. https://sharp.pixelplumbing.com/performance/ — sharp benchmark: 2725×2225 JPEG decode → Lanczos-3 resize 720×588 → q80 encode at ~88–90 ops/s on 4× AMD EPYC 9R45 (c8a.xlarge); ~26× jimp.
41. https://developers.cloudflare.com/images/polish/ — Polish: lossy/lossless compression + metadata strip, same URLs, no markup change, origin untouched; Pro+ plans.
42. https://nextjs.org/docs/app/api-reference/components/image — next/image (v16.3 docs): alt required; width/height required unless static import/`fill`; auto srcset; `formats` default WebP, AVIF opt-in; "AVIF generally takes 50% longer to encode but it compresses 20% smaller compared to WebP"; per-format caching doubles storage; SVG → `unoptimized`.
43. https://make.wordpress.org/core/2024/02/23/wordpress-6-5-adds-avif-support/ — AVIF in WP core 6.5; requires Imagick/GD AVIF support on the host (Site Health → Media Handling); "AVIF images can be up to 50% smaller than JPEGs"; host-level failures reported.
44. https://wordpress.org/plugins/webp-uploads/ — Modern Image Formats (WordPress Performance Team): WebP+AVIF generation on upload (AVIF preferred when supported), `<picture>` output option since 2.0.0; existing images only via regeneration; 100k+ installs, v2.7.1.
45. https://make.wordpress.org/core/2020/07/14/lazy-loading-images-in-5-5/ — WP 5.5 back-fills `width`/`height` on `img` tags (attachment + `wp-image-{id}` class required, reuses srcset logic since 4.4) and auto-adds `loading="lazy"` when dimensions present.
46. https://shopify.dev/docs/api/liquid/filters/image_url — image_url: width/height up to 5760px, crop, `format: pjpg|jpg`; "Shopify automatically detects which image formats are supported by the client (e.g. WebP, AVIF, etc.) and selects a file format for optimal quality and file size."
47. https://shopify.dev/docs/api/liquid/filters/image_tag — image_tag: auto srcset ("smart set of default widths"), auto width/height from image data, auto `loading="lazy"` below the fold.
48. https://developer.wordpress.org/cli/commands/media/regenerate/ — `wp media regenerate [<id>…] [--image_size=] [--only-missing] [--yes]` — regenerate sub-sizes per attachment or site-wide.
49. https://www.industrialempathy.com/posts/avif-webp-quality-settings/ — quality equivalence: JPEG q60 ≈ AVIF q51 ≈ WebP q64 (q50/48/55; q70/56/72; q80/64/82); at matched quality AVIF avg −36%, WebP −15% vs JPEG.
50. https://make.wordpress.org/core/2019/10/09/introducing-handling-of-big-images-in-wordpress-5-3/ — WP 5.3 big-image handling: 2560px `big_image_size_threshold`, `-scaled` derivative becomes the full-size URL, original kept under `original_image` meta.
51. https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github — Git warns >50 MiB, GitHub blocks >100 MiB, 25 MiB browser upload; repos "ideally less than 1 GB, and less than 5 GB is strongly recommended".
52. https://developers.google.com/speed/webp/docs/webp_study — WebP 25%–34% smaller than JPEG at equal SSIM across four datasets.
53. https://github.com/mozilla/mozjpeg — mozjpeg (libjpeg-turbo superset, trellis quantization); progressive + jpegrescan optimization "can be applied to any JPEG file (with jpegtran) to losslessly reduce file size".
54. https://github.com/oxipng/oxipng — oxipng: "multithreaded lossless PNG/APNG compression optimizer"; default `-o 2`; `--strip safe`; `--alpha` is technically lossy.
55. https://wordpress.org/plugins/shortpixel-image-optimiser/ — ShortPixel Image Optimizer: in-place optimization with unchanged URLs, restorable local backups, WebP/AVIF conversion, bulk background processing; 300k+ installs, v6.5.5 (2026-07-21); 100 free credits/mo, ~$9.99/mo unlimited.
56. https://shopify.dev/docs/storefronts/themes/best-practices/performance/platform — Shopify CDN platform behavior: global caching, Brotli/gzip, automatic version numbers appended to generated asset URLs (cache-busting).
57. https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-single-file/ — Cloudflare purge by URL: exact UTF-8 URLs, host case-insensitive but path case-sensitive, wildcards not supported.
