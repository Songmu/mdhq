import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localizeAssets } from "./localize.js";

describe("localizeAssets", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let receivedAuthorization: string | undefined;
  let imageBody: Buffer;

  beforeEach(async () => {
    imageBody = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    server = createServer((request, response) => {
      receivedAuthorization = request.headers.authorization;
      if (request.url === "/bad.png") {
        response.writeHead(200, { "content-type": "text/html" }).end("<html>login</html>");
        return;
      }
      if (request.url === "/not-modified.png") {
        response.writeHead(304).end();
        return;
      }
      response
        .writeHead(200, { "content-type": "image/png" })
        .end(imageBody);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("does not send page headers to cross-origin assets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    const sourceUrl = `${baseUrl}/image.png`;
    const result = await localizeAssets({
      markdown: `![image](${sourceUrl})`,
      imageUrls: [sourceUrl],
      markdownPath: path.join(root, "example.com", "page.md"),
      root,
      baseUrl: "https://example.com/page",
      http: { headers: [{ name: "Authorization", value: "Bearer secret" }] },
      warn: () => undefined
    });
    expect(result.assets[0]?.status).toBe("saved");
    expect(receivedAuthorization).toBeUndefined();
  });

  it("rejects an explicitly non-image response despite its extension", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    const sourceUrl = `${baseUrl}/bad.png`;
    const result = await localizeAssets({
      markdown: `![image](${sourceUrl})`,
      imageUrls: [sourceUrl],
      representativeImage: sourceUrl,
      markdownPath: path.join(root, "example.com", "page.md"),
      root,
      baseUrl: "https://example.com/page",
      warn: () => undefined
    });
    expect(result.assets[0]?.status).toBe("failed");
    expect(result.markdown).toContain(sourceUrl);
    expect(result.representativeImageSource).toBeUndefined();
  });

  it("uses immutable content-addressed paths when asset bytes change", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    const sourceUrl = `${baseUrl}/image.png`;
    const first = await localizeAssets({
      markdown: `![image](${sourceUrl})`,
      imageUrls: [sourceUrl],
      markdownPath: path.join(root, "example.com", "page.md"),
      root,
      baseUrl,
      warn: () => undefined
    });
    imageBody = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
    const second = await localizeAssets({
      markdown: `![image](${sourceUrl})`,
      imageUrls: [sourceUrl],
      markdownPath: path.join(root, "example.com", "page.md"),
      root,
      baseUrl,
      warn: () => undefined
    });
    expect(first.assets[0]?.status).toBe("saved");
    expect(second.assets[0]?.status).toBe("saved");
    expect(second.assets[0]?.path).not.toBe(first.assets[0]?.path);
    expect(await readFile(first.assets[0]?.path ?? "")).toHaveLength(4);
    expect(await readFile(second.assets[0]?.path ?? "")).toHaveLength(5);
  });

  it("conditionally reuses the same image URL across documents", async () => {
    let requests = 0;
    let receivedIfNoneMatch: string | undefined;
    const conditionalServer = createServer((request, response) => {
      requests += 1;
      receivedIfNoneMatch = request.headers["if-none-match"];
      if (receivedIfNoneMatch === '"image-v1"') {
        response.writeHead(304, { etag: '"image-v1"' }).end();
        return;
      }
      response
        .writeHead(200, {
          "content-type": "image/png",
          etag: '"image-v1"'
        })
        .end(imageBody);
    });
    await new Promise<void>((resolve) =>
      conditionalServer.listen(0, "127.0.0.1", resolve)
    );
    const address = conditionalServer.address() as AddressInfo;
    const sourceUrl = `http://127.0.0.1:${address.port}/image.png`;
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    try {
      const first = await localizeAssets({
        markdown: `![image](${sourceUrl})`,
        imageUrls: [sourceUrl],
        markdownPath: path.join(root, "first.example", "page.md"),
        root,
        baseUrl: sourceUrl,
        warn: () => undefined
      });
      const second = await localizeAssets({
        markdown: `![image](${sourceUrl})`,
        imageUrls: [sourceUrl],
        markdownPath: path.join(root, "second.example", "page.md"),
        root,
        baseUrl: sourceUrl,
        warn: () => undefined
      });
      expect(requests).toBe(2);
      expect(receivedIfNoneMatch).toBe('"image-v1"');
      expect(first.assets[0]?.status).toBe("saved");
      expect(second.assets[0]?.status).toBe("reused");
      expect(second.assets[0]?.path).toBe(first.assets[0]?.path);
    } finally {
      await new Promise<void>((resolve) =>
        conditionalServer.close(() => resolve())
      );
    }
  });

  it("keeps query variants as separate validator cache entries", async () => {
    const received: Array<{ url: string; etag?: string }> = [];
    const queryServer = createServer((request, response) => {
      received.push({
        url: request.url ?? "",
        ...(request.headers["if-none-match"]
          ? { etag: request.headers["if-none-match"] }
          : {})
      });
      const etag = request.url === "/image.png?v=1" ? '"v1"' : '"v2"';
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304, { etag }).end();
        return;
      }
      response
        .writeHead(200, { "content-type": "image/png", etag })
        .end(imageBody);
    });
    await new Promise<void>((resolve) =>
      queryServer.listen(0, "127.0.0.1", resolve)
    );
    const address = queryServer.address() as AddressInfo;
    const firstUrl = `http://127.0.0.1:${address.port}/image.png?v=1`;
    const secondUrl = `http://127.0.0.1:${address.port}/image.png?v=2`;
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    const localize = (sourceUrl: string) =>
      localizeAssets({
        markdown: `![image](${sourceUrl})`,
        imageUrls: [sourceUrl],
        markdownPath: path.join(root, "example.com", "page.md"),
        root,
        baseUrl: sourceUrl,
        warn: () => undefined
      });
    try {
      const first = await localize(firstUrl);
      const second = await localize(secondUrl);
      const repeatedFirst = await localize(firstUrl);
      expect(received).toEqual([
        { url: "/image.png?v=1" },
        { url: "/image.png?v=2" },
        { url: "/image.png?v=1", etag: '"v1"' }
      ]);
      expect(second.assets[0]?.path).toBe(first.assets[0]?.path);
      expect(repeatedFirst.assets[0]?.status).toBe("reused");
    } finally {
      await new Promise<void>((resolve) => queryServer.close(() => resolve()));
    }
  });

  it("does not reuse validators for credentialed images", async () => {
    const received: Array<{ authorization?: string; etag?: string }> = [];
    const privateServer = createServer((request, response) => {
      received.push({
        ...(request.headers.authorization
          ? { authorization: request.headers.authorization }
          : {}),
        ...(request.headers["if-none-match"]
          ? { etag: request.headers["if-none-match"] }
          : {})
      });
      response
        .writeHead(200, {
          "content-type": "image/png",
          etag: '"private"'
        })
        .end(imageBody);
    });
    await new Promise<void>((resolve) =>
      privateServer.listen(0, "127.0.0.1", resolve)
    );
    const address = privateServer.address() as AddressInfo;
    const sourceUrl = `http://127.0.0.1:${address.port}/image.png`;
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    const options = {
      markdown: `![image](${sourceUrl})`,
      imageUrls: [sourceUrl],
      markdownPath: path.join(root, "example.com", "page.md"),
      root,
      baseUrl: sourceUrl,
      http: { headers: [{ name: "Authorization", value: "secret" }] },
      warn: () => undefined
    };
    try {
      await localizeAssets(options);
      await localizeAssets(options);
      expect(received).toEqual([
        { authorization: "secret" },
        { authorization: "secret" }
      ]);
    } finally {
      await new Promise<void>((resolve) =>
        privateServer.close(() => resolve())
      );
    }
  });

  it("does not reuse validators for responses with Vary fields", async () => {
    const receivedEtags: Array<string | undefined> = [];
    const varyingServer = createServer((request, response) => {
      receivedEtags.push(request.headers["if-none-match"]);
      response
        .writeHead(200, {
          "content-type": "image/png",
          etag: '"varying"',
          vary: "Accept-Language"
        })
        .end(imageBody);
    });
    await new Promise<void>((resolve) =>
      varyingServer.listen(0, "127.0.0.1", resolve)
    );
    const address = varyingServer.address() as AddressInfo;
    const sourceUrl = `http://127.0.0.1:${address.port}/image.png`;
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    const options = {
      markdown: `![image](${sourceUrl})`,
      imageUrls: [sourceUrl],
      markdownPath: path.join(root, "example.com", "page.md"),
      root,
      baseUrl: sourceUrl,
      warn: () => undefined
    };
    try {
      await localizeAssets(options);
      await localizeAssets(options);
      expect(receivedEtags).toEqual([undefined, undefined]);
    } finally {
      await new Promise<void>((resolve) =>
        varyingServer.close(() => resolve())
      );
    }
  });

  it("drops a stale validator when a later response is not cacheable", async () => {
    const receivedEtags: Array<string | undefined> = [];
    let requestCount = 0;
    const changingServer = createServer((request, response) => {
      requestCount += 1;
      receivedEtags.push(request.headers["if-none-match"]);
      response
        .writeHead(200, {
          "content-type": "image/png",
          ...(requestCount === 1 ? { etag: '"initial"' } : {})
        })
        .end(imageBody);
    });
    await new Promise<void>((resolve) =>
      changingServer.listen(0, "127.0.0.1", resolve)
    );
    const address = changingServer.address() as AddressInfo;
    const sourceUrl = `http://127.0.0.1:${address.port}/image.png`;
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    const options = {
      markdown: `![image](${sourceUrl})`,
      imageUrls: [sourceUrl],
      markdownPath: path.join(root, "example.com", "page.md"),
      root,
      baseUrl: sourceUrl,
      warn: () => undefined
    };
    try {
      await localizeAssets(options);
      await localizeAssets(options);
      await localizeAssets(options);
      expect(receivedEtags).toEqual([undefined, '"initial"', undefined]);
    } finally {
      await new Promise<void>((resolve) =>
        changingServer.close(() => resolve())
      );
    }
  });

  it("does not cache a response with Cache-Control no-store", async () => {
    const receivedEtags: Array<string | undefined> = [];
    const noStoreServer = createServer((request, response) => {
      receivedEtags.push(request.headers["if-none-match"]);
      response
        .writeHead(200, {
          "cache-control": "private, no-store",
          "content-type": "image/png",
          etag: '"not-stored"'
        })
        .end(imageBody);
    });
    await new Promise<void>((resolve) =>
      noStoreServer.listen(0, "127.0.0.1", resolve)
    );
    const address = noStoreServer.address() as AddressInfo;
    const sourceUrl = `http://127.0.0.1:${address.port}/image.png`;
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    const options = {
      markdown: `![image](${sourceUrl})`,
      imageUrls: [sourceUrl],
      markdownPath: path.join(root, "example.com", "page.md"),
      root,
      baseUrl: sourceUrl,
      warn: () => undefined
    };
    try {
      await localizeAssets(options);
      await localizeAssets(options);
      expect(receivedEtags).toEqual([undefined, undefined]);
    } finally {
      await new Promise<void>((resolve) =>
        noStoreServer.close(() => resolve())
      );
    }
  });

  it("localizes an image when its cache path is a directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    const sourceUrl = `${baseUrl}/image.png`;
    const cacheKey = createHash("sha256").update(sourceUrl).digest("hex");
    const cachePath = path.join(root, "_assets", ".cache", `${cacheKey}.json`);
    await mkdir(cachePath, { recursive: true });
    const warnings: string[] = [];
    const result = await localizeAssets({
      markdown: `![image](${sourceUrl})`,
      imageUrls: [sourceUrl],
      markdownPath: path.join(root, "example.com", "page.md"),
      root,
      baseUrl,
      warn: (warning) => warnings.push(warning.code)
    });
    expect(result.assets[0]?.status).toBe("saved");
    expect(warnings).toEqual(["ASSET_CACHE_INVALID"]);
  });

  it("preserves an invalid-cache warning when image fetching also fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    const sourceUrl = `${baseUrl}/bad.png`;
    const cacheKey = createHash("sha256").update(sourceUrl).digest("hex");
    const cachePath = path.join(root, "_assets", ".cache", `${cacheKey}.json`);
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, "{");
    const warnings: string[] = [];
    const result = await localizeAssets({
      markdown: `![image](${sourceUrl})`,
      imageUrls: [sourceUrl],
      markdownPath: path.join(root, "example.com", "page.md"),
      root,
      baseUrl,
      warn: (warning) => warnings.push(warning.code)
    });
    expect(result.assets[0]?.status).toBe("failed");
    expect(warnings).toEqual([
      "ASSET_CACHE_INVALID",
      "ASSET_FETCH_FAILED"
    ]);
  });

  it("accepts a jpeg URL when Content-Type is missing", async () => {
    const jpegServer = createServer((_request, response) => {
      response.writeHead(200).end(Buffer.from([0xff, 0xd8, 0xff]));
    });
    await new Promise<void>((resolve) => jpegServer.listen(0, "127.0.0.1", resolve));
    const address = jpegServer.address() as AddressInfo;
    const sourceUrl = `http://127.0.0.1:${address.port}/photo.jpeg`;
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    try {
      const result = await localizeAssets({
        markdown: `![image](${sourceUrl})`,
        imageUrls: [sourceUrl],
        markdownPath: path.join(root, "example.com", "page.md"),
        root,
        baseUrl: sourceUrl,
        warn: () => undefined
      });
      expect(result.assets[0]?.status).toBe("saved");
    } finally {
      await new Promise<void>((resolve) => jpegServer.close(() => resolve()));
    }
  });

  it("does not replace an existing asset with an empty 304 response", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mdhq-assets-"));
    const sourceUrl = `${baseUrl}/not-modified.png`;
    const existing = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const digest = createHash("sha256").update(existing).digest("hex");
    const assetPath = path.join(root, "_assets", `${digest}.png`);
    await mkdir(path.dirname(assetPath), { recursive: true });
    await writeFile(assetPath, existing);
    const result = await localizeAssets({
      markdown: `![image](${sourceUrl})`,
      imageUrls: [sourceUrl],
      markdownPath: path.join(root, "example.com", "page.md"),
      root,
      baseUrl,
      http: { headers: [{ name: "If-None-Match", value: '"page"' }] },
      warn: () => undefined
    });
    expect(result.assets[0]?.status).toBe("failed");
    expect(await readFile(assetPath)).toEqual(existing);
  });
});
