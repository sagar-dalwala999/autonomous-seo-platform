import { Badge } from "@/components/ui/badge";
import { severityTone } from "@/lib/data-issues";
import type { IssueSeverity } from "@/lib/types";

const LABEL: Record<IssueSeverity, string> = { error: "Error", warning: "Warning", notice: "Notice" };

export function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  return <Badge tone={severityTone(severity)}>{LABEL[severity]}</Badge>;
}
