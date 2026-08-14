import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyCrawlDelay, fetchRobots } from "../../../src/discovery/robots";

function readFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/xml/${name}`, import.meta.url)), "utf-8");
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

const USER_AGENT = "seo-crawler-poc-test";

type FileStub = { status: number; body: string } | "network-error";

/**
 * fetchRobots now fetches two files (robots.txt, then llms.txt) — this routes each mocked call by
 * which path it hit instead of returning one canned response for both, which would otherwise make
 * every robots.txt fixture body also masquerade as the llms.txt response.
 */
function stubSiteFetch(opts: { robots: FileStub; llms?: FileStub }): void {
  const llms = opts.llms ?? { status: 404, body: "not found" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const stub = url.endsWith("/llms.txt") ? llms : opts.robots;
      if (stub === "network-error") throw new Error("ECONNREFUSED");
      return textResponse(stub.status, stub.body);
    })
  );
}

describe("fetchRobots", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a 200 robots.txt: raw content, absolute + relative sitemap declarations resolved", async () => {
    const body = readFixture("robots-with-sitemap-declarations.txt");
    stubSiteFetch({ robots: { status: 200, body } });

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
    stubSiteFetch({ robots: { status: 200, body: "   \n  " } });

    const robots = await fetchRobots("https://example.com", USER_AGENT);

    expect(robots.parseStatus).toBe("empty");
    expect(robots.isAllowed("https://example.com/anything")).toBe(true);
  });

  it("404 robots.txt -> allow-all, parseStatus 'unavailable', statusCode recorded", async () => {
    stubSiteFetch({ robots: { status: 404, body: "not found" } });

    const robots = await fetchRobots("https://example.com", USER_AGENT);

    expect(robots.statusCode).toBe(404);
    expect(robots.parseStatus).toBe("unavailable");
    expect(robots.content).toBeNull();
    expect(robots.sitemaps).toEqual([]);
    expect(robots.isAllowed("https://example.com/private/secret")).toBe(true);
  });

  it("network error -> allow-all, parseStatus 'error', statusCode null", async () => {
    stubSiteFetch({ robots: "network-error" });

    const robots = await fetchRobots("https://example.com", USER_AGENT);

    expect(robots.statusCode).toBeNull();
    expect(robots.parseStatus).toBe("error");
    expect(robots.content).toBeNull();
    expect(robots.isAllowed("https://example.com/anything")).toBe(true);
  });

  it("disallow rules actually block matching URLs (mirrors target-site robots.txt shape)", async () => {
    const body = readFixture("robots-target-site-shape.txt");
    stubSiteFetch({ robots: { status: 200, body } });

    const robots = await fetchRobots("http://localhost:3105", USER_AGENT);

    expect(robots.isAllowed("http://localhost:3105/guides/thru-hiking-gear-guide")).toBe(false);
    expect(robots.isAllowed("http://localhost:3105/guides/")).toBe(false);
    expect(robots.isAllowed("http://localhost:3105/about")).toBe(true);
    expect(robots.sitemaps).toEqual(["https://summittrailgear.example/sitemap.xml"]);
  });

  it("isAllowed defaults its userAgent argument to the userAgent fetchRobots was called with", async () => {
    const body = "User-agent: seo-crawler-poc-test\nDisallow: /only-blocked-for-us/\n";
    stubSiteFetch({ robots: { status: 200, body } });

    const robots = await fetchRobots("https://example.com", USER_AGENT);

    expect(robots.isAllowed("https://example.com/only-blocked-for-us/page")).toBe(false);
    expect(robots.isAllowed("https://example.com/only-blocked-for-us/page", "some-other-bot")).toBe(true);
  });
});

describe("fetchRobots — aiCrawlers table", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("populates all 13 named agents on a normal 200 robots.txt", async () => {
    const body = readFixture("robots-target-site-shape.txt");
    stubSiteFetch({ robots: { status: 200, body } });

    const robots = await fetchRobots("http://localhost:3105", USER_AGENT);

    expect(robots.aiCrawlers).toHaveLength(13);
    // Mirrors the seeded site's real shape: User-agent: * / Disallow: /guides/.
    const gptbot = robots.aiCrawlers!.find((r) => r.agent === "GPTBot")!;
    expect(gptbot.access).toBe("partly blocked");
    expect(gptbot.matchedGroup).toBe("*");
    // Fixture's first line is a `#` comment, so User-agent is line 2 and Disallow is line 3.
    expect(gptbot.matchedRules).toEqual([{ directive: "Disallow", value: "/guides/", line: 3 }]);

    const chatgptUser = robots.aiCrawlers!.find((r) => r.agent === "ChatGPT-User")!;
    expect(chatgptUser.access).toBe("ignores robots.txt");
  });

  it("still populates the table (allow-all) when robots.txt is a 404", async () => {
    stubSiteFetch({ robots: { status: 404, body: "not found" } });
    const robots = await fetchRobots("https://example.com", USER_AGENT);
    expect(robots.aiCrawlers).toHaveLength(13);
    expect(robots.aiCrawlers!.every((r) => r.agent === "ChatGPT-User" || r.agent === "Google-Agent" || r.agent === "Google-NotebookLM" ? r.access === "ignores robots.txt" : r.access === "allowed")).toBe(true);
  });

  it("still populates the table (allow-all) on a network error", async () => {
    stubSiteFetch({ robots: "network-error" });
    const robots = await fetchRobots("https://example.com", USER_AGENT);
    expect(robots.aiCrawlers).toHaveLength(13);
    expect(robots.aiCrawlers!.find((r) => r.agent === "GPTBot")!.access).toBe("allowed");
  });
});

describe("fetchRobots — llms.txt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports present:false on a 404, with zero score weight implied by having no score field at all", async () => {
    stubSiteFetch({ robots: { status: 200, body: "User-agent: *\nDisallow:\n" }, llms: { status: 404, body: "not found" } });
    const robots = await fetchRobots("https://example.com", USER_AGENT);
    expect(robots.llmsTxt).toMatchObject({ present: false, url: "https://example.com/llms.txt", statusCode: 404 });
    expect(robots.llmsTxt!.content).toBeNull();
    expect(robots.llmsTxt).not.toHaveProperty("score");
  });

  it("reports present:true for real plain-text content", async () => {
    const body = "# llms.txt\n\n> A demo site.\n\n## Docs\n- [Guide](/guides/one): a guide\n";
    stubSiteFetch({ robots: { status: 200, body: "User-agent: *\nDisallow:\n" }, llms: { status: 200, body } });
    const robots = await fetchRobots("https://example.com", USER_AGENT);
    expect(robots.llmsTxt!.present).toBe(true);
    expect(robots.llmsTxt!.statusCode).toBe(200);
    expect(robots.llmsTxt!.bytes).toBe(Buffer.byteLength(body));
    expect(robots.llmsTxt!.content).toBe(body);
  });

  it("a 200 that is really an HTML error page does not count as present (and stores no content)", async () => {
    const html = "<!DOCTYPE html><html><body>404</body></html>";
    stubSiteFetch({ robots: { status: 200, body: "User-agent: *\nDisallow:\n" }, llms: { status: 200, body: html } });
    const robots = await fetchRobots("https://example.com", USER_AGENT);
    expect(robots.llmsTxt!.present).toBe(false);
    expect(robots.llmsTxt!.content).toBeNull();
  });

  it("fetches llms.txt even when robots.txt itself 404s or errors", async () => {
    const body = "# llms.txt present even with no robots.txt\n";
    stubSiteFetch({ robots: { status: 404, body: "not found" }, llms: { status: 200, body } });
    const robots1 = await fetchRobots("https://example.com", USER_AGENT);
    expect(robots1.llmsTxt!.present).toBe(true);

    stubSiteFetch({ robots: "network-error", llms: { status: 200, body } });
    const robots2 = await fetchRobots("https://example.com", USER_AGENT);
    expect(robots2.llmsTxt!.present).toBe(true);
  });
});

describe("Crawl-delay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the Crawl-delay for the group matching our user agent", async () => {
    stubSiteFetch({ robots: { status: 200, body: readFixture("robots-crawl-delay.txt") } });

    const robots = await fetchRobots("https://example.com", USER_AGENT);

    expect(robots.crawlDelay).toBe(2);
  });

  it("falls back to the wildcard group's Crawl-delay for an unnamed agent", async () => {
    stubSiteFetch({ robots: { status: 200, body: readFixture("robots-crawl-delay.txt") } });

    const robots = await fetchRobots("https://example.com", "some-other-bot");

    expect(robots.crawlDelay).toBe(5);
  });

  it("is null when robots.txt declares no Crawl-delay", async () => {
    stubSiteFetch({ robots: { status: 200, body: "User-agent: *\nDisallow: /private/\n" } });

    const robots = await fetchRobots("https://example.com", USER_AGENT);

    expect(robots.crawlDelay).toBeNull();
  });

  it("is null for a non-numeric or non-positive Crawl-delay", async () => {
    stubSiteFetch({ robots: { status: 200, body: "User-agent: *\nCrawl-delay: soon\n" } });
    expect((await fetchRobots("https://example.com", USER_AGENT)).crawlDelay).toBeNull();

    stubSiteFetch({ robots: { status: 200, body: "User-agent: *\nCrawl-delay: 0\n" } });
    expect((await fetchRobots("https://example.com", USER_AGENT)).crawlDelay).toBeNull();
  });

  it("is null when robots.txt is unavailable", async () => {
    stubSiteFetch({ robots: { status: 404, body: "not found" } });

    expect((await fetchRobots("https://example.com", USER_AGENT)).crawlDelay).toBeNull();
  });
});

describe("applyCrawlDelay", () => {
  it("converts seconds-between-requests into an rps ceiling", () => {
    expect(applyCrawlDelay(10, 2)).toBe(0.5);
    expect(applyCrawlDelay(10, 0.5)).toBe(2);
  });

  it("never speeds a crawl up — a slower requested rps wins", () => {
    expect(applyCrawlDelay(0.1, 2)).toBe(0.1);
  });

  it("leaves the requested rps alone when there is no usable Crawl-delay", () => {
    expect(applyCrawlDelay(10, null)).toBe(10);
    expect(applyCrawlDelay(10, undefined)).toBe(10);
    expect(applyCrawlDelay(10, 0)).toBe(10);
    expect(applyCrawlDelay(10, Number.NaN)).toBe(10);
  });
});
