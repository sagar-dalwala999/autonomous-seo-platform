import { describe, expect, it } from "vitest";
import { robotsBlockedRule, noUsableRobotsTxtRule } from "../../../../src/analysis/rules/site/robots";
import { emptyRobots, makeConfig, makeContext } from "./fixtures";

describe("robotsBlockedRule", () => {
  it("fires one notice-severity issue per blocked URL", () => {
    const issues = robotsBlockedRule.evaluate(
      makeContext({ blocked: ["https://x.test/guides/a", "https://x.test/guides/b"] }),
      makeConfig(),
    )!;
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.severity === "notice")).toBe(true);
  });

  it("does not fire when nothing was blocked", () => {
    const issues = robotsBlockedRule.evaluate(makeContext({ blocked: [] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });
});

describe("noUsableRobotsTxtRule", () => {
  it("fires when robots.txt failed to parse", () => {
    const robots = { ...emptyRobots, parseStatus: "unavailable" as const };
    const issues = noUsableRobotsTxtRule.evaluate(makeContext({ robots }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("notice");
    expect(issues[0]!.message).toContain("unavailable");
  });

  it("does not fire when robots.txt loaded cleanly", () => {
    const issues = noUsableRobotsTxtRule.evaluate(makeContext({ robots: emptyRobots }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("returns null (data unavailable) when robots.txt was never fetched", () => {
    expect(noUsableRobotsTxtRule.evaluate(makeContext({ robots: null }), makeConfig())).toBeNull();
  });
});
