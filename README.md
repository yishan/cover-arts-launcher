<p align="right">
  <a href="README.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Cover Arts Launcher

Cover Arts Launcher turns a FoloToy AI Passport into a three-position play
library. Browse full-cover artwork with the physical buttons, launch any
installed play, and return to the library after a restart or power cycle.

This repository contains the ESP32-C3 launcher firmware, the browser-based Play
Manager, host tests, build tooling, and the optional creator integration skill.
The first public release is **v1.0.0**.

## What it does

- Stores up to three independent ESP32-C3 plays in fixed application positions.
- Shows the selected play as Cover Art, with adjacent covers visible at both
  sides of the screen.
- Uses `Up` and `Down` to browse and `OK` to launch.
- Returns to the Launcher after a device restart or power cycle without deleting
  the installed play.
- Installs generic compatible plays without requiring a Launcher SDK or source
  change.
- Optionally lets an adapted play return from its existing cover page by holding
  `Up`; the shortcut is intentionally not reserved during gameplay.
- Manages firmware, title, version, source identity, cover preview, image
  conversion, verification, replacement, and erasure in a local browser.

## Install v1.0.0

The recommended path is the hosted [Play Manager](https://cover-arts-launcher.yishan.app/).
Use desktop Chrome or Edge, connect the AI Passport with a data-capable USB
cable, and select the complete-system installation flow.

Download these files from the [v1.0.0 release](https://github.com/yishan/cover-arts-launcher/releases/tag/v1.0.0):

- `FoloToy-AI-Passport-Cover-Arts-Launcher-v1.0.0-full.bin` — complete 8 MiB
  image for flashing from address `0x0`.
- `FoloToy-AI-Passport-Cover-Arts-Launcher-v1.0.0-full.bin.zip` — the same image
  compressed for download and storage; unzip before selecting it in the manager.
- `SHA256SUMS.txt` — published integrity value.
- `THIRD_PARTY_NOTICES.md` — source and license acknowledgements.

Complete-system installation replaces the existing flash layout and erases the
three play positions, covers, and Launcher OTA state. Back up or prepare to
reinstall any play you want to keep. Read the [installation guide](docs/installation.md)
before proceeding.

## Use the play library

1. Open the [Play Manager](https://cover-arts-launcher.yishan.app/) and connect
   the device.
2. Import an official Play URL or select a local compatible `.bin` file.
3. Review the detected title, version, source ID, firmware hash, and cover.
4. Select one of the three positions and install.
5. After the manager sends reset, confirm the new cover on the device.

See the [user guide](docs/user-guide.md) for replacement, erasure, recovery, and
generic-play behavior.

## Optional creator integration

No integration is required for installation or launch. Without integration, a
restart or power cycle returns to the Launcher. Creators who want a faster path
may use the [`ai-passport-cover-arts-launcher`](skills/ai-passport-cover-arts-launcher/SKILL.md)
skill to add `Up Long` only to an existing cover or start page. The public guide
and Agent prompt are available at
[cover-arts-launcher.yishan.app/skills](https://cover-arts-launcher.yishan.app/skills/).

## Develop and verify

Target: ESP32-C3, 8 MiB Flash, no PSRAM, ESP-IDF 5.5.3.

```bash
./tools/validate.sh --static
./tools/validate.sh --firmware
./tools/validate.sh
```

Run the Play Manager locally:

```bash
cd tools/install-slot
npm ci
npm start
```

Then open `http://127.0.0.1:4173` in desktop Chrome or Edge. Build success is
not hardware validation; release candidates must still be checked on a real AI
Passport.

## License and acknowledgements

The repository is released under the [MIT License](LICENSE). It builds on the
FoloToy AI Passport baseline and includes adapted or vendored third-party work
whose notices remain in the repository. See
[Third-party notices](docs/THIRD_PARTY_NOTICES.md) and the
[meta-pass borrowing boundary](docs/reference/meta-pass-borrowing.md).
