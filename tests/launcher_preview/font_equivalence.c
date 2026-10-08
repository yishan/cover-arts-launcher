#include "lvgl.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

extern const lv_font_t launcher_font_16_gb2312;
extern const lv_font_t launcher_font_uncompressed_reference;

/* Compare decoded pixels, not compressed representation or placeholder glyphs. */
int main(void)
{
    const lv_font_t *current = &launcher_font_16_gb2312;
    const lv_font_t *reference = &launcher_font_uncompressed_reference;
    unsigned covered = 0;
    lv_init();
    assert(current->line_height == reference->line_height);
    assert(current->base_line == reference->base_line);
    for (uint32_t codepoint = 0x20; codepoint <= 0xffff; ++codepoint) {
        lv_font_glyph_dsc_t a = {0};
        lv_font_glyph_dsc_t b = {0};
        bool have_a = current->get_glyph_dsc(current, &a, codepoint, 0);
        bool have_b = reference->get_glyph_dsc(reference, &b, codepoint, 0);
        if (have_a != have_b) {
            fprintf(stderr, "coverage mismatch: U+%04X\n", (unsigned)codepoint);
        }
        assert(have_a == have_b);
        if (!have_a) continue;
        ++covered;
        assert(a.adv_w == b.adv_w);
        assert(a.box_w == b.box_w && a.box_h == b.box_h);
        assert(a.ofs_x == b.ofs_x && a.ofs_y == b.ofs_y);
        assert(a.format == b.format);
        if (!a.box_w || !a.box_h) continue;
        a.resolved_font = current;
        b.resolved_font = reference;
        lv_draw_buf_t *pixels_a = lv_draw_buf_create(
            a.box_w, a.box_h, LV_COLOR_FORMAT_A8, 0);
        lv_draw_buf_t *pixels_b = lv_draw_buf_create(
            b.box_w, b.box_h, LV_COLOR_FORMAT_A8, 0);
        assert(pixels_a && pixels_b);
        assert(lv_font_get_glyph_bitmap(&a, pixels_a));
        assert(lv_font_get_glyph_bitmap(&b, pixels_b));
        for (uint32_t y = 0; y < a.box_h; ++y) {
            bool equal = memcmp(pixels_a->data + y * pixels_a->header.stride,
                                pixels_b->data + y * pixels_b->header.stride,
                                a.box_w) == 0;
            if (!equal) {
                fprintf(stderr, "pixel mismatch: U+%04X row %u\n",
                        (unsigned)codepoint, (unsigned)y);
            }
            assert(equal);
        }
        lv_font_glyph_release_draw_data(&a);
        lv_font_glyph_release_draw_data(&b);
        lv_draw_buf_destroy(pixels_a);
        lv_draw_buf_destroy(pixels_b);
    }
    assert(covered >= 3755);
    printf("Font equivalence: PASS (%u glyphs; identical metrics and pixels)\n",
           covered);
    lv_deinit();
    return 0;
}
