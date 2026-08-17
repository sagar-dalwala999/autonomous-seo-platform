/**
 * The dashboard's "site" concept for GSC.
 *
 * The dashboard has no website entity — its unit is the crawl run, each with a
 * start URL. For Search Console (which is site-scoped, not run-scoped) we
 * derive sites from those start URLs: one site per normalised domain, with
 * the newest run of that domain standing in as "the crawl" for crawl-derived
 * views (coverage, enhancements, mobile, merged URLs).
 */
import { listRuns, getPages } from "@/lib/data";
import { hostnameOf } from "./url";
import type { GscSite } from "./types";

export interface SiteWithRun {
  domain: string;
  startUrl: string;
  runId: string;
}

/** Every domain the dashboard has crawled, newest run first per domain. */
export async function listSites(): Promise<GscSite[]> {
  const runs = await listRuns();
  const byDomain = new Map<string, { startUrl: string; lastCrawledAt: string | null; count: number }>();
  for (const run of runs) {
    const host = hostnameOf(run.startUrl);
    if (!host) continue;
    const domain = host.replace(/^www\./i, "").replace(/:\d+$/, "");
    const cur = byDomain.get(domain);
    if (cur) {
      cur.count += 1;
      if (!cur.lastCrawledAt || run.startedAt > cur.lastCrawledAt) cur.lastCrawledAt = run.startedAt;
    } else {
      byDomain.set(domain, { startUrl: run.startUrl, lastCrawledAt: run.startedAt || null, count: 1 });
    }
  }
  return [...byDomain.entries()]
    .map(([domain, v]) => ({ domain, startUrl: v.startUrl, runCount: v.count, lastCrawledAt: v.lastCrawledAt, linkedSiteUrl: null }))
    .sort((a, b) => b.lastCrawledAt?.localeCompare(a.lastCrawledAt ?? "") ?? 0);
}

/** The newest run whose start URL matches `domain` (or null when none). */
export async function latestCrawlForDomain(domain: string): Promise<SiteWithRun | null> {
  const runs = await listRuns();
  const target = domain.toLowerCase().replace(/^www\./i, "").replace(/:\d+$/, "");
  for (const run of runs) {
    const host = hostnameOf(run.startUrl);
    if (!host) continue;
    const runDomain = host.replace(/^www\./i, "").replace(/:\d+$/, "");
    if (runDomain === target) {
      return { domain: target, startUrl: run.startUrl, runId: run.runId };
    }
  }
  return null;
}

/** The pages of the newest crawl for a domain ([] when the domain has no run). */
export async function pagesForDomain(domain: string) {
  const site = await latestCrawlForDomain(domain);
  if (!site) return { site, pages: [] as Awaited<ReturnType<typeof getPages>> };
  const pages = await getPages(site.runId);
  return { site, pages };
}
