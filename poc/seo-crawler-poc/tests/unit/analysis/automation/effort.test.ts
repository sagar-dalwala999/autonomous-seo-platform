import { describe, expect, it } from "vitest";
import { deriveEffort } from "../../../../src/analysis/automation/effort";

describe("deriveEffort", () => {
  it("auto-safe is always low effort regardless of reach", () => {
    expect(deriveEffort({ automation: "auto-safe", scope: "page", affectedPages: 500, pagesAnalyzed: 500 }).level).toBe("low");
    expect(deriveEffort({ automation: "auto-safe", scope: "site", affectedPages: 1, pagesAnalyzed: 1 }).level).toBe("low");
  });

  it("auto-with-review is medium when it reaches over half the crawled pages", () => {
    const r = deriveEffort({ automation: "auto-with-review", scope: "page", affectedPages: 60, pagesAnalyzed: 100 });
    expect(r.level).toBe("medium");
  });

  it("auto-with-review is low when it touches a small share of pages", () => {
    const r = deriveEffort({ automation: "auto-with-review", scope: "page", affectedPages: 2, pagesAnalyzed: 100 });
    expect(r.level).toBe("low");
  });

  it("auto-with-review at site scope always reaches 1 (treated as medium)", () => {
    const r = deriveEffort({ automation: "auto-with-review", scope: "site", affectedPages: 1, pagesAnalyzed: 1000 });
    expect(r.level).toBe("medium");
  });

  it("human-only at site scope is one judgment call — medium, not high, regardless of count", () => {
    const r = deriveEffort({ automation: "human-only", scope: "site", affectedPages: 900, pagesAnalyzed: 1000 });
    expect(r.level).toBe("medium");
  });

  it("human-only at page scope is high once past 25 affected pages", () => {
    const r = deriveEffort({ automation: "human-only", scope: "page", affectedPages: 26, pagesAnalyzed: 1000 });
    expect(r.level).toBe("high");
  });

  it("human-only at page scope is high once reach exceeds 0.4 even under 25 pages", () => {
    const r = deriveEffort({ automation: "human-only", scope: "page", affectedPages: 10, pagesAnalyzed: 20 });
    expect(r.level).toBe("high");
  });

  it("human-only at page scope is medium for a small, low-reach count", () => {
    const r = deriveEffort({ automation: "human-only", scope: "page", affectedPages: 3, pagesAnalyzed: 1000 });
    expect(r.level).toBe("medium");
  });

  it("never divides by zero when pagesAnalyzed is 0", () => {
    expect(() => deriveEffort({ automation: "human-only", scope: "page", affectedPages: 0, pagesAnalyzed: 0 })).not.toThrow();
  });
});
