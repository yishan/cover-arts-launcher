#!/usr/bin/env python3
"""Static checks for the child-application Launcher contract."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def function_body(source: str, name: str) -> str:
    match = re.search(rf"\b{name}\s*\([^;]*?\)\s*\{{", source, re.S)
    if match is None:
        raise AssertionError(f"function {name} not found")
    depth = 1
    cursor = match.end()
    while cursor < len(source) and depth:
        if source[cursor] == "{":
            depth += 1
        elif source[cursor] == "}":
            depth -= 1
        cursor += 1
    if depth:
        raise AssertionError(f"function {name} is not balanced")
    return source[match.end() : cursor - 1]


class LauncherContractSourceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = (
            ROOT / "components/launcher_contract/launcher_contract.c"
        ).read_text(encoding="utf-8")
        cls.defaults = (ROOT / "sdkconfig.defaults").read_text(encoding="utf-8")

    def test_rollback_is_enabled(self) -> None:
        self.assertIn("CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y", self.defaults)

    def test_mark_valid_is_limited_to_ota_children(self) -> None:
        body = function_body(self.source, "launcher_contract_mark_valid")
        self.assertIn("ESP_PARTITION_SUBTYPE_APP_OTA_0", body)
        self.assertIn("esp_ota_mark_app_valid_cancel_rollback", body)

    def test_factory_is_verified_before_selection_and_restart(self) -> None:
        body = function_body(self.source, "launcher_contract_return_to_factory")
        self.assertIn("running == factory", body)
        verify = body.index("esp_image_verify")
        select = body.index("esp_ota_set_boot_partition")
        restart = body.index("esp_restart")
        self.assertLess(verify, select)
        self.assertLess(select, restart)


if __name__ == "__main__":
    unittest.main()
