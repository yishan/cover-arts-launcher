import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { COVER_PAYLOAD_LENGTH, encodeCoverManifest } from "./cover-convert.js";
import { inspectAllSlotsFast, inspectSlot } from "./slot-inspector.js";
import { APP_SLOT_ADDRESSES, COVER_BANK_SIZE, COVER_REGION_ADDRESS } from "./slot-install.js";
import { encodeTrustRecord, trustBankAddress } from "./trust-record.js";

function writeU32LE(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function validApp(targetLength = 0x1000) {
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
  let checksum = 0xef;
  for (const value of bytes.subarray(32, 32 + dataLength)) checksum ^= value;
  let checksumOffset = 32 + dataLength;
  while (checksumOffset % 16 !== 15) checksumOffset++;
  bytes[checksumOffset] = checksum;
  bytes.set(createHash("sha256").update(bytes.subarray(0, checksumOffset + 1)).digest(), checksumOffset + 1);
  return bytes;
}

class FakeLoader {
  constructor() {
    this.flash = new Uint8Array(0x800000).fill(0xff);
  }

  async readFlash(address, length) {
    return this.flash.slice(address, address + length);
  }
}

function installCover(loader, { slotId, bank, generation, title, appSha, payload, sourceId = "play:281" }) {
  const index = slotId * 2 + (bank === "b" ? 1 : 0);
  const address = COVER_REGION_ADDRESS + index * COVER_BANK_SIZE;
  const manifest = encodeCoverManifest({
    generation,
    slotId,
    sourceKind: "play-api",
    title,
    sourceId,
    version: "1",
    firmwareSha256: appSha,
    payload,
  });
  loader.flash.set(manifest, address);
  loader.flash.set(payload, address + 0x1000);
}

test("slot inventory accepts only a cover bound to the verified app", async () => {
  const loader = new FakeLoader();
  const app = validApp();
  loader.flash.set(app, APP_SLOT_ADDRESSES[0]);
  const appSha = createHash("sha256").update(app).digest();
  const payload = new Uint8Array(COVER_PAYLOAD_LENGTH).fill(0x33);
  installCover(loader, { slotId: 0, bank: "a", generation: 7, title: "正确玩法", appSha, payload });
  installCover(loader, {
    slotId: 0,
    bank: "b",
    generation: 8,
    title: "陈旧封面",
    appSha: new Uint8Array(32).fill(0x99),
    payload,
  });

  const slot = await inspectSlot(loader, 0);
  assert.equal(slot.state, "ready", slot.diagnostic);
  assert.equal(slot.title, "正确玩法");
  assert.equal(slot.activeCoverBank, "a", slot.diagnostic);
  assert.equal(slot.generation, 7);
  assert.equal(slot.trustSource, "legacy-cover");
  assert.deepEqual(slot.coverPayload, payload);
});

test("slot inventory recognizes an exact SHA-bound resident receipt without a cover", async () => {
  const loader = new FakeLoader();
  const app = validApp();
  loader.flash.set(app, APP_SLOT_ADDRESSES[2]);
  const appSha = createHash("sha256").update(app).digest();
  const record = encodeTrustRecord({
    generation: 3,
    slotId: 2,
    imageLength: app.length,
    firmwareSha256: appSha,
  });
  loader.flash.set(record, trustBankAddress(2, "b"));

  const slot = await inspectSlot(loader, 2);
  assert.equal(slot.state, "ready");
  assert.equal(slot.trusted, true);
  assert.equal(slot.trustSource, "install-receipt");
  assert.equal(slot.activeTrustBank, "b");
  assert.equal(slot.trustGeneration, 3);
  assert.equal(slot.coverPayload, null);
});

test("equal cover generations select bank A like the device implementation", async () => {
  const loader = new FakeLoader();
  const app = validApp();
  loader.flash.set(app, APP_SLOT_ADDRESSES[1]);
  const appSha = createHash("sha256").update(app).digest();
  const payload = new Uint8Array(COVER_PAYLOAD_LENGTH).fill(0x44);
  installCover(loader, { slotId: 1, bank: "a", generation: 4, title: "Bank A", appSha, payload });
  installCover(loader, { slotId: 1, bank: "b", generation: 4, title: "Bank B", appSha, payload });
  const slot = await inspectSlot(loader, 1);
  assert.equal(slot.activeCoverBank, "a");
  assert.equal(slot.title, "Bank A");
});

test("corrupt app data is invalid instead of ready and stale metadata is ignored", async () => {
  const loader = new FakeLoader();
  const app = validApp();
  app[64] ^= 0x01;
  loader.flash.set(app, APP_SLOT_ADDRESSES[2]);
  const payload = new Uint8Array(COVER_PAYLOAD_LENGTH).fill(0x55);
  installCover(loader, {
    slotId: 2,
    bank: "a",
    generation: 1,
    title: "不应显示",
    appSha: new Uint8Array(32),
    payload,
  });
  const slot = await inspectSlot(loader, 2);
  assert.equal(slot.state, "invalid");
  assert.equal(slot.title, "");
  assert.equal(slot.activeCoverBank, null);
});

test("transport short reads are surfaced instead of being mistaken for corrupt content", async () => {
  const loader = {
    async readFlash(_address, length) { return new Uint8Array(Math.max(0, length - 2)); },
  };
  await assert.rejects(inspectSlot(loader, 0), /短读/);
});

test("fast inventory avoids reading complete app images during connection", async () => {
  const loader = new FakeLoader();
  loader.reads = [];
  const originalReadFlash = loader.readFlash.bind(loader);
  loader.readFlash = async (address, length) => {
    loader.reads.push({ address, length });
    return originalReadFlash(address, length);
  };

  for (let slotId = 0; slotId < 3; slotId++) {
    const app = validApp(0x18000 + slotId * 0x1000);
    const address = APP_SLOT_ADDRESSES[slotId];
    loader.flash.set(app, address);
    const appSha = createHash("sha256").update(app).digest();
    loader.flash.set(encodeTrustRecord({
      generation: slotId + 1,
      slotId,
      imageLength: app.length,
      firmwareSha256: appSha,
    }), trustBankAddress(slotId, "a"));
    installCover(loader, {
      slotId,
      bank: "a",
      generation: slotId + 1,
      title: `Slot ${slotId + 1}`,
      appSha,
      payload: new Uint8Array(COVER_PAYLOAD_LENGTH).fill(0x20 + slotId),
    });
  }

  const slots = await inspectAllSlotsFast(loader);
  assert.deepEqual(slots.map((slot) => slot.title), ["Slot 1", "Slot 2", "Slot 3"]);
  assert.equal(slots.every((slot) => slot.trustSource === "install-receipt"), true);
  assert.equal(loader.reads.some(({ address, length }) =>
    APP_SLOT_ADDRESSES.includes(address) && length > 40), false);
  assert.equal(Math.max(...loader.reads.map(({ length }) => length)), COVER_PAYLOAD_LENGTH);
});
