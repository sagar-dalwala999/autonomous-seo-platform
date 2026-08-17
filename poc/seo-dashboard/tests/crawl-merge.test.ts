import { describe, it, expect } from "vitest";
import { mergeRunLists } from "../lib/data";
import type { RunListItem } from "../lib/data";

function run(partial: Partial<RunListItem> & { runId: string; startedAt: string }): RunListItem {
  const { startedAt, ...rest } = partial;
  return {
    startUrl: "https://example.com/",
    startedAt,
    finishedAt: startedAt,
    attempted: 1,
    successful: 1,
    failed: 0,
    blockedByRobots: 0,
    coveragePercent: 100,
    maxDepthSeen: null,
    ...rest,
  };
}

describe("mergeRunLists", () => {
  it("keeps the local (JSON) copy when the same runId exists in both sources", () => {
    const local = run({ runId: "site-1", startedAt: "2026-08-01T00:00:00Z", healthScore: 88 });
    const db = run({ runId: "site-1", startedAt: "2026-08-01T00:00:00Z", healthScore: 90 });
    const merged = mergeRunLists([local], [db]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(local);
    expect(merged[0].healthScore).toBe(88);
  });

  it("appends DB-only runs (crawled on another machine) after the local ones", () => {
    const local = run({ runId: "local-run", startedAt: "2026-08-01T00:00:00Z" });
    const remote = run({ runId: "remote-run", startedAt: "2026-08-02T00:00:00Z", analyzed: true });
    const merged = mergeRunLists([local], [remote]);
    expect(merged.map((r) => r.runId)).toEqual(["remote-run", "local-run"]);
  });

  it("is a no-op when the DB has nothing", () => {
    const local = run({ runId: "local-run", startedAt: "2026-08-01T00:00:00Z" });
    expect(mergeRunLists([local], [])).toEqual([local]);
  });

  it("is a no-op when the disk has nothing and sorts DB runs newest-first", () => {
    const older = run({ runId: "a", startedAt: "2026-08-01T00:00:00Z" });
    const newer = run({ runId: "b", startedAt: "2026-08-03T00:00:00Z" });
    const merged = mergeRunLists([], [older, newer]);
    expect(merged.map((r) => r.runId)).toEqual(["b", "a"]);
  });
});
