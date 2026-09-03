import { describe, expect, it } from "vitest";
import {
  createUrlIdentity,
  normalizeHost,
  resolveEntryQueryKeys,
  sameHttpTarget,
  sameUrlIdentity,
  serializeUrlIdentity
} from "./identity.js";

describe("URL identity", () => {
  it("ignores scheme, fragments, and unconfigured query parameters", () => {
    expect(
      sameUrlIdentity(
        "http://Example.com/path?a=1#top",
        "https://example.com/path?b=2"
      )
    ).toBe(true);
  });

  it("retains nonstandard ports", () => {
    expect(normalizeHost(new URL("https://example.com:8443/"))).toBe("example.com:8443");
  });

  it("includes the configured entry value", () => {
    expect(
      serializeUrlIdentity(
        createUrlIdentity("https://example.com/blog.php?id=123&ignore=1", "id")
      )
    ).toBe("//example.com/blog.php?id=123");
  });

  it("automatically resolves only supported CMS entry URL patterns", () => {
    expect(resolveEntryQueryKeys("https://example.com/article?entry_id=123")).toEqual([
      "entry_id"
    ]);
    expect(resolveEntryQueryKeys("https://example.com/article?p=123")).toEqual(["p"]);
    expect(
      resolveEntryQueryKeys(
        "https://example.com/index.php?option=com_content&view=article&id=123"
      )
    ).toEqual(["option", "view", "id"]);
    expect(resolveEntryQueryKeys("https://example.com/mt.cgi?_type=entry&id=123")).toEqual([
      "_type",
      "id"
    ]);
    expect(resolveEntryQueryKeys("https://example.com/detail.php?id=123")).toEqual(["id"]);
    expect(resolveEntryQueryKeys("https://example.com/?id=123")).toBeUndefined();
    expect(resolveEntryQueryKeys("https://example.com/article?id=123&id=456")).toBeUndefined();
  });

  it("uses explicit configuration in preference to automatic rules", () => {
    const url = "https://example.com/article.php?entry_id=123&id=456";
    expect(resolveEntryQueryKeys(url, "id")).toEqual(["id"]);
    expect(resolveEntryQueryKeys(url, null)).toBeUndefined();
  });

  it("normalizes Unicode and percent-escape spelling in paths", () => {
    expect(
      sameUrlIdentity(
        "https://example.com/%C3%A9",
        "https://example.com/e%CC%81"
      )
    ).toBe(true);
    expect(
      sameUrlIdentity(
        "https://example.com/%7Euser",
        "https://example.com/~user"
      )
    ).toBe(true);
  });

  it("aligns identity with path-equivalent URL variants", () => {
    expect(sameUrlIdentity("https://example.com/x", "https://example.com/x/")).toBe(true);
    expect(
      sameUrlIdentity("https://example.com/x", "https://example.com/x.html")
    ).toBe(true);
    expect(
      sameUrlIdentity("https://example.com/", "https://example.com/index.html")
    ).toBe(true);
    expect(
      sameUrlIdentity("https://example.com/a//b", "https://example.com/a/b")
    ).toBe(true);
  });

  it("normalizes a DNS trailing dot", () => {
    expect(
      sameUrlIdentity(
        "https://example.com./article",
        "https://example.com/article"
      )
    ).toBe(true);
  });

  it("scopes HTTP targets more narrowly than storage identity", () => {
    expect(
      sameHttpTarget(
        "https://example.com/article?a=1#top",
        "https://example.com/article?a=1#bottom"
      )
    ).toBe(true);
    expect(
      sameHttpTarget(
        "http://example.com/article?a=1",
        "https://example.com/article?a=1"
      )
    ).toBe(false);
    expect(
      sameHttpTarget(
        "https://example.com/article?a=1",
        "https://example.com/article?b=2"
      )
    ).toBe(false);
  });
});
