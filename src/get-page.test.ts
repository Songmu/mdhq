import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPage } from "./get-page.js";

describe("getPage", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let root: string;
  let crossOriginTarget: string | undefined;

  beforeEach(async () => {
    server = createServer((request, response) => {
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
});
