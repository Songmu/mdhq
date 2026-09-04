import { domainToASCII } from "node:url";
import { MdhqError } from "../errors.js";
import { canonicalPathname } from "./pathname.js";

export interface UrlIdentity {
  host: string;
  pathname: string;
  entryParameters?: readonly [string, string][];
}

export type EntryQueryKeys = string | readonly string[] | null | undefined;

function queryValue(url: URL, key: string): string | undefined {
  const values = url.searchParams.getAll(key);
  return values.length === 1 && values[0] ? values[0].normalize("NFC") : undefined;
}

function automaticEntryQueryKeys(url: URL): readonly string[] | undefined {
  if (queryValue(url, "entry_id")) {
    return ["entry_id"];
  }
  const pathname = url.pathname.toLowerCase();
  for (const key of ["p", "page_id", "attachment_id"]) {
    if (
      pathname !== "/" &&
      pathname !== "/index.php" &&
      !pathname.startsWith("/wp-") &&
      queryValue(url, key)
    ) {
      return [key];
    }
  }
  if (
    pathname.endsWith("/index.php") &&
    queryValue(url, "option") === "com_content" &&
    queryValue(url, "view") === "article" &&
    queryValue(url, "id")
  ) {
    return ["option", "view", "id"];
  }
  if (
    (pathname.endsWith("/mt.cgi") || pathname.endsWith("/mt-view.cgi")) &&
    queryValue(url, "_type") === "entry" &&
    queryValue(url, "id")
  ) {
    return ["_type", "id"];
  }
  if (
    /\/(?:article|entry|post|view|detail)\.php$/u.test(pathname) &&
    queryValue(url, "id")
  ) {
    return ["id"];
  }
  return undefined;
}

export function resolveEntryQueryKeys(
  input: string | URL,
  configuredEntryQueryKey: EntryQueryKeys = undefined
): readonly string[] | undefined {
  const url = parseHttpUrl(input);
  if (configuredEntryQueryKey === null) {
    return undefined;
  }
  if (typeof configuredEntryQueryKey === "string") {
    return queryValue(url, configuredEntryQueryKey) ? [configuredEntryQueryKey] : undefined;
  }
  if (configuredEntryQueryKey) {
    return configuredEntryQueryKey.every((key) => queryValue(url, key))
      ? configuredEntryQueryKey
      : undefined;
  }
  return automaticEntryQueryKeys(url);
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
  entryQueryKeys?: EntryQueryKeys
): UrlIdentity {
  const url = parseHttpUrl(input);
  const keys = resolveEntryQueryKeys(url, entryQueryKeys);
  const entryParameters = keys
    ?.map((key): [string, string] | undefined => {
      const value = queryValue(url, key);
      return value ? [key, value] : undefined;
    })
    .filter((entry): entry is [string, string] => entry !== undefined);
  const hasEntryValue = entryParameters !== undefined && entryParameters.length === keys?.length;
  const identity: UrlIdentity = {
    host: normalizeHost(url),
    pathname: canonicalPathname(url.pathname || "/", hasEntryValue)
  };
  if (hasEntryValue && entryParameters) {
    identity.entryParameters = entryParameters;
  }
  return identity;
}

export function serializeUrlIdentity(identity: UrlIdentity): string {
  const entry = identity.entryParameters
    ? `?${identity.entryParameters
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&")}`
    : "";
  return `//${identity.host}${identity.pathname}${entry}`;
}

export function sameUrlIdentity(
  left: string | URL,
  right: string | URL,
  entryQueryKeys?: EntryQueryKeys
): boolean {
  return (
    serializeUrlIdentity(createUrlIdentity(left, entryQueryKeys)) ===
    serializeUrlIdentity(createUrlIdentity(right, entryQueryKeys))
  );
}

export function sameHttpTarget(left: string | URL, right: string | URL): boolean {
  const leftUrl = parseHttpUrl(left);
  const rightUrl = parseHttpUrl(right);
  leftUrl.hash = "";
  rightUrl.hash = "";
  return leftUrl.href === rightUrl.href;
}
