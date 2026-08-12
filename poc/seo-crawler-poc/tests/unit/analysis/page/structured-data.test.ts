import { describe, expect, it } from "vitest";
import { structuredDataRules } from "../../../../src/analysis/rules/page/structured-data";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";
import type { StructuredDataRecord } from "../../../../src/models/types";

const rule = (id: string) => structuredDataRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

const sd = (overrides: Partial<StructuredDataRecord> = {}): StructuredDataRecord => ({
  type: "application/ld+json",
  raw: "{}",
  parsed: {},
  parseError: null,
  ...overrides,
});

describe("structured-data-parse-error", () => {
  it("fires on invalid JSON-LD (matches seeded /blog/choosing-hiking-boots)", () => {
    const issues = rule("structured-data-parse-error").evaluate(
      makePage({ structuredData: [sd({ parsed: null, parseError: "Expected double-quoted property name" })] }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("error");
  });

  it("does not fire when parseError is null", () => {
    expect(rule("structured-data-parse-error").evaluate(makePage({ structuredData: [sd()] }), config)).toEqual([]);
  });

  it("does not fire on a page with no structured data", () => {
    expect(rule("structured-data-parse-error").evaluate(makePage({ structuredData: [] }), config)).toEqual([]);
  });
});

describe("structured-data-missing-required-property", () => {
  it("fires when a Product block is missing offers (matches seeded /products/ridgeline-backpack-45l, manifest #11c)", () => {
    const issues = rule("structured-data-missing-required-property").evaluate(
      makePage({
        structuredData: [sd({ parsed: { "@type": "Product", name: "Ridgeline 45L Backpack", image: "x.png" } })],
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.message).toContain("offers");
    expect(issues![0]!.severity).toBe("warning");
  });

  it("does not fire when Product has both name and offers", () => {
    const issues = rule("structured-data-missing-required-property").evaluate(
      makePage({
        structuredData: [sd({ parsed: { "@type": "Product", name: "X", offers: { "@type": "Offer", price: "10" } } })],
      }),
      config,
    );
    expect(issues).toEqual([]);
  });

  it("fires when an Article block is missing headline", () => {
    const issues = rule("structured-data-missing-required-property").evaluate(
      makePage({ structuredData: [sd({ parsed: { "@type": "Article", author: "x" } })] }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.message).toContain("headline");
  });

  it("fires when a FAQPage block is missing mainEntity", () => {
    const issues = rule("structured-data-missing-required-property").evaluate(
      makePage({ structuredData: [sd({ parsed: { "@type": "FAQPage" } })] }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.message).toContain("mainEntity");
  });

  it("does not fire for a type outside the POC-covered set (e.g. Organization)", () => {
    expect(
      rule("structured-data-missing-required-property").evaluate(
        makePage({ structuredData: [sd({ parsed: { "@type": "Organization", name: "x" } })] }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire on an unparseable block (parse-error rule owns that)", () => {
    expect(
      rule("structured-data-missing-required-property").evaluate(
        makePage({ structuredData: [sd({ parsed: null, parseError: "bad json" })] }),
        config,
      ),
    ).toEqual([]);
  });
});

describe("structured-data-type-mismatch (heuristic)", () => {
  it("fires when Recipe markup appears on a URL with no recipe/food signal (matches seeded /blog/layering-basics, manifest #11b)", () => {
    const issues = rule("structured-data-type-mismatch").evaluate(
      makePage({
        url: "http://localhost:3105/blog/layering-basics",
        structuredData: [sd({ parsed: { "@type": "Recipe", name: "Layering Basics", recipeIngredient: ["a"] } })],
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
  });

  it("does not fire when the URL matches the type's topic", () => {
    expect(
      rule("structured-data-type-mismatch").evaluate(
        makePage({
          url: "http://localhost:3105/recipes/trail-oats",
          structuredData: [sd({ parsed: { "@type": "Recipe", name: "Trail Oats" } })],
        }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire for types outside the curated hint list (e.g. Product/Article)", () => {
    expect(
      rule("structured-data-type-mismatch").evaluate(
        makePage({
          url: "http://localhost:3105/products/ridgeline-backpack-45l",
          structuredData: [sd({ parsed: { "@type": "Product", name: "x", offers: {} } })],
        }),
        config,
      ),
    ).toEqual([]);
  });
});
