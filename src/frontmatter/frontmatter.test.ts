import { describe, expect, it } from "vitest";
import { buildFrontmatter, parseDocumentFrontmatter, serializeDocument } from "./frontmatter.js";

describe("frontmatter", () => {
  it("adds markhq fields and requested URL only for redirects", () => {
    const fields = buildFrontmatter({
      metadata: { title: "Example", wordCount: 42 },
      sourceUrl: "https://example.com/final",
      requestedUrl: "https://example.com/start",
      created: new Date("2026-08-31T12:34:56+09:00")
    });
    expect(fields).toMatchObject({
      title: "Example",
      word_count: 42,
      source: "https://example.com/final",
      requested_url: "https://example.com/start",
      type: "clip"
    });
    expect(fields.created).toMatch(/^2026-08-31T/);
  });

  it("round-trips frontmatter", () => {
    const document = serializeDocument({ source: "https://example.com/" }, "Body");
    expect(parseDocumentFrontmatter(document)).toEqual({ source: "https://example.com/" });
  });

  it("preserves an existing created timestamp verbatim", () => {
    const fields = buildFrontmatter({
      metadata: {},
      sourceUrl: "https://example.com/",
      requestedUrl: "https://example.com/",
      created: "2026-08-30T10:00:00-04:00",
      modified: new Date("2026-08-31T12:00:00+09:00")
    });
    expect(fields.created).toBe("2026-08-30T10:00:00-04:00");
  });

  it("treats malformed YAML as unrecognized frontmatter", () => {
    expect(parseDocumentFrontmatter("---\ninvalid: [\n---\nbody")).toBeUndefined();
  });
});
