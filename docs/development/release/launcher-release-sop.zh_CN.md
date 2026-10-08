<p align="right">
  <strong>简体中文</strong> · <a href="launcher-release-sop.md">English</a>
</p>

# Cover Arts Launcher 发布 SOP

维护日期：2026-10-01。后续发布只使用 `yishan/cover-arts-launcher`。
`folotoy/ai-passport` 是上游参考来源，不是 Launcher 的提交、标签、Release 或固件上传目标。
本 SOP 优先于继承自上游的多应用发布约定。

## 固定入口

| 对象 | 约定 |
| --- | --- |
| GitHub | `https://github.com/yishan/cover-arts-launcher` |
| 发布分支 | `main` |
| 版本与标签 | `firmware_version.txt` 为 `X.Y.Z`；标签为 `vX.Y.Z` |
| Release 标题 | `Cover Arts Launcher vX.Y.Z` |
| 说明 | `docs/releases/vX.Y.Z.md` 和 `.zh_CN.md`，打标签前准备好 |
| 完整固件 | `FoloToy-AI-Passport-Cover-Arts-Launcher-vX.Y.Z-full.bin`，8 MiB、从 `0x0` 写入 |
| 自动发布 | `.github/workflows/build-firmware.yml`，推标签后自动构建、上传、创建 Release |

本机持久发布目录为 `/Users/yishan/project/cover-arts-launcher`，是独立 Git checkout，
与上游基线和开发 worktree 分离。后续优先复用，不为每次发布重新 clone 临时目录。
目录不存在时，只从上述 GitHub 仓库 clone 一次；不要改写共享基线的 `origin`。
开发仍在当前产品 worktree 进行；发布仓库中的既有提交与资产必须保留。

## 执行顺序

1. **预检一次。** 在发布 checkout 查看 `git status --short --branch`，运行
   `python3 tools/release_preflight.py`。脚本只读，检查 `origin` 的全部 fetch/push 地址、
   版本、中英文说明并输出 HEAD；误指上游立即停止。需要验证账号时，只执行一次
   `gh auth status`。所有 GitHub 命令显式使用 `--repo yishan/cover-arts-launcher`。
2. **同步并比较。** 执行 `git fetch origin main --tags`，查看 ahead/behind 与当前差异。
   已有同名标签时，查看其 Actions/Release 并接续，不覆盖、不重新打标签。
   产品 worktree 有新改动时，按文件清单导入差异；不将上游整棵树覆盖到发布仓库，
   不丢弃发布仓库独有改动，不导入 build、缓存、凭据或其它玩法。
3. **准备版本。** 对齐版本文件、README、安装说明、中英文发布说明及本次变更日志。
   历史版本说明保持原样。说明包含变化、升级数据影响和未验证事项。
4. **按改动验证一次。** 固件发布运行一次 `./tools/validate.sh`，包含静态与固件检查；
   或分别运行一次 `--static` 与一次 `--firmware`，两者通过等同完整检查，
   不再为相同内容重复运行完整检查。核验内容寻址归档
   `python3 tools/archive_firmware.py verify build/firmware/<sha256>`。
   仅修改文档、SOP、预检或 CI 时运行 `--static`，无需编译或刷机。
5. **提交并推送 main。** 检查 `git diff --check` 和暂存差异，按当前用户授权提交，
   执行 `git push origin main`。本流程仍需当前发布任务有 Git/发布授权；已授权后
   不反复请求同一确认。然后运行 `python3 tools/release_preflight.py --phase ready`，
   确认 clean main、HEAD 等于已同步的 `origin/main`，且标签尚不存在。
6. **推标签一次。** 创建 annotated tag `vX.Y.Z`，执行 `git push origin vX.Y.Z`。
   用 `gh run list --repo yishan/cover-arts-launcher --workflow build-firmware.yml`
   找到该标签对应 run，再使用 `gh run watch <run-id> --repo yishan/cover-arts-launcher --exit-status`
   等待一次。正常编译中持续等待，不重复触发 dispatch、推标签或手工创建 Release。
7. **验收发布资产。** run 成功后执行
   `gh release view vX.Y.Z --repo yishan/cover-arts-launcher`，检查非草稿、非预发布、
   标题、说明、标签对应提交，以及 bin、ZIP、SHA256SUMS 和双语第三方声明共五个资产。
   下载到一个新目录，执行 `shasum -a 256 -c SHA256SUMS.txt` 和 `unzip -t <zip>`，
   确认 bin 为 8,388,608 字节。
8. **统一社区文件。** 社区导出的 bin、ZIP、校验和使用下载并校验通过的 Release 资产，
   保持逐字节一致。本机交付目录为
   `/Users/yishan/project/ai-passport/build/releases/vX.Y.Z/`。
   导出供社区使用不等于已提交社区；只有用户请求上架时才进行社区上传。
9. **交付。** 给出 Release URL、本地 bin 路径、最终 SHA-256、提交与标签，
   分别说明 Build、Host tests、Device tests、Unverified。真机测试注明测试对象和证据，
   不将 CI 通过当成真机验证。

## 停止重复尝试的规则

| 情况 | 处理 |
| --- | --- |
| origin 指向上游 | 切到独立发布 checkout；不尝试往上游推送，不改共享 origin |
| 静态与固件已分别通过 | 继续发布；相同输入不再额外跑完整 gate |
| 之后只改文档 | 只复查文档/静态；不重编固件 |
| 本地与 CI 镜像 SHA 不同 | 可由构建元数据、路径或工具差异产生；不直接宣称相同，也不仅为追求同 SHA 盲目重编。以 CI 自身布局校验和下载校验和为发布证据，社区采用 CI 资产 |
| 沙盒权限或网络失败 | 判断环境原因；按平台权限机制为原操作升级一次，不改工具链、不弱化校验 |
| Actions 正常运行 | 等待当前 run，不重复触发 |
| Actions 失败 | 读取该 run 的失败日志，修复明确原因；同一提交的暂时环境问题可重跑失败 job，源码需修复则按新提交处理，已发布版本不强行改标签 |
| 已发布、只需导出 | 下载并校验已有资产，不重新编译、打标签或发布 |
| `.bin` 与 ZIP 不同大小 | 社区固件用原始 bin；ZIP 仅供下载，不改名冒充 bin |

## v1.5.0 实际经验

2026-10-01 发布目标为 `yishan/cover-arts-launcher`，提交为 `03a3049`，
云端 run 为 `36743219529`。本地完整 bin 的 SHA-256 为
`6fd15048acafec1c92f37fa60385d805c9f7937487c485f89ba68a1ae9ea8581`，
云端正式资产为 `83eeff7b594a270b8ef99a245f7b107306aa3e56d0e6414fc0ebeba443683c9d`。
两者不是同一二进制；最终社区导出已采用云端资产并通过其校验和。
这次没有向上游推送。需要改进的是发布入口、继承的多应用标签说明、重复确认和
不必要检查，不应为了调整流程重发 v1.5.0。

关联：[CI 说明](../ci/CI-build-and-release.zh_CN.md)、
[社区发布](publish-to-community.zh_CN.md)。
