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
  parseDynamicPartitionEntries,
  planDynamicLibrary,
  reduceDynamicAppend,
  removeDynamicSlot,
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

test("failure while writing the table requires ROM recovery", () => {
  let session = createDynamicAppendSession([], 0x90000);
  for (const type of ["begin", "app-written", "app-verified", "sidecar-written", "sidecar-verified"]) {
    session = reduceDynamicAppend(session, { type });
  }
  session = reduceDynamicAppend(session, { type: "failure", error: "power loss" });
  assert.equal(session.phase, "recovery-required");
  assert.equal(session.recoveryRequired, true);
  assert.equal(session.oldLibraryIntact, false);
});

test("failure after the table write asks for reconnect verification first", () => {
  let session = createDynamicAppendSession([], 0x90000);
  for (const type of [
    "begin", "app-written", "app-verified", "sidecar-written",
    "sidecar-verified", "table-written",
  ]) session = reduceDynamicAppend(session, { type });
  session = reduceDynamicAppend(session, { type: "failure", error: "serial lock" });
  assert.equal(session.phase, "verification-required");
  assert.equal(session.recoveryRequired, false);
  assert.equal(session.verificationRequired, true);
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
  assert.throws(() => appendDynamicSlot(layout.slots, 1), /0x0 contiguous bytes/);
  assert.throws(() => planDynamicLibrary([maximumImage + 1]), /0x670000 contiguous bytes/);
});

test("the standard OTA subtype range caps the library at 16 plays", () => {
  const layout = planDynamicLibrary(Array(DYNAMIC_MAX_SLOTS).fill(1));
  assert.equal(layout.slots.length, 16);
  assert.equal(layout.slots.at(-1).subtype, 0x1f);
  assert.throws(() => appendDynamicSlot(layout.slots, 1), /limit of 16/);
});

test("accepts reusable gaps but rejects reordered identities, overlap, and invalid sidecars", () => {
  const { slots } = planDynamicLibrary([0x40000]);
  const moved = [{
    ...slots[0],
    offset: slots[0].offset + DYNAMIC_SLOT_ALIGNMENT,
    sidecarOffset: slots[0].sidecarOffset + DYNAMIC_SLOT_ALIGNMENT,
  }];
  assert.equal(validateDynamicSlots(moved).remainingBytes,
    DYNAMIC_PLAY_ARENA_END - DYNAMIC_PLAY_ARENA_START - moved[0].size);
  assert.throws(() => validateDynamicSlots([{ ...slots[0], label: "ota_1" }]), /identity/);
  assert.throws(() => validateDynamicSlots([{ ...slots[0], sidecarOffset: slots[0].sidecarOffset - 1 }]), /sidecar/);
  assert.throws(() => validateDynamicSlots([
    slots[0],
    { ...slots[0], slotId: 1, label: "ota_1", subtype: 0x11 },
  ]), /overlap/);
});

test("reports the largest next image separately from raw remaining bytes", () => {
  const { slots, remainingBytes } = planDynamicLibrary([0x100000]);
  assert.equal(largestDynamicImage(slots), remainingBytes - DYNAMIC_SLOT_SIDECAR_SIZE);
});

test("removing a middle play compacts logical ids without moving physical apps", () => {
  const layout = planDynamicLibrary([0x40000, 0x90000, 0x50000]);
  const result = removeDynamicSlot(layout.slots, 1);
  assert.equal(result.removedSlot.slotId, 1);
  assert.deepEqual(result.slots.map(({ slotId, previousSlotId, label, subtype, offset }) => ({
    slotId, previousSlotId, label, subtype, offset,
  })), [
    { slotId: 0, previousSlotId: 0, label: "ota_0", subtype: 0x10, offset: 0x180000 },
    { slotId: 1, previousSlotId: 2, label: "ota_1", subtype: 0x11, offset: 0x270000 },
  ]);
  assert.equal(result.moves.length, 1);
  assert.equal(result.remainingBytes, layout.remainingBytes + result.removedSlot.size);
});

test("append reuses the smallest fitting hole before extending the physical tail", () => {
  const layout = planDynamicLibrary([0x40000, 0x90000, 0x50000]);
  const removed = removeDynamicSlot(layout.slots, 1);
  const reused = appendDynamicSlot(removed.slots, 0x70000);
  assert.equal(reused.slot.slotId, 2);
  assert.equal(reused.slot.offset, layout.slots[1].offset);
  assert.equal(reused.slot.size, 0x80000);

  const appended = appendDynamicSlot(removed.slots, 0xa0000);
  assert.equal(appended.slot.offset, 0x2d0000);
});

test("partition tables preserve logical order when physical offsets are reordered", () => {
  const layout = planDynamicLibrary([0x40000, 0x90000, 0x50000]);
  const removed = removeDynamicSlot(layout.slots, 0);
  const reused = appendDynamicSlot(removed.slots, 0x20000);
  assert.ok(reused.slots[2].offset < reused.slots[0].offset);
  const parsed = parseDynamicPartitionEntries(dynamicPartitionEntries(reused.slots));
  assert.deepEqual(parsed.slots.map(({ slotId, offset }) => ({ slotId, offset })),
    reused.slots.map(({ slotId, offset }) => ({ slotId, offset })));
});

test("fragmented free space reports the largest contiguous allocation", () => {
  const layout = planDynamicLibrary([0x180000, 0x180000, 0x180000]);
  const removed = removeDynamicSlot(layout.slots, 1);
  const state = validateDynamicSlots(removed.slots);
  assert.ok(state.remainingBytes > state.largestFreeRange.size);
  assert.throws(() => appendDynamicSlot(removed.slots, 0x200000), /contiguous bytes/);
});
