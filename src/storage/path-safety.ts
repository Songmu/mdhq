import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { MdhqError } from "../errors.js";

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function assertSafeDestination(
  root: string,
  target: string
): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (!isWithin(resolvedRoot, resolvedTarget)) {
    throw new MdhqError(
      "PATH_COLLISION",
      `Storage path escapes its root: ${resolvedTarget}`
    );
  }

  let rootMetadata;
  try {
    rootMetadata = await lstat(resolvedRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (!rootMetadata.isDirectory() && !rootMetadata.isSymbolicLink()) {
    throw new MdhqError(
      "PATH_COLLISION",
      `Storage root is not a directory: ${resolvedRoot}`
    );
  }
  const realRoot = await realpath(resolvedRoot);
  const relative = path.relative(resolvedRoot, path.dirname(resolvedTarget));
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      throw new MdhqError(
        "PATH_COLLISION",
        `Storage directory is a symbolic link: ${current}`
      );
    }
    if (!metadata.isDirectory()) {
      throw new MdhqError(
        "PATH_COLLISION",
        `Storage path component is not a directory: ${current}`
      );
    }
    const realCurrent = await realpath(current);
    if (!isWithin(realRoot, realCurrent) && realCurrent !== realRoot) {
      throw new MdhqError(
        "PATH_COLLISION",
        `Storage directory escapes its root: ${current}`
      );
    }
  }
}
