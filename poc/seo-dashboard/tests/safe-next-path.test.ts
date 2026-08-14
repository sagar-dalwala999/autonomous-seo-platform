import { describe, it, expect } from "vitest";
import { safeNextPath } from "../lib/safe-next-path";

const BASE = "https://app.example.com/login";

describe("safeNextPath", () => {
  it("never resolves off-origin, even through backslash/protocol-relative tricks", () => {
    // WHATWG URL parsing normalizes `\` to `/` for special schemes, so a naive
    // `next.startsWith("/") && !next.startsWith("//")` string check misses all of these.
    for (const attempt of ["/\\evil.com", "//evil.com", "/\\/evil.com", "https://evil.com", "http://evil.com"]) {
      const result = safeNextPath(attempt, BASE);
      expect(new URL(result, BASE).origin).toBe(new URL(BASE).origin);
      expect(result).toBe("/");
    }
  });

  it("strips tab/newline control characters per the URL spec rather than treating them as an escape", () => {
    // The URL parser strips ASCII tab/newline entirely (it does not error, and does not treat
    // them as a path separator), so "/\tevil.com" becomes the harmless same-origin path
    // "/evil.com" — never off-origin, just not literally "/". Verified against real URL parsing
    // (see the diagnostic run in the implementing session) rather than assumed.
    const result = safeNextPath("/\tevil.com", BASE);
    expect(new URL(result, BASE).origin).toBe(new URL(BASE).origin);
  });

  it("passes legitimate same-origin paths through untouched", () => {
    expect(safeNextPath("/issues", BASE)).toBe("/issues");
    expect(safeNextPath("/pages?status=4xx", BASE)).toBe("/pages?status=4xx");
    expect(safeNextPath("/pages/abc#section", BASE)).toBe("/pages/abc#section");
  });

  it("defaults to / when next is missing, empty, or unparseable", () => {
    expect(safeNextPath(null, BASE)).toBe("/");
    expect(safeNextPath(undefined, BASE)).toBe("/");
    expect(safeNextPath("", BASE)).toBe("/");
  });
});
