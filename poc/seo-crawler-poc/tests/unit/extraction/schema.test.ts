import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractStructuredData } from "../../../src/extraction/schema";
import { loadFixture } from "./testUtils";

describe("extractStructuredData", () => {
  it("preserves an invalid truncated JSON-LD block raw, with a parse error (manifest #11a)", () => {
    const $ = cheerio.load(loadFixture("blog-choosing-hiking-boots.html"));
    const blocks = extractStructuredData($);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.raw.length).toBeGreaterThan(0);
    expect(blocks[0]!.parsed).toBeNull();
    expect(blocks[0]!.parseError).not.toBeNull();
    expect(() => JSON.parse(blocks[0]!.raw)).toThrow();
  });

  it("parses a wrong-schema-type Recipe-on-article block without error (manifest #11b)", () => {
    const $ = cheerio.load(loadFixture("blog-layering-basics.html"));
    const [block] = extractStructuredData($);
    expect(block!.parseError).toBeNull();
    expect((block!.parsed as { "@type": string })["@type"]).toBe("Recipe");
  });

  it("parses a valid Product block missing offers/price/availability (manifest #11c)", () => {
    const $ = cheerio.load(loadFixture("products-ridgeline.html"));
    const [block] = extractStructuredData($);
    expect(block!.parseError).toBeNull();
    const parsed = block!.parsed as Record<string, unknown>;
    expect(parsed["@type"]).toBe("Product");
    expect(parsed.offers).toBeUndefined(); // absence itself IS the evidence — S2 does not judge it
  });

  it("returns [] when no ld+json blocks are present", () => {
    const $ = cheerio.load(loadFixture("about.html"));
    expect(extractStructuredData($)).toEqual([]);
  });

  it("captures multiple blocks on one page independently", () => {
    const $ = cheerio.load(
      `<script type="application/ld+json">{"a":1}</script><script type="application/ld+json">not json</script>`
    );
    const blocks = extractStructuredData($);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.parsed).toEqual({ a: 1 });
    expect(blocks[1]!.parseError).not.toBeNull();
  });

  it("never throws on an empty script block", () => {
    const $ = cheerio.load(`<script type="application/ld+json"></script>`);
    expect(() => extractStructuredData($)).not.toThrow();
    expect(extractStructuredData($)[0]!.parseError).not.toBeNull();
  });
});
