<p align="right">
  <a href="2026-09-21-multi-firmware-cover-art-launcher-design.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Multi-Firmware Cover Art Launcher Design Specification

Status: design baseline
Target: AI Passport, ESP32-C3, 8 MB Flash, 240×320 display, three physical buttons
Related implementation plan: [Multi-Firmware Cover Art Launcher Implementation Plan](2026-09-20-multi-firmware-cover-art-launcher.md)

## 1. Product definition

The product is a multi-boot experience composed of three parts:

1. **Play Manager** — a desktop browser installer that connects through Web Serial, installs the Launcher once, and later adds, updates, or replaces plays.
2. **Play Library** — the permanent `factory` Launcher on the device. It displays three play positions as a Cover Art carousel and boots the selected application.
3. **Play application** — an independently built app image installed in one of three OTA slots. Generic ESP32-C3 plays require no Launcher integration; an optional contract can add an in-app return action.

This is not concurrent execution. Only one play runs at a time, and selecting a different play restarts the device into another app partition.

### User-facing vocabulary

| Internal term | User-facing term | Usage rule |
| --- | --- | --- |
| factory Launcher | Play Library / multi-play system | Never describe it as one of the three plays |
| OTA slot | Play position | Use `Position 1`, `Position 2`, and `Position 3` |
| child firmware/app | Play | Examples: Penalty, Pong |
| Web Serial installer | Play Manager | Desktop browser experience |
| invalid app image | Installation incomplete | Follow with a recovery action |

Terms such as `ota_0`, partition offset, and raw subtype appear only in advanced diagnostics.

## 2. Confirmed product decisions

1. The final device home screen is a Cover Art interface, not a text slot list.
2. Exactly three play positions are shown; the carousel wraps cyclically.
3. The center card is the active selection. The other two positions are hinted by partially visible cards at the left and right edges.
4. Installing the Launcher and installing the first play are separate completion states.
5. A user may finish first-time setup with all three positions empty. An empty library is valid, not an error.
6. A same-source update is recommended in place; otherwise the first empty position is recommended. Replacing a different occupied position always requires explicit user selection and confirmation.
7. Generic plays are the default compatibility path. A verified play is shown as installed without a health-confirmation callback. Reset or power-cycle returns to the Launcher, where the same title and cover remain available for another launch.
7. The MVP uses desktop Web Serial. SoftAP installation is a later phase.
8. Cover and presentation metadata are installed as a sidecar and bound to the app-image SHA-256; arbitrary firmware is not expected to contain a standard cover.
9. The final UI does not inherit the meta-pass text-menu visual design. The project borrows its proven multi-boot and installation concepts only.

## 3. Experience architecture

```text
Desktop browser
  Play Manager
    ├─ install multi-play system once
    ├─ inspect three play positions
    ├─ validate/extract app image
    ├─ choose empty or replacement position
    └─ write app + presentation sidecar
             │ USB / Web Serial
             ▼
Device factory Launcher
  Play Library
    ├─ scan three positions
    ├─ show Cover Art carousel
    ├─ block empty/invalid targets
    └─ select target and restart
             │ standard OTA boot selection
             ▼
Selected play
    ├─ run independently
    ├─ mark healthy when adapted
    └─ return to factory when requested
```

The Launcher must remain usable when no child app is valid. The browser installer is the only place that mutates play positions in the MVP.

## 4. End-to-end user journeys

### 4.1 First-time installation of the multi-play system

```text
Open Play Manager in a supported desktop browser
  → connect AI Passport by USB
  → detect chip and current partition layout
  → explain the one-time storage-layout change
  → confirm Launcher installation
  → write and verify the complete Launcher image
  → restart into Play Library
  → choose either:
       Install the first play
       Finish with an empty library
```

The warning must say that the one-time layout change may reset existing settings. It must not imply that later slot replacements rewrite the entire device.

Choosing `Finish with an empty library` is a successful completion. It must not be styled as cancel, skip error, or unfinished setup.

### 4.2 Install a second or third play

```text
Open a play page or select a local firmware file
  → connect device
  → validate firmware/chip/size/SHA
  → read current position inventory
  → recommend the same-source update position or the first empty position
  → confirm target
  → write app image
  → verify installed app SHA
  → write cover sidecar
  → report success and restart instructions
```

Other positions, the Launcher, NVS, and PHY must not be rewritten during a normal position installation.

### 4.3 Replace or update a play

When all positions are occupied, the user selects the exact card to replace. The confirmation names both old and new plays and states that the other two positions are unaffected.

Target recommendation follows a fixed priority: first recommend the occupied position with the same `source_id` as an in-place update; otherwise recommend the first empty position; if neither exists, require manual replacement selection. A local file without a stable source ID is treated as a new play and never auto-targets an occupied position.

Once app writing begins, the old app in that position is not recoverable without reinstalling it. The A/B cover record protects presentation metadata, not the app image itself.

### 4.4 Daily device use

```text
Power on
  → scan positions
  → show selected Cover Art
  → UP selects previous/left card
  → DOWN selects next/right card
  → OK launches a ready play
  → device restarts into that play
```

For an empty card, `OK` opens installation help. For an incomplete card, `OK` opens recovery help. Neither state may change the boot target.

### 4.5 Return to the Play Library

Generic plays need no Launcher-specific code. The Launcher stages each selection as a one-shot OTA boot. The play runs until the user resets or power-cycles the device; ESP-IDF rollback then returns to the factory Launcher. The resulting `ABORTED` OTA state means that the one-shot session ended, not that the verified image is damaged, so its title, cover, and relaunch action remain available.

An optional adapted play may expose `Return to Play Library` from its own menu or cover page. A play may keep its internal navigation first—for example, long-press OK can return from gameplay to its own cover, and a second long-press from that cover returns to the Play Library.

V1 has no automatic play timeout and does not require a third-party developer to confirm startup. Explicit OTA image validation failures remain non-bootable and open recovery help.

## 5. Device information architecture

The production device experience contains five screens with state variants:

| Screen | Purpose | Main actions |
| --- | --- | --- |
| Boot/scan | Initialize display and inspect positions | Automatic transition |
| Cover Art library | Select ready, empty, or incomplete positions | UP, DOWN, OK, long OK |
| Position details | Show title, version, size, state, and source summary | Back; open help where applicable |
| Installation/recovery help | Explain USB installation or repair | Back |
| Launch/error transition | Confirm launch or explain verification failure | Automatic restart or return |

There is no persistent production text-list home screen. A text list may exist only as an engineering bring-up stage.

## 6. Cover Art home-screen specification

### 6.1 Layout for 240×320 portrait

| Region | Bounds | Content |
| --- | --- | --- |
| Header | `y=0..31` | `Play Library` left; battery right |
| Art stage | `y=36..199` | Center 120×160 cover and side peeks |
| Title | `y=206..233` | Centered play title or position state |
| Metadata | `y=236..253` | Version and `Position n / 3` |
| Position indicator | `y=258..275` | Three dots/status marks |
| Controls | `y=282..319` | UP previous, OK action, DOWN next |

The selected cover is `120×160` at approximately `x=60, y=38`. Each neighboring position exposes about `34 px` of a `36 px` strip, with the remaining `2 px` recessed behind the selected frame. Neighboring strips render at about 60% opacity; the selected card remains full contrast.

### 6.2 Carousel ordering

```text
selected 1: left 3, right 2
selected 2: left 1, right 3
selected 3: left 2, right 1
```

The side peeks and the three position indicators are both required. Side peeks show that other content exists; indicators communicate total count and current position.

### 6.3 Button mapping

| Input | Ready position | Empty position | Incomplete position |
| --- | --- | --- | --- |
| `UP` click | Previous/left card | Previous/left card | Previous/left card |
| `DOWN` click | Next/right card | Next/right card | Next/right card |
| `OK` click | Launch | Installation help | Recovery help |
| `OK` long | Position details | System/help details | Diagnostic details |

Because physical controls are named UP/DOWN while the carousel is horizontal, the control legend must remain visible in v1: `UP Previous` and `DOWN Next`. Do not rely on animation alone to teach the mapping.

On every secondary screen—position details, installation help, recovery help, and diagnostics—`OK` long returns to the Cover Art library. `OK` click may activate the single primary action shown on that screen. Trial positions use the same mapping as ready positions: `OK` launches the trial and `OK` long opens details. A position with a valid app but invalid cover also uses the ready mapping.

### 6.4 Position-state visuals

| State | Center card | Side peek | Primary action |
| --- | --- | --- | --- |
| Ready | Installed cover | Real cover edge | Launch |
| Empty | Neutral placeholder with `+` | Gray edge with slot number | Add-play help |
| Trial | Cover with small `Trial` badge | Cover edge with dot | Launch trial/details |
| Incomplete/invalid | Placeholder with `!` | Warning edge | Repair help |
| Cover invalid, app valid | Built-in placeholder | Placeholder edge | Launch remains allowed |

Color cannot be the only state cue; use `+`, `!`, labels, and action text.

### 6.5 All-empty library

All three empty positions remain navigable. The selected card shows:

```text
[ neutral cover with + ]
Empty position
Position 1 / 3
Connect to a computer to add a play
```

The side peeks show the other two numbered empty positions. No error banner, forced setup, countdown, or automatic network flow appears.

### 6.6 Motion

- MVP transition: 120–160 ms directional slide or immediate swap with a short edge highlight.
- Update only the art/title/indicator regions; do not redraw the full screen continuously.
- Do not implement 3D perspective, blur, spring physics, or simultaneous residency of all three full covers.
- Button input remains accepted only after the selection state is coherent; repeated input must not leave cards and metadata out of sync.

## 7. Visual and content rules

- Use a quiet, dark neutral stage so user-provided art remains the focus.
- The selected art has a 1–2 px focus border; side peeks use dimming rather than blur.
- System status colors are reserved: neutral/empty, ready, trial, and warning.
- The header and control legend must never overlap the art.
- Battery failure hides the value or shows an unavailable state; it must not move the cover layout.
- Long titles truncate visually without changing the layout. The full title remains available in details.
- Store the UTF-8 title for identity and diagnostics. The Launcher title font covers printable ASCII, CJK punctuation, full-width forms, and the 3,755 GB2312 level-one common Simplified Chinese characters. Unsupported rare characters show a placeholder; unrestricted Chinese remains a possible future bounded raster-strip extension.
- A cover must not contain required operational instructions; instructions remain real UI text or fixed system assets.

## 8. Desktop Play Manager screens

The MVP targets a supported desktop Chromium browser because Web Serial is required. Unsupported/mobile browsers receive an environment explanation, not a broken connect button.

| Screen/state | Required content |
| --- | --- |
| Welcome/environment | Supported browser, USB requirement, start action |
| Device connection | Port chooser, chip/device detection, reconnect guidance |
| First-time system installation | Storage-layout warning, affected data, confirm/cancel |
| Play source and validation | Play URL or local file, cover preview, chip/format/size/SHA results |
| Position manager | Three cards with cover, title, version, state, and recommended target |
| Replacement confirmation | Old/new play names, affected position, unaffected positions, recovery warning |
| Install progress | Validate, extract, write app, verify app, write cover, complete |
| Success | Installed position, device restart instructions, install-another action |
| Failure/recovery | Exact failed stage, position safety state, retry/reconnect action, log export |

These may be states of one wizard rather than separate routes.

### Position selection rules

1. If the incoming play has a stable `source_id` that already exists, recommend that same position as an in-place update.
2. Otherwise recommend the first empty position.
3. Allow `Change position` before writing begins.
4. When all positions are occupied and there is no same-source update, require explicit selection; never choose a replacement automatically.
5. Every update or replacement of an occupied position still requires confirmation.
6. Disable a target if the extracted app exceeds 2 MiB or the device layout is unrecognized.
7. Hide the factory Launcher from the selectable inventory.

### Required replacement copy

```text
Replace "Old Play" in Position 2 with "New Play"?
Positions 1 and 3 are not affected.
Once writing starts, the old play cannot be restored unless it is installed again.
```

Do not claim that shared NVS data is deleted. App-data cleanup is outside the MVP and must not be coupled to image replacement.

## 9. Installation progress and failure behavior

Progress reports real stages rather than a decorative percentage:

```text
✓ Check firmware
✓ Extract application
● Write Position 2       68%
○ Verify application
○ Write cover metadata
○ Complete
```

- Target selection locks once app erasure begins.
- Full success appears only after the installed app SHA, the SHA-bound trust receipt, and any committed cover record are verified. A cover-only failure uses the explicit partial-success state below.
- If app writing is interrupted, the target becomes `Installation incomplete` and is not bootable.
- If cover writing fails after app verification, report a partial success: the app remains selectable and bootable with the built-in placeholder, and the Manager offers `Retry cover only` without rewriting the app.
- V1 does not resume a partial app write. After disconnect, reconnect and restart the selected-position installation from app erase/write. A first-time complete-system installation also restarts from the beginning after reconnect; before writing its sparse merged image, it explicitly erases and verifies all three OTA slots, all six cover banks, and `otadata`, so stale bytes cannot appear as installed plays. ROM download mode remains the recovery entry.
- Other positions and the Launcher remain unchanged during normal slot installation.
- Error messages name the failed stage and next action; they do not expose raw offsets unless advanced diagnostics are expanded.

## 10. Slot and metadata contract

Each position exposes these logical fields to the Launcher and Manager:

| Field | Purpose |
| --- | --- |
| `slot_id` | Stable physical position `0..2` |
| `state` | Empty, invalid, trial, or ready |
| `source_kind` | Play API or local file |
| `source_id` | Stable identity such as `play:281`; optional for local files |
| `title_utf8` | Display identity and diagnostics |
| `version` | User-visible installed version |
| `firmware_image_sha256` | Binding between app and presentation metadata |
| `cover_format`, dimensions, length, CRC | Strict cover decoding and bounds |
| `generation` | Select newest valid A/B presentation bank |
| `trust_source` | Exact install receipt, legacy SHA-bound cover, or compatibility mode |

V1 cover format is exactly 120×160 RGB565. The Launcher validates the app independently from the cover. A missing or corrupt cover never makes a valid app unbootable.

### 10.1 Resident-play trust policy

After writing and reading back a verified app, the Manager commits a 256-byte trust receipt in the unused tail of the `covers` partition. Each slot has two 4 KiB banks and selects the newest valid generation. The receipt binds `slot_id`, the exact app length, and the complete app SHA-256; title, Source ID, and filenames never transfer trust. A new installation becomes `verified resident` only after the receipt is read back successfully. Cover metadata is committed independently afterward, so cover failure does not revoke an established receipt.

To preserve existing generic plays, migration order is exact receipt, then a legacy cover manifest bound to the current app SHA, then legacy generic compatibility mode. Compatibility mode remains launchable, but logs and the Manager must not label it `verified resident`; re-verifying the same app in the Manager can add a receipt. This policy means the exact image was verified through the local Manager. It is not a developer signature or a sandbox against malicious firmware.

Trust banks occupy absolute addresses `0x7e0000..0x7e5fff` without changing the partition table. Erasing a position clears its app, both cover banks, and both trust banks. Complete-system migration clears all three positions' receipts.

### 10.2 Launch performance measurement

The Launcher emits structured `PERF` logs for startup scan and trust classification, UI ready, selected-slot reinspection, trust lookup, ESP image verification, and the moment immediately before restart. Measure every slot at least three times with the same firmware, power source, and serial configuration, then report median and maximum values separately. Desktop preview results must not be presented as device launch performance.

## 11. Optional child-application integration contract

Generic plays have no mandatory integration contract. They are installed, displayed, launched, returned from by reset or power-cycle, and made available for relaunch using the one-shot boot policy above.

Plays that opt into an in-app return action must:

- mark themselves healthy only after reaching a usable state;
- provide a discoverable return-to-library action;
- set factory as the next boot target before restarting;
- never write the Launcher, unrelated OTA slots, cover banks belonging to other positions, or the partition table;
- keep slow storage/audio/network operations outside button callbacks and LVGL critical sections.

Integration is an enhancement for returning without a hardware reset; it is not an installation or launch prerequisite.

## 12. Non-goals

- Running multiple plays simultaneously.
- More than three installed plays on the 8 MB device.
- Treating language, difficulty, or game modes as separate positions.
- A device-side app store or background downloader in the MVP.
- Complex 3D Cover Flow.
- Security isolation from a malicious installed firmware.
- Guaranteeing preservation of app-specific data when replacing unrelated firmware.

## 13. Acceptance criteria

### Comprehension

- A first-time user can explain that the system has three play positions without seeing OTA terminology.
- The user can identify the current position and perceive the other two from the home screen.
- Before replacement, the user can name the play that will be removed and the two positions that remain untouched.

### Device behavior

- The all-empty library is a successful, stable state.
- Empty and incomplete positions never become boot targets.
- A valid app with corrupt cover metadata uses a placeholder and remains launchable.
- UP/DOWN navigation, title, position indicator, and side peeks remain synchronized under repeated input.
- One hundred card changes show no monotonic heap loss; three full covers are never simultaneously retained in RAM.
- Both adjacent positions remain visible as approximately `34 px` edge peeks, with their state marks and the three-position indicator synchronized to the selected card.

### Installer behavior

- First-time Launcher installation and first-play installation can complete independently.
- A first-time system install writes and verifies the complete Launcher image; interruption recovery reconnects through ROM download mode and restarts the complete-system write.
- App-only and merged images produce the same validated app image when applicable.
- Oversized, truncated, wrong-chip, or SHA-mismatched images are rejected before the boot target changes.
- Interrupted installation yields an explicit safe state and recovery action.
- Normal position replacement does not rewrite the Launcher, partition table, NVS, PHY, or unrelated positions.

### Evidence reporting

Report build, host tests, device tests, and remaining unverified items separately. Browser simulation or host tests do not count as target-device power-loss, button, Web Serial, or rollback acceptance.

## 14. Delivery phases

1. **Contract prototype:** fixed layout, metadata codec, slot state model, and host tests.
2. **Text bring-up:** validate scan, selection, boot, return, and rollback without treating the text list as product UI.
3. **Play Manager:** first-time installation, slot inventory, app extraction, Web Serial write, verification, and recovery.
4. **Cover Art UI:** production carousel, side peeks, all-empty state, details, and placeholder behavior.
5. **Hardware acceptance:** repeated switching, interrupted writes, power loss, heap stability, and adapted/unadapted app behavior.
6. **Optional SoftAP:** only after measured Flash/RAM headroom and Gates 1–5 pass.

## 15. Open design items

- Final product name for Play Library and Play Manager.
- Final installer URL and whether a QR code is included in device help.
- Visual brand theme, placeholder illustration, and focus-border treatment.
- Whether a future browser version stores a pre-rasterized title mask for Chinese characters outside the built-in common-character set.
- The exact child-app return gesture for each existing play while preserving its internal navigation.

These items may change visual assets and copy, but they do not change the confirmed three-position architecture or user journeys above.
