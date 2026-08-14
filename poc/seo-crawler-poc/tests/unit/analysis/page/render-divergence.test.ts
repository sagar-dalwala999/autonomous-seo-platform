import { describe, expect, it } from "vitest";
import { renderDivergenceRules } from "../../../../src/analysis/rules/page/render-divergence";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";
import type { RenderDivergence } from "../../../../src/models/types";

const rule = (id: string) => renderDivergenceRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

/** The three rules that need the optional canonical/noindex snapshot fields. */
const INDEXING_RULES = ["js-applied-noindex", "noindex-in-raw-html-only", "canonical-changed-by-js"];

function divergence(over: Partial<RenderDivergence>): RenderDivergence {
  return {
    titleChanged: false,
    metaDescriptionChanged: false,
    canonicalChanged: false,
    noindexChanged: false,
    linkCountDelta: 0,
    wordCountDelta: 0,
    staticRawSaved: true,
    ...over,
  };
}

describe("js-applied-noindex", () => {
  it("fires when raw HTML is indexable but the rendered page is noindex", () => {
    const page = makePage({ renderDivergence: divergence({ staticNoindex: false, renderedNoindex: true, noindexChanged: true }) });
    const issues = rule("js-applied-noindex").evaluate(page, config)!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
  });

  it("does not fire in the opposite direction — that is a different bug", () => {
    const page = makePage({ renderDivergence: divergence({ staticNoindex: true, renderedNoindex: false, noindexChanged: true }) });
    expect(rule("js-applied-noindex").evaluate(page, config)).toHaveLength(0);
  });

  it("does not fire when both agree", () => {
    for (const v of [true, false]) {
      const page = makePage({ renderDivergence: divergence({ staticNoindex: v, renderedNoindex: v }) });
      expect(rule("js-applied-noindex").evaluate(page, config)).toHaveLength(0);
    }
  });
});

describe("noindex-in-raw-html-only", () => {
  it("fires when only the rendered DOM removes noindex — Google may never render it", () => {
    const page = makePage({ renderDivergence: divergence({ staticNoindex: true, renderedNoindex: false, noindexChanged: true }) });
    const issues = rule("noindex-in-raw-html-only").evaluate(page, config)!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
  });

  it("does not fire in the js-applied direction", () => {
    const page = makePage({ renderDivergence: divergence({ staticNoindex: false, renderedNoindex: true }) });
    expect(rule("noindex-in-raw-html-only").evaluate(page, config)).toHaveLength(0);
  });
});

describe("canonical-changed-by-js", () => {
  it("distinguishes appeared / removed / repointed", () => {
    const cases: [Partial<RenderDivergence>, string][] = [
      [{ staticCanonical: null, renderedCanonical: "https://x.test/a" }, "only exists after rendering"],
      [{ staticCanonical: "https://x.test/a", renderedCanonical: null }, "removed by rendering"],
      [{ staticCanonical: "https://x.test/a", renderedCanonical: "https://x.test/b" }, "points somewhere else"],
    ];
    for (const [d, expected] of cases) {
      const issues = rule("canonical-changed-by-js").evaluate(makePage({ renderDivergence: divergence(d) }), config)!;
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain(expected);
    }
  });

  it("does not fire when the canonical matches, including both absent", () => {
    for (const v of ["https://x.test/a", null]) {
      const page = makePage({ renderDivergence: divergence({ staticCanonical: v, renderedCanonical: v }) });
      expect(rule("canonical-changed-by-js").evaluate(page, config)).toHaveLength(0);
    }
  });
});

describe("data availability", () => {
  it("returns null (not a pass) on a page that was never rendered", () => {
    const page = makePage({ renderDivergence: null });
    // render-added-nothing is deliberately excluded: renderedWith !== "playwright" answers its
    // question definitively ("no render happened, so nothing was wasted") rather than leaving it
    // unknown — see its own describe block below.
    for (const r of renderDivergenceRules()) {
      if (r.meta.id === "render-added-nothing") continue;
      expect(r.evaluate(page, config)).toBeNull();
    }
  });

  it("returns null on an older run that stored only the booleans", () => {
    const page = makePage({ renderDivergence: divergence({ noindexChanged: true, canonicalChanged: true }) });
    // content-requires-javascript reads wordCountDelta, which those older records DO carry, so it
    // legitimately runs and reports clean rather than skipping.
    for (const r of INDEXING_RULES) expect(rule(r).evaluate(page, config)).toBeNull();
    expect(rule("content-requires-javascript").evaluate(page, config)).toEqual([]);
  });
});

describe("content-requires-javascript", () => {
  it("fires when nearly all the copy is JS-only (matches quotes.toscrape.com/js: 4 static words, 217 rendered)", () => {
    const issues = rule("content-requires-javascript").evaluate(
      makePage({
        renderedWith: "playwright",
        renderSignals: ["framework:spa-root"],
        content: { text: "…", wordCount: 217, contentHash: "h" },
        renderDivergence: divergence({ wordCountDelta: 213 }),
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
    expect(issues![0]!.message).toContain("98%");
  });

  it("does not fire when the JS-only share is under the ratio", () => {
    expect(
      rule("content-requires-javascript").evaluate(
        makePage({ content: { text: "…", wordCount: 1000, contentHash: "h" }, renderDivergence: divergence({ wordCountDelta: 200 }) }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire on a tiny page that clears the ratio on a handful of words", () => {
    expect(
      rule("content-requires-javascript").evaluate(
        makePage({ content: { text: "…", wordCount: 12, contentHash: "h" }, renderDivergence: divergence({ wordCountDelta: 10 }) }),
        config,
      ),
    ).toEqual([]);
  });

  it("skips as data-unavailable on a page that was never rendered", () => {
    expect(rule("content-requires-javascript").evaluate(makePage({ renderDivergence: null }), config)).toBeNull();
  });
});

describe("render-added-nothing", () => {
  it("fires when a page was escalated to render but the divergence shows zero gain", () => {
    const page = makePage({ renderedWith: "playwright", renderSignals: ["tiny-body"], renderDivergence: divergence({}) });
    const issues = rule("render-added-nothing").evaluate(page, config)!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("notice");
  });

  it("does not fire when the render added words", () => {
    const page = makePage({ renderedWith: "playwright", renderDivergence: divergence({ wordCountDelta: 50 }) });
    expect(rule("render-added-nothing").evaluate(page, config)).toEqual([]);
  });

  it("does not fire when the render changed an SEO field even with zero word/link delta", () => {
    const page = makePage({ renderedWith: "playwright", renderDivergence: divergence({ titleChanged: true }) });
    expect(rule("render-added-nothing").evaluate(page, config)).toEqual([]);
  });

  it("does not apply to a page that was never escalated — renderedWith stays http", () => {
    const page = makePage({ renderedWith: "http", renderDivergence: null });
    expect(rule("render-added-nothing").evaluate(page, config)).toEqual([]);
  });

  it("skips as data-unavailable when escalated but the divergence fields aren't captured (pre-v2 record)", () => {
    const page = makePage({ renderedWith: "playwright", renderDivergence: undefined });
    expect(rule("render-added-nothing").evaluate(page, config)).toBeNull();
  });
});
