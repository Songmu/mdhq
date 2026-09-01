import type { Image, Link, Nodes, Parent, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";

function walk(node: Nodes, visitor: (node: Nodes) => void): void {
  visitor(node);
  const children = (node as Parent).children;
  if (Array.isArray(children)) {
    for (const child of children) {
      walk(child, visitor);
    }
  }
}

function absoluteUrl(value: string, baseUrl: string): string {
  if (value.startsWith("#")) {
    return value;
  }
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

export interface MarkdownTransformResult {
  markdown: string;
  imageUrls: string[];
}

export function transformMarkdown(markdown: string, baseUrl: string): MarkdownTransformResult {
  const tree = fromMarkdown(markdown) as Root;
  const imageUrls: string[] = [];
  walk(tree, (node) => {
    if (node.type === "link") {
      const link = node as Link;
      link.url = absoluteUrl(link.url, baseUrl);
    } else if (node.type === "image") {
      const image = node as Image;
      image.url = absoluteUrl(image.url, baseUrl);
      imageUrls.push(image.url);
    }
  });
  return { markdown: toMarkdown(tree).trimEnd(), imageUrls: [...new Set(imageUrls)] };
}

export function rewriteImageUrls(
  markdown: string,
  replacements: ReadonlyMap<string, string>
): string {
  const tree = fromMarkdown(markdown) as Root;
  walk(tree, (node) => {
    if (node.type === "image") {
      const image = node as Image;
      image.url = replacements.get(image.url) ?? image.url;
    }
  });
  return toMarkdown(tree).trimEnd();
}
