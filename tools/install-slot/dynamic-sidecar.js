import {
  COVER_HEIGHT,
  COVER_PAYLOAD_LENGTH,
  COVER_WIDTH,
  crc32,
} from "./cover-convert.js";
import {
  DYNAMIC_MAX_SLOTS,
  DYNAMIC_SLOT_SIDECAR_SIZE,
  dynamicSlotAllocationSize,
} from "./dynamic-layout.js";

export const DYNAMIC_SIDECAR_MAGIC = "DPS1";
export const DYNAMIC_SIDECAR_SCHEMA = 1;
export const DYNAMIC_SIDECAR_RECORD_SIZE = 512;
export const DYNAMIC_SIDECAR_PAYLOAD_OFFSET = 0x0000;
export const DYNAMIC_SIDECAR_BANK_A_OFFSET = 0xa000;
export const DYNAMIC_SIDECAR_BANK_B_OFFSET = 0xb000;
export const DYNAMIC_SIDECAR_BANK_SIZE = 0x1000;

const TITLE_OFFSET = 84;
const TITLE_SIZE = 65;
const SOURCE_ID_OFFSET = 149;
const SOURCE_ID_SIZE = 49;
const VERSION_OFFSET = 198;
const VERSION_SIZE = 25;
const RESERVED_OFFSET = 223;
const CRC_OFFSET = DYNAMIC_SIDECAR_RECORD_SIZE - 4;
const SOURCE_KINDS = { local: 0, "play-api": 1 };
const SOURCE_KIND_NAMES = ["local", "play-api"];
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function asBytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function writeU16(bytes, offset, value) { view(bytes).setUint16(offset, value, true); }
function writeI16(bytes, offset, value) { view(bytes).setInt16(offset, value, true); }
function writeU32(bytes, offset, value) { view(bytes).setUint32(offset, value >>> 0, true); }
function writeU64(bytes, offset, value) { view(bytes).setBigUint64(offset, BigInt(value), true); }
function readU16(bytes, offset) { return view(bytes).getUint16(offset, true); }
function readI16(bytes, offset) { return view(bytes).getInt16(offset, true); }
function readU32(bytes, offset) { return view(bytes).getUint32(offset, true); }
function readU64(bytes, offset) {
  const value = view(bytes).getBigUint64(offset, true);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function encodeField(bytes, offset, size, value, name, required = false) {
  if (typeof value !== "string" || value.includes("\0")) throw new Error(`Invalid ${name}.`);
  const encoded = encoder.encode(value);
  if ((required && encoded.length === 0) || encoded.length >= size) throw new Error(`${name} is missing or too long.`);
  bytes.set(encoded, offset);
}

function decodeField(bytes, offset, size) {
  const field = bytes.subarray(offset, offset + size);
  const end = field.indexOf(0);
  if (end < 0 || !field.subarray(end).every((value) => value === 0)) return null;
  try {
    return decoder.decode(field.subarray(0, end));
  } catch {
    return null;
  }
}

function validTimePair(firstInstalledAt, lastInstalledAt, firstUtcOffsetMinutes, lastUtcOffsetMinutes) {
  return Number.isSafeInteger(firstInstalledAt) && Number.isSafeInteger(lastInstalledAt) &&
    firstInstalledAt >= 0 && lastInstalledAt >= firstInstalledAt &&
    (firstInstalledAt !== 0 || lastInstalledAt === 0) &&
    Number.isInteger(firstUtcOffsetMinutes) && firstUtcOffsetMinutes >= -840 && firstUtcOffsetMinutes <= 840 &&
    Number.isInteger(lastUtcOffsetMinutes) && lastUtcOffsetMinutes >= -840 && lastUtcOffsetMinutes <= 840;
}

export function dynamicSidecarLayout(partition) {
  if (!partition || !Number.isSafeInteger(partition.offset) ||
      !Number.isSafeInteger(partition.size) || partition.size < DYNAMIC_SLOT_SIDECAR_SIZE) {
    throw new Error("Dynamic partition is too small for a sidecar.");
  }
  const base = partition.offset + partition.size - DYNAMIC_SLOT_SIDECAR_SIZE;
  return {
    base,
    payload: { address: base + DYNAMIC_SIDECAR_PAYLOAD_OFFSET, size: COVER_PAYLOAD_LENGTH },
    bankA: { address: base + DYNAMIC_SIDECAR_BANK_A_OFFSET, size: DYNAMIC_SIDECAR_BANK_SIZE },
    bankB: { address: base + DYNAMIC_SIDECAR_BANK_B_OFFSET, size: DYNAMIC_SIDECAR_BANK_SIZE },
  };
}

export function encodeDynamicSidecarRecord({
  generation,
  slotId,
  sourceKind,
  title,
  sourceId = "",
  version = "",
  imageLength,
  firmwareSha256,
  coverPayload = null,
  firstInstalledAt = 0,
  lastInstalledAt = 0,
  firstUtcOffsetMinutes = 0,
  lastUtcOffsetMinutes = 0,
}) {
  if (!Number.isInteger(generation) || generation < 0) throw new Error("Invalid sidecar generation.");
  if (!Number.isInteger(slotId) || slotId < 0 || slotId >= DYNAMIC_MAX_SLOTS) throw new Error("Invalid dynamic slot id.");
  if (!(sourceKind in SOURCE_KINDS)) throw new Error("Invalid source kind.");
  if (sourceKind === "play-api" && !sourceId) throw new Error("Play API source id is required.");
  if (!Number.isSafeInteger(imageLength) || imageLength <= 0) throw new Error("Invalid app image length.");
  if (!(firmwareSha256 instanceof Uint8Array) || firmwareSha256.length !== 32) throw new Error("Firmware SHA-256 must be 32 bytes.");
  if (coverPayload !== null && (!(coverPayload instanceof Uint8Array) || coverPayload.length !== COVER_PAYLOAD_LENGTH)) {
    throw new Error("Cover payload has the wrong length.");
  }
  if (!validTimePair(firstInstalledAt, lastInstalledAt, firstUtcOffsetMinutes, lastUtcOffsetMinutes)) {
    throw new Error("Invalid install timestamps.");
  }

  const bytes = new Uint8Array(DYNAMIC_SIDECAR_RECORD_SIZE);
  bytes.set(encoder.encode(DYNAMIC_SIDECAR_MAGIC), 0);
  writeU16(bytes, 4, DYNAMIC_SIDECAR_SCHEMA);
  writeU16(bytes, 6, DYNAMIC_SIDECAR_RECORD_SIZE);
  writeU32(bytes, 8, generation);
  bytes[12] = slotId;
  bytes[13] = SOURCE_KINDS[sourceKind];
  bytes[14] = 1; // resident trust policy
  bytes[15] = coverPayload === null ? 0 : 1;
  writeU32(bytes, 16, imageLength);
  bytes.set(firmwareSha256, 20);
  if (coverPayload !== null) {
    writeU16(bytes, 52, COVER_WIDTH);
    writeU16(bytes, 54, COVER_HEIGHT);
    writeU32(bytes, 56, COVER_PAYLOAD_LENGTH);
    writeU32(bytes, 60, crc32(coverPayload));
  }
  writeU64(bytes, 64, firstInstalledAt);
  writeU64(bytes, 72, lastInstalledAt);
  writeI16(bytes, 80, firstUtcOffsetMinutes);
  writeI16(bytes, 82, lastUtcOffsetMinutes);
  encodeField(bytes, TITLE_OFFSET, TITLE_SIZE, title, "title", true);
  encodeField(bytes, SOURCE_ID_OFFSET, SOURCE_ID_SIZE, sourceId, "source id");
  encodeField(bytes, VERSION_OFFSET, VERSION_SIZE, version, "version");
  writeU32(bytes, CRC_OFFSET, crc32(bytes.subarray(0, CRC_OFFSET)));
  return bytes;
}

export function decodeDynamicSidecarRecord(input) {
  try {
    const bytes = asBytes(input);
    if (bytes.length < DYNAMIC_SIDECAR_RECORD_SIZE ||
        decoder.decode(bytes.subarray(0, 4)) !== DYNAMIC_SIDECAR_MAGIC ||
        readU16(bytes, 4) !== DYNAMIC_SIDECAR_SCHEMA ||
        readU16(bytes, 6) !== DYNAMIC_SIDECAR_RECORD_SIZE ||
        readU32(bytes, CRC_OFFSET) !== crc32(bytes.subarray(0, CRC_OFFSET)) ||
        bytes[12] >= DYNAMIC_MAX_SLOTS || bytes[13] > 1 || bytes[14] !== 1 ||
        (bytes[15] & ~1) !== 0 || readU32(bytes, 16) === 0 ||
        !bytes.subarray(RESERVED_OFFSET, CRC_OFFSET).every((value) => value === 0)) return null;

    const coverPresent = (bytes[15] & 1) !== 0;
    const width = readU16(bytes, 52);
    const height = readU16(bytes, 54);
    const payloadLength = readU32(bytes, 56);
    const payloadCrc32 = readU32(bytes, 60);
    if (coverPresent ?
      (width !== COVER_WIDTH || height !== COVER_HEIGHT || payloadLength !== COVER_PAYLOAD_LENGTH) :
      (width !== 0 || height !== 0 || payloadLength !== 0 || payloadCrc32 !== 0)) return null;

    const firstInstalledAt = readU64(bytes, 64);
    const lastInstalledAt = readU64(bytes, 72);
    const firstUtcOffsetMinutes = readI16(bytes, 80);
    const lastUtcOffsetMinutes = readI16(bytes, 82);
    const title = decodeField(bytes, TITLE_OFFSET, TITLE_SIZE);
    const sourceId = decodeField(bytes, SOURCE_ID_OFFSET, SOURCE_ID_SIZE);
    const version = decodeField(bytes, VERSION_OFFSET, VERSION_SIZE);
    if (firstInstalledAt === null || lastInstalledAt === null || title === null || !title ||
        sourceId === null || version === null ||
        (bytes[13] === SOURCE_KINDS["play-api"] && !sourceId) ||
        !validTimePair(firstInstalledAt, lastInstalledAt, firstUtcOffsetMinutes, lastUtcOffsetMinutes)) return null;

    return {
      schemaVersion: DYNAMIC_SIDECAR_SCHEMA,
      generation: readU32(bytes, 8),
      slotId: bytes[12],
      sourceKind: SOURCE_KIND_NAMES[bytes[13]],
      policy: "resident",
      coverPresent,
      imageLength: readU32(bytes, 16),
      firmwareSha256: bytes.slice(20, 52),
      width,
      height,
      payloadLength,
      payloadCrc32,
      firstInstalledAt,
      lastInstalledAt,
      firstUtcOffsetMinutes,
      lastUtcOffsetMinutes,
      title,
      sourceId,
      version,
    };
  } catch {
    return null;
  }
}

function generationIsNewer(candidate, current) {
  const difference = (candidate - current) >>> 0;
  return difference !== 0 && difference < 0x80000000;
}

export function selectDynamicSidecarRecord({ slotId, imageLength = null, partitionSize = null, records }) {
  const valid = records.filter(({ record }) => record && record.slotId === slotId &&
    record.policy === "resident" &&
    (imageLength === null || record.imageLength === imageLength) &&
    (partitionSize === null || dynamicSlotAllocationSize(record.imageLength) === partitionSize));
  if (!valid.length) return null;
  return valid.slice(1).reduce((selected, candidate) =>
    generationIsNewer(candidate.record.generation, selected.record.generation) ? candidate : selected,
  valid[0]);
}

export function dynamicCoverMatchesRecord(record, payload) {
  return Boolean(record?.coverPresent && payload instanceof Uint8Array &&
    payload.length === record.payloadLength && crc32(payload) === record.payloadCrc32);
}

export function dynamicRecordMatchesImage(record, imageLength, firmwareSha256) {
  return Boolean(record && record.imageLength === imageLength &&
    firmwareSha256 instanceof Uint8Array && firmwareSha256.length === 32 &&
    equalBytes(record.firmwareSha256, firmwareSha256));
}
