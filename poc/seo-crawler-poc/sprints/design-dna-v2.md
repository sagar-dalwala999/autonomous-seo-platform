# Design DNA v2 — UI Excellence Pass (addendum to design-dna.md; v1 tokens/motion/a11y stay binding)

> Sagar's brief (2026-08-11 evening): "proper UI where everything is linking proper, data are
> structured, image/video shows preview, grouping is proper for each and every part." Research
> base: ui-ux-pro-max ux-guidelines (deep-linking, breadcrumbs, active states, heading
> hierarchy, reduced-motion) + bento dashboard patterns.

## Law 1 — Everything links (no dead data)
- Every entity mention is a link: run id → Overview of that run; any URL/page mention → its
  evidence detail; failure row → its page record (when one exists); sitemap entry → page detail
  or an explanatory "never crawled" state; orphan candidate → detail; parentUrl → parent's
  detail; discoverySources chip "sitemap" → /sitemap view.
- Every NUMBER clicks through to the filtered list that produced it: action-card counts, KPI
  values, legend rows, chip counts → `/pages?...` with the matching filter preselected.
- URL reflects state (query params: run, status, q, sort, group) — every view is shareable and
  back/forward-safe. No state that dies on refresh.
- Breadcrumbs on detail pages: Pages › <section> › <page>. Prev/next page navigation within the
  current filter set.

## Law 2 — Grouping is structural, not cosmetic
- Page detail: grouped section cards WITH a sticky in-page section nav (Metadata · Headings ·
  Links · Images · Media · Structured data · Content · Redirects · Headers · Crawl) — jump
  links + scroll-spy highlight. Section headers carry counts ("Links 34 · 28 internal").
- Pages explorer: optional "Group by section" (first path segment) with collapsible group
  headers showing per-group counts + status mix; default stays flat sorted.
- Failures: grouped by class (exists) → collapsible groups, each row linking to its page record.
- Sitemap: three cross-ref lists as distinct cards with counts + per-row links.

## Law 3 — Media previews (the crawled site is visual evidence)
- Images table → thumbnail cell: lazy-loaded, fixed 56px box (object-cover, reserve space —
  zero CLS), graceful broken-image fallback icon, click → lightbox-free full-size open in new
  tab. Alt badges stay (missing/empty).
- Videos (new crawler capability, slice S12): `<video>`/`<source>` files → `<video
  preload="metadata" controls muted>` inline preview; YouTube/Vimeo iframe embeds → thumbnail
  (img.youtube.com/vi/<id>/hqdefault.jpg for YT) + provider badge + link out. Poster shown when
  declared.
- Page detail gets a "Media" section (images summary + videos) in the section nav.

## Law 4 — Structured data readable by humans
- Parsed JSON-LD → collapsible key tree (not a raw wall), @type badge per block, parse errors
  highlighted inline with the raw preserved below a toggle.

## Law 5 — Visual depth without noise
- Keep the reference's calm density. Bento-style asymmetry allowed on Overview only. Cards:
  consistent radius/border/shadow tokens from v1; hover-lift only on clickable cards; section
  headers 11px uppercase; hero numbers tabular-nums. Active/pressed states on all interactive
  rows (active:scale-[0.99] where appropriate, reduced-motion honored).

## Scope notes
- New-crawl form: maxPages clamp raised 300 → 1000 (client + server) with helper text "your own
  site? go full — external sites stay polite automatically".
- Everything verified via ui-feedback-loop in BOTH themes with real run data; zero console
  errors; keyboard path for section nav + groups.
