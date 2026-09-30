export const COVER_WIDTH = 120;
export const COVER_HEIGHT = 160;
export const COVER_PAYLOAD_LENGTH = COVER_WIDTH * COVER_HEIGHT * 2;
export const COVER_MANIFEST_LENGTH = 256;

const SOURCE_KINDS = { local: 0, "play-api": 1 };
const SOURCE_KIND_NAMES = ["local", "play-api"];
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

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

export function crc32(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function encodeField(target, offset, capacity, value, label) {
  const encoded = encoder.encode(value ?? "");
  if (encoded.length >= capacity) throw new Error(`${label} is too long.`);
  target.set(encoded, offset);
}

function decodeField(bytes, offset, capacity) {
  const field = bytes.subarray(offset, offset + capacity);
  const end = field.indexOf(0);
  if (end < 0 || !field.subarray(end).every((value) => value === 0)) throw new Error("Malformed manifest string.");
  return decoder.decode(field.subarray(0, end));
}

export function rgbaToCoverRgb565({ data, width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Source image dimensions must be positive integers.");
  }
  if (!data || data.length !== width * height * 4) throw new Error("Source image must contain RGBA pixels.");
  const result = new Uint8Array(COVER_PAYLOAD_LENGTH);
  for (let y = 0; y < COVER_HEIGHT; y++) {
    const sourceY = Math.min(height - 1, Math.floor((y + 0.5) * height / COVER_HEIGHT));
    for (let x = 0; x < COVER_WIDTH; x++) {
      const sourceX = Math.min(width - 1, Math.floor((x + 0.5) * width / COVER_WIDTH));
      const sourceOffset = (sourceY * width + sourceX) * 4;
      const alpha = data[sourceOffset + 3] / 255;
      const red = Math.round(data[sourceOffset] * alpha);
      const green = Math.round(data[sourceOffset + 1] * alpha);
      const blue = Math.round(data[sourceOffset + 2] * alpha);
      const rgb565 = ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >> 3);
      const destination = (y * COVER_WIDTH + x) * 2;
      result[destination] = rgb565 & 0xff;
      result[destination + 1] = rgb565 >> 8;
    }
  }
  return { width: COVER_WIDTH, height: COVER_HEIGHT, data: result };
}

export function coverRgb565ToRgba(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length !== COVER_PAYLOAD_LENGTH) throw new Error("Cover payload has the wrong length.");
  const result = new Uint8ClampedArray(COVER_WIDTH * COVER_HEIGHT * 4);
  for (let source = 0, destination = 0; source < bytes.length; source += 2, destination += 4) {
    const rgb565 = bytes[source] | (bytes[source + 1] << 8);
    const red = (rgb565 >> 11) & 0x1f;
    const green = (rgb565 >> 5) & 0x3f;
    const blue = rgb565 & 0x1f;
    result[destination] = (red << 3) | (red >> 2);
    result[destination + 1] = (green << 2) | (green >> 4);
    result[destination + 2] = (blue << 3) | (blue >> 2);
    result[destination + 3] = 0xff;
  }
  return { width: COVER_WIDTH, height: COVER_HEIGHT, data: result };
}

export function encodeCoverManifest({
  generation, slotId, sourceKind, title, sourceId = "", version = "", firmwareSha256, payload,
}) {
  if (!Number.isInteger(slotId) || slotId < 0 || slotId > 2) throw new Error("Invalid slot id.");
  if (!(sourceKind in SOURCE_KINDS)) throw new Error("Invalid source kind.");
  if (sourceKind === "play-api" && !sourceId) throw new Error("Play API source id is required.");
  if (!title) throw new Error("Title is required.");
  if (!(firmwareSha256 instanceof Uint8Array) || firmwareSha256.length !== 32) throw new Error("Firmware SHA-256 must be 32 bytes.");
  if (!(payload instanceof Uint8Array) || payload.length !== COVER_PAYLOAD_LENGTH) throw new Error("Cover payload has the wrong length.");

  const bytes = new Uint8Array(COVER_MANIFEST_LENGTH);
  bytes.set([0x43, 0x56, 0x52, 0x31], 0);
  writeU16(bytes, 4, 1);
  writeU16(bytes, 6, COVER_MANIFEST_LENGTH);
  writeU32(bytes, 8, generation);
  bytes[12] = slotId;
  bytes[13] = SOURCE_KINDS[sourceKind];
  writeU16(bytes, 14, COVER_WIDTH);
  writeU16(bytes, 16, COVER_HEIGHT);
  writeU32(bytes, 20, COVER_PAYLOAD_LENGTH);
  writeU32(bytes, 24, crc32(payload));
  bytes.set(firmwareSha256, 28);
  encodeField(bytes, 60, 65, title, "Title");
  encodeField(bytes, 125, 49, sourceId, "Source id");
  encodeField(bytes, 174, 25, version, "Version");
  writeU32(bytes, 252, crc32(bytes.subarray(0, 252)));
  return bytes;
}

export function decodeCoverManifest(input) {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < COVER_MANIFEST_LENGTH || ![0x43, 0x56, 0x52, 0x31].every((value, index) => bytes[index] === value)) return null;
    if (readU16(bytes, 4) !== 1 || readU16(bytes, 6) !== COVER_MANIFEST_LENGTH) return null;
    if (readU32(bytes, 252) !== crc32(bytes.subarray(0, 252))) return null;
    if (bytes[18] !== 0 || bytes[19] !== 0 || !bytes.subarray(199, 252).every((value) => value === 0)) return null;
    if (bytes[12] > 2 || bytes[13] > 1 || readU16(bytes, 14) !== COVER_WIDTH || readU16(bytes, 16) !== COVER_HEIGHT || readU32(bytes, 20) !== COVER_PAYLOAD_LENGTH) return null;
    const result = {
      generation: readU32(bytes, 8),
      slotId: bytes[12],
      sourceKind: SOURCE_KIND_NAMES[bytes[13]],
      width: readU16(bytes, 14),
      height: readU16(bytes, 16),
      payloadLength: readU32(bytes, 20),
      payloadCrc32: readU32(bytes, 24),
      firmwareSha256: bytes.slice(28, 60),
      title: decodeField(bytes, 60, 65),
      sourceId: decodeField(bytes, 125, 49),
      version: decodeField(bytes, 174, 25),
    };
    if (!result.title || (result.sourceKind === "play-api" && !result.sourceId)) return null;
    return result;
  } catch {
    return null;
  }
}
