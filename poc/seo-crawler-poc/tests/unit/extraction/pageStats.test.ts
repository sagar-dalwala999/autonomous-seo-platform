import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractPageStats } from "../../../src/extraction/pageStats";

describe("extractPageStats", () => {
  it("computes htmlBytes as the UTF-8 byte length of the raw html", () => {
    const html = "<html><body>abc</body></html>";
    const $ = cheerio.load(html);
    const stats = extractPageStats($, html, "abc", {}, null);
    expect(stats.htmlBytes).toBe(Buffer.byteLength(html, "utf8"));
  });

  it("counts multi-byte UTF-8 characters correctly toward htmlBytes (not JS string length)", () => {
    const html = "<html><body>café</body></html>"; // "café" — é is 2 bytes in UTF-8
    const $ = cheerio.load(html);
    const stats = extractPageStats($, html, "café", {}, null);
    expect(stats.htmlBytes).toBeGreaterThan(html.length);
  });

  it("textRatio is content-text bytes / htmlBytes, bounded 0..1", () => {
    const html = "<html><body><p>hello world this is visible content text</p></body></html>";
    const $ = cheerio.load(html);
    const stats = extractPageStats($, html, "hello world this is visible content text", {}, null);
    expect(stats.textRatio).toBeGreaterThan(0);
    expect(stats.textRatio).toBeLessThanOrEqual(1);
  });

  it("textRatio is 0 when there is no content text", () => {
    const html = "<html><body></body></html>";
    const $ = cheerio.load(html);
    const stats = extractPageStats($, html, "", {}, null);
    expect(stats.textRatio).toBe(0);
  });

  it("domNodes grows as more elements are added", () => {
    const small = "<html><body><p>one</p></body></html>";
    const big = "<html><body><p>one</p><p>two</p><div><span>three</span></div></body></html>";
    const statsSmall = extractPageStats(cheerio.load(small), small, "one", {}, null);
    const statsBig = extractPageStats(cheerio.load(big), big, "one two three", {}, null);
    expect(statsBig.domNodes).toBeGreaterThan(statsSmall.domNodes);
  });

  it("passes through contentEncoding from headers and httpVersion from the artifact", () => {
    const html = "<html><body>x</body></html>";
    const $ = cheerio.load(html);
    const stats = extractPageStats($, html, "x", { "content-encoding": "gzip" }, "2.0");
    expect(stats.contentEncoding).toBe("gzip");
    expect(stats.httpVersion).toBe("2.0");
  });

  it("contentEncoding and httpVersion are null when unavailable", () => {
    const html = "<html><body>x</body></html>";
    const $ = cheerio.load(html);
    const stats = extractPageStats($, html, "x", {}, null);
    expect(stats.contentEncoding).toBeNull();
    expect(stats.httpVersion).toBeNull();
  });
});
