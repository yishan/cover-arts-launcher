import assert from "node:assert/strict";
import test from "node:test";

import { COVER_PAYLOAD_LENGTH } from "./cover-convert.js";
import {
  decodeDynamicSidecarRecord,
  dynamicCoverMatchesRecord,
  dynamicRecordMatchesImage,
  dynamicSidecarLayout,
  encodeDynamicSidecarRecord,
  reassignDynamicSidecarRecord,
  selectDynamicSidecarRecord,
} from "./dynamic-sidecar.js";

const sha = new Uint8Array(32).map((_, index) => index + 1);
const cover = new Uint8Array(COVER_PAYLOAD_LENGTH).map((_, index) => index & 0xff);

function record(overrides = {}) {
  return encodeDynamicSidecarRecord({
    generation: 7,
    slotId: 4,
    sourceKind: "play-api",
    title: "动态玩法",
    sourceId: "play:281",
    version: "1.2.3",
    imageLength: 0x123450,
    firmwareSha256: sha,
    coverPayload: cover,
    firstInstalledAt: 1727222400,
    lastInstalledAt: 1727308800,
    firstUtcOffsetMinutes: 480,
    lastUtcOffsetMinutes: 480,
    ...overrides,
  });
}

test("dynamic sidecar record round-trips cover, trust, identity, and install history", () => {
  const decoded = decodeDynamicSidecarRecord(record());
  assert.equal(decoded.slotId, 4);
  assert.equal(decoded.title, "动态玩法");
  assert.equal(decoded.sourceId, "play:281");
  assert.equal(decoded.version, "1.2.3");
  assert.equal(decoded.imageLength, 0x123450);
  assert.equal(decoded.coverPresent, true);
  assert.deepEqual(decoded.firmwareSha256, sha);
  assert.equal(decoded.firstInstalledAt, 1727222400);
  assert.equal(decoded.lastInstalledAt, 1727308800);
  assert.equal(dynamicCoverMatchesRecord(decoded, cover), true);
  assert.equal(dynamicRecordMatchesImage(decoded, 0x123450, sha), true);
});

test("logical reassignment changes only generation, slot id, and record CRC", () => {
  const original = record({ generation: 12, slotId: 7 });
  const reassigned = reassignDynamicSidecarRecord(original, { generation: 13, slotId: 3 });
  const before = decodeDynamicSidecarRecord(original);
  const after = decodeDynamicSidecarRecord(reassigned);
  assert.equal(after.generation, 13);
  assert.equal(after.slotId, 3);
  assert.equal(after.title, before.title);
  assert.equal(after.sourceId, before.sourceId);
  assert.equal(after.imageLength, before.imageLength);
  assert.equal(after.payloadCrc32, before.payloadCrc32);
  assert.equal(after.firstInstalledAt, before.firstInstalledAt);
  assert.equal(after.lastInstalledAt, before.lastInstalledAt);
  assert.deepEqual(after.firmwareSha256, before.firmwareSha256);
});

test("placeholder metadata remains a trusted app record without a cover", () => {
  const decoded = decodeDynamicSidecarRecord(record({ coverPayload: null }));
  assert.equal(decoded.coverPresent, false);
  assert.equal(decoded.width, 0);
  assert.equal(dynamicCoverMatchesRecord(decoded, cover), false);
  assert.equal(dynamicRecordMatchesImage(decoded, 0x123450, sha), true);
});

test("cover corruption does not invalidate the resident app record", () => {
  const decoded = decodeDynamicSidecarRecord(record());
  const corrupt = cover.slice();
  corrupt[100] ^= 1;
  assert.equal(dynamicCoverMatchesRecord(decoded, corrupt), false);
  assert.equal(dynamicRecordMatchesImage(decoded, 0x123450, sha), true);
});

test("record CRC, reserved bytes, and timestamps fail closed", () => {
  const badCrc = record();
  badCrc[100] ^= 1;
  assert.equal(decodeDynamicSidecarRecord(badCrc), null);

  const badReserved = record();
  badReserved[300] = 1;
  assert.equal(decodeDynamicSidecarRecord(badReserved), null);

  assert.throws(() => record({ firstInstalledAt: 20, lastInstalledAt: 10 }), /timestamps/);
});

test("newest matching A/B bank wins and mismatched image length is ignored", () => {
  const older = decodeDynamicSidecarRecord(record({ generation: 9 }));
  const newer = decodeDynamicSidecarRecord(record({ generation: 10 }));
  const selected = selectDynamicSidecarRecord({
    slotId: 4,
    imageLength: 0x123450,
    records: [{ bank: "a", record: older }, { bank: "b", record: newer }],
  });
  assert.equal(selected.bank, "b");
  assert.equal(selectDynamicSidecarRecord({
    slotId: 4,
    imageLength: 0x123451,
    records: [{ bank: "a", record: older }],
  }), null);
});

test("partition-size selection permits an updated image within the same allocation", () => {
  const older = decodeDynamicSidecarRecord(record({ generation: 9, imageLength: 0x121000 }));
  const newer = decodeDynamicSidecarRecord(record({ generation: 10, imageLength: 0x123450 }));
  const selected = selectDynamicSidecarRecord({
    slotId: 4,
    partitionSize: 0x140000,
    records: [{ bank: "a", record: older }, { bank: "b", record: newer }],
  });
  assert.equal(selected.bank, "b");
});

test("sidecar layout stays inside the final 64 KiB of its app partition", () => {
  const layout = dynamicSidecarLayout({ offset: 0x240000, size: 0x110000 });
  assert.equal(layout.base, 0x340000);
  assert.deepEqual(layout.payload, { address: 0x340000, size: COVER_PAYLOAD_LENGTH });
  assert.deepEqual(layout.bankA, { address: 0x34a000, size: 0x1000 });
  assert.deepEqual(layout.bankB, { address: 0x34b000, size: 0x1000 });
  assert.ok(layout.bankB.address + layout.bankB.size <= 0x350000);
});
