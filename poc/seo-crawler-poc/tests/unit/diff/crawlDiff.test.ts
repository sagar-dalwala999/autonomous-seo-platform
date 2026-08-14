import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffRuns } from "../../../src/diff/crawlDiff";
import { makeIssue, makePage, makeReport, writeRun } from "./fixtures";

describe("diffRuns", () => {
  let root: string;
  let baseDir: string;
  let headDir: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "c4-diff-"));
    baseDir = path.join(root, "base");
    headDir = path.join(root, "head");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("throws a clear error when a run directory doesn't exist", async () => {
    await writeRun(baseDir, "base", [makePage()]);
    await expect(diffRuns(baseDir, path.join(root, "missing"))).rejects.toThrow(/run directory not found/);
  });

  it("detects added and removed pages by pathname", async () => {
    await writeRun(baseDir, "base", [
      makePage({ url: "https://ex.com/a", normalizedUrl: "https://ex.com/a" }),
      makePage({ url: "https://ex.com/gone", normalizedUrl: "https://ex.com/gone" }),
    ]);
    await writeRun(headDir, "head", [
      makePage({ url: "https://ex.com/a", normalizedUrl: "https://ex.com/a" }),
      makePage({ url: "https://ex.com/new", normalizedUrl: "https://ex.com/new" }),
    ]);

    const diff = await diffRuns(baseDir, headDir);
    expect(diff.added).toEqual(["https://ex.com/new"]);
    expect(diff.removed).toEqual(["https://ex.com/gone"]);
    expect(diff.unchangedCount).toBe(1);
    expect(diff.changed).toEqual([]);
  });

  it("detects a title change and a contentHash change as separate field changes", async () => {
    await writeRun(baseDir, "base", [
      makePage({
        url: "https://ex.com/a",
        normalizedUrl: "https://ex.com/a",
        title: "Old Title",
        content: { text: "x", wordCount: 1, contentHash: "hash-1" },
      }),
    ]);
    await writeRun(headDir, "head", [
      makePage({
        url: "https://ex.com/a",
        normalizedUrl: "https://ex.com/a",
        title: "New Title",
        content: { text: "y", wordCount: 1, contentHash: "hash-2" },
      }),
    ]);

    const diff = await diffRuns(baseDir, headDir);
    expect(diff.changed).toHaveLength(1);
    const change = diff.changed[0]!;
    expect(change.url).toBe("https://ex.com/a");
    const fields = change.changes.map((c) => c.field);
    expect(fields).toContain("title");
    expect(fields).toContain("content.contentHash");
    const titleChange = change.changes.find((c) => c.field === "title")!;
    expect(titleChange.before).toBe("Old Title");
    expect(titleChange.after).toBe("New Title");
  });

  it("counts a page with zero field changes as unchanged, not changed", async () => {
    const page = makePage({ url: "https://ex.com/a", normalizedUrl: "https://ex.com/a" });
    await writeRun(baseDir, "base", [page]);
    await writeRun(headDir, "head", [{ ...page }]);

    const diff = await diffRuns(baseDir, headDir);
    expect(diff.changed).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it("computes issue lifecycle: new, fixed, persisting", async () => {
    await writeRun(
      baseDir,
      "base",
      [makePage({ url: "https://ex.com/a", normalizedUrl: "https://ex.com/a" })],
      makeReport([
        makeIssue({ ruleId: "missing-title", url: "https://ex.com/a" }),
        makeIssue({ ruleId: "thin-content", url: "https://ex.com/a" }),
      ]),
    );
    await writeRun(
      headDir,
      "head",
      [makePage({ url: "https://ex.com/a", normalizedUrl: "https://ex.com/a" })],
      makeReport([
        makeIssue({ ruleId: "missing-title", url: "https://ex.com/a" }),
        makeIssue({ ruleId: "noindex", url: "https://ex.com/a" }),
      ]),
    );

    const diff = await diffRuns(baseDir, headDir);
    expect(diff.issues).not.toBeNull();
    expect(diff.issues!.newIssues).toEqual(["noindex::https://ex.com/a"]);
    expect(diff.issues!.fixedIssues).toEqual(["thin-content::https://ex.com/a"]);
    expect(diff.issues!.persistingCount).toBe(1);
  });

  it("returns issues: null (never zero) when either run lacks issues.json", async () => {
    await writeRun(baseDir, "base", [makePage()], makeReport([makeIssue({ ruleId: "r", url: null })]));
    await writeRun(headDir, "head", [makePage()]); // no issues.json written

    const diff = await diffRuns(baseDir, headDir);
    expect(diff.issues).toBeNull();
  });

  it("is deterministic and sorted regardless of filesystem read order", async () => {
    const pages = [
      makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b", title: "B-old" }),
      makePage({ url: "https://ex.com/a", normalizedUrl: "https://ex.com/a", title: "A-old" }),
      makePage({ url: "https://ex.com/c", normalizedUrl: "https://ex.com/c", title: "C-old" }),
    ];
    const headPages = pages.map((p) => ({ ...p, title: `${p.title!.split("-")[0]}-new` }));
    await writeRun(baseDir, "base", pages);
    await writeRun(headDir, "head", headPages);

    const first = await diffRuns(baseDir, headDir);
    const second = await diffRuns(baseDir, headDir);
    const expectedOrder = ["https://ex.com/a", "https://ex.com/b", "https://ex.com/c"];
    expect(first.changed.map((c) => c.url)).toEqual(expectedOrder);
    expect(second.changed.map((c) => c.url)).toEqual(expectedOrder);
    expect(second).toEqual({ ...first, generatedAt: second.generatedAt });
  });
});
