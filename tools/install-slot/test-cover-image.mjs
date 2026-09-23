import assert from "node:assert/strict";
import test from "node:test";
import * as coverImage from "./cover-image.js";

import {
  COVER_PREVIEW_MAX_BYTES,
  chooseCompressedCover,
  coverCropRect,
} from "./cover-image.js";

test("center-crops wide and tall images to the 3:4 cover ratio", () => {
  assert.deepEqual(coverCropRect(1600, 900), { sx: 462.5, sy: 0, sw: 675, sh: 900 });
  assert.deepEqual(coverCropRect(900, 1600), { sx: 0, sy: 200, sw: 900, sh: 1200 });
});

test("chooses the highest-quality encoded cover within 50 KiB", () => {
  const candidates = [
    { quality: 0.88, blob: { size: 64000 } },
    { quality: 0.76, blob: { size: 49000 } },
    { quality: 0.64, blob: { size: 36000 } },
  ];
  assert.equal(COVER_PREVIEW_MAX_BYTES, 50 * 1024);
  assert.equal(chooseCompressedCover(candidates), candidates[1]);
});

test("rejects a cover when no encoded candidate meets the size limit", () => {
  assert.throws(() => chooseCompressedCover([{ quality: 0.5, blob: { size: 70000 } }]), /50 KiB/);
});

test("encodes a browser preview at the highest quality that fits the limit", async () => {
  assert.equal(typeof coverImage.encodeCoverPreview, "function");
  const attempts = [];
  const result = await coverImage.encodeCoverPreview({}, {
    encode: async (_canvas, type, quality) => {
      attempts.push({ type, quality });
      return { size: quality >= 0.8 ? 61000 : 48000, type };
    },
  });
  assert.deepEqual(attempts, [
    { type: "image/webp", quality: 0.88 },
    { type: "image/webp", quality: 0.76 },
  ]);
  assert.equal(result.blob.size, 48000);
  assert.equal(result.quality, 0.76);
});
