import { access, mkdtemp, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeDestination } from "./path-safety.js";

describe("assertSafeDestination", () => {
  it("rejects a directory symlink below the storage root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "markhq-safe-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "markhq-safe-outside-"));
    await symlink(
      outside,
      path.join(root, "example.com"),
      process.platform === "win32" ? "junction" : "dir"
    );
    await expect(
      assertSafeDestination(root, path.join(root, "example.com", "page.md"))
    ).rejects.toMatchObject({ code: "PATH_COLLISION" });
  });

  it("accepts ordinary directories below the storage root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "markhq-safe-root-"));
    await mkdir(path.join(root, "example.com"));
    await expect(
      assertSafeDestination(root, path.join(root, "example.com", "page.md"))
    ).resolves.toBeUndefined();
  });

  it("does not create a missing storage root during inspection", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "markhq-safe-parent-"));
    const root = path.join(parent, "missing");
    await expect(
      assertSafeDestination(root, path.join(root, "example.com", "page.md"))
    ).resolves.toBeUndefined();
    await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
