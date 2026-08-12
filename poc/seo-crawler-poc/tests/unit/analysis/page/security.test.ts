import { describe, expect, it } from "vitest";
import { securityRules } from "../../../../src/analysis/rules/page/security";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";

const rule = (id: string) => securityRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

const FULL_HEADERS = {
  "content-security-policy": "default-src 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000",
};

describe("security-headers-missing (v2-optional, gated on pageStats)", () => {
  it("skips when pageStats was never captured (pre-v2 run — headers subset itself can't disambiguate)", () => {
    const { pageStats, ...rest } = makePage({ headers: {} });
    expect(rule("security-headers-missing").evaluate(rest, config)).toBeNull();
  });

  it("fires listing missing headers on an https page missing all of them", () => {
    const issues = rule("security-headers-missing").evaluate(
      makePage({
        url: "https://ex.com/",
        finalUrl: "https://ex.com/",
        headers: {},
        pageStats: { htmlBytes: 100, textRatio: 0.5, domNodes: 10, contentEncoding: null, httpVersion: null },
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
    expect(issues![0]!.message).toContain("strict-transport-security");
  });

  it("does not require HSTS on a plain http page", () => {
    expect(
      rule("security-headers-missing").evaluate(
        makePage({
          url: "http://ex.com/",
          finalUrl: "http://ex.com/",
          headers: {
            "content-security-policy": "default-src 'self'",
            "x-frame-options": "DENY",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
          },
          pageStats: { htmlBytes: 100, textRatio: 0.5, domNodes: 10, contentEncoding: null, httpVersion: null },
        }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire when all expected headers are present on https", () => {
    expect(
      rule("security-headers-missing").evaluate(
        makePage({
          url: "https://ex.com/",
          finalUrl: "https://ex.com/",
          headers: FULL_HEADERS,
          pageStats: { htmlBytes: 100, textRatio: 0.5, domNodes: 10, contentEncoding: null, httpVersion: null },
        }),
        config,
      ),
    ).toEqual([]);
  });
});
