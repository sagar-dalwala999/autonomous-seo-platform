/** Server-only. New lib file. Link graph (inlinks/outlinks/PageRank) + duplicate clustering for
 *  GET /api/crawls/:id/graph and .../duplicates.
 *
 *  A sibling agent's src/graph module (read-only reference, do-not-touch) writes a real
 *  storage/runs/<id>/graph.json — discovered mid-pass on 4 of ~110 runs on disk, with a proper
 *  converging power-iteration PageRank (`{runId, dampingFactor, iterations, converged, pages[],
 *  orphans[]}`). That is strictly better data than a from-scratch computation, so buildGraph()
 *  prefers it and only falls back to computing PageRank itself (see below) when graph.json is
 *  absent for a run — the same "prefer durable, synthesize as fallback" shape as events-log.ts. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getPages } from "./data";
import type { CrawledPageWithId } from "./types";

const STORAGE_ROOT = process.env.CRAWLER_STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_STORAGE_DIR)
  : path.resolve(process.cwd(), "..", "seo-crawler-poc", "storage");
const RUNS_DIR = path.join(STORAGE_ROOT, "runs");

export interface GraphRow {
  pageId: string;
  url: string;
  depth: number | null;
  inlinks: number;
  outlinks: number;
  pagerank: number;
  source: "stored" | "computed";
}

interface StoredGraphFile {
  runId: string;
  dampingFactor: number;
  iterations: number;
  converged: boolean;
  pages: { pageId: string; url: string; internalRank: number; rawRank: number; inlinks: number; uniqueInlinks: number; outlinks: number; depth: number | null }[];
  orphans: string[];
}

async function readStoredGraph(runId: string): Promise<GraphRow[] | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(RUNS_DIR, runId, "graph.json"), "utf8")) as StoredGraphFile;
    return raw.pages.map((p) => ({ pageId: p.pageId, url: p.url, depth: p.depth, inlinks: p.uniqueInlinks, outlinks: p.outlinks, pagerank: p.rawRank, source: "stored" as const }));
  } catch {
    return null;
  }
}

function normKey(p: CrawledPageWithId): string {
  return p.normalizedUrl || p.url;
}

/** Power-iteration PageRank over the internal link graph, damping 0.85, 20 iterations — a
 *  from-scratch implementation (no sibling "graph" module exists yet on the crawler side), scoped
 *  to pages actually crawled in this run. Dangling nodes (no outlinks) redistribute mass evenly,
 *  the standard fix so total rank doesn't leak. */
export async function buildGraph(runId: string): Promise<GraphRow[]> {
  const stored = await readStoredGraph(runId);
  if (stored) return stored;

  const pages = await getPages(runId);
  const byKey = new Map<string, CrawledPageWithId>();
  for (const p of pages) byKey.set(normKey(p), p);

  const outEdges = new Map<string, Set<string>>();
  const inCounts = new Map<string, number>();
  for (const p of pages) {
    const key = normKey(p);
    const targets = new Set<string>();
    for (const link of p.links) {
      if (link.type !== "internal" || !link.targetNormalized) continue;
      if (!byKey.has(link.targetNormalized) || link.targetNormalized === key) continue;
      targets.add(link.targetNormalized);
    }
    outEdges.set(key, targets);
    for (const t of targets) inCounts.set(t, (inCounts.get(t) ?? 0) + 1);
  }

  const n = pages.length;
  const keys = [...byKey.keys()];
  const damping = 0.85;
  let rank = new Map<string, number>(keys.map((k) => [k, 1 / n]));

  for (let iter = 0; iter < 20 && n > 0; iter++) {
    let danglingMass = 0;
    for (const k of keys) {
      const out = outEdges.get(k);
      if (!out || out.size === 0) danglingMass += rank.get(k)! ;
    }
    const next = new Map<string, number>();
    const base = (1 - damping) / n + (damping * danglingMass) / n;
    for (const k of keys) next.set(k, base);
    for (const k of keys) {
      const out = outEdges.get(k);
      if (!out || out.size === 0) continue;
      const share = (damping * rank.get(k)!) / out.size;
      for (const t of out) next.set(t, (next.get(t) ?? base) + share);
    }
    rank = next;
  }

  return pages
    .map((p) => {
      const key = normKey(p);
      return {
        pageId: p.pageId,
        url: p.url,
        depth: p.crawl.depth,
        inlinks: inCounts.get(key) ?? 0,
        outlinks: outEdges.get(key)?.size ?? 0,
        pagerank: Math.round((rank.get(key) ?? 0) * 100000) / 100000,
        source: "computed" as const,
      };
    })
    .sort((a, b) => b.pagerank - a.pagerank);
}

export interface DuplicateGroup {
  key: string;
  kind: "exact" | "near" | "title" | "description";
  pages: { pageId: string; url: string }[];
}

function groupBy(pages: CrawledPageWithId[], keyFn: (p: CrawledPageWithId) => string | null): DuplicateGroup[] {
  const map = new Map<string, { pageId: string; url: string }[]>();
  for (const p of pages) {
    const key = keyFn(p);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push({ pageId: p.pageId, url: p.url });
    map.set(key, list);
  }
  return [...map.entries()].filter(([, items]) => items.length > 1).map(([key, pages]) => ({ key, kind: "exact" as const, pages }));
}

const NEAR_DUP_PAGE_CAP = 300;

/** Jaccard similarity over 5-word shingles, threshold 0.8. O(n^2) — capped, see route handler,
 *  because this run's page count can be in the thousands and pairwise comparison at that scale is
 *  a request-thread cost PLAN-03 explicitly designs against (M5). */
function shingles(text: string, size = 5): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  if (out.size === 0 && words.length > 0) out.add(words.join(" "));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export async function buildDuplicates(
  runId: string,
  kind: "exact" | "near" | "title" | "description",
): Promise<{ groups: DuplicateGroup[]; available: true } | { available: false; reason: string }> {
  const pages = await getPages(runId);

  if (kind === "exact") return { groups: groupBy(pages, (p) => p.content.contentHash || null).map((g) => ({ ...g, kind: "exact" })), available: true };
  if (kind === "title") return { groups: groupBy(pages, (p) => (p.title ? p.title.trim().toLowerCase() : null)).map((g) => ({ ...g, kind: "title" })), available: true };
  if (kind === "description")
    return { groups: groupBy(pages, (p) => (p.metaDescription ? p.metaDescription.trim().toLowerCase() : null)).map((g) => ({ ...g, kind: "description" })), available: true };

  // near
  if (pages.length > NEAR_DUP_PAGE_CAP) {
    return {
      available: false,
      reason: `Near-duplicate detection is O(n^2) pairwise shingle comparison; this run has ${pages.length} pages, above the ${NEAR_DUP_PAGE_CAP}-page cap for a request-thread computation. A streamed/indexed similarity engine (PLAN-03 §3, cross-page index) has not shipped yet.`,
    };
  }
  const withText = pages.filter((p) => p.content.text && p.content.text.length > 50);
  const sets = withText.map((p) => ({ p, s: shingles(p.content.text) }));
  const visited = new Set<number>();
  const groups: DuplicateGroup[] = [];
  for (let i = 0; i < sets.length; i++) {
    if (visited.has(i)) continue;
    const cluster = [sets[i]];
    for (let j = i + 1; j < sets.length; j++) {
      if (visited.has(j)) continue;
      if (jaccard(sets[i].s, sets[j].s) >= 0.8) {
        cluster.push(sets[j]);
        visited.add(j);
      }
    }
    if (cluster.length > 1) {
      visited.add(i);
      groups.push({ key: `near-${sets[i].p.pageId}`, kind: "near", pages: cluster.map((c) => ({ pageId: c.p.pageId, url: c.p.url })) });
    }
  }
  return { groups, available: true };
}
