import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ESPLoader, Transport } from "./vendor/esptool-js-0.6.1.js";

import * as serialTransport from "./serial-transport.js";

const { protectTransportWrites } = serialTransport;

function makeBaudLoader() {
  const events = [];
  const loader = {
    IS_STUB: true,
    baudrate: 115200,
    romBaudrate: 115200,
    transport: { baudrate: 115200 },
    async changeBaud() {
      events.push(["change", this.romBaudrate, this.baudrate]);
      this.transport.baudrate = this.baudrate;
    },
    async readFlash(address, length) {
      assert.equal(address, 0x8000);
      assert.equal(length, 32);
      events.push(["probe", this.transport.baudrate]);
      return new Uint8Array(length).fill(0xaa);
    },
  };
  return { loader, events };
}

test("App readback changes to 230400, verifies at that rate, then confirms 115200 before writing", async () => {
  const { loader, events } = makeBaudLoader();
  const notices = [];
  const result = await serialTransport.withFlashReadBaud(loader, 230400, async () => {
    assert.equal(loader.transport.baudrate, 230400);
    assert.equal(loader.romBaudrate, 115200);
    events.push(["read App"]);
    await Promise.resolve();
    events.push(["SHA and structure"]);
    return "verified";
  }, (baudrate) => notices.push(baudrate));
  assert.equal(result, "verified");
  assert.deepEqual(events, [
    ["probe", 115200], ["change", 115200, 230400], ["probe", 230400],
    ["read App"], ["SHA and structure"], ["change", 230400, 115200], ["probe", 115200],
  ]);
  assert.deepEqual(notices, [230400, 115200]);
  assert.equal(loader.transport.baudrate, 115200);
  assert.equal(loader.baudrate, 115200);
  assert.equal(loader.romBaudrate, 115200);
});

test("consecutive App readbacks each use the actual old Stub rate on both trips", async () => {
  const { loader, events } = makeBaudLoader();
  for (let index = 0; index < 2; index++) {
    await serialTransport.withFlashReadBaud(loader, 230400, async () => {});
  }
  assert.deepEqual(events.filter(([event]) => event === "change"), [
    ["change", 115200, 230400], ["change", 230400, 115200],
    ["change", 115200, 230400], ["change", 230400, 115200],
  ]);
});

test("SHA failure still restores a healthy link and retains the verification error", async () => {
  const { loader } = makeBaudLoader();
  const failure = new Error("App SHA mismatch");
  await assert.rejects(serialTransport.withFlashReadBaud(loader, 230400, async () => { throw failure; }),
    (error) => error === failure);
  assert.equal(loader.transport.baudrate, 115200);
  await serialTransport.withFlashReadBaud(loader, 230400, async () => {});
});

test("failed upshift never reads the App or tries restoring through an unknown session", async () => {
  const { loader, events } = makeBaudLoader();
  loader.changeBaud = async () => { events.push(["failed change"]); throw new Error("USB disconnected"); };
  await assert.rejects(serialTransport.withFlashReadBaud(loader, 230400,
    async () => assert.fail("App read must not start")), (error) => {
    assert.equal(error.code, "FLASH_READ_FAILED");
    assert.match(error.message, /230400.*USB disconnected/);
    return true;
  });
  assert.deepEqual(events, [["probe", 115200], ["failed change"]]);
  await assert.rejects(serialTransport.withFlashReadBaud(loader, 230400, async () => {}), /重新连接/);
  assert.equal(events.length, 2);
});

test("failed App read does not send a restore command into a desynchronized Stub", async () => {
  const { loader, events } = makeBaudLoader();
  const failure = Object.assign(new Error("READ_FLASH timeout"), { code: "FLASH_READ_FAILED" });
  await assert.rejects(serialTransport.withFlashReadBaud(loader, 230400, async () => { throw failure; }),
    (error) => error === failure);
  assert.deepEqual(events, [["probe", 115200], ["change", 115200, 230400], ["probe", 230400]]);
  await assert.rejects(serialTransport.withFlashReadBaud(loader, 230400, async () => {}), /重新连接/);
});

test("failed restore prevents a verified App from reaching metadata/directory writes", async () => {
  const { loader, events } = makeBaudLoader();
  const change = loader.changeBaud.bind(loader);
  loader.changeBaud = async () => {
    if (loader.baudrate === 115200) throw new Error("restore failed");
    await change();
  };
  await assert.rejects((async () => {
    await serialTransport.withFlashReadBaud(loader, 230400, async () => "verified");
    assert.fail("metadata/directory writes must not start");
  })(), (error) => {
    assert.equal(error.code, "FLASH_READ_FAILED");
    assert.match(error.message, /115200.*restore failed/);
    return true;
  });
  assert.equal(loader.romBaudrate, 115200);
  await assert.rejects(serialTransport.withFlashReadBaud(loader, 230400, async () => {}), /重新连接/);
  assert.equal(events.filter(([event]) => event === "change").length, 1);
});

test("restore failure preserves the original SHA failure for diagnosis", async () => {
  const { loader } = makeBaudLoader();
  const change = loader.changeBaud.bind(loader);
  loader.changeBaud = async () => {
    if (loader.baudrate === 115200) throw new Error("restore failed");
    await change();
  };
  await assert.rejects(serialTransport.withFlashReadBaud(loader, 230400,
    async () => { throw new Error("App SHA mismatch"); }), /restore failed.*App SHA mismatch/);
});

for (const direction of ["upshift", "restore"]) {
  test(`a host-opened port with a corrupted ${direction} probe is not considered usable`, async () => {
    const { loader, events } = makeBaudLoader();
    let probes = 0;
    const read = loader.readFlash.bind(loader);
    loader.readFlash = async (...args) => {
      const bytes = await read(...args);
      if (++probes === (direction === "upshift" ? 2 : 3)) bytes[0] ^= 1;
      return bytes;
    };
    await assert.rejects(serialTransport.withFlashReadBaud(loader, 230400, async () => {
      if (direction === "upshift") assert.fail("App must not be read");
    }), (error) => error.code === "FLASH_READ_FAILED" && /表头读回不一致/.test(error.message));
    assert.equal(events.filter(([event]) => event === "change").length, direction === "upshift" ? 1 : 2);
  });
}

test("same-rate operation skips reopen, and invalid/overlapping scopes issue no rate command", async () => {
  const { loader, events } = makeBaudLoader();
  assert.equal(await serialTransport.withFlashReadBaud(loader, 115200, async () => 42), 42);
  assert.deepEqual(events, []);
  for (const rate of [0, -1, 1.5, NaN]) {
    await assert.rejects(serialTransport.withFlashReadBaud(loader, rate, async () => {}), /无效/);
  }
  await assert.rejects(serialTransport.withFlashReadBaud({ ...loader, IS_STUB: false }, 230400, async () => {}), /Stub/);
  await serialTransport.withFlashReadBaud(loader, 230400, async () => {
    await assert.rejects(serialTransport.withFlashReadBaud(loader, 230400, async () => {}), /进行中/);
  });
  assert.equal(events.filter(([event]) => event === "change").length, 2);
});

function makeReceiveTransport() {
  let controller;
  const device = {
    readable: new ReadableStream({ start(value) { controller = value; } }),
    writable: null,
    async open() {},
    async close() { assert.equal(this.readable.locked, false); },
  };
  const transport = new Transport(device, false);
  assert.equal(typeof serialTransport.protectTransportReads, "function");
  serialTransport.protectTransportReads(transport);
  return {
    transport,
    device,
    enqueue: (bytes) => controller.enqueue(bytes),
    close: () => controller.close(),
    fail: (error) => controller.error(error),
  };
}

test("actual vendored baud switching reopens protected streams twice and leaves subsequent reads at 115200", async () => {
  let controller;
  let transport;
  let hostBaud;
  let stubBaud = 115200;
  let data;
  let cursor = 0;
  let active = false;
  const changes = [];
  const opens = [];
  const app = new Uint8Array(1238288).map((_, index) => (index * 17 + (index >> 12)) & 0xff);
  const send = (bytes) => controller.enqueue(transport.slipWriter(bytes));
  const respond = (opcode) => send(new Uint8Array([1, opcode, 2, 0, 0, 0, 0, 0, 0, 0]));
  const next = () => {
    if (cursor < data.length) send(data.subarray(cursor, Math.min(cursor + 4096, data.length)));
    else { send(new Uint8Array(16)); active = false; }
  };
  const device = {
    readable: null,
    writable: null,
    getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    async open({ baudRate }) {
      hostBaud = baudRate;
      opens.push(baudRate);
      this.readable = new ReadableStream({ start(value) { controller = value; } });
      this.writable = new WritableStream({
        write(frame) {
          const decoded = [];
          for (let index = 1; index < frame.length - 1; index++) {
            const byte = frame[index];
            decoded.push(byte === 0xdb ? (frame[++index] === 0xdc ? 0xc0 : 0xdb) : byte);
          }
          const bytes = Uint8Array.from(decoded);
          const view = new DataView(bytes.buffer);
          assert.equal(hostBaud, stubBaud, "host and Stub rates must agree before every command/ACK");
          if (bytes.length === 4) {
            assert.equal(active, true);
            cursor = Math.min(cursor + 4096, data.length);
            assert.equal(view.getUint32(0, true), cursor);
            next();
          } else if (bytes[1] === 0x0f) {
            assert.equal(active, false, "baud switch must follow the consumed MD5 trailer");
            const newBaud = view.getUint32(8, true);
            const oldBaud = view.getUint32(12, true);
            assert.equal(oldBaud, stubBaud);
            changes.push([oldBaud, newBaud]);
            respond(0x0f);
            stubBaud = newBaud;
          } else {
            assert.equal(bytes[1], 0xd2, "the test never sends a Flash write/erase command");
            assert.equal(active, false);
            const address = view.getUint32(8, true);
            const length = view.getUint32(12, true);
            assert.equal(view.getUint32(16, true), 4096);
            assert.equal(view.getUint32(20, true), 1);
            data = address === 0x8000 ? new Uint8Array(length).fill(0xaa) : app.subarray(0, length);
            cursor = 0;
            active = true;
            respond(0xd2);
            next();
          }
        },
      });
    },
    async close() {
      assert.equal(this.readable.locked, false);
      assert.equal(this.writable.locked, false);
      this.readable = this.writable = null;
    },
  };
  transport = serialTransport.protectTransportReads(protectTransportWrites(new Transport(device, false)));
  const loader = serialTransport.protectLoaderFlashReads(new ESPLoader({
    transport, baudrate: 115200, terminal: { clean() {}, write() {}, writeLine() {} },
  }));
  loader.IS_STUB = true;
  await transport.connect(115200);
  transport.readLoop();
  try {
    for (let index = 0; index < 2; index++) {
      const bytes = await serialTransport.withFlashReadBaud(loader, 230400, async () => {
        const readback = await loader.readFlash(0x100000, app.length);
        assert.equal(createHash("sha256").update(readback).digest("hex"), createHash("sha256").update(app).digest("hex"));
        return readback;
      });
      assert.deepEqual(bytes, app);
      assert.equal(transport.baudrate, 115200);
      assert.equal(loader.romBaudrate, 115200);
      assert.deepEqual(await loader.readFlash(0x8000, 32), new Uint8Array(32).fill(0xaa));
    }
    assert.deepEqual(changes, [[115200, 230400], [230400, 115200], [115200, 230400], [230400, 115200]]);
    assert.deepEqual(opens, [115200, 230400, 115200, 230400, 115200]);
  } finally { await transport.disconnect(); }
});

test("event-driven transport decodes byte-fragmented SLIP and retains following frames", async () => {
  const { transport, enqueue, close } = makeReceiveTransport();
  const loop = transport.readLoop();
  const payload = new Uint8Array([1, 0xc0, 2, 0xdb, 3]);
  const frame = transport.slipWriter(payload);
  const result = transport.read(1000);
  for (const byte of frame) { enqueue(new Uint8Array([byte])); await Promise.resolve(); }
  enqueue(transport.slipWriter(new Uint8Array([9, 8])));
  assert.deepEqual(await result, payload);
  assert.deepEqual(await transport.read(1000), new Uint8Array([9, 8]));
  close();
  await loop;
  assert.equal(transport.device.readable.locked, false);
});

test("event-driven transport preserves peek, inWaiting, buffer assignment and flush", async () => {
  const { transport } = makeReceiveTransport();
  transport.buffer = new Uint8Array([1, 2]);
  assert.equal(transport.inWaiting(), 2);
  assert.deepEqual(transport.peek(), new Uint8Array([1, 2]));
  transport.flushInput();
  assert.equal(transport.inWaiting(), 0);
  transport.buffer = transport.slipWriter(new Uint8Array([4]));
  assert.deepEqual(await transport.read(100), new Uint8Array([4]));
  assert.equal(transport.inWaiting(), 0);
});

test("event-driven transport consumes coalesced frames without polling or losing the remainder", async () => {
  const { transport } = makeReceiveTransport();
  transport.buffer = new Uint8Array([0xc0, 1, 0xc0, 0xc0, 2, 0xc0, 0xc0, 0xc0]);
  const originalTimer = globalThis.setTimeout;
  globalThis.setTimeout = () => { throw new Error("buffered packets must not poll"); };
  try {
    assert.deepEqual(await transport.read(1000), new Uint8Array([1]));
    assert.deepEqual(transport.peek(), new Uint8Array([0xc0, 2, 0xc0, 0xc0, 0xc0]));
    assert.deepEqual(await transport.read(1000), new Uint8Array([2]));
    assert.deepEqual(await transport.read(1000), new Uint8Array(0));
    assert.equal(transport.inWaiting(), 0);
  } finally { globalThis.setTimeout = originalTimer; }
});

test("event-driven transport wakes immediately on closed or failed input and releases its reader", async () => {
  for (const failure of [null, new Error("USB disconnected")]) {
    const { transport, close, fail } = makeReceiveTransport();
    const loop = transport.readLoop();
    const pending = assert.rejects(transport.read(10000), failure ? /USB disconnected/ : /closed/i);
    if (failure) fail(failure); else close();
    await pending;
    await loop;
    assert.equal(transport.device.readable.locked, false);
  }
});

test("event-driven transport rejects overlapping reads and cleans up timeouts", async () => {
  const { transport } = makeReceiveTransport();
  const pending = assert.rejects(transport.read(5), /timeout/i);
  await assert.rejects(transport.read(1000), /already active/i);
  await pending;
  transport.buffer = transport.slipWriter(new Uint8Array([7]));
  assert.deepEqual(await transport.read(1000), new Uint8Array([7]));
});

test("event-driven transport applies one deadline to a fragmented packet", async () => {
  const { transport, enqueue, close } = makeReceiveTransport();
  const loop = transport.readLoop();
  const pending = assert.rejects(transport.read(25), /timeout/i);
  enqueue(new Uint8Array([0xc0, 1]));
  const timer = setInterval(() => enqueue(new Uint8Array([2])), 5);
  try { await pending; } finally { clearInterval(timer); close(); await loop; }
});

test("event-driven transport rejects invalid SLIP and excessive packets without per-byte concatenation", async () => {
  const { transport } = makeReceiveTransport();
  transport.appendArray = () => { throw new Error("quadratic concatenation must not run"); };
  for (const [bytes, pattern] of [
    [new Uint8Array([1, 2]), /Invalid head/],
    [new Uint8Array([0xc0, 0xdb, 0xaa]), /Invalid SLIP escape/],
    [new Uint8Array([0xc0, ...new Uint8Array(65537).fill(1)]), /packet.*limit/i],
  ]) {
    transport.buffer = bytes;
    await assert.rejects(transport.read(1000), pattern);
  }
  const payload = new Uint8Array(4096).map((_, index) => index & 0xff);
  transport.buffer = transport.slipWriter(payload);
  assert.deepEqual(await transport.read(1000), payload);
});

test("event-driven transport flush cancels a pending decoder without leaving a waiter", async () => {
  const { transport } = makeReceiveTransport();
  const pending = assert.rejects(transport.read(10000), /flushed/i);
  transport.flushInput();
  await pending;
  transport.buffer = transport.slipWriter(new Uint8Array([6]));
  assert.deepEqual(await transport.read(1000), new Uint8Array([6]));
});

test("event-driven transport has one reader loop and survives cancel/disconnect/reconnect", async () => {
  const { transport, device } = makeReceiveTransport();
  const loop = transport.readLoop();
  assert.equal(transport.readLoop(), loop);
  const pending = assert.rejects(transport.read(10000), /closed/i);
  await transport.disconnect();
  await pending;
  await loop;
  assert.equal(device.readable.locked, false);
  let controller;
  device.readable = new ReadableStream({ start(value) { controller = value; } });
  await transport.connect(115200);
  const newLoop = transport.readLoop();
  controller.enqueue(transport.slipWriter(new Uint8Array([5])));
  assert.deepEqual(await transport.read(1000), new Uint8Array([5]));
  controller.close();
  await newLoop;
});

test("event-driven receive protection is idempotent and caps queued input", async () => {
  const { transport, enqueue } = makeReceiveTransport();
  const originalRead = transport.read;
  assert.equal(serialTransport.protectTransportReads(transport), transport);
  assert.equal(transport.read, originalRead);
  const loop = transport.readLoop();
  enqueue(new Uint8Array(1024 * 1024 + 1));
  await loop;
  await assert.rejects(transport.read(1000), /receive.*limit/i);
  assert.equal(transport.device.readable.locked, false);
});

test("actual loader and optimized receive/write streams read a full App then metadata with single-packet ACKs", async () => {
  const fixture = makeReceiveTransport();
  const { transport, device, enqueue, close } = fixture;
  const app = new Uint8Array(1238288).map((_, index) => (index * 17 + (index >> 12)) & 0xff);
  let cursor = 0;
  let requested = 0;
  let active = false;
  let commands = 0;
  let acknowledgements = 0;
  const send = (payload) => {
    const frame = transport.slipWriter(payload);
    for (let offset = 0; offset < frame.length; offset += 97) enqueue(frame.subarray(offset, offset + 97));
  };
  const next = () => {
    if (cursor < requested) send(app.subarray(cursor, Math.min(cursor + 4096, requested)));
    else { send(new Uint8Array(16)); active = false; }
  };
  device.getInfo = () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 });
  device.writable = new WritableStream({
    write(frame) {
      assert.equal(frame[0], 0xc0);
      assert.equal(frame.at(-1), 0xc0);
      const decoded = [];
      for (let index = 1; index < frame.length - 1; index++) {
        const byte = frame[index];
        decoded.push(byte === 0xdb ? (frame[++index] === 0xdc ? 0xc0 : 0xdb) : byte);
      }
      const bytes = Uint8Array.from(decoded);
      const view = new DataView(bytes.buffer);
      if (bytes.length === 24) {
        assert.equal(active, false, "previous read must consume its trailing frame");
        assert.deepEqual([...bytes.subarray(0, 4)], [0, 0xd2, 16, 0]);
        requested = view.getUint32(12, true);
        assert.equal(view.getUint32(16, true), 4096);
        assert.equal(view.getUint32(20, true), 1);
        cursor = 0;
        active = true;
        commands += 1;
        send(new Uint8Array([1, 0xd2, 2, 0, 0, 0, 0, 0, 0, 0]));
      } else {
        assert.equal(bytes.length, 4);
        assert.equal(active, true);
        cursor = Math.min(cursor + 4096, requested);
        assert.equal(view.getUint32(0, true), cursor);
        acknowledgements += 1;
      }
      next();
    },
  });
  protectTransportWrites(transport);
  const loader = new ESPLoader({ transport, baudrate: 115200, terminal: { clean() {}, write() {}, writeLine() {} } });
  loader.IS_STUB = true;
  serialTransport.protectLoaderFlashReads(loader);
  const loop = transport.readLoop();
  try {
    const received = await loader.readFlash(0x100000, app.length);
    assert.deepEqual(received, app);
    assert.equal(createHash("sha256").update(received).digest("hex"), createHash("sha256").update(app).digest("hex"));
    assert.deepEqual(await loader.readFlash(0x8000, 256), app.slice(0, 256));
    assert.equal(commands, 2);
    assert.equal(acknowledgements, 304);
    assert.equal(transport.inWaiting(), 0);
    assert.equal(device.writable.locked, false);
  } finally { close(); await loop; }
});

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
  let cursor = 0;
  let length = 0;
  let address = 0;
  let blockSize = 0;
  let awaitingAck = false;
  const commands = [];
  const acknowledgements = [];
  const loader = {
    FLASH_READ_TIMEOUT: 2000,
    ESP_READ_FLASH: 0xd2,
    IS_STUB: true,
    transport: {
      async read() {
        if (awaitingAck) throw new Error("Stub requires acknowledgement before next packet");
        if (cursor < length) {
          const packet = new Uint8Array(Math.min(blockSize, length - cursor)).fill(address & 0xff);
          cursor += packet.length;
          awaitingAck = true;
          return packet;
        }
        const packet = trailingPackets.shift();
        if (!packet) throw new Error("missing trailing MD5");
        activeReads -= 1;
        return packet;
      },
      async write(bytes) {
        assert.equal(bytes.length, 4);
        const acknowledged = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
        assert.equal(acknowledged, cursor);
        acknowledgements.push(acknowledged);
        awaitingAck = false;
      },
    },
    async checkCommand(description, opcode, payload) {
      assert.equal(description, "read flash");
      assert.equal(opcode, 0xd2);
      if (trailingPackets.length) throw new Error("previous READ_FLASH MD5 was not consumed");
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      [address, length, blockSize] = [0, 4, 8].map((offset) => view.getUint32(offset, true));
      commands.push({ address, length, blockSize, maxInFlight: view.getUint32(12, true) });
      cursor = 0;
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await Promise.resolve();
      trailingPackets.push(new Uint8Array(16).fill(address & 0xff));
      return 0;
    },
    async readFlash() { throw new Error("unbounded vendor readFlash must not be used"); },
  };
  return { loader, trailingPackets, commands, acknowledgements, maxActiveReads: () => maxActiveReads };
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

test("large app readback uses one in-flight packet, exact length, and cumulative ACKs", async () => {
  const { loader, commands, acknowledgements, trailingPackets } = makeFlashLoader();
  serialTransport.protectLoaderFlashReads(loader);
  const progress = [];
  const length = 1238288;
  const data = await loader.readFlash(0x100055, length, (packet, received, total) => {
    progress.push({ packetLength: packet.length, received, total });
  });
  assert.deepEqual(commands, [{ address: 0x100055, length, blockSize: 4096, maxInFlight: 1 }]);
  assert.equal(data.length, length);
  assert.ok(data.every((value) => value === 0x55));
  assert.equal(acknowledgements.at(-1), length);
  assert.equal(progress.at(-1).received, length);
  assert.equal(progress.at(-1).total, length);
  assert.equal(progress.at(-1).packetLength, length % 4096);
  assert.equal(trailingPackets.length, 0);
});

test("readback timeout includes address and received bytes, and poisons the old session", async () => {
  const { loader, commands } = makeFlashLoader();
  const read = loader.transport.read.bind(loader.transport);
  let packets = 0;
  loader.transport.read = async (...args) => {
    if (++packets === 2) throw new Error("Serial data stream stopped: Possible serial noise or corruption.");
    return read(...args);
  };
  serialTransport.protectLoaderFlashReads(loader);
  await assert.rejects(loader.readFlash(0x100000, 9000), (error) => {
    assert.equal(error.code, "FLASH_READ_FAILED");
    assert.match(error.message, /0x100000/);
    assert.match(error.message, /4096\/9000/);
    assert.match(error.message, /Serial data stream stopped/);
    return true;
  });
  await assert.rejects(loader.readFlash(0x8000, 4096), /重新连接/);
  assert.equal(commands.length, 1);
});

for (const [name, packet] of [
  ["empty packet", new Uint8Array(0)],
  ["oversized packet", new Uint8Array(4097)],
  ["short non-final packet", new Uint8Array(100)],
  ["non-byte packet", "invalid"],
]) {
  test(`readback rejects ${name} before acknowledging it`, async () => {
    const { loader, acknowledgements } = makeFlashLoader();
    loader.transport.read = async () => packet;
    serialTransport.protectLoaderFlashReads(loader);
    await assert.rejects(loader.readFlash(0x100000, 9000), /READ_FLASH/);
    assert.equal(acknowledgements.length, 0);
  });
}

test("invalid MD5 trailer prevents readback success", async () => {
  const { loader, trailingPackets } = makeFlashLoader();
  const command = loader.checkCommand.bind(loader);
  loader.checkCommand = async (...args) => {
    await command(...args);
    trailingPackets[0] = new Uint8Array(15);
    return 0;
  };
  serialTransport.protectLoaderFlashReads(loader);
  await assert.rejects(loader.readFlash(0x8000, 4096), /结束包无效/);
});

test("zero-length reads and invalid ranges never issue a serial command", async () => {
  const { loader, commands } = makeFlashLoader();
  serialTransport.protectLoaderFlashReads(loader);
  assert.deepEqual(await loader.readFlash(0x8000, 0), new Uint8Array(0));
  for (const [address, length] of [[-1, 4], [0, -1], [0, 1.5], [0x7fffff, 2]]) {
    await assert.rejects(loader.readFlash(address, length), /范围/);
  }
  assert.equal(commands.length, 0);
});

test("protecting a loader twice does not duplicate the trailer read", async () => {
  const { loader, commands } = makeFlashLoader();
  serialTransport.protectLoaderFlashReads(loader);
  serialTransport.protectLoaderFlashReads(loader);
  await loader.readFlash(0x8000, 32);
  assert.equal(commands.length, 1);
});

test("a closed writable stream fails instead of silently dropping an ACK", async () => {
  const { transport } = makeTransport();
  transport.device.writable = null;
  protectTransportWrites(transport);
  await assert.rejects(transport.write(new Uint8Array([1])), /重新连接/);
});

test("ACK failure stops progress and rejects queued reads on the same session", async () => {
  const { loader, commands } = makeFlashLoader();
  loader.transport.write = async () => { throw new Error("ACK write failed"); };
  serialTransport.protectLoaderFlashReads(loader);
  let progress = 0;
  const results = await Promise.allSettled([
    loader.readFlash(0x100000, 9000, () => { progress += 1; }),
    loader.readFlash(0x8000, 4096),
  ]);
  assert.equal(results[0].status, "rejected");
  assert.match(results[0].reason.message, /ACK write failed/);
  assert.equal(results[1].status, "rejected");
  assert.match(results[1].reason.message, /重新连接/);
  assert.equal(progress, 0);
  assert.equal(commands.length, 1);
});

test("a rejected READ_FLASH command does not start receiving packets", async () => {
  const { loader } = makeFlashLoader();
  loader.checkCommand = async () => 1;
  loader.transport.read = async () => { assert.fail("no packet expected"); };
  serialTransport.protectLoaderFlashReads(loader);
  await assert.rejects(loader.readFlash(0x8000, 4096), /命令失败/);
});

test("bounded reader interoperates with the actual vendored ESPLoader command framing", async () => {
  const stub = makeFlashLoader();
  const responses = [];
  const transport = {
    getInfo: () => "mock Stub",
    async write(bytes) {
      if (bytes.length === 4) return stub.loader.transport.write(bytes);
      assert.equal(bytes.length, 24);
      assert.deepEqual([...bytes.subarray(0, 4)], [0, 0xd2, 16, 0]);
      await stub.loader.checkCommand("read flash", bytes[1], bytes.subarray(8));
      responses.push(new Uint8Array([1, 0xd2, 2, 0, 0, 0, 0, 0, 0, 0]));
    },
    async read(...args) {
      return responses.length ? responses.shift() : stub.loader.transport.read(...args);
    },
  };
  const loader = new ESPLoader({
    transport,
    baudrate: 115200,
    terminal: { clean() {}, write() {}, writeLine() {} },
  });
  loader.IS_STUB = true;
  serialTransport.protectLoaderFlashReads(loader);
  const bytes = await loader.readFlash(0x100042, 1238288);
  assert.equal(bytes.length, 1238288);
  assert.ok(bytes.every((value) => value === 0x42));
  assert.equal(stub.commands[0].maxInFlight, 1);
  assert.equal(stub.trailingPackets.length, 0);
});
