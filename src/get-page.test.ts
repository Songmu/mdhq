import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseDocument,
  serializeDocument
} from "./frontmatter/frontmatter.js";
import { getPage } from "./get-page.js";

describe("getPage", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let root: string;
  let crossOriginTarget: string | undefined;
  let changingBody: string;
  let changingTitle: string;
  let includeChangingEtag: boolean;
  let pageUnavailable: boolean;
  let invalidLastModifiedOn304: boolean;
  let removeBeforeNotModified: string | undefined;
  let replaceBeforeNotModified:
    | { path: string; content: string; responseBody: string }
    | undefined;
  let replaceBeforeChangingResponse:
    | { path: string; content: string; nextBody: string }
    | undefined;
  let conditionalHeaders: Array<{
    path: string;
    etag?: string;
    lastModified?: string;
  }>;

  beforeEach(async () => {
    changingBody = "First version";
    changingTitle = "Changing";
    includeChangingEtag = false;
    pageUnavailable = false;
    invalidLastModifiedOn304 = false;
    removeBeforeNotModified = undefined;
    replaceBeforeNotModified = undefined;
    replaceBeforeChangingResponse = undefined;
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
          if (replaceBeforeNotModified) {
            const replacement = replaceBeforeNotModified;
            replaceBeforeNotModified = undefined;
            void writeFile(replacement.path, replacement.content)
              .then(() => {
                changingBody = replacement.responseBody;
                response.writeHead(304, { etag: '"v1"' }).end();
              })
              .catch((error: unknown) =>
                response.destroy(
                  error instanceof Error ? error : new Error(String(error))
                )
              );
            return;
          }
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
            etag: changingBody === "First version" ? '"v1"' : '"v2"'
          })
          .end(
            `<html><head><title>Conditional</title></head><body><article><p>${changingBody}</p><img src="/image.png" alt="Example"></article></body></html>`
          );
        return;
      }
      if (request.url === "/conditional-last-modified") {
        const lastModified = "Mon, 31 Aug 2026 03:00:00 GMT";
        if (request.headers["if-modified-since"] === lastModified) {
          response
            .writeHead(304, {
              "last-modified": invalidLastModifiedOn304
                ? "invalid-date"
                : lastModified
            })
            .end();
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
      if (request.url === "/vary-authorization") {
        const lastModified = "Tue, 01 Sep 2026 00:00:00 GMT";
        if (request.headers["if-modified-since"] === lastModified) {
          response
            .writeHead(304, {
              "last-modified": lastModified,
              vary: "Authorization"
            })
            .end();
          return;
        }
        const authenticated = request.headers.authorization !== undefined;
        response
          .writeHead(200, {
            "content-type": "text/html",
            "last-modified": lastModified,
            vary: "Authorization"
          })
          .end(
            `<html><head><title>Account</title></head><body><article><p>${
              authenticated ? "Private account article." : "Public account article."
            }</p></article></body></html>`
          );
        return;
      }
      if (request.url === "/credentialed-no-vary") {
        const lastModified = "Tue, 01 Sep 2026 01:00:00 GMT";
        if (request.headers["if-modified-since"] === lastModified) {
          response.writeHead(304, { "last-modified": lastModified }).end();
          return;
        }
        const authenticated = request.headers.authorization !== undefined;
        response
          .writeHead(200, {
            "content-type": "text/html",
            "last-modified": lastModified
          })
          .end(
            `<html><head><title>Account</title></head><body><article><p>${
              authenticated ? "Private account article." : "Public account article."
            }</p></article></body></html>`
          );
        return;
      }
      if (request.url === "/gone") {
        if (pageUnavailable) {
          response
            .writeHead(404, { "content-type": "text/html" })
            .end("<html><body>Not found</body></html>");
          return;
        }
        response
          .writeHead(200, {
            "content-type": "text/html",
            etag: '"available-v1"'
          })
          .end(
            "<html><head><title>Available</title></head><body><article><p>Original article remains available locally.</p></article></body></html>"
          );
        return;
      }
      if (request.url === "/redirect-changing") {
        response.writeHead(302, { location: "/changing" }).end();
        return;
      }
      if (request.url === "/redirect-tracking-page") {
        response.writeHead(302, { location: "/tracking-page?utm_source=redirect" }).end();
        return;
      }
      if (request.url === "/changing") {
        const responseBody = changingBody;
        const sendResponse = (): void => {
          response
            .writeHead(200, {
              "content-type": "text/html",
              ...(includeChangingEtag ? { etag: '"temporary"' } : {})
            })
            .end(
              `<html><head><title>${changingTitle}</title></head><body><article><p>${responseBody}</p></article></body></html>`
            );
        };
        if (replaceBeforeChangingResponse) {
          const replacement = replaceBeforeChangingResponse;
          replaceBeforeChangingResponse = undefined;
          void writeFile(replacement.path, replacement.content)
            .then(() => {
              changingBody = replacement.nextBody;
              sendResponse();
            })
            .catch((error: unknown) =>
              response.destroy(
                error instanceof Error ? error : new Error(String(error))
              )
            );
          return;
        }
        sendResponse();
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
      if (request.url?.startsWith("/canonical-source")) {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(
            `<html><head><title>Canonical source</title><link rel="canonical" href="${baseUrl}/canonical-source?view=clean#section"></head><body><article><p>Canonical article content.</p><a href="?download=1">Download</a><img src="?image=1" alt="Query image"></article></body></html>`
          );
        return;
      }
      if (request.url === "/slash-alias") {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(
            `<html><head><title>Slash alias</title><link rel="canonical" href="${baseUrl}/slash-alias/"></head><body><article><p>Slash alias article content.</p><a href="child">Child</a><img src="image.png" alt="Image"></article></body></html>`
          );
        return;
      }
      if (request.url?.startsWith("/tracking-page")) {
        if (request.headers["if-none-match"]) {
          response.writeHead(304).end();
          return;
        }
        response
          .writeHead(200, {
            "content-type": "text/html",
            etag: '"tracking"'
          })
          .end(
            "<html><head><title>Tracking cleanup</title></head><body><article><p>Stable tracking-cleaned article content.</p></article></body></html>"
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
      modified: expect.any(String)
    });
    expect(parsed?.frontmatter).not.toHaveProperty("content_digest");
    expect(parsed?.frontmatter).not.toHaveProperty("vary");
    expect(parsed?.frontmatter).not.toHaveProperty("type");
    expect(parsed?.frontmatter).not.toHaveProperty("image");
    expect(parsed?.frontmatter).not.toHaveProperty("image_source");
    expect(parsed?.frontmatter).not.toHaveProperty("site");
    expect(parsed?.frontmatter).not.toHaveProperty("domain");
    expect(parsed?.frontmatter).not.toHaveProperty("word_count");
    expect(parsed?.frontmatter.created).toBe(parsed?.frontmatter.modified);
    expect(document.endsWith("\n")).toBe(true);

    const skipped = await getPage({
      url: `${baseUrl}/article`,
      root,
      useAsync: false
    });
    expect(skipped.status).toBe("skipped");
  });

  it("uses normalized canonical source for storage, frontmatter, and URL bases", async () => {
    const requestedUrl = `${baseUrl}/canonical-source?utm_source=newsletter#top`;
    const sourceUrl = `${baseUrl}/canonical-source?view=clean`;
    const configPath = path.join(root, "canonical-config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        hosts: {
          "*": {
            entryQueryKey: "view"
          }
        }
      })
    );
    const result = await getPage({
      url: requestedUrl,
      root,
      configPath,
      assets: false,
      useAsync: false
    });

    expect(result.requestedUrl).toBe(
      `${baseUrl}/canonical-source?utm_source=newsletter`
    );
    expect(result.sourceUrl).toBe(sourceUrl);
    expect(path.relative(root, result.path)).toBe(
      [
        `127.0.0.1_${new URL(baseUrl).port}`,
        "canonical-source",
        "clean.md"
      ].join(path.sep)
    );
    const parsed = parseDocument(await readFile(result.path, "utf8"));
    expect(parsed?.frontmatter).toMatchObject({
      source: sourceUrl,
      requested_url: `${baseUrl}/canonical-source?utm_source=newsletter`
    });
    expect(parsed?.markdown).toContain(
      `[Download](${baseUrl}/canonical-source?download=1)`
    );
    expect(parsed?.markdown).toContain(
      `![Query image](${baseUrl}/canonical-source?image=1)`
    );
  });

  it("uses the final response URL as the base for a slash canonical alias", async () => {
    const result = await getPage({
      url: `${baseUrl}/slash-alias`,
      root,
      assets: false,
      useAsync: false
    });
    expect(result.sourceUrl).toBe(`${baseUrl}/slash-alias/`);
    const parsed = parseDocument(await readFile(result.path, "utf8"));
    expect(parsed?.frontmatter.source).toBe(`${baseUrl}/slash-alias/`);
    expect(parsed?.markdown).toContain(`[Child](${baseUrl}/child)`);
    expect(parsed?.markdown).toContain(`![Image](${baseUrl}/image.png)`);
  });

  it("keeps the fast pre-fetch skip after tracking cleanup", async () => {
    const requestedUrl = `${baseUrl}/tracking-page?utm_source=newsletter`;
    const first = await getPage({
      url: requestedUrl,
      root,
      assets: false,
      useAsync: false
    });
    const requestsAfterFirst = conditionalHeaders.filter(
      (request) => request.path === "/tracking-page?utm_source=newsletter"
    ).length;
    const second = await getPage({
      url: requestedUrl,
      root,
      assets: false,
      useAsync: false
    });
    expect(first.sourceUrl).toBe(`${baseUrl}/tracking-page`);
    expect(second.status).toBe("skipped");
    expect(second.path).toBe(first.path);
    expect(
      conditionalHeaders.filter(
        (request) => request.path === "/tracking-page?utm_source=newsletter"
      )
    ).toHaveLength(requestsAfterFirst);
  });

  it("updates via the purified URL when it maps to an existing document", async () => {
    const requestedUrl = `${baseUrl}/tracking-page?utm_source=newsletter`;
    const first = await getPage({
      url: requestedUrl,
      root,
      assets: false,
      useAsync: false
    });
    expect(
      parseDocument(await readFile(first.path, "utf8"))?.frontmatter
    ).not.toHaveProperty("etag");
    const updated = await getPage({
      url: requestedUrl,
      root,
      assets: false,
      update: true,
      useAsync: false
    });
    expect(updated.status).toBe("unchanged");
    expect(conditionalHeaders.at(-1)).toEqual({ path: "/tracking-page" });

    const direct = await getPage({
      url: `${baseUrl}/tracking-page`,
      root,
      assets: false,
      update: true,
      useAsync: false
    });
    expect(direct.status).toBe("unchanged");
    expect(
      conditionalHeaders
        .filter((request) => request.path === "/tracking-page")
        .at(-1)
    ).toEqual({ path: "/tracking-page", etag: '"tracking"' });
  });

  it("updates a redirected existing destination via the purified URL", async () => {
    const first = await getPage({
      url: `${baseUrl}/tracking-page`,
      root,
      assets: false,
      useAsync: false
    });
    const updated = await getPage({
      url: `${baseUrl}/redirect-tracking-page`,
      root,
      assets: false,
      update: true,
      useAsync: false
    });
    expect(updated.path).toBe(first.path);
    expect(updated.status).toBe("unchanged");
    expect(
      conditionalHeaders.filter((request) => request.path === "/tracking-page")
    ).toEqual([
      { path: "/tracking-page" },
      { path: "/tracking-page", etag: '"tracking"' }
    ]);
    expect(conditionalHeaders).toContainEqual({
      path: "/tracking-page?utm_source=redirect"
    });
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
    expect(document).not.toContain("image:");
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
        url: crossOriginTarget,
        root,
        assets: false,
        useAsync: false
      });
      received.length = 0;
      await getPage({
        url: `${baseUrl}/cross-origin`,
        root,
        update: true,
        headers: [{ name: "Authorization", value: "Bearer secret" }],
        useAsync: false
      });
      expect(received).toEqual([
        { url: "/article" },
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

  it("attempts representative image localization without emitting image frontmatter", async () => {
    const result = await getPage({
      url: `${baseUrl}/failed-image`,
      root,
      useAsync: false
    });
    const document = await readFile(result.path, "utf8");
    expect(result.assets[0]?.status).toBe("failed");
    expect(document).not.toContain("image:");
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
    const beforeContent = await readFile(first.path, "utf8");
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
    expect(after?.frontmatter).not.toHaveProperty("content_digest");
    expect(after?.frontmatter.modified).toBe(before?.frontmatter.modified);
    expect(after?.markdown).toBe(before?.markdown);
    expect(await readFile(updated.path, "utf8")).toBe(beforeContent);
    expect(
      conditionalHeaders.filter((request) => request.path === "/image.png").length
    ).toBe(imageRequestsBefore);
  });

  it("drops stale removed default fields from an existing file during a 304 refresh", async () => {
    const first = await getPage({
      url: `${baseUrl}/conditional-etag`,
      root,
      useAsync: false,
      now: () => new Date("2026-08-31T12:00:00+09:00")
    });
    const before = parseDocument(await readFile(first.path, "utf8"));
    if (!before) {
      throw new Error("expected a parseable document");
    }
    const legacyFrontmatter = {
      ...before.frontmatter,
      site: "Example Site",
      domain: "example.com",
      image: `${baseUrl}/image.png`,
      image_source: `${baseUrl}/image.png`,
      word_count: 42
    };
    await writeFile(first.path, serializeDocument(legacyFrontmatter, before.markdown));
    const updated = await getPage({
      url: `${baseUrl}/conditional-etag`,
      root,
      update: true,
      headers: [{ name: "If-None-Match", value: '"caller"' }],
      useAsync: false,
      now: () => new Date("2026-09-01T14:00:00+09:00")
    });
    expect(updated.status).toBe("unchanged");
    const after = parseDocument(await readFile(updated.path, "utf8"));
    expect(after?.frontmatter).not.toHaveProperty("site");
    expect(after?.frontmatter).not.toHaveProperty("domain");
    expect(after?.frontmatter).not.toHaveProperty("image");
    expect(after?.frontmatter).not.toHaveProperty("image_source");
    expect(after?.frontmatter).not.toHaveProperty("word_count");
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
      "First version"
    );
  });

  it("restarts from the latest snapshot when the destination changes before a 304 save", async () => {
    const first = await getPage({
      url: `${baseUrl}/conditional-etag`,
      root,
      assets: false,
      useAsync: false
    });
    const before = parseDocument(await readFile(first.path, "utf8"));
    const concurrentBody = "Second version written by a concurrent update.";
    replaceBeforeNotModified = {
      path: first.path,
      responseBody: concurrentBody,
      content: serializeDocument(
        {
          ...before?.frontmatter,
          etag: '"v2"'
        },
        concurrentBody
      )
    };
    const updated = await getPage({
      url: `${baseUrl}/conditional-etag`,
      root,
      assets: false,
      update: true,
      headers: [{ name: "If-Modified-Since", value: "caller-value" }],
      useAsync: false
    });
    expect(updated.status).toBe("updated");
    expect(
      conditionalHeaders.filter(
        (request) => request.path === "/conditional-etag"
      )
    ).toEqual([
      { path: "/conditional-etag" },
      { path: "/conditional-etag", etag: '"v1"' },
      { path: "/conditional-etag", etag: '"v2"' }
    ]);
    const document = parseDocument(await readFile(updated.path, "utf8"));
    expect(document?.frontmatter.etag).toBe('"v2"');
    expect(document?.markdown).toContain(concurrentBody);
  });

  it("restarts a 200 update when the destination changes during conversion", async () => {
    const configPath = path.join(root, "config.json");
    await writeFile(configPath, JSON.stringify({ futureOption: true }));
    const first = await getPage({
      url: `${baseUrl}/changing`,
      root,
      configPath,
      assets: false,
      useAsync: false
    });
    const before = parseDocument(await readFile(first.path, "utf8"));
    const concurrentBody = "Concurrent second version.";
    replaceBeforeChangingResponse = {
      path: first.path,
      nextBody: concurrentBody,
      content: serializeDocument({ ...before?.frontmatter }, concurrentBody)
    };
    const warningCodes: string[] = [];
    const updated = await getPage({
      url: `${baseUrl}/changing`,
      root,
      configPath,
      assets: false,
      update: true,
      useAsync: false,
      onWarning: (warning) => warningCodes.push(warning.code)
    });
    expect(updated.status).toBe("unchanged");
    expect(warningCodes.filter((code) => code === "UNKNOWN_CONFIG_KEY")).toHaveLength(1);
    expect(
      updated.warnings.filter((warning) => warning.code === "UNKNOWN_CONFIG_KEY")
    ).toHaveLength(1);
    expect(
      conditionalHeaders.filter((request) => request.path === "/changing")
    ).toHaveLength(3);
    expect(
      parseDocument(await readFile(updated.path, "utf8"))?.markdown
    ).toContain(concurrentBody);
  });

  it("rebases a redirected update onto the destination snapshot before conversion", async () => {
    const first = await getPage({
      url: `${baseUrl}/changing`,
      root,
      assets: false,
      useAsync: false
    });
    changingBody = "Redirected second version.";
    const updated = await getPage({
      url: `${baseUrl}/redirect-changing`,
      root,
      assets: false,
      update: true,
      useAsync: false
    });
    expect(updated.path).toBe(first.path);
    expect(updated.status).toBe("updated");
    expect(
      conditionalHeaders.filter((request) => request.path === "/changing")
    ).toHaveLength(3);
    const document = parseDocument(await readFile(updated.path, "utf8"));
    expect(document?.frontmatter.source).toBe(`${baseUrl}/changing`);
    expect(document?.frontmatter.requested_url).toBe(
      `${baseUrl}/redirect-changing`
    );
    expect(document?.markdown).toContain("Redirected second version.");
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

  it("removes Last-Modified when a 304 replacement is invalid", async () => {
    const first = await getPage({
      url: `${baseUrl}/conditional-last-modified`,
      root,
      assets: false,
      useAsync: false
    });
    invalidLastModifiedOn304 = true;

    const updated = await getPage({
      url: `${baseUrl}/conditional-last-modified`,
      root,
      update: true,
      assets: false,
      useAsync: false
    });
    const document = parseDocument(await readFile(first.path, "utf8"));

    expect(updated.status).toBe("unchanged");
    expect(updated.warnings).toContainEqual(
      expect.objectContaining({ code: "INVALID_LAST_MODIFIED" })
    );
    expect(document?.frontmatter).not.toHaveProperty("last_modified");
    expect(document?.frontmatter).not.toHaveProperty("vary");
  });

  it("does not reuse validators for a response that varies by authorization", async () => {
    const first = await getPage({
      url: `${baseUrl}/vary-authorization`,
      root,
      assets: false,
      headers: [{ name: "Authorization", value: "Bearer private" }],
      useAsync: false
    });
    const before = parseDocument(await readFile(first.path, "utf8"));
    expect(before?.frontmatter).not.toHaveProperty("vary");
    expect(before?.frontmatter).not.toHaveProperty("last_modified");
    expect(before?.markdown).toContain("Private account article.");

    const updated = await getPage({
      url: `${baseUrl}/vary-authorization`,
      root,
      assets: false,
      update: true,
      useAsync: false
    });
    const after = parseDocument(await readFile(updated.path, "utf8"));
    expect(updated.status).toBe("updated");
    expect(conditionalHeaders.at(-1)).toEqual({
      path: "/vary-authorization"
    });
    expect(after?.frontmatter).not.toHaveProperty("vary");
    expect(after?.frontmatter).not.toHaveProperty("last_modified");
    expect(after?.markdown).toContain("Public account article.");
  });

  it("does not persist validators for credentialed requests without Vary", async () => {
    const first = await getPage({
      url: `${baseUrl}/credentialed-no-vary`,
      root,
      assets: false,
      headers: [{ name: "Authorization", value: "******" }],
      useAsync: false
    });
    const before = parseDocument(await readFile(first.path, "utf8"));
    expect(before?.frontmatter).not.toHaveProperty("last_modified");
    expect(before?.frontmatter).not.toHaveProperty("vary");
    expect(before?.markdown).toContain("Private account article.");

    const updated = await getPage({
      url: `${baseUrl}/credentialed-no-vary`,
      root,
      update: true,
      assets: false,
      useAsync: false
    });
    const after = parseDocument(await readFile(updated.path, "utf8"));

    expect(updated.status).toBe("updated");
    expect(conditionalHeaders.at(-1)).toEqual({
      path: "/credentialed-no-vary"
    });
    expect(after?.frontmatter.last_modified).toBe("2026-09-01T01:00:00Z");
    expect(after?.frontmatter).not.toHaveProperty("vary");
    expect(after?.markdown).toContain("Public account article.");
  });

  it("removes legacy content_digest and vary while retaining reusable validators", async () => {
    const first = await getPage({
      url: `${baseUrl}/conditional-etag`,
      root,
      assets: false,
      useAsync: false
    });
    const document = parseDocument(await readFile(first.path, "utf8"));
    const legacyFrontmatter = {
      ...document?.frontmatter,
      content_digest: "sha256:legacy",
      vary: []
    };
    await writeFile(
      first.path,
      serializeDocument(legacyFrontmatter, document?.markdown ?? "")
    );
    const updated = await getPage({
      url: `${baseUrl}/conditional-etag`,
      root,
      assets: false,
      update: true,
      useAsync: false
    });
    expect(updated.status).toBe("unchanged");
    expect(conditionalHeaders.at(-1)).toEqual({
      path: "/conditional-etag",
      etag: '"v1"'
    });
    const migrated = parseDocument(await readFile(updated.path, "utf8"));
    expect(migrated?.frontmatter.etag).toBe('"v1"');
    expect(migrated?.frontmatter).not.toHaveProperty("content_digest");
    expect(migrated?.frontmatter).not.toHaveProperty("vary");
  });

  it("preserves the existing document when an update returns 404", async () => {
    const first = await getPage({
      url: `${baseUrl}/gone`,
      root,
      assets: false,
      useAsync: false
    });
    const before = await readFile(first.path, "utf8");
    pageUnavailable = true;
    await expect(
      getPage({
        url: `${baseUrl}/gone`,
        root,
        assets: false,
        update: true,
        useAsync: false
      })
    ).rejects.toMatchObject({ code: "FETCH_FAILED" });
    expect(await readFile(first.path, "utf8")).toBe(before);
  });

  it("distinguishes equal and changed Markdown bodies on 200 responses", async () => {
    includeChangingEtag = true;
    const first = await getPage({
      url: `${baseUrl}/changing`,
      root,
      assets: false,
      useAsync: false,
      now: () => new Date("2026-08-31T12:00:00+09:00")
    });
    const before = parseDocument(await readFile(first.path, "utf8"));
    includeChangingEtag = false;
    const unchanged = await getPage({
      url: `${baseUrl}/changing`,
      root,
      assets: false,
      update: true,
      useAsync: false,
      now: () => new Date("2026-09-01T12:00:00+09:00")
    });
    const same = parseDocument(await readFile(first.path, "utf8"));
    changingBody = "Second version";
    const changed = await getPage({
      url: `${baseUrl}/changing`,
      root,
      assets: false,
      update: true,
      useAsync: false,
      now: () => new Date("2026-09-02T12:00:00+09:00")
    });
    const changedDocument = parseDocument(await readFile(changed.path, "utf8"));
    expect(first.status).toBe("saved");
    expect(unchanged.status).toBe("unchanged");
    expect(changed.status).toBe("updated");
    expect(same?.frontmatter.modified).toBe(before?.frontmatter.modified);
    expect(changedDocument?.frontmatter.modified).not.toBe(
      before?.frontmatter.modified
    );
    expect(
      changedDocument?.frontmatter
    ).not.toHaveProperty("etag");
  });

  it("updates modified and status for user-facing metadata-only changes", async () => {
    const first = await getPage({
      url: `${baseUrl}/changing`,
      root,
      assets: false,
      useAsync: false,
      now: () => new Date("2026-08-31T12:00:00+09:00")
    });
    const before = parseDocument(await readFile(first.path, "utf8"));
    changingTitle = "Changing metadata";
    const updated = await getPage({
      url: `${baseUrl}/changing`,
      root,
      assets: false,
      update: true,
      useAsync: false,
      now: () => new Date("2026-09-01T12:00:00+09:00")
    });
    const after = parseDocument(await readFile(updated.path, "utf8"));
    expect(updated.status).toBe("updated");
    expect(after?.markdown).toBe(before?.markdown);
    expect(after?.frontmatter.title).toBe("Changing metadata");
    expect(after?.frontmatter.modified).not.toBe(before?.frontmatter.modified);
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

  it("stores different query targets separately without reusing validators", async () => {
    const first = await getPage({
      url: `${baseUrl}/identity-query?a=1`,
      root,
      assets: false,
      useAsync: false
    });
    const second = await getPage({
      url: `${baseUrl}/identity-query?b=2`,
      root,
      assets: false,
      update: true,
      useAsync: false
    });
    expect(second.status).toBe("saved");
    expect(second.path).not.toBe(first.path);
    expect(conditionalHeaders).toContainEqual({ path: "/identity-query?b=2" });
    expect(
      conditionalHeaders.find((request) => request.path === "/identity-query?b=2")
    ).not.toHaveProperty("etag");
    const firstDocument = parseDocument(await readFile(first.path, "utf8"));
    const secondDocument = parseDocument(await readFile(second.path, "utf8"));
    expect(firstDocument?.markdown).toContain(
      "First query target has original article content."
    );
    expect(secondDocument?.markdown).toContain(
      "Second query target has replacement article content."
    );
    expect(secondDocument?.frontmatter.source).toBe(
      `${baseUrl}/identity-query?b=2`
    );
  });
});
