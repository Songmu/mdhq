import { parseHTML } from "linkedom";
import { normalizeSourceDate } from "../date.js";

const ARTICLE_TYPES = new Set([
  "Article",
  "BlogPosting",
  "CreativeWork",
  "NewsArticle",
  "Report",
  "TechArticle",
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

function collectJsonLdDates(value: unknown, dates: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonLdDates(item, dates);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const object = value as Record<string, unknown>;
  if (
    types(object["@type"]).some((type) => ARTICLE_TYPES.has(schemaTypeName(type))) &&
    typeof object.dateModified === "string"
  ) {
    dates.push(object.dateModified);
  }
  if ("@graph" in object) {
    collectJsonLdDates(object["@graph"], dates);
  }
  for (const [key, child] of Object.entries(object)) {
    if (key !== "@graph") {
      collectJsonLdDates(child, dates);
    }
  }
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

export function extractUpdatedDate(html: string): string | undefined {
  const { document } = parseHTML(html);
  const candidates: string[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      collectJsonLdDates(JSON.parse(script.textContent ?? ""), candidates);
    } catch {
      // Ignore malformed blocks and continue with other metadata sources.
    }
  }
  for (const candidate of [
    ...candidates,
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
