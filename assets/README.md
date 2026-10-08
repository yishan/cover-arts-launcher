<p align="right">
  <a href="README.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Assets

This directory stores reusable fonts, images, music, and sound effects, organized by asset type.

Keep each asset in the matching subdirectory and document its destination, naming, integration method, and source/license. Do not mix binary assets with Markdown documentation.

## Fonts

Store reusable font files and generated font sources in `fonts/`.

- Use descriptive names that include the family, weight, size, and format when relevant.
- Document the source, license, character range, conversion command, and expected destination.
- Check Flash and internal-RAM impact before adding a font; the ESP32-C3 has no PSRAM.
- Do not commit fonts whose license does not permit redistribution.

### Launcher Title Font

`fonts/launcher_source_han_sans_sc_16_gb2312.c` is the Launcher's Flash-resident
16 px, 2 bpp title font. It includes printable ASCII, CJK punctuation,
full-width forms, and all 3,755 GB2312 level-one common Simplified Chinese
characters. Unsupported rare characters use LVGL's placeholder glyph.

The bitmap uses lossless LVGL compression with prefiltering; keep
`CONFIG_LV_USE_FONT_COMPRESSED=y` and the corresponding host-preview setting.
Character coverage, 2 bpp quantization, and layout metrics are unchanged.

The source face is the Source Han Sans SC font pinned with LVGL 9.5.0 under
`managed_components/lvgl__lvgl/scripts/built_in_font/`, licensed under SIL Open
Font License 1.1. Regenerate the C source with `lv_font_conv` 1.5.3:

```bash
python3 tools/generate_launcher_title_font.py --converter /path/to/lv_font_conv
```

## Images

Store reusable source images and generated display assets in `images/`.

- Use descriptive names and document dimensions, pixel format, conversion steps, and destination.
- Prefer formats suitable for the 240 × 320 RGB565 display and account for Flash and internal RAM.
- Preserve editable sources where licensing permits, and record the source and license.
- Never commit device QR secrets, credentials, or personal data in images.

### Launcher Cover Art

`images/launcher/placeholder-cover.svg` is the editable visual reference for
the Launcher's built-in placeholder. It is original project artwork and may be
used under the repository license. Firmware draws its equivalent directly into
a bounded RGB565 buffer, so the SVG is not decoded or embedded on the device.

Installed play covers are exactly 120 × 160 RGB565, converted by Play Manager
in the browser and stored in the raw `covers` partition. The Launcher keeps one
38,400-byte center image plus two 36-pixel edge strips in internal RAM; it does
not retain three full covers or decode PNG/JPEG on the ESP32-C3.

## Music and sound effects

Store reusable music and sound-effect sources in `music/`.

- Document the source, license, sample rate, bit depth, channels, conversion command, and destination.
- Prefer 16 kHz, 16-bit mono PCM when it matches the current BSP audio path.
- Check Flash and internal-RAM cost before embedding audio; stream or chunk long recordings.
- Do not commit media without redistribution permission.
