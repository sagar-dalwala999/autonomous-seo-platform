import { describe, expect, it } from "vitest";
import { robotsBlockedRule } from "../../../../src/analysis/rules/site/robots";
import { makeConfig, makeContext } from "./fixtures";

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
