/**
 * Server-only. "Deep-link into a filtered pages list" for the v2 measurements grid.
 *
 * The existing /pages explorer's URL filters (status/rendered/depth/q — components/explorer's
 * own client state, not owned by this slice) can express only 2 of the 31 measurement ids without
 * risking a count-vs-destination mismatch — the exact "chip counted 400-599 but linked to
 * status=4xx" bug class this build is fighting. Rather than link somewhere that silently
 * disagrees with the card's own number, this computes the exact matching-page set server-side,
 * using the SAME filter semantics as ../seo-crawler-poc/src/analysis/measurements/compute.ts, for
 * a scoped subset of ids this file can verify are exactly correct. Ids not listed here render
 * without a drill-down button — an honest omission beats a wrong subset.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CrawledPageWithId } from "./types";

const CRAWLER_DIR = process.env.CRAWLER_PROJECT_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_PROJECT_DIR)
  : path.resolve(process.cwd(), "..", "seo-crawler-poc");

/** Mirrors compute.ts's DEEP_PAGE_DEPTH — hardcoded there too (not config-driven), so no drift risk. */
const DEEP_PAGE_DEPTH = 3;
/** Fallback only, matches compute.ts's own fallback constant — readThinContentWords() below reads
 *  the real analysis.config.json value whenever it's reachable, for exact parity with the card's
 *  own number instead of a guessed threshold. */
const FALLBACK_THIN_CONTENT_WORDS = 80;

let cachedThinContentWords: number | null = null;

async function readThinContentWords(): Promise<number> {
  if (cachedThinContentWords !== null) return cachedThinContentWords;
  try {
    const raw = await readFile(path.join(CRAWLER_DIR, "analysis.config.json"), "utf8");
    const parsed = JSON.parse(raw) as { thresholds?: { thinContentWords?: number } };
    const v = parsed.thresholds?.thinContentWords;
    cachedThinContentWords = typeof v === "number" ? v : FALLBACK_THIN_CONTENT_WORDS;
  } catch {
    cachedThinContentWords = FALLBACK_THIN_CONTENT_WORDS;
  }
  return cachedThinContentWords;
}

export interface MatchingPageRow {
  pageId: string;
  url: string;
  statusCode: number | null;
}

export interface DrilldownResult {
  rows: MatchingPageRow[];
  total: number;
  truncated: boolean;
}

const ROW_LIMIT = 500;

function buildMatchers(thinContentWords: number): Record<string, (p: CrawledPageWithId) => boolean> {
  return {
    "pages-crawled": () => true,
    // NOT included: "broken-pages" — compute.ts's real measurement is a DEDUPED UNION of
    // pages.json (statusCode>=400) AND failures.json (http-4xx/http-5xx) rows; failures.json
    // entries usually have no CrawledPage record at all (the fetch never produced one), so a
    // pages-only matcher here would both undercount vs. the card AND have no page to link to for
    // the missing rows. Rather than show a subset that silently disagrees with the card's own
    // number, this id is left out — the same "chip counted 400-599 but linked to status=4xx" bug
    // class the brief calls out.
    // NOT included: "images-without-alt" — compute.ts's card is an IMAGE count (an img can repeat
    // per page), but a "matching pages" panel can only itself count PAGES containing >=1 such
    // image — a different unit under the same button would read as a mismatch even though neither
    // number is wrong.
    redirects: (p) => p.redirectChain.length > 0,
    "missing-title": (p) => !p.title || p.title.trim() === "",
    "missing-meta-description": (p) => !p.metaDescription || p.metaDescription.trim() === "",
    "missing-h1": (p) => p.headings.h1.length === 0,
    "multiple-h1": (p) => p.headings.h1.length > 1,
    "thin-content": (p) => p.content.wordCount < thinContentWords,
    noindex: (p) => p.robots.noindex,
    "deep-pages": (p) => p.crawl.depth > DEEP_PAGE_DEPTH,
    "needs-javascript": (p) => p.renderedWith === "playwright",
  };
}

export async function drilldownSupportedIds(): Promise<Set<string>> {
  return new Set(Object.keys(buildMatchers(FALLBACK_THIN_CONTENT_WORDS)));
}

export async function computeMatchingPages(pages: CrawledPageWithId[], measurementId: string): Promise<DrilldownResult | null> {
  const thinContentWords = await readThinContentWords();
  const matcher = buildMatchers(thinContentWords)[measurementId];
  if (!matcher) return null;
  const matched = pages.filter(matcher);
  return {
    rows: matched.slice(0, ROW_LIMIT).map((p) => ({ pageId: p.pageId, url: p.url, statusCode: p.statusCode })),
    total: matched.length,
    truncated: matched.length > ROW_LIMIT,
  };
}
