const PROTECTED_WRITE = Symbol("protected-serial-write");
const PROTECTED_READ = Symbol("protected-serial-read");
const PROTECTED_FLASH_READ = Symbol("protected-flash-read");
const ACTIVE_READ_BAUD = Symbol("active-read-baud");
const UNSAFE_READ_BAUD = Symbol("unsafe-read-baud");
const FLASH_READ_BLOCK_SIZE = 4096;
const FLASH_READ_MAX_IN_FLIGHT = 1;
const FLASH_READ_PACKET_TIMEOUT_MS = 10000;
const PASSPORT_FLASH_SIZE = 0x800000;
const SERIAL_RECEIVE_LIMIT = 1024 * 1024;
const SLIP_PACKET_LIMIT = 64 * 1024;

// Use only around a complete App read AND its verification. A failed Stub
// command/read leaves the link state unknown: reconnect rather than attempting
// another command (including a baud restore) through that session.
export async function withFlashReadBaud(loader, baudrate, action, onBaudChanged = null) {
  if (!loader?.IS_STUB || typeof loader.changeBaud !== "function") {
    throw new Error("App 高速读回需要已连接的 Stub 下载会话。");
  }
  if (!Number.isSafeInteger(baudrate) || baudrate <= 0 || typeof action !== "function" ||
      (onBaudChanged !== null && typeof onBaudChanged !== "function")) {
    throw new Error("App 读回速率或回调无效。");
  }
  if (loader[UNSAFE_READ_BAUD]) {
    const error = new Error("串口速率切换会话已失效，请重新连接设备后重试。");
    error.code = "FLASH_READ_FAILED";
    throw error;
  }
  if (loader[ACTIVE_READ_BAUD]) throw new Error("App 速率切换读回已在进行中。");
  const originalBaud = loader.transport?.baudrate;
  if (!Number.isSafeInteger(originalBaud) || originalBaud <= 0) {
    throw new Error("无法确认当前串口速率，请重新连接设备。");
  }
  let linkProbe;
  const changeBaud = async (nextBaud) => {
    const originalRomBaud = loader.romBaudrate;
    // esptool-js 0.6.1 uses romBaudrate as the Stub command's old-rate field.
    // On the return trip that field must be 230400, not the initial ROM rate.
    loader.romBaudrate = loader.transport.baudrate;
    loader.baudrate = nextBaud;
    try {
      await loader.changeBaud();
      if (loader.transport.baudrate !== nextBaud) throw new Error("串口未恢复到目标速率。");
      // Opening the host port does not prove the Stub received the new rate.
      // Confirm both trips with a tiny read-only partition-header comparison
      // before returning to any metadata/cover/directory writes.
      const actual = await loader.readFlash(0x8000, 32);
      if (actual.length !== linkProbe.length || actual.some((value, index) => value !== linkProbe[index])) {
        throw new Error("速率切换后的分区表头读回不一致。");
      }
    } catch (cause) {
      loader[UNSAFE_READ_BAUD] = true;
      const error = new Error(`App 读回速率切换至 ${nextBaud} 失败：${cause.message}；请重新连接设备。`, { cause });
      error.code = "FLASH_READ_FAILED";
      throw error;
    } finally {
      loader.romBaudrate = originalRomBaud;
    }
  };
  loader[ACTIVE_READ_BAUD] = true;
  let switched = false;
  let failure;
  try {
    if (baudrate !== originalBaud) {
      linkProbe = await loader.readFlash(0x8000, 32);
      await changeBaud(baudrate);
      switched = true;
      onBaudChanged?.(baudrate);
    }
    return await action();
  } catch (error) {
    failure = error;
    if (error?.code === "FLASH_READ_FAILED") loader[UNSAFE_READ_BAUD] = true;
    throw error;
  } finally {
    try {
      if (switched && !loader[UNSAFE_READ_BAUD]) {
        try {
          await changeBaud(originalBaud);
          onBaudChanged?.(originalBaud);
        } catch (error) {
          if (failure) error.message += ` 原校验错误：${failure.message}`;
          throw error;
        }
      }
    } finally {
      loader[ACTIVE_READ_BAUD] = false;
    }
  }
}

export function protectTransportReads(transport) {
  if (!transport || transport[PROTECTED_READ]) return transport;

  // Retain received chunks instead of concatenating the pending input. Only
  // peek() materializes a snapshot for the loader's boot-mode diagnostics.
  let head = null;
  let tail = null;
  let available = 0;
  let wake = null;
  let failure = null;
  let activeRead = false;
  let activeLoop = null;
  let flushGeneration = 0;
  const initialBuffer = transport.buffer;
  const originalConnect = transport.connect.bind(transport);
  const originalDisconnect = transport.disconnect.bind(transport);
  const now = () => performance.now();
  const notify = () => wake?.();
  const clear = () => { head = tail = null; available = 0; };
  const enqueue = (bytes) => {
    if (!(bytes instanceof Uint8Array)) throw new Error("Serial receive data is not a byte array.");
    if (available + bytes.length > SERIAL_RECEIVE_LIMIT) throw new Error("Serial receive buffer limit exceeded.");
    if (!bytes.length) return;
    const chunk = { bytes, offset: 0, next: null };
    if (tail) tail.next = chunk; else head = chunk;
    tail = chunk;
    available += bytes.length;
    notify();
  };
  transport.peek = () => {
    const snapshot = new Uint8Array(available);
    let offset = 0;
    for (let chunk = head; chunk; chunk = chunk.next) {
      const bytes = chunk.bytes.subarray(chunk.offset);
      snapshot.set(bytes, offset);
      offset += bytes.length;
    }
    return snapshot;
  };
  transport.inWaiting = () => available;
  transport.flushInput = () => { clear(); flushGeneration += 1; notify(); };
  Object.defineProperty(transport, "buffer", {
    configurable: true,
    get: () => transport.peek(),
    set: (bytes) => { transport.flushInput(); enqueue(bytes); },
  });
  if (initialBuffer?.length) enqueue(initialBuffer);

  // ESPLoader starts this loop without awaiting it. Always resolve the loop,
  // but propagate receive failures to read(); never hide corrupted input.
  transport.readLoop = () => {
    if (activeLoop) return activeLoop;
    if (failure) return Promise.resolve();
    const operation = (async () => {
      let reader;
      try {
        if (!transport.device?.readable) throw new Error("Serial input stream is closed.");
        reader = transport.device.readable.getReader();
        transport.reader = reader;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) throw new Error("Serial input stream is closed.");
          enqueue(value);
        }
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error(String(error));
      } finally {
        reader?.releaseLock();
        if (transport.reader === reader) transport.reader = undefined;
        notify();
      }
    })();
    activeLoop = operation;
    operation.then(() => { if (activeLoop === operation) activeLoop = null; });
    return operation;
  };
  transport.connect = async (...args) => {
    await originalConnect(...args);
    transport.flushInput();
    failure = null;
  };
  transport.disconnect = async (...args) => {
    failure ??= new Error("Serial input stream is closed.");
    clear();
    notify();
    await originalDisconnect(...args);
    await activeLoop;
  };

  transport.read = async (timeout) => {
    if (activeRead) throw new Error("Serial packet read is already active.");
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("Invalid serial read timeout.");
    activeRead = true;
    const generation = flushGeneration;
    const deadline = now() + timeout;
    let packet = new Uint8Array(FLASH_READ_BLOCK_SIZE);
    let length = 0;
    let started = false;
    let escaped = false;
    try {
      for (;;) {
        if (generation !== flushGeneration) throw new Error("Serial input was flushed during a packet read.");
        if (failure) throw failure;
        const remaining = deadline - now();
        if (remaining <= 0) throw new Error("Serial packet read timeout; incomplete or missing data.");
        if (!head) {
          // One timeout per wait, no 1 ms polling. Incoming data, flush, and
          // disconnect all wake the same waiter and clear its timer.
          await new Promise((resolve) => {
            const timer = setTimeout(() => wake?.(), remaining);
            wake = () => { clearTimeout(timer); wake = null; resolve(); };
          });
          continue;
        }
        const chunk = head;
        while (chunk.offset < chunk.bytes.length) {
          let byte = chunk.bytes[chunk.offset++];
          available -= 1;
          if (!started) {
            if (byte !== 0xc0) {
              transport.detectPanicHandler?.(chunk.bytes);
              throw new Error(`Invalid head of packet (0x${byte.toString(16)}): Possible serial noise or corruption.`);
            }
            started = true;
            continue;
          }
          if (escaped) {
            escaped = false;
            if (byte === 0xdc) byte = 0xc0;
            else if (byte === 0xdd) byte = 0xdb;
            else throw new Error(`Invalid SLIP escape (0xdb, 0x${byte.toString(16)})`);
          } else if (byte === 0xdb) {
            escaped = true;
            continue;
          } else if (byte === 0xc0) {
            if (chunk.offset === chunk.bytes.length) {
              head = chunk.next;
              if (!head) tail = null;
            }
            const result = length === packet.length ? packet : packet.slice(0, length);
            if (transport.tracing) transport.trace(`Received full packet: ${transport.hexConvert(result)}`);
            return result;
          }
          if (length === SLIP_PACKET_LIMIT) throw new Error("Serial SLIP packet size limit exceeded.");
          if (length === packet.length) {
            const grown = new Uint8Array(Math.min(packet.length * 2, SLIP_PACKET_LIMIT));
            grown.set(packet);
            packet = grown;
          }
          packet[length++] = byte;
        }
        head = chunk.next;
        if (!head) tail = null;
      }
    } finally {
      activeRead = false;
    }
  };
  Object.defineProperty(transport, PROTECTED_READ, { value: true });
  return transport;
}

export function protectTransportWrites(transport) {
  if (!transport || transport[PROTECTED_WRITE]) return transport;

  let writeQueue = Promise.resolve();
  transport.write = (data) => {
    const operation = writeQueue.catch(() => {}).then(async () => {
      const writable = transport.device?.writable;
      if (!writable) throw new Error("串口写入流已关闭，请重新连接设备。");

      const outData = transport.slipWriter(data);
      const writer = writable.getWriter();
      try {
        if (transport.tracing) {
          transport.trace(`Write ${outData.length} bytes: ${transport.hexConvert(outData)}`);
        }
        await writer.write(outData);
      } finally {
        writer.releaseLock();
      }
    });
    writeQueue = operation.catch(() => {});
    return operation;
  };
  Object.defineProperty(transport, PROTECTED_WRITE, { value: true });
  return transport;
}

export function protectLoaderFlashReads(loader) {
  if (!loader || loader[PROTECTED_FLASH_READ]) return loader;

  let readQueue = Promise.resolve();
  let sessionFailed = false;
  // esptool-js 0.6.1 readFlash allows 1024 outstanding 4 KiB packets and
  // reallocates the entire result per packet. Native USB can overwhelm the
  // browser before it catches up. Use the same Stub protocol with one packet
  // in flight, cumulative ACKs, and a single exact-size output allocation.
  loader.readFlash = (address, length, onPacketReceived = null) => {
    const operation = readQueue.catch(() => {}).then(async () => {
      if (sessionFailed || loader[UNSAFE_READ_BAUD]) {
        const error = new Error("串口读回会话已失步，请重新连接设备后重试。");
        error.code = "FLASH_READ_FAILED";
        throw error;
      }
      if (!Number.isSafeInteger(address) || !Number.isSafeInteger(length) ||
          address < 0 || length < 0 || address + length > PASSPORT_FLASH_SIZE) {
        throw new Error("READ_FLASH 范围无效或超出设备 Flash。");
      }
      if (onPacketReceived !== null && typeof onPacketReceived !== "function") {
        throw new Error("READ_FLASH 进度回调无效。");
      }
      if (!loader.IS_STUB) throw new Error("READ_FLASH 需要已连接的 Stub 下载会话。");
      if (length === 0) return new Uint8Array(0);
      const data = new Uint8Array(length);
      const request = new Uint8Array(16);
      const requestView = new DataView(request.buffer);
      [address, length, FLASH_READ_BLOCK_SIZE, FLASH_READ_MAX_IN_FLIGHT]
        .forEach((value, index) => requestView.setUint32(index * 4, value, true));
      const timeout = Math.min(loader.FLASH_READ_TIMEOUT, FLASH_READ_PACKET_TIMEOUT_MS);
      let received = 0;
      try {
        const status = await loader.checkCommand("read flash", loader.ESP_READ_FLASH, request);
        if (status !== 0) throw new Error(`READ_FLASH 命令失败：${status}`);
        while (received < length) {
          const packet = await loader.transport.read(timeout);
          const expected = Math.min(FLASH_READ_BLOCK_SIZE, length - received);
          if (!(packet instanceof Uint8Array) || packet.length !== expected) {
            throw new Error(`READ_FLASH 数据包无效：预期 ${expected} 字节，实际 ${packet?.length ?? 0} 字节。`);
          }
          data.set(packet, received);
          received += packet.length;
          const acknowledgement = new Uint8Array(4);
          new DataView(acknowledgement.buffer).setUint32(0, received, true);
          await loader.transport.write(acknowledgement);
          onPacketReceived?.(packet, received, length);
        }
        const trailer = await loader.transport.read(timeout);
        if (!(trailer instanceof Uint8Array) || trailer.length !== 16) {
          throw new Error(`READ_FLASH 结束包无效：预期 16 字节 MD5，实际 ${trailer?.length ?? 0} 字节。`);
        }
        return data;
      } catch (cause) {
        // A failed packet/ACK/trailer leaves the Stub state unknown. Never
        // issue another command through this loader, even from a queued read.
        sessionFailed = true;
        const error = new Error(`READ_FLASH 0x${address.toString(16)}，已接收 ${received}/${length} bytes：${cause.message}`, { cause });
        error.code = "FLASH_READ_FAILED";
        throw error;
      }
    });
    readQueue = operation.catch(() => {});
    return operation;
  };
  Object.defineProperty(loader, PROTECTED_FLASH_READ, { value: true });
  return loader;
}
