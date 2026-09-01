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

  it("preserves GFM and rewrites reference-style links and images", () => {
    const transformed = transformMarkdown(
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n~~gone~~\n\n[link][target]\n\n![image][asset]\n\n[target]: /next\n[asset]: /image.png",
      "https://example.com/article"
    );
    expect(transformed.markdown).toContain("| a | b |");
    expect(transformed.markdown).toContain("~~gone~~");
    expect(transformed.markdown).toContain(
      "[target]: https://example.com/next"
    );
    expect(transformed.imageUrls).toEqual(["https://example.com/image.png"]);
    expect(
      rewriteImageUrls(
        transformed.markdown,
        new Map([["https://example.com/image.png", "../_assets/image.png"]])
      )
    ).toContain("[asset]: ../_assets/image.png");
  });

  it("leaves data images untouched without scheduling a download", () => {
    const result = transformMarkdown(
      "![inline](data:image/png;base64,AAAA)",
      "https://example.com/article"
    );
    expect(result.imageUrls).toEqual([]);
    expect(result.markdown).toContain("data:image/png;base64,AAAA");
  });

  it("uses the first duplicate reference definition", () => {
    const result = transformMarkdown(
      "![image][asset]\n\n[asset]: /first.png\n[asset]: /second.png",
      "https://example.com/article"
    );
    expect(result.imageUrls).toEqual(["https://example.com/first.png"]);
  });
});
