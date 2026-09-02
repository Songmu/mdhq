import { extractArticleDate } from "./article-date.js";

/**
 * Extracts and normalizes the article publication ("published") date from
 * Schema.org `datePublished` JSON-LD, `article:published_time` /
 * `og:published_time` meta tags, or `itemprop="datePublished"` microdata.
 *
 * This is attempted before falling back to Defuddle's own (string-only)
 * `published` extraction, because Defuddle drops numeric or JSON-LD
 * `@value`-shaped `datePublished` values instead of stringifying them.
 */
export function extractPublishedDate(
  html: string,
  pageUrl?: string
): string | undefined {
  return extractArticleDate(
    html,
    {
      schemaProperty: "datePublished",
      metaProperties: ["article:published_time", "og:published_time"],
      itemprops: ["datePublished"]
    },
    pageUrl
  );
}
