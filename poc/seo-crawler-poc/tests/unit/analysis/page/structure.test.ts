import { describe, expect, it } from "vitest";
import { structureRules } from "../../../../src/analysis/rules/page/structure";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";
import type { DocumentStructure } from "../../../../src/models/types";

const rule = (id: string) => structureRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

const structure = (landmarks: string[]): DocumentStructure => ({
  headings: [],
  paragraphs: 3,
  lists: { ordered: 0, unordered: 1, definition: 0 },
  tables: { total: 0, withTh: 0, withCaption: 0 },
  codeBlocks: 0,
  blockquotes: 0,
  landmarks,
});

describe("main-landmark-missing", () => {
  it("fires when no <main> element and no role=main content area", () => {
    const issues = rule("main-landmark-missing").evaluate(
      makePage({
        structure: structure(["nav", "footer"]),
        content: { text: "x", wordCount: 1, contentHash: "h", contentAreaMethod: "body-minus-chrome" },
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
  });

  it("does not fire when a <main> element is present (matches every v3 run in storage/runs)", () => {
    expect(
      rule("main-landmark-missing").evaluate(
        makePage({ structure: structure(["main", "nav"]), content: { text: "x", wordCount: 1, contentHash: "h", contentAreaMethod: "main" } }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire on role=main — structure.landmarks only tracks the element, never the ARIA role", () => {
    expect(
      rule("main-landmark-missing").evaluate(
        makePage({ structure: structure(["nav"]), content: { text: "x", wordCount: 1, contentHash: "h", contentAreaMethod: "role-main" } }),
        config,
      ),
    ).toEqual([]);
  });

  it("skips as data-unavailable when structure or contentAreaMethod is missing", () => {
    expect(rule("main-landmark-missing").evaluate(makePage(), config)).toBeNull();
    expect(rule("main-landmark-missing").evaluate(makePage({ structure: structure(["nav"]) }), config)).toBeNull();
  });
});
