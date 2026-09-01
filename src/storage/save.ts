import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { MarkhqError } from "../errors.js";
import { parseDocumentFrontmatter } from "../frontmatter/frontmatter.js";
import { sameUrlIdentity } from "../url/identity.js";

export interface SaveDocumentOptions {
  path: string;
  content: string;
  sourceUrl: string;
  update: boolean;
  entryQueryKey?: string;
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
  return typeof frontmatter?.source === "string"
    ? {
        sourceUrl: frontmatter.source,
        ...(typeof frontmatter.created === "string" ? { created: frontmatter.created } : {})
      }
    : undefined;
}

function assertSameIdentity(
  existing: ExistingDocument | undefined,
  sourceUrl: string,
  entryQueryKey?: string
): void {
  if (!existing || !sameUrlIdentity(existing.sourceUrl, sourceUrl, entryQueryKey)) {
    throw new MarkhqError("PATH_COLLISION", `Storage path is already used by another URL`);
  }
}

export async function saveDocument(
  options: SaveDocumentOptions
): Promise<"saved" | "updated" | "skipped"> {
  await mkdir(path.dirname(options.path), { recursive: true });
  const existing = await readExistingDocument(options.path);
  if (existing) {
    assertSameIdentity(existing, options.sourceUrl, options.entryQueryKey);
    if (!options.update) {
      return "skipped";
    }
  }

  if (!options.update) {
    try {
      await writeFile(options.path, options.content, { flag: "wx" });
      return "saved";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new MarkhqError("STORAGE_ERROR", `Failed to write ${options.path}`, { cause: error });
      }
      assertSameIdentity(
        await readExistingDocument(options.path),
        options.sourceUrl,
        options.entryQueryKey
      );
      return "skipped";
    }
  }

  if (!existing) {
    try {
      await writeFile(options.path, options.content, { flag: "wx" });
      return "saved";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new MarkhqError("STORAGE_ERROR", `Failed to write ${options.path}`, {
          cause: error
        });
      }
      assertSameIdentity(
        await readExistingDocument(options.path),
        options.sourceUrl,
        options.entryQueryKey
      );
      return "skipped";
    }
  }

  const temporaryPath = path.join(
    path.dirname(options.path),
    `.${path.basename(options.path)}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporaryPath, options.content, { flag: "wx" });
    assertSameIdentity(
      await readExistingDocument(options.path),
      options.sourceUrl,
      options.entryQueryKey
    );
    await rename(temporaryPath, options.path);
    return "updated";
  } catch (error) {
    throw new MarkhqError("STORAGE_ERROR", `Failed to update ${options.path}`, { cause: error });
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}
