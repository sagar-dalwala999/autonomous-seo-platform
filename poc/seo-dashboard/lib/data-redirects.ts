/** Server-only. New lib file for the /redirects screen — same classification logic as
 *  app/api/crawls/:id/redirects/route.ts (do-not-touch, can't be imported from a route file), read
 *  straight off each page's stored redirectChain[] via getPages (do-not-touch), matching this app's
 *  convention of RSC pages calling lib/ directly instead of fetching their own API. */
import { getPages } from "./data";

export type RedirectType = "permanent" | "temporary" | "loop" | "to-error";

export interface RedirectRow {
  pageId: string;
  requestedUrl: string;
  chain: { from: string; to: string; statusCode: number }[];
  hops: number;
  finalUrl: string | null;
  finalStatus: number | null;
  type: RedirectType;
  crossHost: boolean;
  toHttps: boolean;
}

function classify(chain: { statusCode: number }[], finalStatus: number | null): RedirectType {
  if (finalStatus !== null && finalStatus >= 400) return "to-error";
  if (new Set(chain.map((c) => c.statusCode)).size < chain.length && chain.length > 3) return "loop";
  const allPermanent = chain.every((c) => c.statusCode === 301 || c.statusCode === 308);
  return allPermanent ? "permanent" : "temporary";
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function buildRedirectRows(runId: string): Promise<RedirectRow[]> {
  const pages = await getPages(runId);
  return pages
    .filter((p) => p.redirectChain.length > 0)
    .map((p) => {
      const chain = p.redirectChain.map((r) => ({ from: r.from, to: r.to, statusCode: r.statusCode }));
      const firstHost = hostOf(chain[0]?.from ?? p.url);
      const finalHost = hostOf(p.finalUrl ?? p.url);
      return {
        pageId: p.pageId,
        requestedUrl: chain[0]?.from ?? p.url,
        chain,
        hops: chain.length,
        finalUrl: p.finalUrl,
        finalStatus: p.statusCode,
        type: classify(p.redirectChain, p.statusCode),
        crossHost: Boolean(firstHost && finalHost && firstHost !== finalHost),
        toHttps: chain.some((c) => c.from.startsWith("http://")) && Boolean(p.finalUrl?.startsWith("https://")),
      };
    })
    .sort((a, b) => b.hops - a.hops);
}
