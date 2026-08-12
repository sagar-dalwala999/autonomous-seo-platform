/** OpenGraph / Twitter card rule pack. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { issueFor } from "./shared";

function ogMissing(): PageRule {
  const meta: RuleMeta = {
    id: "og-missing",
    category: "social",
    defaultSeverity: "notice",
    description: "Page has no OpenGraph (og:*) tags.",
    howToFix: "Add og:title, og:description, and og:image for clean social-share previews.",
    dataRequirements: ["social"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.social === undefined) return null;
      if (Object.keys(page.social.og).length > 0) return [];
      return [issueFor(meta, config, page, { message: "No OpenGraph tags found.", evidence: [{ field: "social.og", value: page.social.og }] })];
    },
  };
}

function twitterMissing(): PageRule {
  const meta: RuleMeta = {
    id: "twitter-missing",
    category: "social",
    defaultSeverity: "notice",
    description: "Page has no Twitter card (twitter:*) tags.",
    howToFix: "Add twitter:card, twitter:title, and twitter:image for clean X/Twitter previews.",
    dataRequirements: ["social"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.social === undefined) return null;
      if (Object.keys(page.social.twitter).length > 0) return [];
      return [
        issueFor(meta, config, page, { message: "No Twitter card tags found.", evidence: [{ field: "social.twitter", value: page.social.twitter }] }),
      ];
    },
  };
}

export function socialRules(): PageRule[] {
  return [ogMissing(), twitterMissing()];
}
