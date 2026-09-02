import { describe, expect, it } from "vitest";
import {
  buildFrontmatter,
  markdownContentDigest,
  parseDocument,
  parseDocumentFrontmatter,
  refreshFrontmatter,
  serializeDocument
} from "./frontmatter.js";

describe("frontmatter", () => {
  it("adds mdhq fields and requested URL only for redirects", () => {
    const fields = buildFrontmatter({
      metadata: { title: "Example" },
      sourceUrl: "https://example.com/final",
      requestedUrl: "https://example.com/start",
      created: new Date("2026-08-31T12:34:56+09:00"),
      modified: new Date("2026-08-31T12:34:56+09:09")
    });
    expect(fields).toMatchObject({
      title: "Example",
      source: "https://example.com/final",
      requested_url: "https://example.com/start"
    });
    expect(fields).not.toHaveProperty("content_digest");
    expect(fields).not.toHaveProperty("vary");
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
      modified: new Date("2026-08-31T12:00:00+09:00")
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
      modified: new Date("2026-08-31T12:00:00+09:00")
    };
    expect(buildFrontmatter(common)).not.toHaveProperty("type");
    expect(
      buildFrontmatter({
        ...common,
        config: {
          exclude: ["vary"],
          values: { type: "clip", vary: "caller-value" }
        }
      })
    ).toMatchObject({ type: "clip" });
    expect(
      buildFrontmatter({
        ...common,
        config: {
          exclude: ["vary"],
          values: { type: "clip", vary: "caller-value" }
        }
      })
    ).not.toHaveProperty("vary");
  });

  it("does not emit site, domain, image, image_source, or word_count by default", () => {
    const fields = buildFrontmatter({
      metadata: {
        title: "Example",
        site: "Example Site",
        domain: "example.com",
        image: "https://example.com/image.png",
        wordCount: 42
      },
      sourceUrl: "https://example.com/",
      requestedUrl: "https://example.com/",
      created: new Date("2026-08-31T12:00:00+09:00"),
      modified: new Date("2026-08-31T12:00:00+09:00")
    });
    expect(fields).not.toHaveProperty("site");
    expect(fields).not.toHaveProperty("domain");
    expect(fields).not.toHaveProperty("image");
    expect(fields).not.toHaveProperty("image_source");
    expect(fields).not.toHaveProperty("word_count");
  });

  it("allows removed default fields to be added back via frontmatter.values", () => {
    const fields = buildFrontmatter({
      metadata: { title: "Example" },
      sourceUrl: "https://example.com/",
      requestedUrl: "https://example.com/",
      created: new Date("2026-08-31T12:00:00+09:00"),
      modified: new Date("2026-08-31T12:00:00+09:00"),
      config: { values: { site: "Custom Site", word_count: 7 } }
    });
    expect(fields).toMatchObject({ site: "Custom Site", word_count: 7 });
  });

  it("strips stale removed default fields when refreshing existing frontmatter", () => {
    const fields = refreshFrontmatter(
      {
        source: "https://example.com/",
        site: "Example Site",
        domain: "example.com",
        image: "https://example.com/image.png",
        image_source: "https://example.com/original.png",
        word_count: 42
      },
      {
        sourceUrl: "https://example.com/",
        requestedUrl: "https://example.com/",
        created: new Date("2026-08-31T12:00:00+09:00"),
        modified: new Date("2026-08-31T12:00:00+09:00")
      }
    );
    expect(fields).not.toHaveProperty("site");
    expect(fields).not.toHaveProperty("domain");
    expect(fields).not.toHaveProperty("image");
    expect(fields).not.toHaveProperty("image_source");
    expect(fields).not.toHaveProperty("word_count");
  });
});
