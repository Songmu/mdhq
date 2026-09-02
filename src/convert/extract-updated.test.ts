import { describe, expect, it } from "vitest";
import { extractUpdatedDate } from "./extract-updated.js";

describe("extractUpdatedDate", () => {
  it("falls back past malformed JSON-LD to article metadata", () => {
    expect(
      extractUpdatedDate(`<html><head>
        <script type="application/ld+json">{invalid</script>
        <meta property="article:modified_time" content="2026-08-30">
      </head></html>`)
    ).toBe("2026-08-30");
  });

  it("uses JSON-LD before meta and microdata values", () => {
    expect(
      extractUpdatedDate(`<html><head>
        <script type="application/ld+json">
          {"@type":"Article","dateModified":"2026-08-31T12:34:56+09:00"}
        </script>
        <meta property="article:modified_time" content="2026-08-30">
      </head><body>
        <time itemprop="dateModified" datetime="2026-08-29"></time>
      </body></html>`)
    ).toBe("2026-08-31T12:34:56+09:00");
  });

  it("accepts a non-string dateModified value (JSON-LD @value object)", () => {
    expect(
      extractUpdatedDate(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "Article",
          dateModified: {
            "@value": "2026-08-31T12:34:56Z",
            "@type": "http://www.w3.org/2001/XMLSchema#dateTime"
          }
        })}</script>`
      )
    ).toBe("2026-08-31T12:34:56Z");
  });

  it("accepts a numeric Unix epoch dateModified value", () => {
    expect(
      extractUpdatedDate(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "Article",
          dateModified: 1_693_672_496
        })}</script>`
      )
    ).toBe("2023-09-02T16:34:56Z");
  });

  it("skips an invalid JSON-LD date and uses the next valid source", () => {
    expect(
      extractUpdatedDate(`<html><head>
        <script type="application/ld+json">
          {"@type":"Article","dateModified":"yesterday"}
        </script>
        <meta property="article:modified_time" content="2026-08-30">
      </head></html>`)
    ).toBe("2026-08-30");
  });

  it("accepts absolute Schema.org type IRIs", () => {
    expect(
      extractUpdatedDate(`<html><head>
        <script type="application/ld+json">
          {"@type":"https://schema.org/NewsArticle","dateModified":"2026-08-31"}
        </script>
      </head></html>`)
    ).toBe("2026-08-31");
  });

  it("accepts concrete Article subtypes and case-insensitive JSON-LD media types", () => {
    expect(
      extractUpdatedDate(`<html><head>
        <script type="Application/LD+JSON; charset=utf-8">
          {"@type":"https://schema.org/ScholarlyArticle","dateModified":"2026-08-31"}
        </script>
      </head></html>`)
    ).toBe("2026-08-31");
  });

  it("matches dateModified in a multi-token itemprop", () => {
    expect(
      extractUpdatedDate(
        '<time itemprop="datePublished dateModified" datetime="2026-08-31"></time>'
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
      dateModified: "2026-08-01"
    };
    const related = {
      "@type": "NewsArticle",
      "@id": "https://example.com/related",
      dateModified: "2026-08-15"
    };
    const article = {
      "@type": "NewsArticle",
      "@id": `${pageUrl}#article`,
      mainEntityOfPage: { "@id": `${pageUrl}#webpage` },
      dateModified: "2026-09-01"
    };
    for (const graph of [
      [webPage, related, article],
      [article, related, webPage]
    ]) {
      expect(
        extractUpdatedDate(
          `<script type="application/ld+json">${JSON.stringify({
            "@graph": graph
          })}</script>`,
          pageUrl
        )
      ).toBe("2026-09-01");
    }
  });

  it("does not prefer an arbitrarily nested related article", () => {
    expect(
      extractUpdatedDate(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "NewsArticle",
          url: "https://example.com/article",
          dateModified: "2026-09-01",
          citation: {
            "@type": "NewsArticle",
            dateModified: "2026-09-02"
          }
        })}</script>`,
        "https://example.com/article"
      )
    ).toBe("2026-09-01");
  });

  it("prefers an inline mainEntity without an identifier", () => {
    expect(
      extractUpdatedDate(
        `<script type="application/ld+json">${JSON.stringify({
          "@graph": [
            {
              "@type": "NewsArticle",
              dateModified: "2026-09-02"
            },
            {
              "@type": "WebPage",
              url: "https://example.com/article",
              mainEntity: {
                "@type": "NewsArticle",
                dateModified: "2026-09-01"
              }
            }
          ]
        })}</script>`,
        "https://example.com/article"
      )
    ).toBe("2026-09-01");
  });

  it("links a fragment-identified WebPage to its primary article", () => {
    expect(
      extractUpdatedDate(
        `<script type="application/ld+json">${JSON.stringify({
          "@graph": [
            {
              "@type": "NewsArticle",
              "@id": "https://example.com/related",
              dateModified: "2026-09-02"
            },
            {
              "@type": "WebPage",
              "@id": "https://example.com/article#webpage",
              mainEntity: {
                "@id": "https://example.com/article#article"
              }
            },
            {
              "@type": "NewsArticle",
              "@id": "https://example.com/article#article",
              mainEntityOfPage: {
                "@id": "https://example.com/article#webpage"
              },
              dateModified: "2026-09-01"
            }
          ]
        })}</script>`,
        "https://example.com/article"
      )
    ).toBe("2026-09-01");
  });

  it("recognizes fragment-based article links without a WebPage object", () => {
    for (const article of [
      {
        "@type": "NewsArticle",
        "@id": "https://example.com/article#article",
        dateModified: "2026-09-01"
      },
      {
        "@type": "NewsArticle",
        mainEntityOfPage: {
          "@id": "https://example.com/article#webpage"
        },
        dateModified: "2026-09-01"
      }
    ]) {
      expect(
        extractUpdatedDate(
          `<script type="application/ld+json">${JSON.stringify({
            "@graph": [
              {
                "@type": "NewsArticle",
                "@id": "https://example.com/related",
                dateModified: "2026-09-02"
              },
              article
            ]
          })}</script>`,
          "https://example.com/article"
        )
      ).toBe("2026-09-01");
    }
  });
});
