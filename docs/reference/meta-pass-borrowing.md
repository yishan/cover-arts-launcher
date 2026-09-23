<p align="right">
  <a href="meta-pass-borrowing.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# meta-pass Borrowing Boundary

This record defines what the multi-firmware Launcher may borrow from the
community `meta-pass` project and what remains an AI Passport-specific design.
It is an attribution and review ledger, not a moving source dependency.

## Pinned upstream

- Repository: <https://github.com/alexwwang/meta-pass>
- Pinned commit: `994caaf52357d97323bffb82b2db9cc784afb1eb`
- License: MIT; the preserved upstream text is in
  [`tools/install-slot/LICENSE.meta-pass.txt`](../../tools/install-slot/LICENSE.meta-pass.txt).

Review and adaptation must use the pinned commit. A later upstream revision is
not incorporated until its source, behavior, tests, and license are reviewed
and this record is updated.

## Borrowing ledger

| Local area | Pinned upstream reference | Treatment |
| --- | --- | --- |
| `tools/install-slot/extract-app-image.js` | `tools/install-slot/extract-app-image.js` | Substantially adapted with the MIT notice preserved; local code adds partition-table MD5 validation and uses a full 2 MiB app position with no slot-tail metadata. |
| Browser Web Serial installation flow and `vendor/` runtime | `tools/install-slot/` | The esptool-js browser runtime is copied from the pinned source. Local state machines, exact write scopes, readback verification, cover A/B behavior, and recovery rules are independently tested against the AI Passport layout. |
| Trial boot and rollback policy | `main/meta_slots.c`, `main/metapass_hook.h` | Reimplement against ESP-IDF 5.5.3 APIs and the local factory/OTA contract; do not copy layout constants. |
| Merged-image validation | `main/meta_image.c` and installer parser/tests | Reuse the validated parsing sequence only after local bad-MD5, truncation, wrong-chip, size, and missing-image tests exist. |

The copied runtime and substantially adapted parser remain covered by the
preserved MIT license. They are pinned source material rather than a moving
package dependency.

## Explicitly not inherited

- The upstream partition table, including its project-specific `cardid`
  partition and address.
- Its 4 KiB/8 KiB slot-tail convention and 32-byte ASCII display-name blob.
- Its text-list user interface and visual styling.
- Its build, simulator, or host-test results as proof of behavior on AI
  Passport hardware.
- SoftAP installation in the MVP; Web Serial is the first installation path.

The local product instead uses a reviewed 8 MB layout, three fixed 2 MiB
application positions, a separate A/B `covers` partition, SHA-bound cover
metadata, and a Cover Art selector. All device behavior remains subject to the
AI Passport build and hardware acceptance gates.
