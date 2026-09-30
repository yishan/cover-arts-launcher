<p align="right">
  <strong>简体中文</strong> · <a href="2026-09-23-cover-arts-skill-distribution.md">English</a>
</p>

# Cover Arts Launcher Skill 分发与 Agent 提示词实施规划

> **给 Codex：** 分发方案经审议确认后，使用 `executing-plans` 按任务逐项实施。

**目标：** 让创作者复制一段提示词，就能明确告诉 Agent：真实 Skill 在哪里、如何安装到当前项目，以及无法安装时如何直接读取；同时为可选的 skills.sh 公开收录做好准备。

**架构：** 继续以 `skills/ai-passport-cover-arts-launcher/` 为唯一源文件，由它生成 Vercel ZIP 和可浏览 Markdown。第一阶段直接使用现有 ZIP URL 安装；只有确实需要 skills.sh 仓库页面和 `owner/repo` 安装命令时，才建立独立公开 GitHub 仓库。

**技术栈：** 静态 HTML/CSS/JavaScript、Node.js 测试、`npx skills`、GitHub、skills.sh、Vercel。

---

## 1. 已确认事实与决策边界

- 当前完整安装包位于 `https://calm.yishan.app/skills/ai-passport-cover-arts-launcher.zip`。
- 英文主指引位于 `https://calm.yishan.app/skills/ai-passport-cover-arts-launcher/SKILL.md`。
- `skills` CLI 支持直接传入有效的 `SKILL.md` 或 ZIP URL，因此安装不依赖 skills.sh 收录。
- skills.sh 通过用户执行 `npx skills add <owner/repo>` 产生的匿名遥测发现公开 GitHub Skill；官方文档没有要求单独提交排行榜申请。
- `skills.sh.json` 只控制公开仓库页面的分组展示。单 Skill 仓库目前不需要它。
- 当前远端是公开的 `FoloToy/ai-passport`，但当前 GitHub 身份只有只读权限。若没有上游 PR 或维护者操作，当前分支不能直接把 Skill 发布到该仓库。

## 2. 待审议方案

| 方案 | 用户安装来源 | skills.sh 收录 | 依赖条件 | 建议 |
| --- | --- | --- | --- | --- |
| A. CALM 直接安装包 | Vercel ZIP URL | 不需要 | 现有部署 | 立即实施 |
| B. 独立公开仓库 | `<owner>/<repo>` | 遥测处理后自动出现 | 用户可写的公开 GitHub 仓库 | 推荐作为第二阶段 |
| C. FoloToy 上游仓库 | `FoloToy/ai-passport` 加指定 Skill | 合并并安装后自动出现 | 上游 PR 与维护者批准 | 不阻塞第一阶段 |

推荐顺序：先实施 A；如果“公开发现”是产品目标，再选择 B。B 上线后仍保留 ZIP 作为回退安装源。

## 3. 建议的复制提示词

复制内容应先给安装来源，再提出接入要求：

```text
请先安装并使用 AI Passport Cover Arts Launcher Skill：

npx skills add https://calm.yishan.app/skills/ai-passport-cover-arts-launcher.zip --skill ai-passport-cover-arts-launcher -y

如果当前环境无法运行 skills CLI，请直接读取主 Skill：
https://calm.yishan.app/skills/ai-passport-cover-arts-launcher/SKILL.md

然后使用 $ai-passport-cover-arts-launcher，仅在当前玩法已有的封面／开始页接入长按 Up 返回 Cover Arts Launcher。不要全局注册 Up Long，不要修改游戏、设置或其他状态；无法可靠识别封面状态时，不要擅自新增封面页。保留重启返回 Launcher 的兼容策略。安装 Skill 不代表授权烧录、commit、push 或发布。
```

中文页面可以使用中文描述，但 URL、命令、标识符和安全边界必须与英文内容一致。默认命令安装到当前项目；全局安装必须由用户另行明确选择。

## 4. 审议通过后的实施任务

### 任务 1：先用测试锁定直接安装契约

**文件：**

- 修改：`tools/install-slot/test-skill-site.mjs`

1. 新增失败断言，要求 `integrate-prompt` 包含完整 ZIP URL。
2. 新增失败断言，要求包含准确的 `npx skills add` 命令和 `--skill ai-passport-cover-arts-launcher` 选择。
3. 断言主 `SKILL.md` 回退 URL，以及现有“不授权烧录、commit、push、发布”边界。
4. 在 `tools/install-slot/` 运行 `npm test`；页面未改前，新增测试应当失败。

### 任务 2：更新 Agent 提示词，不改变协议

**文件：**

- 修改：`tools/install-slot/skills/index.html`
- 仅在布局确有需要时修改：`tools/install-slot/skills/skills.css`

1. 把安装命令与主 Skill URL 放到 `integrate-prompt` 开头。
2. 保留封面／开始状态门控、禁止全局 Up Long、重启兜底和授权边界。
3. 在提示词旁增加可见的“Skill 来源”链接，让用户复制前可以检查同一安装包。
4. 不修改审计提示词、下载包、协议文件、管理器首页或设备管理逻辑。
5. 运行 `npm test`，预期全部网页测试通过。

### 任务 3：使用真实 CLI 验证直接来源

**文件：** 无。

1. 运行 `npx skills add https://calm.yishan.app/skills/ai-passport-cover-arts-launcher.zip --list`，应当只发现 `ai-passport-cover-arts-launcher`。
2. 在一次性临时项目目录中，对一个受支持 Agent 执行建议的项目级安装命令。
3. 检查安装副本必须包含 `SKILL.md`、`references/protocol.md` 和 `assets/launcher_contract/launcher_contract.c`。
4. 检查后只删除本次创建的临时目录。
5. 仅能下载 URL、但没有安装出完整包，应判定为失败。

### 任务 4：浏览器与生产验收

**文件：** 无。

1. 使用真实浏览器检查桌面宽度和 390 px 宽度的 `/skills`。
2. 复制提示词，确认剪贴板内容包含 ZIP URL、安装命令、回退 URL 和安全边界。
3. 运行 `./tools/validate.sh --static`，再按仓库交付要求运行完整门禁。
4. 发布现有 `tools/install-slot` Vercel 项目。
5. 回读 `/`、`/?mode=play`、`/skills`、ZIP URL 和主 `SKILL.md`，全部应返回 HTTP 200。
6. 确认根管理页仍将玩法管理显示为任务 01、初始化设备显示为任务 02。

### 任务 5：可选发布到 skills.sh

**新公开仓库中的文件：**

- 新建：`SKILL.md`
- 新建：`SKILL.zh_CN.md`
- 新建：`README.md`
- 新建：`README.zh_CN.md`
- 复制：`agents/`、`assets/` 和 `references/`
- 只有确认授权协议与当前源仓库兼容后，才添加 LICENSE。

1. 审批 GitHub 所有者、仓库名、授权协议，以及是否需要保留独立历史。
2. 在具有写权限的账号下创建公开仓库。除非明确选择上游 PR，不使用 `FoloToy/ai-passport`。
3. 从 `skills/ai-passport-cover-arts-launcher/` 唯一源复制，不从 Vercel 生成目录反向复制。
4. 使用 `npx skills add <owner>/<repo> --list` 和一次性项目级安装验证仓库。
5. 执行一次未关闭遥测的安装。根据 skills.sh 文档，这是触发自动发现的方式；需要预留处理与页面缓存时间。
6. 观察到真实 skills.sh 仓库页和 Skill 页后，才能把它们写入 CALM 页面。
7. 验证完成后，主命令可换为 `npx skills add <owner>/<repo> --skill ai-passport-cover-arts-launcher -y`，同时保留 Vercel ZIP 回退。
8. 除非仓库以后容纳多个 Skill 并需要分组，否则不增加 `skills.sh.json`。

## 5. 验收标准

- 复制提示词必须自包含：Agent 无需猜路径，就能安装完整 Skill 或读取主指引。
- 默认使用项目级安装；不得静默执行全局安装。
- 安装 Skill 不代表获得烧录、commit、push、发布或创建 PR 的授权。
- 安装结果必须包含运行时组件和协议资料，不能只有 `SKILL.md`。
- Cover Arts Launcher 协议继续只在封面／开始页生效。
- 根管理页和现有下载链接保持不变且可访问。
- 只有实际观察到公开页面后，才展示 skills.sh 链接。

## 6. 实施前需要确认

1. 是否批准立即实施方案 A 的直接 URL 安装？
2. 方案 B 选择独立公开仓库，还是走 FoloToy 上游 PR？
3. 若选择独立仓库，GitHub owner 和仓库名是什么？
4. 复制命令是否按建议默认项目级安装，还是要求使用 `-g` 全局安装？
