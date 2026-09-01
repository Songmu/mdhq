import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDocument } from "./frontmatter/frontmatter.js";
import { getPage } from "./get-page.js";

describe("getPage", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let root: string;
  let crossOriginTarget: string | undefined;
  let changingBody: string;
  let includeChangingEtag: boolean;
  let removeBeforeNotModified: string | undefined;
  let conditionalHeaders: Array<{
    path: string;
    etag?: string;
    lastModified?: string;
  }>;

  beforeEach(async () => {
    changingBody = "First version";
    includeChangingEtag = false;
    removeBeforeNotModified = undefined;
    conditionalHeaders = [];
    server = createServer((request, response) => {
      conditionalHeaders.push({
        path: request.url ?? "",
        ...(request.headers["if-none-match"]
          ? { etag: request.headers["if-none-match"] }
          : {}),
        ...(request.headers["if-modified-since"]
          ? { lastModified: request.headers["if-modified-since"] }
          : {})
      });
      if (request.url === "/conditional-etag") {
        if (request.headers["if-none-match"] === '"v1"') {
          if (removeBeforeNotModified) {
            const file = removeBeforeNotModified;
            removeBeforeNotModified = undefined;
            void rm(file)
              .then(() => response.writeHead(304, { etag: '"v1"' }).end())
              .catch((error: unknown) =>
                response.destroy(
                  error instanceof Error ? error : new Error(String(error))
                )
              );
            return;
          }
          response.writeHead(304, { etag: '"v1"' }).end();
          return;
        }
        response
          .writeHead(200, {
            "content-type": "text/html",
            etag: '"v1"'
          })
          .end(
            "<html><head><title>Conditional</title></head><body><article><p>Stable content for ETag.</p><img src=\"/image.png\" alt=\"Example\"></article></body></html>"
          );
        return;
      }
      if (request.url === "/conditional-last-modified") {
        const lastModified = "Mon, 31 Aug 2026 03:00:00 GMT";
        if (request.headers["if-modified-since"] === lastModified) {
          response.writeHead(304, { "last-modified": lastModified }).end();
          return;
        }
        response
          .writeHead(200, {
            "content-type": "text/html",
            "last-modified": lastModified
          })
          .end(
            "<html><head><title>Conditional</title></head><body><article><p>Stable content for Last-Modified.</p></article></body></html>"
          );
        return;
      }
      if (request.url === "/changing") {
        response
          .writeHead(200, {
            "content-type": "text/html",
            ...(includeChangingEtag ? { etag: '"temporary"' } : {})
          })
          .end(
            `<html><head><title>Changing</title></head><body><article><p>${changingBody}</p></article></body></html>`
          );
        return;
      }
      if (request.url === "/caller-conditional") {
        if (request.headers["if-none-match"] === '"caller"') {
          response.writeHead(304).end();
          return;
        }
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(
            "<html><head><title>Caller conditional</title></head><body><article><p>Stored version.</p></article></body></html>"
          );
        return;
      }
      if (request.url?.startsWith("/identity-query")) {
        if (request.headers["if-none-match"]) {
          response.writeHead(304).end();
          return;
        }
        response
          .writeHead(200, {
            "content-type": "text/html",
            etag: '"query"'
          })
          .end(
            `<html><head><title>Query target</title></head><body><article><p>${
              request.url.includes("b=2")
                ? "Second query target has replacement article content."
                : "First query target has original article content."
            }</p></article></body></html>`
          );
        return;
      }
      if (request.url === "/invalid-last-modified") {
        response
          .writeHead(200, {
            "content-type": "text/html",
            "last-modified": "not-a-date"
          })
          .end(
            "<html><head><title>Invalid validator</title></head><body><article><p>Valid article content.</p></article></body></html>"
          );
        return;
      }
      if (request.url === "/cross-origin" && crossOriginTarget) {
        response.writeHead(302, { location: crossOriginTarget }).end();
        return;
      }
      if (request.url === "/image.png") {
        response.writeHead(200, { "content-type": "image/png" }).end(
          Buffer.from([0x89, 0x50, 0x4e, 0x47])
        );
        return;
      }
      if (request.url === "/invalid-image") {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(
            "<html><head><title>Invalid Image</title><meta property=\"og:image\" content=\"http://[\"></head><body><article><p>Valid page content.</p></article></body></html>"
          );
        return;
      }
      if (request.url === "/data-image") {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(
            "<html><head><title>Data Image</title><meta property=\"og:image\" content=\"data:image/png;base64,AAAA\"></head><body><article><p>Valid page content.</p></article></body></html>"
          );
        return;
      }
      if (request.url === "/failed-image") {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(
            "<html><head><title>Failed Image</title><meta property=\"og:image\" content=\"/missing.png\"></head><body><article><p>Valid page content.</p></article></body></html>"
          );
        return;
      }
      response
        .writeHead(200, { "content-type": "text/html" })
        .end(`<!doctype html>
          <html>
            <head>
              <title>Integration Example</title>
              <meta property="og:image" content="/image.png">
            </head>
            <body>
              <article>
                <h1>Integration Example</h1>
                <p>This is enough article text for extraction and storage.</p>
                <a href="/next">Next</a>
                <img src="/image.png" alt="Example">
              </article>
            </body>
          </html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    root = await mkdtemp(path.join(os.tmpdir(), "mdhq-get-"));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("fetches, converts, localizes assets, and saves a page", async () => {
    const result = await getPage({
      url: `${baseUrl}/article`,
      root,
      useAsync: false,
      now: () => new Date("2026-08-31T12:00:00+09:00")
    });
    expect(result.status).toBe("saved");
    expect(result.assets.some((asset) => asset.status === "saved")).toBe(true);
    const document = await readFile(result.path, "utf8");
    expect(document).toContain("title: Integration Example");
    expect(document).toContain(`${baseUrl}/next`);
    expect(document).toContain("_assets/");
    const parsed = parseDocument(document);
    expect(parsed?.frontmatter).toMatchObject({
      created: expect.any(String),
      modified: expect.any(String),
      content_digest: expect.stringMatching(/^sha256:/u)
    });
    expect(parsed?.frontmatter).not.toHaveProperty("type");
    expect(parsed?.frontmatter.created).toBe(parsed?.frontmatter.modified);
    expect(document.endsWith("\n")).toBe(true);

    const skipped = await getPage({
      url: `${baseUrl}/article`,
      root,
      useAsync: false
    });
    expect(skipped.status).toBe("skipped");
  });

  it.each([
    ["library option", { assets: false }],
    ["configuration", { config: { assets: false } }]
  ])("saves absolute image URLs without creating _assets via %s", async (_label, mode) => {
    const configPath = path.join(root, "config.json");
    if ("config" in mode) {
      await writeFile(configPath, JSON.stringify(mode.config));
    }
    const result = await getPage({
      url: `${baseUrl}/article`,
      root,
      useAsync: false,
      ...("assets" in mode ? { assets: mode.assets } : { configPath })
    });
    const document = await readFile(result.path, "utf8");
    expect(result.assets).toEqual([]);
    expect(document).toContain(`image: ${baseUrl}/image.png`);
    expect(document).toContain(`![Example](${baseUrl}/image.png)`);
    await expect(access(path.join(root, "_assets"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not restore caller headers for assets after a cross-origin redirect", async () => {
    const received: Array<{ url: string; authorization?: string }> = [];
    const target = createServer((request, response) => {
      received.push({
        url: request.url ?? "",
        ...(request.headers.authorization
          ? { authorization: request.headers.authorization }
          : {})
      });
      if (request.url === "/image.png") {
        response
          .writeHead(200, { "content-type": "image/png" })
          .end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return;
      }
      response
        .writeHead(200, { "content-type": "text/html" })
        .end(
          "<html><head><title>Redirected</title></head><body><article><p>Redirected article content.</p><img src=\"/image.png\" alt=\"Image\"></article></body></html>"
        );
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const address = target.address() as AddressInfo;
    crossOriginTarget = `http://127.0.0.1:${address.port}/article`;
    try {
      await getPage({
        url: `${baseUrl}/cross-origin`,
        root,
        headers: [{ name: "Authorization", value: "Bearer secret" }],
        useAsync: false
      });
      expect(received).toEqual([
        { url: "/article" },
        { url: "/image.png" }
      ]);
    } finally {
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  it("warns and continues for an invalid representative image URL", async () => {
    const result = await getPage({
      url: `${baseUrl}/invalid-image`,
      root,
      useAsync: false
    });
    expect(result.status).toBe("saved");
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "INVALID_IMAGE_URL" })
    );
  });

  it("omits a non-HTTP representative image URL", async () => {
    const result = await getPage({
      url: `${baseUrl}/data-image`,
      root,
      useAsync: false
    });
    const document = await readFile(result.path, "utf8");
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "INVALID_IMAGE_URL" })
    );
    expect(document).not.toContain("data:image/png");
  });

  it("keeps an absolute representative image when localization fails", async () => {
    const result = await getPage({
      url: `${baseUrl}/failed-image`,
      root,
      useAsync: false
    });
    const document = await readFile(result.path, "utf8");
    expect(result.assets[0]?.status).toBe("failed");
    expect(document).toContain(`image: ${baseUrl}/missing.png`);
    expect(document).not.toContain("image_source:");
  });

  it("uses ETag for an unchanged update", async () => {
    const first = await getPage({
      url: `${baseUrl}/conditional-etag`,
      root,
      useAsync: false,
      now: () => new Date("2026-08-31T12:00:00+09:00")
    });
    const before = parseDocument(await readFile(first.path, "utf8"));
    const imageRequestsBefore = conditionalHeaders.filter(
      (request) => request.path === "/image.png"
    ).length;
    const updated = await getPage({
      url: `${baseUrl}/conditional-etag`,
      root,
      update: true,
      headers: [{ name: "If-None-Match", value: '"caller"' }],
      useAsync: false,
      now: () => new Date("2026-09-01T14:00:00+09:00")
    });
    const after = parseDocument(await readFile(updated.path, "utf8"));
    expect(updated.status).toBe("unchanged");
    expect(conditionalHeaders.at(-1)).toMatchObject({ etag: '"v1"' });
    expect(after?.frontmatter.etag).toBe('"v1"');
    expect(after?.frontmatter.content_digest).toBe(before?.frontmatter.content_digest);
    expect(after?.frontmatter.modified).not.toBe(before?.frontmatter.modified);
    expect(after?.markdown).toBe(before?.markdown);
    expect(
      conditionalHeaders.filter((request) => request.path === "/image.png").length
    ).toBe(imageRequestsBefore);
  });

  it("preserves a saved race outcome after a 304 response", async () => {
    const first = await getPage({
      url: `${baseUrl}/conditional-etag`,
      root,
      assets: false,
      useAsync: false
    });
    removeBeforeNotModified = first.path;
    const updated = await getPage({
      url: `${baseUrl}/conditional-etag`,
      root,
      assets: false,
      update: true,
      useAsync: false
    });
    expect(updated.status).toBe("saved");
    expect(parseDocument(await readFile(updated.path, "utf8"))?.markdown).toContain(
      "Stable content for ETag."
    );
  });

  it("replaces an invalid stored created timestamp during a 304 update", async () => {
    const first = await getPage({
      url: `${baseUrl}/conditional-etag`,
      root,
      assets: false,
      useAsync: false
    });
    const document = await readFile(first.path, "utf8");
    await writeFile(
      first.path,
      document.replace(
        /^created: .+$/mu,
        "created: 2026-02-30T00:00:00Z"
      )
    );
    const updated = await getPage({
      url: `${baseUrl}/conditional-etag`,
      root,
      assets: false,
      update: true,
      useAsync: false,
      now: () => new Date("2026-09-01T16:00:00+09:00")
    });
    expect(updated.status).toBe("unchanged");
    expect(
      parseDocument(await readFile(updated.path, "utf8"))?.frontmatter.created
    ).toMatch(/^2026-09-01T/u);
  });

  it("falls back to Last-Modified when ETag is absent", async () => {
    const first = await getPage({
      url: `${baseUrl}/conditional-last-modified`,
      root,
      assets: false,
      useAsync: false
    });
    const updated = await getPage({
      url: `${baseUrl}/conditional-last-modified`,
      root,
      assets: false,
      update: true,
      useAsync: false
    });
    const document = parseDocument(await readFile(first.path, "utf8"));
    expect(updated.status).toBe("unchanged");
    expect(conditionalHeaders.at(-1)).toMatchObject({
      lastModified: "Mon, 31 Aug 2026 03:00:00 GMT"
    });
    expect(document?.frontmatter.last_modified).toBe("2026-08-31T03:00:00Z");
  });

  it("distinguishes equal and changed Markdown bodies on 200 responses", async () => {
    includeChangingEtag = true;
    const first = await getPage({
      url: `${baseUrl}/changing`,
      root,
      assets: false,
      useAsync: false
    });
    includeChangingEtag = false;
    const unchanged = await getPage({
      url: `${baseUrl}/changing`,
      root,
      assets: false,
      update: true,
      useAsync: false
    });
    changingBody = "Second version";
    const changed = await getPage({
      url: `${baseUrl}/changing`,
      root,
      assets: false,
      update: true,
      useAsync: false
    });
    expect(first.status).toBe("saved");
    expect(unchanged.status).toBe("unchanged");
    expect(changed.status).toBe("updated");
    expect(
      parseDocument(await readFile(changed.path, "utf8"))?.frontmatter
    ).not.toHaveProperty("etag");
  });

  it("warns and omits an invalid Last-Modified value", async () => {
    const result = await getPage({
      url: `${baseUrl}/invalid-last-modified`,
      root,
      assets: false,
      useAsync: false
    });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "INVALID_LAST_MODIFIED" })
    );
    expect(
      parseDocument(await readFile(result.path, "utf8"))?.frontmatter
    ).not.toHaveProperty("last_modified");
  });

  it("rejects a 304 produced by a caller validator not tied to the document", async () => {
    const first = await getPage({
      url: `${baseUrl}/caller-conditional`,
      root,
      assets: false,
      useAsync: false
    });
    const before = await readFile(first.path, "utf8");
    await expect(
      getPage({
        url: `${baseUrl}/caller-conditional`,
        root,
        assets: false,
        update: true,
        headers: [{ name: "If-None-Match", value: '"caller"' }],
        useAsync: false
      })
    ).rejects.toMatchObject({ code: "FETCH_FAILED" });
    expect(await readFile(first.path, "utf8")).toBe(before);
  });

  it("does not reuse validators for a different query target with the same storage identity", async () => {
    const first = await getPage({
      url: `${baseUrl}/identity-query?a=1`,
      root,
      assets: false,
      useAsync: false
    });
    const updated = await getPage({
      url: `${baseUrl}/identity-query?b=2`,
      root,
      assets: false,
      update: true,
      useAsync: false
    });
    expect(updated.status).toBe("updated");
    expect(conditionalHeaders).toContainEqual({ path: "/identity-query?b=2" });
    const document = parseDocument(await readFile(first.path, "utf8"));
    expect(document?.markdown).toContain(
      "Second query target has replacement article content."
    );
    expect(document?.frontmatter.source).toBe(
      `${baseUrl}/identity-query?b=2`
    );
  });
});
