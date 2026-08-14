import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractFonts, parseFontFaceCss } from "../../../src/extraction/fonts";

const PAGE_URL = "https://example.com/blog/post";

describe("parseFontFaceCss", () => {
  it("parses an @font-face with multiple url() sources into one record per source", () => {
    const css = `
      @font-face {
        font-family: 'Brand Sans';
        src: url('/fonts/brand.woff2') format('woff2'), url('/fonts/brand.woff') format('woff');
        font-display: swap;
      }
    `;
    const faces = parseFontFaceCss(css, PAGE_URL, PAGE_URL);
    expect(faces).toHaveLength(2);
    expect(faces[0]!.family).toBe("Brand Sans");
    expect(faces[0]!.source).toBe("https://example.com/fonts/brand.woff2");
    expect(faces[1]!.source).toBe("https://example.com/fonts/brand.woff");
    expect(faces.every((f) => f.display === "swap")).toBe(true);
    expect(faces.every((f) => f.preloaded === false)).toBe(true);
  });

  it("captures font-display values verbatim, including the worst-case 'block', and null when absent", () => {
    const values = ["block", "swap", "optional", "fallback", "auto"];
    for (const v of values) {
      const css = `@font-face { font-family: 'X'; src: url(x.woff2); font-display: ${v}; }`;
      expect(parseFontFaceCss(css, PAGE_URL, PAGE_URL)[0]!.display).toBe(v);
    }
    const noDisplay = `@font-face { font-family: 'X'; src: url(x.woff2); }`;
    expect(parseFontFaceCss(noDisplay, PAGE_URL, PAGE_URL)[0]!.display).toBeNull();
  });

  it("classifies a relative url() as same-origin and a different registrable domain as third-party", () => {
    const css = `
      @font-face { font-family: 'Local'; src: url('/fonts/local.woff2'); }
      @font-face { font-family: 'Remote'; src: url('https://fonts.gstatic.com/s/x/v1/a.woff2'); }
    `;
    const [local, remote] = parseFontFaceCss(css, PAGE_URL, PAGE_URL);
    expect(local!.origin).toBe("same-origin");
    expect(local!.host).toBe("example.com");
    expect(remote!.origin).toBe("third-party");
    expect(remote!.host).toBe("fonts.gstatic.com");
  });

  it("treats a same-registrable-domain subdomain as same-origin, not third-party", () => {
    const css = `@font-face { font-family: 'CDN'; src: url('https://static.example.com/f.woff2'); }`;
    expect(parseFontFaceCss(css, PAGE_URL, PAGE_URL)[0]!.origin).toBe("same-origin");
  });

  it("tolerates CSS comments and fully minified/whitespace-free CSS", () => {
    const commented = `
      /* brand font, do not remove */
      @font-face{font-family:'Foo'/* inline comment */;src:url(/f/foo.woff2)format('woff2');font-display:swap}
    `;
    const faces = parseFontFaceCss(commented, PAGE_URL, PAGE_URL);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.family).toBe("Foo");
    expect(faces[0]!.display).toBe("swap");

    const minified = `@font-face{font-family:Bar;src:url(/f/bar.woff2)}@font-face{font-family:Baz;src:url(/f/baz.woff2)}`;
    const minFaces = parseFontFaceCss(minified, PAGE_URL, PAGE_URL);
    expect(minFaces.map((f) => f.family)).toEqual(["Bar", "Baz"]);
  });

  it("never throws on malformed CSS (unterminated rule, stray braces, garbage) or empty input", () => {
    const unterminated = `@font-face { font-family: 'Broken'; src: url(/f/broken.woff2`;
    expect(() => parseFontFaceCss(unterminated, PAGE_URL, PAGE_URL)).not.toThrow();

    const garbage = `{{{ not css at all ]]] @font-face`;
    expect(() => parseFontFaceCss(garbage, PAGE_URL, PAGE_URL)).not.toThrow();

    expect(parseFontFaceCss("", PAGE_URL, PAGE_URL)).toEqual([]);
    expect(parseFontFaceCss("   ", PAGE_URL, PAGE_URL)).toEqual([]);
  });

  it("resolves relative url()s against `base`, not `pageUrl`, when the two differ (external stylesheet case)", () => {
    const css = `@font-face { font-family: 'Ext'; src: url('../fonts/ext.woff2'); }`;
    const stylesheetUrl = "https://fonts.example.net/css/v1/style.css";
    const faces = parseFontFaceCss(css, stylesheetUrl, PAGE_URL);
    expect(faces[0]!.source).toBe("https://fonts.example.net/css/fonts/ext.woff2");
    // origin is measured against the real page, not the stylesheet's own host
    expect(faces[0]!.origin).toBe("third-party");
    expect(faces[0]!.host).toBe("fonts.example.net");
  });
});

describe("extractFonts", () => {
  it("flags a font preload missing crossorigin, and clears the flag when crossorigin is present", () => {
    const $ = cheerio.load(`
      <link rel="preload" as="font" href="/fonts/local.woff2" crossorigin>
      <link rel="preload" as="font" href="https://fonts.gstatic.com/s/x/v1/a.woff2">
    `);
    const report = extractFonts($, PAGE_URL);
    expect(report.faces).toHaveLength(2);
    const [withCors, withoutCors] = report.faces;
    expect(withCors!.preloaded).toBe(true);
    expect(withCors!.preloadMissingCrossorigin).toBe(false);
    expect(withCors!.origin).toBe("same-origin");
    expect(withoutCors!.preloadMissingCrossorigin).toBe(true);
    expect(withoutCors!.origin).toBe("third-party");
    expect(withoutCors!.host).toBe("fonts.gstatic.com");
  });

  it("ignores preload links that aren't as=font", () => {
    const $ = cheerio.load(`<link rel="preload" as="style" href="/style.css">`);
    expect(extractFonts($, PAGE_URL).faces).toEqual([]);
  });

  it("detects a Google Fonts stylesheet link as a third-party font load, with a best-effort family", () => {
    const $ = cheerio.load(`
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap">
    `);
    const report = extractFonts($, PAGE_URL);
    expect(report.faces).toHaveLength(1);
    expect(report.faces[0]!.host).toBe("fonts.googleapis.com");
    expect(report.faces[0]!.origin).toBe("third-party");
    expect(report.faces[0]!.family).toBe("Roboto");
    expect(report.faces[0]!.preloaded).toBe(false);
    expect(report.thirdPartyHosts).toEqual(["fonts.googleapis.com"]);
  });

  it("ignores a stylesheet link to a host with no font signal", () => {
    const $ = cheerio.load(`<link rel="stylesheet" href="https://cdn.example.com/site.css">`);
    expect(extractFonts($, PAGE_URL).faces).toEqual([]);
  });

  it("counts a generic CDN stylesheet as a font load only when the URL hints at fonts", () => {
    const fontish = cheerio.load(`<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/inter@5/index.css">`);
    expect(extractFonts(fontish, PAGE_URL).faces).toHaveLength(1);

    const notFontish = cheerio.load(`<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js">`);
    expect(extractFonts(notFontish, PAGE_URL).faces).toEqual([]);
  });

  it("dedupes thirdPartyHosts across multiple faces on the same third-party host", () => {
    const $ = cheerio.load(`
      <style>
        @font-face { font-family: 'A'; src: url('https://fonts.gstatic.com/s/a/v1/a.woff2'); }
        @font-face { font-family: 'B'; src: url('https://fonts.gstatic.com/s/b/v1/b.woff2'); }
      </style>
      <link rel="preload" as="font" href="https://fonts.gstatic.com/s/c/v1/c.woff2">
    `);
    const report = extractFonts($, PAGE_URL);
    expect(report.faces).toHaveLength(3);
    expect(report.thirdPartyHosts).toEqual(["fonts.gstatic.com"]);
  });

  it("leaves usedFamilies unset — only a browser pass can know what actually rendered", () => {
    const $ = cheerio.load(`<style>@font-face { font-family: 'X'; src: url(x.woff2); }</style>`);
    expect(extractFonts($, PAGE_URL).usedFamilies).toBeUndefined();
  });

  it("returns an empty report for a page with no font signals at all", () => {
    const $ = cheerio.load(`<p>no fonts here</p>`);
    expect(extractFonts($, PAGE_URL)).toEqual({ faces: [], thirdPartyHosts: [] });
  });

  it("never throws on malformed/unclosed markup", () => {
    const $ = cheerio.load(`
      <style>@font-face { font-family: 'Broken'; src: url(/f/x.woff2
      <link rel="preload" as="font" href="/f/y.woff2"
    `);
    expect(() => extractFonts($, PAGE_URL)).not.toThrow();
  });

  it("respects <base href> when resolving relative font URLs", () => {
    const $ = cheerio.load(`
      <base href="https://totallydifferent-cdn.com/assets/">
      <style>@font-face { font-family: 'Based'; src: url('fonts/based.woff2'); }</style>
    `);
    const report = extractFonts($, PAGE_URL);
    expect(report.faces[0]!.source).toBe("https://totallydifferent-cdn.com/assets/fonts/based.woff2");
    // still measured against the real page origin, not <base href>'s host
    expect(report.faces[0]!.origin).toBe("third-party");
  });
});
