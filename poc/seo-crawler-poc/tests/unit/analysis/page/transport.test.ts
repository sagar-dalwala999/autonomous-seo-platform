import { describe, expect, it } from "vitest";
import { transportRules } from "../../../../src/analysis/rules/page/transport";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";

const rule = (id: string) => transportRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

const image = (url: string) => ({ url, alt: "a", width: 10, height: 10, format: "jpg" });

describe("page-not-https", () => {
  it("fires on a plain http page (matches quotes.toscrape.com in storage/runs)", () => {
    const issues = rule("page-not-https").evaluate(
      makePage({ url: "http://quotes.toscrape.com/js", finalUrl: "http://quotes.toscrape.com/js" }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("error");
  });

  it("does not fire on https", () => {
    expect(rule("page-not-https").evaluate(makePage({ url: "https://ex.com/", finalUrl: "https://ex.com/" }), config)).toEqual([]);
  });

  it("does not fire on loopback — W3C Secure Contexts counts it potentially trustworthy", () => {
    for (const host of ["http://localhost:3105/", "http://127.0.0.1:8080/", "http://app.localhost/"]) {
      expect(rule("page-not-https").evaluate(makePage({ url: host, finalUrl: host }), config)).toEqual([]);
    }
  });

  it("judges the final URL, so an http page redirected to https is clean", () => {
    expect(
      rule("page-not-https").evaluate(makePage({ url: "http://ex.com/", finalUrl: "https://ex.com/" }), config),
    ).toEqual([]);
  });
});

describe("mixed-content", () => {
  it("fires on an http image referenced from an https page (matches visioninfotech.net/9-awesome-tech-talk-events-to-follow-in-2022)", () => {
    const issues = rule("mixed-content").evaluate(
      makePage({
        url: "https://ex.com/post",
        finalUrl: "https://ex.com/post",
        images: [image("https://ex.com/ok.jpg"), image("http://ex.com/legacy.jpg")],
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
    expect(issues![0]!.evidence).toEqual([{ field: "images[1].url", value: "http://ex.com/legacy.jpg" }]);
  });

  it("collects http fonts and declared favicons too, and ignores implicit favicon guesses", () => {
    const issues = rule("mixed-content").evaluate(
      makePage({
        url: "https://ex.com/",
        finalUrl: "https://ex.com/",
        fonts: {
          faces: [
            {
              family: "F",
              source: "http://cdn.ex.com/f.woff2",
              origin: "third-party",
              host: "cdn.ex.com",
              display: null,
              preloaded: false,
              preloadMissingCrossorigin: false,
            },
          ],
          thirdPartyHosts: ["cdn.ex.com"],
        },
        favicons: {
          candidates: [
            { rel: "icon", href: "http://ex.com/declared.ico", declaredSizes: null, type: null, index: 0, source: "link" },
            { rel: "icon", href: "http://ex.com/favicon.ico", declaredSizes: null, type: null, index: -1, source: "implicit" },
          ],
          effective: null,
          googleSerpEligible: null,
          googleSerpBlockers: [],
        },
      }),
      config,
    );
    expect(issues![0]!.evidence.map((e) => e.field)).toEqual(["fonts.faces[0].source", "favicons.candidates[0].href"]);
  });

  it("does not fire when every subresource is https", () => {
    expect(
      rule("mixed-content").evaluate(
        makePage({ url: "https://ex.com/", finalUrl: "https://ex.com/", images: [image("https://ex.com/ok.jpg")] }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire on an http page — nothing is mixed there", () => {
    expect(
      rule("mixed-content").evaluate(
        makePage({ url: "http://ex.com/", finalUrl: "http://ex.com/", images: [image("http://ex.com/x.jpg")] }),
        config,
      ),
    ).toEqual([]);
  });
});

describe("oversized-html", () => {
  it("skips when pageStats was never captured", () => {
    const { pageStats, ...rest } = makePage();
    expect(rule("oversized-html").evaluate(rest, config)).toBeNull();
  });

  it("fires above the configured byte threshold", () => {
    const issues = rule("oversized-html").evaluate(
      makePage({ pageStats: { htmlBytes: 600000, textRatio: 0.2, domNodes: 100, contentEncoding: "gzip", httpVersion: "2.0" } }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
    expect(issues![0]!.evidence).toEqual([{ field: "pageStats.htmlBytes", value: 600000 }]);
  });

  it("does not fire at/under the threshold", () => {
    expect(
      rule("oversized-html").evaluate(
        makePage({ pageStats: { htmlBytes: 10000, textRatio: 0.2, domNodes: 100, contentEncoding: "gzip", httpVersion: "2.0" } }),
        config,
      ),
    ).toEqual([]);
  });
});
