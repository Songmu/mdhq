import { loadConfig, resolveRoot } from "./config/config.js";
import { resolveHostConfig } from "./config/match.js";
import { convertHtml } from "./convert/convert-html.js";
import { localizeAssets } from "./assets/localize.js";
import { buildFrontmatter, serializeDocument } from "./frontmatter/frontmatter.js";
import { fetchHtml, fetchWithEnvProxy } from "./http/fetch.js";
import { transformMarkdown } from "./markdown/transform.js";
import { storagePathForUrl } from "./path/storage-path.js";
import { readExistingDocument, saveDocument } from "./storage/save.js";
import type { GetPageOptions, GetPageResult, MarkhqWarning } from "./types.js";
import { normalizeHost, parseHttpUrl } from "./url/identity.js";

export async function getPage(options: GetPageOptions): Promise<GetPageResult> {
  const requestedUrl = parseHttpUrl(options.url).href;
  const loaded = await loadConfig(options.configPath);
  const warnings: MarkhqWarning[] = [];
  const warn = (warning: MarkhqWarning): void => {
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
  const requestedExisting = await readExistingDocument(requestedPath);
  if (requestedExisting && !options.update) {
    const status = await saveDocument({
      path: requestedPath,
      content: "",
      sourceUrl: requestedUrl,
      update: false,
      ...(requestedEntryKey ? { entryQueryKey: requestedEntryKey } : {})
    });
    return {
      requestedUrl,
      sourceUrl: requestedExisting.sourceUrl,
      path: requestedPath,
      status,
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
  const existing = await readExistingDocument(markdownPath);
  if (existing && !options.update) {
    const status = await saveDocument({
      path: markdownPath,
      content: "",
      sourceUrl: finalUrl.href,
      update: false,
      ...(entryQueryKey ? { entryQueryKey } : {})
    });
    return {
      requestedUrl,
      sourceUrl: finalUrl.href,
      path: markdownPath,
      status,
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
  const metadata = converted.metadata.image
    ? {
        ...converted.metadata,
        image: new URL(converted.metadata.image, finalUrl).href
      }
    : converted.metadata;
  const transformed = transformMarkdown(converted.markdown, finalUrl.href);
  const localized = await localizeAssets({
    markdown: transformed.markdown,
    imageUrls: transformed.imageUrls,
    ...(metadata.image ? { representativeImage: metadata.image } : {}),
    markdownPath,
    root,
    baseUrl: finalUrl.href,
    http,
    warn
  });
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
