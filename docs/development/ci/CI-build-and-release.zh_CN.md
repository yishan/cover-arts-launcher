<p align="right">
  <strong>简体中文</strong> · <a href="CI-build-and-release.md">English</a>
</p>

# 自动构建与发布

Launcher 唯一发布仓库为 `yishan/cover-arts-launcher`。完整本地与 GitHub 操作顺序见
[发布 SOP](../release/launcher-release-sop.zh_CN.md)。本页说明
`.github/workflows/build-firmware.yml` 的自动化行为。

## 触发与目标

推送标签触发构建和 Release。手动 `workflow_dispatch` 构建所选 ref，只有 ref 是标签时
才创建 Release。普通分支推送不触发固件构建。

两个 job 均限定 `github.repository == 'yishan/cover-arts-launcher'`。
编译前执行 `tools/release_preflight.py --phase ci`，检查 origin、中英文发布说明及
标签与版本一致性。标签为 `vX.Y.Z`，对应 `firmware_version.txt`；标题为
`Cover Arts Launcher vX.Y.Z`。本仓库只发布一个产品，不采用继承的多应用标签后缀。

## 构建与资产

build job 恢复 ccache，在 ESP-IDF 5.5.3 / ESP32-C3 环境运行
`./tools/validate.sh --firmware`。检查镜像段与 `flash_args` 一致、分区边界、
8 MB Flash 设置及完整合并镜像。这些检查不替代本地静态/主机测试或真机验收。

build 上传五个资产，release job 下载后发布：

- `FoloToy-AI-Passport-Cover-Arts-Launcher-vX.Y.Z-full.bin`；
- 包含同一 bin 的 ZIP；
- 校验 bin 与 ZIP 的 `SHA256SUMS.txt`；
- `THIRD_PARTY_NOTICES.md`；
- `THIRD_PARTY_NOTICES.zh_CN.md`。

完整 bin 为 8 MiB，从 `0x0` 写入。ZIP 仅用于下载。ELF、MAP、缓存和调试归档不作为
Release 资产。所有 Action 固定完整 commit SHA。build 仅有 `contents: read`，
只有标签 release job 获得 `contents: write`。

## 变更日志与说明

普通功能/文档改动不修改双语变更日志。发布准备检查上一版本之后的变化，只把用户可见行为、
兼容性和发布流程变化写入 `docs/CHANGELOG.md` 与 `.zh_CN.md`，保留新 `Unreleased`。

打标签前准备 `docs/releases/vX.Y.Z.md` 和 `.zh_CN.md`，解释变化、构建/校验、
安装、按键操作、数据影响和验收边界。工作流读取
`docs/releases/${{ github.ref_name }}.md`，说明须包含在标签提交中，按需链接中文版本。

## 发布验收与刷机

等待已有工作流，查看正式 Release，下载五个资产并校验 checksum、ZIP 和精确 bin 大小。
社区导出采用该 CI bin，即使本地重编译 SHA 不同。下载已有版本不需要重新构建。

使用官方网页刷机工具 `https://ai-passport.folotoy.cn/tools/web-flasher/`，
选择原始合并 bin，从 `0x0` 写入。完整系统安装可能替换存储数据，遵守
[安装说明](../../installation.zh_CN.md)。资产已发布或写入校验通过，不代表玩法真机验收通过。

关联：[社区发布](../release/publish-to-community.zh_CN.md)、
[完成流程](../release/project-completion.zh_CN.md)。
