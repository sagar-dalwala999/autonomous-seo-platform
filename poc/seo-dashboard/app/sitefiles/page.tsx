import { History, FileWarning } from "lucide-react";
import { resolveRunId, getRun } from "@/lib/data";
import { buildAiAccessTable } from "@/lib/data-sitefiles";
import { findRuleSourceLine } from "@/lib/sitefiles-lines";
import { EmptyState } from "@/components/ui/empty-state";
import { RobotsPanel } from "@/components/sitefiles/robots-panel";
import { LlmsPanel } from "@/components/sitefiles/llms-panel";
import { AiCrawlerHeadline, AiCrawlerTable } from "@/components/sitefiles/ai-crawler-table";

interface Props {
  searchParams: Promise<{ run?: string }>;
}

export default async function SiteFilesPage({ searchParams }: Props) {
  const { run } = await searchParams;
  const runId = await resolveRunId(run);

  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl first to see what this site tells crawlers." />;
  }

  const { report, robots } = await getRun(runId);

  if (!report) {
    return <EmptyState icon={FileWarning} title="Run report missing" description={`storage/runs/${runId}/report.json could not be read.`} />;
  }

  const aiAccess = await buildAiAccessTable(runId);
  const rows = aiAccess?.rows ?? [];
  const robotsAvailable = Boolean(robots?.content && robots.parseStatus === "ok");

  const sourceLines = new Map<string, number | null>();
  if (robotsAvailable && robots?.content) {
    for (const r of rows) {
      const ruleType: "allow" | "disallow" | null = r.verdict === "allowed" && r.allowRules[0] ? "allow" : r.verdict === "blocked" || r.verdict === "partly-blocked" ? "disallow" : null;
      const rulePath = ruleType === "allow" ? r.allowRules[0] ?? null : ruleType === "disallow" ? r.disallowRules[0] ?? null : null;
      sourceLines.set(r.agent, findRuleSourceLine(robots.content, r.matchedGroup, rulePath, ruleType));
    }
  }

  // llms.txt/feeds/favicon/webManifest are not stored on any run yet (mirrors the real shape
  // GET /api/crawls/:id/site-files already returns for these fields — see that route for the
  // authoritative "awaiting" reasons; kept in sync by hand since importing app/api/** isn't allowed).
  const llmsTxt = { available: false, reason: "llms.txt is not probed/stored by the crawler yet." };

  return (
    <div className="space-y-6">
      <p className="text-sm text-secondary">
        Run <span className="font-medium text-foreground">{runId}</span> · what {new URL(report.startUrl).hostname} tells crawlers
      </p>

      <AiCrawlerHeadline rows={rows} />

      <AiCrawlerTable rows={rows} sourceLines={sourceLines} robotsAvailable={robotsAvailable} />

      {aiAccess && aiAccess.parseStatus !== "ok" && (
        <p className="text-xs text-faint">
          robots.txt parse status: <span className="font-medium text-foreground">{aiAccess.parseStatus}</span> — verdicts above fell back to &quot;unknown&quot; rather than guessing.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RobotsPanel robots={robots} runId={runId} />
        <LlmsPanel llmsTxt={llmsTxt} />
      </div>
    </div>
  );
}
