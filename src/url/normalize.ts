import { parseHTML } from "linkedom";
import {
  defaultTrackingParams,
  stripTrackingParams,
  type TrackingParam
} from "urlpurify";
import { canonicalPathname } from "./pathname.js";
import { normalizeHost, parseHttpUrl } from "./identity.js";

const FUNCTIONAL_PAGE_PARAMS = new Set([
  "preview",
  "preview_id",
  "preview_nonce"
]);
const PAGE_TRACKING_PARAMS: TrackingParam[] = defaultTrackingParams.filter(
  (parameter) =>
    typeof parameter !== "string" ||
    !FUNCTIONAL_PAGE_PARAMS.has(parameter.toLowerCase())
);

function withoutFragment(url: URL): URL {
  const normalized = new URL(url.href);
  normalized.hash = "";
  return normalized;
}

function normalizedOrigin(url: URL): string {
  return `${url.protocol}//${normalizeHost(url)}`;
}

function canonicalUrl(html: string, finalUrl: URL): URL | undefined {
  let document: Document;
  try {
    ({ document } = parseHTML(html));
  } catch {
    return undefined;
  }
  const canonicalLinks = [...document.querySelectorAll("link[href]")].filter((link) =>
    (link.getAttribute("rel") ?? "")
      .split(/\s+/u)
      .some((token) => token.toLowerCase() === "canonical")
  );
  if (canonicalLinks.length !== 1) {
    return undefined;
  }

  let baseUrl = finalUrl;
  const baseHref = document.querySelector("base[href]")?.getAttribute("href");
  if (baseHref) {
    try {
      baseUrl = parseHttpUrl(new URL(baseHref, finalUrl));
    } catch {
      baseUrl = finalUrl;
    }
  }

  const href = canonicalLinks[0]?.getAttribute("href");
  if (!href) {
    return undefined;
  }
  try {
    return parseHttpUrl(new URL(href, baseUrl));
  } catch {
    return undefined;
  }
}

function isCanonicalEquivalent(finalUrl: URL, canonical: URL): boolean {
  return (
    canonical.username === "" &&
    canonical.password === "" &&
    normalizedOrigin(finalUrl) === normalizedOrigin(canonical) &&
    canonicalPathname(finalUrl.pathname || "/") ===
      canonicalPathname(canonical.pathname || "/")
  );
}

export function normalizeRequestedUrl(input: string | URL): string {
  return withoutFragment(parseHttpUrl(input)).href;
}

export function normalizeSourceUrlWithoutCanonical(input: string | URL): string {
  const url = withoutFragment(parseHttpUrl(input));
  return withoutFragment(
    parseHttpUrl(stripTrackingParams(url.href, PAGE_TRACKING_PARAMS))
  ).href;
}

export function normalizeSourceUrl(html: string, finalUrlInput: string | URL): string {
  const finalUrl = withoutFragment(parseHttpUrl(finalUrlInput));
  const canonical = canonicalUrl(html, finalUrl);
  if (canonical && isCanonicalEquivalent(finalUrl, canonical)) {
    return withoutFragment(canonical).href;
  }
  return normalizeSourceUrlWithoutCanonical(finalUrl);
}
