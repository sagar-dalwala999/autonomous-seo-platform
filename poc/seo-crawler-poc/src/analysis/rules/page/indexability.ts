/** noindex / canonical / meta-refresh rule pack. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { issueFor } from "./shared";

/** Loose same-URL check (ignores scheme, www prefix, trailing slash) — good enough to tell
 * "canonical points at a totally different URL" from "canonical is just the page's own URL". */
function sameUrl(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const norm = (u: URL) => `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "") || "/"}${u.search}`;
    return norm(ua) === norm(ub);
  } catch {
    return true; // unparseable — don't false-fire a mismatch we can't verify
  }
}

function noindex(): PageRule {
  const meta: RuleMeta = {
    id: "noindex",
    category: "indexability",
    defaultSeverity: "error",
    description: "Page is marked noindex via <meta name=\"robots\"> or the X-Robots-Tag header.",
    howToFix: "Remove the noindex directive if this page should appear in search results.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!page.robots.noindex) return [];
      return [
        issueFor(meta, config, page, {
          message: "Page is set to noindex.",
          evidence: [
            { field: "robots.noindex", value: true },
            { field: "robots.meta", value: page.robots.meta },
          ],
        }),
      ];
    },
  };
}

function canonicalMismatch(): PageRule {
  const meta: RuleMeta = {
    id: "canonical-mismatch",
    category: "indexability",
    defaultSeverity: "warning",
    description: "Canonical tag points at a different URL than the page itself.",
    howToFix: "Confirm the canonical target is intentional, or point it at this page's own URL.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.canonical === null) return [];
      const self = page.finalUrl ?? page.url;
      if (sameUrl(page.canonical, self)) return [];
      return [
        issueFor(meta, config, page, {
          message: `Canonical points at a different URL: ${page.canonical}`,
          evidence: [
            { field: "canonical", value: page.canonical },
            { field: "url", value: self },
          ],
        }),
      ];
    },
  };
}

function canonicalAbsent(): PageRule {
  const meta: RuleMeta = {
    id: "canonical-absent",
    category: "indexability",
    defaultSeverity: "notice",
    description: "Page has no canonical tag.",
    howToFix: "Add a self-referencing (or intentionally cross-page) canonical tag.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.canonical !== null) return [];
      return [issueFor(meta, config, page, { message: "No canonical tag present.", evidence: [{ field: "canonical", value: null }] })];
    },
  };
}

function metaRefreshPresent(): PageRule {
  const meta: RuleMeta = {
    id: "meta-refresh-present",
    category: "indexability",
    defaultSeverity: "warning",
    description: "Page uses a meta-refresh redirect instead of an HTTP redirect.",
    howToFix: "Replace the meta-refresh with a proper 301/302 HTTP redirect.",
    dataRequirements: ["metaRefresh"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.metaRefresh === undefined) return null;
      if (page.metaRefresh === null) return [];
      return [
        issueFor(meta, config, page, {
          message: `Meta-refresh redirect to ${page.metaRefresh.url ?? "(same page)"} after ${page.metaRefresh.delaySeconds ?? "?"}s.`,
          evidence: [{ field: "metaRefresh", value: page.metaRefresh }],
        }),
      ];
    },
  };
}

export function indexabilityRules(): PageRule[] {
  return [noindex(), canonicalMismatch(), canonicalAbsent(), metaRefreshPresent()];
}
