import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPage } from "./get-page.js";

describe("getPage", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let root: string;

  beforeEach(async () => {
    server = createServer((request, response) => {
      if (request.url === "/image.png") {
        response.writeHead(200, { "content-type": "image/png" }).end(
          Buffer.from([0x89, 0x50, 0x4e, 0x47])
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
    root = await mkdtemp(path.join(os.tmpdir(), "markhq-get-"));
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
});
