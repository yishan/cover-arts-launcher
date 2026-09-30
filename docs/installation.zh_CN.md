<p align="right">
  <strong>简体中文</strong> · <a href="installation.md">English</a>
</p>

# 安装 Cover Arts Launcher v1.5.0

## 准备条件

- 使用 ESP32-C3、8 MiB Flash 的 FoloToy AI Passport。
- 支持 Web Serial 的桌面版 Chrome 或 Edge。
- 支持数据传输的 USB 线和稳定供电。
- 从同一个 GitHub Release 下载 v1.5.0 完整固件及 `SHA256SUMS.txt`。

## 安装前须知

“完整安装”不是原地更新玩法。从 v1.3.1 之前的固定位置 Launcher 迁移时，它会切换到动态玩法
区域，并清除旧布局下已安装的玩法与封面，完成后需要重新添加玩法。v1.3.1 与 v1.5.0 使用相同
的动态存储布局，但完整系统写入仍可能替换已有数据；开始前请先导出必须保留的内容。

操作过程中请保持线缆和供电稳定。如果浏览器、线缆或电源中断，请让设备重新进入 ROM 下载模式，
重新连接，并从完整安装的第一步重新开始。

## 推荐的浏览器安装流程

1. 从 [v1.5.0 Release](https://github.com/yishan/cover-arts-launcher/releases/tag/v1.5.0)
   下载 `FoloToy-AI-Passport-Cover-Arts-Launcher-v1.5.0-full.bin` 和 `SHA256SUMS.txt`。
2. 使用桌面版 Chrome 或 Edge 打开[玩法管理器](https://calm.yishan.app/)。
3. 选择完整安装 Launcher，并连接 USB Serial/JTAG 设备。
4. 选择完整 `.bin`，输入发布的 SHA-256，核对芯片、Flash 大小和布局迁移警告。
5. 确认安装，等待擦除、写入和回读校验完成。
6. 设备重启后，确认进入 Cover Art 玩法库。玩法库为空是有效的初始状态。

## 校验文件完整性

macOS 或 Linux：

```bash
shasum -a 256 -c SHA256SUMS.txt
```

Windows PowerShell：

```powershell
Get-FileHash .\FoloToy-AI-Passport-Cover-Arts-Launcher-v1.5.0-full.bin -Algorithm SHA256
```

将结果与 `SHA256SUMS.txt` 对比。

## 故障恢复

安装失败后，不要尝试启动写入不完整的系统。请保留错误提示，重新连接，然后重新执行完整安装。
如果需要完全退出 Cover Arts Launcher，请针对准确的 AI Passport 硬件版本使用官方恢复或固件安装流程。
