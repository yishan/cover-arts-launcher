import {
  COVER_MANIFEST_LENGTH,
  COVER_PAYLOAD_LENGTH,
  crc32,
  decodeCoverManifest,
} from "./cover-convert.js";
import { selectValidCoverBank } from "./cover-bank.js";
import {
  ESP32C3_CHIP_ID,
  ESP_IMAGE_MAGIC,
  EspImageValidationError,
  verifyEspImage,
} from "./extract-app-image.js";
import {
  APP_SLOT_ADDRESSES,
  APP_SLOT_SIZE,
  COVER_BANK_SIZE,
  COVER_REGION_ADDRESS,
} from "./slot-install.js";
import {
  TRUST_RECORD_LENGTH,
  decodeTrustRecord,
  selectValidTrustBank,
  trustBankAddress,
} from "./trust-record.js";

function asBytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function u16le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32le(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function allErased(bytes) {
  return bytes.every((value) => value === 0xff);
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("WebCrypto SHA-256 is unavailable.");
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}

function validateHeader(header) {
  if (header.length < 24) throw new EspImageValidationError("Truncated ESP image header.");
  if (header[0] !== ESP_IMAGE_MAGIC) throw new EspImageValidationError("Bad ESP image magic; expected 0xE9.");
  if (header[1] < 1 || header[1] > 16) throw new EspImageValidationError(`Invalid ESP segment count ${header[1]}.`);
  if (u16le(header, 12) !== ESP32C3_CHIP_ID) throw new EspImageValidationError("ESP image is not for ESP32-C3.");
}

async function readImageCandidate(loader, address, maxLength, header, extensionLength) {
  let cursor = 24 + extensionLength;
  for (let index = 0; index < header[1]; index++) {
    const segmentHeader = cursor + 8 <= header.length
      ? header.subarray(cursor, cursor + 8)
      : asBytes(await loader.readFlash(address + cursor, 8));
    if (segmentHeader.length !== 8) throw new Error(`读取 segment ${index} header 时发生短读。`);
    const dataLength = u32le(segmentHeader, 4);
    cursor += 8 + dataLength;
    if (cursor > maxLength) throw new EspImageValidationError(`ESP segment ${index} exceeds the slot boundary.`);
  }
  while (cursor % 16 !== 15) cursor++;
  cursor += 1;
  if (header[23] === 1) cursor += 32;
  if (cursor > maxLength) throw new EspImageValidationError("ESP checksum or SHA-256 trailer exceeds the slot boundary.");

  const image = asBytes(await loader.readFlash(address, cursor));
  if (image.length !== cursor) throw new Error(`读取 App 时发生短读：需要 ${cursor} bytes，实际 ${image.length} bytes。`);
  const verifiedLength = await verifyEspImage(image);
  if (verifiedLength !== cursor) throw new EspImageValidationError("ESP image length is inconsistent after verification.");
  return image;
}

async function readVerifiedImage(loader, address, maxLength) {
  const header = asBytes(await loader.readFlash(address, 40));
  if (header.length !== 40) throw new Error(`读取 App header 时发生短读：需要 40 bytes，实际 ${header.length} bytes。`);
  validateHeader(header);

  let lastValidationError;
  for (const extensionLength of [0, 16]) {
    try {
      return await readImageCandidate(loader, address, maxLength, header, extensionLength);
    } catch (error) {
      if (!(error instanceof EspImageValidationError)) throw error;
      lastValidationError = error;
    }
  }
  throw lastValidationError;
}

async function readCoverCandidate(loader, slotId, bank, appSha256) {
  const bankIndex = slotId * 2 + (bank === "b" ? 1 : 0);
  const address = COVER_REGION_ADDRESS + bankIndex * COVER_BANK_SIZE;
  const manifest = decodeCoverManifest(asBytes(await loader.readFlash(address, COVER_MANIFEST_LENGTH)));
  if (!manifest || manifest.slotId !== slotId || !equalBytes(manifest.firmwareSha256, appSha256)) {
    return { bank, manifest, payload: null };
  }
  const payload = asBytes(await loader.readFlash(address + 0x1000, COVER_PAYLOAD_LENGTH));
  if (payload.length !== COVER_PAYLOAD_LENGTH) throw new Error(`读取 Cover bank ${bank.toUpperCase()} 时发生短读。`);
  return { bank, manifest, payload };
}

async function readTrustCandidate(loader, slotId, bank) {
  const record = decodeTrustRecord(asBytes(await loader.readFlash(
    trustBankAddress(slotId, bank), TRUST_RECORD_LENGTH,
  )));
  return { bank, record };
}

function generationIsNewer(candidate, current) {
  const difference = (candidate - current) >>> 0;
  return difference !== 0 && difference < 0x80000000;
}

function selectNewest(candidates, generationOf) {
  if (!candidates.length) return null;
  return candidates.slice(1).reduce((current, candidate) =>
    generationIsNewer(generationOf(candidate), generationOf(current)) ? candidate : current,
  candidates[0]);
}

async function readFastCoverCandidate(loader, slotId, bank) {
  const bankIndex = slotId * 2 + (bank === "b" ? 1 : 0);
  const address = COVER_REGION_ADDRESS + bankIndex * COVER_BANK_SIZE;
  const manifest = decodeCoverManifest(asBytes(await loader.readFlash(address, COVER_MANIFEST_LENGTH)));
  if (!manifest || manifest.slotId !== slotId) return { bank, manifest, payload: null };
  const payload = asBytes(await loader.readFlash(address + 0x1000, COVER_PAYLOAD_LENGTH));
  if (payload.length !== COVER_PAYLOAD_LENGTH) throw new Error(`读取 Cover bank ${bank.toUpperCase()} 时发生短读。`);
  if (crc32(payload) !== manifest.payloadCrc32) return { bank, manifest, payload: null };
  return { bank, manifest, payload };
}

export async function inspectSlotFast(loader, slotId) {
  if (!loader || typeof loader.readFlash !== "function") throw new Error("A connected flash loader is required.");
  if (!Number.isInteger(slotId) || slotId < 0 || slotId >= APP_SLOT_ADDRESSES.length) throw new Error("Slot id must be 0, 1, or 2.");
  const address = APP_SLOT_ADDRESSES[slotId];
  const prefix = asBytes(await loader.readFlash(address, 24));
  if (prefix.length !== 24) throw new Error(`读取位置 ${slotId + 1} 时发生短读。`);
  if (allErased(prefix)) {
    return {
      slotId, state: "empty", sourceId: "", title: "", activeCoverBank: null, generation: 0,
      coverPayload: null, trusted: false, trustSource: null, activeTrustBank: null, trustGeneration: 0,
    };
  }

  try {
    validateHeader(prefix);
  } catch (error) {
    if (!(error instanceof EspImageValidationError)) throw error;
    return {
      slotId, state: "invalid", sourceId: "", title: "", activeCoverBank: null, generation: 0,
      coverPayload: null, trusted: false, trustSource: null, activeTrustBank: null, trustGeneration: 0,
      diagnostic: error.message,
    };
  }

  const trustBanks = await Promise.all([
    readTrustCandidate(loader, slotId, "a"),
    readTrustCandidate(loader, slotId, "b"),
  ]);
  const selectedTrust = selectNewest(
    trustBanks.filter(({ record }) => record?.slotId === slotId && record.policy === "resident"),
    ({ record }) => record.generation,
  );
  const coverBanks = await Promise.all([
    readFastCoverCandidate(loader, slotId, "a"),
    readFastCoverCandidate(loader, slotId, "b"),
  ]);
  const validCovers = coverBanks.filter(({ manifest, payload }) => manifest && payload &&
    (!selectedTrust || equalBytes(manifest.firmwareSha256, selectedTrust.record.firmwareSha256)));
  const selectedCover = selectNewest(validCovers, ({ manifest }) => manifest.generation);
  const appShaBytes = selectedTrust?.record.firmwareSha256 ?? selectedCover?.manifest.firmwareSha256 ?? null;

  return {
    slotId,
    state: "ready",
    sourceId: selectedCover?.manifest.sourceId ?? "",
    title: selectedCover?.manifest.title ?? "",
    version: selectedCover?.manifest.version ?? "",
    activeCoverBank: selectedCover?.bank ?? null,
    generation: selectedCover?.manifest.generation ?? 0,
    coverPayload: selectedCover?.payload ?? null,
    trusted: Boolean(selectedTrust || selectedCover),
    trustSource: selectedTrust ? "install-receipt" : selectedCover ? "legacy-cover" : "legacy-generic",
    activeTrustBank: selectedTrust?.bank ?? null,
    trustGeneration: selectedTrust?.record.generation ?? 0,
    imageLength: selectedTrust?.record.imageLength ?? null,
    appShaBytes,
  };
}

export async function inspectSlot(loader, slotId) {
  if (!loader || typeof loader.readFlash !== "function") throw new Error("A connected flash loader is required.");
  if (!Number.isInteger(slotId) || slotId < 0 || slotId >= APP_SLOT_ADDRESSES.length) throw new Error("Slot id must be 0, 1, or 2.");
  const address = APP_SLOT_ADDRESSES[slotId];
  const prefix = asBytes(await loader.readFlash(address, 24));
  if (prefix.length !== 24) throw new Error(`读取位置 ${slotId + 1} 时发生短读。`);
  if (allErased(prefix)) {
    return {
      slotId, state: "empty", sourceId: "", title: "", activeCoverBank: null, generation: 0,
      coverPayload: null, trusted: false, trustSource: null, activeTrustBank: null, trustGeneration: 0,
    };
  }

  let image;
  try {
    image = await readVerifiedImage(loader, address, APP_SLOT_SIZE);
  } catch (error) {
    if (!(error instanceof EspImageValidationError)) throw error;
    return {
      slotId,
      state: "invalid",
      sourceId: "",
      title: "",
      activeCoverBank: null,
      generation: 0,
      coverPayload: null,
      trusted: false,
      trustSource: null,
      activeTrustBank: null,
      trustGeneration: 0,
      diagnostic: error.message,
    };
  }

  const appShaBytes = await sha256(image);
  const banks = await Promise.all([
    readCoverCandidate(loader, slotId, "a", appShaBytes),
    readCoverCandidate(loader, slotId, "b", appShaBytes),
  ]);
  const selected = selectValidCoverBank({ slotId, appSha256: appShaBytes, banks });
  const trustBanks = await Promise.all([
    readTrustCandidate(loader, slotId, "a"),
    readTrustCandidate(loader, slotId, "b"),
  ]);
  const selectedTrust = selectValidTrustBank({
    slotId,
    appSha256: appShaBytes,
    imageLength: image.length,
    banks: trustBanks,
  });
  return {
    slotId,
    state: "ready",
    sourceId: selected?.manifest.sourceId ?? "",
    title: selected?.manifest.title ?? "",
    version: selected?.manifest.version ?? "",
    activeCoverBank: selected?.bank ?? null,
    generation: selected?.manifest.generation ?? 0,
    coverPayload: selected?.payload ?? null,
    trusted: Boolean(selectedTrust || selected),
    trustSource: selectedTrust ? "install-receipt" : selected ? "legacy-cover" : "legacy-generic",
    activeTrustBank: selectedTrust?.bank ?? null,
    trustGeneration: selectedTrust?.record.generation ?? 0,
    imageLength: image.length,
    appShaBytes,
  };
}

export async function inspectAllSlots(loader) {
  const result = [];
  for (let slotId = 0; slotId < APP_SLOT_ADDRESSES.length; slotId++) {
    result.push(await inspectSlot(loader, slotId));
  }
  return result;
}

export async function inspectAllSlotsFast(loader) {
  const result = [];
  for (let slotId = 0; slotId < APP_SLOT_ADDRESSES.length; slotId++) {
    result.push(await inspectSlotFast(loader, slotId));
  }
  return result;
}
