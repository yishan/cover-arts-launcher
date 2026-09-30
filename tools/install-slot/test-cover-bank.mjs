import assert from "node:assert/strict";
import test from "node:test";

import { COVER_PAYLOAD_LENGTH, crc32 } from "./cover-convert.js";
import { selectLatestReadableCoverBank, selectValidCoverBank } from "./cover-bank.js";

const appSha = new Uint8Array(32).fill(0x42);
const payload = new Uint8Array(COVER_PAYLOAD_LENGTH).fill(0x19);

function manifest(generation, overrides = {}) {
  return {
    generation,
    slotId: 1,
    firmwareSha256: appSha,
    payloadLength: payload.length,
    payloadCrc32: crc32(payload),
    title: `Play ${generation}`,
    ...overrides,
  };
}

test("selects only a bank accepted by the Launcher app-SHA and payload-CRC contract", () => {
  const selected = selectValidCoverBank({
    slotId: 1,
    appSha256: appSha,
    banks: [
      { bank: "a", manifest: manifest(3), payload },
      { bank: "b", manifest: manifest(4, { firmwareSha256: new Uint8Array(32) }), payload },
    ],
  });
  assert.equal(selected.bank, "a");
  assert.equal(selected.manifest.title, "Play 3");
});

test("rejects a newer bank when its payload is corrupt", () => {
  const selected = selectValidCoverBank({
    slotId: 1,
    appSha256: appSha,
    banks: [
      { bank: "a", manifest: manifest(8), payload },
      { bank: "b", manifest: manifest(9), payload: new Uint8Array(payload.length) },
    ],
  });
  assert.equal(selected.bank, "a");
});

test("returns null when no cover belongs to the installed app", () => {
  assert.equal(selectValidCoverBank({
    slotId: 1,
    appSha256: appSha,
    banks: [{ bank: "a", manifest: manifest(1, { slotId: 0 }), payload }],
  }), null);
});

test("selects the newest readable bank when restoring slot cover art", () => {
  const selected = selectLatestReadableCoverBank({
    slotId: 1,
    banks: [
      { bank: "a", manifest: manifest(10), payload },
      { bank: "b", manifest: manifest(11), payload },
    ],
  });
  assert.equal(selected.bank, "b");
  assert.equal(selected.manifest.title, "Play 11");
});

test("falls back to the older readable bank when the newest payload is corrupt", () => {
  const selected = selectLatestReadableCoverBank({
    slotId: 1,
    banks: [
      { bank: "a", manifest: manifest(12), payload },
      { bank: "b", manifest: manifest(13), payload: new Uint8Array(payload.length) },
    ],
  });
  assert.equal(selected.bank, "a");
});
