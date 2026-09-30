import { COVER_PAYLOAD_LENGTH, crc32 } from "./cover-convert.js";

function equalBytes(left, right) {
  return left instanceof Uint8Array && right instanceof Uint8Array &&
    left.length === right.length && left.every((value, index) => value === right[index]);
}

function bankIsValid(slotId, appSha256, candidate) {
  const { manifest, payload } = candidate ?? {};
  return manifest && payload instanceof Uint8Array &&
    manifest.slotId === slotId &&
    manifest.payloadLength === COVER_PAYLOAD_LENGTH &&
    payload.length === COVER_PAYLOAD_LENGTH &&
    equalBytes(manifest.firmwareSha256, appSha256) &&
    crc32(payload) === manifest.payloadCrc32;
}

function bankIsReadable(slotId, candidate) {
  const { manifest, payload } = candidate ?? {};
  return manifest && payload instanceof Uint8Array &&
    manifest.slotId === slotId &&
    manifest.payloadLength === COVER_PAYLOAD_LENGTH &&
    payload.length === COVER_PAYLOAD_LENGTH &&
    crc32(payload) === manifest.payloadCrc32;
}

function generationIsNewer(candidate, current) {
  const difference = (candidate - current) >>> 0;
  return difference !== 0 && difference < 0x80000000;
}

export function selectValidCoverBank({ slotId, appSha256, banks }) {
  if (!Number.isInteger(slotId) || slotId < 0 || slotId > 2 ||
      !(appSha256 instanceof Uint8Array) || appSha256.length !== 32) return null;
  const valid = (banks ?? []).filter((candidate) => bankIsValid(slotId, appSha256, candidate));
  if (!valid.length) return null;
  return valid.slice(1).reduce(
    (current, candidate) => generationIsNewer(candidate.manifest.generation, current.manifest.generation)
      ? candidate : current,
    valid[0],
  );
}

export function selectLatestReadableCoverBank({ slotId, banks }) {
  if (!Number.isInteger(slotId) || slotId < 0 || slotId > 2) return null;
  const valid = (banks ?? []).filter((candidate) => bankIsReadable(slotId, candidate));
  if (!valid.length) return null;
  return valid.slice(1).reduce(
    (current, candidate) => generationIsNewer(candidate.manifest.generation, current.manifest.generation)
      ? candidate : current,
    valid[0],
  );
}
