/** Slice A4 implements — site-scope passes over the whole run (registry). */
export type { SiteRule, SiteRuleContext } from "./types";
import type { SiteRule } from "./types";
import { duplicateTitleRule, duplicateDescriptionRule, exactDuplicateContentRule, nearDuplicateContentRule } from "./duplicates";
import { orphanPageRule } from "./orphans";
import { sitemap404Rule, sitemapNoindexIncludedRule, inSitemapNotCrawledRule, crawledNotInSitemapRule } from "./sitemap";
import { robotsBlockedRule } from "./robots";
import { redirectChainRule, redirectLoopRule } from "./redirects";
import { weaklyLinkedRule, canonicalTargetValidityRule, brokenInternalLinkRule, authRequiredLinkRule } from "./links";
import { internalLinkSchemeMixRule, internalLinkWwwMixRule } from "./link-consistency";
import { hreflangReciprocityRule } from "./hreflang";

export function siteRules(): SiteRule[] {
  return [
    duplicateTitleRule,
    duplicateDescriptionRule,
    exactDuplicateContentRule,
    nearDuplicateContentRule,
    orphanPageRule,
    sitemap404Rule,
    sitemapNoindexIncludedRule,
    inSitemapNotCrawledRule,
    crawledNotInSitemapRule,
    robotsBlockedRule,
    redirectChainRule,
    redirectLoopRule,
    weaklyLinkedRule,
    canonicalTargetValidityRule,
    brokenInternalLinkRule,
    authRequiredLinkRule,
    internalLinkSchemeMixRule,
    internalLinkWwwMixRule,
    hreflangReciprocityRule,
  ];
}
