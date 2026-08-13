import { describe, expect, it } from "vitest";
import { contentRules } from "../../../../src/analysis/rules/page/content";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";

const rule = (id: string) => contentRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

describe("thin-content", () => {
  it("fires under the word threshold (matches seeded /blog/trail-snacks, 35 words)", () => {
    const issues = rule("thin-content").evaluate(makePage({ content: { text: "x", wordCount: 35, contentHash: "h" } }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning"); // heuristic — never error (MF-5)
  });

  it("does not fire above the threshold", () => {
    expect(
      rule("thin-content").evaluate(makePage({ content: { text: "x", wordCount: 300, contentHash: "h" } }), config),
    ).toEqual([]);
  });
});

describe("low-text-ratio (v2-optional pageStats)", () => {
  it("skips when pageStats was never captured", () => {
    const { pageStats, ...rest } = makePage();
    expect(rule("low-text-ratio").evaluate(rest, config)).toBeNull();
  });

  it("fires below the ratio threshold", () => {
    const issues = rule("low-text-ratio").evaluate(
      makePage({ pageStats: { htmlBytes: 10000, textRatio: 0.02, domNodes: 500, contentEncoding: null, httpVersion: null } }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice"); // heuristic — never error (MF-5)
  });

  it("does not fire at/above the threshold", () => {
    expect(
      rule("low-text-ratio").evaluate(
        makePage({ pageStats: { htmlBytes: 1000, textRatio: 0.5, domNodes: 50, contentEncoding: null, httpVersion: null } }),
        config,
      ),
    ).toEqual([]);
  });
});

describe("zero-word-content", () => {
  it("fires on a genuinely empty page (deterministic fact, error severity)", () => {
    const issues = rule("zero-word-content").evaluate(makePage({ content: { text: "", wordCount: 0, contentHash: "h" } }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("error");
    expect(issues![0]!.evidence).toEqual([{ field: "content.wordCount", value: 0 }]);
  });

  it("does not fire once there is any content, even below the thin-content threshold", () => {
    expect(rule("zero-word-content").evaluate(makePage({ content: { text: "x", wordCount: 1, contentHash: "h" } }), config)).toEqual([]);
  });
});

describe("low-readability (reads the pre-computed content.readability report)", () => {
  function readability(ease: number | null) {
    return { fleschReadingEase: ease, fleschKincaidGrade: null, sentences: 10, syllables: 400, averageWordsPerSentence: 20, band: "x" };
  }

  it("fires on a low score inside a real <article>", () => {
    const issues = rule("low-readability").evaluate(
      makePage({ content: { text: "…", wordCount: 200, contentHash: "h", contentAreaMethod: "article", readability: readability(21.8) } }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
    expect(issues![0]!.message).toContain("21.8");
    expect(issues![0]!.evidence).toEqual([
      { field: "content.wordCount", value: 200 },
      { field: "content.readability.fleschReadingEase", value: 21.8 },
    ]);
  });

  it("does not fire at/above the threshold", () => {
    expect(
      rule("low-readability").evaluate(
        makePage({ content: { text: "…", wordCount: 200, contentHash: "h", contentAreaMethod: "article", readability: readability(60) } }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire below the word-count floor, even on a low score", () => {
    expect(
      rule("low-readability").evaluate(
        makePage({ content: { text: "…", wordCount: 40, contentHash: "h", contentAreaMethod: "article", readability: readability(10) } }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire when the report itself has no score (too little text to measure)", () => {
    expect(
      rule("low-readability").evaluate(
        makePage({ content: { text: "…", wordCount: 200, contentHash: "h", contentAreaMethod: "article", readability: readability(null) } }),
        config,
      ),
    ).toEqual([]);
  });

  // Real-data false positive this guard closes: on a real books.toscrape.com crawl, a category
  // page (genre-nav strip glued to a product grid) scored Flesch ~18-26 despite being navigation,
  // not prose — dozens of short polysyllabic category names with no real sentence structure tank
  // the formula. Confirmed the same page scores clean once contentAreaMethod is gated to "article".
  it("does not fire on non-article content, however low the score would measure — the score isn't trustworthy there", () => {
    for (const method of ["body-minus-chrome", "main", "role-main"] as const) {
      expect(
        rule("low-readability").evaluate(
          makePage({ content: { text: "…", wordCount: 200, contentHash: "h", contentAreaMethod: method, readability: readability(10) } }),
          config,
        ),
      ).toEqual([]);
    }
  });

  it("skips as data-unavailable when contentAreaMethod or readability was never captured (pre-wave record)", () => {
    expect(
      rule("low-readability").evaluate(
        makePage({ content: { text: "…", wordCount: 200, contentHash: "h", readability: readability(10) } }),
        config,
      ),
    ).toBeNull();
    expect(
      rule("low-readability").evaluate(
        makePage({ content: { text: "…", wordCount: 200, contentHash: "h", contentAreaMethod: "article" } }),
        config,
      ),
    ).toBeNull();
  });
});
