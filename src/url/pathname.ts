import { MarkhqError } from "../errors.js";

export function decodeUrlPathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/%(?![0-9a-f]{2})/giu, "%25")).normalize("NFC");
  } catch (error) {
    throw new MarkhqError("INVALID_URL", `Invalid UTF-8 in path segment: ${segment}`, {
      cause: error
    });
  }
}

export function canonicalPathname(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeUrlPathSegment(segment)))
    .join("/");
}
