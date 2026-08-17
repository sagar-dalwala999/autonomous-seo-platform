import { describe, it, expect } from "vitest";
import { resolveRange, daysBetween, latestUsableDate, provisionalStartDate } from "../lib/gsc/date-range";

describe("resolveRange", () => {
  it("falls back to the default window on malformed input", () => {
    const r = resolveRange("garbage", "nonsense");
    expect(r.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.startDate <= r.endDate).toBe(true);
  });

  it("swaps start and end when reversed", () => {
    const r = resolveRange("2026-08-10", "2026-08-01");
    expect(r.startDate).toBe("2026-08-01");
    expect(r.endDate).toBe("2026-08-10");
    expect(r.clampedReason).toContain("swapped");
  });

  it("clamps the end date to the newest settled day", () => {
    const r = resolveRange("2026-08-01", "2999-01-01");
    expect(r.endDate).toBe(latestUsableDate());
    expect(r.clampedReason).not.toBeNull();
  });

  it("clamps the start date to 16 months of history", () => {
    const r = resolveRange("2000-01-01", latestUsableDate());
    expect(r.startDate > "2000-01-01").toBe(true);
    expect(r.clampedReason).not.toBeNull();
  });

  it("reports no clamp for a valid in-window range", () => {
    const r = resolveRange("2026-07-01", "2026-07-28");
    expect(r.clampedReason).toBeNull();
  });
});

describe("daysBetween", () => {
  it("counts inclusively", () => {
    expect(daysBetween({ startDate: "2026-08-01", endDate: "2026-08-28" })).toBe(28);
    expect(daysBetween({ startDate: "2026-08-01", endDate: "2026-08-01" })).toBe(1);
  });
});

describe("provisionalStartDate", () => {
  it("labels the newest two days as provisional", () => {
    expect(provisionalStartDate("2026-08-10")).toBe("2026-08-09");
  });
});
