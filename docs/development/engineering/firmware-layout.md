<p align="right">
  <a href="firmware-layout.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Firmware Layout

This Launcher targets the ESP32-C3 with 8 MB Flash. The complete-system image
starts with an empty dynamic library. The browser Play Manager adds OTA entries
to the partition table according to each verified application's actual size.

## Empty Launcher layout

| Partition | Type/subtype | Offset | Size | Purpose |
| --- | --- | ---: | ---: | --- |
| `nvs` | data/NVS | `0x9000` | `0x6000` | Launcher and application key-value namespaces |
| `phy_init` | data/PHY | `0xF000` | `0x1000` | PHY initialization data |
| `factory` | app/factory | `0x10000` | `0x0F0000` | Launcher, maximum 983,040 bytes |
| `otadata` | data/OTA | `0x7FE000` | `0x2000` | Standard ESP-IDF boot selection |

The v1.6.0 compact layout uses `0x100000..0x7F0000` (6.9375 MiB).
Published v1.5.0 devices retain Factory size `0x170000` and their arena
`0x180000..0x7F0000` (6.4375 MiB); both layouts are recognized at runtime.
Only explicit compact initialization releases the extra 512 KiB, removing
installed plays/covers. Normal play operations and Factory-only updates never
resize Factory. See [compact migration](../../plans/2026-10-08-compact-launcher-layout.md).
Each installed play becomes a
contiguously numbered `ota_0..ota_15` entry, but its physical offset does not
have to match its logical order after deletion. Its allocation is the verified
application length rounded up to 64 KiB, plus one 64 KiB DPS1 sidecar at the
partition tail. The sidecar stores double-bank identity metadata and the cover
payload. Allocations must not overlap or extend beyond the arena.

Removing a play rewrites later logical identities without copying retained
application bytes. A later installation uses the smallest released range that
fits before consuming tail space. Fragmented free bytes are not physically
compacted in v1.5.0.

## Image types

- A **complete-system merged image** starts at `0x0` and contains the
  bootloader, empty dynamic partition table, and factory Launcher. It is for
  first-time migration or an intentional complete refresh.
- An **app-only image** starts with an ESP application image and is written to
  a newly allocated dynamic `ota_*` entry after validation. It must never be
  flashed at `0x0`.
- A compatible merged play image may be accepted only after its partition table
  and embedded application are validated and the application image is
  extracted. Normal play installation does not rewrite the bootloader, NVS,
  PHY, factory Launcher, or unrelated play allocations.

The complete-system image can be sparse and does not prove that the dynamic
play arena is empty. A first-time installation must explicitly erase and verify
the incoming layout's arena and `otadata` before reporting an empty library.
Validate an empty incoming directory, Factory checksum/SHA, length, and partition
fit before any erase. Do not use the old arena start for compact initialization.

## Enforced validation

Run `./tools/validate.sh --firmware`. The gate builds in an isolated directory,
creates the merged image, validates the offsets from `flash_args`, checks the
partition-table MD5, partition bounds, non-overlap, and factory application
fit. Host tests additionally cover the empty dynamic table, 64 KiB allocation
rules, the 16-entry limit, logical reordering, smallest-fitting-hole reuse, and
the 8 MB boundary. CI runs the same gate.

Publish the complete-system artifact and child play images as different
products. `build/FoloToy-AI-Passport.bin` is the factory Launcher app-only image;
it is not a complete-system image or a child play image.

## Flashing and stored data

No backup of the firmware already installed on the device is required before
flashing new firmware. This does not preserve user data or authorize a
full-chip erase. Export settings, records, or other data that must be kept.

Changing from an older fixed or single-factory layout rewrites the partition
table and changes the meaning of Flash addresses. The verified merged image is
written from `0x0`; because it pads gaps between included images, it can reset
NVS or PHY data while leaving bytes in the dynamic arena untouched. Use the
reviewed complete-installation flow for migration so it erases and verifies the
arena and `otadata`.

During normal development, segmented `idf.py flash` may preserve compatible NVS
state, but only when the current partition layout and targets are understood.
`idf.py erase-flash` erases all user data and is not a routine prerequisite.
