import { describe, it, expect } from "vitest";
import { pickDefaultRun } from "../lib/run-selection";

const run = (runId: string, successful: number) => ({ runId, successful });

describe("pickDefaultRun", () => {
  it("skips a newest-but-degenerate 1-page run for the newest substantial one", () => {
    const runs = [run("sagar-shots2", 1), run("phase2-final", 21), run("older", 50)];
    expect(pickDefaultRun(runs)?.runId).toBe("phase2-final");
  });

  it("takes the newest run when it is already substantial", () => {
    expect(pickDefaultRun([run("newest", 50), run("older", 21)])?.runId).toBe("newest");
  });

  it("falls back to the newest run when nothing qualifies", () => {
    expect(pickDefaultRun([run("a", 1), run("b", 0)])?.runId).toBe("a");
  });

  it("returns undefined for an empty list", () => {
    expect(pickDefaultRun([])).toBeUndefined();
  });
});
