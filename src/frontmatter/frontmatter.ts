import { createHash } from "node:crypto";
import { parse, stringify } from "yaml";
import type { MdhqConfig } from "../config/config.js";
import { formatLocalRfc3339 } from "../date.js";
import type { PageMetadata } from "../types.js";

export interface FrontmatterOptions {
  metadata: PageMetadata;
  sourceUrl: string;
  requestedUrl: string;
  created: Date | string;
  modified: Date | string;
  etag?: string;
  lastModified?: string;
  config?: MdhqConfig["frontmatter"];
}

interface ControlledFrontmatterOptions {
  fields: Record<string, unknown>;
  sourceUrl: string;
  requestedUrl: string;
  created: Date | string;
  modified: Date | string;
  etag?: string;
  lastModified?: string;
  config?: MdhqConfig["frontmatter"];
}

const REMOVED_DEFAULT_FIELDS = [
  "site",
  "domain",
  "image",
  "image_source",
  "word_count",
  "canonical"
];

function applyControlledFields(options: ControlledFrontmatterOptions): Record<string, unknown> {
  const fields = { ...options.fields };
  delete fields.type;
  for (const key of REMOVED_DEFAULT_FIELDS) {
    delete fields[key];
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
  } else {
    delete fields.requested_url;
  }
  fields.created =
    typeof options.created === "string"
      ? options.created
      : formatLocalRfc3339(options.created);
  fields.modified =
    typeof options.modified === "string"
      ? options.modified
      : formatLocalRfc3339(options.modified);
  delete fields.content_digest;
  if (options.etag) {
    fields.etag = options.etag;
  } else {
    delete fields.etag;
  }
  if (options.lastModified) {
    fields.last_modified = options.lastModified;
  } else {
    delete fields.last_modified;
  }
  delete fields.vary;
  return fields;
}

export function buildFrontmatter(options: FrontmatterOptions): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const metadataFields: Array<[string, unknown]> = [
    ["title", options.metadata.title],
    ["description", options.metadata.description],
    ["author", options.metadata.author],
    ["published", options.metadata.published],
    ["updated", options.metadata.updated],
    ["language", options.metadata.language],
    ["canonical_url", options.metadata.canonical]
  ];
  for (const [key, value] of metadataFields) {
    if (value !== undefined && value !== "") {
      fields[key] = value;
    }
  }
  return applyControlledFields({ ...options, fields });
}

export function refreshFrontmatter(
  existing: Record<string, unknown>,
  options: Omit<ControlledFrontmatterOptions, "fields">
): Record<string, unknown> {
  return applyControlledFields({ ...options, fields: existing });
}

export function normalizeMarkdownBody(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/gu, "\n").trimEnd();
  return normalized ? `${normalized}\n` : "";
}

export function markdownContentDigest(markdown: string): string {
  return `sha256:${createHash("sha256").update(normalizeMarkdownBody(markdown), "utf8").digest("hex")}`;
}

export function serializeDocument(frontmatter: Record<string, unknown>, markdown: string): string {
  return `---\n${stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n\n${normalizeMarkdownBody(markdown)}`;
}

export interface ParsedDocument {
  frontmatter: Record<string, unknown>;
  markdown: string;
}

export function parseDocument(document: string): ParsedDocument | undefined {
  const normalized = document.replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) {
    return undefined;
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return undefined;
  }
  try {
    const value = parse(normalized.slice(4, end));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const afterFrontmatter = normalized.slice(end + 5);
    return {
      frontmatter: value as Record<string, unknown>,
      markdown: normalizeMarkdownBody(
        afterFrontmatter.startsWith("\n") ? afterFrontmatter.slice(1) : afterFrontmatter
      )
    };
  } catch {
    return undefined;
  }
}

export function parseDocumentFrontmatter(document: string): Record<string, unknown> | undefined {
  return parseDocument(document)?.frontmatter;
}
