#!/usr/bin/env python3
"""Static contracts for the production Launcher shell and boot path."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


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


class LauncherShellContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.main = read("main/main.c")
        cls.boot = read("main/launcher_boot.c")
        cls.ui = read("main/launcher_ui.c")
        cls.cover_view = read("main/launcher_cover_view.c")
        cls.cmake = read("main/CMakeLists.txt")

    def test_shell_uses_bsp_queue_slots_and_boot_adapter(self) -> None:
        for required in (
            "bsp_display_init()",
            "bsp_lvgl_init()",
            "bsp_button_init(on_key",
            "xQueueCreate(",
            "launcher_slots_scan(",
            "launcher_boot_slot(",
        ):
            self.assertIn(required, self.main)

    def test_button_callback_only_enqueues(self) -> None:
        body = function_body(self.main, "on_key")
        self.assertIn("xQueueSend", body)
        self.assertNotIn("lv_", body)
        self.assertNotIn("launcher_boot_slot", body)
        self.assertNotIn("launcher_slots_scan", body)

    def test_boot_reverifies_before_changing_target(self) -> None:
        body = function_body(self.boot, "launcher_boot_slot")
        verify = body.index("esp_image_verify")
        select = body.index("esp_ota_set_boot_partition")
        restart = body.index("esp_restart")
        self.assertLess(verify, select)
        self.assertLess(select, restart)

    def test_ui_has_real_empty_library_and_no_demo_shell(self) -> None:
        self.assertIn("Connect to a computer", self.ui)
        self.assertIn("Empty position", self.cover_view)
        self.assertNotIn("ui_pixel", self.ui)
        self.assertNotIn("demo_", self.main)

    def test_component_builds_launcher_sources(self) -> None:
        for source in (
            '"launcher_model.c"',
            '"launcher_slots.c"',
            '"launcher_ui.c"',
            '"launcher_boot.c"',
            '"launcher_manifest.c"',
            '"launcher_trust_store.c"',
        ):
            self.assertIn(source, self.cmake)
        for dependency in ("app_update", "bootloader_support", "mbedtls"):
            self.assertIn(dependency, self.cmake)


if __name__ == "__main__":
    unittest.main()
