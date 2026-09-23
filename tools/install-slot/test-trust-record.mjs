import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeTrustRecord,
  encodeTrustRecord,
  selectValidTrustBank,
  trustBankAddress,
} from "./trust-record.js";

const sha = new Uint8Array(32).map((_value, index) => index + 1);

test("trust record round-trips and is bound to exact slot, length, and SHA", () => {
  const bytes = encodeTrustRecord({ generation: 9, slotId: 1, imageLength: 0x12345, firmwareSha256: sha });
  const record = decodeTrustRecord(bytes);
  assert.deepEqual(record, {
    generation: 9,
    slotId: 1,
    policy: "resident",
    imageLength: 0x12345,
    firmwareSha256: sha,
  });
  assert.equal(selectValidTrustBank({
    slotId: 1,
    appSha256: sha,
    imageLength: 0x12345,
    banks: [{ bank: "a", record }],
  }).bank, "a");
  assert.equal(selectValidTrustBank({
    slotId: 2,
    appSha256: sha,
    imageLength: 0x12345,
    banks: [{ bank: "a", record }],
  }), null);
});

test("trust record rejects CRC corruption and selects newest valid bank", () => {
  const older = decodeTrustRecord(encodeTrustRecord({ generation: 4, slotId: 0, imageLength: 4096, firmwareSha256: sha }));
  const newerBytes = encodeTrustRecord({ generation: 5, slotId: 0, imageLength: 4096, firmwareSha256: sha });
  const newer = decodeTrustRecord(newerBytes);
  assert.equal(selectValidTrustBank({
    slotId: 0,
    appSha256: sha,
    imageLength: 4096,
    banks: [{ bank: "a", record: older }, { bank: "b", record: newer }],
  }).bank, "b");
  newerBytes[20] ^= 0xff;
  assert.equal(decodeTrustRecord(newerBytes), null);
});

test("trust banks occupy only the reserved covers tail", () => {
  assert.equal(trustBankAddress(0, "a"), 0x7e0000);
  assert.equal(trustBankAddress(2, "b"), 0x7e5000);
});
