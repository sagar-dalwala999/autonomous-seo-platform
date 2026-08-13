import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractHeadMeta } from "../../../src/extraction/headMeta";

function load(html: string) {
  return cheerio.load(html);
}

describe("extractHeadMeta", () => {
  describe("og:image ordered-stream binding", () => {
    it("binds interleaved width/height/alt to the correct one of three og:image roots by position", () => {
      const html = `<html><head>
        <meta property="og:image" content="https://example.com/rock.jpg">
        <meta property="og:image:width" content="300">
        <meta property="og:image:height" content="300">
        <meta property="og:image:alt" content="A rock">
        <meta property="og:title" content="Interleaved title, should not affect image binding">
        <meta property="og:image" content="https://example.com/rock2.jpg">
        <meta property="og:image" content="https://example.com/rock3.jpg">
        <meta property="og:image:height" content="1000">
        <meta property="og:image:alt" content="Rock three">
      </head><body></body></html>`;
      const { ogImages } = extractHeadMeta(load(html));

      expect(ogImages).toHaveLength(3);
      expect(ogImages[0]).toMatchObject({
        url: "https://example.com/rock.jpg",
        width: 300,
        height: 300,
        alt: "A rock",
      });
      expect(ogImages[0]!.type).toBeUndefined();
      expect(ogImages[1]).toEqual({ url: "https://example.com/rock2.jpg" });
      expect(ogImages[2]).toMatchObject({
        url: "https://example.com/rock3.jpg",
        height: 1000,
        alt: "Rock three",
      });
      expect(ogImages[2]!.width).toBeUndefined();
    });

    it("treats og:image:url as identical to og:image when it opens a group on its own", () => {
      const html = `<meta property="og:image:url" content="https://example.com/only.jpg">
        <meta property="og:image:width" content="50">`;
      const { ogImages } = extractHeadMeta(load(html));
      expect(ogImages).toEqual([{ url: "https://example.com/only.jpg", width: 50 }]);
    });

    it("ignores an orphan og:image sub-property with no preceding og:image root", () => {
      const html = `<meta property="og:image:width" content="300">`;
      const { ogImages } = extractHeadMeta(load(html));
      expect(ogImages).toEqual([]);
    });

    it("rejects a non-numeric og:image:width/height without throwing", () => {
      const html = `<meta property="og:image" content="https://example.com/a.jpg">
        <meta property="og:image:width" content="not-a-number">`;
      const { ogImages } = extractHeadMeta(load(html));
      expect(ogImages[0]!.width).toBeUndefined();
    });
  });

  describe("conflict rules", () => {
    it("OG: first occurrence wins on duplicate keys", () => {
      const html = `<meta property="og:title" content="First">
        <meta property="og:title" content="Second">`;
      const { og } = extractHeadMeta(load(html));
      expect(og["og:title"]).toBe("First");
    });

    it("twitter:card: last occurrence wins (X's documented behaviour, inverted from OG)", () => {
      const html = `<meta name="twitter:card" content="summary">
        <meta name="twitter:card" content="summary_large_image">`;
      const { twitter } = extractHeadMeta(load(html));
      expect(twitter["twitter:card"]).toBe("summary_large_image");
    });
  });

  describe("twitter:* attribute mixing", () => {
    it("reads twitter:* from name= (standard)", () => {
      const html = `<meta name="twitter:title" content="Via name">`;
      expect(extractHeadMeta(load(html)).twitter["twitter:title"]).toBe("Via name");
    });

    it("reads twitter:* from property= (X also accepts this)", () => {
      const html = `<meta property="twitter:title" content="Via property">`;
      expect(extractHeadMeta(load(html)).twitter["twitter:title"]).toBe("Via property");
      expect(extractHeadMeta(load(html)).tags[0]).toMatchObject({ attr: "property", key: "twitter:title" });
    });
  });

  describe("viewportBlocksZoom", () => {
    it("flags user-scalable=no", () => {
      const html = `<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">`;
      const r = extractHeadMeta(load(html));
      expect(r.viewportBlocksZoom).toBe(true);
    });

    it("flags maximum-scale=1 (below the 200% WCAG floor) even without user-scalable", () => {
      const html = `<meta name="viewport" content="width=device-width, maximum-scale=1">`;
      expect(extractHeadMeta(load(html)).viewportBlocksZoom).toBe(true);
    });

    it("does not flag maximum-scale=5", () => {
      const html = `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">`;
      expect(extractHeadMeta(load(html)).viewportBlocksZoom).toBe(false);
    });

    it("does not flag a plain viewport with no scale/zoom directives", () => {
      const html = `<meta name="viewport" content="width=device-width, initial-scale=1">`;
      expect(extractHeadMeta(load(html)).viewportBlocksZoom).toBe(false);
    });

    it("does not flag when there is no viewport meta at all", () => {
      const r = extractHeadMeta(load(`<meta name="description" content="x">`));
      expect(r.viewport).toBeNull();
      expect(r.viewportBlocksZoom).toBe(false);
    });

    it("survives a garbage viewport content string", () => {
      const html = `<meta name="viewport" content=";;;garbage,,,">`;
      expect(() => extractHeadMeta(load(html))).not.toThrow();
      expect(extractHeadMeta(load(html)).viewportBlocksZoom).toBe(false);
    });
  });

  describe("site-verification providers", () => {
    const cases: Array<[string, string, string]> = [
      ["google-site-verification", "name", "google"],
      ["msvalidate.01", "name", "bing"],
      ["p:domain_verify", "property", "pinterest"],
      ["facebook-domain-verification", "name", "facebook"],
      ["yandex-verification", "name", "yandex"],
      ["norton-safeweb-site-verification", "name", "norton-safeweb"],
      ["ahrefs-site-verification", "name", "ahrefs"],
    ];

    for (const [metaKey, attr, provider] of cases) {
      it(`extracts ${provider} from ${metaKey} via ${attr}=`, () => {
        const html = `<meta ${attr}="${metaKey}" content="token-${provider}-123">`;
        const { verification } = extractHeadMeta(load(html));
        expect(verification[provider]).toBe(`token-${provider}-123`);
      });
    }

    it("keeps all seven providers distinct on one page", () => {
      const html = cases.map(([metaKey, attr, provider]) => `<meta ${attr}="${metaKey}" content="${provider}-tok">`).join("\n");
      const { verification } = extractHeadMeta(load(html));
      expect(Object.keys(verification).sort()).toEqual(
        ["ahrefs", "bing", "facebook", "google", "norton-safeweb", "pinterest", "yandex"].sort(),
      );
    });
  });

  describe("document order + inHead", () => {
    it("assigns index in document order across all meta tags", () => {
      const html = `<html><head>
        <meta name="description" content="d">
        <meta property="og:title" content="t">
        <meta name="twitter:card" content="summary">
      </head><body></body></html>`;
      const { tags } = extractHeadMeta(load(html));
      expect(tags.map((t) => t.key)).toEqual(["description", "og:title", "twitter:card"]);
      expect(tags[0]!.index).toBeLessThan(tags[1]!.index);
      expect(tags[1]!.index).toBeLessThan(tags[2]!.index);
    });

    it("marks a meta tag inside <head> as inHead=true and one stranded past an implicit head-close as inHead=false", () => {
      const html = `<html><head><title>T</title><div>oops</div><meta name="description" content="stranded"></head><body></body></html>`;
      const { tags } = extractHeadMeta(load(html));
      const record = tags.find((t) => t.key === "description");
      expect(record?.inHead).toBe(false);
    });

    it("marks a normal head meta tag as inHead=true", () => {
      const html = `<html><head><meta name="description" content="d"></head><body></body></html>`;
      const { tags } = extractHeadMeta(load(html));
      expect(tags[0]!.inHead).toBe(true);
    });
  });

  describe("simple fields", () => {
    it("captures themeColor, colorScheme, referrer, generator", () => {
      const html = `<meta name="theme-color" content="#ff0000">
        <meta name="color-scheme" content="dark light">
        <meta name="referrer" content="no-referrer">
        <meta name="generator" content="WordPress 6.4">`;
      const r = extractHeadMeta(load(html));
      expect(r.themeColor).toBe("#ff0000");
      expect(r.colorScheme).toBe("dark light");
      expect(r.referrer).toBe("no-referrer");
      expect(r.generator).toBe("WordPress 6.4");
    });

    it("captures a <meta charset> tag with attr='charset'", () => {
      const html = `<meta charset="utf-8">`;
      const { tags } = extractHeadMeta(load(html));
      expect(tags[0]).toMatchObject({ attr: "charset", key: "charset", value: "utf-8" });
    });
  });

  describe("robustness — never throws", () => {
    it("handles a document with no <head> at all", () => {
      expect(() => extractHeadMeta(load("<body><p>no head</p></body>"))).not.toThrow();
    });

    it("handles a document with zero meta tags", () => {
      const r = extractHeadMeta(load("<html><head><title>T</title></head><body></body></html>"));
      expect(r).toMatchObject({ tags: [], og: {}, twitter: {}, ogImages: [], verification: {} });
    });

    it("handles completely empty input", () => {
      expect(() => extractHeadMeta(load(""))).not.toThrow();
    });

    it("skips a meta tag with an empty content attribute value without throwing (present but empty)", () => {
      const html = `<meta property="og:description" content="">`;
      const r = extractHeadMeta(load(html));
      expect(r.og["og:description"]).toBe("");
    });

    it("skips a meta tag missing the content attribute entirely", () => {
      const html = `<meta property="og:title">`;
      const r = extractHeadMeta(load(html));
      expect(r.og["og:title"]).toBeUndefined();
      expect(r.tags).toEqual([]);
    });

    it("skips a meta tag with none of the identifying attributes", () => {
      const html = `<meta content="orphaned value">`;
      const r = extractHeadMeta(load(html));
      expect(r.tags).toEqual([]);
    });

    it("handles duplicate identical tags without throwing", () => {
      const html = `<meta name="description" content="same">
        <meta name="description" content="same">`;
      expect(() => extractHeadMeta(load(html))).not.toThrow();
    });

    it("handles malformed/broken markup soup", () => {
      for (const html of ["<<>>", "<meta", "<html><body><div></p></div>"]) {
        expect(() => extractHeadMeta(load(html))).not.toThrow();
      }
    });
  });
});
