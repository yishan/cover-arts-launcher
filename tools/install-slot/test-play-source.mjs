import assert from "node:assert/strict";
import test from "node:test";

import {
  managerApiUrl,
  normalizeOfficialPlay,
  officialPlayApiPath,
} from "./play-source.js";

const officialPayload = {
  ok: true,
  play: {
    id: 281,
    projectId: 281,
    title: { zh: "meta-pass 多固件启动器", en: "meta-pass Multi-Firmware Launcher" },
    shareVersion: "1037-2",
    image: "/api/media/plays/meta-pass.webp?v=1037-2",
    downloadUrl: "/api/download/community/meta-pass",
    firmwareSha256: "b4041f5a6cfdf2f7a191b40ca1c65c4263e4747134d10804cb5cd64b4b827fb4",
  },
};

test("maps the official Play response to installer metadata", () => {
  assert.deepEqual(normalizeOfficialPlay(officialPayload), {
    playId: "281",
    sourceId: "play:281",
    title: "meta-pass 多固件启动器",
    deviceTitle: "meta-pass 多固件启动器",
    version: "1037-2",
    coverUrl: "/api/media/plays/meta-pass.webp?v=1037-2",
    firmwareUrl: "/api/download/community/meta-pass",
    firmwareSha256: "b4041f5a6cfdf2f7a191b40ca1c65c4263e4747134d10804cb5cd64b4b827fb4",
  });
});

test("prefers the official Chinese title supported by the Launcher font", () => {
  assert.equal(normalizeOfficialPlay({
    play: {
      ...officialPayload.play,
      title: { zh: "点球大战", en: "Penalty Kick" },
    },
  }).deviceTitle, "点球大战");
});

test("bounds a Chinese device title at a valid 64-byte UTF-8 boundary", () => {
  const deviceTitle = normalizeOfficialPlay({
    play: {
      ...officialPayload.play,
      title: { zh: "点球大战玩法".repeat(8), en: "Penalty Kick" },
    },
  }).deviceTitle;
  assert.ok(new TextEncoder().encode(deviceTitle).length <= 64);
  assert.ok(deviceTitle.startsWith("点球大战玩法"));
  assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(deviceTitle)));
});

test("accepts official detail URLs and rejects non-official sources", () => {
  assert.equal(officialPlayApiPath("https://ai-passport.folotoy.cn/plays/281/"), "/api/plays/id/281");
  assert.equal(officialPlayApiPath("https://ai-passport.folotoy.cn/en/plays/meta-pass/"), "/api/plays/meta-pass");
  assert.throws(() => officialPlayApiPath("https://example.com/plays/281/"), /official/i);
});

test("file pages call the localhost manager while hosted pages stay same-origin", () => {
  assert.equal(managerApiUrl("/api/play", { protocol: "file:", origin: "null" }), "http://127.0.0.1:4173/api/play");
  assert.equal(managerApiUrl("/api/play", { protocol: "http:", origin: "http://127.0.0.1:4173" }), "/api/play");
});
