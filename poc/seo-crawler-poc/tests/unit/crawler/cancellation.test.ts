import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCrawl, CrawlCancelledError } from "../../../src/crawler/crawl";
import { defaultSafety } from "../../../src/crawler/safety";
import { EventLog } from "../../../src/events/eventLog";
import type { CrawlOptions } from "../../../src/models/types";

/** A generously-linked site with a small artificial per-page delay — big enough that a crawl at
 * a low concurrency is still mid-flight when the test cancels it, so the proof is real: fetch
 * activity actually stops, not just that the test finished before the crawl would have anyway. */
const PAGE_COUNT = 60;
const PAGE_DELAY_MS = 120;

function startFixtureServer(): Promise<{ server: http.Server; baseUrl: string; requestLog: string[] }> {
  return new Promise((resolve) => {
    const requestLog: string[] = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      requestLog.push(url.pathname);

      if (url.pathname === "/robots.txt") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("User-agent: *\nAllow: /\n");
      }

      const match = /^\/page\/(\d+)$/.exec(url.pathname);
      const n = match ? Number(match[1]) : 0;
      setTimeout(() => {
        const next = n + 1 < PAGE_COUNT ? `<a href="/page/${n + 1}">next</a>` : "";
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><head><title>Page ${n}</title></head><body><h1>Page ${n}</h1>${next}</body></html>`);
      }, PAGE_DELAY_MS);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, requestLog });
    });
  });
}

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
let outDir: string;

beforeAll(async () => {
  fixture = await startFixtureServer();
});

afterAll(async () => {
  await new Promise((resolve) => fixture.server.close(resolve));
});

beforeEach(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), "cancel-test-"));
  fixture.requestLog.length = 0;
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

function optionsFor(startUrl: string, runId: string, concurrency = 2): CrawlOptions {
  return {
    startUrl,
    maxPages: PAGE_COUNT,
    concurrency,
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

describe("cancellation actually reaches outbound requests", () => {
  it("stops issuing new requests to the fixture server once cancelled — proven by the request log, not the UI", async () => {
    const controller = new AbortController();
    const eventLog = new EventLog(outDir, "cancel-run-1");
    await eventLog.init();

    const crawlPromise = runCrawl(
      optionsFor(`${fixture.baseUrl}/page/0`, "cancel-run-1"),
      false,
      { signal: controller.signal, eventLog },
    );

    // Let a handful of requests actually go out, then cancel mid-flight.
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS * 4));
    const countAtCancel = fixture.requestLog.length;
    expect(countAtCancel).toBeGreaterThan(0);
    expect(countAtCancel).toBeLessThan(PAGE_COUNT); // proves the crawl was genuinely still going

    controller.abort();

    await expect(crawlPromise).rejects.toBeInstanceOf(CrawlCancelledError);

    // Real proof: after cancellation resolves, the outbound request count must not keep growing
    // to completion. A brief in-flight tail (requests already dispatched) is allowed; reaching
    // PAGE_COUNT would mean the crawl ran to completion regardless of cancel() — the exact
    // reference defect (22 pages fetched after Stop).
    const countRightAfterCancel = fixture.requestLog.length;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS * 20));
    const countAfterSettling = fixture.requestLog.length;

    expect(countAfterSettling).toBeLessThan(PAGE_COUNT);
    // No meaningful growth once the in-flight tail has had time to land — outbound activity
    // actually ceased rather than merely being hidden from a listener.
    expect(countAfterSettling - countRightAfterCancel).toBeLessThanOrEqual(6);
  }, 30_000);

  it("never writes report.json for a cancelled run — a stopped crawl must not claim to have finished", async () => {
    const controller = new AbortController();
    const crawlPromise = runCrawl(optionsFor(`${fixture.baseUrl}/page/0`, "cancel-run-2"), false, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS * 3));
    controller.abort();
    await expect(crawlPromise).rejects.toBeInstanceOf(CrawlCancelledError);

    const { existsSync } = await import("node:fs");
    expect(existsSync(path.join(outDir, "runs", "cancel-run-2", "report.json"))).toBe(false);
  }, 30_000);

  it("cancelling before the crawl starts (already-aborted signal) does no fetching at all", async () => {
    const controller = new AbortController();
    controller.abort();
    fixture.requestLog.length = 0;

    await expect(
      runCrawl(optionsFor(`${fixture.baseUrl}/page/0`, "cancel-run-3"), false, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(CrawlCancelledError);

    // robots.txt is fetched as evidence regardless (cheap, no page fetch) — but no /page/* request.
    expect(fixture.requestLog.filter((p) => p.startsWith("/page/"))).toHaveLength(0);
  });
});
