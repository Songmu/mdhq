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

  it("matches dateModified in a multi-token itemprop", () => {
    expect(
      extractUpdatedDate(
        '<time itemprop="datePublished dateModified" datetime="2026-08-31"></time>'
      )
    ).toBe("2026-08-31");
  });
});
