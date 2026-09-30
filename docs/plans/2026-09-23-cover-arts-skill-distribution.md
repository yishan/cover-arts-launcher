<p align="right">
  <a href="2026-09-23-cover-arts-skill-distribution.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Cover Arts Launcher Skill Distribution and Agent Prompt Plan

> **For Codex:** Use `executing-plans` to implement this plan task by task only after the distribution decision is approved.

**Goal:** Let a creator copy one prompt that tells an agent where the real Cover Arts Launcher Skill lives, how to install it locally, and what to do when installation is unavailable, while preparing an optional public skills.sh listing.

**Architecture:** Keep `skills/ai-passport-cover-arts-launcher/` as the canonical source. Continue generating the Vercel ZIP and browsable Markdown from that directory. Use the existing ZIP URL as the immediate install source; publish a separate public GitHub repository only if a skills.sh repository page and `owner/repo` install command are desired.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js tests, `npx skills`, GitHub, skills.sh, Vercel.

---

## 1. Confirmed facts and decision boundary

- The current complete package is available at `https://calm.yishan.app/skills/ai-passport-cover-arts-launcher.zip`.
- The canonical English instruction is available at `https://calm.yishan.app/skills/ai-passport-cover-arts-launcher/SKILL.md`.
- The `skills` CLI accepts a direct valid `SKILL.md` or ZIP URL, so installation does not depend on a skills.sh listing.
- skills.sh discovers public GitHub-hosted skills through `npx skills add <owner/repo>` telemetry. There is no separate manual submission step documented for the leaderboard.
- `skills.sh.json` only customizes a public repository page. It is unnecessary for a repository that contains one skill.
- The current remote is the public `FoloToy/ai-passport` repository, but the current GitHub identity has read-only permission. This branch cannot publish the Skill to that repository without an upstream pull request or a maintainer action.

## 2. Options for approval

| Option | User-facing install source | skills.sh listing | Dependency | Recommendation |
| --- | --- | --- | --- | --- |
| A. Direct CALM package | Vercel ZIP URL | Not required | Existing deployment | Implement immediately |
| B. Standalone public repository | `<owner>/<repo>` | Automatic after telemetry processing | User-owned public GitHub repository | Recommended second phase |
| C. Upstream FoloToy repository | `FoloToy/ai-passport` plus skill selection | Automatic after merge and installation | Upstream PR and maintainer approval | Do not block phase A on this |

Recommended sequence: implement A first, then choose B if public discovery is a product goal. Keep the direct ZIP as a fallback after B goes live.

## 3. Proposed copy prompt

The copied prompt should contain the install source before the integration request:

```text
Please install and use the AI Passport Cover Arts Launcher Skill first:

npx skills add https://calm.yishan.app/skills/ai-passport-cover-arts-launcher.zip --skill ai-passport-cover-arts-launcher -y

If the current environment cannot run the skills CLI, read the canonical Skill directly:
https://calm.yishan.app/skills/ai-passport-cover-arts-launcher/SKILL.md

Then use $ai-passport-cover-arts-launcher to add Up Long return only on this play's existing cover/start page. Do not register Up Long globally, do not change gameplay, settings, or other states, and do not create a new cover page when the state cannot be identified reliably. Preserve reboot-to-Launcher compatibility. Installing the Skill does not authorize flashing, commit, push, or publishing.
```

The Chinese page may present this request in Chinese, but URLs, the command, identifiers, and safety boundaries must remain identical. The default command installs to project scope; global installation must remain an explicit user choice.

## 4. Implementation tasks after approval

### Task 1: Lock the direct-install contract with tests

**Files:**

- Modify: `tools/install-slot/test-skill-site.mjs`

1. Add a failing assertion for the full ZIP URL in `integrate-prompt`.
2. Add a failing assertion for the exact `npx skills add` command and `--skill ai-passport-cover-arts-launcher` selection.
3. Assert the canonical `SKILL.md` fallback URL and the existing no-flash/no-commit/no-publish boundary.
4. Run `npm test` under `tools/install-slot/`; expect the new test to fail before the page change.

### Task 2: Update the Agent prompt without changing the protocol

**Files:**

- Modify: `tools/install-slot/skills/index.html`
- Modify only if layout needs it: `tools/install-slot/skills/skills.css`

1. Put the install command and canonical Skill URL at the beginning of `integrate-prompt`.
2. Retain the cover/start-state guard, no global Up Long rule, reboot fallback, and authorization boundary.
3. Add a visible “Skill source” link beside the prompt so a human can inspect the same package before copying it.
4. Do not change the audit prompt, downloadable package, protocol files, manager page, or device management logic.
5. Run `npm test`; expect all web tests to pass.

### Task 3: Verify the direct source with the real CLI

**Files:** none.

1. Run `npx skills add https://calm.yishan.app/skills/ai-passport-cover-arts-launcher.zip --list`; expect exactly `ai-passport-cover-arts-launcher` to be discoverable.
2. In a disposable temporary project directory, run the proposed project-local install command for one supported agent.
3. Verify the installed copy contains `SKILL.md`, `references/protocol.md`, and `assets/launcher_contract/launcher_contract.c`.
4. Remove only the disposable temporary directory after inspection.
5. Treat a successful URL fetch without an installed complete package as a failure.

### Task 4: Browser and production acceptance

**Files:** none.

1. Check `/skills` in a real browser at desktop width and 390 px width.
2. Copy the prompt and confirm the copied text contains the ZIP URL, install command, fallback URL, and safety boundary.
3. Run `./tools/validate.sh --static`, then the repository's complete gate required for delivery.
4. Deploy the existing `tools/install-slot` Vercel project.
5. Read back `/`, `/?mode=play`, `/skills`, the ZIP URL, and canonical `SKILL.md`; all must return HTTP 200.
6. Confirm the root manager still shows task 01 as play management and task 02 as device initialization.

### Task 5: Optional public skills.sh publication

**Files in a new public repository:**

- Create: `SKILL.md`
- Create: `SKILL.zh_CN.md`
- Create: `README.md`
- Create: `README.zh_CN.md`
- Copy: `agents/`, `assets/`, and `references/`
- Add a license only after confirming the intended license is compatible with the current repository source.

1. Approve the GitHub owner, repository name, license, and whether history should be independent or mirrored.
2. Create a public repository owned by an account with write permission. Do not use `FoloToy/ai-passport` unless the upstream PR route is explicitly chosen.
3. Copy from the canonical `skills/ai-passport-cover-arts-launcher/` source; do not copy from the generated Vercel directory.
4. Validate with `npx skills add <owner>/<repo> --list` and a disposable project-local installation.
5. Run one telemetry-enabled install. According to skills.sh documentation, this is what triggers automatic discovery; allow for processing and cache delay.
6. Verify the actual skills.sh repository and skill URLs before adding them to the CALM page.
7. Replace the primary command with `npx skills add <owner>/<repo> --skill ai-passport-cover-arts-launcher -y` only after verification; keep the Vercel ZIP fallback.
8. Do not add `skills.sh.json` unless this repository later hosts multiple skills that need grouping.

## 5. Acceptance criteria

- A copied prompt is self-contained: an agent can install the complete Skill or read the canonical instruction without guessing a path.
- Project-local installation is the default; global installation is never performed silently.
- Installation does not imply permission to flash hardware, commit, push, publish, or open a pull request.
- The package still includes the runtime component and protocol references, not only `SKILL.md`.
- The Cover Arts Launcher protocol remains cover/start-page-only.
- The root manager and all existing download links remain unchanged and available.
- A skills.sh link is shown only after a real public page is observed.

## 6. Decisions required before implementation

1. Approve phase A direct URL installation now?
2. For phase B, use a standalone public repository or pursue an upstream FoloToy pull request?
3. If standalone, what GitHub owner and repository name should be used?
4. Should the copied command remain project-local by default, as recommended, or request global installation with `-g`?
