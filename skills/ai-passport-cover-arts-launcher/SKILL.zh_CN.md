---
name: ai-passport-cover-arts-launcher
description: 检查或接入 AI Passport 玩法的可选 Cover Arts Launcher 返回协议。适用于创作者希望仅在玩法已有封面页通过 Up Long 返回，同时保留游戏按键行为和重启返回 Launcher 兼容策略的场景。
---

<p align="right">
  <strong>简体中文</strong> · <a href="SKILL.md">English</a>
</p>

# AI Passport Cover Arts Launcher 兼容

本 Skill 用于检查、接入或验证玩法返回 Cover Arts Launcher 的可选路径。协议
有意保持窄边界：**只有玩法自己的封面／开始页处于活动状态时才处理 Up Long**。
游戏、设置及其他状态继续保留原有的 Up Long 行为。

修改前先阅读 [`references/protocol.zh_CN.md`](references/protocol.zh_CN.md)。
玩法自身的状态机、输入模型和仓库规则是事实来源。

## 确认请求模式

- **检查：** 检查玩法能否采用协议并报告结果，不修改文件。
- **接入：** 添加返回组件和最小的封面状态输入钩子，然后测试。
- **验证：** 检查已有接入，运行可用的主机／构建检查，并给出真机清单。

不得把本 Skill 视为烧录、commit、push、发布或创建 PR 的授权；按当前仓库
流程另行取得对应许可。

## 修改前检查

1. 阅读仓库 Agent 指引以及开发、构建说明。
2. 先运行 `git status --short --branch`，保护无关修改。
3. 找到 Up Long 的语义输入事件，优先复用已有消抖后的长按事件，不重新实现
   GPIO 计时。
4. 找到玩法已有的封面／开始状态，以及能够可靠获知该状态的统一输入分发点。
5. 检查分区假设。辅助组件在运行时查找并校验 `factory` 分区，不得硬编码地址。

无法可靠识别封面状态时，停止并说明阻碍。不得增加全局监听，也不得为满足
协议擅自新增封面页。

## 接入可选返回路径

1. 把 `assets/launcher_contract/` 复制到玩法的 `components/` 目录，或将其中唯一
   的返回函数合并到等价的现有组件。
2. 在应用组件依赖中加入 `launcher_contract`。
3. 在既有输入分发点中，仅当当前状态为已有封面／开始页时拦截 Up Long：

```c
if (app_state == APP_STATE_COVER &&
    input.btn == BSP_BTN_UP &&
    input.event == BSP_BTN_LONG) {
    esp_err_t err = launcher_contract_return_to_factory();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "return to Launcher failed: %s", esp_err_to_name(err));
    }
    continue;
}

game_handle_input(input);
```

按项目调整名称，但必须保留状态门控语义。应从输入／应用任务调用辅助函数，
不得直接在 GPIO、定时器或 LVGL 回调中调用。玩法如需保存状态，应先完成有
明确时限的保存，再调用辅助函数。

当安装方式依赖 Launcher 的一次性 OTA 行为时，不得调用
`esp_ota_mark_app_valid_cancel_rollback()`。复位或重新上电必须继续作为通用
兜底，让未适配和已适配玩法都能返回 Launcher。

## 验证边界

先运行仓库最小相关主机测试，再运行其规定的构建门禁。检查最终 diff，并确认：

- 在已有封面／开始页长按上键能够返回 Launcher。
- 游戏、设置、暂停、结算及其他状态中的 Up Long 完全不受影响。
- `factory` 分区缺失、无效或已经在运行时，函数返回错误并保持玩法运行。
- 没有硬编码 factory 地址或产品专用分区偏移。
- 复位或重新上电仍会返回 Launcher。
- 除非创作者明确要求，否则不新增任何界面文字。

分别报告 Build、Host tests、Device tests 和 Unverified。构建成功不等于真机
验收通过。

## 面向创作者的文案

README 或社区列表可使用：

> 支持 Cover Arts Launcher 返回。在玩法封面长按上键约 1.5 秒，即可返回玩法库。

不得宣称 Up Long 在整个玩法中被保留或占用。

## 资源

- 协议与验收细则：[`references/protocol.zh_CN.md`](references/protocol.zh_CN.md)
- 可复用 ESP-IDF 组件：[`assets/launcher_contract/`](assets/launcher_contract/)
- 公开指南：`https://cover-arts-launcher.yishan.app/skills/`
