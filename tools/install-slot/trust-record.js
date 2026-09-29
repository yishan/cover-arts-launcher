import { crc32 } from "./cover-convert.js";

export const TRUST_RECORD_LENGTH = 256;
export const TRUST_BANK_SIZE = 0x1000;
export const TRUST_REGION_ADDRESS = 0x7e0000;
export const TRUST_POLICY_RESIDENT = 1;
export const TRUST_SCHEMA_VERSION = 2;
export const TRUST_SOURCE_ID_MAX_BYTES = 48;

function writeU16(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
}

function writeU32(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value >>> 0, true);
}

function writeU64(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(offset, BigInt(value), true);
}

function writeI16(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt16(offset, value, true);
}

function readU16(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function readU32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function readU64(bytes, offset) {
  const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, true);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function readI16(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(offset, true);
}

function encodeSourceId(value) {
  if (typeof value !== "string" || value.includes("\0")) throw new Error("Invalid trust source id.");
  const encoded = new TextEncoder().encode(value);
  if (encoded.length > TRUST_SOURCE_ID_MAX_BYTES) throw new Error("Trust source id exceeds 48 UTF-8 bytes.");
  return encoded;
}

function decodeSourceId(bytes) {
  const end = bytes.indexOf(0);
  if (end < 0) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
  } catch {
    return null;
  }
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function trustBankAddress(slotId, bank) {
  if (!Number.isInteger(slotId) || slotId < 0 || slotId > 2) throw new Error("Invalid slot id.");
  if (!['a', 'b'].includes(bank)) throw new Error("Trust bank must be a or b.");
  return TRUST_REGION_ADDRESS + (slotId * 2 + (bank === 'b' ? 1 : 0)) * TRUST_BANK_SIZE;
}

export function encodeTrustRecord({
  generation, slotId, imageLength, firmwareSha256, firstInstalledAt = 0,
  lastInstalledAt = 0, firstUtcOffsetMinutes = 0, lastUtcOffsetMinutes = 0,
  sourceId = "",
}) {
  if (!Number.isInteger(generation) || generation < 0) throw new Error("Invalid trust generation.");
  if (!Number.isInteger(slotId) || slotId < 0 || slotId > 2) throw new Error("Invalid slot id.");
  if (!Number.isInteger(imageLength) || imageLength <= 0 || imageLength > 0x200000) throw new Error("Invalid image length.");
  if (!(firmwareSha256 instanceof Uint8Array) || firmwareSha256.length !== 32) throw new Error("Firmware SHA-256 must be 32 bytes.");
  if (!Number.isSafeInteger(firstInstalledAt) || !Number.isSafeInteger(lastInstalledAt) ||
      firstInstalledAt < 0 || lastInstalledAt < 0 ||
      ((firstInstalledAt === 0) !== (lastInstalledAt === 0)) ||
      (firstInstalledAt > 0 && lastInstalledAt < firstInstalledAt)) throw new Error("Invalid install timestamps.");
  if (![firstUtcOffsetMinutes, lastUtcOffsetMinutes].every((value) =>
    Number.isInteger(value) && value >= -840 && value <= 840)) throw new Error("Invalid UTC offset.");
  const sourceBytes = encodeSourceId(sourceId);

  const bytes = new Uint8Array(TRUST_RECORD_LENGTH);
  bytes.set([0x54, 0x52, 0x53, 0x31], 0);
  writeU16(bytes, 4, TRUST_SCHEMA_VERSION);
  writeU16(bytes, 6, TRUST_RECORD_LENGTH);
  writeU32(bytes, 8, generation);
  bytes[12] = slotId;
  bytes[13] = TRUST_POLICY_RESIDENT;
  writeU32(bytes, 16, imageLength);
  bytes.set(firmwareSha256, 20);
  writeU64(bytes, 52, firstInstalledAt);
  writeU64(bytes, 60, lastInstalledAt);
  writeI16(bytes, 68, firstUtcOffsetMinutes);
  writeI16(bytes, 70, lastUtcOffsetMinutes);
  bytes.set(sourceBytes, 72);
  writeU32(bytes, 252, crc32(bytes.subarray(0, 252)));
  return bytes;
}

export function decodeTrustRecord(input) {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < TRUST_RECORD_LENGTH) return null;
    if (![0x54, 0x52, 0x53, 0x31].every((value, index) => bytes[index] === value)) return null;
    const schemaVersion = readU16(bytes, 4);
    if (![1, TRUST_SCHEMA_VERSION].includes(schemaVersion) || readU16(bytes, 6) !== TRUST_RECORD_LENGTH) return null;
    if (bytes[12] > 2 || bytes[13] !== TRUST_POLICY_RESIDENT || bytes[14] !== 0 || bytes[15] !== 0) return null;
    if (readU32(bytes, 16) === 0 || readU32(bytes, 16) > 0x200000) return null;
    if (readU32(bytes, 252) !== crc32(bytes.subarray(0, 252))) return null;
    let firstInstalledAt = 0;
    let lastInstalledAt = 0;
    let firstUtcOffsetMinutes = 0;
    let lastUtcOffsetMinutes = 0;
    let sourceId = "";
    if (schemaVersion === 1) {
      if (!bytes.subarray(52, 252).every((value) => value === 0)) return null;
    } else {
      firstInstalledAt = readU64(bytes, 52);
      lastInstalledAt = readU64(bytes, 60);
      firstUtcOffsetMinutes = readI16(bytes, 68);
      lastUtcOffsetMinutes = readI16(bytes, 70);
      sourceId = decodeSourceId(bytes.subarray(72, 121));
      if (firstInstalledAt === null || lastInstalledAt === null || sourceId === null ||
          ((firstInstalledAt === 0) !== (lastInstalledAt === 0)) ||
          (firstInstalledAt > 0 && lastInstalledAt < firstInstalledAt) ||
          firstUtcOffsetMinutes < -840 || firstUtcOffsetMinutes > 840 ||
          lastUtcOffsetMinutes < -840 || lastUtcOffsetMinutes > 840 ||
          !bytes.subarray(121, 252).every((value) => value === 0)) return null;
    }
    return {
      schemaVersion,
      generation: readU32(bytes, 8),
      slotId: bytes[12],
      policy: "resident",
      imageLength: readU32(bytes, 16),
      firmwareSha256: bytes.slice(20, 52),
      firstInstalledAt,
      lastInstalledAt,
      firstUtcOffsetMinutes,
      lastUtcOffsetMinutes,
      sourceId,
    };
  } catch {
    return null;
  }
}

function generationIsNewer(candidate, current) {
  return ((candidate - current) << 0) > 0;
}

export function selectValidTrustBank({ slotId, appSha256, imageLength, banks }) {
  const valid = banks.filter(({ record }) => record && record.slotId === slotId &&
    record.policy === "resident" && record.imageLength === imageLength &&
    equalBytes(record.firmwareSha256, appSha256));
  if (!valid.length) return null;
  return valid.reduce((selected, candidate) => generationIsNewer(candidate.record.generation, selected.record.generation)
    ? candidate : selected);
}
