import assert from "node:assert/strict";
import test from "node:test";

import * as serialTransport from "./serial-transport.js";

const { protectTransportWrites } = serialTransport;

function makeTransport({ failFirstWrite = false } = {}) {
  let locked = false;
  let writes = 0;
  let activeWrites = 0;
  let maxActiveWrites = 0;
  const released = [];
  const writable = {
    get locked() { return locked; },
    getWriter() {
      if (locked) throw new TypeError("WritableStream is locked");
      locked = true;
      return {
        async write(data) {
          writes += 1;
          activeWrites += 1;
          maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
          await Promise.resolve();
          activeWrites -= 1;
          if (failFirstWrite && writes === 1) throw new Error("serial write failed");
          released.push([...data]);
        },
        releaseLock() { locked = false; },
      };
    },
  };
  return {
    transport: {
      device: { writable },
      tracing: false,
      slipWriter: (data) => new Uint8Array([0xc0, ...data, 0xc0]),
    },
    writable,
    released,
    maxActiveWrites: () => maxActiveWrites,
  };
}

test("protected transport releases the writer after a failed write", async () => {
  const { transport, writable } = makeTransport({ failFirstWrite: true });
  protectTransportWrites(transport);

  await assert.rejects(transport.write(new Uint8Array([1])), /serial write failed/);
  assert.equal(writable.locked, false);
  await transport.write(new Uint8Array([2]));
  assert.equal(writable.locked, false);
});

test("protected transport serializes overlapping writes", async () => {
  const { transport, released, maxActiveWrites } = makeTransport();
  protectTransportWrites(transport);

  await Promise.all([
    transport.write(new Uint8Array([1])),
    transport.write(new Uint8Array([2])),
  ]);

  assert.equal(maxActiveWrites(), 1);
  assert.deepEqual(released, [[0xc0, 1, 0xc0], [0xc0, 2, 0xc0]]);
});

function makeFlashLoader() {
  const trailingPackets = [];
  let activeReads = 0;
  let maxActiveReads = 0;
  const loader = {
    FLASH_READ_TIMEOUT: 2000,
    transport: {
      async read() {
        const packet = trailingPackets.shift();
        if (!packet) throw new Error("missing trailing MD5");
        return packet;
      },
    },
    async readFlash(address, length) {
      if (trailingPackets.length) throw new Error("previous READ_FLASH MD5 was not consumed");
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await Promise.resolve();
      activeReads -= 1;
      trailingPackets.push(new Uint8Array(16).fill(address & 0xff));
      return new Uint8Array(length).fill(address & 0xff);
    },
  };
  return { loader, trailingPackets, maxActiveReads: () => maxActiveReads };
}

test("protected flash read consumes the Stub MD5 trailer before the next command", async () => {
  assert.equal(typeof serialTransport.protectLoaderFlashReads, "function");
  const { loader, trailingPackets } = makeFlashLoader();
  serialTransport.protectLoaderFlashReads(loader);

  await loader.readFlash(0x8000, 16);
  assert.equal(trailingPackets.length, 0);
  await loader.readFlash(0x180000, 24);
  assert.equal(trailingPackets.length, 0);
});

test("protected flash reads never overlap on one serial loader", async () => {
  assert.equal(typeof serialTransport.protectLoaderFlashReads, "function");
  const { loader, maxActiveReads } = makeFlashLoader();
  serialTransport.protectLoaderFlashReads(loader);

  await Promise.all([
    loader.readFlash(0x1000, 16),
    loader.readFlash(0x2000, 16),
  ]);
  assert.equal(maxActiveReads(), 1);
});
