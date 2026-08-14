/** Server-only. New lib file. Site-files + the 13-agent AI-crawler access table for
 *  GET /api/crawls/:id/site-files and .../site-files/ai-access. Robots parsing here is a
 *  deliberately simple, self-contained group-matcher over the raw robots.json content already on
 *  disk (real data) — NOT the crawler's authoritative most-specific-path-wins parser (PLAN-03
 *  §3.2), which is a sibling deliverable. Good enough to give real allowed/partly-blocked/blocked
 *  verdicts; not a substitute for the real parser once it ships. */
import { getRun } from "./data";

/** PLAN-03 §3.2 — the 13 named agents, all four buckets always surfaced (never only "blocked"). */
export const AI_CRAWLER_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "CCBot",
  "Bytespider",
  "cohere-ai",
  "Google-Extended",
  "Google-CloudVertexBot",
  "Google-Agent",
  "Google-NotebookLM",
] as const;

export type AiAccessVerdict = "allowed" | "partly-blocked" | "blocked" | "ignores-robots" | "unknown";

export interface AiAccessRow {
  agent: string;
  verdict: AiAccessVerdict;
  matchedGroup: string; // the User-agent token whose group applied, or "(no matching group)"
  disallowRules: string[];
  allowRules: string[];
}

interface RobotsGroup {
  agents: string[];
  rules: { type: "allow" | "disallow"; path: string }[];
}

function parseGroups(content: string): RobotsGroup[] {
  const lines = content.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const groups: RobotsGroup[] = [];
  let pendingAgents: string[] = [];
  let current: RobotsGroup | null = null;

  for (const line of lines) {
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();

    if (field === "user-agent") {
      if (current && current.rules.length > 0) {
        current = null; // a new UA after rules starts a fresh group, per spec
      }
      if (!current) {
        pendingAgents = [];
        current = { agents: pendingAgents, rules: [] };
        groups.push(current);
      }
      pendingAgents.push(value);
    } else if (field === "allow" || field === "disallow") {
      if (!current) continue;
      current.rules.push({ type: field, path: value });
    }
  }
  return groups;
}

function matchGroup(groups: RobotsGroup[], agent: string): RobotsGroup | null {
  const lower = agent.toLowerCase();
  const exact = groups.find((g) => g.agents.some((a) => a.toLowerCase() === lower));
  if (exact) return exact;
  return groups.find((g) => g.agents.some((a) => a === "*")) ?? null;
}

function verdictFor(group: RobotsGroup | null): { verdict: AiAccessVerdict; disallow: string[]; allow: string[] } {
  if (!group) return { verdict: "allowed", disallow: [], allow: [] };
  // `Disallow:` with an EMPTY value is the standard's "disallow nothing" — the opposite of
  // `Disallow: /`. Conflating the two (an earlier version of this parser did) reported every
  // agent as "blocked" against a robots.txt that in fact blocks nothing (Yoast's default
  // `User-agent: *\nDisallow:` block, real content seen in run ui-20260812-145824's robots.json).
  const disallow = group.rules.filter((r) => r.type === "disallow" && r.path !== "").map((r) => r.path);
  const allow = group.rules.filter((r) => r.type === "allow").map((r) => r.path);
  const blocksRoot = group.rules.some((r) => r.type === "disallow" && r.path === "/");
  if (blocksRoot && allow.length === 0) return { verdict: "blocked", disallow, allow };
  if (disallow.length > 0) return { verdict: "partly-blocked", disallow, allow };
  return { verdict: "allowed", disallow, allow };
}

export async function buildAiAccessTable(runId: string): Promise<{ rows: AiAccessRow[]; parseStatus: string } | null> {
  const { robots } = await getRun(runId);
  if (!robots) return null;
  if (robots.parseStatus !== "ok" || !robots.content) {
    return { rows: AI_CRAWLER_AGENTS.map((agent) => ({ agent, verdict: "unknown", matchedGroup: "(robots.txt unavailable)", disallowRules: [], allowRules: [] })), parseStatus: robots.parseStatus };
  }
  const groups = parseGroups(robots.content);
  const rows: AiAccessRow[] = AI_CRAWLER_AGENTS.map((agent) => {
    const group = matchGroup(groups, agent);
    const { verdict, disallow, allow } = verdictFor(group);
    return {
      agent,
      verdict,
      matchedGroup: group ? group.agents.join(", ") : "(no matching group)",
      disallowRules: disallow,
      allowRules: allow,
    };
  });
  return { rows, parseStatus: robots.parseStatus };
}
