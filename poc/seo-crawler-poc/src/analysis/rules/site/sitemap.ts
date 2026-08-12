/** Slice A4 — sitemap hygiene four-pack. Computed independently from ctx.sitemap.entries +
 * ctx.pages + ctx.failures (pathname-based matching, alias/redirect-safe — scripts/lib/records.ts
 * convention) rather than trusting the crawler's own report.sitemap.* fields, so the analyzer
 * stays correct even if the report builder's cross-ref logic diverges. */
import type { Issue, RuleMeta } from "../../../models/types";
import { httpFailurePaths, isRuleEnabled, pageByPath, pageIdFor, pathnameOf, primaryUrl, resolvedSeverity } from "./helpers";
import type { SiteRule, SiteRuleContext } from "./types";

function crawledPathSet(ctx: SiteRuleContext): Set<string> {
  const set = new Set<string>();
  for (const p of ctx.pages) {
    const req = pathnameOf(primaryUrl(p));
    const landed = pathnameOf(p.finalUrl);
    if (req) set.add(req);
    if (landed) set.add(landed);
  }
  return set;
}

const sitemap404Meta: RuleMeta = {
  id: "sitemap-404-entry",
  category: "sitemap",
  defaultSeverity: "warning",
  description: "A URL listed in the sitemap failed with a 4xx/5xx status when crawled.",
  howToFix: "Remove the URL from the sitemap or fix the page so it resolves successfully.",
  dataRequirements: ["sitemap"],
};

export const sitemap404Rule: SiteRule = {
  meta: sitemap404Meta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(sitemap404Meta.id, config)) return null;
    if (!ctx.sitemap) return null;
    const severity = resolvedSeverity(sitemap404Meta.id, sitemap404Meta.defaultSeverity, config);
    const failedPaths = httpFailurePaths(ctx.failures);
    const issues: Issue[] = [];
    const seen = new Set<string>();
    for (const entry of ctx.sitemap.entries) {
      const path = pathnameOf(entry.url);
      if (!path || !failedPaths.has(path) || seen.has(path)) continue;
      seen.add(path);
      issues.push({
        ruleId: sitemap404Meta.id,
        category: sitemap404Meta.category,
        severity,
        scope: "site",
        url: entry.url,
        pageId: null,
        message: `Sitemap references ${entry.url}, which returns a 4xx/5xx status`,
        howToFix: sitemap404Meta.howToFix,
        evidence: [{ field: "entries", value: entry.url }],
      });
    }
    return issues;
  },
};

const sitemapNoindexMeta: RuleMeta = {
  id: "sitemap-noindex-included",
  category: "sitemap",
  defaultSeverity: "warning",
  description: "A URL listed in the sitemap is marked noindex — wastes crawl budget on a page that won't be indexed.",
  howToFix: "Remove noindexed URLs from the sitemap, or remove the noindex if the page should be indexed.",
  dataRequirements: ["sitemap", "robots.noindex"],
};

export const sitemapNoindexIncludedRule: SiteRule = {
  meta: sitemapNoindexMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(sitemapNoindexMeta.id, config)) return null;
    if (!ctx.sitemap) return null;
    const severity = resolvedSeverity(sitemapNoindexMeta.id, sitemapNoindexMeta.defaultSeverity, config);
    const sitemapPaths = new Set(ctx.sitemap.entries.map((e) => pathnameOf(e.url)).filter((p): p is string => p !== null));
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (!page.robots.noindex) continue;
      const path = pathnameOf(primaryUrl(page));
      if (!path || !sitemapPaths.has(path)) continue;
      issues.push({
        ruleId: sitemapNoindexMeta.id,
        category: sitemapNoindexMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} is noindex but still listed in the sitemap`,
        howToFix: sitemapNoindexMeta.howToFix,
        evidence: [{ field: "robots.noindex", value: page.robots.noindex }],
      });
    }
    return issues;
  },
};

const inSitemapNotCrawledMeta: RuleMeta = {
  id: "sitemap-not-crawled",
  category: "sitemap",
  defaultSeverity: "notice",
  description: "A URL is listed in the sitemap but was never reached by the crawl (not a 4xx/5xx entry).",
  howToFix: "Confirm the URL is reachable via internal links, or remove it from the sitemap if intentional.",
  dataRequirements: ["sitemap"],
};

export const inSitemapNotCrawledRule: SiteRule = {
  meta: inSitemapNotCrawledMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(inSitemapNotCrawledMeta.id, config)) return null;
    if (!ctx.sitemap) return null;
    const severity = resolvedSeverity(inSitemapNotCrawledMeta.id, inSitemapNotCrawledMeta.defaultSeverity, config);
    const crawled = crawledPathSet(ctx);
    const failedPaths = httpFailurePaths(ctx.failures);
    const issues: Issue[] = [];
    const seen = new Set<string>();
    for (const entry of ctx.sitemap.entries) {
      const path = pathnameOf(entry.url);
      if (!path || crawled.has(path) || failedPaths.has(path) || seen.has(path)) continue;
      seen.add(path);
      issues.push({
        ruleId: inSitemapNotCrawledMeta.id,
        category: inSitemapNotCrawledMeta.category,
        severity,
        scope: "site",
        url: entry.url,
        pageId: null,
        message: `Sitemap lists ${entry.url}, which the crawl never reached`,
        howToFix: inSitemapNotCrawledMeta.howToFix,
        evidence: [{ field: "entries", value: entry.url }],
      });
    }
    return issues;
  },
};

const crawledNotInSitemapMeta: RuleMeta = {
  id: "crawled-not-in-sitemap",
  category: "sitemap",
  defaultSeverity: "notice",
  description: "A successfully crawled page is missing from the sitemap.",
  howToFix: "Add the URL to the sitemap so search engines can discover it directly.",
  dataRequirements: ["sitemap"],
};

export const crawledNotInSitemapRule: SiteRule = {
  meta: crawledNotInSitemapMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(crawledNotInSitemapMeta.id, config)) return null;
    if (!ctx.sitemap) return null;
    const severity = resolvedSeverity(crawledNotInSitemapMeta.id, crawledNotInSitemapMeta.defaultSeverity, config);
    const sitemapPaths = new Set(ctx.sitemap.entries.map((e) => pathnameOf(e.url)).filter((p): p is string => p !== null));
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (page.statusCode !== null && page.statusCode >= 400) continue;
      const path = pathnameOf(primaryUrl(page));
      if (!path || sitemapPaths.has(path)) continue;
      const landed = pathnameOf(page.finalUrl);
      if (landed && sitemapPaths.has(landed)) continue;
      issues.push({
        ruleId: crawledNotInSitemapMeta.id,
        category: crawledNotInSitemapMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} was crawled successfully but is absent from the sitemap`,
        howToFix: crawledNotInSitemapMeta.howToFix,
        evidence: [{ field: "normalizedUrl", value: page.normalizedUrl }],
      });
    }
    return issues;
  },
};
