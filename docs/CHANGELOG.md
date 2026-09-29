<p align="right">
  <a href="CHANGELOG.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Changelog

## v1.3.1 — 2026-09-29

- Replaced the fixed three-position layout with dynamic play storage allocated
  from each verified firmware image's actual size.
- Changed the Cover Art library to show only installed plays and added a compact
  details view with version, install history, and launch count.
- Improved Chinese labels and play-title support, cover layout, bottom hints,
  metadata recognition, and launch-time verification.
- Preserved generic-play compatibility: restart or power cycle returns to the
  Launcher, while adapted cover pages may optionally support `Up Long`.
- Added a migration warning: the first complete v1.3.1 installation replaces the
  old Flash layout, clears older installed plays, and requires adding them again.
- Kept this first dynamic-storage release append-only; arbitrary middle deletion
  and automatic physical compaction remain future work.

## v1.0.0 — 2026-09-24

- Released the factory Cover Art launcher with three fixed 2 MiB play positions
  for the ESP32-C3 8 MiB AI Passport.
- Added cover-first on-device navigation, empty-position support, Chinese play
  titles, adjacent-card previews, and verified one-shot play launching.
- Added restart and power-cycle return compatibility for generic plays, plus an
  optional `Up Long` return protocol scoped to a play's existing cover page.
- Added the browser Play Manager for complete-system migration, official Play URL
  import, local firmware import, cover preview and conversion, title/glyph
  checks, verified writes, replacement, erasure, reset, and recovery.
- Added app/cover SHA binding, double-bank metadata and trust receipts, scoped
  cleanup after failure, and inventory validation after reconnect.
- Added public installation, user, creator-skill, provenance, build, and release
  documentation under the MIT License.
