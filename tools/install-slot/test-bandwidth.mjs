import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import catalogHandler from "./api/catalog.js";
import playHandler from "./api/play.js";
import resourceHandler from "./api/resource.js";
import { normalizeOfficialCatalog, officialPlayCatalogApiPath } from "./play-catalog.js";
import { onRequest as cloudflarePlay } from "./functions/api/play.js";
import { onRequest as cloudflareResource } from "./functions/api/resource.js";
import { onRequest as cloudflareCatalog } from "./functions/api/catalog.js";

const origin = "https://ai-passport.folotoy.cn";
function recorder() {
  return { statusCode: 200, headers: new Map(), body: null,
    setHeader(key, value) { this.headers.set(key.toLowerCase(), String(value)); },
    end(body) { this.body = Buffer.from(body); } };
}
function upstream(body, url, status = 200, type = "application/json") {
  const response = new Response(body, { status, headers: { "content-type": type } });
  Object.defineProperty(response, "url", { value: String(url) });
  return response;
}
async function request(handler, url, fetchImpl) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const response = recorder();
  try { await handler({ method: "GET", url, headers: { host: "localhost" } }, response); }
  finally { globalThis.fetch = original; }
  return response;
}

test("catalog omits bootstrap at the source and strips unused upstream fields before transfer", async () => {
  assert.equal(new URL(officialPlayCatalogApiPath(), origin).searchParams.get("bootstrap"), "false");
  const payload = { plays: [{ id: 702, title: { zh: "国旗" }, author: "A", category: "games",
    image: "/api/media/full.webp?v=1", thumbnail: "/api/media/thumb.webp?v=1", firmwareSize: 100,
    instructions: "unused".repeat(5000), authorProfile: { unused: "profile" } }],
    pagination: { total: 1, hasMore: false }, categoryCounts: { games: 1 }, bootstrap: "unused".repeat(50000) };
  const response = await request(catalogHandler, "/api/catalog", async (url) => upstream(JSON.stringify(payload), url));
  assert.equal(response.statusCode, 200);
  assert.ok(response.body.length < 1000);
  const result = JSON.parse(response.body);
  assert.equal(result.bootstrap, undefined);
  assert.equal(result.plays[0].instructions, undefined);
  assert.equal(normalizeOfficialCatalog(result).plays[0].coverUrl, "/api/media/thumb.webp?v=1");
  assert.match(response.headers.get("cache-control"), /s-maxage=300/);
});

test("catalog prefers a supplied thumbnail while preserving original-image fallback", () => {
  const payload = { plays: [{ id: 1, title: "Test", image: "/api/media/full.webp", thumbnail: "/api/media/thumb.webp" }],
    pagination: { total: 1, hasMore: false } };
  assert.equal(normalizeOfficialCatalog(payload).plays[0].coverUrl, "/api/media/thumb.webp");
  payload.plays[0].thumbnail = "";
  assert.equal(normalizeOfficialCatalog(payload).plays[0].coverUrl, "/api/media/full.webp");
});

test("detail is briefly cached, but fresh install metadata and upstream errors are never cached", async () => {
  const fetchImpl = async (url) => upstream('{"projectId":1}', url);
  const path = "/api/play?url=" + encodeURIComponent(origin + "/plays/1/");
  const normal = await request(playHandler, path, fetchImpl);
  assert.match(normal.headers.get("cache-control"), /s-maxage=60/);
  const fresh = await request(playHandler, path + "&fresh=1", fetchImpl);
  assert.equal(fresh.headers.get("cache-control"), "no-store");
  const failure = await request(playHandler, path, async (url) => upstream("missing", url, 404));
  assert.equal(failure.statusCode, 404);
  assert.equal(failure.headers.get("cache-control"), "no-store");
});

test("versioned images cache while unverified firmware stays uncached", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const fetchImpl = async (url) => upstream(bytes, url, 200, "image/webp");
  const image = await request(resourceHandler, "/api/resource?url=" + encodeURIComponent(origin + "/api/media/a.webp?v=1"), fetchImpl);
  assert.match(image.headers.get("cache-control"), /s-maxage=604800/);
  const firmware = await request(resourceHandler, "/api/resource?url=" + encodeURIComponent(origin + "/api/download/community/a"), fetchImpl);
  assert.equal(firmware.headers.get("cache-control"), "no-store");
});

test("generic resource requests cannot opt into public metadata caching", async () => {
  const response = await request(resourceHandler, "/api/resource?url=" + encodeURIComponent(origin + "/api/plays"),
    async (url) => upstream('{"viewerUserId":null}', url));
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("firmware long caching requires a server-verified SHA; mismatch and malformed SHA fail closed", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const path = "/api/resource?url=" + encodeURIComponent(origin + "/api/download/community/a");
  const fetchImpl = async (url) => upstream(bytes, url, 200, "application/octet-stream");
  const valid = await request(resourceHandler, path + "&sha256=" + sha, fetchImpl);
  assert.equal(valid.statusCode, 200);
  assert.match(valid.headers.get("cache-control"), /s-maxage=86400/);
  const invalid = await request(resourceHandler, path + "&sha256=" + "0".repeat(64), fetchImpl);
  assert.notEqual(invalid.statusCode, 200);
  assert.equal(invalid.headers.get("cache-control"), "no-store");
  assert.match(invalid.body.toString(), /SHA/);
  const malformed = await request(resourceHandler, path + "&sha256=broken", async () => assert.fail("invalid SHA must fail before fetch"));
  assert.equal(malformed.statusCode, 400);
});

test("browsing only resolves metadata; firmware preparation runs before any flash erase", async () => {
  const app = await readFile(new URL("app.js", import.meta.url), "utf8");
  const resolve = app.match(/async function resolvePlayUrl\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.doesNotMatch(resolve, /fetchOfficialResource\(play\.firmwareUrl/);
  assert.match(resolve, /state\.pendingPlay/);
  const install = app.match(/async function installPlay\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.ok(install.indexOf("await ensurePreparedPlay()") >= 0);
  assert.ok(install.indexOf("await ensurePreparedPlay()") < install.indexOf("eraseRegion("));
  const select = app.match(/async function selectCatalogPlay\(play\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.doesNotMatch(select, /renderCatalogResults\(/);
});

test("pending official metadata enables install and repair without pretending firmware is verified", async () => {
  const app = await readFile(new URL("app.js", import.meta.url), "utf8");
  const refresh = app.match(/function refreshActions\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(refresh, /state\.pendingPlay/);
  const repair = app.match(/async function repairMetadataCover\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.ok(repair.indexOf("await ensurePreparedPlay()") >= 0);
  assert.ok(repair.indexOf("await ensurePreparedPlay()") < repair.indexOf("writeDynamicSidecar("));
});

test("Cloudflare shares compact catalog, fresh metadata and verified firmware cache policies", async () => {
  const original = globalThis.fetch;
  const bytes = new Uint8Array([4, 5, 6]);
  const sha = createHash("sha256").update(bytes).digest("hex");
  globalThis.fetch = async (url) => String(url).includes("/api/plays?")
    ? upstream(JSON.stringify({ plays: [], pagination: { total: 0, hasMore: false }, bootstrap: "unused".repeat(1000) }), url)
    : upstream(bytes, url, 200, "application/octet-stream");
  const context = (path) => ({ request: new Request("https://preview.pages.dev" + path) });
  try {
    const catalog = await cloudflareCatalog(context("/api/catalog"));
    assert.equal(catalog.status, 200);
    assert.ok((await catalog.text()).length < 200);
    assert.match(catalog.headers.get("cache-control"), /s-maxage=300/);
    const fresh = await cloudflarePlay(context("/api/play?fresh=1&url=" + encodeURIComponent(origin + "/plays/1/")));
    assert.equal(fresh.headers.get("cache-control"), "no-store");
    const path = "/api/resource?url=" + encodeURIComponent(origin + "/api/download/community/a");
    const valid = await cloudflareResource(context(path + "&sha256=" + sha));
    assert.equal(valid.status, 200);
    assert.match(valid.headers.get("cache-control"), /s-maxage=86400/);
    assert.deepEqual(new Uint8Array(await valid.arrayBuffer()), bytes);
    const mismatch = await cloudflareResource(context(path + "&sha256=" + "0".repeat(64)));
    assert.notEqual(mismatch.status, 200);
    assert.equal(mismatch.headers.get("cache-control"), "no-store");
  } finally { globalThis.fetch = original; }
});
