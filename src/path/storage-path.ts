import { createHash } from "node:crypto";
import path from "node:path";
import { MarkhqError } from "../errors.js";
import { createUrlIdentity, parseHttpUrl } from "../url/identity.js";
import { decodeUrlPathSegment, storageBasename } from "../url/pathname.js";
const INVALID_CHARACTERS = /[\/\\:*?"<>|\u0000-\u001f\u007f]/u;
const WINDOWS_DEVICES =
  /^(con|prn|aux|nul|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))(?:\.|$)/iu;
const MAX_SEGMENT_BYTES = 240;
const MAX_ABSOLUTE_PATH_LENGTH = process.platform === "win32" ? 240 : 1000;

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function absolutePathLength(value: string): number {
  return process.platform === "win32" ? value.length : Buffer.byteLength(value);
}

function ensureWithinRoot(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new MarkhqError("PATH_COLLISION", `Storage path escapes its root: ${target}`);
  }
  return target;
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
  const safe = fitSegment(encodeURIComponent(storageBasename(rawSegment)), ".md");
  return `${safe}.md`;
}

function hostDirectory(url: URL): string {
  const identity = createUrlIdentity(url);
  const ipv6 = identity.host.match(/^\[([^\]]+)\](?::(\d+))?$/u);
  const host = ipv6
    ? `[${ipv6[1]?.replaceAll(":", "_")}]${ipv6[2] ? `_${ipv6[2]}` : ""}`
    : identity.host.replaceAll(":", "_");
  const safeHost = fitSegment(encodeURIComponent(host));
  if (safeHost.toLowerCase() === "_assets") {
    throw new MarkhqError("PATH_COLLISION", "The normalized host conflicts with _assets");
  }
  return safeHost;
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

  const allSegments = [hostDirectory(url), ...directories, filename];
  const resolvedRoot = path.resolve(options.root);
  let result = path.resolve(resolvedRoot, ...allSegments);
  if (absolutePathLength(result) <= MAX_ABSOLUTE_PATH_LENGTH) {
    return ensureWithinRoot(resolvedRoot, result);
  }

  const candidates = allSegments
    .map((segment, index) => ({
      index,
      length: absolutePathLength(segment),
      replacementLength: segment.endsWith(".md") ? 35 : 32
    }))
    .filter((candidate) => candidate.length > candidate.replacementLength)
    .sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    const current = allSegments[candidate.index];
    if (!current) {
      continue;
    }
    allSegments[candidate.index] = current.endsWith(".md")
      ? `${md5(current.slice(0, -3))}.md`
      : md5(current);
    result = path.resolve(resolvedRoot, ...allSegments);
    if (absolutePathLength(result) <= MAX_ABSOLUTE_PATH_LENGTH) {
      return ensureWithinRoot(resolvedRoot, result);
    }
  }
  throw new MarkhqError(
    "PATH_TOO_LONG",
    `Storage path is too long for ${url.href}: ${result}`
  );
}
