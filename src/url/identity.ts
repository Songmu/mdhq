import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";
import { MdhqError } from "../errors.js";
import { canonicalPathname } from "./pathname.js";

export interface UrlIdentity {
  host: string;
  pathname: string;
  entryKey?: string;
  entryValue?: string;
  queryHash?: string;
}

export function queryTail(url: URL): string {
  if (!url.search) {
    return "";
  }
  if (url.pathname.endsWith("/")) {
    return url.search;
  }
  return `${url.pathname.split("/").at(-1) ?? ""}${url.search}`;
}

export function queryTailHash(url: URL): string | undefined {
  const tail = queryTail(url);
  return tail
    ? createHash("md5").update(tail, "utf8").digest("hex")
    : undefined;
}

export function parseHttpUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch (error) {
    throw new MdhqError("INVALID_URL", `Invalid URL: ${String(input)}`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new MdhqError("UNSUPPORTED_SCHEME", `Unsupported URL scheme: ${url.protocol}`);
  }
  return url;
}

export function normalizeHost(url: URL): string {
  const rawHostname = url.hostname.toLowerCase();
  const hostname = domainToASCII(
    /^\.+$/u.test(rawHostname) ? rawHostname : rawHostname.replace(/\.+$/u, "")
  );
  const standardPort =
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443");
  return url.port && !standardPort ? `${hostname}:${url.port}` : hostname;
}

export function createUrlIdentity(
  input: string | URL,
  entryQueryKey?: string
): UrlIdentity {
  const url = parseHttpUrl(input);
  const entryValue = entryQueryKey
    ? url.searchParams.getAll(entryQueryKey).find((value) => value !== "")
    : undefined;
  const hasEntryValue = entryValue !== undefined;
  const identity: UrlIdentity = {
    host: normalizeHost(url),
    pathname: canonicalPathname(url.pathname || "/", hasEntryValue)
  };
  if (entryQueryKey && hasEntryValue) {
    identity.entryKey = entryQueryKey;
    identity.entryValue = entryValue.normalize("NFC");
  } else {
    const hash = queryTailHash(url);
    if (hash) {
      identity.queryHash = hash;
    }
  }
  return identity;
}

export function serializeUrlIdentity(identity: UrlIdentity): string {
  const entry =
    identity.entryKey && identity.entryValue
      ? `?entry-key=${encodeURIComponent(identity.entryKey)}&entry-value=${encodeURIComponent(identity.entryValue)}`
      : identity.queryHash
        ? `?query-md5=${identity.queryHash}`
        : "";
  return `//${identity.host}${identity.pathname}${entry}`;
}

export function sameUrlIdentity(
  left: string | URL,
  right: string | URL,
  entryQueryKey?: string
): boolean {
  return (
    serializeUrlIdentity(createUrlIdentity(left, entryQueryKey)) ===
    serializeUrlIdentity(createUrlIdentity(right, entryQueryKey))
  );
}

export function sameHttpTarget(left: string | URL, right: string | URL): boolean {
  const leftUrl = parseHttpUrl(left);
  const rightUrl = parseHttpUrl(right);
  leftUrl.hash = "";
  rightUrl.hash = "";
  return leftUrl.href === rightUrl.href;
}
