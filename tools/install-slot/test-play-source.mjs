import assert from "node:assert/strict";
import test from "node:test";

import {
  managerApiUrl,
  normalizeOfficialPlay,
  officialPlayApiPath,
} from "./play-source.js";
import { inspectLauncherTitle } from "./title-font.js";

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
    deviceTitleChanges: [],
    version: "1037-2",
    coverUrl: "/api/media/plays/meta-pass.webp?v=1037-2",
    firmwareUrl: "/api/download/community/meta-pass",
    firmwareSha256: "b4041f5a6cfdf2f7a191b40ca1c65c4263e4747134d10804cb5cd64b4b827fb4",
  });
});

test("adapts an official title to the Launcher font instead of requiring a manual rename", () => {
  const play = normalizeOfficialPlay({
    play: {
      ...officialPayload.play,
      title: { zh: "恶魔·契约🎮", en: "Demon Pact" },
    },
  });
  assert.equal(play.deviceTitle, "恶魔 契约");
  assert.deepEqual(play.deviceTitleChanges, [
    { character: "·", codePoint: "U+00B7", replacement: " " },
    { character: "🎮", codePoint: "U+1F3AE", replacement: "" },
  ]);
  assert.equal(inspectLauncherTitle(play.deviceTitle).valid, true);
});

test("falls back to the play id when no official title character is displayable", () => {
  const play = normalizeOfficialPlay({
    play: { ...officialPayload.play, title: "🎮🎮" },
  });
  assert.equal(play.deviceTitle, "Play 281");
  assert.deepEqual(play.deviceTitleChanges.map(({ character }) => character), ["🎮"]);
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

function rejectedPlayUrl(value) {
  try {
    officialPlayApiPath(value);
  } catch (error) {
    return error;
  }
  assert.fail(`expected ${value} to be rejected`);
}

test("accepts official detail URLs and public Play API URLs", () => {
  const cases = new Map([
    ["https://ai-passport.folotoy.cn/plays/281/", "/api/plays/id/281"],
    ["https://ai-passport.folotoy.cn/plays/222/", "/api/plays/id/222"],
    ["https://ai-passport.folotoy.cn/plays/537", "/api/plays/id/537"],
    ["https://ai-passport.folotoy.cn/en/plays/meta-pass/", "/api/plays/meta-pass"],
    ["https://ai-passport.folotoy.cn/api/plays/id/281", "/api/plays/id/281"],
    ["https://ai-passport.folotoy.cn/api/plays/meta-pass/", "/api/plays/meta-pass/"],
  ]);
  for (const [input, expected] of cases) {
    assert.equal(officialPlayApiPath(input), expected, input);
  }
});

test("rejects non-official sources with an actionable Chinese hint", () => {
  for (const input of [
    "https://example.com/plays/281/",
    "https://github.com/yishan/cover-arts-launcher",
    "https://ai-passport.folotoy.cn.example.com/plays/281/",
    "http://ai-passport.folotoy.cn/plays/281/",
    "ftp://ai-passport.folotoy.cn/plays/281/",
  ]) {
    const error = rejectedPlayUrl(input);
    assert.equal(error.code, "unofficial-play-url", input);
    assert.match(error.message, /仅支持官方/, input);
    assert.match(error.message, /ai-passport\.folotoy\.cn/, input);
    assert.match(error.message, /本地文件/, input);
  }
});

test("rejects unsupported official paths without treating them as a source error", () => {
  for (const input of [
    "https://ai-passport.folotoy.cn/",
    "https://ai-passport.folotoy.cn/about",
    "https://ai-passport.folotoy.cn/plays/",
    "https://ai-passport.folotoy.cn/api/plays?q=flag",
    "https://ai-passport.folotoy.cn/plays/not_a_slug!/",
    "https://ai-passport.folotoy.cn/plays/281/comments/",
    "http://[",
  ]) {
    const error = rejectedPlayUrl(input);
    assert.equal(error.code, "unsupported-play-url", input);
    assert.match(error.message, /玩法详情页/, input);
    assert.match(error.message, /\/api\/plays\/id\//, input);
  }
});

test("points firmware file links and local .bin paths to the local file source", () => {
  for (const input of [
    "https://github.com/yishan/cover-arts-launcher/releases/download/v1.6.0/launcher.bin",
    "https://ai-passport.folotoy.cn/api/download/community/meta-pass",
    "https://example.com/firmware.bin",
  ]) {
    const error = rejectedPlayUrl(input);
    assert.equal(error.code, "firmware-file-url", input);
    assert.match(error.message, /本地文件/, input);
  }
  for (const input of ["./app.bin", "app.bin", "C:\\firmware\\play.bin", "file:///tmp/play.bin"]) {
    const error = rejectedPlayUrl(input);
    assert.equal(error.code, "local-firmware-path", input);
    assert.match(error.message, /本地文件/, input);
  }
});

test("file pages call the localhost manager while hosted pages stay same-origin", () => {
  assert.equal(managerApiUrl("/api/play", { protocol: "file:", origin: "null" }), "http://127.0.0.1:4173/api/play");
  assert.equal(managerApiUrl("/api/play", { protocol: "http:", origin: "http://127.0.0.1:4173" }), "/api/play");
});
