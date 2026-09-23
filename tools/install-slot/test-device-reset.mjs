import assert from "node:assert/strict";
import test from "node:test";

import { resetToApplication } from "./device-reset.js";

test("reset releases the download strap and pulses reset before boot wait", async () => {
  const events = [];
  const transport = {
    async setDTR(value) { events.push(`DTR:${value}`); },
    async setRTS(value) { events.push(`RTS:${value}`); },
  };

  await resetToApplication(transport, {
    resetHoldMs: 100,
    bootWaitMs: 800,
    async wait(milliseconds) { events.push(`WAIT:${milliseconds}`); },
  });

  assert.deepEqual(events, [
    "DTR:false",
    "RTS:true",
    "WAIT:100",
    "RTS:false",
    "WAIT:800",
  ]);
});

test("reset always releases RTS when the hold wait fails", async () => {
  const events = [];
  const expected = new Error("timer failed");
  const transport = {
    async setDTR(value) { events.push(`DTR:${value}`); },
    async setRTS(value) { events.push(`RTS:${value}`); },
  };

  await assert.rejects(resetToApplication(transport, {
    async wait() { throw expected; },
  }), expected);
  assert.deepEqual(events, ["DTR:false", "RTS:true", "RTS:false"]);
});

test("reset rejects a missing transport", async () => {
  await assert.rejects(resetToApplication(null), /串口传输未连接/);
});
