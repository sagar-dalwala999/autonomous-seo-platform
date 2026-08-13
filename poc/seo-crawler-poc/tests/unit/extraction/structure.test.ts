import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractDocumentStructure } from "../../../src/extraction/structure";

describe("extractDocumentStructure", () => {
  it("captures headings interleaved across levels in true document order", () => {
    const $ = cheerio.load(`
      <body>
        <h2>Intro</h2>
        <div><h1>Title</h1><h4>Deep note</h4></div>
        <h3>Section</h3>
      </body>
    `);
    const { headings } = extractDocumentStructure($);
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [2, "Intro"],
      [1, "Title"],
      [4, "Deep note"],
      [3, "Section"],
    ]);
    expect(headings.map((h) => h.index)).toEqual([0, 1, 2, 3]);
  });

  it("marks inMain true only for headings inside main/[role=main]/article", () => {
    const $ = cheerio.load(`
      <body>
        <header><h1>Site header</h1></header>
        <main><h2>In main</h2></main>
        <div role="main"><h2>In role-main</h2></div>
        <article><h2>In article</h2></article>
        <footer><h2>In footer</h2></footer>
      </body>
    `);
    const byText = Object.fromEntries(extractDocumentStructure($).headings.map((h) => [h.text, h.inMain]));
    expect(byText["Site header"]).toBe(false);
    expect(byText["In main"]).toBe(true);
    expect(byText["In role-main"]).toBe(true);
    expect(byText["In article"]).toBe(true);
    expect(byText["In footer"]).toBe(false);
  });

  it("trims and collapses embedded whitespace in heading text", () => {
    const $ = cheerio.load(`<h1>\n  Spaced   Out \n Heading \n</h1>`);
    expect(extractDocumentStructure($).headings[0]?.text).toBe("Spaced Out Heading");
  });

  it("distinguishes a data table (th + caption) from a layout table", () => {
    const $ = cheerio.load(`
      <table id="data">
        <caption>Pricing</caption>
        <tr><th>Plan</th><th>Cost</th></tr>
        <tr><td>Pro</td><td>$9</td></tr>
      </table>
      <table id="layout">
        <tr><td>Logo</td><td>Nav</td></tr>
      </table>
    `);
    expect(extractDocumentStructure($).tables).toEqual({ total: 2, withTh: 1, withCaption: 1 });
  });

  it("scopes th/caption ownership to the table that actually contains them, not a nested table", () => {
    const $ = cheerio.load(`
      <table id="outer">
        <tr><td>
          <table id="inner"><caption>Inner</caption><tr><th>X</th></tr></table>
        </td></tr>
      </table>
    `);
    // Outer table has no th/caption of its own — both belong to the inner table.
    expect(extractDocumentStructure($).tables).toEqual({ total: 2, withTh: 1, withCaption: 1 });
  });

  it("counts ordered, unordered and definition lists separately, including nested lists as distinct elements", () => {
    const $ = cheerio.load(`
      <ul><li>A<ul><li>Nested</li></ul></li></ul>
      <ol><li>1</li></ol>
      <dl><dt>Term</dt><dd>Def</dd></dl>
    `);
    expect(extractDocumentStructure($).lists).toEqual({ ordered: 1, unordered: 2, definition: 1 });
  });

  it("counts paragraphs, code blocks and blockquotes", () => {
    const $ = cheerio.load(`
      <p>One</p><p>Two</p>
      <pre><code>const x = 1;</code></pre>
      <blockquote>Quoted</blockquote>
    `);
    const s = extractDocumentStructure($);
    expect(s.paragraphs).toBe(2);
    expect(s.codeBlocks).toBe(1);
    expect(s.blockquotes).toBe(1);
  });

  it("treats section as a landmark only when it has an accessible name", () => {
    const $ = cheerio.load(`
      <main></main>
      <nav></nav>
      <section aria-label="Related products">Named</section>
      <section>Unnamed</section>
    `);
    const landmarks = extractDocumentStructure($).landmarks;
    expect(landmarks).toContain("section");
    expect(landmarks).toContain("main");
    expect(landmarks).toContain("nav");
    expect(landmarks).not.toContain("article");
  });

  it("does not treat a section with an empty aria-label as a landmark", () => {
    const $ = cheerio.load(`<section aria-label="   "></section>`);
    expect(extractDocumentStructure($).landmarks).not.toContain("section");
  });

  it("recognizes aria-labelledby as an accessible name too", () => {
    const $ = cheerio.load(`<h2 id="t">Team</h2><section aria-labelledby="t"></section>`);
    expect(extractDocumentStructure($).landmarks).toContain("section");
  });

  it("does not throw on empty markup and returns zeroed-out structure", () => {
    const $ = cheerio.load("");
    const s = extractDocumentStructure($);
    expect(s.headings).toEqual([]);
    expect(s.paragraphs).toBe(0);
    expect(s.tables).toEqual({ total: 0, withTh: 0, withCaption: 0 });
    expect(s.landmarks).toEqual([]);
  });

  it("does not throw on malformed/unclosed markup", () => {
    const $ = cheerio.load(`<main><h1>Unclosed<h2>Nested wrong<table><tr><td>cell`);
    expect(() => extractDocumentStructure($)).not.toThrow();
  });

  it("does not mutate the caller's tree", () => {
    const $ = cheerio.load(`<main><h1>Keep me</h1><table><tr><th>Th</th></tr></table></main>`);
    extractDocumentStructure($);
    expect($("h1").text()).toBe("Keep me");
    expect($("table").length).toBe(1);
    expect($("th").length).toBe(1);
  });
});
