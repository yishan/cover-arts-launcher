import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSlotWritePlan,
  createSlotInstallSession,
  recommendSlot,
  reduceSlotInstall,
  runSlotInstall,
} from "./slot-install.js";

const slots = [
  { slotId: 0, state: "ready", sourceId: "play:10" },
  { slotId: 1, state: "empty", sourceId: "" },
  { slotId: 2, state: "ready", sourceId: "play:30" },
];

test("recommends same source before an earlier empty slot", () => {
  assert.deepEqual(recommendSlot(slots, "play:30"), { slotId: 2, reason: "same-source" });
});

test("otherwise recommends the first empty slot", () => {
  assert.deepEqual(recommendSlot(slots, "play:99"), { slotId: 1, reason: "first-empty" });
});

test("requires manual replacement when all slots are occupied", () => {
  const full = slots.map((slot) => ({ ...slot, state: "ready" }));
  assert.deepEqual(recommendSlot(full, "play:99"), { slotId: null, reason: "manual-replacement" });
});

test("write plan touches only the selected OTA slot and inactive cover bank", () => {
  const plan = buildSlotWritePlan({
    slotId: 1,
    appLength: 0x100000,
    activeCoverBank: "a",
    activeTrustBank: "a",
    hasCover: true,
  });
  assert.deepEqual(plan, {
    app: { address: 0x380000, eraseSize: 0x200000, writeLength: 0x100000 },
    trust: { bank: "b", address: 0x7e3000, eraseSize: 0x1000 },
    cover: { bank: "b", address: 0x7b0000, eraseSize: 0x10000 },
  });
  assert.ok(plan.app.address >= 0x380000 && plan.app.address + plan.app.eraseSize <= 0x580000);
  assert.ok(plan.cover.address >= 0x780000 && plan.cover.address + plan.cover.eraseSize <= 0x7e0000);
  assert.ok(plan.trust.address >= 0x7e0000 && plan.trust.address + plan.trust.eraseSize <= 0x7e6000);
});

test("erase plan touches only the selected OTA slot and both of its cover banks", async () => {
  const module = await import("./slot-install.js");
  assert.equal(typeof module.buildSlotErasePlan, "function");
  assert.deepEqual(module.buildSlotErasePlan(1), {
    app: { address: 0x380000, eraseSize: 0x200000 },
    covers: { address: 0x7a0000, eraseSize: 0x20000 },
    trust: { address: 0x7e2000, eraseSize: 0x2000 },
  });
});

test("rejects images over exactly 2 MiB", () => {
  assert.throws(
    () => buildSlotWritePlan({ slotId: 0, appLength: 0x200001, activeCoverBank: null, hasCover: false }),
    /2 MiB|0x200000/i,
  );
});

test("app failure becomes incomplete and must restart app writing", () => {
  let session = createSlotInstallSession(0);
  session = reduceSlotInstall(session, { type: "validation-complete" });
  session = reduceSlotInstall(session, { type: "begin" });
  session = reduceSlotInstall(session, { type: "app-write-failed", error: "disconnect", cleanupVerified: false });
  assert.equal(session.phase, "incomplete");
  assert.equal(session.bootable, null);
  assert.equal(session.deviceState, "unknown");
  assert.equal(session.resumeAllowed, false);
  assert.equal(session.retryFrom, "app-erase");
});

test("cover failure after app verification keeps app bootable with retry-cover", () => {
  let session = createSlotInstallSession(2);
  for (const event of [
    { type: "validation-complete" },
    { type: "begin" },
    { type: "app-written" },
    { type: "app-verified" },
    { type: "trust-written" },
    { type: "cover-write-failed", error: "cover timeout" },
  ]) session = reduceSlotInstall(session, event);
  assert.equal(session.phase, "partial-success");
  assert.equal(session.bootable, true);
  assert.equal(session.usePlaceholder, true);
  assert.equal(session.retryFrom, "cover-only");
});

test("real install controller reports unknown state when write and cleanup both fail", async () => {
  const events = [];
  const result = await runSlotInstall({
    slotId: 1,
    hasCover: true,
    async eraseApp() { events.push("erase"); },
    async writeApp() { events.push("write"); throw new Error("Only got 2 bytes"); },
    async verifyApp() { events.push("verify"); },
    async invalidateApp() { events.push("invalidate"); throw new Error("erase response lost"); },
    async writeTrust() { events.push("trust"); },
    async writeCover() { events.push("cover"); },
  });
  assert.deepEqual(events, ["erase", "write", "invalidate"]);
  assert.equal(result.session.phase, "incomplete");
  assert.equal(result.session.deviceState, "unknown");
  assert.match(result.session.cleanupError, /erase response lost/);
});

test("real install controller confirms an invalidated app header after verification failure", async () => {
  const result = await runSlotInstall({
    slotId: 0,
    hasCover: false,
    async eraseApp() {},
    async writeApp() {},
    async verifyApp() { throw new Error("readback mismatch"); },
    async invalidateApp() { return true; },
    async writeTrust() {},
    async writeCover() {},
  });
  assert.equal(result.session.phase, "incomplete");
  assert.equal(result.session.deviceState, "unbootable");
  assert.equal(result.session.bootable, false);
});

test("trust receipt is committed before an optional cover", async () => {
  const events = [];
  const result = await runSlotInstall({
    slotId: 2,
    hasCover: true,
    async eraseApp() { events.push("erase"); },
    async writeApp() { events.push("app"); },
    async verifyApp() { events.push("verify"); },
    async invalidateApp() { events.push("invalidate"); return true; },
    async writeTrust() { events.push("trust"); },
    async writeCover() { events.push("cover"); },
  });
  assert.deepEqual(events, ["erase", "app", "verify", "trust", "cover"]);
  assert.equal(result.session.phase, "completed");
  assert.equal(result.session.trusted, true);
});

test("trust failure invalidates the app instead of claiming a resident install", async () => {
  const events = [];
  const result = await runSlotInstall({
    slotId: 0,
    hasCover: false,
    async eraseApp() { events.push("erase"); },
    async writeApp() { events.push("app"); },
    async verifyApp() { events.push("verify"); },
    async invalidateApp() { events.push("invalidate"); return true; },
    async writeTrust() { events.push("trust"); throw new Error("receipt write failed"); },
    async writeCover() { events.push("cover"); },
  });
  assert.deepEqual(events, ["erase", "app", "verify", "trust", "invalidate"]);
  assert.equal(result.session.phase, "incomplete");
  assert.equal(result.session.trusted, false);
  assert.equal(result.session.bootable, false);
});

test("cover failure can finish with a placeholder or succeed on retry", () => {
  let session = createSlotInstallSession(2);
  for (const event of [
    { type: "validation-complete" },
    { type: "begin" },
    { type: "app-written" },
    { type: "app-verified" },
    { type: "trust-written" },
    { type: "cover-write-failed", error: "timeout" },
  ]) session = reduceSlotInstall(session, event);
  const placeholder = reduceSlotInstall(session, { type: "finish-without-cover" });
  assert.equal(placeholder.phase, "completed");
  assert.equal(placeholder.usePlaceholder, true);
  const retried = reduceSlotInstall(session, { type: "cover-retry-succeeded" });
  assert.equal(retried.phase, "completed");
  assert.equal(retried.usePlaceholder, false);
});
