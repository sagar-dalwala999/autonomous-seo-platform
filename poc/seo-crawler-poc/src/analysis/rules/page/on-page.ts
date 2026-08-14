/** Title / meta description / heading rule pack. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { issueFor } from "./shared";

const isBlank = (s: string | null): boolean => s === null || s.trim() === "";

/* Screaming Frog's published minimums, used when a config predates these thresholds. */
const DEFAULT_TITLE_MIN_PX = 200;
const DEFAULT_DESC_MIN_PX = 400;
const DEFAULT_URL_MAX_CHARS = 115;

function urlTooLong(): PageRule {
  const meta: RuleMeta = {
    id: "url-too-long",
    category: "on-page",
    defaultSeverity: "notice",
    description: "URL exceeds the configured maximum character length (Screaming Frog flags over 115).",
    howToFix: "Shorten the URL slug; long URLs are truncated in search results and harder to share.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const url = page.normalizedUrl ?? page.url;
      const max = config.thresholds.urlMaxChars ?? DEFAULT_URL_MAX_CHARS;
      if (url.length <= max) return [];
      return [
        issueFor(meta, config, page, {
          message: `URL is ${url.length} characters.`,
          evidence: [{ field: "normalizedUrl", value: url }],
          threshold: `url ${url.length} chars > max ${max}`,
        }),
      ];
    },
  };
}

function titleMissing(): PageRule {
  const meta: RuleMeta = {
    id: "title-missing",
    category: "on-page",
    defaultSeverity: "error",
    description: "Page has no <title> tag (or it is empty).",
    howToFix: "Add a unique, descriptive <title> tag between the configured min/max length.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!isBlank(page.title)) return [];
      return [issueFor(meta, config, page, { message: "Title is missing.", evidence: [{ field: "title", value: page.title }] })];
    },
  };
}

function titleTooShort(): PageRule {
  const meta: RuleMeta = {
    id: "title-too-short",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Title is shorter than the configured minimum length.",
    howToFix: "Expand the title to fall within the configured char/pixel-width range.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (isBlank(page.title)) return []; // covered by title-missing
      const len = page.title!.length;
      const px = page.pixelWidths?.titlePx ?? null;
      const minPx = config.thresholds.titleMinPx ?? DEFAULT_TITLE_MIN_PX;
      const underChars = len < config.thresholds.titleMinChars;
      // Pixel width is the real SERP constraint: "IIII" and "WWWW" are the same char count.
      const underPx = px !== null && px < minPx;
      if (!underChars && !underPx) return [];
      const parts: string[] = [];
      if (underChars) parts.push(`title ${len} chars < min ${config.thresholds.titleMinChars}`);
      if (underPx) parts.push(`title ~${px}px < min ${minPx}px`);
      return [
        issueFor(meta, config, page, {
          message: underChars ? `Title is only ${len} characters.` : `Title is only ~${px}px wide.`,
          evidence: [
            { field: "title", value: page.title },
            ...(px !== null ? [{ field: "pixelWidths.titlePx", value: px }] : []),
          ],
          threshold: parts.join("; "),
        }),
      ];
    },
  };
}

function titleTooLong(): PageRule {
  const meta: RuleMeta = {
    id: "title-too-long",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Title exceeds the configured maximum length (char count and/or estimated pixel width).",
    howToFix: "Shorten the title so it is not truncated in search results.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (isBlank(page.title)) return [];
      const len = page.title!.length;
      const px = page.pixelWidths?.titlePx ?? null;
      const overChars = len > config.thresholds.titleMaxChars;
      const overPx = px !== null && px > config.thresholds.titleMaxPx;
      if (!overChars && !overPx) return [];
      const parts: string[] = [];
      if (overChars) parts.push(`title ${len} chars > max ${config.thresholds.titleMaxChars}`);
      if (overPx) parts.push(`title ~${px}px > max ${config.thresholds.titleMaxPx}px`);
      return [
        issueFor(meta, config, page, {
          message: `Title is too long (${len} characters).`,
          evidence: [
            { field: "title", value: page.title },
            ...(px !== null ? [{ field: "pixelWidths.titlePx", value: px }] : []),
          ],
          threshold: parts.join("; "),
        }),
      ];
    },
  };
}

function titleMultiple(): PageRule {
  const meta: RuleMeta = {
    id: "title-multiple",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Page markup contains more than one <title> tag.",
    howToFix: "Keep exactly one <title> tag in <head>.",
    dataRequirements: ["titles"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.titles === undefined) return null;
      if (page.titles.length <= 1) return [];
      return [
        issueFor(meta, config, page, {
          message: `${page.titles.length} <title> tags found on this page.`,
          evidence: [{ field: "titles", value: page.titles }],
        }),
      ];
    },
  };
}

function descMissing(): PageRule {
  const meta: RuleMeta = {
    id: "meta-description-missing",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Page has no meta description (or it is empty).",
    howToFix: "Add a unique meta description within the configured char/pixel-width range.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!isBlank(page.metaDescription)) return [];
      return [
        issueFor(meta, config, page, {
          message: "Meta description is missing.",
          evidence: [{ field: "metaDescription", value: page.metaDescription }],
        }),
      ];
    },
  };
}

function descTooShort(): PageRule {
  const meta: RuleMeta = {
    id: "meta-description-too-short",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Meta description is shorter than the configured minimum length.",
    howToFix: "Expand the meta description to fall within the configured char/pixel-width range.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (isBlank(page.metaDescription)) return [];
      const len = page.metaDescription!.length;
      const px = page.pixelWidths?.metaDescriptionPx ?? null;
      const minPx = config.thresholds.descMinPx ?? DEFAULT_DESC_MIN_PX;
      const underChars = len < config.thresholds.descMinChars;
      const underPx = px !== null && px < minPx;
      if (!underChars && !underPx) return [];
      const parts: string[] = [];
      if (underChars) parts.push(`description ${len} chars < min ${config.thresholds.descMinChars}`);
      if (underPx) parts.push(`description ~${px}px < min ${minPx}px`);
      return [
        issueFor(meta, config, page, {
          message: underChars ? `Meta description is only ${len} characters.` : `Meta description is only ~${px}px wide.`,
          evidence: [
            { field: "metaDescription", value: page.metaDescription },
            ...(px !== null ? [{ field: "pixelWidths.metaDescriptionPx", value: px }] : []),
          ],
          threshold: parts.join("; "),
        }),
      ];
    },
  };
}

function descTooLong(): PageRule {
  const meta: RuleMeta = {
    id: "meta-description-too-long",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Meta description exceeds the configured maximum length (char count and/or estimated pixel width).",
    howToFix: "Shorten the meta description so it is not truncated in search results.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (isBlank(page.metaDescription)) return [];
      const len = page.metaDescription!.length;
      const px = page.pixelWidths?.metaDescriptionPx ?? null;
      const overChars = len > config.thresholds.descMaxChars;
      const overPx = px !== null && px > config.thresholds.descMaxPx;
      if (!overChars && !overPx) return [];
      const parts: string[] = [];
      if (overChars) parts.push(`description ${len} chars > max ${config.thresholds.descMaxChars}`);
      if (overPx) parts.push(`description ~${px}px > max ${config.thresholds.descMaxPx}px`);
      return [
        issueFor(meta, config, page, {
          message: `Meta description is too long (${len} characters).`,
          evidence: [{ field: "metaDescription", value: page.metaDescription }],
          threshold: parts.join("; "),
        }),
      ];
    },
  };
}

function descMultiple(): PageRule {
  const meta: RuleMeta = {
    id: "meta-description-multiple",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Page markup contains more than one meta description tag.",
    howToFix: "Keep exactly one meta description tag in <head>.",
    dataRequirements: ["metaDescriptions"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.metaDescriptions === undefined) return null;
      if (page.metaDescriptions.length <= 1) return [];
      return [
        issueFor(meta, config, page, {
          message: `${page.metaDescriptions.length} meta description tags found on this page.`,
          evidence: [{ field: "metaDescriptions", value: page.metaDescriptions }],
        }),
      ];
    },
  };
}

function h1Missing(): PageRule {
  const meta: RuleMeta = {
    id: "h1-missing",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Page has no H1 heading.",
    howToFix: "Add a single, descriptive H1 that reflects the page's primary topic.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.headings.h1.length > 0) return [];
      return [issueFor(meta, config, page, { message: "No H1 heading found.", evidence: [{ field: "headings.h1", value: [] }] })];
    },
  };
}

function h1Multiple(): PageRule {
  const meta: RuleMeta = {
    id: "h1-multiple",
    category: "on-page",
    defaultSeverity: "notice",
    description: "Page has more than one H1 heading.",
    howToFix: "Keep a single H1 per page; demote extras to H2/H3.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.headings.h1.length <= 1) return [];
      return [
        issueFor(meta, config, page, {
          message: `${page.headings.h1.length} H1 headings found.`,
          evidence: [{ field: "headings.h1", value: page.headings.h1 }],
        }),
      ];
    },
  };
}

function headingHierarchySkip(): PageRule {
  const meta: RuleMeta = {
    id: "heading-hierarchy-skip",
    category: "on-page",
    defaultSeverity: "notice",
    description: "Page uses H3 headings with no H2 present — the hierarchy skips a level.",
    howToFix: "Insert H2 headings so the outline steps down one level at a time.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.headings.h3.length === 0 || page.headings.h2.length > 0) return [];
      return [
        issueFor(meta, config, page, {
          message: "H3 headings present with no H2 — heading hierarchy skips a level.",
          evidence: [
            { field: "headings.h2", value: page.headings.h2 },
            { field: "headings.h3", value: page.headings.h3 },
          ],
        }),
      ];
    },
  };
}

export function onPageRules(): PageRule[] {
  return [
    urlTooLong(),
    titleMissing(),
    titleTooShort(),
    titleTooLong(),
    titleMultiple(),
    descMissing(),
    descTooShort(),
    descTooLong(),
    descMultiple(),
    h1Missing(),
    h1Multiple(),
    headingHierarchySkip(),
  ];
}
