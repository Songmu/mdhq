import { randomUUID } from "node:crypto";
import path from "node:path";
import { link, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { assertSafeDestination } from "./path-safety.js";

type FileContent = string | Uint8Array;

function temporaryPath(targetPath: string): string {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomUUID()}.tmp`
  );
}

export async function publishFileExclusive(
  targetPath: string,
  content: FileContent,
  root?: string
): Promise<boolean> {
  if (root) {
    await assertSafeDestination(root, targetPath);
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  if (root) {
    await assertSafeDestination(root, targetPath);
  }
  const tempPath = temporaryPath(targetPath);
  try {
    await writeFile(tempPath, content, { flag: "wx" });
    try {
      await link(tempPath, targetPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      throw error;
    }
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

export async function replaceFileAtomic(
  targetPath: string,
  content: FileContent,
  options: {
    root?: string;
    beforeCommit?: () => Promise<void>;
  } = {}
): Promise<void> {
  if (options.root) {
    await assertSafeDestination(options.root, targetPath);
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  if (options.root) {
    await assertSafeDestination(options.root, targetPath);
  }
  const tempPath = temporaryPath(targetPath);
  try {
    await writeFile(tempPath, content, { flag: "wx" });
    await options.beforeCommit?.();
    if (options.root) {
      await assertSafeDestination(options.root, targetPath);
    }
    await rename(tempPath, targetPath);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}
