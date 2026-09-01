import { describe, expect, it } from "vitest";
import { rewriteImageUrls, transformMarkdown } from "./transform.js";

describe("Markdown transforms", () => {
  it("absolutizes links and images but preserves fragments", () => {
    const result = transformMarkdown(
      "[relative](next) [fragment](#part) ![image](../image.png)",
      "https://example.com/articles/current"
    );
    expect(result.markdown).toContain("(https://example.com/articles/next)");
    expect(result.markdown).toContain("(#part)");
    expect(result.imageUrls).toEqual(["https://example.com/image.png"]);
  });

  it("rewrites only matching image destinations", () => {
    expect(
      rewriteImageUrls(
        "![image](https://example.com/image.png)",
        new Map([["https://example.com/image.png", "../_assets/image.png"]])
      )
    ).toContain("(../_assets/image.png)");
  });
});
