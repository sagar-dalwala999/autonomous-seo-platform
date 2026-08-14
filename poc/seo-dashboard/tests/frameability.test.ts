import { describe, it, expect } from "vitest";
import { frameability, isFrameableScheme } from "../components/preview/frameability";

describe("isFrameableScheme", () => {
  it("accepts only http and https", () => {
    expect(isFrameableScheme("https://example.com/")).toBe(true);
    expect(isFrameableScheme("http://example.com/")).toBe(true);
  });

  it("rejects schemes that would execute in our origin inside an iframe", () => {
    for (const url of [
      "javascript:alert(document.domain)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "about:blank",
      "not a url",
      "",
    ]) {
      expect(isFrameableScheme(url)).toBe(false);
    }
  });
});

describe("frameability", () => {
  it("refuses to frame a non-http(s) URL regardless of headers", () => {
    const r = frameability({}, "javascript:alert(1)");
    expect(r.canFrameLive).toBe(false);
    expect(r.frameBlockedBy).toContain("http(s)");
  });

  it("allows framing when no blocking header is present", () => {
    expect(frameability({}, "https://example.com/")).toEqual({ canFrameLive: true, frameBlockedBy: null });
  });

  it("blocks on X-Frame-Options and names it", () => {
    const r = frameability({ "x-frame-options": "DENY" }, "https://example.com/");
    expect(r.canFrameLive).toBe(false);
    expect(r.frameBlockedBy).toContain("DENY");
  });

  it("blocks on CSP frame-ancestors unless it is a bare wildcard", () => {
    expect(frameability({ "content-security-policy": "frame-ancestors 'none'" }, "https://e.test/").canFrameLive).toBe(false);
    expect(frameability({ "content-security-policy": "frame-ancestors 'self'" }, "https://e.test/").canFrameLive).toBe(false);
    expect(frameability({ "content-security-policy": "default-src 'self'; frame-ancestors *" }, "https://e.test/").canFrameLive).toBe(true);
  });

  it("stays permissive when headers are absent entirely", () => {
    expect(frameability(undefined, "https://example.com/").canFrameLive).toBe(true);
  });
});
