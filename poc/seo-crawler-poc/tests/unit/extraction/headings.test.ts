import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractHeadings } from "../../../src/extraction/headings";
import { loadFixture } from "./testUtils";

describe("extractHeadings", () => {
  it("returns empty h1 when the page has no H1, starting at H2 (manifest #6a)", () => {
    const $ = cheerio.load(loadFixture("contact.html"));
    const { h1, h2 } = extractHeadings($);
    expect(h1).toEqual([]);
    expect(h2).toEqual(["Get in touch", "Returns"]);
  });

  it("captures two H1s in document order (synthetic two-H1 page)", () => {
    const $ = cheerio.load(loadFixture("two-h1.html"));
    expect(extractHeadings($).h1).toEqual(["Summit Trail Gear", "Winter Clearance Sale"]);
  });

  it("captures an H1-to-H3 jump with an empty h2 array (manifest #6c)", () => {
    const $ = cheerio.load(loadFixture("blog-trail-nutrition.html"));
    const { h1, h2, h3 } = extractHeadings($);
    expect(h1).toEqual(["Trail nutrition basics"]);
    expect(h2).toEqual([]);
    expect(h3).toEqual(["Carbs during, protein after"]);
  });

  it("trims and collapses embedded whitespace in heading text", () => {
    const $ = cheerio.load(`<h1>\n  Spaced   Out \n Heading \n</h1>`);
    expect(extractHeadings($).h1).toEqual(["Spaced Out Heading"]);
  });

  it("captures every h1 beyond the first two (v2: no truncation)", () => {
    const $ = cheerio.load(`<h1>One</h1><h1>Two</h1><h1>Three</h1><h1>Four</h1>`);
    expect(extractHeadings($).h1).toEqual(["One", "Two", "Three", "Four"]);
  });
});
