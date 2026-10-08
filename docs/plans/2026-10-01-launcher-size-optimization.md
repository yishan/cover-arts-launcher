<p align="right">
  <a href="2026-10-01-launcher-size-optimization.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Launcher Size Optimization

## Scope and measurements

This is an unpublished code-only candidate based on v1.5.0, built with the
pinned ESP-IDF 5.5.3 and LVGL 9.5.0. It does not change partitions, installed
plays, the manager protocol, title coverage, or UI layout. It is not a replacement
v1.5.0 Release asset.

| Measurement | v1.5.0 local build | Optimized candidate |
| --- | ---: | ---: |
| Application binary | 920,816 bytes | 737,040 bytes |
| Title bitmap only | 229,532 bytes | 198,761 bytes |
| Factory allocation | 1,507,328 bytes | unchanged |
| Empty play arena | 6.4375 MiB | unchanged |
| Full merged image | 8,388,608 bytes | unchanged |

The application saves 183,776 bytes (179.47 KiB, 19.96%). The full image is
8 MiB, or 8.39 decimal MB, because it spans Flash addresses through the OTA
selection data at `0x7fe000`; it is not 8 MiB of Launcher code. Its erased
padding must not be counted as executable size. Remaining free play space also
depends on installed app allocations, alignment, and 64 KiB sidecars.

## Implemented changes

- Enable size-oriented compiler optimization.
- Disable unused LVGL widgets; retain base objects, images, labels, and their
  default-theme styling.
- Losslessly compress the 16 px, 2 bpp font with LVGL prefiltering. Keep all
  3,755 GB2312 level-one characters and existing punctuation/ASCII coverage.
- Align the native preview configuration with the firmware widget selection.
  Guard these choices with static tests.

## Validation

Firmware build and merged-image/layout checks passed. Repository checks and
host tests passed. The native LVGL preview passed, including repeated screen
transitions. Comparing all 4,008 supported glyphs against the uncompressed
v1.5.0 font found identical coverage, metrics, and decoded pixels.

Reproduce the lossless comparison with an uncompressed reference outside the
candidate tree; keep the reference separate rather than committing a duplicate
large font:

```bash
cmake -S tests/launcher_preview -B build/font-check \
  -DLVGL_DIR="$PWD/managed_components/lvgl__lvgl" \
  -DLAUNCHER_REFERENCE_FONT=/absolute/path/to/uncompressed-font.c
cmake --build build/font-check --parallel 6
build/font-check/launcher_font_equivalence
```

Device tests are NOT RUN. Font decompression adds short-lived per-line buffers
and decoding work; actual navigation speed, free heap, Chinese rendering, and
long-running stability must be checked on hardware. No flash, commit, or
publication has been performed for this candidate.

## Separate next step: reclaim factory slack

Code savings alone do not grow the arena. An optional compact layout could
reduce factory size from `0x170000` to `0x0f0000` and lower the play-arena start
from `0x180000` to `0x100000`. This would reclaim 512 KiB and raise the empty
arena to 6.9375 MiB. Factory headroom would be 983,040 minus the final release
app size; this candidate leaves 246,000 bytes (about 240 KiB).

This layout is NOT implemented. First decide migration policy and coordinate
the Launcher and manager changes. They must derive a safe arena boundary from
the actual factory partition, remain compatible with existing allocations, and
guard old firmware/manager combinations. Do not move installed apps or overwrite
their storage merely to change logical positions. Keep compact full-system
installation and preserving-data Launcher updates as separate workflows.

Do not simply truncate the full image's OTA initialization range: that can
leave an old boot-selection state. A smaller community download needs a
separately validated packaging/install contract, not just code compression.
