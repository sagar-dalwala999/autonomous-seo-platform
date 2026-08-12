import { describe, expect, it } from "vitest";
import { httpRules } from "../../../../src/analysis/rules/page/http";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";

const rule = (id: string) => httpRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

describe("http-error-4xx / http-error-5xx", () => {
  it("http-error-4xx fires on 404 (matches seeded /guides/gear-repair)", () => {
    const issues = rule("http-error-4xx").evaluate(makePage({ statusCode: 404 }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("error");
  });

  it("http-error-4xx does not fire on 200 or 5xx", () => {
    expect(rule("http-error-4xx").evaluate(makePage({ statusCode: 200 }), config)).toEqual([]);
    expect(rule("http-error-4xx").evaluate(makePage({ statusCode: 503 }), config)).toEqual([]);
  });

  it("http-error-5xx fires on 500-599", () => {
    const issues = rule("http-error-5xx").evaluate(makePage({ statusCode: 502 }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("error");
  });

  it("http-error-5xx does not fire on null statusCode (unresolved)", () => {
    expect(rule("http-error-5xx").evaluate(makePage({ statusCode: null }), config)).toEqual([]);
  });
});

describe("slow-page", () => {
  it("fires above the threshold", () => {
    const issues = rule("slow-page").evaluate(makePage({ performance: { responseTimeMs: 5000 } }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning"); // heuristic — never error (MF-5)
  });

  it("does not fire under the threshold or when unmeasured", () => {
    expect(rule("slow-page").evaluate(makePage({ performance: { responseTimeMs: 300 } }), config)).toEqual([]);
    expect(rule("slow-page").evaluate(makePage({ performance: { responseTimeMs: null } }), config)).toEqual([]);
  });
});
