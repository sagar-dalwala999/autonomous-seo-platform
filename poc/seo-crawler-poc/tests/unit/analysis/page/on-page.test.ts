import { describe, expect, it } from "vitest";
import { onPageRules } from "../../../../src/analysis/rules/page/on-page";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";

const rule = (id: string) => onPageRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

describe("title-missing", () => {
  it("fires when title is null", () => {
    const issues = rule("title-missing").evaluate(makePage({ title: null }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("error");
    expect(issues![0]!.evidence[0]).toEqual({ field: "title", value: null });
  });

  it("fires when title is blank", () => {
    const issues = rule("title-missing").evaluate(makePage({ title: "   " }), config);
    expect(issues).toHaveLength(1);
  });

  it("does not fire when title is present", () => {
    expect(rule("title-missing").evaluate(makePage({ title: "A Good Title Here" }), config)).toEqual([]);
  });
});

describe("title-too-short / title-too-long", () => {
  it("title-too-short fires under the min and reports char count in threshold", () => {
    const issues = rule("title-too-short").evaluate(makePage({ title: "Contact" }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.threshold).toBe("title 7 chars < min 30");
  });

  it("title-too-short does not fire on a missing title (covered by title-missing instead)", () => {
    expect(rule("title-too-short").evaluate(makePage({ title: null }), config)).toEqual([]);
  });

  it("title-too-short does not fire within range", () => {
    expect(rule("title-too-short").evaluate(makePage({ title: "A title thirty-plus characters long" }), config)).toEqual([]);
  });

  it("title-too-long fires over the max chars", () => {
    const longTitle = "The Complete Ultimate Thru-Hiking Gear Checklist and Buying Guide for Long-Distance Backpacking";
    const issues = rule("title-too-long").evaluate(makePage({ title: longTitle }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
  });

  it("title-too-long also flags pixel-width overflow when captured", () => {
    const issues = rule("title-too-long").evaluate(
      makePage({ title: "Mid length title", pixelWidths: { titlePx: 700, metaDescriptionPx: null } }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.threshold).toContain("700px > max 561px");
  });

  it("title-too-long does not fire within range", () => {
    expect(rule("title-too-long").evaluate(makePage({ title: "A normal length product title here" }), config)).toEqual([]);
  });
});

describe("title-multiple (v2-optional titles[])", () => {
  it("fires when more than one <title> captured", () => {
    const issues = rule("title-multiple").evaluate(makePage({ titles: ["First", "Second"] }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
  });

  it("does not fire with a single title", () => {
    expect(rule("title-multiple").evaluate(makePage({ titles: ["Only"] }), config)).toEqual([]);
  });

  it("skips (returns null) when titles[] was never captured (pre-v2 run)", () => {
    const { titles, ...rest } = makePage();
    expect(rule("title-multiple").evaluate(rest, config)).toBeNull();
  });
});

describe("meta-description-missing / too-short / too-long / multiple", () => {
  it("meta-description-missing fires on null", () => {
    const issues = rule("meta-description-missing").evaluate(makePage({ metaDescription: null }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
  });

  it("meta-description-missing does not fire when present", () => {
    expect(rule("meta-description-missing").evaluate(makePage({ metaDescription: "A fine description." }), config)).toEqual([]);
  });

  it("meta-description-too-short fires under the min", () => {
    const issues = rule("meta-description-too-short").evaluate(makePage({ metaDescription: "Too short." }), config);
    expect(issues).toHaveLength(1);
  });

  it("meta-description-too-long fires over the max", () => {
    const long = "x".repeat(200);
    const issues = rule("meta-description-too-long").evaluate(makePage({ metaDescription: long }), config);
    expect(issues).toHaveLength(1);
  });

  it("meta-description-multiple skips on pre-v2 runs and fires when >1 captured", () => {
    const { metaDescriptions, ...rest } = makePage();
    expect(rule("meta-description-multiple").evaluate(rest, config)).toBeNull();
    const issues = rule("meta-description-multiple").evaluate(makePage({ metaDescriptions: ["A", "B"] }), config);
    expect(issues).toHaveLength(1);
  });
});

describe("h1-missing / h1-multiple / heading-hierarchy-skip", () => {
  it("h1-missing fires when h1 is empty", () => {
    const issues = rule("h1-missing").evaluate(makePage({ headings: { h1: [], h2: [], h3: [] } }), config);
    expect(issues).toHaveLength(1);
  });

  it("h1-missing does not fire with one h1", () => {
    expect(rule("h1-missing").evaluate(makePage({ headings: { h1: ["Title"], h2: [], h3: [] } }), config)).toEqual([]);
  });

  it("h1-multiple fires with two h1s", () => {
    const issues = rule("h1-multiple").evaluate(makePage({ headings: { h1: ["A", "B"], h2: [], h3: [] } }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
  });

  it("heading-hierarchy-skip fires when h3 present with no h2 (matches seeded /blog/trail-nutrition)", () => {
    const issues = rule("heading-hierarchy-skip").evaluate(
      makePage({ headings: { h1: ["Trail nutrition"], h2: [], h3: ["Eat early", "Salt"] } }),
      config,
    );
    expect(issues).toHaveLength(1);
  });

  it("heading-hierarchy-skip does not fire when h2 is present", () => {
    expect(
      rule("heading-hierarchy-skip").evaluate(makePage({ headings: { h1: ["A"], h2: ["B"], h3: ["C"] } }), config),
    ).toEqual([]);
  });
});

describe("Screaming Frog parity checks", () => {
  const longTitle = "A title that is comfortably past the thirty character minimum";

  it("url-too-long fires past 115 characters and not before", () => {
    const short = makePage({ url: "https://x.test/fine", normalizedUrl: "https://x.test/fine" });
    expect(rule("url-too-long").evaluate(short, config)).toHaveLength(0);

    const long = `https://x.test/${"a".repeat(120)}`;
    const issues = rule("url-too-long").evaluate(makePage({ url: long, normalizedUrl: long }), config)!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.threshold).toContain("max 115");
  });

  it("title-too-short fires on pixel width even when the character count passes", () => {
    // Narrow glyphs: enough characters, too few pixels to fill the SERP slot.
    const page = makePage({ title: longTitle, pixelWidths: { titlePx: 150, metaDescriptionPx: null } });
    const issues = rule("title-too-short").evaluate(page, config)!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.threshold).toContain("px");
  });

  it("title-too-short stays quiet when both character count and pixel width pass", () => {
    const page = makePage({ title: longTitle, pixelWidths: { titlePx: 420, metaDescriptionPx: null } });
    expect(rule("title-too-short").evaluate(page, config)).toHaveLength(0);
  });

  it("meta-description-too-short fires on pixel width even when the character count passes", () => {
    const desc = "A meta description that clears the seventy character minimum comfortably enough.";
    const page = makePage({ metaDescription: desc, pixelWidths: { titlePx: null, metaDescriptionPx: 300 } });
    const issues = rule("meta-description-too-short").evaluate(page, config)!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.threshold).toContain("px");
  });

  it("does not fire either pixel rule when pixel width was never captured", () => {
    const page = makePage({ title: longTitle, pixelWidths: undefined });
    expect(rule("title-too-short").evaluate(page, config)).toHaveLength(0);
  });
});
