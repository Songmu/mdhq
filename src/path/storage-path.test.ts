import path from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizePathSegment, storagePathForUrl } from "./storage-path.js";

const root = path.resolve("/tmp/markhq");

describe("storagePathForUrl", () => {
  it.each([
    ["https://example.com/", "example.com/index.md"],
    ["https://example.com/entry/hoge/", "example.com/entry/hoge.md"],
    ["https://example.com/path/fuga", "example.com/path/fuga.md"],
    ["https://example.com/entry/hoge.html", "example.com/entry/hoge.md"],
    ["https://example.com/entry/hoge.ja.html", "example.com/entry/hoge.ja.md"],
    ["https://example.com/data.json", "example.com/data.json.md"],
    ["https://example.com/file.md", "example.com/file.md.md"],
    ["https://example.com:8443/path", "example.com_8443/path.md"],
    ["https://example.com/%E6%97%A5%E6%9C%AC%E8%AA%9E", "example.com/日本語.md"]
  ])("maps %s to %s", (url, expected) => {
    expect(path.relative(root, storagePathForUrl({ root, url }))).toBe(expected);
  });

  it("uses an entry query value below the original page path", () => {
    expect(
      path.relative(
        root,
        storagePathForUrl({
          root,
          url: "https://example.com/blog/blog.php?entry_id=123",
          entryQueryKey: "entry_id"
        })
      )
    ).toBe("example.com/blog/blog.php/123.md");
  });

  it("uses Windows-safe IPv6 host directories", () => {
    expect(
      path.relative(root, storagePathForUrl({ root, url: "http://[::1]/x" }))
    ).toBe("[__1]/x.md");
    expect(
      path.relative(
        root,
        storagePathForUrl({ root, url: "http://[2001:db8::1]:8080/x" })
      )
    ).toBe("[2001_db8__1]_8080/x.md");
  });

  it("keeps encoded slashes within one safe segment", () => {
    expect(
      path.relative(root, storagePathForUrl({ root, url: "https://example.com/a%2Fb" }))
    ).toBe("example.com/a%2Fb.md");
  });

  it("shortens long absolute paths while preserving the hierarchy", () => {
    const longPath = Array.from(
      { length: 12 },
      (_, index) => `${index}-${"x".repeat(90)}`
    ).join("/");
    const result = storagePathForUrl({ root, url: `https://example.com/${longPath}` });
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(1000);
    expect(result).toMatch(/\.md$/);
  });
});

describe("sanitizePathSegment", () => {
  it("escapes unsafe and special segments", () => {
    expect(sanitizePathSegment("a%3Ab")).toBe("a%3Ab");
    expect(sanitizePathSegment("%2E%2E")).toBe("%2E%2E");
    expect(sanitizePathSegment("CON")).toBe("%43%4F%4E");
    expect(sanitizePathSegment("a%b")).toBe("a%25b");
  });
});
