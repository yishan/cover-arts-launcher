import { parsePartitionTable } from "./extract-app-image.js";

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

const LEGACY_PARTITIONS = [
  { name: "nvs", type: 1, subtype: 2, offset: 0x9000, size: 0x6000 },
  { name: "phy_init", type: 1, subtype: 1, offset: 0xf000, size: 0x1000 },
  { name: "factory", type: 0, subtype: 0, offset: 0x10000, size: 0x7f0000 },
];

export const SYSTEM_ERASE_RANGES = [
  { name: "ota_0", address: 0x180000, size: 0x200000 },
  { name: "ota_1", address: 0x380000, size: 0x200000 },
  { name: "ota_2", address: 0x580000, size: 0x200000 },
  { name: "cover_0a", address: 0x780000, size: 0x10000 },
  { name: "cover_0b", address: 0x790000, size: 0x10000 },
  { name: "cover_1a", address: 0x7a0000, size: 0x10000 },
  { name: "cover_1b", address: 0x7b0000, size: 0x10000 },
  { name: "cover_2a", address: 0x7c0000, size: 0x10000 },
  { name: "cover_2b", address: 0x7d0000, size: 0x10000 },
  { name: "trust_0", address: 0x7e0000, size: 0x2000 },
  { name: "trust_1", address: 0x7e2000, size: 0x2000 },
  { name: "trust_2", address: 0x7e4000, size: 0x2000 },
  { name: "otadata", address: 0x7fe000, size: 0x2000 },
];

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
      if (event.otaSelected || event.emptySlots !== 3) return recovery(session, "Installed system did not finish with three empty slots and no selected OTA app.");
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

export async function runSystemInstall({ targetKind, erase, write, verifySegments, verifyEmptyState }) {
  let session = createSystemInstallSession(targetKind);
  session = reduceSystemInstall(session, { type: "confirm-warning" });
  try {
    await erase();
    session = reduceSystemInstall(session, { type: "erase-complete" });
    await write();
    session = reduceSystemInstall(session, { type: "write-complete" });
    await verifySegments();
    session = reduceSystemInstall(session, { type: "segments-verified" });
    const emptyState = await verifyEmptyState();
    session = reduceSystemInstall(session, { type: "empty-state-verified", ...emptyState });
    if (session.phase !== "completed") throw new Error(session.error ?? "System installation verification failed.");
    return { session, error: null };
  } catch (error) {
    const eventType = session.phase.startsWith("verifying") ? "verification-failed" : "write-failed";
    session = reduceSystemInstall(session, { type: eventType, error: error.message });
    return { session, error };
  }
}
