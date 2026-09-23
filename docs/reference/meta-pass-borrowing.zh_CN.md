<p align="right">
  <strong>简体中文</strong> · <a href="meta-pass-borrowing.md">English</a>
</p>

# meta-pass 借鉴边界

本文规定多固件 Launcher 可以从社区项目 `meta-pass` 借鉴什么，以及哪些内容仍属于 AI Passport 自身设计。它是归属与评审台账，不是随上游自动变化的源码依赖。

## 固定上游基线

- 仓库：<https://github.com/alexwwang/meta-pass>
- 固定提交：`994caaf52357d97323bffb82b2db9cc784afb1eb`
- 许可证：MIT；保留的上游原文位于
  [`tools/install-slot/LICENSE.meta-pass.txt`](../../tools/install-slot/LICENSE.meta-pass.txt)。

评审和移植必须以固定提交为准。后续上游版本只有在重新审核源码、行为、测试与许可证，并更新本文后，才能纳入本项目。

## 借鉴台账

| 本地范围 | 固定上游参考 | 处理方式 |
| --- | --- | --- |
| `tools/install-slot/extract-app-image.js` | `tools/install-slot/extract-app-image.js` | 已实质性改编并保留 MIT 声明；本地实现新增分区表 MD5 校验，并使用完整 2 MiB app 位置，不沿用槽尾元数据。 |
| 浏览器 Web Serial 安装流程与 `vendor/` 运行文件 | `tools/install-slot/` | esptool-js 浏览器运行文件复制自固定来源。本地状态机、精确写入范围、读回校验、封面 A/B 行为和恢复规则均按 AI Passport 布局独立测试。 |
| 试运行启动与回退策略 | `main/meta_slots.c`、`main/metapass_hook.h` | 基于 ESP-IDF 5.5.3 API 和本地 factory/OTA 契约重新实现，不复制上游布局常量。 |
| merged image 校验 | `main/meta_image.c` 和安装器 parser/tests | 先建立本地 MD5 错误、截断、错误芯片、尺寸和缺失镜像测试，再复用已验证的解析顺序。 |

复制的运行文件和实质性改编的解析器继续遵循已保留的 MIT 许可。它们是固定来源材料，不是随上游移动的包依赖。

## 明确不继承

- 上游分区表，包括项目专用 `cardid` 分区和地址。
- 4 KiB/8 KiB 槽尾约定和 32 字节 ASCII 显示名 blob。
- 文字列表界面及其视觉样式。
- 上游构建、模拟器或 host test 结果作为 AI Passport 真机行为证明。
- MVP 中不引入 SoftAP 安装；首个安装路径为 Web Serial。

本项目改用经过审核的 8 MB 布局、三个固定 2 MiB 应用位置、独立 A/B `covers` 分区、与 app SHA 绑定的封面元数据，以及 Cover Art 选择器。所有设备行为仍须通过 AI Passport 构建和真机验收门禁。
