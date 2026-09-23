<p align="right">
  <a href="CHANGELOG.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Changelog

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
