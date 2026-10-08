<p align="right">
  <strong>简体中文</strong> · <a href="README.md">English</a>
</p>

# Cover Arts Launcher

Cover Arts Launcher 可以把 FoloToy AI Passport 变成以封面为主的玩法库。设备只展示
实际已安装的玩法，用户可浏览封面、启动玩法，并在重启或重新上电后回到玩法库。

本仓库包含 Launcher 固件、浏览器端管理工具、Host tests、构建工具和供创作者选择接入的
兼容 Skill。当前公开版本为 **v1.6.0**。

## 它能做什么

- 按已校验玩法固件的实际大小分配空间，不再固定预留三个 2 MiB 位置。
- 只显示已安装玩法：安装 1 个显示 1 张封面，安装 2 个显示 2 张，以此类推。
- 使用 `Up`、`Down` 浏览，按 `OK` 启动，长按 `OK` 查看详情。
- 详情页显示版本、首次安装时间、最近安装／更新时间和启动次数。
- 支持中文玩法名称，并在安装前检查 Launcher 字形覆盖。
- 通用兼容玩法无需 Launcher SDK，也无需修改源码即可安装和启动。
- 支持删除任意已安装玩法、立即补齐逻辑位置，并让后续玩法复用释放的空间。
- 同一次浏览器串口授权可连续安装多个玩法，完成玩法库管理后再统一重启设备。
- 重启或重新上电后返回 Launcher，不会删除已安装玩法。
- 创作者可选择在玩法已有封面页接入长按 `Up` 返回；该操作不会占用游戏过程中的按键。

## 安装 v1.6.0

推荐使用线上[玩法管理器](https://calm.yishan.app/)。请使用桌面版 Chrome 或 Edge，
通过支持数据传输的 USB 线连接 AI Passport，然后选择完整安装 Launcher。

从 [v1.6.0 Release](https://github.com/yishan/cover-arts-launcher/releases/tag/v1.6.0)
下载：

- `FoloToy-AI-Passport-Cover-Arts-Launcher-v1.6.0-full.bin`：从 `0x0` 写入的完整
  8 MiB 固件。
- `FoloToy-AI-Passport-Cover-Arts-Launcher-v1.6.0-full.bin.zip`：同一固件的压缩包；
  选择写入前先解压。
- `SHA256SUMS.txt`：发布时生成的完整性校验值。
- `THIRD_PARTY_NOTICES.md`：来源和许可证致谢。

v1.6.0 的玩法区域为 6.9375 MiB，比 v1.5.0 多 512 KiB。采用紧凑布局需要完整初始化，
会清除已安装的玩法和封面；写入原始完整镜像还可能重置已有设置。请准备重新安装玩法，
保存需要保留的数据，并先阅读[安装指南](docs/installation.zh_CN.md)。

## 使用玩法库

1. 打开[玩法管理器](https://calm.yishan.app/)并连接设备。
2. 按玩法名称搜索或按分类浏览官方玩法，选择卡片；也可以填写官方 Play URL，或选择本地兼容的 `.bin` 文件。
3. 核对识别到的标题、版本、Source ID、固件哈希和封面。
4. 连续安装一个或多个玩法；v1.6.0 按逻辑顺序追加，并优先复用能够容纳玩法的最小释放空间。
5. 完成本次会话后统一重启设备，在真机上确认新封面和启动行为。

详情页、故障恢复及通用玩法行为见[用户指南](docs/user-guide.zh_CN.md)。

## 创作者可选接入

安装和启动玩法不要求任何接入。未接入时，用户重启或重新上电即可返回 Launcher。
希望提供更快捷返回方式的创作者，可以使用
[`ai-passport-cover-arts-launcher`](skills/ai-passport-cover-arts-launcher/SKILL.zh_CN.md)
Skill，仅在玩法已有封面页或开始页接入 `Up Long`。公开指南和 Agent 提示词位于
[calm.yishan.app/skills](https://calm.yishan.app/skills/)。

## 开发与验证

目标硬件：ESP32-C3、8 MiB Flash、无 PSRAM；工具链：ESP-IDF 5.5.3。

```bash
./tools/validate.sh --static
./tools/validate.sh --firmware
./tools/validate.sh
```

构建成功不等于真机验证；候选发布版本仍需在真实 AI Passport 上验收。

## 许可证与致谢

本仓库按 [MIT License](LICENSE) 开源。项目基于 FoloToy AI Passport 基线开发，并包含经适配
或固定版本引入的第三方工作，相关声明均保留在仓库中。详见
[第三方声明](docs/THIRD_PARTY_NOTICES.zh_CN.md)和
[meta-pass 借鉴边界](docs/reference/meta-pass-borrowing.zh_CN.md)。
