import { extractArticleDate } from "./article-date.js";

/**
 * Extracts and normalizes the article modification ("updated") date from
 * Schema.org `dateModified` JSON-LD, `article:modified_time` /
 * `og:updated_time` meta tags, or `itemprop="dateModified"` microdata.
 */
export function extractUpdatedDate(
  html: string,
  pageUrl?: string
): string | undefined {
  return extractArticleDate(
    html,
    {
      schemaProperty: "dateModified",
      metaProperties: ["article:modified_time", "og:updated_time"],
      itemprops: ["dateModified"]
    },
    pageUrl
  );
}
