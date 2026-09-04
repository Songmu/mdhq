import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sanitizePathSegment, storagePathForUrl } from "./storage-path.js";

const root = path.resolve("/tmp/mdhq");

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
    expect(path.relative(root, storagePathForUrl({ root, url }))).toBe(
      expected.split("/").join(path.sep)
    );
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
    ).toBe(["example.com", "blog", "blog.php", "123.md"].join(path.sep));
  });

  it("uses the first non-empty entry query value", () => {
    expect(
      path.relative(
        root,
        storagePathForUrl({
          root,
          url: "https://example.com/blog/blog.php?entry_id=&entry_id=123",
          entryQueryKey: "entry_id"
        })
      )
    ).toBe(["example.com", "blog", "blog.php", "123.md"].join(path.sep));
  });

  it("hashes the final path segment and query for file-like paths", () => {
    const digest = createHash("md5").update("to.php?id=123").digest("hex");
    expect(
      path.relative(
        root,
        storagePathForUrl({
          root,
          url: "https://example.com/path/to.php?id=123"
        })
      )
    ).toBe(["example.com", "path", `${digest}.md`].join(path.sep));
  });

  it("hashes only the query below a trailing-slash path", () => {
    const digest = createHash("md5").update("?id=123").digest("hex");
    expect(
      path.relative(
        root,
        storagePathForUrl({
          root,
          url: "https://example.com/path/to/?id=123"
        })
      )
    ).toBe(["example.com", "path", "to", `${digest}.md`].join(path.sep));
  });

  it("falls back to a query hash when the configured entry value is empty", () => {
    const digest = createHash("md5")
      .update("blog.php?entry_id=&lang=en")
      .digest("hex");
    expect(
      path.relative(
        root,
        storagePathForUrl({
          root,
          url: "https://example.com/blog/blog.php?entry_id=&lang=en",
          entryQueryKey: "entry_id"
        })
      )
    ).toBe(["example.com", "blog", `${digest}.md`].join(path.sep));
  });

  it("uses Windows-safe IPv6 host directories", () => {
    expect(
      path.relative(root, storagePathForUrl({ root, url: "http://[::1]/x" }))
    ).toBe(["[__1]", "x.md"].join(path.sep));
    expect(
      path.relative(
        root,
        storagePathForUrl({ root, url: "http://[2001:db8::1]:8080/x" })
      )
    ).toBe(["[2001_db8__1]_8080", "x.md"].join(path.sep));
  });

  it("keeps special hostnames inside the storage root", () => {
    expect(storagePathForUrl({ root, url: "http://./page" })).toBe(
      path.join(root, "%2E", "page.md")
    );
    expect(storagePathForUrl({ root, url: "http://../page" })).toBe(
      path.join(root, "%2E%2E", "page.md")
    );
  });

  it("keeps encoded slashes within one safe segment", () => {
    expect(
      path.relative(root, storagePathForUrl({ root, url: "https://example.com/a%2Fb" }))
    ).toBe(["example.com", "a%2Fb.md"].join(path.sep));
  });

  it("shortens long absolute paths while preserving the hierarchy", () => {
    const longPath = Array.from(
      { length: 12 },
      (_, index) => `${index}-${"x".repeat(90)}`
    ).join("/");
    if (process.platform === "win32") {
      expect(() =>
        storagePathForUrl({ root, url: `https://example.com/${longPath}` })
      ).toThrow(/Storage path is too long/);
    } else {
      const result = storagePathForUrl({ root, url: `https://example.com/${longPath}` });
      expect(Buffer.byteLength(result)).toBeLessThanOrEqual(1000);
      expect(result).toMatch(/\.md$/);
    }
  });

  it("hashes an overlong host segment", () => {
    const labels = Array.from({ length: 4 }, (_, index) => `${index}${"a".repeat(60)}`);
    const result = storagePathForUrl({
      root,
      url: `https://${labels.join(".")}/page`
    });
    expect(path.basename(path.dirname(result))).toMatch(/^[a-f0-9]{32}$/u);
  });
});

describe("sanitizePathSegment", () => {
  it("escapes unsafe and special segments", () => {
    expect(sanitizePathSegment("a%3Ab")).toBe("a%3Ab");
    expect(sanitizePathSegment("%2E%2E")).toBe("%2E%2E");
    expect(sanitizePathSegment("CON")).toBe("%43%4F%4E");
    expect(sanitizePathSegment("a%b")).toBe("a%25b");
  });

  it.each(["COM¹", "COM².txt", "COM³", "LPT¹", "LPT².txt", "LPT³"])(
    "escapes the Windows reserved device name %s",
    (name) => {
      expect(sanitizePathSegment(encodeURIComponent(name))).toMatch(/^%/u);
    }
  );
});
