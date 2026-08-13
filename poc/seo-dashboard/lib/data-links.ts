/** Server-only. New lib file for the /links screen — aggregates the per-page LinkRecord[] already
 *  captured by the crawler (getPages, do-not-touch) into one row per unique destination, mirroring
 *  the edge-list computation in app/api/crawls/:id/links/route.ts (do-not-touch) but rolled up by
 *  target instead of left as a flat edge list, since a practitioner table needs "who links here"
 *  per destination, not one row per link instance. */
import { getPages } from "./data";
import type { CrawledPageWithId } from "./types";

export interface LinkRow {
  key: string;
  target: string;
  targetNormalized: string | null;
  type: "internal" | "external";
  status: number | null;
  crawled: boolean;
  broken: boolean;
  inboundCount: number;
  nofollowCount: number;
  anchors: string[];
  sources: { pageId: string; url: string; anchor: string; nofollow: boolean }[];
}

export async function buildLinkRows(runId: string): Promise<LinkRow[]> {
  const pages = await getPages(runId);
  const statusByNormUrl = new Map(pages.map((p) => [p.normalizedUrl, p.statusCode]));
  const pageIdByNormUrl = new Map(pages.map((p) => [p.normalizedUrl, p.pageId]));

  const rows = new Map<string, LinkRow>();
  for (const p of pages) {
    for (const l of p.links) {
      const key = `${l.type}|${l.target}`;
      const existing = rows.get(key);
      const targetStatus = l.targetNormalized ? (statusByNormUrl.get(l.targetNormalized) ?? null) : null;
      const source = { pageId: p.pageId, url: p.url, anchor: l.anchor, nofollow: l.nofollow };
      if (existing) {
        existing.inboundCount++;
        if (l.nofollow) existing.nofollowCount++;
        if (l.anchor && !existing.anchors.includes(l.anchor)) existing.anchors.push(l.anchor);
        if (existing.sources.length < 50) existing.sources.push(source);
        continue;
      }
      rows.set(key, {
        key,
        target: l.target,
        targetNormalized: l.targetNormalized,
        type: l.type,
        status: targetStatus,
        crawled: l.targetNormalized ? pageIdByNormUrl.has(l.targetNormalized) : false,
        broken: targetStatus !== null && targetStatus >= 400,
        inboundCount: 1,
        nofollowCount: l.nofollow ? 1 : 0,
        anchors: l.anchor ? [l.anchor] : [],
        sources: [source],
      });
    }
  }
  return [...rows.values()].sort((a, b) => b.inboundCount - a.inboundCount);
}

export function targetPageId(pages: CrawledPageWithId[], targetNormalized: string | null): string | null {
  if (!targetNormalized) return null;
  return pages.find((p) => p.normalizedUrl === targetNormalized)?.pageId ?? null;
}
