#!/usr/bin/env python3
"""Install curated repository, backnotprop/pstack, and emilkowalski/skills skills for Codex."""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


@dataclass(frozen=True)
class ExternalSkillPack:
    name: str
    repo_url: str
    commit_sha: str
    skills_subdir: str
    skill_names: tuple[str, ...]


LOCAL_SKILL_NAMES: tuple[str, ...] = (
    "passport-develop",
    "passport-setup",
    "passport-build",
    "passport-device-test",
    "passport-debug",
    "ai-passport-cover-arts-launcher",
    "linear-feedback-to-pr",
)

EXTERNAL_PACKS: tuple[ExternalSkillPack, ...] = (
    ExternalSkillPack(
        name="backnotprop/pstack",
        repo_url="https://github.com/backnotprop/pstack.git",
        commit_sha="0d2dc00df47d7686c94324cfe9c3444710d9f16d",
        skills_subdir="skills",
        skill_names=(
            "poteto-mode",
            "tdd",
            "blast-radius",
            "interrogate",
            "unslop",
            "principle-fix-root-causes",
            "principle-prove-it-works",
            "principle-laziness-protocol",
            "principle-boundary-discipline",
            "principle-model-the-domain",
            "principle-make-operations-idempotent",
            "principle-test-behavior-not-implementation",
        ),
    ),
    ExternalSkillPack(
        name="emilkowalski/skills",
        repo_url="https://github.com/emilkowalski/skills.git",
        commit_sha="64eb3deb9a5fbfa041faf783e0bc3fd635872e9c",
        skills_subdir="skills",
        skill_names=(
            "emil-design-eng",
            "ask-emil",
            "break-ui",
            "animate",
            "review-animations",
            "remove-animations",
        ),
    ),
)


def expected_skill_names() -> tuple[str, ...]:
    names: list[str] = list(LOCAL_SKILL_NAMES)
    for pack in EXTERNAL_PACKS:
        names.extend(pack.skill_names)
    return tuple(names)


def validate_pack_pins(packs: tuple[ExternalSkillPack, ...] = EXTERNAL_PACKS) -> list[str]:
    """Ensure every external skill pack is pinned to a full 40-char commit SHA."""
    errors: list[str] = []
    seen: set[str] = set(LOCAL_SKILL_NAMES)
    for pack in packs:
        if not FULL_SHA_RE.fullmatch(pack.commit_sha):
            errors.append(f"{pack.name}: commit_sha must be a 40-char hex SHA, got {pack.commit_sha!r}")
        for skill in pack.skill_names:
            if skill in seen:
                errors.append(f"duplicate skill name across packs: {skill}")
            seen.add(skill)
    return errors


def inspect_destination(dest: Path) -> tuple[list[str], list[str]]:
    """Return (installed, missing) skill names in dest."""
    installed: list[str] = []
    missing: list[str] = []
    for name in expected_skill_names():
        if (dest / name / "SKILL.md").is_file():
            installed.append(name)
        else:
            missing.append(name)
    return installed, missing


def copy_skill_dir(source: Path, destination: Path) -> None:
    if not (source / "SKILL.md").is_file():
        raise FileNotFoundError(f"missing SKILL.md in {source}")
    if destination.exists() or destination.is_symlink():
        if destination.is_symlink() or destination.is_file():
            destination.unlink()
        else:
            shutil.rmtree(destination)
    shutil.copytree(source, destination)


def install_local_skills(dest: Path, *, repo_root: Path = ROOT, dry_run: bool = False) -> list[str]:
    installed: list[str] = []
    for name in LOCAL_SKILL_NAMES:
        source = repo_root / "skills" / name
        if not (source / "SKILL.md").is_file():
            raise FileNotFoundError(f"missing local skill source: {source / 'SKILL.md'}")
        if not dry_run:
            copy_skill_dir(source, dest / name)
        installed.append(name)
    return installed


def fetch_pinned_repo(repo_url: str, commit_sha: str, checkout_dir: Path) -> None:
    subprocess.run(["git", "init", "-q", str(checkout_dir)], check=True)
    subprocess.run(
        ["git", "-C", str(checkout_dir), "remote", "add", "origin", repo_url],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(checkout_dir), "fetch", "--depth", "1", "origin", commit_sha],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(checkout_dir), "checkout", "-q", "--detach", "FETCH_HEAD"],
        check=True,
    )


def install_external_pack_multi(
    pack: ExternalSkillPack, destinations: list[Path], *, dry_run: bool = False
) -> list[str]:
    if dry_run:
        return list(pack.skill_names)
    with tempfile.TemporaryDirectory(prefix="feedback-skill-pack-") as tmp:
        checkout_dir = Path(tmp) / "repo"
        fetch_pinned_repo(pack.repo_url, pack.commit_sha, checkout_dir)
        installed: list[str] = []
        for name in pack.skill_names:
            source = checkout_dir / pack.skills_subdir / name
            for dest in destinations:
                copy_skill_dir(source, dest / name)
            installed.append(name)
        return installed


def install_external_pack(pack: ExternalSkillPack, dest: Path, *, dry_run: bool = False) -> list[str]:
    return install_external_pack_multi(pack, [dest], dry_run=dry_run)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dest",
        type=Path,
        action="append",
        default=None,
        help="Destination directory (repeatable; default: ~/.agents/skills)",
    )
    parser.add_argument(
        "--all-harnesses",
        action="store_true",
        help="Install into both ~/.agents/skills (Codex) and ~/.claude/skills (Claude Code)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify all curated skills are installed in destination(s) without modifying files",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate pins and print planned installs without cloning or copying",
    )
    parser.add_argument(
        "--local-only",
        action="store_true",
        help="Install only repository-local skills (skip external GitHub packs)",
    )
    args = parser.parse_args(argv)

    pin_errors = validate_pack_pins()
    if pin_errors:
        for err in pin_errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1

    if args.all_harnesses:
        destinations = [
            Path.home() / ".agents" / "skills",
            Path.home() / ".claude" / "skills",
        ]
    elif args.dest:
        destinations = args.dest
    else:
        destinations = [Path.home() / ".agents" / "skills"]

    if args.check:
        rc = 0
        for dest in destinations:
            installed, missing = inspect_destination(dest)
            print(f"Destination: {dest}")
            print(
                f"Installed ({len(installed)}/{len(expected_skill_names())}): "
                f"{', '.join(installed) or 'none'}"
            )
            if missing:
                print(f"Missing ({len(missing)}): {', '.join(missing)}", file=sys.stderr)
                rc = 1
        return rc

    if not args.dry_run:
        for dest in destinations:
            dest.mkdir(parents=True, exist_ok=True)

    action = "Would install" if args.dry_run else "Installed"
    dest_summary = ", ".join(str(d) for d in destinations)
    for dest in destinations:
        local = install_local_skills(dest, dry_run=args.dry_run)
    print(f"{action} local skills ({len(local)}) into [{dest_summary}]: {', '.join(local)}")

    if not args.local_only:
        for pack in EXTERNAL_PACKS:
            names = install_external_pack_multi(pack, destinations, dry_run=args.dry_run)
            print(
                f"{action} {pack.name}@{pack.commit_sha[:12]} ({len(names)}) "
                f"into [{dest_summary}]: {', '.join(names)}"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
