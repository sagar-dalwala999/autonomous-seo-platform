import { describe, expect, it } from "vitest";
import { authHeaders, checkSafety, defaultSafety } from "../../../src/crawler/safety";
import type { CrawlAuth, CrawlSafety } from "../../../src/models/types";

const noAuth: CrawlAuth = { basic: null, cookie: null, headers: {} };
const basicAuth: CrawlAuth = { basic: { username: "u", password: "p" }, cookie: null, headers: {} };

function safetyOf(overrides: Partial<CrawlSafety>): CrawlSafety {
  return { excludePatterns: [], denyLogout: false, denyDestructive: false, ...overrides };
}

describe("defaultSafety", () => {
  it("is permissive (both deny flags off) for an anonymous crawl", () => {
    expect(defaultSafety(null)).toEqual({ excludePatterns: [], denyLogout: false, denyDestructive: false });
    expect(defaultSafety(undefined)).toEqual({ excludePatterns: [], denyLogout: false, denyDestructive: false });
  });

  it("is strict (both deny flags on) when credentials are present", () => {
    expect(defaultSafety(basicAuth)).toEqual({ excludePatterns: [], denyLogout: true, denyDestructive: true });
    expect(defaultSafety({ basic: null, cookie: "session=abc", headers: {} })).toEqual({
      excludePatterns: [],
      denyLogout: true,
      denyDestructive: true,
    });
    expect(defaultSafety({ basic: null, cookie: null, headers: { "X-Api-Key": "x" } })).toEqual({
      excludePatterns: [],
      denyLogout: true,
      denyDestructive: true,
    });
  });

  it("treats a present-but-empty CrawlAuth as unauthenticated", () => {
    expect(defaultSafety(noAuth)).toEqual({ excludePatterns: [], denyLogout: false, denyDestructive: false });
  });
});

describe("checkSafety", () => {
  it("fires on a logout path when denyLogout is on", () => {
    const skip = checkSafety("https://example.com/logout", "https://example.com/", safetyOf({ denyLogout: true }));
    expect(skip).toEqual({
      url: "https://example.com/logout",
      reason: "logout",
      matchedPattern: "/logout",
      foundOn: "https://example.com/",
    });
  });

  it("does not fire on a logout path when denyLogout is off", () => {
    expect(checkSafety("https://example.com/logout", null, safetyOf({ denyLogout: false }))).toBeNull();
  });

  it("segment-matches a destructive path nested under other segments", () => {
    const skip = checkSafety(
      "https://example.com/members/reports/q1/delete",
      null,
      safetyOf({ denyDestructive: true }),
    );
    expect(skip?.reason).toBe("destructive");
    expect(skip?.matchedPattern).toBe("/delete");
  });

  it("segment-matches a destructive path followed by another segment", () => {
    const skip = checkSafety("https://example.com/delete/123", null, safetyOf({ denyDestructive: true }));
    expect(skip?.reason).toBe("destructive");
  });

  it("does NOT false-positive on a word that merely contains the pattern as a substring", () => {
    expect(checkSafety("https://example.com/undeleted-items", null, safetyOf({ denyDestructive: true }))).toBeNull();
  });

  it("does not fire on an anonymous-crawl article whose slug contains a destructive word, when denyDestructive is off", () => {
    const skip = checkSafety(
      "https://example.com/articles/how-to-cancel-a-subscription",
      null,
      safetyOf({ denyDestructive: false }),
    );
    expect(skip).toBeNull();
  });

  it("DOES fire on that same article when denyDestructive is on — documented coverage tradeoff", () => {
    const skip = checkSafety(
      "https://example.com/articles/how-to-cancel-a-subscription",
      null,
      safetyOf({ denyDestructive: true }),
    );
    expect(skip?.reason).toBe("destructive");
    expect(skip?.matchedPattern).toBe("/cancel");
  });

  it("checks user excludePatterns first, as a literal case-insensitive substring", () => {
    const skip = checkSafety(
      "https://example.com/staging/preview",
      "https://example.com/",
      safetyOf({ excludePatterns: ["/staging"], denyLogout: true, denyDestructive: true }),
    );
    expect(skip).toEqual({
      url: "https://example.com/staging/preview",
      reason: "user-excluded",
      matchedPattern: "/staging",
      foundOn: "https://example.com/",
    });
  });

  it("user excludePatterns match as a plain substring, not word-boundary", () => {
    const skip = checkSafety("https://example.com/prestaging/x", null, safetyOf({ excludePatterns: ["staging"] }));
    // "staging" is a substring of "prestaging" with no word-boundary guard — literal substring.
    expect(skip?.reason).toBe("user-excluded");
  });

  it("returns null when nothing matches", () => {
    expect(checkSafety("https://example.com/about", null, safetyOf({ denyLogout: true, denyDestructive: true }))).toBeNull();
  });
});

describe("authHeaders", () => {
  it("returns {} for null/undefined auth", () => {
    expect(authHeaders(null)).toEqual({});
    expect(authHeaders(undefined)).toEqual({});
  });

  it("returns {} for a present-but-empty CrawlAuth", () => {
    expect(authHeaders(noAuth)).toEqual({});
  });

  it("builds a correct Basic Authorization header", () => {
    const headers = authHeaders(basicAuth);
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });

  it("builds a Cookie header from the raw cookie value", () => {
    const headers = authHeaders({ basic: null, cookie: "session=abc; csrf=xyz", headers: {} });
    expect(headers.Cookie).toBe("session=abc; csrf=xyz");
  });

  it("includes custom headers alongside Basic + Cookie", () => {
    const headers = authHeaders({
      basic: { username: "u", password: "p" },
      cookie: "session=abc",
      headers: { "X-Api-Key": "secret" },
    });
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
    expect(headers.Cookie).toBe("session=abc");
    expect(headers["X-Api-Key"]).toBe("secret");
  });

  it("lets a custom header override Authorization/Cookie", () => {
    const headers = authHeaders({
      basic: { username: "u", password: "p" },
      cookie: "session=abc",
      headers: { Authorization: "Bearer token123" },
    });
    expect(headers.Authorization).toBe("Bearer token123");
  });
});
