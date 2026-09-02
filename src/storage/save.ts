import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { MdhqError } from "../errors.js";
import { markdownContentDigest, parseDocument } from "../frontmatter/frontmatter.js";
import { sameUrlIdentity } from "../url/identity.js";
import {
  publishFileExclusive,
  replaceFileAtomic,
  withDestinationLock
} from "./atomic.js";
import { assertSafeDestination } from "./path-safety.js";

export interface SaveDocumentOptions {
  path: string;
  content: string;
  sourceUrl: string;
  update: boolean;
  expectedContent?: string | null;
  entryQueryKey?: string;
  root?: string;
}

export interface ExistingDocument {
  content: string;
  sourceUrl: string;
  frontmatter: Record<string, unknown>;
  markdown: string;
  contentDigest: string;
  created?: string;
  modified?: string;
  etag?: string;
  lastModified?: string;
}

export async function readExistingDocument(filePath: string): Promise<ExistingDocument | undefined> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw new MdhqError("STORAGE_ERROR", `Failed to read ${filePath}`, { cause: error });
  }
  const parsed = parseDocument(content);
  if (!parsed || typeof parsed.frontmatter.source !== "string") {
    throw new MdhqError(
      "PATH_COLLISION",
      `Existing file does not contain a valid source URL: ${filePath}`
    );
  }
  const frontmatter = parsed.frontmatter;
  const sourceUrl = frontmatter.source as string;
  return {
    content,
    sourceUrl,
    frontmatter,
    markdown: parsed.markdown,
    contentDigest: markdownContentDigest(parsed.markdown),
    ...(typeof frontmatter.created === "string" ? { created: frontmatter.created } : {}),
    ...(typeof frontmatter.modified === "string"
      ? { modified: frontmatter.modified }
      : {}),
    ...(typeof frontmatter.etag === "string" ? { etag: frontmatter.etag } : {}),
    ...(typeof frontmatter.last_modified === "string"
      ? { lastModified: frontmatter.last_modified }
      : {})
  };
}

function assertSameIdentity(
  existing: ExistingDocument | undefined,
  sourceUrl: string,
  entryQueryKey: string | undefined,
  filePath: string
): void {
  let matches = false;
  try {
    matches =
      existing !== undefined &&
      sameUrlIdentity(existing.sourceUrl, sourceUrl, entryQueryKey);
  } catch {
    matches = false;
  }
  if (!matches) {
    throw new MdhqError(
      "PATH_COLLISION",
      `Storage path is already used by another URL: ${filePath}`
    );
  }
}

export async function inspectDestination(
  filePath: string,
  sourceUrl: string,
  entryQueryKey?: string,
  root?: string
): Promise<ExistingDocument | undefined> {
  if (root) {
    await assertSafeDestination(root, filePath);
  }
  const existing = await readExistingDocument(filePath);
  if (existing) {
    assertSameIdentity(existing, sourceUrl, entryQueryKey, filePath);
  }
  return existing;
}

export async function saveDocument(
  options: SaveDocumentOptions
): Promise<"saved" | "updated" | "skipped" | "conflicted"> {
  if (options.root) {
    await assertSafeDestination(options.root, options.path);
  }
  await mkdir(path.dirname(options.path), { recursive: true });
  try {
    return await withDestinationLock(
      options.path,
      async () => {
        const existing = await readExistingDocument(options.path);
        const hasExpectation = options.expectedContent !== undefined;
        if (
          hasExpectation &&
          (existing?.content ?? null) !== options.expectedContent
        ) {
          return "conflicted";
        }
        if (existing) {
          assertSameIdentity(
            existing,
            options.sourceUrl,
            options.entryQueryKey,
            options.path
          );
          if (!options.update) {
            return "skipped";
          }
          if (existing.content === options.content) {
            return "skipped";
          }
        }

        if (existing) {
          await replaceFileAtomic(options.path, options.content, {
            ...(options.root ? { root: options.root } : {}),
            beforeCommit: async () => {
              const current = await readExistingDocument(options.path);
              assertSameIdentity(
                current,
                options.sourceUrl,
                options.entryQueryKey,
                options.path
              );
              if (
                hasExpectation &&
                current?.content !== options.expectedContent
              ) {
                throw new DestinationChangedError();
              }
            }
          });
          return "updated";
        }

        if (
          await publishFileExclusive(
            options.path,
            options.content,
            options.root
          )
        ) {
          return "saved";
        }
        const current = await readExistingDocument(options.path);
        assertSameIdentity(
          current,
          options.sourceUrl,
          options.entryQueryKey,
          options.path
        );
        return hasExpectation ? "conflicted" : "skipped";
      },
      options.root
    );
  } catch (error) {
    if (error instanceof DestinationChangedError) {
      return "conflicted";
    }
    if (error instanceof MdhqError) {
      throw error;
    }
    throw new MdhqError(
      "STORAGE_ERROR",
      `Failed to ${options.update ? "update" : "write"} ${options.path}`,
      { cause: error }
    );
  }
}

class DestinationChangedError extends Error {}
