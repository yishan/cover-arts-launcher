"""Verify that release target checks reject upstream and mismatched tags."""

import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "release_preflight", Path(__file__).parents[1] / "tools/release_preflight.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class ReleasePreflightTests(unittest.TestCase):
    def test_supported_github_urls(self):
        for url in ("https://github.com/yishan/cover-arts-launcher.git",
                    "git@github.com:yishan/cover-arts-launcher.git",
                    "ssh://git@github.com/yishan/cover-arts-launcher.git"):
            self.assertEqual(preflight.repository_identity(url), preflight.REPOSITORY)

    def test_rejects_upstream_other_hosts_and_credentials(self):
        for url in ("https://github.com/folotoy/ai-passport.git",
                    "git@github.com:folotoy/ai-passport.git",
                    "https://example.com/yishan/cover-arts-launcher.git",
                    "https://token@github.com/yishan/cover-arts-launcher.git",
                    "https://github.com/yishan/cover-arts-launcher.git?extra=1"):
            with self.assertRaises(ValueError):
                preflight.repository_identity(url)

    def test_all_push_destinations_are_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def remote(*args):
                return ("https://github.com/yishan/cover-arts-launcher.git\n"
                        "https://github.com/folotoy/ai-passport.git")
            with patch.object(preflight, "git", side_effect=remote):
                with self.assertRaisesRegex(ValueError, "destination"):
                    preflight.check(root, "prepare")

    def test_ci_rejects_version_tag_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "firmware_version.txt").write_text("1.5.0\n")
            notes = root / "docs/releases"
            notes.mkdir(parents=True)
            for suffix in (".md", ".zh_CN.md"):
                (notes / f"v1.5.0{suffix}").write_text("notes")
            def git(*args):
                if args[0] == "remote":
                    return "https://github.com/yishan/cover-arts-launcher.git"
                if args[0] == "branch":
                    return ""
                if args[0] == "status":
                    return ""
                return "commit"
            environment = {"GITHUB_REPOSITORY": preflight.REPOSITORY,
                           "GITHUB_REF_TYPE": "tag", "GITHUB_REF_NAME": "v1.6.0"}
            with patch.object(preflight, "git", side_effect=git), patch.dict(os.environ, environment):
                with self.assertRaisesRegex(ValueError, "differ"):
                    preflight.check(root, "ci")


if __name__ == "__main__":
    unittest.main()
