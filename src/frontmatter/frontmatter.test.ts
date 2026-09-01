import { describe, expect, it } from "vitest";
import {
  buildFrontmatter,
  markdownContentDigest,
  parseDocument,
  parseDocumentFrontmatter,
  serializeDocument
} from "./frontmatter.js";

describe("frontmatter", () => {
  it("adds mdhq fields and requested URL only for redirects", () => {
    const fields = buildFrontmatter({
      metadata: { title: "Example", wordCount: 42 },
      sourceUrl: "https://example.com/final",
      requestedUrl: "https://example.com/start",
      created: new Date("2026-08-31T12:34:56+09:00"),
      modified: new Date("2026-08-31T12:34:56+09:00"),
      contentDigest: "sha256:test"
    });
    expect(fields).toMatchObject({
      title: "Example",
      word_count: 42,
      source: "https://example.com/final",
      requested_url: "https://example.com/start",
      content_digest: "sha256:test"
    });
    expect(fields.created).toMatch(/^2026-08-31T/);
    expect(fields.modified).toMatch(/^2026-08-31T/);
    expect(fields).not.toHaveProperty("type");
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
      modified: new Date("2026-08-31T12:00:00+09:00"),
      contentDigest: "sha256:test"
    });
    expect(fields.created).toBe("2026-08-30T10:00:00-04:00");
  });

  it("treats malformed YAML as unrecognized frontmatter", () => {
    expect(parseDocumentFrontmatter("---\ninvalid: [\n---\nbody")).toBeUndefined();
  });

  it("normalizes the Markdown body and hashes only that body", () => {
    const first = serializeDocument({ source: "https://example.com/", modified: "one" }, "Body\r\n\r\n");
    const second = serializeDocument({ source: "https://example.com/", modified: "two" }, "Body");
    expect(first).toBe("---\nsource: https://example.com/\nmodified: one\n---\n\nBody\n");
    expect(markdownContentDigest("Body\r\n\r\n")).toBe(markdownContentDigest("Body"));
    expect(parseDocument(first)?.markdown).toBe("Body\n");
    expect(first.endsWith("\n")).toBe(true);
    expect(markdownContentDigest(parseDocument(first)?.markdown ?? "")).toBe(
      markdownContentDigest(parseDocument(second)?.markdown ?? "")
    );
  });

  it("allows type to be configured without emitting it by default", () => {
    const common = {
      metadata: {},
      sourceUrl: "https://example.com/",
      requestedUrl: "https://example.com/",
      created: new Date("2026-08-31T12:00:00+09:00"),
      modified: new Date("2026-08-31T12:00:00+09:00"),
      contentDigest: "sha256:test"
    };
    expect(buildFrontmatter(common)).not.toHaveProperty("type");
    expect(
      buildFrontmatter({
        ...common,
        config: { values: { type: "clip" } }
      })
    ).toHaveProperty("type", "clip");
  });
});
