<p align="right">
  <strong>简体中文</strong> · <a href="CHANGELOG.md">English</a>
</p>

# 变更记录

## v1.0.0 — 2026-09-24

- 发布 factory Cover Art Launcher，为 ESP32-C3、8 MiB Flash 的 AI Passport 提供三个固定
  2 MiB 玩法位置。
- 加入以封面为主的设备端浏览、空位置支持、中文玩法标题、两侧相邻卡片预览，以及经过校验的
  单次玩法启动。
- 通用玩法可通过重启或重新上电返回 Launcher；同时提供仅作用于玩法已有封面页的可选
  `Up Long` 返回协议。
- 加入浏览器玩法管理器，支持完整系统迁移、官方 Play URL 导入、本地固件导入、封面预览与转换、
  标题字形检查、校验写入、替换、擦除、复位和故障恢复。
- 加入 App/封面 SHA 绑定、双 bank 元数据与信任记录、失败后的限定范围清理，以及重新连接后的
  设备清单校验。
- 按 MIT License 发布安装、用户、创作者 Skill、来源、构建和 Release 文档。
