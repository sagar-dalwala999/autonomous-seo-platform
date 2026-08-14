import { describe, expect, it } from "vitest";
import { structuredDataReportRules } from "../../../../src/analysis/rules/page/structured-data-report";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";
import type {
  StructuredDataError,
  StructuredDataItem,
  StructuredDataReport,
  StructuredDataValidation,
} from "../../../../src/models/types";

const rule = (id: string) => structuredDataReportRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

const validation = (over: Partial<StructuredDataValidation> = {}): StructuredDataValidation => ({
  profile: "Article",
  status: "validated",
  missingRequired: [],
  missingRecommended: [],
  ...over,
});

const item = (over: Partial<StructuredDataItem> = {}): StructuredDataItem => ({
  format: "json-ld",
  types: ["Article"],
  path: "$.@graph[0]",
  blockIndex: 0,
  node: {},
  validation: validation(),
  ...over,
});

function report(over: Partial<StructuredDataReport> = {}): StructuredDataReport {
  const items = over.items ?? [];
  return {
    items,
    counts: {
      jsonLdBlocks: 1, jsonLdParseErrors: 0, items: items.length,
      jsonLdItems: items.filter((i) => i.format === "json-ld").length,
      microdataItems: items.filter((i) => i.format === "microdata").length,
      rdfaItems: items.filter((i) => i.format === "rdfa").length,
      validatedItems: items.length, itemsMissingRequired: 0, unknownTypes: 0,
      ...over.counts,
    },
    errors: over.errors ?? [],
    types: over.types ?? [...new Set(items.flatMap((i) => i.types))],
    truncated: over.truncated ?? false,
  };
}

const err = (kind: StructuredDataError["kind"], value: string | null = null): StructuredDataError => ({
  kind, format: "json-ld", blockIndex: 0, message: `${kind} message`, value,
});

/** Every rule in this pack needs the report; none may treat its absence as a pass. */
describe("data availability", () => {
  it("returns null on a run predating structuredDataReport", () => {
    for (const r of structuredDataReportRules()) expect(r.evaluate(makePage(), config), r.meta.id).toBeNull();
  });

  it("returns null when the report is present but hollow", () => {
    const page = makePage({ structuredDataReport: {} as StructuredDataReport });
    for (const r of structuredDataReportRules()) expect(r.evaluate(page, config), r.meta.id).toBeNull();
  });
});

describe("structured-data-missing-recommended-property", () => {
  it("aggregates one issue per page (matches sd-wave-fixture: 9 nodes, 1 issue)", () => {
    const issues = rule("structured-data-missing-recommended-property").evaluate(
      makePage({
        structuredDataReport: report({
          items: [
            item({ types: ["Organization"], validation: validation({ missingRecommended: ["sameAs", "description"] }) }),
            item({ types: ["Article"], validation: validation({ missingRecommended: ["image"] }) }),
          ],
        }),
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
    expect(issues![0]!.evidence).toHaveLength(2);
  });

  it("excludes ImageObject — Yoast emits one per image and it always has recommended gaps", () => {
    expect(
      rule("structured-data-missing-recommended-property").evaluate(
        makePage({
          structuredDataReport: report({
            items: [item({ types: ["ImageObject"], validation: validation({ missingRecommended: ["caption", "author"] }) })],
          }),
        }),
        config,
      ),
    ).toEqual([]);
  });

  it("skips @id reference nodes, which carry no properties of their own", () => {
    expect(
      rule("structured-data-missing-recommended-property").evaluate(
        makePage({
          structuredDataReport: report({
            items: [item({ validation: validation({ status: "reference", missingRecommended: ["image"] }) })],
          }),
        }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire when nothing is missing", () => {
    expect(
      rule("structured-data-missing-recommended-property").evaluate(makePage({ structuredDataReport: report({ items: [item()] }) }), config),
    ).toEqual([]);
  });
});

describe("structured-data-unknown-type", () => {
  it("fires on a type that is not on schema.org (matches sd-wave-fixture's \"Prodcut\")", () => {
    const issues = rule("structured-data-unknown-type").evaluate(
      makePage({
        structuredDataReport: report({ items: [item({ types: ["Prodcut"], validation: validation({ status: "unknown-type" }) })] }),
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
    expect(issues![0]!.message).toContain("Prodcut");
  });

  it("does not fire on a real type we simply have no rich-result profile for", () => {
    expect(
      rule("structured-data-unknown-type").evaluate(
        makePage({ structuredDataReport: report({ items: [item({ types: ["Thing"], validation: validation({ status: "no-profile" }) })] }) }),
        config,
      ),
    ).toEqual([]);
  });
});

describe("error-kind rules", () => {
  const cases: [string, StructuredDataError["kind"], string][] = [
    ["structured-data-missing-type", "missing-type", "declare no type"],
    ["structured-data-missing-context", "missing-context", "no @context"],
    ["structured-data-invalid-context", "invalid-context", "not schema.org"],
    ["structured-data-empty-block", "empty-block", "empty JSON-LD"],
  ];

  it.each(cases)("%s fires on its own error kind only", (id, kind, fragment) => {
    const issues = rule(id).evaluate(
      makePage({ structuredDataReport: report({ errors: [err(kind, kind === "invalid-context" ? "https://example.org/" : null)] }) }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.message).toContain(fragment);
  });

  it.each(cases)("%s stays clean when only unrelated errors are present", (id) => {
    expect(rule(id).evaluate(makePage({ structuredDataReport: report({ errors: [err("malformed-json")] }) }), config)).toEqual([]);
  });

  it("empty-block is a notice, not an error — it is a templating bug, not broken JSON", () => {
    const issues = rule("structured-data-empty-block").evaluate(
      makePage({ structuredDataReport: report({ errors: [err("empty-block")] }) }),
      config,
    );
    expect(issues![0]!.severity).toBe("notice");
  });
});

describe("structured-data-no-json-ld", () => {
  it("fires when every node is microdata/RDFa", () => {
    const issues = rule("structured-data-no-json-ld").evaluate(
      makePage({ structuredDataReport: report({ items: [item({ format: "microdata" }), item({ format: "rdfa" })] }) }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
  });

  it("does not fire when any JSON-LD node exists, nor when there is no structured data at all", () => {
    expect(
      rule("structured-data-no-json-ld").evaluate(
        makePage({ structuredDataReport: report({ items: [item(), item({ format: "microdata" })] }) }),
        config,
      ),
    ).toEqual([]);
    expect(rule("structured-data-no-json-ld").evaluate(makePage({ structuredDataReport: report() }), config)).toEqual([]);
  });

  it("skips a truncated report — counts are taken after the 200-item cap, so absence proves nothing", () => {
    expect(
      rule("structured-data-no-json-ld").evaluate(
        makePage({ structuredDataReport: report({ items: [item({ format: "microdata" })], truncated: true }) }),
        config,
      ),
    ).toBeNull();
  });
});

describe("no-structured-data", () => {
  it("fires when the report is present but empty — no JSON-LD, microdata or RDFa anywhere", () => {
    const issues = rule("no-structured-data").evaluate(makePage({ structuredDataReport: report() }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
    expect(issues![0]!.evidence).toEqual([{ field: "structuredDataReport.counts.items", value: 0 }]);
  });

  it("does not fire once any item exists, JSON-LD or otherwise", () => {
    expect(rule("no-structured-data").evaluate(makePage({ structuredDataReport: report({ items: [item({ format: "microdata" })] }) }), config)).toEqual(
      [],
    );
  });

  it("skips a truncated report — zero seen after the cap proves nothing", () => {
    expect(rule("no-structured-data").evaluate(makePage({ structuredDataReport: report({ truncated: true }) }), config)).toBeNull();
  });

  it("returns null on a run predating structuredDataReport", () => {
    expect(rule("no-structured-data").evaluate(makePage(), config)).toBeNull();
  });
});
