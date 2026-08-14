"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Server-side accepted-risk store (POST/DELETE /api/mutes, backed by
 * ../seo-crawler-poc/src/analysis/priority/muteStore.ts's per-site mutes.json). Findings are never
 * deleted: a mute flips the finding's status to "muted" and the health score recomputes — this
 * hook's job is just to call the API, wait for the reanalysis it triggers, then refresh the server
 * component so the new report.mutedRuleIds/findings/healthScore flow back down as props. No local
 * mute list is kept — `mutedRuleIds` below IS the server's answer, read from the current report.
 */
export function useMutes(runId: string, mutedRuleIds: string[]) {
  const router = useRouter();
  const [pending, setPending] = useState<Set<string>>(new Set());

  const isMuted = useCallback((ruleId: string) => mutedRuleIds.includes(ruleId), [mutedRuleIds]);
  const isPending = useCallback((ruleId: string) => pending.has(ruleId), [pending]);

  const call = useCallback(
    async (method: "POST" | "DELETE", ruleId: string, note?: string) => {
      setPending((prev) => new Set(prev).add(ruleId));
      try {
        const res = await fetch("/api/mutes", {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, ruleId, note }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message ?? `${method} /api/mutes failed (${res.status})`);
        }
        router.refresh();
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(ruleId);
          return next;
        });
      }
    },
    [runId, router],
  );

  const mute = useCallback((ruleId: string, note: string) => void call("POST", ruleId, note), [call]);
  const unmute = useCallback((ruleId: string) => void call("DELETE", ruleId), [call]);

  return { mutedRuleIds, isMuted, isPending, mute, unmute };
}
