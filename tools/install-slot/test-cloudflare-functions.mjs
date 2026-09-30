import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as playHandler } from "./functions/api/play.js";
import { onRequest as resourceHandler } from "./functions/api/resource.js";

function upstreamResponse(body, { status = 200, url, contentType = "application/octet-stream" } = {}) {
  return {
    body: new Blob([body]).stream(),
    headers: new Headers({ "content-type": contentType }),
    ok: status >= 200 && status < 300,
    status,
    url,
  };
}

test("Cloudflare Play function maps an official detail URL to the public API", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (target) => {
    requested = String(target);
    return upstreamResponse('{"projectId":"281"}', {
      url: requested,
      contentType: "application/json",
    });
  };
  try {
    const response = await playHandler({
      request: new Request(
        "https://cover-arts-launcher.pages.dev/api/play?url=https%3A%2F%2Fai-passport.folotoy.cn%2Fplays%2F281%2F",
      ),
    });
    assert.equal(requested, "https://ai-passport.folotoy.cn/api/plays/id/281");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(await response.text(), '{"projectId":"281"}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare resource function streams official API assets", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (target) => upstreamResponse(new Uint8Array([1, 2, 3]), {
    url: String(target),
    contentType: "application/octet-stream",
  });
  try {
    const response = await resourceHandler({
      request: new Request(
        "https://cover-arts-launcher.pages.dev/api/resource?url=https%3A%2F%2Fai-passport.folotoy.cn%2Fapi%2Ffirmware.bin",
      ),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare resource function fails closed for an external target", async () => {
  const response = await resourceHandler({
    request: new Request(
      "https://cover-arts-launcher.pages.dev/api/resource?url=https%3A%2F%2Fexample.com%2Ffirmware.bin",
    ),
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Only official/);
});

test("Cloudflare proxy rejects an upstream redirect outside the official origin", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => upstreamResponse("redirected", {
    url: "https://example.com/api/firmware.bin",
  });
  try {
    const response = await resourceHandler({
      request: new Request(
        "https://cover-arts-launcher.pages.dev/api/resource?url=https%3A%2F%2Fai-passport.folotoy.cn%2Fapi%2Ffirmware.bin",
      ),
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /redirected outside/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare functions preserve upstream failure status", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (target) => upstreamResponse("missing", {
    status: 404,
    url: String(target),
  });
  try {
    const response = await resourceHandler({
      request: new Request(
        "https://cover-arts-launcher.pages.dev/api/resource?url=https%3A%2F%2Fai-passport.folotoy.cn%2Fapi%2Fmissing.bin",
      ),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Official service returned HTTP 404." });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare functions reject non-GET methods", async () => {
  const response = await playHandler({
    request: new Request("https://cover-arts-launcher.pages.dev/api/play", { method: "POST" }),
  });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
});
