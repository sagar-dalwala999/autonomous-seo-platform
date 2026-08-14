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

  it("drops script/style/noscript/template and page-level nav/header/footer noise", () => {
    const $ = cheerio.load(`
      <body>
        <nav>Nav links</nav>
        <header>Site header</header>
        <script>var x = 1;</script>
        <style>.a{color:red}</style>
        <noscript>Enable JS</noscript>
        <template>Hidden template</template>
        <main>Real page content</main>
        <footer>Footer text</footer>
      </body>
    `);
    expect(extractContent($).text).toBe("Real page content");
  });

  it("keeps an article's own header/footer — they are not page chrome (bug D1)", () => {
    const $ = cheerio.load(`
      <body>
        <header>Site tagline chrome</header>
        <main><article>
          <header><h1>The Real Title</h1><p>By Jane Doe</p></header>
          <p>Body paragraph.</p>
          <footer>Article footnote.</footer>
        </article></main>
        <footer>Copyright chrome</footer>
      </body>
    `);
    const { text } = extractContent($);
    expect(text).toContain("The Real Title");
    expect(text).toContain("By Jane Doe");
    expect(text).toContain("Article footnote.");
    expect(text).not.toContain("Site tagline chrome");
    expect(text).not.toContain("Copyright chrome");
  });

  it("counts aria-hidden text instead of stripping it, and reports it separately (bug D2)", () => {
    const $ = cheerio.load(`<body><main><p>Visible words here</p><div aria-hidden="true"><p>Hidden decorative text</p></div></main></body>`);
    const { text, wordCount, ariaHiddenWordCount } = extractContent($);
    expect(text).toContain("Hidden decorative text"); // Google indexes it; users see it
    expect(wordCount).toBe(6);
    expect(ariaHiddenWordCount).toBe(3);
  });

  it("counts nested aria-hidden only once", () => {
    const $ = cheerio.load(`<body><main><div aria-hidden="true"><p>one two</p><span aria-hidden="true">three</span></div></main></body>`);
    expect(extractContent($).ariaHiddenWordCount).toBe(3);
  });

  it("separates block elements so adjacent words never fuse into one token", () => {
    const $ = cheerio.load(`<body><main><h1>Title</h1><p>By Jane</p><ul><li>one</li><li>two</li></ul></main></body>`);
    const { text, wordCount } = extractContent($);
    expect(text).toBe("Title By Jane one two");
    expect(wordCount).toBe(5); // not 3 — "TitleBy" and "onetwo" were single tokens before the fix
  });

  it("records how the content area was located", () => {
    const main = extractContent(cheerio.load(`<body><header>chrome</header><main><p>a b</p></main></body>`));
    expect(main.contentAreaMethod).toBe("main");

    const roleMain = extractContent(cheerio.load(`<body><div role="main"><p>a b</p></div></body>`));
    expect(roleMain.contentAreaMethod).toBe("role-main");

    const article = extractContent(cheerio.load(`<body><article><p>a b</p></article></body>`));
    expect(article.contentAreaMethod).toBe("article");

    // Many articles = a listing page; no single one is "the" content, so fall back to body.
    const listing = extractContent(cheerio.load(`<body><article><p>a</p></article><article><p>b</p></article></body>`));
    expect(listing.contentAreaMethod).toBe("body-minus-chrome");
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
