import assert from "node:assert/strict";
import test from "node:test";

import {
  DYNAMIC_MAX_SLOTS,
  DYNAMIC_PLAY_ARENA_END,
  DYNAMIC_PLAY_ARENA_START,
  DYNAMIC_SLOT_ALIGNMENT,
  DYNAMIC_SLOT_SIDECAR_SIZE,
  appendDynamicSlot,
  createDynamicAppendSession,
  dynamicPartitionEntries,
  dynamicSlotAllocationSize,
  largestDynamicImage,
  planDynamicLibrary,
  reduceDynamicAppend,
  validateDynamicSlots,
} from "./dynamic-layout.js";

test("allocates each app by verified length plus one aligned sidecar", () => {
  assert.equal(dynamicSlotAllocationSize(700 * 1024), 0xc0000);
  const first = appendDynamicSlot([], 700 * 1024);
  assert.deepEqual(first.slot, {
    slotId: 0,
    label: "ota_0",
    type: 0,
    subtype: 0x10,
    offset: DYNAMIC_PLAY_ARENA_START,
    size: 0xc0000,
    imageLength: 700 * 1024,
    imageCapacity: 0xb0000,
    sidecarOffset: 0x230000,
    sidecarSize: DYNAMIC_SLOT_SIDECAR_SIZE,
  });
  assert.equal(first.nextOffset, 0x240000);
});

test("builds the standard partition entries around the dynamic play list", () => {
  const layout = planDynamicLibrary([700 * 1024, 0x100000]);
  assert.deepEqual(dynamicPartitionEntries(layout.slots).map(({ name, offset, size }) => ({ name, offset, size })), [
    { name: "nvs", offset: 0x9000, size: 0x6000 },
    { name: "phy_init", offset: 0xf000, size: 0x1000 },
    { name: "factory", offset: 0x10000, size: 0x170000 },
    { name: "ota_0", offset: 0x180000, size: 0xc0000 },
    { name: "ota_1", offset: 0x240000, size: 0x110000 },
    { name: "otadata", offset: 0x7fe000, size: 0x2000 },
  ]);
});

test("append transaction commits the partition table last and then clears otadata", () => {
  let session = createDynamicAppendSession([], 0x90000);
  for (const type of [
    "begin", "app-written", "app-verified", "sidecar-written",
    "sidecar-verified", "table-written", "table-verified", "otadata-cleared",
  ]) session = reduceDynamicAppend(session, { type });
  assert.equal(session.phase, "completed");
  assert.equal(session.committed, true);
  assert.equal(session.oldLibraryIntact, false);
});

test("failure before table commit preserves the old library description", () => {
  let session = createDynamicAppendSession([], 0x90000);
  session = reduceDynamicAppend(session, { type: "begin" });
  session = reduceDynamicAppend(session, { type: "app-written" });
  session = reduceDynamicAppend(session, { type: "failure", error: "readback mismatch" });
  assert.equal(session.phase, "failed");
  assert.equal(session.oldLibraryIntact, true);
  assert.equal(session.recoveryRequired, false);
});

test("failure once table commit starts requires ROM recovery", () => {
  let session = createDynamicAppendSession([], 0x90000);
  for (const type of ["begin", "app-written", "app-verified", "sidecar-written", "sidecar-verified"]) {
    session = reduceDynamicAppend(session, { type });
  }
  session = reduceDynamicAppend(session, { type: "failure", error: "power loss" });
  assert.equal(session.phase, "recovery-required");
  assert.equal(session.recoveryRequired, true);
  assert.equal(session.oldLibraryIntact, false);
});

test("appends multiple slots without pre-reserving 2 MiB for each play", () => {
  const layout = planDynamicLibrary([700 * 1024, 0x100000, 0x81000]);
  assert.deepEqual(layout.slots.map(({ offset, size }) => ({ offset, size })), [
    { offset: 0x180000, size: 0xc0000 },
    { offset: 0x240000, size: 0x110000 },
    { offset: 0x350000, size: 0xa0000 },
  ]);
  assert.equal(layout.nextOffset, 0x3f0000);
  assert.equal(layout.remainingBytes, DYNAMIC_PLAY_ARENA_END - 0x3f0000);
});

test("one play may consume the complete arena and then installation stops", () => {
  const maximumImage = DYNAMIC_PLAY_ARENA_END - DYNAMIC_PLAY_ARENA_START -
    DYNAMIC_SLOT_SIDECAR_SIZE;
  const layout = planDynamicLibrary([maximumImage]);
  assert.equal(layout.remainingBytes, 0);
  assert.equal(largestDynamicImage(layout.slots), 0);
  assert.throws(() => appendDynamicSlot(layout.slots, 1), /only 0x0 bytes remain/);
  assert.throws(() => planDynamicLibrary([maximumImage + 1]), /only 0x670000 bytes remain/);
});

test("the standard OTA subtype range caps the library at 16 plays", () => {
  const layout = planDynamicLibrary(Array(DYNAMIC_MAX_SLOTS).fill(1));
  assert.equal(layout.slots.length, 16);
  assert.equal(layout.slots.at(-1).subtype, 0x1f);
  assert.throws(() => appendDynamicSlot(layout.slots, 1), /limit of 16/);
});

test("rejects gaps, reordered identities, and sidecars outside the partition tail", () => {
  const { slots } = planDynamicLibrary([0x40000]);
  assert.throws(() => validateDynamicSlots([{ ...slots[0], offset: slots[0].offset + DYNAMIC_SLOT_ALIGNMENT }]), /offset/);
  assert.throws(() => validateDynamicSlots([{ ...slots[0], label: "ota_1" }]), /identity/);
  assert.throws(() => validateDynamicSlots([{ ...slots[0], sidecarOffset: slots[0].sidecarOffset - 1 }]), /sidecar/);
});

test("reports the largest next image separately from raw remaining bytes", () => {
  const { slots, remainingBytes } = planDynamicLibrary([0x100000]);
  assert.equal(largestDynamicImage(slots), remainingBytes - DYNAMIC_SLOT_SIDECAR_SIZE);
});
