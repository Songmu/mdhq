import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchHtml } from "./fetch.js";

describe("fetchHtml", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/page" }).end();
        return;
      }
      if (request.url === "/large") {
        response.writeHead(200, { "content-type": "text/html" }).end("x".repeat(100));
        return;
      }
      if (request.url === "/json") {
        response.writeHead(200, { "content-type": "application/json" }).end("{}");
        return;
      }
      response
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(`<html><body>${request.headers["x-test"] ?? ""}</body></html>`);
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

  it("follows redirects and sends custom headers", async () => {
    const result = await fetchHtml(`${baseUrl}/redirect`, {
      headers: [{ name: "X-Test", value: "present" }]
    });
    expect(result.finalUrl).toBe(`${baseUrl}/page`);
    expect(result.html).toContain("present");
  });

  it("does not forward custom headers across origins", async () => {
    let receivedAuthorization: string | undefined;
    const target = createServer((request, response) => {
      receivedAuthorization = request.headers.authorization;
      response.writeHead(200, { "content-type": "text/html" }).end("<html></html>");
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const targetAddress = target.address() as AddressInfo;
    const redirect = createServer((_request, response) => {
      response
        .writeHead(302, {
          location: `http://127.0.0.1:${targetAddress.port}/target`
        })
        .end();
    });
    await new Promise<void>((resolve) => redirect.listen(0, "127.0.0.1", resolve));
    const redirectAddress = redirect.address() as AddressInfo;
    try {
      await fetchHtml(`http://127.0.0.1:${redirectAddress.port}/redirect`, {
        headers: [{ name: "Authorization", value: "Bearer secret" }]
      });
      expect(receivedAuthorization).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => redirect.close(() => resolve()));
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  it("rejects unsupported page content types", async () => {
    await expect(fetchHtml(`${baseUrl}/json`)).rejects.toMatchObject({
      code: "UNSUPPORTED_CONTENT_TYPE"
    });
  });

  it("enforces the response size limit", async () => {
    await expect(fetchHtml(`${baseUrl}/large`, { maxResponseBytes: 20 })).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE"
    });
  });
});
