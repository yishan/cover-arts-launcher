import { extractAppImage, parsePartitionTable, verifyEspImage } from "./extract-app-image.js";
import {
  DYNAMIC_LEGACY_LAYOUT, DYNAMIC_PLAY_ARENA_END, DYNAMIC_OTADATA_ADDRESS,
  dynamicPartitionEntries, parseDynamicPartitionEntries, requireDynamicLayout,
} from "./dynamic-layout.js";

export const COMPATIBLE_PARTITIONS = [
  { name: "nvs", type: 1, subtype: 2, offset: 0x9000, size: 0x6000 },
  { name: "phy_init", type: 1, subtype: 1, offset: 0xf000, size: 0x1000 },
  { name: "factory", type: 0, subtype: 0, offset: 0x10000, size: 0x170000 },
  { name: "ota_0", type: 0, subtype: 0x10, offset: 0x180000, size: 0x200000 },
  { name: "ota_1", type: 0, subtype: 0x11, offset: 0x380000, size: 0x200000 },
  { name: "ota_2", type: 0, subtype: 0x12, offset: 0x580000, size: 0x200000 },
  { name: "covers", type: 1, subtype: 0x40, offset: 0x780000, size: 0x7e000 },
  { name: "otadata", type: 1, subtype: 0, offset: 0x7fe000, size: 0x2000 },
];

export const DYNAMIC_EMPTY_PARTITIONS = dynamicPartitionEntries([]);

const LEGACY_PARTITIONS = [
  { name: "nvs", type: 1, subtype: 2, offset: 0x9000, size: 0x6000 },
  { name: "phy_init", type: 1, subtype: 1, offset: 0xf000, size: 0x1000 },
  { name: "factory", type: 0, subtype: 0, offset: 0x10000, size: 0x7f0000 },
];

export function systemEraseRanges(layout = DYNAMIC_LEGACY_LAYOUT) {
  layout = requireDynamicLayout(layout);
  return [
    { name: "dynamic_play_arena", address: layout.arenaStart,
      size: DYNAMIC_PLAY_ARENA_END - layout.arenaStart },
    { name: "otadata", address: DYNAMIC_OTADATA_ADDRESS, size: 0x2000 },
  ];
}

export const SYSTEM_ERASE_RANGES = systemEraseRanges();

/** Validate the incoming layout and Factory before any destructive operation. */
export async function prepareDynamicSystemImage(input) {
  const full = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (full.length < 0x11000 || full.length > 0x800000) {
    throw new Error("Complete Launcher image has an invalid length.");
  }
  const table = parsePartitionTable(full.subarray(0x8000, 0x9000));
  if (!table.md5Present || !table.md5Valid) throw new Error("Launcher partition MD5 is invalid.");
  const library = parseDynamicPartitionEntries(table.entries);
  if (library.slotCount !== 0) throw new Error("System initialization requires an empty play directory.");
  const factory = extractAppImage(full);
  if (factory.kind !== "merged" || factory.appOffset !== 0x10000 ||
      factory.length > library.layout.factorySize) {
    throw new Error("Factory Launcher does not fit the incoming layout.");
  }
  if (await verifyEspImage(factory.data) !== factory.length) {
    throw new Error("Factory Launcher image length is inconsistent.");
  }
  return { entries: table.entries, layout: library.layout, factory,
    eraseRanges: systemEraseRanges(library.layout) };
}

function sameEntry(left, right) {
  return left.name === right.name && left.type === right.type && left.subtype === right.subtype &&
    left.offset === right.offset && left.size === right.size;
}

function sameTable(actual, expected) {
  return actual.length === expected.length && expected.every((entry, index) => sameEntry(actual[index], entry));
}

export function classifySystemTarget({ chip, flashSize, partitionTableSector }) {
  if (chip !== "ESP32-C3" || flashSize !== 0x800000) return { kind: "unknown", canInstall: false };
  try {
    const table = parsePartitionTable(partitionTableSector);
    if (!table.md5Present || !table.md5Valid) return { kind: "unknown", canInstall: false };
    if (sameTable(table.entries, LEGACY_PARTITIONS)) return { kind: "single-factory", canInstall: true, partitions: table.entries };
    if (sameTable(table.entries, COMPATIBLE_PARTITIONS)) return { kind: "compatible-launcher", canInstall: true, partitions: table.entries };
    try {
      const library = parseDynamicPartitionEntries(table.entries);
      return { kind: "dynamic-launcher", canInstall: true, partitions: table.entries, library };
    } catch {
      // Not a v0.3 dynamic Launcher table.
    }
  } catch {
    // Fall through to a fail-closed result.
  }
  return { kind: "unknown", canInstall: false };
}

export function makeEraseVerificationSamples(range, sampleLength = 32) {
  if (sampleLength <= 0 || sampleLength * 2 > range.size) throw new Error("Invalid erase verification sample length.");
  return [
    { address: range.address, length: sampleLength },
    { address: range.address + range.size - sampleLength, length: sampleLength },
  ];
}

export function createSystemInstallSession(targetKind) {
  return {
    targetKind,
    phase: "warning",
    writeStarted: false,
    completed: false,
    resumeAllowed: false,
    restartFrom: null,
    error: null,
    completionActions: [],
  };
}

function recovery(session, error) {
  return {
    ...session, phase: "recovery-required", completed: false, resumeAllowed: false,
    restartFrom: "warning", error,
  };
}

export function reduceSystemInstall(session, event) {
  if (["completed", "cancelled", "recovery-required"].includes(session.phase)) return session;
  switch (event.type) {
    case "cancel":
      return { ...session, phase: "cancelled" };
    case "confirm-warning":
      return session.phase === "warning" ? { ...session, phase: "erasing", writeStarted: true } : session;
    case "erase-complete":
      return session.phase === "erasing" ? { ...session, phase: "writing" } : session;
    case "write-complete":
      return session.phase === "writing" ? { ...session, phase: "verifying-segments" } : session;
    case "segments-verified":
      return session.phase === "verifying-segments" ? { ...session, phase: "verifying-empty-state" } : session;
    case "empty-state-verified":
      if (session.phase !== "verifying-empty-state") return session;
      if (event.otaSelected || event.playCount !== 0) return recovery(session, "Installed system did not finish with an empty dynamic library and no selected OTA app.");
      return {
        ...session, phase: "completed", completed: true,
        completionActions: ["install-first-play", "finish-empty-library"],
      };
    case "disconnect":
      return recovery(session, "Device disconnected. Re-enter ROM download mode and restart the full installation.");
    case "write-failed":
    case "verification-failed":
      return recovery(session, event.error ?? "System installation failed.");
    default:
      return session;
  }
}
