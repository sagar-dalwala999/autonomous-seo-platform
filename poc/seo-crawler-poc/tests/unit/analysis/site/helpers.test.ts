import { describe, expect, it } from "vitest";
import { buildInlinkOccurrences } from "../../../../src/analysis/rules/site/helpers";
import { makeLink, makePage } from "./fixtures";

describe("buildInlinkOccurrences", () => {
  it("excludes self-links so every consumer reads the same inlink count", () => {
    const page = makePage({
      url: "https://x.test/target",
      links: [
        makeLink({ source: "https://x.test/target", target: "https://x.test/target" }),
        makeLink({ source: "https://x.test/target", target: "https://x.test/other" }),
      ],
    });
    const map = buildInlinkOccurrences([page]);
    expect(map.get("/target")).toBeUndefined();
    expect(map.get("/other")).toHaveLength(1);
  });

  it("excludes a self-link authored against the page's finalUrl after a redirect", () => {
    const page = makePage({
      url: "https://x.test/old",
      normalizedUrl: "https://x.test/old",
      finalUrl: "https://x.test/new",
      links: [makeLink({ source: "https://x.test/new", target: "https://x.test/new" })],
    });
    expect(buildInlinkOccurrences([page]).get("/new")).toBeUndefined();
  });

  it("still records genuine cross-page inlinks with their source and link index", () => {
    const a = makePage({
      url: "https://x.test/a",
      links: [
        makeLink({ source: "https://x.test/a", target: "https://x.test/a" }),
        makeLink({ source: "https://x.test/a", target: "https://x.test/b" }),
      ],
    });
    const occurrences = buildInlinkOccurrences([a]).get("/b")!;
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.linkIndex).toBe(1);
    expect(occurrences[0]!.source).toBe(a);
  });

  it("ignores external links entirely", () => {
    const a = makePage({
      url: "https://x.test/a",
      links: [makeLink({ source: "https://x.test/a", target: "https://other.test/b", type: "external" })],
    });
    expect(buildInlinkOccurrences([a]).size).toBe(0);
  });
});
