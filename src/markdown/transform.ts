import type {
  Definition,
  Image,
  ImageReference,
  Link,
  Nodes,
  Parent,
  Root
} from "mdast";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";

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

function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  }) as Root;
}

function serializeMarkdown(tree: Root): string {
  return toMarkdown(tree, { extensions: [gfmToMarkdown()] }).trimEnd();
}

function isDownloadableImage(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export interface MarkdownTransformResult {
  markdown: string;
  imageUrls: string[];
}

export function transformMarkdown(markdown: string, baseUrl: string): MarkdownTransformResult {
  const tree = parseMarkdown(markdown);
  const definitions = new Map<string, Definition>();
  walk(tree, (node) => {
    if (node.type === "definition") {
      if (!definitions.has(node.identifier)) {
        definitions.set(node.identifier, node);
      }
    }
  });
  const imageUrls: string[] = [];
  const seenImages = new Set<string>();
  const addImage = (url: string): void => {
    if (isDownloadableImage(url) && !seenImages.has(url)) {
      seenImages.add(url);
      imageUrls.push(url);
    }
  };
  walk(tree, (node) => {
    if (node.type === "link") {
      const link = node as Link;
      link.url = absoluteUrl(link.url, baseUrl);
    } else if (node.type === "image") {
      const image = node as Image;
      image.url = absoluteUrl(image.url, baseUrl);
      addImage(image.url);
    } else if (node.type === "linkReference" || node.type === "imageReference") {
      const definition = definitions.get(node.identifier);
      if (definition) {
        definition.url = absoluteUrl(definition.url, baseUrl);
        if (node.type === "imageReference") {
          addImage(definition.url);
        }
      }
    }
  });
  return { markdown: serializeMarkdown(tree), imageUrls };
}

export function rewriteImageUrls(
  markdown: string,
  replacements: ReadonlyMap<string, string>
): string {
  const tree = parseMarkdown(markdown);
  const definitions = new Map<string, Definition>();
  const linkReferences = new Set<string>();
  walk(tree, (node) => {
    if (node.type === "definition") {
      if (!definitions.has(node.identifier)) {
        definitions.set(node.identifier, node);
      }
    } else if (node.type === "linkReference") {
      linkReferences.add(node.identifier);
    } else if (node.type === "image") {
      const image = node as Image;
      image.url = replacements.get(image.url) ?? image.url;
    }
  });

  const rewriteReferences = (parent: Parent): void => {
    parent.children = parent.children.map((node) => {
      if (node.type === "imageReference") {
        const imageReference = node as ImageReference;
        const definition = definitions.get(imageReference.identifier);
        const replacement = definition
          ? replacements.get(definition.url)
          : undefined;
        if (definition && replacement) {
          if (linkReferences.has(imageReference.identifier)) {
            return {
              type: "image",
              url: replacement,
              alt: imageReference.alt,
              title: definition.title
            } satisfies Image;
          }
          definition.url = replacement;
        }
      }
      if ("children" in node && Array.isArray(node.children)) {
        rewriteReferences(node);
      }
      return node;
    });
  };
  rewriteReferences(tree);
  return serializeMarkdown(tree);
}
