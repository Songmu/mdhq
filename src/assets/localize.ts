import { createHash } from "node:crypto";
import path from "node:path";
import { lstat, readFile, unlink } from "node:fs/promises";
import { fetchResource, type FetchResourceOptions } from "../http/fetch.js";
import { rewriteImageUrls } from "../markdown/transform.js";
import {
  publishFileExclusive,
  replaceFileAtomic,
  withDestinationLock
} from "../storage/atomic.js";
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
const ASSET_CACHE_VERSION = 1;

interface AssetCacheEntry {
  version: typeof ASSET_CACHE_VERSION;
  sourceUrl: string;
  finalUrl: string;
  assetFile: string;
  contentType: string;
  etag?: string;
  lastModified?: string;
  vary: string[];
}

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

function cachePathForUrl(root: string, sourceUrl: string): string {
  const digest = createHash("sha256").update(sourceUrl).digest("hex");
  return path.join(root, "_assets", ".cache", `${digest}.json`);
}

function varyNames(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean)
    )
  ];
}

function hasCredentialHeaders(
  headers: readonly { name: string }[] | undefined
): boolean {
  return (headers ?? []).some((header) => {
    const name = header.name.toLowerCase();
    return name === "authorization" || name === "cookie";
  });
}

function parseAssetCacheEntry(value: unknown): AssetCacheEntry | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const entry = value as Record<string, unknown>;
  if (
    entry.version !== ASSET_CACHE_VERSION ||
    typeof entry.sourceUrl !== "string" ||
    typeof entry.finalUrl !== "string" ||
    typeof entry.assetFile !== "string" ||
    !/^[a-f0-9]{64}\.[a-z0-9]{1,8}$/u.test(entry.assetFile) ||
    typeof entry.contentType !== "string" ||
    !Array.isArray(entry.vary) ||
    !entry.vary.every((name) => typeof name === "string") ||
    (entry.etag !== undefined && typeof entry.etag !== "string") ||
    (entry.lastModified !== undefined && typeof entry.lastModified !== "string")
  ) {
    return undefined;
  }
  return {
    version: ASSET_CACHE_VERSION,
    sourceUrl: entry.sourceUrl,
    finalUrl: entry.finalUrl,
    assetFile: entry.assetFile,
    contentType: entry.contentType,
    ...(typeof entry.etag === "string" ? { etag: entry.etag } : {}),
    ...(typeof entry.lastModified === "string"
      ? { lastModified: entry.lastModified }
      : {}),
    vary: entry.vary
  };
}

async function readAssetCache(
  cachePath: string,
  sourceUrl: string
): Promise<{ entry?: AssetCacheEntry; warning?: MdhqWarning }> {
  try {
    const metadata = await lstat(cachePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return {
        warning: {
          code: "ASSET_CACHE_INVALID",
          message: `Invalid asset cache metadata: ${cachePath}`,
          url: sourceUrl
        }
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
  const content = await readFile(cachePath, "utf8");
  try {
    const entry = parseAssetCacheEntry(JSON.parse(content));
    if (entry?.sourceUrl === sourceUrl) {
      return { entry };
    }
  } catch {
    // Report malformed cache metadata and recover with an unconditional fetch.
  }
  return {
    warning: {
      code: "ASSET_CACHE_INVALID",
      message: `Invalid asset cache metadata: ${cachePath}`,
      url: sourceUrl
    }
  };
}

async function existingCachedAsset(
  entry: AssetCacheEntry,
  root: string
): Promise<string | undefined> {
  const assetPath = path.join(root, "_assets", entry.assetFile);
  try {
    const metadata = await lstat(assetPath);
    return metadata.isFile() && !metadata.isSymbolicLink()
      ? assetPath
      : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function serializeAssetCache(entry: AssetCacheEntry): string {
  return `${JSON.stringify(entry, null, 2)}\n`;
}

async function removeAssetCache(cachePath: string): Promise<void> {
  try {
    await unlink(cachePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
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
  warnings?: MdhqWarning[];
}

async function processAsset(
  sourceUrl: string,
  options: LocalizeAssetsOptions,
  representativeImage: string | undefined
): Promise<ProcessedAsset> {
  try {
    const sameOrigin = new URL(sourceUrl).origin === new URL(options.baseUrl).origin;
    const http = {
      ...options.http,
      ...(sameOrigin ? {} : { headers: [] })
    };
    const cachePath = cachePathForUrl(options.root, sourceUrl);
    return await withDestinationLock(
      cachePath,
      async () => {
        const cached = await readAssetCache(cachePath, sourceUrl);
        const cachedAsset = cached.entry
          ? await existingCachedAsset(cached.entry, options.root)
          : undefined;
        const validatorsReusable =
          cached.entry !== undefined &&
          cachedAsset !== undefined &&
          cached.entry.finalUrl === sourceUrl &&
          cached.entry.vary.length === 0 &&
          !hasCredentialHeaders(http.headers);
        const conditional = validatorsReusable
          ? cached.entry?.etag
            ? { etag: cached.entry.etag }
            : cached.entry?.lastModified
              ? { lastModified: cached.entry.lastModified }
              : undefined
          : undefined;
        const response = await fetchResource(sourceUrl, {
          ...http,
          conditional: conditional ?? {},
          ...(conditional ? { allowNotModified: true } : {})
        });
        if (response.notModified) {
          if (!cached.entry || !cachedAsset || !conditional) {
            throw new Error(`HTTP 304 without a matching cached asset: ${sourceUrl}`);
          }
          const vary = response.vary ? varyNames(response.vary) : cached.entry.vary;
          if (vary.length === 0) {
            const refreshed: AssetCacheEntry = {
              ...cached.entry,
              ...(response.etag ? { etag: response.etag } : {}),
              ...(response.lastModified
                ? { lastModified: response.lastModified }
                : {}),
              vary
            };
            await replaceFileAtomic(cachePath, serializeAssetCache(refreshed), {
              root: options.root
            });
          } else {
            await removeAssetCache(cachePath);
          }
          const replacement = path
            .relative(path.dirname(options.markdownPath), cachedAsset)
            .split(path.sep)
            .join("/");
          return {
            asset: {
              sourceUrl,
              finalUrl: cached.entry.finalUrl,
              path: cachedAsset,
              status: "reused"
            },
            replacement,
            representative: sourceUrl === representativeImage,
            ...(cached.warning ? { warnings: [cached.warning] } : {})
          };
        }

        const urlExtension = path.posix.extname(new URL(response.finalUrl).pathname).toLowerCase();
        if (
          (response.contentType && !response.contentType.startsWith("image/")) ||
          (!response.contentType && !IMAGE_EXTENSIONS.has(urlExtension))
        ) {
          throw new Error(`Unsupported asset Content-Type: ${response.contentType || "(missing)"}`);
        }
        const digest = createHash("sha256").update(response.body).digest("hex");
        const assetFile = `${digest}${assetExtension(response.contentType, response.finalUrl)}`;
        const assetPath = path.join(options.root, "_assets", assetFile);
        const status = await saveAsset(assetPath, response.body, options.root);
        const vary = varyNames(response.vary);
        const cacheable =
          response.finalUrl === sourceUrl &&
          vary.length === 0 &&
          !hasCredentialHeaders(http.headers) &&
          Boolean(response.etag || response.lastModified);
        if (cacheable) {
          const entry: AssetCacheEntry = {
            version: ASSET_CACHE_VERSION,
            sourceUrl,
            finalUrl: response.finalUrl,
            assetFile,
            contentType: response.contentType,
            ...(response.etag ? { etag: response.etag } : {}),
            ...(response.lastModified
              ? { lastModified: response.lastModified }
              : {}),
            vary
          };
          await replaceFileAtomic(cachePath, serializeAssetCache(entry), {
            root: options.root
          });
        } else if (!hasCredentialHeaders(http.headers)) {
          await removeAssetCache(cachePath);
        }
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
          representative: sourceUrl === representativeImage,
          ...(cached.warning ? { warnings: [cached.warning] } : {})
        };
      },
      options.root
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      asset: { sourceUrl, status: "failed", error: message },
      representative: sourceUrl === representativeImage,
      warnings: [{ code: "ASSET_FETCH_FAILED", message, url: sourceUrl }]
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
      for (const warning of result.warnings ?? []) {
        options.warn(warning);
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
