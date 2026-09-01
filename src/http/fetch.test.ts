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
    expect(result.notModified).toBe(false);
    if (!result.notModified) {
      expect(result.html).toContain("present");
    }
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
        headers: [{ name: "Authorization", value: "Bearer test-token" }]
      });
      expect(receivedAuthorization).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => redirect.close(() => resolve()));
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  it("does not restore custom headers after returning to the original origin", async () => {
    const received: Array<{ server: string; authorization?: string }> = [];
    let firstPort = 0;
    const second = createServer((request, response) => {
      received.push({
        server: "second",
        ...(request.headers.authorization
          ? { authorization: request.headers.authorization }
          : {})
      });
      response
        .writeHead(302, { location: `http://127.0.0.1:${firstPort}/final` })
        .end();
    });
    await new Promise<void>((resolve) => second.listen(0, "127.0.0.1", resolve));
    const secondPort = (second.address() as AddressInfo).port;
    const first = createServer((request, response) => {
      received.push({
        server: "first",
        ...(request.headers.authorization
          ? { authorization: request.headers.authorization }
          : {})
      });
      if (request.url === "/start") {
        response
          .writeHead(302, { location: `http://127.0.0.1:${secondPort}/bounce` })
          .end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html" }).end("<html></html>");
    });
    await new Promise<void>((resolve) => first.listen(0, "127.0.0.1", resolve));
    firstPort = (first.address() as AddressInfo).port;
    try {
      const result = await fetchHtml(`http://127.0.0.1:${firstPort}/start`, {
        headers: [{ name: "Authorization", value: "Bearer test-token" }]
      });
      expect(result.customHeadersAllowed).toBe(false);
      expect(received).toEqual([
        { server: "first", authorization: "Bearer test-token" },
        { server: "second" },
        { server: "first" }
      ]);
    } finally {
      await new Promise<void>((resolve) => first.close(() => resolve()));
      await new Promise<void>((resolve) => second.close(() => resolve()));
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

  it("wraps body transfer failures", async () => {
    const broken = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.write("partial");
      setTimeout(() => response.destroy(), 10);
    });
    await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", resolve));
    const address = broken.address() as AddressInfo;
    try {
      await expect(fetchHtml(`http://127.0.0.1:${address.port}/`)).rejects.toMatchObject({
        code: "FETCH_FAILED"
      });
    } finally {
      await new Promise<void>((resolve) => broken.close(() => resolve()));
    }
  });

  it("wraps malformed redirect locations", async () => {
    const redirect = createServer((_request, response) => {
      response.writeHead(302, { location: "http://[" }).end();
    });
    await new Promise<void>((resolve) => redirect.listen(0, "127.0.0.1", resolve));
    const address = redirect.address() as AddressInfo;
    try {
      await expect(fetchHtml(`http://127.0.0.1:${address.port}/`)).rejects.toMatchObject({
        code: "FETCH_FAILED"
      });
    } finally {
      await new Promise<void>((resolve) => redirect.close(() => resolve()));
    }
  });

  it("uses ETag before Last-Modified and accepts 304 without a body", async () => {
    let receivedHeaders: Record<string, string | undefined> = {};
    const conditionalServer = createServer((request, response) => {
      receivedHeaders = {
        ifNoneMatch: request.headers["if-none-match"],
        ifModifiedSince: request.headers["if-modified-since"]
      };
      response.writeHead(304, { etag: '"new"' }).end();
    });
    await new Promise<void>((resolve) =>
      conditionalServer.listen(0, "127.0.0.1", resolve)
    );
    const address = conditionalServer.address() as AddressInfo;
    try {
      const result = await fetchHtml(`http://127.0.0.1:${address.port}/`, {
        headers: [
          { name: "If-None-Match", value: '"caller"' },
          { name: "If-Modified-Since", value: "Sun, 30 Aug 2026 03:00:00 GMT" }
        ],
        conditional: {
          etag: '"old"',
          lastModified: "Mon, 31 Aug 2026 03:00:00 GMT"
        }
      });
      expect(result.notModified).toBe(true);
      expect(result.etag).toBe('"new"');
      expect(receivedHeaders).toEqual({
        ifNoneMatch: '"old"',
        ifModifiedSince: undefined
      });
    } finally {
      await new Promise<void>((resolve) => conditionalServer.close(() => resolve()));
    }
  });

  it("falls back to If-Modified-Since and drops validators after redirects", async () => {
    const received: Array<{ path: string; value?: string }> = [];
    const redirectServer = createServer((request, response) => {
      received.push({
        path: request.url ?? "",
        ...(request.headers["if-modified-since"]
          ? { value: request.headers["if-modified-since"] }
          : {})
      });
      if (request.url === "/start") {
        response.writeHead(302, { location: "/final" }).end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html" }).end("<html></html>");
    });
    await new Promise<void>((resolve) =>
      redirectServer.listen(0, "127.0.0.1", resolve)
    );
    const address = redirectServer.address() as AddressInfo;
    try {
      await fetchHtml(`http://127.0.0.1:${address.port}/start`, {
        conditional: { lastModified: "Mon, 31 Aug 2026 03:00:00 GMT" }
      });
      expect(received).toEqual([
        { path: "/start", value: "Mon, 31 Aug 2026 03:00:00 GMT" },
        { path: "/final" }
      ]);
    } finally {
      await new Promise<void>((resolve) => redirectServer.close(() => resolve()));
    }
  });
});
