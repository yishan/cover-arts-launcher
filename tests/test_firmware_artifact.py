#!/usr/bin/env python3
"""Host tests for the public firmware artifact naming contract."""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import firmware_artifact as ARTIFACT  # noqa: E402


class FirmwareArtifactTest(unittest.TestCase):
    def test_cover_arts_launcher_uses_versioned_project_name(self) -> None:
        self.assertRegex(ARTIFACT.VERSION, r"^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$")
        self.assertEqual(ARTIFACT.VERSION, (ROOT / "firmware_version.txt").read_text().strip())
        self.assertEqual(ARTIFACT.PRODUCT, "FoloToy-AI-Passport-Cover-Arts-Launcher")
        self.assertEqual(
            ARTIFACT.FULL_BIN,
            f"{ARTIFACT.PRODUCT}-v{ARTIFACT.VERSION}-full.bin",
        )

    def test_cli_returns_the_same_filename(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "firmware_artifact.py"), "full-bin"],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.stdout.strip(), ARTIFACT.FULL_BIN)


if __name__ == "__main__":
    unittest.main()
