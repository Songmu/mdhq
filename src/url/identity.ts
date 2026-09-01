import { domainToASCII } from "node:url";
import { MarkhqError } from "../errors.js";
import { canonicalPathname } from "./pathname.js";

export interface UrlIdentity {
  host: string;
  pathname: string;
  entryKey?: string;
  entryValue?: string;
}

export function parseHttpUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch (error) {
    throw new MarkhqError("INVALID_URL", `Invalid URL: ${String(input)}`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new MarkhqError("UNSUPPORTED_SCHEME", `Unsupported URL scheme: ${url.protocol}`);
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
  const entryValue = entryQueryKey ? url.searchParams.get(entryQueryKey) : null;
  const hasEntryValue = entryValue !== null && entryValue !== "";
  const identity: UrlIdentity = {
    host: normalizeHost(url),
    pathname: canonicalPathname(url.pathname || "/", hasEntryValue)
  };
  if (entryQueryKey && hasEntryValue) {
    identity.entryKey = entryQueryKey;
    identity.entryValue = entryValue.normalize("NFC");
  }
  return identity;
}

export function serializeUrlIdentity(identity: UrlIdentity): string {
  const entry =
    identity.entryKey && identity.entryValue
      ? `?${encodeURIComponent(identity.entryKey)}=${encodeURIComponent(identity.entryValue)}`
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
