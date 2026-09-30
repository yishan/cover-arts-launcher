<p align="right">
  <a href="2026-09-29-arbitrary-delete-hole-reuse.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Arbitrary Delete, Logical Reflow, and Hole Reuse

Status: implemented; host and connected-device validation completed for v1.5.0

## User-visible behavior

- Any installed play can be removed, not only the final one.
- Remaining covers close the logical gap immediately: deleting position 2 turns the former position 3 into position 2.
- Application bytes stay at their existing Flash offsets, so deletion does not spend time copying retained firmware.
- A later installation uses the smallest released range that can hold its aligned app and 64 KiB DPS1 sidecar. If no hole fits, it uses the free tail.
- If total free bytes are sufficient but fragmented, installation stops before erasing and explains that no contiguous range fits. Automatic physical compaction is out of scope.

## Transaction order

1. Validate the complete current library and compute the new contiguous logical identities.
2. For each shifted play, copy its active DPS1 record into the inactive bank with only generation, logical slot ID, and record CRC changed.
3. Commit and read back the new MD5-protected partition table.
4. Clear and verify `otadata`.
5. Rescan every retained play and compare its firmware SHA with the pre-delete inventory.
6. Erase and sample-verify the removed physical allocation.

Before step 3, the old table still selects the old active DPS1 records. After
step 3, the new table selects the newly written records. A failed final erase
does not reintroduce the deleted play; the same range is erased again before it
can be reused by a later installation.

## Persistent statistics

Launch counters remain stored in NVS, but Launcher now searches all bounded
position records for the selected play's stable identity. When it finds the
identity under an old logical key, it migrates the counter to the current key
and removes the stale key. Official plays use Source ID identity; local plays
fall back to firmware SHA-256.

## Acceptance

Host tests cover first, middle, and final logical removal; reordered physical
offsets; smallest-fitting-hole allocation; fragmentation rejection; DPS1
identity reassignment; and retained-library rescanning. Connected-device testing
covered the v1.5.0 Launcher startup and Play Manager write path. Deliberate power
loss around the partition-table commit and exhaustive fragmentation cases remain
fault-injection checks rather than routine release acceptance.
