import assert from "node:assert/strict";
import test from "node:test";
import catalogHandler from "./api/catalog.js";
import playHandler from "./api/play.js";
import resourceHandler from "./api/resource.js";
import { officialResourceUrl } from "./lib/official-proxy.js";

function responseRecorder() {
  return {
    statusCode: 200,
    headers: new Map(),
    body: null,
    setHeader(name, value) { this.headers.set(name.toLowerCase(), String(value)); },
    end(body) { this.body = Buffer.from(body ?? ""); },
  };
}

test("Vercel resource proxy accepts only official API assets", () => {
  assert.equal(
    officialResourceUrl("https://ai-passport.folotoy.cn/api/media/cover.webp").href,
    "https://ai-passport.folotoy.cn/api/media/cover.webp",
  );
  assert.throws(() => officialResourceUrl("https://example.com/api/firmware.bin"), /Only official/);
  assert.throws(() => officialResourceUrl("https://ai-passport.folotoy.cn/plays/281/"), /Only official/);
});

test("Vercel Play function maps an official detail URL to the public API", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (target) => {
    requested = String(target);
    const body = new TextEncoder().encode('{"projectId":"281"}');
    return {
      ok: true,
      status: 200,
      url: requested,
      headers: new Headers({ "content-type": "application/json" }),
      arrayBuffer: async () => body.buffer,
    };
  };
  try {
    const response = responseRecorder();
    await playHandler({
      method: "GET",
      url: "/api/play?url=https%3A%2F%2Fai-passport.folotoy.cn%2Fplays%2F281%2F",
      headers: { host: "preview.vercel.app" },
    }, response);
    assert.equal(requested, "https://ai-passport.folotoy.cn/api/plays/id/281");
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.body.toString(), '{"projectId":"281"}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Vercel catalog function forwards normalized title and category filters", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (target) => {
    requested = String(target);
    const body = new TextEncoder().encode('{"ok":true,"plays":[],"pagination":{"total":0,"hasMore":false}}');
    return {
      ok: true,
      status: 200,
      url: requested,
      headers: new Headers({ "content-type": "application/json" }),
      arrayBuffer: async () => body.buffer,
    };
  };
  try {
    const response = responseRecorder();
    await catalogHandler({
      method: "GET",
      url: "/api/catalog?q=flag&category=games&limit=12&offset=0&url=https%3A%2F%2Fexample.com",
      headers: { host: "preview.vercel.app" },
    }, response);
    assert.equal(
      requested,
      "https://ai-passport.folotoy.cn/api/plays?tag=&bootstrap=true&q=flag&category=games&sort=relevance&period=all&limit=12&offset=0",
    );
    assert.equal(response.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Vercel resource function fails closed for an external target", async () => {
  const response = responseRecorder();
  await resourceHandler({
    method: "GET",
    url: "/api/resource?url=https%3A%2F%2Fexample.com%2Ffirmware.bin",
    headers: { host: "preview.vercel.app" },
  }, response);
  assert.equal(response.statusCode, 400);
  assert.match(response.body.toString(), /Only official/);
});

test("Vercel functions reject non-GET methods", async () => {
  const response = responseRecorder();
  await playHandler({ method: "POST", url: "/api/play", headers: { host: "preview.vercel.app" } }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.get("allow"), "GET");
  const catalogResponse = responseRecorder();
  await catalogHandler({ method: "POST", url: "/api/catalog", headers: { host: "preview.vercel.app" } }, catalogResponse);
  assert.equal(catalogResponse.statusCode, 405);
});
