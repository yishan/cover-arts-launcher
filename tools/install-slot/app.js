import { ESPLoader, Transport } from "./vendor/esptool-js-0.6.1.js";
import { COVER_PAYLOAD_LENGTH, coverRgb565ToRgba, rgbaToCoverRgb565 } from "./cover-convert.js";
import { coverCropRect, encodeCoverPreview } from "./cover-image.js";
import { encodePartitionTable, espImageLength, extractAppImage, parsePartitionTable } from "./extract-app-image.js";
import { resetAndDisconnect, resetToApplication } from "./device-reset.js";
import { protectLoaderFlashReads, protectTransportReads, protectTransportWrites, withFlashReadBaud } from "./serial-transport.js";
import { managerApiUrl, normalizeOfficialPlay } from "./play-source.js";
import { PLAY_CATEGORIES, normalizeOfficialCatalog } from "./play-catalog.js";
import { inspectLauncherTitle, requireLauncherTitle } from "./title-font.js";
import {
  appendDynamicSlot,
  dynamicPartitionEntries,
  removeDynamicSlot,
} from "./dynamic-layout.js";
import {
  decodeDynamicSidecarRecord,
  dynamicCoverMatchesRecord,
  dynamicSidecarLayout,
  encodeDynamicSidecarRecord,
  reassignDynamicSidecarRecord,
} from "./dynamic-sidecar.js";
import { inspectDynamicLibraryFast } from "./dynamic-slot-inspector.js";
import { classifySystemTarget, makeEraseVerificationSamples, prepareDynamicSystemImage } from "./system-install.js";

const $ = (selector) => document.querySelector(selector);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
// Sustained Web Serial writes at 460800 are unreliable on the Passport's
// USB-JTAG bridge in Chromium-based browsers. Prefer a slower, stable session;
// this affects transfer time only, not the image written to flash.
const WEB_SERIAL_BAUDRATE = 115200;
const APP_READBACK_BAUDRATE = 230400;
const state = {
  port: null,
  transport: null,
  loader: null,
  target: null,
  library: null,
  slots: [],
  sourceKind: "play-api",
  preparedPlay: null,
  preparedCover: null,
  coverPreviewUrl: null,
  busy: false,
  coverBusy: false,
  catalogSelecting: false,
};

const catalog = {
  query: "",
  category: "all",
  plays: [],
  total: 0,
  hasMore: false,
  categoryCounts: {},
  loading: false,
  selectedId: null,
  requestId: 0,
};
let catalogQueryTimer = 0;

const terminal = {
  clean() {},
  write(value) { log(String(value), false); },
  writeLine(value) { log(String(value)); },
};

function log(message, newline = true) {
  const output = $("#log");
  if (output.textContent === "等待操作。") output.textContent = "";
  output.textContent += `${message}${newline ? "\n" : ""}`;
  output.scrollTop = output.scrollHeight;
}

function setResult(selector, message, kind = "") {
  const target = $(selector);
  target.textContent = message;
  target.className = `inline-message${kind ? ` ${kind}` : ""}`;
}

function setDeviceState(message, kind = "idle") {
  $("#device-status").textContent = message;
  document.querySelector(".device-dock").dataset.state = kind;
}

function updateTitleCheck() {
  const result = inspectLauncherTitle($("#play-title").value);
  const target = $("#title-check");
  if (result.empty) {
    target.textContent = "标题会显示在设备上；请输入内容。";
    target.className = "inline-message";
  } else if (result.valid) {
    target.textContent = `设备字体可完整显示 · UTF-8 ${result.bytes}/64 bytes`;
    target.className = "inline-message ok";
  } else if (result.tooLong) {
    target.textContent = `标题为 ${result.bytes} bytes，设备最多支持 64 bytes。`;
    target.className = "inline-message error";
  } else {
    const glyphs = result.unsupported.map(({ character, codePoint }) => `${character} (${codePoint})`).join("、");
    target.textContent = `设备字体未收录：${glyphs}`;
    target.className = "inline-message error";
  }
  return result.valid;
}

function scrollBehavior() {
  return reducedMotion.matches ? "auto" : "smooth";
}

function toHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function normalizeSha(value) {
  const result = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(result)) throw new Error("SHA-256 必须是 64 位十六进制。");
  return result;
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function allErased(bytes) {
  return bytes.every((value) => value === 0xff);
}

function writeU32(bytes, offset, value) {
  new DataView(bytes.buffer).setUint32(offset, value, true);
}

async function eraseRegion(address, size) {
  if ((address | size) % 0x1000 !== 0) throw new Error("Erase region must be 4 KiB aligned.");
  const payload = new Uint8Array(8);
  writeU32(payload, 0, address);
  writeU32(payload, 4, size);
  const timeout = Math.max(3000, state.loader.timeoutPerMb(state.loader.ERASE_REGION_TIMEOUT_PER_MB, size));
  await state.loader.checkCommand("erase region", state.loader.ESP_ERASE_REGION, payload, 0, undefined, timeout);
}

async function writeSegments(segments, progressLabel) {
  const total = segments.reduce((sum, segment) => sum + segment.data.length, 0);
  let completed = 0;
  for (const segment of segments) {
    log(`${progressLabel}: 写入 0x${segment.address.toString(16)}，${segment.data.length} bytes`);
    log(`${progressLabel}: 开始传输并等待 Flash 会话结束…`);
    await state.loader.writeFlash({
      fileArray: [{ data: segment.data, address: segment.address }],
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "8MB",
      eraseAll: false,
      compress: true,
      reportProgress: (_index, written) => {
        const percent = Math.min(100, Math.round((completed + written) / total * 100));
        setDeviceState(`${progressLabel} ${percent}%`, "working");
      },
    });
    log(`${progressLabel}: Flash 会话已结束。`);
    completed += segment.data.length;
  }
}

async function verifySegment(segment) {
  const actual = await state.loader.readFlash(segment.address, segment.data.length);
  if (!equalBytes(actual, segment.data)) throw new Error(`0x${segment.address.toString(16)} 写后读取不一致。`);
}

async function discardFailedReadSession(error) {
  if (error.code !== "FLASH_READ_FAILED") return;
  // Closing the broken session is not a reset or a directory repair. Keep the
  // prepared play/cover so the user can reconnect and retry the same input.
  await disconnect(false);
  setResult("#device-message", "串口读回被中断，失效连接已关闭。请重新连接设备后重试；无需重新读取玩法资料。", "error");
  log("已关闭失步的串口会话；未自动重启、清空设备或提交新目录。");
}

async function installPhase(label, action) {
  const started = performance.now();
  log(`[阶段] ${label}：开始`);
  try {
    const result = await action();
    log(`[阶段] ${label}：完成，${((performance.now() - started) / 1000).toFixed(3)} s`);
    return result;
  } catch (error) {
    log(`[阶段] ${label}：中断，${((performance.now() - started) / 1000).toFixed(3)} s`);
    throw error;
  }
}

async function readAppForVerification(address, length) {
  let loggedPercent = -25;
  setDeviceState("App 读回校验 0%", "working");
  return state.loader.readFlash(address, length, (_packet, received, total) => {
    const percent = Math.floor(received / total * 100);
    setDeviceState(`App 读回校验 ${percent}%`, "working");
    if (percent >= loggedPercent + 25 || percent === 100) {
      log(`App 读回：${received}/${total} bytes（${percent}%）`);
      loggedPercent = percent;
    }
  });
}

async function withAppReadbackRate(action) {
  return withFlashReadBaud(state.loader, APP_READBACK_BAUDRATE, action, (baudrate) => {
    log(baudrate === APP_READBACK_BAUDRATE
      ? `[速率] App 完整读回：${baudrate}。`
      : `[速率] 已恢复写入速率：${baudrate}。`);
  });
}

function samePartitionTable(actual, expected) {
  return actual.length === expected.length && actual.every((entry, index) => {
    const wanted = expected[index];
    return ["name", "type", "subtype", "offset", "size"].every((key) => entry[key] === wanted[key]);
  });
}

async function readTargetIdentity() {
  const description = await state.loader.main("default_reset");
  const chip = description.includes("ESP32-C3") ? "ESP32-C3" : description;
  const detectedSize = await state.loader.detectFlashSize();
  const flashSize = state.loader.flashSizeBytes(detectedSize);
  const partitionTableSector = await state.loader.readFlash(0x8000, 0x1000);
  return { chip, flashSize, partitionTableSector };
}

async function connect() {
  if (state.busy) return;
  state.busy = true;
  setResult("#device-message", "");
  setDeviceState("正在连接并识别设备…", "working");
  refreshActions();
  try {
    if (!navigator.serial) throw new Error("当前浏览器不支持 Web Serial。");
    log("请选择 AI Passport 串口；设备将进入下载模式。 ");
    state.port = await navigator.serial.requestPort();
    state.transport = protectTransportReads(protectTransportWrites(new Transport(state.port, false)));
    state.loader = protectLoaderFlashReads(new ESPLoader({
      transport: state.transport,
      baudrate: WEB_SERIAL_BAUDRATE,
      terminal,
    }));
    const identity = await readTargetIdentity();
    state.target = classifySystemTarget(identity);
    const label = state.target.kind === "dynamic-launcher" ? "动态 Launcher 布局"
      : state.target.kind === "compatible-launcher" ? "旧版三位置 Launcher"
        : state.target.kind === "single-factory" ? "单固件布局" : "未知布局";
    setDeviceState(`已连接 · ${label}`, "connected");
    log(`目标识别：${label}`);
    if (state.target.kind === "dynamic-launcher") {
      state.library = await inspectDynamicLibraryFast(state.loader, identity.partitionTableSector);
      state.slots = state.library.slots;
      log(`分区：${state.library.layout.id}；玩法区域 ${formatBytes(state.library.arenaBytes)}，剩余 ${formatBytes(state.library.remainingBytes)}。`);
      renderSlots();
    } else {
      state.library = null;
      state.slots = [];
      renderSlots();
      if (state.target.kind === "compatible-launcher") {
        setResult("#device-message", "检测到旧版三位置布局。请先在“初始化设备”中迁移为动态玩法库。", "error");
      }
    }
    refreshActions();
  } catch (error) {
    log(`连接失败：${error.message}`);
    await disconnect(false);
    throw error;
  } finally {
    state.busy = false;
    refreshActions();
  }
}

async function disconnect(updateLog = true) {
  try { await state.transport?.disconnect(); } catch {}
  state.port = null;
  state.transport = null;
  state.loader = null;
  state.target = null;
  state.library = null;
  state.slots = [];
  setDeviceState("等待连接设备", "idle");
  renderSlots();
  refreshActions();
  if (updateLog) log("已断开设备。");
}

async function refreshContinuousSession() {
  if (!state.port || !state.transport) throw new Error("串口授权已失效，请重新连接设备。");
  setDeviceState("正在刷新连续安装会话…", "working");
  log("上一款玩法已完成；正在自动刷新下载会话，避免长时间复用 stub 导致串口失步。");
  try { await state.transport.disconnect(); } catch {}

  state.transport = protectTransportReads(protectTransportWrites(new Transport(state.port, false)));
  state.loader = protectLoaderFlashReads(new ESPLoader({
    transport: state.transport,
    baudrate: WEB_SERIAL_BAUDRATE,
    terminal,
  }));
  const identity = await readTargetIdentity();
  state.target = classifySystemTarget(identity);
  if (state.target.kind !== "dynamic-launcher") {
    throw new Error("刷新后未识别到动态 Launcher 布局。");
  }
  state.library = await inspectDynamicLibraryFast(state.loader, identity.partitionTableSector);
  state.slots = state.library.slots;
  renderSlots();
  setDeviceState("已连接 · 动态 Launcher 布局", "connected");
  log("连续安装会话已自动刷新；无需重新选择串口。");
}

async function disconnectToApplication() {
  if (state.busy || !state.transport) return;
  state.busy = true;
  setDeviceState("正在退出下载模式并重启…", "working");
  refreshActions();
  try {
    await resetAndDisconnect(state.transport);
    state.port = null;
    state.transport = null;
    state.loader = null;
    state.target = null;
    state.library = null;
    state.slots = [];
    setDeviceState("等待连接设备", "idle");
    renderSlots();
    log("已退出下载模式，设备已重启到 Launcher。");
  } catch (error) {
    log(`断开失败：${error.message}`);
    setResult("#device-message", "未能自动退出下载模式，请重新上电设备。", "error");
  } finally {
    state.busy = false;
    refreshActions();
  }
}

async function verifyPublished(bytes, expected) {
  const actual = toHex(await sha256(bytes));
  if (expected && actual !== normalizeSha(expected)) throw new Error(`发布 SHA 不匹配：计算值 ${actual}`);
  return actual;
}

async function installSystem() {
  if (state.busy) return;
  state.busy = true;
  $("#system-complete-actions").hidden = true;
  try {
    if (!state.loader || !state.target?.canInstall) throw new Error("未连接到可识别的 ESP32-C3 8 MiB 布局。");
    if (!$("#system-confirm").checked) throw new Error("请先确认迁移警告。");
    const file = $("#system-file").files[0];
    if (!file) throw new Error("请选择完整 Launcher 合并镜像。");
    const full = new Uint8Array(await file.arrayBuffer());
    const publishedSha = normalizeSha($("#system-sha").value);
    setResult("#system-result", "正在验证发布文件…");
    const actualSha = await verifyPublished(full, publishedSha);
    const systemImage = await prepareDynamicSystemImage(full);
    const { factory, eraseRanges } = systemImage;
    const segments = [
      { name: "bootloader", address: 0x0, data: full.slice(0, 0x8000) },
      { name: "partition table", address: 0x8000, data: full.slice(0x8000, 0x9000) },
      { name: "factory Launcher", address: 0x10000, data: factory.data },
    ];
    log(`完整镜像 SHA-256 已确认：${actualSha}`);
    setResult("#system-result", "正在清空动态玩法区和 OTA 选择…");
    for (const range of eraseRanges) {
      log(`擦除 ${range.name}：0x${range.address.toString(16)} + 0x${range.size.toString(16)}`);
      await eraseRegion(range.address, range.size);
    }
    for (const range of eraseRanges) {
      for (const sample of makeEraseVerificationSamples(range, 32)) {
        if (!allErased(await state.loader.readFlash(sample.address, sample.length))) throw new Error(`${range.name} 擦除校验失败。`);
      }
    }
    await writeSegments(segments, "安装 Launcher");
    for (const segment of segments) {
      setResult("#system-result", `正在验证 ${segment.name}…`);
      await verifySegment(segment);
    }
    const targetTable = parsePartitionTable(await state.loader.readFlash(0x8000, 0x1000));
    if (!targetTable.md5Valid || !samePartitionTable(targetTable.entries, systemImage.entries)) throw new Error("设备上的 Launcher 分区表复核失败。");
    const factoryReadback = await state.loader.readFlash(0x10000, factory.length);
    if (espImageLength(factoryReadback, 0) !== factory.length) throw new Error("设备上的 factory Launcher 不可读。");
    const otaData = await state.loader.readFlash(0x7fe000, 0x2000);
    if (!allErased(otaData)) throw new Error("OTA 元数据不是空白状态，不能确认无玩法被选中。");
    const emptyLibrary = await inspectDynamicLibraryFast(state.loader);
    if (emptyLibrary.slotCount !== 0) throw new Error("动态玩法库不是空白状态。");
    setResult("#system-result", "安装与读回验证完成：Launcher 可读，动态玩法库为空。", "ok");
    $("#system-complete-actions").hidden = false;
    log("完整系统安装成功；正在重启到 Launcher。");
    await resetToApplication(state.transport);
    await disconnect(false);
    setResult("#system-result", "安装与读回验证完成。设备已重启到空的 Launcher 玩法库。", "ok");
  } catch (error) {
    setResult("#system-result", `未完成：${error.message} 请重新进入 ROM 下载模式，并从完整安装开头重试。`, "error");
    log(`完整系统安装失败：${error.message}`);
    await discardFailedReadSession(error);
  } finally {
    state.busy = false;
    refreshActions();
  }
}

function drawSlotCover(canvas, payload) {
  const decoded = coverRgb565ToRgba(payload);
  canvas.width = decoded.width;
  canvas.height = decoded.height;
  const context = canvas.getContext("2d");
  if (!context) return false;
  const image = context.createImageData(decoded.width, decoded.height);
  image.data.set(decoded.data);
  context.putImageData(image, 0, 0);
  return true;
}

function renderSlots() {
  const container = $("#slots");
  const select = $("#target-slot");
  container.replaceChildren();
  select.replaceChildren();
  if (!state.loader || state.target?.kind !== "dynamic-launcher" || !state.library) {
    select.append(new Option("请先连接动态 Launcher", ""));
    container.append(createSlotCard({ slotId: 0, state: "ghost", title: "等待连接" }, true));
    updateReplacementWarning();
    return;
  }

  select.append(new Option("请选择", ""));
  for (const slot of state.slots) {
    const label = `位置 ${slot.slotId + 1} · ${slot.title || "已安装"}`;
    container.append(createSlotCard(slot));
    select.append(new Option(label, String(slot.slotId)));
  }
  if (state.library.largestInstallableImage > 0 && state.slots.length < 16) {
    select.append(new Option(`追加为位置 ${state.slots.length + 1}`, String(state.slots.length)));
  }
  if (state.slots.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "slot-empty-state";
    emptyState.textContent = "玩法库为空。准备玩法后，可安装到位置 1。";
    container.append(emptyState);
  }
  applyRecommendation();
  updateReplacementWarning();
}

function createSlotCard(slot, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `slot-card is-${slot.state}`;
  button.dataset.slotId = String(slot.slotId);
  button.disabled = disabled;
  button.setAttribute("role", "radio");
  button.setAttribute("aria-checked", "false");
  button.setAttribute("aria-label", `位置 ${slot.slotId + 1}，${slot.state === "ready" ? (slot.title || "已安装玩法") : slot.state === "invalid" ? "安装记录不完整" : "等待连接设备"}`);

  const art = document.createElement("span");
  art.className = "slot-art";
  if (slot.coverPayload) {
    const cover = document.createElement("canvas");
    cover.className = "slot-cover";
    cover.setAttribute("aria-hidden", "true");
    if (drawSlotCover(cover, slot.coverPayload)) {
      art.classList.add("has-cover");
      art.append(cover);
    }
  }
  const number = document.createElement("strong");
  number.textContent = String(slot.slotId + 1).padStart(2, "0");
  const stateLabel = document.createElement("span");
  stateLabel.textContent = slot.state === "ready" ? "READY" : slot.state === "invalid" ? "INVALID" : "OFFLINE";
  art.append(number, stateLabel);

  const copy = document.createElement("span");
  copy.className = "slot-copy";
  const title = document.createElement("strong");
  title.textContent = slot.state === "ready" ? (slot.title || "已安装玩法") : slot.state === "invalid" ? "记录不完整" : "等待连接";
  const meta = document.createElement("small");
  meta.textContent = slot.state === "ready" ? (slot.sourceId || "可维护名称与封面") : slot.diagnostic || "读取设备后显示内容";
  copy.append(title, meta);
  button.append(art, copy);

  if (!disabled) {
    button.addEventListener("click", () => {
      $("#target-slot").value = String(slot.slotId);
      updateReplacementWarning();
    });
    button.addEventListener("keydown", (event) => {
      const cards = [...document.querySelectorAll(".slot-card:not(:disabled)")];
      const current = cards.indexOf(button);
      let next = null;
      if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (current + 1) % cards.length;
      if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (current - 1 + cards.length) % cards.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = cards.length - 1;
      if (next === null) return;
      event.preventDefault();
      cards[next].click();
      cards[next].focus();
    });
  }
  return button;
}

function syncSlotCards() {
  const selected = $("#target-slot").value;
  const cards = [...document.querySelectorAll(".slot-card")];
  const hasSelection = cards.some((button) => button.dataset.slotId === selected);
  cards.forEach((button, index) => {
    const isSelected = button.dataset.slotId === selected;
    button.setAttribute("aria-checked", String(isSelected));
    button.tabIndex = isSelected || (!hasSelection && index === 0) ? 0 : -1;
    if (!button.classList.contains("is-ghost")) button.disabled = state.busy || !state.loader;
  });
  const slot = state.slots.find((item) => String(item.slotId) === selected);
  const appendSelected = state.library?.largestInstallableImage > 0 &&
    state.slots.length < 16 && selected === String(state.slots.length);
  $("#slot-selection-hint").textContent = appendSelected
    ? `将追加为位置 ${Number(selected) + 1} · 剩余 ${formatBytes(state.library?.remainingBytes ?? 0)}`
    : slot ? `已选位置 ${slot.slotId + 1} · ${slot.title || slot.state}`
      : state.library ? `已安装 ${state.library.slotCount} 个玩法` : "连接设备后显示玩法库";
}

function applyRecommendation() {
  if (!state.library || state.library.largestInstallableImage <= 0 || state.slots.length >= 16) return;
  $("#target-slot").value = String(state.slots.length);
  if (state.preparedPlay) log(`将按顺序追加为位置 ${state.slots.length + 1}。`);
  updateReplacementWarning();
}

async function fetchOfficialResource(url) {
  const endpoint = managerApiUrl(`/api/resource?url=${encodeURIComponent(url)}`);
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KiB`;
}

function clearCoverPreview(message = "选择图片或读取官方 Play 后显示封面。") {
  if (state.coverPreviewUrl) URL.revokeObjectURL(state.coverPreviewUrl);
  state.coverPreviewUrl = null;
  state.preparedCover = null;
  const image = $("#cover-preview");
  image.removeAttribute("src");
  image.hidden = true;
  $("#cover-placeholder").hidden = false;
  $("#cover-info").textContent = message;
  refreshActions();
}

async function prepareCover(bytes, sourceLabel) {
  const blob = new Blob([bytes]);
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 160;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("浏览器无法创建封面画布。");
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const crop = coverCropRect(bitmap.width, bitmap.height, canvas.width, canvas.height);
    context.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
    const payload = rgbaToCoverRgb565(context.getImageData(0, 0, canvas.width, canvas.height)).data;
    const encoded = await encodeCoverPreview(canvas);
    if (state.coverPreviewUrl) URL.revokeObjectURL(state.coverPreviewUrl);
    state.coverPreviewUrl = URL.createObjectURL(encoded.blob);
    state.preparedCover = { payload, previewBlob: encoded.blob, sourceBytes: bytes.length, sourceLabel };
    const image = $("#cover-preview");
    image.src = state.coverPreviewUrl;
    image.hidden = false;
    $("#cover-placeholder").hidden = true;
    const changed = bytes.length > encoded.blob.size ? `，已从 ${formatBytes(bytes.length)} 压缩` : "";
    $("#cover-info").textContent = `${sourceLabel} · 120×160 · ${formatBytes(encoded.blob.size)}${changed} · 设备数据 ${formatBytes(payload.length)}`;
  } finally {
    bitmap.close();
  }
  refreshActions();
}

async function loadPreferredCover() {
  const local = $("#cover-file").files[0];
  if (local) {
    await prepareCover(new Uint8Array(await local.arrayBuffer()), "自定义封面");
    return;
  }
  if (state.preparedPlay?.coverBytes) {
    await prepareCover(state.preparedPlay.coverBytes, "官方封面");
    return;
  }
  clearCoverPreview();
}

async function preparePlay(bytes, metadata, expectedSha = "") {
  const sourceSha = await verifyPublished(bytes, expectedSha);
  const extracted = extractAppImage(bytes);
  const appShaBytes = await sha256(extracted.data);
  state.preparedPlay = {
    app: extracted.data,
    appShaBytes,
    sourceSha,
    appSha: toHex(appShaBytes),
    sourceKind: metadata.sourceKind,
    sourceId: metadata.sourceId ?? "",
    title: metadata.title || "Local Play",
    version: metadata.version ?? "",
    coverBytes: metadata.coverBytes ?? null,
  };
  $("#play-title").value = state.preparedPlay.title;
  updateTitleCheck();
  $("#play-version").value = state.preparedPlay.version;
  $("#play-source-id").value = state.preparedPlay.sourceId;
  $("#image-info").textContent = `${extracted.kind === "merged" ? "已从合并镜像提取" : "App 镜像"} · ${extracted.length} bytes · App SHA-256 ${state.preparedPlay.appSha}`;
  applyRecommendation();
  refreshActions();
}

function catalogCategoryLabel(key) {
  return PLAY_CATEGORIES.find((category) => category.key === key)?.label ?? "全部玩法";
}

function updateCatalogUrlState() {
  const url = new URL(window.location.href);
  if (catalog.query) url.searchParams.set("play_q", catalog.query);
  else url.searchParams.delete("play_q");
  if (catalog.category !== "all") url.searchParams.set("play_category", catalog.category);
  else url.searchParams.delete("play_category");
  history.replaceState(null, "", url);
}

function catalogCoverProxyUrl(value) {
  if (!value) return "";
  return managerApiUrl(`/api/resource?url=${encodeURIComponent(value)}`);
}

function renderCatalogCategories() {
  const container = $("#catalog-categories");
  container.replaceChildren();
  for (const category of PLAY_CATEGORIES) {
    const button = document.createElement("button");
    const selected = category.key === catalog.category;
    const count = category.key === "all" ? catalog.total : catalog.categoryCounts[category.key];
    button.type = "button";
    button.className = "catalog-category";
    button.dataset.catalogCategory = category.key;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "catalog-results");
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.textContent = Number.isSafeInteger(count) ? `${category.label} ${count}` : category.label;
    button.addEventListener("click", () => {
      if (catalog.loading || category.key === catalog.category) return;
      catalog.category = category.key;
      catalog.selectedId = null;
      updateCatalogUrlState();
      renderCatalogCategories();
      loadCatalog();
    });
    button.addEventListener("keydown", (event) => {
      const tabs = [...container.querySelectorAll("[role=tab]")];
      const current = tabs.indexOf(button);
      let next = null;
      if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (current + 1) % tabs.length;
      if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (current - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      tabs[next].click();
      tabs[next].focus();
    });
    container.append(button);
  }
}

function renderCatalogResults(message = "") {
  const results = $("#catalog-results");
  results.replaceChildren();
  results.setAttribute("aria-busy", String(catalog.loading));
  $("#catalog-load-more").hidden = !catalog.hasMore || catalog.loading;
  $("#catalog-load-more").disabled = catalog.loading || state.catalogSelecting;

  if (message || (!catalog.loading && catalog.plays.length === 0)) {
    const empty = document.createElement("li");
    empty.className = "catalog-empty";
    empty.textContent = message || "没有找到符合条件的玩法。可换一个名称或分类。";
    results.append(empty);
    return;
  }

  for (const play of catalog.plays) {
    const item = document.createElement("li");
    item.className = "catalog-item";
    const card = document.createElement("button");
    const selected = play.playId === catalog.selectedId;
    card.type = "button";
    card.className = "catalog-card";
    card.setAttribute("aria-label", `选择玩法：${play.title}，${play.author}`);
    card.setAttribute("aria-pressed", String(selected));
    card.disabled = catalog.loading || state.catalogSelecting;

    const art = document.createElement("span");
    art.className = "catalog-card-art";
    if (play.coverUrl) {
      const image = document.createElement("img");
      image.src = catalogCoverProxyUrl(play.coverUrl);
      image.alt = "";
      image.width = 72;
      image.height = 96;
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => { art.classList.add("is-fallback"); image.remove(); }, { once: true });
      art.append(image);
    } else {
      art.classList.add("is-fallback");
    }

    const copy = document.createElement("span");
    copy.className = "catalog-card-copy";
    const title = document.createElement("strong");
    title.textContent = play.title;
    const author = document.createElement("span");
    author.className = "catalog-card-author";
    author.textContent = play.author;
    const meta = document.createElement("span");
    meta.className = "catalog-card-meta";
    meta.textContent = play.firmwareSize > 0
      ? `${play.categoryLabel} · ${formatBytes(play.firmwareSize)}`
      : play.categoryLabel;
    const action = document.createElement("span");
    action.className = "catalog-card-action";
    action.textContent = selected ? "已选择" : "选择玩法";
    copy.append(title, author, meta, action);
    card.append(art, copy);
    card.addEventListener("click", () => selectCatalogPlay(play));
    item.append(card);
    results.append(item);
  }
}

async function loadCatalog({ append = false } = {}) {
  const requestId = ++catalog.requestId;
  const offset = append ? catalog.plays.length : 0;
  let resultMessage = "";
  catalog.loading = true;
  $("#catalog-status").textContent = append ? "正在加载更多玩法…" : "正在读取官方玩法…";
  renderCatalogCategories();
  renderCatalogResults(append ? "" : "正在读取玩法列表…");
  try {
    const parameters = new URLSearchParams({
      q: catalog.query,
      category: catalog.category,
      limit: "12",
      offset: String(offset),
    });
    const response = await fetch(managerApiUrl(`/api/catalog?${parameters}`), { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    const normalized = normalizeOfficialCatalog(payload);
    if (requestId !== catalog.requestId) return;
    catalog.plays = append ? [...catalog.plays, ...normalized.plays] : normalized.plays;
    catalog.total = normalized.total;
    catalog.hasMore = normalized.hasMore;
    catalog.categoryCounts = normalized.categoryCounts;
    const context = catalog.query
      ? `“${catalog.query}”`
      : catalog.category === "all" ? "官方玩法库" : catalogCategoryLabel(catalog.category);
    $("#catalog-status").textContent = `${context} · 找到 ${catalog.total} 款玩法`;
  } catch (error) {
    if (requestId !== catalog.requestId) return;
    if (!append) catalog.plays = [];
    catalog.hasMore = false;
    $("#catalog-status").textContent = `无法读取玩法库：${error.message}`;
    if (catalog.plays.length === 0) {
      resultMessage = "玩法库暂时不可用。可稍后重试，或在下方粘贴官方 Play 详情 URL。";
    }
  } finally {
    if (requestId === catalog.requestId) {
      catalog.loading = false;
      renderCatalogCategories();
      renderCatalogResults(resultMessage);
    }
  }
}

async function selectCatalogPlay(play) {
  if (state.catalogSelecting) return;
  catalog.selectedId = play.playId;
  state.catalogSelecting = true;
  $("#play-url").value = play.detailUrl;
  $("#catalog-status").textContent = `正在准备「${play.title}」…`;
  renderCatalogResults();
  try {
    await resolvePlayUrl();
    $("#catalog-status").textContent = state.preparedPlay
      ? `已选择「${play.title}」，请继续确认封面与安装位置。`
      : `未能准备「${play.title}」，请查看下方错误信息。`;
  } finally {
    state.catalogSelecting = false;
    renderCatalogResults();
  }
}

function scheduleCatalogSearch() {
  window.clearTimeout(catalogQueryTimer);
  catalog.query = $("#catalog-search").value.trim();
  catalog.selectedId = null;
  updateCatalogUrlState();
  $("#catalog-status").textContent = catalog.query ? "等待输入完成…" : "正在恢复全部玩法…";
  catalogQueryTimer = window.setTimeout(() => loadCatalog(), 350);
}

async function resolvePlayUrl() {
  state.preparedPlay = null;
  clearCoverPreview("正在读取官方封面…");
  refreshActions();
  try {
    setResult("#play-result", "正在读取官方 Play 信息…");
    const endpoint = managerApiUrl(`/api/play?url=${encodeURIComponent($("#play-url").value)}`);
    const response = await fetch(endpoint, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    const play = normalizeOfficialPlay(payload);
    $("#play-title").value = play.deviceTitle;
    $("#play-version").value = play.version;
    $("#play-source-id").value = play.sourceId;
    $("#play-meta-summary").textContent = `官方 Play #${play.playId} · ${play.title} · 设备显示 ${play.deviceTitle}`;
    $("#play-meta-summary").hidden = false;
    setResult("#play-result", "已读取发布信息，正在下载并验证固件…");
    const bytes = await fetchOfficialResource(play.firmwareUrl);
    let coverBytes = null;
    if (play.coverUrl) {
      try { coverBytes = await fetchOfficialResource(play.coverUrl); } catch (error) { log(`封面下载失败，将使用占位图：${error.message}`); }
    }
    await preparePlay(bytes, {
      sourceKind: "play-api",
      sourceId: play.sourceId,
      title: play.deviceTitle,
      version: play.version,
      coverBytes,
    }, play.firmwareSha256);
    await loadPreferredCover();
    setResult("#play-result", "标题、版本、Source ID、固件与封面均已读取；发布 SHA 已确认。", "ok");
  } catch (error) {
    state.preparedPlay = null;
    clearCoverPreview("未能读取官方封面。");
    const hint = location.protocol === "file:" && error instanceof TypeError
      ? "请先启动 Play Manager 本地服务，或改用 http://127.0.0.1:4173 打开。"
      : error.message;
    setResult("#play-result", `无法准备玩法：${hint}`, "error");
    refreshActions();
  }
}

async function prepareLocalFile() {
  try {
    const file = $("#play-file").files[0];
    if (!file) { state.preparedPlay = null; refreshActions(); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    await preparePlay(bytes, {
      sourceKind: "local",
      sourceId: $("#play-source-id").value.trim(),
      title: $("#play-title").value.trim() || file.name.replace(/\.bin$/i, ""),
      version: $("#play-version").value.trim(),
    }, $("#play-sha").value.trim());
    await loadPreferredCover();
    setResult("#play-result", "本地固件结构与 SHA 已确认。", "ok");
  } catch (error) {
    state.preparedPlay = null;
    setResult("#play-result", `本地固件无效：${error.message}`, "error");
    refreshActions();
  }
}

async function handleCoverFileChange() {
  state.coverBusy = true;
  refreshActions();
  try {
    $("#cover-info").textContent = "正在裁切并压缩封面…";
    await loadPreferredCover();
    if (state.preparedCover) setResult("#play-result", `封面已在浏览器内压缩到 ${formatBytes(state.preparedCover.previewBlob.size)}。`, "ok");
  } catch (error) {
    clearCoverPreview("封面处理失败，请选择 PNG、JPEG 或 WebP 图片。");
    setResult("#play-result", `封面无效：${error.message}`, "error");
  } finally {
    state.coverBusy = false;
    refreshActions();
  }
}

async function selectedCoverPayload() {
  return state.preparedCover?.payload ?? null;
}

function installationTime() {
  const now = new Date();
  return {
    epochSeconds: Math.floor(now.getTime() / 1000),
    utcOffsetMinutes: -now.getTimezoneOffset(),
  };
}

async function writeDynamicSidecar({
  slot,
  payload,
  title,
  version,
  sourceId,
  sourceKind,
  appShaBytes,
  imageLength,
  firstInstalledAt = null,
  firstUtcOffsetMinutes = null,
}) {
  const clock = installationTime();
  const layout = dynamicSidecarLayout(slot);
  const generation = ((slot.generation ?? 0) + 1) >>> 0;
  const bank = slot.activeSidecarBank === "a" ? "b" : "a";
  const record = encodeDynamicSidecarRecord({
    generation,
    slotId: slot.slotId,
    sourceKind,
    title,
    sourceId,
    version,
    imageLength,
    firmwareSha256: appShaBytes,
    coverPayload: payload,
    firstInstalledAt: firstInstalledAt ?? clock.epochSeconds,
    lastInstalledAt: clock.epochSeconds,
    firstUtcOffsetMinutes: firstUtcOffsetMinutes ?? clock.utcOffsetMinutes,
    lastUtcOffsetMinutes: clock.utcOffsetMinutes,
  });

  if (payload) {
    await eraseRegion(layout.payload.address, 0xa000);
    const coverSegment = { address: layout.payload.address, data: payload };
    await writeSegments([coverSegment], "写入 DPS1 封面");
    await verifySegment(coverSegment);
  }

  const targetBank = bank === "a" ? layout.bankA : layout.bankB;
  await eraseRegion(targetBank.address, targetBank.size);
  const recordSegment = { address: targetBank.address, data: record };
  await writeSegments([recordSegment], "提交 DPS1 记录");
  await verifySegment(recordSegment);
  const decoded = decodeDynamicSidecarRecord(await state.loader.readFlash(targetBank.address, record.length));
  if (!decoded || decoded.slotId !== slot.slotId || decoded.imageLength !== imageLength ||
      !equalBytes(decoded.firmwareSha256, appShaBytes)) {
    throw new Error("DPS1 记录读回校验失败。");
  }
  if (payload) {
    const installedPayload = await state.loader.readFlash(layout.payload.address, COVER_PAYLOAD_LENGTH);
    if (!dynamicCoverMatchesRecord(decoded, installedPayload)) throw new Error("DPS1 封面 CRC 校验失败。");
  }
  return { bank, generation, record };
}

async function writeReassignedDynamicSidecar(slot, nextSlotId) {
  if (!(slot.sidecarRecordBytes instanceof Uint8Array)) {
    throw new Error(`位置 ${slot.slotId + 1} 缺少可迁移的 DPS1 记录。`);
  }
  const generation = ((slot.generation ?? 0) + 1) >>> 0;
  const record = reassignDynamicSidecarRecord(slot.sidecarRecordBytes, {
    slotId: nextSlotId,
    generation,
  });
  const layout = dynamicSidecarLayout(slot);
  const bank = slot.activeSidecarBank === "a" ? "b" : "a";
  const targetBank = bank === "a" ? layout.bankA : layout.bankB;
  await eraseRegion(targetBank.address, targetBank.size);
  const segment = { address: targetBank.address, data: record };
  await writeSegments([segment], `重排位置 ${slot.slotId + 1} → ${nextSlotId + 1}`);
  await verifySegment(segment);
  const decoded = decodeDynamicSidecarRecord(await state.loader.readFlash(targetBank.address, record.length));
  if (!decoded || decoded.slotId !== nextSlotId || decoded.generation !== generation ||
      !equalBytes(decoded.firmwareSha256, slot.appShaBytes)) {
    throw new Error(`位置 ${slot.slotId + 1} 的重排记录读回校验失败。`);
  }
  return { bank, generation };
}

async function commitDynamicTable(slots, onWritten = () => {}) {
  const entries = dynamicPartitionEntries(slots, state.library.layout);
  const tableBytes = encodePartitionTable(entries);
  const decoded = parsePartitionTable(tableBytes);
  if (!decoded.md5Valid || !samePartitionTable(decoded.entries, entries)) {
    throw new Error("新分区表在写入前未通过 MD5 与布局校验。");
  }
  await eraseRegion(0x8000, 0x1000);
  const tableSegment = { address: 0x8000, data: tableBytes };
  await writeSegments([tableSegment], "提交动态分区表");
  onWritten();
  await verifySegment(tableSegment);
  const installed = parsePartitionTable(await state.loader.readFlash(0x8000, 0x1000));
  if (!installed.md5Valid || !samePartitionTable(installed.entries, decoded.entries)) {
    throw new Error("设备上的动态分区表读回校验失败。");
  }
}

async function clearOtaSelection() {
  await eraseRegion(0x7fe000, 0x2000);
  if (!allErased(await state.loader.readFlash(0x7fe000, 0x2000))) {
    throw new Error("OTA 选择区擦除校验失败。");
  }
}

function hidePlayCompletion() {
  $("#play-complete").hidden = true;
}

function showPlayCompletion({ slotId, title, version, hasCover }) {
  $("#complete-title").textContent = title;
  $("#complete-meta").textContent = `位置 ${slotId + 1}${version ? ` · 版本 ${version}` : ""} · ${hasCover ? "封面已校验" : "使用占位图"}`;
  $("#complete-reset").textContent = "数据已提交，设备保持连接。可以继续安装，全部完成后再重启。";
  const image = $("#complete-cover");
  if (hasCover && state.coverPreviewUrl) {
    image.src = state.coverPreviewUrl;
    image.hidden = false;
    $("#complete-cover-placeholder").hidden = true;
  } else {
    image.removeAttribute("src");
    image.hidden = true;
    $("#complete-cover-placeholder").hidden = false;
  }
  $("#play-complete").hidden = false;
  $("#play-complete").scrollIntoView({ behavior: scrollBehavior(), block: "nearest" });
}

async function prepareAnotherPlay() {
  if (state.busy || !state.transport) return;
  state.busy = true;
  refreshActions();
  try {
    await refreshContinuousSession();
  } catch (error) {
    setResult("#device-message", `无法刷新连续安装会话：${error.message}`, "error");
    log(`连续安装会话刷新失败：${error.message}`);
    await disconnect(false);
    return;
  } finally {
    state.busy = false;
    refreshActions();
  }
  hidePlayCompletion();
  state.preparedPlay = null;
  clearCoverPreview();
  $("#play-url").value = "";
  $("#play-file").value = "";
  $("#play-sha").value = "";
  $("#cover-file").value = "";
  $("#play-title").value = state.sourceKind === "local" ? "Local Play" : "";
  $("#play-version").value = "";
  $("#play-source-id").value = "";
  $("#play-meta-summary").hidden = true;
  $("#image-info").textContent = "尚未载入固件。";
  setResult("#play-result", "设备授权保持不变，下载会话已自动刷新；请准备下一个玩法。", "ok");
  refreshActions();
  const nextInput = state.sourceKind === "local" ? $("#play-file") : $("#play-url");
  nextInput.focus();
  window.scrollTo({ top: $("#play-panel").offsetTop - 16, behavior: scrollBehavior() });
}

async function finishPlaySession() {
  if (state.busy || !state.transport) return;
  state.busy = true;
  setDeviceState("正在完成连续安装并重启…", "working");
  $("#complete-reset").textContent = "正在重启设备并退出下载模式…";
  refreshActions();
  try {
    await resetAndDisconnect(state.transport);
    state.port = null;
    state.transport = null;
    state.loader = null;
    state.target = null;
    state.library = null;
    state.slots = [];
    setDeviceState("等待连接设备", "idle");
    renderSlots();
    $("#complete-reset").textContent = "设备已重启到 Launcher，网页串口已断开。";
    log("连续安装会话已完成；设备已重启到 Launcher。");
  } catch (error) {
    $("#complete-reset").textContent = "玩法均已提交，但未确认最终重启；请手动重启设备。";
    setResult("#device-message", "未能自动退出下载模式，请重新上电设备。", "error");
    log(`连续安装已完成，但最终重启失败：${error.message}。`);
  } finally {
    state.busy = false;
    refreshActions();
  }
}

async function installPlay() {
  if (state.busy) return;
  state.busy = true;
  hidePlayCompletion();
  let plan;
  let tableCommitStarted = false;
  let tableWritten = false;
  try {
    if (!state.loader || state.target?.kind !== "dynamic-launcher" || !state.library) throw new Error("请先连接动态 Launcher 布局。");
    if (!state.preparedPlay) throw new Error("请先载入并验证玩法固件。");
    if ($("#target-slot").value !== String(state.slots.length)) throw new Error("新增玩法只能追加到玩法库末尾。");
    if (state.slots.some((slot) => slot.state !== "ready")) throw new Error("玩法库包含无效记录，请先恢复完整系统，不能继续追加。");
    state.preparedPlay.title = requireLauncherTitle($("#play-title").value);
    state.preparedPlay.version = $("#play-version").value.trim();
    state.preparedPlay.sourceId = $("#play-source-id").value.trim();
    if (state.preparedPlay.sourceKind === "play-api" && !state.preparedPlay.sourceId) throw new Error("Play API 来源必须保留 Source ID。");
    const cover = await selectedCoverPayload();
    plan = appendDynamicSlot(state.slots, state.preparedPlay.app.length, state.library.layout);
    const slot = plan.slot;
    setResult("#play-result", `正在分配位置 ${slot.slotId + 1}：${formatBytes(slot.size)}…`);
    await installPhase("擦除新玩法区域", () => eraseRegion(slot.offset, slot.size));
    await installPhase("擦除读回检查", async () => {
      for (const sample of makeEraseVerificationSamples({ address: slot.offset, size: slot.size }, 32)) {
        if (!allErased(await state.loader.readFlash(sample.address, sample.length))) throw new Error("新玩法区域擦除校验失败。");
      }
    });
    const appSegment = { address: slot.offset, data: state.preparedPlay.app };
    await installPhase("App 写入", () => writeSegments([appSegment], `安装位置 ${slot.slotId + 1}`));
    await withAppReadbackRate(async () => {
      const readback = await installPhase("App 完整读回", () => readAppForVerification(slot.offset, state.preparedPlay.app.length));
      await installPhase("App SHA 与结构校验", async () => {
        if (toHex(await sha256(readback)) !== state.preparedPlay.appSha) throw new Error("App SHA 写后校验失败。");
        if (espImageLength(readback) !== state.preparedPlay.app.length) throw new Error("App 结构读回校验失败。");
      });
    });
    log(`位置 ${slot.slotId + 1} App SHA 已验证：${state.preparedPlay.appSha}`);
    await installPhase("DPS1 与封面写入校验", () => writeDynamicSidecar({ slot, payload: cover, imageLength: state.preparedPlay.app.length, ...state.preparedPlay }));

    tableCommitStarted = true;
    setResult("#play-result", "App 与 DPS1 已验证，正在最后提交玩法目录…");
    await installPhase("玩法目录提交与校验", () => commitDynamicTable(plan.slots, () => { tableWritten = true; }));
    await installPhase("清除 OTA 选择", clearOtaSelection);
    state.library = await installPhase("玩法库重新扫描", () => inspectDynamicLibraryFast(state.loader));
    state.slots = state.library.slots;
    const rescanned = state.slots[slot.slotId];
    if (!rescanned || rescanned.state !== "ready" || rescanned.title !== state.preparedPlay.title) {
      throw new Error("提交后的玩法库重新扫描未找到新玩法。");
    }
    setResult("#play-result", `位置 ${slot.slotId + 1} 安装完成，可以继续安装其他玩法；目录、App、DPS1 与封面均已读回验证。`, "ok");
    showPlayCompletion({
      slotId: slot.slotId,
      title: state.preparedPlay.title,
      version: state.preparedPlay.version,
      hasCover: Boolean(cover),
    });
    renderSlots();
    state.preparedPlay = null;
    log(`位置 ${slot.slotId + 1} 已安装并重新扫描确认；保持连接等待下一项操作。`);
  } catch (error) {
    const recovery = tableWritten
      ? "玩法目录已写入，但安装后确认被中断。请重新连接设备并扫描：若新玩法已出现在列表中，安装已经完成；只有无法识别动态玩法库时才使用完整系统安装恢复。"
      : tableCommitStarted
        ? "玩法目录写入被中断，完整性无法确认。请重新连接设备；若无法识别动态玩法库，请使用完整系统安装恢复。"
        : "旧玩法目录保持不变，未完成数据不可启动；可重新连接后重试。";
    setResult("#play-result", `玩法安装不完整：${error.message}。${recovery}`, "error");
    log(`玩法安装失败：${error.message}`);
    await discardFailedReadSession(error);
  }

  state.busy = false;
  refreshActions();
}

async function repairMetadataCover() {
  if (state.busy) return;
  state.busy = true;
  hidePlayCompletion();
  let repaired = false;
  let slotId = null;
  try {
    if (!state.loader || state.target?.kind !== "dynamic-launcher") throw new Error("请先连接动态 Launcher 布局。");
    if (!state.preparedPlay || !state.preparedCover) throw new Error("请先载入玩法固件和封面。");
    slotId = Number.parseInt($("#target-slot").value, 10);
    const slot = state.slots.find((item) => item.slotId === slotId);
    if (!slot || slot.state !== "ready") throw new Error("请选择已安装且记录完整的玩法。");
    state.preparedPlay.title = requireLauncherTitle($("#play-title").value);
    state.preparedPlay.version = $("#play-version").value.trim();
    state.preparedPlay.sourceId = $("#play-source-id").value.trim();

    setResult("#play-result", `正在核对位置 ${slotId + 1} 的 App SHA；不会擦除 App…`);
    if (slot.imageLength !== state.preparedPlay.app.length) throw new Error("位置中的 App 长度与当前玩法不一致。");
    await withAppReadbackRate(async () => {
      const readback = await readAppForVerification(slot.offset, slot.imageLength);
      if (toHex(await sha256(readback)) !== state.preparedPlay.appSha) {
        throw new Error("位置中的 App SHA 与当前玩法不一致，已拒绝修改名称和封面。");
      }
    });
    await writeDynamicSidecar({
      slot,
      payload: state.preparedCover.payload,
      imageLength: slot.imageLength,
      firstInstalledAt: slot.firstInstalledAt,
      firstUtcOffsetMinutes: slot.firstUtcOffsetMinutes,
      ...state.preparedPlay,
    });
    repaired = true;
    setResult("#play-result", `位置 ${slotId + 1} 的名称与封面已修复；App 未重写。`, "ok");
    showPlayCompletion({
      slotId,
      title: state.preparedPlay.title,
      version: state.preparedPlay.version,
      hasCover: true,
    });
    state.library = await inspectDynamicLibraryFast(state.loader);
    state.slots = state.library.slots;
    renderSlots();
  } catch (error) {
    setResult("#play-result", `名称与封面修复未完成：${error.message}`, "error");
    log(`名称与封面修复失败：${error.message}`);
    repaired = false;
    await discardFailedReadSession(error);
    return;
  } finally {
    if (!repaired) {
      state.busy = false;
      refreshActions();
    }
  }

  try {
    log(`位置 ${slotId + 1} 的名称与封面已提交；正在执行最终重启。`);
    await resetToApplication(state.transport);
    $("#complete-reset").textContent = "设备已重启，网页已断开串口；Launcher 应显示这里的名称和封面。";
  } catch (error) {
    $("#complete-reset").textContent = "名称与封面已写入，但未确认自动重启；请手动重启设备后检查 Launcher。";
    log(`修复已成功，但未收到最终重启确认：${error.message}。`);
  } finally {
    await disconnect(false);
    state.busy = false;
    refreshActions();
  }
}

async function eraseSelectedSlot() {
  if (state.busy) return;
  state.busy = true;
  let tableCommitStarted = false;
  let tableWritten = false;
  let removedSlot = null;
  try {
    if (!state.loader || state.target?.kind !== "dynamic-launcher") throw new Error("请先连接动态 Launcher 布局。");
    const slotId = Number.parseInt($("#target-slot").value, 10);
    const slot = state.slots.find((item) => item.slotId === slotId);
    if (!slot) throw new Error("请选择要擦除的位置。");
    if (state.slots.some((item) => item.state !== "ready")) {
      throw new Error("玩法库包含不完整记录，不能安全重排。");
    }
    if (!$("#erase-confirm").checked) throw new Error("请先确认擦除所选位置。");

    const plan = removeDynamicSlot(state.slots, slotId, state.library.layout);
    removedSlot = plan.removedSlot;
    setResult("#play-result", `正在移除位置 ${slotId + 1}，并重排后续 ${plan.moves.length} 个玩法…`);
    for (const move of plan.moves) {
      const source = state.slots[move.previousSlotId];
      await writeReassignedDynamicSidecar(source, move.slotId);
    }
    tableCommitStarted = true;
    await commitDynamicTable(plan.slots, () => { tableWritten = true; });
    await clearOtaSelection();
    state.library = await inspectDynamicLibraryFast(state.loader);
    state.slots = state.library.slots;
    if (state.slots.length !== plan.slots.length || state.slots.some((item, index) =>
      item.state !== "ready" || !equalBytes(item.appShaBytes, plan.slots[index].appShaBytes))) {
      throw new Error("逻辑重排后的玩法库读回校验失败。");
    }
    renderSlots();

    log(`擦除已释放空洞：0x${slot.offset.toString(16)} + 0x${slot.size.toString(16)}`);
    await eraseRegion(slot.offset, slot.size);
    for (const sample of makeEraseVerificationSamples({ address: slot.offset, size: slot.size }, 32)) {
      if (!allErased(await state.loader.readFlash(sample.address, sample.length))) {
        throw new Error(`0x${slot.offset.toString(16)} 擦除校验失败。`);
      }
    }

    $("#erase-confirm").checked = false;
    setResult("#play-result", `原位置 ${slotId + 1} 已移除；后续玩法已连续重排，释放空间会自动优先复用。`, "ok");
    log(`位置 ${slotId + 1} 删除、逻辑重排与空洞擦除完成。`);
  } catch (error) {
    if (tableWritten && error.code !== "FLASH_READ_FAILED") {
      try {
        state.library = await inspectDynamicLibraryFast(state.loader);
        state.slots = state.library.slots;
        renderSlots();
      } catch {
        // Keep the original error and recovery instruction.
      }
    }
    const recovery = tableWritten
      ? `玩法目录已经提交${removedSlot ? "；未擦净的释放区域会在下次安装前重新擦除" : ""}。请重新连接并扫描；若分区表无法识别，再执行完整系统恢复。`
      : tableCommitStarted
        ? "分区表提交已经开始，请重新连接并扫描；若无法识别动态玩法库，执行完整系统恢复。"
        : "设备目录未修改。";
    setResult("#play-result", `位置擦除未完成：${error.message} ${recovery}`, "error");
    log(`位置擦除失败：${error.message}`);
    await discardFailedReadSession(error);
  } finally {
    state.busy = false;
    refreshActions();
  }
}

function updateReplacementWarning() {
  const slot = state.slots.find((item) => String(item.slotId) === $("#target-slot").value);
  $("#replace-label").hidden = true;
  $("#replace-confirm").checked = false;
  $("#erase-label").hidden = !slot;
  $("#erase-confirm").checked = false;
  syncSlotCards();
  refreshActions();
}

function refreshActions() {
  $("#main-content").setAttribute("aria-busy", String(state.busy || state.coverBusy));
  $("#connect").disabled = state.busy || Boolean(state.loader);
  $("#disconnect").disabled = state.busy || !state.transport;
  const systemReady = state.loader && state.target?.canInstall && $("#system-confirm").checked && $("#system-file").files.length && /^[0-9a-fA-F]{64}$/.test($("#system-sha").value.trim());
  $("#install-system").disabled = state.busy || !systemReady;
  const chosen = state.slots.find((item) => String(item.slotId) === $("#target-slot").value);
  const appendSelected = $("#target-slot").value === String(state.slots.length);
  const fits = Boolean(state.preparedPlay && state.library && state.preparedPlay.app.length <= state.library.largestInstallableImage);
  $("#install-play").disabled = state.busy || state.coverBusy || !state.loader || state.target?.kind !== "dynamic-launcher" || !appendSelected || !fits;
  $("#repair-cover").disabled = state.busy || state.coverBusy || !state.loader || state.target?.kind !== "dynamic-launcher" || !state.preparedPlay || !state.preparedCover || !chosen || chosen.state !== "ready";
  $("#erase-slot").disabled = state.busy || state.coverBusy || !state.loader || state.target?.kind !== "dynamic-launcher" || !chosen || chosen.state !== "ready" || !$("#erase-confirm").checked;
  $("#finish-play-session").disabled = state.busy || !state.transport;
  document.querySelectorAll(".slot-card:not(.is-ghost)").forEach((button) => { button.disabled = state.busy || !state.loader; });
  if (!state.busy && state.loader && document.querySelector(".device-dock").dataset.state === "working") {
    const label = state.target?.kind === "dynamic-launcher" ? "动态 Launcher 布局"
      : state.target?.kind === "compatible-launcher" ? "旧版三位置 Launcher"
        : state.target?.kind === "single-factory" ? "单固件布局" : "未知布局";
    setDeviceState(`已连接 · ${label}`, "connected");
  }
}

function updateUrlState(key, value) {
  const url = new URL(window.location.href);
  url.searchParams.set(key, value);
  history.replaceState(null, "", url);
}

function selectMode(mode, updateUrl = true) {
  $("#system-panel").hidden = mode !== "system";
  $("#play-panel").hidden = mode !== "play";
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  if (updateUrl) updateUrlState("mode", mode);
}

function selectSource(source, updateUrl = true) {
  state.sourceKind = source === "play" ? "play-api" : "local";
  state.preparedPlay = null;
  clearCoverPreview();
  $("#play-source").hidden = source !== "play";
  $("#local-source").hidden = source !== "local";
  $("#play-meta-summary").hidden = true;
  $("#cover-file").value = "";
  $("#play-source-id").readOnly = source === "play";
  $("#play-title").value = source === "play" ? "" : "Local Play";
  updateTitleCheck();
  $("#play-version").value = "";
  $("#play-source-id").value = "";
  document.querySelectorAll("[data-source]").forEach((button) => {
    const selected = button.dataset.source === source;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  $("#image-info").textContent = "尚未载入固件。";
  if (updateUrl) updateUrlState("source", source);
  refreshActions();
}

function enableArrowKeyTabs(selector, activation) {
  const tabs = [...document.querySelectorAll(selector)];
  for (const tab of tabs) {
    tab.addEventListener("keydown", (event) => {
      const current = tabs.indexOf(tab);
      let next = null;
      if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (current + 1) % tabs.length;
      if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (current - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      activation(tabs[next]);
      tabs[next].focus();
    });
  }
}

$("#unsupported").hidden = Boolean(navigator.serial && window.isSecureContext);
$("#connect").addEventListener("click", () => connect().catch((error) => setResult("#device-message", error.message, "error")));
$("#disconnect").addEventListener("click", disconnectToApplication);
$("#install-system").addEventListener("click", installSystem);
$("#resolve-play").addEventListener("click", resolvePlayUrl);
$("#catalog-search").addEventListener("input", scheduleCatalogSearch);
$("#catalog-load-more").addEventListener("click", () => loadCatalog({ append: true }));
$("#play-file").addEventListener("change", prepareLocalFile);
$("#cover-file").addEventListener("change", handleCoverFileChange);
$("#install-play").addEventListener("click", installPlay);
$("#repair-cover").addEventListener("click", repairMetadataCover);
$("#erase-slot").addEventListener("click", eraseSelectedSlot);
$("#install-another").addEventListener("click", prepareAnotherPlay);
$("#finish-play-session").addEventListener("click", finishPlaySession);
$("#target-slot").addEventListener("change", updateReplacementWarning);
$("#replace-confirm").addEventListener("change", refreshActions);
$("#erase-confirm").addEventListener("change", refreshActions);
$("#system-file").addEventListener("change", refreshActions);
$("#system-sha").addEventListener("input", refreshActions);
$("#system-confirm").addEventListener("change", refreshActions);
$("#play-title").addEventListener("input", () => { updateTitleCheck(); refreshActions(); });
$("#go-play").addEventListener("click", () => selectMode("play"));
$("#finish-empty").addEventListener("click", () => setResult("#system-result", "已以空玩法库完成。之后可随时回到此页面安装玩法。", "ok"));
document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => selectMode(button.dataset.mode)));
document.querySelectorAll("[data-source]").forEach((button) => button.addEventListener("click", () => selectSource(button.dataset.source)));
enableArrowKeyTabs("[data-mode]", (button) => selectMode(button.dataset.mode));
enableArrowKeyTabs("[data-source]", (button) => selectSource(button.dataset.source));
window.addEventListener("beforeunload", () => {
  if (state.coverPreviewUrl) URL.revokeObjectURL(state.coverPreviewUrl);
  state.transport?.disconnect().catch(() => {});
});

const initialUrl = new URL(window.location.href);
const initialMode = initialUrl.searchParams.get("mode");
const initialSource = initialUrl.searchParams.get("source");
const initialCatalogCategory = initialUrl.searchParams.get("play_category");
catalog.query = (initialUrl.searchParams.get("play_q") ?? "").slice(0, 120).trim();
catalog.category = PLAY_CATEGORIES.some(({ key }) => key === initialCatalogCategory) ? initialCatalogCategory : "all";
$("#catalog-search").value = catalog.query;
selectMode(initialMode === "system" ? "system" : "play", false);
selectSource(initialSource === "local" ? "local" : "play", false);
renderCatalogCategories();
loadCatalog();
renderSlots();
refreshActions();
