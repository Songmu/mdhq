import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { DefuddleOptions } from "defuddle/node";
import { MdhqError } from "../errors.js";
import type { MdhqWarning } from "../types.js";
import type { HostConfig } from "./match.js";

const pathConfigSchema = z
  .object({
    entryQueryKey: z.string().nullable().optional()
  })
  .passthrough();

const hostConfigSchema = pathConfigSchema
  .extend({
    paths: z.record(z.string(), pathConfigSchema).optional()
  })
  .passthrough();

const frontmatterSchema = z
  .object({
    exclude: z.array(z.string()).optional(),
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
  })
  .passthrough();

const defuddleSchema = z
  .object({
    debug: z.boolean().optional(),
    removeExactSelectors: z.boolean().optional(),
    removePartialSelectors: z.boolean().optional(),
    removeImages: z.boolean().optional(),
    useAsync: z.boolean().optional(),
    removeHiddenElements: z.boolean().optional(),
    removeLowScoring: z.boolean().optional(),
    removeSmallImages: z.boolean().optional(),
    standardize: z.boolean().optional(),
    removeContentPatterns: z.boolean().optional(),
    contentSelector: z.string().optional(),
    language: z.string().optional(),
    includeReplies: z.union([z.boolean(), z.literal("extractors")]).optional(),
    profile: z.boolean().optional()
  })
  .passthrough();

const configSchema = z
  .object({
    root: z.string().optional(),
    userAgent: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxResponseBytes: z.number().int().positive().optional(),
    maxRedirects: z.number().int().nonnegative().optional(),
    assets: z.boolean().optional(),
    useAsync: z.boolean().optional(),
    defuddle: defuddleSchema.optional(),
    frontmatter: frontmatterSchema.optional(),
    hosts: z.record(z.string(), hostConfigSchema).optional()
  })
  .passthrough();

export interface MdhqConfig {
  root?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  assets?: boolean;
  useAsync?: boolean;
  defuddle?: Omit<DefuddleOptions, "fetch" | "markdown" | "separateMarkdown" | "url">;
  frontmatter?: {
    exclude?: string[];
    values?: Record<string, string | number | boolean | null>;
  };
  hosts?: Record<string, HostConfig>;
}

const KNOWN_TOP_LEVEL = new Set([
  "root",
  "userAgent",
  "timeoutMs",
  "maxResponseBytes",
  "maxRedirects",
  "assets",
  "useAsync",
  "defuddle",
  "frontmatter",
  "hosts"
]);
const KNOWN_FRONTMATTER = new Set(["exclude", "values"]);
const KNOWN_HOST = new Set(["entryQueryKey", "paths"]);
const KNOWN_PATH = new Set(["entryQueryKey"]);
const KNOWN_DEFUDDLE = new Set([
  "debug",
  "removeExactSelectors",
  "removePartialSelectors",
  "removeImages",
  "useAsync",
  "removeHiddenElements",
  "removeLowScoring",
  "removeSmallImages",
  "standardize",
  "removeContentPatterns",
  "contentSelector",
  "language",
  "includeReplies",
  "profile"
]);

function warnUnknown(
  object: Record<string, unknown>,
  known: Set<string>,
  location: string,
  warnings: MdhqWarning[]
): void {
  for (const key of Object.keys(object)) {
    if (!known.has(key)) {
      warnings.push({
        code: "UNKNOWN_CONFIG_KEY",
        message: `Unknown configuration key: ${location}${key}`
      });
    }
  }
}

function collectUnknownWarnings(value: Record<string, unknown>): MdhqWarning[] {
  const warnings: MdhqWarning[] = [];
  warnUnknown(value, KNOWN_TOP_LEVEL, "", warnings);
  const frontmatter = value.frontmatter;
  if (frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)) {
    warnUnknown(frontmatter as Record<string, unknown>, KNOWN_FRONTMATTER, "frontmatter.", warnings);
  }
  const defuddle = value.defuddle;
  if (defuddle && typeof defuddle === "object" && !Array.isArray(defuddle)) {
    warnUnknown(defuddle as Record<string, unknown>, KNOWN_DEFUDDLE, "defuddle.", warnings);
  }
  const hosts = value.hosts;
  if (hosts && typeof hosts === "object" && !Array.isArray(hosts)) {
    for (const [hostPattern, hostValue] of Object.entries(hosts)) {
      if (!hostValue || typeof hostValue !== "object" || Array.isArray(hostValue)) {
        continue;
      }
      const host = hostValue as Record<string, unknown>;
      warnUnknown(host, KNOWN_HOST, `hosts.${hostPattern}.`, warnings);
      const paths = host.paths;
      if (paths && typeof paths === "object" && !Array.isArray(paths)) {
        for (const [pathPattern, pathValue] of Object.entries(paths)) {
          if (pathValue && typeof pathValue === "object" && !Array.isArray(pathValue)) {
            warnUnknown(
              pathValue as Record<string, unknown>,
              KNOWN_PATH,
              `hosts.${hostPattern}.paths.${pathPattern}.`,
              warnings
            );
          }
        }
      }
    }
  }
  return warnings;
}

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "mdhq", "config.json");
}

export function defaultDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "mdhq");
}

export function resolveRoot(
  cliRoot: string | undefined,
  config: MdhqConfig,
  env: NodeJS.ProcessEnv = process.env
): string {
  return path.resolve(cliRoot || env.MDHQ_ROOT || config.root || defaultDataRoot(env));
}

export async function loadConfig(
  configPath = defaultConfigPath()
): Promise<{ config: MdhqConfig; warnings: MdhqWarning[] }> {
  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: {}, warnings: [] };
    }
    throw new MdhqError("CONFIG_ERROR", `Failed to read configuration: ${configPath}`, {
      cause: error
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new MdhqError("CONFIG_ERROR", `Invalid JSON configuration: ${configPath}`, {
      cause: error
    });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MdhqError("CONFIG_ERROR", "Configuration must be a JSON object");
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MdhqError("CONFIG_ERROR", z.prettifyError(parsed.error));
  }
  return {
    config: parsed.data as MdhqConfig,
    warnings: collectUnknownWarnings(raw as Record<string, unknown>)
  };
}
