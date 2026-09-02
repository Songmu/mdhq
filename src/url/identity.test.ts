import { describe, expect, it } from "vitest";
import {
  createUrlIdentity,
  normalizeHost,
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
