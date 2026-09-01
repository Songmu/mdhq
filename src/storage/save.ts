import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { MarkhqError } from "../errors.js";
import { parseDocumentFrontmatter } from "../frontmatter/frontmatter.js";
import { sameUrlIdentity } from "../url/identity.js";
import { publishFileExclusive, replaceFileAtomic } from "./atomic.js";
import { assertSafeDestination } from "./path-safety.js";

export interface SaveDocumentOptions {
  path: string;
  content: string;
  sourceUrl: string;
  update: boolean;
  entryQueryKey?: string;
  root?: string;
}

export interface ExistingDocument {
  sourceUrl: string;
  created?: string;
}

export async function readExistingDocument(filePath: string): Promise<ExistingDocument | undefined> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw new MarkhqError("STORAGE_ERROR", `Failed to read ${filePath}`, { cause: error });
  }
  const frontmatter = parseDocumentFrontmatter(content);
  if (typeof frontmatter?.source !== "string") {
    throw new MarkhqError(
      "PATH_COLLISION",
      `Existing file does not contain a valid source URL: ${filePath}`
    );
  }
  return {
    sourceUrl: frontmatter.source,
    ...(typeof frontmatter.created === "string" ? { created: frontmatter.created } : {})
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
    throw new MarkhqError(
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
): Promise<"saved" | "updated" | "skipped"> {
  if (options.root) {
    await assertSafeDestination(options.root, options.path);
  }
  await mkdir(path.dirname(options.path), { recursive: true });
  const existing = await readExistingDocument(options.path);
  if (existing) {
    assertSameIdentity(existing, options.sourceUrl, options.entryQueryKey, options.path);
    if (!options.update) {
      return "skipped";
    }
  }

  if (!options.update) {
    try {
      if (await publishFileExclusive(options.path, options.content, options.root)) {
        return "saved";
      }
      assertSameIdentity(
        await readExistingDocument(options.path),
        options.sourceUrl,
        options.entryQueryKey,
        options.path
      );
      return "skipped";
    } catch (error) {
      if (error instanceof MarkhqError) {
        throw error;
      }
      throw new MarkhqError("STORAGE_ERROR", `Failed to write ${options.path}`, {
        cause: error
      });
    }
  }

  if (!existing) {
    try {
      if (await publishFileExclusive(options.path, options.content, options.root)) {
        return "saved";
      }
      assertSameIdentity(
        await readExistingDocument(options.path),
        options.sourceUrl,
        options.entryQueryKey,
        options.path
      );
      return "skipped";
    } catch (error) {
      if (error instanceof MarkhqError) {
        throw error;
      }
      throw new MarkhqError("STORAGE_ERROR", `Failed to write ${options.path}`, {
        cause: error
      });
    }
  }

  try {
    await replaceFileAtomic(options.path, options.content, {
      ...(options.root ? { root: options.root } : {}),
      beforeCommit: async () => {
        assertSameIdentity(
          await readExistingDocument(options.path),
          options.sourceUrl,
          options.entryQueryKey,
          options.path
        );
      }
    });
    return "updated";
  } catch (error) {
    if (error instanceof MarkhqError) {
      throw error;
    }
    throw new MarkhqError("STORAGE_ERROR", `Failed to update ${options.path}`, { cause: error });
  }
}
