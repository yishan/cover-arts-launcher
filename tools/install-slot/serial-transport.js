const PROTECTED_WRITE = Symbol("protected-serial-write");
const PROTECTED_FLASH_READ = Symbol("protected-flash-read");

export function protectTransportWrites(transport) {
  if (!transport || transport[PROTECTED_WRITE]) return transport;

  let writeQueue = Promise.resolve();
  transport.write = (data) => {
    const operation = writeQueue.catch(() => {}).then(async () => {
      const writable = transport.device?.writable;
      if (!writable) return;

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

  const readFlash = loader.readFlash.bind(loader);
  let readQueue = Promise.resolve();
  loader.readFlash = (...args) => {
    const operation = readQueue.catch(() => {}).then(async () => {
      const data = await readFlash(...args);
      const trailer = await loader.transport.read(loader.FLASH_READ_TIMEOUT);
      if (!(trailer instanceof Uint8Array) || trailer.length !== 16) {
        throw new Error(`READ_FLASH 结束包无效：预期 16 字节 MD5，实际 ${trailer?.length ?? 0} 字节。`);
      }
      return data;
    });
    readQueue = operation.catch(() => {});
    return operation;
  };
  Object.defineProperty(loader, PROTECTED_FLASH_READ, { value: true });
  return loader;
}
