import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverSitemaps } from "../../../src/discovery/sitemap";
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
      { url: "https://example.com/sitemap.xml", statusCode: 200, kind: "urlset", urlCount: 3, error: null },
    ]);
    expect(result.errors).toEqual([]);
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
    // Undeclared probing continues past a fruitless malformed file — remaining ladder paths 404.
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://example.com/sitemap.xml": { status: 200, body: readFixture("malformed.xml") },
        "https://example.com/sitemap_index.xml": { status: 404, body: "" },
        "https://example.com/wp-sitemap.xml": { status: 404, body: "" },
        "https://example.com/sitemap-index.xml": { status: 404, body: "" },
      })
    );

    const result = await discoverSitemaps(makeRobots([]), "https://example.com");

    expect(result.entries).toEqual([]);
    expect(result.files[0]).toEqual(
      expect.objectContaining({ url: "https://example.com/sitemap.xml", kind: "unknown", urlCount: 0 }),
    );
    expect(result.files[0]?.error).toContain("malformed XML");
    expect(result.errors.length).toBeGreaterThan(0);
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
      routeFetch({
        "https://example.com/sitemap-self.xml": {
          status: 200,
          body: readFixture("sitemapindex-self-referencing.xml"),
        },
      })
    );

    const result = await discoverSitemaps(
      makeRobots(["https://example.com/sitemap-self.xml"]),
      "https://example.com"
    );

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      url: "https://example.com/sitemap-self.xml",
      kind: "index",
      urlCount: 1,
    });
  });

  it("flags a .gz sitemap as unsupported without attempting to parse it", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://example.com/sitemap.xml.gz": { status: 200, body: new Uint8Array([0x1f, 0x8b, 0x08, 0x00]) },
      })
    );

    const result = await discoverSitemaps(
      makeRobots(["https://example.com/sitemap.xml.gz"]),
      "https://example.com"
    );

    expect(result.files[0]).toMatchObject({ kind: "unknown", error: "gzip not supported in POC" });
    expect(result.entries).toEqual([]);
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

  it("all fallback locations 404 → empty result with every attempt recorded, never a throw", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://example.com/sitemap.xml": { status: 404, body: "" },
        "https://example.com/sitemap_index.xml": { status: 404, body: "" },
        "https://example.com/wp-sitemap.xml": { status: 404, body: "" },
        "https://example.com/sitemap-index.xml": { status: 404, body: "" },
      })
    );

    const result = await discoverSitemaps(makeRobots([]), "https://example.com");

    expect(result.entries).toHaveLength(0);
    expect(result.files).toHaveLength(4);
    expect(result.files.every((f) => f.statusCode === 404)).toBe(true);
  });
});
