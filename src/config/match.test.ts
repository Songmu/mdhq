import { describe, expect, it } from "vitest";
import { resolveHostConfig } from "./match.js";

describe("configuration pattern matching", () => {
  it("prefers exact host and path matches", () => {
    const result = resolveHostConfig("api.example.com", "/posts/1", {
      "*.example.com": { entryQueryKey: "wildcard" },
      "api.example.com": {
        entryQueryKey: "host",
        paths: {
          "/posts/*": { entryQueryKey: "glob" },
          "/posts/1": { entryQueryKey: "exact" }
        }
      }
    });
    expect(result).toEqual({ entryQueryKey: "exact" });
  });

  it("allows a path to disable the host entry key", () => {
    const result = resolveHostConfig("example.com", "/search/all", {
      "example.com": {
        entryQueryKey: "id",
        paths: { "/search/*": { entryQueryKey: null } }
      }
    });
    expect(result).toEqual({ entryQueryKey: null });
  });

  it("inherits the host entry key through an empty path configuration", () => {
    const result = resolveHostConfig("example.com", "/articles/one", {
      "example.com": {
        entryQueryKey: "id",
        paths: { "/articles/*": {} }
      }
    });
    expect(result).toEqual({ entryQueryKey: "id" });
  });

  it("rejects equally specific matches", () => {
    expect(() =>
      resolveHostConfig("a.b.com", "/", {
        "a.*.com": {},
        "*.b.com": {}
      })
    ).toThrow(/Ambiguous host patterns/);
  });

  it("does not count character class alternatives as literal specificity", () => {
    expect(() =>
      resolveHostConfig("example.com", "/foo/a", {
        "example.com": {
          paths: {
            "/foo/[ab]": { entryQueryKey: "class" },
            "/foo/?": { entryQueryKey: "single" }
          }
        }
      })
    ).toThrow(/Ambiguous path patterns/);
  });

  it("normalizes host patterns before matching", () => {
    expect(
      resolveHostConfig("xn--r8jz45g.example", "/", {
        "*.EXAMPLE": { entryQueryKey: "wildcard" },
        "例え.EXAMPLE:443": { entryQueryKey: "exact" }
      })
    ).toEqual({ entryQueryKey: "exact" });
  });
});
