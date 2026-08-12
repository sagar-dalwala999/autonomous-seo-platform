/** Slice A3 implements. Threshold defaults are Screaming-Frog-aligned per D-08 — every default
 * documents its source in analysis.config.json. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IssueSeverity } from "../models/types";

export interface AnalysisConfig {
  rulebookVersion: string;
  /** Per-rule overrides: severity and/or enabled=false. */
  rules: Record<string, { severity?: IssueSeverity; enabled?: boolean }>;
  thresholds: {
    titleMinChars: number;
    titleMaxChars: number;
    titleMaxPx: number;
    descMinChars: number;
    descMaxChars: number;
    descMaxPx: number;
    thinContentWords: number;
    lowTextRatio: number;
    slowPageMs: number;
    redirectChainMax: number;
    nearDupWordCountDeltaPct: number;
    weakInlinkCount: number;
  };
}

/** Resolved relative to this file, not cwd, so `npm run analyze` works from any directory. */
const DEFAULT_CONFIG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../analysis.config.json");

interface RawConfigFile {
  rulebookVersion?: string;
  rules?: AnalysisConfig["rules"];
  thresholds?: Partial<AnalysisConfig["thresholds"]>;
  // _docs / _sources doc-header keys are tolerated and ignored.
  [key: string]: unknown;
}

async function readConfigFile(filePath: string): Promise<RawConfigFile> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as RawConfigFile;
}

function mergeRules(base: AnalysisConfig["rules"], override: AnalysisConfig["rules"] | undefined): AnalysisConfig["rules"] {
  const merged: AnalysisConfig["rules"] = { ...base };
  for (const [ruleId, ov] of Object.entries(override ?? {})) {
    merged[ruleId] = { ...merged[ruleId], ...ov };
  }
  return merged;
}

const THRESHOLD_KEYS = [
  "titleMinChars",
  "titleMaxChars",
  "titleMaxPx",
  "descMinChars",
  "descMaxChars",
  "descMaxPx",
  "thinContentWords",
  "lowTextRatio",
  "slowPageMs",
  "redirectChainMax",
  "nearDupWordCountDeltaPct",
  "weakInlinkCount",
] as const satisfies readonly (keyof AnalysisConfig["thresholds"])[];

const VALID_SEVERITIES: IssueSeverity[] = ["error", "warning", "notice"];

function validate(config: AnalysisConfig): void {
  if (!config.rulebookVersion) throw new Error("analysis config: rulebookVersion is required");
  for (const key of THRESHOLD_KEYS) {
    const value = config.thresholds[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`analysis config: thresholds.${key} must be a non-negative finite number, got ${String(value)}`);
    }
  }
  if (config.thresholds.titleMinChars >= config.thresholds.titleMaxChars) {
    throw new Error("analysis config: thresholds.titleMinChars must be < titleMaxChars");
  }
  if (config.thresholds.descMinChars >= config.thresholds.descMaxChars) {
    throw new Error("analysis config: thresholds.descMinChars must be < descMaxChars");
  }
  if (config.thresholds.lowTextRatio > 1) {
    throw new Error("analysis config: thresholds.lowTextRatio must be a 0..1 fraction");
  }
  if (config.thresholds.nearDupWordCountDeltaPct > 100) {
    throw new Error("analysis config: thresholds.nearDupWordCountDeltaPct must be a 0..100 percentage");
  }
  for (const [ruleId, override] of Object.entries(config.rules)) {
    if (override.severity && !VALID_SEVERITIES.includes(override.severity)) {
      throw new Error(`analysis config: rules.${ruleId}.severity "${override.severity}" is invalid`);
    }
  }
}

/**
 * Loads analysis.config.json (project root) as defaults, then deep-merges an optional user
 * override file (--config path) on top: thresholds merge per-key, rules merge per-ruleId.
 */
export async function loadConfig(configPath?: string): Promise<AnalysisConfig> {
  const defaultsRaw = await readConfigFile(DEFAULT_CONFIG_PATH);
  let overrideRaw: RawConfigFile = {};
  if (configPath && path.resolve(configPath) !== DEFAULT_CONFIG_PATH) {
    overrideRaw = await readConfigFile(configPath);
  }

  const merged: AnalysisConfig = {
    rulebookVersion: overrideRaw.rulebookVersion ?? defaultsRaw.rulebookVersion ?? "1.0.0",
    rules: mergeRules((defaultsRaw.rules ?? {}) as AnalysisConfig["rules"], overrideRaw.rules),
    thresholds: {
      ...(defaultsRaw.thresholds as AnalysisConfig["thresholds"]),
      ...(overrideRaw.thresholds ?? {}),
    },
  };

  validate(merged);
  return merged;
}
