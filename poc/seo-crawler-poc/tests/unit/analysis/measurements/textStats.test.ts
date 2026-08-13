import { describe, expect, it } from "vitest";
import { fleschReadingEase } from "../../../../src/analysis/measurements/textStats";

describe("fleschReadingEase", () => {
  it("returns null for empty/whitespace-only text", () => {
    expect(fleschReadingEase("")).toBeNull();
    expect(fleschReadingEase("   ")).toBeNull();
  });

  it("scores short, simple sentences higher (easier) than long, dense ones", () => {
    const simple = fleschReadingEase("The cat sat. The dog ran. It was fun.");
    const dense = fleschReadingEase(
      "The multidisciplinary implementation necessitates comprehensive reconceptualization of institutionalized organizational infrastructures.",
    );
    expect(simple).not.toBeNull();
    expect(dense).not.toBeNull();
    expect(simple!.score).toBeGreaterThan(dense!.score);
  });

  it("counts words and sentences plausibly", () => {
    const result = fleschReadingEase("One two three. Four five six.");
    expect(result!.words).toBe(6);
    expect(result!.sentences).toBe(2);
    expect(result!.syllables).toBeGreaterThanOrEqual(6);
  });

  it("never divides by zero on a single-fragment page (no terminal punctuation)", () => {
    expect(() => fleschReadingEase("no punctuation here just words")).not.toThrow();
    expect(fleschReadingEase("no punctuation here just words")!.sentences).toBe(1);
  });
});
