<p align="right">
  <a href="README.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Plans and Design Specifications

- [Compact Launcher Layout](2026-10-08-compact-launcher-layout.md) — recover 512 KiB, recognize both dynamic layouts, and separate destructive initialization from firmware-only updates.

- [Launcher Size Optimization](2026-10-01-launcher-size-optimization.md) — measured code/font reductions, unchanged-layout boundaries, and compact-layout migration considerations.

- [Cover Arts Launcher Skill Distribution and Agent Prompt Plan](2026-09-23-cover-arts-skill-distribution.md) — direct URL installation, optional skills.sh publication, prompt changes, and acceptance gates.
- [Multi-Firmware Cover Art Launcher Design Specification](2026-09-21-multi-firmware-cover-art-launcher-design.md) — product model, user journeys, device/browser screens, interaction rules, states, and acceptance criteria.
- [Multi-Firmware Cover Art Launcher Implementation Plan](2026-09-20-multi-firmware-cover-art-launcher.md) — task-by-task engineering sequence, files, tests, and delivery gates.
- [Dynamic Play Storage v0.3 Design](2026-09-25-dynamic-play-storage.md) — variable-size append allocation, per-play sidecars, partition-table transactions, migration boundaries, and phased delivery.
- [Arbitrary Delete, Logical Reflow, and Hole Reuse](2026-09-29-arbitrary-delete-hole-reuse.md) — stable-identity deletion transactions, logical renumbering without moving apps, best-fit reuse, and recovery boundaries.
