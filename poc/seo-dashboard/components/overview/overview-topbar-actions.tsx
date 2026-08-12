"use client";

import { useEffect } from "react";
import { Download } from "lucide-react";
import type { CrawlSummary } from "@/lib/types";
import { useTopbarActions } from "@/lib/topbar-actions-context";
import { Button } from "@/components/ui/button";
import { NewCrawlTriggerButton } from "./new-crawl-trigger-button";

function downloadReport(report: CrawlSummary) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${report.runId}-report.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function OverviewTopbarActions({ report }: { report: CrawlSummary | null }) {
  const { setActions } = useTopbarActions();

  useEffect(() => {
    setActions(
      <>
        {report && (
          <Button variant="outline" size="sm" onClick={() => downloadReport(report)}>
            <Download size={14} strokeWidth={1.75} aria-hidden="true" />
            Export
          </Button>
        )}
        <NewCrawlTriggerButton />
      </>,
    );
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report identity changes per run; re-registering on every render would thrash the topbar
  }, [report?.runId]);

  return null;
}
