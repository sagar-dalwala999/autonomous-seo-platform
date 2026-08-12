import { describe, it, expect, vi } from "vitest";

const { fakeNormalizeUrl, fakeIsInScope } = vi.hoisted(() => {
  function fakeNormalizeUrl(raw: string, base?: string): string | null {
    if (/^(mailto|tel|javascript|data|sms|fax):/i.test(raw)) return null;
    try {
      const u = new URL(raw, base);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      u.hash = "";
      u.hostname = u.hostname.toLowerCase();
      if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
      return u.toString();
    } catch {
      return null;
    }
  }
  function fakeIsInScope(normalizedUrl: string, scope: { registrableDomain: string; hostAliases: string[] }): boolean {
    try {
      const host = new URL(normalizedUrl).hostname.toLowerCase().replace(/^www\./, "");
      const allowed = [scope.registrableDomain, ...scope.hostAliases].map((h) => h.toLowerCase().replace(/^www\./, ""));
      return allowed.some((h) => host === h || host.endsWith(`.${h}`));
    } catch {
      return false;
    }
  }
  return { fakeNormalizeUrl, fakeIsInScope };
});

vi.mock("../../../src/url", () => ({
  normalizeUrl: fakeNormalizeUrl,
  isInScope: fakeIsInScope,
}));

const { extractPage } = await import("../../../src/extraction/index");
const { loadFixture, makeArtifact, makeScope } = await import("./testUtils");

const SCOPE = makeScope();

describe("extractPage — seeded-evidence integration", () => {
  it("never throws on badly malformed markup, and still returns usable evidence", () => {
    const artifact = makeArtifact({ html: loadFixture("broken-markup.html") });
    let result;
    expect(() => {
      result = extractPage(artifact, SCOPE);
    }).not.toThrow();
    expect(result!.headings.h1).toEqual(["Heading with unclosed span"]);
    expect(result!.links).toHaveLength(1);
    expect(result!.images[0]!.alt).toBe("no closing tag");
    expect(result!.structuredData[0]!.parseError).not.toBeNull(); // empty ld+json block preserved, not dropped
  });

  it("produces title:null + metaDescription:null together (manifest #1, #4)", () => {
    const result = extractPage(makeArtifact({ html: loadFixture("about.html") }), SCOPE);
    expect(result.title).toBeNull();
    expect(result.metaDescription).toBeNull();
  });

  it("produces a noindex:true robots record for the seeded product page (manifest #12)", () => {
    const result = extractPage(
      makeArtifact({
        html: loadFixture("products-switchback.html"),
        url: "https://summittrailgear.example/products/switchback-trekking-poles",
        finalUrl: "https://summittrailgear.example/products/switchback-trekking-poles",
      }),
      SCOPE
    );
    expect(result.robots.noindex).toBe(true);
  });

  it("merges x-robots-tag noindex from headers even with no HTML robots meta", () => {
    const result = extractPage(
      makeArtifact({ html: loadFixture("blog-trail-snacks.html"), headers: { "x-robots-tag": "noindex" } }),
      SCOPE
    );
    expect(result.robots.noindex).toBe(true);
    expect(result.robots.meta).toEqual(["noindex"]);
  });

  it("preserves invalid JSON-LD raw + parseError without dropping the record (manifest #11a)", () => {
    const result = extractPage(makeArtifact({ html: loadFixture("blog-choosing-hiking-boots.html") }), SCOPE);
    expect(result.structuredData).toHaveLength(1);
    expect(result.structuredData[0]!.parseError).not.toBeNull();
    expect(result.structuredData[0]!.raw.length).toBeGreaterThan(0);
  });

  it("resolves <base href> for canonical, links, and images consistently (base href resolution)", () => {
    const result = extractPage(
      makeArtifact({
        html: loadFixture("base-href.html"),
        url: "https://summittrailgear.example/some/other/page",
        finalUrl: "https://summittrailgear.example/some/other/page",
      }),
      SCOPE
    );
    expect(result.canonical).toBe("https://summittrailgear.example/assets/sub/canonical-target");
    expect(result.links[0]!.target).toBe("https://summittrailgear.example/assets/sub/child");
    expect(result.images[0]!.url).toBe("https://summittrailgear.example/assets/sub/photo.jpg");
  });

  it("full ExtractionResult shape is present for a normal seeded page", () => {
    const result = extractPage(
      makeArtifact({
        html: loadFixture("products-ridgeline.html"),
        url: "https://summittrailgear.example/products/ridgeline-backpack-45l",
        finalUrl: "https://summittrailgear.example/products/ridgeline-backpack-45l",
      }),
      SCOPE
    );
    expect(result).toEqual(
      expect.objectContaining({
        title: "Ridgeline 45L Backpack | Summit Trail Gear",
        metaDescription: expect.any(String),
        canonical: null,
        robots: { meta: [], noindex: false, nofollow: false },
        headings: expect.objectContaining({ h1: ["Ridgeline 45L backpack"] }),
      })
    );
    expect(result.images[0]!.alt).toBeNull(); // manifest #10a
    expect((result.structuredData[0]!.parsed as Record<string, unknown>).offers).toBeUndefined(); // manifest #11c
    expect(result.content.wordCount).toBeGreaterThan(0);
    expect(result.content.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("wires all v2 fields end-to-end: multi-instance titles/descriptions, social, hreflang, refresh, keywords, pixel widths, pageStats", () => {
    const artifact = makeArtifact({
      html: loadFixture("multi-instance-social.html"),
      url: "https://summittrailgear.example/some/page",
      finalUrl: "https://summittrailgear.example/some/page",
      headers: { "content-encoding": "gzip" },
      httpVersion: "2.0",
    });
    const result = extractPage(artifact, SCOPE);

    expect(result.title).toBe("First Title | Summit Trail Gear"); // back-compat: first instance
    expect(result.titles).toEqual(["First Title | Summit Trail Gear", "Second Duplicate Title"]);
    expect(result.metaDescription).toBe("First description instance.");
    expect(result.metaDescriptions).toEqual(["First description instance.", "Second description instance."]);

    expect(result.social?.og["og:title"]).toBe("OG Title Value");
    expect(result.social?.twitter["twitter:card"]).toBe("summary_large_image");

    expect(result.hreflang).toEqual([
      { lang: "en", href: "https://summittrailgear.example/en/page" },
      { lang: "fr", href: "https://summittrailgear.example/fr/page" },
      { lang: "x-default", href: "https://summittrailgear.example/page" },
    ]);

    expect(result.metaRefresh).toEqual({
      delaySeconds: 5,
      url: "https://summittrailgear.example/redirected-page",
      raw: "5;url=/redirected-page",
    });
    expect(result.metaKeywords).toBe("hiking, trail gear, backpacks");

    expect(result.pixelWidths!.titlePx).toBeGreaterThan(0);
    expect(result.pixelWidths!.metaDescriptionPx).toBeGreaterThan(0);

    expect(result.pageStats!.htmlBytes).toBeGreaterThan(0);
    expect(result.pageStats!.domNodes).toBeGreaterThan(0);
    expect(result.pageStats!.textRatio).toBeGreaterThan(0);
    expect(result.pageStats!.textRatio).toBeLessThanOrEqual(1);
    expect(result.pageStats!.contentEncoding).toBe("gzip");
    expect(result.pageStats!.httpVersion).toBe("2.0");
  });

  it("v2 fields degrade to empty-but-present (never undefined) on a page with none of them", () => {
    const result = extractPage(makeArtifact({ html: loadFixture("about.html") }), SCOPE);
    expect(result.titles).toEqual([]);
    expect(result.metaDescriptions).toEqual([]);
    expect(result.social).toEqual({ og: {}, twitter: {} });
    expect(result.hreflang).toEqual([]);
    expect(result.metaRefresh).toBeNull();
    expect(result.metaKeywords).toBeNull();
    expect(result.pixelWidths).toEqual({ titlePx: null, metaDescriptionPx: null }); // about.html has no title/description
    expect(result.pageStats!.htmlBytes).toBeGreaterThan(0);
  });
});
