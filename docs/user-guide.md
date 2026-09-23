<p align="right">
  <a href="user-guide.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Cover Arts Launcher user guide

## On-device controls

- `Up` / `Down`: move between the three positions.
- `OK`: launch the centered play.
- Empty position: remains selectable and does not launch an application.
- Restart or power cycle: return to the Launcher while retaining verified plays.
- Adapted play only: hold `Up` on that play's existing cover or start page to
  return directly. This shortcut is not required and should not affect gameplay.

## Install a play

The Play Manager accepts an official Play detail URL or a local `.bin`. For an
official URL, it retrieves the available title, version, Source ID, firmware
hash, and cover. For a local file, review the detected firmware and provide the
display metadata yourself.

Before writing, the manager previews and locally converts the cover, validates
the ESP32-C3 image, checks that it fits the selected 2 MiB position, and checks
title glyph coverage. It then writes only the selected application position and
its metadata. Other positions remain unchanged.

After installation, distinguish these two states:

1. The browser verified Flash and sent a reset request.
2. You observed the new cover and launched the play on the device.

Only the second state is physical-device confirmation.

## Replace or erase a position

Selecting an occupied position and installing another play replaces only that
position after explicit confirmation. **Erase selected position** removes that
position's app, cover banks, and trust receipts; it does not erase the Launcher,
NVS, PHY data, or either other position.

## Generic plays and optional return support

Compatible generic plays can be installed and launched without source changes.
They remain installed after use. If a play does not implement the optional
cover-page return protocol, restart or power-cycle the device to return to the
Launcher.

Creators can use the [compatibility skill](../skills/ai-passport-cover-arts-launcher/SKILL.md).
It must not add a global `Up Long` handler or change input inside gameplay,
settings, or unrelated screens.

## Common recovery actions

- **Browser disconnected:** reconnect and rescan before deciding the installed
  state. Do not trust a stale browser message.
- **Play write failed:** retry the app installation after the manager confirms
  that the position is unbootable or after an explicit erase.
- **Cover write failed:** retry the cover only, or finish with the placeholder
  when the manager offers that recovery path.
- **Reset was sent but the display did not change:** reconnect, rescan, and then
  restart the device manually. The browser reset request and observed display
  are reported separately.
- **Wrong title or cover:** rescan first. Metadata is accepted only when it is
  bound to the installed application hash and passes its own integrity checks.
