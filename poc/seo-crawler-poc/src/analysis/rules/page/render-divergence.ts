/** Raw-vs-rendered indexing conflicts. We already stored both renders and never read them —
 * gap surfaced by the claude-seo teardown (research/competitor-claude-seo.md §4). */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { issueFor } from "./shared";

function jsAppliedNoindex(): PageRule {
  const meta: RuleMeta = {
    id: "js-applied-noindex",
    category: "indexability",
    defaultSeverity: "error",
    description:
      "The raw HTML is indexable but the rendered DOM adds noindex — JavaScript is deindexing the " +
      "page. Google indexes the rendered result, so the page drops out despite the source looking fine.",
    howToFix: "Remove the noindex your client-side code injects, or serve the correct directive in the raw HTML.",
    dataRequirements: ["renderDivergence"],
  };
  return {
    meta,
    evaluate(page, config) {
      const d = page.renderDivergence;
      if (!d || d.staticNoindex === undefined || d.renderedNoindex === undefined) return null;
      if (!(d.staticNoindex === false && d.renderedNoindex === true)) return [];
      return [
        issueFor(meta, config, page, {
          message: "Raw HTML is indexable but the rendered page is noindex — JavaScript is deindexing it.",
          evidence: [
            { field: "renderDivergence.staticNoindex", value: d.staticNoindex },
            { field: "renderDivergence.renderedNoindex", value: d.renderedNoindex },
          ],
        }),
      ];
    },
  };
}

function noindexInRawHtmlOnly(): PageRule {
  const meta: RuleMeta = {
    id: "noindex-in-raw-html-only",
    category: "indexability",
    defaultSeverity: "error",
    description:
      "The raw HTML says noindex and only the rendered DOM removes it. Googlebot may drop the page " +
      "before it ever renders, so the client-side correction is never seen — the opposite direction " +
      "of js-applied-noindex, and a different fix.",
    howToFix: "Serve the page without noindex in the raw HTML; do not rely on JavaScript to remove it.",
    dataRequirements: ["renderDivergence"],
  };
  return {
    meta,
    evaluate(page, config) {
      const d = page.renderDivergence;
      if (!d || d.staticNoindex === undefined || d.renderedNoindex === undefined) return null;
      if (!(d.staticNoindex === true && d.renderedNoindex === false)) return [];
      return [
        issueFor(meta, config, page, {
          message: "Raw HTML is noindex and only JavaScript removes it — Google may never render this page.",
          evidence: [
            { field: "renderDivergence.staticNoindex", value: d.staticNoindex },
            { field: "renderDivergence.renderedNoindex", value: d.renderedNoindex },
          ],
        }),
      ];
    },
  };
}

function canonicalChangedByJs(): PageRule {
  const meta: RuleMeta = {
    id: "canonical-changed-by-js",
    category: "canonical",
    defaultSeverity: "warning",
    description:
      "The canonical URL differs between the raw HTML and the rendered DOM. Google uses the rendered " +
      "value, so the raw one is misleading, and a canonical that only appears after render is at the " +
      "mercy of the render queue.",
    howToFix: "Serve one consistent canonical in the raw HTML rather than rewriting it client-side.",
    dataRequirements: ["renderDivergence"],
  };
  return {
    meta,
    evaluate(page, config) {
      const d = page.renderDivergence;
      if (!d || d.staticCanonical === undefined || d.renderedCanonical === undefined) return null;
      if (d.staticCanonical === d.renderedCanonical) return [];
      const appeared = d.staticCanonical === null && d.renderedCanonical !== null;
      const removed = d.staticCanonical !== null && d.renderedCanonical === null;
      const detail = appeared
        ? "canonical only exists after rendering"
        : removed
          ? "canonical is removed by rendering"
          : "canonical points somewhere else after rendering";
      return [
        issueFor(meta, config, page, {
          message: `Canonical differs between raw and rendered HTML — ${detail}.`,
          evidence: [
            { field: "renderDivergence.staticCanonical", value: d.staticCanonical },
            { field: "renderDivergence.renderedCanonical", value: d.renderedCanonical },
          ],
        }),
      ];
    },
  };
}

export function renderDivergenceRules(): PageRule[] {
  return [jsAppliedNoindex(), noindexInRawHtmlOnly(), canonicalChangedByJs()];
}
