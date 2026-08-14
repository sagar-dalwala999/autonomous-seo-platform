import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractHeadBoundary, extractCharset, extractBaseHrefInfo } from "../../../src/extraction/head";

function load(html: string) {
  return cheerio.load(html, { sourceCodeLocationInfo: true } as Parameters<typeof cheerio.load>[1]);
}

const CLEAN = `<html><head><title>T</title><link rel="canonical" href="/c"><meta name="robots" content="noindex"></head><body><p>x</p></body></html>`;

describe("extractHeadBoundary", () => {
  it("reports no early close on a well-formed head", () => {
    const r = extractHeadBoundary(load(CLEAN));
    expect(r.closedBy).toBeNull();
    expect(r.closedAtOffset).toBeNull();
    expect(r.stranded).toEqual([]);
    expect(r.elementCount).toBe(3);
  });

  it("detects a <div> closing the head and strands the canonical", () => {
    const r = extractHeadBoundary(
      load(`<html><head><title>T</title><div>oops</div><link rel="canonical" href="/c"></head><body></body></html>`),
    );
    expect(r.closedBy).toBe("div");
    expect(r.closedAtOffset).toBeGreaterThan(0);
    expect(r.stranded.map((s) => s.signal)).toContain("canonical");
  });

  it("detects an <img> closing the head", () => {
    const r = extractHeadBoundary(
      load(`<html><head><title>T</title><img src="a.png"><link rel="canonical" href="/c"></head><body></body></html>`),
    );
    expect(r.closedBy).toBe("img");
    expect(r.stranded.some((s) => s.signal === "canonical")).toBe(true);
  });

  it("marks a stranded canonical as not honoured but a stranded meta robots as honoured", () => {
    const r = extractHeadBoundary(
      load(
        `<html><head><title>T</title><div>x</div><link rel="canonical" href="/c"><meta name="robots" content="noindex"></head><body></body></html>`,
      ),
    );
    // Google ignores a canonical outside head, but explicitly respects meta robots in the body.
    expect(r.stranded.find((s) => s.signal === "canonical")?.honoured).toBe(false);
    expect(r.stranded.find((s) => s.signal === "meta-robots")?.honoured).toBe(true);
  });

  it("does not treat inert <template> content as a stranded signal", () => {
    const r = extractHeadBoundary(
      load(`<html><head><title>T</title></head><body><template><link rel="canonical" href="/c"></template></body></html>`),
    );
    expect(r.stranded).toEqual([]);
    expect(r.closedBy).toBeNull();
  });

  it("keeps the head open for <noscript><img> — scripting-enabled parsers treat it as raw text", () => {
    const r = extractHeadBoundary(
      load(`<html><head><title>T</title><noscript><img src="a.png"></noscript><link rel="canonical" href="/c"></head><body></body></html>`),
    );
    expect(r.stranded).toEqual([]);
    expect(r.closedBy).toBeNull();
  });

  it("reports no culprit when the head closes early but nothing of value follows", () => {
    const r = extractHeadBoundary(load(`<html><head><title>T</title><div>x</div></head><body><p>y</p></body></html>`));
    expect(r.closedBy).toBeNull(); // early close with no orphaned signal causes no harm
  });

  it("never throws on malformed or empty input", () => {
    for (const html of ["", "<p>fragment", "<html><head>", "<<>>", "<html><body><div></p></div>"]) {
      expect(() => extractHeadBoundary(load(html))).not.toThrow();
    }
  });
});

describe("extractCharset", () => {
  it("reads a meta charset inside the first 1024 bytes as effective", () => {
    const html = `<html><head><meta charset="utf-8"><title>T</title></head><body></body></html>`;
    const r = extractCharset(load(html), html);
    expect(r).toMatchObject({ value: "utf-8", source: "meta", effective: true });
    expect(r.metaOffset).toBeLessThan(1024);
  });

  it("marks a meta charset past 1024 bytes as NOT effective", () => {
    // Real padding, not a faked offset — the prescan genuinely never reaches this declaration.
    const padding = `<link rel="stylesheet" href="/very/long/path/to/a/stylesheet/file.css">`.repeat(20);
    const html = `<html><head><title>T</title>${padding}<meta charset="utf-8"></head><body></body></html>`;
    const r = extractCharset(load(html), html);
    expect(r.metaOffset).toBeGreaterThan(1024);
    expect(r.effective).toBe(false);
    expect(r.value).toBe("utf-8");
  });

  it("prefers a BOM over everything else", () => {
    const html = `﻿<html><head><meta charset="iso-8859-1"></head><body></body></html>`;
    expect(extractCharset(load(html), html)).toMatchObject({ value: "utf-8", source: "bom", effective: true });
  });

  it("prefers an HTTP header over a meta declaration", () => {
    const html = `<html><head><meta charset="iso-8859-1"></head><body></body></html>`;
    const r = extractCharset(load(html), html, { "content-type": "text/html; charset=UTF-8" });
    expect(r).toMatchObject({ value: "utf-8", source: "header", effective: true });
  });

  it("reads charset from a http-equiv content-type meta", () => {
    const html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"></head><body></body></html>`;
    expect(extractCharset(load(html), html)).toMatchObject({ value: "windows-1252", source: "meta" });
  });

  it("reports nothing declared rather than guessing", () => {
    const html = `<html><head><title>T</title></head><body></body></html>`;
    expect(extractCharset(load(html), html)).toMatchObject({ value: null, source: null, effective: false });
  });
});

describe("extractBaseHrefInfo", () => {
  it("returns the first base href and the total count", () => {
    const r = extractBaseHrefInfo(load(`<html><head><base href="/app/"><base href="/ignored/"></head><body></body></html>`));
    expect(r).toEqual({ href: "/app/", count: 2 }); // all but the first are ignored per spec
  });

  it("reports absence honestly", () => {
    expect(extractBaseHrefInfo(load(CLEAN))).toEqual({ href: null, count: 0 });
  });
});
