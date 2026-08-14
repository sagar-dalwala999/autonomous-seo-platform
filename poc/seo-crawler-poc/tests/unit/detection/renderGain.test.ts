import { describe, expect, it } from "vitest";
import { evaluateRenderGain } from "../../../src/detection/renderGain";
import { extraction, link } from "./helpers";
import type { ExtractionResult } from "../../../src/models/types";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("evaluateRenderGain", () => {
  it("keeps static when nothing changed across all six signals", () => {
    const base = extraction(words(20));
    const decision = evaluateRenderGain(base, base);
    expect(decision.keep).toBe("static");
    expect(decision.gained).toBe(false);
    expect(decision.reasons).toEqual(["render-gain:kept-static"]);
  });

  it("keeps static on noise-level word deltas below the minimum gain floor", () => {
    const staticEx = extraction(words(20));
    const renderedEx = extraction(words(25)); // +5 words, under MIN_WORD_GAIN(10)
    const decision = evaluateRenderGain(staticEx, renderedEx);
    expect(decision.keep).toBe("static");
    expect(decision.signals.text).toBe(false);
  });

  it("keeps rendered on a real word-count gain", () => {
    const staticEx = extraction(words(20));
    const renderedEx = extraction(words(50)); // +30 words
    const decision = evaluateRenderGain(staticEx, renderedEx);
    expect(decision.keep).toBe("rendered");
    expect(decision.signals.text).toBe(true);
    expect(decision.reasons).toContain("render-gain:text+30w");
  });

  it("keeps rendered on new internal links even with zero word gain", () => {
    const staticEx = extraction(words(20), []);
    const renderedEx = extraction(words(20), [
      link("https://example.test/a", "internal"),
      link("https://example.test/b", "internal"),
    ]);
    const decision = evaluateRenderGain(staticEx, renderedEx);
    expect(decision.keep).toBe("rendered");
    expect(decision.signals.links).toBe(true);
    expect(decision.signals.text).toBe(false);
  });

  it("keeps rendered on new images even with zero word/link gain — the image-led-page case", () => {
    const staticEx = extraction(words(20));
    const renderedEx: ExtractionResult = {
      ...extraction(words(20)),
      images: [
        { url: "https://example.test/a.jpg", alt: "a", width: null, height: null, format: "jpg" },
        { url: "https://example.test/b.jpg", alt: "b", width: null, height: null, format: "jpg" },
      ],
    };
    const decision = evaluateRenderGain(staticEx, renderedEx);
    expect(decision.keep).toBe("rendered");
    expect(decision.signals.images).toBe(true);
    expect(decision.reasons).toContain("render-gain:images+2");
  });

  it("counts backgroundImages toward the images signal too", () => {
    const staticEx = extraction(words(20));
    const renderedEx: ExtractionResult = {
      ...extraction(words(20)),
      backgroundImages: [{ url: "https://example.test/bg.jpg", alt: null, width: null, height: null, format: "jpg" }],
    };
    const decision = evaluateRenderGain(staticEx, renderedEx);
    expect(decision.signals.images).toBe(true);
  });

  it("keeps rendered when new headings appear", () => {
    const staticEx = extraction(words(20));
    const renderedEx: ExtractionResult = { ...extraction(words(20)), headings: { h1: ["Title"], h2: [], h3: [] } };
    const decision = evaluateRenderGain(staticEx, renderedEx);
    expect(decision.keep).toBe("rendered");
    expect(decision.signals.headings).toBe(true);
  });

  it("keeps rendered when title/meta/canonical appear only after rendering", () => {
    const staticEx = extraction(words(20));
    const renderedEx: ExtractionResult = { ...extraction(words(20)), title: "New Title" };
    const decision = evaluateRenderGain(staticEx, renderedEx);
    expect(decision.keep).toBe("rendered");
    expect(decision.signals.metaTags).toBe(true);
    expect(decision.reasons).toContain("render-gain:meta-tags");
  });

  it("does not fire metaTags when a tag merely CHANGES value (not new)", () => {
    const staticEx: ExtractionResult = { ...extraction(words(20)), title: "Old Title" };
    const renderedEx: ExtractionResult = { ...extraction(words(20)), title: "New Title" };
    const decision = evaluateRenderGain(staticEx, renderedEx);
    expect(decision.signals.metaTags).toBe(false);
  });

  it("keeps rendered when JSON-LD blocks appear", () => {
    const staticEx = extraction(words(20));
    const renderedEx: ExtractionResult = {
      ...extraction(words(20)),
      structuredData: [{ type: "json-ld", raw: "{}", valid: true } as unknown as ExtractionResult["structuredData"][number]],
    };
    const decision = evaluateRenderGain(staticEx, renderedEx);
    expect(decision.keep).toBe("rendered");
    expect(decision.signals.jsonLd).toBe(true);
  });

  it("keeps static when the rendered pass LOSES content (never treats a loss as a gain)", () => {
    const staticEx = extraction(words(50));
    const renderedEx = extraction(words(10));
    const decision = evaluateRenderGain(staticEx, renderedEx);
    expect(decision.keep).toBe("static");
    expect(decision.gained).toBe(false);
  });

  it("gained is true if ANY one of the six signals fires, even with the rest flat", () => {
    const staticEx = extraction(words(20));
    const renderedEx: ExtractionResult = { ...extraction(words(20)), headings: { h1: ["X"], h2: [], h3: [] } };
    const decision = evaluateRenderGain(staticEx, renderedEx);
    expect(decision.gained).toBe(true);
    expect(decision.signals).toEqual({
      text: false,
      links: false,
      images: false,
      headings: true,
      metaTags: false,
      jsonLd: false,
    });
  });
});
