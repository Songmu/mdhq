import {
  EnvHttpProxyAgent,
  Headers,
  fetch as undiciFetch,
  type Dispatcher
} from "undici";
import { MdhqError } from "../errors.js";
import type { HeaderValue } from "../types.js";
import { DEFAULT_USER_AGENT } from "../version.js";
import { parseHttpUrl } from "../url/identity.js";

export interface FetchResourceOptions {
  headers?: HeaderValue[];
  userAgent?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  acceptedContentTypes?: string[];
  allowNotModified?: boolean;
  conditional?: {
    etag?: string;
    lastModified?: string;
  };
}

export interface FetchedResource {
  body: Uint8Array;
  finalUrl: string;
  contentType: string;
  status: number;
  customHeadersAllowed: boolean;
  notModified: boolean;
  etag?: string;
  lastModified?: string;
}

const proxyAgent = new EnvHttpProxyAgent();

type ProxyFetch = (
  input: RequestInfo | URL,
  init?: RequestInit & { dispatcher?: Dispatcher }
) => Promise<Response>;

const undiciProxyFetch = undiciFetch as unknown as ProxyFetch;

export const fetchWithEnvProxy: typeof globalThis.fetch = (input, init) =>
  undiciProxyFetch(input, { ...init, dispatcher: proxyAgent });

function requestHeaders(
  options: FetchResourceOptions,
  includeCustomHeaders: boolean,
  includeConditionalHeaders: boolean
): Headers {
  const headers = new Headers({
    accept: options.acceptedContentTypes?.join(", ") ?? "*/*",
    "user-agent": options.userAgent ?? DEFAULT_USER_AGENT
  });
  if (includeCustomHeaders) {
    for (const header of options.headers ?? []) {
      headers.append(header.name, header.value);
    }
  }
  if (includeConditionalHeaders && options.conditional) {
    headers.delete("if-none-match");
    headers.delete("if-modified-since");
    if (options.conditional?.etag) {
      headers.set("if-none-match", options.conditional.etag);
    } else if (options.conditional?.lastModified) {
      headers.set("if-modified-since", options.conditional.lastModified);
    }
  }
  return headers;
}

function contentType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new MdhqError("RESPONSE_TOO_LARGE", `Response exceeds ${limit} bytes`);
  }
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new MdhqError("RESPONSE_TOO_LARGE", `Response exceeds ${limit} bytes`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function fetchResource(
  input: string | URL,
  options: FetchResourceOptions = {}
): Promise<FetchedResource> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxResponseBytes = options.maxResponseBytes ?? 20 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 10;
  let url = parseHttpUrl(input);
  let customHeadersAllowed = true;

  for (let redirects = 0; ; redirects += 1) {
    let response: Response;
    try {
      response = (await undiciFetch(url, {
        dispatcher: proxyAgent,
        headers: requestHeaders(options, customHeadersAllowed, redirects === 0),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs)
      })) as unknown as Response;
    } catch (error) {
      throw new MdhqError("FETCH_FAILED", `Failed to fetch ${url.href}`, { cause: error });
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        await response.body?.cancel().catch(() => undefined);
        throw new MdhqError("FETCH_FAILED", `Redirect response has no Location: ${url.href}`);
      }
      if (redirects >= maxRedirects) {
        await response.body?.cancel().catch(() => undefined);
        throw new MdhqError("TOO_MANY_REDIRECTS", `Too many redirects: ${String(input)}`);
      }
      let nextUrl: URL;
      try {
        nextUrl = parseHttpUrl(new URL(location, url));
      } catch (error) {
        await response.body?.cancel().catch(() => undefined);
        if (error instanceof MdhqError && error.code === "UNSUPPORTED_SCHEME") {
          throw error;
        }
        throw new MdhqError(
          "FETCH_FAILED",
          `Invalid redirect Location for ${url.href}: ${location}`,
          { cause: error }
        );
      }
      if (nextUrl.origin !== url.origin) {
        customHeadersAllowed = false;
      }
      await response.body?.cancel().catch(() => undefined);
      url = nextUrl;
      continue;
    }
    const etag = response.headers.get("etag")?.trim() || undefined;
    const lastModified = response.headers.get("last-modified")?.trim() || undefined;
    if (response.status === 304 && options.allowNotModified) {
      await response.body?.cancel().catch(() => undefined);
      return {
        body: new Uint8Array(),
        finalUrl: url.href,
        contentType: "",
        status: response.status,
        customHeadersAllowed,
        notModified: true,
        ...(etag ? { etag } : {}),
        ...(lastModified ? { lastModified } : {})
      };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new MdhqError("FETCH_FAILED", `HTTP ${response.status} for ${url.href}`);
    }
    const type = contentType(response.headers.get("content-type"));
    if (options.acceptedContentTypes && !options.acceptedContentTypes.includes(type)) {
      await response.body?.cancel().catch(() => undefined);
      throw new MdhqError(
        "UNSUPPORTED_CONTENT_TYPE",
        `Unsupported Content-Type ${type || "(missing)"} for ${url.href}`
      );
    }
    let body: Uint8Array;
    try {
      body = await readLimited(response, maxResponseBytes);
    } catch (error) {
      if (error instanceof MdhqError) {
        throw error;
      }
      throw new MdhqError("FETCH_FAILED", `Failed to read response body from ${url.href}`, {
        cause: error
      });
    }
    return {
      body,
      finalUrl: url.href,
      contentType: type,
      status: response.status,
      customHeadersAllowed,
      notModified: false,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {})
    };
  }
}

export type FetchedHtml =
  | {
      notModified: true;
      finalUrl: string;
      customHeadersAllowed: boolean;
      etag?: string;
      lastModified?: string;
    }
  | {
      notModified: false;
      html: string;
      finalUrl: string;
      customHeadersAllowed: boolean;
      etag?: string;
      lastModified?: string;
    };

export async function fetchHtml(
  input: string | URL,
  options: FetchResourceOptions = {}
): Promise<FetchedHtml> {
  const resource = await fetchResource(input, {
    ...options,
    allowNotModified: true,
    acceptedContentTypes: ["text/html", "application/xhtml+xml"]
  });
  if (resource.notModified) {
    return {
      notModified: true,
      finalUrl: resource.finalUrl,
      customHeadersAllowed: resource.customHeadersAllowed,
      ...(resource.etag ? { etag: resource.etag } : {}),
      ...(resource.lastModified ? { lastModified: resource.lastModified } : {})
    };
  }
  return {
    notModified: false,
    html: new TextDecoder().decode(resource.body),
    finalUrl: resource.finalUrl,
    customHeadersAllowed: resource.customHeadersAllowed,
    ...(resource.etag ? { etag: resource.etag } : {}),
    ...(resource.lastModified ? { lastModified: resource.lastModified } : {})
  };
}
