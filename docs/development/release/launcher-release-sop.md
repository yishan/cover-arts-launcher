<p align="right">
  <a href="launcher-release-sop.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Cover Arts Launcher Release SOP

Maintained: 2026-10-01. Publish only to `yishan/cover-arts-launcher`.
`folotoy/ai-passport` supplies upstream reference material; it is not a destination
for Launcher commits, tags, Releases, or firmware uploads. This SOP overrides
inherited multi-application release conventions.

## Fixed entry points

| Item | Contract |
| --- | --- |
| GitHub | `https://github.com/yishan/cover-arts-launcher` |
| Publication branch | `main` |
| Version and tag | `X.Y.Z` in `firmware_version.txt`; `vX.Y.Z` tag |
| Release title | `Cover Arts Launcher vX.Y.Z` |
| Notes | `docs/releases/vX.Y.Z.md` and `.zh_CN.md`, prepared before tagging |
| Complete image | `FoloToy-AI-Passport-Cover-Arts-Launcher-vX.Y.Z-full.bin`, 8 MiB at `0x0` |
| Automation | `.github/workflows/build-firmware.yml`; tag push builds and creates the Release |

The persistent local publication checkout is `/Users/yishan/project/cover-arts-launcher`.
It has an independent Git repository, separate from the upstream baseline and
product worktrees. Reuse it; clone the GitHub repository once only if missing.
Do not replace the shared baseline's origin. Product development stays in its
current worktree; preserve existing publication commits and assets.

## Procedure

1. **Preflight once.** In the publication checkout, inspect
   `git status --short --branch` and run `python3 tools/release_preflight.py`.
   The read-only script checks all origin fetch/push URLs, the version, and both
   notes, and reports HEAD. An upstream destination fails immediately. Check
   `gh auth status` once if account verification is needed. Every GitHub command
   explicitly specifies `--repo yishan/cover-arts-launcher`.
2. **Fetch and compare.** Run `git fetch origin main --tags`, inspect divergence
   and changes. If the version tag exists, inspect/resume its Actions or Release;
   do not replace it. Import product changes through a reviewed file list, not
   an upstream tree overwrite. Preserve publication-only changes and exclude
   build output, caches, credentials, and other plays.
3. **Prepare the version.** Align the version file, README, installation guide,
   paired release notes, and release changelog. Keep historical notes unchanged.
   Explain user-visible behavior, upgrade data impact, and unverified items.
4. **Validate once for the change.** For firmware releases, run
   `./tools/validate.sh` once, or run `--static` and `--firmware` once each.
   Both passing constitute the complete gate; do not run it again for unchanged
   inputs. Verify the content-addressed archive with
   `python3 tools/archive_firmware.py verify build/firmware/<sha256>`.
   Documentation/SOP/preflight/CI-only changes require `--static`, not a firmware
   rebuild or a device flash.
5. **Commit and push main.** Check `git diff --check` and staged changes, commit
   under the current task's authorization, then `git push origin main`. This
   procedure does not grant publication authority; once authorized, do not ask
   repeatedly for the same action. Run
   `python3 tools/release_preflight.py --phase ready` to require clean main, HEAD
   matching the synchronized `origin/main`, and an absent local version tag.
6. **Push one tag.** Create annotated tag `vX.Y.Z`, then
   `git push origin vX.Y.Z`. Locate its run using
   `gh run list --repo yishan/cover-arts-launcher --workflow build-firmware.yml`.
   Wait with `gh run watch <run-id> --repo yishan/cover-arts-launcher --exit-status`.
   During normal compilation, wait for that run; do not dispatch another build,
   push the tag again, or create a parallel manual Release.
7. **Verify published assets.** After success, use
   `gh release view vX.Y.Z --repo yishan/cover-arts-launcher` to verify published,
   non-prerelease state, title, notes, tag commit, and five assets: bin, ZIP,
   SHA256SUMS, and paired third-party notices. Download into a new directory,
   run `shasum -a 256 -c SHA256SUMS.txt` and `unzip -t <zip>`, and confirm the bin
   contains 8,388,608 bytes.
8. **Use one community artifact.** Export the downloaded, verified Release bin,
   ZIP, and checksums byte-for-byte. The local handoff directory is
   `/Users/yishan/project/ai-passport/build/releases/vX.Y.Z/`. Exporting for the
   community is not submitting to it; upload only when requested.
9. **Handoff.** Report the Release URL, local bin, final SHA-256, commit/tag, and
   separate Build, Host tests, Device tests, and Unverified results. Identify the
   actual device-tested artifact and evidence; CI success is not device testing.

## Avoid repeated attempts

| Condition | Response |
| --- | --- |
| origin targets upstream | Switch to the publication checkout; do not push upstream or change shared origin |
| Static and firmware checks passed separately | Proceed; no extra complete gate for the same inputs |
| Only documentation changes afterwards | Repeat relevant documentation/static checks, not firmware compilation |
| Local and CI bin SHA differ | Build metadata, paths, or tools may differ. Do not claim equality or blindly rebuild for equal SHA. Verify CI layout and downloaded checksums; use CI assets for community distribution |
| Sandbox/network failure | Identify the environment cause; escalate the original operation once through platform permissions without weakening checks or changing the toolchain |
| Actions still progressing normally | Wait for the existing run |
| Actions failed | Read failed logs and repair the specific cause. Rerun failed jobs for transient same-commit failures; source fixes use a new commit. Do not force-change a published version tag |
| Release exists; export only | Download and verify assets; no rebuild, retag, or republish |
| ZIP is much smaller than bin | Upload raw bin as firmware; ZIP is a download convenience, not a renamed bin |

## v1.5.0 evidence

The 2026-10-01 publication targeted `yishan/cover-arts-launcher`, commit
`03a3049`, run `36743219529`. The locally built bin SHA-256 was
`6fd15048acafec1c92f37fa60385d805c9f7937487c485f89ba68a1ae9ea8581`;
the official CI asset SHA-256 was
`83eeff7b594a270b8ef99a245f7b107306aa3e56d0e6414fc0ebeba443683c9d`.
These binaries differ. The final community export uses the CI asset and passed
its checksums. Nothing was pushed upstream. Improvements concern destination
discovery, inherited tag documentation, repeated confirmation, and unnecessary
checks; changing this procedure does not require republishing v1.5.0.

Related: [CI guide](../ci/CI-build-and-release.md),
[community publication](publish-to-community.md).
