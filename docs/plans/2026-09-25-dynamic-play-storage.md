<p align="right">
  <a href="2026-09-25-dynamic-play-storage.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Dynamic Play Storage v0.3 Design

Status: Launcher runtime implemented and device-tested; browser integration maintained separately

Target release: v1.3.1

Compatibility: breaking Flash-layout migration from the fixed three-position v0.2 layout

## Outcome

Play Manager allocates each installed play from its verified ESP application
length instead of reserving 2 MiB for every position. Plays are appended until
the remaining contiguous arena cannot hold the next application and its
sidecar. User-facing positions remain a stable ordered library; physical
offsets and sizes are implementation details.

This design retains the stock ESP-IDF bootloader, `otadata`, and OTA partition
subtypes. It does not require third-party play changes or introduce a custom
bootloader.

## Flash contract

The system prefix remains fixed through the factory Launcher. Dynamic play
partitions occupy the aligned range `0x180000..0x7f0000`; standard `otadata`
remains at `0x7fe000..0x800000`. The small gap before `otadata` is intentionally
not allocated to an app because application partition starts and extents use
64 KiB allocation units.

Each play partition contains:

```text
partition start
  verified ESP application image
  erased alignment padding
  64 KiB position sidecar
    cover payload
    double-bank manifest/trust/install record
partition end
```

The 64 KiB sidecar uses this v0.3 layout:

| Relative range | Content |
| --- | --- |
| `0x0000..0x95ff` | One 120×160 RGB565 cover payload |
| `0x9600..0x9fff` | Erased padding |
| `0xa000..0xafff` | Metadata bank A |
| `0xb000..0xbfff` | Metadata bank B |
| `0xc000..0xffff` | Reserved, erased |

Each metadata record binds the position, exact image length and SHA-256 while
also carrying title, source identity, version, install history, and cover CRC.
Metadata A/B selection is generation-based. A corrupt or interrupted cover
payload falls back to the placeholder but does not invalidate the independently
CRC-protected resident-app record.

Allocation is:

```text
align_up(verified_image_length, 64 KiB) + 64 KiB sidecar
```

The resulting partition is a normal `app/ota_N` entry. The sidecar is outside
the verified ESP image length but inside the partition boundary. Launcher and
Play Manager own it; a play must not write its running application partition.

ESP-IDF defines `ota_0` through `ota_15`, so the absolute directory limit is 16
plays. Flash capacity will normally be the earlier limit.

## Append transaction

The first implementation is append-only. It accepts only a compact, contiguous
sequence of `ota_0..ota_N` partitions.

1. Validate the incoming ESP32-C3 image and determine its exact image length.
2. Read and validate the current partition table and every dynamic entry.
3. Calculate the aligned partition and sidecar boundaries.
4. Reject before erasing anything when contiguous space is insufficient.
5. Write the application into unused Flash and verify its checksum, appended
   SHA-256, and readback hash.
6. Write and verify the sidecar.
7. Generate and verify a new partition table that appends exactly one entry.
8. Commit the partition table, clear `otadata`, and reset to the factory
   Launcher.

The existing library remains described by the old table until step 7. A power
loss before that commit can leave only unreachable bytes. A power loss while
the primary partition-table sector is being committed can still require ROM
download recovery; Play Manager must state this boundary and preserve a
complete-system recovery action.

## Update and removal policy

- Same or smaller updates may reuse the current partition after full image and
  sidecar validation.
- The last partition may grow into the free tail.
- A larger middle update is appended as a new physical partition, then the
  logical directory is committed. Physical movement must not reset first
  install time or launch count.
- Removing the last partition immediately reclaims space.
- Removing a middle partition initially leaves a hole. v0.3 reports total free
  bytes and the largest installable contiguous image separately.
- Compaction is a later explicit operation. It must never run implicitly during
  an ordinary launch.

## Device and browser changes

Launcher must enumerate contiguous OTA entries at runtime instead of compiling
arrays of three. Its model has a bounded capacity of 16 and a runtime count.
Cover navigation continues to show previous, selected, and next cards while the
indicator becomes `current / total`.

Play Manager no longer asks for a physical target when adding a new play. It
shows required bytes, remaining bytes, and post-install capacity, then appends
the play. Update and removal actions continue to identify the exact title and
stable source identity.

Startup must not hash every complete image as library size grows. It loads the
small sidecar directory first and performs full image verification only for the
selected launch or a requested diagnostic scan.

## Migration

The fixed v0.2 table and the dynamic v0.3 table are distinct system layouts.
Normal slot installation must never rewrite one into the other. Play Manager
detects v0.2, explains that the migration rebuilds the play library, and uses a
dedicated complete-system migration flow. The safe initial release requires
the user to reinstall existing plays after migration; automatic relocation is
deferred until it can be power-loss tested on hardware.

## Delivery phases

1. Pure allocator and layout validation with host tests.
2. Partition-table encoder, MD5 verification, and append transaction simulator.
3. Dynamic sidecar format and browser inventory.
4. Runtime Launcher enumeration, bounded model, and dynamic Cover Art UI.
5. Complete-system migration and recovery UX.
6. Firmware build, simulated interruption tests, and real-device acceptance.

This checkout completes phases 1 through 4: allocation and partition-table
encoding, interruption-state simulation, the double-bank sidecar, fast browser
inventory helpers, runtime Launcher enumeration, and the dynamic Cover Art UI.
The Launcher runtime has been validated on a device with four installed plays.
The browser helper modules in this checkout are host-tested but are not wired
directly into its Web Serial UI; migration and installation integration are
maintained in the Play Manager workflow and must retain the transaction and
recovery boundaries above.
