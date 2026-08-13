import { describe, expect, it } from "vitest";
import { renderDivergenceRules } from "../../../../src/analysis/rules/page/render-divergence";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";
import type { RenderDivergence } from "../../../../src/models/types";

const rule = (id: string) => renderDivergenceRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

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
    for (const r of renderDivergenceRules()) expect(r.evaluate(page, config)).toBeNull();
  });

  it("returns null on an older run that stored only the booleans", () => {
    const page = makePage({ renderDivergence: divergence({ noindexChanged: true, canonicalChanged: true }) });
    for (const r of renderDivergenceRules()) expect(r.evaluate(page, config)).toBeNull();
  });
});
