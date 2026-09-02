import { parseHTML } from "linkedom";
import { normalizeSourceDate } from "../date.js";

const ARTICLE_LIKE_TYPES = new Set([
  "CreativeWork",
  "APIReference",
  "Report",
  "WebPage"
]);

function types(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function schemaTypeName(value: string): string {
  for (const prefix of ["https://schema.org/", "http://schema.org/"]) {
    if (value.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }
  return value;
}

function isArticleLikeType(value: string): boolean {
  const name = schemaTypeName(value);
  return (
    ARTICLE_LIKE_TYPES.has(name) ||
    name.endsWith("Article") ||
    name.endsWith("Posting")
  );
}

function isPageType(value: string): boolean {
  const name = schemaTypeName(value);
  return name === "WebPage" || name.endsWith("Page");
}

function collectJsonLdObjects(
  value: unknown,
  objects: Record<string, unknown>[],
  seen = new Set<object>()
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonLdObjects(item, objects, seen);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const object = value as Record<string, unknown>;
  if (seen.has(object)) {
    return;
  }
  seen.add(object);
  objects.push(object);
  if ("@graph" in object) {
    collectJsonLdObjects(object["@graph"], objects, seen);
  }
  if ("mainEntity" in object) {
    collectJsonLdObjects(object.mainEntity, objects, seen);
  }
}

function referenceUrls(value: unknown, baseUrl: string | undefined): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => referenceUrls(item, baseUrl));
  }
  if (typeof value === "string") {
    try {
      return [new URL(value, baseUrl).href];
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const object = value as Record<string, unknown>;
  return [
    ...referenceUrls(object["@id"], baseUrl),
    ...referenceUrls(object.url, baseUrl)
  ];
}

function pageHref(pageUrl: string | undefined): string | undefined {
  if (!pageUrl) {
    return undefined;
  }
  try {
    const url = new URL(pageUrl);
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

function directlyMatchesPage(
  value: unknown,
  page: string | undefined,
  baseUrl: string | undefined
): boolean {
  if (!page) {
    return false;
  }
  return referenceUrls(value, baseUrl).some((reference) => {
    const url = new URL(reference);
    return !url.hash && url.href === page;
  });
}

function identifiesPageDocument(
  value: unknown,
  page: string | undefined,
  baseUrl: string | undefined
): boolean {
  if (!page) {
    return false;
  }
  return referenceUrls(value, baseUrl).some((reference) => {
    const url = new URL(reference);
    url.hash = "";
    return url.href === page;
  });
}

function intersects(left: readonly string[], right: Set<string>): boolean {
  return left.some((value) => right.has(value));
}

function referencedObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(referencedObjects);
  }
  return value && typeof value === "object"
    ? [value as Record<string, unknown>]
    : [];
}

function jsonLdDates(
  objects: readonly Record<string, unknown>[],
  pageUrl: string | undefined
): string[] {
  const page = pageHref(pageUrl);
  const pageEntityIds = new Set<string>(page ? [page] : []);
  const primaryEntityIds = new Set<string>();
  const primaryEntityObjects = new Set<Record<string, unknown>>();
  for (const object of objects) {
    const pageObject = types(object["@type"]).some(isPageType);
    if (
      (pageObject && identifiesPageDocument(object["@id"], page, pageUrl)) ||
      directlyMatchesPage(object.url, page, pageUrl)
    ) {
      for (const identifier of referenceUrls(object["@id"], pageUrl)) {
        pageEntityIds.add(identifier);
      }
      for (const identifier of referenceUrls(object.mainEntity, pageUrl)) {
        primaryEntityIds.add(identifier);
      }
      for (const entity of referencedObjects(object.mainEntity)) {
        primaryEntityObjects.add(entity);
      }
    }
  }
  return objects
    .flatMap((object, index) => {
      if (
        typeof object.dateModified !== "string" ||
        !types(object["@type"]).some(isArticleLikeType)
      ) {
        return [];
      }
      const names = types(object["@type"]).map(schemaTypeName);
      const concreteArticle = names.some(
        (name) => name.endsWith("Article") || name.endsWith("Posting")
      );
      const identifiers = [
        ...referenceUrls(object["@id"], pageUrl),
        ...referenceUrls(object.url, pageUrl)
      ];
      const primary =
        directlyMatchesPage(object["@id"], page, pageUrl) ||
        directlyMatchesPage(object.url, page, pageUrl) ||
        primaryEntityObjects.has(object) ||
        intersects(referenceUrls(object.mainEntityOfPage, pageUrl), pageEntityIds) ||
        intersects(identifiers, primaryEntityIds);
      return [
        {
          date: object.dateModified,
          score: (primary ? 100 : 0) + (concreteArticle ? 20 : 10),
          index
        }
      ];
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((candidate) => candidate.date);
}

function attributeValue(
  element: Element | null,
  attributes: readonly string[]
): string | undefined {
  for (const attribute of attributes) {
    const value = element?.getAttribute(attribute)?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function extractUpdatedDate(
  html: string,
  pageUrl?: string
): string | undefined {
  const { document } = parseHTML(html);
  const objects: Record<string, unknown>[] = [];
  for (const script of document.querySelectorAll("script[type]")) {
    const mediaType =
      script.getAttribute("type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (mediaType !== "application/ld+json") {
      continue;
    }
    try {
      collectJsonLdObjects(JSON.parse(script.textContent ?? ""), objects);
    } catch {
      // Ignore malformed blocks and continue with other metadata sources.
    }
  }
  for (const candidate of [
    ...jsonLdDates(objects, pageUrl),
    attributeValue(document.querySelector('meta[property="article:modified_time"]'), ["content"]),
    attributeValue(document.querySelector('meta[property="og:updated_time"]'), ["content"]),
    attributeValue(document.querySelector('[itemprop~="dateModified"]'), ["datetime", "content"])
  ]) {
    if (candidate && normalizeSourceDate(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
