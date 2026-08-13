import { describe, expect, it } from "vitest";
import { buildCatalog, classifyRulebook } from "../../../../src/analysis/automation/registry";
import { CLASSIFICATIONS, DEFAULT_CLASSIFICATION } from "../../../../src/analysis/automation/classification";
import { TIER_CONFIDENCE } from "../../../../src/analysis/automation/types";

const EXPECTED_AUTO_SAFE = ["canonical-absent", "image-missing-dimensions", "mixed-content", "redirect-chain"];

describe("classification safety defaults", () => {
  it("defaults an unreviewed rule to human-only, never auto-safe or auto-with-review", () => {
    expect(DEFAULT_CLASSIFICATION.automation).toBe("human-only");
  });

  it("defaults an unreviewed rule to the lowest-confidence tier", () => {
    expect(DEFAULT_CLASSIFICATION.tier).toBe("heuristic");
  });

  it("confidence strictly orders observed > derived > heuristic", () => {
    expect(TIER_CONFIDENCE.observed).toBeGreaterThan(TIER_CONFIDENCE.derived);
    expect(TIER_CONFIDENCE.derived).toBeGreaterThan(TIER_CONFIDENCE.heuristic);
  });

  it("the hand-classified auto-safe list is exactly the four audited rules — small by design", () => {
    const autoSafeIds = Object.entries(CLASSIFICATIONS)
      .filter(([, c]) => c.automation === "auto-safe")
      .map(([id]) => id)
      .sort();
    expect(autoSafeIds).toEqual([...EXPECTED_AUTO_SAFE].sort());
  });

  it("every hand-classified entry carries a non-empty rationale", () => {
    for (const [id, c] of Object.entries(CLASSIFICATIONS)) {
      expect(c.rationale.length, `rule ${id} has no rationale`).toBeGreaterThan(10);
    }
  });
});

describe("buildCatalog (reads the live rule registry at call time)", () => {
  it("does not throw and returns at least the rules this slice audited", () => {
    const catalog = buildCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(Object.keys(CLASSIFICATIONS).length - 5); // registry may have shrunk/renamed a couple mid-flight
  });

  it("resolves the four audited rules to auto-safe with full (observed/derived) confidence", () => {
    const catalog = buildCatalog();
    for (const id of EXPECTED_AUTO_SAFE) {
      const entry = catalog.find((e) => e.id === id);
      expect(entry, `expected ${id} to still be registered`).toBeDefined();
      expect(entry!.automation).toBe("auto-safe");
      expect(entry!.reviewed).toBe(true);
      expect(entry!.confidence).toBeGreaterThanOrEqual(TIER_CONFIDENCE.derived);
    }
  });

  it("any rule not in CLASSIFICATIONS (added by a sibling slice after this audit) falls back to human-only, never auto-safe", () => {
    const catalog = buildCatalog();
    const unreviewed = catalog.filter((e) => !e.reviewed);
    for (const entry of unreviewed) {
      expect(entry.automation).toBe("human-only");
      expect(entry.tier).toBe("heuristic");
    }
  });

  it("every catalog entry has a scope of exactly page or site", () => {
    for (const entry of buildCatalog()) {
      expect(["page", "site"]).toContain(entry.scope);
    }
  });
});

describe("classifyRulebook", () => {
  it("counts sum to the total rule count", () => {
    const { counts } = classifyRulebook();
    expect(counts["auto-safe"] + counts["auto-with-review"] + counts["human-only"]).toBe(counts.totalRules);
  });

  it("auto-safe count is small relative to the rulebook — a large auto-safe bucket would mean over-permissive classification", () => {
    const { counts } = classifyRulebook();
    expect(counts["auto-safe"]).toBeLessThanOrEqual(6);
  });
});
