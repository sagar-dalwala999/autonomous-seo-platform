/** Slice A4 — robots-blocked inventory. Informational by default (spec: "(notice)") — these
 * URLs were never fetched, so this is evidence of robots.txt working as configured, not
 * necessarily a problem. */
import type { Issue, RuleMeta } from "../../../models/types";
import { isRuleEnabled, resolvedSeverity } from "./helpers";
import type { SiteRule } from "./types";

const meta: RuleMeta = {
  id: "robots-blocked",
  category: "robots",
  defaultSeverity: "notice",
  description: "A URL was blocked by robots.txt and never fetched during this crawl.",
  howToFix: "Confirm the block is intentional; update robots.txt if the page should be crawlable.",
  dataRequirements: ["blocked"],
};

export const robotsBlockedRule: SiteRule = {
  meta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(meta.id, config)) return null;
    const severity = resolvedSeverity(meta.id, meta.defaultSeverity, config);
    return ctx.blocked.map((url) => ({
      ruleId: meta.id,
      category: meta.category,
      severity,
      scope: "site" as const,
      url,
      pageId: null,
      message: `${url} is blocked by robots.txt`,
      howToFix: meta.howToFix,
      evidence: [{ field: "blocked", value: url }],
    }));
  },
};
