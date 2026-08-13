import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import {
  extractStructuredData,
  extractMicrodata,
  extractRdfa,
  buildStructuredDataReport,
  validateSchemaNode,
} from "../../../src/extraction/schema";
import { extractPage } from "../../../src/extraction";
import type { StructuredDataItem, StructuredDataReport } from "../../../src/models/types";
import { loadFixture, makeArtifact, makeScope } from "./testUtils";

const BASE = "https://summittrailgear.example/shop/";

function report(html: string, base = BASE): StructuredDataReport {
  return buildStructuredDataReport(cheerio.load(html), base);
}

function jsonLd(payload: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

/** The one item whose types include `type` — asserts uniqueness so a test can't silently match twice. */
function itemOfType(rep: StructuredDataReport, type: string): StructuredDataItem {
  const matches = rep.items.filter((i) => i.types.includes(type));
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

describe("extractStructuredData", () => {
  it("preserves an invalid truncated JSON-LD block raw, with a parse error (manifest #11a)", () => {
    const $ = cheerio.load(loadFixture("blog-choosing-hiking-boots.html"));
    const blocks = extractStructuredData($);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.raw.length).toBeGreaterThan(0);
    expect(blocks[0]!.parsed).toBeNull();
    expect(blocks[0]!.parseError).not.toBeNull();
    expect(() => JSON.parse(blocks[0]!.raw)).toThrow();
  });

  it("parses a wrong-schema-type Recipe-on-article block without error (manifest #11b)", () => {
    const $ = cheerio.load(loadFixture("blog-layering-basics.html"));
    const [block] = extractStructuredData($);
    expect(block!.parseError).toBeNull();
    expect((block!.parsed as { "@type": string })["@type"]).toBe("Recipe");
  });

  it("parses a valid Product block missing offers/price/availability (manifest #11c)", () => {
    const $ = cheerio.load(loadFixture("products-ridgeline.html"));
    const [block] = extractStructuredData($);
    expect(block!.parseError).toBeNull();
    const parsed = block!.parsed as Record<string, unknown>;
    expect(parsed["@type"]).toBe("Product");
    expect(parsed.offers).toBeUndefined(); // absence itself IS the evidence — S2 does not judge it
  });

  it("returns [] when no ld+json blocks are present", () => {
    const $ = cheerio.load(loadFixture("about.html"));
    expect(extractStructuredData($)).toEqual([]);
  });

  it("captures multiple blocks on one page independently", () => {
    const $ = cheerio.load(
      `<script type="application/ld+json">{"a":1}</script><script type="application/ld+json">not json</script>`
    );
    const blocks = extractStructuredData($);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.parsed).toEqual({ a: 1 });
    expect(blocks[1]!.parseError).not.toBeNull();
  });

  it("never throws on an empty script block", () => {
    const $ = cheerio.load(`<script type="application/ld+json"></script>`);
    expect(() => extractStructuredData($)).not.toThrow();
    expect(extractStructuredData($)[0]!.parseError).not.toBeNull();
  });

  it("stays JSON-LD-only — microdata and RDFa never leak into structuredData[]", () => {
    const $ = cheerio.load(
      `<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">X</span></div>
       <div vocab="https://schema.org/" typeof="Organization"><span property="name">Y</span></div>`
    );
    expect(extractStructuredData($)).toEqual([]);
  });
});

describe("extractMicrodata", () => {
  it("extracts a flat item's type and properties", () => {
    const $ = cheerio.load(
      `<div itemscope itemtype="https://schema.org/Person">
         <span itemprop="name">Ada Lovelace</span>
         <span itemprop="jobTitle">Analyst</span>
       </div>`
    );
    const items = extractMicrodata($, BASE);
    expect(items).toHaveLength(1);
    expect(items[0]!.types).toEqual(["Person"]);
    expect(items[0]!.node).toMatchObject({ "@type": "Person", name: "Ada Lovelace", jobTitle: "Analyst" });
    expect(items[0]!.path).toBe("microdata[0]");
  });

  it("nests a child item under its itemprop and emits it as its own item too", () => {
    const $ = cheerio.load(
      `<div itemscope itemtype="http://schema.org/Product">
         <h1 itemprop="name">Ridgeline 45</h1>
         <div itemprop="offers" itemscope itemtype="http://schema.org/Offer">
           <meta itemprop="priceCurrency" content="USD">
           <span itemprop="price">189.00</span>
           <link itemprop="availability" href="https://schema.org/InStock">
         </div>
       </div>`
    );
    const items = extractMicrodata($, BASE);
    expect(items.map((i) => i.types[0])).toEqual(["Product", "Offer"]);
    const product = items[0]!.node as Record<string, unknown>;
    const offer = product.offers as Record<string, unknown>;
    expect(offer).toMatchObject({ "@type": "Offer", priceCurrency: "USD", price: "189.00" });
    expect(offer.availability).toBe("https://schema.org/InStock");
    expect(items[1]!.path).toBe("microdata[0].offers");
  });

  it("keeps nesting three levels deep", () => {
    const $ = cheerio.load(
      `<div itemscope itemtype="https://schema.org/LocalBusiness">
         <span itemprop="name">Summit Outfitters</span>
         <div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
           <span itemprop="streetAddress">1 Alpine Way</span>
           <span itemprop="addressLocality">Boulder</span>
           <div itemprop="addressCountry" itemscope itemtype="https://schema.org/Country">
             <span itemprop="name">US</span>
           </div>
         </div>
       </div>`
    );
    const items = extractMicrodata($, BASE);
    expect(items).toHaveLength(3);
    const biz = items[0]!.node as Record<string, unknown>;
    const address = biz.address as Record<string, unknown>;
    expect(address.streetAddress).toBe("1 Alpine Way");
    expect((address.addressCountry as Record<string, unknown>).name).toBe("US");
    expect(items[2]!.path).toBe("microdata[0].address.addressCountry");
  });

  it("reads values from the attribute the microdata spec assigns to each element", () => {
    const $ = cheerio.load(
      `<article itemscope itemtype="https://schema.org/Article">
         <meta itemprop="headline" content="Winter checklist">
         <time itemprop="datePublished" datetime="2026-01-04">Jan 4</time>
         <img itemprop="image" src="/img/hero.jpg" alt="">
         <a itemprop="url" href="/blog/winter">Read</a>
         <data itemprop="wordCount" value="1200">about 1.2k</data>
       </article>`
    );
    const node = extractMicrodata($, BASE)[0]!.node;
    expect(node.headline).toBe("Winter checklist");
    expect(node.datePublished).toBe("2026-01-04");
    expect(node.image).toBe("https://summittrailgear.example/img/hero.jpg");
    expect(node.url).toBe("https://summittrailgear.example/blog/winter");
    expect(node.wordCount).toBe("1200");
  });

  it("collapses a repeated property into an array and splits multi-name itemprop", () => {
    const $ = cheerio.load(
      `<div itemscope itemtype="https://schema.org/Recipe">
         <span itemprop="recipeIngredient">Oats</span>
         <span itemprop="recipeIngredient">Honey</span>
         <span itemprop="name headline">Trail bars</span>
       </div>`
    );
    const node = extractMicrodata($, BASE)[0]!.node;
    expect(node.recipeIngredient).toEqual(["Oats", "Honey"]);
    expect(node.name).toBe("Trail bars");
    expect(node.headline).toBe("Trail bars");
  });

  it("pulls in properties referenced by itemref from outside the subtree", () => {
    const $ = cheerio.load(
      `<div itemscope itemtype="https://schema.org/Product" itemref="shared-price">
         <span itemprop="name">Switchback 30</span>
       </div>
       <div id="shared-price"><span itemprop="sku">SW-30</span></div>`
    );
    const node = extractMicrodata($, BASE)[0]!.node;
    expect(node.name).toBe("Switchback 30");
    expect(node.sku).toBe("SW-30");
  });

  it("records an itemscope with no itemtype as a missing-type item", () => {
    const rep = report(`<div itemscope><span itemprop="name">Nameless</span></div>`);
    expect(rep.counts.microdataItems).toBe(1);
    expect(rep.items[0]!.validation.status).toBe("missing-type");
    expect(rep.errors.some((e) => e.kind === "missing-type" && e.format === "microdata")).toBe(true);
  });

  it("returns [] on a page with no microdata", () => {
    expect(extractMicrodata(cheerio.load(loadFixture("about.html")), BASE)).toEqual([]);
  });
});

describe("extractRdfa — Open Graph exclusion", () => {
  const OG_ONLY = `<!doctype html><html prefix="og: https://ogp.me/ns# article: https://ogp.me/ns/article#">
    <head>
      <meta property="og:title" content="Winter Day-Hike Checklist">
      <meta property="og:type" content="article">
      <meta property="og:url" content="https://summittrailgear.example/blog/winter">
      <meta property="og:image" content="https://summittrailgear.example/img/hero.jpg">
      <meta property="og:site_name" content="Summit Trail Gear">
      <meta property="article:published_time" content="2026-01-04">
      <meta property="fb:app_id" content="123">
      <meta name="twitter:card" content="summary_large_image">
    </head><body><h1>Winter Day-Hike Checklist</h1></body></html>`;

  it("reports ZERO RDFa items on a page whose only property attributes are Open Graph", () => {
    expect(extractRdfa(cheerio.load(OG_ONLY), BASE)).toEqual([]);
    const rep = report(OG_ONLY);
    expect(rep.counts.rdfaItems).toBe(0);
    expect(rep.items).toHaveLength(0);
    expect(rep.errors).toEqual([]);
  });

  it("reports ZERO RDFa items when og: is used without a declared prefix (the common shape)", () => {
    const html = `<html><head><meta property="og:title" content="X"><meta property="og:description" content="Y"></head><body></body></html>`;
    expect(extractRdfa(cheerio.load(html), BASE)).toEqual([]);
  });

  it("keeps og:* out of a real RDFa item that wraps the whole document", () => {
    const html = `<html vocab="https://schema.org/" typeof="WebPage" prefix="og: https://ogp.me/ns#">
      <head><meta property="og:title" content="Social title"></head>
      <body><h1 property="name">Real title</h1></body></html>`;
    const items = extractRdfa(cheerio.load(html), BASE);
    expect(items).toHaveLength(1);
    expect(items[0]!.types).toEqual(["WebPage"]);
    expect(items[0]!.node.name).toBe("Real title");
    expect(Object.keys(items[0]!.node).some((k) => k.includes(":"))).toBe(false);
    expect(items[0]!.node["og:title"]).toBeUndefined();
  });

  it("ignores an item whose vocabulary is not schema.org", () => {
    const html = `<div vocab="http://purl.org/dc/terms/" typeof="BibliographicResource">
        <span property="title">Dublin Core doc</span></div>`;
    expect(extractRdfa(cheerio.load(html), BASE)).toEqual([]);
  });

  it("ignores a prefixed type bound to a non-schema.org vocabulary", () => {
    const html = `<div prefix="sioc: http://rdfs.org/sioc/ns#" typeof="sioc:Item">
        <span property="sioc:content">forum post</span></div>`;
    expect(extractRdfa(cheerio.load(html), BASE)).toEqual([]);
  });
});

describe("extractRdfa", () => {
  it("extracts a vocab + typeof + property item", () => {
    const html = `<div vocab="https://schema.org/" typeof="Organization" resource="#org">
        <span property="name">Summit Trail Gear</span>
        <a property="url" href="/about">About</a>
        <img property="logo" src="/logo.png" alt="">
      </div>`;
    const items = extractRdfa(cheerio.load(html), BASE);
    expect(items).toHaveLength(1);
    expect(items[0]!.node).toMatchObject({
      "@type": "Organization",
      "@id": "#org",
      name: "Summit Trail Gear",
      url: "https://summittrailgear.example/about",
      logo: "https://summittrailgear.example/logo.png",
    });
  });

  it("accepts a schema: prefixed type and nests child items under their property", () => {
    const html = `<div prefix="schema: https://schema.org/" typeof="schema:Product">
        <span property="schema:name">Ridgeline 45</span>
        <div property="schema:offers" typeof="schema:Offer">
          <span property="schema:price">189.00</span>
          <meta property="schema:priceCurrency" content="USD">
        </div>
      </div>`;
    const items = extractRdfa(cheerio.load(html), BASE);
    expect(items.map((i) => i.types[0])).toEqual(["Product", "Offer"]);
    const offer = items[0]!.node.offers as Record<string, unknown>;
    expect(offer).toMatchObject({ "@type": "Offer", price: "189.00", priceCurrency: "USD" });
    expect(items[1]!.path).toBe("rdfa[0].offers");
  });

  it("accepts a full-URL typeof and a bare known type with no vocab", () => {
    const full = extractRdfa(cheerio.load(`<div typeof="https://schema.org/Event"></div>`), BASE);
    expect(full[0]!.types).toEqual(["Event"]);
    const bare = extractRdfa(cheerio.load(`<div typeof="Recipe"><span property="name">Bars</span></div>`), BASE);
    expect(bare[0]!.types).toEqual(["Recipe"]);
  });

  it("still finds a schema.org item nested inside another vocabulary's typeof node", () => {
    const html = `<div prefix="sioc: http://rdfs.org/sioc/ns#" typeof="sioc:Item">
        <span property="sioc:content">forum post</span>
        <div vocab="https://schema.org/" typeof="Product"><span property="name">Ridgeline 45</span></div>
      </div>`;
    const items = extractRdfa(cheerio.load(html), BASE);
    expect(items).toHaveLength(1);
    expect(items[0]!.types).toEqual(["Product"]);
    expect(items[0]!.node).toEqual({ "@type": "Product", name: "Ridgeline 45" });
  });

  it("emits a nested item only once", () => {
    const html = `<div vocab="https://schema.org/" typeof="Product">
        <span property="name">P</span>
        <div property="offers" typeof="Offer"><span property="price">1</span></div>
      </div>`;
    const items = extractRdfa(cheerio.load(html), BASE);
    expect(items.map((i) => i.path)).toEqual(["rdfa[0]", "rdfa[0].offers"]);
  });

  it("skips an undeclared bare typeof that is not a schema.org type", () => {
    expect(extractRdfa(cheerio.load(`<nav typeof="mainmenu"><span property="label">Home</span></nav>`), BASE)).toEqual([]);
  });

  it("still reports a misspelled type when the schema.org vocab is declared", () => {
    const rep = report(`<div vocab="https://schema.org/" typeof="Prodcut"><span property="name">X</span></div>`);
    expect(rep.counts.rdfaItems).toBe(1);
    expect(rep.items[0]!.validation.status).toBe("unknown-type");
  });
});

describe("Google rich-result validation", () => {
  it("passes a complete Product and fails one with no name or offers", () => {
    const ok = report(
      jsonLd({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Ridgeline 45",
        image: "https://x/i.jpg",
        description: "Pack",
        brand: { "@type": "Brand", name: "Summit" },
        sku: "R45",
        offers: { "@type": "Offer", price: "189.00", priceCurrency: "USD", availability: "https://schema.org/InStock", url: "https://x/p" },
      })
    );
    expect(itemOfType(ok, "Product").validation).toMatchObject({ profile: "Product", status: "validated", missingRequired: [] });
    expect(itemOfType(ok, "Offer").validation.missingRequired).toEqual([]);

    const bad = report(jsonLd({ "@context": "https://schema.org", "@type": "Product", description: "Pack" }));
    expect(itemOfType(bad, "Product").validation.missingRequired).toEqual(["name", "offers or review or aggregateRating"]);
  });

  it("flags an Offer missing price and priceCurrency", () => {
    const rep = report(
      jsonLd({ "@context": "https://schema.org", "@type": "Product", name: "P", offers: { "@type": "Offer", url: "https://x/p" } })
    );
    expect(itemOfType(rep, "Offer").validation.missingRequired).toEqual(["price or priceSpecification", "priceCurrency"]);
  });

  it("accepts priceSpecification in place of price", () => {
    const rep = report(
      jsonLd({
        "@context": "https://schema.org",
        "@type": "Offer",
        priceCurrency: "USD",
        priceSpecification: { "@type": "UnitPriceSpecification", price: "10" },
      })
    );
    expect(itemOfType(rep, "Offer").validation.missingRequired).toEqual([]);
  });

  it("validates NewsArticle and BlogPosting against the Article profile", () => {
    for (const type of ["Article", "NewsArticle", "BlogPosting"]) {
      const ok = report(
        jsonLd({
          "@context": "https://schema.org",
          "@type": type,
          headline: "Winter checklist",
          image: "https://x/i.jpg",
          datePublished: "2026-01-04",
          dateModified: "2026-01-05",
          author: { "@type": "Person", name: "Ada" },
          publisher: { "@type": "Organization", name: "Summit", url: "https://x/" },
        })
      );
      const item = itemOfType(ok, type);
      expect(item.validation.profile).toBe("Article");
      expect(item.validation.missingRequired).toEqual([]);
      expect(item.validation.missingRecommended).toEqual([]);

      const bad = report(jsonLd({ "@context": "https://schema.org", "@type": type, description: "no headline" }));
      const badItem = itemOfType(bad, type);
      expect(badItem.validation.missingRequired).toEqual(["headline"]);
      expect(badItem.validation.missingRecommended).toEqual(["image", "datePublished", "dateModified", "author", "publisher"]);
    }
  });

  it("validates FAQPage down to each Question and its acceptedAnswer", () => {
    const ok = report(
      jsonLd({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          { "@type": "Question", name: "Is it waterproof?", acceptedAnswer: { "@type": "Answer", text: "Yes." } },
        ],
      })
    );
    expect(itemOfType(ok, "FAQPage").validation.missingRequired).toEqual([]);
    expect(itemOfType(ok, "Question").validation.missingRequired).toEqual([]);
    expect(itemOfType(ok, "Answer").validation.missingRequired).toEqual([]);

    const bad = report(
      jsonLd({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [{ "@type": "Question", name: "Is it waterproof?" }],
      })
    );
    expect(itemOfType(bad, "Question").validation.missingRequired).toEqual(["acceptedAnswer or suggestedAnswer"]);
    expect(itemOfType(bad, "FAQPage").validation.missingRequired).toEqual([]);
  });

  it("validates BreadcrumbList list items for position and name", () => {
    const ok = report(
      jsonLd({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://x/" },
          { "@type": "ListItem", position: 2, name: "Packs", item: "https://x/packs" },
        ],
      })
    );
    expect(ok.items.filter((i) => i.types.includes("ListItem"))).toHaveLength(2);
    expect(ok.items.every((i) => i.validation.missingRequired.length === 0)).toBe(true);

    const bad = report(
      jsonLd({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [{ "@type": "ListItem", item: "https://x/" }],
      })
    );
    expect(itemOfType(bad, "ListItem").validation.missingRequired).toEqual(["position", "name"]);
  });

  it("flags an empty BreadcrumbList itemListElement", () => {
    const rep = report(jsonLd({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] }));
    expect(itemOfType(rep, "BreadcrumbList").validation.missingRequired).toEqual(["itemListElement"]);
  });

  it("validates Organization for name and url", () => {
    const ok = report(
      jsonLd({ "@context": "https://schema.org", "@type": "Organization", name: "Summit", url: "https://x/", logo: "https://x/l.png", sameAs: ["https://x.social"], description: "d", address: "a" })
    );
    expect(itemOfType(ok, "Organization").validation).toMatchObject({ missingRequired: [], missingRecommended: [] });
    const bad = report(jsonLd({ "@context": "https://schema.org", "@type": "Organization", logo: "https://x/l.png" }));
    expect(itemOfType(bad, "Organization").validation.missingRequired).toEqual(["name", "url"]);
  });

  it("validates LocalBusiness (and its subtypes) for name and address", () => {
    const bad = report(jsonLd({ "@context": "https://schema.org", "@type": "Restaurant", telephone: "+1" }));
    const item = itemOfType(bad, "Restaurant");
    expect(item.validation.profile).toBe("LocalBusiness");
    expect(item.validation.missingRequired).toEqual(["name", "address"]);

    const ok = report(
      jsonLd({
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: "Summit Outfitters",
        address: { "@type": "PostalAddress", streetAddress: "1 Alpine Way", addressLocality: "Boulder", addressRegion: "CO", postalCode: "80301", addressCountry: "US" },
      })
    );
    expect(itemOfType(ok, "LocalBusiness").validation.missingRequired).toEqual([]);
    expect(itemOfType(ok, "PostalAddress").validation.missingRequired).toEqual([]);
  });

  it("flags a PostalAddress missing the parts Google requires", () => {
    const rep = report(jsonLd({ "@context": "https://schema.org", "@type": "PostalAddress", postalCode: "80301" }));
    expect(itemOfType(rep, "PostalAddress").validation.missingRequired).toEqual([
      "streetAddress",
      "addressLocality",
      "addressCountry",
    ]);
  });

  it("validates Recipe for name and image", () => {
    const bad = report(jsonLd({ "@context": "https://schema.org", "@type": "Recipe", name: "Trail bars" }));
    expect(itemOfType(bad, "Recipe").validation.missingRequired).toEqual(["image"]);
    const ok = report(jsonLd({ "@context": "https://schema.org", "@type": "Recipe", name: "Trail bars", image: "https://x/i.jpg" }));
    expect(itemOfType(ok, "Recipe").validation.missingRequired).toEqual([]);
    expect(itemOfType(ok, "Recipe").validation.missingRecommended).toContain("recipeIngredient");
  });

  it("validates Event for name, startDate and location", () => {
    const bad = report(jsonLd({ "@context": "https://schema.org", "@type": "Event", name: "Trail day" }));
    expect(itemOfType(bad, "Event").validation.missingRequired).toEqual(["startDate", "location"]);
    const ok = report(
      jsonLd({
        "@context": "https://schema.org",
        "@type": "MusicEvent",
        name: "Trail day",
        startDate: "2026-06-01T09:00",
        location: { "@type": "Place", name: "Base camp", address: "1 Alpine Way" },
      })
    );
    expect(itemOfType(ok, "MusicEvent").validation).toMatchObject({ profile: "Event", missingRequired: [] });
    expect(itemOfType(ok, "Place").validation.missingRequired).toEqual([]);
  });

  it("validates Review and AggregateRating, including the ratingCount-or-reviewCount rule", () => {
    const bad = report(jsonLd({ "@context": "https://schema.org", "@type": "Review", reviewBody: "great" }));
    expect(itemOfType(bad, "Review").validation.missingRequired).toEqual(["author", "reviewRating"]);

    const agg = report(jsonLd({ "@context": "https://schema.org", "@type": "AggregateRating", ratingValue: "4.5" }));
    expect(itemOfType(agg, "AggregateRating").validation.missingRequired).toEqual(["ratingCount or reviewCount"]);

    const ok = report(jsonLd({ "@context": "https://schema.org", "@type": "AggregateRating", ratingValue: "4.5", reviewCount: 12 }));
    expect(itemOfType(ok, "AggregateRating").validation.missingRequired).toEqual([]);
  });

  it("validates VideoObject for the four properties Google requires", () => {
    const bad = report(jsonLd({ "@context": "https://schema.org", "@type": "VideoObject", name: "Fitting a pack" }));
    expect(itemOfType(bad, "VideoObject").validation.missingRequired).toEqual(["description", "thumbnailUrl", "uploadDate"]);
    const ok = report(
      jsonLd({ "@context": "https://schema.org", "@type": "VideoObject", name: "n", description: "d", thumbnailUrl: "https://x/t.jpg", uploadDate: "2026-01-01" })
    );
    expect(itemOfType(ok, "VideoObject").validation.missingRequired).toEqual([]);
  });

  it("validates JobPosting, accepting jobLocationType for a remote role", () => {
    const bad = report(jsonLd({ "@context": "https://schema.org", "@type": "JobPosting", title: "Guide" }));
    expect(itemOfType(bad, "JobPosting").validation.missingRequired).toEqual([
      "description",
      "datePosted",
      "hiringOrganization",
      "jobLocation or jobLocationType or applicantLocationRequirements",
    ]);
    const remote = report(
      jsonLd({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Guide",
        description: "d",
        datePosted: "2026-01-01",
        hiringOrganization: { "@type": "Organization", name: "Summit", url: "https://x/" },
        jobLocationType: "TELECOMMUTE",
      })
    );
    expect(itemOfType(remote, "JobPosting").validation.missingRequired).toEqual([]);
  });

  it("validates HowTo for name and step", () => {
    const bad = report(jsonLd({ "@context": "https://schema.org", "@type": "HowTo", name: "Fit a pack" }));
    expect(itemOfType(bad, "HowTo").validation.missingRequired).toEqual(["step"]);
    const ok = report(
      jsonLd({ "@context": "https://schema.org", "@type": "HowTo", name: "Fit a pack", step: [{ "@type": "HowToStep", text: "Loosen straps" }] })
    );
    expect(itemOfType(ok, "HowTo").validation.missingRequired).toEqual([]);
    expect(itemOfType(ok, "HowToStep").validation.missingRequired).toEqual([]);
  });

  it("validates Course and SoftwareApplication", () => {
    const course = report(jsonLd({ "@context": "https://schema.org", "@type": "Course", name: "Navigation 101" }));
    expect(itemOfType(course, "Course").validation.missingRequired).toEqual(["description", "provider"]);
    const app = report(jsonLd({ "@context": "https://schema.org", "@type": "SoftwareApplication", name: "TrailMap" }));
    expect(itemOfType(app, "SoftwareApplication").validation.missingRequired).toEqual(["offers", "aggregateRating or review"]);
  });

  it("treats a multi-valued @type as validated against the first type carrying a profile", () => {
    const rep = report(jsonLd({ "@context": "https://schema.org", "@type": ["Thing", "Product"], name: "P" }));
    expect(rep.items[0]!.validation.profile).toBe("Product");
    expect(rep.items[0]!.validation.missingRequired).toEqual(["offers or review or aggregateRating"]);
  });

  it("normalizes @type written as a schema.org URL", () => {
    const rep = report(jsonLd({ "@context": "https://schema.org", "@type": "https://schema.org/Product", name: "P", offers: { "@type": "Offer", price: 1, priceCurrency: "USD" } }));
    expect(rep.items[0]!.types).toEqual(["Product"]);
    expect(rep.items[0]!.validation.status).toBe("validated");
  });

  it("validateSchemaNode is callable directly for a bare node", () => {
    expect(validateSchemaNode(["Product"], { name: "P" }).missingRequired).toEqual(["offers or review or aggregateRating"]);
  });
});

describe("@graph and nested-node recursion", () => {
  it("validates every node inside @graph, not just the wrapper", () => {
    const rep = report(
      jsonLd({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "Organization", "@id": "https://x/#org", name: "Summit" },
          { "@type": "WebSite", "@id": "https://x/#site", url: "https://x/", name: "Summit" },
          { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home" }] },
        ],
      })
    );
    expect(rep.counts.jsonLdItems).toBe(4);
    expect(itemOfType(rep, "Organization").validation.missingRequired).toEqual(["url"]);
    expect(itemOfType(rep, "Organization").path).toBe("$.@graph[0]");
    expect(itemOfType(rep, "ListItem").path).toBe("$.@graph[2].itemListElement[0]");
    expect(rep.errors.filter((e) => e.kind === "missing-type")).toEqual([]);
  });

  it("does not report the @graph wrapper itself as a typeless node", () => {
    const rep = report(jsonLd({ "@context": "https://schema.org", "@graph": [{ "@type": "Person", name: "Ada" }] }));
    expect(rep.counts.jsonLdItems).toBe(1);
    expect(rep.items[0]!.types).toEqual(["Person"]);
  });

  it("skips validation for a bare @id reference to a node defined elsewhere", () => {
    const rep = report(
      jsonLd({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "Article", headline: "H", image: "i", datePublished: "d", dateModified: "d", author: { "@id": "https://x/#me" }, publisher: { "@type": "Organization", "@id": "https://x/#org" } },
          { "@type": "Organization", "@id": "https://x/#org", name: "Summit", url: "https://x/" },
        ],
      })
    );
    const stub = rep.items.find((i) => i.path.endsWith("publisher"))!;
    expect(stub.validation.status).toBe("reference");
    expect(stub.validation.missingRequired).toEqual([]);
    expect(rep.counts.itemsMissingRequired).toBe(0);
  });

  it("walks an array-rooted block and validates each root", () => {
    const rep = report(
      jsonLd([
        { "@context": "https://schema.org", "@type": "Product", name: "A", offers: { "@type": "Offer", price: 1, priceCurrency: "USD" } },
        { "@context": "https://schema.org", "@type": "Product", name: "B" },
      ])
    );
    expect(rep.items.filter((i) => i.types.includes("Product"))).toHaveLength(2);
    expect(rep.items[0]!.path).toBe("$[0]");
    expect(rep.counts.itemsMissingRequired).toBe(1);
  });
});

describe("malformed JSON vs unknown @type", () => {
  it("reports a truncated block as malformed-json and produces no items", () => {
    const rep = report(`<script type="application/ld+json">{"@type":"Product","name":</script>`);
    expect(rep.counts.jsonLdParseErrors).toBe(1);
    expect(rep.counts.items).toBe(0);
    const errors = rep.errors.filter((e) => e.kind === "malformed-json");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.blockIndex).toBe(0);
    expect(rep.errors.some((e) => e.kind === "unknown-type")).toBe(false);
  });

  it("reports an empty block separately from a malformed one", () => {
    const rep = report(`<script type="application/ld+json"></script>`);
    expect(rep.errors.map((e) => e.kind)).toEqual(["empty-block"]);
  });

  it("reports a misspelled @type as unknown-type, not as a parse error", () => {
    const rep = report(jsonLd({ "@context": "https://schema.org", "@type": "Prodcut", name: "P" }));
    expect(rep.counts.jsonLdParseErrors).toBe(0);
    expect(rep.counts.unknownTypes).toBe(1);
    expect(rep.items[0]!.validation.status).toBe("unknown-type");
    const err = rep.errors.find((e) => e.kind === "unknown-type")!;
    expect(err.value).toBe("Prodcut");
    expect(err.format).toBe("json-ld");
  });

  it("distinguishes a real-but-ungated type from an unknown one", () => {
    const rep = report(jsonLd({ "@context": "https://schema.org", "@type": "CollectionPage", name: "Blog" }));
    expect(rep.items[0]!.validation.status).toBe("no-profile");
    expect(rep.counts.unknownTypes).toBe(0);
    expect(rep.errors).toEqual([]);
  });

  it("reports a typeless top-level JSON-LD object as missing-type", () => {
    const rep = report(jsonLd({ "@context": "https://schema.org", name: "No type here" }));
    expect(rep.items[0]!.validation.status).toBe("missing-type");
    expect(rep.errors.map((e) => e.kind)).toEqual(["missing-type"]);
  });

  it("flags a missing or non-schema.org @context", () => {
    expect(report(jsonLd({ "@type": "Product", name: "P" })).errors.map((e) => e.kind)).toContain("missing-context");
    const wrong = report(jsonLd({ "@context": "https://example.com/ns", "@type": "Product", name: "P" }));
    expect(wrong.errors.map((e) => e.kind)).toContain("invalid-context");
    expect(report(jsonLd({ "@context": "http://schema.org", "@type": "Person", name: "A" })).errors).toEqual([]);
  });
});

describe("buildStructuredDataReport", () => {
  it("counts all three formats on one page and lists the distinct types", () => {
    const html =
      jsonLd({ "@context": "https://schema.org", "@type": "Article", headline: "H", image: "i", datePublished: "d", dateModified: "d", author: "a", publisher: "p" }) +
      `<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">P</span></div>` +
      `<div vocab="https://schema.org/" typeof="Organization"><span property="name">O</span></div>` +
      `<meta property="og:title" content="social">`;
    const rep = report(html);
    expect(rep.counts).toMatchObject({
      jsonLdBlocks: 1,
      jsonLdParseErrors: 0,
      items: 3,
      jsonLdItems: 1,
      microdataItems: 1,
      rdfaItems: 1,
      validatedItems: 3,
    });
    expect(rep.types).toEqual(["Article", "Organization", "Product"]);
    expect(rep.truncated).toBe(false);
  });

  it("counts items missing required properties across formats", () => {
    const rep = report(
      `<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">P</span></div>` +
        `<div vocab="https://schema.org/" typeof="Recipe"><span property="name">R</span></div>`
    );
    expect(rep.counts.itemsMissingRequired).toBe(2);
    expect(rep.items.map((i) => i.format)).toEqual(["microdata", "rdfa"]);
  });

  it("returns an empty report for a page with no structured data at all", () => {
    const rep = report(loadFixture("about.html"));
    expect(rep.counts).toMatchObject({ items: 0, jsonLdBlocks: 0, microdataItems: 0, rdfaItems: 0 });
    expect(rep.errors).toEqual([]);
    expect(rep.types).toEqual([]);
  });

  it("never throws on broken markup", () => {
    expect(() => report(loadFixture("broken-markup.html"))).not.toThrow();
  });

  it("caps runaway item counts and flags the truncation", () => {
    const nodes = Array.from({ length: 400 }, (_, i) => ({ "@type": "ListItem", position: i + 1, name: `n${i}` }));
    const rep = report(jsonLd({ "@context": "https://schema.org", "@graph": nodes }));
    expect(rep.counts.items).toBe(200);
    expect(rep.truncated).toBe(true);
  });
});

describe("extractPage wiring", () => {
  it("populates structuredDataReport alongside the JSON-LD-only structuredData[]", () => {
    const html = `<html><head><base href="https://summittrailgear.example/shop/">
      <meta property="og:title" content="social">
      ${jsonLd({ "@context": "https://schema.org", "@type": "Product", name: "Ridgeline 45" })}</head>
      <body><div itemscope itemtype="https://schema.org/Offer"><a itemprop="url" href="buy">Buy</a></div></body></html>`;
    const result = extractPage(makeArtifact({ html }), makeScope());
    expect(result.structuredData).toHaveLength(1);
    const rep = result.structuredDataReport!;
    expect(rep.counts).toMatchObject({ jsonLdItems: 1, microdataItems: 1, rdfaItems: 0 });
    expect(itemOfType(rep, "Product").validation.missingRequired).toEqual(["offers or review or aggregateRating"]);
    // <base href> must drive microdata URL resolution, not the page URL
    expect(itemOfType(rep, "Offer").node.url).toBe("https://summittrailgear.example/shop/buy");
  });

  it("populates the report from the shipped product fixture", () => {
    const result = extractPage(makeArtifact({ html: loadFixture("products-ridgeline.html") }), makeScope());
    const rep = result.structuredDataReport!;
    expect(rep.counts.jsonLdItems).toBeGreaterThan(0);
    expect(itemOfType(rep, "Product").validation.missingRequired).toContain("offers or review or aggregateRating");
  });
});
