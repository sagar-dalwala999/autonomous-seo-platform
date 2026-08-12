import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import {
  extractTitle,
  extractMetaDescription,
  extractCanonical,
  extractRobotsMeta,
  extractTitles,
  extractMetaDescriptions,
  extractMetaKeywords,
  extractMetaRefresh,
} from "../../../src/extraction/metadata";
import { loadFixture } from "./testUtils";

const BASE = "https://summittrailgear.example/about";

describe("extractTitle / extractMetaDescription", () => {
  it("returns null for both when absent (manifest #1, #4)", () => {
    const $ = cheerio.load(loadFixture("about.html"));
    expect(extractTitle($)).toBeNull();
    expect(extractMetaDescription($)).toBeNull();
  });

  it("returns a very short title verbatim (manifest #3b)", () => {
    const $ = cheerio.load(loadFixture("contact.html"));
    expect(extractTitle($)).toBe("Contact");
  });

  it("returns an overlong title in full, uncut (manifest #3a)", () => {
    const $ = cheerio.load(loadFixture("guides-thru-hiking.html"));
    const title = extractTitle($);
    expect(title).not.toBeNull();
    expect(title!.length).toBeGreaterThan(70);
  });

  it("two fixtures share the same title verbatim (manifest #2)", () => {
    const a = extractTitle(cheerio.load(loadFixture("blog-layering-basics.html")));
    const b = extractTitle(cheerio.load(loadFixture("blog-rain-gear-care.html")));
    expect(a).toBe(b);
    expect(a).toBe("Hiking Gear Tips | Summit Trail Gear");
  });

  it("two fixtures share the same meta description while titles differ (manifest #5)", () => {
    const $a = cheerio.load(loadFixture("blog-choosing-hiking-boots.html"));
    const $b = cheerio.load(loadFixture("blog-backpack-fitting.html"));
    expect(extractMetaDescription($a)).toBe(extractMetaDescription($b));
    expect(extractTitle($a)).not.toBe(extractTitle($b));
  });

  it("collapses embedded whitespace/newlines in title and description", () => {
    const $ = cheerio.load(`<title>\n  Multi   line\n  Title \n</title><meta name="description" content="  a   b \n c  ">`);
    expect(extractTitle($)).toBe("Multi line Title");
    expect(extractMetaDescription($)).toBe("a b c");
  });

  it("meta name matching is case-insensitive", () => {
    const $ = cheerio.load(`<meta name="Description" content="case test">`);
    expect(extractMetaDescription($)).toBe("case test");
  });
});

describe("extractCanonical", () => {
  it("is null when no canonical link present", () => {
    const $ = cheerio.load(loadFixture("about.html"));
    expect(extractCanonical($, BASE)).toBeNull();
  });

  it("resolves a canonical pointing at an unrelated URL, absolute, unchanged (manifest #15a)", () => {
    const $ = cheerio.load(loadFixture("blog-rain-gear-care.html"));
    expect(extractCanonical($, "https://summittrailgear.example/blog/rain-gear-care")).toBe(
      "https://summittrailgear.example/products/ridgeline-backpack-45l"
    );
  });

  it("resolves a relative canonical href against the given base", () => {
    const $ = cheerio.load(`<link rel="canonical" href="/products/foo">`);
    expect(extractCanonical($, "https://example.com/x/y")).toBe("https://example.com/products/foo");
  });
});

describe("extractRobotsMeta", () => {
  it("is all-false with an empty meta array when nothing present", () => {
    const $ = cheerio.load(loadFixture("about.html"));
    expect(extractRobotsMeta($, {})).toEqual({ meta: [], noindex: false, nofollow: false });
  });

  it("reads noindex from an accidental robots meta tag (manifest #12)", () => {
    const $ = cheerio.load(loadFixture("products-switchback.html"));
    const robots = extractRobotsMeta($, {});
    expect(robots.noindex).toBe(true);
    expect(robots.nofollow).toBe(false);
    expect(robots.meta).toContain("noindex");
  });

  it("merges the x-robots-tag header even when meta says index,follow", () => {
    const $ = cheerio.load(loadFixture("generic-page.html"));
    const robots = extractRobotsMeta($, { "x-robots-tag": "noindex" });
    expect(robots.noindex).toBe(true);
    expect(robots.meta).toEqual(["index, follow", "noindex"]);
  });

  it("treats 'none' as both noindex and nofollow", () => {
    const $ = cheerio.load(`<meta name="robots" content="none">`);
    const robots = extractRobotsMeta($, {});
    expect(robots.noindex).toBe(true);
    expect(robots.nofollow).toBe(true);
  });

  it("strips an agent prefix in X-Robots-Tag values (e.g. 'googlebot: noindex')", () => {
    const $ = cheerio.load(`<html></html>`);
    const robots = extractRobotsMeta($, { "x-robots-tag": "googlebot: noindex, nofollow" });
    expect(robots.noindex).toBe(true);
    expect(robots.nofollow).toBe(true);
  });

  it("merges <meta name=googlebot> alongside <meta name=robots>", () => {
    const $ = cheerio.load(`<meta name="robots" content="index"><meta name="googlebot" content="nofollow">`);
    const robots = extractRobotsMeta($, {});
    expect(robots.noindex).toBe(false);
    expect(robots.nofollow).toBe(true);
  });
});

describe("extractTitles / extractMetaDescriptions (multi-instance)", () => {
  it("returns [] for both when the page has neither", () => {
    const $ = cheerio.load(loadFixture("about.html"));
    expect(extractTitles($)).toEqual([]);
    expect(extractMetaDescriptions($)).toEqual([]);
  });

  it("returns a single-element array for a normal single-title/description page (back-compat shape)", () => {
    const $ = cheerio.load(loadFixture("contact.html"));
    expect(extractTitles($)).toEqual(["Contact"]);
  });

  it("captures both <title> elements in document order; first matches extractTitle", () => {
    const $ = cheerio.load(loadFixture("multi-instance-social.html"));
    const titles = extractTitles($);
    expect(titles).toEqual(["First Title | Summit Trail Gear", "Second Duplicate Title"]);
    expect(extractTitle($)).toBe(titles[0]);
  });

  it("captures both meta descriptions in document order, whitespace-collapsed; first matches extractMetaDescription", () => {
    const $ = cheerio.load(loadFixture("multi-instance-social.html"));
    const descriptions = extractMetaDescriptions($);
    expect(descriptions).toEqual(["First description instance.", "Second description instance."]);
    expect(extractMetaDescription($)).toBe(descriptions[0]);
  });
});

describe("extractMetaKeywords", () => {
  it("is null when no keywords meta present", () => {
    const $ = cheerio.load(loadFixture("about.html"));
    expect(extractMetaKeywords($)).toBeNull();
  });

  it("returns the whitespace-collapsed keywords content", () => {
    const $ = cheerio.load(loadFixture("multi-instance-social.html"));
    expect(extractMetaKeywords($)).toBe("hiking, trail gear, backpacks");
  });
});

describe("extractMetaRefresh", () => {
  it("is null when no meta-refresh tag present", () => {
    const $ = cheerio.load(loadFixture("about.html"));
    expect(extractMetaRefresh($, BASE)).toBeNull();
  });

  it("parses delay + resolved absolute url from 'N;url=...' (manifest-style redirect page)", () => {
    const $ = cheerio.load(loadFixture("multi-instance-social.html"));
    expect(extractMetaRefresh($, "https://summittrailgear.example/some/page")).toEqual({
      delaySeconds: 5,
      url: "https://summittrailgear.example/redirected-page",
      raw: "5;url=/redirected-page",
    });
  });

  it("parses a delay-only refresh (no url) as self-refresh", () => {
    const $ = cheerio.load(`<meta http-equiv="refresh" content="10">`);
    expect(extractMetaRefresh($, BASE)).toEqual({ delaySeconds: 10, url: null, raw: "10" });
  });

  it("keeps raw and nulls delay/url for malformed content", () => {
    const $ = cheerio.load(`<meta http-equiv="refresh" content="not-a-valid-refresh">`);
    expect(extractMetaRefresh($, BASE)).toEqual({ delaySeconds: null, url: null, raw: "not-a-valid-refresh" });
  });

  it("strips quotes around the url target", () => {
    const $ = cheerio.load(`<meta http-equiv="refresh" content="3;url='/quoted-target'">`);
    expect(extractMetaRefresh($, BASE)).toEqual({
      delaySeconds: 3,
      url: "https://summittrailgear.example/quoted-target",
      raw: "3;url='/quoted-target'",
    });
  });

  it("http-equiv matching is case-insensitive", () => {
    const $ = cheerio.load(`<meta http-equiv="Refresh" content="0;url=/x">`);
    const result = extractMetaRefresh($, BASE);
    expect(result?.delaySeconds).toBe(0);
  });
});
