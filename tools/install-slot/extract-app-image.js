/*
 * Copyright (c) 2026 FoloToy
 * SPDX-License-Identifier: MIT
 *
 * Partition/image parsing adapted from meta-pass at commit
 * 994caaf52357d97323bffb82b2db9cc784afb1eb. See LICENSE.meta-pass.txt.
 */

export const MAX_APP_IMAGE_SIZE = 0x200000;
export const ESP_IMAGE_MAGIC = 0xe9;
export const ESP32C3_CHIP_ID = 5;
const ESP_IMAGE_CHECKSUM_INITIAL = 0xef;

const PARTITION_ENTRY_SIZE = 32;
const PARTITION_TABLE_SIZE = 0x1000;
const PARTITION_TABLE_OFFSET = 0x8000;

function asBytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export class EspImageValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "EspImageValidationError";
    this.code = "ESP_IMAGE_INVALID";
  }
}

function imageError(message) {
  return new EspImageValidationError(message);
}

function u16le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32le(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function leftRotate(value, shift) {
  return (value << shift) | (value >>> (32 - shift));
}

// WebCrypto deliberately omits MD5. Partition tables still use MD5, so keep
// this small, synchronous implementation local to the parser.
function md5(input) {
  const bytes = asBytes(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const tail = new DataView(padded.buffer);
  tail.setUint32(paddedLength - 8, bitLength >>> 0, true);
  tail.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const constants = Array.from({ length: 64 }, (_, index) =>
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);

  for (let block = 0; block < paddedLength; block += 64) {
    const words = new Uint32Array(16);
    for (let index = 0; index < 16; index++) words[index] = tail.getUint32(block + index * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index++) {
      let f;
      let g;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }
      const previousD = d;
      d = c;
      c = b;
      const shift = shifts[Math.floor(index / 16) * 4 + (index % 4)];
      b = (b + leftRotate((a + f + constants[index] + words[g]) >>> 0, shift)) >>> 0;
      a = previousD;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const digest = new Uint8Array(16);
  const view = new DataView(digest.buffer);
  view.setUint32(0, a0, true);
  view.setUint32(4, b0, true);
  view.setUint32(8, c0, true);
  view.setUint32(12, d0, true);
  return digest;
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function decodeLabel(bytes) {
  const nul = bytes.indexOf(0);
  const erased = bytes.indexOf(0xff);
  const end = Math.min(nul < 0 ? bytes.length : nul, erased < 0 ? bytes.length : erased);
  return new TextDecoder().decode(bytes.subarray(0, end));
}

export function parsePartitionTable(input) {
  const bytes = asBytes(input);
  if (bytes.length < PARTITION_TABLE_SIZE) throw new Error("Truncated partition table sector.");
  const entries = [];
  let cursor = 0;
  let md5Present = false;
  let md5Valid = false;
  while (cursor + PARTITION_ENTRY_SIZE <= PARTITION_TABLE_SIZE) {
    if (bytes[cursor] === 0xaa && bytes[cursor + 1] === 0x50) {
      entries.push({
        name: decodeLabel(bytes.subarray(cursor + 12, cursor + 28)),
        type: bytes[cursor + 2],
        subtype: bytes[cursor + 3],
        offset: u32le(bytes, cursor + 4),
        size: u32le(bytes, cursor + 8),
      });
      cursor += PARTITION_ENTRY_SIZE;
      continue;
    }
    if (bytes[cursor] === 0xeb && bytes[cursor + 1] === 0xeb) {
      md5Present = true;
      const markerPaddingValid = bytes.subarray(cursor + 2, cursor + 16).every((value) => value === 0xff);
      md5Valid = markerPaddingValid && equalBytes(md5(bytes.subarray(0, cursor)), bytes.subarray(cursor + 16, cursor + 32));
    }
    break;
  }
  return { entries, md5Present, md5Valid };
}

function inspectImageLayout(bytes, start, extensionLength) {
  const segmentCount = bytes[start + 1];
  let cursor = start + 24 + extensionLength;
  const segments = [];
  for (let index = 0; index < segmentCount; index++) {
    if (cursor + 8 > bytes.length) throw imageError(`Truncated ESP image at segment ${index} header.`);
    const dataLength = u32le(bytes, cursor + 4);
    const dataOffset = cursor + 8;
    cursor = dataOffset + dataLength;
    if (cursor > bytes.length) throw imageError(`Truncated ESP image at segment ${index} data.`);
    segments.push({ dataOffset, dataLength });
  }
  while ((cursor - start) % 16 !== 15) cursor++;
  const checksumOffset = cursor;
  cursor += 1;
  const hashOffset = bytes[start + 23] === 1 ? cursor : null;
  if (hashOffset !== null) cursor += 32;
  if (cursor > bytes.length) throw imageError("Truncated ESP image checksum or SHA-256 trailer.");
  return { length: cursor - start, checksumOffset, hashOffset, segments };
}

function imageLayouts(bytes, start) {
  const layouts = [];
  let firstError;
  for (const extensionLength of [0, 16]) {
    try {
      layouts.push(inspectImageLayout(bytes, start, extensionLength));
    } catch (error) {
      firstError ??= error;
    }
  }
  if (!layouts.length) throw firstError;
  return layouts;
}

export function espImageLength(input, start = 0) {
  const bytes = asBytes(input);
  if (start < 0 || start + 24 > bytes.length) throw imageError("Truncated ESP image header.");
  if (bytes[start] !== ESP_IMAGE_MAGIC) throw imageError("Bad ESP image magic; expected 0xE9.");
  const segmentCount = bytes[start + 1];
  if (segmentCount < 1 || segmentCount > 16) throw imageError(`Invalid ESP segment count ${segmentCount}.`);
  if (u16le(bytes, start + 12) !== ESP32C3_CHIP_ID) throw imageError("ESP image is not for ESP32-C3.");
  return imageLayouts(bytes, start)[0].length;
}

async function sha256(input) {
  if (!globalThis.crypto?.subtle) throw new Error("WebCrypto SHA-256 is unavailable.");
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input));
}

export async function verifyEspImage(input, start = 0) {
  const bytes = asBytes(input);
  espImageLength(bytes, start);
  let lastError;
  for (const layout of imageLayouts(bytes, start)) {
    try {
      let checksum = ESP_IMAGE_CHECKSUM_INITIAL;
      for (const segment of layout.segments) {
        for (const value of bytes.subarray(segment.dataOffset, segment.dataOffset + segment.dataLength)) checksum ^= value;
      }
      if (bytes[layout.checksumOffset] !== checksum) {
        throw imageError(`ESP image checksum mismatch: calculated 0x${checksum.toString(16).padStart(2, "0")}, read 0x${bytes[layout.checksumOffset].toString(16).padStart(2, "0")}.`);
      }
      if (layout.hashOffset !== null) {
        const calculated = await sha256(bytes.subarray(start, layout.hashOffset));
        const appended = bytes.subarray(layout.hashOffset, layout.hashOffset + 32);
        if (!equalBytes(calculated, appended)) throw imageError("ESP image appended SHA-256 is invalid.");
      }
      return layout.length;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function extractAppImage(input) {
  const bytes = asBytes(input);
  let kind = "app";
  let appOffset = 0;

  const possibleTable = bytes.length >= PARTITION_TABLE_OFFSET + PARTITION_TABLE_SIZE
    ? bytes.subarray(PARTITION_TABLE_OFFSET, PARTITION_TABLE_OFFSET + PARTITION_TABLE_SIZE)
    : null;
  if (possibleTable && ((possibleTable[0] === 0xaa && possibleTable[1] === 0x50) ||
      (possibleTable[0] === 0xeb && possibleTable[1] === 0xeb))) {
    const table = parsePartitionTable(possibleTable);
    if (!table.md5Present || !table.md5Valid) throw new Error("Merged image partition-table MD5 is missing or invalid.");
    const factory = table.entries.find((entry) => entry.type === 0 && entry.subtype === 0);
    if (!factory) throw new Error("Merged image has no factory app partition.");
    kind = "merged";
    appOffset = factory.offset;
  }

  const length = espImageLength(bytes, appOffset);
  if (length > MAX_APP_IMAGE_SIZE) {
    throw new Error(`App image length ${length} exceeds slot capacity 0x200000.`);
  }
  return { kind, appOffset, length, data: bytes.slice(appOffset, appOffset + length) };
}
