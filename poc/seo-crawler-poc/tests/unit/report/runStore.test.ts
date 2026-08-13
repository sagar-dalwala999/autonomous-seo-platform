import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStore } from "../../../src/storage/runStore";
import { makeFailure, makePage } from "./fixtures";

describe("RunStore", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), "seo-crawler-poc-runstore-"));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("pageIdFor is deterministic 12-hex", () => {
    const id1 = RunStore.pageIdFor("https://ex.com/a");
    const id2 = RunStore.pageIdFor("https://ex.com/a");
    const id3 = RunStore.pageIdFor("https://ex.com/b");
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id1).toMatch(/^[0-9a-f]{12}$/);
  });

  it("round-trips raw/pages/failures/blocked/report through the real filesystem", async () => {
    const store = new RunStore(outDir, "run-1");
    expect(store.runDir).toBe(path.resolve(outDir, "runs", "run-1"));

    await store.init();

    const pageA = makePage({ normalizedUrl: "https://ex.com/a" });
    const pageB = makePage({ normalizedUrl: "https://ex.com/b" });
    await store.saveRaw(pageA.normalizedUrl, "<html>a</html>");
    await store.savePage(pageA);
    await store.savePage(pageB);

    // Concurrent saveFailure calls must not interleave the read-modify-write.
    const failure1 = makeFailure({ url: "https://ex.com/f1", normalizedUrl: "https://ex.com/f1" });
    const failure2 = makeFailure({ url: "https://ex.com/f2", normalizedUrl: "https://ex.com/f2" });
    await Promise.all([store.saveFailure(failure1), store.saveFailure(failure2)]);

    await store.saveBlocked(["https://ex.com/blocked-1"]);
    await store.saveRobots({
      url: "https://ex.com/robots.txt",
      statusCode: 200,
      content: "User-agent: *\nAllow: /",
      sitemaps: [],
      parseStatus: "ok",
      fetchedAt: new Date().toISOString(),
    });
    await store.saveSitemaps({ entries: [], files: [], errors: [] });

    const loaded = await store.loadAllPages();
    expect(loaded.map((p) => p.normalizedUrl).sort()).toEqual(["https://ex.com/a", "https://ex.com/b"]);

    const failuresRaw = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(store.runDir, "failures.json"), "utf8"),
    );
    const failures = JSON.parse(failuresRaw) as unknown[];
    expect(failures).toHaveLength(2);

    const summary = { runId: "run-1" } as unknown as import("../../../src/models/types").CrawlSummary;
    await store.saveReport(summary);
    const reportRaw = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(store.runDir, "report.json"), "utf8"),
    );
    expect(JSON.parse(reportRaw)).toEqual(summary);
  });

  it("saveScreenshots writes thumb+full WebP named by pageId and returns forward-slashed relative paths", async () => {
    const store = new RunStore(outDir, "run-1");
    await store.init();

    const url = "https://ex.com/screenshots-me";
    const thumbBuf = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    const fullBuf = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x11, 0x11, 0x11, 0x11, 0x57, 0x45, 0x42, 0x50]);

    const paths = await store.saveScreenshots(url, thumbBuf, fullBuf);
    const id = RunStore.pageIdFor(url);

    expect(paths).toEqual({ thumb: `screenshots/${id}.thumb.webp`, full: `screenshots/${id}.full.webp` });
    expect(paths.thumb).not.toContain("\\");
    expect(paths.full).not.toContain("\\");

    const { readFile } = await import("node:fs/promises");
    await expect(readFile(path.join(store.runDir, "screenshots", `${id}.thumb.webp`))).resolves.toEqual(thumbBuf);
    await expect(readFile(path.join(store.runDir, "screenshots", `${id}.full.webp`))).resolves.toEqual(fullBuf);
  });
});
