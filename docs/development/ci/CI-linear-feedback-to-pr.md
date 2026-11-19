<p align="right">
  <a href="CI-linear-feedback-to-pr.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# CI: Linear Feedback to Draft PR

[`.github/workflows/linear-feedback-to-pr.yml`](../../../.github/workflows/linear-feedback-to-pr.yml)
automates turning user feedback issues from the Linear `SAAN` team's
`CoverArts Launcher` project into validated **Draft PRs** against
`yishan/cover-arts-launcher`.

## How it works

1. **Select (`select-issue`)**: Polls Linear every 30 minutes (or runs on demand
   via `workflow_dispatch`) for open issues in team `SAAN`, project
   `CoverArts Launcher`, carrying the opt-in label `auto-pr` and not yet labeled
   `pr-opened` or linked to an open `feedback/<issue-id>` PR.
2. **Solve (`solve-issue`)**: Runs in a read-only GitHub permissions job
   (`contents: read`, without `LINEAR_API_KEY`). It installs SHA-pinned skills
   into `~/.agents/skills/` via
   [`tools/install_feedback_skills.py`](../../../tools/install_feedback_skills.py),
   runs OpenAI Codex CLI via `openai/codex-action` (`permission-profile: ":workspace"`,
   `safety-strategy: drop-sudo`), validates with `./tools/validate.sh --static`,
   and uploads the patch and structured result JSON.
3. **Publish (`publish-draft-pr`)**: Runs in a separate job without
   `OPENAI_API_KEY`, applies the patch to `feedback/<issue-id>`, re-runs
   `./tools/validate.sh --static`, opens or updates a **Draft PR**, and posts an
   idempotent comment (plus the `pr-opened` label) back to the Linear issue. If
   Codex reports `needs_clarification`, no PR is opened and clarification
   questions are posted on the Linear issue instead.

## Curated skills installed automatically

| Source | Installed skills | Role in the workflow |
| --- | --- | --- |
| Repository (`skills/`) | `linear-feedback-to-pr`, `passport-develop`, `passport-setup`, `passport-build`, `passport-device-test`, `passport-debug`, `ai-passport-cover-arts-launcher` | ESP32-C3 / LVGL rules, cover-page return scope, and repo validation policy |
| `backnotprop/pstack` (SHA-pinned) | `poteto-mode`, `tdd`, `blast-radius`, `interrogate`, `unslop`, `principle-fix-root-causes`, `principle-prove-it-works`, `principle-laziness-protocol`, `principle-boundary-discipline`, `principle-model-the-domain`, `principle-make-operations-idempotent`, `principle-test-behavior-not-implementation` | Root-cause analysis, test-first bug fixes, blast-radius/adversarial self-review, minimal diffs, and concise PR writing |
| `emilkowalski/skills` (SHA-pinned) | `emil-design-eng`, `ask-emil`, `break-ui`, `animate`, `review-animations`, `remove-animations` | Play Manager (`tools/install-slot/`) UI craft, responsive interactions, purposeful motion, and worst-case data resilience |

## Required repository setup

### 1. GitHub Actions secrets

Configure under **Settings -> Secrets and variables -> Actions -> Secrets**:

- `LINEAR_API_KEY` (required): Linear personal API key or OAuth token with read/write access to `SAAN` issues and comments.
- `OPENAI_API_KEY` (required): OpenAI API key used by `openai/codex-action` behind its local Responses API proxy.
- `PR_WORKFLOW_TOKEN` (optional): Fine-grained PAT or GitHub App token with `contents: write` and `pull-requests: write`. When set, Draft PRs created by this workflow automatically trigger `Static checks` and `Firmware checks` (GitHub suppresses `pull_request` workflows triggered by the default `GITHUB_TOKEN`).

### 2. GitHub Actions permissions

Enable **Settings -> Actions -> General -> Workflow permissions -> Allow GitHub Actions to create and approve pull requests**.

### 3. Optional repository variables

Configure under **Settings -> Secrets and variables -> Actions -> Variables** if
you want to override the defaults:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LINEAR_TEAM_KEY` | `SAAN` | Linear team key |
| `LINEAR_PROJECT_NAME` | `CoverArts Launcher` | Linear project name |
| `LINEAR_AUTO_LABEL` | `auto-pr` | Opt-in label required for automatic pickup |
| `LINEAR_PROCESSED_LABEL` | `pr-opened` | Label added once a Draft PR is created |
| `LINEAR_TARGET_STATE` | *(empty)* | Optional Linear workflow state name to transition to (for example `In Review`) |
| `CODEX_MODEL` | *(action default)* | Optional OpenAI Codex model override |
| `CODEX_EFFORT` | *(action default)* | Optional reasoning effort override |

## Manual runs (CI or local)

- **GitHub Actions**: Run **Actions -> Linear feedback to Draft PR -> Run workflow**
  with an optional `issue_id` (such as `SAAN-42`) and `dry_run: true` to verify
  end-to-end before enabling branch pushes.
- **Local agent session**: Use [`$linear-feedback-to-pr`](../../../skills/linear-feedback-to-pr/SKILL.md)
  after running `python3 tools/install_feedback_skills.py`.

## Safety boundaries

- Generated PRs are always opened as **Draft PRs** and never auto-merged.
- Build and host tests do not replace real-device testing on a FoloToy AI Passport
  or Web Serial testing in desktop Chrome/Edge.
- Workflow runs are restricted to `yishan/cover-arts-launcher` and never publish
  to `folotoy/ai-passport`.
