import { describe, expect, it } from "vitest";
import { hreflangReciprocityRule } from "../../../../src/analysis/rules/site/hreflang";
import { makeConfig, makeContext, makePage } from "./fixtures";

describe("hreflangReciprocityRule", () => {
  it("returns null (data-unavailable) when no page captured hreflang", () => {
    const page = makePage({ url: "https://x.test/a" });
    expect(hreflangReciprocityRule.evaluate(makeContext({ pages: [page] }), makeConfig())).toBeNull();
  });

  it("fires when page A points at B but B has no reciprocal entry", () => {
    const a = makePage({ url: "https://x.test/en/a", hreflang: [{ lang: "es", href: "https://x.test/es/a" }] });
    const b = makePage({ url: "https://x.test/es/a", hreflang: [] });
    const issues = hreflangReciprocityRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.url).toBe(a.url);
  });

  it("does not fire when the pair reciprocates", () => {
    const a = makePage({ url: "https://x.test/en/a", hreflang: [{ lang: "es", href: "https://x.test/es/a" }] });
    const b = makePage({ url: "https://x.test/es/a", hreflang: [{ lang: "en", href: "https://x.test/en/a" }] });
    const issues = hreflangReciprocityRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });
});
