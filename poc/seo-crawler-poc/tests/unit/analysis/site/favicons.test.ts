import { describe, expect, it } from "vitest";
import { faviconInconsistentRule } from "../../../../src/analysis/rules/site/favicons";
import { makeConfig, makeContext, makePage } from "./fixtures";
import type { FaviconReport } from "../../../../src/models/types";

const config = makeConfig();

function favicons(hrefs: string[]): FaviconReport {
  return {
    candidates: [
      ...hrefs.map((href, index) => ({ rel: "icon", href, declaredSizes: null, type: null, index, source: "link" as const })),
      { rel: "icon", href: "https://ex.test/favicon.ico", declaredSizes: null, type: null, index: -1, source: "implicit" as const },
    ],
    effective: null,
    googleSerpEligible: null,
    googleSerpBlockers: [],
  };
}

describe("favicon-inconsistent", () => {
  it("fires on every page of a host whose declared favicon differs", () => {
    const issues = faviconInconsistentRule.evaluate(
      makeContext({
        pages: [
          makePage({ url: "https://ex.test/", favicons: favicons(["https://ex.test/a.png"]) }),
          makePage({ url: "https://ex.test/about", favicons: favicons(["https://ex.test/b.png"]) }),
        ],
      }),
      config,
    );
    expect(issues).toHaveLength(2);
    expect(issues![0]!.severity).toBe("notice");
    expect(issues![0]!.message).toContain("2 different favicons");
  });

  it("does not fire when every page declares the same icon (matches visioninfotech.net, 10/10 pages agree)", () => {
    expect(
      faviconInconsistentRule.evaluate(
        makeContext({
          pages: [
            makePage({ url: "https://ex.test/", favicons: favicons(["https://ex.test/a.png"]) }),
            makePage({ url: "https://ex.test/about", favicons: favicons(["https://ex.test/a.png"]) }),
          ],
        }),
        config,
      ),
    ).toEqual([]);
  });

  it("compares per host, so two hosts with different icons are both clean", () => {
    expect(
      faviconInconsistentRule.evaluate(
        makeContext({
          pages: [
            makePage({ url: "https://ex.test/", favicons: favicons(["https://ex.test/a.png"]) }),
            makePage({ url: "https://other.test/", favicons: favicons(["https://other.test/b.png"]) }),
          ],
        }),
        config,
      ),
    ).toEqual([]);
  });

  it("skips as data-unavailable when no page captured favicons (pre-v3 run)", () => {
    expect(faviconInconsistentRule.evaluate(makeContext({ pages: [makePage({ url: "https://ex.test/" })] }), config)).toBeNull();
  });

  it("ignores pages that declare nothing — favicon-not-declared owns that finding", () => {
    expect(
      faviconInconsistentRule.evaluate(
        makeContext({
          pages: [
            makePage({ url: "https://ex.test/", favicons: favicons(["https://ex.test/a.png"]) }),
            makePage({ url: "https://ex.test/about", favicons: favicons([]) }),
          ],
        }),
        config,
      ),
    ).toEqual([]);
  });
});
