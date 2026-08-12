import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractHreflang } from "../../../src/extraction/hreflang";
import { loadFixture } from "./testUtils";

const BASE = "https://summittrailgear.example/some/page";

describe("extractHreflang", () => {
  it("returns [] when no alternate/hreflang links present", () => {
    const $ = cheerio.load(loadFixture("about.html"));
    expect(extractHreflang($, BASE)).toEqual([]);
  });

  it("captures a full hreflang cluster with resolved absolute hrefs, document order", () => {
    const $ = cheerio.load(loadFixture("multi-instance-social.html"));
    expect(extractHreflang($, BASE)).toEqual([
      { lang: "en", href: "https://summittrailgear.example/en/page" },
      { lang: "fr", href: "https://summittrailgear.example/fr/page" },
      { lang: "x-default", href: "https://summittrailgear.example/page" },
    ]);
  });

  it("excludes rel=alternate links with no hreflang attribute (e.g. a feed link)", () => {
    const $ = cheerio.load(loadFixture("multi-instance-social.html"));
    const entries = extractHreflang($, BASE);
    expect(entries.find((e) => e.href.endsWith("/feed.xml"))).toBeUndefined();
  });

  it("skips an alternate/hreflang link with no href", () => {
    const $ = cheerio.load(`<link rel="alternate" hreflang="de">`);
    expect(extractHreflang($, BASE)).toEqual([]);
  });

  it("resolves a relative href against the given base", () => {
    const $ = cheerio.load(`<link rel="alternate" hreflang="es" href="/es/page">`);
    expect(extractHreflang($, BASE)).toEqual([
      { lang: "es", href: "https://summittrailgear.example/es/page" },
    ]);
  });
});
