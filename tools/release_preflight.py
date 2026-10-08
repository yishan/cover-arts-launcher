#!/usr/bin/env python3
"""Read-only release checks for the Cover Arts Launcher publication repository."""

import argparse
import json
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

REPOSITORY = "yishan/cover-arts-launcher"


def repository_identity(url: str) -> str:
    """Accept GitHub HTTPS/SSH URLs, never a different host or repository."""
    if url.startswith("git@github.com:"):
        path = url.removeprefix("git@github.com:")
    else:
        parsed = urlsplit(url)
        if parsed.scheme not in ("https", "ssh") or parsed.hostname != "github.com":
            raise ValueError("origin must target GitHub")
        if parsed.password or (parsed.scheme == "https" and parsed.username):
            raise ValueError("origin must not embed credentials")
        if parsed.query or parsed.fragment or parsed.port is not None:
            raise ValueError("origin contains unexpected URL components")
        path = parsed.path.removeprefix("/")
    identity = path.removesuffix(".git")
    if identity != REPOSITORY:
        raise ValueError(f"release destination must be {REPOSITORY}")
    return identity


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def check(root: Path, phase: str) -> dict:
    for direction in ([], ["--push"]):
        urls = git("remote", "get-url", *direction, "--all", "origin").splitlines()
        if not urls:
            raise ValueError("origin is missing")
        for url in urls:
            repository_identity(url)
    version = (root / "firmware_version.txt").read_text().strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("firmware_version.txt must contain X.Y.Z")
    tag = f"v{version}"
    for suffix in (".md", ".zh_CN.md"):
        if not (root / "docs" / "releases" / f"{tag}{suffix}").is_file():
            raise ValueError(f"missing release notes: {tag}{suffix}")
    branch = git("branch", "--show-current")
    dirty = bool(git("status", "--porcelain"))
    commit = git("rev-parse", "HEAD")
    if phase == "ready":
        if branch != "main" or dirty:
            raise ValueError("tag readiness requires a clean main checkout")
        if git("rev-parse", "origin/main") != commit:
            raise ValueError("push the reviewed main commit before creating the tag")
        if git("tag", "--list", tag):
            raise ValueError("tag already exists; inspect/resume its workflow instead")
    if phase == "ci":
        if os.environ.get("GITHUB_REPOSITORY") != REPOSITORY:
            raise ValueError("GitHub Actions is running in the wrong repository")
        if os.environ.get("GITHUB_REF_TYPE") == "tag":
            if os.environ.get("GITHUB_REF_NAME") != tag:
                raise ValueError("tag and firmware_version.txt differ")
    return {"repository": REPOSITORY, "phase": phase, "version": version,
            "tag": tag, "branch": branch or "detached", "commit": commit,
            "dirty": dirty, "writes_performed": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("prepare", "ready", "ci"), default="prepare")
    args = parser.parse_args()
    try:
        root = Path(git("rev-parse", "--show-toplevel"))
        print(json.dumps(check(root, args.phase), indent=2))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Release preflight: FAIL ({error})")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
