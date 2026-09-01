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

  beforeEach(async () => {
    server = createServer((request, response) => {
      receivedAuthorization = request.headers.authorization;
      if (request.url === "/bad.png") {
        response.writeHead(200, { "content-type": "text/html" }).end("<html>login</html>");
        return;
      }
      response
        .writeHead(200, { "content-type": "image/png" })
        .end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
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
    const root = await mkdtemp(path.join(os.tmpdir(), "markhq-assets-"));
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
    const root = await mkdtemp(path.join(os.tmpdir(), "markhq-assets-"));
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

  it("atomically replaces a differing existing asset", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "markhq-assets-"));
    const sourceUrl = `${baseUrl}/image.png`;
    const digest = createHash("md5").update(sourceUrl).digest("hex");
    const assetPath = path.join(root, "_assets", `${digest}.png`);
    await mkdir(path.dirname(assetPath), { recursive: true });
    await writeFile(assetPath, new Uint8Array());
    const result = await localizeAssets({
      markdown: `![image](${sourceUrl})`,
      imageUrls: [sourceUrl],
      markdownPath: path.join(root, "example.com", "page.md"),
      root,
      baseUrl,
      warn: () => undefined
    });
    expect(result.assets[0]?.status).toBe("saved");
    expect((await readFile(assetPath)).byteLength).toBe(4);
  });

  it("accepts a jpeg URL when Content-Type is missing", async () => {
    const jpegServer = createServer((_request, response) => {
      response.writeHead(200).end(Buffer.from([0xff, 0xd8, 0xff]));
    });
    await new Promise<void>((resolve) => jpegServer.listen(0, "127.0.0.1", resolve));
    const address = jpegServer.address() as AddressInfo;
    const sourceUrl = `http://127.0.0.1:${address.port}/photo.jpeg`;
    const root = await mkdtemp(path.join(os.tmpdir(), "markhq-assets-"));
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
});
