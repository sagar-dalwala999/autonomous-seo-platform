import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractImages } from "../../../src/extraction/images";
import { loadFixture } from "./testUtils";

const BASE = "https://summittrailgear.example/products/foo";

describe("extractImages", () => {
  it("distinguishes missing alt (null) from present-empty alt (''), captures dims and format", () => {
    const $ = cheerio.load(loadFixture("images-mixed.html"));
    const images = extractImages($, BASE);
    expect(images).toHaveLength(4);

    const [missingAlt, emptyAlt, bmp, badDims] = images;

    // manifest #10a — alt attribute entirely absent
    expect(missingAlt!.alt).toBeNull();
    expect(missingAlt!.width).toBe(240);
    expect(missingAlt!.height).toBe(240);
    expect(missingAlt!.format).toBe("png");

    // present-empty alt — distinct evidence from missing
    expect(emptyAlt!.alt).toBe("");
    // manifest #10c — no width/height attributes present
    expect(emptyAlt!.width).toBeNull();
    expect(emptyAlt!.height).toBeNull();
    expect(emptyAlt!.format).toBe("jpg");

    // manifest #10d — suboptimal BMP format
    expect(bmp!.format).toBe("bmp");
    expect(bmp!.alt).toBe("Trail map of the Granite Ridge test loop");

    // non-numeric width/height ("100%", "auto") must not be coerced — null, not garbage numbers
    expect(badDims!.width).toBeNull();
    expect(badDims!.height).toBeNull();
  });

  it("resolves relative src to absolute against the given base", () => {
    const $ = cheerio.load(`<img src="/images/x.png" alt="x">`);
    expect(extractImages($, BASE)[0]!.url).toBe("https://summittrailgear.example/images/x.png");
  });

  it("skips img tags with no src", () => {
    const $ = cheerio.load(`<img alt="no src at all">`);
    expect(extractImages($, BASE)).toEqual([]);
  });

  it("never throws on an unresolvable src", () => {
    const $ = cheerio.load(`<img src="http://[bad" alt="x">`);
    expect(() => extractImages($, BASE)).not.toThrow();
    expect(extractImages($, BASE)).toEqual([]);
  });
});
