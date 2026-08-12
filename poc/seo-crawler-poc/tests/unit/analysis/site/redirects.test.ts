import { describe, expect, it } from "vitest";
import { redirectChainRule, redirectLoopRule } from "../../../../src/analysis/rules/site/redirects";
import { makeConfig, makeContext, makeFailure, makePage } from "./fixtures";

describe("redirectChainRule", () => {
  it("fires when redirectChain.length exceeds the configured max", () => {
    const page = makePage({
      url: "https://x.test/old-gear",
      finalUrl: "https://x.test/products",
      redirectChain: [
        { from: "https://x.test/old-gear", to: "https://x.test/gear", statusCode: 301 },
        { from: "https://x.test/gear", to: "https://x.test/products", statusCode: 301 },
      ],
    });
    const issues = redirectChainRule.evaluate(makeContext({ pages: [page] }), makeConfig({ thresholds: { ...makeConfig().thresholds, redirectChainMax: 1 } }))!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.threshold).toContain("redirectChain.length > 1");
  });

  it("does not fire for a single-hop redirect at the default max", () => {
    const page = makePage({
      url: "https://x.test/a",
      redirectChain: [{ from: "https://x.test/a", to: "https://x.test/b", statusCode: 301 }],
    });
    const issues = redirectChainRule.evaluate(makeContext({ pages: [page] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });
});

describe("redirectLoopRule", () => {
  it("fires for a redirect-loop failure record", () => {
    const failures = [makeFailure({ url: "https://x.test/loop-a", reason: "redirect-loop" })];
    const issues = redirectLoopRule.evaluate(makeContext({ failures }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
  });

  it("does not fire for unrelated failure classes", () => {
    const failures = [makeFailure({ url: "https://x.test/timeout", reason: "timeout" })];
    const issues = redirectLoopRule.evaluate(makeContext({ failures }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });
});
