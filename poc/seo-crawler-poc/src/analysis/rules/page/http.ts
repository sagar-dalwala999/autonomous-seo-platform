/** HTTP status / response-time rule pack. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { issueFor } from "./shared";

function http4xx(): PageRule {
  const meta: RuleMeta = {
    id: "http-error-4xx",
    category: "http",
    defaultSeverity: "error",
    description: "Page returned a 4xx client-error status.",
    howToFix: "Fix the broken URL, or redirect/remove links pointing at it.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.statusCode === null || page.statusCode < 400 || page.statusCode >= 500) return [];
      return [
        issueFor(meta, config, page, {
          message: `Page returned status ${page.statusCode}.`,
          evidence: [{ field: "statusCode", value: page.statusCode }],
        }),
      ];
    },
  };
}

function http5xx(): PageRule {
  const meta: RuleMeta = {
    id: "http-error-5xx",
    category: "http",
    defaultSeverity: "error",
    description: "Page returned a 5xx server-error status.",
    howToFix: "Investigate the server error; this URL is unreachable for crawlers and users alike.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.statusCode === null || page.statusCode < 500 || page.statusCode >= 600) return [];
      return [
        issueFor(meta, config, page, {
          message: `Page returned status ${page.statusCode}.`,
          evidence: [{ field: "statusCode", value: page.statusCode }],
        }),
      ];
    },
  };
}

function slowPage(): PageRule {
  const meta: RuleMeta = {
    id: "slow-page",
    category: "http",
    defaultSeverity: "warning", // heuristic (MF-5): threshold-based, never error
    description: "Page response time exceeds the configured slow-page threshold.",
    howToFix: "Investigate server/TTFB latency for this URL.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const ms = page.performance.responseTimeMs;
      if (ms === null || ms <= config.thresholds.slowPageMs) return [];
      return [
        issueFor(meta, config, page, {
          message: `Response time was ${ms}ms.`,
          evidence: [{ field: "performance.responseTimeMs", value: ms }],
          threshold: `responseTimeMs ${ms} > max ${config.thresholds.slowPageMs}`,
        }),
      ];
    },
  };
}

export function httpRules(): PageRule[] {
  return [http4xx(), http5xx(), slowPage()];
}
