<p align="right">
  <strong>简体中文</strong> · <a href="README.md">English</a>
</p>

# Cover Arts Launcher

Cover Arts Launcher 可以把 FoloToy AI Passport 变成一个拥有三个安装位置的玩法库。
用户通过实体按键浏览完整封面、启动任意已安装玩法，并可在重启或重新上电后回到玩法库。

本仓库包含 ESP32-C3 Launcher 固件、浏览器玩法管理器、Host tests、构建工具和供创作者
选择接入的兼容 Skill。首个公开版本为 **v1.0.0**。

## 它能做什么

- 在三个固定 App 位置中保存最多三个独立 ESP32-C3 玩法。
- 以 Cover Art 展示当前玩法，并在屏幕两侧露出相邻封面。
- 使用 `Up`、`Down` 浏览，按 `OK` 启动。
- 重启或重新上电后返回 Launcher，不会删除已安装玩法。
- 通用兼容玩法无需接入 Launcher SDK，也无需修改源码即可安装和启动。
- 创作者可选择在玩法已有封面页接入长按 `Up` 返回；该操作不会占用游戏过程中的按键。
- 在本地浏览器中完成固件、标题、版本、Source ID、封面预览、图片转换、校验、替换和擦除。

## 安装 v1.0.0

推荐使用线上[玩法管理器](https://cover-arts-launcher.yishan.app/)。请使用桌面版 Chrome
或 Edge，通过支持数据传输的 USB 线连接 AI Passport，然后选择“完整安装 Launcher”。

从 [v1.0.0 Release](https://github.com/yishan/cover-arts-launcher/releases/tag/v1.0.0)
下载：

- `FoloToy-AI-Passport-Cover-Arts-Launcher-v1.0.0-full.bin`：从 `0x0` 写入的完整
  8 MiB 固件。
- `FoloToy-AI-Passport-Cover-Arts-Launcher-v1.0.0-full.bin.zip`：同一固件的下载压缩包；
  选择写入前先解压。
- `SHA256SUMS.txt`：发布时生成的完整性校验值。
- `THIRD_PARTY_NOTICES.md`：来源和许可证致谢。

完整安装会替换原有 Flash 分区布局，并清空三个玩法位置、封面和 Launcher OTA 状态。
请先备份或准备重新安装需要保留的玩法。开始前请阅读[安装指南](docs/installation.zh_CN.md)。

## 使用玩法库

1. 打开[玩法管理器](https://cover-arts-launcher.yishan.app/)并连接设备。
2. 导入官方 Play URL，或选择本地兼容的 `.bin` 文件。
3. 核对识别到的标题、版本、Source ID、固件哈希和封面。
4. 选择三个位置中的一个并安装。
5. 管理器发送复位请求后，在设备上确认新封面已经出现。

替换、擦除、故障恢复及通用玩法行为见[用户指南](docs/user-guide.zh_CN.md)。

## 创作者可选接入

安装和启动玩法不要求任何接入。未接入时，用户重启或重新上电即可返回 Launcher。
希望提供更快捷返回方式的创作者，可以使用
[`ai-passport-cover-arts-launcher`](skills/ai-passport-cover-arts-launcher/SKILL.zh_CN.md)
Skill，仅在玩法已有封面页接入 `Up Long`。公开指南和 Agent 提示词位于
[cover-arts-launcher.yishan.app/skills](https://cover-arts-launcher.yishan.app/skills/)。

## 开发与验证

目标硬件：ESP32-C3、8 MiB Flash、无 PSRAM；工具链：ESP-IDF 5.5.3。

```bash
./tools/validate.sh --static
./tools/validate.sh --firmware
./tools/validate.sh
```

在本地运行玩法管理器：

```bash
cd tools/install-slot
npm ci
npm start
```

然后使用桌面版 Chrome 或 Edge 打开 `http://127.0.0.1:4173`。构建成功不等于真机验证；
候选发布版本仍需在真实 AI Passport 上验收。

## 许可证与致谢

本仓库按 [MIT License](LICENSE) 开源。项目基于 FoloToy AI Passport 基线开发，并包含经适配
或固定版本引入的第三方工作，相关声明均保留在仓库中。详见
[第三方声明](docs/THIRD_PARTY_NOTICES.zh_CN.md)和
[meta-pass 借鉴边界](docs/reference/meta-pass-borrowing.zh_CN.md)。
