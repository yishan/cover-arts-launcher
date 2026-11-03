import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";
import { extractAppImage } from "./extract-app-image.js";
import { managerApiUrl, normalizeOfficialPlay } from "./play-source.js";

const app = await readFile(new URL("app.js", import.meta.url), "utf8");
function source(name) {
  const match = app.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `missing application function ${name}`);
  return match[0];
}
function image() {
  const bytes = new Uint8Array(96).fill(0xa5);
  bytes.set([0xe9, 1]); bytes[12] = 5; bytes[13] = 0; bytes[23] = 1;
  const view = new DataView(bytes.buffer);
  view.setUint32(24, 0x3c000020, true); view.setUint32(28, 31, true);
  return bytes;
}
function harness({ changed = false, corrupt = false, malformed = false } = {}) {
  const bytes = malformed ? new Uint8Array([1, 2, 3]) : image();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const play = { projectId: 1, title: "Demo", shareVersion: "1", downloadUrl: "/api/download/community/demo", firmwareSha256: hash };
  const pending = { ...normalizeOfficialPlay(play), detailUrl: "https://ai-passport.folotoy.cn/plays/1/", coverBytes: null };
  const state = { pendingPlay: pending, preparedPlay: null, verifiedDownload: null };
  const fields = new Map([['#play-title', { value: 'Edited title' }], ['#play-version', { value: '1' }], ['#play-source-id', { value: 'play:1' }], ['#image-info', {}]]);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith("/api/play?")) return Response.json({ play: { ...play, shareVersion: changed ? "2" : "1" } });
    const result = bytes.slice();
    if (corrupt) result[0] ^= 1;
    return new Response(result);
  };
  const names = ["toHex", "normalizeSha", "sha256", "verifyPublished", "preparePlay", "fetchOfficialResource", "fetchOfficialMetadata", "ensurePreparedPlay"];
  const ensure = new Function("state", "$", "fetch", "crypto", "extractAppImage", "normalizeOfficialPlay", "managerApiUrl", "setResult", "updateTitleCheck", "applyRecommendation", "refreshActions",
    names.map(source).join("\n") + "\nreturn ensurePreparedPlay;")(
    state, (selector) => fields.get(selector), fetchImpl, webcrypto, extractAppImage, normalizeOfficialPlay,
    (path) => managerApiUrl(path, { protocol: "https:" }), () => {}, () => {}, () => {}, () => {});
  return { ensure, state, calls, pending, hash };
}

test("confirmed install revalidates metadata then verifies and extracts the downloaded App", async () => {
  const run = harness();
  assert.equal(run.calls.length, 0);
  await run.ensure();
  assert.match(run.calls[0].url, /fresh=1/);
  assert.equal(run.calls[0].options.cache, "no-store");
  assert.match(run.calls[1].url, new RegExp(`sha256=${run.hash}`));
  assert.equal(run.state.preparedPlay.sourceSha, run.hash);
  assert.equal(run.state.preparedPlay.title, "Edited title");
  assert.equal(run.state.preparedPlay.app.length, 96);
});

test("changed publication fails before downloading any firmware", async () => {
  const run = harness({ changed: true });
  await assert.rejects(run.ensure(), /已更新/);
  assert.equal(run.calls.length, 1);
  assert.equal(run.state.preparedPlay, null);
});

test("corrupt and structurally invalid firmware cannot become a prepared play", async () => {
  for (const options of [{ corrupt: true }, { malformed: true }]) {
    const run = harness(options);
    await assert.rejects(run.ensure(), /SHA|image|ESP|short|magic/i);
    assert.equal(run.state.preparedPlay, null);
  }
});

test("reselection reuses only one SHA-verified file and checks it again before use", async () => {
  const run = harness();
  await run.ensure();
  run.state.preparedPlay = null;
  await run.ensure();
  assert.equal(run.calls.filter(({ url }) => url.startsWith("/api/resource")).length, 1);
  run.state.preparedPlay = null;
  run.state.verifiedDownload.bytes[0] ^= 1;
  await assert.rejects(run.ensure(), /SHA/);
  assert.equal(run.state.preparedPlay, null);
});

test("a prepared local file needs no official metadata request", async () => {
  const run = harness();
  run.state.pendingPlay = null;
  run.state.preparedPlay = { sourceKind: "local" };
  await run.ensure();
  assert.equal(run.calls.length, 0);
});
