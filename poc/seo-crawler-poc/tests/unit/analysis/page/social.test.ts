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

describe("og-incomplete", () => {
  it("skips (returns null) when social was never captured", () => {
    const { social, ...rest } = makePage();
    expect(rule("og-incomplete").evaluate(rest, config)).toBeNull();
  });

  it("does not fire when og is empty — og-missing owns that case", () => {
    expect(rule("og-incomplete").evaluate(makePage({ social: { og: {}, twitter: {} } }), config)).toEqual([]);
  });

  it("fires when some but not all of title/description/image/url are present", () => {
    const issues = rule("og-incomplete").evaluate(
      makePage({ social: { og: { "og:title": "T" }, twitter: {} } }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
    expect(issues![0]!.message).toContain("og:description");
    expect(issues![0]!.message).toContain("og:image");
    expect(issues![0]!.message).toContain("og:url");
    expect(issues![0]!.message).not.toContain("og:title");
  });

  it("does not fire once all four are present", () => {
    expect(
      rule("og-incomplete").evaluate(
        makePage({
          social: { og: { "og:title": "T", "og:description": "D", "og:image": "https://x/img.jpg", "og:url": "https://x/" }, twitter: {} },
        }),
        config,
      ),
    ).toEqual([]);
  });
});
