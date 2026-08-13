"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Clipboard, Download, ExternalLink, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CrawledPageWithId } from "@/lib/types";

// Mirrors Button's outline/sm classes — an <a> can't be a Button (button-in-anchor is invalid HTML).
const LINK_BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-control border border-border bg-transparent px-2.5 text-xs font-medium text-foreground transition-colors duration-150 ease-out hover:bg-subtle outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export function PageActions({ page, runId, hasRawHtml }: { page: CrawledPageWithId; runId: string; hasRawHtml: boolean }) {
  const [copied, setCopied] = useState(false);
  const rawUrl = `/api/raw/${encodeURIComponent(runId)}/${encodeURIComponent(page.pageId)}`;

  async function copyJson() {
    await navigator.clipboard.writeText(JSON.stringify(page, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(page, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${page.pageId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* The embedded replay below shares this page with 15 other panels in a narrow column;
          /preview is the same component full-width, and works even when no raw HTML was stored. */}
      <Link
        href={`/pages/${encodeURIComponent(page.pageId)}/preview?run=${encodeURIComponent(runId)}`}
        className={LINK_BUTTON_CLASS}
      >
        <Maximize2 size={14} strokeWidth={1.75} aria-hidden="true" />
        Full-page replay
      </Link>
      {hasRawHtml ? (
        <>
          <a href={rawUrl} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON_CLASS}>
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
            Open raw HTML
          </a>
          <a href={`${rawUrl}?download=1`} className={LINK_BUTTON_CLASS}>
            <Download size={14} strokeWidth={1.75} aria-hidden="true" />
            Download raw
          </a>
        </>
      ) : (
        <span className="text-xs text-faint">No raw HTML stored for this page</span>
      )}
      <Button variant="outline" size="sm" onClick={copyJson}>
        {copied ? <Check size={14} strokeWidth={1.75} aria-hidden="true" /> : <Clipboard size={14} strokeWidth={1.75} aria-hidden="true" />}
        {copied ? "Copied" : "Copy JSON"}
      </Button>
      <Button variant="outline" size="sm" onClick={downloadJson}>
        <Download size={14} strokeWidth={1.75} aria-hidden="true" />
        Download JSON
      </Button>
    </div>
  );
}
