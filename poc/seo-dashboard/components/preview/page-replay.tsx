"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock, ExternalLink, FileWarning, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ArtifactStorageNotice } from "@/components/artifacts/artifact-storage-notice";
import { statusTone } from "@/lib/explorer-shared";
import { cn } from "@/lib/cn";
import { isFrameableScheme } from "./frameability";

export type ReplayVariant = "rendered" | "static";

export interface PageReplayProps {
  runId: string;
  pageId: string;
  pageUrl: string;
  statusCode: number | null;
  fetchedAt: string;
  hasStaticHtml: boolean;
  /** From the page's OWN stored response headers — x-frame-options / CSP frame-ancestors. */
  canFrameLive: boolean;
  frameBlockedBy: string | null;
  hasScreenshot: boolean;
  /** MVP acceptance criterion #11 — undefined while the server-side check hasn't run (never true
   *  blank-render: the notice only shows once we know for sure it's false). */
  artifactStorageConfigured?: boolean;
  artifactStorageReason?: string;
  className?: string;
}

interface ReplayPayload {
  variant: ReplayVariant;
  html: string;
  empty: boolean;
  truncated: boolean;
  maxBytes: number;
  byteLength: number;
  originalByteLength: number;
}

// Sandbox carries zero tokens on purpose: no allow-scripts (scripts can't run at all, independent
// of the CSP the API route injected into the markup), no allow-same-origin (opaque origin — can't
// read/write anything of the real site's origin), no allow-forms/popups/top-navigation. This is
// the strictest standard configuration; the API route additionally strips href/meta-refresh so a
// same-frame link click (which sandbox alone doesn't block — only TOP navigation is sandbox-gated)
// can't silently navigate the iframe out to the live site either.
const SANDBOX = "";

// srcdoc, never a blob: URL. A blob URL is readable only by the origin that created it, and an
// empty sandbox gives the frame an opaque origin — so src={blobUrl} loads nothing, silently.

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function PageReplay({
  runId,
  pageId,
  pageUrl,
  statusCode,
  fetchedAt,
  hasStaticHtml,
  canFrameLive,
  frameBlockedBy,
  hasScreenshot,
  artifactStorageConfigured,
  artifactStorageReason,
  className,
}: PageReplayProps) {
  const [variant, setVariant] = useState<ReplayVariant>("rendered");
  const [styled, setStyled] = useState(true);
  // Re-checked here, not just trusted from props: this is the value that becomes an iframe src.
  const liveOk = canFrameLive && isFrameableScheme(pageUrl);
  const [mode, setMode] = useState<"live" | "shot" | "replay">(liveOk ? "live" : hasScreenshot ? "shot" : "replay");
  const [state, setState] = useState<"loading" | "loaded" | "error" | "not-found">("loading");
  const [payload, setPayload] = useState<ReplayPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // toLocaleString() with no explicit locale reads the runtime's default locale — Node's differs
  // from the browser's, so SSR and first client paint disagree and React throws a hydration
  // mismatch. Render a fixed, locale-free format for SSR/first paint, then upgrade post-mount.
  const [capturedLabel, setCapturedLabel] = useState(() => new Date(fetchedAt).toISOString().replace("T", " ").slice(0, 19) + " UTC");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate post-mount upgrade from the locale-free SSR value above, not derivable at render time
    setCapturedLabel(new Date(fetchedAt).toLocaleString());
  }, [fetchedAt]);

  function load() {
    const seq = ++requestSeq.current;
    setState("loading");
    setPayload(null);
    setErrorMessage(null);

    fetch(`/api/replay/${encodeURIComponent(runId)}/${encodeURIComponent(pageId)}?variant=${variant}${styled ? "&assets=live" : ""}`)
      .then(async (res) => {
        if (seq !== requestSeq.current) return;
        if (res.status === 404) {
          setState("not-found");
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setErrorMessage(body?.error ?? `Request failed (${res.status})`);
          setState("error");
          return;
        }
        const data: ReplayPayload = await res.json();
        setPayload(data);
        setState("loaded");
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setErrorMessage(err instanceof Error ? err.message : "Network error");
        setState("error");
      });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- React's own fetch-on-change pattern (react.dev "Fetching data"): reset before the request, resolve async inside load()
    if (mode === "replay") load();
    // Only fetch markup when the replay tab is actually showing; live/screenshot need no payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load() is stable for these inputs
  }, [runId, pageId, variant, styled, mode]);

  return (
    <div className={cn("space-y-3", className)}>
      {artifactStorageConfigured === false && <ArtifactStorageNotice reason={artifactStorageReason} />}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-subtle px-4 py-3 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={statusTone(statusCode)}>{statusCode ?? "—"}</Badge>
          <span className="max-w-[420px] truncate text-secondary" title={pageUrl}>
            {pageUrl}
          </span>
          {isFrameableScheme(pageUrl) && (
            <a
              href={pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-primary underline underline-offset-2"
            >
              <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
              open live URL
            </a>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-faint">
          <Clock size={12} strokeWidth={1.75} aria-hidden="true" />
          Captured {capturedLabel} · this is a snapshot, not the live page
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Preview mode" className="inline-flex rounded-control border border-border bg-subtle p-0.5 text-xs">
          {([
            ["live", "Live page", liveOk],
            ["shot", "Screenshot", hasScreenshot],
            ["replay", "Captured HTML", true],
          ] as const).map(([key, label, enabled]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              disabled={!enabled}
              title={
                enabled
                  ? undefined
                  : key === "live"
                    ? (frameBlockedBy ?? "This site blocks embedding")
                    : 'No screenshot stored for this run — turn on "Capture screenshots" in New crawl and run it again'
              }
              onClick={() => setMode(key)}
              className={cn(
                "rounded-[6px] px-2.5 py-1.5 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
                mode === key ? "bg-card text-foreground shadow-card" : "text-secondary hover:text-foreground",
                !enabled && "cursor-not-allowed opacity-40 hover:text-secondary",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "replay" && hasStaticHtml && (
          <div role="tablist" aria-label="Replay variant" className="inline-flex rounded-control border border-border bg-subtle p-0.5 text-xs">
            {([["rendered", "Rendered (post-JS)"], ["static", "Static (pre-JS)"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={variant === key}
                onClick={() => setVariant(key)}
                className={cn(
                  "rounded-[6px] px-2.5 py-1.5 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
                  variant === key ? "bg-card text-foreground shadow-card" : "text-secondary hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {mode === "replay" && (
          <div role="tablist" aria-label="Asset loading" className="inline-flex rounded-control border border-border bg-subtle p-0.5 text-xs">
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                type="button"
                role="tab"
                aria-selected={styled === on}
                onClick={() => setStyled(on)}
                className={cn(
                  "rounded-[6px] px-2.5 py-1.5 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
                  styled === on ? "bg-card text-foreground shadow-card" : "text-secondary hover:text-foreground",
                )}
              >
                {on ? "Styled" : "As captured"}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "replay" && (
      <div className="flex items-start gap-2 rounded-control border border-border-strong bg-elevated px-3 py-2 text-xs text-secondary">
        <FileWarning size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
        <span>
          {styled ? (
            <>
              Captured HTML, with stylesheets, images and fonts loaded from the live site so the page looks like itself.
              Scripts never run, and links are inert. Assets come from the site as it is <em>now</em>, so a since-changed
              page may not look exactly as it did at capture.
            </>
          ) : (
            <>
              HTML exactly as captured — nothing is fetched from the live site, so the page is deliberately unstyled.
              Faithful to the snapshot, but asset-heavy pages render as bare boxes.
            </>
          )}
        </span>
      </div>
      )}

      {mode === "live" && liveOk && (
        <>
          <div className="flex items-start gap-2 rounded-control border border-border-strong bg-elevated px-3 py-2 text-xs text-secondary">
            <FileWarning size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
            <span>
              The live site, embedded now — not the crawl snapshot. It reflects the page as it is today, so it can differ
              from what was captured on {capturedLabel}.
            </span>
          </div>
          <div className="overflow-hidden rounded-card border border-border bg-white" style={{ height: "70vh" }}>
            <iframe
              src={pageUrl}
              referrerPolicy="no-referrer"
              // Both tokens are required for a third-party page to render as itself; allow-same-origin
              // grants the frame ITS OWN origin (never ours), so this is a plain cross-origin embed.
              sandbox="allow-scripts allow-same-origin"
              title={`Live page: ${pageUrl}`}
              className="h-full w-full"
            />
          </div>
        </>
      )}

      {mode === "shot" && (
        <>
          <div className="flex items-start gap-2 rounded-control border border-border-strong bg-elevated px-3 py-2 text-xs text-secondary">
            <FileWarning size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
            <span>
              Full-page screenshot taken during the crawl, with JavaScript executed — this is exactly what the crawler saw
              at {capturedLabel}.
            </span>
          </div>
          <div className="overflow-auto rounded-card border border-border bg-white" style={{ maxHeight: "70vh" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a stored WebP served by our own route, not a Next-optimisable asset */}
            <img
              src={`/api/screenshot/${encodeURIComponent(runId)}/${encodeURIComponent(pageId)}?size=full`}
              alt={`Screenshot of ${pageUrl} captured during the crawl`}
              className="w-full"
            />
          </div>
        </>
      )}

      {mode === "replay" && payload?.truncated && (
        <div className="flex items-start gap-2 rounded-control border border-warn/30 bg-warn-bg px-3 py-2 text-xs text-warn">
          <AlertTriangle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Truncated for preview — showing the first {fmtBytes(payload.byteLength)} of {fmtBytes(payload.originalByteLength)} captured.
          </span>
        </div>
      )}

      {mode === "replay" && state === "loading" && <Skeleton className="h-[70vh] w-full" />}

      {mode === "replay" && state === "error" && (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load the replay"
          description={errorMessage ?? "Unknown error"}
          action={
            <button
              type="button"
              onClick={load}
              className="inline-flex h-8 items-center gap-1.5 rounded-control border border-border bg-transparent px-2.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary"
            >
              <RefreshCw size={13} strokeWidth={1.75} aria-hidden="true" />
              Retry
            </button>
          }
        />
      )}

      {mode === "replay" && state === "not-found" && (
        <EmptyState
          icon={FileWarning}
          title={`No stored HTML for this page (${variant === "static" ? "static pre-JS" : "rendered"} variant)`}
          description="The crawler didn't save this variant for this page — it may only exist as the other variant, or this page failed before capture."
        />
      )}

      {mode === "replay" && state === "loaded" && payload?.empty && (
        <EmptyState icon={FileWarning} title="Captured file is empty" description="The crawler stored a 0-byte file for this page/variant." />
      )}

      {mode === "replay" && state === "loaded" && payload && !payload.empty && (
        <div className="overflow-hidden rounded-card border border-border bg-white" style={{ height: "70vh" }}>
          <iframe
            key={`${variant}-${styled}`}
            srcDoc={payload.html}
            sandbox={SANDBOX}
            referrerPolicy="no-referrer"
            title={`Captured HTML replay (${variant}) for ${pageUrl}`}
            className="h-full w-full"
          />
        </div>
      )}
    </div>
  );
}
