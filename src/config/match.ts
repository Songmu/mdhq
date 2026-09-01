import { domainToASCII } from "node:url";
import { Minimatch } from "minimatch";
import { MarkhqError } from "../errors.js";

export interface PathConfig {
  entryQueryKey?: string | null;
}

export interface HostConfig extends PathConfig {
  paths?: Record<string, PathConfig>;
}

function literalSpecificity(pattern: string): number {
  let count = 0;
  let skippedUntil: string | undefined;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === undefined) {
      continue;
    }
    if (character === "\\") {
      if (skippedUntil === undefined && index + 1 < pattern.length) {
        count += 1;
      }
      index += 1;
      continue;
    }
    if (skippedUntil) {
      if (character === skippedUntil) {
        skippedUntil = undefined;
      }
      continue;
    }
    if (character === "[") {
      skippedUntil = "]";
    } else if (character === "{") {
      skippedUntil = "}";
    } else if ("!?+*@".includes(character) && pattern[index + 1] === "(") {
      skippedUntil = ")";
      index += 1;
    } else if (character !== "*" && character !== "?") {
      count += 1;
    }
  }
  return count;
}

function normalizeHostPattern(pattern: string): string {
  const lower = pattern.toLowerCase();
  const portMatch = lower.match(/:(\d+)$/u);
  const port = portMatch?.[1];
  const hostname = portMatch ? lower.slice(0, -portMatch[0].length) : lower;
  const normalized = hostname
    .split(".")
    .map((label) =>
      /[*?[\]{}()!+@]/u.test(label) ? label : domainToASCII(label)
    )
    .join(".");
  return port ? `${normalized}:${port}` : normalized;
}

function selectPattern<T>(
  value: string,
  patterns: Record<string, T>,
  kind: string
): T | undefined {
  const entries = Object.entries(patterns).map(([pattern, config]) => ({
    pattern,
    normalizedPattern: kind === "host" ? normalizeHostPattern(pattern) : pattern,
    config
  }));
  const exact = entries.filter((entry) => entry.normalizedPattern === value);
  if (exact.length > 1) {
    throw new MarkhqError(
      "CONFIG_ERROR",
      `Ambiguous normalized ${kind} patterns: ${exact.map((entry) => entry.pattern).join(" and ")}`
    );
  }
  if (exact[0]) {
    return exact[0].config;
  }
  const matches = entries
    .filter((entry) =>
      new Minimatch(entry.normalizedPattern, { dot: true }).match(value)
    )
    .map((entry) => ({
      pattern: entry.pattern,
      config: entry.config,
      specificity: literalSpecificity(entry.normalizedPattern)
    }))
    .sort((a, b) => b.specificity - a.specificity);
  if (matches.length < 1) {
    return undefined;
  }
  const best = matches[0];
  const ambiguous = matches.find(
    (match, index) => index > 0 && match.specificity === best?.specificity
  );
  if (ambiguous) {
    throw new MarkhqError(
      "CONFIG_ERROR",
      `Ambiguous ${kind} patterns: ${best?.pattern} and ${ambiguous.pattern}`
    );
  }
  return best?.config;
}

export function resolveHostConfig(
  host: string,
  pathname: string,
  hosts: Record<string, HostConfig>
): PathConfig | undefined {
  const hostConfig = selectPattern(host, hosts, "host");
  if (!hostConfig) {
    return undefined;
  }
  const pathConfig = hostConfig.paths
    ? selectPattern(pathname, hostConfig.paths, "path")
    : undefined;
  if (pathConfig) {
    return pathConfig.entryQueryKey === undefined
      ? hostConfig.entryQueryKey === undefined
        ? {}
        : { entryQueryKey: hostConfig.entryQueryKey }
      : pathConfig;
  }
  return hostConfig.entryQueryKey === undefined
    ? {}
    : { entryQueryKey: hostConfig.entryQueryKey };
}
