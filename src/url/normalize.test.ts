import { describe, expect, it } from "vitest";
import {
  normalizeRequestedUrl,
  normalizeSourceUrl,
  normalizeSourceUrlWithoutCanonical
} from "./normalize.js";

describe("URL normalization", () => {
  it("uses an equivalent canonical URL and removes its fragment", () => {
    expect(
      normalizeSourceUrl(
        '<html><head><link rel="canonical" href="/article?view=full#top"></head></html>',
        "https://example.com/article?utm_source=newsletter"
      )
    ).toBe("https://example.com/article?view=full");
  });

  it("accepts canonical pathname aliases recognized by storage identity", () => {
    expect(
      normalizeSourceUrl(
        '<html><head><link rel="canonical" href="/article?view=full"></head></html>',
        "https://example.com/article.html?utm_source=newsletter"
      )
    ).toBe("https://example.com/article?view=full");
  });

  it("rejects a canonical alias that changes relative URL resolution", () => {
    expect(
      normalizeSourceUrl(
        '<html><head><link rel="canonical" href="/article/?view=full"></head></html>',
        "https://example.com/article?utm_source=newsletter"
      )
    ).toBe("https://example.com/article");
  });

  it("resolves a relative canonical against a valid document base", () => {
    expect(
      normalizeSourceUrl(
        '<html><head><base href="/articles/"><link rel="canonical" href="../article?clean=1"></head></html>',
        "https://example.com/article?utm_source=newsletter"
      )
    ).toBe("https://example.com/article?clean=1");
  });

  it.each([
    [
      '<link rel="canonical" href="/other?clean=1">',
      "a divergent pathname"
    ],
    [
      '<link rel="canonical" href="/article?one=1"><link rel="canonical" href="/article?two=2">',
      "multiple canonical links"
    ],
    [
      '<link rel="canonical" href="mailto:test@example.com">',
      "a non-HTTP canonical URL"
    ]
  ])("falls back to tracking cleanup for %s", (head) => {
    expect(
      normalizeSourceUrl(
        `<html><head>${head}</head></html>`,
        "https://example.com/article?utm_source=newsletter&id=123#top"
      )
    ).toBe("https://example.com/article?id=123");
  });

  it("serializes the requested URL without its fragment", () => {
    expect(
      normalizeRequestedUrl("HTTPS://Example.COM:443/article?x=1#top")
    ).toBe("https://example.com/article?x=1");
  });

  it("normalizes a pre-fetch source candidate without canonical HTML", () => {
    expect(
      normalizeSourceUrlWithoutCanonical(
        "https://example.com/article?utm_source=newsletter&id=123#top"
      )
    ).toBe("https://example.com/article?id=123");
  });
});
