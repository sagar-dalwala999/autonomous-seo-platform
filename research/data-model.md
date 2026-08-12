# Website Understanding & Data Model (SPEC §5)

Research lane: how the platform should represent an entire website — pages, categories, products,
blog posts, topics, keywords, internal links, and their relationships — so it can answer the
questions the client lists: which pages are important, which target similar keywords, which
compete/cannibalize, which are orphaned, which get the most traffic, which have weak internal
linking, and which should receive more links. Date of research: August 2026. All prices/quotas
verified against current sources; inline citations `[n]` refer to the numbered list at the end.

---

## Summary

**Recommendation: PostgreSQL 16+ with pgvector is the single system of record for the MVP** — pages,
link edges, keywords, GSC facts, topics, and embeddings all live in one database. The link graph is
stored as a plain edge table; **graph algorithms (PageRank, HITS, depth, orphan detection, connected
components) are computed in-process in an analysis worker using `rustworkx`/`igraph`** — not in a
graph database — and the resulting scores are written back as columns on the `pages` table. Semantic
similarity (related pages, cannibalization candidates, internal-link targets, topic clustering) uses
**OpenAI `text-embedding-3-small` embeddings ($0.02/M tokens; roughly $0.30 per 10k pages)** stored
in a pgvector `halfvec` column with an HNSW index. Keyword-to-page mapping and cannibalization
detection are **plain SQL joins/aggregations over GSC query-page-day facts** pulled via the Search
Analytics API (small/medium sites) or the free GSC Bulk Export to BigQuery (large sites).
The load-bearing `page_type` column is populated by a **template-first layered classifier**
(CMS/platform ground truth → structured-data signals → learned URL rules → DOM-template
clustering → LLM labeling of *templates*, not pages) with provenance + confidence columns that
gate downstream automation — mechanism, measured accuracy anchors, and misclassification
containment in Findings §2b.

Why not the alternatives, in one line each (full analysis below):

- **MongoDB**: `$graphLookup` has a hard 100 MB per-stage memory limit with no disk spill and
  degrades exponentially with traversal depth — the worst possible fit for a link graph; and the
  workload is intensely relational (joins between crawl facts, GSC facts, and issues) [21][22].
- **Elasticsearch/OpenSearch**: adds a second data system for exactly one capability the MVP needs
  (BM25 mention-search for anchor opportunities), which Postgres covers natively (`tsvector`) or via
  ParadeDB `pg_search` at Elastic-class quality [33][34]. Defer until crawl analytics at
  100M+-row scale demands it.
- **Neo4j/Memgraph**: a real graph DB is the *right shape* for the link graph but the *wrong cost*:
  a whole-site PageRank at even 5M nodes / 69M edges takes ~10 s in-process with igraph [24] —
  a nightly batch job, not a database. Neo4j AuraDB starts at ~$65/GB/month and Memgraph
  Enterprise at ~$25k/yr [17]; both buy nothing the batch job doesn't already deliver at MVP scale.
- **Dedicated vector DBs (Qdrant/Pinecone)**: pgvector handles the MVP's vector volumes
  (10k–100k pages = 10⁴–10⁵ vectors — 3–4 orders of magnitude below pgvector's practical
  ~10M-vector comfort zone [3][7]). A separate vector DB would force cross-database joins for the
  platform's most common query pattern ("similar pages *that are indexable and in the same
  category*"), which pgvector does in one SQL statement with iterative index scans [5].

**Scale-up path** (each trigger is concrete): >5–10M vectors → add `pgvectorscale`
(StreamingDiskANN) or split vectors to Qdrant; interactive multi-hop graph queries as a *product
feature* → add Memgraph (community edition) or Neo4j; crawl-analytics UI over 100M+ row datasets →
add OpenSearch. None of these are MVP needs.

---

## Findings

### 1. What the model must answer, and what data answers it

Every question in SPEC §5 decomposes into one of three data shapes:

| Client question | Data shape that answers it | Computation |
|---|---|---|
| Which pages are important? | link graph + GSC traffic | internal PageRank × GSC clicks/impressions blend |
| Which pages target similar keywords? | GSC query-page facts + embeddings | query-set overlap (SQL) + cosine similarity |
| Which pages compete/cannibalize? | GSC query-page-day facts | per-query multi-page aggregation + position flip detection |
| Which pages are orphaned? | crawl edge set vs sitemap/GSC page set | set difference: known-pages minus link-reachable pages [26] |
| Which get the most traffic? | GSC facts | trivial SQL |
| Which have weak internal linking? | link graph | in-degree, PageRank percentile vs traffic percentile |
| Which should receive more links? | link graph + embeddings + GSC | high traffic-potential + low PageRank + semantically related source pages exist |

Nothing here requires *interactive* graph traversal at query time. Every graph question is a
**batch analytics** question over a site-sized graph (10²–10⁶ nodes), recomputed after each crawl.
This single observation drives the whole architecture: the graph is *data* (an edge table),
not a *database engine requirement*.

Industry precedent agrees: Botify and Lumar model crawl output as structured datasets exported to
BigQuery/Snowflake; OnCrawl exports to Elasticsearch — i.e., the commercial crawl-analytics leaders
treat the website model as tabular/columnar analytics data, and none of them run customer link
graphs in a graph database [40].

### 2. Core entity model (concrete schema)

One Postgres database, one schema per concern, `project_id` on every row for multi-tenancy
(compose with RLS or partitioning per the security lane):

```sql
-- The canonical page registry. One row per canonicalized URL per project.
CREATE TABLE pages (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     uuid NOT NULL,
  url            text NOT NULL,
  url_hash       bytea NOT NULL,          -- sha256(normalized url), unique per project
  canonical_id   bigint REFERENCES pages(id),
  page_type      text,                    -- 'product'|'category'|'blog'|'home'|'other' — populated by the §2b classifier
  http_status    smallint,
  indexable      boolean,
  title          text,
  meta_desc      text,
  h1             text,
  word_count     int,
  content_hash   bytea,                   -- for duplicate/near-duplicate detection
  discovered_via text[],                  -- {'crawl','sitemap','gsc','logs'}
  -- computed by the analysis worker after each crawl:
  depth          int,                     -- BFS clicks from home; NULL = unreachable by links
  inlink_count   int DEFAULT 0,
  outlink_count  int DEFAULT 0,
  pagerank       real,                    -- internal PageRank
  hub_score      real, authority_score real,  -- HITS
  is_orphan      boolean GENERATED ALWAYS AS (depth IS NULL) STORED,
  embedding      halfvec(1536),           -- pgvector; halfvec = 2 bytes/dim
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, url_hash)
);
CREATE INDEX ON pages USING hnsw (embedding halfvec_cosine_ops);

-- The link graph: one row per internal link instance.
CREATE TABLE links (
  project_id  uuid NOT NULL,
  from_id     bigint NOT NULL REFERENCES pages(id),
  to_id       bigint NOT NULL REFERENCES pages(id),
  anchor_text text,
  rel         text[],                     -- {'nofollow',...}
  placement   text,                       -- 'nav'|'footer'|'body'|'breadcrumb' (template detection)
  first_seen  timestamptz, last_seen timestamptz,
  PRIMARY KEY (project_id, from_id, to_id, anchor_text)
);
CREATE INDEX ON links (project_id, to_id);   -- who links TO a page (inlink queries)

-- GSC facts: query × page × day. THE join surface for cannibalization & opportunity.
CREATE TABLE gsc_query_page_daily (
  project_id  uuid NOT NULL,
  date        date NOT NULL,
  query       text NOT NULL,
  page_id     bigint NOT NULL REFERENCES pages(id),
  clicks      int, impressions int, ctr real, position real,
  device      text, country text,
  PRIMARY KEY (project_id, date, query, page_id, device, country)
) PARTITION BY RANGE (date);

-- Keywords as first-class entities (from GSC queries ∪ keyword APIs), clustered into topics.
CREATE TABLE keywords (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL,
  keyword text NOT NULL,
  embedding halfvec(1536),
  topic_id bigint,                        -- cluster assignment
  search_volume int, difficulty real,     -- from keyword API lane
  UNIQUE (project_id, keyword)
);

CREATE TABLE topics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL,
  label text,                             -- c-TF-IDF or LLM-generated label
  centroid halfvec(1536)
);

-- Explicit page↔keyword mapping with provenance (GSC-observed vs assigned target).
CREATE TABLE page_keywords (
  project_id uuid NOT NULL,
  page_id bigint NOT NULL,
  keyword_id bigint NOT NULL,
  source text NOT NULL,                   -- 'gsc'|'assigned'|'ai_suggested'
  is_primary_target boolean DEFAULT false,
  clicks_90d int, impressions_90d int, best_position real,
  PRIMARY KEY (project_id, page_id, keyword_id, source)
);
```

Site hierarchy (category → subcategory → product; blog → post) is representable with
`pages.parent_id` + Postgres `ltree` or a simple path column derived from URL structure and
breadcrumb markup — no document DB needed for "nesting". Raw crawl artifacts (full HTML,
rendered DOM) do **not** belong in this database; they go to object storage (S3/R2) keyed by
`content_hash`, with only extracted fields landing in Postgres (crawler lane's concern; the
interface is: crawler emits page facts + edge facts).

### 2b. The `page_type` classifier — mechanism, accuracy anchors, and misclassification containment

*(Gap-fill, Aug 2026: `page_type` was a one-word annotation in the schema above, yet it is
load-bearing across lanes — seo-detection applies word-count/thin-content thresholds to "content
templates only", the competitor lane's intent gate and schema-type expectations key off it, the
crawling lane's render-mode decisions cluster by template, and the internal-linking lane picks
sources/targets by type. This section specifies the mechanism.)*

**Taxonomy first.** SPEC §5 names Pages/Categories/Products/Blog, but a 4-way forced choice is a
design error: every production classifier in this space ships an escape hatch — Diffbot's Analyze
API classifies into ~20 types and explicitly returns **`other`** for "pages not currently supported,"
with an optional `fallback` parameter [55]; Botify's own purpose model adds listing/detail/
subdetail/API/paid-search dimensions on top of user segments [43]. Recommended enum:
`home | product | category | blog_post | blog_index | static_page | search | pagination |
legal | account_cart | other` — plus a free-text `page_subtype` for site-specific labels
("recipe", "location", "doc"). `other` must be a first-class value the downstream lanes treat as
"no template-conditional rules fire," never silently coerced into a content type.

**Signal inventory, cheapest → most expensive:**

1. **Platform ground truth (deterministic where available — use it and stop).**
   - **Shopify**: URL prefixes are hardcoded and cannot be changed on any standard plan —
     `/products/`, `/collections/`, `/pages/`, `/blogs/` "are there to stay" [51]; the theme system
     itself enumerates the exact template set (product, collection, blog, article, page, index,
     cart, search, 404, list-collections, password) with fixed paths for `/cart` and `/search` [50].
     Page-type classification on Shopify is a **lookup, not a model** — expected accuracy ≈ 100%.
   - **WordPress**: permalinks are user-configurable, so URL rules are *not* global — but two
     authoritative feeds exist without any ML: (a) the REST API `GET /wp/v2/types` publicly lists
     every registered post type (slug, `rest_base`, hierarchical) and each content object carries
     its type [56][52]; (b) core sitemaps at `/wp-sitemap.xml` are **split by object type**
     (posts, pages, custom post types, taxonomies — max 2,000 URLs per sitemap, 50,000 sitemaps
     per index), so even crawl-only access reads page type off which sub-sitemap listed the URL
     [53]. Yoast/RankMath sitemaps split the same way. Since the MVP targets Next.js + WordPress +
     Shopify (SPEC §24) and the site-modification lane already holds CMS credentials, **the two
     CMS platforms are solved by plumbing, not classification**.
2. **Structured-data / meta signals (high precision, partial coverage).** JSON-LD `@type` is a
   near-perfect label when present: `Product` ⇒ product page, `Article`/`BlogPosting` ⇒ blog,
   `CollectionPage`/`ItemList` ⇒ category. Coverage reality (Web Almanac 2024, mobile pages):
   JSON-LD on 41% of pages overall (up from 34% in 2022), but the type distribution is skewed —
   WebSite 12.73%, Organization 7.16%, BreadcrumbList 5.66%, ItemList 2.44%, **Product 0.77%,
   Article 0.18%** of *all* pages [48]. On a commerce site product-page coverage is far higher in
   practice, but it cannot be assumed: **schema presence is exactly what this platform is hired to
   fix** (SPEC §6 lists "missing schema" as a detection), so the classifier must not *depend* on
   the signal the product improves. `og:type` is nominally required by Open Graph (default
   `website`; `article` is a global type; OG present on ~64% of pages) [49][48] — useful as a
   blog-vs-other tiebreaker, too coarse alone. Same circularity caveat: treat schema/OG as
   **precision boosters, never as the recall path**.
3. **URL-pattern segmentation rules (the industry-standard workhorse).** Botify — the enterprise
   reference implementation — classifies every URL by **user-defined, first-match ordered rules**
   over url/protocol/host/path/query fields with `*` wildcards or `rx:` regex (500-char cap),
   AND implied between lines, `or()`/`not` operators, hierarchical `@pagetype` segments
   (`@parent/child`), "most specific rules first" [41][42], plus `purpose detail|listing` +
   `object product|article` flags per segment [43]. Screaming Frog v19+ segments work the same
   way but can match on *any* crawl field, including GA/GSC API data and post-crawl analysis [44].
   Two lessons transfer: (a) URL rules are **per-project configuration maintained by a human** in
   every commercial tool — none of them auto-derives it; (b) first-match ordered rules with
   wildcards are expressive enough for real enterprise sites and are trivially explainable — they
   should be our *storage format* for whatever the automatic layers learn. Accuracy ceiling of
   URL-only inference on arbitrary (non-CMS) sites, from the strongest published benchmark:
   Baykan et al. trained per-topic SVMs on URL character n-grams over 1.5M ODP pages and reached
   **macro-F 82.4 (P≈85.4 / R≈80.1)**, "typical F-measure values between 80 and 85"; ~32% of URLs
   are "empty" of token evidence for token-based variants, which n-grams reduce to ~0% [45]. Our
   task (few format buckets on *one* site with shared conventions) is easier than 15-way open-web
   topic classification, so treat ~85% as the *floor* for learned URL rules — and ~100% where the
   platform fixes the URL space (Shopify).
4. **DOM-template clustering (the recall workhorse for custom sites).** Pages generated by the same
   template share tag structure and CSS classes; the standard similarity metric combines
   **tag-sequence structural similarity** (bit-parallel Indel/LCS, or pq-gram tree profiles that
   approximate tree edit distance) with **Jaccard similarity over the set of CSS class names**,
   joined as `k·structural + (1−k)·style` — with the empirical finding that **k=0.3 works best,
   i.e. CSS-class overlap carries more template signal than tag structure** [54]. Academic
   precedent: tree-edit-distance-on-DOM + CSS-class-Jaccard clustering and DOM-tree-path
   clustering of template-generated pages [54]. Implementation: compute a cheap fingerprint per
   crawled page (MinHash of the tag sequence + the CSS-class set — both already in the crawler's
   parsed DOM, ~zero marginal cost), agglomeratively cluster per project, and materialize clusters
   as rows in a `templates` table. This is the *same* clustering the crawling lane needs for
   render-mode decisions — one shared table, two consumers. Template count per site is small
   (typically 10–100 even for a 100k-page site), which is what makes layer 5 affordable.
5. **LLM labeling — of templates, not pages.** Best current evidence on LLM web-page
   classification at scale is WebOrganizer (ICML 2025): a 24-way *format* taxonomy (including
   `Product Page`, `Content Listing` ≈ category/listing, `Personal Blog`, `News Article`,
   `Documentation`, `FAQ`, `User Review`) [46][47]. The numbers that matter: a **140M-param
   gte-base-en-v1.5 classifier distilled from Llama-3.1-405B annotations** (input `{url}\n\n{text}`,
   1M cheap-model + 80K strong-model annotations, 8k-token context) reaches **91.8% average /
   80.5% worst-group agreement** with the 405B teacher on formats (topics: 93.5/87.1); ablations:
   dropping URL features costs ~3 points (88.9), dropping 2-stage training craters worst-group
   (74.1) [46]. Two sobering calibration facts: **the 405B teacher agrees with itself only 97% on
   formats when the answer-choice ordering is shuffled** — ~3% of pages are irreducibly ambiguous
   even to a frontier-class model — and the distilled classifier adds a further ~4.4–5.1% error
   [46]. Diffbot, the longest-running commercial auto-classifier, likewise concedes it "can
   occasionally misclassify confusing pages" and recommends the type-specific API when the type is
   already known [55]. Conclusion: LLM classification is the right *fallback*, wrong *primary* —
   and it should run **once per template cluster** (send the exemplar page's URL + rendered text
   extract + nav context; get back a type + a proposed Botify-syntax URL rule), not once per page.
   At 100k pages × ~1,000 input tokens, per-page labeling burns ~100M tokens per full crawl;
   per-template labeling is O(10–100) calls per site — a ~3-orders-of-magnitude cost cut that also
   *improves* consistency, since every member of a template inherits the same label.

**Recommended mechanism — template-first cascade with provenance.** After each crawl:
(1) fingerprint + cluster pages into `templates` (layer 4); (2) label each *template* by the
highest-precision signal available: CMS API type (layer 1) → majority JSON-LD `@type` among
members (layer 2, circularity caveat noted) → matching stored URL rule (layer 3) → LLM exemplar
labeling (layer 5); (3) propagate the template label to member pages; (4) allow page-level
overrides (a page's own CMS record / JSON-LD) to beat the template vote only at higher provenance;
(5) persist every learned rule as a first-match URL-rule list the customer can inspect and edit —
the Botify segmentation-editor pattern [41], which doubles as the human-override surface SPEC §14
wants. Schema delta:

```sql
CREATE TABLE templates (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id       uuid NOT NULL,
  dom_signature    bytea,          -- MinHash(tag sequence) + CSS-class set sketch
  url_rule         text,           -- learned first-match rule, Botify syntax (e.g. path /products/*)
  exemplar_page_id bigint,
  page_type        text,
  page_type_confidence real,
  render_mode      text,           -- shared with the crawling lane's render decision
  page_count       int,
  labeled_by       text            -- 'cms_api'|'schema'|'url_rule'|'llm'|'manual'
);

ALTER TABLE pages
  ADD COLUMN template_id          bigint REFERENCES templates(id),
  ADD COLUMN page_type_source     text,   -- 'cms_api'|'schema'|'url_rule'|'template_vote'|'llm'|'manual'
  ADD COLUMN page_type_confidence real;
```

**Expected accuracy by site class (honest anchors, not promises):**

| Site class | Dominant signal | Expected page-level accuracy | Anchor |
|---|---|---|---|
| Shopify | fixed URL prefixes | ~100% (deterministic) | prefixes unchangeable [50][51] |
| WordPress w/ API or sitemaps | CMS object type | ~100% on CMS-managed URLs | `/wp/v2/types`, type-split sitemaps [56][53] |
| Custom site, clean URL conventions | learned URL rules + template vote | ~90–97% | URL-only ML floor 82.4 F on a *harder* task [45]; template voting adds DOM evidence |
| Custom site, opaque URLs (ids/hashes) | template clustering + LLM exemplar | ~85–92%, worst-group materially lower | distilled classifier 91.8 avg / 80.5 worst-group; LLM self-agreement ceiling 97% [46] |

No public benchmark exists for the exact Pages/Categories/Products/Blog split on single sites —
the numbers above are extrapolated from the two nearest published tasks [45][46]. The platform
must therefore **measure per project**: each full crawl, LLM-annotate a random ~200-page sample
against assigned labels and store the agreement rate as the project's classifier health metric;
below ~0.9, page-type-conditional automation degrades (below).

**Misclassification blast radius — what breaks downstream, and the containment rule:**

| Consumer (lane) | Uses `page_type` for | Failure if wrong | Containment |
|---|---|---|---|
| seo-detection | word-count/thin-content thresholds on content templates only | category page typed `blog_post` → "thin content" issue → AI content expansion queued on a listing template | content-expansion actions require `page_type_source ∈ {cms_api, url_rule, manual}` or confidence ≥ 0.9 |
| competitor / schema expectations | expected schema type per page type | blog post typed `product` → false "missing Product schema" → wrong JSON-LD generated | schema *additions* are MEDIUM risk (PR-gated) per SPEC §14 — never auto-applied off a low-provenance type |
| crawling | render-mode per template | template mis-clustered → JS links never rendered → false orphans → bogus internal-link actions | already Risk #4; orphan-derived actions additionally require the page's template to have a settled `render_mode` |
| internal-linking | source/target eligibility (blog→product money links, category hub logic) | links inserted from/into the wrong surface (e.g., into a paginated listing) | link insertion restricted to templates with confidence ≥ 0.9 and `page_count` ≥ N (well-attested template) |
| UI / reporting | segment rollups (Botify-style dashboards [41][44]) | misleading aggregates | cosmetic — lowest stakes, no gate |

Governing invariant: **a `page_type` error must degrade to a wasted *suggestion*, never a harmful
*auto-apply***. Concretely: `page_type_confidence` × `page_type_source` join the SPEC §14
confidence score — any auto-apply path conditional on page type multiplies in the classifier's
confidence — and **template consistency** (share of a template's members whose page-level signals
agree with the template label; healthy ≥95%) is a standing health check, with outlier pages
demoted to `other`.

**Options compared (classification mechanism only):**

| Mechanism | Coverage | Accuracy | Cost /100k pages | Explainable? | Verdict |
|---|---|---|---|---|---|
| CMS/platform ground truth | Shopify/WP (= MVP scope) | ~100% | ~0 (API/sitemap reads) | fully | **use first, always** |
| Schema/OG inference | only pages already marked up (Product on 0.77% of web pages [48]) | very high precision | ~0 | fully | booster only — circular with our own fixes |
| URL rules (manual, Botify-style) | any site | high once written; human-maintained [41] | human time | fully | storage format + override surface, not the mechanism |
| URL ML (n-gram classifier) | any site | ~82 F macro on open web [45] | tiny | partially | subsumed by learned rules + template vote |
| DOM-template clustering | any crawled site | high cluster purity; yields no type label by itself | ~0 (fingerprints from parsed DOM) | mostly | **the recall backbone** |
| Per-page LLM | any site | ≤97% ceiling; 91.8/80.5 distilled [46] | ~100M tokens/crawl | reasoning text, unstable | too costly, less consistent |
| **Template-first cascade (recommended)** | any site | ~100% CMS sites; 85–97% custom | O(10–100) LLM calls/site | rules + provenance columns | **recommended** |

### 3. Internal PageRank / page importance — compute in-process, store as columns

- The algorithm itself is 30-year-old commodity math: power iteration with damping factor 0.85,
  ~20 iterations [11]. Neo4j GDS, Memgraph MAGE, igraph, rustworkx, scikit-network all implement
  it identically.
- **Performance reality check**: on LiveJournal (4.8M nodes, 69M edges — ~50× larger than a
  100k-page site's graph), PageRank takes **10.6 s in igraph**, ~41 s in SNAP, and 2,720 s in
  pure-Python NetworkX [24]. scikit-network does Orkut (3.07M nodes, 117M edges) in 48 s [25].
  rustworkx runs 3–100× faster than NetworkX with a Python API [23].
  A 100k-page site (~10M edges at 100 links/page) computes in **seconds**. Even a 1M-page site is
  a sub-minute batch job on one worker.
- Therefore: after each crawl, the analysis worker loads the edge list
  (`SELECT from_id, to_id FROM links WHERE project_id = …` — 10M rows streams in seconds),
  builds a rustworkx digraph, and computes in one pass: PageRank, **CheiRank** (PageRank on the
  reversed graph — surfaces pages that *leak* equity, useful for "should receive more links"
  analysis [14]), HITS hub/authority [13], BFS depth from the homepage (and from all sitemap
  roots), weakly connected components, and in/out-degree. All results are bulk-written back
  (`COPY`) as columns. NetworkX is explicitly rejected as the implementation (45-minute PageRank
  at LiveJournal scale [24]).
- **Weighted importance**: raw internal PageRank treats a footer link like an in-content link.
  Weight edges by `placement` (body > breadcrumb > nav > footer) — the edge table carries
  placement, so this is a parameter of the batch job, not a schema change. Blend PageRank with
  GSC clicks/impressions percentile into a single `importance_score` so "important" reflects both
  link equity and real demand (SPEC §5 asks for both signals).

### 4. Orphan detection, depth, weak linking — set algebra, not graph magic

The industry-standard method (Screaming Frog's documented approach) is exactly a set difference:
pages known from **sitemap ∪ GSC ∪ analytics ∪ server logs** minus pages **reachable via internal
links from the crawl** — an orphan is a known page with no crawl-discovered inlink / blank crawl
depth [26]. Our model gets this for free: `discovered_via` records every discovery source, `depth`
is NULL when BFS never reached the page, and `is_orphan` is a generated column. Related detections,
each one SQL query over the same tables:

- **Deep pages**: `depth > 3` (or percentile-based) — standard "3–4 clicks from home" heuristic [26].
- **Weakly linked**: high `importance_score` or high GSC impressions but bottom-quartile
  `inlink_count`/`pagerank` — the exact "should receive more internal links" candidate set.
- **Dead-weight hubs**: high `hub_score`, low `authority_score`, low traffic (HITS [13]).
- **Disconnected clusters**: weakly-connected-component id ≠ main component.

### 5. Embedding strategy — model choice, cost, storage

**Model comparison (verified Aug 2026 prices):**

| Model | $/M tokens | Dims | Notes |
|---|---|---|---|
| OpenAI `text-embedding-3-small` | **$0.02** ($0.01 batch) | 1536 (MRL-truncatable to 512) | best price/quality mainstream option [8][9] |
| OpenAI `text-embedding-3-large` | $0.13 ($0.065 batch) | 3072 (truncatable) | +~2–3 MTEB points; 6.5× cost [8][9] |
| Google `text-embedding-005` | $0.006 | 768 | cheapest API option [10] |
| Google Gemini Embedding 2 (Mar 2026) | $0.15 | — | multimodal; overkill here [10] |
| Cohere embed v3 | $0.10 (light: $0.02) | 1024 | [9] |
| Voyage 3.5 / voyage-3-large | $0.10–0.18 | 1024–2048 | retrieval-tuned [9] |
| Self-hosted SBERT (e.g. bge/gte family) | GPU cost only | 384–1024 | free at small scale; ops burden |

**Cost per 10k pages** (title + H1–H3 + cleaned body extract, capped at ~1,500 tokens/page →
15M tokens): `3-small` ≈ **$0.30** ($0.15 via Batch API); `3-large` ≈ $1.95. Per 100k pages:
$3 / $19.50. Re-embedding only fires on `content_hash` change, so steady-state cost is a small
fraction of the initial crawl. Embedding cost is **noise** compared to the crawl and LLM-generation
lanes — do not optimize it; pick the model on quality/simplicity.

**Storage**: 1536-dim `halfvec` = ~3.1 KB/row → 10k pages ≈ 31 MB (+ HNSW index of the same order);
100k pages ≈ 310 MB + index. Trivial for Postgres. pgvector 0.8.6 supports `vector` to 16k dims
(2,000 indexable with HNSW), `halfvec` to 4,000 indexable dims, binary quantization, and
**iterative index scans** that keep filtered vector queries correct (critical: almost every
similarity query here carries `WHERE project_id = … AND indexable AND page_type = …`) [5].
Known pgvector ceilings — HNSW build wants the graph in `maintenance_work_mem` (8–16 GB for 5M ×
1536-dim), ~80–120 GB index at 10M × 1536-dim, degradation past ~10–20M vectors [3][6][7] — sit
far above MVP scale (100k pages = 0.1M vectors; even 100 customer sites × 100k pages = 10M, at
which point per-project partial indexes or the scale-up path apply).

**What gets embedded**: (a) each page (content extract); (b) each keyword/query string;
(c) optionally each candidate anchor sentence for link-insertion (deferred to the internal-linking
lane). One embedding space for pages and keywords enables direct page↔keyword similarity —
embed keywords with the same model.

### 6. Keyword-to-page mapping and cannibalization — GSC joins

**Data feed**: Search Analytics API returns query×page×device×country×day at up to 25,000
rows/request with `startRow` pagination, capped at **50,000 rows/day/site/search-type** (top rows
by clicks) [2][4]; rate limits are 1,200 QPM per site and per user [1]. 16 months of history is
available via API [4]. For large sites where 50k rows/day truncates the tail, the free **GSC Bulk
Data Export to BigQuery** ships *all* rows daily (minus privacy-filtered anonymized queries) [3b];
an ELT job then loads the site's slice into the same Postgres fact table. Same schema either way —
the ingestion path is the only difference.

**Mapping**: `page_keywords` materializes, per page, the queries it actually ranks for (rolling
90-day aggregates from the fact table). "Pages targeting similar keywords" = Jaccard overlap of
query sets (SQL) *or* page-embedding cosine similarity — run both; embedding similarity catches
pages competing on *intent* before GSC shows overlapping impressions.

**Cannibalization detector** (standard practice across SEO tooling [27][28], expressed over our
fact table):

```sql
WITH q AS (
  SELECT query, page_id,
         SUM(clicks) clicks, SUM(impressions) imps, AVG(position) pos
  FROM gsc_query_page_daily
  WHERE project_id = :p AND date >= now()::date - 90
  GROUP BY query, page_id
)
SELECT query,
       COUNT(*)                                   AS competing_pages,
       SUM(imps)                                  AS total_imps,
       MAX(clicks) FILTER (WHERE rk = 2)          AS second_page_clicks
FROM (SELECT q.*, ROW_NUMBER() OVER (PARTITION BY query ORDER BY clicks DESC) rk FROM q) t
GROUP BY query
HAVING COUNT(*) > 1
   AND MAX(clicks) FILTER (WHERE rk = 2) > 0;    -- 2nd page earns clicks ⇒ true split [27]
```

Severity scoring layers on: (a) impression share of the non-primary page(s); (b) **position
flip-flopping** — day-level rank alternation between the two URLs for the same query (windowed
stddev of which page is on top); (c) embedding similarity of the two pages (>0.9 ⇒ true duplicate
intent → merge/canonical recommendation; <0.7 ⇒ likely intentional differentiation → internal
linking/anchor fix instead). This 3-signal design is why the fact table and the vector column
must live in the same database: the whole detector is one SQL statement + one cosine operator.

### 7. Topic clustering

Standard pipeline, BERTopic-style: SBERT/API embeddings → UMAP dimensionality reduction → HDBSCAN
density clustering (auto-detects cluster count, marks noise) → c-TF-IDF for cluster labels
[29][30]. Applied twice:

- **Keyword clustering** → `topics` (keyword groups = content opportunities & target assignment).
- **Page clustering** → topical hubs; a page whose embedding is far from its own category centroid
  is a mis-siloed page; a topic with many keywords but few/no pages is a content gap (feeds the
  competitor/content lane).

At MVP scale this is a scikit-learn batch job in the same analysis worker (10k–100k embeddings
cluster in minutes on CPU). LLM-assisted labeling of clusters (send exemplar keywords to a cheap
model for a human-readable label) is a nice-to-have. SERP-overlap clustering (two keywords are
"the same topic" if their Google top-10 overlaps) is more accurate for SEO but costs SERP API
calls per keyword — defer to the keyword-intelligence lane's budget; the schema supports both
(cluster assignment is just `keywords.topic_id`).

### 8. Why each database family wins/loses (detail behind the table)

**PostgreSQL + pgvector (recommended)**
- One engine covers: relational joins (crawl × GSC × issues — the dominant query pattern), edge
  table for the graph, vectors with filtered ANN [5], JSONB for variable crawl payloads
  (structured-data blobs, per-CMS metadata), `tsvector`/`pg_trgm` full-text for "which pages
  mention phrase X" (the internal-link opportunity primitive, SPEC §11), partitioning for the GSC
  fact table, and mature multi-tenant patterns (RLS).
- Recursive CTEs handle the few *online* traversals needed (e.g., "show the shortest link path
  from home to this page" in the UI): benchmarked at 22.5K RPS vs Neo4j's 14.5K on a GraphRAG-style
  OLTP mix, and ~2× faster than Apache AGE, which adds expressiveness but not speed [18][19].
  RCTEs only choke at 10–15-hop traversals over multi-million-edge graphs [18] — which we never do
  online (depth is precomputed).
- Full-text at scale: native FTS is fine to ~10⁵ pages; ParadeDB `pg_search` (BM25 on Tantivy,
  ~20× faster ranking than `ts_rank` at 1M rows) is a drop-in extension before Elasticsearch is
  ever justified [33][34].

**MongoDB (rejected)**
- `$graphLookup` has a **100 MB per-stage memory cap with no disk spill** (`allowDiskUse` is
  ignored for this stage) and exponential frontier growth with depth; index advantage decays as
  depth increases [21][22]. Link-graph analytics is the workload it is worst at.
- The platform's core queries are joins (GSC facts × pages × links × issues). Document modeling
  buys flexibility for crawl payloads that JSONB already provides inside Postgres.
- Atlas Vector Search is competent (HNSW, 4096–8192 dims, quantization; dedicated search nodes
  from $0.12/hr) [39] — but it doesn't rescue the graph or join story.

**Elasticsearch / OpenSearch (defer)**
- Right tool for: faceted exploration of 100M+-row crawl datasets (OnCrawl's architecture [40]),
  log analytics. Wrong tool as system of record: no joins (the GSC×crawl join surface disappears),
  no graph, eventual consistency, second ops burden.
- If/when added, **OpenSearch**: Apache 2.0 under the Linux Foundation vs Elastic's
  AGPLv3/ELv2/SSPL triple license — cleaner for embedding in a commercial SaaS [31][32].

**Neo4j / Memgraph / Apache AGE (defer; only for a graph-explorer product feature)**
- Algorithms are all present and free-tier-available: Neo4j GDS Community includes PageRank,
  ArticleRank, HITS, Louvain/Leiden, WCC [11][12][13]; Memgraph MAGE is open source with the same
  set, though *dynamic/streaming* variants moved to Enterprise in v3.0 [15].
- Cost/ops: Neo4j AuraDB from ~$65/GB/month; Memgraph Enterprise from ~$25k/yr (16 GB) [17].
  Memgraph is markedly faster than Neo4j on mixed workloads (up to 132× throughput in vendor
  benchmarks [16]) and is the pick if a graph DB ever becomes necessary.
- The decisive argument stands: our graph computations are **nightly batch over site-sized
  graphs**, done in seconds by an in-process library [23][24]. A graph DB adds a data-sync
  pipeline (Postgres→graph), a second query language, and a second failure domain to replace a
  50-line worker job. Apache AGE specifically is measured *slower* than plain recursive CTEs
  (~2× cost) — expressiveness, not performance [18].

**Qdrant / Pinecone (defer; scale-up only)**
- Pricing at scale (2026): Pinecone serverless $0.33/GB storage + $8.25/1M read units + $2/1M
  write units — with metadata-filtered queries burning 5–10 RUs each, real costs run 5–10× naive
  estimates [38][37]. Qdrant Cloud is resource-priced: ~$114/mo at 1M×1536-dim (quantized),
  ~$456/mo at 10M, 32% cheaper than Pinecone at 50M ($1,824 vs $2,700/mo) [37].
- pgvector+pgvectorscale (StreamingDiskANN + statistical binary quantization) benchmarks 28× lower
  p95 latency and 16× higher throughput than Pinecone s1 at 50M vectors, at 75% lower self-hosted
  cost [35][36] — i.e., even the *scale-up* path can stay in Postgres; Qdrant is the escape hatch
  if vector traffic must be isolated from OLTP or exceeds ~100M vectors.

---

## Options compared

| Criterion | **Postgres + pgvector** | MongoDB (+Atlas Search) | Elasticsearch/OpenSearch | Neo4j / Memgraph | Qdrant / Pinecone | Pragmatic combo (PG + graph lib) |
|---|---|---|---|---|---|---|
| Relational joins (GSC×crawl×issues) | Native, excellent | Weak (`$lookup`) | None (denormalize) | Poor fit | None | Native |
| Link-graph analytics (PageRank, HITS, depth, WCC) | Edge table + batch worker | `$graphLookup`: 100 MB cap, no spill [22] | No | Native + GDS/MAGE [11][15] | No | **rustworkx/igraph: seconds at 10M edges [23][24]** |
| Online traversal (path-to-page UI) | RCTE: 22.5K RPS [19] | Poor | No | Best-in-class | No | RCTE |
| Vector similarity + filters | HNSW + iterative scans, to ~10M vectors [5][7] | HNSW, 4096–8192 dims [39] | kNN ok | Neo4j has vectors (secondary) | Best ≥100M vectors | pgvector |
| Full-text "mentions phrase X" | tsvector; pg_search BM25 20× ts_rank [33][34] | Atlas Search (Lucene) | Best-in-class | No | No | pgvector + pg_search |
| Multi-tenancy | RLS/partitioning, mature | OK | Index-per-tenant sprawl | Weak (DB-per-tenant) | Namespaces | RLS |
| Ops burden (MVP team) | **One system** | One system + weak graph | +1 cluster | +1 cluster + sync pipeline | +1 service + cross-DB joins | One system + a Python/Rust lib |
| Cost at MVP (10k–100k pages/site) | One managed PG (~$50–200/mo) | Atlas M10+ (~$60+/mo) | +$100s/mo cluster | Aura $65/GB/mo; Memgraph Ent $25k/yr [17] | $114+/mo at 1M vectors [37] | Same as PG column |
| Answers all 7 SPEC-§5 questions? | Yes (with batch worker) | No (graph) | No (joins/graph) | Graph yes; joins/facts awkward | Similarity only | **Yes** |

The last column *is* the recommendation: Postgres as the store, an in-process graph library as the
compute — they are one option, not two.

---

## Recommendation & why

**MVP stack (one concrete pick):**

1. **PostgreSQL 16/17** (managed: RDS/Cloud SQL/Neon/Supabase — per infra lane) with
   **pgvector 0.8.x** — system of record for pages, links, keywords, topics, GSC facts, issues,
   changes. Schema as in Findings §2. GSC fact table partitioned by month.
2. **Embeddings: OpenAI `text-embedding-3-small`, 1536 dims, stored as `halfvec(1536)` + HNSW
   (cosine)**. ~$0.30/10k pages ($0.15 batched); re-embed on `content_hash` change only. Rationale:
   6.5× cheaper than 3-large with near-par retrieval quality for this use case [8][9]; MRL
   truncation to 512 dims is a free storage lever if ever needed; no GPU ops vs self-hosted SBERT.
3. **Graph compute: `rustworkx` (or igraph) in the Python analysis worker**, triggered after each
   crawl: PageRank + CheiRank + HITS + BFS depth + WCC + degrees in one pass, `COPY` back to
   `pages`. Sub-minute even at 1M pages / 100M edges [23][24][25].
4. **Cannibalization/opportunity: SQL over `gsc_query_page_daily`** (Findings §6), fed by the
   Search Analytics API (25k rows/req, 50k rows/day/search-type [2][4]) and by **GSC Bulk Export →
   BigQuery → ELT into the same table** for sites that hit the 50k truncation [3b].
5. **Topic clustering: UMAP + HDBSCAN + c-TF-IDF** (BERTopic pattern) in the same worker [29][30].
6. **Mention search for link opportunities: Postgres FTS now; ParadeDB `pg_search` when ranking
   quality/scale demands BM25** [33][34].

**Why (the client's "explain your choice"):** every SPEC-§5 question reduces to either a SQL
join/aggregation, a batch graph computation, or a nearest-neighbor lookup — and the *hard* product
queries (cannibalization severity, "weakly linked but high potential", link-target suggestion)
need all three signals **in the same query**. Only Postgres puts the fact table, the edge table,
and the vectors behind one query planner. Every alternative either fails a required capability
outright (MongoDB: graph; ES: joins; vector DBs: everything but similarity) or duplicates data
into a second system to accelerate a computation that an in-process library already does in
seconds at 100× MVP scale (graph DBs). The MVP therefore ships with **one database, one worker,
zero sync pipelines** — the cheapest thing to build, operate, and reason about, with measured,
named escape hatches for each scaling dimension.

**Scale-up path (trigger → action):**
- Vectors >5–10M total (≈50–100 large customer sites): add `pgvectorscale` StreamingDiskANN
  (28× lower p95 than Pinecone s1 at 50M vectors, self-hosted [35][36]); if vector load must be
  isolated, split to **Qdrant** (resource-based pricing beats Pinecone ≥10M vectors [37]).
- Interactive graph exploration becomes a sold feature (visual link-graph explorer, ad-hoc
  multi-hop queries): add **Memgraph** community (in-memory speed, MAGE algorithms free [15][16])
  fed from the `links` table; keep Postgres canonical.
- Crawl-analytics UI over 10⁸+ rows with faceting: add **OpenSearch** (Apache 2.0 licensing is
  safer to embed in a SaaS than Elastic's triple license [31][32]) as a read-optimized projection.
- GSC facts beyond Postgres comfort (many large sites × years of daily grain): keep raw history
  in BigQuery (bulk export lands there anyway [3b]) and hold only rolling 16-month aggregates in
  Postgres.

---

## Risks & limitations

1. **GSC 50k-row/day truncation silently biases small-site analysis of long-tail queries** — the
   API returns the *top* rows by clicks [4]. Mitigation: detect truncation (row count == cap) and
   push the customer to enable Bulk Export; note anonymized queries are absent from both feeds.
2. **Internal PageRank ≠ Google's PageRank.** It's a proxy for crawl/equity flow only; footer/nav
   links must be down-weighted or hub pages dominate. Mitigation: placement-weighted edges
   (schema supports it); validate against GSC impressions correlation per site.
3. **pgvector operational cliffs are real** if the platform succeeds: HNSW builds need
   `maintenance_work_mem` sized to the graph (8–16 GB at 5M vectors), indexes don't reclaim
   deleted-row space until rebuild, and >10–20M vectors degrades [3][6][7]. The triggers above
   must be monitored, not discovered.
4. **JS-rendered links**: the link graph is only as complete as the crawler's rendering. If the
   crawler lane doesn't render JS for React/Next sites, orphan/depth analysis produces false
   positives. Contract: crawler must emit rendered-DOM link edges.
5. **Embedding drift on model deprecation**: a model swap invalidates all stored vectors
   (different space). Mitigation: version column on embeddings; re-embed is cheap (~$3/100k pages)
   but must be atomic per project.
6. **Cannibalization false positives**: brand/navigational queries legitimately surface multiple
   pages; the `second_page_clicks > 0` + flip-flop + similarity triple gate reduces but does not
   eliminate this. Human-review tier (per SPEC §14 risk model) should gate merge/canonical actions.
7. **Benchmark provenance**: several DB-comparison numbers ([16][18][19][37]) come from vendor or
   single-author benchmarks; treat them as order-of-magnitude guidance, not procurement facts.
   The MVP choice deliberately does not depend on any of them being precise.
8. **Multi-tenant blast radius**: one Postgres for all tenants means one noisy crawl import can
   affect neighbors. Mitigation: separate the ingest path (staging schema + `COPY`), per-tenant
   partitions on the big tables, and statement timeouts — details belong to the infra lane.
9. **`page_type` accuracy is unbenchmarked for our exact task.** No public benchmark covers the
   Pages/Categories/Products/Blog split on single sites; §2b's 85–97% custom-site range is
   extrapolated from adjacent tasks (URL-only open-web topic F 82.4 [45]; 24-way format classifier
   91.8% avg / 80.5% worst-group, with a 97% LLM self-agreement ceiling [46]). Mitigation is
   built into the design: per-project ~200-page audit sample each crawl, template-consistency
   monitoring (≥95% healthy), and degradation of type-conditional automation below 0.9 agreement.
10. **`page_type` misclassification cascades into actions, not just reports** — wrong word-count
    thresholds (seo-detection), wrong schema-type expectations (competitor lane), wrong render
    mode → false orphans (crawling lane). Containment is provenance gating (§2b): auto-apply
    paths conditional on page type require `cms_api`/`url_rule`/`manual` provenance or ≥0.9
    confidence, so classifier errors surface as wasted suggestions, never harmful auto-applies.
    Residual risk: the schema/OG signal is circular (the platform itself adds the markup it would
    otherwise read) — the cascade must record *when* markup was self-injected and exclude it from
    classification evidence.

---

## Sources

1. https://developers.google.com/webmaster-tools/limits — GSC API quotas (Search Analytics 1,200 QPM/site, 1,200 QPM/user)
2. https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data — Search Analytics pagination, 25k rows/request, 50k rows/day/search-type
3. https://clickhouse.com/resources/engineering/scale-vector-search-postgres — pgvector memory limits, 80–120 GB HNSW at 10M×1536, degradation thresholds
   3b. https://developers.google.com/search/blog/2023/02/bulk-data-export — GSC Bulk Data Export to BigQuery (no row limits, anonymized queries excluded)
4. https://developers.google.com/search/blog/2022/10/performance-data-deep-dive — GSC performance-data filtering and limits (50K rows/day/search-type, top by clicks)
5. https://github.com/pgvector/pgvector — pgvector 0.8.6: types (vector/halfvec/bit/sparsevec), HNSW/IVFFlat limits, iterative index scans, quantization
6. https://www.paradedb.com/learn/postgresql/pgvector-limitations — HNSW no space reclamation, build-memory requirements
7. https://www.dbi-services.com/blog/pgvector-a-guide-for-dba-part-2-indexes-update-march-2026/ — HNSW index sizing (halfvec 3072 ≈ 77 GB at 10M rows)
8. https://developers.openai.com/api/docs/pricing — OpenAI embeddings: 3-small $0.02/M, 3-large $0.13/M, 50% Batch discount
9. https://pecollective.com/tools/text-embedding-models-compared/ — embedding model specs/pricing table 2026 (OpenAI, Cohere, Voyage)
10. https://tokenmix.ai/blog/text-embedding-models-comparison — Google text-embedding-005 $0.006/M; Gemini Embedding 2 $0.15/M (Mar 2026)
11. https://neo4j.com/docs/graph-data-science/current/algorithms/page-rank/ — Neo4j GDS PageRank (damping 0.85, maxIterations 20, execution modes)
12. https://github.com/neo4j/graph-data-science — GDS Community edition includes all algorithms; OpenGDS GPLv3
13. https://www.markhneedham.com/blog/2021/02/03/neo4j-gdsl-hits-algorithm/ — HITS hub/authority in Neo4j GDS
14. https://inboundfound.com/graph-first-pagerank-cheirank/ — internal PageRank + CheiRank for SEO link-equity analysis
15. https://memgraph.com/docs/advanced-algorithms/available-algorithms — MAGE algorithm catalog (PageRank, Louvain/Leiden, WCC, betweenness, node2vec); dynamic variants Enterprise since v3.0
16. https://memgraph.com/blog/neo4j-vs-memgraph — Memgraph vs Neo4j latency/throughput comparison (vendor)
17. https://www.puppygraph.com/blog/memgraph-vs-neo4j — pricing: Memgraph Enterprise ~$25k/yr/16 GB; Neo4j AuraDB from $65/GB/mo
18. https://exobench.ai/blog/pg19-graph-queries-part-1 — Apache AGE ≈ 2× cost of recursive CTE; deep-hop RCTE failure modes
19. https://jaesolshin.com/posts/lightrag-pg-rcte/ — RCTE 22.5K RPS vs Neo4j 14.5K vs AGE 78 RPS (GraphRAG OLTP mix)
20. https://evokoa.com/blog/postgres-as-a-graph-database/ — four approaches to graphs in Postgres compared
21. https://medium.com/mongodb-performance-tuning/optimising-graph-lookups-in-mongodb-49483afb55c8 — $graphLookup depth/index behavior, frontier explosion
22. https://oneuptime.com/blog/post/2026-03-31-mongodb-what-is-graphlookup-and-when-to-use-it-in-mongodb/view — $graphLookup 100 MB per-stage limit, no disk spill
23. https://www.rustworkx.org/benchmarks.html — rustworkx 3–100× vs NetworkX, competitive with igraph/graph-tool
24. https://graph-tool.skewed.de/performance.html — PageRank on LiveJournal (4.8M/69M): igraph 10.6 s, SNAP 40.9 s, NetworkX 2,720 s
25. https://arxiv.org/pdf/2009.07660 — scikit-network: PageRank on Orkut (3.07M/117M) in 48 s
26. https://www.screamingfrog.co.uk/seo-spider/tutorials/find-orphan-pages/ — orphan detection = sitemap/GA/GSC set minus link-reachable set; blank crawl depth
27. https://n8n.io/workflows/7237-detect-cannibalized-keywords-and-competing-pages-with-google-search-console/ — cannibalization detection logic over GSC (2nd page clicks > 0)
28. https://www.advancedgsc.com/blog/keyword-cannibalization-google-search-console — GSC query×page pivot method
29. https://www.mlforseo.com/machine-learning-tutorials/topic-modeling-clustering/topic-modeling-for-seo-with-bertopic/ — BERTopic for SEO keyword/topic clustering
30. https://www.emergentmind.com/topics/bertopic-model — BERTopic pipeline: SBERT → UMAP → HDBSCAN → c-TF-IDF
31. https://pulse.support/kb/opensearch-vs-elasticsearch — licensing history: Elastic AGPLv3/ELv2/SSPL vs OpenSearch Apache 2.0
32. https://bigdataboutique.com/blog/opensearch-vs-elasticsearch-compared — 2026 comparison, Linux Foundation governance
33. https://www.paradedb.com/blog/elasticsearch-vs-postgres — pg_search (BM25/Tantivy) as Elasticsearch alternative in Postgres
34. https://www.tigerdata.com/blog/you-dont-need-elasticsearch-bm25-is-now-in-postgres — BM25-in-Postgres landscape (pg_search ~20× ts_rank at 1M rows; pg_textsearch)
35. https://github.com/timescale/pgvectorscale — StreamingDiskANN + statistical binary quantization
36. https://www.tigerdata.com/blog/pgvector-is-now-as-fast-as-pinecone-at-75-less-cost — 50M-vector benchmark: 28× lower p95, 16× throughput vs Pinecone s1, 75% cheaper
37. https://leanopstech.com/blog/qdrant-cloud-pricing-2026/ — Qdrant vs Pinecone cost curves ($114/mo @1M, $456 @10M, 32% saving @50M)
38. https://spendark.com/blog/vector-database-pricing/ — Pinecone serverless units ($0.33/GB, $8.25/1M RU, $2/1M WU; filtered queries 5–10 RU)
39. https://www.mongodb.com/products/platform/atlas-vector-search + https://www.modern-datatools.com/tools/mongodb-atlas-vector-search/pricing — Atlas Vector Search dims/quantization/search-node pricing
40. https://www.revolveagency.co.uk/post/enterprise-seo-tools-ranked-by-crawl-depth-and-data-export-flexibility — Botify/Lumar native BigQuery; OnCrawl Elasticsearch export architecture
41. https://support.botify.com/en/articles/9108591-segmentation-overview — Botify segmentation: user-defined URL rules, hierarchical segments/subsegments, manual configuration
42. https://support.botify.com/en/articles/9108594-segmentation-syntax-reference — rule syntax: url/protocol/host/path/query selectors, `*` wildcards, `rx:` regex (500-char cap), first-match ordering, `or()`/`not`
43. https://support.botify.com/en/articles/10518472-classifying-pages-by-purpose — `purpose detail|listing|subdetail` + `object product|article` flags on segments (URL-rule based, no ML)
44. https://www.screamingfrog.co.uk/blog/seo-spider-19/ — Screaming Frog v19 Segments: segment on any crawl/API/post-crawl data; segments bar, per-segment issue rollups
45. https://ingmarweber.de/wp-content/uploads/2013/07/Purely-URL-based-topic-classification.pdf — Baykan, Henzinger, Marian, Weber (WWW 2009): URL-only SVM all-grams, macro-F 82.4 / P 85.4 / R 80.1 over 15 ODP topics; token "empty-URL" rate 32% vs ~0% for n-grams
46. https://arxiv.org/abs/2502.10341 — WebOrganizer (ICML 2025): 24-topic + 24-format taxonomies; gte-base-en-v1.5 (140M) distilled from Llama-3.1-405B; formats 91.8 avg / 80.5 worst-group agreement, −3 pts w/o URL features; 405B self-agreement only 97% under choice reordering (Table 7, App. B)
47. https://huggingface.co/WebOrganizer/FormatClassifier — the 24 format categories (incl. Product Page, Content Listing, Personal Blog, News Article); input format `{url} {text}`
48. https://almanac.httparchive.org/en/2024/structured-data — Web Almanac 2024: JSON-LD on 41% of pages (34% in 2022); JSON-LD types on mobile: WebSite 12.73%, Organization 7.16%, BreadcrumbList 5.66%, ItemList 2.44%, Product 0.77%, Article 0.18%; OG ~64%
49. https://ogp.me/ — og:type required property; default "any non-marked up webpage should be treated as og:type website"; global types article/book/profile/website
50. https://shopify.dev/docs/storefronts/themes/architecture/templates — Shopify fixed template set (product, collection, blog, article, page, index, cart, search, 404, list-collections, password); fixed paths /cart, /search
51. https://logeix.com/shopify-seo/url-structure — Shopify /products/, /collections/, /pages/, /blogs/ prefixes are hardcoded and cannot be removed on standard plans
52. https://developer.wordpress.org/themes/basics/template-hierarchy/ — WordPress page-type template hierarchy (single-{post-type}, page, category/tag/custom-post-type archives, front page)
53. https://make.wordpress.org/core/2020/07/22/new-xml-sitemaps-functionality-in-wordpress-5-5/ — core /wp-sitemap.xml index split by object type (posts, pages, CPTs, taxonomies, users); 2,000 URLs/sitemap, 50,000 sitemaps/index
54. https://github.com/matiskay/html-similarity — structural (tag-sequence Indel/LCS, pq-gram) + style (CSS-class Jaccard) similarity; combined `k·structural+(1−k)·style`, empirical k=0.3 (style carries more template signal)
55. https://www.diffbot.com/docs/extract/analyze — Diffbot Analyze API: ML page-type classification (~20 types incl. article, product, discussion, image, video, event, list); returns `other` when unsupported; `fallback` param; "can occasionally misclassify confusing pages"
56. https://developer.wordpress.org/rest-api/reference/post-types/ — public `GET /wp/v2/types` lists all registered post types (slug, rest_base, hierarchical, taxonomies)
