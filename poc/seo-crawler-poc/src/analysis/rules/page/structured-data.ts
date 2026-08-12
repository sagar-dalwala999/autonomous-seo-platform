/** JSON-LD structured-data rule pack. */
import type { Issue, RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { issueFor } from "./shared";

/**
 * POC subset of Google rich-result required properties (not the full spec — e.g. real Product
 * rich results also weigh aggregateRating/review, real FAQPage requires each Question to carry
 * acceptedAnswer). Covers the single top-level property most likely to break eligibility.
 */
const REQUIRED_PROPS: Record<string, string[]> = {
  Product: ["name", "offers"],
  Article: ["headline"],
  FAQPage: ["mainEntity"],
};

/**
 * Narrow "type-vs-context" heuristic: a curated set of topic-specific schema.org types compared
 * against URL path keywords. Not a content classifier — flags only when the URL gives no hint at
 * all that the topic matches (e.g. Recipe markup on a URL with no "recipe"/"food"/"cook" segment).
 */
const TYPE_URL_HINTS: Record<string, string[]> = {
  Recipe: ["recipe", "recipes", "cook", "food"],
  Event: ["event", "events"],
  JobPosting: ["job", "jobs", "career", "careers"],
  Course: ["course", "courses"],
  Movie: ["movie", "movies", "film"],
  Book: ["book", "books"],
};

function typeOf(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const t = (parsed as Record<string, unknown>)["@type"];
  if (typeof t === "string") return t;
  if (Array.isArray(t) && typeof t[0] === "string") return t[0];
  return null;
}

function parseError(): PageRule {
  const meta: RuleMeta = {
    id: "structured-data-parse-error",
    category: "structured-data",
    defaultSeverity: "error",
    description: "A JSON-LD block on this page failed to parse.",
    howToFix: "Fix the malformed JSON so search engines can read the structured data.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const offenders = page.structuredData.map((sd, i) => ({ sd, i })).filter(({ sd }) => sd.parseError !== null);
      if (offenders.length === 0) return [];
      return offenders.map(({ sd, i }) =>
        issueFor(meta, config, page, {
          message: `Invalid JSON-LD: ${sd.parseError}`,
          evidence: [
            { field: `structuredData[${i}].parseError`, value: sd.parseError },
            { field: `structuredData[${i}].raw`, value: sd.raw },
          ],
        }),
      );
    },
  };
}

function missingRequiredProperty(): PageRule {
  const meta: RuleMeta = {
    id: "structured-data-missing-required-property",
    category: "structured-data",
    defaultSeverity: "warning",
    description: "A structured-data block is missing a property Google requires for that type's rich result (POC subset — see module doc comment).",
    howToFix: "Add the missing property to the JSON-LD block.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const issues: Issue[] = [];
      for (let i = 0; i < page.structuredData.length; i++) {
        const sd = page.structuredData[i]!;
        if (sd.parseError !== null || sd.parsed === null || typeof sd.parsed !== "object") continue;
        const type = typeOf(sd.parsed);
        if (type === null || !(type in REQUIRED_PROPS)) continue;
        const obj = sd.parsed as Record<string, unknown>;
        const missing = REQUIRED_PROPS[type]!.filter((prop) => obj[prop] === undefined);
        if (missing.length === 0) continue;
        issues.push(
          issueFor(meta, config, page, {
            message: `${type} structured data is missing required propert${missing.length === 1 ? "y" : "ies"}: ${missing.join(", ")}.`,
            evidence: missing.map((prop) => ({ field: `structuredData[${i}].parsed.${prop}`, value: null })),
            threshold: `${type} requires: ${REQUIRED_PROPS[type]!.join(", ")}`,
          }),
        );
      }
      return issues;
    },
  };
}

function typeMismatch(): PageRule {
  const meta: RuleMeta = {
    id: "structured-data-type-mismatch",
    category: "structured-data",
    defaultSeverity: "warning",
    description: "Structured-data @type doesn't match the page's URL context (heuristic — see module doc comment).",
    howToFix: "Use the schema.org type that matches this page's actual content, or remove the mismatched block.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const issues: Issue[] = [];
      for (let i = 0; i < page.structuredData.length; i++) {
        const sd = page.structuredData[i]!;
        if (sd.parseError !== null || sd.parsed === null) continue;
        const type = typeOf(sd.parsed);
        if (type === null) continue;
        const hints = TYPE_URL_HINTS[type];
        if (!hints) continue;
        const urlLower = page.url.toLowerCase();
        if (hints.some((hint) => urlLower.includes(hint))) continue;
        issues.push(
          issueFor(meta, config, page, {
            message: `${type} structured data present but the URL gives no "${type}" content signal.`,
            evidence: [{ field: `structuredData[${i}].parsed.@type`, value: type }],
          }),
        );
      }
      return issues;
    },
  };
}

export function structuredDataRules(): PageRule[] {
  return [parseError(), missingRequiredProperty(), typeMismatch()];
}
