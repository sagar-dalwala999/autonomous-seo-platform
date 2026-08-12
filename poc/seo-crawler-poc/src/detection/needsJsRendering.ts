/** Slice S7 implements. Dependency-free string/regex heuristics — no cheerio, no DOM parse. */
import type { CrawlScope, ExtractionResult } from "../models/types";

/** Numeric knobs, exported so the POC report can cite exactly what fired. */
export const DETECTION_THRESHOLDS = {
  /** "tiny-body": meaningful markup (script/style stripped) below this many bytes. */
  tinyBodyBytes: 1536,
  /** "empty-app-shell": text left inside a matched mount root, in chars, to count as "empty". */
  emptyShellMaxInnerTextChars: 40,
  /** "low-text-ratio": visible-text bytes / total HTML bytes below this fraction. */
  lowTextRatio: 0.02,
  /** "low-text-ratio" only applies above this total-HTML-byte size (guards trivial docs). */
  lowTextRatioMinHtmlBytes: 500,
  /** "no-links-no-text": wordCount below this, combined with zero internal links. */
  noLinksNoTextMaxWordCount: 30,
  /** "spa-bundle-only": wordCount below this, combined with a bundler-pattern script src. */
  spaBundleMaxWordCount: 50,
  /** "script-dominant": script bytes / total bytes at or above this fraction. */
  scriptDominantMinFraction: 0.7,
  /** "script-dominant" also requires wordCount below this. */
  scriptDominantMaxWordCount: 30,
} as const;

const NOSCRIPT_RE = /<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi;
const NOSCRIPT_WARNING_RE = /enable\s+javascript|javascript\s+is\s+required/i;

// Bundler-pattern script src: Next static chunks, Vite/webpack hashed assets, generic "chunk-*.js".
const BUNDLE_SCRIPT_RE =
  /<script[^>]+src=["'][^"']*(?:\/_next\/static\/|\/assets\/[^"']*\.[0-9a-f]{6,}\.js|webpack|chunk-[\w.]+\.js|vite|\bbundle(?:\.[\w]+)?\.js|main\.[0-9a-f]{6,}\.js)[^"']*["']/i;

// Div-based mount roots: matched by id, then scanned for near-empty inner content.
const DIV_MOUNT_ID_RE = /<div\b[^>]*\bid=["'](root|__next|app)["'][^>]*>/gi;
// Attribute-based framework markers that aren't bound to one element we can scan the inside of.
const ATTR_MOUNT_MARKERS_RE = /data-reactroot|ng-version\s*=|\bng-app\b/i;

function stripScriptStyle(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function visibleText(html: string): string {
  return stripTags(stripScriptStyle(html)).replace(/\s+/g, " ").trim();
}

/**
 * Text inside the first div matching `openRe`, found by depth-counting `<div>`/`</div>` tokens
 * from the match — a full parser is overkill for a heuristic and this repo stays dependency-free.
 */
function firstMountRootInnerText(html: string, openRe: RegExp): string | null {
  openRe.lastIndex = 0;
  const open = openRe.exec(html);
  if (!open) return null;

  const start = open.index + open[0].length;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = start;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    if (m[0].startsWith("</")) {
      depth--;
      if (depth === 0) return visibleText(html.slice(start, m.index));
    } else if (!/\/>\s*$/.test(m[0])) {
      depth++;
    }
  }
  return visibleText(html.slice(start));
}

/**
 * Decide whether static HTML is insufficient and the page needs Playwright rendering (plan §18).
 * `scope` is unused here — internal/external is already resolved into `extraction.links[].type`.
 */
export function needsJsRendering(
  html: string,
  extraction: ExtractionResult,
  scope: CrawlScope,
): { needed: boolean; signals: string[] } {
  const T = DETECTION_THRESHOLDS;
  const signals: string[] = [];
  const strong = new Set(["empty-app-shell", "noscript-warning"]);

  const totalBytes = Buffer.byteLength(html, "utf8");
  const meaningfulBytes = Buffer.byteLength(stripScriptStyle(html), "utf8");

  if (meaningfulBytes < T.tinyBodyBytes) signals.push("tiny-body");

  let emptyShell = false;
  for (const m of html.matchAll(DIV_MOUNT_ID_RE)) {
    const idRe = new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const inner = firstMountRootInnerText(html, idRe);
    if (inner !== null && inner.length < T.emptyShellMaxInnerTextChars) {
      emptyShell = true;
      break;
    }
  }
  if (!emptyShell && ATTR_MOUNT_MARKERS_RE.test(html)) {
    emptyShell = visibleText(html).length < T.emptyShellMaxInnerTextChars;
  }
  if (emptyShell) signals.push("empty-app-shell");

  if (totalBytes >= T.lowTextRatioMinHtmlBytes) {
    const textBytes = Buffer.byteLength(visibleText(html), "utf8");
    if (textBytes / totalBytes < T.lowTextRatio) signals.push("low-text-ratio");
  }

  const hasInternalLink = extraction.links.some((l) => l.type === "internal");
  if (!hasInternalLink && extraction.content.wordCount < T.noLinksNoTextMaxWordCount) {
    signals.push("no-links-no-text");
  }

  const noscriptMatches = [...html.matchAll(NOSCRIPT_RE)].map((m) => m[1] ?? "");
  if (noscriptMatches.some((body) => NOSCRIPT_WARNING_RE.test(body))) {
    signals.push("noscript-warning");
  }

  if (BUNDLE_SCRIPT_RE.test(html) && extraction.content.wordCount < T.spaBundleMaxWordCount) {
    signals.push("spa-bundle-only");
  }

  // Inline-data CSR shells (quotes.toscrape.com/js shape) can ride the low-text-ratio threshold
  // edge across server variants — script dominance is the stable version of the same evidence.
  if (
    totalBytes > 0 &&
    (totalBytes - meaningfulBytes) / totalBytes >= T.scriptDominantMinFraction &&
    extraction.content.wordCount < T.scriptDominantMaxWordCount
  ) {
    signals.push("script-dominant");
  }

  const hasStrong = signals.some((s) => strong.has(s));
  const weakCount = signals.filter((s) => !strong.has(s)).length;
  const needed = hasStrong || weakCount >= 2;

  return { needed, signals };
}
