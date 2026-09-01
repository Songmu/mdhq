#!/usr/bin/env node
import { Command, Option } from "commander";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MarkhqError } from "./errors.js";
import { getPage } from "./get-page.js";
import type { HeaderValue } from "./types.js";
import { VERSION } from "./version.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseHeaders(values: string[]): HeaderValue[] {
  return values.map((value) => {
    const separator = value.indexOf(":");
    if (separator <= 0) {
      throw new MarkhqError("INVALID_URL", `Invalid header: ${value}`);
    }
    return {
      name: value.slice(0, separator).trim(),
      value: value.slice(separator + 1).trim()
    };
  });
}

export interface CliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export function createProgram(io: CliIo = process): Command {
  const program = new Command()
    .name("markhq")
    .version(VERSION)
    .description("Save web pages as Markdown.");

  program
    .command("get")
    .description("Fetch and save one web page.")
    .argument("<url>")
    .option("--root <path>", "storage root")
    .option("--update", "update an existing page")
    .option("--user-agent <value>", "HTTP User-Agent")
    .option("--header <header>", "additional HTTP header", collect, [])
    .addOption(new Option("--json", "print a structured result"))
    .action(
      async (
        url: string,
        options: {
          root?: string;
          update?: boolean;
          userAgent?: string;
          header: string[];
          json?: boolean;
        }
      ) => {
        const result = await getPage({
          url,
          ...(options.root ? { root: options.root } : {}),
          update: options.update ?? false,
          ...(options.userAgent ? { userAgent: options.userAgent } : {}),
          headers: parseHeaders(options.header),
          onWarning: (warning) => io.stderr.write(`warning: ${warning.message}\n`)
        });
        io.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${result.path}\n`);
      }
    );
  return program;
}

export async function runCli(argv = process.argv, io: CliIo = process): Promise<number> {
  try {
    await createProgram(io).parseAsync(argv);
    return 0;
  } catch (error) {
    const message =
      error instanceof MarkhqError
        ? `markhq: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    io.stderr.write(`${message}\n`);
    return 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  process.exitCode = await runCli();
}
