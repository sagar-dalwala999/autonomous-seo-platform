import type { AnalysisConfig } from "../../../../src/analysis/config";

/** Mirrors analysis.config.json defaults, without touching the filesystem in unit tests. */
export function makeConfig(overrides: Partial<AnalysisConfig> = {}): AnalysisConfig {
  return {
    rulebookVersion: "test",
    rules: {},
    thresholds: {
      titleMinChars: 30,
      titleMaxChars: 60,
      titleMaxPx: 561,
      descMinChars: 70,
      descMaxChars: 155,
      descMaxPx: 985,
      thinContentWords: 80,
      lowTextRatio: 0.1,
      slowPageMs: 2000,
      redirectChainMax: 1,
      nearDupWordCountDeltaPct: 5,
      weakInlinkCount: 1,
    },
    ...overrides,
  };
}
