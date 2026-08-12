import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { extractContent } from "../../../src/extraction/content";
import { loadFixture } from "./testUtils";

describe("extractContent", () => {
  it("flags thin content under 80 words (manifest #17)", () => {
    const $ = cheerio.load(loadFixture("blog-trail-snacks.html"));
    const { wordCount } = extractContent($);
    expect(wordCount).toBeLessThan(80);
    expect(wordCount).toBeGreaterThan(0);
  });

  it("produces near-identical evidence for a near-duplicate content pair (manifest #18)", () => {
    const a = extractContent(cheerio.load(loadFixture("blog-winter-hiking-checklist.html")));
    const b = extractContent(cheerio.load(loadFixture("blog-winter-day-hike-checklist.html")));
    expect(Math.abs(a.wordCount - b.wordCount)).toBeLessThanOrEqual(2); // close, not identical, wordCount evidence
    expect(a.contentHash).not.toBe(b.contentHash); // not byte-identical — hash correctly differs
  });

  it("produces the exact same contentHash for byte-identical normalized text", () => {
    const $a = cheerio.load(`<body><p>Same Text  Here</p></body>`);
    const $b = cheerio.load(`<body><p>same text here</p></body>`); // different case, same normalized text
    expect(extractContent($a).contentHash).toBe(extractContent($b).contentHash);
  });

  it("contentHash is sha256 hex of lowercased whitespace-collapsed text", () => {
    const $ = cheerio.load(`<body><p>Hello   World</p></body>`);
    const { text, contentHash } = extractContent($);
    expect(text).toBe("Hello World");
    expect(contentHash).toBe(createHash("sha256").update("hello world").digest("hex"));
  });

  it("drops script/style/noscript/nav/header/footer/aria-hidden noise from content text", () => {
    const $ = cheerio.load(`
      <body>
        <nav>Nav links</nav>
        <header>Site header</header>
        <script>var x = 1;</script>
        <style>.a{color:red}</style>
        <noscript>Enable JS</noscript>
        <template>Hidden template</template>
        <div aria-hidden="true">Hidden decorative text</div>
        <main>Real page content</main>
        <footer>Footer text</footer>
      </body>
    `);
    expect(extractContent($).text).toBe("Real page content");
  });

  it("falls back to the whole document when there is no <body>", () => {
    const $ = cheerio.load(`<p>Fragment content only</p>`, null, false);
    expect(extractContent($).text).toContain("Fragment content only");
  });

  it("never mutates the caller's cheerio tree", () => {
    const $ = cheerio.load(`<body><script>var x=1;</script><p>Visible</p></body>`);
    extractContent($);
    expect($("script")).toHaveLength(1); // still present on the original tree — only the clone was pruned
  });
});
