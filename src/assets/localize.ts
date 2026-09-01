import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fetchResource, type FetchResourceOptions } from "../http/fetch.js";
import { rewriteImageUrls } from "../markdown/transform.js";
import type { AssetResult, MarkhqWarning } from "../types.js";

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp"
};
const IMAGE_EXTENSIONS = new Set(Object.values(CONTENT_TYPE_EXTENSIONS));

function assetExtension(contentType: string, finalUrl: string): string {
  const fromType = CONTENT_TYPE_EXTENSIONS[contentType];
  if (fromType) {
    return fromType;
  }
  const extension = path.posix.extname(new URL(finalUrl).pathname).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/u.test(extension) ? extension : ".bin";
}

async function saveAsset(assetPath: string, body: Uint8Array): Promise<"saved" | "reused"> {
  await mkdir(path.dirname(assetPath), { recursive: true });
  try {
    await writeFile(assetPath, body, { flag: "wx" });
    return "saved";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return "reused";
    }
    throw error;
  }
}

export interface LocalizeAssetsOptions {
  markdown: string;
  imageUrls: string[];
  representativeImage?: string;
  markdownPath: string;
  root: string;
  baseUrl: string;
  http?: FetchResourceOptions;
  warn: (warning: MarkhqWarning) => void;
}

export interface LocalizeAssetsResult {
  markdown: string;
  assets: AssetResult[];
  representativeImage?: string;
  representativeImageSource?: string;
}

export async function localizeAssets(
  options: LocalizeAssetsOptions
): Promise<LocalizeAssetsResult> {
  const representativeImage = options.representativeImage
    ? new URL(options.representativeImage, options.baseUrl).href
    : undefined;
  const urls = [...new Set([...options.imageUrls, ...(representativeImage ? [representativeImage] : [])])];
  const replacements = new Map<string, string>();
  const assets: AssetResult[] = [];
  let localRepresentative: string | undefined;

  for (const sourceUrl of urls) {
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
      const digest = createHash("md5").update(response.finalUrl).digest("hex");
      const assetPath = path.join(
        options.root,
        "_assets",
        `${digest}${assetExtension(response.contentType, response.finalUrl)}`
      );
      const status = await saveAsset(assetPath, response.body);
      const relative = path.relative(path.dirname(options.markdownPath), assetPath).split(path.sep).join("/");
      replacements.set(sourceUrl, relative);
      if (sourceUrl === representativeImage) {
        localRepresentative = relative;
      }
      assets.push({
        sourceUrl,
        finalUrl: response.finalUrl,
        path: assetPath,
        status
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const warning = { code: "ASSET_FETCH_FAILED", message, url: sourceUrl };
      options.warn(warning);
      assets.push({ sourceUrl, status: "failed", error: message });
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
