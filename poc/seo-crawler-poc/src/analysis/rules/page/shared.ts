/** Shared helpers for page rule modules — not a rule pack itself. */
import type { CrawledPage, Issue, IssueEvidence, IssueSeverity, RuleMeta } from "../../../models/types";
import type { AnalysisConfig } from "../../config";

export function severityFor(meta: RuleMeta, config: AnalysisConfig): IssueSeverity {
  return config.rules[meta.id]?.severity ?? meta.defaultSeverity;
}

/** Builds a page-scope Issue. pageId is backfilled by the engine (rules don't know their own storage filename). */
export function issueFor(
  meta: RuleMeta,
  config: AnalysisConfig,
  page: CrawledPage,
  opts: { message: string; evidence: IssueEvidence[]; threshold?: string },
): Issue {
  const issue: Issue = {
    ruleId: meta.id,
    category: meta.category,
    severity: severityFor(meta, config),
    scope: "page",
    url: page.url,
    pageId: null,
    message: opts.message,
    howToFix: meta.howToFix,
    evidence: opts.evidence,
  };
  if (opts.threshold) issue.threshold = opts.threshold;
  return issue;
}
