import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import {
  extractImages,
  extractImageInventory,
  extractBackgroundImages,
  parseSrcset,
  probeImageAsset,
  dataUriBytes,
  type ImageFetcher,
  type ImageProbeResponse,
} from "../../../src/extraction/images";
import { loadFixture } from "./testUtils";

const BASE = "https://summittrailgear.example/products/foo";

describe("extractImages", () => {
  it("distinguishes missing alt (null) from present-empty alt (''), captures dims and format", () => {
    const $ = cheerio.load(loadFixture("images-mixed.html"));
    const images = extractImages($, BASE);
    expect(images).toHaveLength(4);

    const [missingAlt, emptyAlt, bmp, badDims] = images;

    // manifest #10a — alt attribute entirely absent
    expect(missingAlt!.alt).toBeNull();
    expect(missingAlt!.width).toBe(240);
    expect(missingAlt!.height).toBe(240);
    expect(missingAlt!.format).toBe("png");

    // present-empty alt — distinct evidence from missing
    expect(emptyAlt!.alt).toBe("");
    // manifest #10c — no width/height attributes present
    expect(emptyAlt!.width).toBeNull();
    expect(emptyAlt!.height).toBeNull();
    expect(emptyAlt!.format).toBe("jpg");

    // manifest #10d — suboptimal BMP format
    expect(bmp!.format).toBe("bmp");
    expect(bmp!.alt).toBe("Trail map of the Granite Ridge test loop");

    // non-numeric width/height ("100%", "auto") must not be coerced — null, not garbage numbers
    expect(badDims!.width).toBeNull();
    expect(badDims!.height).toBeNull();
  });

  it("resolves relative src to absolute against the given base", () => {
    const $ = cheerio.load(`<img src="/images/x.png" alt="x">`);
    expect(extractImages($, BASE)[0]!.url).toBe("https://summittrailgear.example/images/x.png");
  });

  it("skips img tags with no src", () => {
    const $ = cheerio.load(`<img alt="no src at all">`);
    expect(extractImages($, BASE)).toEqual([]);
  });

  it("never throws on an unresolvable src", () => {
    const $ = cheerio.load(`<img src="http://[bad" alt="x">`);
    expect(() => extractImages($, BASE)).not.toThrow();
    expect(extractImages($, BASE)).toEqual([]);
  });

  it("captures loading/decoding/fetchpriority/sizes as authored, lowercased", () => {
    const $ = cheerio.load(
      `<img src="/a.png" alt="a" loading="LAZY" decoding="Async" fetchpriority="High" sizes="(max-width: 600px) 100vw, 50vw">`
    );
    const img = extractImages($, BASE)[0]!;
    expect(img.loading).toBe("lazy");
    expect(img.decoding).toBe("async");
    expect(img.fetchPriority).toBe("high");
    expect(img.sizes).toBe("(max-width: 600px) 100vw, 50vw");
    expect(img.kind).toBe("img");
    expect(img.source).toBe("src");
  });

  it("leaves absent loading/decoding attributes null rather than defaulting them", () => {
    const $ = cheerio.load(`<img src="/a.png" alt="a">`);
    const img = extractImages($, BASE)[0]!;
    expect(img.loading).toBeNull();
    expect(img.decoding).toBeNull();
    expect(img.fetchPriority).toBeNull();
    expect(img.sizes).toBeNull();
  });

  it("falls back through lazy-loader src attributes when src is absent", () => {
    const $ = cheerio.load(`<img data-src="/lazy.png" alt="lazy">`);
    const img = extractImages($, BASE)[0]!;
    expect(img.url).toBe("https://summittrailgear.example/lazy.png");
    expect(img.source).toBe("data-src");
  });

  it("uses the first srcset candidate when an img carries srcset but no src at all", () => {
    const $ = cheerio.load(`<img srcset="/small.png 400w, /big.png 1200w" alt="responsive">`);
    const img = extractImages($, BASE)[0]!;
    expect(img.url).toBe("https://summittrailgear.example/small.png");
    expect(img.source).toBe("srcset");
    expect(img.srcset).toHaveLength(2);
  });

  it("captures <input type=image> — it carries alt like an img does", () => {
    const $ = cheerio.load(`<input type="image" src="/go.png">`);
    const img = extractImages($, BASE)[0]!;
    expect(img.kind).toBe("input-image");
    expect(img.alt).toBeNull();
  });
});

describe("parseSrcset", () => {
  it("parses width descriptors", () => {
    expect(parseSrcset("/a.png 400w, /b.png 800w", BASE)).toEqual([
      { url: "https://summittrailgear.example/a.png", width: 400, density: null, raw: "400w" },
      { url: "https://summittrailgear.example/b.png", width: 800, density: null, raw: "800w" },
    ]);
  });

  it("parses pixel-density descriptors including fractional ones", () => {
    const out = parseSrcset("/a.png 1x, /b.png 1.5x, /c.png 2x", BASE);
    expect(out.map((c) => c.density)).toEqual([1, 1.5, 2]);
    expect(out.every((c) => c.width === null)).toBe(true);
  });

  it("defaults a descriptor-less candidate to density 1 per spec", () => {
    expect(parseSrcset("/only.png", BASE)).toEqual([
      { url: "https://summittrailgear.example/only.png", width: null, density: 1, raw: "" },
    ]);
  });

  it("does not split a URL that itself contains commas", () => {
    const out = parseSrcset("/img/a,b.png 1x, /c.png 2x", BASE);
    expect(out).toHaveLength(2);
    expect(out[0]!.url).toBe("https://summittrailgear.example/img/a,b.png");
  });

  it("splits on a comma only once whitespace follows it, as the spec requires", () => {
    // Per the HTML srcset algorithm the URL runs to the next whitespace, so an unspaced comma is
    // part of the URL — the same thing a browser does, and why authors must write ", ".
    expect(parseSrcset("/a.png,/b.png 2x", BASE)).toEqual([
      { url: "https://summittrailgear.example/a.png,/b.png", width: null, density: 2, raw: "2x" },
    ]);
    const spaced = parseSrcset("/a.png, /b.png 2x", BASE);
    expect(spaced).toHaveLength(2);
    expect(spaced[0]!).toMatchObject({ url: "https://summittrailgear.example/a.png", density: 1 });
    expect(spaced[1]!).toMatchObject({ url: "https://summittrailgear.example/b.png", density: 2 });
  });

  it("strips a trailing comma from a descriptor-less candidate", () => {
    expect(parseSrcset("/a.png, /b.png,", BASE).map((c) => c.url)).toEqual([
      "https://summittrailgear.example/a.png",
      "https://summittrailgear.example/b.png",
    ]);
  });

  it("tolerates newlines and runs of whitespace between candidates", () => {
    const out = parseSrcset("\n  /a.png   400w ,\n  /b.png   800w\n", BASE);
    expect(out.map((c) => c.width)).toEqual([400, 800]);
  });

  it("returns [] for empty, whitespace-only, or missing srcset", () => {
    expect(parseSrcset("", BASE)).toEqual([]);
    expect(parseSrcset("   ", BASE)).toEqual([]);
    expect(parseSrcset(null, BASE)).toEqual([]);
    expect(parseSrcset(undefined, BASE)).toEqual([]);
  });

  it("drops unresolvable candidate URLs rather than throwing", () => {
    expect(() => parseSrcset("http://[bad 1x, /ok.png 2x", BASE)).not.toThrow();
    expect(parseSrcset("http://[bad 1x, /ok.png 2x", BASE)).toHaveLength(1);
  });
});

describe("<picture> extraction", () => {
  const html = `
    <picture>
      <source srcset="/hero.avif 1x, /hero@2x.avif 2x" type="image/avif" media="(min-width: 800px)">
      <source srcset="/hero.webp" type="image/webp">
      <img src="/hero.jpg" alt="Hero" width="1200" height="600">
    </picture>`;

  it("attaches sources to the owning img instead of emitting alt-less records", () => {
    const $ = cheerio.load(html);
    const images = extractImages($, BASE);
    expect(images).toHaveLength(1); // the <img>, never the <source> elements
    const img = images[0]!;
    expect(img.pictureSources).toHaveLength(2);
    expect(img.pictureSources![0]).toMatchObject({ type: "image/avif", media: "(min-width: 800px)" });
    expect(img.pictureSources![0]!.srcset.map((c) => c.density)).toEqual([1, 2]);
    expect(img.pictureSources![1]!.srcset[0]!.url).toBe("https://summittrailgear.example/hero.webp");
  });

  it("leaves pictureSources empty for a standalone img", () => {
    const $ = cheerio.load(`<img src="/a.png" alt="a">`);
    expect(extractImages($, BASE)[0]!.pictureSources).toEqual([]);
  });

  it("ignores <source> outside a <picture> (video sources are media.ts's job)", () => {
    const $ = cheerio.load(`<video><source src="/clip.mp4" type="video/mp4"></video>`);
    expect(extractImages($, BASE)).toEqual([]);
  });
});

describe("extractBackgroundImages", () => {
  it("extracts an inline style background and marks it kind=background", () => {
    const $ = cheerio.load(`<div style="background-image: url('/bg/hero.jpg')"></div>`);
    const bg = extractBackgroundImages($, BASE);
    expect(bg).toHaveLength(1);
    expect(bg[0]!).toMatchObject({
      url: "https://summittrailgear.example/bg/hero.jpg",
      kind: "background",
      cssProperty: "background-image",
      cssSelector: null,
      alt: null,
    });
  });

  it("extracts from a <style> block and keeps the selector, including inside @media", () => {
    const $ = cheerio.load(`<style>
      .hero { background: #fff url(/bg/a.png) no-repeat; }
      @media (min-width: 700px) { .hero-wide { background-image: url("/bg/b.png"); } }
    </style>`);
    const bg = extractBackgroundImages($, BASE);
    expect(bg.map((b) => b.url)).toEqual([
      "https://summittrailgear.example/bg/a.png",
      "https://summittrailgear.example/bg/b.png",
    ]);
    expect(bg[0]!.cssSelector).toBe(".hero");
    expect(bg[1]!.cssSelector).toBe(".hero-wide"); // the rule, not the @media prelude
  });

  it("reads every quoted candidate out of image-set()", () => {
    const $ = cheerio.load(`<style>.a { background-image: image-set("/x1.png" 1x, "/x2.png" 2x); }</style>`);
    expect(extractBackgroundImages($, BASE).map((b) => b.url)).toEqual([
      "https://summittrailgear.example/x1.png",
      "https://summittrailgear.example/x2.png",
    ]);
  });

  it("ignores @font-face src — that is a font, not an image", () => {
    const $ = cheerio.load(`<style>@font-face { font-family: X; src: url(/fonts/x.woff2); }</style>`);
    expect(extractBackgroundImages($, BASE)).toEqual([]);
  });

  it("skips data: URI backgrounds — there is no asset to fetch", () => {
    const $ = cheerio.load(`<div style="background:url(data:image/gif;base64,R0lGODlhAQABAAAAACw=)"></div>`);
    expect(extractBackgroundImages($, BASE)).toEqual([]);
  });

  it("dedupes a background URL used by several rules", () => {
    const $ = cheerio.load(`<style>.a{background:url(/d.png)} .b{background-image:url(/d.png)}</style>`);
    expect(extractBackgroundImages($, BASE)).toHaveLength(1);
  });

  it("records an external <svg><use> sprite but not a same-document fragment ref", () => {
    const $ = cheerio.load(`<svg><use href="/sprite.svg#cart"></use></svg><svg><use href="#local"></use></svg>`);
    const bg = extractBackgroundImages($, BASE);
    expect(bg).toHaveLength(1);
    expect(bg[0]!).toMatchObject({ url: "https://summittrailgear.example/sprite.svg", kind: "svg-use" });
  });

  it("never throws on malformed CSS", () => {
    const $ = cheerio.load(`<style>.a { background: url( } .b {{{ url(/x.png)</style><div style=":::"></div>`);
    expect(() => extractBackgroundImages($, BASE)).not.toThrow();
  });
});

describe("the alt denominator", () => {
  it("counts only alt-applicable elements, never backgrounds or picture sources", () => {
    const $ = cheerio.load(`
      <img src="/no-alt.png">
      <img src="/empty-alt.png" alt="">
      <img src="/good.png" alt="A real description">
      <picture><source srcset="/s.webp"><img src="/pic.jpg" alt="Pic"></picture>
      <div style="background-image:url(/bg1.png)"></div>
      <style>.x { background: url(/bg2.png); }</style>`);
    const { images, backgroundImages, summary } = extractImageInventory($, BASE);

    expect(images).toHaveLength(4);
    expect(backgroundImages).toHaveLength(2);
    expect(summary.altApplicable).toBe(4);
    expect(summary.backgroundCount).toBe(2);
    expect(summary.total).toBe(6);
    // The one thing that must never drift: a background is not a missing alt.
    expect(summary.missingAlt).toBe(1);
    expect(summary.emptyAlt).toBe(1);
    expect(summary.pictureCount).toBe(1);
  });

  it("treats role=presentation and aria-hidden as declared-decorative", () => {
    const $ = cheerio.load(`
      <img src="/a.png" alt="" >
      <img src="/b.png" alt="x" role="presentation">
      <img src="/c.png" alt="y" aria-hidden="true">
      <img src="/d.png" alt="real">`);
    const { summary, images } = extractImageInventory($, BASE);
    expect(summary.decorative).toBe(3);
    expect(images[3]!.decorative).toBe(false);
  });

  it("a missing alt is still missing even on a decorative-looking image", () => {
    const $ = cheerio.load(`<img src="/a.png" role="presentation">`);
    const { summary } = extractImageInventory($, BASE);
    expect(summary.missingAlt).toBe(1);
    expect(summary.decorative).toBe(1);
  });

  it("keeps data: URIs out of images[] but counts their inlined bytes", () => {
    const $ = cheerio.load(`<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="dot"><img src="/real.png" alt="r">`);
    const { images, summary } = extractImageInventory($, BASE);
    expect(images).toHaveLength(1);
    expect(images[0]!.url).toBe("https://summittrailgear.example/real.png");
    expect(summary.dataUriCount).toBe(1);
    expect(summary.dataUriBytes).toBeGreaterThan(0);
    expect(summary.altApplicable).toBe(1);
  });

  it("counts lazy vs eager loading", () => {
    const $ = cheerio.load(`<img src="/a.png" alt="a" loading="lazy"><img src="/b.png" alt="b" loading="eager"><img src="/c.png" alt="c">`);
    const { summary } = extractImageInventory($, BASE);
    expect(summary.lazyLoaded).toBe(1);
    expect(summary.eagerLoaded).toBe(1);
  });
});

describe("dataUriBytes", () => {
  it("decodes base64 length exactly, accounting for padding", () => {
    const payload = Buffer.from("hello world").toString("base64");
    expect(dataUriBytes(`data:image/png;base64,${payload}`)).toBe(11);
  });

  it("uses the raw length for a non-base64 data URI and 0 when there is no comma", () => {
    expect(dataUriBytes("data:image/svg+xml,%3Csvg%3E")).toBe(9);
    expect(dataUriBytes("data:image/png;base64")).toBe(0);
  });
});

/* ── asset probing ── */

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function fetcher(
  responses: Record<string, ImageProbeResponse | "reject">
): ImageFetcher & { calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = [];
  const fn = (async (url: string, init: { method: "GET" | "HEAD" }) => {
    calls.push({ url, method: init.method });
    const r = responses[`${init.method} ${url}`];
    if (r === undefined) throw new Error(`unmocked ${init.method} ${url}`);
    if (r === "reject") throw new Error("simulated network failure");
    return r;
  }) as ImageFetcher & { calls: { url: string; method: string }[] };
  fn.calls = calls;
  return fn;
}

describe("probeImageAsset", () => {
  const URL_A = "https://summittrailgear.example/images/hero.png";

  it("reads the total size from Content-Range and the dimensions from the same ranged GET", async () => {
    const fetchImpl = fetcher({
      [`GET ${URL_A}`]: {
        status: 206,
        headers: { "content-range": "bytes 0-4095/2411520", "content-length": "4096" },
        bytes: pngBytes(3000, 2000),
      },
    });
    const result = await probeImageAsset(URL_A, { fetchImpl });
    expect(result.bytes).toBe(2411520);
    expect(result.byteSource).toBe("content-range");
    expect(result.naturalWidth).toBe(3000);
    expect(result.naturalHeight).toBe(2000);
    expect(result.naturalSource).toBe("header-decode");
    expect(result.sizeError).toBeNull();
    expect(fetchImpl.calls).toHaveLength(1); // one request buys both size and dimensions
  });

  it("never mistakes a 206 slice length for the file size", async () => {
    const fetchImpl = fetcher({
      [`GET ${URL_A}`]: { status: 206, headers: { "content-length": "4096" }, bytes: pngBytes(10, 10) },
      [`HEAD ${URL_A}`]: { status: 200, headers: { "content-length": "999999" }, bytes: null },
    });
    const result = await probeImageAsset(URL_A, { fetchImpl });
    expect(result.bytes).toBe(999999); // from HEAD, not the 4096 slice
    expect(result.byteSource).toBe("content-length");
  });

  it("uses Content-Length when the server ignores Range and answers 200", async () => {
    const fetchImpl = fetcher({
      [`GET ${URL_A}`]: { status: 200, headers: { "content-length": "51234" }, bytes: pngBytes(800, 600) },
    });
    const result = await probeImageAsset(URL_A, { fetchImpl });
    expect(result.bytes).toBe(51234);
    expect(result.byteSource).toBe("content-length");
    expect(fetchImpl.calls.map((c) => c.method)).toEqual(["GET"]); // no wasted HEAD
  });

  it("records the reason instead of a byte count when no length header exists anywhere", async () => {
    const fetchImpl = fetcher({
      [`GET ${URL_A}`]: { status: 200, headers: {}, bytes: pngBytes(10, 10) },
      [`HEAD ${URL_A}`]: { status: 200, headers: {}, bytes: null },
    });
    const result = await probeImageAsset(URL_A, { fetchImpl });
    expect(result.bytes).toBeNull();
    expect(result.byteSource).toBeNull();
    expect(result.sizeError).toBe("no-content-length-or-content-range");
    expect(result.naturalWidth).toBe(10); // dimensions still decoded — a partial answer is not a failure
  });

  it("reports the HTTP status on a 404 and fabricates nothing", async () => {
    const fetchImpl = fetcher({ [`GET ${URL_A}`]: { status: 404, headers: {}, bytes: null } });
    const result = await probeImageAsset(URL_A, { fetchImpl });
    expect(result).toMatchObject({
      bytes: null,
      byteSource: null,
      naturalWidth: null,
      naturalHeight: null,
      status: 404,
      sizeError: "http-404",
    });
  });

  it("captures a network failure as a sizeError rather than throwing", async () => {
    const fetchImpl = fetcher({ [`GET ${URL_A}`]: "reject" });
    const result = await probeImageAsset(URL_A, { fetchImpl });
    expect(result.bytes).toBeNull();
    expect(result.status).toBeNull();
    expect(result.sizeError).toContain("fetch-failed");
  });

  it("still reports the byte size when the header bytes cannot be decoded", async () => {
    const fetchImpl = fetcher({
      [`GET ${URL_A}`]: { status: 206, headers: { "content-range": "bytes 0-99/8000" }, bytes: new Uint8Array([1, 2, 3]) },
    });
    const result = await probeImageAsset(URL_A, { fetchImpl });
    expect(result.bytes).toBe(8000);
    expect(result.naturalWidth).toBeNull();
    expect(result.naturalSource).toBeNull();
  });

  it("treats an unsatisfiable Content-Range total (*) as unknown, not zero", async () => {
    const fetchImpl = fetcher({
      [`GET ${URL_A}`]: { status: 206, headers: { "content-range": "bytes 0-99/*" }, bytes: pngBytes(5, 5) },
      [`HEAD ${URL_A}`]: { status: 200, headers: {}, bytes: null },
    });
    const result = await probeImageAsset(URL_A, { fetchImpl });
    expect(result.bytes).toBeNull();
    expect(result.sizeError).toBe("no-content-length-or-content-range");
  });
});
