"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Globe, Info, Link2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { FormField } from "@/components/new-crawl/FormField";
import { FormSection } from "@/components/new-crawl/FormSection";
import { RenderModeCards } from "@/components/new-crawl/RenderModeCards";
import { ScopeCards, type CrawlScope } from "@/components/new-crawl/ScopeCards";
import { RobotsSwitch } from "@/components/new-crawl/RobotsSwitch";
import { AuthSection, type AuthMethod } from "@/components/new-crawl/AuthSection";
import { ProgressPanel } from "@/components/new-crawl/ProgressPanel";
import type { CrawlStatusResponse, PanelState, RenderMode } from "@/components/new-crawl/types";

// --max-depth live-verified 2026-08-11 (depth-1 target-site run: 21 pages vs 25, maxDepthSeen 1).
const MAX_DEPTH_SUPPORTED = true;

function validateUrl(v: string): string | null {
  if (!v.trim()) return "Start URL is required.";
  try {
    const parsed = new URL(v.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "URL must start with http:// or https://.";
  } catch {
    return "Enter a full URL, e.g. https://example.com.";
  }
  return null;
}

function validateMaxPages(v: string): string | null {
  if (!v.trim()) return "Enter a number.";
  const n = Number(v);
  if (Number.isNaN(n) || !Number.isInteger(n)) return "Must be a whole number.";
  if (n < 1 || n > 1000000) return "Must be between 1 and 1,000,000.";
  return null;
}

function validateMaxDepth(v: string): string | null {
  if (!v.trim()) return null;
  const n = Number(v);
  if (Number.isNaN(n) || !Number.isInteger(n)) return "Must be a whole number.";
  if (n < 0) return "Must be 0 or greater.";
  return null;
}

export default function NewCrawlPage() {
  const [panelState, setPanelState] = useState<PanelState>("form");
  const [url, setUrl] = useState("");
  const [maxPagesInput, setMaxPagesInput] = useState("100");
  const [scope, setScope] = useState<CrawlScope>("limited");
  const allPages = scope === "all";
  const [maxDepthInput, setMaxDepthInput] = useState("");
  const [respectRobots, setRespectRobots] = useState(true);
  const [render, setRender] = useState<RenderMode>("auto");
  const [aliases, setAliases] = useState("");

  const [authEnabled, setAuthEnabled] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("none");
  const [basicUsername, setBasicUsername] = useState("");
  const [basicPassword, setBasicPassword] = useState("");
  const [cookie, setCookie] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const [skipLogoutDestructive, setSkipLogoutDestructive] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [urlError, setUrlError] = useState<string | null>(null);
  const [maxPagesError, setMaxPagesError] = useState<string | null>(null);
  const [maxDepthError, setMaxDepthError] = useState<string | null>(null);
  const [basicUsernameError, setBasicUsernameError] = useState<string | null>(null);
  const [basicPasswordError, setBasicPasswordError] = useState<string | null>(null);
  const [cookieError, setCookieError] = useState<string | null>(null);
  const [headerNameError, setHeaderNameError] = useState<string | null>(null);
  const [headerValueError, setHeaderValueError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<CrawlStatusResponse | null>(null);

  const router = useRouter();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  function resetForm() {
    setPanelState("form");
    setFormError(null);
    setRunId(null);
    setStatus(null);
    stopPolling();
  }

  async function poll(id: string) {
    try {
      const res = await fetch(`/api/crawls/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data: CrawlStatusResponse = await res.json();
      setStatus(data);
      if (data.state === "done") {
        setPanelState("done");
        stopPolling();
      } else if (data.state === "failed") {
        setPanelState("failed");
        stopPolling();
      }
    } catch {
      // transient network hiccup — next 2s tick retries
    }
  }

  /** Mirrors the crawl-runner.ts server-side check — never trust the client alone. */
  function validateAuth(): boolean {
    setBasicUsernameError(null);
    setBasicPasswordError(null);
    setCookieError(null);
    setHeaderNameError(null);
    setHeaderValueError(null);
    if (!authEnabled) return true;

    let ok = true;
    if (authMethod === "basic") {
      if (!basicUsername.trim()) {
        setBasicUsernameError("Username is required.");
        ok = false;
      }
      if (!basicPassword.trim()) {
        setBasicPasswordError("Password is required.");
        ok = false;
      }
    } else if (authMethod === "cookie") {
      if (!cookie.trim()) {
        setCookieError("Paste the Cookie header value.");
        ok = false;
      }
    } else if (authMethod === "header") {
      if (!headerName.trim()) {
        setHeaderNameError("Header name is required.");
        ok = false;
      }
      if (!headerValue.trim()) {
        setHeaderValueError("Header value is required.");
        ok = false;
      }
    }
    return ok;
  }

  async function submit(startUrl: string) {
    const uErr = validateUrl(startUrl);
    const pErr = allPages ? null : validateMaxPages(maxPagesInput);
    const dErr = validateMaxDepth(maxDepthInput);
    setUrlError(uErr);
    setMaxPagesError(pErr);
    setMaxDepthError(dErr);
    const authOk = validateAuth();

    if (uErr || pErr || dErr || !authOk) {
      setFormError("Fix the highlighted fields before starting.");
      if (uErr) urlInputRef.current?.focus();
      return;
    }
    setFormError(null);
    setPanelState("starting");

    const aliasList = aliases
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);

    // auth/safety null when the login toggle is off or method is "none" — an anonymous crawl
    // never sends credentials, and the server derives its own (permissive) safety defaults.
    const auth =
      authEnabled && authMethod !== "none"
        ? {
            basic: authMethod === "basic" ? { username: basicUsername.trim(), password: basicPassword } : null,
            cookie: authMethod === "cookie" ? cookie.trim() : null,
            headers: authMethod === "header" ? { [headerName.trim()]: headerValue } : {},
          }
        : null;
    const safety = auth ? { denyLogout: skipLogoutDestructive, denyDestructive: skipLogoutDestructive, excludePatterns: [] } : null;

    try {
      const res = await fetch("/api/crawls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startUrl: startUrl.trim(),
          maxPages: allPages ? 0 : Number(maxPagesInput),
          maxDepth: MAX_DEPTH_SUPPORTED && maxDepthInput.trim() ? Number(maxDepthInput) : null,
          respectRobots,
          render,
          aliases: aliasList,
          auth,
          safety,
        }),
      });
      const data = await res.json();

      if (res.status === 409) {
        setFormError(`A crawl is already running (${data.runningRunId}). Wait for it to finish.`);
        setPanelState("form");
        return;
      }
      if (!res.ok) {
        setFormError(data.error ?? "Failed to start crawl.");
        setPanelState("form");
        return;
      }

      setRunId(data.runId);
      setPanelState("running");
      void poll(data.runId);
      pollRef.current = setInterval(() => void poll(data.runId), 2000);
    } catch {
      setFormError("Network error starting the crawl. Check the dashboard server is running.");
      setPanelState("form");
    }
  }

  function viewRun() {
    if (!runId) return;
    router.push(`/?run=${encodeURIComponent(runId)}`);
    router.refresh();
  }

  const locked = panelState !== "form";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">New crawl</h1>
        <p className="mt-1 max-w-2xl text-sm text-secondary">
          Paste any website link below. The dashboard spawns a real crawler run against it — same engine as{" "}
          <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">npm run crawl</code> — and streams live progress here.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <form
            className="flex flex-col gap-6"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit(url);
            }}
          >
            <FormSection label="Target">
              <FormField htmlFor="crawl-url" label="Start URL" error={urlError}>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-control border bg-canvas px-3 py-2 focus-within:ring-2 focus-within:ring-primary",
                    urlError ? "border-danger" : "border-border",
                  )}
                >
                  <Globe size={14} strokeWidth={1.75} className="text-faint" aria-hidden="true" />
                  <input
                    ref={urlInputRef}
                    id="crawl-url"
                    type="text"
                    inputMode="url"
                    placeholder="https://example.com"
                    value={url}
                    disabled={locked}
                    aria-invalid={!!urlError}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      if (urlError) setUrlError(null);
                    }}
                    onBlur={(e) => setUrlError(validateUrl(e.target.value))}
                    className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint disabled:opacity-50"
                  />
                </div>
              </FormField>

              <FormField
                htmlFor="crawl-aliases"
                label={
                  <>
                    Host aliases <span className="text-faint">(optional, comma-separated)</span>
                  </>
                }
              >
                <div className="flex items-center gap-2 rounded-control border border-border bg-canvas px-3 py-2 focus-within:ring-2 focus-within:ring-primary">
                  <Link2 size={14} strokeWidth={1.75} className="text-faint" aria-hidden="true" />
                  <input
                    id="crawl-aliases"
                    type="text"
                    placeholder="staging.example.com"
                    value={aliases}
                    disabled={locked}
                    onChange={(e) => setAliases(e.target.value)}
                    className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint disabled:opacity-50"
                  />
                </div>
              </FormField>
            </FormSection>

            <FormSection label="Limits" className="border-t border-border pt-5">
              <FormField
                htmlFor="crawl-url"
                label="How many pages?"
                error={allPages ? null : maxPagesError}
                hint={
                  allPages
                    ? "The crawler follows every internal link until the whole site is covered — external sites stay polite automatically (rate-limited)."
                    : "Set a page budget. Your own site? Pick Entire site above."
                }
              >
                <ScopeCards
                  value={scope}
                  onChange={(next) => {
                    setScope(next);
                    if (next === "all") setMaxPagesError(null);
                  }}
                  disabled={locked}
                  limitedControl={
                    <div className="flex items-center gap-2 rounded-control border border-border bg-canvas px-2.5 py-1.5">
                      <input
                        id="crawl-max-pages"
                        type="number"
                        min={1}
                        max={1000000}
                        value={maxPagesInput}
                        disabled={locked}
                        aria-invalid={!!maxPagesError}
                        aria-label="Maximum pages"
                        onChange={(e) => {
                          setMaxPagesInput(e.target.value);
                          if (maxPagesError) setMaxPagesError(null);
                        }}
                        onBlur={(e) => setMaxPagesError(validateMaxPages(e.target.value))}
                        className="w-24 bg-transparent text-sm font-medium text-foreground outline-none disabled:opacity-50"
                      />
                      <span className="text-[11px] text-faint">pages max</span>
                    </div>
                  }
                />
              </FormField>

              <div className="mt-4">
                <FormField
                  htmlFor="crawl-max-depth"
                  label={
                    <>
                      Max depth <span className="text-faint">(optional)</span>
                    </>
                  }
                  error={maxDepthError}
                  hint={MAX_DEPTH_SUPPORTED ? "How many link-hops from the start URL." : "How many link-hops from the start URL — coming in integration."}
                  className="w-32"
                >
                  <input
                    id="crawl-max-depth"
                    type="number"
                    min={0}
                    placeholder="unlimited"
                    value={maxDepthInput}
                    disabled={locked || !MAX_DEPTH_SUPPORTED}
                    aria-invalid={!!maxDepthError}
                    onChange={(e) => {
                      setMaxDepthInput(e.target.value);
                      if (maxDepthError) setMaxDepthError(null);
                    }}
                    onBlur={(e) => setMaxDepthError(validateMaxDepth(e.target.value))}
                    className={cn(
                      "w-32 rounded-control border bg-canvas px-3 py-2 text-sm text-foreground outline-none placeholder:text-faint focus:ring-2 focus:ring-primary disabled:opacity-50",
                      maxDepthError ? "border-danger" : "border-border",
                    )}
                  />
                </FormField>
              </div>
            </FormSection>

            <FormSection label="Engine" className="border-t border-border pt-5">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-secondary">Render mode</p>
                <RenderModeCards value={render} onChange={setRender} disabled={locked} />
                <p className="flex items-start gap-1.5 text-[11px] text-faint">
                  <Info size={12} strokeWidth={1.75} className="mt-[1px] shrink-0" aria-hidden="true" />
                  Pages are fetched over HTTP first; when a page can&apos;t be read that way (JS-only content or blocked responses), the crawler
                  automatically retries in headless Chromium (Playwright).
                </p>
              </div>

              <RobotsSwitch checked={respectRobots} onChange={setRespectRobots} disabled={locked} />
            </FormSection>

            <FormSection label="Access" className="border-t border-border pt-5">
              <AuthSection
                enabled={authEnabled}
                onEnabledChange={setAuthEnabled}
                disabled={locked}
                method={authMethod}
                onMethodChange={setAuthMethod}
                basicUsername={basicUsername}
                onBasicUsernameChange={(v) => {
                  setBasicUsername(v);
                  if (basicUsernameError) setBasicUsernameError(null);
                }}
                basicUsernameError={basicUsernameError}
                basicPassword={basicPassword}
                onBasicPasswordChange={(v) => {
                  setBasicPassword(v);
                  if (basicPasswordError) setBasicPasswordError(null);
                }}
                basicPasswordError={basicPasswordError}
                cookie={cookie}
                onCookieChange={(v) => {
                  setCookie(v);
                  if (cookieError) setCookieError(null);
                }}
                cookieError={cookieError}
                headerName={headerName}
                onHeaderNameChange={(v) => {
                  setHeaderName(v);
                  if (headerNameError) setHeaderNameError(null);
                }}
                headerNameError={headerNameError}
                headerValue={headerValue}
                onHeaderValueChange={(v) => {
                  setHeaderValue(v);
                  if (headerValueError) setHeaderValueError(null);
                }}
                headerValueError={headerValueError}
                skipLogoutDestructive={skipLogoutDestructive}
                onSkipLogoutDestructiveChange={setSkipLogoutDestructive}
                advancedOpen={advancedOpen}
                onAdvancedOpenChange={setAdvancedOpen}
              />
            </FormSection>

            <div className="flex flex-col gap-2">
              {formError && (
                <div className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger" role="alert">
                  <AlertTriangle size={14} strokeWidth={1.75} className="mt-[1px] shrink-0" aria-hidden="true" />
                  <span>{formError}</span>
                </div>
              )}

              {panelState === "form" && (
                <Button type="submit" variant="primary" className="w-full">
                  Start crawl
                </Button>
              )}
              {(panelState === "starting" || panelState === "running") && (
                <Button type="button" variant="primary" className="w-full" disabled>
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                  {panelState === "starting" ? "Spawning…" : "Crawl in progress…"}
                </Button>
              )}
              {(panelState === "done" || panelState === "failed") && (
                <Button type="button" variant="outline" className="w-full" onClick={resetForm}>
                  {panelState === "done" ? "Start another crawl" : "Edit & retry"}
                </Button>
              )}
            </div>
          </form>
        </Card>

        <Card className="flex flex-col gap-4">
          <ProgressPanel panelState={panelState} url={url} runId={runId} status={status} onViewRun={viewRun} onRetry={resetForm} />
        </Card>
      </div>
    </div>
  );
}
