"use client";

import { Chip } from "@/components/ui/chip";
import type { AutomationLevel } from "@/lib/data-issue-extras";
import type { IssueSeverity } from "@/lib/types";

const SEVERITY_LABEL: Record<IssueSeverity, string> = { error: "Error", warning: "Warning", notice: "Notice" };
const AUTOMATION_LABEL: Record<AutomationLevel | "not-classified", string> = {
  "auto-safe": "Auto-safe",
  "auto-with-review": "Auto, review",
  "human-only": "Human-only",
  "not-classified": "Not classified",
};

interface Props {
  severities: { key: IssueSeverity; count: number }[];
  categories: string[];
  automationLevels: { key: AutomationLevel | "not-classified"; count: number }[];
  activeSeverity: IssueSeverity | null;
  activeCategory: string | null;
  activeAutomation: AutomationLevel | "not-classified" | null;
  automationDataAvailable: boolean;
  onSeverity: (v: IssueSeverity | null) => void;
  onCategory: (v: string | null) => void;
  onAutomation: (v: AutomationLevel | "not-classified" | null) => void;
}

/** Client-callback chip bar (URL sync happens one level up in issues-client.tsx) — severity + fix
 *  type (automation class) + category, every chip's count matching exactly what it filters to
 *  (own hard rule: chip counts must match their destinations). */
export function IssuesFilterChips({
  severities,
  categories,
  automationLevels,
  activeSeverity,
  activeCategory,
  activeAutomation,
  automationDataAvailable,
  onSeverity,
  onCategory,
  onAutomation,
}: Props) {
  const totalSeverity = severities.reduce((sum, s) => sum + s.count, 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-faint">Severity</span>
        <Chip active={activeSeverity === null} onClick={() => onSeverity(null)}>
          All <span className="tabular-nums">{totalSeverity}</span>
        </Chip>
        {severities.map((s) => (
          <Chip key={s.key} active={activeSeverity === s.key} onClick={() => onSeverity(activeSeverity === s.key ? null : s.key)}>
            {s.key === "error" && s.count > 0 && <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />}
            {SEVERITY_LABEL[s.key]} <span className="tabular-nums">{s.count}</span>
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-faint">Fix type</span>
        {!automationDataAvailable && (
          <span className="text-[11px] text-faint">(not classified for this run — run npm run analyze:automation)</span>
        )}
        <Chip active={activeAutomation === null} onClick={() => onAutomation(null)}>
          All
        </Chip>
        {automationLevels.map((a) => (
          <Chip key={a.key} active={activeAutomation === a.key} onClick={() => onAutomation(activeAutomation === a.key ? null : a.key)}>
            {AUTOMATION_LABEL[a.key]} <span className="tabular-nums">{a.count}</span>
          </Chip>
        ))}
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-faint">Area</span>
          <Chip active={activeCategory === null} onClick={() => onCategory(null)}>
            All
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={activeCategory === c} onClick={() => onCategory(activeCategory === c ? null : c)}>
              {c}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
