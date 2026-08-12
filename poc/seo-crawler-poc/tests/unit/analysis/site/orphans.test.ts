import { describe, expect, it } from "vitest";
import { orphanPageRule } from "../../../../src/analysis/rules/site/orphans";
import { makeConfig, makeContext, makePage } from "./fixtures";
import type { CrawlSummary } from "../../../../src/models/types";

function makeSummary(overrides: Partial<CrawlSummary>): CrawlSummary {
  return {
    runId: "test-run",
    startUrl: "https://x.test/",
    startedAt: "2026-08-12T00:00:00.000Z",
    finishedAt: "2026-08-12T00:01:00.000Z",
    durationMs: 60000,
    discovered: 1,
    unique: 1,
    allowed: 1,
    blockedByRobots: 0,
    attempted: 1,
    successful: 1,
    failed: 0,
    redirects: 0,
    statusHistogram: { "200": 1 },
    jsRendered: 0,
    internalLinks: 0,
    externalLinks: 0,
    orphanCandidates: [],
    coveragePercent: 100,
    maxDepthSeen: 0,
    sitemap: { urlsInSitemap: 0, inSitemapNotCrawled: [], crawledNotInSitemap: [], sitemapEntriesFailed: [] },
    failuresByClass: {},
    ...overrides,
  };
}

describe("orphanPageRule", () => {
  it("fires one issue per crawler-computed orphan candidate", () => {
    const page = makePage({ url: "https://x.test/gear-archive" });
    const summary = makeSummary({ orphanCandidates: ["https://x.test/gear-archive"] });
    const issues = orphanPageRule.evaluate(makeContext({ pages: [page], summary }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.ruleId).toBe("orphan-page");
    expect(issues[0]!.pageId).not.toBeNull();
  });

  it("does not fire when there are no orphan candidates", () => {
    const summary = makeSummary({ orphanCandidates: [] });
    const issues = orphanPageRule.evaluate(makeContext({ summary }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("returns null (data-unavailable) when the run has no report/summary", () => {
    const issues = orphanPageRule.evaluate(makeContext({ summary: null }), makeConfig());
    expect(issues).toBeNull();
  });
});
