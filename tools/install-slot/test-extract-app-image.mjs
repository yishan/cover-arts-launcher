import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  MAX_APP_IMAGE_SIZE,
  encodePartitionTable,
  espImageLength,
  extractAppImage,
  parsePartitionTable,
} from "./extract-app-image.js";

function writeU32LE(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function buildAppImage(targetLength = 0x1000) {
  assert.equal(targetLength % 16, 0);
  let dataLength = targetLength - (24 + 8 + 1 + 32);
  for (;;) {
    let length = 24 + 8 + dataLength;
    while (length % 16 !== 15) length++;
    length += 1 + 32;
    if (length === targetLength) break;
    dataLength += targetLength - length;
  }
  const bytes = new Uint8Array(targetLength).fill(0xa5);
  bytes[0] = 0xe9;
  bytes[1] = 1;
  bytes[12] = 5;
  bytes[13] = 0;
  bytes[23] = 1;
  writeU32LE(bytes, 24, 0x3c000020);
  writeU32LE(bytes, 28, dataLength);
  return bytes;
}

function partitionSector(entries, corruptMd5 = false) {
  const sector = new Uint8Array(0x1000).fill(0xff);
  let offset = 0;
  for (const entry of entries) {
    sector[offset] = 0xaa;
    sector[offset + 1] = 0x50;
    sector[offset + 2] = entry.type;
    sector[offset + 3] = entry.subtype;
    writeU32LE(sector, offset + 4, entry.offset);
    writeU32LE(sector, offset + 8, entry.size);
    new TextEncoder().encodeInto(entry.name, sector.subarray(offset + 12, offset + 28));
    offset += 32;
  }
  sector.set([0xeb, 0xeb, ...new Uint8Array(14).fill(0xff)], offset);
  const digest = createHash("md5").update(sector.subarray(0, offset)).digest();
  sector.set(digest, offset + 16);
  if (corruptMd5) sector[offset + 16] ^= 0x80;
  return sector;
}

function mergedImage({ app = buildAppImage(), includeFactory = true, corruptMd5 = false } = {}) {
  const entries = [
    { name: "nvs", type: 1, subtype: 2, offset: 0x9000, size: 0x6000 },
    ...(includeFactory ? [{ name: "factory", type: 0, subtype: 0, offset: 0x10000, size: 0x170000 }] : []),
  ];
  const bytes = new Uint8Array(0x10000 + app.length).fill(0xff);
  bytes.set(partitionSector(entries, corruptMd5), 0x8000);
  if (includeFactory) bytes.set(app, 0x10000);
  return bytes;
}

test("accepts an app-only ESP32-C3 image", () => {
  const app = buildAppImage();
  const result = extractAppImage(app);
  assert.equal(result.kind, "app");
  assert.equal(result.length, app.length);
  assert.deepEqual(result.data, app);
});
test("extracts the factory app from a merged image with valid partition MD5", () => {
  const app = buildAppImage(0x2000);
  const merged = mergedImage({ app });
  const table = parsePartitionTable(merged.subarray(0x8000, 0x9000));
  assert.equal(table.md5Valid, true);
  const result = extractAppImage(merged);
  assert.equal(result.kind, "merged");
  assert.equal(result.appOffset, 0x10000);
  assert.deepEqual(result.data, app);
});

test("encodes a partition table that round-trips with a valid MD5", () => {
  const entries = [
    { name: "nvs", type: 1, subtype: 2, offset: 0x9000, size: 0x6000 },
    { name: "factory", type: 0, subtype: 0, offset: 0x10000, size: 0x170000 },
    { name: "ota_0", type: 0, subtype: 0x10, offset: 0x180000, size: 0xc0000 },
    { name: "otadata", type: 1, subtype: 0, offset: 0x7fe000, size: 0x2000 },
  ];
  const decoded = parsePartitionTable(encodePartitionTable(entries));
  assert.equal(decoded.md5Present, true);
  assert.equal(decoded.md5Valid, true);
  assert.deepEqual(decoded.entries, entries);
});

test("rejects a merged image with a bad partition-table MD5", () => {
  assert.throws(() => extractAppImage(mergedImage({ corruptMd5: true })), /partition.*MD5/i);
});

test("rejects a merged image without a factory app", () => {
  assert.throws(() => extractAppImage(mergedImage({ includeFactory: false })), /factory/i);
});

test("rejects truncated segment data", () => {
  const app = buildAppImage();
  assert.throws(() => espImageLength(app.subarray(0, app.length - 64), 0), /truncated/i);
});

test("rejects non-ESP input", () => {
  assert.throws(() => extractAppImage(new Uint8Array(256)), /magic|ESP/i);
});

test("allows one image to fill the dynamic arena and rejects the next aligned image", () => {
  assert.equal(extractAppImage(buildAppImage(MAX_APP_IMAGE_SIZE)).length, MAX_APP_IMAGE_SIZE);
  assert.throws(
    () => extractAppImage(buildAppImage(MAX_APP_IMAGE_SIZE + 0x10)),
    /exceeds.*0x6e0000/i,
  );
});
