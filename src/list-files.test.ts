import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listMarkdownFiles } from "./list-files.js";

describe("listMarkdownFiles", () => {
  const directories: string[] = [];

  async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mdhq-list-"));
    directories.push(directory);
    return directory;
  }

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("recursively lists only .md regular files in sorted relative order", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "example.com", "nested"), { recursive: true });
    await writeFile(path.join(root, "z.md"), "");
    await writeFile(path.join(root, "example.com", "b.md"), "");
    await writeFile(path.join(root, "example.com", "nested", "a.md"), "");
    await writeFile(path.join(root, "example.com", "ignored.MD"), "");
    await writeFile(path.join(root, "example.com", "ignored.txt"), "");

    await expect(listMarkdownFiles({ root })).resolves.toEqual(
      [
        path.join("example.com", "b.md"),
        path.join("example.com", "nested", "a.md"),
        "z.md"
      ].sort()
    );
  });

  it("prints absolute paths when requested", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "example.com"));
    await writeFile(path.join(root, "example.com", "page.md"), "");

    await expect(listMarkdownFiles({ root, fullPath: true })).resolves.toEqual([
      path.join(root, "example.com", "page.md")
    ]);
  });

  it("uses the configured root and reports configuration warnings", async () => {
    const directory = await temporaryDirectory();
    const root = path.join(directory, "storage");
    const configPath = path.join(directory, "config.json");
    await mkdir(root);
    await writeFile(path.join(root, "page.md"), "");
    await writeFile(configPath, JSON.stringify({ root, unknown: true }));
    const warnings: string[] = [];

    await expect(
      listMarkdownFiles({
        configPath,
        onWarning: (warning) => warnings.push(warning.message)
      })
    ).resolves.toEqual(["page.md"]);
    expect(warnings).toEqual(["Unknown configuration key: unknown"]);
  });

  it("does not follow directory symbolic links", async () => {
    const directory = await temporaryDirectory();
    const root = path.join(directory, "storage");
    const external = path.join(directory, "external");
    await mkdir(root);
    await mkdir(external);
    await writeFile(path.join(root, "local.md"), "");
    await writeFile(path.join(external, "external.md"), "");
    await symlink(
      external,
      path.join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir"
    );

    await expect(listMarkdownFiles({ root })).resolves.toEqual(["local.md"]);
  });

  it("fails when the storage root does not exist", async () => {
    const directory = await temporaryDirectory();

    await expect(
      listMarkdownFiles({ root: path.join(directory, "missing") })
    ).rejects.toMatchObject({
      code: "STORAGE_ERROR"
    });
  });
});
