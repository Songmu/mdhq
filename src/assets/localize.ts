import { createHash } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fetchResource, type FetchResourceOptions } from "../http/fetch.js";
import { rewriteImageUrls } from "../markdown/transform.js";
import { publishFileExclusive } from "../storage/atomic.js";
import type { AssetResult, MdhqWarning } from "../types.js";

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp"
};
const IMAGE_EXTENSIONS = new Set(Object.values(CONTENT_TYPE_EXTENSIONS));
IMAGE_EXTENSIONS.add(".jpeg");
IMAGE_EXTENSIONS.add(".jfif");

function assetExtension(contentType: string, finalUrl: string): string {
  const fromType = CONTENT_TYPE_EXTENSIONS[contentType];
  if (fromType) {
    return fromType;
  }
  const extension = path.posix.extname(new URL(finalUrl).pathname).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/u.test(extension) ? extension : ".bin";
}

async function saveAsset(
  assetPath: string,
  body: Uint8Array,
  root: string
): Promise<"saved" | "reused"> {
  if (await publishFileExclusive(assetPath, body, root)) {
    return "saved";
  }
  const existing = await readFile(assetPath);
  if (Buffer.from(body).equals(existing)) {
    return "reused";
  }
  throw new Error(`Asset digest collision: ${assetPath}`);
}

export interface LocalizeAssetsOptions {
  markdown: string;
  imageUrls: string[];
  representativeImage?: string;
  markdownPath: string;
  root: string;
  baseUrl: string;
  http?: FetchResourceOptions;
  warn: (warning: MdhqWarning) => void;
}

export interface LocalizeAssetsResult {
  markdown: string;
  assets: AssetResult[];
  representativeImage?: string;
  representativeImageSource?: string;
}

interface ProcessedAsset {
  asset: AssetResult;
  replacement?: string;
  representative: boolean;
  warning?: MdhqWarning;
}

async function processAsset(
  sourceUrl: string,
  options: LocalizeAssetsOptions,
  representativeImage: string | undefined
): Promise<ProcessedAsset> {
  try {
    const sameOrigin = new URL(sourceUrl).origin === new URL(options.baseUrl).origin;
    const response = await fetchResource(sourceUrl, {
      ...options.http,
      ...(sameOrigin ? {} : { headers: [] })
    });
    const urlExtension = path.posix.extname(new URL(response.finalUrl).pathname).toLowerCase();
    if (
      (response.contentType && !response.contentType.startsWith("image/")) ||
      (!response.contentType && !IMAGE_EXTENSIONS.has(urlExtension))
    ) {
      throw new Error(`Unsupported asset Content-Type: ${response.contentType || "(missing)"}`);
    }
    const digest = createHash("sha256").update(response.body).digest("hex");
    const assetPath = path.join(
      options.root,
      "_assets",
      `${digest}${assetExtension(response.contentType, response.finalUrl)}`
    );
    const status = await saveAsset(assetPath, response.body, options.root);
    const replacement = path
      .relative(path.dirname(options.markdownPath), assetPath)
      .split(path.sep)
      .join("/");
    return {
      asset: {
        sourceUrl,
        finalUrl: response.finalUrl,
        path: assetPath,
        status
      },
      replacement,
      representative: sourceUrl === representativeImage
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      asset: { sourceUrl, status: "failed", error: message },
      representative: sourceUrl === representativeImage,
      warning: { code: "ASSET_FETCH_FAILED", message, url: sourceUrl }
    };
  }
}

export async function localizeAssets(
  options: LocalizeAssetsOptions
): Promise<LocalizeAssetsResult> {
  const representativeCandidate = options.representativeImage
    ? new URL(options.representativeImage, options.baseUrl)
    : undefined;
  const representativeImage =
    representativeCandidate?.protocol === "http:" ||
    representativeCandidate?.protocol === "https:"
      ? representativeCandidate.href
      : undefined;
  const urls = [...new Set([...options.imageUrls, ...(representativeImage ? [representativeImage] : [])])];
  const replacements = new Map<string, string>();
  const assets: AssetResult[] = [];
  let localRepresentative: string | undefined;

  for (let offset = 0; offset < urls.length; offset += 6) {
    const batch = await Promise.all(
      urls
        .slice(offset, offset + 6)
        .map((sourceUrl) => processAsset(sourceUrl, options, representativeImage))
    );
    for (const result of batch) {
      assets.push(result.asset);
      if (result.warning) {
        options.warn(result.warning);
      }
      if (result.replacement) {
        replacements.set(result.asset.sourceUrl, result.replacement);
        if (result.representative) {
          localRepresentative = result.replacement;
        }
      }
    }
  }

  const result: LocalizeAssetsResult = {
    markdown: rewriteImageUrls(options.markdown, replacements),
    assets
  };
  if (localRepresentative !== undefined) {
    result.representativeImage = localRepresentative;
  }
  if (representativeImage !== undefined && localRepresentative !== undefined) {
    result.representativeImageSource = representativeImage;
  }
  return result;
}
