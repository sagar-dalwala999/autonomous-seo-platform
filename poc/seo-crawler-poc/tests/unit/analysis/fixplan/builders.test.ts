import { describe, expect, it } from "vitest";
import {
  canonicalAbsentBuilder,
  mixedContentBuilder,
  imageMissingDimensionsBuilder,
  redirectChainBuilder,
  FIX_PLAN_BUILDERS,
} from "../../../../src/analysis/fixplan/builders";
import { CLASSIFICATIONS } from "../../../../src/analysis/automation/classification";
import type { CrawledPage, ImageRecord, Issue } from "../../../../src/models/types";

function makePage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    runId: "test-run",
    url: "https://x.test/page",
    normalizedUrl: "https://x.test/page",
    finalUrl: "https://x.test/page",
    statusCode: 200,
    redirectChain: [],
    headers: {},
    performance: { responseTimeMs: 1 },
    renderedWith: "http",
    renderSignals: [],
    fetchedAt: "2026-01-01T00:00:00.000Z",
    crawl: { depth: 1, parentUrl: null, discoverySources: ["seed"] },
    title: "t",
    metaDescription: "d",
    canonical: null,
    robots: { meta: [], noindex: false, nofollow: false },
    headings: { h1: [], h2: [], h3: [] },
    links: [],
    images: [],
    videos: [],
    structuredData: [],
    content: { text: "", wordCount: 0, contentHash: "hash" },
    ...overrides,
  };
}

function makeImage(overrides: Partial<ImageRecord> = {}): ImageRecord {
  return { url: "https://x.test/img.jpg", alt: null, width: null, height: null, format: "jpg", ...overrides };
}

function makeIssue(overrides: Partial<Issue> & Pick<Issue, "ruleId">): Issue {
  return {
    category: "test",
    severity: "notice",
    scope: "page",
    url: "https://x.test/page",
    pageId: "p1",
    message: "test message",
    howToFix: "fix it",
    evidence: [],
    ...overrides,
  };
}

describe("consistency: every auto-safe classification has a wired builder, and vice versa", () => {
  it("classification.ts auto-safe ids match builders.ts keys exactly", () => {
    const autoSafeIds = Object.entries(CLASSIFICATIONS)
      .filter(([, c]) => c.automation === "auto-safe")
      .map(([id]) => id)
      .sort();
    const builderIds = Object.keys(FIX_PLAN_BUILDERS).sort();
    expect(builderIds).toEqual(autoSafeIds);
  });
});

describe("canonicalAbsentBuilder", () => {
  it("self-references the page's finalUrl when a page record is available", () => {
    const page = makePage({ url: "https://x.test/a", finalUrl: "https://x.test/a-final" });
    const issue = makeIssue({ ruleId: "canonical-absent", url: "https://x.test/a" });
    const result = canonicalAbsentBuilder(issue, page);
    expect(result.skipped).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.change).toBe('<link rel="canonical" href="https://x.test/a-final">');
    expect(result.items[0]!.action).toBe("add-tag");
  });

  it("falls back to issue.url when no page record is available", () => {
    const issue = makeIssue({ ruleId: "canonical-absent", url: "https://x.test/b" });
    const result = canonicalAbsentBuilder(issue, null);
    expect(result.items[0]!.change).toContain("https://x.test/b");
  });

  it("skips (never fabricates a URL) when neither a page record nor issue.url is available", () => {
    const issue = makeIssue({ ruleId: "canonical-absent", url: null, pageId: null });
    const result = canonicalAbsentBuilder(issue, null);
    expect(result.items).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });
});

describe("mixedContentBuilder", () => {
  it("rewrites only http:// evidence values to https://, leaving anything else out", () => {
    const issue = makeIssue({
      ruleId: "mixed-content",
      evidence: [
        { field: "images[0].url", value: "http://cdn.x.test/a.jpg" },
        { field: "images[1].url", value: "https://cdn.x.test/already-secure.jpg" },
        { field: "videos[0].poster", value: "http://cdn.x.test/poster.jpg" },
      ],
    });
    const result = mixedContentBuilder(issue);
    expect(result.items).toHaveLength(1);
    const change = result.items[0]!.change as string[];
    expect(change).toHaveLength(2);
    expect(change).toContain("http://cdn.x.test/a.jpg → https://cdn.x.test/a.jpg");
    expect(change.join(" ")).not.toContain("already-secure");
  });

  it("skips when there is no http:// evidence to rewrite", () => {
    const issue = makeIssue({ ruleId: "mixed-content", evidence: [] });
    const result = mixedContentBuilder(issue);
    expect(result.items).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });
});

describe("imageMissingDimensionsBuilder", () => {
  it("emits a measured width/height change only for images the crawl's size-probe actually measured", () => {
    const page = makePage({
      images: [
        makeImage({ url: "https://x.test/measured.jpg", asset: { bytes: 1000, byteSource: "content-length", naturalWidth: 800, naturalHeight: 600, naturalSource: "header-decode", status: 200, sizeError: null } }),
        makeImage({ url: "https://x.test/unmeasured.jpg" }), // no asset field at all
      ],
    });
    const issue = makeIssue({
      ruleId: "image-missing-dimensions",
      evidence: [
        { field: "images[0]", value: { width: null, height: null } },
        { field: "images[1]", value: { width: null, height: null } },
      ],
    });
    const result = imageMissingDimensionsBuilder(issue, page);
    expect(result.items).toHaveLength(1);
    const change = result.items[0]!.change as string[];
    expect(change).toEqual(['https://x.test/measured.jpg → width="800" height="600"']);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain("unmeasured.jpg");
  });

  it("never guesses — an image with a naturalWidth but no naturalHeight is skipped, not half-applied", () => {
    const page = makePage({
      images: [makeImage({ url: "https://x.test/partial.jpg", asset: { bytes: 1000, byteSource: "content-length", naturalWidth: 800, naturalHeight: null, naturalSource: "header-decode", status: 200, sizeError: null } })],
    });
    const issue = makeIssue({ ruleId: "image-missing-dimensions", evidence: [{ field: "images[0]", value: { width: null, height: null } }] });
    const result = imageMissingDimensionsBuilder(issue, page);
    expect(result.items).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it("skips entirely when no page record is available", () => {
    const issue = makeIssue({ ruleId: "image-missing-dimensions", evidence: [{ field: "images[0]", value: { width: null, height: null } }] });
    const result = imageMissingDimensionsBuilder(issue, null);
    expect(result.items).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });
});

describe("redirectChainBuilder", () => {
  it("points the first hop directly at the final destination", () => {
    const issue = makeIssue({
      ruleId: "redirect-chain",
      evidence: [
        {
          field: "redirectChain",
          value: [
            { from: "https://x.test/old", to: "https://x.test/mid", statusCode: 301 },
            { from: "https://x.test/mid", to: "https://x.test/new", statusCode: 301 },
          ],
        },
      ],
    });
    const result = redirectChainBuilder(issue);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.change).toBe("https://x.test/old → https://x.test/new (currently 2 hops)");
  });

  it("skips when there is no redirectChain evidence", () => {
    const issue = makeIssue({ ruleId: "redirect-chain", evidence: [] });
    const result = redirectChainBuilder(issue);
    expect(result.items).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });
});
