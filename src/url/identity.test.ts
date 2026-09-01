import { describe, expect, it } from "vitest";
import {
  createUrlIdentity,
  normalizeHost,
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
});
