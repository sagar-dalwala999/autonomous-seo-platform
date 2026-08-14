import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCrawl } from "../../../src/crawler/crawl";
import { defaultSafety } from "../../../src/crawler/safety";
import type { CrawlOptions } from "../../../src/models/types";

/**
 * Proves the two "written, unit-tested, never invoked" image mergers (mergeComputedBackgroundImages
 * / mergeNetworkObservedImages, extraction/images.ts) now actually run and produce data once wired
 * into crawl.ts's Playwright pass. The real seeded target site (localhost:3105) turned out to have
 * ZERO real CSS background-image usage anywhere in its own stylesheets (verified: only appears in
 * node_modules type declarations) — a genuine "nothing to find" result there, not a wiring bug. This
 * fixture deliberately puts the background-image in an EXTERNAL stylesheet (which the static regex
 * parser, extractBackgroundImages, cannot reach — it only scans [style] attrs + inline <style>
 * blocks) and behind a ::before pseudo-element, so a pass here is real proof the COMPUTED sweep is
 * doing something the static pass structurally cannot. Runs with render:"always" and NO
 * --screenshots (screenshots would trigger a real Supabase Storage write in this checkout — see
 * src/artifacts/supabaseUpload.ts's CAUTION comment — deliberately out of scope for this test).
 */
function startFixtureServer(): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><html><head><title>Hero</title>
          <link rel="stylesheet" href="/styles.css">
        </head><body>
          <div id="hero">Hero content</div>
          <script>
            // Non-DOM-node asset request: Playwright tags a fetch() request resourceType "fetch",
            // not "image" — so it is never blocked by the image/media route.abort() this repo uses
            // when --screenshots is off, and it is exactly the "no DOM node an extractor could
            // find" class mergeNetworkObservedImages exists for.
            fetch('/canvas-source.png').catch(() => {});
          </script>
        </body></html>`);
      }
      if (url.pathname === "/styles.css") {
        res.writeHead(200, { "content-type": "text/css" });
        // External stylesheet — extractBackgroundImages (the static regex parser) never fetches
        // this file, so the static pass reports zero backgroundImages for this page.
        return res.end(`
          #hero { background-image: url('/hero-bg.jpg'); }
          #hero::before { content: ''; background-image: url('/hero-before.jpg'); }
        `);
      }
      if (url.pathname === "/canvas-source.png") {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(png);
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    });
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

let server: http.Server;
let baseUrl: string;
let outDir: string;

beforeAll(async () => {
  const started = await startFixtureServer();
  server = started.server;
  baseUrl = started.baseUrl;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), "image-mergers-test-"));
});
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

function options(runId: string): CrawlOptions {
  return {
    startUrl: `${baseUrl}/`,
    maxPages: 1,
    concurrency: 1,
    respectRobots: false,
    render: "always",
    screenshots: false,
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

describe("computed-background sweep + network-observed images (real wiring, real browser)", () => {
  it("the static parser alone finds zero backgroundImages for this fixture (sets up the real gap)", async () => {
    const staticOnly: CrawlOptions = { ...options("static-baseline"), render: "never" };
    await runCrawl(staticOnly, false, {});
    const pagesDir = path.join(outDir, "runs", "static-baseline", "pages");
    const { readdir } = await import("node:fs/promises");
    const [file] = await readdir(pagesDir);
    const page = JSON.parse(await readFile(path.join(pagesDir, file!), "utf-8"));
    expect(page.backgroundImages ?? []).toEqual([]);
  });

  it("the computed-style sweep finds the external-stylesheet + ::before background the static pass cannot", async () => {
    await runCrawl(options("computed-sweep"), false, {});
    const pagesDir = path.join(outDir, "runs", "computed-sweep", "pages");
    const { readdir } = await import("node:fs/promises");
    const [file] = await readdir(pagesDir);
    const page = JSON.parse(await readFile(path.join(pagesDir, file!), "utf-8"));

    const computedHits = (page.backgroundImages ?? []).filter((b: any) => b.source === "computed-style");
    expect(computedHits.length).toBeGreaterThanOrEqual(2); // #hero + #hero::before

    const direct = computedHits.find((b: any) => b.pseudoElement === null || b.pseudoElement === undefined);
    const before = computedHits.find((b: any) => b.pseudoElement === "::before");
    expect(direct?.url).toContain("hero-bg.jpg");
    expect(before?.url).toContain("hero-before.jpg");
    expect(before?.cssProperty).toBe("background-image");

    // imageSummary was recomputed to include the merged records, not just the static-parse count.
    expect(page.imageSummary?.backgroundCount).toBe((page.backgroundImages ?? []).length);
  });

  it("the network-observed merger catches the fetch()-loaded asset no DOM node references", async () => {
    await runCrawl(options("network-observed"), false, {});
    const pagesDir = path.join(outDir, "runs", "network-observed", "pages");
    const { readdir } = await import("node:fs/promises");
    const [file] = await readdir(pagesDir);
    const page = JSON.parse(await readFile(path.join(pagesDir, file!), "utf-8"));

    const networkHits = (page.backgroundImages ?? []).filter((b: any) => b.source === "network-response");
    expect(networkHits.length).toBeGreaterThanOrEqual(1);
    const hit = networkHits.find((b: any) => b.url.includes("canvas-source.png"));
    expect(hit).toBeDefined();
    expect(hit.kind).toBe("network");
    expect(hit.networkContentType).toBe("image/png");
  });
});
