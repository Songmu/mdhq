import { describe, expect, it } from "vitest";
import { convertHtml } from "./convert-html.js";

describe("convertHtml", () => {
  it("extracts Markdown and metadata from HTML", async () => {
    const result = await convertHtml({
      html: `<!doctype html><html><head><title>Example</title></head><body><article><h1>Example</h1><p>Hello world from markhq.</p></article></body></html>`,
      url: "https://example.com/article",
      defuddle: { useAsync: false }
    });
    expect(result.markdown).toContain("Hello world");
    expect(result.metadata.title).toBe("Example");
  });

  it("accepts a local-file base URL in the low-level API", async () => {
    const result = await convertHtml({
      html: "<html><body><article><p>Local article content.</p></article></body></html>",
      url: "file:///tmp/article.html",
      defuddle: { useAsync: false }
    });
    expect(result.markdown).toContain("Local article content");
  });
});
