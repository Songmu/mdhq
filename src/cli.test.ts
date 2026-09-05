import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "./cli.js";

describe("CLI", () => {
  let server: ReturnType<typeof createServer>;
  let url: string;
  let root: string;
  let originalEnv: Pick<NodeJS.ProcessEnv, "MDHQ_ROOT" | "XDG_CONFIG_HOME" | "XDG_DATA_HOME">;

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
    originalEnv = {
      MDHQ_ROOT: process.env.MDHQ_ROOT,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME
    };
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
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

  it("merges URLs from arguments and stdin", async () => {
    let stdout = "";
    const io: CliIo = {
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        }
      },
      stderr: { write: () => true },
      stdin: Object.assign(Readable.from([`${url}\n`]), {
        isTTY: false
      }) as NodeJS.ReadStream
    };
    expect(
      await runCli(["node", "mdhq", "get", "--root", root, url], io)
    ).toBe(0);
    expect(stdout.trim().split("\n")).toHaveLength(2);
  });

  it("returns a JSON array for multiple URLs", async () => {
    let stdout = "";
    const io: CliIo = {
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        }
      },
      stderr: { write: () => true },
      stdin: Object.assign(Readable.from([`${url}\n`]), {
        isTTY: false
      }) as NodeJS.ReadStream
    };
    expect(
      await runCli(["node", "mdhq", "get", "--root", root, "--json", url], io)
    ).toBe(0);
    expect(JSON.parse(stdout)).toHaveLength(2);
  });

  it("rejects an empty URL batch", async () => {
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
    expect(await runCli(["node", "mdhq", "get"], io)).toBe(1);
    expect(stderr).toContain("At least one URL is required");
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

  it("prints the explicit effective storage root", async () => {
    const missingRoot = path.join(root, "missing");
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

    expect(await runCli(["node", "mdhq", "root", "--root", missingRoot], io)).toBe(0);
    expect(stdout).toBe(`${path.resolve(missingRoot)}\n`);
    expect(stderr).toBe("");
    await expect(access(missingRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prints the environment storage root before configuration", async () => {
    const configHome = path.join(root, "config-home");
    const configRoot = path.join(root, "config-root");
    const envRoot = path.join(root, "env-root");
    await mkdir(path.join(configHome, "mdhq"), { recursive: true });
    await writeFile(
      path.join(configHome, "mdhq", "config.json"),
      JSON.stringify({ root: configRoot })
    );
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.MDHQ_ROOT = envRoot;
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

    expect(await runCli(["node", "mdhq", "root"], io)).toBe(0);
    expect(stdout).toBe(`${path.resolve(envRoot)}\n`);
  });

  it("prints the configured storage root and warnings", async () => {
    const configHome = path.join(root, "config-home");
    const configRoot = path.join(root, "config-root");
    await mkdir(path.join(configHome, "mdhq"), { recursive: true });
    await writeFile(
      path.join(configHome, "mdhq", "config.json"),
      JSON.stringify({ root: configRoot, future: true })
    );
    delete process.env.MDHQ_ROOT;
    process.env.XDG_CONFIG_HOME = configHome;
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

    expect(await runCli(["node", "mdhq", "root"], io)).toBe(0);
    expect(stdout).toBe(`${path.resolve(configRoot)}\n`);
    expect(stderr).toBe("warning: Unknown configuration key: future\n");
  });

  it("prints the default XDG data storage root", async () => {
    const configHome = path.join(root, "empty-config-home");
    const dataHome = path.join(root, "data-home");
    delete process.env.MDHQ_ROOT;
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.XDG_DATA_HOME = dataHome;
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

    expect(await runCli(["node", "mdhq", "root"], io)).toBe(0);
    expect(stdout).toBe(`${path.join(dataHome, "mdhq")}\n`);
    expect(stderr).toBe("");
  });
});
