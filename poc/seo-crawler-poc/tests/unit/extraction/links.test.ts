import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";

// Test double for S1 (in flight concurrently) — plain URL-API normalize + host-equality scope check.
// Never import S1's real implementation into this slice's tests (spec.md S2 instruction).
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

const { extractLinks } = await import("../../../src/extraction/links");
const { loadFixture, makeScope } = await import("./testUtils");

const FINAL_URL = "https://summittrailgear.example/about";
const SCOPE = makeScope();

describe("extractLinks", () => {
  it("skips empty href, fragment-only, mailto:, and tel: (not crawl links)", () => {
    const $ = cheerio.load(loadFixture("about.html"));
    const links = extractLinks($, FINAL_URL, FINAL_URL, SCOPE);
    const targets = links.map((l) => l.target);
    expect(targets.some((t) => t.includes("mailto"))).toBe(false);
    expect(targets.some((t) => t.includes("tel:"))).toBe(false);
    expect(targets.some((t) => t.includes("#top"))).toBe(false);
    expect(links).toHaveLength(1); // only the http:// contact link survives
  });

  it("preserves an http:// absolute internal link AS AUTHORED, but normalizes to https for scoping (manifest #15b)", () => {
    const $ = cheerio.load(loadFixture("about.html"));
    const [link] = extractLinks($, FINAL_URL, FINAL_URL, SCOPE);
    expect(link!.target).toBe("http://summittrailgear.example/contact"); // authored scheme preserved
    expect(link!.type).toBe("internal");
    expect(link!.targetNormalized).not.toBeNull();
  });

  it("classifies a www-absolute link as internal while the page itself is served non-www (manifest #15c)", () => {
    const $ = cheerio.load(loadFixture("links-mixed.html"));
    const links = extractLinks($, FINAL_URL, FINAL_URL, SCOPE);
    const wwwLink = links.find((l) => l.target.includes("www.summittrailgear.example"));
    expect(wwwLink).toBeDefined();
    expect(wwwLink!.target).toBe("https://www.summittrailgear.example/products"); // www preserved verbatim
    expect(wwwLink!.type).toBe("internal");
  });

  it("captures rel=sponsored+nofollow, rel=ugc, and the target attribute", () => {
    const $ = cheerio.load(loadFixture("links-mixed.html"));
    const links = extractLinks($, FINAL_URL, FINAL_URL, SCOPE);
    const sponsored = links.find((l) => l.anchor === "Sponsored deal")!;
    expect(sponsored.sponsored).toBe(true);
    expect(sponsored.nofollow).toBe(true);
    expect(sponsored.ugc).toBe(false);
    expect(sponsored.targetAttr).toBe("_blank");
    expect(sponsored.type).toBe("external");

    const ugc = links.find((l) => l.anchor === "User comment")!;
    expect(ugc.ugc).toBe(true);
    expect(ugc.rel).toBe("ugc");
  });

  it("classifies an external domain as external", () => {
    const $ = cheerio.load(loadFixture("links-mixed.html"));
    const links = extractLinks($, FINAL_URL, FINAL_URL, SCOPE);
    const external = links.find((l) => l.target.startsWith("https://ads.example"))!;
    expect(external.type).toBe("external");
  });

  it("resolves relative hrefs against <base href> rather than finalUrl (manifest: base href resolution)", () => {
    const differentFinalUrl = "https://summittrailgear.example/some/other/page";
    const $ = cheerio.load(loadFixture("base-href.html"));
    const [link] = extractLinks($, "https://summittrailgear.example/assets/sub/", differentFinalUrl, SCOPE);
    expect(link!.target).toBe("https://summittrailgear.example/assets/sub/child");
    expect(link!.source).toBe(differentFinalUrl); // source is always the page's finalUrl, never the base
  });

  it("trims and collapses whitespace in anchor text", () => {
    const $ = cheerio.load(`<a href="/x">\n  Spaced   Anchor \n</a>`);
    expect(extractLinks($, FINAL_URL, FINAL_URL, SCOPE)[0]!.anchor).toBe("Spaced Anchor");
  });

  it("never throws on an unresolvable href", () => {
    const $ = cheerio.load(`<a href="http://[bad">broken</a>`);
    expect(() => extractLinks($, FINAL_URL, FINAL_URL, SCOPE)).not.toThrow();
    expect(extractLinks($, FINAL_URL, FINAL_URL, SCOPE)).toEqual([]);
  });
});
