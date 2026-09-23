<p align="right">
  <a href="firmware-layout.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Firmware Layout

This Launcher branch targets the ESP32-C3 with 8 MB Flash. Its partition
contract reserves one factory Launcher, three fixed application positions,
sidecar Cover Art storage, and standard ESP-IDF OTA selection data.

## Launcher layout

The partition table contains exactly:

| Partition | Type/subtype | Offset | Size | Purpose |
| --- | --- | ---: | ---: | --- |
| `nvs` | data/NVS | `0x9000` | `0x6000` | Launcher and application key-value namespaces |
| `phy_init` | data/PHY | `0xF000` | `0x1000` | PHY initialization data |
| `factory` | app/factory | `0x10000` | `0x170000` | Launcher, maximum 1,507,328 bytes |
| `ota_0` | app/OTA 0 | `0x180000` | `0x200000` | Application position 1 |
| `ota_1` | app/OTA 1 | `0x380000` | `0x200000` | Application position 2 |
| `ota_2` | app/OTA 2 | `0x580000` | `0x200000` | Application position 3 |
| `covers` | data/custom `0x40` | `0x780000` | `0x7E000` | A/B Cover Art records and manifests |
| `otadata` | data/OTA | `0x7FE000` | `0x2000` | Standard ESP-IDF boot selection |

The final partition ends exactly at `0x800000`. Every application position is
exactly 2 MiB; an application image larger than `0x200000` is rejected. Cover
data is stored only in `covers` and is never appended to an application image.

## Image types

- A **complete-system merged image** starts at `0x0` and contains the
  bootloader, partition table, and factory Launcher. It is for first-time
  migration or intentional complete refresh only.
- An **app-only image** starts with an ESP application image and is written to
  exactly one selected `ota_*` position after validation. It must never be
  flashed at `0x0`.
- A compatible merged application image may be accepted by the browser
  installer only after its partition table and embedded application are
  validated and the application image has been extracted. Normal position
  replacement does not rewrite the bootloader, partition table, NVS, PHY,
  Launcher, or unrelated positions.

The complete-system merged artifact may be sparse and therefore does not prove
that unwritten application or cover ranges are erased. A first-time installer
must explicitly erase and verify `ota_0`, `ota_1`, `ota_2`, all six cover banks,
and `otadata` before it reports an all-empty library.

## Enforced validation

Run:

```bash
./tools/validate.sh --firmware
```

The check builds in an isolated directory, creates the merged image, reads the
configured image offsets from `flash_args`, validates the partition-table MD5,
partition bounds, unique labels, and non-overlap, then ensures the factory
Launcher starts in and fits its configured partition. Host tests additionally
pin every Launcher label, subtype, offset, size, the three equal 2 MiB
positions, and the exact 8 MB end. CI runs the same gate.

Publish the complete-system artifact and child application artifacts as
different products with separate labels and hashes. The similarly named
`build/FoloToy-AI-Passport.bin` is the factory Launcher app-only image; it does
not contain the bootloader or partition table and is not a child play image.

## Flashing and stored data

> **No backup of the firmware already installed on the device is required
> before downloading (flashing) new firmware.** Do not make reading out the
> original firmware or saving a full-Flash dump a prerequisite for this
> workflow. The new firmware replaces the original firmware; this workflow
> does not retain an automatic rollback copy or promise that the original
> firmware can be restored.

Firmware and user data are different. If existing NVS settings, application
records, or files must be kept, export or otherwise save them before flashing
using a method supported by that application. Not requiring an original-firmware
backup does not guarantee data preservation or authorize a full-chip erase.

Changing from the former single-factory layout rewrites the partition table and
can make every previously stored address mean something different. Before a
device migration, read and archive the small existing partition-table sector,
review product-identity storage, and do not assume an unknown data region is
disposable. This diagnostic record is not a requirement to back up the full
firmware. The `meta-pass` project's `cardid` address is not part of this
contract.

The verified merged image is written from `0x0`. Because it pads gaps between
included images, flashing it can reset NVS or PHY regions but may leave stale
bytes beyond its final segment. Use the reviewed first-time installer for a
three-empty-position migration. During normal development, use segmented
`idf.py flash` when existing state should be preserved; this also requires a
compatible partition layout and flash targets that do not overwrite those data
regions. `idf.py erase-flash` erases all user data. Do not add it as a routine
prerequisite: use it only when a complete erase is explicitly intended and any
data that must be kept has been saved.
