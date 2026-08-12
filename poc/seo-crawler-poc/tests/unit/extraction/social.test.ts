import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractSocialTags } from "../../../src/extraction/social";
import { loadFixture } from "./testUtils";

describe("extractSocialTags", () => {
  it("returns empty og/twitter maps when no social meta present", () => {
    const $ = cheerio.load(loadFixture("about.html"));
    expect(extractSocialTags($)).toEqual({ og: {}, twitter: {} });
  });

  it("captures og:* via property= and twitter:* via name= (standard authoring)", () => {
    const $ = cheerio.load(loadFixture("multi-instance-social.html"));
    const { og, twitter } = extractSocialTags($);
    expect(og["og:title"]).toBe("OG Title Value");
    expect(og["og:description"]).toBe("OG description value.");
    expect(twitter["twitter:card"]).toBe("summary_large_image");
    expect(twitter["twitter:title"]).toBe("Twitter Title Value");
  });

  it("also captures og:* authored via name= and twitter:* via property= (nonstandard but real-world)", () => {
    const $ = cheerio.load(loadFixture("multi-instance-social.html"));
    const { og, twitter } = extractSocialTags($);
    expect(og["og:type"]).toBe("website");
    expect(twitter["twitter:description"]).toBe("Twitter description via property attr.");
  });

  it("first instance wins on duplicate keys (two og:image tags)", () => {
    const $ = cheerio.load(loadFixture("multi-instance-social.html"));
    const { og } = extractSocialTags($);
    expect(og["og:image"]).toBe("/images/og-cover.jpg");
  });

  it("ignores meta tags with no content attribute", () => {
    const $ = cheerio.load(`<meta property="og:title">`);
    expect(extractSocialTags($).og).toEqual({});
  });

  it("ignores non-og/twitter meta tags entirely", () => {
    const $ = cheerio.load(`<meta name="description" content="not social">`);
    expect(extractSocialTags($)).toEqual({ og: {}, twitter: {} });
  });
});

// Integration addition: mailto/tel contact capture (sagardalwala.me finding).
import { extractContacts } from "../../../src/extraction/contacts";

describe("extractContacts", () => {
  it("captures email and phone with scheme+query stripped, deduped", () => {
    const $ = cheerio.load(`
      <a href="mailto:hi@sagardalwala.me?subject=Hello">Email me</a>
      <a href="mailto:hi@sagardalwala.me">Email again</a>
      <a href="tel:+91 98765 43210">Call</a>
      <a href="/about">Not a contact</a>
    `);
    const contacts = extractContacts($);
    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({ kind: "email", value: "hi@sagardalwala.me", anchor: "Email me" });
    expect(contacts[1]).toMatchObject({ kind: "phone", value: "+91 98765 43210" });
  });

  it("returns empty on a page without contact links", () => {
    const $ = cheerio.load(`<a href="https://github.com/x">GitHub</a>`);
    expect(extractContacts($)).toHaveLength(0);
  });
});
