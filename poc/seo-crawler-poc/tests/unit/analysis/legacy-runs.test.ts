/** Guards the "old stored run" contract for the WHOLE rulebook at once: fields that ExtractionResult
 * marks required are genuinely absent on runs already on disk (videos[] is missing from 1190 of
 * them), so a rule that dereferences one unguarded makes those runs unanalyzable. */
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pageRules } from "../../../src/analysis/rules/page/index";
import { siteRules } from "../../../src/analysis/rules/site/index";
import { runAnalysis } from "../../../src/analysis/engine";
import { makePage } from "../report/fixtures";
import { makeConfig } from "./page/testConfig";
import type { CrawledPage } from "../../../src/models/types";

const config = makeConfig();

/** Optional/v3 fields a modern record carries, in the shapes the rules read. */
function modernPage(): CrawledPage {
  return makePage({
    videos: [],
    fonts: { faces: [], thirdPartyHosts: [] },
    favicons: { candidates: [], effective: null, googleSerpEligible: null, googleSerpBlockers: [] },
    headBoundary: { elementCount: 3, closedBy: null, closedAtOffset: null, stranded: [] },
    charset: { value: "utf-8", source: "header", metaOffset: 20, effective: true },
    baseHref: { href: null, count: 0 },
    headMeta: {
      tags: [], og: {}, twitter: {}, ogImages: [], viewport: "width=device-width", viewportBlocksZoom: false,
      themeColor: null, colorScheme: null, referrer: null, generator: null, verification: {},
    },
    structure: {
      headings: [], paragraphs: 1, lists: { ordered: 0, unordered: 0, definition: 0 },
      tables: { total: 0, withTh: 0, withCaption: 0 }, codeBlocks: 0, blockquotes: 0, landmarks: ["main"],
    },
    content: { text: "hello", wordCount: 1, contentHash: "abc123", contentAreaMethod: "main" },
  });
}

/** Every field the rules touch stripped — the pre-v2 records in storage/runs. */
function pristineLegacyPage(): CrawledPage {
  const page = modernPage() as unknown as Record<string, unknown>;
  for (const field of [
    "videos", "fonts", "favicons", "headBoundary", "charset", "baseHref", "headMeta", "structure",
    "titles", "metaDescriptions", "social", "contacts", "hreflang", "metaRefresh", "metaKeywords",
    "pixelWidths", "pageStats", "renderDivergence",
  ]) {
    delete page[field];
  }
  page.content = { text: "hello", wordCount: 1, contentHash: "abc123" };
  return page as unknown as CrawledPage;
}

/** The nastier shape: containers present but their sub-fields absent (a partial/interrupted
 * write). Optional chaining on the container alone would sail straight past this. */
function hollowContainerPage(): CrawledPage {
  const page = modernPage() as unknown as Record<string, unknown>;
  for (const field of ["fonts", "favicons", "headBoundary", "charset", "baseHref", "headMeta", "structure"]) {
    page[field] = {};
  }
  page.videos = undefined;
  page.renderDivergence = {};
  page.content = { text: "hello", wordCount: 1, contentHash: "abc123" };
  return page as unknown as CrawledPage;
}

const DEGRADED: [string, () => CrawledPage][] = [
  ["pre-v2 record with every optional field stripped", pristineLegacyPage],
  ["containers present but hollow", hollowContainerPage],
];

describe.each(DEGRADED)("every page rule survives a %s", (_label, build) => {
  for (const rule of pageRules()) {
    it(`${rule.meta.id} returns null or findings, never throws`, () => {
      const page = build();
      let result: ReturnType<typeof rule.evaluate>;
      expect(() => {
        result = rule.evaluate(page, config);
      }).not.toThrow();
      expect(result! === null || Array.isArray(result!)).toBe(true);
    });
  }
});

describe.each(DEGRADED)("no page rule reports a finding it cannot evidence on a %s", (_label, build) => {
  it("declares data-unavailable (null) rather than inventing a finding", () => {
    const page = build();
    for (const rule of pageRules()) {
      const result = rule.evaluate(page, config);
      if (result === null) continue;
      for (const issue of result) {
        // A finding on a stripped record must never carry an `undefined` evidence value —
        // that is the signature of a rule reading through a missing field.
        for (const evidence of issue.evidence) {
          expect(evidence.value, `${rule.meta.id} evidence ${evidence.field}`).not.toBeUndefined();
        }
        expect(issue.message, rule.meta.id).not.toContain("undefined");
      }
    }
  });
});

describe("every site rule survives a legacy run", () => {
  for (const rule of siteRules()) {
    it(`${rule.meta.id} returns null or findings, never throws`, () => {
      const ctx = {
        pages: [pristineLegacyPage(), hollowContainerPage()],
        failures: [], blocked: [], sitemap: null, robots: null, summary: null,
      };
      let result: ReturnType<typeof rule.evaluate>;
      expect(() => {
        result = rule.evaluate(ctx, config);
      }).not.toThrow();
      expect(result! === null || Array.isArray(result!)).toBe(true);
    });
  }
});

describe("runAnalysis over a legacy run directory (end-to-end)", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  async function writeRun(pages: CrawledPage[]): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "legacy-run-"));
    dirs.push(root);
    const runDir = path.join(root, "runs", "legacy");
    await mkdir(path.join(runDir, "pages"), { recursive: true });
    await Promise.all(
      pages.map((page, i) => writeFile(path.join(runDir, "pages", `p${i}.json`), JSON.stringify(page), "utf-8")),
    );
    return runDir;
  }

  it("analyzes a run whose pages predate every optional field", async () => {
    const runDir = await writeRun([pristineLegacyPage(), pristineLegacyPage()]);
    const report = await runAnalysis(runDir, config);
    expect(report.pagesAnalyzed).toBe(2);
    expect(report.rulesRun).toBe(pageRules().length + siteRules().length);
    // The v3 packs cannot read these records, so they must be reported skipped, not scored clean.
    expect(report.rulesSkippedDataUnavailable).toEqual(
      expect.arrayContaining(["viewport-missing", "charset-missing", "head-signal-stranded", "video-embed-without-schema"]),
    );
  });

  it("analyzes a run whose containers are present but hollow", async () => {
    const runDir = await writeRun([hollowContainerPage()]);
    const report = await runAnalysis(runDir, config);
    expect(report.pagesAnalyzed).toBe(1);
    expect(report.rulesSkippedDataUnavailable).toEqual(
      expect.arrayContaining(["viewport-missing", "charset-not-effective", "base-href-multiple", "main-landmark-missing"]),
    );
  });

  it("still scores a modern record, so the guards did not disable the rulebook", async () => {
    const runDir = await writeRun([modernPage()]);
    const report = await runAnalysis(runDir, config);
    for (const id of ["viewport-missing", "charset-missing", "head-signal-stranded", "main-landmark-missing"]) {
      expect(report.rulesSkippedDataUnavailable, id).not.toContain(id);
    }
  });
});
