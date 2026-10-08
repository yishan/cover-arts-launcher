<p align="right">
  <a href="CI-build-and-release.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Automated Build and Release

The only Launcher publication repository is `yishan/cover-arts-launcher`.
Follow the [release SOP](../release/launcher-release-sop.md) for the full local
and GitHub sequence. This page describes
`.github/workflows/build-firmware.yml`.

## Triggers and destination

Tag pushes trigger a build and Release. Manual `workflow_dispatch` builds
the selected ref; it creates a Release only when the ref is a tag. Ordinary
branch pushes do not trigger firmware builds.

Both jobs are limited to `github.repository == 'yishan/cover-arts-launcher'`.
Before compilation, `tools/release_preflight.py --phase ci` verifies origin,
paired notes, and tag/version consistency. A tag is `vX.Y.Z`, matching
`firmware_version.txt`; the title is `Cover Arts Launcher vX.Y.Z`. This repository
publishes one product, so inherited multi-application tag suffixes do not apply.

## Build and assets

The build job restores ccache and runs `./tools/validate.sh --firmware` in
ESP-IDF 5.5.3 for ESP32-C3. It verifies image segments against `flash_args`,
partition bounds, the 8 MB Flash setting, and the merged image. These checks
do not replace the local static/host gate or device acceptance.

The build uploads five assets; the release job downloads and publishes them:

- `FoloToy-AI-Passport-Cover-Arts-Launcher-vX.Y.Z-full.bin`;
- the same bin in a ZIP;
- `SHA256SUMS.txt` covering bin and ZIP;
- `THIRD_PARTY_NOTICES.md`;
- `THIRD_PARTY_NOTICES.zh_CN.md`.

The complete bin is 8 MiB and is written at `0x0`. ZIP is only for downloads.
ELF, MAP, caches, and debugging archives are not Release assets. All Actions
are pinned to full commit SHAs. The build job has `contents: read`; only the
tag release job has `contents: write`.

## Changelog and notes

Ordinary feature/documentation changes leave paired changelogs unchanged.
Release preparation reviews changes since the previous version and adds only
user-visible behavior, compatibility, and release-flow changes to both
`docs/CHANGELOG.md` and `.zh_CN.md`, retaining a fresh `Unreleased` section.

Prepare `docs/releases/vX.Y.Z.md` and `.zh_CN.md` before tagging. Explain changes,
build/verification, installation, controls, data impact, and acceptance limits.
The workflow reads `docs/releases/${{ github.ref_name }}.md`; notes must
travel in the tagged commit. Link the paired Chinese page where needed.

## Publication verification and flashing

Wait for the existing workflow, inspect the published Release, download its
five assets, and verify checksums, ZIP, and exact bin size. Export this CI bin
for the community even when a local rebuild has a different SHA. A rebuild is
not needed simply to download a published version.

Use the official browser flasher at
`https://ai-passport.folotoy.cn/tools/web-flasher/` with the raw merged bin at
`0x0`. Full-system installation can replace stored data; follow
[installation guidance](../../installation.md). A published artifact or verified
write is not proof of the requested gameplay on hardware.

Related: [community publication](../release/publish-to-community.md),
[completion](../release/project-completion.md).
