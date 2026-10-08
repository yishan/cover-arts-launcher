import assert from "node:assert/strict";
import test from "node:test";

import { COVER_PAYLOAD_LENGTH } from "./cover-convert.js";
import {
  DYNAMIC_COMPACT_LAYOUT,
  appendDynamicSlot,
  dynamicPartitionEntries,
  planDynamicLibrary,
  removeDynamicSlot,
} from "./dynamic-layout.js";
import {
  dynamicSidecarLayout,
  encodeDynamicSidecarRecord,
} from "./dynamic-sidecar.js";
import { inspectDynamicLibraryFast } from "./dynamic-slot-inspector.js";
import { encodePartitionTable } from "./extract-app-image.js";

class FlashLoader {
  constructor() {
    this.flash = new Uint8Array(0x800000).fill(0xff);
    this.reads = [];
  }

  async readFlash(address, length) {
    this.reads.push({ address, length });
    return this.flash.slice(address, address + length);
  }
}

const cover = new Uint8Array(COVER_PAYLOAD_LENGTH).map((_, index) => index & 0xff);

function installFixture(loader, partition, { generation, title, corruptCover = false, omitRecord = false }) {
  loader.flash[partition.offset] = 0xe9;
  loader.flash[partition.offset + 1] = 1;
  loader.flash[partition.offset + 12] = 5;
  loader.flash[partition.offset + 13] = 0;
  const sidecar = dynamicSidecarLayout(partition);
  const payload = cover.slice();
  if (corruptCover) payload[0] ^= 1;
  loader.flash.set(payload, sidecar.payload.address);
  if (!omitRecord) {
    const record = encodeDynamicSidecarRecord({
      generation,
      slotId: partition.slotId,
      sourceKind: "play-api",
      title,
      sourceId: `play:${partition.slotId + 1}`,
      version: "1.0.0",
      imageLength: partition.imageLength,
      firmwareSha256: new Uint8Array(32).fill(partition.slotId + 1),
      coverPayload: cover,
      firstInstalledAt: 1727222400,
      lastInstalledAt: 1727308800,
      firstUtcOffsetMinutes: 480,
      lastUtcOffsetMinutes: 480,
    });
    loader.flash.set(record, generation % 2 ? sidecar.bankA.address : sidecar.bankB.address);
  }
}

function fixture() {
  const loader = new FlashLoader();
  const layout = planDynamicLibrary([0x50000, 0x90000]);
  loader.flash.set(encodePartitionTable(dynamicPartitionEntries(layout.slots)), 0x8000);
  return { loader, layout };
}

test("compact inventory reads populated plays from the recovered prefix", async () => {
  const loader = new FlashLoader();
  const layout = planDynamicLibrary([0x50000, 0x90000], DYNAMIC_COMPACT_LAYOUT);
  loader.flash.set(encodePartitionTable(dynamicPartitionEntries(layout.slots, DYNAMIC_COMPACT_LAYOUT)), 0x8000);
  installFixture(loader, layout.slots[0], { generation: 1, title: "玩法一" });
  installFixture(loader, layout.slots[1], { generation: 2, title: "玩法二" });
  const inventory = await inspectDynamicLibraryFast(loader);
  assert.deepEqual(inventory.layout, DYNAMIC_COMPACT_LAYOUT);
  assert.deepEqual(inventory.slots.map(({ offset, title, state, coverState }) => ({ offset, title, state, coverState })), [
    { offset: 0x100000, title: "玩法一", state: "ready", coverState: "ready" },
    { offset: 0x160000, title: "玩法二", state: "ready", coverState: "ready" },
  ]);
  assert.ok(loader.reads.every(({ address }) => address === 0x8000 || address >= 0x100000));
});

test("fast inventory discovers a variable number of plays from the partition table", async () => {
  const { loader, layout } = fixture();
  installFixture(loader, layout.slots[0], { generation: 1, title: "玩法一" });
  installFixture(loader, layout.slots[1], { generation: 2, title: "玩法二" });

  const inventory = await inspectDynamicLibraryFast(loader);
  assert.equal(inventory.slotCount, 2);
  assert.deepEqual(inventory.slots.map(({ title, state, activeSidecarBank }) => ({ title, state, activeSidecarBank })), [
    { title: "玩法一", state: "ready", activeSidecarBank: "a" },
    { title: "玩法二", state: "ready", activeSidecarBank: "b" },
  ]);
  assert.equal(inventory.slots[0].coverState, "ready");
  assert.equal(inventory.slots[0].trusted, true);
  assert.ok(loader.reads.every(({ length }) => length <= COVER_PAYLOAD_LENGTH));
});

test("a corrupt cover falls back without making the resident app untrusted", async () => {
  const { loader, layout } = fixture();
  installFixture(loader, layout.slots[0], { generation: 1, title: "玩法一", corruptCover: true });
  installFixture(loader, layout.slots[1], { generation: 2, title: "玩法二" });
  const inventory = await inspectDynamicLibraryFast(loader);
  assert.equal(inventory.slots[0].state, "ready");
  assert.equal(inventory.slots[0].trusted, true);
  assert.equal(inventory.slots[0].coverState, "corrupt");
  assert.equal(inventory.slots[0].coverPayload, null);
});

test("a partition committed without a matching sidecar is incomplete", async () => {
  const { loader, layout } = fixture();
  installFixture(loader, layout.slots[0], { generation: 1, title: "玩法一", omitRecord: true });
  installFixture(loader, layout.slots[1], { generation: 2, title: "玩法二" });
  const inventory = await inspectDynamicLibraryFast(loader);
  assert.equal(inventory.slots[0].state, "invalid");
  assert.match(inventory.slots[0].diagnostic, /sidecar/i);
});

test("invalid partition-table MD5 fails before any play scan", async () => {
  const { loader } = fixture();
  loader.flash[0x8000 + 16] ^= 1;
  await assert.rejects(inspectDynamicLibraryFast(loader), /MD5/);
  assert.deepEqual(loader.reads, [{ address: 0x8000, length: 0x1000 }]);
});

test("an empty dynamic table is a valid empty library", async () => {
  const loader = new FlashLoader();
  loader.flash.set(encodePartitionTable(dynamicPartitionEntries([])), 0x8000);
  const inventory = await inspectDynamicLibraryFast(loader);
  assert.equal(inventory.slotCount, 0);
  assert.deepEqual(inventory.slots, []);
  assert.ok(inventory.largestInstallableImage > 0x600000);
});

test("inventory follows logical ids when a new play reuses an earlier physical hole", async () => {
  const loader = new FlashLoader();
  const initial = planDynamicLibrary([0x40000, 0x90000, 0x50000]);
  const removed = removeDynamicSlot(initial.slots, 0);
  const reused = appendDynamicSlot(removed.slots, 0x20000);
  loader.flash.set(encodePartitionTable(dynamicPartitionEntries(reused.slots)), 0x8000);
  reused.slots.forEach((slot, index) => installFixture(loader, slot, {
    generation: index + 1,
    title: `逻辑玩法${index + 1}`,
  }));

  const inventory = await inspectDynamicLibraryFast(loader);
  assert.deepEqual(inventory.slots.map(({ slotId, offset, title }) => ({ slotId, offset, title })),
    reused.slots.map(({ slotId, offset }, index) => ({
      slotId,
      offset,
      title: `逻辑玩法${index + 1}`,
    })));
  assert.ok(inventory.slots[2].offset < inventory.slots[0].offset);
});
