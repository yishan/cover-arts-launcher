import { crc32 } from "./cover-convert.js";

export const TRUST_RECORD_LENGTH = 256;
export const TRUST_BANK_SIZE = 0x1000;
export const TRUST_REGION_ADDRESS = 0x7e0000;
export const TRUST_POLICY_RESIDENT = 1;

function writeU16(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
}

function writeU32(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value >>> 0, true);
}

function readU16(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function readU32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function trustBankAddress(slotId, bank) {
  if (!Number.isInteger(slotId) || slotId < 0 || slotId > 2) throw new Error("Invalid slot id.");
  if (!['a', 'b'].includes(bank)) throw new Error("Trust bank must be a or b.");
  return TRUST_REGION_ADDRESS + (slotId * 2 + (bank === 'b' ? 1 : 0)) * TRUST_BANK_SIZE;
}

export function encodeTrustRecord({ generation, slotId, imageLength, firmwareSha256 }) {
  if (!Number.isInteger(generation) || generation < 0) throw new Error("Invalid trust generation.");
  if (!Number.isInteger(slotId) || slotId < 0 || slotId > 2) throw new Error("Invalid slot id.");
  if (!Number.isInteger(imageLength) || imageLength <= 0 || imageLength > 0x200000) throw new Error("Invalid image length.");
  if (!(firmwareSha256 instanceof Uint8Array) || firmwareSha256.length !== 32) throw new Error("Firmware SHA-256 must be 32 bytes.");

  const bytes = new Uint8Array(TRUST_RECORD_LENGTH);
  bytes.set([0x54, 0x52, 0x53, 0x31], 0);
  writeU16(bytes, 4, 1);
  writeU16(bytes, 6, TRUST_RECORD_LENGTH);
  writeU32(bytes, 8, generation);
  bytes[12] = slotId;
  bytes[13] = TRUST_POLICY_RESIDENT;
  writeU32(bytes, 16, imageLength);
  bytes.set(firmwareSha256, 20);
  writeU32(bytes, 252, crc32(bytes.subarray(0, 252)));
  return bytes;
}

export function decodeTrustRecord(input) {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < TRUST_RECORD_LENGTH) return null;
    if (![0x54, 0x52, 0x53, 0x31].every((value, index) => bytes[index] === value)) return null;
    if (readU16(bytes, 4) !== 1 || readU16(bytes, 6) !== TRUST_RECORD_LENGTH) return null;
    if (bytes[12] > 2 || bytes[13] !== TRUST_POLICY_RESIDENT || bytes[14] !== 0 || bytes[15] !== 0) return null;
    if (readU32(bytes, 16) === 0 || readU32(bytes, 16) > 0x200000) return null;
    if (!bytes.subarray(52, 252).every((value) => value === 0)) return null;
    if (readU32(bytes, 252) !== crc32(bytes.subarray(0, 252))) return null;
    return {
      generation: readU32(bytes, 8),
      slotId: bytes[12],
      policy: "resident",
      imageLength: readU32(bytes, 16),
      firmwareSha256: bytes.slice(20, 52),
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
