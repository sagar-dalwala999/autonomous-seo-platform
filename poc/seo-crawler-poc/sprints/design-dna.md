# Design DNA — SEO Crawler Dashboard (binding for UI slices S8–S10)

> Source: Sagar's reference image (creator-campaign dashboard, `Downloads/HPR2m32bQAAm46d.jfif`)
> + ui-ux-pro-max design system (Analytics Dashboard palette lineage, Minimal Swiss typography).
> Hard requirements from Sagar: full-height/width app UI (NOT a modal/centered module),
> light AND dark mode, "everything proper".

## 1. Reference teardown — the logic to reproduce (not the pixels)

The reference page is an **answer machine**, four bands top to bottom:

1. **"What needs attention NOW"** — 3 action cards, each: tinted header strip (rounded-square
   icon + label), huge number + unit caption, footnote with clock icon, right-aligned CTA button.
2. **"How are we doing vs baseline"** — one bordered container split into 4 KPI tiles by
   hairline dividers: small icon + label, big value (with unit suffix), delta pill (green ↑ /
   red ↓), "vs <previous>" caption.
3. **"Distribution + trend"** — two chart cards: LEFT a hexagon-matrix (bee-swarm honeycomb,
   colored clusters on gray empty cells) with a legend list (color dot, name, % chip,
   right-aligned value with arrow); RIGHT a halftone DOT-MATRIX area chart (stacked dot columns,
   not solid fills), big value + avg/day caption + legend chip, $-gridlines, date x-labels.
4. **"Work queue"** — table "…that need you": rows with colored letter-avatar + name + status
   subline (green dot · day N / Stalled), badge chips with sublines, numeric columns with
   sublines, segmented progress meter (color communicates consumption), right-aligned CTA
   (outline "Review" / dark filled "Launch" depending on state).

Shell: fixed sidebar (~264px) — workspace block, search with kbd hint, tiny section labels
(Essentials/Work/Measure/Account), icon+label items with count badges, active item = card-pill;
bottom sticky zone (setup/promo card with stepper, Appearance, Help & support, user row).
Top bar: page icon + title left; icon button + outline "Export" + filled-primary "+ New" right.
Below it a chips row: calendar chip + segmented filter chips (one carries a red status dot).

Every number has context (unit caption, delta, footnote). One primary blue; data colors
(blue/orange/green/purple) are reserved for data; green/red only as semantics. Neutral warm
canvas, white cards, 1px hairline borders, ~10px radii, generous padding, 13–14px UI text.

## 2. Domain mapping (crawler data → reference bands)

- Action cards: **Crawl coverage %** (footnote "X of Y attempted" / CTA "View failures") ·
  **Failed URLs** (footnote top failure classes / CTA "Open failures") · **Blocked by robots**
  (footnote "robots.txt enforced · /guides/*" / CTA "Review robots"). Tints: blue / amber / violet.
- KPI strip: **Pages crawled** · **Avg response time** · **JS-rendered** · **Internal links**
  — delta vs previous run when one exists, otherwise "—" with "first run" caption (never a fake delta).
- LEFT chart: **hex matrix of crawled pages** — one hex per page, colored by status class
  (2xx blue / 3xx violet / 4xx amber / 5xx red / blocked gray-dark / empty cell gray-light),
  legend rows: class, % chip, count. Hover = tooltip with URL + status; click → page detail.
- RIGHT chart: **crawl progress over time** — dot-matrix columns of pages fetched per time
  bucket (from fetchedAt), big value = total pages, caption "N pages/min avg", legend chip
  "HTTP vs Playwright" (two dot colors stacked).
- Work queue table "**Pages that need you**": worst offenders — 4xx/5xx pages, redirect loops,
  noindex-on-crawlable, orphan candidates. Columns: Page (letter-avatar colored by section,
  path, status subline) · Issue evidence (badge + subline) · Depth · Response time · Status
  chip · CTA "View evidence" → detail. Empty state when a run is clean.
- Page evidence detail (drill-down route): full CrawledPage record rendered as sections
  (metadata, robots, headings, links, images, structured data, content stats, redirect chain,
  crawl meta) + "open raw HTML" + "copy JSON". This is the POC's proof surface.
- Sidebar nav: **Essentials**: Overview, Runs (badge: run count) · **Crawl data**: Pages,
  Failures & Blocked, Sitemap & Robots · **Account**: Appearance (theme), Help. Bottom user row:
  "Crawler POC · local". Search field filters pages by URL (routes to /pages?q=).
- Top bar: title per route; right: "Export" (downloads the run's report.json) + primary
  "**+ New crawl**" → slide-over panel = REAL crawl trigger (Sagar requirement): URL +
  max-pages + robots + render form → spawns an actual crawler run with live progress + log
  tail; on completion the dashboard switches to the new run. Contract: spec.md S9.
- Chips row: run selector chip (calendar icon, run id + date) + status filter chips
  (All pages / Successful / Redirects / Failed / Blocked — counts; Failed chip carries the red
  dot when failures > 0).

## 3. Tokens (CSS custom properties; Tailwind v4 maps to them)

Semantic, theme-switched via `[data-theme="dark"]` on <html> (default from
prefers-color-scheme, toggle persisted in localStorage, no-flash inline script in <head>).

| Token | Light | Dark |
|---|---|---|
| --bg-canvas | #F4F4F2 | #101114 |
| --bg-card | #FFFFFF | #17181C |
| --bg-elevated | #FFFFFF | #1D1F24 |
| --bg-subtle (tile headers, table header) | #FAFAF8 | #1A1C20 |
| --border | #E6E6E2 | #262930 |
| --border-strong | #D9D9D4 | #32363F |
| --text-primary | #17181C | #F2F3F5 |
| --text-secondary | #5C6470 | #A6ACB8 |
| --text-faint (captions; still ≥4.5:1 on its bg) | #6E7683 | #8F96A3 |
| --primary | #2563EB | #6C9BF5 |
| --primary-contrast | #FFFFFF | #0B1220 |
| --data-blue | #3B82F6 | #6FA5F8 |
| --data-orange | #E8862E | #F2A65A |
| --data-green | #10B981 | #34D399 |
| --data-violet | #8B5CF6 | #A78BFA |
| --data-red | #EF4444 | #F87171 |
| --ok / --ok-bg | #067A55 / #E7F7F0 | #34D399 / #12291F |
| --danger / --danger-bg | #DC2626 / #FDECEC | #F87171 / #2E1717 |
| --warn / --warn-bg | #B45309 / #FDF3E4 | #F2A65A / #2C2113 |

Radii: card 12px, control 8px, chip/pill 999px. Shadows: light `0 1px 2px rgb(0 0 0 / .05)`
cards, `0 8px 24px rgb(0 0 0 / .10)` popovers; dark mode uses borders + elevated bg, near-zero
shadow. Spacing 4/8 scale; page padding 24px; card padding 16–20px.

Typography: **Inter** via next/font (self-hosted, no CDN), weights 400/500/600/700.
Scale: 12 (captions/labels) · 13 (table/secondary) · 14 (body/nav) · 16 (card titles) ·
22–24 (card big numbers) · 28–30 (chart hero values). Data cells + big numbers get
`font-variant-numeric: tabular-nums`. Section labels: 11px, 600, uppercase, letter-spacing 0.04em.

Icons: **lucide-react** exclusively, 16/18/20px, stroke 1.75 — no emoji anywhere.

## 4. Layout skeleton (full height/width — hard requirement)

```
<html> → body (h-dvh, overflow hidden, bg-canvas)
  <div class="app-grid">  grid-cols-[264px_1fr], h-dvh, w-full
    <aside>  h-full, border-r, flex-col, own overflow-y; bottom zone sticky
    <div>    flex-col, min-w-0
      <header>  h-14, border-b, flex items-center  (title | actions)
      <main>    flex-1, overflow-y-auto, p-6, min-w-0   ← the ONLY page scroll
```

No max-width cap on main content (fluid full-width; grids re-flow). Never render page content
inside a centered modal frame. Breakpoints: <1024px sidebar collapses to icon rail +
slide-over; charts stack to one column; table gets horizontal scroll INSIDE its card.

## 5. Component rules (from ui-ux-pro-max quick reference — enforce, don't re-derive)

- Contrast ≥4.5:1 body text BOTH themes (the token table above is pre-checked — don't invent
  new grays); focus rings visible (2px ring --primary, offset 2) on ALL interactive elements;
  full keyboard nav; aria-labels on icon-only buttons; aria-sort on sortable columns.
- Hover/press: cards hover-lift (translateY(-1px) + shadow step, 180ms ease-out); buttons
  press scale 0.98; chips/nav items bg-shift; NO layout-shifting hover.
- Motion: 150–250ms, ease-out enter/ease-in exit; scroll-reveal (opacity+8px translate) on
  section entry, stagger 40ms; all gated behind prefers-reduced-motion.
- Loading: skeleton shimmer blocks matching final layout (no spinners for page loads);
  charts get skeleton frames; reserve space (no CLS).
- Empty states: icon + one-line explanation + action (e.g. no runs yet → show the CLI command
  to produce one). Error states: message + retry, never a blank card.
- Tables: sortable headers with aria-sort, sticky header inside card scroll, tabular-nums,
  row hover bg, 44px min row height.
- Charts: custom SVG (no chart lib). Hex matrix + dot-matrix must ALSO convey by tooltip +
  legend text, never color alone; gridlines --border; axis labels 12px --text-faint;
  tooltips keyboard-reachable (focusable cells); honor reduced-motion (no entry animation).
- Theme toggle: "Appearance" in sidebar bottom zone — Light / Dark / System segmented control,
  live swap, persisted; both themes ship polished (dark is NOT an inverted afterthought).

## 6. Stack & structure (S8 owns)

Next.js 15 (App Router, TS) + Tailwind v4, port **3100**, app dir `poc/seo-dashboard/`.
Data source: filesystem reads of `../seo-crawler-poc/storage/runs/<runId>/` (server-side only,
`lib/data.ts`: listRuns, getRun, getPages w/ filter+search+sort, getPage, getBench). Path
resolved relative to the dashboard app; overridable via env `CRAWLER_STORAGE_DIR`. No DB, no
auth (local POC tool). Deps: next, react, tailwindcss, lucide-react — nothing else without a
BLOCKED return.
