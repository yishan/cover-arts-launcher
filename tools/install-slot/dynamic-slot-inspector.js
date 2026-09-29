import { COVER_PAYLOAD_LENGTH, crc32 } from "./cover-convert.js";
import {
  DYNAMIC_PLAY_ARENA_END,
  DYNAMIC_SLOT_SIDECAR_SIZE,
  parseDynamicPartitionEntries,
} from "./dynamic-layout.js";
import {
  DYNAMIC_SIDECAR_RECORD_SIZE,
  decodeDynamicSidecarRecord,
  dynamicCoverMatchesRecord,
  dynamicSidecarLayout,
  selectDynamicSidecarRecord,
} from "./dynamic-sidecar.js";
import {
  ESP32C3_CHIP_ID,
  ESP_IMAGE_MAGIC,
  parsePartitionTable,
} from "./extract-app-image.js";

const PARTITION_TABLE_ADDRESS = 0x8000;
const PARTITION_TABLE_SIZE = 0x1000;

function asBytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function allErased(bytes) {
  return bytes.every((value) => value === 0xff);
}

function u16le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

async function readExact(loader, address, length, label) {
  const bytes = asBytes(await loader.readFlash(address, length));
  if (bytes.length !== length) throw new Error(`${label} short read: expected ${length}, got ${bytes.length}.`);
  return bytes;
}

function headerDiagnostic(header) {
  if (allErased(header)) return "App header is erased.";
  if (header[0] !== ESP_IMAGE_MAGIC) return "App image magic is invalid.";
  if (header[1] < 1 || header[1] > 16) return "App segment count is invalid.";
  if (u16le(header, 12) !== ESP32C3_CHIP_ID) return "App image is not for ESP32-C3.";
  return null;
}

async function readRecord(loader, address, bank) {
  return {
    bank,
    record: decodeDynamicSidecarRecord(await readExact(
      loader, address, DYNAMIC_SIDECAR_RECORD_SIZE, `Sidecar bank ${bank.toUpperCase()}`,
    )),
  };
}

async function inspectPartitionFast(loader, partition) {
  const header = await readExact(loader, partition.offset, 24, `Position ${partition.slotId + 1} header`);
  const diagnostic = headerDiagnostic(header);
  if (diagnostic) {
    return {
      ...partition,
      state: "invalid",
      trusted: false,
      title: "",
      sourceId: "",
      version: "",
      coverPayload: null,
      coverState: "placeholder",
      diagnostic,
    };
  }

  const sidecar = dynamicSidecarLayout(partition);
  const records = await Promise.all([
    readRecord(loader, sidecar.bankA.address, "a"),
    readRecord(loader, sidecar.bankB.address, "b"),
  ]);
  const selected = selectDynamicSidecarRecord({
    slotId: partition.slotId,
    partitionSize: partition.size,
    records,
  });
  if (!selected) {
    return {
      ...partition,
      state: "invalid",
      trusted: false,
      title: "",
      sourceId: "",
      version: "",
      coverPayload: null,
      coverState: "placeholder",
      diagnostic: "No valid dynamic sidecar record matches this partition.",
    };
  }

  const record = selected.record;
  let coverPayload = null;
  let coverState = "placeholder";
  if (record.coverPresent) {
    const payload = await readExact(loader, sidecar.payload.address, COVER_PAYLOAD_LENGTH, `Position ${partition.slotId + 1} cover`);
    if (dynamicCoverMatchesRecord(record, payload)) {
      coverPayload = payload;
      coverState = "ready";
    } else {
      coverState = "corrupt";
    }
  }

  return {
    ...partition,
    state: "ready",
    trusted: true,
    trustSource: "dynamic-sidecar",
    activeSidecarBank: selected.bank,
    generation: record.generation,
    title: record.title,
    sourceId: record.sourceId,
    version: record.version,
    sourceKind: record.sourceKind,
    imageLength: record.imageLength,
    appShaBytes: record.firmwareSha256,
    firstInstalledAt: record.firstInstalledAt,
    lastInstalledAt: record.lastInstalledAt,
    firstUtcOffsetMinutes: record.firstUtcOffsetMinutes,
    lastUtcOffsetMinutes: record.lastUtcOffsetMinutes,
    coverPayload,
    coverState,
    fastInspection: true,
  };
}

export async function inspectDynamicLibraryFast(loader, partitionTableSector = null) {
  if (!loader || typeof loader.readFlash !== "function") throw new Error("A connected flash loader is required.");
  const sector = partitionTableSector === null
    ? await readExact(loader, PARTITION_TABLE_ADDRESS, PARTITION_TABLE_SIZE, "Partition table")
    : asBytes(partitionTableSector);
  const table = parsePartitionTable(sector);
  if (!table.md5Present || !table.md5Valid) throw new Error("Dynamic partition table MD5 is missing or invalid.");
  const layout = parseDynamicPartitionEntries(table.entries);
  const slots = [];
  for (const partition of layout.slots) slots.push(await inspectPartitionFast(loader, partition));
  return {
    kind: "dynamic-launcher",
    slots,
    slotCount: slots.length,
    nextOffset: layout.nextOffset,
    remainingBytes: layout.remainingBytes,
    largestInstallableImage: layout.remainingBytes > DYNAMIC_SLOT_SIDECAR_SIZE
      ? layout.remainingBytes - DYNAMIC_SLOT_SIDECAR_SIZE
      : 0,
    arenaEnd: DYNAMIC_PLAY_ARENA_END,
  };
}

export function dynamicCoverPayloadCrc(payload) {
  return crc32(payload);
}
