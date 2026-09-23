import { ESPLoader, Transport } from "./vendor/esptool-js-0.6.1.js";
import { COVER_PAYLOAD_LENGTH, decodeCoverManifest, encodeCoverManifest, rgbaToCoverRgb565 } from "./cover-convert.js";
import { selectValidCoverBank } from "./cover-bank.js";
import { coverCropRect, encodeCoverPreview } from "./cover-image.js";
import { extractAppImage, parsePartitionTable, verifyEspImage } from "./extract-app-image.js";
import { resetToApplication } from "./device-reset.js";
import { managerApiUrl, normalizeOfficialPlay } from "./play-source.js";
import { inspectAllSlotsFast } from "./slot-inspector.js";
import { decodeTrustRecord, encodeTrustRecord, selectValidTrustBank } from "./trust-record.js";
import { inspectLauncherTitle, requireLauncherTitle } from "./title-font.js";
import {
  buildSlotErasePlan,
  buildSlotWritePlan,
  recommendSlot,
  reduceSlotInstall,
  runSlotInstall,
} from "./slot-install.js";
import {
  COMPATIBLE_PARTITIONS,
  SYSTEM_ERASE_RANGES,
  classifySystemTarget,
  makeEraseVerificationSamples,
  runSystemInstall,
} from "./system-install.js";

const $ = (selector) => document.querySelector(selector);
const state = {
  transport: null,
  loader: null,
  target: null,
  slots: [],
  sourceKind: "play-api",
  preparedPlay: null,
  preparedCover: null,
  coverPreviewUrl: null,
  pendingCover: null,
  busy: false,
  coverBusy: false,
};

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
  target.className = `status ${kind}`;
}

function updateTitleCheck() {
  const result = inspectLauncherTitle($("#play-title").value);
  const target = $("#title-check");
  if (result.empty) {
    target.textContent = "标题会显示在设备上；请输入内容。";
    target.className = "status";
  } else if (result.valid) {
    target.textContent = `设备字体可完整显示 · UTF-8 ${result.bytes}/64 bytes`;
    target.className = "status ok";
  } else if (result.tooLong) {
    target.textContent = `标题为 ${result.bytes} bytes，设备最多支持 64 bytes。`;
    target.className = "status error";
  } else {
    const glyphs = result.unsupported.map(({ character, codePoint }) => `${character} (${codePoint})`).join("、");
    target.textContent = `设备字体未收录：${glyphs}`;
    target.className = "status error";
  }
  return result.valid;
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
        $("#device-status").textContent = `${progressLabel} ${percent}%`;
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

function samePartitionTable(actual) {
  return actual.length === COMPATIBLE_PARTITIONS.length && actual.every((entry, index) => {
    const expected = COMPATIBLE_PARTITIONS[index];
    return ["name", "type", "subtype", "offset", "size"].every((key) => entry[key] === expected[key]);
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
  try {
    if (!navigator.serial) throw new Error("当前浏览器不支持 Web Serial。");
    log("请选择 AI Passport 串口；设备将进入下载模式。 ");
    const port = await navigator.serial.requestPort();
    state.transport = new Transport(port, false);
    state.loader = new ESPLoader({ transport: state.transport, baudrate: 460800, terminal });
    state.target = classifySystemTarget(await readTargetIdentity());
    const label = state.target.kind === "compatible-launcher" ? "Launcher 布局" : state.target.kind === "single-factory" ? "单固件布局" : "未知布局";
    $("#device-status").textContent = `已连接 · ${label}`;
    $("#connect").disabled = true;
    $("#disconnect").disabled = false;
    log(`目标识别：${label}`);
    if (state.target.kind === "compatible-launcher") {
      state.slots = await inspectSlots();
      renderSlots();
    } else {
      state.slots = [];
      renderSlots();
    }
    refreshActions();
  } catch (error) {
    log(`连接失败：${error.message}`);
    await disconnect(false);
    throw error;
  } finally {
    state.busy = false;
  }
}

async function disconnect(updateLog = true) {
  try { await state.transport?.disconnect(); } catch {}
  state.transport = null;
  state.loader = null;
  state.target = null;
  state.slots = [];
  state.pendingCover = null;
  $("#retry-cover").hidden = true;
  $("#finish-without-cover").hidden = true;
  $("#device-status").textContent = "尚未连接";
  $("#connect").disabled = false;
  $("#disconnect").disabled = true;
  renderSlots();
  refreshActions();
  if (updateLog) log("已断开设备。");
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
    if (full.length < 0x11000) throw new Error("完整镜像过短。");
    const tableSector = full.subarray(0x8000, 0x9000);
    const table = parsePartitionTable(tableSector);
    if (!table.md5Valid || !samePartitionTable(table.entries)) throw new Error("发布镜像不是兼容的 Launcher 分区布局。");
    const factory = extractAppImage(full);
    if (factory.kind !== "merged" || factory.appOffset !== 0x10000) throw new Error("发布镜像缺少 0x10000 factory Launcher。");
    await verifyEspImage(factory.data);
    const segments = [
      { name: "bootloader", address: 0x0, data: full.slice(0, 0x8000) },
      { name: "partition table", address: 0x8000, data: full.slice(0x8000, 0x9000) },
      { name: "factory Launcher", address: 0x10000, data: factory.data },
    ];
    log(`完整镜像 SHA-256 已确认：${actualSha}`);
    const result = await runSystemInstall({
      targetKind: state.target.kind,
      async erase() {
        setResult("#system-result", "正在清空三个玩法、六个封面银行和 OTA 选择…");
        for (const range of SYSTEM_ERASE_RANGES) {
          log(`擦除 ${range.name}：0x${range.address.toString(16)} + 0x${range.size.toString(16)}`);
          await eraseRegion(range.address, range.size);
        }
        for (const range of SYSTEM_ERASE_RANGES) {
          for (const sample of makeEraseVerificationSamples(range, 32)) {
            if (!allErased(await state.loader.readFlash(sample.address, sample.length))) throw new Error(`${range.name} 擦除抽样校验失败。`);
          }
        }
      },
      async write() {
        await writeSegments(segments, "安装 Launcher");
      },
      async verifySegments() {
        for (const segment of segments) {
          setResult("#system-result", `正在验证 ${segment.name}…`);
          await verifySegment(segment);
        }
        const targetTable = parsePartitionTable(await state.loader.readFlash(0x8000, 0x1000));
        if (!targetTable.md5Valid || !samePartitionTable(targetTable.entries)) throw new Error("设备上的 Launcher 分区表复核失败。");
        const factoryReadback = await state.loader.readFlash(0x10000, factory.length);
        if (await verifyEspImage(factoryReadback, 0) !== factory.length) throw new Error("设备上的 factory Launcher 未通过 checksum/SHA 校验。");
      },
      async verifyEmptyState() {
        const otaData = await state.loader.readFlash(0x7fe000, 0x2000);
        if (!allErased(otaData)) throw new Error("OTA 元数据不是空白状态，不能确认无玩法被选中。");
        let emptySlots = 0;
        for (const address of [0x180000, 0x380000, 0x580000]) {
          if (allErased(await state.loader.readFlash(address, 32))) emptySlots++;
        }
        return { otaSelected: false, emptySlots };
      },
    });
    if (result.error) throw result.error;
    setResult("#system-result", "写入与读回验证完成：Launcher 镜像有效，三个玩法启动头为空；正在发送复位指令。", "ok");
    $("#system-complete-actions").hidden = false;
    log("完整系统安装成功；正在重启到 Launcher。");
    await resetToApplication(state.transport);
    setResult("#system-result", "数据写入和读回已验证，复位指令已发送。请在设备上确认 Launcher 已启动并显示空玩法库。", "ok");
    await disconnect(false);
  } catch (error) {
    setResult("#system-result", `未完成：${error.message} 请重新进入 ROM 下载模式，并从完整安装开头重试。`, "error");
    log(`完整系统安装失败：${error.message}`);
  } finally {
    state.busy = false;
    refreshActions();
  }
}

async function inspectSlots() {
  return inspectAllSlotsFast(state.loader);
}

function renderSlots() {
  const container = $("#slots");
  const select = $("#target-slot");
  container.replaceChildren();
  select.replaceChildren();
  if (!state.slots.length) {
    container.textContent = state.target?.kind === "compatible-launcher" ? "正在读取位置…" : "连接兼容 Launcher 后显示位置。";
    select.append(new Option("请先连接兼容 Launcher", ""));
    updateReplacementWarning();
    return;
  }
  select.append(new Option("请选择", ""));
  for (const slot of state.slots) {
    const stateLabel = slot.state === "empty"
      ? "空"
      : slot.state === "invalid"
        ? "内容不完整"
        : (slot.title || "玩法有效，缺少名称与封面");
    const trustLabel = slot.state === "ready"
      ? slot.trustSource === "install-receipt"
        ? "已验证常驻"
        : slot.trustSource === "legacy-cover"
          ? "旧版封面凭据"
          : "兼容模式"
      : "";
    const label = `位置 ${slot.slotId + 1} · ${stateLabel}${trustLabel ? ` · ${trustLabel}` : ""}`;
    const item = document.createElement("div");
    item.className = "slot";
    item.textContent = label;
    container.append(item);
    select.append(new Option(label, String(slot.slotId)));
  }
  applyRecommendation();
  updateReplacementWarning();
}

function applyRecommendation() {
  if (!state.slots.length || !state.preparedPlay) return;
  const recommendation = recommendSlot(state.slots, state.preparedPlay.sourceId);
  $("#target-slot").value = recommendation.slotId === null ? "" : String(recommendation.slotId);
  log(recommendation.reason === "same-source" ? `建议原位更新位置 ${recommendation.slotId + 1}。`
    : recommendation.reason === "first-empty" ? `建议使用第一个空位置 ${recommendation.slotId + 1}。`
      : "三个位置均已占用，请手动选择要替换的位置。 ");
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
  await verifyEspImage(extracted.data);
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
    setResult("#play-result", "标题、版本、Source ID、固件与封面均已读取；发布 SHA、App checksum 与 appended SHA 已确认。", "ok");
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
    setResult("#play-result", "本地固件结构、checksum 与 appended SHA 已确认。", "ok");
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

async function writeCover({ slot, plan, payload, title, version, sourceId, sourceKind, appShaBytes }) {
  if (!plan.cover || !payload || payload.length !== COVER_PAYLOAD_LENGTH) return;
  const generation = (slot.generation + 1) >>> 0;
  const manifest = encodeCoverManifest({ generation, slotId: slot.slotId, sourceKind, title, sourceId, version, firmwareSha256: appShaBytes, payload });
  await eraseRegion(plan.cover.address, plan.cover.eraseSize);
  const payloadSegment = { address: plan.cover.address + 0x1000, data: payload };
  await writeSegments([payloadSegment], "写入封面");
  await verifySegment(payloadSegment);
  const manifestSegment = { address: plan.cover.address, data: manifest };
  await writeSegments([manifestSegment], "提交封面清单");
  await verifySegment(manifestSegment);
  const installedManifest = decodeCoverManifest(await state.loader.readFlash(plan.cover.address, 256));
  const installedPayload = await state.loader.readFlash(plan.cover.address + 0x1000, COVER_PAYLOAD_LENGTH);
  const selected = selectValidCoverBank({
    slotId: slot.slotId,
    appSha256: appShaBytes,
    banks: [{ bank: plan.cover.bank, manifest: installedManifest, payload: installedPayload }],
  });
  if (!selected) throw new Error("封面未通过 Launcher 的 App SHA 与 payload CRC 规则。");
}

async function writeTrustReceipt({ slot, plan, appShaBytes, imageLength }) {
  const generation = (slot.trustGeneration + 1) >>> 0;
  const record = encodeTrustRecord({
    generation,
    slotId: slot.slotId,
    imageLength,
    firmwareSha256: appShaBytes,
  });
  await eraseRegion(plan.trust.address, plan.trust.eraseSize);
  const segment = { address: plan.trust.address, data: record };
  await writeSegments([segment], "写入玩法信任收据");
  await verifySegment(segment);
  const installed = decodeTrustRecord(await state.loader.readFlash(plan.trust.address, record.length));
  const selected = selectValidTrustBank({
    slotId: slot.slotId,
    appSha256: appShaBytes,
    imageLength,
    banks: [{ bank: plan.trust.bank, record: installed }],
  });
  if (!selected) throw new Error("玩法信任收据未通过 slot、App SHA 与长度校验。");
}

function hidePlayCompletion() {
  $("#play-complete").hidden = true;
}

function showPlayCompletion({ slotId, title, version, hasCover }) {
  $("#complete-title").textContent = title;
  $("#complete-meta").textContent = `位置 ${slotId + 1}${version ? ` · 版本 ${version}` : ""} · ${hasCover ? "封面已校验" : "使用占位图"}`;
  $("#complete-reset").textContent = "数据已提交，正在执行最终重启…";
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
  $("#play-complete").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function installPlay() {
  if (state.busy) return;
  state.busy = true;
  state.pendingCover = null;
  $("#retry-cover").hidden = true;
  $("#finish-without-cover").hidden = true;
  hidePlayCompletion();
  try {
    if (!state.loader || state.target?.kind !== "compatible-launcher") throw new Error("请先连接兼容 Launcher 布局。");
    if (!state.preparedPlay) throw new Error("请先载入并验证玩法固件。");
    const slotId = Number.parseInt($("#target-slot").value, 10);
    const slot = state.slots.find((item) => item.slotId === slotId);
    if (!slot) throw new Error("请选择目标位置。");
    if (slot.state !== "empty" && !$("#replace-confirm").checked) throw new Error("替换已占用位置前必须明确确认。");
    state.preparedPlay.title = requireLauncherTitle($("#play-title").value);
    state.preparedPlay.version = $("#play-version").value.trim();
    state.preparedPlay.sourceId = $("#play-source-id").value.trim();
    if (state.preparedPlay.sourceKind === "play-api" && !state.preparedPlay.sourceId) throw new Error("Play API 来源必须保留 Source ID。");
    const cover = await selectedCoverPayload();
    const plan = buildSlotWritePlan({
      slotId,
      appLength: state.preparedPlay.app.length,
      activeCoverBank: slot.activeCoverBank,
      activeTrustBank: slot.activeTrustBank,
      hasCover: Boolean(cover),
    });
    const appSegment = { address: plan.app.address, data: state.preparedPlay.app };
    const coverWrite = { slot, plan, payload: cover, ...state.preparedPlay };
    const result = await runSlotInstall({
      slotId,
      hasCover: Boolean(cover),
      async eraseApp() {
        setResult("#play-result", `正在擦除位置 ${slotId + 1}…`);
        await eraseRegion(plan.app.address, plan.app.eraseSize);
      },
      async writeApp() {
        await writeSegments([appSegment], `安装位置 ${slotId + 1}`);
      },
      async verifyApp() {
        setResult("#play-result", `正在验证位置 ${slotId + 1} 的 App checksum、SHA 与读回内容…`);
        const readback = await state.loader.readFlash(plan.app.address, state.preparedPlay.app.length);
        if (toHex(await sha256(readback)) !== state.preparedPlay.appSha) throw new Error("App SHA 写后校验失败。");
        await verifyEspImage(readback);
        log(`位置 ${slotId + 1} App SHA 与 ESP 镜像校验已通过：${state.preparedPlay.appSha}`);
      },
      async invalidateApp() {
        await eraseRegion(plan.app.address, 0x1000);
        return allErased(await state.loader.readFlash(plan.app.address, 32));
      },
      async writeTrust() {
        setResult("#play-result", `正在为位置 ${slotId + 1} 写入与 App SHA 绑定的信任收据…`);
        await writeTrustReceipt({
          slot,
          plan,
          appShaBytes: state.preparedPlay.appShaBytes,
          imageLength: state.preparedPlay.app.length,
        });
      },
      async writeCover() {
        await writeCover(coverWrite);
      },
    });

    if (result.session.phase === "incomplete") {
      const recovery = result.session.deviceState === "unbootable"
        ? "清理后已读回确认启动头为空；重新连接后从擦除 App 开始重试。"
        : `无法确认该位置当前状态；重新连接后必须重新扫描再决定下一步${result.session.cleanupError ? `（清理失败：${result.session.cleanupError}）` : ""}。`;
      setResult("#play-result", `玩法安装未完成：${result.error.message}。${recovery}`, "error");
      log(`玩法安装失败：${result.error.message}；位置状态：${result.session.deviceState}。`);
      return;
    }

    const completion = {
      slotId,
      title: state.preparedPlay.title,
      version: state.preparedPlay.version,
    };
    if (result.session.phase === "partial-success") {
      state.pendingCover = { write: coverWrite, session: result.session, completion };
      $("#retry-cover").hidden = false;
      $("#finish-without-cover").hidden = false;
      setResult("#play-result", `App 已通过 checksum、SHA 与读回验证，但封面未提交：${result.error.message}。可仅重试封面，或使用占位图完成并重启。`, "error");
      return;
    }
    await finishVerifiedInstall({ ...completion, hasCover: Boolean(cover) });
  } catch (error) {
    setResult("#play-result", `安装流程未完成：${error.message}。设备状态尚未确认，请重新连接后扫描位置。`, "error");
    log(`安装流程异常：${error.message}`);
  } finally {
    state.busy = false;
    refreshActions();
  }
}

async function finishVerifiedInstall({ slotId, title, version, hasCover }) {
  setResult("#play-result", `位置 ${slotId + 1} 的 Flash 数据已验证；正在发送复位指令。`, "ok");
  showPlayCompletion({ slotId, title, version, hasCover });
  try {
    log(`位置 ${slotId + 1} 的数据已提交；正在发送最终复位脉冲。`);
    await resetToApplication(state.transport);
    $("#complete-reset").textContent = "复位指令已发送，网页已断开串口。请在设备上确认 Launcher 已显示该玩法。";
    log("复位指令已发送；Launcher 画面仍需在设备上确认。");
  } catch (error) {
    $("#complete-reset").textContent = "Flash 数据已验证，但复位指令未确认完成；请手动重启设备并检查 Launcher。";
    log(`Flash 数据已验证，但复位失败：${error.message}。`);
  } finally {
    await disconnect(false);
  }
}

async function repairMetadataCover() {
  if (state.busy) return;
  state.busy = true;
  hidePlayCompletion();
  let repaired = false;
  let slotId = null;
  try {
    if (!state.loader || state.target?.kind !== "compatible-launcher") throw new Error("请先连接兼容 Launcher 布局。");
    if (!state.preparedPlay || !state.preparedCover) throw new Error("请先载入玩法固件和封面。");
    slotId = Number.parseInt($("#target-slot").value, 10);
    const slot = state.slots.find((item) => item.slotId === slotId);
    if (!slot || slot.state === "empty") throw new Error("请选择已安装该玩法的位置。");
    state.preparedPlay.title = requireLauncherTitle($("#play-title").value);
    state.preparedPlay.version = $("#play-version").value.trim();
    state.preparedPlay.sourceId = $("#play-source-id").value.trim();

    setResult("#play-result", `正在核对位置 ${slotId + 1} 的 App SHA；不会擦除 App…`);
    const address = 0x180000 + slotId * 0x200000;
    const readback = await state.loader.readFlash(address, state.preparedPlay.app.length);
    if (toHex(await sha256(readback)) !== state.preparedPlay.appSha) {
      throw new Error("位置中的 App SHA 与当前玩法不一致，已拒绝修改名称和封面。");
    }
    const plan = buildSlotWritePlan({
      slotId,
      appLength: state.preparedPlay.app.length,
      activeCoverBank: slot.activeCoverBank,
      activeTrustBank: slot.activeTrustBank,
      hasCover: true,
    });
    await writeTrustReceipt({
      slot,
      plan,
      appShaBytes: state.preparedPlay.appShaBytes,
      imageLength: state.preparedPlay.app.length,
    });
    await writeCover({
      slot,
      plan,
      payload: state.preparedCover.payload,
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
    state.slots = await inspectSlots();
    renderSlots();
  } catch (error) {
    setResult("#play-result", `名称与封面修复未完成：${error.message}`, "error");
    log(`名称与封面修复失败：${error.message}`);
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
    $("#complete-reset").textContent = "复位指令已发送，网页已断开串口。请在设备上确认 Launcher 已显示这里的名称和封面。";
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
  try {
    if (!state.loader || state.target?.kind !== "compatible-launcher") throw new Error("请先连接兼容 Launcher 布局。");
    const slotId = Number.parseInt($("#target-slot").value, 10);
    const slot = state.slots.find((item) => item.slotId === slotId);
    if (!slot) throw new Error("请选择要擦除的位置。");
    if (!$("#erase-confirm").checked) throw new Error("请先确认擦除所选位置。");

    const plan = buildSlotErasePlan(slotId);
    setResult("#play-result", `正在擦除位置 ${slotId + 1} 的玩法、封面和信任收据…`);
    log(`擦除位置 ${slotId + 1} App：0x${plan.app.address.toString(16)} + 0x${plan.app.eraseSize.toString(16)}`);
    await eraseRegion(plan.app.address, plan.app.eraseSize);
    log(`擦除位置 ${slotId + 1} 封面：0x${plan.covers.address.toString(16)} + 0x${plan.covers.eraseSize.toString(16)}`);
    await eraseRegion(plan.covers.address, plan.covers.eraseSize);
    log(`擦除位置 ${slotId + 1} 信任收据：0x${plan.trust.address.toString(16)} + 0x${plan.trust.eraseSize.toString(16)}`);
    await eraseRegion(plan.trust.address, plan.trust.eraseSize);

    for (const range of [plan.app, plan.covers, plan.trust]) {
      for (const sample of makeEraseVerificationSamples({ address: range.address, size: range.eraseSize }, 32)) {
        if (!allErased(await state.loader.readFlash(sample.address, sample.length))) {
          throw new Error(`0x${range.address.toString(16)} 擦除校验失败。`);
        }
      }
    }

    state.slots = await inspectSlots();
    renderSlots();
    $("#erase-confirm").checked = false;
    setResult("#play-result", `位置 ${slotId + 1} 已擦除，头尾抽样和启动头均为空；Launcher、NVS 和其他位置未修改。`, "ok");
    log(`位置 ${slotId + 1} 擦除完成。`);
  } catch (error) {
    setResult("#play-result", `位置擦除未完成：${error.message} 请重新连接并复核该位置。`, "error");
    log(`位置擦除失败：${error.message}`);
  } finally {
    state.busy = false;
    refreshActions();
  }
}

async function retryCover() {
  if (!state.pendingCover || !state.loader || state.busy) return;
  state.busy = true;
  try {
    const pending = state.pendingCover;
    await writeCover(pending.write);
    pending.session = reduceSlotInstall(pending.session, { type: "cover-retry-succeeded" });
    if (pending.session.phase !== "completed") throw new Error("封面状态机未进入完成状态。");
    state.pendingCover = null;
    $("#retry-cover").hidden = true;
    $("#finish-without-cover").hidden = true;
    setResult("#play-result", "封面重试成功并通过 App SHA 与 payload CRC 验证；正在重启。", "ok");
    await finishVerifiedInstall({ ...pending.completion, hasCover: true });
  } catch (error) {
    setResult("#play-result", `封面仍未完成：${error.message}`, "error");
  } finally {
    state.busy = false;
    refreshActions();
  }
}

async function finishWithoutCover() {
  if (!state.pendingCover || !state.loader || state.busy) return;
  state.busy = true;
  try {
    const pending = state.pendingCover;
    pending.session = reduceSlotInstall(pending.session, { type: "finish-without-cover" });
    if (pending.session.phase !== "completed") throw new Error("占位图完成状态无效。");
    state.pendingCover = null;
    $("#retry-cover").hidden = true;
    $("#finish-without-cover").hidden = true;
    setResult("#play-result", "App 已验证；本次不写入封面，Launcher 将使用占位图。正在重启。", "ok");
    await finishVerifiedInstall({ ...pending.completion, hasCover: false });
  } catch (error) {
    setResult("#play-result", `无法使用占位图完成：${error.message}`, "error");
  } finally {
    state.busy = false;
    refreshActions();
  }
}

function updateReplacementWarning() {
  const slot = state.slots.find((item) => String(item.slotId) === $("#target-slot").value);
  const replacing = slot && slot.state !== "empty";
  $("#replace-label").hidden = !replacing;
  if (!replacing) $("#replace-confirm").checked = false;
  $("#erase-label").hidden = !slot;
  $("#erase-confirm").checked = false;
  refreshActions();
}

function refreshActions() {
  const systemReady = state.loader && state.target?.canInstall && $("#system-confirm").checked && $("#system-file").files.length && /^[0-9a-fA-F]{64}$/.test($("#system-sha").value.trim());
  $("#install-system").disabled = state.busy || !systemReady;
  const chosen = state.slots.find((item) => String(item.slotId) === $("#target-slot").value);
  const replacementConfirmed = !chosen || chosen.state === "empty" || $("#replace-confirm").checked;
  const titleValid = inspectLauncherTitle($("#play-title").value).valid;
  $("#install-play").disabled = state.busy || state.coverBusy || !state.loader || state.target?.kind !== "compatible-launcher" || !state.preparedPlay || !chosen || !replacementConfirmed || !titleValid;
  $("#repair-cover").disabled = state.busy || state.coverBusy || !state.loader || state.target?.kind !== "compatible-launcher" || !state.preparedPlay || !state.preparedCover || !chosen || chosen.state === "empty" || !titleValid;
  $("#erase-slot").disabled = state.busy || state.coverBusy || !state.loader || state.target?.kind !== "compatible-launcher" || !chosen || !$("#erase-confirm").checked;
}

function selectMode(mode) {
  $("#system-panel").hidden = mode !== "system";
  $("#play-panel").hidden = mode !== "play";
  document.querySelectorAll("[data-mode]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.mode === mode)));
}

function selectSource(source) {
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
  document.querySelectorAll("[data-source]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.source === source)));
  $("#image-info").textContent = "尚未载入固件。";
  refreshActions();
}

$("#unsupported").hidden = Boolean(navigator.serial && window.isSecureContext);
$("#connect").addEventListener("click", () => connect().catch((error) => setResult("#system-result", error.message, "error")));
$("#disconnect").addEventListener("click", () => disconnect());
$("#install-system").addEventListener("click", installSystem);
$("#resolve-play").addEventListener("click", resolvePlayUrl);
$("#play-file").addEventListener("change", prepareLocalFile);
$("#cover-file").addEventListener("change", handleCoverFileChange);
$("#install-play").addEventListener("click", installPlay);
$("#repair-cover").addEventListener("click", repairMetadataCover);
$("#erase-slot").addEventListener("click", eraseSelectedSlot);
$("#retry-cover").addEventListener("click", retryCover);
$("#finish-without-cover").addEventListener("click", finishWithoutCover);
$("#install-another").addEventListener("click", () => {
  hidePlayCompletion();
  $("#play-url").focus();
  window.scrollTo({ top: $("#play-panel").offsetTop - 16, behavior: "smooth" });
});
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
window.addEventListener("beforeunload", () => {
  if (state.coverPreviewUrl) URL.revokeObjectURL(state.coverPreviewUrl);
  state.transport?.disconnect().catch(() => {});
});

renderSlots();
$("#play-title").value = "";
updateTitleCheck();
refreshActions();
