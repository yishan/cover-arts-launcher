<p align="right">
  <a href="user-guide.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Cover Arts Launcher user guide

## Device controls

- `Up` / `Down`: move through installed plays.
- `OK`: launch the centered play.
- `OK Long`: open details; press `OK` in details to return to the library.
- Restart or power cycle: return to the Launcher while keeping verified plays.
- Adapted plays only: hold `Up` on that play's existing cover or start page to
  return directly to the Launcher. This optional shortcut is not reserved during
  gameplay.

The library shows only installed plays. Its position indicator is the current
play over the installed total, not a set of pre-created empty positions.

## Play details

The details view shows the play version, first installation time, latest
installation or update time, and launch count. Older metadata may show no record
until that play is installed or updated again under the dynamic Launcher.

## Install plays

The hosted Play Manager accepts an official Play detail URL or a local `.bin`.
Review the detected title, version, source ID, firmware hash, and cover before
writing. It validates the ESP32-C3 app and checks Chinese title glyph coverage.

v1.5.0 allocates each play from its verified app length plus its sidecar. It
first reuses the smallest released range that fits, then uses tail space. The
absolute maximum is 16 OTA play entries, but available Flash normally limits the
real count first.

Install several plays without selecting the serial port again. After each play,
choose to continue; the manager refreshes its download session while preserving
the browser permission. Finish the session when ready to restart the device once.

After installation, distinguish two states:

1. The browser verified Flash data and requested a restart.
2. The user observed the new cover and successfully launched the play.

Only the second state is on-device confirmation.

## Remove a play

Select any installed play in the maintenance section, review its name and
identity, then confirm removal. Remaining covers close the logical gap without
copying their application bytes. A later install can reuse the released range.

If total free space is sufficient but split into ranges that are all too small,
the manager stops before erasing and reports that no contiguous range fits.
Automatic physical compaction is not included in v1.5.0.

## Generic plays and optional return support

Compatible generic plays require no source change to install or launch. Without
the optional return protocol, restart or power cycle the device to return to the
Launcher. Creators can use the
[compatibility skill](../skills/ai-passport-cover-arts-launcher/SKILL.md) to add
`Up Long` only to an existing cover or start page.

## Recovery

- **Browser disconnects:** reconnect and rescan before judging installation
  state; do not rely on a stale page message.
- **Play write fails:** retry only after the manager confirms the incomplete app
  cannot boot, or use complete installation if the dynamic table was being
  committed.
- **Reset was requested but the screen did not change:** reconnect, rescan, and
  then restart manually.
- **Title or cover is wrong:** rescan first. The Launcher accepts metadata only
  when it matches the installed app identity and passes integrity checks.
