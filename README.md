<p align="right">
  <a href="README.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Cover Arts Launcher

Cover Arts Launcher turns a FoloToy AI Passport into a cover-first play library.
Browse the plays actually installed on the device, launch the selected play, and
return to the library after a restart or power cycle.

This repository contains the launcher firmware, browser-side management tools,
host tests, build tooling, and the optional creator integration skill. The
current public release is **v1.6.0**.

## What it does

- Allocates play storage from each verified firmware image's actual size instead
  of reserving three fixed 2 MiB positions.
- Shows only installed plays: one installed play produces one cover, two produce
  two covers, and so on.
- Uses `Up` and `Down` to browse, `OK` to launch, and `OK Long` to open details.
- Shows the play version, first install time, latest install/update time, and
  launch count in the details view.
- Supports Chinese play titles with pre-install glyph checks.
- Installs generic compatible plays without requiring a Launcher SDK or source
  change.
- Removes any installed play, closes its logical gap immediately, and reuses
  the released range for a later compatible play.
- Installs several plays in one browser permission session, then restarts the
  device once when library management is complete.
- Returns to the Launcher after a restart or power cycle without deleting the
  installed plays.
- Optionally lets an adapted play return from its existing cover page by holding
  `Up`; the shortcut is intentionally not reserved during gameplay.

## Install v1.6.0

The recommended path is the hosted [Play Manager](https://calm.yishan.app/).
Use desktop Chrome or Edge, connect the AI Passport with a data-capable USB
cable, and select the complete Launcher installation flow.

Download these files from the
[v1.6.0 release](https://github.com/yishan/cover-arts-launcher/releases/tag/v1.6.0):

- `FoloToy-AI-Passport-Cover-Arts-Launcher-v1.6.0-full.bin` — complete 8 MiB
  image for writing at address `0x0`.
- `FoloToy-AI-Passport-Cover-Arts-Launcher-v1.6.0-full.bin.zip` — compressed copy
  of the same image; unzip it before selecting it in the manager.
- `SHA256SUMS.txt` — published integrity values.
- `THIRD_PARTY_NOTICES.md` — source and license acknowledgements.

v1.6.0 provides 6.9375 MiB of play storage, 512 KiB more than v1.5.0.
Adopting this compact layout requires complete initialization and clears installed
plays and covers. A raw full-image write can also reset stored settings. Prepare
to reinstall plays, save needed data, and read the
[installation guide](docs/installation.md) before proceeding.

## Use the play library

1. Open the [Play Manager](https://calm.yishan.app/) and connect the device.
2. Import an official Play URL or select a local compatible `.bin` file.
3. Review the detected title, version, source ID, firmware hash, and cover.
4. Install one or more plays. v1.6.0 appends them in logical order and first
   reuses the smallest released range that fits.
5. Finish the session to restart the device once, then confirm the new cover and
   launch behavior on the device.

See the [user guide](docs/user-guide.md) for details, recovery, and generic-play
behavior.

## Optional creator integration

No integration is required for installation or launch. Without integration, a
restart or power cycle returns to the Launcher. Creators who want a faster path
may use the
[`ai-passport-cover-arts-launcher`](skills/ai-passport-cover-arts-launcher/SKILL.md)
skill to add `Up Long` only to an existing cover or start page. The public guide
and Agent prompt are available at
[calm.yishan.app/skills](https://calm.yishan.app/skills/).

## Develop and verify

Target: ESP32-C3, 8 MiB Flash, no PSRAM, ESP-IDF 5.5.3.

```bash
./tools/validate.sh --static
./tools/validate.sh --firmware
./tools/validate.sh
```

Build success is not hardware validation; release candidates must still be
checked on a real AI Passport.

## License and acknowledgements

The repository is released under the [MIT License](LICENSE). It builds on the
FoloToy AI Passport baseline and includes adapted or vendored third-party work
whose notices remain in the repository. See
[Third-party notices](docs/THIRD_PARTY_NOTICES.md) and the
[meta-pass borrowing boundary](docs/reference/meta-pass-borrowing.md).
