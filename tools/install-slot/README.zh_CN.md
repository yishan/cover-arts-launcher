<p align="right">
  <strong>简体中文</strong> · <a href="README.md">English</a>
</p>

# 玩法管理器

玩法管理器是一个本地浏览器工具，用于安装多玩法 Launcher，之后管理三个玩法位置。当前网页仍属于工程预览；设备端已经使用图形化 Cover Art 选择器。

## 本地运行

请使用电脑端 Chrome 或 Edge。Web Serial 需要安全上下文；随附的回环地址服务器满足要求，并为 `ai-passport.folotoy.cn` 的公开玩法资料和资源提供严格限域代理。

```bash
cd tools/install-slot
npm ci
npm start
```

打开 `http://127.0.0.1:4173`。工具和随附的浏览器依赖均在本地运行。代理只接受官方玩法详情/API URL，以及官方 `/api/` 固件或图片资源，不是通用代理。

## 完整系统安装

完整系统安装是一次性迁移。启用安装前，它会读取已连接芯片、Flash 容量及分区表扇区。只接受 8 MiB Flash 的 ESP32-C3，以及已知旧单 factory 布局或完全匹配的 Launcher 布局。任何未知分区或无效分区表 MD5 都会保守拒绝。

选择已发布的完整合并镜像并输入发布方 SHA-256。安装器会验证发布 SHA、镜像内的 Launcher 分区表以及 factory App 的 checksum/appended SHA，然后明确擦除三个 OTA 位置、六个封面银行和 `otadata`。它只写入 bootloader、分区表和精确长度的 factory Launcher，逐段读回，在每个擦除范围首尾采样，并确认 OTA 元数据为空、三个玩法启动头为空。最后发送复位指令；Launcher 是否正常显示仍由用户在设备上确认。

此流程不支持续传。线缆或电源中断后，请重新进入 ROM 下载模式，从迁移警告开始完整重试。成功后，“安装第一个玩法”和“以空玩法库完成”是同等正常的结果。

## 玩法位置安装

玩法来源可以是官方玩法详情/API URL，也可以是本地 `.bin`。官方路径从公开 API 取得 `downloadUrl`、`firmwareSha256`、身份、标题、版本和封面信息，先验证下载文件再提取。本地文件可以填写预期 SHA；留空时以本地文件计算值为准。

官方来源的身份按 `play:<projectId>` 保存；标题优先使用中文，版本优先使用 `shareVersion`。从官方 URL 读取完成后，页面会同时展示标题、版本、Source ID 和封面。

支持 ESP32-C3 app-only 镜像和合并镜像。合并镜像必须带有效分区表 MD5 和 factory app。提取出的 app 必须完整放入 2 MiB OTA 位置，并在擦除目标位置前通过 segment 边界、checksum 和 appended SHA-256 校验。页面显示的 app SHA 会写入封面清单，与封面绑定。连接设备时，网页重新验证已安装 App，并且只接受 App SHA、manifest 和封面 payload CRC 全部一致的名称与封面。

玩法不需要接入 Launcher SDK 或健康确认回调。每次启动采用一次性 OTA 启动：用户复位或重新上电后返回 Launcher，已校验玩法仍以原名称和封面显示，并可再次启动。只有需要在玩法内直接返回时，才需要可选适配。

创作者如需可选快捷返回，可使用
[`ai-passport-cover-arts-launcher`](../../skills/ai-passport-cover-arts-launcher/SKILL.zh_CN.md)
Skill。它只在玩法已有的封面／开始页接入 Up Long，不会占用游戏、设置或其他
状态中的同一按键。公开指南、Agent 提示词和 Skill 下载地址为
`https://cover-arts-launcher.yishan.app/skills/`。

目标建议顺序为：相同 `source_id` 原位更新、第一个空位置、最后才要求用户明确选择替换。玩法安装只擦写被选中的 OTA 位置。官方封面或用户选择的 PNG、JPEG、WebP 会在浏览器内居中裁切并生成 120×160 预览；预览文件压缩到不超过 50 KiB，不上传到第三方。随后生成固定 38,400 字节的 RGB565 设备数据；安装器擦除非活动的 64 KiB 封面银行，写入并验证 payload，最后提交 manifest。它绝不写入 NVS、PHY、factory Launcher 或分区表。

App 写入或校验失败时，安装器会尝试擦除启动头并读回确认；只有读回为空时才声明该位置不可启动，清理失败则明确标记为“状态未知”，要求重新连接扫描。封面失败时，已验证 App 仍可启动，并提供“仅重试封面”和“使用占位图完成并重启”。网页只声明 Flash 数据已验证和复位指令已发送，最终 Launcher 显示需要在设备上确认。

每次新安装在 App 读回验证后写入一条双 bank 信任收据，绑定目标位置、App 长度和 App SHA-256。旧版 SHA 绑定封面可作为迁移凭据；没有收据和封面的既有通用玩法保持兼容启动，但不会显示为“已验证常驻”。

当前收据还会保存浏览器提供的首次安装时间、最近一次安装／更新时间及对应 UTC 偏移。同一稳定玩法身份执行更新时保留首次安装时间，并刷新最近安装时间。旧版收据继续有效，但在该玩法再次安装或更新前，详情页相应字段显示“暂无记录”。只修复名称或封面不会伪造一次安装时间。

Launcher 在切换到所选玩法前，把该玩法的启动次数写入自己的 NVS。位置被替换为不同玩法身份后，页面从 0 次重新显示；统计写入失败只记录日志，不会阻止已验证玩法启动。

输入标题时页面会在写入前按 Launcher 实际字体清单检查 UTF-8 长度和字符覆盖。未收录字符会显示字符及 Unicode 码点，并阻止安装，避免设备端出现方框占位。

选择位置并明确勾选确认后，“擦除所选位置”会清空该位置完整的 2 MiB App 区域、两个 64 KiB 封面 bank 和两个 4 KiB 信任 bank，并对各范围的首尾取样验证。此操作不会擦除 Launcher、NVS、PHY、分区表或另外两个位置。

## 验证与来源

```bash
npm test
```

ESP 镜像与分区解析器实质性改编自 `meta-pass` 提交 `994caaf52357d97323bffb82b2db9cc784afb1eb`。MIT 声明保留在 `extract-app-image.js` 和 `LICENSE.meta-pass.txt`。当前 Web Serial 运行时使用官方 `esptool-js` 0.6.1 的 `bundle.js`，依赖版本与完整性由 lockfile 精确固定，浏览器文件保存为 `vendor/esptool-js-0.6.1.js`，Apache-2.0 声明保存为 `vendor/LICENSE.esptool-js.txt`。运行 `npm run vendor:esptool` 可以重新生成这两个文件。旧版 0.5.6 运行时及其支持文件暂时仅用于回退，应用不再导入。本项目的分区、尺寸、manifest、写入范围、运行时版本和恢复契约由本地测试定义。

主机测试不能代替实机验收。在 Web Serial 门禁完成前，需在目标设备上测试：完整安装成功、擦除和各写入阶段的断线/断电、app-only 与合并玩法安装、App 失败、封面失败，以及仅重试封面。
