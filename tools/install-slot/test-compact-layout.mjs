import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DYNAMIC_COMPACT_LAYOUT, DYNAMIC_LEGACY_LAYOUT, appendDynamicSlot,
  dynamicPartitionEntries, largestDynamicImage, parseDynamicPartitionEntries,
  planDynamicLibrary, removeDynamicSlot, requireDynamicLayout, validateDynamicSlots,
} from "./dynamic-layout.js";
import { inspectDynamicLibraryFast } from "./dynamic-slot-inspector.js";
import { encodePartitionTable, MAX_APP_IMAGE_SIZE } from "./extract-app-image.js";
import { classifySystemTarget, prepareDynamicSystemImage, systemEraseRanges } from "./system-install.js";

function systemImage(layout, appLength = 0x1000, slots = []) {
  // One checked segment, aligned checksum, no appended SHA. The full-image
  // published SHA is validated separately by the UI before this helper runs.
  const app = new Uint8Array(appLength);
  app[0] = 0xe9;
  app[1] = 1;
  app[12] = 5;
  new DataView(app.buffer).setUint32(28, appLength - 33, true);
  app[appLength - 1] = 0xef;
  const full = new Uint8Array(0x10000 + appLength).fill(0xff);
  full.set(encodePartitionTable(dynamicPartitionEntries(slots, layout)), 0x8000);
  full.set(app, 0x10000);
  return full;
}

test("compact arena releases exactly 512 KiB without moving NVS or OTA data", () => {
  const legacy = parseDynamicPartitionEntries(dynamicPartitionEntries([]));
  const compact = parseDynamicPartitionEntries(dynamicPartitionEntries([], DYNAMIC_COMPACT_LAYOUT));
  assert.equal(legacy.arenaBytes, 6.4375 * 1024 * 1024);
  assert.equal(compact.arenaBytes, 6.9375 * 1024 * 1024);
  assert.equal(compact.arenaBytes - legacy.arenaBytes, 512 * 1024);
  assert.equal(compact.arenaStart, 0x100000);
  assert.deepEqual(dynamicPartitionEntries([], DYNAMIC_COMPACT_LAYOUT).filter((entry) => entry.name !== "factory"),
    dynamicPartitionEntries([]).filter((entry) => entry.name !== "factory"));
  assert.equal(largestDynamicImage([], DYNAMIC_COMPACT_LAYOUT), MAX_APP_IMAGE_SIZE);
});

for (const layout of [DYNAMIC_LEGACY_LAYOUT, DYNAMIC_COMPACT_LAYOUT]) {
  test(`${layout.id}: allocation, arbitrary deletion and hole reuse preserve the Factory`, () => {
    const initial = planDynamicLibrary([0x40000, 0x90000, 0x50000], layout);
    assert.equal(initial.slots[0].offset, layout.arenaStart);
    const removed = removeDynamicSlot(initial.slots, 1, layout);
    assert.equal(removed.slots[1].offset, initial.slots[2].offset);
    const reused = appendDynamicSlot(removed.slots, 0x70000, layout);
    assert.equal(reused.slot.offset, initial.slots[1].offset);
    const parsed = parseDynamicPartitionEntries(dynamicPartitionEntries(reused.slots, layout));
    assert.deepEqual(parsed.layout, layout);
    assert.equal(parsed.remainingBytes, reused.remainingBytes);
    assert.equal(dynamicPartitionEntries(reused.slots, layout)[2].size, layout.factorySize);
    // Even an empty directory retains its actual layout when the last play is removed.
    const lastRemoved = removeDynamicSlot(appendDynamicSlot([], 1, layout).slots, 0, layout);
    assert.equal(lastRemoved.remainingBytes, 0x7f0000 - layout.arenaStart);
  });

  test(`${layout.id}: full arena, final byte and 16-slot boundary are enforced`, () => {
    const maximum = largestDynamicImage([], layout);
    const full = appendDynamicSlot([], maximum, layout);
    assert.equal(full.remainingBytes, 0);
    assert.equal(full.slot.offset + full.slot.size, 0x7f0000);
    assert.throws(() => appendDynamicSlot([], maximum + 1, layout), /contiguous bytes/);
    assert.throws(() => appendDynamicSlot(full.slots, 1, layout), /contiguous bytes/);
    const sixteen = planDynamicLibrary(Array(16).fill(1), layout);
    assert.throws(() => appendDynamicSlot(sixteen.slots, 1, layout), /limit of 16/);
  });

  test(`${layout.id}: device classification and inventory carry the actual boundary`, async () => {
    const sector = encodePartitionTable(dynamicPartitionEntries([], layout));
    const target = classifySystemTarget({ chip: "ESP32-C3", flashSize: 0x800000, partitionTableSector: sector });
    assert.equal(target.kind, "dynamic-launcher");
    assert.deepEqual(target.library.layout, layout);
    const inventory = await inspectDynamicLibraryFast({ readFlash() { throw new Error("Empty scan must not read apps."); } }, sector);
    assert.deepEqual(inventory.layout, layout);
    assert.equal(inventory.arenaStart, layout.arenaStart);
    assert.equal(inventory.remainingBytes, 0x7f0000 - layout.arenaStart);
  });

  test(`${layout.id}: initialization validates Factory and clears the incoming arena`, async () => {
    const prepared = await prepareDynamicSystemImage(systemImage(layout));
    assert.deepEqual(prepared.layout, layout);
    assert.deepEqual(prepared.eraseRanges, systemEraseRanges(layout));
    assert.equal(prepared.eraseRanges[0].address, 0x10000 + layout.factorySize);
    assert.equal(prepared.eraseRanges[0].address + prepared.eraseRanges[0].size, 0x7f0000);
    assert.deepEqual(prepared.eraseRanges[1], { name: "otadata", address: 0x7fe000, size: 0x2000 });
  });
}

test("legacy table cannot claim the extra prefix or silently change Factory size", () => {
  const compactSlots = appendDynamicSlot([], 1, DYNAMIC_COMPACT_LAYOUT).slots;
  assert.throws(() => validateDynamicSlots(compactSlots), /offset/);
  assert.throws(() => dynamicPartitionEntries(compactSlots), /offset/);
  const entries = dynamicPartitionEntries(compactSlots, DYNAMIC_COMPACT_LAYOUT);
  entries[2].size = DYNAMIC_LEGACY_LAYOUT.factorySize;
  assert.throws(() => parseDynamicPartitionEntries(entries), /boundary/);
  assert.throws(() => requireDynamicLayout({ ...DYNAMIC_COMPACT_LAYOUT, arenaStart: 0xf0000 }), /Unknown/);
  assert.throws(() => requireDynamicLayout(null), /Unknown/);
});

test("unsupported Factory boundaries and foreign data partitions fail closed", () => {
  const entries = dynamicPartitionEntries([], DYNAMIC_COMPACT_LAYOUT);
  for (const size of [0, 0xe0000, 0x100000, 0x7f0000]) {
    assert.throws(() => parseDynamicPartitionEntries(entries.map((entry) =>
      entry.name === "factory" ? { ...entry, size } : entry)), /Factory/);
  }
  const unknown = [...entries.slice(0, -1),
    { name: "identity", type: 1, subtype: 0x40, offset: 0x700000, size: 0x1000 }, entries.at(-1)];
  const target = classifySystemTarget({ chip: "ESP32-C3", flashSize: 0x800000,
    partitionTableSector: encodePartitionTable(unknown) });
  assert.equal(target.canInstall, false);
});

test("retained physical allocations are never moved just because layout is compact", () => {
  const original = planDynamicLibrary([0x40000, 0x90000]);
  const compact = parseDynamicPartitionEntries(dynamicPartitionEntries(original.slots, DYNAMIC_COMPACT_LAYOUT));
  assert.deepEqual(compact.slots.map(({ offset, size }) => ({ offset, size })),
    original.slots.map(({ offset, size }) => ({ offset, size })));
  const next = appendDynamicSlot(original.slots, 0x40000, DYNAMIC_COMPACT_LAYOUT);
  assert.equal(next.slot.offset, 0x100000);
});

test("oversized Factory, invalid MD5, corrupt app and populated system image are rejected before erase", async () => {
  await assert.rejects(prepareDynamicSystemImage(systemImage(DYNAMIC_COMPACT_LAYOUT, 0xf0010)), /does not fit/);
  const checksum = systemImage(DYNAMIC_COMPACT_LAYOUT);
  checksum[checksum.length - 1] ^= 1;
  await assert.rejects(prepareDynamicSystemImage(checksum), /checksum/);
  const md5 = systemImage(DYNAMIC_COMPACT_LAYOUT);
  md5[0x8008] ^= 1;
  await assert.rejects(prepareDynamicSystemImage(md5), /MD5/);
  const slots = appendDynamicSlot([], 1, DYNAMIC_COMPACT_LAYOUT).slots;
  await assert.rejects(prepareDynamicSystemImage(systemImage(DYNAMIC_COMPACT_LAYOUT, 0x1000, slots)), /empty/);
  await assert.rejects(prepareDynamicSystemImage(new Uint8Array(0x800001)), /length/);
});

test("UI threads inspected layout through install, deletion and table commit", async () => {
  const source = await readFile(new URL("./app.js", import.meta.url), "utf8");
  assert.match(source, /appendDynamicSlot\(state\.slots, state\.preparedPlay\.app\.length, state\.library\.layout\)/);
  assert.match(source, /removeDynamicSlot\(state\.slots, slotId, state\.library\.layout\)/);
  assert.match(source, /dynamicPartitionEntries\(slots, state\.library\.layout\)/);
  assert.match(source, /prepareDynamicSystemImage\(full\)/);
  assert.doesNotMatch(source, /for \(const range of SYSTEM_ERASE_RANGES\)/);
  assert.match(source, /samePartitionTable\(targetTable\.entries, systemImage\.entries\)/);
});
