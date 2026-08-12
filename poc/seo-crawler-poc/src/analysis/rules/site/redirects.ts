/** Slice A4 — redirect chains (>1 hop) and redirect loops. */
import type { Issue, RuleMeta } from "../../../models/types";
import { isRuleEnabled, pageIdFor, primaryUrl, resolvedSeverity } from "./helpers";
import type { SiteRule } from "./types";

const chainMeta: RuleMeta = {
  id: "redirect-chain",
  category: "redirects",
  defaultSeverity: "warning",
  description: "A page's redirect chain has more hops than the configured maximum.",
  howToFix: "Point the link directly at the final destination URL, collapsing the chain to one hop.",
  dataRequirements: ["redirectChain"],
};

export const redirectChainRule: SiteRule = {
  meta: chainMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(chainMeta.id, config)) return null;
    const severity = resolvedSeverity(chainMeta.id, chainMeta.defaultSeverity, config);
    const max = config.thresholds.redirectChainMax;
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (page.redirectChain.length <= max) continue;
      issues.push({
        ruleId: chainMeta.id,
        category: chainMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} redirects through ${page.redirectChain.length} hops before landing on ${page.finalUrl ?? "?"}`,
        howToFix: chainMeta.howToFix,
        threshold: `redirectChain.length > ${max} (was ${page.redirectChain.length})`,
        evidence: [{ field: "redirectChain", value: page.redirectChain }],
      });
    }
    return issues;
  },
};

const loopMeta: RuleMeta = {
  id: "redirect-loop",
  category: "redirects",
  defaultSeverity: "error",
  description: "A URL redirects back to itself (directly or via a cycle) and never resolves.",
  howToFix: "Fix the redirect rule so the chain terminates at a real page.",
  dataRequirements: ["failures"],
};

export const redirectLoopRule: SiteRule = {
  meta: loopMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(loopMeta.id, config)) return null;
    const severity = resolvedSeverity(loopMeta.id, loopMeta.defaultSeverity, config);
    return ctx.failures
      .filter((f) => f.reason === "redirect-loop")
      .map((f) => ({
        ruleId: loopMeta.id,
        category: loopMeta.category,
        severity,
        scope: "site" as const,
        url: f.url,
        pageId: null,
        message: `${f.url} is a redirect loop and never resolves`,
        howToFix: loopMeta.howToFix,
        evidence: [{ field: "reason", value: f.reason }],
      }));
  },
};
