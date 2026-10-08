import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withFlashReadBaud } from "./serial-transport.js";

const root = new URL("./", import.meta.url);
const [html, css, app, favicon, cloudflareBuild, vercelIgnore] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("styles.css", root), "utf8"),
  readFile(new URL("app.js", root), "utf8"),
  readFile(new URL("favicon.svg", root), "utf8"),
  readFile(new URL("build-cloudflare.mjs", root), "utf8"),
  readFile(new URL(".vercelignore", root), "utf8"),
]);

test("manager uses the CALM identity in the masthead and favicon", () => {
  assert.match(html, /<link rel="icon" href="\.\/favicon\.svg" type="image\/svg\+xml">/);
  assert.match(html, /class="brand-mark"[^>]*><span>C<\/span><span>A<\/span><span>L<\/span><span>M<\/span>/);
  assert.match(html, /AI PASSPORT · CA LAUNCHER MGR。/);
  assert.match(css, /\.brand-mark\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*1fr\)/s);
  assert.match(favicon, /#d9ff63/i);
  assert.match(favicon, /#173b31/i);
  for (const letter of ["C", "A", "L", "M"]) assert.match(favicon, new RegExp(`>${letter}<`));
});

test("manager exposes semantic task and source tabs", () => {
  assert.match(html, /role="tablist" aria-label="管理任务"/);
  assert.match(html, /id="system-tab"[^>]+role="tab"[^>]+aria-controls="system-panel"/);
  assert.match(html, /id="play-tab"[^>]+role="tab"[^>]+aria-controls="play-panel"/);
  assert.match(html, /id="play-tab"[^>]+aria-selected="true"[^>]*>[\s\S]*?<span class="mode-number">01<\/span>/);
  assert.match(html, /id="system-tab"[^>]+aria-selected="false"[^>]*>[\s\S]*?<span class="mode-number">02<\/span>/);
  assert.match(html, /id="system-panel"[^>]+hidden/);
  assert.doesNotMatch(html, /id="play-panel"[^>]+hidden/);
  assert.match(app, /selectMode\(initialMode === "system" \? "system" : "play", false\)/);
  assert.match(html, /role="tablist" aria-label="玩法来源"/);
  assert.match(app, /enableArrowKeyTabs\("\[data-mode\]"/);
  assert.match(app, /enableArrowKeyTabs\("\[data-source\]"/);
});

test("official source supports title search, category browsing, and accessible card selection", () => {
  assert.match(html, /<label class="field catalog-search-field" for="catalog-search">/);
  assert.match(html, /id="catalog-search"[^>]+name="catalog_query"[^>]+type="search"[^>]+autocomplete="off"/);
  assert.match(html, /placeholder="搜索玩法名称…"/);
  assert.match(html, /id="catalog-categories"[^>]+role="tablist"[^>]+aria-label="玩法分类"/);
  assert.match(html, /id="catalog-status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /id="catalog-results"[^>]+role="list"/);
  assert.match(html, /id="catalog-load-more"[^>]*>加载更多玩法<\/button>/);
  assert.doesNotMatch(html, /搜索作者|作者搜索/);
  assert.match(app, /normalizeOfficialCatalog/);
  assert.match(app, /managerApiUrl\(`\/api\/catalog\?/);
  assert.match(app, /card\.type = "button"/);
  assert.match(app, /card\.setAttribute\("aria-label"/);
  assert.match(app, /selectCatalogPlay/);
  assert.match(app, /catalogQueryTimer = window\.setTimeout/);
  assert.match(app, /if \(category\.key === catalog\.category\) return;/);
  assert.doesNotMatch(app, /if \(catalog\.loading \|\| category\.key === catalog\.category\) return;/);
  assert.match(css, /\.catalog-card:focus-visible/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.catalog-grid/);
});

test("system installation begins with the official Launcher discovery step", () => {
  assert.match(html, /<span class="step-index"[^>]*>01<\/span>[\s\S]*?从官网获取启动器/);
  assert.match(html, /id="launcher-store-link"[^>]+aria-disabled="true"[^>]*>Cover-Arts 启动器<\/a>/);
  assert.match(html, /<span class="step-index"[^>]*>02<\/span>[\s\S]*?选择发布镜像/);
  assert.match(html, /<span class="step-index"[^>]*>03<\/span>[\s\S]*?确认迁移范围/);
});

test("manager provides visible focus, motion preferences, and safe-area support", () => {
  assert.match(html, /class="skip-link" href="#main-content"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(css, /transition:\s*all\b/);
});

test("device feedback remains visible regardless of the selected task", () => {
  assert.match(html, /id="device-status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /id="device-message"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(app, /connect\(\)\.catch\(\(error\) => setResult\("#device-message"/);
  assert.doesNotMatch(app, /connect\(\)\.catch\(\(error\) => setResult\("#system-result"/);
});

test("manual disconnect returns the device to Launcher before releasing serial", () => {
  assert.match(app, /resetAndDisconnect/);
  assert.match(app, /#disconnect"\)\.addEventListener\("click", disconnectToApplication\)/);
});

test("cover deck renders only installed plays and keeps append outside the deck", () => {
  assert.match(html, /id="slots" class="slot-deck" role="radiogroup"/);
  assert.match(app, /inspectDynamicLibraryFast/);
  assert.match(app, /for \(const slot of state\.slots\)/);
  assert.doesNotMatch(app, /cards\.push\(\{[\s\S]*?virtual:\s*true/);
  assert.match(app, /className = "slot-empty-state"/);
  assert.match(app, /state\.slots\.length < 16/);
  assert.match(app, /button\.className = `slot-card is-\$\{slot\.state\}`/);
  assert.match(app, /button\.setAttribute\("role", "radio"\)/);
  assert.match(app, /button\.setAttribute\("aria-checked"/);
  assert.match(app, /coverRgb565ToRgba/);
  assert.match(app, /cover\.className = "slot-cover"/);
  assert.match(css, /\.slot-cover\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.slot-deck\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
});

test("initial library scan reuses the partition table already read for target classification", () => {
  const connectFlow = app.match(/async function connect\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(connectFlow, /const identity = await readTargetIdentity\(\)/);
  assert.match(connectFlow, /inspectDynamicLibraryFast\(state\.loader, identity\.partitionTableSector\)/);
});

test("append transaction commits the dynamic directory last and keeps the session connected", () => {
  const install = app.match(/async function installPlay\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(install, /writeDynamicSidecar/);
  assert.match(install, /tableCommitStarted = true;[\s\S]*commitDynamicTable/);
  assert.match(install, /tableWritten[\s\S]*重新连接设备并扫描/);
  assert.match(install, /clearOtaSelection/);
  assert.match(install, /inspectDynamicLibraryFast/);
  assert.doesNotMatch(install, /resetToApplication|disconnect\(/);
  assert.match(install, /安装完成，可以继续安装其他玩法/);
  assert.match(install, /showPlayCompletion\([\s\S]*?state\.preparedPlay = null;/);
});

test("readback failure closes only the invalid session and keeps the prepared input", () => {
  const recovery = app.match(/async function discardFailedReadSession\(error\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(recovery, /error\.code !== "FLASH_READ_FAILED"/);
  assert.match(recovery, /await disconnect\(false\)/);
  assert.doesNotMatch(recovery, /resetToApplication|resetAndDisconnect|eraseRegion|preparedPlay\s*=|clearCoverPreview/);
  for (const name of ["installPlay", "repairMetadataCover", "eraseSelectedSlot", "installSystem"]) {
    const flow = app.match(new RegExp(`async function ${name}\\(\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    assert.match(flow, /catch \(error\)[\s\S]*await discardFailedReadSession\(error\)/);
  }
});

test("installation exposes timed phases and full readback progress before directory commit", () => {
  const flow = app.match(/async function installPlay\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(app, /performance\.now\(\)/);
  assert.match(flow, /installPhase\("App 完整读回", \(\) => readAppForVerification/);
  assert.match(flow, /App 完整读回[\s\S]*sha256\(readback\)[\s\S]*writeDynamicSidecar[\s\S]*tableCommitStarted = true/);
  assert.match(app, /App 读回校验 \$\{percent\}%/);
});

test("play session exposes an explicit final reset and clears the previous draft", () => {
  assert.match(html, /id="finish-play-session"[^>]*>完成并重启<\/button>/);
  assert.match(html, /id="install-another"[^>]*>继续安装其他玩法<\/button>/);
  assert.match(app, /async function finishPlaySession\(\)/);
  assert.match(app, /finishPlaySession[\s\S]*resetAndDisconnect\(state\.transport\)/);
  assert.match(app, /#finish-play-session"\)\.addEventListener\("click", finishPlaySession\)/);
  assert.match(app, /function prepareAnotherPlay\(\)/);
  assert.match(app, /prepareAnotherPlay[\s\S]*state\.preparedPlay = null/);
  assert.match(app, /#install-another"\)\.addEventListener\("click", prepareAnotherPlay\)/);
});

test("continuous installs refresh the stub session without another port picker", () => {
  assert.match(app, /async function refreshContinuousSession\(\)/);
  assert.match(app, /new Transport\(state\.port, false\)/);
  assert.match(app, /连续安装会话已自动刷新；无需重新选择串口/);
  const continuation = app.match(/async function prepareAnotherPlay\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(continuation, /await refreshContinuousSession\(\)/);
  assert.doesNotMatch(continuation, /requestPort\(/);
});

test("deployed manager includes the protected serial transport module", () => {
  assert.match(app, /protectTransportWrites\(new Transport/);
  const protectedConnections = app.match(/protectTransportReads\(protectTransportWrites\(new Transport\(state\.port, false\)\)\)/g);
  assert.equal(protectedConnections?.length, 2, "initial and continuous sessions must both use optimized receive");
  assert.match(app, /protectLoaderFlashReads\(new ESPLoader/);
  assert.match(cloudflareBuild, /"serial-transport\.js"/);
  assert.match(cloudflareBuild, /"play-catalog\.js"/);
});

test("Cloudflare bundle includes the v1.5 manager support modules", () => {
  for (const moduleName of [
    "slot-inspector.js",
    "title-font.js",
    "title-glyphs.js",
    "trust-record.js",
  ]) {
    assert.match(cloudflareBuild, new RegExp(`"${moduleName.replace(".", "\\.")}"`));
  }
});

test("Vercel deploy excludes duplicate module API shims", () => {
  assert.match(vercelIgnore, /^api\/catalog\.mjs$/m);
  assert.match(vercelIgnore, /^api\/play\.mjs$/m);
  assert.match(vercelIgnore, /^api\/resource\.mjs$/m);
});

test("manager uses the stable Web Serial baud rate for sustained writes", () => {
  assert.match(app, /const WEB_SERIAL_BAUDRATE = 115200/);
  assert.match(app, /baudrate: WEB_SERIAL_BAUDRATE/);
  assert.doesNotMatch(app, /baudrate:\s*460800/);
});

test("high-speed App readback is explicit opt-in and disabled while busy", () => {
  const input = html.match(/<input\b[^>]*id="fast-app-readback"[^>]*>/)?.[0] ?? "";
  assert.match(input, /type="checkbox"/);
  assert.match(input, /name="fast_app_readback"/);
  assert.doesNotMatch(input, /\bchecked\b/);
  assert.match(html, /115200[\s\S]*230400/);
  assert.match(app, /\$\("#fast-app-readback"\)\.disabled = state\.busy/);
});

test("default App readback retains 115200 across consecutive verifications without reopening", async () => {
  const wrapper = app.match(/async function withAppReadbackRate\(action\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(wrapper);
  const notices = [];
  const loader = {
    IS_STUB: true,
    transport: { baudrate: 115200 },
    changeBaud() { assert.fail("default readback must not reopen serial"); },
    readFlash() { assert.fail("same-rate readback must not issue a switch probe"); },
  };
  const run = new Function("state", "$", "log", "withFlashReadBaud", "WEB_SERIAL_BAUDRATE", "APP_READBACK_BAUDRATE",
    `return async function(action) {${wrapper}\n};`)({ loader },
    () => ({ checked: false }), (notice) => notices.push(notice), withFlashReadBaud, 115200, 230400);
  for (let index = 0; index < 2; index++) {
    assert.equal(await run(async () => {
      assert.equal(loader.transport.baudrate, 115200);
      return "full App verified";
    }), "full App verified");
  }
  assert.equal(notices.length, 2);
  for (const notice of notices) assert.match(notice, /兼容模式.*115200/);
  const failure = Object.assign(new Error("READ_FLASH interrupted"), { code: "FLASH_READ_FAILED" });
  await assert.rejects(run(async () => { throw failure; }), (error) => error === failure);
  await assert.rejects(run(async () => assert.fail("broken session must not be reused")), /重新连接/);
});

test("only opted-in complete App readback and SHA verification use the faster rate before sidecar writes", () => {
  assert.match(app, /const APP_READBACK_BAUDRATE = 230400/);
  const wrapper = app.match(/async function withAppReadbackRate\(action\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(wrapper, /\$\("#fast-app-readback"\)\.checked \? APP_READBACK_BAUDRATE : WEB_SERIAL_BAUDRATE/);
  assert.match(wrapper, /withFlashReadBaud\(state\.loader, baudrate, action/);
  assert.match(wrapper, /已恢复写入速率/);
  const install = app.match(/async function installPlay\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(install, /await withAppReadbackRate\(async \(\) => \{[\s\S]*App 完整读回[\s\S]*App SHA 与结构校验[\s\S]*\n    \}\);\n    log\([\s\S]*writeDynamicSidecar/);
  const repair = app.match(/async function repairMetadataCover\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(repair, /await withAppReadbackRate\(async \(\) => \{[\s\S]*sha256\(readback\)[\s\S]*\n    \}\);\n    await writeDynamicSidecar/);
  const system = app.match(/async function installSystem\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.doesNotMatch(system, /withAppReadbackRate/);
});

test("images declare dimensions and destructive erase is progressively disclosed", () => {
  const images = [...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(images.length >= 2);
  for (const image of images) {
    assert.match(image, /\bwidth="\d+"/);
    assert.match(image, /\bheight="\d+"/);
  }
  assert.match(html, /<details class="danger-zone">/);
  assert.match(html, /id="erase-confirm"[^>]+type="checkbox"/);
});

test("arbitrary deletion reassigns sidecars before committing and reuses released space", () => {
  const removal = app.match(/async function eraseSelectedSlot\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(html, /可移除任意玩法/);
  assert.match(app, /removeDynamicSlot/);
  assert.match(app, /writeReassignedDynamicSidecar/);
  assert.match(removal, /for \(const move of plan\.moves\)[\s\S]*writeReassignedDynamicSidecar/);
  assert.match(removal, /writeReassignedDynamicSidecar[\s\S]*commitDynamicTable/);
  assert.match(removal, /commitDynamicTable[\s\S]*clearOtaSelection[\s\S]*inspectDynamicLibraryFast[\s\S]*eraseRegion/);
  assert.doesNotMatch(removal, /slotId !== state\.slots\.length - 1/);
});

test("all editable manager inputs have stable names", () => {
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(inputs.length > 0);
  for (const input of inputs) assert.match(input, /\bname="[^"]+"/);
});
