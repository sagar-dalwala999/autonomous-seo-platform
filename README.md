# Autonomous SEO Optimization Platform

Research and proof-of-concept work for an autonomous SEO platform: crawl a website, understand
it, detect issues, generate optimizations, validate them, apply them safely, and measure the
result.

The contract every deliverable is graded against is [`SPEC.md`](SPEC.md) (distilled from the
client's problem statement).

## Repository layout

| Path | What it is |
|---|---|
| `SPEC.md` | The problem statement, distilled — the binding requirements |
| `docs/` | Client deliverable documents 01–07 (requirements, feasibility, architecture, technology comparison, API research, risk, MVP plan) + `DECISIONS.md`, the binding decision register (D-01…D-40) |
| `research/` | The research lanes behind the decisions, including `crawler-advanced-competitive.md` (SearchAtlas/OTTO, Ahrefs, Screaming Frog, Sitebulb, Botify/Lumar/Oncrawl/JetOctopus teardown + our roadmap) |
| `poc/seo-crawler-poc/` | **POC-1 (crawler) + POC-2 (analyzer)** — Node/TypeScript, Crawlee + Playwright |
| `poc/seo-dashboard/` | Next.js dashboard — dynamic crawl trigger, evidence explorer, Issues view |
| `poc/target-site/` | Purpose-built Next.js test site with **18 deliberately seeded SEO issues** — the acceptance ground truth |
| `gdocs/` | Tooling that renders the markdown deliverables into styled documents |

## Proof of correctness

The POCs are graded against the seeded test site, not against claims:

- **Crawler (POC-1):** 18/18 seeded evidence classes captured — `poc/seo-crawler-poc/POC-1-REPORT.md`
- **Analyzer (POC-2):** acceptance gate at 29/30 with zero error-severity false positives and
  every finding's evidence pointer resolving to a real stored field —
  `npx tsx scripts/analyzer-gate.ts`
- **Test suite:** 296 unit tests

## Quick start

```bash
# 1. Crawler + analyzer
cd poc/seo-crawler-poc
npm install
npx playwright install chromium
npm run crawl -- https://example.com --max-pages 50   # --max-pages 0 = whole site
npm run analyze -- --run <runId>

# 2. Dashboard (reads the crawler's storage/ directly)
cd ../seo-dashboard
npm install
npm run build && npm run start                        # http://localhost:3100

# 3. The seeded test site (for acceptance runs)
cd ../seo-crawler-poc
npx tsx scripts/serve-target-site.ts                  # http://localhost:3105
```

## Status

| Deliverable | State |
|---|---|
| Docs 01–07 + decision register | Complete |
| POC-1 — crawl a website | Complete, gate-verified |
| POC-2 — analyze SEO automatically | Complete, gate-verified |
| POC-3 — generate SEO optimizations (AI) | Not started |
| POC-4/5/6 — modify repo, validate, open PR | Not started |
| POC-7 — read Google Search Console data | Not started |
| POC-8 — measure optimization impact | Not started |
