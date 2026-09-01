import { loadConfig, resolveRoot } from "./config/config.js";
import { resolveHostConfig } from "./config/match.js";
import { convertHtml } from "./convert/convert-html.js";
import { localizeAssets } from "./assets/localize.js";
import { buildFrontmatter, serializeDocument } from "./frontmatter/frontmatter.js";
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
  const fetched = await fetchHtml(requestedUrl, http);
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
  const now = options.now?.() ?? new Date();
  const created =
    existing?.created && !Number.isNaN(Date.parse(existing.created))
      ? existing.created
      : now;
  const frontmatter = buildFrontmatter({
    metadata,
    sourceUrl: finalUrl.href,
    requestedUrl,
    created,
    ...(existing && options.update ? { modified: now } : {}),
    ...(localized.representativeImage
      ? { image: localized.representativeImage }
      : {}),
    ...(localized.representativeImageSource
      ? { imageSource: localized.representativeImageSource }
      : {}),
    ...(loaded.config.frontmatter ? { config: loaded.config.frontmatter } : {})
  });
  const content = serializeDocument(frontmatter, localized.markdown);
  const status = await saveDocument({
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
    status,
    assets: localized.assets,
    warnings
  };
}
