import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMPATIBLE_PARTITIONS,
  SYSTEM_ERASE_RANGES,
  classifySystemTarget,
  createSystemInstallSession,
  makeEraseVerificationSamples,
  reduceSystemInstall,
  runSystemInstall,
} from "./system-install.js";

function writeU32LE(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function partitionSector(entries, { corruptMd5 = false } = {}) {
  const sector = new Uint8Array(0x1000).fill(0xff);
  let offset = 0;
  for (const entry of entries) {
    sector[offset] = 0xaa;
    sector[offset + 1] = 0x50;
    sector[offset + 2] = entry.type;
    sector[offset + 3] = entry.subtype;
    writeU32LE(sector, offset + 4, entry.offset);
    writeU32LE(sector, offset + 8, entry.size);
    new TextEncoder().encodeInto(entry.name, sector.subarray(offset + 12, offset + 28));
    offset += 32;
  }
  sector.set([0xeb, 0xeb, ...new Uint8Array(14).fill(0xff)], offset);
  const digest = createHash("md5").update(sector.subarray(0, offset)).digest();
  sector.set(digest, offset + 16);
  if (corruptMd5) sector[offset + 16] ^= 0x01;
  return sector;
}

const legacyEntries = [
  { name: "nvs", type: 1, subtype: 2, offset: 0x9000, size: 0x6000 },
  { name: "phy_init", type: 1, subtype: 1, offset: 0xf000, size: 0x1000 },
  { name: "factory", type: 0, subtype: 0, offset: 0x10000, size: 0x7f0000 },
];

test("detects the known single-factory 8 MiB layout as migratable", () => {
  const result = classifySystemTarget({
    chip: "ESP32-C3",
    flashSize: 0x800000,
    partitionTableSector: partitionSector(legacyEntries),
  });
  assert.equal(result.kind, "single-factory");
  assert.equal(result.canInstall, true);
});

test("detects an existing compatible Launcher layout", () => {
  const result = classifySystemTarget({
    chip: "ESP32-C3",
    flashSize: 0x800000,
    partitionTableSector: partitionSector(COMPATIBLE_PARTITIONS),
  });
  assert.equal(result.kind, "compatible-launcher");
  assert.equal(result.canInstall, true);
});

test("refuses unknown layouts and invalid identity data", () => {
  const withUnknownData = [...legacyEntries, {
    name: "identity", type: 1, subtype: 0x40, offset: 0x700000, size: 0x1000,
  }];
  const cases = [
    { chip: "ESP32-S3", flashSize: 0x800000, partitionTableSector: partitionSector(legacyEntries) },
    { chip: "ESP32-C3", flashSize: 0x400000, partitionTableSector: partitionSector(legacyEntries) },
    { chip: "ESP32-C3", flashSize: 0x800000, partitionTableSector: partitionSector(withUnknownData) },
    { chip: "ESP32-C3", flashSize: 0x800000, partitionTableSector: partitionSector(legacyEntries, { corruptMd5: true }) },
  ];
  for (const input of cases) {
    const result = classifySystemTarget(input);
    assert.equal(result.kind, "unknown");
    assert.equal(result.canInstall, false);
  }
});

test("user cancellation is terminal and performs no writes", () => {
  const initial = createSystemInstallSession("single-factory");
  const cancelled = reduceSystemInstall(initial, { type: "cancel" });
  assert.equal(cancelled.phase, "cancelled");
  assert.equal(cancelled.writeStarted, false);
});

test("disconnect and full-write failure require a full restart", () => {
  let session = createSystemInstallSession("single-factory");
  session = reduceSystemInstall(session, { type: "confirm-warning" });
  session = reduceSystemInstall(session, { type: "erase-complete" });
  const disconnected = reduceSystemInstall(session, { type: "disconnect" });
  assert.equal(disconnected.phase, "recovery-required");
  assert.equal(disconnected.resumeAllowed, false);
  assert.equal(disconnected.restartFrom, "warning");

  const failed = reduceSystemInstall(session, { type: "write-failed", error: "serial timeout" });
  assert.equal(failed.phase, "recovery-required");
  assert.match(failed.error, /serial timeout/);
});

test("verification failure never reaches success", () => {
  let session = createSystemInstallSession("compatible-launcher");
  for (const event of [
    { type: "confirm-warning" },
    { type: "erase-complete" },
    { type: "write-complete" },
    { type: "verification-failed", error: "factory SHA mismatch" },
  ]) session = reduceSystemInstall(session, event);
  assert.equal(session.phase, "recovery-required");
  assert.equal(session.completed, false);
});

test("success requires verified segments, no OTA selection, and three empty slots", () => {
  let session = createSystemInstallSession("single-factory");
  for (const event of [
    { type: "confirm-warning" },
    { type: "erase-complete" },
    { type: "write-complete" },
    { type: "segments-verified" },
    { type: "empty-state-verified", otaSelected: false, emptySlots: 3 },
  ]) session = reduceSystemInstall(session, event);
  assert.equal(session.phase, "completed");
  assert.equal(session.completed, true);
  assert.deepEqual(session.completionActions, ["install-first-play", "finish-empty-library"]);
});

test("real system controller stops after a short-read verification failure", async () => {
  const events = [];
  const result = await runSystemInstall({
    targetKind: "single-factory",
    async erase() { events.push("erase"); },
    async write() { events.push("write"); },
    async verifySegments() { events.push("verify"); throw new Error("Only got 2 bytes"); },
    async verifyEmptyState() { events.push("empty"); return { otaSelected: false, emptySlots: 3 }; },
  });
  assert.deepEqual(events, ["erase", "write", "verify"]);
  assert.equal(result.session.phase, "recovery-required");
  assert.equal(result.session.restartFrom, "warning");
  assert.match(result.error.message, /Only got 2 bytes/);
});

test("erase plan names every slot, all six cover banks, and otadata", () => {
  assert.deepEqual(SYSTEM_ERASE_RANGES.map((item) => item.name), [
    "ota_0", "ota_1", "ota_2",
    "cover_0a", "cover_0b", "cover_1a", "cover_1b", "cover_2a", "cover_2b",
    "trust_0", "trust_1", "trust_2",
    "otadata",
  ]);
  for (const range of SYSTEM_ERASE_RANGES) {
    const samples = makeEraseVerificationSamples(range, 32);
    assert.deepEqual(samples, [
      { address: range.address, length: 32 },
      { address: range.address + range.size - 32, length: 32 },
    ]);
  }
});

test("vendored esptool runtime is pinned to the official 0.6.1 bundle", async () => {
  const packageJson = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.devDependencies["esptool-js"], "0.6.1");

  const runtime = await import("./vendor/esptool-js-0.6.1.js");
  assert.equal(typeof runtime.ESPLoader, "function");
  assert.equal(typeof runtime.Transport, "function");
});

test("writer uses the esptool-js 0.6.1 byte and flash-size contracts", async () => {
  const source = await readFile(new URL("./app.js", import.meta.url), "utf8");

  assert.match(source, /vendor\/esptool-js-0\.6\.1\.js/);
  assert.doesNotMatch(source, /bytesToBinary/);
  assert.match(source, /detectFlashSize\(\)/);
  assert.match(source, /flashSizeBytes\(detectedSize\)/);
});

test("erase-region timeout uses the sixth checkCommand argument", async () => {
  const source = await readFile(new URL("./app.js", import.meta.url), "utf8");

  assert.match(
    source,
    /checkCommand\("erase region", state\.loader\.ESP_ERASE_REGION, payload, 0, undefined, timeout\)/,
  );
});

test("play manager exposes an explicitly confirmed selected-slot erase action", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("./app.js", import.meta.url), "utf8");

  assert.match(html, /id="erase-confirm"/);
  assert.match(html, /id="erase-slot"/);
  assert.match(source, /async function eraseSelectedSlot\(\)/);
});

test("selected-slot erase adapts eraseSize for verification samples", async () => {
  const source = await readFile(new URL("./app.js", import.meta.url), "utf8");

  assert.match(
    source,
    /makeEraseVerificationSamples\(\{ address: range\.address, size: range\.eraseSize \}, 32\)/,
  );
});

test("play manager can repair title and cover without erasing the app slot", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("./app.js", import.meta.url), "utf8");
  const repair = source.match(/async function repairMetadataCover\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(html, /id="repair-cover"/);
  assert.match(source, /async function repairMetadataCover\(\)/);
  assert.match(repair, /App SHA/);
  assert.doesNotMatch(repair, /eraseRegion\(plan\.app/);
});
