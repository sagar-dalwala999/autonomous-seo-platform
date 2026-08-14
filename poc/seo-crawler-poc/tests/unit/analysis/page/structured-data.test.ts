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

describe("structured-data-type-mismatch (corroborated heuristic)", () => {
  const recipeReport = (over = {}) => ({
    items: [
      {
        format: "json-ld" as const,
        types: ["Recipe"],
        path: "$[0]",
        blockIndex: 0,
        node: {},
        validation: { profile: "Recipe", status: "validated" as const, missingRequired: ["image"], missingRecommended: [] },
      },
    ],
    counts: {
      jsonLdBlocks: 1, jsonLdParseErrors: 0, items: 1, jsonLdItems: 1, microdataItems: 0, rdfaItems: 0,
      validatedItems: 1, itemsMissingRequired: 1, unknownTypes: 0,
    },
    errors: [],
    types: ["Recipe"],
    truncated: false,
    ...over,
  });

  it("fires when nothing on the page signals the type AND the node is incomplete (matches seeded /blog/layering-basics)", () => {
    const issues = rule("structured-data-type-mismatch").evaluate(
      makePage({
        url: "http://localhost:3105/blog/layering-basics",
        title: "Hiking Gear Tips | Summit Trail Gear",
        headings: { h1: ["Layering basics for cold weather"], h2: [], h3: [] },
        content: { text: "base layer mid layer shell", wordCount: 5, contentHash: "h" },
        structuredDataReport: recipeReport(),
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
    expect(issues![0]!.message).toContain("missing image");
  });

  it("does not fire when the URL signals the topic", () => {
    expect(
      rule("structured-data-type-mismatch").evaluate(
        makePage({ url: "http://localhost:3105/recipes/trail-oats", structuredDataReport: recipeReport() }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire when only the body copy signals the topic — a real recipe at /blog/best-brownies", () => {
    expect(
      rule("structured-data-type-mismatch").evaluate(
        makePage({
          url: "http://localhost:3105/blog/best-brownies",
          title: "Best brownies",
          content: { text: "This recipe uses cocoa. Cook for 25 minutes.", wordCount: 8, contentHash: "h" },
          structuredDataReport: recipeReport(),
        }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire when the node is complete — an off-topic URL alone is too weak to report", () => {
    const complete = recipeReport();
    complete.items[0]!.validation.missingRequired = [];
    expect(
      rule("structured-data-type-mismatch").evaluate(
        makePage({ url: "http://localhost:3105/blog/layering-basics", structuredDataReport: complete }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire for types outside the curated hint list (e.g. Product)", () => {
    const product = recipeReport();
    product.items[0]!.types = ["Product"];
    expect(
      rule("structured-data-type-mismatch").evaluate(
        makePage({ url: "http://localhost:3105/products/ridgeline-backpack-45l", structuredDataReport: product }),
        config,
      ),
    ).toEqual([]);
  });

  it("skips a legacy run: the URL keyword test alone cannot be corroborated, so it reports could-not-check", () => {
    expect(
      rule("structured-data-type-mismatch").evaluate(
        makePage({
          url: "http://localhost:3105/blog/layering-basics",
          structuredData: [sd({ parsed: { "@type": "Recipe", name: "Layering Basics" } })],
        }),
        config,
      ),
    ).toBeNull();
  });
});

describe("video-embed-without-schema", () => {
  const embed = (kind: "youtube" | "vimeo" | "file") => ({
    url: `https://provider.example/${kind}/1`,
    kind,
    poster: null,
    mimeType: null,
    providerId: kind === "file" ? null : "1",
  });

  it("fires on a YouTube embed with no VideoObject (matches arena.ai/blog/agent-mode)", () => {
    const issues = rule("video-embed-without-schema").evaluate(
      makePage({ videos: [embed("youtube"), embed("vimeo")], structuredData: [sd({ parsed: { "@type": "Article", headline: "x" } })] }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
    expect(issues![0]!.evidence).toHaveLength(2);
  });

  it("does not fire on a bare <video> file — usually a decorative background loop", () => {
    expect(rule("video-embed-without-schema").evaluate(makePage({ videos: [embed("file")] }), config)).toEqual([]);
  });

  it("does not fire when VideoObject is nested inside @graph or a parent entity", () => {
    expect(
      rule("video-embed-without-schema").evaluate(
        makePage({ videos: [embed("youtube")], structuredData: [sd({ parsed: { "@graph": [{ "@type": "VideoObject", name: "v" }] } })] }),
        config,
      ),
    ).toEqual([]);
    expect(
      rule("video-embed-without-schema").evaluate(
        makePage({ videos: [embed("youtube")], structuredData: [sd({ parsed: { "@type": "Article", video: { "@type": "VideoObject" } } })] }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire on a page with no videos at all", () => {
    expect(rule("video-embed-without-schema").evaluate(makePage(), config)).toEqual([]);
  });
});

describe("report-driven upgrades (v4 structuredDataReport)", () => {
  const baseCounts = {
    jsonLdBlocks: 1, jsonLdParseErrors: 0, items: 1, jsonLdItems: 1, microdataItems: 0, rdfaItems: 0,
    validatedItems: 1, itemsMissingRequired: 0, unknownTypes: 0,
  };
  const mkReport = (over: Record<string, unknown> = {}) =>
    ({ items: [], counts: baseCounts, errors: [], types: [], truncated: false, ...over }) as never;

  it("missing-required validates beyond the legacy 3-type table and names the format (matches sd-wave-fixture's RDFa Recipe)", () => {
    const issues = rule("structured-data-missing-required-property").evaluate(
      makePage({
        structuredDataReport: mkReport({
          items: [
            {
              format: "rdfa", types: ["Recipe"], path: "rdfa[0]", blockIndex: null, node: {},
              validation: { profile: "Recipe", status: "validated", missingRequired: ["image"], missingRecommended: [] },
            },
          ],
        }),
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.message).toContain("(rdfa)");
    expect(issues![0]!.evidence.map((e) => e.field)).toContain("structuredDataReport.items[0].path");
  });

  it("missing-required ignores @id reference nodes", () => {
    expect(
      rule("structured-data-missing-required-property").evaluate(
        makePage({
          structuredDataReport: mkReport({
            items: [
              {
                format: "json-ld", types: ["Article"], path: "$[0]", blockIndex: 0, node: {},
                validation: { profile: "Article", status: "reference", missingRequired: ["headline"], missingRecommended: [] },
              },
            ],
          }),
        }),
        config,
      ),
    ).toEqual([]);
  });

  it("parse-error reports malformed JSON but no longer mislabels an empty block as malformed", () => {
    const page = makePage({
      structuredData: [sd({ raw: "", parseError: "Unexpected end of JSON input" })],
      structuredDataReport: mkReport({
        errors: [{ kind: "empty-block", format: "json-ld", blockIndex: 0, message: "Empty block.", value: null }],
      }),
    });
    expect(rule("structured-data-parse-error").evaluate(page, config)).toEqual([]);
  });

  it("video-embed-without-schema sees a microdata VideoObject through report.types", () => {
    const video = { url: "https://www.youtube.com/embed/x", kind: "youtube" as const, poster: null, mimeType: null, providerId: "x" };
    expect(
      rule("video-embed-without-schema").evaluate(
        makePage({ videos: [video], structuredData: [], structuredDataReport: mkReport({ types: ["VideoObject"] }) }),
        config,
      ),
    ).toEqual([]);
    expect(
      rule("video-embed-without-schema").evaluate(
        makePage({ videos: [video], structuredData: [], structuredDataReport: mkReport({ types: ["Article"] }) }),
        config,
      ),
    ).toHaveLength(1);
  });

  it("video-embed-without-schema skips a truncated report — types[] is taken after the 200-item cap", () => {
    expect(
      rule("video-embed-without-schema").evaluate(
        makePage({
          videos: [{ url: "https://www.youtube.com/embed/x", kind: "youtube", poster: null, mimeType: null, providerId: "x" }],
          structuredData: [],
          structuredDataReport: mkReport({ types: [], truncated: true }),
        }),
        config,
      ),
    ).toBeNull();
  });
});
