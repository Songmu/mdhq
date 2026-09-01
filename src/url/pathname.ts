import { MarkhqError } from "../errors.js";

export const HTML_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".xhtml",
  ".php",
  ".asp",
  ".aspx",
  ".jsp",
  ".jspx"
]);

export function decodeUrlPathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/%(?![0-9a-f]{2})/giu, "%25")).normalize("NFC");
  } catch (error) {
    throw new MarkhqError("INVALID_URL", `Invalid UTF-8 in path segment: ${segment}`, {
      cause: error
    });
  }
}

export function storageBasename(segment: string): string {
  const normalized = decodeUrlPathSegment(segment);
  const match = normalized.match(/(\.[^.]+)$/u);
  const extension = match?.[1];
  return extension && HTML_EXTENSIONS.has(extension.toLowerCase())
    ? normalized.slice(0, -extension.length)
    : normalized;
}

export function canonicalPathname(pathname: string, hasEntryValue = false): string {
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(decodeUrlPathSegment(segment)))
  if (!hasEntryValue) {
    if (segments.length === 0) {
      return "/index";
    }
    const finalIndex = segments.length - 1;
    const finalSegment = pathname.split("/").filter(Boolean).at(-1);
    if (finalSegment !== undefined) {
      segments[finalIndex] = encodeURIComponent(storageBasename(finalSegment));
    }
  }
  return `/${segments.join("/")}`;
}
