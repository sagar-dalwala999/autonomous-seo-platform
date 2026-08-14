import { describe, expect, it } from "vitest";
import { fontRules } from "../../../../src/analysis/rules/page/fonts";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";
import type { FontFaceRecord, FontReport } from "../../../../src/models/types";

const rule = (id: string) => fontRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

const face = (overrides: Partial<FontFaceRecord> = {}): FontFaceRecord => ({
  family: "Inter",
  source: "https://ex.com/inter.woff2",
  origin: "same-origin",
  host: "ex.com",
  display: "swap",
  preloaded: false,
  preloadMissingCrossorigin: false,
  ...overrides,
});

function fonts(faces: FontFaceRecord[]): FontReport {
  return {
    faces,
    thirdPartyHosts: [...new Set(faces.filter((f) => f.origin === "third-party" && f.host).map((f) => f.host as string))].sort(),
  };
}

describe("font-preload-missing-crossorigin", () => {
  it("fires on a preload as=font without crossorigin (matches seeded /seeded/head-meta-rich.html)", () => {
    const issues = rule("font-preload-missing-crossorigin").evaluate(
      makePage({ fonts: fonts([face({ preloaded: true, preloadMissingCrossorigin: true })]) }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
    expect(issues![0]!.evidence[0]!.field).toBe("fonts.faces[0].source");
  });

  it("does not fire when every preload carries crossorigin", () => {
    expect(
      rule("font-preload-missing-crossorigin").evaluate(makePage({ fonts: fonts([face({ preloaded: true })]) }), config),
    ).toEqual([]);
  });

  it("skips as data-unavailable on a pre-v3 record", () => {
    expect(rule("font-preload-missing-crossorigin").evaluate(makePage(), config)).toBeNull();
  });
});

describe("font-display-blocking", () => {
  it("fires on font-display: block and auto", () => {
    const issues = rule("font-display-blocking").evaluate(
      makePage({ fonts: fonts([face({ display: "block" }), face({ display: "auto" })]) }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.evidence).toHaveLength(2);
  });

  it("does not fire on swap/optional, nor on an unfetched stylesheet where display is unknown", () => {
    expect(rule("font-display-blocking").evaluate(makePage({ fonts: fonts([face({ display: "swap" })]) }), config)).toEqual([]);
    expect(rule("font-display-blocking").evaluate(makePage({ fonts: fonts([face({ display: null })]) }), config)).toEqual([]);
  });

  it("skips as data-unavailable on a pre-v3 record", () => {
    expect(rule("font-display-blocking").evaluate(makePage(), config)).toBeNull();
  });
});

describe("third-party-font-host", () => {
  it("fires listing the hosts (matches sagardalwala.me loading fonts.googleapis.com)", () => {
    const issues = rule("third-party-font-host").evaluate(
      makePage({
        fonts: fonts([face({ origin: "third-party", host: "fonts.gstatic.com", source: "https://fonts.gstatic.com/s/inter.woff2" })]),
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
    expect(issues![0]!.message).toContain("fonts.gstatic.com");
  });

  it("does not fire when every font is same-origin", () => {
    expect(rule("third-party-font-host").evaluate(makePage({ fonts: fonts([face()]) }), config)).toEqual([]);
  });

  it("skips as data-unavailable on a pre-v3 record", () => {
    expect(rule("third-party-font-host").evaluate(makePage(), config)).toBeNull();
  });
});
