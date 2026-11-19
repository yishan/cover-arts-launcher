<p align="right">
  <strong>简体中文</strong> · <a href="CI-linear-feedback-to-pr.md">English</a>
</p>

# CI：Linear 用户反馈自动转 Draft PR

[`.github/workflows/linear-feedback-to-pr.yml`](../../../.github/workflows/linear-feedback-to-pr.yml)
将 Linear `SAAN` 团队 `CoverArts Launcher` 项目中的用户反馈 issue 自动转化为面向
`yishan/cover-arts-launcher` 的已验证 **Draft PR**。

## 工作流程

1. **筛选（`select-issue`）**：每 30 分钟轮询一次 Linear（也支持通过
   `workflow_dispatch` 手动触发），查找 `SAAN` 团队 `CoverArts Launcher` 项目下
   带有准入标签 `auto-pr`、且尚未带有 `pr-opened` 标签或未存在同名
   `feedback/<issue-id>` 开放 PR 的 issue。
2. **求解（`solve-issue`）**：在只读仓库权限（`contents: read`，不注入
   `LINEAR_API_KEY`）下运行。通过
   [`tools/install_feedback_skills.py`](../../../tools/install_feedback_skills.py)
   将固定提交 SHA 的精选技能安装到 `~/.agents/skills/`，调用
   `openai/codex-action`（`permission-profile: ":workspace"`、`safety-strategy: drop-sudo`）
   运行 OpenAI Codex CLI，执行 `./tools/validate.sh --static` 验证，并上传补丁与结构化结果。
3. **发布（`publish-draft-pr`）**：在不注入 `OPENAI_API_KEY` 的独立任务中，将补丁
   应用到 `feedback/<issue-id>` 分支，二次运行 `./tools/validate.sh --static`，创建
   或更新 **Draft PR**，并向对应 Linear issue 幂等回写评论与 `pr-opened` 标签。若
   Codex 判定为 `needs_clarification`，则不创建空 PR，而是在 Linear 评论中提出澄清问题。

## 自动安装的精选技能

| 来源 | 安装技能 | 在流程中的职责 |
| --- | --- | --- |
| 本仓库（`skills/`） | `linear-feedback-to-pr`、`passport-develop`、`passport-setup`、`passport-build`、`passport-device-test`、`passport-debug`、`ai-passport-cover-arts-launcher` | ESP32-C3 / LVGL 安全约束、封面页返回边界与仓库门禁 |
| `backnotprop/pstack`（锁定 SHA） | `poteto-mode`、`tdd`、`blast-radius`、`interrogate`、`unslop`、`principle-fix-root-causes`、`principle-prove-it-works`、`principle-laziness-protocol`、`principle-boundary-discipline`、`principle-model-the-domain`、`principle-make-operations-idempotent`、`principle-test-behavior-not-implementation` | 根因排查、测试先行、影响面与对抗自审、最小改动与精炼 PR 描述 |
| `emilkowalski/skills`（锁定 SHA） | `emil-design-eng`、`ask-emil`、`break-ui`、`animate`、`review-animations`、`remove-animations` | Play Manager（`tools/install-slot/`）界面细节、交互反馈、克制动效与极端数据抗压 |

## 仓库配置步骤

### 1. 配置 GitHub Actions Secrets

在 **Settings -> Secrets and variables -> Actions -> Secrets** 中添加：

- `LINEAR_API_KEY`（必需）：具备 `SAAN` 团队 issue 与评论读写权限的 Linear API Key。
- `OPENAI_API_KEY`（必需）：供 `openai/codex-action` 通过本地 Responses API 代理调用的 OpenAI API Key。
- `PR_WORKFLOW_TOKEN`（可选）：具备 `contents: write` 与 `pull-requests: write` 权限的 Fine-grained PAT 或 GitHub App Token。配置后，自动创建的 Draft PR 会立即触发 `Static checks` 与 `Firmware checks`（使用默认 `GITHUB_TOKEN` 创建的 PR 不会自动触发 `pull_request` 工作流）。

### 2. 开启 GitHub Actions 创建 PR 权限

开启 **Settings -> Actions -> General -> Workflow permissions -> Allow GitHub Actions to create and approve pull requests**。

### 3. 可选 Repository Variables

如需覆盖默认值，可在 **Settings -> Secrets and variables -> Actions -> Variables**
中配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LINEAR_TEAM_KEY` | `SAAN` | Linear 团队键 |
| `LINEAR_PROJECT_NAME` | `CoverArts Launcher` | Linear 项目名称 |
| `LINEAR_AUTO_LABEL` | `auto-pr` | 自动拾取所需的准入标签 |
| `LINEAR_PROCESSED_LABEL` | `pr-opened` | 创建 Draft PR 后自动追加的去重标签 |
| `LINEAR_TARGET_STATE` | *（空）* | 可选的 Linear 目标状态名称（如 `In Review`） |
| `CODEX_MODEL` | *（action 默认）* | 可选的 OpenAI Codex 模型覆盖 |
| `CODEX_EFFORT` | *（action 默认）* | 可选的推理强度覆盖 |

## 手动触发（CI 或本地）

- **GitHub Actions**：在 **Actions -> Linear feedback to Draft PR -> Run workflow**
  中填写可选的 `issue_id`（如 `SAAN-42`），并可先勾选 `dry_run: true` 验证全流程。
- **本地 Agent 会话**：先执行 `python3 tools/install_feedback_skills.py`，然后使用
  [`$linear-feedback-to-pr`](../../../skills/linear-feedback-to-pr/SKILL.zh_CN.md)。

## 安全边界

- 自动生成的 PR 一律为 **Draft PR**，不会自动合并。
- 静态检查与固件构建不能替代 FoloToy AI Passport 实机验证或桌面 Chrome/Edge 的 Web Serial 实测。
- 工作流仅在 `yishan/cover-arts-launcher` 仓库运行，严禁向 `folotoy/ai-passport` 发布。
