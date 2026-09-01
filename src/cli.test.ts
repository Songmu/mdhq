import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "./cli.js";

describe("CLI", () => {
  let server: ReturnType<typeof createServer>;
  let url: string;
  let root: string;

  beforeEach(async () => {
    server = createServer((_request, response) => {
      response
        .writeHead(200, { "content-type": "text/html" })
        .end(
          "<html><head><title>CLI Example</title></head><body><article><p>CLI article content.</p></article></body></html>"
        );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}/article`;
    root = await mkdtemp(path.join(os.tmpdir(), "markhq-cli-"));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("prints only the path by default", async () => {
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        }
      },
      stderr: {
        write: (value) => {
          stderr += String(value);
          return true;
        }
      }
    };
    expect(await runCli(["node", "markhq", "get", "--root", root, url], io)).toBe(0);
    expect(stdout.trim()).toBe(
      path.join(root, `127.0.0.1_${new URL(url).port}`, "article.md")
    );
    expect(stderr).toBe("");
  });

  it("prints a structured JSON result", async () => {
    let stdout = "";
    const io: CliIo = {
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        }
      },
      stderr: { write: () => true }
    };
    expect(
      await runCli(["node", "markhq", "get", "--root", root, "--json", url], io)
    ).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ requestedUrl: url, status: "saved" });
  });

  it("reports malformed headers", async () => {
    let stderr = "";
    const io: CliIo = {
      stdout: { write: () => true },
      stderr: {
        write: (value) => {
          stderr += String(value);
          return true;
        }
      }
    };
    expect(
      await runCli(["node", "markhq", "get", "--header", "invalid", url], io)
    ).toBe(1);
    expect(stderr).toContain("Invalid header");
  });

  it.each([" : value", "Bad Name: value"])(
    "rejects an invalid HTTP header name: %s",
    async (header) => {
      let stderr = "";
      const io: CliIo = {
        stdout: { write: () => true },
        stderr: {
          write: (value) => {
            stderr += String(value);
            return true;
          }
        }
      };
      expect(
        await runCli(["node", "markhq", "get", "--header", header, url], io)
      ).toBe(1);
      expect(stderr).toContain("Invalid header");
    }
  );
});
