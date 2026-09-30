<p align="right">
  <strong>简体中文</strong> · <a href="protocol.md">English</a>
</p>

# 封面页返回协议

## 兼容级别

1. **通用兼容：** 有效的 ESP32-C3 应用无需 Launcher SDK 即可安装、启动；复位
   或重新上电后返回 Launcher。
2. **增强封面返回：** 玩法已有封面／开始页处于活动状态时，Up Long 可立即
   请求返回已经校验的 factory Launcher。

增强返回是可选能力，不能削弱通用兼容策略。

## 输入契约

- 触发：项目已有的 Up Long 语义事件；项目需要具体数值时，建议交互时长约
  1.5 秒。
- 范围：仅限已有封面／开始状态。
- 不适用范围：游戏、设置、暂停、结算、诊断及其他所有状态。
- 界面：不要求新增标签、弹窗或提示。
- 失败：记录可诊断错误并保持玩法运行。

## 启动契约

`launcher_contract_return_to_factory()` 查找标签为 `factory` 的分区，校验镜像，
将其设置为下次启动分区并重启。函数只在失败时返回。

不得硬编码 factory 地址，不得选择未校验镜像。当 Launcher 依赖一次性 OTA
回滚实现“重启返回 Launcher”时，不得把子应用标记为有效。

## 验收清单

- 封面页 + Up Long：显示 Launcher。
- 游戏中 + Up Long：保留玩法原有行为。
- 设置／其他状态 + Up Long：保留玩法原有行为。
- 玩法中复位：显示 Launcher。
- 玩法中重新上电：显示 Launcher。
- 受控测试中 factory 缺失／无效：不进入重启循环，日志记录错误。
