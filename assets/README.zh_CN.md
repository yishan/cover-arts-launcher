<p align="right">
  <strong>简体中文</strong> · <a href="README.md">English</a>
</p>

# 资源目录（Assets）

本目录集中存放可复用的资源（字库、图片、音乐等），按资源类型分子目录管理。每个资源放在其类型对应的子目录，并记录放置路径、命名方式、集成方式与来源/许可。二进制资源（字体、图片、音频）不属于纯 markdown 文档，请勿与文档混放。涉及版权/授权的资源需注明来源与许可。

## 字库（fonts）

可复用的字库文件与生成的字库源码放在 `fonts/`。

- 命名要能反映字族、字重、字级与格式。
- 记录来源、许可、字符范围、转换命令与目标放置路径。
- 添加字库前评估 Flash 与内部 RAM 影响；ESP32-C3 无 PSRAM。
- 不提交许可不允许分发的字库。

### Launcher 标题字库

`fonts/launcher_source_han_sans_sc_16_gb2312.c` 是 Launcher 常驻 Flash 的
16 px、2 bpp 标题字库。它包含可打印 ASCII、CJK 标点、全角字符，以及 GB2312
一级字表的 3755 个常用简体汉字。不在字表中的生僻字由 LVGL 显示占位符。

源字型为 LVGL 9.5.0 固定版本中自带的 Source Han Sans SC，位于
`managed_components/lvgl__lvgl/scripts/built_in_font/`，采用 SIL Open Font
License 1.1。使用 `lv_font_conv` 1.5.3 重新生成 C 源码：

```bash
python3 tools/generate_launcher_title_font.py --converter /path/to/lv_font_conv
```

## 图片（images）

可复用的源图与生成的显示资产放在 `images/`。

- 使用描述性命名，并记录尺寸、像素格式、转换步骤与目标路径。
- 优先采用适合 240 × 320 RGB565 显示的格式，并纳入 Flash 与内部 RAM 考量。
- 许可允许时保留可编辑源文件，并记录来源与许可。
- 图片中不得包含设备二维码秘密、凭证或个人数据。

### Launcher 封面

`images/launcher/placeholder-cover.svg` 是 Launcher 内置占位封面的可编辑视觉参考，
属于本项目原创素材，可按仓库许可证使用。固件会在有界 RGB565 缓冲区中直接绘制
等效图形，因此设备端不会解码或嵌入该 SVG。

安装的玩法封面由 Play Manager 在浏览器中转换为精确的 120 × 160 RGB565，并写入
原始 `covers` 分区。Launcher 在内部 RAM 中只保留一张 38,400 字节的中央封面和两条
36 像素宽的侧边切片；不会同时保存三张完整封面，也不会在 ESP32-C3 上解码 PNG/JPEG。

## 音乐与音效（music）

可复用的音乐与音效源码放在 `music/`。

- 记录来源、许可、采样率、位深、声道、转换命令与目标路径。
- 与当前 BSP 音频路径匹配时优先采用 16 kHz、16 位单声道 PCM。
- 嵌入音频前评估 Flash 与内部 RAM 成本；长录音应流式或分块。
- 无再分发许可不提交媒体文件。
