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
import {
  normalizeHost,
  sameHttpTarget
} from "./url/identity.js";
import {
  normalizeRequestedUrl,
  normalizeSourceUrl,
  normalizeSourceUrlWithoutCanonical
} from "./url/normalize.js";

interface GetPageContext {
  options: GetPageOptions;
  requestedUrl: string;
  loaded: Awaited<ReturnType<typeof loadConfig>>;
  warnings: MdhqWarning[];
  warn: (warning: MdhqWarning) => void;
  root: string;
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

const NOTE_BOOKKEEPING_FIELDS = new Set([
  "created",
  "modified",
  "etag",
  "last_modified",
  "content_digest",
  "vary"
]);

function normalizeComparable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeComparable);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeComparable(entry)])
    );
  }
  return value;
}

function userFacingFrontmatter(
  frontmatter: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(frontmatter)
      .filter(([key]) => !NOTE_BOOKKEEPING_FIELDS.has(key))
    .map(
      ([key, value]): [string, unknown] => [key, normalizeComparable(value)]
    )
    .sort(([left], [right]) => left.localeCompare(right))
  );
}

function sameUserFacingFrontmatter(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  return (
    JSON.stringify(userFacingFrontmatter(left)) ===
    JSON.stringify(userFacingFrontmatter(right))
  );
}

export async function getPage(options: GetPageOptions): Promise<GetPageResult> {
  const requestedUrl = normalizeRequestedUrl(options.url);
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
  return getPageAttempt(
    { options, requestedUrl, loaded, warnings, warn, root },
    requestedUrl,
    2,
    true
  );
}

async function getPageAttempt(
  context: GetPageContext,
  fetchUrl: string,
  retriesRemaining: number,
  callerHeadersAllowed: boolean
): Promise<GetPageResult> {
  const { options, requestedUrl, loaded, warnings, warn, root } = context;
  const requestedCandidateUrl = normalizeSourceUrlWithoutCanonical(fetchUrl);
  const requested = new URL(requestedCandidateUrl);
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
    requestedCandidateUrl,
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
  const headers = callerHeadersAllowed ? options.headers : [];
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
    ,
    ...(options.scheduler ? { scheduler: options.scheduler } : {})
  };
  let conditional: { etag?: string; lastModified?: string } | undefined;
  if (
    options.update &&
    requestedExisting &&
    !hasCredentialHeaders(headers) &&
    sameHttpTarget(requestedExisting.sourceUrl, fetchUrl)
  ) {
    if (requestedExisting.etag) {
      conditional = { etag: requestedExisting.etag };
    } else {
      const lastModified = rfc3339ToHttpDate(requestedExisting.lastModified);
      if (lastModified) {
        conditional = { lastModified };
      }
    }
  }
  const fetched = await fetchHtml(fetchUrl, {
    ...http,
    ...(conditional ? { conditional } : {})
  });
  const responseHeadersAllowed =
    callerHeadersAllowed && fetched.customHeadersAllowed;
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
      return undefined;
    }
    return normalized;
  };
  if (fetched.notModified) {
    if (!requestedExisting || !conditional) {
      throw new MdhqError(
        "FETCH_FAILED",
        `HTTP 304 for ${fetchUrl} without a matching stored validator`
      );
    }
    const lastModified = normalizeLastModified(
      fetched.lastModified,
      requestedExisting.lastModified
    );
    const vary = varyNames(fetched.vary);
    const validatorsReusable =
      vary.length === 0 && !hasCredentialHeaders(headers);
    const etag = validatorsReusable
      ? fetched.etag ?? requestedExisting.etag
      : undefined;
    const reusableLastModified = validatorsReusable ? lastModified : undefined;
    const frontmatter = refreshFrontmatter(requestedExisting.frontmatter, {
      sourceUrl: requestedExisting.sourceUrl,
      requestedUrl,
      created:
        isRfc3339DateTime(requestedExisting.created)
          ? requestedExisting.created
          : now,
      modified: requestedExisting.modified ?? now,
      ...(etag ? { etag } : {}),
      ...(reusableLastModified
        ? { lastModified: reusableLastModified }
        : {}),
      ...(loaded.config.frontmatter ? { config: loaded.config.frontmatter } : {})
    });
    const content = serializeDocument(frontmatter, requestedExisting.markdown);
    const storageStatus = await saveDocument({
      path: requestedPath,
      content,
      sourceUrl: requestedExisting.sourceUrl,
      update: true,
      expectedContent: requestedExisting.content,
      root,
      ...(requestedEntryKey ? { entryQueryKey: requestedEntryKey } : {})
    });
    if (storageStatus === "conflicted") {
      if (retriesRemaining === 0) {
        throw new MdhqError(
          "STORAGE_ERROR",
          `Destination changed repeatedly while updating ${requestedPath}`
        );
      }
      return getPageAttempt(
        context,
        fetchUrl,
        retriesRemaining - 1,
        responseHeadersAllowed
      );
    }
    return {
      requestedUrl,
      sourceUrl: requestedExisting.sourceUrl,
      path: requestedPath,
      status: storageStatus === "saved" ? "saved" : "unchanged",
      assets: [],
      warnings
    };
  }
  const finalResponseUrl = new URL(fetched.finalUrl);
  const sourceUrl = normalizeSourceUrl(fetched.html, finalResponseUrl);
  const normalizedSource = new URL(sourceUrl);
  const matchedConfig = resolveHostConfig(
    normalizeHost(normalizedSource),
    normalizedSource.pathname,
    loaded.config.hosts ?? {}
  );
  const entryQueryKey = matchedConfig?.entryQueryKey ?? undefined;
  const markdownPath = storagePathForUrl({
    root,
    url: normalizedSource,
    ...(entryQueryKey ? { entryQueryKey } : {})
  });
  const existing = await inspectDestination(
    markdownPath,
    sourceUrl,
    entryQueryKey,
    root
  );
  if (
    options.update &&
    existing &&
    markdownPath !== requestedPath &&
    sameHttpTarget(sourceUrl, finalResponseUrl)
  ) {
    if (retriesRemaining === 0) {
      throw new MdhqError(
        "STORAGE_ERROR",
        `Redirect destination changed repeatedly while updating ${markdownPath}`
      );
    }
    return getPageAttempt(
      context,
      finalResponseUrl.href,
      retriesRemaining - 1,
      responseHeadersAllowed
    );
  }
  if (existing && !options.update) {
    return {
      requestedUrl,
      sourceUrl,
      path: markdownPath,
      status: "skipped",
      assets: [],
      warnings
    };
  }

  const expectedExisting =
    markdownPath === requestedPath ? requestedExisting : existing;
  const responseCredentialed =
    responseHeadersAllowed && hasCredentialHeaders(http.headers);
  const converted = await convertHtml({
    html: fetched.html,
    url: finalResponseUrl,
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
      const image = new URL(converted.metadata.image, finalResponseUrl);
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
        url: finalResponseUrl.href
      });
    }
  }
  const transformed = transformMarkdown(
    converted.markdown,
    finalResponseUrl.href
  );
  const assetsEnabled = options.assets ?? loaded.config.assets ?? true;
  const localized = assetsEnabled
    ? await localizeAssets({
        markdown: transformed.markdown,
        imageUrls: transformed.imageUrls,
        ...(metadata.image ? { representativeImage: metadata.image } : {}),
        markdownPath,
        root,
        baseUrl: finalResponseUrl.href,
        http: responseHeadersAllowed ? http : { ...http, headers: [] },
        warn
      })
    : {
        markdown: transformed.markdown,
        assets: [],
        ...(metadata.image ? { representativeImage: metadata.image } : {})
      };
  const created =
    isRfc3339DateTime(expectedExisting?.created)
      ? expectedExisting.created
      : now;
  const contentDigest = markdownContentDigest(localized.markdown);
  const lastModified = normalizeLastModified(fetched.lastModified);
  const vary = varyNames(fetched.vary);
  const validatorsReusable =
    vary.length === 0 &&
    !responseCredentialed &&
    sameHttpTarget(sourceUrl, finalResponseUrl);
  const etag = validatorsReusable ? fetched.etag : undefined;
  const reusableLastModified = validatorsReusable ? lastModified : undefined;
  const nextFrontmatterOptions = {
    metadata,
    sourceUrl,
    requestedUrl,
    created,
    modified: now,
    ...(etag ? { etag } : {}),
    ...(reusableLastModified ? { lastModified: reusableLastModified } : {}),
    ...(loaded.config.frontmatter ? { config: loaded.config.frontmatter } : {})
  };
  const nextFrontmatter = buildFrontmatter(nextFrontmatterOptions);
  const noteChanged =
    !expectedExisting ||
    expectedExisting.contentDigest !== contentDigest ||
    !sameUserFacingFrontmatter(
      expectedExisting.frontmatter,
      nextFrontmatter
    );
  const frontmatter = noteChanged
    ? nextFrontmatter
    : buildFrontmatter({
        ...nextFrontmatterOptions,
        modified: expectedExisting.modified ?? now
      });
  const content = serializeDocument(frontmatter, localized.markdown);
  const storageStatus = await saveDocument({
    path: markdownPath,
    content,
    sourceUrl,
    update: options.update ?? false,
    ...(options.update
      ? { expectedContent: expectedExisting?.content ?? null }
      : {}),
    root,
    ...(entryQueryKey ? { entryQueryKey } : {})
  });
  if (storageStatus === "conflicted") {
    if (retriesRemaining === 0) {
      throw new MdhqError(
        "STORAGE_ERROR",
        `Destination changed repeatedly while updating ${markdownPath}`
      );
    }
    return getPageAttempt(
      context,
      fetchUrl,
      retriesRemaining - 1,
      responseHeadersAllowed
    );
  }
  return {
    requestedUrl,
    sourceUrl,
    path: markdownPath,
    status:
      expectedExisting &&
      (storageStatus === "updated" || storageStatus === "skipped") &&
      !noteChanged
        ? "unchanged"
        : storageStatus,
    assets: localized.assets,
    warnings
  };
}
