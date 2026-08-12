import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/analysis/config";

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function writeOverride(content: unknown): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), "a3-config-"));
  const file = path.join(dir, "override.json");
  await writeFile(file, JSON.stringify(content));
  return file;
}

describe("loadConfig", () => {
  it("loads analysis.config.json defaults with every threshold present and documented", async () => {
    const config = await loadConfig();
    expect(config.rulebookVersion).toBeTruthy();
    expect(config.thresholds.titleMinChars).toBe(30);
    expect(config.thresholds.titleMaxChars).toBe(60);
    expect(config.thresholds.thinContentWords).toBe(80);
    expect(config.thresholds.nearDupWordCountDeltaPct).toBe(5);
    expect(config.thresholds.weakInlinkCount).toBe(1);
  });

  it("deep-merges a partial threshold override on top of defaults, leaving other keys untouched", async () => {
    const overridePath = await writeOverride({ thresholds: { thinContentWords: 120 } });
    const config = await loadConfig(overridePath);
    expect(config.thresholds.thinContentWords).toBe(120);
    expect(config.thresholds.titleMinChars).toBe(30); // untouched default
  });

  it("merges per-rule severity overrides by ruleId", async () => {
    const overridePath = await writeOverride({ rules: { "title-missing": { severity: "warning" } } });
    const config = await loadConfig(overridePath);
    expect(config.rules["title-missing"]).toEqual({ severity: "warning" });
  });

  it("rejects an override where titleMinChars >= titleMaxChars", async () => {
    const overridePath = await writeOverride({ thresholds: { titleMinChars: 100 } });
    await expect(loadConfig(overridePath)).rejects.toThrow(/titleMinChars/);
  });

  it("rejects an invalid rule severity", async () => {
    const overridePath = await writeOverride({ rules: { "title-missing": { severity: "critical" } } });
    await expect(loadConfig(overridePath)).rejects.toThrow(/severity/);
  });

  it("rejects a negative threshold", async () => {
    const overridePath = await writeOverride({ thresholds: { slowPageMs: -1 } });
    await expect(loadConfig(overridePath)).rejects.toThrow(/slowPageMs/);
  });
});
