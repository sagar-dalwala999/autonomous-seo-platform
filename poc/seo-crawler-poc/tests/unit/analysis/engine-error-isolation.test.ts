/**
 * Proves engine.ts's per-rule try/catch without touching a single file under
 * src/analysis/rules/** (off-limits — two other agents are working there concurrently). Instead
 * this file mocks pageRules() to inject one fake rule that always throws, using vi.mock's
 * importOriginal so every REAL rule still runs unmodified alongside it. Module mocking is
 * file-scoped in Vitest (isolated per test file), so this never leaks into engine.test.ts.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAnalysis } from "../../../src/analysis/engine";
import { makePage } from "../report/fixtures";
import { makeConfig } from "./page/testConfig";
import type { CrawledPage } from "../../../src/models/types";

const THROWING_RULE_ID = "test-throws-on-every-page";
const THROW_MESSAGE = "intentional test dereference — proves per-rule isolation";

// vi.mock calls are hoisted above every import in this file by Vitest's transform, so
// runAnalysis (which imports pageRules internally) always sees the mocked version below.
vi.mock("../../../src/analysis/rules/page/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/analysis/rules/page/index")>();
  return {
    ...actual,
    pageRules: () => [
      ...actual.pageRules(),
      {
        meta: {
          id: THROWING_RULE_ID,
          category: "test",
          defaultSeverity: "warning",
          description: "injected for the try/catch isolation proof — always throws",
          howToFix: "n/a",
          dataRequirements: [],
        },
        evaluate: () => {
          throw new Error(THROW_MESSAGE);
        },
      },
    ],
  };
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function makeRun(pages: Record<string, CrawledPage>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "a3-engine-errtest-"));
  dirs.push(dir);
  await mkdir(path.join(dir, "pages"), { recursive: true });
  for (const [pageId, page] of Object.entries(pages)) {
    await writeFile(path.join(dir, "pages", `${pageId}.json`), JSON.stringify(page));
  }
  return dir;
}

describe("runAnalysis — a throwing rule never aborts the run", () => {
  it("completes the run, records the rule in rulesErrored, and every other rule still runs normally", async () => {
    const dir = await makeRun({
      a: makePage({ url: "http://ex.com/a", finalUrl: "http://ex.com/a", canonical: null }), // canonical-absent still fires
      b: makePage({ url: "http://ex.com/b", finalUrl: "http://ex.com/b", canonical: null }),
    });

    const report = await runAnalysis(dir, makeConfig());

    // 1. the run completed at all — before this wave, one throw here would abort the whole analysis
    expect(report).toBeDefined();
    expect(report.pagesAnalyzed).toBe(2);

    // 2. the throwing rule is recorded, not silently swallowed
    expect(report.rulesErrored).toContain(THROWING_RULE_ID);
    const detail = report.rulesErroredDetail.find((e) => e.ruleId === THROWING_RULE_ID);
    expect(detail).toBeDefined();
    expect(detail!.pageCount).toBe(2); // threw on both pages
    expect(detail!.message).toContain(THROW_MESSAGE);

    // 3. excluded from the score denominator exactly like a null result — and never mixed into
    //    the "skipped: no data" bucket, which is a different, non-crash reason for zero evaluation
    expect(report.rulesSkippedDataUnavailable).not.toContain(THROWING_RULE_ID);
    expect(report.rulesSkippedDetail.some((s) => s.ruleId === THROWING_RULE_ID)).toBe(false);

    // 4. its own finding is status "errored" — zero priority, no damage charged to the score
    const f = report.findings.find((x) => x.ruleId === THROWING_RULE_ID);
    expect(f).toBeDefined();
    expect(f!.status).toBe("errored");
    expect(f!.priority).toBe(0);
    expect(f!.damage).toBeNull();

    // 5. every OTHER rule still ran and fired normally — the crash was fully isolated to its own rule
    expect(report.issues.some((i) => i.ruleId === "canonical-absent")).toBe(true);
    expect(report.rulesRun).toBeGreaterThan(1);
  });

  it("is fully deterministic across repeated runs — the throw is caught the same way every time, never flakes the score", async () => {
    const dir = await makeRun({ p: makePage({ url: "http://ex.com/p", finalUrl: "http://ex.com/p" }) });
    const first = await runAnalysis(dir, makeConfig());
    const second = await runAnalysis(dir, makeConfig());
    expect(second.healthScore).toBe(first.healthScore);
    expect(second.rulesErrored).toEqual(first.rulesErrored);
  });
});
