<p align="right">
  <strong>简体中文</strong> · <a href="THIRD_PARTY_NOTICES.md">English</a>
</p>

# 第三方声明

Cover Arts Launcher 按仓库根目录的 [MIT License](../LICENSE) 发布。以下内容记录
v1.6.0 源码分发中包含的重要来源和运行时依赖，仅用于致谢和许可证追踪，不表示相关项目为本项目背书。

## FoloToy AI Passport

- 项目：<https://github.com/FoloToy/ai-passport>
- 许可证：MIT
- 使用范围：BSP、硬件接口、ESP-IDF 项目基线、工程检查和文档规范。
- 声明：原始版权声明保留在仓库 [LICENSE](../LICENSE) 中。

## meta-pass

- 项目：<https://github.com/alexwwang/meta-pass>
- 审查版本：`994caaf52357d97323bffb82b2db9cc784afb1eb`
- 许可证：MIT
- 使用范围：ESP 镜像提取解析器经过实质性适配；浏览器安装链路作为 AI Passport 布局实现的参考。
- 保留的许可证：[`tools/install-slot/LICENSE.meta-pass.txt`](../tools/install-slot/LICENSE.meta-pass.txt)
- 详细边界：[`docs/reference/meta-pass-borrowing.zh_CN.md`](reference/meta-pass-borrowing.zh_CN.md)

Cover Arts Launcher 使用独立的分区布局、元数据格式、Cover Art 界面、验证规则、故障恢复和真机验收，
并非 meta-pass 的官方发布版本。

## esptool-js

- 项目：<https://github.com/espressif/esptool-js>
- 当前启用的浏览器运行时：0.6.1
- 许可证：Apache License 2.0
- 使用范围：通过本地 Web Serial 与 ESP32-C3 通信。
- 保留的许可证：[`tools/install-slot/vendor/LICENSE.esptool-js.txt`](../tools/install-slot/vendor/LICENSE.esptool-js.txt)

浏览器运行时在用户本地执行。封面转换也在本地完成，不会把用户选择的图片上传到第三方。

固定版本的 esptool-js bundle 包含其公开运行时依赖：`pako`（MIT 与 Zlib）、
`atob-lite`（MIT）和 `tslib`（0BSD）。版本号与包完整性记录在
[`tools/install-slot/package-lock.json`](../tools/install-slot/package-lock.json) 中；生成的 bundle
保留了 pako 的许可证标记。
