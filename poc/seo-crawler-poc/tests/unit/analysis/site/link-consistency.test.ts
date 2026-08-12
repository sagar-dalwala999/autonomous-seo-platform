import { describe, expect, it } from "vitest";
import { internalLinkSchemeMixRule, internalLinkWwwMixRule } from "../../../../src/analysis/rules/site/link-consistency";
import { makeContext, makePage, makeLink, makeConfig } from "./fixtures";

const cfg = makeConfig();

describe("internal-link-scheme-mix (manifest #15b)", () => {
  it("fires when the same internal host is authored with both http:// and https://", () => {
    const ctx = makeContext({
      pages: [
        makePage({
          url: "http://localhost:3105/about",
          links: [makeLink({ source: "page", target: "http://summittrailgear.example/contact", type: "internal" })],
        }),
        makePage({
          url: "http://localhost:3105/blog",
          links: [makeLink({ source: "page", target: "https://summittrailgear.example/about", type: "internal" })],
        }),
      ],
    });
    const issues = internalLinkSchemeMixRule.evaluate(ctx, cfg);
    expect(issues).not.toBeNull();
    expect(issues).toHaveLength(1);
    expect(issues![0]!.severity).toBe("warning");
    const values = issues![0]!.evidence.map((e) => e.value);
    expect(values).toContain("http://summittrailgear.example/contact");
    expect(values).toContain("https://summittrailgear.example/about");
  });

  it("stays silent when every authored link to a host shares one scheme", () => {
    const ctx = makeContext({
      pages: [
        makePage({
          url: "https://example.test/a",
          links: [
            makeLink({ source: "page", target: "https://example.test/b", type: "internal" }),
            makeLink({ source: "page", target: "https://example.test/c", type: "internal" }),
          ],
        }),
      ],
    });
    expect(internalLinkSchemeMixRule.evaluate(ctx, cfg)).toHaveLength(0);
  });
});

describe("internal-link-www-mix (manifest #15c)", () => {
  it("fires when www and non-www variants of the same domain are both linked internally", () => {
    const ctx = makeContext({
      pages: [
        makePage({
          url: "http://localhost:3105/",
          links: [makeLink({ source: "page", target: "https://www.summittrailgear.example/guides", type: "internal" })],
        }),
        makePage({
          url: "http://localhost:3105/blog",
          links: [makeLink({ source: "page", target: "https://summittrailgear.example/about", type: "internal" })],
        }),
      ],
    });
    const issues = internalLinkWwwMixRule.evaluate(ctx, cfg);
    expect(issues).not.toBeNull();
    expect(issues).toHaveLength(1);
    const values = issues![0]!.evidence.map((e) => e.value);
    expect(values).toContain("https://www.summittrailgear.example/guides");
    expect(values).toContain("https://summittrailgear.example/about");
  });

  it("stays silent on a single-host-variant site and skips external links entirely", () => {
    const ctx = makeContext({
      pages: [
        makePage({
          url: "https://example.test/a",
          links: [
            makeLink({ source: "page", target: "https://example.test/b", type: "internal" }),
            makeLink({ source: "page", target: "https://www.othersite.example/x", type: "external" }),
          ],
        }),
      ],
    });
    expect(internalLinkWwwMixRule.evaluate(ctx, cfg)).toHaveLength(0);
  });
});
