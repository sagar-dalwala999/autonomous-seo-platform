import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRobots } from "../../../src/discovery/robots";

function readFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/xml/${name}`, import.meta.url)), "utf-8");
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

const USER_AGENT = "seo-crawler-poc-test";

describe("fetchRobots", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a 200 robots.txt: raw content, absolute + relative sitemap declarations resolved", async () => {
    const body = readFixture("robots-with-sitemap-declarations.txt");
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(200, body)));

    const robots = await fetchRobots("https://example.com", USER_AGENT);

    expect(robots.url).toBe("https://example.com/robots.txt");
    expect(robots.statusCode).toBe(200);
    expect(robots.content).toBe(body);
    expect(robots.parseStatus).toBe("ok");
    expect(robots.sitemaps).toEqual([
      "https://example.com/sitemap-absolute.xml",
      "https://example.com/sitemap-relative.xml",
    ]);
    expect(typeof robots.fetchedAt).toBe("string");
    expect(new Date(robots.fetchedAt).toString()).not.toBe("Invalid Date");
  });

  it("treats a blank 200 body as parseStatus 'empty'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(200, "   \n  ")));

    const robots = await fetchRobots("https://example.com", USER_AGENT);

    expect(robots.parseStatus).toBe("empty");
    expect(robots.isAllowed("https://example.com/anything")).toBe(true);
  });

  it("404 robots.txt -> allow-all, parseStatus 'unavailable', statusCode recorded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(404, "not found")));

    const robots = await fetchRobots("https://example.com", USER_AGENT);

    expect(robots.statusCode).toBe(404);
    expect(robots.parseStatus).toBe("unavailable");
    expect(robots.content).toBeNull();
    expect(robots.sitemaps).toEqual([]);
    expect(robots.isAllowed("https://example.com/private/secret")).toBe(true);
  });

  it("network error -> allow-all, parseStatus 'error', statusCode null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );

    const robots = await fetchRobots("https://example.com", USER_AGENT);

    expect(robots.statusCode).toBeNull();
    expect(robots.parseStatus).toBe("error");
    expect(robots.content).toBeNull();
    expect(robots.isAllowed("https://example.com/anything")).toBe(true);
  });

  it("disallow rules actually block matching URLs (mirrors target-site robots.txt shape)", async () => {
    const body = readFixture("robots-target-site-shape.txt");
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(200, body)));

    const robots = await fetchRobots("http://localhost:3105", USER_AGENT);

    expect(robots.isAllowed("http://localhost:3105/guides/thru-hiking-gear-guide")).toBe(false);
    expect(robots.isAllowed("http://localhost:3105/guides/")).toBe(false);
    expect(robots.isAllowed("http://localhost:3105/about")).toBe(true);
    expect(robots.sitemaps).toEqual(["https://summittrailgear.example/sitemap.xml"]);
  });

  it("isAllowed defaults its userAgent argument to the userAgent fetchRobots was called with", async () => {
    const body = "User-agent: seo-crawler-poc-test\nDisallow: /only-blocked-for-us/\n";
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(200, body)));

    const robots = await fetchRobots("https://example.com", USER_AGENT);

    expect(robots.isAllowed("https://example.com/only-blocked-for-us/page")).toBe(false);
    expect(robots.isAllowed("https://example.com/only-blocked-for-us/page", "some-other-bot")).toBe(true);
  });
});
