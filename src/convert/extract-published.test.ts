import { describe, expect, it } from "vitest";
import { extractPublishedDate } from "./extract-published.js";

describe("extractPublishedDate", () => {
  it("falls back past malformed JSON-LD to article metadata", () => {
    expect(
      extractPublishedDate(`<html><head>
        <script type="application/ld+json">{invalid</script>
        <meta property="article:published_time" content="2026-08-30">
      </head></html>`)
    ).toBe("2026-08-30");
  });

  it("uses JSON-LD before meta and microdata values", () => {
    expect(
      extractPublishedDate(`<html><head>
        <script type="application/ld+json">
          {"@type":"Article","datePublished":"2026-08-31T12:34:56+09:00"}
        </script>
        <meta property="article:published_time" content="2026-08-30">
      </head><body>
        <time itemprop="datePublished" datetime="2026-08-29"></time>
      </body></html>`)
    ).toBe("2026-08-31T12:34:56+09:00");
  });

  it("accepts a numeric Unix epoch datePublished value", () => {
    expect(
      extractPublishedDate(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "Article",
          datePublished: 1_693_672_496
        })}</script>`
      )
    ).toBe("2023-09-02T16:34:56Z");
  });

  it("accepts a JSON-LD @value object for datePublished", () => {
    expect(
      extractPublishedDate(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "Article",
          datePublished: {
            "@value": "2026-08-31",
            "@type": "http://www.w3.org/2001/XMLSchema#date"
          }
        })}</script>`
      )
    ).toBe("2026-08-31");
  });

  it("selects the first valid value from a JSON-LD candidate array", () => {
    expect(
      extractPublishedDate(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "Article",
          datePublished: ["not a date", "2026-08-31", "2026-01-01"]
        })}</script>`
      )
    ).toBe("2026-08-31");
  });

  it("skips an invalid JSON-LD date and uses the next valid source", () => {
    expect(
      extractPublishedDate(`<html><head>
        <script type="application/ld+json">
          {"@type":"Article","datePublished":"yesterday"}
        </script>
        <meta property="article:published_time" content="2026-08-30">
      </head></html>`)
    ).toBe("2026-08-30");
  });

  it("falls back to og:published_time when article:published_time is absent", () => {
    expect(
      extractPublishedDate(
        `<html><head><meta property="og:published_time" content="2026-08-30"></head></html>`
      )
    ).toBe("2026-08-30");
  });

  it("falls back to itemprop microdata when no meta tag is present", () => {
    expect(
      extractPublishedDate(
        '<time itemprop="datePublished" datetime="2026-08-31"></time>'
      )
    ).toBe("2026-08-31");
  });

  it("matches datePublished in a multi-token itemprop", () => {
    expect(
      extractPublishedDate(
        '<time itemprop="datePublished dateCreated" datetime="2026-08-31"></time>'
      )
    ).toBe("2026-08-31");
  });

  it("selects the primary article independently of graph order", () => {
    const pageUrl = "https://example.com/article";
    const webPage = {
      "@type": "WebPage",
      "@id": `${pageUrl}#webpage`,
      url: pageUrl,
      mainEntity: { "@id": `${pageUrl}#article` },
      datePublished: "2026-08-01"
    };
    const related = {
      "@type": "NewsArticle",
      "@id": "https://example.com/related",
      datePublished: "2026-08-15"
    };
    const article = {
      "@type": "NewsArticle",
      "@id": `${pageUrl}#article`,
      mainEntityOfPage: { "@id": `${pageUrl}#webpage` },
      datePublished: "2026-07-01"
    };
    for (const graph of [
      [webPage, related, article],
      [article, related, webPage]
    ]) {
      expect(
        extractPublishedDate(
          `<script type="application/ld+json">${JSON.stringify({
            "@graph": graph
          })}</script>`,
          pageUrl
        )
      ).toBe("2026-07-01");
    }
  });
});
