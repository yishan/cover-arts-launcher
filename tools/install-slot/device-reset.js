const DEFAULT_RESET_HOLD_MS = 100;
const DEFAULT_BOOT_WAIT_MS = 800;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function resetToApplication(transport, {
  resetHoldMs = DEFAULT_RESET_HOLD_MS,
  bootWaitMs = DEFAULT_BOOT_WAIT_MS,
  wait = sleep,
} = {}) {
  if (!transport || typeof transport.setRTS !== "function") {
    throw new Error("串口传输未连接，无法重启设备。");
  }

  // Keep the ESP32-C3 download strap released, then reproduce esptool.py's
  // hard-reset pulse. esptool-js 0.6.1 only releases RTS in after("hard_reset"),
  // so it does not restart a device that is still running the ROM downloader.
  if (typeof transport.setDTR === "function") await transport.setDTR(false);
  await transport.setRTS(true);
  try {
    await wait(resetHoldMs);
  } finally {
    await transport.setRTS(false);
  }
  await wait(bootWaitMs);
}
