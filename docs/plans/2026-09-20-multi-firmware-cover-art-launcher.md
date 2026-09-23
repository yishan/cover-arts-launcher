<p align="right">
  <a href="2026-09-20-multi-firmware-cover-art-launcher.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Multi-Firmware Cover Art Launcher Implementation Plan

Product and interaction baseline: [Multi-Firmware Cover Art Launcher Design Specification](2026-09-21-multi-firmware-cover-art-launcher-design.md)

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task.

**Goal:** Build a factory Launcher with exactly three fixed play positions that can hold up to three independently installed application images, present them as Cover Art cards, boot the selected application, and safely return or roll back to the Launcher.

**Architecture:** Keep the standard ESP-IDF second-stage bootloader. A normal `factory` application owns the BSP/LVGL UI and selects one of three `ota_*` application partitions with the OTA API. App-only images go to OTA slots; a raw `covers` partition stores an A/B sidecar containing the title, 120×160 RGB565 cover, checksums, generation, and bound application SHA-256. Deliver a reliable text Launcher first, then the installer, then Cover Art; keep SoftAP upload outside the MVP gate.

**Tech Stack:** ESP-IDF 5.5.3, ESP32-C3, standard OTA/rollback APIs, LVGL, current BSP, C11 host tests, Python firmware-layout tests, browser JavaScript with Web Serial, Node.js tests.

---

## 1. Scope and decisions

### MVP includes

- One `factory` Launcher and three 2 MiB application slots.
- Empty, invalid, trial, and ready slot states.
- A valid all-empty first-run library. Installing the first play is optional and may be skipped after the Launcher is installed.
- `UP`/`DOWN` card selection, `OK` click to boot, and `OK` long-press for details.
- A text-only bring-up UI before graphical cards are enabled.
- Browser installation from either app-only or merged `0x0` images.
- Install-time title and cover sidecars; missing/corrupt covers use a built-in placeholder.
- SHA-256 binding between a cover record and its installed application image.
- One-shot boot for generic applications with persistent title/cover/relaunch after reset; an optional in-app return hook for adapted applications.
- Host tests, firmware verification, and a real-device acceptance matrix.

### Deferred until the MVP passes on hardware

- SoftAP/HTTP upload, more than three applications, an online store, and background downloads.
- JPEG/PNG decoding on the device; v1 stores browser-converted RGB565 only.
- Secure Boot, Flash Encryption, and isolation from malicious child firmware.
- `.rodata_custom_desc` as the primary metadata source. It may later be optional for controlled builds.

### Product boundary

This is multi-boot, not concurrent execution. Only one application runs at a time and switching requires a restart. Different plays belong in different slots; language, difficulty, and modes remain inside one application.

The Launcher installation and the first play installation are separate completion states. A user may finish setup with all three positions empty. This is a normal library state, not an installation failure; the device must explain how to add a play from the computer installer.

## 2. Provisional 8 MB Flash contract

Do not flash this layout until the device's current partition table and product-identity requirements have been read and reviewed. In particular, do not copy meta-pass's project-specific `cardid` address.

| Partition | Type/subtype | Offset | Size | Purpose |
| --- | --- | ---: | ---: | --- |
| `nvs` | data/NVS | `0x9000` | `0x6000` | Launcher and application namespaces |
| `phy_init` | data/PHY | `0xF000` | `0x1000` | PHY initialization |
| `factory` | app/factory | `0x10000` | `0x170000` | Launcher, maximum about 1.44 MiB |
| `ota_0` | app/OTA 0 | `0x180000` | `0x200000` | Application slot 0 |
| `ota_1` | app/OTA 1 | `0x380000` | `0x200000` | Application slot 1 |
| `ota_2` | app/OTA 2 | `0x580000` | `0x200000` | Application slot 2 |
| `covers` | data/custom `0x40` | `0x780000` | `0x7E000` | A/B cover records and manifests |
| `otadata` | data/OTA | `0x7FE000` | `0x2000` | Standard ESP-IDF boot selection |

The table ends exactly at `0x800000`. The complete app image must be no larger than `0x200000`; cover data is never appended to an app slot.

### Cover-bank layout

Each application gets two 64 KiB banks in `covers`:

```text
slot 0: A 0x00000, B 0x10000
slot 1: A 0x20000, B 0x30000
slot 2: A 0x40000, B 0x50000
```

Each bank reserves its first 4 KiB for a serialized manifest and stores the payload at `0x1000`. A 120×160 RGB565 cover is 38,400 bytes. The installer erases and writes the inactive bank, verifies the payload, then writes the valid manifest last. The Launcher chooses the highest valid generation whose firmware SHA matches the slot, leaving the prior bank recoverable after an interrupted update.

Persist fields explicitly in little-endian form; never write a compiler-padded C structure directly:

```c
#define LAUNCHER_COVER_MAGIC 0x31525643u /* "CVR1" */
#define LAUNCHER_COVER_SCHEMA 1u
#define LAUNCHER_TITLE_MAX 64u
#define LAUNCHER_SOURCE_ID_MAX 48u
#define LAUNCHER_VERSION_MAX 24u

typedef struct {
    uint32_t generation;
    uint8_t slot_id;
    uint8_t source_kind;
    uint16_t width;
    uint16_t height;
    uint32_t payload_length;
    uint32_t payload_crc32;
    uint8_t firmware_sha256[32];
    char title[LAUNCHER_TITLE_MAX + 1];
    char source_id[LAUNCHER_SOURCE_ID_MAX + 1];
    char version[LAUNCHER_VERSION_MAX + 1];
} launcher_cover_manifest_t;
```

Schema v1 accepts only `120×160`, RGB565, and `payload_length == 38400`. Play API installs persist a stable `source_id` such as `play:281`; local files may leave it empty and therefore cannot be auto-matched for in-place updates. Unknown schemas, invalid lengths/UTF-8, CRC failures, and SHA mismatches return a placeholder rather than blocking boot.

## 3. Delivery gates

| Gate | Outcome | Must pass before moving on |
| --- | --- | --- |
| A | Layout and pure contracts | Static checks, layout tests, manifest tests |
| B | Text multi-boot Launcher | Three real apps boot; all three cards remain navigable, while empty/corrupt slots never become boot targets |
| C | Generic return and relaunch | A generic app returns after reset, remains installed, and can launch again; optional adapted return works |
| D | Web Serial installation | Complete-system, app-only, and merged-image paths install with layout/size/SHA verification and interruption recovery |
| E | Cover Art | A/B update, placeholder fallback, and low-memory rendering pass on device |
| F | Optional SoftAP | Starts only after A–E pass and memory/Flash headroom is remeasured |

## 4. Implementation tasks

### Task 1: Create an isolated Launcher branch and pin the borrowing boundary

**Files:**

- Create during execution: managed worktree on `feature/multi-firmware-launcher`, based on upstream `main`.
- Create: `tools/install-slot/LICENSE.meta-pass.txt`
- Create: `docs/reference/meta-pass-borrowing.md`
- Create: `docs/reference/meta-pass-borrowing.zh_CN.md`

**Steps:**

1. Record branch/status; do not merge the Penalty shell into the Launcher.
2. Create the isolated branch/worktree and confirm it is clean.
3. Pin meta-pass commit `994caaf52357d97323bffb82b2db9cc784afb1eb` as a reference, not a moving dependency.
4. Record copied/substantially adapted installer files and preserve the MIT notice.
5. Record that meta-pass's layout, `cardid`, 4 KiB/8 KiB tail convention, and UI are not inherited.
6. If commits are authorized, commit only these attribution/reference files.

### Task 2: Freeze and test the partition contract

**Files:**

- Modify: `partitions.csv`
- Modify: `docs/development/engineering/firmware-layout.md`
- Modify: `docs/development/engineering/firmware-layout.zh_CN.md`
- Modify: `tests/test_verify_firmware.py`
- Modify only if required: `tools/verify_firmware.py`

**Steps:**

1. Add a failing host test for the labels, offsets, sizes, non-overlap, `0x800000` end, and three equal 2 MiB slots.
2. Run `PYTHONDONTWRITEBYTECODE=1 python3 tests/test_verify_firmware.py`; expect the new assertion to fail.
3. Replace the single-factory table with the reviewed Launcher table.
4. Update both firmware-layout documents with full-image/app-only rules and migration risk.
5. Run the focused test, then `./tools/validate.sh --static`; expect PASS.
6. Before any device write, read/archive the existing partition-table sector and confirm no identity data is displaced.

### Task 3: Implement the portable cover-manifest codec

**Files:**

- Create: `main/launcher_manifest.h`
- Create: `main/launcher_manifest.c`
- Create: `tests/test_launcher_manifest.c`
- Modify: `tools/validate.sh`

**API:**

```c
bool launcher_manifest_encode(uint8_t out[256],
                              const launcher_cover_manifest_t *manifest);
bool launcher_manifest_decode(launcher_cover_manifest_t *out,
                              const uint8_t *bytes, size_t length);
bool launcher_manifest_matches_image(const launcher_cover_manifest_t *manifest,
                                     const uint8_t image_sha256[32]);
```

**Steps:**

1. Write failing table-driven tests for valid round-trip, bad magic/schema, invalid slot/dimensions, oversized payload, invalid UTF-8, Play API source without `source_id`, local source with an empty `source_id`, and SHA mismatch.
2. Compile with `cc -std=c11 -Wall -Wextra -Werror -Imain tests/test_launcher_manifest.c main/launcher_manifest.c`; verify failure.
3. Implement fixed-offset little-endian serialization without ESP-IDF/LVGL dependencies.
4. Add the test to `tools/validate.sh` and run it to PASS.

### Task 4: Implement slot discovery and selection as pure logic first

**Files:**

- Create: `main/launcher_model.h`
- Create: `main/launcher_model.c`
- Create: `main/launcher_slots.h`
- Create: `main/launcher_slots.c`
- Create: `tests/test_launcher_model.c`
- Modify: `tools/validate.sh`

```c
typedef enum {
    LAUNCHER_SLOT_EMPTY,
    LAUNCHER_SLOT_INVALID,
    LAUNCHER_SLOT_TRIAL,
    LAUNCHER_SLOT_READY,
} launcher_slot_state_t;
```

**Steps:**

1. Write failing tests for wraparound navigation across all three cards, all-empty behavior, refresh, and refusal to boot empty/invalid targets.
2. Implement the pure model without partition APIs.
3. Implement the ESP-IDF adapter with `esp_partition_find_first()`, image verification, and `esp_ota_get_partition_description()`.
4. Compute app SHA-256 with bounded streaming chunks, never an image-sized buffer.
5. Run model tests and `./tools/validate.sh --static` to PASS.

### Task 5: Bring up the text Launcher and standard boot switching

**Files:**

- Replace on the Launcher branch: `main/main.c`
- Create: `main/launcher_ui.h`, `main/launcher_ui.c`
- Create: `main/launcher_boot.h`, `main/launcher_boot.c`
- Modify: `main/CMakeLists.txt`
- Modify only for measured requirements: `sdkconfig.defaults`

**Steps:**

1. Add a contract test requiring BSP display/buttons, an input queue, and standard OTA APIs.
2. Initialize through the BSP; keep button callbacks non-blocking and queue events.
3. When all three slots are empty, render a dedicated first-run library screen with three empty positions, `Connect to a computer to add a play`, and the installer URL/help entry. Do not show an error or auto-launch setup.
4. Otherwise render slot, title/project name, version, size, and state. Invalid slots remain visible but cannot launch.
5. Implement `UP`/`DOWN`, `OK` click, and `OK` long-press details.
6. Reverify the image, call `esp_ota_set_boot_partition(target)`, then restart only after success.
7. Run `./tools/validate.sh --firmware`; the Launcher must fit `factory` and the merged image must validate.
8. On device, test cold boot, all-empty, each populated slot, invalid-image refusal, and 30 repeated selections.

### Task 6: Define generic one-shot return and optional adapted return

**Files:**

- Create: `components/launcher_contract/CMakeLists.txt`
- Create: `components/launcher_contract/include/launcher_contract.h`
- Create: `components/launcher_contract/launcher_contract.c`
- Create: `tests/test_launcher_boot_policy.c`
- Modify in each adapted child: its application shell and component manifest.

```c
esp_err_t launcher_contract_mark_valid(void);
esp_err_t launcher_contract_return_to_factory(void);
```

**Steps:**

1. Write policy tests for factory, first one-shot launch, reset-to-ready relaunch, confirmed app, invalid image, and explicit return.
2. Port the proven meta-pass rollback sequence against ESP-IDF 5.5.3 and document every OTA state transition.
3. Make `return_to_factory()` resolve factory, set it as target, and restart only after success.
4. Adapt Penalty first without changing its modes or its own cover screen.
5. Test generic reset return and relaunch plus optional adapted confirm/return. V1 has no automatic timeout: a generic play runs until reset/power-cycle, then returns because it never confirms itself. Its rollback `ABORTED` state is classified as ready, while explicit image-invalid state remains blocked.
6. Verify every secondary Launcher screen uses `OK` long to return to the Cover Art library.
7. Remove power at each transition and record the next boot target.

### Task 7: Implement first-time complete-system installation

**Files:**

- Create: `tools/install-slot/system-install.js`
- Create: `tools/install-slot/test-system-install.mjs`
- Create: `tools/install-slot/index.html`, `tools/install-slot/app.js`
- Create: `tools/install-slot/README.md`, `tools/install-slot/README.zh_CN.md`
- Modify: `tools/validate.sh`

**Steps:**

1. Write failing state-machine tests for detecting the current single-factory layout, an existing compatible Launcher layout, an unknown layout, user cancellation, disconnect, full-write failure, verification failure, and successful completion with all three positions empty.
2. Read the chip, Flash size, and current partition-table sector before offering migration. Refuse automatic migration when the chip, Flash size, or layout cannot be identified; never infer that an unknown data partition is disposable.
3. Show the one-time warning that installing the multi-play system rewrites the bootloader, partition table, factory Launcher, OTA metadata, and all three application/cover regions and may reset existing settings.
4. Verify the signed/published complete-image SHA. Before writing the validated sparse Launcher merged image at `0x0`, explicitly erase every region that must start empty: `ota_0`, `ota_1`, `ota_2`, both cover banks for all three positions, and `otadata`. Do not infer these erasures from gaps in the merged image.
5. Verify every written system segment, verify the erased regions by readback sampling at the start and end of every erase range, confirm that no OTA entry is selected, and restart into the Launcher. Do not present success before the compatible layout and factory image are readable and all three positions scan as empty. A future full-8-MiB artifact may replace this procedure only if its blank-fill policy and whole-image SHA are part of the release contract.
6. V1 does not resume a partial complete-system write. After disconnect or power loss, guide the user back into ROM download mode, reconnect, and restart the full system installation from the beginning.
7. After success, offer `Install the first play` and `Finish with an empty library` as equal completion actions; skipping the first play is not cancellation or failure.
8. Add `node --test tools/install-slot/test-system-install.mjs` to the static gate and complete a real-device interrupted-install recovery test before Gate D passes.

### Task 8: Port and harden play-position installation

**Files:**

- Modify: `tools/install-slot/index.html`, `tools/install-slot/app.js`
- Create: `tools/install-slot/extract-app-image.js`, `tools/install-slot/cover-convert.js`
- Create: `tools/install-slot/test-extract-app-image.mjs`, `test-cover-convert.mjs`
- Modify: `tools/install-slot/README.md`, `tools/install-slot/README.zh_CN.md`
- Modify: `tools/validate.sh`

**Steps:**

1. Port the merged-image parser from the pinned source while retaining its MIT notice.
2. Test app-only, valid merged, bad partition-table MD5, missing factory image, truncated segments, non-ESP images, and images over exactly `0x200000`.
3. Accept a Play URL/API response or local firmware plus optional local cover. Target recommendation order is: same `source_id` for an in-place update, otherwise first empty position, otherwise explicit manual replacement.
4. Verify the published/downloaded SHA before extraction; then display the extracted app SHA bound into the cover manifest.
5. Web Serial writes only the selected OTA slot and inactive cover bank; slot replacement never writes NVS, PHY, Launcher, or the partition table.
6. If app erase/write/verification fails, mark the target installation incomplete and reject it as a boot target. If only cover writing fails after app verification, keep the app bootable with a placeholder and offer `Retry cover only`. V1 restarts interrupted app writes from erase/write rather than resuming them.
7. Add `node --test tools/install-slot/test-*.mjs` to the static gate and run to PASS.

### Task 9: Add Cover Art storage and the graphical selector

**Files:**

- Create: `main/launcher_cover_store.h`, `main/launcher_cover_store.c`
- Create: `main/launcher_cover_view.h`, `main/launcher_cover_view.c`
- Create: `assets/images/launcher/placeholder-cover.*`
- Create: `tests/test_launcher_cover_store.c`, `tests/test_launcher_art_contract.py`
- Modify: `main/launcher_ui.c`, `main/CMakeLists.txt`
- Modify: `assets/README.md`, `assets/README.zh_CN.md`

**Steps:**

1. Test bank selection, generation wrap, erased/partial banks, CRC/SHA failure, and fallback to the older valid bank.
2. Implement strictly bounded raw-partition reads with no unbounded allocation.
3. Convert covers in the browser to exactly 120×160 RGB565; do not decode PNG/JPEG on device.
4. Render the selected 120×160 cover from Flash with a bounded draw buffer. Stream/crop a `20–24 px` edge strip from each adjacent position for the left/right peeks; never retain three full covers in RAM.
5. Add title, version, slot state, battery, and the three-position indicator; missing battery and cover data degrade independently.
6. Test that UP/DOWN, center cover, both side peeks, title, and indicator remain synchronized across ready, empty, trial, incomplete, and cover-invalid states.
7. Test three cards with one corrupt record and verify responsiveness.
8. Record heap before UI, after scan, and after 100 card changes; a monotonic leak fails the device gate.

### Task 10: Complete documentation and release-quality acceptance

**Files:**

- Create: `docs/software/multi-firmware-launcher.md`
- Create: `docs/software/multi-firmware-launcher.zh_CN.md`
- Modify: `docs/README.md`, `docs/README.zh_CN.md`
- Update authoritative build/flashing docs if commands changed.

**Steps:**

1. Document flow, slot states, app-only versus merged images, recovery, shared NVS, and that SHA/signatures do not sandbox child firmware.
2. Document safe migration: inspect/backup first, flash the Launcher layout once, then replace slots without rewriting the partition table.
3. Run `./tools/validate.sh --static`, `./tools/validate.sh --firmware`, then `./tools/validate.sh`; all must PASS under ESP-IDF 5.5.3.
4. Execute the device matrix below. Build output alone cannot complete the feature.

## 5. Required device acceptance matrix

- All three slots empty: Launcher setup is complete, the empty-library screen is usable, and it points to the computer installer without offering an invalid boot target.
- First-time complete-system installation: migration warning is shown, successful installation verifies the compatible layout/factory image, and an interrupted write can be recovered by restarting through ROM download mode.
- Three valid apps: each boots from cold power-on and Launcher selection.
- App-only and merged installation: installed app SHA matches the installer.
- Oversized/truncated/wrong-chip images: rejected before boot selection changes.
- Missing/corrupt/failed cover: placeholder displays while a verified app remains bootable, and cover-only retry does not rewrite the app.
- Power loss during image, payload, and manifest writes: an old valid state or a safe non-bootable state recovers; every card remains navigable.
- Generic reset return preserves the installed card and permits relaunch; optional adapted return behaves as documented.
- Thirty slot switches and 100 card changes: no crash, stuck input, or monotonic heap loss.
- Every carousel state shows synchronized left/right `20–24 px` adjacent peeks and the three-position indicator.
- Launcher NVS uses a dedicated namespace and survives child-app use.
- Slot replacement preserves NVS/PHY and unrelated slots where promised.

Final reporting remains separate:

```text
Build: PASS / FAIL / NOT RUN
Host tests: PASS / FAIL / NOT RUN
Device tests: PASS / FAIL / NOT RUN
Unverified: remaining board, power-loss, security, or installer checks
```

## 6. Optional Phase 2: SoftAP upload

Start only after Gates A–E pass and Flash/internal-RAM headroom is remeasured. Reuse Web Serial's image parser, size rule, SHA binding, cover manifest, and failure cleanup instead of creating a second storage contract. Stream HTTP writes into an inactive target and post UI state to the LVGL task. Test disconnect, timeout, duplicate chunks, content-length mismatch, and reboot during finalization before enabling it by default.
