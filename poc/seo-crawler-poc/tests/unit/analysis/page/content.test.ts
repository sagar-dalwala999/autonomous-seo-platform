import { describe, expect, it } from "vitest";
import { contentRules } from "../../../../src/analysis/rules/page/content";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";

const rule = (id: string) => contentRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

describe("thin-content", () => {
  it("fires under the word threshold (matches seeded /blog/trail-snacks, 35 words)", () => {
    const issues = rule("thin-content").evaluate(makePage({ content: { text: "x", wordCount: 35, contentHash: "h" } }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning"); // heuristic — never error (MF-5)
  });

  it("does not fire above the threshold", () => {
    expect(
      rule("thin-content").evaluate(makePage({ content: { text: "x", wordCount: 300, contentHash: "h" } }), config),
    ).toEqual([]);
  });
});

describe("low-text-ratio (v2-optional pageStats)", () => {
  it("skips when pageStats was never captured", () => {
    const { pageStats, ...rest } = makePage();
    expect(rule("low-text-ratio").evaluate(rest, config)).toBeNull();
  });

  it("fires below the ratio threshold", () => {
    const issues = rule("low-text-ratio").evaluate(
      makePage({ pageStats: { htmlBytes: 10000, textRatio: 0.02, domNodes: 500, contentEncoding: null, httpVersion: null } }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice"); // heuristic — never error (MF-5)
  });

  it("does not fire at/above the threshold", () => {
    expect(
      rule("low-text-ratio").evaluate(
        makePage({ pageStats: { htmlBytes: 1000, textRatio: 0.5, domNodes: 50, contentEncoding: null, httpVersion: null } }),
        config,
      ),
    ).toEqual([]);
  });
});
