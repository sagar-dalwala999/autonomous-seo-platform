import { describe, expect, it } from "vitest";
import { ScreenshotBudget } from "../../../src/artifacts/screenshotPolicy";

describe("ScreenshotBudget", () => {
  it("admits up to topN non-error pages by importance, then exhausts the budget", () => {
    const budget = new ScreenshotBudget({ topN: 2 });
    const a = budget.decide({ normalizedUrl: "https://x/a", depth: 0, isError: false });
    const b = budget.decide({ normalizedUrl: "https://x/b", depth: 1, isError: false });
    const c = budget.decide({ normalizedUrl: "https://x/c", depth: 1, isError: false });

    expect(a).toEqual({ capture: true, reason: "top-n-importance" });
    expect(b).toEqual({ capture: true, reason: "top-n-importance" });
    expect(c).toEqual({ capture: false, reason: "budget-exhausted" });
  });

  it("never bounds error pages — every error page captures regardless of budget state", () => {
    const budget = new ScreenshotBudget({ topN: 0 });
    for (let i = 0; i < 10; i++) {
      const d = budget.decide({ normalizedUrl: `https://x/err${i}`, depth: 2, isError: true });
      expect(d).toEqual({ capture: true, reason: "error-page" });
    }
    expect(budget.stats.admittedErrors).toBe(10);
    expect(budget.stats.admittedByImportance).toBe(0);
  });

  it("error admission does not consume the importance budget", () => {
    const budget = new ScreenshotBudget({ topN: 1 });
    budget.decide({ normalizedUrl: "https://x/err", depth: 0, isError: true });
    const importanceDecision = budget.decide({ normalizedUrl: "https://x/ok", depth: 0, isError: false });
    expect(importanceDecision).toEqual({ capture: true, reason: "top-n-importance" });
  });

  it("clamps a negative topN to 0", () => {
    const budget = new ScreenshotBudget({ topN: -5 });
    const d = budget.decide({ normalizedUrl: "https://x/a", depth: 0, isError: false });
    expect(d.capture).toBe(false);
  });

  it("stats reports admitted counts and the configured topN", () => {
    const budget = new ScreenshotBudget({ topN: 3 });
    budget.decide({ normalizedUrl: "https://x/a", depth: 0, isError: false });
    budget.decide({ normalizedUrl: "https://x/err", depth: 0, isError: true });
    expect(budget.stats).toEqual({ admittedByImportance: 1, admittedErrors: 1, topN: 3 });
  });
});
