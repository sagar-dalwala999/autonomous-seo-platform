import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { RobotsEvidence } from "@/lib/types";

export function RobotsPanel({ robots, runId }: { robots: RobotsEvidence | null; runId: string }) {
  if (!robots) {
    return (
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-foreground">robots.txt</h2>
        <p className="text-xs text-faint">robots.json not found for this run.</p>
      </Card>
    );
  }

  const lines = (robots.content ?? "").split(/\r?\n/);

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">robots.txt</h2>
        <div className="flex items-center gap-2">
          <Badge tone={robots.parseStatus === "ok" ? "ok" : robots.parseStatus === "error" ? "danger" : "neutral"}>{robots.parseStatus}</Badge>
          <Link href={`/sitemap?run=${encodeURIComponent(runId)}`} className="text-xs text-primary underline underline-offset-2">
            Full sitemap coverage →
          </Link>
        </div>
      </div>
      <p className="mb-2 text-xs text-faint">
        {robots.url} · fetched {new Date(robots.fetchedAt).toLocaleString()}
      </p>
      {robots.content ? (
        <pre className="max-h-72 overflow-auto rounded-control border border-border bg-elevated p-3 font-mono text-xs text-secondary">
          {lines.map((line, i) => (
            <div key={i} className="flex gap-3">
              <span className="w-7 shrink-0 select-none text-right text-faint">{i + 1}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{line || " "}</span>
            </div>
          ))}
        </pre>
      ) : (
        <p className="text-xs text-faint">(no content)</p>
      )}
    </Card>
  );
}
