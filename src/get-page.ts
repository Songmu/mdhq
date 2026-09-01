import { loadConfig, resolveRoot } from "./config/config.js";
import { resolveHostConfig } from "./config/match.js";
import { convertHtml } from "./convert/convert-html.js";
import { localizeAssets } from "./assets/localize.js";
import {
  httpDateToRfc3339,
  isRfc3339DateTime,
  rfc3339ToHttpDate
} from "./date.js";
import { MdhqError } from "./errors.js";
import {
  buildFrontmatter,
  markdownContentDigest,
  refreshFrontmatter,
  serializeDocument
} from "./frontmatter/frontmatter.js";
import { fetchHtml, fetchWithEnvProxy } from "./http/fetch.js";
import { transformMarkdown } from "./markdown/transform.js";
import { storagePathForUrl } from "./path/storage-path.js";
import { inspectDestination, saveDocument } from "./storage/save.js";
import type { GetPageOptions, GetPageResult, MdhqWarning } from "./types.js";
import { normalizeHost, parseHttpUrl } from "./url/identity.js";

export async function getPage(options: GetPageOptions): Promise<GetPageResult> {
  const requestedUrl = parseHttpUrl(options.url).href;
  const loaded = await loadConfig(options.configPath);
  const warnings: MdhqWarning[] = [];
  const warn = (warning: MdhqWarning): void => {
    warnings.push(warning);
    options.onWarning?.(warning);
  };
  for (const warning of loaded.warnings) {
    warn(warning);
  }
  const root = resolveRoot(options.root, loaded.config);
  const requested = new URL(requestedUrl);
  const requestedConfig = resolveHostConfig(
    normalizeHost(requested),
    requested.pathname,
    loaded.config.hosts ?? {}
  );
  const requestedEntryKey = requestedConfig?.entryQueryKey ?? undefined;
  const requestedPath = storagePathForUrl({
    root,
    url: requested,
    ...(requestedEntryKey ? { entryQueryKey: requestedEntryKey } : {})
  });
  const requestedExisting = await inspectDestination(
    requestedPath,
    requestedUrl,
    requestedEntryKey,
    root
  );
  if (requestedExisting && !options.update) {
    return {
      requestedUrl,
      sourceUrl: requestedExisting.sourceUrl,
      path: requestedPath,
      status: "skipped",
      assets: [],
      warnings
    };
  }
  const headers = options.headers;
  const userAgent = options.userAgent ?? loaded.config.userAgent;
  const timeoutMs = options.timeoutMs ?? loaded.config.timeoutMs;
  const maxResponseBytes = options.maxResponseBytes ?? loaded.config.maxResponseBytes;
  const maxRedirects = options.maxRedirects ?? loaded.config.maxRedirects;
  const http = {
    ...(headers ? { headers } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxResponseBytes !== undefined ? { maxResponseBytes } : {}),
    ...(maxRedirects !== undefined ? { maxRedirects } : {})
  };
  let conditional: { etag?: string; lastModified?: string } | undefined;
  if (options.update && requestedExisting) {
    if (requestedExisting.etag) {
      conditional = { etag: requestedExisting.etag };
    } else {
      const lastModified = rfc3339ToHttpDate(requestedExisting.lastModified);
      if (lastModified) {
        conditional = { lastModified };
      }
    }
  }
  const fetched = await fetchHtml(requestedUrl, {
    ...http,
    ...(conditional ? { conditional } : {})
  });
  const now = options.now?.() ?? new Date();
  const normalizeLastModified = (
    value: string | undefined,
    fallback?: string
  ): string | undefined => {
    const validFallback = rfc3339ToHttpDate(fallback) ? fallback : undefined;
    if (!value) {
      return validFallback;
    }
    const normalized = httpDateToRfc3339(value);
    if (!normalized) {
      warn({
        code: "INVALID_LAST_MODIFIED",
        message: `Invalid Last-Modified response header: ${value}`,
        url: fetched.finalUrl
      });
      return validFallback;
    }
    return normalized;
  };
  if (fetched.notModified) {
    if (!requestedExisting || !conditional) {
      throw new MdhqError(
        "FETCH_FAILED",
        `HTTP 304 for ${requestedUrl} without a matching stored validator`
      );
    }
    const lastModified = normalizeLastModified(
      fetched.lastModified,
      requestedExisting.lastModified
    );
    const etag = fetched.etag ?? requestedExisting.etag;
    const frontmatter = refreshFrontmatter(requestedExisting.frontmatter, {
      sourceUrl: requestedExisting.sourceUrl,
      requestedUrl,
      created:
        isRfc3339DateTime(requestedExisting.created)
          ? requestedExisting.created
          : now,
      modified: now,
      contentDigest: requestedExisting.contentDigest,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
      ...(loaded.config.frontmatter ? { config: loaded.config.frontmatter } : {})
    });
    const content = serializeDocument(frontmatter, requestedExisting.markdown);
    const storageStatus = await saveDocument({
      path: requestedPath,
      content,
      sourceUrl: requestedExisting.sourceUrl,
      update: true,
      root,
      ...(requestedEntryKey ? { entryQueryKey: requestedEntryKey } : {})
    });
    return {
      requestedUrl,
      sourceUrl: requestedExisting.sourceUrl,
      path: requestedPath,
      status: storageStatus === "updated" ? "unchanged" : storageStatus,
      assets: [],
      warnings
    };
  }
  const finalUrl = new URL(fetched.finalUrl);
  const matchedConfig = resolveHostConfig(
    normalizeHost(finalUrl),
    finalUrl.pathname,
    loaded.config.hosts ?? {}
  );
  const entryQueryKey = matchedConfig?.entryQueryKey ?? undefined;
  const markdownPath = storagePathForUrl({
    root,
    url: finalUrl,
    ...(entryQueryKey ? { entryQueryKey } : {})
  });
  const existing = await inspectDestination(
    markdownPath,
    finalUrl.href,
    entryQueryKey,
    root
  );
  if (existing && !options.update) {
    return {
      requestedUrl,
      sourceUrl: finalUrl.href,
      path: markdownPath,
      status: "skipped",
      assets: [],
      warnings
    };
  }

  const converted = await convertHtml({
    html: fetched.html,
    url: finalUrl,
    defuddle: {
      ...loaded.config.defuddle,
      fetch: fetchWithEnvProxy,
      useAsync:
        options.useAsync ??
        loaded.config.defuddle?.useAsync ??
        loaded.config.useAsync ??
        true
    }
  });
  let metadata = converted.metadata;
  if (converted.metadata.image) {
    try {
      const image = new URL(converted.metadata.image, finalUrl);
      if (image.protocol !== "http:" && image.protocol !== "https:") {
        throw new TypeError(`Unsupported image URL scheme: ${image.protocol}`);
      }
      metadata = {
        ...converted.metadata,
        image: image.href
      };
    } catch {
      const { image: _invalidImage, ...metadataWithoutImage } = converted.metadata;
      metadata = metadataWithoutImage;
      warn({
        code: "INVALID_IMAGE_URL",
        message: `Invalid representative image URL: ${converted.metadata.image}`,
        url: finalUrl.href
      });
    }
  }
  const transformed = transformMarkdown(converted.markdown, finalUrl.href);
  const assetsEnabled = options.assets ?? loaded.config.assets ?? true;
  const localized = assetsEnabled
    ? await localizeAssets({
        markdown: transformed.markdown,
        imageUrls: transformed.imageUrls,
        ...(metadata.image ? { representativeImage: metadata.image } : {}),
        markdownPath,
        root,
        baseUrl: finalUrl.href,
        http: fetched.customHeadersAllowed ? http : { ...http, headers: [] },
        warn
      })
    : {
        markdown: transformed.markdown,
        assets: [],
        ...(metadata.image ? { representativeImage: metadata.image } : {})
      };
  const created =
    isRfc3339DateTime(existing?.created)
      ? existing.created
      : now;
  const contentDigest = markdownContentDigest(localized.markdown);
  const lastModified = normalizeLastModified(fetched.lastModified);
  const frontmatter = buildFrontmatter({
    metadata,
    sourceUrl: finalUrl.href,
    requestedUrl,
    created,
    modified: now,
    contentDigest,
    ...(fetched.etag ? { etag: fetched.etag } : {}),
    ...(lastModified ? { lastModified } : {}),
    ...(localized.representativeImage
      ? { image: localized.representativeImage }
      : {}),
    ...(localized.representativeImageSource
      ? { imageSource: localized.representativeImageSource }
      : {}),
    ...(loaded.config.frontmatter ? { config: loaded.config.frontmatter } : {})
  });
  const content = serializeDocument(frontmatter, localized.markdown);
  const storageStatus = await saveDocument({
    path: markdownPath,
    content,
    sourceUrl: finalUrl.href,
    update: options.update ?? false,
    root,
    ...(entryQueryKey ? { entryQueryKey } : {})
  });
  return {
    requestedUrl,
    sourceUrl: finalUrl.href,
    path: markdownPath,
    status:
      storageStatus === "updated" && existing?.contentDigest === contentDigest
        ? "unchanged"
        : storageStatus,
    assets: localized.assets,
    warnings
  };
}
