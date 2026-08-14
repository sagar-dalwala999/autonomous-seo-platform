import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureGraphReport } from "../../../src/graph/runGraph";
import { RunStore } from "../../../src/storage/runStore";
import { makeLink, makePage } from "./fixtures";
import type { GraphReport } from "../../../src/models/types";

describe("ensureGraphReport", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "ensure-graph-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("computes and persists graph.json in one call, from caller-supplied pages (no extra disk read)", async () => {
    const a = makePage({ url: "https://x.test/a", links: [makeLink("https://x.test/a", "https://x.test/b")] });
    const b = makePage({ url: "https://x.test/b" });

    const report = await ensureGraphReport(root, "run-1", [a, b]);
    expect(report.pages).toHaveLength(2);

    const store = new RunStore(root, "run-1");
    const onDisk = JSON.parse(await readFile(path.join(store.runDir, "graph.json"), "utf8")) as GraphReport;
    expect(onDisk.pages).toHaveLength(2);
    expect(onDisk.runId).toBe("run-1");
  });

  it("falls back to loading pages via RunStore when none are supplied", async () => {
    const store = new RunStore(root, "run-2");
    await store.init();
    await store.savePage(makePage({ url: "https://x.test/only" }));

    const report = await ensureGraphReport(root, "run-2");
    expect(report.pages).toHaveLength(1);
    expect(report.pages[0]!.url).toBe("https://x.test/only");
  });
});
