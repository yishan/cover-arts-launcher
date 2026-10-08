<p align="right">
  <a href="2026-10-08-compact-launcher-layout.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Compact Launcher Layout

Status: implementation included in v1.6.0 release preparation. The candidate
identity and checks below are historical development evidence, not the CI Release
artifact. See the [v1.6.0 release notes](../releases/v1.6.0.md) for current scope
and validation boundaries.

## Capacity and compatibility

| Item | Published v1.5.0 layout | Compact layout |
| --- | ---: | ---: |
| Factory offset | `0x10000` | unchanged |
| Factory allocation | `0x170000` (1,472 KiB) | `0x0f0000` (960 KiB) |
| Play arena | `0x180000..0x7f0000` | `0x100000..0x7f0000` |
| Empty arena capacity | 6.4375 MiB | 6.9375 MiB |
| Standard OTA selection | `0x7fe000..0x800000` | unchanged |

The compact layout releases exactly 512 KiB. The maximum single app image is
`0x6e0000` bytes because each play still needs an aligned 64 KiB sidecar.
Actual free space depends on installed allocations and fragmentation. NVS,
PHY, Factory start, bootloader, and partition-table addresses do not move.
The full merged image remains 8 MiB: smaller executable code does not remove
the erased padding needed to initialize the OTA selection area.

## Implementation

- New complete-system builds use the compact Factory allocation. The existing
  size-optimized code and losslessly compressed Chinese font remain enabled.
- Launcher derives the reviewed arena start from the active Factory partition.
  It accepts both reviewed Factory sizes and rejects unsafe play boundaries.
- The manager identifies the layout from the actual MD5-validated device table,
  not from version text or an assumed arena start. Allocation, deletion, hole
  reuse, inventory, and directory commits retain that layout explicitly.
- Ordinary installation or removal never rewrites Factory into another size.
  No automatic physical relocation or compaction is introduced.
- Complete-system installation validates an empty incoming directory, Factory
  length, ESP checksum/SHA, and its partition fit before erasing. Its erase
  ranges follow the incoming layout, including the recovered prefix.

## Upgrade choices

1. **Keep the current layout:** continue using the published version. A reviewed
   Factory-only firmware update can retain the existing partition table, NVS,
   plays, covers, and statistics, but does not release the extra 512 KiB. This
   change does not add a Factory-only update button to the manager.
2. **Adopt the compact layout:** use the new complete-system initialization
   workflow after confirming its destructive warning. Installed plays and
   covers are removed and must be reinstalled. Save any application data that
   matters using that application's supported export method. Export/restore
   of every third-party play's private data is not guaranteed.

The segmented browser initialization preserves NVS/PHY, but this does not
preserve the deleted applications or guarantee their save-data compatibility.
Writing the full merged image at `0x0` can reset NVS/PHY. A separately authorized
full-chip erase deletes all stored data. These are different operations.
Original-firmware backup is not a prerequisite. Preserving data must never be
inferred from successful flashing.

Deploy the updated manager before offering compact firmware to ordinary users.
The older fixed-boundary manager cannot recognize a compact table and must not
be used to initialize or manage it. The new manager supports both dynamic
layouts; it does not silently migrate existing devices. Downgrading by a full
old system image is also destructive.

## Validation and device handoff

Host checks cover exact capacity gain, both allocator boundaries, full arenas,
16-play limits, arbitrary deletion, logical reordering, hole reuse, empty
inventories, unknown layouts, oversized Factory images, corrupt images/tables,
and incoming erase ranges. The existing complete gate validates the actual
Factory fit and the merged image and retains matching debug artifacts.

Device acceptance must separately check initialization, Chinese screens and
buttons, first installation at `0x100000`, multiple plays, arbitrary deletion
and reuse in the recovered prefix, launch/return, restart, saved metadata, and
long-run font decoding. Power interruption during the primary partition-table
commit can require ROM recovery; this layout does not eliminate that risk.
No device write or publication is authorized by this document.

## Verified candidate identity

- Build: PASS, complete gate with ESP-IDF 5.5.3.
- Host tests: PASS, including 157 browser-module tests in the local publication
  checkout and preflight of the actual candidate full image.
- Device tests: NOT RUN for this compact candidate.
- Factory app: 737,216 bytes; unused Factory allocation: 245,824 bytes.
- Full image: `FoloToy-AI-Passport-Cover-Arts-Launcher-v1.6.0-full.bin`,
  8,388,608 bytes.
- Full SHA-256: `8a0799fc1dec225d22a1a18ecfab44e12946c122650329aaee76fd093a741422`.
- Matching ELF SHA-256: `ca54fa056409005ed87e0777397beb2e7a3ba6db667931115cc572607dad22dd`.

The source worktree retains the matching bundle under
`build/firmware/<full-sha256>/`. This is a local development candidate, not a
GitHub Release asset. No device flash, commit, push, or deployment was performed.
