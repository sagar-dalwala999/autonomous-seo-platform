
---

# 1. Overall plan for Points 1–10

I would divide the work into **7 major phases**:

```text
PHASE 0
Product + Technical Foundation
        ↓
PHASE 1
Crawling & URL Discovery
        ↓
PHASE 2
Website Data Model / Site Understanding
        ↓
PHASE 3
Technical SEO Detection
        ↓
PHASE 4
GSC + Keyword Intelligence
        ↓
PHASE 5
Competitor / SERP Intelligence
        ↓
PHASE 6
AI SEO Optimization Foundation
        ↓
FINAL
Points 1–10 Research + POCs + Decisions
```

But there is an important dependency:

```text
Crawler
   ↓
Website Model
   ↓
SEO Detection
   ↓
GSC
   ↓
Keyword Intelligence
   ↓
Competitor Analysis
   ↓
AI Optimization
```

So although the PDF numbers AI as Point 7, **we should not make Point 7 the first thing we implement**.

---

# 2. What we should have at the end

Before moving to Point 11, I want us to have this:

```text
                    WEBSITE
                       │
                       ▼
                ┌─────────────┐
                │ SITE CONFIG │
                └──────┬──────┘
                       │
                       ▼
              ┌─────────────────┐
              │ URL DISCOVERY   │
              └────────┬────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
     Sitemap        robots.txt     HTML Links
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                URL NORMALIZER
                       │
                       ▼
                 DEDUPLICATOR
                       │
                       ▼
                 CRAWL QUEUE
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
     HTTP CRAWLER             JS RENDERER
          │                    Playwright
          └────────────┬────────────┘
                       ▼
                 PAGE EXTRACTOR
                       │
                       ▼
                PAGE SNAPSHOT
                       │
                       ▼
              WEBSITE KNOWLEDGE
                       │
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
      SEO RULES       GSC          KEYWORDS
          │            │             │
          └────────────┼─────────────┘
                       ▼
                OPPORTUNITY ENGINE
                       │
                       ▼
              COMPETITOR ANALYSIS
                       │
                       ▼
                 AI CONTEXT
                       │
                       ▼
               SEO OPPORTUNITIES
```

That is our **Point 1–10 foundation**.

---

# 3. PHASE 0 — Product and technical foundation

Before writing crawler code, we need to define the contracts.

This is where most teams make a mistake. They start with:

```text
Playwright → scrape HTML → save JSON
```

That will eventually become extremely difficult to scale.

We should first define the data and workflow contracts.

---

## Task 0.1 — Define the website/project model

Create:

```text
Project
 ├── project_id
 ├── domain
 ├── protocol
 ├── allowed_domains
 ├── allowed_paths
 ├── excluded_paths
 ├── crawl_configuration
 ├── crawl_frequency
 ├── GSC connection
 ├── keyword configuration
 └── competitor configuration
```

Example:

```json
{
  "projectId": "project_001",
  "domain": "example.com",
  "startUrls": [
    "https://example.com/"
  ],
  "allowedHosts": [
    "example.com"
  ],
  "crawlMode": "full",
  "respectRobots": true
}
```

---

# 4. Task 0.2 — Define what "crawl complete" means

This is **very important**.

Instead of saying:

> "Crawler scraped everything."

we need a measurable definition.

I suggest:

### Crawl coverage

```text
Discovered URLs
        ↓
Normalized URLs
        ↓
Allowed URLs
        ↓
Attempted URLs
        ↓
Successfully fetched URLs
        ↓
Successfully parsed URLs
```

Then calculate:

### URL discovery coverage

```text
attempted_discoverable_urls
/
known_discoverable_urls
```

But we also need multiple discovery sources.

---

# 5. Our crawler must have multiple URL discovery mechanisms

This is the first major architectural requirement.

We should NOT rely only on `<a href>`.

The crawler should discover URLs from:

### Source 1 — Initial URL

```text
https://example.com
```

### Source 2 — robots.txt

```text
https://example.com/robots.txt
```

### Source 3 — Sitemap

```text
/sitemap.xml
/sitemap_index.xml
```

### Source 4 — HTML links

```html
<a href="/products/foo">
```

### Source 5 — Canonical

```html
<link rel="canonical" href="...">
```

Canonical is primarily a signal to record, not blindly a crawl frontier source.

### Source 6 — hreflang

```html
<link rel="alternate" hreflang="en" ...>
```

### Source 7 — Structured data

For example:

```json
{
  "@type": "Product",
  "url": "https://example.com/product/1"
}
```

### Source 8 — OpenGraph / metadata

Where useful.

### Source 9 — JavaScript-generated URLs

For JavaScript-heavy sites, browser/network observation can expose requests and resources that don't appear in the initial HTML. Playwright supports monitoring browser requests and responses, which is useful for this layer. ([Playwright][1])

### Source 10 — Optional external sources

Later:

* GSC URLs
* Bing URLs
* manually uploaded URL list
* Google indexing data
* API-provided URLs

This becomes extremely important when identifying **orphan pages**.

---

# 6. PHASE 1 — Build the crawler

This is the most important part of Points 1–10.

## Task 1.1 — Research crawler technologies

We should create a formal comparison:

| Requirement        |         Crawlee | Playwright | Puppeteer |    Custom |
| ------------------ | --------------: | ---------: | --------: | --------: |
| URL queue          |          Strong |     Custom |    Custom |    Custom |
| Recursive crawling |          Strong |     Custom |    Custom |    Custom |
| JS rendering       | Via integration |  Excellent | Excellent | Difficult |
| Retry handling     |        Built-in |     Custom |    Custom |    Custom |
| Deduplication      |          Strong |     Custom |    Custom |    Custom |
| Parallelism        |          Strong |     Custom |    Custom |    Custom |
| Large sites        |          Strong |     Medium |    Medium |   Depends |
| Development effort |      Low/Medium |     Medium |    Medium | Very High |

Crawlee's `RequestQueue` is specifically designed for recursive crawling and maintains unique requests using request keys. ([Crawlee][2])

Crawlee also provides a Playwright crawler that combines its crawling infrastructure with browser-based JavaScript execution. Its documentation specifically distinguishes browser crawling from raw HTTP crawling, noting that non-JavaScript pages can be crawled much faster without a browser. ([Crawlee][3])

### Preliminary direction

I would currently investigate:

> **Crawlee as the crawling/orchestration layer + HTTP crawler as default + Playwright as a rendering fallback.**

Not:

> Playwright for every URL.

That distinction will have a major impact on cost and throughput.

---

# 7. Task 1.2 — URL normalization

Every discovered URL must pass through:

```text
URL
 ↓
Parse
 ↓
Normalize
 ↓
Validate
 ↓
Scope check
 ↓
Deduplicate
 ↓
Queue
```

Normalization should consider:

* HTTP → HTTPS policy
* hostname casing
* trailing slash
* fragments
* default ports
* percent encoding
* duplicate query parameters
* tracking parameters
* URL encoding
* punycode/IDN
* relative URLs
* protocol-relative URLs

Example:

```text
https://example.com/page
https://example.com/page/
https://EXAMPLE.com/page
https://example.com/page#section
```

must be handled according to a defined canonicalization policy.

---

# 8. Task 1.3 — Query parameter strategy

This is a huge problem on e-commerce websites.

Example:

```text
/products
/products?color=red
/products?color=blue
/products?sort=price
/products?sort=price&color=red
/products?utm_source=facebook
```

If we blindly crawl everything:

```text
10,000 pages
        ↓
potentially millions of URLs
```

So we need a parameter policy.

### Categorize parameters

```text
Tracking
utm_*
fbclid
gclid

Pagination
page
offset

Sorting
sort
order

Filtering
color
size
category

Functional
search
query
```

Each parameter gets a policy:

```text
IGNORE
NORMALIZE
CRAWL
CRAWL WITH LIMIT
```

This must be configurable per project.

---

# 9. Task 1.4 — Crawl scope

We need explicit scope rules.

For example:

```text
Allowed:
example.com

Not allowed:
facebook.com
youtube.com
google.com
cdn.example.com
```

But we should distinguish:

### Same-origin

```text
example.com
```

### Subdomain

```text
blog.example.com
shop.example.com
```

### External

```text
youtube.com
```

The user should be able to configure:

```text
crawlSubdomains: true/false
```

because different businesses will need different behavior.

---

# 10. Task 1.5 — robots.txt

We should retrieve and parse:

```text
/robots.txt
```

and preserve the raw file plus parsed directives.

Robots.txt is standardized under the Robots Exclusion Protocol, and Google documents it as a mechanism that expresses crawler access preferences. ([Google for Developers][4])

Important distinction:

> **Our crawler's behavior and Google's indexing behavior are not the same thing.**

So we should record:

```text
robotsAllowedForOurCrawler
robotsDisallowed
sitemapDeclarations
```

and separately analyze whether the robots configuration creates an SEO problem.

---

# 11. Task 1.6 — Sitemap discovery

Try:

```text
/robots.txt
```

Then parse:

```text
Sitemap:
https://example.com/sitemap.xml
```

Also try configured/common sitemap locations.

We need support:

```text
sitemap.xml
sitemap-index.xml
sitemap_index.xml
```

and sitemap indexes.

Google's current sitemap documentation states that individual sitemap files are limited to 50 MB uncompressed or 50,000 URLs, with sitemap indexes used to split larger sites. ([Google for Developers][5])

So our crawler needs to support:

```text
Sitemap Index
      ↓
Sitemap 1
Sitemap 2
Sitemap 3
...
      ↓
URL Frontier
```

---

# 12. Task 1.7 — HTTP crawler

Default flow:

```text
URL
 ↓
HTTP request
 ↓
Response
 ↓
Status
 ↓
Headers
 ↓
HTML
 ↓
Parser
```

Collect:

* status code
* final URL
* redirect chain
* response headers
* content type
* content length
* response time
* cache headers
* compression
* HTML
* server information where available
* robots headers
* X-Robots-Tag

This should be the **cheap path**.

---

# 13. Task 1.8 — Playwright rendering fallback

We should not browser-render everything.

Instead:

```text
HTTP fetch
    ↓
Is HTML sufficient?
    │
 ┌──┴──┐
NO    YES
│      │
▼      ▼
Playwright  Parse
```

Possible reasons for rendering:

* extremely thin HTML
* known SPA
* important content loaded after JavaScript
* significant DOM changes
* links generated dynamically
* client-side routing
* structured data inserted dynamically

Playwright gives us browser page navigation and network observation capabilities, which makes it suitable for this fallback layer. ([Playwright][1])

---

# 14. Task 1.9 — Dynamic URL discovery

When Playwright is used, collect:

```text
DOM links
+
network requests
+
navigation events
+
history changes
```

But we should **not blindly enqueue every network request**.

For example:

```text
analytics.google.com
facebook.com/tr
cdn.example.com
api.example.com
```

are not necessarily crawlable pages.

So classify discovered URLs:

```text
HTML page
API
Image
JS
CSS
Font
Tracking
Video
Other
```

Only enqueue relevant page-like resources.

---

# 15. Task 1.10 — Redirect handling

For every URL:

```text
A
 ↓ 301
B
 ↓ 302
C
 ↓ 200
```

we store:

```json
{
  "requestedUrl": "A",
  "finalUrl": "C",
  "chain": [
    {"url": "A", "status": 301},
    {"url": "B", "status": 302},
    {"url": "C", "status": 200}
  ]
}
```

This directly supports Point 6 later.

---

# 16. Task 1.11 — Retry strategy

Not every failure is a page failure.

Classify:

```text
DNS failure
Timeout
Connection reset
429
403
500
502
503
504
Invalid SSL
Browser crash
Parsing error
```

Then define:

```text
Retry
Don't retry
Retry with browser
Retry later
Mark blocked
```

For example:

```text
500 → retry
502 → retry
503 → retry
429 → retry with backoff
404 → don't retry repeatedly
403 → mark access restricted
```

---

# 17. Task 1.12 — Rate limiting

We need domain-aware controls:

```text
requests per second
concurrent requests
browser concurrency
per-host concurrency
retry backoff
```

This is important both ethically and operationally.

We don't want:

```text
500 browser tabs
      ↓
customer website
      ↓
server overload
```

---

# 18. Task 1.13 — Crawl priority

Not every URL is equally important.

Potential priority:

```text
Homepage
 ↓
Sitemap URLs
 ↓
Navigation pages
 ↓
High-depth pages
 ↓
Other discovered pages
```

Later we can incorporate:

```text
GSC traffic
GSC impressions
internal link count
page type
```

to prioritize important pages.

---

# 19. Task 1.14 — Infinite crawl protection

This is mandatory.

We need protection against:

```text
calendar pages
faceted navigation
search URLs
session URLs
infinite pagination
URL-generated states
```

Example:

```text
/calendar/2026/01
/calendar/2026/02
/calendar/2026/03
...
```

We need:

* maximum depth
* maximum URLs
* parameter policies
* duplicate detection
* pagination detection
* URL pattern detection
* per-path limits
* crawl budget

But these should be **safety limits**, not the primary mechanism for completeness.

---

# 20. Task 1.15 — Crawl storage

Every crawl should create a crawl session:

```text
crawl
 ├── crawl_id
 ├── project_id
 ├── started_at
 ├── finished_at
 ├── status
 ├── discovered_count
 ├── queued_count
 ├── crawled_count
 ├── failed_count
 ├── blocked_count
 └── coverage
```

And each page should have a crawl result.

---

# 21. What "page data" should we collect?

This is where we need to be extremely thorough.

For every HTML page:

### Identity

```text
requested URL
final URL
canonical URL
URL hash
crawl timestamp
```

### HTTP

```text
status
redirects
content type
response headers
response size
response time
```

### Meta

```text
title
meta description
robots
viewport
canonical
hreflang
OpenGraph
Twitter cards
```

### Headings

```text
H1
H2
H3
H4
...
```

### Content

```text
raw HTML
clean text
word count
language
content hash
text hash
```

### Links

```text
internal
external
nofollow
sponsored
ugc
anchor
target
```

### Images

```text
src
alt
width
height
format
lazy loading
```

### Structured data

```text
JSON-LD
Microdata
RDFa
schema types
schema properties
```

### Page relationships

```text
incoming links
outgoing links
depth
parent
discovery source
```

### Technical

```text
robots
noindex
canonical
status
redirects
sitemap presence
```

### Rendering

```text
SSR/CSR indicators
JS-required
rendered HTML
DOM size
```

This directly covers the crawler requirements specified in the PDF. 

---

# 22. Crawl completeness must be measurable

This is something I would add to the proposal even though the PDF doesn't explicitly define the metric.

For every crawl, produce:

```text
Discovered URLs       12,420
Allowed URLs          11,980
Attempted URLs        11,950
Successful            11,720
Failed                180
Blocked               50
```

Then:

### Crawl completion

```text
11,950 / 11,980 = 99.75%
```

But that's not enough.

We also need:

### Discovery source coverage

```text
Sitemap URLs
HTML URLs
GSC URLs
Canonical URLs
hreflang URLs
JS-discovered URLs
```

### Failure classification

```text
HTTP failures
Access blocked
Timeout
Rendering failure
Parsing failure
Unsupported resource
```

This lets us tell the user:

> "We crawled 99.7% of all URLs discovered through the configured discovery sources. 18 URLs were blocked by access restrictions and 12 timed out."

That is much more trustworthy than saying:

> "Crawl completed."

---

# 23. PHASE 2 — Website Understanding

Once crawler output exists, we build the **Website Knowledge Model**.

This is Point 5.

The PDF explicitly says we should understand relationships between websites, pages, categories, products, blogs, topics, keywords and internal links. 

---

# 24. Task 2.1 — Page entity

Define:

```text
Page
 ├── identity
 ├── URL
 ├── content
 ├── metadata
 ├── technical SEO
 ├── links
 ├── structured data
 ├── performance signals
 ├── keywords
 ├── GSC metrics
 └── embeddings
```

---

# 25. Task 2.2 — Page relationships

We need relationships like:

```text
Page A
 ├── LINKS_TO → Page B
 ├── SIMILAR_TO → Page C
 ├── COMPETES_WITH → Page D
 ├── TARGETS → Keyword X
 ├── BELONGS_TO → Category
 └── RELATED_TO → Topic
```

This is where the system starts becoming an actual **SEO knowledge system**, rather than a crawler.

---

# 26. Task 2.3 — Page type classification

We need to automatically determine:

```text
homepage
category
product
blog
article
service
landing page
documentation
author
tag
search
unknown
```

Initially this can use:

```text
URL patterns
HTML structure
schema.org
breadcrumbs
navigation
content patterns
```

AI can improve classification later.

---

# 27. Task 2.4 — Duplicate detection

We need multiple types:

### Exact duplicate

```text
content hash
```

### Near duplicate

```text
similarity
```

### Metadata duplicate

```text
same title
same description
```

### Keyword cannibalization

```text
multiple pages
        ↓
same keyword
        ↓
similar intent
```

These are different problems and should not be combined into one "duplicate" field.

---

# 28. Task 2.5 — Internal-link graph

Build:

```text
Page A
  ↓
Page B
  ↓
Page C
```

with metadata:

```text
source
target
anchor
nofollow
position
link type
```

Then calculate:

* inbound links
* outbound links
* depth
* orphan status
* highly connected pages
* weakly linked pages

This becomes the foundation for Point 11 later.

---

# 29. Database research

For Point 5, we should **not decide immediately that we need five databases**.

The candidates are:

```text
PostgreSQL
MongoDB
OpenSearch
Graph DB
Vector DB
```

I would first prototype the workload.

A very strong candidate for the initial architecture is:

```text
PostgreSQL
   +
JSONB
   +
pgvector
   +
object storage
```

because PostgreSQL's JSONB supports indexed/queryable JSON data, and pgvector provides vector similarity search directly in PostgreSQL. ([PostgreSQL][6])

But that is a **hypothesis**, not our final decision.

We'll benchmark whether we actually need:

```text
Neo4j
OpenSearch
Qdrant
```

instead.

This is important because unnecessary infrastructure creates operational complexity.

---

# 30. PHASE 3 — Point 6: Technical SEO Engine

Now that we have normalized pages, we can implement deterministic rules.

Architecture:

```text
Page Snapshot
      ↓
Normalizer
      ↓
SEO Rule Engine
      ↓
Issues
      ↓
Severity
      ↓
Evidence
      ↓
Suggested Fix
```

---

# 31. Break Point 6 into rule families

### Indexing

* noindex
* robots blocked
* canonical
* indexability

### URL

* HTTP
* HTTPS
* www/non-www
* duplicate URL
* query duplication

### Status

* 200
* 301
* 302
* 404
* 410
* 5xx
* redirect loop
* redirect chain

### Metadata

* missing title
* duplicate title
* title length
* missing description
* duplicate description

### Headings

* missing H1
* multiple H1
* hierarchy issues

### Links

* broken internal
* broken external
* orphan
* excessive links
* weak internal linking

### Images

* missing alt
* dimensions
* large files
* unsupported formats

### Schema

* missing
* invalid JSON-LD
* invalid properties
* incorrect type

This matches the categories explicitly required in Point 6. 

---

# 32. Every SEO rule needs a contract

For example:

```json
{
  "ruleId": "TITLE_MISSING",
  "severity": "MEDIUM",
  "category": "ON_PAGE",
  "condition": "...",
  "evidence": "...",
  "recommendation": "...",
  "autoFixable": true
}
```

This is important because later the AI should **consume rule results**, not reinvent basic SEO detection.

---

# 33. PHASE 4 — Point 9: GSC

GSC should be implemented as a separate ingestion system.

Google's Search Analytics API supports dimensions including query, page, country and device and allows filtered date-range analysis. ([Google for Developers][7])

Architecture:

```text
Google OAuth
     ↓
GSC Property
     ↓
Initial Historical Sync
     ↓
Normalization
     ↓
Database
     ↓
Daily Incremental Sync
```

---

# 34. GSC data model

We should store:

```text
date
property
page
query
country
device
clicks
impressions
ctr
position
```

Then build aggregated views:

```text
Page performance
Keyword performance
Country performance
Device performance
```

---

# 35. GSC sync strategy

Don't make every feature call GSC.

Instead:

```text
GSC
 ↓
Ingestion Service
 ↓
Our Database
 ↓
SEO Engine
```

Then:

```text
AI → Our Database
Competitor Engine → Our Database
Opportunity Engine → Our Database
Dashboard → Our Database
```

This gives us historical analysis.

---

# 36. PHASE 5 — Point 8: Keyword Intelligence

Now we can combine:

```text
Website keywords
+
GSC keywords
+
SERP data
+
Competitor keywords
```

Initially, GSC is our most direct first-party source.

---

# 37. Keyword extraction

For each page:

```text
Page
 ↓
Existing content
 ↓
Title
 ↓
H1/H2
 ↓
GSC queries
 ↓
Extract keyword candidates
```

Store:

```text
keyword
page
impressions
clicks
CTR
position
intent
relevance
```

---

# 38. Keyword opportunity scoring

We need a formal scoring model.

Potential inputs:

```text
Search impressions
Current position
CTR
CTR gap
Business relevance
Page relevance
Competition
Trend
Conversion value
```

For example:

```text
Opportunity Score
=
Demand
×
Ranking Potential
×
CTR Opportunity
×
Business Relevance
×
Confidence
```

But we should not finalize the mathematical formula before testing it against real datasets.

---

# 39. Important opportunity categories

The engine should detect:

### Almost-ranking opportunity

```text
Position 5–20
High impressions
Low CTR
```

### CTR opportunity

```text
Good position
Low CTR
```

### Content decay

```text
Previous performance
        ↓
Current performance
        ↓
Significant deterioration
```

### Untargeted keyword

```text
Query exists in GSC
        ↓
No strong page target
```

### Cannibalization

```text
Keyword
 ↓
Page A
Page B
Page C
```

### Content gap

```text
Competitors cover topic
        ↓
Our site doesn't
```

---

# 40. PHASE 6 — Point 10: Competitor Analysis

This should not start with AI.

First:

```text
Target keyword
      ↓
SERP provider
      ↓
Top relevant results
      ↓
Competitor URLs
      ↓
Crawler
      ↓
Competitor page model
```

Then compare:

```text
Title
H1
H2
Content
Entities
Questions
Schema
Internal links
Content depth
```

which directly follows the PDF requirement. 

---

# 41. Competitor analysis pipeline

```text
OUR PAGE
   │
   ▼
Target Keyword
   │
   ▼
SERP
   │
   ├── Competitor 1
   ├── Competitor 2
   ├── Competitor 3
   ├── Competitor 4
   └── Competitor 5
            │
            ▼
       Crawl/Extract
            │
            ▼
       Normalize
            │
            ▼
       Compare
            │
            ▼
       Gap Detection
            │
            ▼
       Opportunity
```

---

# 42. Do not equate competitor differences with opportunities

This is a very important product rule.

Suppose:

```text
Competitor A has 4,000 words.
Our page has 1,500.
```

That doesn't mean:

> "Generate 2,500 more words."

Instead:

```text
Competitor topics
        ↓
Our topics
        ↓
Missing concepts
        ↓
Search intent
        ↓
Business relevance
        ↓
Genuine content gap?
```

Only then should it become an opportunity.

---

# 43. Where Point 7 — AI — fits

Although Point 7 appears early in the PDF, I would implement the **AI foundation after we have enough structured data**.

The AI should receive:

```text
Page
+
SEO issues
+
GSC
+
Keywords
+
Competitor analysis
+
Website context
```

and return:

```json
{
  "action": "UPDATE_TITLE",
  "target": "...",
  "oldValue": "...",
  "newValue": "...",
  "reason": "...",
  "confidence": 0.94,
  "risk": "LOW"
}
```

The PDF explicitly proposes this structured-action approach. 

The important architectural principle is:

> **AI proposes actions; deterministic systems decide whether the action is valid and safe.**

---

# 44. Final dependency graph for Points 1–10

This is the part I would actually give to the development team.

```text
                    PHASE 0
              Project / Site Setup
                       │
                       ▼
                Crawl Configuration
                       │
                       ▼
              ┌───────────────────┐
              │ URL DISCOVERY     │
              │ Sitemap           │
              │ Robots            │
              │ HTML Links        │
              │ JS Links          │
              └─────────┬─────────┘
                        │
                        ▼
                 URL NORMALIZER
                        │
                        ▼
                  URL DEDUPE
                        │
                        ▼
                  CRAWL QUEUE
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
        HTTP CRAWLER         PLAYWRIGHT
             │                     │
             └──────────┬──────────┘
                        ▼
                  PAGE EXTRACTOR
                        │
                        ▼
                 PAGE SNAPSHOT
                        │
                        ▼
              WEBSITE KNOWLEDGE MODEL
                        │
          ┌─────────────┼──────────────┐
          ▼             ▼              ▼
       SEO RULES       LINKS        CONTENT
          │             │              │
          └─────────────┼──────────────┘
                        ▼
                  GSC INGESTION
                        │
                        ▼
                KEYWORD ENGINE
                        │
                        ▼
                 SERP ENGINE
                        │
                        ▼
              COMPETITOR ANALYSIS
                        │
                        ▼
                OPPORTUNITY ENGINE
                        │
                        ▼
                   AI ENGINE
```

---

# 45. Exact task breakdown

I would create the project backlog approximately like this.

## EPIC 0 — Research & Architecture

### 0.1 Requirement analysis

* Extract requirements 1–10
* Define acceptance criteria
* Define dependencies
* Identify unknowns

### 0.2 Technology research

* Crawlee
* Playwright
* Puppeteer
* HTTP crawling
* PostgreSQL
* MongoDB
* OpenSearch
* Graph DB
* Vector DB

### 0.3 Architecture design

* Service boundaries
* Data flow
* Crawl flow
* Storage model

### 0.4 POC strategy

* crawler POC
* storage POC
* SEO rule POC
* GSC POC
* SERP POC

---

# EPIC 1 — Project / Website Management

### Tasks

```text
Create project
Add domain
Validate domain
Configure crawl
Configure scope
Configure exclusions
Configure crawl limits
Start crawl
Stop crawl
Resume crawl
View crawl status
```

### Acceptance criteria

A user can:

```text
Create project
      ↓
Enter URL
      ↓
Configure crawl
      ↓
Start crawl
      ↓
Track progress
```

---

# EPIC 2 — URL Discovery

### Tasks

```text
Initial URL discovery
robots discovery
sitemap discovery
sitemap index parser
HTML link extraction
canonical extraction
hreflang extraction
structured data URL extraction
JS navigation discovery
URL source tracking
```

### Acceptance criteria

For every URL we know:

```text
where it came from
```

Example:

```text
/product/123

Sources:
✓ sitemap
✓ HTML link
✓ GSC
```

---

# EPIC 3 — URL Processing

### Tasks

```text
URL normalization
URL validation
scope validation
parameter filtering
fragment removal
duplicate detection
unique URL key
crawl priority
crawl depth
```

---

# EPIC 4 — Crawler

### Tasks

```text
HTTP crawler
HTTP retry
redirect handling
response capture
HTML parser
Playwright fallback
browser retry
JS extraction
network observation
resource classification
```

---

# EPIC 5 — Crawl Safety

### Tasks

```text
robots policy
rate limiting
concurrency control
timeout
retry backoff
infinite crawl protection
URL limits
domain limits
path limits
parameter limits
```

---

# EPIC 6 — Crawl Storage

### Tasks

```text
crawl session
crawl request
crawl result
page snapshot
redirect record
resource record
failure record
discovery source
crawl statistics
```

---

# EPIC 7 — Website Knowledge Model

### Tasks

```text
page entity
site entity
link entity
keyword entity
topic entity
page type
page relationships
internal-link graph
duplicate detection
content hashing
semantic representation
```

---

# EPIC 8 — Technical SEO Engine

### Tasks

```text
indexability rules
status rules
redirect rules
canonical rules
robots rules
sitemap rules
metadata rules
heading rules
link rules
image rules
schema rules
duplicate rules
orphan rules
```

---

# EPIC 9 — GSC

### Tasks

```text
Google OAuth
property discovery
property selection
API client
initial sync
incremental sync
query data
page data
country data
device data
date aggregation
historical storage
sync monitoring
```

---

# EPIC 10 — Keyword Intelligence

### Tasks

```text
GSC keyword extraction
page-keyword mapping
keyword normalization
keyword clustering
position analysis
CTR analysis
impression analysis
keyword opportunity
cannibalization
content decay
```

---

# EPIC 11 — Competitor Analysis

### Tasks

```text
target keyword selection
SERP provider integration
competitor discovery
competitor URL extraction
competitor crawl
competitor page model
heading comparison
content comparison
entity comparison
schema comparison
question extraction
topic gap detection
```

---

# EPIC 12 — AI Foundation

### Tasks

```text
AI context builder
prompt templates
structured output
schema validation
AI confidence
AI reasoning metadata
action generation
retry
fallback
cost tracking
```

---

# 46. POC order

I strongly recommend that we **do not build all of these simultaneously**.

The POCs should be sequential.

### POC 1 — Comprehensive crawler

Input:

```text
URL
```

Output:

```text
Complete crawl dataset
```

Must demonstrate:

* sitemap
* robots
* HTML
* JS
* links
* metadata
* redirects
* schema
* images
* duplicate detection
* crawl coverage

This is the first gate.

---

### POC 2 — Website model

Input:

```text
POC 1 data
```

Output:

```text
Website graph/model
```

Must demonstrate:

* page relationships
* page types
* orphan detection
* duplicate detection
* internal linking
* content representation

---

### POC 3 — Technical SEO engine

Input:

```text
Website model
```

Output:

```text
SEO issues
```

Must demonstrate all major Point 6 categories.

---

### POC 4 — GSC

Input:

```text
Google account
```

Output:

```text
GSC data
```

Then join:

```text
GSC page
      ↓
Crawled page
```

---

### POC 5 — Keyword opportunity

Input:

```text
Crawl
+
GSC
```

Output:

```text
Prioritized opportunities
```

---

### POC 6 — Competitor analysis

Input:

```text
Keyword
```

Output:

```text
SERP
 ↓
Competitors
 ↓
Competitor page data
 ↓
Content/topic gap
```

---

### POC 7 — AI recommendation

Input:

```text
Page
+
SEO issue
+
GSC
+
Keyword
+
Competitor
```

Output:

```text
Structured SEO action
```

---

# 47. Testing strategy for the crawler

This is where I want us to be particularly rigorous.

We should **not test the crawler against only one normal website**.

We need a crawler test matrix.

### Test Website A — Static

```text
HTML
Normal links
Normal sitemap
```

### Test Website B — JavaScript

```text
React
Client-side rendering
Dynamic links
```

### Test Website C — Next.js

```text
SSR
SSG
Dynamic routes
Metadata
```

### Test Website D — WordPress

```text
Posts
Categories
Tags
Pagination
Sitemap
```

### Test Website E — E-commerce

```text
Products
Categories
Filters
Sorting
Variants
Query parameters
```

### Test Website F — Huge URL space

```text
Infinite pagination
Calendar
Filters
Search
```

### Test Website G — Broken site

```text
404
410
500
redirect chains
redirect loops
timeouts
```

### Test Website H — Complex JS

```text
API-generated content
lazy-loaded content
dynamic navigation
```

### Test Website I — Multilingual

```text
hreflang
language paths
localized URLs
```

### Test Website J — Duplicate-heavy

```text
tracking parameters
query variations
duplicate content
canonical variations
```

This is far more valuable than testing against 10 random websites.

---

# 48. The crawler's "definition of done"

I would not consider Point 4 complete until the crawler can demonstrate:

### Discovery

* sitemap discovery
* sitemap index
* robots
* HTML links
* JS-generated links
* configured start URLs

### Coverage

* complete reachable URL traversal
* URL coverage reporting
* failure reporting
* blocked URL reporting

### Extraction

* HTML
* metadata
* headings
* content
* links
* images
* schema
* canonical
* robots
* hreflang

### Technical

* redirects
* status codes
* timeouts
* retries
* duplicate URLs
* duplicate content
* crawl depth

### Safety

* rate limiting
* concurrency
* infinite URL protection
* parameter handling
* domain scope

### Performance

* HTTP-first
* browser fallback
* parallel workers
* resumable crawl

### Observability

```text
URLs discovered
URLs queued
URLs crawled
URLs failed
URLs blocked
URLs skipped
URLs rendered
URLs parsed
crawl duration
average response time
```

---

# 49. One architectural principle I strongly recommend

Do **not** store only the final extracted SEO data.

Store both:

```text
RAW
+
NORMALIZED
+
ANALYZED
```

For example:

```text
RAW PAGE
   │
   ├── raw HTML
   ├── headers
   ├── response metadata
   └── timestamp
        │
        ▼
NORMALIZED PAGE
   │
   ├── title
   ├── description
   ├── headings
   ├── links
   ├── images
   └── schema
        │
        ▼
ANALYZED PAGE
   │
   ├── SEO issues
   ├── page type
   ├── keywords
   ├── opportunities
   └── relationships
```

Why?

Because later, if our SEO rule changes, we should not necessarily have to crawl the website again.

We can reprocess:

```text
RAW → NORMALIZED → NEW ANALYSIS
```

That will save enormous crawler/API cost.

---

# 50. Another critical architectural principle: crawl vs analysis

Separate these.

### Crawl

> What exists on the website?

### Analyze

> What does it mean?

### Decide

> What should we do?

For Points 1–10, we are mostly building:

```text
CRAWL
   ↓
UNDERSTAND
   ↓
ANALYZE
   ↓
OPPORTUNITY
```

We should **not mix AI decisions into the crawler**.

---

# 51. Final implementation sequence

If I were assigning this to your development team, I would use this exact order:

```text
01. Requirement analysis
        ↓
02. Data contracts
        ↓
03. Project/site configuration
        ↓
04. URL normalization
        ↓
05. URL discovery
        ↓
06. Sitemap/robots
        ↓
07. Crawl queue
        ↓
08. HTTP crawler
        ↓
09. HTML extraction
        ↓
10. Playwright fallback
        ↓
11. Crawl persistence
        ↓
12. Crawl monitoring
        ↓
13. Website model
        ↓
14. Link graph
        ↓
15. Page classification
        ↓
16. Duplicate detection
        ↓
17. Technical SEO rules
        ↓
18. GSC OAuth
        ↓
19. GSC ingestion
        ↓
20. Keyword intelligence
        ↓
21. Opportunity scoring
        ↓
22. SERP integration
        ↓
23. Competitor crawler
        ↓
24. Competitor gap analysis
        ↓
25. AI context builder
        ↓
26. Structured AI recommendation
        ↓
27. End-to-end POC
```

---

# 52. Dependency map

This is probably the most useful thing for your actual project planning.

```text
                 REQUIREMENTS
                      │
                      ▼
              PROJECT CONFIG
                      │
                      ▼
               URL DISCOVERY
                      │
                      ▼
              URL NORMALIZATION
                      │
                      ▼
                 CRAWL QUEUE
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
     HTTP CRAWLER            PLAYWRIGHT
          │                       │
          └───────────┬───────────┘
                      ▼
                PAGE DATA
                      │
                      ▼
              WEBSITE MODEL
                 │       │
                 │       └──────────► LINK GRAPH
                 │
                 └──────────────► SEO ENGINE
                                      │
                                      ▼
                                    ISSUES
                                      │
             ┌────────────────────────┼───────────────────┐
             ▼                        ▼                   ▼
            GSC                   KEYWORDS            COMPETITORS
             │                        │                   │
             └────────────────────────┼───────────────────┘
                                      ▼
                              OPPORTUNITY ENGINE
                                      │
                                      ▼
                                  AI ENGINE
```

And this gives us a very clear rule:

> **Don't start Point 8/9/10 until the underlying page model is stable.**

Otherwise we'll constantly rewrite the data model.

---

# 53. What I would consider the first milestone

The first major milestone should be:

## **Milestone 1 — Website Intelligence Foundation**

Given:

```text
https://some-website.com
```

the system should be capable of:

```text
Connect website
      ↓
Read robots.txt
      ↓
Find sitemap
      ↓
Parse sitemap
      ↓
Discover HTML links
      ↓
Normalize URLs
      ↓
Deduplicate
      ↓
Queue
      ↓
HTTP crawl
      ↓
Detect JS requirement
      ↓
Playwright if required
      ↓
Extract SEO data
      ↓
Store page snapshot
      ↓
Build internal-link graph
      ↓
Generate crawl report
```

And the report should tell us:

```text
Total discovered: 5,420
Allowed: 5,200
Crawled: 5,180
Successful: 5,100
Failed: 60
Blocked: 20

JS-rendered: 430
Redirects: 120
404s: 45
5xx: 3
Orphans: 27
Duplicate URLs: 83
```

**If we can make this work reliably, we have the foundation for the rest of the platform.**

---

# 54. Then the second milestone

## **Milestone 2 — SEO Intelligence**

```text
Crawl
 ↓
Website Model
 ↓
SEO Rules
 ↓
GSC
 ↓
Keywords
 ↓
Competitors
 ↓
Opportunities
```

At the end, the system should be able to say something like:

> Page `/amazon-advertising` has 32,000 impressions, average position 8.7, CTR 2.1%, and is receiving queries related to "amazon advertising software." Three competing pages cover topics that this page does not cover. The page has one weak internal-link path from a high-traffic related article. This represents a high-priority optimization opportunity.

**That is when we can say Points 1–10 are genuinely working together.**

---

# 55. And only then do we move to Point 11+

After Points 1–10:

```text
Website Understanding
        +
SEO Issues
        +
SEO Opportunities
        ↓
Point 11
Internal Linking Automation
        ↓
Point 12
Website Modification
        ↓
Point 13
GitHub
        ↓
Point 14
Confidence
        ↓
Point 15
Validation
        ↓
...
```

So we're not building isolated features. **We're building the intelligence foundation that the autonomous SEO engine will later operate on.**

---

## My recommendation for our immediate next step

We should now take **Phase 0 + Phase 1 (Crawler)** and turn it into an even more granular engineering specification before touching the other points.

Specifically, next we should define:

1. **Crawler architecture**
2. **Complete database schema**
3. **URL normalization rules**
4. **URL discovery algorithm**
5. **Sitemap parser**
6. **robots.txt handling**
7. **crawl queue design**
8. **HTTP crawler behavior**
9. **Playwright fallback criteria**
10. **HTML/SEO extraction schema**
11. **duplicate detection**
12. **query-parameter strategy**
13. **pagination strategy**
14. **infinite-crawl protection**
15. **retry/error strategy**
16. **rate limiting**
17. **crawl concurrency**
18. **crawl state machine**
19. **crawl progress/coverage metrics**
20. **raw vs normalized storage**
21. **crawler test websites**
22. **crawler POC acceptance criteria**
23. **benchmark methodology**
24. **100 / 10,000 / 100,000-page scaling strategy**