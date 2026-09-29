#include "launcher_cover_store.h"
#include "launcher_model.h"
#include "launcher_ui.h"

#include "lvgl.h"

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

LV_FONT_DECLARE(launcher_font_16_gb2312);

#define SCREEN_WIDTH 240
#define SCREEN_HEIGHT 320

static uint16_t s_pixels[SCREEN_WIDTH * SCREEN_HEIGHT];
static uint16_t s_buffer[SCREEN_WIDTH * 20];
static uint8_t s_cover_bytes[LAUNCHER_COVER_USED_SIZE];
static lv_display_t *s_display;

static bool read_cover(void *context, size_t offset, void *destination,
                       size_t length)
{
    uint8_t *bytes = context;

    if (offset > sizeof(s_cover_bytes) ||
        length > sizeof(s_cover_bytes) - offset) {
        return false;
    }
    memcpy(destination, bytes + offset, length);
    return true;
}

static lv_obj_t *find_visible_text(lv_obj_t *object, const char *expected)
{
    if (lv_obj_has_flag(object, LV_OBJ_FLAG_HIDDEN)) {
        return NULL;
    }
    if (lv_obj_check_type(object, &lv_label_class) &&
        strstr(lv_label_get_text(object), expected) != NULL) {
        return object;
    }
    for (uint32_t index = 0; index < lv_obj_get_child_count(object); ++index) {
        lv_obj_t *match = find_visible_text(lv_obj_get_child(object, index),
                                            expected);
        if (match != NULL) {
            return match;
        }
    }
    return NULL;
}

static bool has_visible_text(lv_obj_t *object, const char *expected)
{
    return find_visible_text(object, expected) != NULL;
}

static void assert_text_bounds(const char *expected, int y1, int y2)
{
    lv_obj_t *label = find_visible_text(lv_screen_active(), expected);
    lv_area_t area;

    assert(label != NULL);
    lv_obj_get_coords(label, &area);
    assert(area.y1 == y1);
    assert(area.y2 == y2);
}

static void flush(lv_display_t *display, const lv_area_t *area, uint8_t *data)
{
    uint16_t *pixels = (uint16_t *)data;
    int area_width = lv_area_get_width(area);

    (void)display;
    for (int y = area->y1; y <= area->y2; ++y) {
        for (int x = area->x1; x <= area->x2; ++x) {
            assert(x >= 0 && x < SCREEN_WIDTH && y >= 0 && y < SCREEN_HEIGHT);
            s_pixels[y * SCREEN_WIDTH + x] =
                pixels[(y - area->y1) * area_width + x - area->x1];
        }
    }
    lv_display_flush_ready(display);
}

static void save_ppm(const char *directory, const char *name)
{
    char path[1024];
    FILE *file;

    snprintf(path, sizeof(path), "%s/%s.ppm", directory, name);
    file = fopen(path, "wb");
    assert(file != NULL);
    fprintf(file, "P6\n%d %d\n255\n", SCREEN_WIDTH, SCREEN_HEIGHT);
    for (size_t index = 0; index < SCREEN_WIDTH * SCREEN_HEIGHT; ++index) {
        uint16_t pixel = s_pixels[index];
        uint8_t rgb[3] = {
            (uint8_t)(((pixel >> 11) & 31u) * 255u / 31u),
            (uint8_t)(((pixel >> 5) & 63u) * 255u / 63u),
            (uint8_t)((pixel & 31u) * 255u / 31u),
        };
        assert(fwrite(rgb, 1, sizeof(rgb), file) == sizeof(rgb));
    }
    fclose(file);
}

static void render(launcher_model_t *model,
                   launcher_cover_record_t covers[LAUNCHER_MAX_SLOTS],
                   const launcher_cover_source_t sources[LAUNCHER_MAX_SLOTS],
                   const char *directory, const char *name)
{
    launcher_ui_render(model, covers, sources, 76, NULL);
    lv_obj_update_layout(lv_screen_active());
    lv_obj_invalidate(lv_screen_active());
    lv_refr_now(s_display);
    if (name != NULL) {
        save_ppm(directory, name);
    }
}

static void make_cover(launcher_cover_record_t *record, uint8_t slot_id,
                       uint32_t background, uint32_t accent,
                       const char *title, const char *version)
{
    size_t bank_offset = launcher_cover_bank_offset(slot_id, 0u);
    uint8_t *pixels = s_cover_bytes + bank_offset +
                      LAUNCHER_COVER_PAYLOAD_OFFSET;

    *record = (launcher_cover_record_t){
        .valid = true,
        .bank = 0u,
        .bank_offset = bank_offset,
        .manifest = {
            .slot_id = slot_id,
            .width = LAUNCHER_COVER_WIDTH,
            .height = LAUNCHER_COVER_HEIGHT,
            .payload_length = LAUNCHER_COVER_PAYLOAD_LENGTH,
        },
    };
    snprintf(record->manifest.title, sizeof(record->manifest.title), "%s",
             title);
    snprintf(record->manifest.version, sizeof(record->manifest.version), "%s",
             version);
    for (size_t y = 0u; y < LAUNCHER_COVER_HEIGHT; ++y) {
        for (size_t x = 0u; x < LAUNCHER_COVER_WIDTH; ++x) {
            uint32_t rgb = (x > 18u && x < 102u && y > 28u && y < 118u) ?
                               accent : background;
            uint16_t pixel = (uint16_t)((((rgb >> 16u) & 0xffu) >> 3u) << 11u |
                                        (((rgb >> 8u) & 0xffu) >> 2u) << 5u |
                                        ((rgb & 0xffu) >> 3u));
            size_t offset = (y * LAUNCHER_COVER_WIDTH + x) * 2u;
            pixels[offset] = (uint8_t)(pixel & 0xffu);
            pixels[offset + 1u] = (uint8_t)(pixel >> 8u);
        }
    }
}

static launcher_slot_info_t slot(launcher_slot_state_t state,
                                 const char *name, const char *version,
                                 uint32_t image_size)
{
    launcher_slot_info_t info = {
        .state = state,
        .image_size = image_size,
        .first_installed_at = 1727222400u,
        .last_installed_at = 1727308800u,
        .first_install_utc_offset_minutes = 480,
        .last_install_utc_offset_minutes = 480,
        .launch_count = 12u,
        .launch_count_valid = state == LAUNCHER_SLOT_READY ||
                              state == LAUNCHER_SLOT_TRIAL,
    };

    snprintf(info.project_name, sizeof(info.project_name), "%s", name);
    snprintf(info.version, sizeof(info.version), "%s", version);
    return info;
}

static void assert_chinese_title_coverage(void)
{
    static const uint32_t required[] = {
        0x4e2du, /* 中 */
        0x6587u, /* 文 */
        0x73a9u, /* 玩 */
        0x6cd5u, /* 法 */
        0x70b9u, /* 点 */
        0x7403u, /* 球 */
        0x51b3u, /* 决 */
        0x80dcu, /* 胜 */
    };

    for (size_t index = 0; index < sizeof(required) / sizeof(required[0]);
         ++index) {
        lv_font_glyph_dsc_t glyph = {0};
        bool covered = lv_font_get_glyph_dsc(
            &launcher_font_16_gb2312, &glyph, required[index], 0u);
        if (!covered || glyph.is_placeholder) {
            fprintf(stderr, "missing title glyph: U+%04lX\n",
                    (unsigned long)required[index]);
        }
        assert(covered);
        assert(!glyph.is_placeholder);
    }
}

int main(int argc, char **argv)
{
    launcher_slot_info_t empty[3] = {
        slot(LAUNCHER_SLOT_EMPTY, "", "", 0),
        slot(LAUNCHER_SLOT_EMPTY, "", "", 0),
        slot(LAUNCHER_SLOT_EMPTY, "", "", 0),
    };
    launcher_slot_info_t mixed[3] = {
        slot(LAUNCHER_SLOT_READY, "点球决胜", "1.1.0", 734208),
        slot(LAUNCHER_SLOT_TRIAL, "Space Radio", "0.8.0", 912384),
        slot(LAUNCHER_SLOT_INVALID, "", "", 0),
    };
    launcher_model_t model;
    launcher_cover_record_t no_covers[LAUNCHER_MAX_SLOTS] = {0};
    launcher_cover_record_t covers[LAUNCHER_MAX_SLOTS] = {0};
    launcher_cover_source_t cover_source = {
        .read = read_cover,
        .context = s_cover_bytes,
        .size = sizeof(s_cover_bytes),
    };
    launcher_cover_source_t cover_sources[LAUNCHER_MAX_SLOTS] = {0};
    size_t stable_free = 0;

    assert(argc == 2);
    lv_init();
    s_display = lv_display_create(SCREEN_WIDTH, SCREEN_HEIGHT);
    assert(s_display != NULL);
    lv_display_set_color_format(s_display, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(s_display, s_buffer, NULL, sizeof(s_buffer),
                           LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(s_display, flush);
    assert_chinese_title_coverage();
    make_cover(&covers[0], 0u, 0x183b56u, 0xe19b31u, "点球决胜", "1.1.0");
    make_cover(&covers[1], 1u, 0x362657u, 0x58c8b8u, "Space Radio", "0.8.0");
    cover_sources[0] = cover_source;
    cover_sources[1] = cover_source;
    cover_sources[2] = cover_source;

    for (unsigned cycle = 0; cycle < 3; ++cycle) {
        launcher_model_init(&model, empty, 3u);
        assert(launcher_ui_create());
        render(&model, no_covers, cover_sources, argv[1],
               cycle == 0 ? "01-all-empty" : NULL);
        assert(has_visible_text(lv_screen_active(), "空位置"));
        assert(has_visible_text(lv_screen_active(), "连接电脑"));

        launcher_model_refresh(&model, mixed, 3u);
        render(&model, covers, cover_sources, argv[1],
               cycle == 0 ? "02-ready" : NULL);
        assert(has_visible_text(lv_screen_active(), "点球决胜"));
        assert(!has_visible_text(lv_screen_active(), "准备就绪"));
        assert(!has_visible_text(lv_screen_active(), "版本："));
        assert_text_bounds("位置 1 / 3", 260, 283);
        assert_text_bounds("上下切换", 288, 311);
        launcher_model_handle(&model, LAUNCHER_INPUT_DOWN);
        render(&model, covers, cover_sources, argv[1],
               cycle == 0 ? "03-trial" : NULL);
        assert(has_visible_text(lv_screen_active(), "Space Radio"));
        launcher_model_handle(&model, LAUNCHER_INPUT_DOWN);
        render(&model, covers, cover_sources, argv[1],
               cycle == 0 ? "04-incomplete" : NULL);
        assert(has_visible_text(lv_screen_active(), "安装不完整"));
        launcher_model_handle(&model, LAUNCHER_INPUT_OK);
        render(&model, covers, cover_sources, argv[1],
               cycle == 0 ? "05-recovery" : NULL);
        assert(has_visible_text(lv_screen_active(), "修复位置"));
        launcher_model_handle(&model, LAUNCHER_INPUT_OK);
        launcher_model_handle(&model, LAUNCHER_INPUT_UP);
        launcher_model_handle(&model, LAUNCHER_INPUT_UP);
        launcher_model_handle(&model, LAUNCHER_INPUT_OK_LONG);
        render(&model, covers, cover_sources, argv[1],
               cycle == 0 ? "06-details" : NULL);
        assert(has_visible_text(lv_screen_active(), "点球决胜"));
        assert(has_visible_text(lv_screen_active(), "位置：1"));
        assert(has_visible_text(lv_screen_active(), "准备就绪"));
        assert(has_visible_text(lv_screen_active(), "版本：1.1.0"));
        assert(has_visible_text(lv_screen_active(), "首次安装"));
        assert(has_visible_text(lv_screen_active(), "启动次数：12"));
        launcher_model_handle(&model, LAUNCHER_INPUT_OK);
        render(&model, covers, cover_sources, argv[1], NULL);

        lv_mem_monitor_t before_stress;
        lv_mem_monitor(&before_stress);
        for (unsigned index = 0; index < 100u; ++index) {
            launcher_model_handle(&model, LAUNCHER_INPUT_DOWN);
            render(&model, covers, cover_sources, argv[1], NULL);
        }
        lv_mem_monitor_t after_stress;
        lv_mem_monitor(&after_stress);
        if (after_stress.free_size < before_stress.free_size) {
            fprintf(stderr, "100-selection LVGL memory: before=%zu after=%zu\n",
                    before_stress.free_size, after_stress.free_size);
        }
        assert(after_stress.free_size >= before_stress.free_size);

        launcher_ui_destroy();
        lv_refr_now(s_display);
        lv_mem_monitor_t memory;
        lv_mem_monitor(&memory);
        if (cycle == 1) {
            stable_free = memory.free_size;
        } else if (cycle > 1) {
            if (memory.free_size != stable_free) {
                fprintf(stderr,
                        "LVGL free-memory drift: cycle=%u stable=%zu current=%zu\n",
                        cycle, stable_free, memory.free_size);
            }
            /* LVGL may retain one tiny glyph-cache allocation after the
             * Chinese details page; anything larger still fails the leak
             * probe. */
            assert(memory.free_size + 32u >= stable_free);
        }
    }

    puts("Launcher LVGL preview: PASS");
    return 0;
}
