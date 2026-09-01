import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "./cli.js";

describe("CLI", () => {
  let server: ReturnType<typeof createServer>;
  let url: string;
  let root: string;

  beforeEach(async () => {
    server = createServer((request, response) => {
      if (request.url === "/image.png") {
        response
          .writeHead(200, { "content-type": "image/png" })
          .end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return;
      }
      response
        .writeHead(200, { "content-type": "text/html" })
        .end(
          "<html><head><title>CLI Example</title></head><body><article><p>CLI article content.</p><img src=\"/image.png\" alt=\"Example\"></article></body></html>"
        );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}/article`;
    root = await mkdtemp(path.join(os.tmpdir(), "mdhq-cli-"));
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
    expect(await runCli(["node", "mdhq", "get", "--root", root, url], io)).toBe(0);
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
      await runCli(["node", "mdhq", "get", "--root", root, "--json", url], io)
    ).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ requestedUrl: url, status: "saved" });
  });

  it("does not create _assets with --no-assets", async () => {
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
      await runCli(["node", "mdhq", "get", "--root", root, "--no-assets", url], io)
    ).toBe(0);
    const document = await readFile(stdout.trim(), "utf8");
    expect(document).toContain(`![Example](${new URL("/image.png", url).href})`);
    await expect(access(path.join(root, "_assets"))).rejects.toMatchObject({
      code: "ENOENT"
    });
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
      await runCli(["node", "mdhq", "get", "--header", "invalid", url], io)
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
        await runCli(["node", "mdhq", "get", "--header", header, url], io)
      ).toBe(1);
      expect(stderr).toContain("Invalid header");
    }
  );

  it("lists Markdown files relative to the storage root", async () => {
    await mkdir(path.join(root, "example.com", "nested"), { recursive: true });
    await writeFile(path.join(root, "example.com", "z.md"), "");
    await writeFile(path.join(root, "example.com", "nested", "a.md"), "");
    await writeFile(path.join(root, "example.com", "ignored.txt"), "");
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

    expect(await runCli(["node", "mdhq", "list", "--root", root], io)).toBe(0);
    expect(stdout).toBe(
      `${[
        path.join("example.com", "nested", "a.md"),
        path.join("example.com", "z.md")
      ].sort().join("\n")}\n`
    );
  });

  it.each(["-p", "--full-path"])("lists full paths with %s", async (option) => {
    await mkdir(path.join(root, "example.com"));
    const markdownPath = path.join(root, "example.com", "page.md");
    await writeFile(markdownPath, "");
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
      await runCli(["node", "mdhq", "list", "--root", root, option], io)
    ).toBe(0);
    expect(stdout).toBe(`${markdownPath}\n`);
  });

  it("prints nothing for an empty storage root", async () => {
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

    expect(await runCli(["node", "mdhq", "list", "--root", root], io)).toBe(0);
    expect(stdout).toBe("");
  });

  it("reports a missing storage root", async () => {
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
      await runCli(["node", "mdhq", "list", "--root", path.join(root, "missing")], io)
    ).toBe(1);
    expect(stderr).toContain("Failed to list storage root");
  });
});
