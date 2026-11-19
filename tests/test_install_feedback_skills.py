#!/usr/bin/env python3
"""Host tests for tools/install_feedback_skills.py."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import install_feedback_skills as ifs  # noqa: E402


class InstallFeedbackSkillsTests(unittest.TestCase):
    def test_external_packs_are_sha_pinned_and_unique(self) -> None:
        self.assertEqual(ifs.validate_pack_pins(), [])
        pack_names = {pack.name for pack in ifs.EXTERNAL_PACKS}
        self.assertIn("backnotprop/pstack", pack_names)
        self.assertIn("emilkowalski/skills", pack_names)

    def test_local_skills_install_and_check(self) -> None:
        with tempfile.TemporaryDirectory(prefix="test-feedback-skills-") as tmp:
            dest = Path(tmp) / "skills"
            dest.mkdir()
            installed = ifs.install_local_skills(dest, repo_root=ROOT)
            self.assertEqual(tuple(installed), ifs.LOCAL_SKILL_NAMES)
            for name in ifs.LOCAL_SKILL_NAMES:
                self.assertTrue((dest / name / "SKILL.md").is_file(), f"missing {name}/SKILL.md")

            found, missing = ifs.inspect_destination(dest)
            self.assertEqual(set(found), set(ifs.LOCAL_SKILL_NAMES))
            self.assertTrue(len(missing) > 0)

    def test_dry_run_cli_succeeds_without_network(self) -> None:
        with tempfile.TemporaryDirectory(prefix="test-feedback-dryrun-") as tmp:
            dest = Path(tmp) / "skills"
            rc = ifs.main(["--dest", str(dest), "--dry-run"])
            self.assertEqual(rc, 0)
            self.assertFalse(dest.exists())

    def test_multi_dest_local_only_cli(self) -> None:
        with tempfile.TemporaryDirectory(prefix="test-feedback-multi-") as tmp:
            dest_a = Path(tmp) / "agents-skills"
            dest_b = Path(tmp) / "claude-skills"
            rc = ifs.main(["--dest", str(dest_a), "--dest", str(dest_b), "--local-only"])
            self.assertEqual(rc, 0)
            for dest in (dest_a, dest_b):
                for name in ifs.LOCAL_SKILL_NAMES:
                    self.assertTrue((dest / name / "SKILL.md").is_file())


if __name__ == "__main__":
    unittest.main()
