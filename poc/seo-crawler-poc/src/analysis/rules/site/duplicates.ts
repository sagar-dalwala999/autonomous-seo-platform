/** Slice A4 — duplicate-title / duplicate-description / exact-dup / near-dup content clusters. */
import type { CrawledPage, Issue, RuleMeta } from "../../../models/types";
import { buildClusters, isRuleEnabled, pageIdFor, primaryUrl, pathnameOf, resolvedSeverity, sectionPrefix } from "./helpers";
import type { SiteRule } from "./types";

function clusterIssues(
  members: CrawledPage[],
  meta: RuleMeta,
  severity: Issue["severity"],
  field: "title" | "metaDescription",
  clusterValue: string,
): Issue[] {
  return members.map((page) => {
    const others = members.filter((m) => m !== page);
    return {
      ruleId: meta.id,
      category: meta.category,
      severity,
      scope: "site",
      url: primaryUrl(page),
      pageId: pageIdFor(page.normalizedUrl),
      message: `${field === "title" ? "Title" : "Meta description"} duplicated across ${members.length} pages: "${clusterValue}"`,
      howToFix: meta.howToFix,
      evidence: [
        { field, value: page[field] },
        ...others.map((o) => ({ field, value: o[field], pageId: pageIdFor(o.normalizedUrl) })),
      ],
    };
  });
}

const duplicateTitleMeta: RuleMeta = {
  id: "duplicate-title",
  category: "duplicates",
  defaultSeverity: "warning",
  description: "Two or more crawled pages share the exact same <title>.",
  howToFix: "Write a unique, descriptive title for each page.",
  dataRequirements: ["title"],
};

export const duplicateTitleRule: SiteRule = {
  meta: duplicateTitleMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(duplicateTitleMeta.id, config)) return null;
    const severity = resolvedSeverity(duplicateTitleMeta.id, duplicateTitleMeta.defaultSeverity, config);
    const clusters = buildClusters(ctx.pages, (p) => (p.title && p.title.trim() ? p.title.trim() : null));
    const issues: Issue[] = [];
    for (const [value, members] of clusters) {
      issues.push(...clusterIssues(members, duplicateTitleMeta, severity, "title", value));
    }
    return issues;
  },
};

const duplicateDescriptionMeta: RuleMeta = {
  id: "duplicate-description",
  category: "duplicates",
  defaultSeverity: "warning",
  description: "Two or more crawled pages share the exact same meta description.",
  howToFix: "Write a unique meta description for each page.",
  dataRequirements: ["metaDescription"],
};

export const duplicateDescriptionRule: SiteRule = {
  meta: duplicateDescriptionMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(duplicateDescriptionMeta.id, config)) return null;
    const severity = resolvedSeverity(duplicateDescriptionMeta.id, duplicateDescriptionMeta.defaultSeverity, config);
    const clusters = buildClusters(ctx.pages, (p) =>
      p.metaDescription && p.metaDescription.trim() ? p.metaDescription.trim() : null,
    );
    const issues: Issue[] = [];
    for (const [value, members] of clusters) {
      issues.push(...clusterIssues(members, duplicateDescriptionMeta, severity, "metaDescription", value));
    }
    return issues;
  },
};

const exactDuplicateContentMeta: RuleMeta = {
  id: "exact-duplicate-content",
  category: "duplicates",
  defaultSeverity: "warning",
  description: "Two or more crawled pages have byte-identical extracted content (same contentHash).",
  howToFix: "Merge, canonicalize, or differentiate the duplicate pages.",
  dataRequirements: ["content.contentHash"],
};

export const exactDuplicateContentRule: SiteRule = {
  meta: exactDuplicateContentMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(exactDuplicateContentMeta.id, config)) return null;
    const severity = resolvedSeverity(exactDuplicateContentMeta.id, exactDuplicateContentMeta.defaultSeverity, config);
    const clusters = buildClusters(ctx.pages, (p) => (p.content.wordCount > 0 ? p.content.contentHash : null));
    const issues: Issue[] = [];
    for (const [hash, members] of clusters) {
      for (const page of members) {
        const others = members.filter((m) => m !== page);
        issues.push({
          ruleId: exactDuplicateContentMeta.id,
          category: exactDuplicateContentMeta.category,
          severity,
          scope: "site",
          url: primaryUrl(page),
          pageId: pageIdFor(page.normalizedUrl),
          message: `Content is byte-identical to ${others.length} other page(s) (contentHash ${hash.slice(0, 12)})`,
          howToFix: exactDuplicateContentMeta.howToFix,
          evidence: [
            { field: "content.contentHash", value: page.content.contentHash },
            ...others.map((o) => ({ field: "content.contentHash", value: o.content.contentHash, pageId: pageIdFor(o.normalizedUrl) })),
          ],
        });
      }
    }
    return issues;
  },
};

const nearDuplicateContentMeta: RuleMeta = {
  id: "near-duplicate-content",
  category: "duplicates",
  defaultSeverity: "notice",
  description:
    "Two pages in the same site section have near-identical word counts (POC proxy — wordCount " +
    "delta within threshold, NOT a real similarity score; minhash/shingling is Tier 2 future work).",
  howToFix: "Review for content overlap; differentiate or consolidate if truly duplicative.",
  dataRequirements: ["content.wordCount"],
};

export const nearDuplicateContentRule: SiteRule = {
  meta: nearDuplicateContentMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(nearDuplicateContentMeta.id, config)) return null;
    const severity = resolvedSeverity(nearDuplicateContentMeta.id, nearDuplicateContentMeta.defaultSeverity, config);
    const pct = config.thresholds.nearDupWordCountDeltaPct;
    const issues: Issue[] = [];
    // Cluster, never pairwise: O(n²) pair emission produced ~1M issues on a 1.2k-page catalog
    // (books.toscrape) and blew the stack. Sort by wordCount per section, chain adjacent pages
    // within the threshold into clusters (transitive — documented POC proxy), one issue per
    // member with capped peer evidence.
    const bySection = new Map<string, typeof ctx.pages>();
    for (const page of ctx.pages) {
      if (page.content.wordCount === 0) continue;
      const section = sectionPrefix(pathnameOf(primaryUrl(page)));
      if (!section) continue;
      const list = bySection.get(section);
      if (list) list.push(page);
      else bySection.set(section, [page]);
    }
    for (const pages of bySection.values()) {
      const sorted = [...pages].sort((a, b) => a.content.wordCount - b.content.wordCount);
      let cluster: typeof sorted = [];
      const flush = (): void => {
        if (cluster.length < 2) {
          cluster = [];
          return;
        }
        // Skip members that are exact dups of another member — exact-dup rule's job.
        const hashes = new Map<string, number>();
        for (const m of cluster) hashes.set(m.content.contentHash, (hashes.get(m.content.contentHash) ?? 0) + 1);
        const members = cluster.filter((m) => (hashes.get(m.content.contentHash) ?? 0) === 1);
        if (members.length >= 2) {
          for (const page of members) {
            const peers = members.filter((m) => m !== page).slice(0, 5);
            issues.push({
              ruleId: nearDuplicateContentMeta.id,
              category: nearDuplicateContentMeta.category,
              severity,
              scope: "site",
              url: primaryUrl(page),
              pageId: pageIdFor(page.normalizedUrl),
              message: `Near-duplicate wordCount cluster of ${members.length} pages in this section (this page: ${page.content.wordCount} words)`,
              howToFix: nearDuplicateContentMeta.howToFix,
              threshold: `adjacent wordCount delta <= ${pct}% within section`,
              evidence: [
                { field: "content.wordCount", value: page.content.wordCount },
                ...peers.map((m) => ({ field: "content.wordCount", value: m.content.wordCount, pageId: pageIdFor(m.normalizedUrl) })),
              ],
            });
          }
        }
        cluster = [];
      };
      for (const page of sorted) {
        const prev = cluster[cluster.length - 1];
        if (!prev) {
          cluster.push(page);
          continue;
        }
        const wa = prev.content.wordCount;
        const wb = page.content.wordCount;
        const deltaPct = (Math.abs(wa - wb) / Math.max(wa, wb)) * 100;
        if (deltaPct <= pct) cluster.push(page);
        else {
          flush();
          cluster.push(page);
        }
      }
      flush();
    }
    return issues;
  },
};
