#!/usr/bin/env node
import { Command, Option } from "commander";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, resolveRoot } from "./config/config.js";
import { MdhqError } from "./errors.js";
import { getPage } from "./get-page.js";
import { listMarkdownFiles } from "./list-files.js";
import type { HeaderValue } from "./types.js";
import { VERSION } from "./version.js";
import { RequestScheduler } from "./http/scheduler.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseHeaders(values: string[]): HeaderValue[] {
  return values.map((value) => {
    const separator = value.indexOf(":");
    const name = value.slice(0, Math.max(separator, 0)).trim();
    if (
      separator <= 0 ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name)
    ) {
      throw new MdhqError("INVALID_HEADER", `Invalid header: ${value}`);
    }
    return {
      name,
      value: value.slice(separator + 1).trim()
    };
  });
}

export interface CliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdin?: NodeJS.ReadStream;
}

async function readStdinUrls(stdin: NodeJS.ReadStream | undefined): Promise<string[]> {
  if (!stdin || stdin.isTTY) {
    return [];
  }
  let content = "";
  for await (const chunk of stdin) {
    content += String(chunk);
  }
  return content.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

export function createProgram(io: CliIo = process): Command {
  const program = new Command()
    .name("mdhq")
    .version(VERSION)
    .description("Save web pages as Markdown.");
  program.configureOutput({
    writeOut: (value) => {
      io.stdout.write(value);
    },
    writeErr: (value) => {
      io.stderr.write(value);
    }
  });

  program
    .command("get")
    .description("Fetch and save web pages.")
    .argument("[urls...]")
    .option("--root <path>", "storage root")
    .option("--no-assets", "do not download images")
    .option("--update", "update an existing page")
    .option("--user-agent <value>", "HTTP User-Agent")
    .option("--header <header>", "additional HTTP header", collect, [])
    .addOption(new Option("--json", "print a structured result"))
    .action(
      async (
        urls: string[],
        options: {
          root?: string;
          assets?: boolean;
          update?: boolean;
          userAgent?: string;
          header: string[];
          json?: boolean;
        }
      ) => {
        const inputUrls = await readStdinUrls(io.stdin);
        const requestedUrls = [...urls, ...inputUrls];
        if (requestedUrls.length === 0) {
          throw new MdhqError("INVALID_URL", "At least one URL is required");
        }
        const scheduler = new RequestScheduler();
        const results = await Promise.all(
          requestedUrls.map((url) =>
            getPage({
              url,
              ...(options.root ? { root: options.root } : {}),
              ...(options.assets === false ? { assets: false } : {}),
              update: options.update ?? false,
              ...(options.userAgent ? { userAgent: options.userAgent } : {}),
              headers: parseHeaders(options.header),
              scheduler,
              onWarning: (warning) => io.stderr.write(`warning: ${warning.message}\n`)
            })
          )
        );
        io.stdout.write(
          options.json
            ? `${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n`
            : `${results.map((result) => result.path).join("\n")}\n`
        );
      }
    );

  program
    .command("list")
    .description("List saved Markdown files.")
    .option("--root <path>", "storage root")
    .option("-p, --full-path", "print full paths")
    .action(async (options: { root?: string; fullPath?: boolean }) => {
      const files = await listMarkdownFiles({
        ...(options.root ? { root: options.root } : {}),
        fullPath: options.fullPath ?? false,
        onWarning: (warning) => io.stderr.write(`warning: ${warning.message}\n`)
      });
      if (files.length > 0) {
        io.stdout.write(`${files.join("\n")}\n`);
      }
    });

  program
    .command("root")
    .description("Print the effective storage root.")
    .option("--root <path>", "storage root")
    .action(async (options: { root?: string }) => {
      const loaded = await loadConfig();
      for (const warning of loaded.warnings) {
        io.stderr.write(`warning: ${warning.message}\n`);
      }
      io.stdout.write(`${resolveRoot(options.root, loaded.config)}\n`);
    });
  return program;
}

export async function runCli(argv = process.argv, io: CliIo = process): Promise<number> {
  try {
    await createProgram(io).parseAsync(argv);
    return 0;
  } catch (error) {
    const message =
      error instanceof MdhqError
        ? `mdhq: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    io.stderr.write(`${message}\n`);
    return 1;
  }
}

let isMain = false;
if (process.argv[1] !== undefined) {
  try {
    isMain =
      realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(path.resolve(process.argv[1]));
  } catch {
    isMain = false;
  }
}
if (isMain) {
  process.exitCode = await runCli(process.argv, { ...process, stdin: process.stdin });
}
