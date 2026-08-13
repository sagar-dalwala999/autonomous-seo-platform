import { describe, expect, it } from "vitest";
import { buildAiCrawlerTable, parseRobotsGroupsForReporting } from "../../../src/discovery/aiCrawlers";

const THIRTEEN_AGENTS = [
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
];

function ruleFor(agent: string, robotsText: string | null) {
  const table = buildAiCrawlerTable(robotsText);
  const rule = table.find((r) => r.agent === agent);
  if (!rule) throw new Error(`no rule for ${agent}`);
  return rule;
}

describe("buildAiCrawlerTable", () => {
  it("always reports exactly the 13 named agents, in order, each with a plain-English 'who'", () => {
    const table = buildAiCrawlerTable(null);
    expect(table.map((r) => r.agent)).toEqual(THIRTEEN_AGENTS);
    for (const rule of table) {
      expect(rule.who.length).toBeGreaterThan(10);
    }
  });

  it("verdict: allowed — no robots.txt at all means allow-all for every obeying agent", () => {
    const rule = ruleFor("GPTBot", null);
    expect(rule.access).toBe("allowed");
    expect(rule.matchedGroup).toBe("none");
    expect(rule.matchedGroupLine).toBeNull();
    expect(rule.matchedRules).toEqual([]);
  });

  it("verdict: allowed — wildcard group with an empty Disallow: still cites that line", () => {
    const text = "User-agent: *\nDisallow:\n";
    const rule = ruleFor("GPTBot", text);
    expect(rule.access).toBe("allowed");
    expect(rule.matchedGroup).toBe("*");
    expect(rule.matchedGroupLine).toBe(1);
    expect(rule.matchedRules).toEqual([{ directive: "Disallow", value: "", line: 2 }]);
  });

  it("verdict: blocked — Disallow: / with no Allow in the matched group", () => {
    const text = "User-agent: GPTBot\nDisallow: /\n";
    const rule = ruleFor("GPTBot", text);
    expect(rule.access).toBe("blocked");
    expect(rule.matchedGroup).toBe("GPTBot");
    expect(rule.matchedGroupLine).toBe(1);
    expect(rule.matchedRules).toEqual([{ directive: "Disallow", value: "/", line: 2 }]);
  });

  it("verdict: blocked — Disallow: /* (wildcard root) also counts as blocking root", () => {
    const rule = ruleFor("ClaudeBot", "User-agent: ClaudeBot\nDisallow: /*\n");
    expect(rule.access).toBe("blocked");
  });

  it("verdict: partly blocked — a non-root Disallow leaves some paths open", () => {
    const text = "User-agent: *\nDisallow: /guides/\n";
    const rule = ruleFor("PerplexityBot", text);
    expect(rule.access).toBe("partly blocked");
    expect(rule.matchedGroup).toBe("*");
    expect(rule.matchedRules).toEqual([{ directive: "Disallow", value: "/guides/", line: 2 }]);
  });

  it("verdict: partly blocked — Disallow: / plus an Allow in the same group is not a full block", () => {
    // Known simplification (ported intentionally, not full RFC 9309 specificity): any Allow rule
    // in a group that also disallows root downgrades the verdict from blocked to partly blocked.
    const text = "User-agent: GPTBot\nDisallow: /\nAllow: /public/\n";
    const rule = ruleFor("GPTBot", text);
    expect(rule.access).toBe("partly blocked");
    expect(rule.matchedRules).toEqual([{ directive: "Disallow", value: "/", line: 2 }]);
  });

  it("verdict: ignores robots.txt — ChatGPT-User, Google-Agent, Google-NotebookLM regardless of what robots.txt says", () => {
    const text = "User-agent: ChatGPT-User\nDisallow: /\n\nUser-agent: Google-Agent\nDisallow: /\n\nUser-agent: Google-NotebookLM\nDisallow: /\n";
    expect(ruleFor("ChatGPT-User", text).access).toBe("ignores robots.txt");
    expect(ruleFor("Google-Agent", text).access).toBe("ignores robots.txt");
    expect(ruleFor("Google-NotebookLM", text).access).toBe("ignores robots.txt");
    // The matched-group evidence is still populated even though it doesn't gate the agent.
    expect(ruleFor("ChatGPT-User", text).matchedGroup).toBe("ChatGPT-User");
  });

  it("ignores-robots.txt agents report 'ignores robots.txt' even with no robots.txt present", () => {
    expect(ruleFor("Google-Agent", null).access).toBe("ignores robots.txt");
  });

  it("a named group wins over the wildcard outright — not merged", () => {
    const text = "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow:\n";
    const gptbot = ruleFor("GPTBot", text);
    expect(gptbot.access).toBe("allowed");
    expect(gptbot.matchedGroup).toBe("GPTBot");

    const claude = ruleFor("ClaudeBot", text); // falls through to wildcard
    expect(claude.access).toBe("blocked");
    expect(claude.matchedGroup).toBe("*");
  });

  it("stacked consecutive User-agent lines share one rule set", () => {
    const text = "User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /no-ai/\n";
    const gptbot = ruleFor("GPTBot", text);
    const claude = ruleFor("ClaudeBot", text);
    expect(gptbot.access).toBe("partly blocked");
    expect(claude.access).toBe("partly blocked");
    expect(gptbot.matchedGroupLine).toBe(1);
    expect(claude.matchedGroupLine).toBe(2);
    expect(gptbot.matchedRules).toEqual([{ directive: "Disallow", value: "/no-ai/", line: 3 }]);
  });

  it("headline bug this ports the fix for: a boolean summary would say 0 blocked when 10 of 13 are partly blocked", () => {
    // Mirrors the seeded test site's actual robots.txt shape (User-agent: * / Disallow: /guides/).
    const table = buildAiCrawlerTable("User-agent: *\nDisallow: /guides/\n");
    const partlyBlocked = table.filter((r) => r.access === "partly blocked");
    const blocked = table.filter((r) => r.access === "blocked");
    const ignoring = table.filter((r) => r.access === "ignores robots.txt");
    expect(blocked).toHaveLength(0); // a boolean "blocked: 0" headline would be technically true and misleading
    expect(partlyBlocked).toHaveLength(10); // all obeying agents, none individually named
    expect(ignoring).toHaveLength(3);
  });
});

describe("parseRobotsGroupsForReporting", () => {
  it("ignores comments and blank lines when locating directive lines", () => {
    const text = "# comment\nUser-agent: * # trailing comment\n\nDisallow: /private/ # also a comment\n";
    const groups = parseRobotsGroupsForReporting(text);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.agents).toEqual(["*"]);
    expect(groups[0]!.rules).toEqual([{ directive: "Disallow", value: "/private/", line: 4 }]);
  });

  it("field names are case-insensitive; agent tokens are lower-cased for matching", () => {
    const text = "USER-AGENT: GPTBot\nDISALLOW: /x/\n";
    const groups = parseRobotsGroupsForReporting(text);
    expect(groups[0]!.agents).toEqual(["gptbot"]);
  });

  it("a rule line before any User-agent line is dropped, not attached to a phantom group", () => {
    const text = "Disallow: /orphan/\nUser-agent: *\nDisallow: /real/\n";
    const groups = parseRobotsGroupsForReporting(text);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rules).toEqual([{ directive: "Disallow", value: "/real/", line: 3 }]);
  });
});
