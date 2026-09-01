import { Defuddle } from "defuddle/node";
import { MarkhqError } from "../errors.js";
import type { ConvertedPage, ConvertHtmlOptions, PageMetadata } from "../types.js";

function nonempty(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}

export async function convertHtml(options: ConvertHtmlOptions): Promise<ConvertedPage> {
  let url: URL;
  try {
    url = options.url instanceof URL ? new URL(options.url.href) : new URL(options.url);
  } catch (error) {
    throw new MarkhqError("INVALID_URL", `Invalid base URL: ${String(options.url)}`, {
      cause: error
    });
  }
  try {
    const result = await Defuddle(options.html, url.href, {
      ...options.defuddle,
      markdown: true,
      useAsync: options.defuddle?.useAsync ?? true
    });
    const markdown = result.content?.trim();
    if (!markdown) {
      throw new MarkhqError("CONVERSION_FAILED", `Defuddle returned no content for ${url.href}`);
    }
    const metadata: PageMetadata = {};
    const stringFields = {
      title: nonempty(result.title),
      description: nonempty(result.description),
      author: nonempty(result.author),
      published: nonempty(result.published),
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
    if (error instanceof MarkhqError) {
      throw error;
    }
    throw new MarkhqError("CONVERSION_FAILED", `Failed to convert ${url.href}`, { cause: error });
  }
}
