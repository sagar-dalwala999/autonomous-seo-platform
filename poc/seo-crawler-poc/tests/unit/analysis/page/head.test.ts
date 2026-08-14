import { describe, expect, it } from "vitest";
import { headRules } from "../../../../src/analysis/rules/page/head";
import { makePage } from "../../../unit/report/fixtures";
import { makeConfig } from "./testConfig";
import type { CharsetInfo, FaviconReport, HeadBoundary, HeadMetaReport, IconRecord } from "../../../../src/models/types";

const rule = (id: string) => headRules().find((r) => r.meta.id === id)!;
const config = makeConfig();

function headMeta(overrides: Partial<HeadMetaReport> = {}): HeadMetaReport {
  return {
    tags: [],
    og: {},
    twitter: {},
    ogImages: [],
    viewport: "width=device-width, initial-scale=1",
    viewportBlocksZoom: false,
    themeColor: null,
    colorScheme: null,
    referrer: null,
    generator: null,
    verification: {},
    ...overrides,
  };
}

const charset = (overrides: Partial<CharsetInfo> = {}): CharsetInfo => ({
  value: "utf-8",
  source: "meta",
  metaOffset: 40,
  effective: true,
  ...overrides,
});

const boundary = (overrides: Partial<HeadBoundary> = {}): HeadBoundary => ({
  elementCount: 10,
  closedBy: null,
  closedAtOffset: null,
  stranded: [],
  ...overrides,
});

const icon = (overrides: Partial<IconRecord> = {}): IconRecord => ({
  rel: "icon",
  href: "https://ex.com/icon.png",
  declaredSizes: null,
  type: null,
  index: 0,
  source: "link",
  ...overrides,
});

const favicons = (candidates: IconRecord[]): FaviconReport => ({
  candidates,
  effective: null,
  googleSerpEligible: null,
  googleSerpBlockers: [],
});

describe("viewport-missing / viewport-blocks-zoom", () => {
  it("viewport-missing fires when no viewport tag was found (matches seeded /seeded/head-broken.html)", () => {
    const issues = rule("viewport-missing").evaluate(makePage({ headMeta: headMeta({ viewport: null }) }), config);
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
  });

  it("viewport-missing does not fire when a viewport is present", () => {
    expect(rule("viewport-missing").evaluate(makePage({ headMeta: headMeta() }), config)).toEqual([]);
  });

  it("viewport-blocks-zoom fires on user-scalable=no (matches seeded /seeded/head-meta-rich.html)", () => {
    const issues = rule("viewport-blocks-zoom").evaluate(
      makePage({
        headMeta: headMeta({ viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no", viewportBlocksZoom: true }),
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.message).toContain("user-scalable=no");
  });

  it("viewport-blocks-zoom does not fire on a zoomable viewport", () => {
    expect(rule("viewport-blocks-zoom").evaluate(makePage({ headMeta: headMeta() }), config)).toEqual([]);
  });

  it("both skip as data-unavailable when headMeta was never captured (pre-v3 run)", () => {
    const page = makePage();
    expect(rule("viewport-missing").evaluate(page, config)).toBeNull();
    expect(rule("viewport-blocks-zoom").evaluate(page, config)).toBeNull();
  });
});

describe("charset-missing / charset-not-effective", () => {
  it("charset-missing fires when nothing declared an encoding", () => {
    const issues = rule("charset-missing").evaluate(
      makePage({ charset: charset({ value: null, source: null, metaOffset: null, effective: false }) }),
      config,
    );
    expect(issues).toHaveLength(1);
  });

  it("charset-missing does not fire when a header charset was sent", () => {
    expect(rule("charset-missing").evaluate(makePage({ charset: charset({ source: "header" }) }), config)).toEqual([]);
  });

  it("charset-not-effective fires when the meta serializes past the 1024-byte prescan window", () => {
    const issues = rule("charset-not-effective").evaluate(
      makePage({ charset: charset({ metaOffset: 2048, effective: false }) }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.threshold).toContain("1024");
  });

  it("charset-not-effective stays quiet when the charset is absent entirely (charset-missing owns that)", () => {
    expect(
      rule("charset-not-effective").evaluate(makePage({ charset: charset({ value: null, effective: false }) }), config),
    ).toEqual([]);
  });

  it("both skip as data-unavailable on a pre-v3 record", () => {
    const page = makePage();
    expect(rule("charset-missing").evaluate(page, config)).toBeNull();
    expect(rule("charset-not-effective").evaluate(page, config)).toBeNull();
  });
});

describe("base-href-multiple / base-href-cross-origin", () => {
  it("base-href-multiple fires on two <base> tags (matches seeded /seeded/head-meta-rich.html)", () => {
    const issues = rule("base-href-multiple").evaluate(
      makePage({ baseHref: { href: "https://other.example/seeded/", count: 2 } }),
      config,
    );
    expect(issues).toHaveLength(1);
  });

  it("base-href-multiple does not fire on a single base", () => {
    expect(rule("base-href-multiple").evaluate(makePage({ baseHref: { href: "/x/", count: 1 } }), config)).toEqual([]);
  });

  it("base-href-cross-origin fires when the base points at another origin", () => {
    const issues = rule("base-href-cross-origin").evaluate(
      makePage({ url: "http://localhost:3105/p", finalUrl: "http://localhost:3105/p", baseHref: { href: "https://other.example/seeded/", count: 1 } }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.message).toContain("https://other.example");
  });

  it("base-href-cross-origin does not fire on a same-origin or relative base", () => {
    expect(
      rule("base-href-cross-origin").evaluate(makePage({ baseHref: { href: "/section/", count: 1 } }), config),
    ).toEqual([]);
    expect(rule("base-href-cross-origin").evaluate(makePage({ baseHref: { href: null, count: 0 } }), config)).toEqual([]);
  });

  it("both skip as data-unavailable on a pre-v3 record", () => {
    const page = makePage();
    expect(rule("base-href-multiple").evaluate(page, config)).toBeNull();
    expect(rule("base-href-cross-origin").evaluate(page, config)).toBeNull();
  });
});

describe("head-signal-stranded", () => {
  it("fires only on signals Google does not honour, and names them (matches seeded /seeded/head-broken.html)", () => {
    const issues = rule("head-signal-stranded").evaluate(
      makePage({
        headBoundary: boundary({
          closedBy: "div",
          closedAtOffset: 512,
          stranded: [
            { signal: "canonical", tag: "link", honoured: false },
            { signal: "meta-robots", tag: "meta", honoured: true },
            { signal: "open-graph", tag: "meta", honoured: false },
          ],
        }),
      }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.message).toContain("canonical");
    expect(issues![0]!.message).toContain("open-graph");
    expect(issues![0]!.message).not.toContain("meta-robots");
    expect(issues![0]!.evidence.map((e) => e.field)).toContain("headBoundary.stranded[2]");
  });

  it("does not fire when the only stranded signal is one Google respects", () => {
    expect(
      rule("head-signal-stranded").evaluate(
        makePage({ headBoundary: boundary({ closedBy: "div", stranded: [{ signal: "meta-robots", tag: "meta", honoured: true }] }) }),
        config,
      ),
    ).toEqual([]);
  });

  it("does not fire when the head closed cleanly", () => {
    expect(rule("head-signal-stranded").evaluate(makePage({ headBoundary: boundary() }), config)).toEqual([]);
  });

  it("skips as data-unavailable on a pre-v3 record", () => {
    expect(rule("head-signal-stranded").evaluate(makePage(), config)).toBeNull();
  });
});

describe("favicon-not-declared", () => {
  it("fires when only the implicit guesses exist (matches seeded /seeded/head-broken.html)", () => {
    const issues = rule("favicon-not-declared").evaluate(
      makePage({ favicons: favicons([icon({ source: "implicit", index: -1 }), icon({ source: "implicit", index: -2 })]) }),
      config,
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("notice");
  });

  it("does not fire when a <link rel=icon> or manifest icon is declared", () => {
    expect(rule("favicon-not-declared").evaluate(makePage({ favicons: favicons([icon(), icon({ source: "implicit", index: -1 })]) }), config)).toEqual([]);
    expect(rule("favicon-not-declared").evaluate(makePage({ favicons: favicons([icon({ source: "manifest" })]) }), config)).toEqual([]);
  });

  it("skips as data-unavailable on a pre-v3 record", () => {
    expect(rule("favicon-not-declared").evaluate(makePage(), config)).toBeNull();
  });
});
