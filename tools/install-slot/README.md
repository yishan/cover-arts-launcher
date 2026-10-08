<p align="right">
  <a href="README.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Play Manager

Play Manager is the browser tool for installing the multi-play Launcher and
managing its runtime-discovered play library. Each play uses only its verified
image length rounded to 64 KiB plus one 64 KiB DPS1 sidecar; the manager does
not pre-reserve three fixed 2 MiB positions.

## Run locally

The updated manager recognizes both published v1.5.0 dynamic partitions and
the v1.6.0 compact candidate. It uses the actual Factory end for allocation and
keeps the detected layout when committing an installation or deletion. Compact
initialization releases 512 KiB but removes existing plays/covers; a Factory-only
update does not change capacity. Read the
[compact migration guide](../../docs/plans/2026-10-08-compact-launcher-layout.md)
before initializing a device. Deploy this manager before distributing compact
firmware; the older fixed-boundary manager cannot recognize that layout.

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

## Deploy to Vercel

Deploy this directory as the Vercel project root. `index.html` and the vendored
browser runtime are served as static files. `/api/play` and `/api/resource` are
Vercel Functions with the same allowlist as the loopback server: they accept
only official AI Passport Play URLs and official `/api/` resources, reject
cross-origin redirects, and never act as a general-purpose proxy.

The deployed page must be opened over HTTPS in desktop Chrome or Edge for Web
Serial. Vercel provides HTTPS automatically. Preview deployments should be
tested with an official Play URL and a real-device connection before promotion
to a production domain.

## Deploy to Cloudflare Pages alongside Vercel

The Vercel deployment and `https://calm.yishan.app/` can remain the production
site while Cloudflare Pages publishes the same source at its default
`https://cover-arts-launcher.pages.dev/` hostname or another domain. The two
targets share the allowlist and upstream validation in
`lib/official-proxy-core.js`; `api/` contains the Vercel adapter and
`functions/` contains the Cloudflare Pages Functions adapter.

Build and test the Cloudflare output locally:

```bash
npm ci
npm run build:cloudflare
npm run dev:cloudflare
```

The build copies an explicit public-file allowlist into `dist/`, generates the
Pages `_headers`, `_redirects`, and `_routes.json` files, and leaves tests and
server source out of the published assets. To deploy from an authenticated
machine:

```bash
npx wrangler whoami
npm run deploy:cloudflare
```

Keep the Pages project on its generated hostname until its API routes, Skill
downloads, Web Serial connection, and real-device operations have been
validated. This parallel deployment does not change the Vercel production
domain or its redirects. The current Cloudflare project uses Direct Upload;
running `npm run deploy:cloudflare` from `main` updates the fixed production
hostname, while other branches create preview deployments. A CI service can run
the same command with a scoped Cloudflare API token. Cloudflare cannot convert a
Direct Upload project to native Git integration later; if native Git builds are
preferred, create a separate Pages project with this directory as its root,
`npm ci && npm run build:cloudflare` as its build command, and `dist` as its
output directory.

## Complete-system installation

The complete-system path is a one-time migration. Before enabling installation
it reads the connected chip, Flash size, and partition-table sector. It accepts
only an ESP32-C3 with 8 MiB Flash and either the known legacy single-factory
layout, the fixed three-position Launcher layout, or a valid dynamic Launcher
layout. Any unknown partition or invalid
partition-table MD5 fails closed.

Select the published complete merged image and enter its published SHA-256.
The installer validates the SHA and embedded Launcher partition table, then
explicitly erases the dynamic play arena and `otadata`.
It writes only the bootloader, partition table, and exact factory Launcher app,
reads each segment back, samples both ends of every erased range, confirms blank
OTA metadata, and confirms an empty dynamic library.

This flow does not resume. After cable or power interruption, reconnect in ROM
download mode and restart the complete-system installation from its warning
step. Success offers installing the first play and finishing with an empty
library as equal outcomes.

## Dynamic play installation

A play can come from an official Play detail/API URL or a local `.bin`. The
official path obtains `downloadUrl`, `firmwareSha256`, identity, title, version,
and cover metadata from the public API and verifies the downloaded file before
extracting it. It records official identity as `play:<projectId>`, preferring
Chinese title text and `shareVersion` when available. For a local file, an optional expected SHA can be supplied; the
computed source SHA is authoritative when it is omitted.

Both app-only ESP32-C3 images and merged images are accepted. Merged input must
have a valid partition-table MD5 and a factory app. The extracted app may use
the available play arena up to its capacity. Its displayed SHA is bound into
the DPS1 sidecar record.

Plays do not need a Launcher SDK or health-confirmation callback. Each launch
uses a one-shot OTA boot: reset or power-cycle returns to the Launcher, and the
verified play remains installed with the same title and cover so it can be
launched again. An optional integration is only needed for an in-app return
action.

The manager reads the partition table at runtime and appends each new play to
the logical library. It uses the smallest released physical range that fits,
falling back to the free tail. It erases and writes the selected allocation, reads
the complete app back, and verifies its SHA before touching the directory. The
official cover or a user-selected PNG, JPEG, or WebP is center-cropped and
previewed at 120×160. The preview is encoded locally in the browser at no more
than 50 KiB; no image is uploaded to a third party.

The fixed 38,400-byte RGB565 payload and DPS1 record carry the title, version,
Source ID, app length and SHA, first/last install time, and cover CRC. After app
and sidecar readback pass, the manager commits a new MD5-protected partition
table, clears `otadata`, and rescans the library while keeping the download
session connected. The user can append more plays without reconnecting; only
the explicit **Finish and restart** action exits download mode, boots the
Launcher, and closes the browser serial connection. Launcher launch statistics
remain in NVS and start at zero when no counter exists.

Any failure before the final partition-table commit leaves the previous library
intact and the unreachable partial bytes unbootable. If the table write itself
is interrupted, the manager warns that a complete-system reinstall may be
needed. If the table was written and only post-write verification was
interrupted, reconnecting and rescanning comes first; reinstall is suggested
only when the dynamic library can no longer be recognized. The manager also
serializes Web Serial writes and releases every writer in a `finally` block so
an exceptional write cannot leave the stream locked.

Flash readback uses preallocated result buffers and a single in-flight 4 KiB
Stub packet, with a cumulative acknowledgement after every packet. It consumes
serial input through an event-driven chunk queue and decodes SLIP into a
growable packet buffer, avoiding 1 ms polling and per-byte concatenation.
Queued input is capped at 1 MiB and a decoded packet at 64 KiB. Packet reads
have one absolute deadline; closed/corrupted streams fail rather than returning
partial data. Disconnect cancels the reader and releases its lock before a new
session starts. It consumes
the final 16-byte MD5 frame before sending another command; app SHA and the
existing metadata/cover checks remain required before directory commit. The
log separates erase, write, full readback, verification, and commit timings.
Writes, cover/metadata reads, and directory operations remain at 115200 baud.
Only complete App readback and its SHA/structure verification use 230400 baud;
cover repair uses the same temporary rate for its App SHA check. The manager
passes the actual previous rate to the Stub, reopens the protected serial
streams, and checks a 32-byte partition header before/after both transitions.
It confirms restoration to 115200 before any sidecar or directory write. Rate
switch/restore failures close the invalid session; a failed App read does not
send a restore command through a desynchronized Stub. Native read-only tests
showed about 109 s versus 56 s on the same 1,238,288-byte App; browser installation
speed and continuous-install reliability still require real-device acceptance.
If a read or acknowledgement fails, the manager closes the invalid serial
session without resetting or erasing the device. Prepared firmware and cover
remain available for reconnect-and-retry. This manager-only change does not
require reflashing the Launcher. Reload the page after ending the old connection
to load the new readback implementation; real-device acceptance remains required.

Any logical position can be removed. Before committing the new directory, the
manager rewrites the inactive DPS1 bank of each following play with its new
logical position. It then commits the renumbered partition table, clears
`otadata`, rescans every retained identity, and erases the removed allocation.
Application bytes are not moved. Launcher launch counts follow the stable
Source ID or firmware SHA instead of the old position key. Released holes are
reused automatically; physical compaction remains a separate future operation
when total free space is sufficient but no single hole fits.

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
complete, test a successful complete install, an empty-library first append,
multiple app sizes, cable/power interruption before and during directory commit,
app-only and merged play installs, sidecar failure, first/middle/final removal,
logical reflow, hole reuse, launch-count retention,
and post-reset Launcher rendering on the target board.
