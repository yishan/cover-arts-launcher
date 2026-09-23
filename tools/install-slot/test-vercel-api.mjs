import assert from "node:assert/strict";
import test from "node:test";
import playHandler from "./api/play.mjs";
import resourceHandler from "./api/resource.mjs";

function mockResponse() {
  return {
    body: undefined,
    headers: new Map(),
    statusCode: 200,
    setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

test("Vercel play proxy accepts only official play detail URLs", async (context) => {
  let requested;
  context.mock.method(globalThis, "fetch", async (target) => {
    requested = String(target);
    return {
      url: requested,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      async arrayBuffer() { return new TextEncoder().encode('{"play":{"id":281}}').buffer; },
    };
  });
  const response = mockResponse();

  await playHandler({ method: "GET", query: { url: "https://ai-passport.folotoy.cn/plays/281/" } }, response);

  assert.equal(requested, "https://ai-passport.folotoy.cn/api/plays/id/281");
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
});

test("Vercel resource proxy rejects non-official resources before fetch", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch must not run");
  });
  const response = mockResponse();

  await resourceHandler({ method: "GET", query: { url: "https://example.com/firmware.bin" } }, response);

  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /Only official/);
});

test("Vercel proxy endpoints reject non-GET methods", async () => {
  const response = mockResponse();

  await playHandler({ method: "POST", query: {} }, response);

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.get("allow"), "GET");
});
