/** Thin content / text-ratio rule pack. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { issueFor } from "./shared";

function thinContent(): PageRule {
  const meta: RuleMeta = {
    id: "thin-content",
    category: "content",
    defaultSeverity: "warning", // heuristic (MF-5): threshold-based, never error
    description: "Page's extracted text is below the configured word-count threshold.",
    howToFix: "Add substantive, unique content, or noindex the page if it's intentionally minimal (e.g. a utility page).",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.content.wordCount >= config.thresholds.thinContentWords) return [];
      return [
        issueFor(meta, config, page, {
          message: `Page has only ${page.content.wordCount} words of extracted content.`,
          evidence: [{ field: "content.wordCount", value: page.content.wordCount }],
          threshold: `wordCount ${page.content.wordCount} < min ${config.thresholds.thinContentWords}`,
        }),
      ];
    },
  };
}

function lowTextRatio(): PageRule {
  const meta: RuleMeta = {
    id: "low-text-ratio",
    category: "content",
    defaultSeverity: "notice", // heuristic (MF-5): threshold-based, never error
    description: "Visible text is a small fraction of total HTML bytes — markup-heavy / content-light page.",
    howToFix: "Reduce boilerplate markup or add more substantive content.",
    dataRequirements: ["pageStats"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.pageStats === undefined) return null;
      if (page.pageStats.textRatio >= config.thresholds.lowTextRatio) return [];
      return [
        issueFor(meta, config, page, {
          message: `Text-to-HTML ratio is ${(page.pageStats.textRatio * 100).toFixed(1)}%.`,
          evidence: [{ field: "pageStats.textRatio", value: page.pageStats.textRatio }],
          threshold: `textRatio ${page.pageStats.textRatio.toFixed(3)} < min ${config.thresholds.lowTextRatio}`,
        }),
      ];
    },
  };
}

export function contentRules(): PageRule[] {
  return [thinContent(), lowTextRatio()];
}
