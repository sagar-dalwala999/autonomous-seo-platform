import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCrawl } from "../../../src/crawler/crawl";
import { defaultSafety } from "../../../src/crawler/safety";
import { EventLog } from "../../../src/events/eventLog";
import type { CrawlActivityEvent } from "../../../src/events/types";
import type { CrawlOptions } from "../../../src/models/types";

function startExternalServer(): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function startFixtureServer(externalUrl: string): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/robots.txt") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("User-agent: *\nAllow: /\n");
      }
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<html><head><title>Home</title></head><body><h1>Home</h1>
          <a href="/a">a</a><a href="/b">b</a><a href="/missing">missing</a>
          <a href="${externalUrl}/">external</a>
          <img src="/logo.png" alt="logo"></body></html>`);
      }
      if (url.pathname === "/a" || url.pathname === "/b") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<html><head><title>${url.pathname}</title></head><body>page</body></html>`);
      }
      if (url.pathname === "/logo.png") {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(png);
      }
      // text/html (not text/plain) so Crawlee treats this as a normal page fetch — a
      // real requestHandler call with statusCode 404 — rather than tripping its own
      // content-type filter before the request ever reaches this crawler's code.
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html><body>not found</body></html>");
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

let external: Awaited<ReturnType<typeof startExternalServer>>;
let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
let outDir: string;

beforeAll(async () => {
  external = await startExternalServer();
  fixture = await startFixtureServer(external.baseUrl);
});

afterAll(async () => {
  await new Promise((resolve) => fixture.server.close(resolve));
  await new Promise((resolve) => external.server.close(resolve));
});

beforeEach(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), "eventstream-test-"));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

function baseOptions(startUrl: string, runId: string): CrawlOptions {
  return {
    startUrl,
    maxPages: 20,
    concurrency: 2,
    respectRobots: true,
    render: "never",
    outDir,
    runId,
    userAgent: "seo-crawler-poc-test/0.1",
    maxRequestsPerSecond: 20,
    hostAliases: [],
    maxDepth: null,
    auth: null,
    safety: defaultSafety(null),
    imageSizes: false,
    faviconProbe: false,
  };
}

describe("real crawl activity stream", () => {
  it("live-tails progressively DURING the crawl, then the same run replays identically from disk after it finishes", async () => {
    const runId = "stream-run-1";
    const eventLog = new EventLog(outDir, runId);
    await eventLog.init();

    const liveSeen: CrawlActivityEvent[] = [];
    const sampledCountsOverTime: number[] = [];
    eventLog.subscribe((e) => liveSeen.push(e));

    const poll = setInterval(() => sampledCountsOverTime.push(liveSeen.length), 15);
    const summary = await runCrawl(baseOptions(fixture.baseUrl, runId), true, { eventLog });
    clearInterval(poll);

    // Real "live" proof: events arrived in more than one batch while the crawl was running —
    // not all delivered in a single flush once the promise resolved.
    const distinctNonZeroSamples = new Set(sampledCountsOverTime.filter((n) => n > 0));
    expect(distinctNonZeroSamples.size).toBeGreaterThan(1);

    expect(summary.successful).toBeGreaterThanOrEqual(3); // /, /a, /b

    // Per-request events carry a real status code, including the 404.
    const requestEvents = liveSeen.filter((e) => e.kind === "request");
    expect(requestEvents.some((e) => e.url?.endsWith("/missing") && e.statusCode === 404)).toBe(true);
    expect(requestEvents.some((e) => e.statusCode === 200)).toBe(true);

    // The four named event kinds all actually fired on a real crawl (checkExternal=true above).
    const kinds = new Set(liveSeen.map((e) => e.kind));
    expect(kinds.has("certificate-check")).toBe(true); // http site — "no certificate to check" branch
    const linkCheckEvents = liveSeen.filter((e) => e.kind === "outbound-link-check");
    expect(linkCheckEvents.length).toBeGreaterThan(0);
    expect(linkCheckEvents.some((e) => e.url === `${external.baseUrl}/` && e.statusCode === 200)).toBe(true);
    expect(kinds.has("crawl-started")).toBe(true);
    expect(kinds.has("crawl-finished")).toBe(true);

    // Replay: a completely independent read of the same run's log off disk. Must match what the
    // live subscriber saw, in the same order — proving durability, not just in-memory delivery.
    const replayed: CrawlActivityEvent[] = [];
    for await (const event of EventLog.replay(outDir, runId)) replayed.push(event);
    expect(replayed).toEqual(liveSeen);
  }, 180_000);

  it("image-measuring events fire during the post-crawl asset-sizing pass", async () => {
    const runId = "stream-run-2";
    const eventLog = new EventLog(outDir, runId);
    await eventLog.init();
    const options = { ...baseOptions(fixture.baseUrl, runId), imageSizes: true };
    await runCrawl(options, false, { eventLog });
    await eventLog.flush();

    const replayed: CrawlActivityEvent[] = [];
    for await (const event of EventLog.replay(outDir, runId)) replayed.push(event);
    const imageEvents = replayed.filter((e) => e.kind === "image-measuring");
    expect(imageEvents.length).toBeGreaterThan(0);
    expect(imageEvents.some((e) => e.url?.endsWith("/logo.png"))).toBe(true);
  }, 180_000);
});
