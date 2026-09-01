import { readdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig, resolveRoot } from "./config/config.js";
import { MdhqError } from "./errors.js";
import type { MdhqWarning } from "./types.js";

export interface ListMarkdownFilesOptions {
  root?: string;
  configPath?: string;
  fullPath?: boolean;
  onWarning?: (warning: MdhqWarning) => void;
}

async function collectMarkdownFiles(
  root: string,
  relativeDirectory: string,
  files: string[]
): Promise<void> {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdownFiles(root, relativePath, files);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relativePath);
    }
  }
}

export async function listMarkdownFiles(
  options: ListMarkdownFilesOptions = {}
): Promise<string[]> {
  const loaded = await loadConfig(options.configPath);
  for (const warning of loaded.warnings) {
    options.onWarning?.(warning);
  }
  const root = resolveRoot(options.root, loaded.config);
  const files: string[] = [];
  try {
    await collectMarkdownFiles(root, "", files);
  } catch (error) {
    throw new MdhqError("STORAGE_ERROR", `Failed to list storage root: ${root}`, {
      cause: error
    });
  }
  files.sort();
  return options.fullPath ? files.map((file) => path.join(root, file)) : files;
}
