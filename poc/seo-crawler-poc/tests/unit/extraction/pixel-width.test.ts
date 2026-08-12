import { describe, it, expect } from "vitest";
import { estimateTitlePx, estimateMetaDescriptionPx } from "../../../src/extraction/pixel-width";

describe("estimateTitlePx / estimateMetaDescriptionPx", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(estimateTitlePx(null)).toBeNull();
    expect(estimateTitlePx(undefined)).toBeNull();
    expect(estimateTitlePx("")).toBeNull();
    expect(estimateMetaDescriptionPx("")).toBeNull();
  });

  it("a longer string estimates a larger pixel width than a shorter one", () => {
    const short = estimateTitlePx("Short");
    const long = estimateTitlePx("A Much Longer Title With Considerably More Characters In It");
    expect(short).not.toBeNull();
    expect(long).not.toBeNull();
    expect(long!).toBeGreaterThan(short!);
  });

  it("is deterministic for the same input", () => {
    expect(estimateTitlePx("Ridgeline 45L Backpack")).toBe(estimateTitlePx("Ridgeline 45L Backpack"));
  });

  it("scales with the given font-size bucket — same text, title (20px) vs description (14px) differ", () => {
    const text = "Ridgeline 45L Backpack Review";
    const titlePx = estimateTitlePx(text);
    const descPx = estimateMetaDescriptionPx(text);
    expect(titlePx).not.toBeNull();
    expect(descPx).not.toBeNull();
    expect(titlePx!).toBeGreaterThan(descPx!);
  });

  it("unknown characters (accented/CJK) still produce a finite positive estimate via the fallback width", () => {
    const px = estimateTitlePx("café 日本語");
    expect(px).not.toBeNull();
    expect(px!).toBeGreaterThan(0);
  });
});
