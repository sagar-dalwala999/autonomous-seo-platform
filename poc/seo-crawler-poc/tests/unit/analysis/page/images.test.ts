import { describe, expect, it } from "vitest";
import { imageRules } from "../../../../src/analysis/rules/page/images";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";
import type { ImageRecord } from "../../../../src/models/types";

const rule = (id: string) => imageRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

const img = (overrides: Partial<ImageRecord> = {}): ImageRecord => ({
  url: "http://ex.com/x.jpg",
  alt: "a photo",
  width: 100,
  height: 100,
  format: "jpg",
  ...overrides,
});

describe("image-missing-alt / image-empty-alt", () => {
  it("image-missing-alt fires on alt: null (matches seeded /products/cascade-rain-shell)", () => {
    const issues = rule("image-missing-alt").evaluate(makePage({ images: [img({ alt: null })] }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.evidence).toEqual([{ field: "images[0].alt", value: null }]);
  });

  it("image-missing-alt does not fire when alt is present or empty", () => {
    expect(rule("image-missing-alt").evaluate(makePage({ images: [img({ alt: "" }), img({ alt: "x" })] }), config)).toEqual([]);
  });

  it("image-empty-alt fires on alt: '' distinctly from null", () => {
    const issues = rule("image-empty-alt").evaluate(makePage({ images: [img({ alt: "" })] }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
  });

  it("image-empty-alt does not fire on alt: null", () => {
    expect(rule("image-empty-alt").evaluate(makePage({ images: [img({ alt: null })] }), config)).toEqual([]);
  });
});

describe("image-bad-format", () => {
  it("fires on bmp (matches seeded /products/granite-hiking-boots)", () => {
    const issues = rule("image-bad-format").evaluate(makePage({ images: [img({ format: "bmp" })] }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
  });

  it("does not fire on jpg/png/webp", () => {
    expect(
      rule("image-bad-format").evaluate(makePage({ images: [img({ format: "jpg" }), img({ format: "webp" })] }), config),
    ).toEqual([]);
  });
});

describe("image-missing-dimensions", () => {
  it("fires when width or height is null (matches seeded homepage hero image)", () => {
    const issues = rule("image-missing-dimensions").evaluate(makePage({ images: [img({ width: null, height: null })] }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
  });

  it("does not fire when both dimensions are present", () => {
    expect(rule("image-missing-dimensions").evaluate(makePage({ images: [img({ width: 240, height: 240 })] }), config)).toEqual([]);
  });

  it("does not fire on a page with no images", () => {
    expect(rule("image-missing-dimensions").evaluate(makePage({ images: [] }), config)).toEqual([]);
  });
});
