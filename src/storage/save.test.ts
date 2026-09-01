import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { serializeDocument } from "../frontmatter/frontmatter.js";
import { saveDocument } from "./save.js";

describe("saveDocument", () => {
  it("saves, skips the same identity, and rejects a collision", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mdhq-save-"));
    const file = path.join(directory, "example.md");
    const first = serializeDocument({ source: "https://example.com/page" }, "first");
    expect(
      await saveDocument({
        path: file,
        content: first,
        sourceUrl: "https://example.com/page",
        update: false
      })
    ).toBe("saved");
    expect(
      await saveDocument({
        path: file,
        content: "unused",
        sourceUrl: "http://example.com/page?ignored=1",
        update: false
      })
    ).toBe("skipped");
    await expect(
      saveDocument({
        path: file,
        content: "collision",
        sourceUrl: "https://example.com/other",
        update: false
      })
    ).rejects.toMatchObject({ code: "PATH_COLLISION" });
  });

  it("atomically updates an existing document", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mdhq-save-"));
    const file = path.join(directory, "example.md");
    await saveDocument({
      path: file,
      content: serializeDocument({ source: "https://example.com/page" }, "first"),
      sourceUrl: "https://example.com/page",
      update: false
    });
    expect(
      await saveDocument({
        path: file,
        content: serializeDocument({ source: "https://example.com/page" }, "second"),
        sourceUrl: "https://example.com/page",
        update: true
      })
    ).toBe("updated");
    expect(await readFile(file, "utf8")).toContain("second");
  });

  it("does not replace a document that changed after inspection", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mdhq-save-"));
    const file = path.join(directory, "example.md");
    const first = serializeDocument(
      { source: "https://example.com/page", etag: '"v1"' },
      "first"
    );
    const second = serializeDocument(
      { source: "https://example.com/page", etag: '"v2"' },
      "second"
    );
    await writeFile(file, second);
    expect(
      await saveDocument({
        path: file,
        content: first,
        sourceUrl: "https://example.com/page",
        update: true,
        expectedContent: first
      })
    ).toBe("conflicted");
    expect(await readFile(file, "utf8")).toBe(second);
  });

  it("does not overwrite a concurrently created document during update", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mdhq-save-"));
    const file = path.join(directory, "example.md");
    const attempts = await Promise.allSettled([
      saveDocument({
        path: file,
        content: serializeDocument({ source: "https://example.com/one" }, "one"),
        sourceUrl: "https://example.com/one",
        update: true
      }),
      saveDocument({
        path: file,
        content: serializeDocument({ source: "https://example.com/two" }, "two"),
        sourceUrl: "https://example.com/two",
        update: true
      })
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
  });

  it("reports malformed existing documents as path collisions", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mdhq-save-"));
    const file = path.join(directory, "example.md");
    await writeFile(file, "---\ninvalid: [\n---\nbody");
    await expect(
      saveDocument({
        path: file,
        content: "replacement",
        sourceUrl: "https://example.com/page",
        update: true
      })
    ).rejects.toMatchObject({ code: "PATH_COLLISION" });
  });
});
