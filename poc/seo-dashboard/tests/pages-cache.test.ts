import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// lib/data.ts resolves STORAGE_ROOT at module load, so the env must be set before the import.
const storage = mkdtempSync(path.join(tmpdir(), "seo-dash-cache-"));
process.env.CRAWLER_STORAGE_DIR = storage;

const runDir = (runId: string) => path.join(storage, "runs", runId);

function writeRun(runId: string, pageCount: number) {
  mkdirSync(path.join(runDir(runId), "pages"), { recursive: true });
  writeFileSync(path.join(runDir(runId), "report.json"), JSON.stringify({ runId, successful: pageCount }));
  for (let i = 0; i < pageCount; i++) writePage(runId, `p${i}`);
}

function writePage(runId: string, pageId: string) {
  writeFileSync(path.join(runDir(runId), "pages", `${pageId}.json`), JSON.stringify({ url: `https://x/${pageId}` }));
}

/** Bump report.json's mtime by a whole second so the change is visible at any fs timestamp resolution. */
function bumpReportMtime(runId: string) {
  const p = path.join(runDir(runId), "report.json");
  const next = new Date(statSync(p).mtimeMs + 1000);
  utimesSync(p, next, next);
}

let getPages: typeof import("../lib/data")["getPages"];

beforeAll(async () => {
  for (let i = 0; i < 12; i++) writeRun(`run${i}`, 3);
  ({ getPages } = await import("../lib/data"));
});

afterAll(() => rmSync(storage, { recursive: true, force: true }));

describe("getPages cache", () => {
  it("serves a warm run from cache when report.json has not changed", async () => {
    expect(await getPages("run0")).toHaveLength(3);
    writePage("run0", "sneaky");
    expect(await getPages("run0")).toHaveLength(3);
  });

  it("evicts the least-recently-used run once the bound is exceeded", async () => {
    for (let i = 1; i <= 10; i++) await getPages(`run${i}`);
    expect(await getPages("run0")).toHaveLength(4);
  });

  it("reloads a run whose report.json was rewritten, as a re-crawl reusing its runId does", async () => {
    expect(await getPages("run11")).toHaveLength(3);
    writePage("run11", "added-by-recrawl");
    bumpReportMtime("run11");
    expect(await getPages("run11")).toHaveLength(4);
  });
});
