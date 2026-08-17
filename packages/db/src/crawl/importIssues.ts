/**
 * Post-analyze findings import. The crawler's syncRunToPostgres runs at crawl close — BEFORE the
 * dashboard's auto-analyze has written issues.json — so findings never made it into Postgres for
 * dashboard-spawned crawls. This module imports issues.json → Rule/Finding/Issue rows on demand,
 * after analysis, and is also the single shared implementation of the findings block (syncRun.ts
 * delegates to it, so the two paths can never drift).
 *
 * Idempotent: a crawl that already has findings is skipped (re-running an analyze + sync is safe).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../../generated/client/index.js";

async function readJsonIfExists(file: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export interface FindingsImportResult {
  findingsInserted: number;
  issuesInserted: number;
  skippedReason: string | null;
}

/**
 * Shared findings block: issues.json → Rule (upsert, global) → Finding (upsert per rule) →
 * Issue (bulk) → Crawl.healthScore/counts. `pageKeyToId` maps the dashboard's 12-hex page ids
 * (stored as Issue.pageId foreign keys to Page.id) and `evaluatedPages` sizes the reach math.
 */
export async function importFindingsForCrawl(
  prisma: PrismaClient,
  crawl: { id: string; projectId: string },
  runDir: string,
  pageKeyToId: Map<string, string>,
  evaluatedPages: number,
): Promise<FindingsImportResult> {
  const findingsAlreadyImported = (await prisma.finding.count({ where: { crawlId: crawl.id } })) > 0;
  if (findingsAlreadyImported) {
    return { findingsInserted: 0, issuesInserted: 0, skippedReason: "findings already imported" };
  }

  const issuesReport = await readJsonIfExists(path.join(runDir, "issues.json"));
  if (!issuesReport?.issues?.length) {
    return { findingsInserted: 0, issuesInserted: 0, skippedReason: "no issues.json or no issues" };
  }

  const byRule = new Map<string, any[]>();
  for (const issue of issuesReport.issues) {
    if (!byRule.has(issue.ruleId)) byRule.set(issue.ruleId, []);
    byRule.get(issue.ruleId)!.push(issue);
  }

  let findingsInserted = 0;
  let issuesInserted = 0;

  for (const [ruleId, ruleIssues] of byRule) {
    const first = ruleIssues[0];
    const rule = await prisma.rule.upsert({
      where: { projectId_slug_version: { projectId: null as any, slug: ruleId, version: 1 } },
      update: {},
      create: {
        slug: ruleId,
        version: 1,
        scope: first.scope === "site" ? "SITE" : "PAGE",
        category: first.category ?? "general",
        defaultSeverity: (first.severity ?? "notice").toUpperCase(),
        title: ruleId,
        why: "",
        howToFix: first.howToFix ?? "",
      },
    });

    const affectedPageKeys = new Set(ruleIssues.map((i) => i.pageId).filter(Boolean));
    const affectedPages = affectedPageKeys.size;
    const reach = Math.sqrt(Math.min(1, affectedPages / (evaluatedPages || 1)));

    const finding = await prisma.finding.upsert({
      where: { crawlId_ruleSlug: { crawlId: crawl.id, ruleSlug: ruleId } },
      update: {},
      create: {
        crawlId: crawl.id,
        projectId: crawl.projectId,
        ruleId: rule.id,
        ruleSlug: ruleId,
        scope: rule.scope,
        category: rule.category,
        severity: rule.defaultSeverity,
        status: "FAILING",
        affectedPages,
        affectedInstances: ruleIssues.length,
        evaluatedPages,
        reach,
        sampleUrls: [...new Set(ruleIssues.map((i) => i.url).filter(Boolean))].slice(0, 5),
      },
    });
    findingsInserted++;

    await prisma.issue.createMany({
      data: ruleIssues.map((i) => ({
        crawlId: crawl.id,
        projectId: crawl.projectId,
        findingId: finding.id,
        ruleId: rule.id,
        ruleSlug: ruleId,
        pageId: i.pageId ? (pageKeyToId.get(i.pageId) ?? null) : null,
        severity: (i.severity ?? "notice").toUpperCase(),
        category: i.category ?? "general",
        message: i.message ?? "",
        evidencePaths: Array.isArray(i.evidence) ? i.evidence.map((e: any) => e.field).filter(Boolean) : [],
        evidence: i.evidence ?? null,
      })),
    });
    issuesInserted += ruleIssues.length;
  }

  await prisma.crawl.update({
    where: { id: crawl.id },
    data: {
      healthScore: issuesReport.healthScore ?? null,
      rulebookVersion: issuesReport.rulebookVersion ?? null,
      errorCount: issuesReport.counts?.error ?? 0,
      warningCount: issuesReport.counts?.warning ?? 0,
      noticeCount: issuesReport.counts?.notice ?? 0,
    },
  });

  return { findingsInserted, issuesInserted, skippedReason: null };
}

/** Standalone entry point (dashboard post-analyze sync + packages/db CLI): resolves the crawl row
 *  and the pageKey→Page.id map, then delegates to the shared block above. */
export async function importIssuesToPostgres(prisma: PrismaClient, runDir: string, runId: string): Promise<FindingsImportResult> {
  const crawl = await prisma.crawl.findFirst({ where: { slug: runId } });
  if (!crawl) throw new Error(`importIssuesToPostgres: no crawl row for runId "${runId}"`);
  const pages = await prisma.page.findMany({ where: { crawlId: crawl.id }, select: { id: true, pageKey: true } });
  const pageKeyToId = new Map(pages.map((p) => [p.pageKey, p.id]));
  return importFindingsForCrawl(prisma, crawl, runDir, pageKeyToId, crawl.pagesCrawled || 1);
}
