import { parse, stringify } from "yaml";
import type { MarkhqConfig } from "../config/config.js";
import type { PageMetadata } from "../types.js";

export interface FrontmatterOptions {
  metadata: PageMetadata;
  sourceUrl: string;
  requestedUrl: string;
  created: Date | string;
  modified?: Date;
  image?: string;
  imageSource?: string;
  config?: MarkhqConfig["frontmatter"];
}

function formatLocalRfc3339(date: Date | string): string {
  if (typeof date === "string") {
    return date;
  }
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  const minutes = Math.abs(offsetMinutes) % 60;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(hours)}:${pad(minutes)}`;
}

export function buildFrontmatter(options: FrontmatterOptions): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const metadataFields: Array<[string, unknown]> = [
    ["title", options.metadata.title],
    ["description", options.metadata.description],
    ["author", options.metadata.author],
    ["published", options.metadata.published],
    ["site", options.metadata.site],
    ["domain", options.metadata.domain],
    ["language", options.metadata.language],
    ["word_count", options.metadata.wordCount]
  ];
  for (const [key, value] of metadataFields) {
    if (value !== undefined && value !== "") {
      fields[key] = value;
    }
  }
  if (options.image) {
    fields.image = options.image;
  } else if (options.metadata.image) {
    fields.image = options.metadata.image;
  }
  if (options.imageSource) {
    fields.image_source = options.imageSource;
  }
  for (const key of options.config?.exclude ?? []) {
    delete fields[key];
  }
  for (const [key, value] of Object.entries(options.config?.values ?? {})) {
    fields[key] = value;
  }
  fields.source = options.sourceUrl;
  if (options.requestedUrl !== options.sourceUrl) {
    fields.requested_url = options.requestedUrl;
  }
  fields.type = "clip";
  fields.created = formatLocalRfc3339(options.created);
  if (options.modified) {
    fields.modified = formatLocalRfc3339(options.modified);
  }
  return fields;
}

export function serializeDocument(frontmatter: Record<string, unknown>, markdown: string): string {
  return `---\n${stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n\n${markdown.trimEnd()}\n`;
}

export function parseDocumentFrontmatter(document: string): Record<string, unknown> | undefined {
  if (!document.startsWith("---\n")) {
    return undefined;
  }
  const end = document.indexOf("\n---\n", 4);
  if (end < 0) {
    return undefined;
  }
  try {
    const value = parse(document.slice(4, end));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
