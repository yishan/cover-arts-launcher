<p align="right">
  <a href="README.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Play Manager

Play Manager is the local browser tool for installing the multi-play Launcher
and then managing its three play positions. Its functional interface is an
engineering preview. The device already uses the graphical Cover Art selector.

## Run locally

Use desktop Chrome or Edge. Web Serial requires a secure context; the supplied
loopback server qualifies and also provides a narrowly scoped proxy for public
Play metadata and assets from `ai-passport.folotoy.cn`.

```bash
cd tools/install-slot
npm ci
npm start
```

Open `http://127.0.0.1:4173`. The tool and vendored browser dependencies run
locally. The proxy accepts only official Play detail/API URLs and official
`/api/` firmware or image resources; it is not a general-purpose proxy.

## Complete-system installation

The complete-system path is a one-time migration. Before enabling installation
it reads the connected chip, Flash size, and partition-table sector. It accepts
only an ESP32-C3 with 8 MiB Flash and either the known legacy single-factory
layout or the exact Launcher layout. Any unknown partition or invalid
partition-table MD5 fails closed.

Select the published complete merged image and enter its published SHA-256.
The installer validates the published SHA, embedded Launcher partition table,
and factory-app checksum/appended SHA, then
explicitly erases all three OTA positions, all six cover banks, and `otadata`.
It writes only the bootloader, partition table, and exact factory Launcher app,
reads each segment back, samples both ends of every erased range, confirms blank
OTA metadata, and confirms three blank play boot headers. It finally sends a
reset request; the user still confirms the resulting Launcher display on-device.

This flow does not resume. After cable or power interruption, reconnect in ROM
download mode and restart the complete-system installation from its warning
step. Success offers installing the first play and finishing with an empty
library as equal outcomes.

## Play-position installation

A play can come from an official Play detail/API URL or a local `.bin`. The
official path obtains `downloadUrl`, `firmwareSha256`, identity, title, version,
and cover metadata from the public API and verifies the downloaded file before
extracting it. It records official identity as `play:<projectId>`, preferring
Chinese title text and `shareVersion` when available. For a local file, an optional expected SHA can be supplied; the
computed source SHA is authoritative when it is omitted.

Both app-only ESP32-C3 images and merged images are accepted. Merged input must
have a valid partition-table MD5 and a factory app. Before the selected position
is erased, the extracted app must fit the complete 2 MiB OTA position and pass
segment-boundary, checksum, and appended-SHA validation. Its displayed SHA is
bound into the cover manifest. On connection, inventory revalidates the installed
app and accepts title/cover metadata only when app SHA, manifest, and payload CRC
all match.

Plays do not need a Launcher SDK or health-confirmation callback. Each launch
uses a one-shot OTA boot: reset or power-cycle returns to the Launcher, and the
verified play remains installed with the same title and cover so it can be
launched again. An optional integration is only needed for an in-app return
action.

Creators who want the optional shortcut can use the
[`ai-passport-cover-arts-launcher`](../../skills/ai-passport-cover-arts-launcher/SKILL.md)
skill. It integrates Up Long only on the play's existing cover/start page and
does not reserve that input during gameplay, settings, or other states. The
public guide, Agent prompt, and downloadable skill are published at
`https://cover-arts-launcher.yishan.app/skills/`.

Target recommendation order is the same `source_id`, the first empty position,
then explicit manual replacement. A play operation erases and writes only the
chosen OTA position. The official cover or a user-selected PNG, JPEG, or WebP
is center-cropped and previewed at 120×160. The preview is encoded locally in
the browser at no more than 50 KiB; no image is uploaded to a third party. Its
fixed 38,400-byte RGB565 device payload is then generated; the inactive 64 KiB cover bank is erased, its payload is
verified, and its manifest is committed last. It never writes NVS, PHY, the
factory Launcher, or the partition table.

After an app write or verification failure, the installer erases the boot header
and reads it back. It calls the position unbootable only after that readback;
failed cleanup is reported as an unknown state that requires a reconnect and
rescan. A cover-only failure leaves the verified app bootable and offers both a
cover-only retry and finishing with a placeholder plus reset. The browser reports
verified Flash data and a sent reset request separately from on-device display
confirmation.

After app readback verification, every new install commits a double-bank trust
receipt bound to the selected position, exact app length, and app SHA-256. A
legacy SHA-bound cover can act as a migration receipt. Existing generic plays
with neither remain launchable in compatibility mode but are not labelled
`verified resident`.

The current receipt also stores the first installation time and the most recent
installation/update time supplied by the browser, including its UTC offset. An
update of the same stable play identity preserves the first time and refreshes
the most recent time. Older receipts remain valid and appear as `No record`
until that play is installed or updated again. Metadata/cover-only repair does
not create a false installation timestamp.

The Launcher stores a per-play launch count in its own NVS immediately before
switching to the selected app. Replacing a position with a different identity
starts that position's displayed count at zero. A statistics write failure is
logged but never blocks a verified play from launching.

Before any write, the title field checks UTF-8 length and character coverage
against the Launcher's exact font inventory. Unsupported glyphs are shown with
their Unicode code points and block installation, avoiding placeholder boxes on
the device.

After selecting and explicitly confirming a position, **Erase selected
position** erases that position's complete 2 MiB app region, both 64 KiB
cover banks, and both 4 KiB trust banks, then samples both ends of each range. It does not erase the
Launcher, NVS, PHY data, the partition table, or either other position.

## Validation and provenance

```bash
npm test
```

The ESP image and partition parser is substantially adapted from `meta-pass`
commit `994caaf52357d97323bffb82b2db9cc784afb1eb`. Its MIT notice is preserved in
`extract-app-image.js` and `LICENSE.meta-pass.txt`. The active Web Serial runtime
is the official `esptool-js` 0.6.1 `bundle.js`, pinned exactly in the lockfile and
vendored as `vendor/esptool-js-0.6.1.js`; its Apache-2.0 notice is preserved as
`vendor/LICENSE.esptool-js.txt`. Regenerate both files with
`npm run vendor:esptool`. The previous 0.5.6 runtime and support files remain only
as a temporary rollback path and are not imported by the application. Local
tests define this project's partition, size, manifest, write-scope, runtime
version, and recovery contracts.

Host tests do not replace device acceptance. Before the Web Serial gate is
complete, test a successful complete install, cable/power interruption during
erase and each write stage, app-only and merged play installs, app failure,
cover failure, and cover-only retry on the target board.
