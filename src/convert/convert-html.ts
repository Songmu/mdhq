import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";
import { MdhqError } from "../errors.js";
import { normalizeSourceDate } from "../date.js";
import type { ConvertedPage, ConvertHtmlOptions, PageMetadata } from "../types.js";
import { extractPublishedDateFromDocument } from "./extract-published.js";
import { extractUpdatedDateFromDocument } from "./extract-updated.js";

function nonempty(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}

function dateOnlyEvidence(document: Document): string | undefined {
  const text = document.body?.textContent ?? "";
  const match = text.match(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/iu
  );
  return match ? normalizeSourceDate(match[0]) : undefined;
}

export async function convertHtml(options: ConvertHtmlOptions): Promise<ConvertedPage> {
  let url: URL;
  try {
    url = options.url instanceof URL ? new URL(options.url.href) : new URL(options.url);
  } catch (error) {
    throw new MdhqError("INVALID_URL", `Invalid base URL: ${String(options.url)}`, {
      cause: error
    });
  }
  try {
    const { document } = parseHTML(options.html);
    const updated = extractUpdatedDateFromDocument(document, url.href);
    const publishedFromMetadata = extractPublishedDateFromDocument(document, url.href);
    const publishedDateOnlyEvidence = dateOnlyEvidence(document);
    const result = await Defuddle(options.html, url.href, {
      ...options.defuddle,
      markdown: true,
      useAsync: options.defuddle?.useAsync ?? true
    });
    const markdown = result.content?.trim();
    if (!markdown) {
      throw new MdhqError("CONVERSION_FAILED", `Defuddle returned no content for ${url.href}`);
    }
    const publishedFromDefuddle = normalizeSourceDate(nonempty(result.published));
    const published =
      publishedFromMetadata ??
      (publishedFromDefuddle?.match(/^\d{4}-\d{2}-\d{2}T00:00:00(?:Z|\+00:00)$/u) &&
      publishedDateOnlyEvidence === publishedFromDefuddle.slice(0, 10)
        ? publishedDateOnlyEvidence
        : publishedFromDefuddle);
    const metadata: PageMetadata = {};
    const stringFields = {
      title: nonempty(result.title),
      description: nonempty(result.description),
      author: nonempty(result.author),
      published,
      updated,
      site: nonempty(result.site),
      domain: nonempty(result.domain),
      language: nonempty(result.language),
      image: nonempty(result.image),
      favicon: nonempty(result.favicon)
    };
    for (const [key, value] of Object.entries(stringFields)) {
      if (value !== undefined) {
        metadata[key as keyof typeof stringFields] = value;
      }
    }
    if (result.wordCount > 0) {
      metadata.wordCount = result.wordCount;
    }
    return { markdown, metadata };
  } catch (error) {
    if (error instanceof MdhqError) {
      throw error;
    }
    throw new MdhqError("CONVERSION_FAILED", `Failed to convert ${url.href}`, { cause: error });
  }
}
