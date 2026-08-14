import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverSitemaps } from "../../../src/discovery/sitemap";
import { DEFAULT_USER_AGENT } from "../../../src/discovery/http";
import type { RobotsInfo } from "../../../src/models/types";

function readFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/xml/${name}`, import.meta.url)), "utf-8");
}

function makeRobots(sitemaps: string[]): RobotsInfo {
  return {
    url: "https://example.com/robots.txt",
    statusCode: 200,
    content: "",
    sitemaps,
    crawlDelay: null,
    parseStatus: "ok",
    fetchedAt: new Date().toISOString(),
    isAllowed: () => true,
  };
}

interface Route {
  status: number;
  body: BodyInit;
  contentType?: string;
}

const LADDER_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml", "/sitemap-index.xml"];
const FEED_PATHS = ["/feed", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml", "/feed.json"];

/** Fills every unmapped ladder/feed probe with an explicit 404 so a test only maps what it cares about. */
function withProbes404(routes: Record<string, Route>, origin = "https://example.com"): Record<string, Route> {
  const filled: Record<string, Route> = {};
  for (const path of [...LADDER_PATHS, ...FEED_PATHS]) {
    filled[new URL(path, origin).toString()] = { status: 404, body: "" };
  }
  return { ...filled, ...routes };
}

function routeFetch(routes: Record<string, Route>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const route = routes[url];
    if (!route) throw new Error(`unmapped fetch in test: ${url}`);
    const headers = route.contentType ? { "content-type": route.contentType } : undefined;
    return new Response(route.body, { status: route.status, headers });
  });
}

describe("discoverSitemaps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a plain urlset from a robots-declared sitemap", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({ "https://example.com/sitemap.xml": { status: 200, body: readFixture("urlset-plain.xml") } })
    );

    const result = await discoverSitemaps(makeRobots(["https://example.com/sitemap.xml"]), "https://example.com");

    expect(result.entries).toEqual([
      { url: "https://example.com/", sourceSitemap: "https://example.com/sitemap.xml" },
      { url: "https://example.com/about", sourceSitemap: "https://example.com/sitemap.xml" },
      { url: "https://example.com/products", sourceSitemap: "https://example.com/sitemap.xml" },
    ]);
    expect(result.files).toEqual([
      {
        url: "https://example.com/sitemap.xml",
        statusCode: 200,
        kind: "urlset",
        urlCount: 3,
        error: null,
        gzipped: false,
        crossHost: false,
        crossHostUrlCount: 0,
        imageCount: 0,
        videoCount: 0,
        newsCount: 0,
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.crossHostEntryCount).toBe(0);
  });

  it("falls back to <origin>/sitemap.xml when robots declares no sitemaps", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({ "https://example.com/sitemap.xml": { status: 200, body: readFixture("urlset-plain.xml") } })
    );

    const result = await discoverSitemaps(makeRobots([]), "https://example.com");

    expect(result.files[0]?.url).toBe("https://example.com/sitemap.xml");
    expect(result.entries).toHaveLength(3);
  });

  it("recurses a sitemapindex into its children and dedups an entry shared across two children (keeps first)", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://example.com/sitemap-index.xml": { status: 200, body: readFixture("sitemapindex-two-children.xml") },
        "https://example.com/sitemap-child-a.xml": { status: 200, body: readFixture("sitemap-child-a.xml") },
        "https://example.com/sitemap-child-b.xml": { status: 200, body: readFixture("sitemap-child-b.xml") },
      })
    );

    const result = await discoverSitemaps(
      makeRobots(["https://example.com/sitemap-index.xml"]),
      "https://example.com"
    );

    expect(result.files).toHaveLength(3);
    expect(result.files.find((f) => f.kind === "index")?.urlCount).toBe(2);
    // a-one, shared-page (from child-a only), b-one — no duplicate of shared-page
    expect(result.entries).toHaveLength(3);
    const shared = result.entries.filter((e) => e.url === "https://example.com/shared-page");
    expect(shared).toHaveLength(1);
    expect(shared[0]?.sourceSitemap).toBe("https://example.com/sitemap-child-a.xml");
  });

  it("records malformed XML as kind 'unknown' with an error, without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch(
        withProbes404({ "https://example.com/sitemap.xml": { status: 200, body: readFixture("malformed.xml") } })
      )
    );

    const result = await discoverSitemaps(makeRobots([]), "https://example.com");

    expect(result.entries).toEqual([]);
    expect(result.files[0]).toEqual(
      expect.objectContaining({ url: "https://example.com/sitemap.xml", kind: "unknown", urlCount: 0 }),
    );
    expect(result.files[0]?.error).toContain("malformed XML");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("reports a valid but empty <urlset> as an empty urlset, not as a missing root element", async () => {
    const body =
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
    vi.stubGlobal("fetch", routeFetch(withProbes404({ "https://example.com/sitemap.xml": { status: 200, body } })));

    const result = await discoverSitemaps(makeRobots(["https://example.com/sitemap.xml"]), "https://example.com");

    expect(result.files[0]).toMatchObject({ kind: "urlset", urlCount: 0, error: null });
  });

  it("records a 404 child sitemap in files with statusCode 404, no throw, and keeps processing siblings", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://example.com/sitemap-index.xml": { status: 200, body: readFixture("sitemapindex-two-children.xml") },
        "https://example.com/sitemap-child-a.xml": { status: 404, body: "not found" },
        "https://example.com/sitemap-child-b.xml": { status: 200, body: readFixture("sitemap-child-b.xml") },
      })
    );

    const result = await discoverSitemaps(
      makeRobots(["https://example.com/sitemap-index.xml"]),
      "https://example.com"
    );

    const failed = result.files.find((f) => f.url === "https://example.com/sitemap-child-a.xml");
    expect(failed).toMatchObject({ statusCode: 404, kind: "unknown" });
    expect(failed?.error).toContain("404");
    expect(result.entries.some((e) => e.url === "https://example.com/b-one")).toBe(true);
  });

  it("terminates a self-referencing sitemapindex instead of looping forever", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch(
        withProbes404({
          "https://example.com/sitemap-self.xml": {
            status: 200,
            body: readFixture("sitemapindex-self-referencing.xml"),
          },
        })
      )
    );

    const result = await discoverSitemaps(
      makeRobots(["https://example.com/sitemap-self.xml"]),
      "https://example.com"
    );

    expect(result.files.filter((f) => f.url === "https://example.com/sitemap-self.xml")).toEqual([
      expect.objectContaining({ kind: "index", urlCount: 1 }),
    ]);
  });

  it("network error fetching a sitemap is recorded as evidence, not thrown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ETIMEDOUT");
      })
    );

    const result = await discoverSitemaps(
      makeRobots(["https://example.com/sitemap.xml"]),
      "https://example.com"
    );

    expect(result.files[0]).toMatchObject({
      url: "https://example.com/sitemap.xml",
      statusCode: null,
      kind: "unknown",
    });
    expect(result.files[0]?.error).toContain("ETIMEDOUT");
  });

  it("sends the honest crawler user agent on sitemap fetches, and the operator's override when given", async () => {
    const seen: Array<string | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push((init?.headers as Record<string, string> | undefined)?.["user-agent"]);
        return new Response(readFixture("urlset-plain.xml"), { status: 200 });
      })
    );

    await discoverSitemaps(makeRobots(["https://example.com/sitemap.xml"]), "https://example.com");
    await discoverSitemaps(makeRobots(["https://example.com/sitemap.xml"]), "https://example.com", {
      userAgent: "operator-choice/1.0",
    });

    expect(seen).toEqual([DEFAULT_USER_AGENT, "operator-choice/1.0"]);
  });
});

describe("gzipped sitemaps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decompresses a .xml.gz sitemap and parses its URLs", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://example.com/sitemap.xml.gz": {
          status: 200,
          body: gzipSync(Buffer.from(readFixture("urlset-plain.xml"), "utf-8")),
          contentType: "application/gzip",
        },
      })
    );

    const result = await discoverSitemaps(
      makeRobots(["https://example.com/sitemap.xml.gz"]),
      "https://example.com"
    );

    expect(result.entries.map((e) => e.url)).toEqual([
      "https://example.com/",
      "https://example.com/about",
      "https://example.com/products",
    ]);
    expect(result.files[0]).toMatchObject({ kind: "urlset", urlCount: 3, gzipped: true, error: null });
    expect(result.errors).toEqual([]);
  });

  it("decompresses by magic bytes even when the URL has no .gz suffix", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://example.com/sitemap.xml": {
          status: 200,
          body: gzipSync(Buffer.from(readFixture("urlset-plain.xml"), "utf-8")),
          contentType: "application/xml",
        },
      })
    );

    const result = await discoverSitemaps(makeRobots([]), "https://example.com");

    expect(result.entries).toHaveLength(3);
    expect(result.files[0]?.gzipped).toBe(true);
  });

  it("parses a .gz URL that the server already decoded (Content-Encoding was applied)", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://example.com/sitemap.xml.gz": { status: 200, body: readFixture("urlset-plain.xml") },
      })
    );

    const result = await discoverSitemaps(
      makeRobots(["https://example.com/sitemap.xml.gz"]),
      "https://example.com"
    );

    expect(result.entries).toHaveLength(3);
    expect(result.files[0]?.gzipped).toBe(false);
  });

  it("records a corrupt gzip body as an error instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch(
        withProbes404({
          "https://example.com/sitemap.xml.gz": {
            status: 200,
            body: new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff]),
          },
        })
      )
    );

    const result = await discoverSitemaps(
      makeRobots(["https://example.com/sitemap.xml.gz"]),
      "https://example.com"
    );

    expect(result.entries).toEqual([]);
    expect(result.files[0]).toMatchObject({ kind: "unknown", gzipped: true });
    expect(result.files[0]?.error).toContain("gzip decompression failed");
  });

  it("decompresses a gzipped sitemapindex and recurses into its children", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://example.com/sitemap-index.xml.gz": {
          status: 200,
          body: gzipSync(Buffer.from(readFixture("sitemapindex-two-children.xml"), "utf-8")),
        },
        "https://example.com/sitemap-child-a.xml": { status: 200, body: readFixture("sitemap-child-a.xml") },
        "https://example.com/sitemap-child-b.xml": { status: 200, body: readFixture("sitemap-child-b.xml") },
      })
    );

    const result = await discoverSitemaps(
      makeRobots(["https://example.com/sitemap-index.xml.gz"]),
      "https://example.com"
    );

    expect(result.entries).toHaveLength(3);
    expect(result.files.find((f) => f.kind === "index")?.gzipped).toBe(true);
  });
});

describe("sitemap metadata (lastmod / changefreq / priority)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures lastmod, changefreq and priority, and omits them where absent", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({ "https://example.com/sitemap.xml": { status: 200, body: readFixture("urlset-metadata.xml") } })
    );

    const result = await discoverSitemaps(makeRobots(["https://example.com/sitemap.xml"]), "https://example.com");

    expect(result.entries[0]).toEqual({
      url: "https://example.com/",
      sourceSitemap: "https://example.com/sitemap.xml",
      lastmod: "2026-01-15",
      changefreq: "daily",
      priority: 1,
    });
    expect(result.entries[1]).toMatchObject({
      lastmod: "2025-11-02T09:30:00+00:00",
      changefreq: "monthly",
      priority: 0.5,
    });
    // A URL without metadata carries no empty keys into the stored JSON.
    expect(result.entries[2]).toEqual({
      url: "https://example.com/no-meta",
      sourceSitemap: "https://example.com/sitemap.xml",
    });
  });

  it("keeps a numeric-looking <loc> as a string instead of dropping it", async () => {
    const body =
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      "<url><loc>https://example.com/2024</loc><lastmod>2026</lastmod></url></urlset>";
    vi.stubGlobal("fetch", routeFetch({ "https://example.com/sitemap.xml": { status: 200, body } }));

    const result = await discoverSitemaps(makeRobots(["https://example.com/sitemap.xml"]), "https://example.com");

    expect(result.entries).toEqual([
      { url: "https://example.com/2024", sourceSitemap: "https://example.com/sitemap.xml", lastmod: "2026" },
    ]);
  });
});

function urlsetWithLastmods(lastmods: Array<string | null>): string {
  const urls = lastmods
    .map((lm, i) => `<url><loc>https://example.com/p${i}</loc>${lm === null ? "" : `<lastmod>${lm}</lastmod>`}</url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

async function trustFor(lastmods: Array<string | null>, now: Date) {
  vi.stubGlobal(
    "fetch",
    routeFetch({ "https://example.com/sitemap.xml": { status: 200, body: urlsetWithLastmods(lastmods) } })
  );
  const result = await discoverSitemaps(makeRobots(["https://example.com/sitemap.xml"]), "https://example.com", {
    now,
  });
  return result.lastmodTrust;
}

describe("lastmod trust assessment", () => {
  const NOW = new Date("2026-08-13T12:00:00Z");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports 'absent' when no URL carries a lastmod", async () => {
    const trust = await trustFor([null, null], NOW);
    expect(trust).toMatchObject({ totalUrls: 2, withLastmod: 0, verdict: "absent", newest: null, oldest: null });
  });

  it("reports 'trustworthy' for spread-out, valid, past dates on every URL", async () => {
    const trust = await trustFor(["2026-01-02", "2025-06-30", "2024-12-01"], NOW);
    expect(trust).toMatchObject({
      withLastmod: 3,
      invalid: 0,
      distinctValues: 3,
      future: 0,
      withinLastHour: 0,
      allIdentical: false,
      newest: "2026-01-02",
      oldest: "2024-12-01",
      verdict: "trustworthy",
    });
  });

  it("reports 'partial' when only some URLs carry a lastmod", async () => {
    const trust = await trustFor(["2026-01-02", null, "2025-06-30"], NOW);
    expect(trust).toMatchObject({ totalUrls: 3, withLastmod: 2, verdict: "partial" });
  });

  it("flags a generator that stamps the same value on every URL", async () => {
    const trust = await trustFor(["2026-03-01", "2026-03-01", "2026-03-01"], NOW);
    expect(trust).toMatchObject({ distinctValues: 1, allIdentical: true, verdict: "suspect-uniform" });
  });

  it("flags a generator that stamps 'now' on every URL", async () => {
    const trust = await trustFor(
      ["2026-08-13T11:59:00Z", "2026-08-13T11:30:00Z", "2026-08-13T12:00:00Z"],
      NOW
    );
    expect(trust).toMatchObject({ withinLastHour: 3, future: 0, verdict: "suspect-stamped-now" });
  });

  it("flags future-dated lastmods beyond the 24h clock-skew allowance", async () => {
    const trust = await trustFor(["2026-08-13T13:00:00Z", "2027-01-01", "2025-01-01"], NOW);
    // +1h stays inside the skew allowance; only 2027 counts as future.
    expect(trust).toMatchObject({ future: 1, verdict: "suspect-future" });
  });

  it("flags lastmod values that are not W3C Datetime", async () => {
    const trust = await trustFor(["15/01/2026", "Mon, 15 Jan 2026 00:00:00 GMT", "2026-01-15"], NOW);
    expect(trust).toMatchObject({ withLastmod: 3, invalid: 2, verdict: "suspect-invalid" });
  });
});

describe("sitemap extensions (image / video / news)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts image:, video: and news: entries and counts them per file", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({ "https://example.com/sitemap.xml": { status: 200, body: readFixture("urlset-extensions.xml") } })
    );

    const result = await discoverSitemaps(makeRobots(["https://example.com/sitemap.xml"]), "https://example.com");

    expect(result.entries[0]?.images).toEqual([
      { loc: "https://cdn.example.com/a.jpg", title: "Alpha", caption: "First shot" },
      { loc: "https://cdn.example.com/b.jpg" },
    ]);
    expect(result.entries[1]?.videos).toEqual([
      {
        thumbnailLoc: "https://cdn.example.com/thumb.jpg",
        title: "Trail film",
        description: "A short film.",
        contentLoc: "https://cdn.example.com/film.mp4",
        // player_loc carries an allow_embed attribute; the element text is what we want.
        playerLoc: "https://example.com/player?id=1",
        duration: 620,
      },
    ]);
    expect(result.entries[2]?.news).toEqual({
      publicationName: "Example Times",
      publicationLanguage: "en",
      publicationDate: "2026-02-01",
      title: "Trail reopens",
    });
    expect(result.files[0]).toMatchObject({ urlCount: 3, imageCount: 2, videoCount: 1, newsCount: 1 });
  });

  it("leaves extension fields undefined on a plain urlset", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({ "https://example.com/sitemap.xml": { status: 200, body: readFixture("urlset-plain.xml") } })
    );

    const result = await discoverSitemaps(makeRobots(["https://example.com/sitemap.xml"]), "https://example.com");

    expect(result.entries[0]?.images).toBeUndefined();
    expect(result.entries[0]?.videos).toBeUndefined();
    expect(result.entries[0]?.news).toBeUndefined();
  });
});

describe("fallback ladder when robots declares nothing (Sagar: no-robots/no-sitemap sites)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("probes conventional locations and finds a Yoast-style /sitemap_index.xml after /sitemap.xml 404s", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://example.com/sitemap.xml": { status: 404, body: "not found" },
        "https://example.com/sitemap_index.xml": { status: 200, body: readFixture("urlset-plain.xml") },
      })
    );

    const result = await discoverSitemaps(makeRobots([]), "https://example.com");

    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]?.sourceSitemap).toBe("https://example.com/sitemap_index.xml");
    // the failed probe stays recorded as evidence
    expect(result.files.find((f) => f.url === "https://example.com/sitemap.xml")?.statusCode).toBe(404);
  });

  it("stops probing after the first hit — later fallback paths are never fetched", async () => {
    const fetchMock = routeFetch({
      "https://example.com/sitemap.xml": { status: 200, body: readFixture("urlset-plain.xml") },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverSitemaps(makeRobots([]), "https://example.com");

    expect(result.entries).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tries all four conventional paths in order, then the feed paths, before giving up", async () => {
    const fetchMock = routeFetch(withProbes404({}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverSitemaps(makeRobots([]), "https://example.com", { feedFallback: false });

    expect(result.entries).toHaveLength(0);
    expect(result.files.map((f) => f.url)).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/sitemap_index.xml",
      "https://example.com/wp-sitemap.xml",
      "https://example.com/sitemap-index.xml",
    ]);
    expect(result.files.every((f) => f.statusCode === 404)).toBe(true);
  });

  it("falls through to the conventional ladder when a robots-declared sitemap yields nothing", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://declared.example/sitemap.xml": { status: 404, body: "" },
        "https://example.com/sitemap.xml": { status: 200, body: readFixture("urlset-plain.xml") },
      })
    );

    const result = await discoverSitemaps(
      makeRobots(["https://declared.example/sitemap.xml"]),
      "https://example.com"
    );

    expect(result.entries).toHaveLength(3);
    expect(result.files[0]).toMatchObject({ url: "https://declared.example/sitemap.xml", crossHost: true });
  });
});

describe("cross-host sitemaps (the seeded target-site defect)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a 200 sitemap whose URLs all point at another host, and counts them as cross-host", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://example.com/sitemap.xml": { status: 200, body: readFixture("urlset-cross-host.xml") },
      })
    );

    const result = await discoverSitemaps(makeRobots([]), "https://example.com");

    // The sitemap is NOT "missing" — it exists, returns 200, and describes a different site.
    expect(result.entries).toHaveLength(2);
    expect(result.crossHostEntryCount).toBe(2);
    expect(result.files[0]).toMatchObject({
      statusCode: 200,
      kind: "urlset",
      urlCount: 2,
      crossHost: false,
      crossHostUrlCount: 2,
    });
  });

  it("treats a declared alias host as same-site when originHosts includes it", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://example.com/sitemap.xml": { status: 200, body: readFixture("urlset-cross-host.xml") },
      })
    );

    const result = await discoverSitemaps(makeRobots([]), "https://example.com", {
      originHosts: ["example.com", "other-host.example"],
    });

    expect(result.crossHostEntryCount).toBe(0);
    expect(result.files[0]?.crossHostUrlCount).toBe(0);
  });
});

describe("feed discovery (RSS / Atom / JSON Feed)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("discovers URLs from an RSS feed when no sitemap exists anywhere", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch(
        withProbes404({ "https://example.com/feed": { status: 200, body: readFixture("feed-rss.xml") } })
      )
    );

    const result = await discoverSitemaps(makeRobots([]), "https://example.com");

    expect(result.entries).toEqual([
      { url: "https://example.com/blog/one", sourceSitemap: "https://example.com/feed", sourceKind: "feed" },
      { url: "https://example.com/blog/two", sourceSitemap: "https://example.com/feed", sourceKind: "feed" },
    ]);
    expect(result.files.at(-1)).toMatchObject({ url: "https://example.com/feed", kind: "rss", urlCount: 2 });
  });

  it("discovers URLs from an Atom feed via <link href>, preferring rel=alternate", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch(
        withProbes404({ "https://example.com/atom.xml": { status: 200, body: readFixture("feed-atom.xml") } })
      )
    );

    const result = await discoverSitemaps(makeRobots([]), "https://example.com");

    expect(result.entries.map((e) => e.url)).toEqual([
      "https://example.com/blog/one",
      "https://example.com/blog/two",
    ]);
    expect(result.files.at(-1)).toMatchObject({ kind: "atom", urlCount: 2 });
  });

  it("discovers URLs from a JSON Feed", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch(
        withProbes404({
          "https://example.com/feed.json": {
            status: 200,
            body: readFixture("feed-jsonfeed.json"),
            contentType: "application/json",
          },
        })
      )
    );

    const result = await discoverSitemaps(makeRobots([]), "https://example.com");

    expect(result.entries.map((e) => e.url)).toEqual([
      "https://example.com/blog/one",
      "https://example.com/blog/two",
    ]);
    expect(result.files.at(-1)).toMatchObject({ kind: "jsonfeed", urlCount: 2 });
  });

  it("never probes feeds when a sitemap already produced URLs", async () => {
    const fetchMock = routeFetch({
      "https://example.com/sitemap.xml": { status: 200, body: readFixture("urlset-plain.xml") },
    });
    vi.stubGlobal("fetch", fetchMock);

    await discoverSitemaps(makeRobots([]), "https://example.com");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records a non-feed 200 body as evidence rather than inventing URLs", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch(
        withProbes404({ "https://example.com/feed": { status: 200, body: "<html><body>not a feed</body></html>" } })
      )
    );

    const result = await discoverSitemaps(makeRobots([]), "https://example.com");

    expect(result.entries).toEqual([]);
    expect(result.files.find((f) => f.url === "https://example.com/feed")?.error).toContain("not a recognised");
  });
});
