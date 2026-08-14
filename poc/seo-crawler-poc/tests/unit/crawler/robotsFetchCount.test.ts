import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCrawl } from "../../../src/crawler/crawl";
import { fetchRobots } from "../../../src/discovery/robots";
import { defaultSafety } from "../../../src/crawler/safety";
import type { CrawlOptions } from "../../../src/models/types";

/**
 * Regression test for a real, verified defect: robots.txt was being fetched twice per crawl — once
 * by the CLI's Crawl-delay pre-probe (index.ts) and once again by runCrawl's own "always fetched
 * for evidence" line (crawl.ts). Counts real requests against a local fixture server on an
 * OS-assigned port (never a reserved dev port) — never mocked.
 */
let server: http.Server;
let baseUrl: string;
let robotsHits: number;

function startFixtureServer(onRobotsHit: () => void): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/robots.txt") {
        onRobotsHit();
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("User-agent: *\nAllow: /\n");
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head><title>Home</title></head><body><h1>Home</h1></body></html>");
    });
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

beforeAll(async () => {
  const started = await startFixtureServer(() => robotsHits++);
  server = started.server;
  baseUrl = started.baseUrl;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

let outDir: string;
beforeEach(async () => {
  robotsHits = 0;
  outDir = await mkdtemp(path.join(tmpdir(), "robots-fetch-count-test-"));
});
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

function baseOptions(runId: string): CrawlOptions {
  return {
    startUrl: `${baseUrl}/`,
    maxPages: 3,
    concurrency: 2,
    respectRobots: true,
    render: "never",
    outDir,
    runId,
    userAgent: "seo-crawler-poc-test/1.0",
    maxRequestsPerSecond: 20,
    hostAliases: [],
    maxDepth: 0,
    safety: defaultSafety(null),
    imageSizes: false,
    faviconProbe: false,
  };
}

describe("robots.txt fetch count", () => {
  it("fetches robots.txt exactly once when no pre-fetch is supplied (baseline)", async () => {
    await runCrawl(baseOptions("no-prefetch"), false, {});
    expect(robotsHits).toBe(1);
  });

  it("fetches robots.txt exactly once total when the CLI's pre-probe result is reused — not twice", async () => {
    // Mirrors index.ts's own Crawl-delay pre-probe: fetch once, up front, exactly like the CLI does.
    const preFetchedRobots = await fetchRobots(baseUrl, "seo-crawler-poc-test/1.0");
    expect(robotsHits).toBe(1); // the pre-probe itself is request #1

    await runCrawl(baseOptions("with-prefetch"), false, { preFetchedRobots });
    // If runCrawl fetched again, this would be 2. The fix makes it stay 1 for the WHOLE flow.
    expect(robotsHits).toBe(1);
  });

  it("falls back to a real fetch when the pre-fetched result is for a DIFFERENT origin (defensive guard)", async () => {
    let otherHits = 0;
    const otherServer = await startFixtureServer(() => otherHits++);
    try {
      const wrongOriginRobots = await fetchRobots(otherServer.baseUrl, "seo-crawler-poc-test/1.0");
      expect(otherHits).toBe(1); // that hit landed on otherServer, not the main fixture server
      expect(robotsHits).toBe(0); // main fixture server untouched so far

      await runCrawl(baseOptions("mismatched-prefetch"), false, { preFetchedRobots: wrongOriginRobots });
      // Must NOT silently trust the wrong-origin cache — a real fetch against the real origin happens.
      expect(robotsHits).toBe(1);
    } finally {
      await new Promise((resolve) => otherServer.server.close(resolve));
    }
  });
});
