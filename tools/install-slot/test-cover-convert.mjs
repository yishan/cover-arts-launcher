import assert from "node:assert/strict";
import test from "node:test";

import {
  COVER_HEIGHT,
  COVER_PAYLOAD_LENGTH,
  COVER_WIDTH,
  coverRgb565ToRgba,
  crc32,
  decodeCoverManifest,
  encodeCoverManifest,
  rgbaToCoverRgb565,
} from "./cover-convert.js";

test("converts and scales RGBA input to exactly 120x160 RGB565 little-endian", () => {
  const rgba = Uint8ClampedArray.from([255, 0, 0, 255]);
  const result = rgbaToCoverRgb565({ data: rgba, width: 1, height: 1 });
  assert.equal(result.width, COVER_WIDTH);
  assert.equal(result.height, COVER_HEIGHT);
  assert.equal(result.data.length, COVER_PAYLOAD_LENGTH);
  assert.deepEqual([...result.data.subarray(0, 4)], [0x00, 0xf8, 0x00, 0xf8]);
});
test("transparent source pixels composite onto black", () => {
  const rgba = Uint8ClampedArray.from([255, 255, 255, 0]);
  const result = rgbaToCoverRgb565({ data: rgba, width: 1, height: 1 });
  assert.deepEqual([...result.data.subarray(0, 2)], [0x00, 0x00]);
});

test("decodes stored RGB565 cover pixels for browser display", () => {
  const payload = new Uint8Array(COVER_PAYLOAD_LENGTH);
  payload.set([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00]);
  const result = coverRgb565ToRgba(payload);
  assert.equal(result.width, COVER_WIDTH);
  assert.equal(result.height, COVER_HEIGHT);
  assert.deepEqual([...result.data.subarray(0, 12)], [
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
  ]);
  assert.throws(() => coverRgb565ToRgba(new Uint8Array(2)), /length/i);
});

test("rejects malformed source image data", () => {
  assert.throws(
    () => rgbaToCoverRgb565({ data: new Uint8Array(3), width: 1, height: 1 }),
    /RGBA/i,
  );
  assert.throws(
    () => rgbaToCoverRgb565({ data: new Uint8Array(4), width: 0, height: 1 }),
    /dimensions/i,
  );
});

test("uses the standard CRC-32 vector", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("encodes a canonical manifest bound to the app SHA and round-trips it", () => {
  const firmwareSha256 = new Uint8Array(32).map((_, index) => index + 1);
  const payload = new Uint8Array(COVER_PAYLOAD_LENGTH);
  const encoded = encodeCoverManifest({
    generation: 9,
    slotId: 2,
    sourceKind: "play-api",
    title: "Penalty Kick",
    sourceId: "play:281",
    version: "1.2.3",
    firmwareSha256,
    payload,
  });
  assert.equal(encoded.length, 256);
  assert.deepEqual([...encoded.subarray(0, 4)], [0x43, 0x56, 0x52, 0x31]);
  const decoded = decodeCoverManifest(encoded);
  assert.equal(decoded.generation, 9);
  assert.equal(decoded.slotId, 2);
  assert.equal(decoded.sourceId, "play:281");
  assert.deepEqual(decoded.firmwareSha256, firmwareSha256);
  assert.equal(decoded.payloadCrc32, crc32(payload));
});

test("rejects bad manifest CRC and invalid Play API identity", () => {
  const base = {
    generation: 1,
    slotId: 0,
    sourceKind: "play-api",
    title: "Play",
    sourceId: "play:1",
    version: "1",
    firmwareSha256: new Uint8Array(32),
    payload: new Uint8Array(COVER_PAYLOAD_LENGTH),
  };
  const encoded = encodeCoverManifest(base);
  encoded[60] ^= 1;
  assert.equal(decodeCoverManifest(encoded), null);
  assert.throws(() => encodeCoverManifest({ ...base, sourceId: "" }), /source/i);
});
