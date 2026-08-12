import type { CheerioAPI } from "cheerio";
import { createHash } from "node:crypto";
import type { PageContent } from "../models/types";
import { collapseWhitespace } from "./shared";

const NOISE_SELECTOR = 'script, style, noscript, template, nav, header, footer, [aria-hidden="true"]';

export function extractContent($: CheerioAPI): PageContent {
  const clonedRoot = $.root().clone(); // clone — never mutate the shared tree
  clonedRoot.find(NOISE_SELECTOR).remove();
  const clonedBody = clonedRoot.find("body");
  const text = collapseWhitespace(clonedBody.length ? clonedBody.text() : clonedRoot.text()); // fallback: whole doc (fragment fixtures)
  const wordCount = text === "" ? 0 : text.split(" ").length;
  const contentHash = createHash("sha256").update(text.toLowerCase()).digest("hex");

  return { text, wordCount, contentHash };
}
