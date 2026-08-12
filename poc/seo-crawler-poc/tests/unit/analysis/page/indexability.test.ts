import { describe, expect, it } from "vitest";
import { indexabilityRules } from "../../../../src/analysis/rules/page/indexability";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";

const rule = (id: string) => indexabilityRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

describe("noindex", () => {
  it("fires when robots.noindex is true (matches seeded /products/switchback-trekking-poles)", () => {
    const issues = rule("noindex").evaluate(makePage({ robots: { meta: ["noindex"], noindex: true, nofollow: false } }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("error");
  });

  it("does not fire when robots.noindex is false", () => {
    expect(rule("noindex").evaluate(makePage({ robots: { meta: [], noindex: false, nofollow: false } }), config)).toEqual([]);
  });
});

describe("canonical-mismatch / canonical-absent", () => {
  it("fires when canonical points at an unrelated URL (matches seeded /blog/rain-gear-care)", () => {
    const issues = rule("canonical-mismatch").evaluate(
      makePage({
        url: "http://localhost:3105/blog/rain-gear-care",
        finalUrl: "http://localhost:3105/blog/rain-gear-care",
        canonical: "https://summittrailgear.example/products/cascade-rain-shell",
      }),
      config,
    );
    expect(issues).toHaveLength(1);
  });

  it("does not fire when canonical is self-referential across scheme + trailing slash + www", () => {
    const issues = rule("canonical-mismatch").evaluate(
      makePage({
        url: "http://example.com/about",
        finalUrl: "http://example.com/about",
        canonical: "https://www.example.com/about/",
      }),
      config,
    );
    expect(issues).toEqual([]);
  });

  it("does not fire when canonical is absent", () => {
    expect(rule("canonical-mismatch").evaluate(makePage({ canonical: null }), config)).toEqual([]);
  });

  it("canonical-absent fires when there is no canonical tag", () => {
    const issues = rule("canonical-absent").evaluate(makePage({ canonical: null }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
  });

  it("canonical-absent does not fire when canonical is present", () => {
    expect(rule("canonical-absent").evaluate(makePage({ canonical: "http://localhost:3105/x" }), config)).toEqual([]);
  });
});

describe("meta-refresh-present (v2-optional)", () => {
  it("skips when metaRefresh was never captured", () => {
    const { metaRefresh, ...rest } = makePage();
    expect(rule("meta-refresh-present").evaluate(rest, config)).toBeNull();
  });

  it("does not fire when metaRefresh is null (captured, absent)", () => {
    expect(rule("meta-refresh-present").evaluate(makePage({ metaRefresh: null }), config)).toEqual([]);
  });

  it("fires when a meta-refresh redirect is present", () => {
    const issues = rule("meta-refresh-present").evaluate(
      makePage({ metaRefresh: { delaySeconds: 0, url: "http://localhost:3105/new", raw: "0;url=/new" } }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
  });
});
