import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import {
  extractFaviconCandidates,
  probeFaviconCandidates,
  assessGoogleSerpEligibility,
  buildFaviconReport,
  decodeImageDimensions,
  type FaviconFetcher,
  type FaviconFetchResult,
} from "../../../src/extraction/favicons";
import type { IconRecord } from "../../../src/models/types";

const BASE = "https://summittrailgear.example/";

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

function gifBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(10);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}

function icoBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(22);
  bytes.set([0, 0, 1, 0, 1, 0], 0);
  bytes[6] = width; // 0 encodes 256 per the ICO spec
  bytes[7] = height;
  return bytes;
}

function jpegBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(29);
  bytes.set([0xff, 0xd8], 0); // SOI
  bytes.set([0xff, 0xe0, 0x00, 0x10], 2); // APP0, len=16 (2 len bytes + 14 payload)
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20); // SOF0, len, precision
  const view = new DataView(bytes.buffer);
  view.setUint16(25, height);
  view.setUint16(27, width);
  return bytes;
}

function svgBytes(markup: string): Uint8Array {
  return new TextEncoder().encode(markup);
}

function riffHeader(bytes: Uint8Array, chunk: string): void {
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set(Array.from(chunk, (c) => c.charCodeAt(0)), 12);
}

function webpLossyBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  riffHeader(bytes, "VP8 ");
  bytes.set([0x9d, 0x01, 0x2a], 23); // VP8 keyframe start code
  const view = new DataView(bytes.buffer);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return bytes;
}

function webpLosslessBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  riffHeader(bytes, "VP8L");
  bytes[20] = 0x2f; // VP8L signature
  // 14 bits width-1 then 14 bits height-1, packed little-endian.
  new DataView(bytes.buffer).setUint32(21, (width - 1) | ((height - 1) << 14), true);
  return bytes;
}

function webpExtendedBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  riffHeader(bytes, "VP8X");
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return bytes;
}

function bmpBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(54);
  bytes.set([0x42, 0x4d], 0); // "BM"
  const view = new DataView(bytes.buffer);
  view.setUint32(14, 40, true); // BITMAPINFOHEADER
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  return bytes;
}

function fakeFetcher(map: Record<string, FaviconFetchResult | "reject">): FaviconFetcher & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const r = map[url];
    if (r === undefined) throw new Error(`unmocked fetch: ${url}`);
    if (r === "reject") throw new Error("simulated network failure");
    return r;
  }) as FaviconFetcher & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe("extractFaviconCandidates", () => {
  it("detects every declaration form with correct source + document order", () => {
    const html = `<html><head>
      <link rel="icon" href="/icon.png" sizes="32x32">
      <link rel="shortcut icon" href="/shortcut.ico">
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="apple-touch-icon-precomposed" href="/apple-precomposed.png">
      <link rel="mask-icon" href="/mask.svg">
      <link rel="manifest" href="/manifest.json">
      <meta name="msapplication-TileImage" content="/tile.png">
      <meta name="msapplication-config" content="/browserconfig.xml">
    </head><body></body></html>`;
    const $ = cheerio.load(html);
    const candidates = extractFaviconCandidates($, BASE, [{ src: "/pwa-icon.png", sizes: "192x192" }]);

    const bySource = (s: IconRecord["source"]) => candidates.filter((c) => c.source === s);
    expect(bySource("link")).toHaveLength(5);
    expect(bySource("meta")).toHaveLength(2);
    expect(bySource("manifest")).toHaveLength(1);
    expect(bySource("implicit")).toHaveLength(2);

    const shortcut = candidates.find((c) => c.rel === "shortcut icon");
    expect(shortcut?.href).toBe("https://summittrailgear.example/shortcut.ico");
    const precomposed = candidates.find((c) => c.rel === "apple-touch-icon-precomposed");
    expect(precomposed?.href).toBe("https://summittrailgear.example/apple-precomposed.png");
    const maskIcon = candidates.find((c) => c.rel === "mask-icon");
    expect(maskIcon?.href).toBe("https://summittrailgear.example/mask.svg");
    const tile = candidates.find((c) => c.rel.toLowerCase() === "msapplication-tileimage");
    expect(tile?.href).toBe("https://summittrailgear.example/tile.png");

    // document order preserved across link declarations
    const linkIndexes = bySource("link").map((c) => c.index);
    expect(linkIndexes).toEqual([...linkIndexes].sort((a, b) => a - b));
  });

  it("gives the LAST equally-appropriate <link rel=icon> the highest index (not the first)", () => {
    const $ = cheerio.load(
      `<html><head><link rel="icon" href="/a.png"><link rel="icon" href="/b.png"></head><body></body></html>`
    );
    const candidates = extractFaviconCandidates($, BASE);
    const a = candidates.find((c) => c.href.endsWith("a.png"))!;
    const b = candidates.find((c) => c.href.endsWith("b.png"))!;
    expect(b.index).toBeGreaterThan(a.index); // b declared later in tree order
  });

  it("resolves relative hrefs against a <base href> found by the caller", () => {
    // resolveBase (shared.ts, owned elsewhere) is what a real caller uses to build baseUrl —
    // here we simulate its effect directly: pass the <base>-resolved URL as baseUrl.
    const $ = cheerio.load(
      `<html><head><base href="/app/"><link rel="icon" href="icon.png"></head><body></body></html>`
    );
    const effectiveBase = new URL("/app/", BASE).href;
    const candidates = extractFaviconCandidates($, effectiveBase);
    expect(candidates.find((c) => c.source === "link")?.href).toBe("https://summittrailgear.example/app/icon.png");
  });

  it("resolves manifest icon src against the manifest's own URL, not the page URL", () => {
    const $ = cheerio.load(`<html><head><link rel="manifest" href="/app/manifest.json"></head><body></body></html>`);
    const candidates = extractFaviconCandidates($, BASE, [{ src: "icon-192.png" }]);
    const manifestIcon = candidates.find((c) => c.source === "manifest");
    expect(manifestIcon?.href).toBe("https://summittrailgear.example/app/icon-192.png");
  });

  it("always includes the implicit /favicon.ico and /apple-touch-icon.png fallbacks, lowest priority", () => {
    const $ = cheerio.load(`<html><head></head><body></body></html>`);
    const candidates = extractFaviconCandidates($, BASE);
    expect(candidates).toHaveLength(2);
    const favicon = candidates.find((c) => c.href.endsWith("/favicon.ico"));
    const appleTouch = candidates.find((c) => c.href.endsWith("/apple-touch-icon.png"));
    expect(favicon?.source).toBe("implicit");
    expect(appleTouch?.source).toBe("implicit");
    expect(favicon!.index).toBeLessThan(0);
    expect(appleTouch!.index).toBeLessThan(0);
  });

  it("never throws on malformed or absent markup", () => {
    for (const html of ["", "<p>fragment", "<<>>", "<html><head><link rel></head>", "<link href='/x.png'>"]) {
      const $ = cheerio.load(html);
      expect(() => extractFaviconCandidates($, BASE)).not.toThrow();
      expect(() => extractFaviconCandidates($, "not a url")).not.toThrow();
    }
  });

  it("never throws and yields no manifest candidates on malformed manifestIcons input", () => {
    const $ = cheerio.load(`<html><head></head><body></body></html>`);
    // @ts-expect-error deliberately malformed input for the never-throw guarantee
    expect(() => extractFaviconCandidates($, BASE, [{}, { src: "" }, null])).not.toThrow();
  });
});

describe("probeFaviconCandidates", () => {
  it("resolves effective to the LAST declared candidate when both are reachable (last-wins)", async () => {
    const $ = cheerio.load(
      `<html><head><link rel="icon" href="/a.png"><link rel="icon" href="/b.png"></head><body></body></html>`
    );
    const candidates = extractFaviconCandidates($, BASE);
    const fetchImpl = fakeFetcher({
      "https://summittrailgear.example/a.png": { status: 200, bytes: pngBytes(16, 16) },
      "https://summittrailgear.example/b.png": { status: 200, bytes: pngBytes(32, 32) },
      "https://summittrailgear.example/favicon.ico": { status: 404, bytes: new Uint8Array() },
      "https://summittrailgear.example/apple-touch-icon.png": { status: 404, bytes: new Uint8Array() },
    });
    const result = await probeFaviconCandidates(candidates, { fetchImpl });
    expect(result.effective).toBe("https://summittrailgear.example/b.png");
  });

  it("falls through to the next-most-appropriate candidate when the last one 404s", async () => {
    const $ = cheerio.load(
      `<html><head><link rel="icon" href="/a.png"><link rel="icon" href="/b.png"></head><body></body></html>`
    );
    const candidates = extractFaviconCandidates($, BASE);
    const fetchImpl = fakeFetcher({
      "https://summittrailgear.example/a.png": { status: 200, bytes: pngBytes(16, 16) },
      "https://summittrailgear.example/b.png": { status: 404, bytes: new Uint8Array() },
      "https://summittrailgear.example/favicon.ico": { status: 404, bytes: new Uint8Array() },
      "https://summittrailgear.example/apple-touch-icon.png": { status: 404, bytes: new Uint8Array() },
    });
    const result = await probeFaviconCandidates(candidates, { fetchImpl });
    expect(result.effective).toBe("https://summittrailgear.example/a.png");
    expect(result.candidates.find((c) => c.href.endsWith("b.png"))?.status).toBe(404);
  });

  it("falls all the way through to the implicit /favicon.ico when nothing declared works", async () => {
    const $ = cheerio.load(`<html><head><link rel="icon" href="/missing.png"></head><body></body></html>`);
    const candidates = extractFaviconCandidates($, BASE);
    const fetchImpl = fakeFetcher({
      "https://summittrailgear.example/missing.png": { status: 404, bytes: new Uint8Array() },
      "https://summittrailgear.example/favicon.ico": { status: 200, bytes: icoBytes(16, 16) },
      "https://summittrailgear.example/apple-touch-icon.png": { status: 404, bytes: new Uint8Array() },
    });
    const result = await probeFaviconCandidates(candidates, { fetchImpl });
    expect(result.effective).toBe("https://summittrailgear.example/favicon.ico");
  });

  it("returns effective: null when every candidate fails, without throwing", async () => {
    const $ = cheerio.load(`<html><head><link rel="icon" href="/x.png"></head><body></body></html>`);
    const candidates = extractFaviconCandidates($, BASE);
    const fetchImpl = fakeFetcher({
      "https://summittrailgear.example/x.png": { status: 404, bytes: new Uint8Array() },
      "https://summittrailgear.example/favicon.ico": { status: 500, bytes: new Uint8Array() },
      "https://summittrailgear.example/apple-touch-icon.png": "reject",
    });
    const result = await probeFaviconCandidates(candidates, { fetchImpl });
    expect(result.effective).toBeNull();
    expect(result.candidates.find((c) => c.href.endsWith("apple-touch-icon.png"))?.status).toBeNull();
  });

  it("never probes more candidates than were declared, and never touches the real network", async () => {
    const $ = cheerio.load(`<html><head><link rel="icon" href="/x.png"></head><body></body></html>`);
    const candidates = extractFaviconCandidates($, BASE);
    expect(candidates).toHaveLength(3); // 1 declared + 2 implicit
    const fetchImpl = fakeFetcher({
      "https://summittrailgear.example/x.png": { status: 200, bytes: pngBytes(8, 8) },
      "https://summittrailgear.example/favicon.ico": { status: 200, bytes: icoBytes(16, 16) },
      "https://summittrailgear.example/apple-touch-icon.png": { status: 200, bytes: pngBytes(180, 180) },
    });
    await probeFaviconCandidates(candidates, { fetchImpl });
    expect(fetchImpl.calls).toHaveLength(3);
  });
});

describe("decodeImageDimensions", () => {
  it("decodes PNG from the IHDR chunk", () => {
    expect(decodeImageDimensions(pngBytes(150, 150))).toEqual({ width: 150, height: 150 });
  });

  it("decodes GIF from the logical screen descriptor", () => {
    expect(decodeImageDimensions(gifBytes(64, 32))).toEqual({ width: 64, height: 32 });
  });

  it("decodes ICO from the first directory entry, treating 0 as 256", () => {
    expect(decodeImageDimensions(icoBytes(32, 32))).toEqual({ width: 32, height: 32 });
    expect(decodeImageDimensions(icoBytes(0, 0))).toEqual({ width: 256, height: 256 });
  });

  it("decodes JPEG by scanning markers to the SOF0 frame header, skipping APP0", () => {
    expect(decodeImageDimensions(jpegBytes(48, 64))).toEqual({ width: 48, height: 64 });
  });

  it("decodes all three WebP container variants", () => {
    expect(decodeImageDimensions(webpLossyBytes(800, 600))).toEqual({ width: 800, height: 600 });
    expect(decodeImageDimensions(webpLosslessBytes(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(decodeImageDimensions(webpExtendedBytes(4000, 3000))).toEqual({ width: 4000, height: 3000 });
  });

  it("decodes BMP, treating a negative (top-down) height as a positive size", () => {
    expect(decodeImageDimensions(bmpBytes(400, 300))).toEqual({ width: 400, height: 300 });
    expect(decodeImageDimensions(bmpBytes(400, -300))).toEqual({ width: 400, height: 300 });
  });

  it("decodes SVG from explicit width/height attributes", () => {
    const svg = svgBytes(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path d="M0 0"/></svg>`);
    expect(decodeImageDimensions(svg)).toEqual({ width: 64, height: 64 });
  });

  it("falls back to viewBox when SVG has no width/height attributes", () => {
    const svg = svgBytes(`<svg viewBox="0 0 100 50"><path d="M0 0"/></svg>`);
    expect(decodeImageDimensions(svg)).toEqual({ width: 100, height: 50 });
  });

  it("returns null on garbage or empty bytes, never throws", () => {
    expect(decodeImageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodeImageDimensions(new Uint8Array())).toBeNull();
    expect(() => decodeImageDimensions(new Uint8Array([1, 2, 3]))).not.toThrow();
  });
});

describe("assessGoogleSerpEligibility", () => {
  const HOME = "https://summittrailgear.example/";
  const validCandidate: IconRecord = {
    rel: "icon",
    href: "https://summittrailgear.example/icon.png",
    declaredSizes: "32x32",
    type: null,
    index: 0,
    source: "link",
    status: 200,
    actualSize: { width: 32, height: 32 },
  };

  it("is eligible with no blockers when every signal checks out and robots checks pass", () => {
    const r = assessGoogleSerpEligibility([validCandidate], {
      pageUrl: HOME,
      checkGooglebotAccess: () => true,
      checkGooglebotImageAccess: () => true,
    });
    expect(r).toEqual({ googleSerpEligible: true, googleSerpBlockers: [] });
  });

  it("is false with 'not-home-page' when the page isn't the home page", () => {
    const r = assessGoogleSerpEligibility([validCandidate], {
      pageUrl: "https://summittrailgear.example/products/foo",
      checkGooglebotAccess: () => true,
      checkGooglebotImageAccess: () => true,
    });
    expect(r.googleSerpEligible).toBe(false);
    expect(r.googleSerpBlockers).toContain("not-home-page");
  });

  it("is false with 'manifest-icons-ignored-by-google' when only manifest icons are declared", () => {
    const manifestOnly: IconRecord = {
      rel: "icon",
      href: "https://summittrailgear.example/pwa.png",
      declaredSizes: "192x192",
      type: null,
      index: 0,
      source: "manifest",
    };
    const implicitFallback: IconRecord = {
      rel: "icon",
      href: "https://summittrailgear.example/favicon.ico",
      declaredSizes: null,
      type: null,
      index: -1,
      source: "implicit",
    };
    const r = assessGoogleSerpEligibility([manifestOnly, implicitFallback], { pageUrl: HOME });
    expect(r.googleSerpEligible).toBe(false);
    expect(r.googleSerpBlockers).toContain("manifest-icons-ignored-by-google");
  });

  it("stays null when robots.txt access wasn't checked, rather than guessing", () => {
    const r = assessGoogleSerpEligibility([validCandidate], { pageUrl: HOME });
    expect(r.googleSerpEligible).toBeNull();
    expect(r.googleSerpBlockers).toContain("googlebot-access-unknown");
    expect(r.googleSerpBlockers).toContain("googlebot-image-access-unknown");
  });

  it("is false with 'icon-not-square' for a non-square icon", () => {
    const nonSquare: IconRecord = { ...validCandidate, actualSize: { width: 32, height: 16 } };
    const r = assessGoogleSerpEligibility([nonSquare], {
      pageUrl: HOME,
      checkGooglebotAccess: () => true,
      checkGooglebotImageAccess: () => true,
    });
    expect(r.googleSerpEligible).toBe(false);
    expect(r.googleSerpBlockers).toContain("icon-not-square");
  });

  it("is false with 'icon-smaller-than-8x8' for a tiny icon", () => {
    const tiny: IconRecord = { ...validCandidate, actualSize: { width: 4, height: 4 } };
    const r = assessGoogleSerpEligibility([tiny], {
      pageUrl: HOME,
      checkGooglebotAccess: () => true,
      checkGooglebotImageAccess: () => true,
    });
    expect(r.googleSerpEligible).toBe(false);
    expect(r.googleSerpBlockers).toContain("icon-smaller-than-8x8");
  });

  it("is false with 'icon-url-looks-unstable' for a content-hashed filename", () => {
    const hashed: IconRecord = { ...validCandidate, href: "https://summittrailgear.example/9f8e7d6c5b4a3210.png" };
    const r = assessGoogleSerpEligibility([hashed], {
      pageUrl: HOME,
      checkGooglebotAccess: () => true,
      checkGooglebotImageAccess: () => true,
    });
    expect(r.googleSerpEligible).toBe(false);
    expect(r.googleSerpBlockers).toContain("icon-url-looks-unstable");
  });

  it("is false when Googlebot-Image specifically is blocked, even if Googlebot itself is allowed", () => {
    const r = assessGoogleSerpEligibility([validCandidate], {
      pageUrl: HOME,
      checkGooglebotAccess: () => true,
      checkGooglebotImageAccess: () => false,
    });
    expect(r.googleSerpEligible).toBe(false);
    expect(r.googleSerpBlockers).toContain("blocked-for-googlebot-image");
  });

  it("never throws on empty candidates", () => {
    expect(() => assessGoogleSerpEligibility([], { pageUrl: HOME })).not.toThrow();
    expect(assessGoogleSerpEligibility([], { pageUrl: HOME }).googleSerpEligible).toBeNull();
  });
});

describe("buildFaviconReport", () => {
  it("assembles the FaviconReport shape from its three inputs", () => {
    const candidates: IconRecord[] = [];
    const report = buildFaviconReport(candidates, "https://x.example/icon.png", {
      googleSerpEligible: true,
      googleSerpBlockers: [],
    });
    expect(report).toEqual({
      candidates,
      effective: "https://x.example/icon.png",
      googleSerpEligible: true,
      googleSerpBlockers: [],
    });
  });
});
