/** Slice A4 — weakly-linked pages, canonical-target validity, broken internal links (MF-3: the
 * latter two are cross-page lookups, hence site-scope even though each finding anchors to a
 * single source page). */
import type { Issue, RuleMeta } from "../../../models/types";
import {
  buildInlinkOccurrences,
  httpFailurePaths,
  httpFailureStatusByPath,
  AUTH_REQUIRED_STATUSES,
  isRuleEnabled,
  pageByPath,
  pageIdFor,
  pathnameOf,
  primaryUrl,
  resolvedSeverity,
} from "./helpers";
import type { SiteRule, SiteRuleContext } from "./types";

const weaklyLinkedMeta: RuleMeta = {
  id: "weakly-linked",
  category: "links",
  defaultSeverity: "warning",
  description: "A crawled non-seed page has exactly one internal inlink.",
  howToFix: "Add more internal links to this page from relevant content.",
  dataRequirements: ["crawl"],
};

export const weaklyLinkedRule: SiteRule = {
  meta: weaklyLinkedMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(weaklyLinkedMeta.id, config)) return null;
    const severity = resolvedSeverity(weaklyLinkedMeta.id, weaklyLinkedMeta.defaultSeverity, config);
    const want = config.thresholds.weakInlinkCount;
    const occurrences = buildInlinkOccurrences(ctx.pages);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (page.crawl.depth === 0) continue; // seed excluded — not meaningfully "weakly linked"
      const path = pathnameOf(primaryUrl(page));
      if (!path) continue;
      const occ = occurrences.get(path) ?? [];
      if (occ.length !== want) continue;
      const sources = occ.map((o) => primaryUrl(o.source));
      issues.push({
        ruleId: weaklyLinkedMeta.id,
        category: weaklyLinkedMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} has only ${occ.length} internal inlink(s), from: ${sources.join(", ")}`,
        howToFix: weaklyLinkedMeta.howToFix,
        threshold: `inlink count === ${want} (was ${occ.length})`,
        evidence: occ.map((o) => ({
          field: `links[${o.linkIndex}].targetNormalized`,
          value: o.link.targetNormalized ?? o.link.target,
          pageId: pageIdFor(o.source.normalizedUrl),
        })),
      });
    }
    return issues;
  },
};

const canonicalMeta: RuleMeta = {
  id: "canonical-target-invalid",
  category: "canonical",
  defaultSeverity: "warning",
  description: "A page's canonical points at a URL that itself 4xx/5xxs, redirects, or is noindexed.",
  howToFix: "Point the canonical at a live, indexable, 200-status URL.",
  dataRequirements: ["canonical"],
};

function canonicalTargetProblem(ctx: SiteRuleContext, targetPath: string, failedPaths: Set<string>): string | null {
  if (failedPaths.has(targetPath)) return "target returns a 4xx/5xx status";
  const targetPage = pageByPath(ctx.pages, targetPath);
  if (!targetPage) return null; // never crawled, not in failures — inconclusive, not flagged
  if (targetPage.statusCode !== null && targetPage.statusCode >= 400) return `target returns ${targetPage.statusCode}`;
  if (targetPage.redirectChain.length > 0) return "target itself redirects elsewhere";
  if (targetPage.robots.noindex) return "target is noindex";
  return null;
}

export const canonicalTargetValidityRule: SiteRule = {
  meta: canonicalMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(canonicalMeta.id, config)) return null;
    const severity = resolvedSeverity(canonicalMeta.id, canonicalMeta.defaultSeverity, config);
    const failedPaths = httpFailurePaths(ctx.failures);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (!page.canonical) continue;
      const selfPath = pathnameOf(primaryUrl(page));
      const targetPath = pathnameOf(page.canonical);
      if (!targetPath || targetPath === selfPath) continue;
      const problem = canonicalTargetProblem(ctx, targetPath, failedPaths);
      if (!problem) continue;
      const targetPage = pageByPath(ctx.pages, targetPath);
      issues.push({
        ruleId: canonicalMeta.id,
        category: canonicalMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `Canonical on ${primaryUrl(page)} points at ${page.canonical}, but ${problem}`,
        howToFix: canonicalMeta.howToFix,
        evidence: [
          { field: "canonical", value: page.canonical },
          ...(targetPage ? [{ field: "statusCode", value: targetPage.statusCode, pageId: pageIdFor(targetPage.normalizedUrl) }] : []),
        ],
      });
    }
    return issues;
  },
};

const brokenLinkMeta: RuleMeta = {
  id: "broken-internal-link",
  category: "links",
  defaultSeverity: "error",
  description:
    "An internal link's target failed (4xx/5xx) or was recorded as a crawl failure. " +
    "401/403 targets are excluded — those are auth-required-link, not broken.",
  howToFix: "Fix or remove the link so it points at a live page.",
  dataRequirements: ["links"],
};

/** Effective status of a link target: the crawled record's, else the recorded failure's. */
function targetStatus(ctx: SiteRuleContext, targetPath: string, failedStatus: Map<string, number | null>): number | null {
  const targetPage = pageByPath(ctx.pages, targetPath);
  if (targetPage?.statusCode != null) return targetPage.statusCode;
  return failedStatus.get(targetPath) ?? null;
}

export const brokenInternalLinkRule: SiteRule = {
  meta: brokenLinkMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(brokenLinkMeta.id, config)) return null;
    const severity = resolvedSeverity(brokenLinkMeta.id, brokenLinkMeta.defaultSeverity, config);
    const failedPaths = httpFailurePaths(ctx.failures);
    const failedStatus = httpFailureStatusByPath(ctx.failures);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      page.links.forEach((link, index) => {
        if (link.type !== "internal") return;
        const targetPath = pathnameOf(link.targetNormalized ?? link.target);
        if (!targetPath) return;
        const targetPage = pageByPath(ctx.pages, targetPath);
        const isBroken =
          failedPaths.has(targetPath) || (targetPage?.statusCode !== null && targetPage?.statusCode !== undefined && targetPage.statusCode >= 400);
        if (!isBroken) return;
        const status = targetStatus(ctx, targetPath, failedStatus);
        if (status !== null && AUTH_REQUIRED_STATUSES.has(status)) return; // auth wall, not a dead link
        issues.push({
          ruleId: brokenLinkMeta.id,
          category: brokenLinkMeta.category,
          severity,
          scope: "site",
          url: primaryUrl(page),
          pageId: pageIdFor(page.normalizedUrl),
          message: `${primaryUrl(page)} links to ${link.target}, which fails${status === null ? "" : ` (${status})`}`,
          howToFix: brokenLinkMeta.howToFix,
          evidence: [{ field: `links[${index}].targetNormalized`, value: link.targetNormalized ?? link.target }],
        });
      });
    }
    return issues;
  },
};

const authRequiredLinkMeta: RuleMeta = {
  id: "auth-required-link",
  category: "links",
  defaultSeverity: "notice",
  description:
    "An internal link points at a target that returned 401 or 403. On an anonymous crawl this is " +
    "expected for a genuinely protected area, so it is reported as coverage information rather " +
    "than a defect. It is only a real problem if the target was meant to be public.",
  howToFix:
    "If the area is meant to be public, fix the access control. If it is genuinely protected, " +
    "re-crawl with credentials to cover it.",
  dataRequirements: ["links"],
};

export const authRequiredLinkRule: SiteRule = {
  meta: authRequiredLinkMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(authRequiredLinkMeta.id, config)) return null;
    const severity = resolvedSeverity(authRequiredLinkMeta.id, authRequiredLinkMeta.defaultSeverity, config);
    const failedStatus = httpFailureStatusByPath(ctx.failures);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      page.links.forEach((link, index) => {
        if (link.type !== "internal") return;
        const targetPath = pathnameOf(link.targetNormalized ?? link.target);
        if (!targetPath) return;
        const status = targetStatus(ctx, targetPath, failedStatus);
        if (status === null || !AUTH_REQUIRED_STATUSES.has(status)) return;
        issues.push({
          ruleId: authRequiredLinkMeta.id,
          category: authRequiredLinkMeta.category,
          severity,
          scope: "site",
          url: primaryUrl(page),
          pageId: pageIdFor(page.normalizedUrl),
          message: `${primaryUrl(page)} links to ${link.target}, which requires authentication (${status})`,
          howToFix: authRequiredLinkMeta.howToFix,
          evidence: [{ field: `links[${index}].targetNormalized`, value: link.targetNormalized ?? link.target }],
        });
      });
    }
    return issues;
  },
};
