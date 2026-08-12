import { describe, expect, it } from "vitest";
import { socialRules } from "../../../../src/analysis/rules/page/social";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";

const rule = (id: string) => socialRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

describe("og-missing / twitter-missing (v2-optional)", () => {
  it("skip (return null) when social was never captured", () => {
    const { social, ...rest } = makePage();
    expect(rule("og-missing").evaluate(rest, config)).toBeNull();
    expect(rule("twitter-missing").evaluate(rest, config)).toBeNull();
  });

  it("og-missing fires when og map is empty", () => {
    const issues = rule("og-missing").evaluate(makePage({ social: { og: {}, twitter: { card: "summary" } } }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
  });

  it("og-missing does not fire when og has tags", () => {
    expect(rule("og-missing").evaluate(makePage({ social: { og: { title: "x" }, twitter: {} } }), config)).toEqual([]);
  });

  it("twitter-missing fires when twitter map is empty", () => {
    const issues = rule("twitter-missing").evaluate(makePage({ social: { og: { title: "x" }, twitter: {} } }), config);
    expect(issues).toHaveLength(1);
  });

  it("twitter-missing does not fire when twitter has tags", () => {
    expect(rule("twitter-missing").evaluate(makePage({ social: { og: {}, twitter: { card: "summary" } } }), config)).toEqual([]);
  });
});
