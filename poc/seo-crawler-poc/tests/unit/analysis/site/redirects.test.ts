import { describe, expect, it } from "vitest";
import {
  redirectChainRule,
  redirectLoopRule,
  redirectToErrorRule,
  redirectTemporaryRule,
  redirectSingleHopRule,
} from "../../../../src/analysis/rules/site/redirects";
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

describe("redirectToErrorRule", () => {
  it("fires when a page's redirect chain lands on a 4xx/5xx status", () => {
    const page = makePage({
      url: "https://x.test/old-promo",
      statusCode: 404,
      redirectChain: [{ from: "https://x.test/old-promo", to: "https://x.test/promo-gone", statusCode: 301 }],
    });
    const issues = redirectToErrorRule.evaluate(makeContext({ pages: [page] }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
  });

  it("does not fire for a redirect landing on 200", () => {
    const page = makePage({
      url: "https://x.test/old",
      statusCode: 200,
      redirectChain: [{ from: "https://x.test/old", to: "https://x.test/new", statusCode: 301 }],
    });
    expect(redirectToErrorRule.evaluate(makeContext({ pages: [page] }), makeConfig())!).toHaveLength(0);
  });

  it("does not fire for a page with no redirect chain, even on a 4xx", () => {
    const page = makePage({ url: "https://x.test/gone", statusCode: 404 });
    expect(redirectToErrorRule.evaluate(makeContext({ pages: [page] }), makeConfig())!).toHaveLength(0);
  });
});

describe("redirectTemporaryRule", () => {
  it("fires when the chain includes a 302 hop", () => {
    const page = makePage({
      url: "https://x.test/sale",
      redirectChain: [{ from: "https://x.test/sale", to: "https://x.test/sale-2026", statusCode: 302 }],
    });
    const issues = redirectTemporaryRule.evaluate(makeContext({ pages: [page] }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("notice");
  });

  it("does not fire for a permanent (301) redirect", () => {
    const page = makePage({
      url: "https://x.test/a",
      redirectChain: [{ from: "https://x.test/a", to: "https://x.test/b", statusCode: 301 }],
    });
    expect(redirectTemporaryRule.evaluate(makeContext({ pages: [page] }), makeConfig())!).toHaveLength(0);
  });
});

describe("redirectSingleHopRule", () => {
  it("fires for exactly one redirect hop", () => {
    const page = makePage({
      url: "https://x.test/a",
      redirectChain: [{ from: "https://x.test/a", to: "https://x.test/b", statusCode: 301 }],
    });
    const issues = redirectSingleHopRule.evaluate(makeContext({ pages: [page] }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("notice");
  });

  it("does not fire for a multi-hop chain (that's redirect-chain's finding)", () => {
    const page = makePage({
      url: "https://x.test/a",
      redirectChain: [
        { from: "https://x.test/a", to: "https://x.test/b", statusCode: 301 },
        { from: "https://x.test/b", to: "https://x.test/c", statusCode: 301 },
      ],
    });
    expect(redirectSingleHopRule.evaluate(makeContext({ pages: [page] }), makeConfig())!).toHaveLength(0);
  });

  it("does not fire when there is no redirect at all", () => {
    const page = makePage({ url: "https://x.test/direct" });
    expect(redirectSingleHopRule.evaluate(makeContext({ pages: [page] }), makeConfig())!).toHaveLength(0);
  });
});
