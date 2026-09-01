import { createHash } from "node:crypto";
import path from "node:path";
import { MarkhqError } from "../errors.js";
import { createUrlIdentity, parseHttpUrl } from "../url/identity.js";
import { decodeUrlPathSegment } from "../url/pathname.js";

const HTML_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".xhtml",
  ".php",
  ".asp",
  ".aspx",
  ".jsp",
  ".jspx"
]);
const INVALID_CHARACTERS = /[\/\\:*?"<>|\u0000-\u001f\u007f]/u;
const WINDOWS_DEVICES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const MAX_SEGMENT_BYTES = 240;
const MAX_ABSOLUTE_PATH_BYTES = 1000;

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function encodeCharacter(character: string): string {
  return [...Buffer.from(character)].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
}

export function sanitizePathSegment(rawSegment: string): string {
  const normalized = decodeUrlPathSegment(rawSegment);
  if (normalized === "." || normalized === ".." || WINDOWS_DEVICES.test(normalized)) {
    return [...normalized].map(encodeCharacter).join("");
  }
  const characters = [...normalized];
  return characters
    .map((character, index) => {
      const trailingUnsafe =
        index === characters.length - 1 && (character === " " || character === ".");
      return INVALID_CHARACTERS.test(character) || character === "%" || trailingUnsafe
        ? encodeCharacter(character)
        : character;
    })
    .join("");
}

function fitSegment(rawSegment: string, suffix = ""): string {
  const sanitized = sanitizePathSegment(rawSegment);
  return Buffer.byteLength(`${sanitized}${suffix}`) <= MAX_SEGMENT_BYTES
    ? sanitized
    : md5(decodeUrlPathSegment(rawSegment));
}

function markdownFilename(rawSegment: string): string {
  const normalized = decodeUrlPathSegment(rawSegment);
  const extension = path.posix.extname(normalized).toLowerCase();
  const basename = HTML_EXTENSIONS.has(extension)
    ? normalized.slice(0, -extension.length)
    : normalized;
  const suffix = ".md";
  const safe = fitSegment(encodeURIComponent(basename), suffix);
  return `${safe}${suffix}`;
}

function hostDirectory(url: URL): string {
  const identity = createUrlIdentity(url);
  const ipv6 = identity.host.match(/^\[([^\]]+)\](?::(\d+))?$/u);
  const host = ipv6
    ? `[${ipv6[1]?.replaceAll(":", "_")}]${ipv6[2] ? `_${ipv6[2]}` : ""}`
    : identity.host.replaceAll(":", "_");
  if (host.toLowerCase() === "_assets") {
    throw new MarkhqError("PATH_COLLISION", "The normalized host conflicts with _assets");
  }
  return host;
}

export interface StoragePathOptions {
  root: string;
  url: string | URL;
  entryQueryKey?: string;
}

export function storagePathForUrl(options: StoragePathOptions): string {
  const url = parseHttpUrl(options.url);
  const identity = createUrlIdentity(url, options.entryQueryKey);
  const rawSegments = url.pathname.split("/").filter(Boolean);
  const directories = rawSegments.slice(0, -1).map((segment) => fitSegment(segment));
  let filename: string;

  if (identity.entryValue !== undefined) {
    const pageSegment = rawSegments.at(-1) ?? "index";
    directories.push(fitSegment(pageSegment));
    filename = `${fitSegment(encodeURIComponent(identity.entryValue), ".md")}.md`;
  } else if (rawSegments.length === 0) {
    filename = "index.md";
  } else {
    filename = markdownFilename(rawSegments.at(-1) ?? "index");
  }

  const host = hostDirectory(url);
  const segments = [...directories, filename];
  let result = path.resolve(options.root, host, ...segments);
  if (Buffer.byteLength(result) <= MAX_ABSOLUTE_PATH_BYTES) {
    return result;
  }

  const candidates = segments
    .map((segment, index) => ({ index, bytes: Buffer.byteLength(segment) }))
    .sort((a, b) => b.bytes - a.bytes);
  for (const candidate of candidates) {
    const current = segments[candidate.index];
    if (!current) {
      continue;
    }
    segments[candidate.index] = current.endsWith(".md")
      ? `${md5(current.slice(0, -3))}.md`
      : md5(current);
    result = path.resolve(options.root, host, ...segments);
    if (Buffer.byteLength(result) <= MAX_ABSOLUTE_PATH_BYTES) {
      return result;
    }
  }
  throw new MarkhqError("PATH_TOO_LONG", `Storage root is too long: ${options.root}`);
}
