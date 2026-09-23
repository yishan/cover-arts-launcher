from pathlib import Path
import json
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.generate_launcher_title_font import gb2312_level_one_codepoints


class LauncherArtContractTests(unittest.TestCase):
    def test_graphical_selector_has_bounded_cover_buffers(self) -> None:
        ui = (ROOT / "main/launcher_ui.c").read_text()
        self.assertIn("LAUNCHER_COVER_WIDTH", ui)
        self.assertIn("LAUNCHER_COVER_HEIGHT", ui)
        self.assertIn("LAUNCHER_SIDE_VISIBLE_WIDTH", ui)
        self.assertIn("s_center_pixels", ui)
        self.assertIn("s_left_peek_pixels", ui)
        self.assertIn("s_right_peek_pixels", ui)
        self.assertNotIn("lodepng", ui.lower())
        self.assertNotIn("jpeg_decoder", ui.lower())

    def test_cover_store_and_view_are_in_firmware_build(self) -> None:
        cmake = (ROOT / "main/CMakeLists.txt").read_text()
        self.assertIn('"launcher_cover_store.c"', cmake)
        self.assertIn('"launcher_cover_view.c"', cmake)
        self.assertTrue(
            (ROOT / "assets/images/launcher/placeholder-cover.svg").is_file()
        )

    def test_heap_probe_and_preview_stress_are_present(self) -> None:
        main = (ROOT / "main/main.c").read_text()
        preview = (ROOT / "tests/launcher_preview/preview.c").read_text()
        self.assertIn("heap before UI", main)
        self.assertIn("heap after cover scan", main)
        self.assertIn("100 selections", main)
        self.assertIn("for (unsigned index = 0; index < 100u; ++index)", preview)

    def test_side_cards_are_recessed_behind_the_center_cover(self) -> None:
        ui = (ROOT / "main/launcher_ui.c").read_text()

        self.assertIn("#define LAUNCHER_SIDE_CARD_WIDTH 108u", ui)
        self.assertIn("#define LAUNCHER_SIDE_CARD_HEIGHT 144u", ui)
        self.assertIn("#define LAUNCHER_SIDE_VISIBLE_WIDTH 36u", ui)
        self.assertIn("#define LAUNCHER_SIDE_OPACITY 153u", ui)
        self.assertIn("#define LAUNCHER_SIDE_LEFT_X 22", ui)
        self.assertIn("#define LAUNCHER_SIDE_RIGHT_X 182", ui)
        self.assertIn("#define LAUNCHER_SIDE_Y 44", ui)
        self.assertIn("lv_obj_set_style_opa(s_left_image, LAUNCHER_SIDE_OPACITY", ui)
        self.assertIn("lv_obj_set_style_opa(s_right_image, LAUNCHER_SIDE_OPACITY", ui)
        self.assertLess(
            ui.index("s_left_image = create_image"),
            ui.index("s_center_frame = lv_obj_create"),
        )
        self.assertLess(
            ui.index("s_right_image = create_image"),
            ui.index("s_center_frame = lv_obj_create"),
        )

    def test_play_title_uses_enabled_common_cjk_font(self) -> None:
        ui = (ROOT / "main/launcher_ui.c").read_text()
        cmake = (ROOT / "main/CMakeLists.txt").read_text()
        defaults = (ROOT / "sdkconfig.defaults").read_text()
        preview = (ROOT / "tests/launcher_preview/preview.c").read_text()

        self.assertIn("&launcher_font_16_gb2312", ui)
        self.assertIn("launcher_source_han_sans_sc_16_gb2312.c", cmake)
        self.assertIn("CONFIG_LV_TXT_ENC_UTF8=y", defaults)
        self.assertIn("CONFIG_LV_USE_FONT_PLACEHOLDER=y", defaults)
        self.assertIn("assert_chinese_title_coverage();", preview)
        self.assertIn('"点球决胜"', preview)
        level_one = gb2312_level_one_codepoints()
        self.assertEqual(len(level_one), 3755)
        for character in "中文玩法点球决胜":
            self.assertIn(ord(character), level_one)

    def test_browser_title_preflight_uses_the_same_glyph_inventory(self) -> None:
        generated = (ROOT / "tools/install-slot/title-glyphs.js").read_text()
        match = re.search(r"= (.*);\n$", generated)
        self.assertIsNotNone(match)
        inventory = json.loads(match.group(1))
        self.assertEqual({ord(character) for character in inventory}, gb2312_level_one_codepoints())
        manager = (ROOT / "tools/install-slot/app.js").read_text()
        self.assertIn("requireLauncherTitle", manager)
        self.assertIn("updateTitleCheck", manager)


if __name__ == "__main__":
    unittest.main()
