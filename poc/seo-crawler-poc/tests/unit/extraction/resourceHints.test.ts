import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractResourceHints } from "../../../src/extraction/resourceHints";

const BASE = "https://summittrailgear.example/products/foo";

describe("extractResourceHints", () => {
  it("flags a synchronous head script with no async/defer as render-blocking", () => {
    const $ = cheerio.load(`<html><head><script src="/a.js"></script></head><body></body></html>`);
    const hints = extractResourceHints($, BASE);
    expect(hints.scripts).toHaveLength(1);
    expect(hints.scripts[0]!.url).toBe("https://summittrailgear.example/a.js");
    expect(hints.scripts[0]!.renderBlocking).toBe(true);
    expect(hints.renderBlockingScriptCount).toBe(1);
  });

  it("does not flag async/defer/module head scripts as render-blocking", () => {
    const $ = cheerio.load(`<html><head>
      <script src="/a.js" async></script>
      <script src="/b.js" defer></script>
      <script src="/c.js" type="module"></script>
    </head><body></body></html>`);
    const hints = extractResourceHints($, BASE);
    expect(hints.scripts.every((s) => s.renderBlocking === false)).toBe(true);
    expect(hints.renderBlockingScriptCount).toBe(0);
  });

  it("does not flag a body script as render-blocking (out of scope of this heuristic)", () => {
    const $ = cheerio.load(`<html><head></head><body><script src="/a.js"></script></body></html>`);
    const hints = extractResourceHints($, BASE);
    expect(hints.scripts[0]!.inHead).toBe(false);
    expect(hints.scripts[0]!.renderBlocking).toBe(false);
  });

  it("skips non-executable script types (JSON-LD) from the inventory", () => {
    const $ = cheerio.load(`<script type="application/ld+json">{"a":1}</script>`);
    expect(extractResourceHints($, BASE).scripts).toEqual([]);
  });

  it("sums inline script byte length and excludes it from render-blocking (no src = not a fetch)", () => {
    const $ = cheerio.load(`<head><script>var x = 12345;</script></head>`);
    const hints = extractResourceHints($, BASE);
    expect(hints.scripts[0]!.url).toBeNull();
    expect(hints.scripts[0]!.inlineBytes).toBe(Buffer.byteLength("var x = 12345;", "utf8"));
    expect(hints.scripts[0]!.renderBlocking).toBe(false);
    expect(hints.inlineScriptBytesTotal).toBe(hints.scripts[0]!.inlineBytes);
  });

  it("flags a head stylesheet as render-blocking, exempts print media", () => {
    const $ = cheerio.load(`<head>
      <link rel="stylesheet" href="/screen.css">
      <link rel="stylesheet" href="/print.css" media="print">
    </head>`);
    const hints = extractResourceHints($, BASE);
    expect(hints.stylesheets).toHaveLength(2);
    expect(hints.stylesheets[0]!.renderBlocking).toBe(true);
    expect(hints.stylesheets[1]!.renderBlocking).toBe(false);
    expect(hints.renderBlockingStylesheetCount).toBe(1);
  });

  it("captures preload inventory with as/type/crossorigin", () => {
    const $ = cheerio.load(
      `<head><link rel="preload" href="/font.woff2" as="font" type="font/woff2" crossorigin="anonymous"></head>`
    );
    const hints = extractResourceHints($, BASE);
    expect(hints.preloads).toEqual([
      {
        url: "https://summittrailgear.example/font.woff2",
        as: "font",
        type: "font/woff2",
        crossorigin: "anonymous",
      },
    ]);
  });

  it("never throws on a page with no resources at all", () => {
    const $ = cheerio.load(`<html><head></head><body>hi</body></html>`);
    expect(() => extractResourceHints($, BASE)).not.toThrow();
    const hints = extractResourceHints($, BASE);
    expect(hints).toEqual({
      scripts: [],
      stylesheets: [],
      preloads: [],
      inlineScriptBytesTotal: 0,
      renderBlockingScriptCount: 0,
      renderBlockingStylesheetCount: 0,
    });
  });
});
