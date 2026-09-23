import assert from "node:assert/strict";
import test from "node:test";

import { fitLauncherTitle, inspectLauncherTitle, requireLauncherTitle } from "./title-font.js";

test("common Simplified Chinese, ASCII, and full-width punctuation are supported", () => {
  assert.equal(inspectLauncherTitle("点球决胜：第１关！").valid, true);
  assert.equal(requireLauncherTitle("中文 Play 1"), "中文 Play 1");
});

test("rare CJK and emoji are reported before installation", () => {
  const result = inspectLauncherTitle("神龘玩法🎮");
  assert.equal(result.valid, false);
  assert.deepEqual(result.unsupported.map((item) => item.codePoint), ["U+9F98", "U+1F3AE"]);
  assert.throws(() => requireLauncherTitle("神龘玩法🎮"), /U\+9F98.*U\+1F3AE/);
});

test("title fitting never splits a UTF-8 character", () => {
  const fitted = fitLauncherTitle("点球大战玩法".repeat(8));
  assert.ok(new TextEncoder().encode(fitted).length <= 64);
  assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(fitted)));
});
