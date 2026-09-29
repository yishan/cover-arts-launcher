export const DYNAMIC_SLOT_ALIGNMENT = 0x10000;
export const DYNAMIC_SLOT_SIDECAR_SIZE = 0x10000;
export const DYNAMIC_PLAY_ARENA_START = 0x180000;
export const DYNAMIC_PLAY_ARENA_END = 0x7f0000;
export const DYNAMIC_OTADATA_ADDRESS = 0x7fe000;
export const DYNAMIC_MAX_SLOTS = 16;

export const DYNAMIC_SYSTEM_PARTITIONS = Object.freeze([
  Object.freeze({ name: "nvs", type: 1, subtype: 2, offset: 0x9000, size: 0x6000 }),
  Object.freeze({ name: "phy_init", type: 1, subtype: 1, offset: 0xf000, size: 0x1000 }),
  Object.freeze({ name: "factory", type: 0, subtype: 0, offset: 0x10000, size: 0x170000 }),
]);

function requireInteger(value, name) {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer.`);
  return value;
}

export function alignDynamicSlotSize(value) {
  requireInteger(value, "Slot size");
  if (value <= 0) throw new Error("Slot size must be positive.");
  return Math.ceil(value / DYNAMIC_SLOT_ALIGNMENT) * DYNAMIC_SLOT_ALIGNMENT;
}

export function dynamicSlotAllocationSize(imageLength) {
  requireInteger(imageLength, "App image length");
  if (imageLength <= 0) throw new Error("App image length must be positive.");
  return alignDynamicSlotSize(imageLength) + DYNAMIC_SLOT_SIDECAR_SIZE;
}

export function validateDynamicSlots(slots) {
  if (!Array.isArray(slots)) throw new Error("Dynamic slots must be an array.");
  if (slots.length > DYNAMIC_MAX_SLOTS) throw new Error("Dynamic layout exceeds 16 OTA slots.");

  let cursor = DYNAMIC_PLAY_ARENA_START;
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];
    if (!slot || slot.slotId !== index || slot.label !== `ota_${index}` ||
        slot.subtype !== 0x10 + index) {
      throw new Error(`Dynamic slot ${index + 1} identity is not contiguous.`);
    }
    if (slot.offset !== cursor || slot.offset % DYNAMIC_SLOT_ALIGNMENT !== 0) {
      throw new Error(`Dynamic slot ${index + 1} offset is not append-only aligned.`);
    }
    if (!Number.isSafeInteger(slot.imageLength) || slot.imageLength <= 0 ||
        slot.size !== dynamicSlotAllocationSize(slot.imageLength)) {
      throw new Error(`Dynamic slot ${index + 1} size does not match its app image.`);
    }
    if (slot.sidecarOffset !== slot.offset + slot.size - DYNAMIC_SLOT_SIDECAR_SIZE) {
      throw new Error(`Dynamic slot ${index + 1} sidecar is not at the partition tail.`);
    }
    cursor += slot.size;
    if (cursor > DYNAMIC_PLAY_ARENA_END) throw new Error("Dynamic slots exceed the play arena.");
  }
  return {
    nextOffset: cursor,
    remainingBytes: DYNAMIC_PLAY_ARENA_END - cursor,
    slotCount: slots.length,
  };
}

export function appendDynamicSlot(slots, imageLength) {
  const state = validateDynamicSlots(slots);
  if (slots.length >= DYNAMIC_MAX_SLOTS) {
    throw new Error("The ESP-IDF OTA slot limit of 16 has been reached.");
  }

  const size = dynamicSlotAllocationSize(imageLength);
  if (size > state.remainingBytes) {
    throw new Error(
      `App needs 0x${size.toString(16)} bytes including its sidecar, but only ` +
      `0x${state.remainingBytes.toString(16)} bytes remain.`,
    );
  }

  const slotId = slots.length;
  const slot = {
    slotId,
    label: `ota_${slotId}`,
    type: 0,
    subtype: 0x10 + slotId,
    offset: state.nextOffset,
    size,
    imageLength,
    imageCapacity: size - DYNAMIC_SLOT_SIDECAR_SIZE,
    sidecarOffset: state.nextOffset + size - DYNAMIC_SLOT_SIDECAR_SIZE,
    sidecarSize: DYNAMIC_SLOT_SIDECAR_SIZE,
  };
  const nextSlots = [...slots, slot];
  const nextState = validateDynamicSlots(nextSlots);
  return { slot, slots: nextSlots, ...nextState };
}

export function planDynamicLibrary(imageLengths) {
  if (!Array.isArray(imageLengths)) throw new Error("App image lengths must be an array.");
  let slots = [];
  let result = validateDynamicSlots(slots);
  for (const imageLength of imageLengths) {
    result = appendDynamicSlot(slots, imageLength);
    slots = result.slots;
  }
  return { slots, nextOffset: result.nextOffset, remainingBytes: result.remainingBytes };
}

export function largestDynamicImage(slots) {
  const { remainingBytes } = validateDynamicSlots(slots);
  return remainingBytes > DYNAMIC_SLOT_SIDECAR_SIZE
    ? remainingBytes - DYNAMIC_SLOT_SIDECAR_SIZE
    : 0;
}

export function dynamicPartitionEntries(slots) {
  validateDynamicSlots(slots);
  return [
    ...DYNAMIC_SYSTEM_PARTITIONS.map((entry) => ({ ...entry })),
    ...slots.map(({ label: name, type, subtype, offset, size }) => ({
      name, type, subtype, offset, size,
    })),
    {
      name: "otadata",
      type: 1,
      subtype: 0,
      offset: DYNAMIC_OTADATA_ADDRESS,
      size: 0x2000,
    },
  ];
}

function samePartition(left, right) {
  return left?.name === right.name && left.type === right.type &&
    left.subtype === right.subtype && left.offset === right.offset &&
    left.size === right.size;
}

export function parseDynamicPartitionEntries(entries) {
  if (!Array.isArray(entries)) throw new Error("Partition entries must be an array.");
  if (entries.length < DYNAMIC_SYSTEM_PARTITIONS.length + 1) {
    throw new Error("Dynamic partition table is incomplete.");
  }
  for (let index = 0; index < DYNAMIC_SYSTEM_PARTITIONS.length; index++) {
    if (!samePartition(entries[index], DYNAMIC_SYSTEM_PARTITIONS[index])) {
      throw new Error(`Dynamic system partition ${index + 1} does not match the v0.3 contract.`);
    }
  }
  const otadata = entries.at(-1);
  if (!samePartition(otadata, {
    name: "otadata", type: 1, subtype: 0,
    offset: DYNAMIC_OTADATA_ADDRESS, size: 0x2000,
  })) throw new Error("Dynamic otadata partition does not match the v0.3 contract.");

  const appEntries = entries.slice(DYNAMIC_SYSTEM_PARTITIONS.length, -1);
  if (appEntries.length > DYNAMIC_MAX_SLOTS) throw new Error("Dynamic layout exceeds 16 OTA slots.");
  let cursor = DYNAMIC_PLAY_ARENA_START;
  const slots = appEntries.map((entry, slotId) => {
    if (entry.name !== `ota_${slotId}` || entry.type !== 0 ||
        entry.subtype !== 0x10 + slotId) {
      throw new Error(`Dynamic partition position ${slotId + 1} is not contiguous.`);
    }
    if (entry.offset !== cursor || entry.offset % DYNAMIC_SLOT_ALIGNMENT !== 0 ||
        entry.size < DYNAMIC_SLOT_ALIGNMENT * 2 ||
        entry.size % DYNAMIC_SLOT_ALIGNMENT !== 0) {
      throw new Error(`Dynamic partition ${entry.name} has an invalid boundary.`);
    }
    cursor += entry.size;
    if (cursor > DYNAMIC_PLAY_ARENA_END) throw new Error("Dynamic partitions exceed the play arena.");
    return {
      slotId,
      label: entry.name,
      type: entry.type,
      subtype: entry.subtype,
      offset: entry.offset,
      size: entry.size,
      imageCapacity: entry.size - DYNAMIC_SLOT_SIDECAR_SIZE,
      sidecarOffset: entry.offset + entry.size - DYNAMIC_SLOT_SIDECAR_SIZE,
      sidecarSize: DYNAMIC_SLOT_SIDECAR_SIZE,
    };
  });
  return {
    slots,
    nextOffset: cursor,
    remainingBytes: DYNAMIC_PLAY_ARENA_END - cursor,
  };
}

export function createDynamicAppendSession(slots, imageLength) {
  const plan = appendDynamicSlot(slots, imageLength);
  return {
    phase: "planned",
    committed: false,
    recoveryRequired: false,
    oldLibraryIntact: true,
    plan,
    error: null,
  };
}

export function reduceDynamicAppend(session, event) {
  if (!session || !event || ["completed", "failed", "recovery-required"].includes(session?.phase)) {
    return session;
  }
  const transitions = {
    planned: ["begin", "writing-app"],
    "writing-app": ["app-written", "verifying-app"],
    "verifying-app": ["app-verified", "writing-sidecar"],
    "writing-sidecar": ["sidecar-written", "verifying-sidecar"],
    "verifying-sidecar": ["sidecar-verified", "writing-table"],
    "writing-table": ["table-written", "verifying-table"],
    "verifying-table": ["table-verified", "clearing-otadata"],
    "clearing-otadata": ["otadata-cleared", "completed"],
  };
  const transition = transitions[session.phase];
  if (transition && event.type === transition[0]) {
    const phase = transition[1];
    const committed = session.committed || event.type === "table-written";
    return {
      ...session,
      phase,
      committed,
      oldLibraryIntact: !committed,
    };
  }
  if (event.type === "failure") {
    const tableCommitStarted = ["writing-table", "verifying-table", "clearing-otadata"].includes(session.phase);
    return {
      ...session,
      phase: tableCommitStarted ? "recovery-required" : "failed",
      recoveryRequired: tableCommitStarted,
      oldLibraryIntact: !tableCommitStarted,
      error: event.error ?? "Dynamic append failed.",
    };
  }
  return session;
}
