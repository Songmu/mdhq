import {
  EnvHttpProxyAgent,
  Headers,
  fetch as undiciFetch,
  type Dispatcher
} from "undici";
import { MarkhqError } from "../errors.js";
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
}

export interface FetchedResource {
  body: Uint8Array;
  finalUrl: string;
  contentType: string;
  status: number;
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
  includeCustomHeaders: boolean
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
  return headers;
}

function contentType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) {
    throw new MarkhqError("RESPONSE_TOO_LARGE", `Response exceeds ${limit} bytes`);
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
      throw new MarkhqError("RESPONSE_TOO_LARGE", `Response exceeds ${limit} bytes`);
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
  const originalOrigin = url.origin;

  for (let redirects = 0; ; redirects += 1) {
    let response: Response;
    try {
      response = (await undiciFetch(url, {
        dispatcher: proxyAgent,
        headers: requestHeaders(options, url.origin === originalOrigin),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs)
      })) as unknown as Response;
    } catch (error) {
      throw new MarkhqError("FETCH_FAILED", `Failed to fetch ${url.href}`, { cause: error });
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new MarkhqError("FETCH_FAILED", `Redirect response has no Location: ${url.href}`);
      }
      if (redirects >= maxRedirects) {
        throw new MarkhqError("TOO_MANY_REDIRECTS", `Too many redirects: ${String(input)}`);
      }
      url = parseHttpUrl(new URL(location, url));
      continue;
    }
    if (!response.ok) {
      throw new MarkhqError("FETCH_FAILED", `HTTP ${response.status} for ${url.href}`);
    }
    const type = contentType(response.headers.get("content-type"));
    if (options.acceptedContentTypes && !options.acceptedContentTypes.includes(type)) {
      throw new MarkhqError(
        "UNSUPPORTED_CONTENT_TYPE",
        `Unsupported Content-Type ${type || "(missing)"} for ${url.href}`
      );
    }
    return {
      body: await readLimited(response, maxResponseBytes),
      finalUrl: url.href,
      contentType: type,
      status: response.status
    };
  }
}

export async function fetchHtml(
  input: string | URL,
  options: FetchResourceOptions = {}
): Promise<{ html: string; finalUrl: string }> {
  const resource = await fetchResource(input, {
    ...options,
    acceptedContentTypes: ["text/html", "application/xhtml+xml"]
  });
  return {
    html: new TextDecoder().decode(resource.body),
    finalUrl: resource.finalUrl
  };
}
