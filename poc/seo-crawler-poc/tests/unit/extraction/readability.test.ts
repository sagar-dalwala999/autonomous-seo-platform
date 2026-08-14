import { describe, it, expect } from "vitest";
import { computeReadability, computeKeywordDensity } from "../../../src/extraction/readability";

describe("computeReadability", () => {
  it("returns nulls with an honest band for empty text", () => {
    const r = computeReadability("");
    expect(r).toEqual({
      fleschReadingEase: null,
      fleschKincaidGrade: null,
      sentences: 0,
      syllables: 0,
      averageWordsPerSentence: 0,
      band: "not enough text",
    });
  });

  it("scores simple short sentences as easy", () => {
    const r = computeReadability("The cat sat on the mat. The dog ran fast. I like cats and dogs.");
    expect(r.fleschReadingEase).not.toBeNull();
    expect(r.fleschReadingEase!).toBeGreaterThan(70);
    expect(r.sentences).toBe(3);
    expect(r.band).toMatch(/easy/);
  });

  it("scores long, multisyllabic academic prose as hard", () => {
    const r = computeReadability(
      "The instantiation of multidimensional organizational architectures necessitates comprehensive interdisciplinary methodological considerations, particularly regarding sociopolitical ramifications."
    );
    expect(r.fleschReadingEase).not.toBeNull();
    expect(r.fleschReadingEase!).toBeLessThan(40);
  });

  it("counts a lone sentence with no terminal punctuation as one sentence, not zero", () => {
    const r = computeReadability("Just some words with no period at the end");
    expect(r.sentences).toBe(1);
    expect(r.fleschReadingEase).not.toBeNull();
  });
});

describe("computeKeywordDensity", () => {
  it("returns empty buckets for empty text", () => {
    const r = computeKeywordDensity("");
    expect(r).toEqual({ totalTerms: 0, oneWord: [], twoWord: [] });
  });

  it("filters stopwords and short tokens, ranks by frequency", () => {
    const text = "hiking gear hiking boots hiking trail hiking pack the gear is great gear for hiking trips";
    const r = computeKeywordDensity(text);
    expect(r.oneWord[0]!.term).toBe("hiking"); // 5 occurrences, strictly more than "gear" (3)
    expect(r.oneWord[0]!.count).toBe(5);
    expect(r.oneWord.some((k) => k.term === "the")).toBe(false); // stopword excluded
    expect(r.oneWord.some((k) => k.term === "is")).toBe(false); // stopword excluded
  });

  it("only surfaces terms that repeat (count > 1), never a singleton", () => {
    const r = computeKeywordDensity("unique singleton words appear only once each here");
    expect(r.oneWord).toEqual([]);
  });

  it("computes two-word phrase density from adjacent non-stopword tokens", () => {
    const text = "trail running shoes trail running shoes trail running gear";
    const r = computeKeywordDensity(text);
    expect(r.twoWord.some((k) => k.term === "trail running")).toBe(true);
  });

  it("density percentages are computed against total token count, capped at the limit", () => {
    const text = Array(5).fill("mountain").join(" ") + " " + Array(3).fill("valley").join(" ");
    const r = computeKeywordDensity(text, 1);
    expect(r.oneWord).toHaveLength(1);
    expect(r.oneWord[0]!.term).toBe("mountain");
    expect(r.oneWord[0]!.density).toBeCloseTo((5 / 8) * 100, 1);
  });
});
