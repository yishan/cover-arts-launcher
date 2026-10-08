<p align="right">
  <strong>简体中文</strong> · <a href="README.md">English</a>
</p>

# 玩法管理器

玩法管理器用于安装多玩法 Launcher，并管理从设备分区表实时发现的玩法库。每个玩法只占用“实际镜像长度向上对齐到 64 KiB + 64 KiB DPS1 sidecar”，不再预留三个固定 2 MiB 位置。

## 本地运行

新版管理器兼容已发布 v1.5.0 动态分区与 v1.6.0 紧凑候选版。分配起点来自设备实际
Factory 终点，安装和删除提交目录时保持当前布局。紧凑初始化增加 512 KiB，但移除
原玩法和封面；仅更新 Factory 程序不会增加容量。初始化前请阅读
[紧凑分区迁移说明](../../docs/plans/2026-10-08-compact-launcher-layout.zh_CN.md)。
应先部署此管理器，再分发紧凑固件；旧固定边界管理器无法识别该布局。

请使用电脑端 Chrome 或 Edge。Web Serial 需要安全上下文；随附的回环地址服务器满足要求，并为 `ai-passport.folotoy.cn` 的公开玩法资料和资源提供严格限域代理。

```bash
cd tools/install-slot
npm ci
npm start
```

打开 `http://127.0.0.1:4173`。工具和随附的浏览器依赖均在本地运行。代理只接受官方玩法详情/API URL、按名称或分类发起的目录查询，以及官方 `/api/` 固件或图片资源，不是通用代理。

## 部署到 Vercel

将此目录作为 Vercel 项目根目录部署。`index.html` 与内置浏览器运行时作为静态文件提供；`/api/catalog`、`/api/play` 和 `/api/resource` 由 Vercel Functions 提供，并沿用本地服务的白名单：只接受官方玩法目录查询、官方 AI Passport Play URL 与官方 `/api/` 资源，拒绝跨域重定向，也不会成为通用代理。

部署后的页面必须在桌面 Chrome 或 Edge 中通过 HTTPS 打开才能使用 Web Serial；Vercel 会自动提供 HTTPS。预览部署在提升到生产域名前，应使用官方玩法 URL 与真机连接完成验证。

## 在保留 Vercel 的同时部署到 Cloudflare Pages

Vercel 部署和 `https://calm.yishan.app/` 可以继续作为正式站，Cloudflare Pages 则从同一份源码发布到默认 `https://cover-arts-launcher.pages.dev/` 地址或其他域名。两个目标共用 `lib/official-proxy-core.js` 中的白名单和上游校验；`api/` 是 Vercel 适配层，`functions/` 是 Cloudflare Pages Functions 适配层。

在本地构建并测试 Cloudflare 产物：

```bash
npm ci
npm run build:cloudflare
npm run dev:cloudflare
```

构建过程只会将明确允许公开的文件复制到 `dist/`，并生成 Pages 使用的 `_headers`、`_redirects` 和 `_routes.json`，测试与服务端源码不会进入静态发布目录。在已经完成 Cloudflare 登录的电脑上部署：

```bash
npx wrangler whoami
npm run deploy:cloudflare
```

在官方 API 路由、Skill 下载、Web Serial 连接和真机操作通过验证前，Cloudflare 项目保持使用平台生成的域名。本并行部署不会改变 Vercel 正式域名及其重定向。当前 Cloudflare 项目采用 Direct Upload；从 `main` 运行 `npm run deploy:cloudflare` 会更新固定生产地址，其他分支则生成预览部署。CI 服务也可以使用权限受限的 Cloudflare API Token 运行同一命令。Cloudflare 不支持把 Direct Upload 项目改为原生 Git 集成；如以后希望使用 Cloudflare 原生 Git 构建，需要另建 Pages 项目，并将此目录设为项目根目录、`npm ci && npm run build:cloudflare` 设为构建命令、`dist` 设为输出目录。

## 完整系统安装

完整系统安装是一次性迁移。启用安装前，它会读取已连接芯片、Flash 容量及分区表扇区。只接受 8 MiB Flash 的 ESP32-C3，以及已知旧单 factory 布局、固定三位置 Launcher 布局或有效动态 Launcher 布局。任何未知分区或无效分区表 MD5 都会保守拒绝。

选择已发布的完整合并镜像并输入发布方 SHA-256。安装器会验证 SHA 和镜像内的 Launcher 分区表，然后明确擦除动态玩法区和 `otadata`。它只写入 bootloader、分区表和精确长度的 factory Launcher，逐段读回，在每个擦除范围首尾采样，并确认 OTA 元数据及动态玩法库均为空。

此流程不支持续传。线缆或电源中断后，请重新进入 ROM 下载模式，从迁移警告开始完整重试。成功后，“安装第一个玩法”和“以空玩法库完成”是同等正常的结果。

## 动态玩法安装

玩法来源可以从官方玩法库按名称或分类浏览并选择，也可以填写官方玩法详情/API URL，或选择本地 `.bin`。目录卡片展示发布封面、名称、作者、分类和固件大小；选择卡片后复用同一条官方下载与校验链路。作者名称当前只展示，不作为搜索条件。官方路径从公开 API 取得 `downloadUrl`、`firmwareSha256`、身份、标题、版本和封面信息，先验证下载文件再提取。本地文件可以填写预期 SHA；留空时以本地文件计算值为准。

官方来源的身份按 `play:<projectId>` 保存；标题优先使用中文，版本优先使用 `shareVersion`。从官方 URL 读取完成后，页面会同时展示标题、版本、Source ID 和封面。

支持 ESP32-C3 app-only 镜像和合并镜像。合并镜像必须带有效分区表 MD5 和 factory app。提取出的 app 可以使用玩法区内的可用容量；页面显示的 app SHA 会写入 DPS1 记录并与封面绑定。

玩法不需要接入 Launcher SDK 或健康确认回调。每次启动采用一次性 OTA 启动：用户复位或重新上电后返回 Launcher，已校验玩法仍以原名称和封面显示，并可再次启动。只有需要在玩法内直接返回时，才需要可选适配。

管理器实时读取分区表，并把新玩法追加到逻辑玩法库。物理空间优先选择能够容纳本次玩法的最小已释放空洞，没有合适空洞时才使用尾部空间。它先擦写选定分配区域，完整读回 App 并核验 SHA，随后处理官方封面或用户选择的 PNG、JPEG、WebP。封面在浏览器内居中裁切为 120×160，预览压缩到不超过 50 KiB，不上传第三方；设备数据固定为 38,400 字节 RGB565。

DPS1 记录保存标题、版本、Source ID、App 长度与 SHA、首次/最近安装时间及封面 CRC。App 和 sidecar 均读回通过后，管理器才提交带 MD5 的新分区表、清空 `otadata` 并重新扫描玩法库。单个玩法安装完成后设备保持当前下载会话，用户可以继续追加其他玩法；点击“完成并重启”后才退出下载模式、启动 Launcher 并断开网页串口。启动次数由 Launcher 保存在 NVS；不存在计数器时初始值为 0。

最终提交分区表前发生任何失败，旧玩法目录保持不变，未完成字节不可启动。若分区表写入本身被中断，管理器会提示可能需要完整系统恢复；若分区表已经写入、只是写后确认被中断，则优先要求重新连接并扫描，只有动态玩法库无法识别时才建议恢复。管理器还会串行执行 Web Serial 写入，并在异常路径中也释放 writer，避免写入流遗留锁定。

Flash 读回采用预分配结果缓冲区，最多允许一个 4 KiB Stub 数据包在途，并逐包发送
累计字节数确认。串口输入改为数据到达时唤醒的分块队列，SLIP 解包写入可扩展缓冲区，
避免 1 ms 轮询和逐字节复制。待处理输入上限为 1 MiB，单个解码包上限为 64 KiB。
每次读包使用一个总超时；输入流关闭或损坏时立即失败，不返回不完整数据。断开连接时
取消 reader 并释放锁，再进入新会话。发送下一条命令前会消费最后的 16 字节 MD5 结束包；提交目录前
仍须通过 App SHA 和原有的元数据、封面检查。日志分别记录擦除、写入、完整读回、
校验和提交耗时。写入、封面/元数据读取及目录操作仍使用 115200；仅 App 完整读回及其
SHA/结构校验临时使用 230400，修复封面时的 App SHA 核对也采用此速率。管理器向 Stub
传入实际切换前速率，重新打开受保护串口流，并在切换前后比对 32 字节分区表头。
确认恢复至 115200 后才允许写入 sidecar 或目录。速率切换或恢复失败会关闭失效会话；
App 读回失步后不会再发送恢复速率命令。原生只读测试中，同一份 1,238,288 字节 App
回读约从 109 秒降至 56 秒；网页安装速度与连续安装稳定性仍需真机验收。
读回或确认包发送失败时，管理器关闭失效串口会话，不自动复位或
擦除设备；已准备的固件和封面保留，可重新连接后重试。本次仅修改管理器，无需
重刷 Launcher。结束旧连接后刷新页面才能载入新的读回实现；仍需完成真机验收。

现在可以移除任意逻辑位置。提交新目录前，管理器先在后续玩法的非活动 DPS1 bank 中写入新逻辑编号，再提交连续编号的分区表、清空 `otadata`、重新扫描并核对所有保留玩法身份，最后擦除被删除玩法的完整分配区域。App 字节不会搬动；Launcher 的启动次数按稳定 Source ID 或固件 SHA 迁移，不跟随旧位置键丢失。释放空洞会自动复用；当总空闲空间足够、但没有单个连续空洞能容纳玩法时，仍需未来单独提供的“整理空间”操作。

## 验证与来源

```bash
npm test
```

ESP 镜像与分区解析器实质性改编自 `meta-pass` 提交 `994caaf52357d97323bffb82b2db9cc784afb1eb`。MIT 声明保留在 `extract-app-image.js` 和 `LICENSE.meta-pass.txt`。当前 Web Serial 运行时使用官方 `esptool-js` 0.6.1 的 `bundle.js`，依赖版本与完整性由 lockfile 精确固定，浏览器文件保存为 `vendor/esptool-js-0.6.1.js`，Apache-2.0 声明保存为 `vendor/LICENSE.esptool-js.txt`。运行 `npm run vendor:esptool` 可以重新生成这两个文件。旧版 0.5.6 运行时及其支持文件暂时仅用于回退，应用不再导入。本项目的分区、尺寸、manifest、写入范围、运行时版本和恢复契约由本地测试定义。

主机测试不能代替实机验收。在 Web Serial 门禁完成前，需在目标设备上测试：完整安装成功、空库首次追加、不同大小玩法连续追加、目录提交前后断线/断电、app-only 与合并玩法安装、sidecar 失败、删除首位/中间/末位、逻辑重排、空洞复用、启动次数保留，以及复位后的 Launcher 名称与封面显示。
