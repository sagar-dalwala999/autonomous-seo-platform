import { describe, it, expect, afterEach } from "vitest";
import * as cheerio from "cheerio";
import {
  collectComputedBackgroundsInPage,
  mergeComputedBackgroundImages,
  mergeNetworkObservedImages,
  extractImages,
} from "../../../src/extraction/images";
import type { ImageRecord, NetworkObservedAsset } from "../../../src/models/types";

const BASE = "https://summittrailgear.example/products/foo";

/** Minimal stand-in for a computed style, matching the CSSStyleDeclaration surface the collector reads. */
function styles(over: Partial<Record<"backgroundImage" | "borderImageSource" | "maskImage" | "listStyleImage", string>>) {
  return {
    backgroundImage: "none",
    borderImageSource: "none",
    maskImage: "none",
    listStyleImage: "none",
    ...over,
  };
}

describe("collectComputedBackgroundsInPage (real execution against stubbed DOM globals)", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).window;
  });

  it("finds background-image, border-image-source, mask-image and list-style-image, on the element and its ::before/::after", () => {
    const hero = {
      tagName: "DIV",
      id: "hero",
      className: "card",
      __own: styles({ backgroundImage: 'url("https://x.example/bg.png")' }),
      __before: styles({ backgroundImage: "url(https://x.example/before.png)" }),
      __after: styles({}),
    };
    const bullet = {
      tagName: "LI",
      id: "",
      className: "",
      __own: styles({ listStyleImage: "url('https://x.example/bullet.png')" }),
      __before: styles({}),
      __after: styles({}),
    };

    (globalThis as Record<string, unknown>).document = { body: { getElementsByTagName: () => [hero, bullet] } };
    (globalThis as Record<string, unknown>).window = {
      getComputedStyle: (el: typeof hero, pseudo?: string) =>
        pseudo === "::before" ? el.__before : pseudo === "::after" ? el.__after : el.__own,
    };

    const hits = collectComputedBackgroundsInPage(100);
    expect(hits).toHaveLength(3);
    expect(hits.find((h) => h.url === "https://x.example/bg.png")).toMatchObject({
      property: "background-image",
      pseudo: null,
      locator: "div#hero.card",
    });
    expect(hits.find((h) => h.url === "https://x.example/before.png")).toMatchObject({
      property: "background-image",
      pseudo: "::before",
    });
    expect(hits.find((h) => h.url === "https://x.example/bullet.png")).toMatchObject({
      property: "list-style-image",
      pseudo: null,
      locator: "li",
    });
  });

  it("respects the scan cap — only the first N elements are read", () => {
    const elements = Array.from({ length: 10 }, (_, i) => ({
      tagName: "DIV",
      id: "",
      className: "",
      __own: styles({ backgroundImage: `url(https://x.example/${i}.png)` }),
      __before: styles({}),
      __after: styles({}),
    }));
    (globalThis as Record<string, unknown>).document = { body: { getElementsByTagName: () => elements } };
    (globalThis as Record<string, unknown>).window = {
      getComputedStyle: (el: (typeof elements)[number], pseudo?: string) =>
        pseudo === "::before" ? el.__before : pseudo === "::after" ? el.__after : el.__own,
    };
    expect(collectComputedBackgroundsInPage(3)).toHaveLength(3);
  });

  it("never throws when getComputedStyle throws for an element — skips it instead", () => {
    (globalThis as Record<string, unknown>).document = { body: { getElementsByTagName: () => [{ tagName: "DIV", id: "", className: "" }] } };
    (globalThis as Record<string, unknown>).window = {
      getComputedStyle: () => {
        throw new Error("boom");
      },
    };
    expect(() => collectComputedBackgroundsInPage(10)).not.toThrow();
    expect(collectComputedBackgroundsInPage(10)).toEqual([]);
  });
});

describe("mergeComputedBackgroundImages", () => {
  it("adds a new computed-sweep hit as a background ImageRecord with pseudo/cssProperty evidence", () => {
    const added = mergeComputedBackgroundImages([], [
      { url: "https://x.example/bg.png", property: "background-image", pseudo: "::before", locator: "div.hero" },
    ]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      url: "https://x.example/bg.png",
      kind: "background",
      source: "computed-style",
      cssProperty: "background-image",
      pseudoElement: "::before",
      cssSelector: "div.hero",
      alt: null,
    });
  });

  it("dedupes against a URL the static regex parse already found", () => {
    const existing: ImageRecord[] = [
      { url: "https://x.example/bg.png", alt: null, width: null, height: null, format: "png" },
    ];
    const added = mergeComputedBackgroundImages(existing, [
      { url: "https://x.example/bg.png", property: "background-image", pseudo: null, locator: null },
    ]);
    expect(added).toEqual([]);
  });

  it("skips a malformed URL rather than throwing", () => {
    const added = mergeComputedBackgroundImages([], [
      { url: "not a url at all", property: "mask-image", pseudo: null, locator: null },
    ]);
    expect(added).toEqual([]);
  });

  it("never re-adds a data: URI as a fetchable background asset", () => {
    const added = mergeComputedBackgroundImages([], [
      { url: "data:image/png;base64,AAAA", property: "background-image", pseudo: null, locator: null },
    ]);
    expect(added).toEqual([]);
  });
});

describe("mergeNetworkObservedImages", () => {
  it("creates a new network-kind record for a response with no matching DOM node", () => {
    const observed: NetworkObservedAsset[] = [
      { url: "https://x.example/canvas-drawn.png", contentType: "image/png", status: 200, bytes: 4096 },
    ];
    const added = mergeNetworkObservedImages([], [], observed);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      url: "https://x.example/canvas-drawn.png",
      kind: "network",
      source: "network-response",
      networkContentType: "image/png",
      asset: { bytes: 4096, byteSource: "browser-transfer", status: 200, sizeError: null },
    });
  });

  it("never attributes a 404 response body's byte count as an image size (the trap this repo hit before)", () => {
    const observed: NetworkObservedAsset[] = [
      { url: "https://x.example/missing.png", contentType: "text/html", status: 404, bytes: 9 },
    ];
    const added = mergeNetworkObservedImages([], [], observed);
    expect(added[0]!.asset!.bytes).toBeNull();
    expect(added[0]!.asset!.sizeError).toBe("http-404");
  });

  it("does not duplicate a URL already known from DOM images[] or backgroundImages[] (exact-URL match only)", () => {
    const images: ImageRecord[] = [{ url: "https://x.example/known.png", alt: "x", width: null, height: null, format: "png" }];
    const backgrounds: ImageRecord[] = [{ url: "https://x.example/bg-known.png", alt: null, width: null, height: null, format: "png" }];
    const observed: NetworkObservedAsset[] = [
      { url: "https://x.example/known.png", contentType: "image/png", status: 200, bytes: 100 },
      { url: "https://x.example/bg-known.png", contentType: "image/png", status: 200, bytes: 100 },
      { url: "https://x.example/genuinely-new.png", contentType: "image/png", status: 200, bytes: 100 },
    ];
    const added = mergeNetworkObservedImages(images, backgrounds, observed);
    expect(added).toHaveLength(1);
    expect(added[0]!.url).toBe("https://x.example/genuinely-new.png");
  });

  it("records a missing content-length honestly instead of fabricating a size", () => {
    const observed: NetworkObservedAsset[] = [{ url: "https://x.example/no-length.png", contentType: "image/png", status: 200, bytes: null }];
    const added = mergeNetworkObservedImages([], [], observed);
    expect(added[0]!.asset!.bytes).toBeNull();
    expect(added[0]!.asset!.sizeError).toBe("browser-did-not-report-content-length");
  });
});

describe("extended lazy-load src fallback attributes", () => {
  it("picks up data-image, data-bg and data-fallback-src as primary src fallbacks", () => {
    expect(extractImages(cheerio.load(`<img data-image="/a.png" alt="a">`), BASE)[0]!.source).toBe("data-image");
    expect(extractImages(cheerio.load(`<img data-bg="/b.png" alt="b">`), BASE)[0]!.source).toBe("data-bg");
    expect(extractImages(cheerio.load(`<img data-fallback-src="/c.png" alt="c">`), BASE)[0]!.source).toBe("data-fallback-src");
  });
});
