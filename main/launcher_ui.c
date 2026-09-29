#include "launcher_ui.h"

#include "launcher_cover_view.h"
#include "launcher_time.h"
#include "lvgl.h"

#include <stdio.h>

LV_FONT_DECLARE(launcher_font_16_gb2312);

#define COLOR_BACKGROUND 0x101319u
#define COLOR_SHELF 0x242931u
#define COLOR_TEXT 0xf4f0e5u
#define COLOR_MUTED 0x9aa2adu
#define COLOR_FOCUS 0xf0c85au
#define COLOR_WARNING 0xf07a62u
#define COLOR_READY 0x4eae83u
#define LAUNCHER_SIDE_CARD_WIDTH 108u
#define LAUNCHER_SIDE_CARD_HEIGHT 144u
#define LAUNCHER_SIDE_VISIBLE_WIDTH 36u
#define LAUNCHER_SIDE_SOURCE_WIDTH                                             \
    ((LAUNCHER_SIDE_VISIBLE_WIDTH * LAUNCHER_COVER_WIDTH +                    \
      LAUNCHER_SIDE_CARD_WIDTH - 1u) / LAUNCHER_SIDE_CARD_WIDTH)
#define LAUNCHER_SIDE_OPACITY 153u
#define LAUNCHER_SIDE_LEFT_X 22
#define LAUNCHER_SIDE_RIGHT_X 182
#define LAUNCHER_SIDE_Y 44

static lv_obj_t *s_screen;
static lv_obj_t *s_blank_screen;
static lv_obj_t *s_battery;
static lv_obj_t *s_shelf;
static lv_obj_t *s_center_frame;
static lv_obj_t *s_center_image;
static lv_obj_t *s_left_image;
static lv_obj_t *s_right_image;
static lv_obj_t *s_title;
static lv_obj_t *s_metadata;
static lv_obj_t *s_message;
static lv_obj_t *s_indicator;
static lv_obj_t *s_controls;

static LV_ATTRIBUTE_MEM_ALIGN uint8_t
    s_center_pixels[LAUNCHER_COVER_PAYLOAD_LENGTH];
static LV_ATTRIBUTE_MEM_ALIGN uint8_t
    s_left_peek_pixels[LAUNCHER_SIDE_VISIBLE_WIDTH * LAUNCHER_SIDE_CARD_HEIGHT *
                       2u];
static LV_ATTRIBUTE_MEM_ALIGN uint8_t
    s_right_peek_pixels[LAUNCHER_SIDE_VISIBLE_WIDTH *
                        LAUNCHER_SIDE_CARD_HEIGHT * 2u];

static lv_image_dsc_t s_center_descriptor = {
    .header = {
        .magic = LV_IMAGE_HEADER_MAGIC,
        .cf = LV_COLOR_FORMAT_RGB565,
        .w = LAUNCHER_COVER_WIDTH,
        .h = LAUNCHER_COVER_HEIGHT,
        .stride = LAUNCHER_COVER_WIDTH * 2u,
    },
    .data_size = sizeof(s_center_pixels),
    .data = s_center_pixels,
};
static lv_image_dsc_t s_left_descriptor = {
    .header = {
        .magic = LV_IMAGE_HEADER_MAGIC,
        .cf = LV_COLOR_FORMAT_RGB565,
        .w = LAUNCHER_SIDE_VISIBLE_WIDTH,
        .h = LAUNCHER_SIDE_CARD_HEIGHT,
        .stride = LAUNCHER_SIDE_VISIBLE_WIDTH * 2u,
    },
    .data_size = sizeof(s_left_peek_pixels),
    .data = s_left_peek_pixels,
};
static lv_image_dsc_t s_right_descriptor = {
    .header = {
        .magic = LV_IMAGE_HEADER_MAGIC,
        .cf = LV_COLOR_FORMAT_RGB565,
        .w = LAUNCHER_SIDE_VISIBLE_WIDTH,
        .h = LAUNCHER_SIDE_CARD_HEIGHT,
        .stride = LAUNCHER_SIDE_VISIBLE_WIDTH * 2u,
    },
    .data_size = sizeof(s_right_peek_pixels),
    .data = s_right_peek_pixels,
};

static uint16_t rgb565(uint32_t rgb)
{
    return (uint16_t)((((rgb >> 16u) & 0xffu) >> 3u) << 11u |
                      (((rgb >> 8u) & 0xffu) >> 2u) << 5u |
                      ((rgb & 0xffu) >> 3u));
}

static void put_pixel(uint8_t *destination, size_t pixel, uint16_t color)
{
    destination[pixel * 2u] = (uint8_t)(color & 0xffu);
    destination[pixel * 2u + 1u] = (uint8_t)(color >> 8u);
}

static uint16_t placeholder_pixel(const launcher_cover_card_t *card,
                                  size_t x, size_t y)
{
    static const uint32_t bases[] = {
        0x28303a, 0x4a272b, 0x4a4028, 0x263e37,
    };
    uint32_t base = bases[card->state];
    uint32_t accent = card->state == LAUNCHER_SLOT_INVALID ? COLOR_WARNING :
                      card->state == LAUNCHER_SLOT_READY ? COLOR_READY :
                                                          COLOR_FOCUS;

    if (x < 4u || x >= LAUNCHER_COVER_WIDTH - 4u || y < 4u ||
        y >= LAUNCHER_COVER_HEIGHT - 4u) {
        return rgb565(0x0b0d11u);
    }
    if (y >= 112u && y < 136u) {
        return rgb565(accent);
    }
    if (((x / 12u) + (y / 12u) + card->slot_id) % 2u == 0u) {
        base += 0x080808u;
    }
    if (x >= 36u && x < 84u && y >= 42u && y < 92u) {
        return rgb565(card->state == LAUNCHER_SLOT_EMPTY ? 0x65707cu : accent);
    }
    return rgb565(base);
}

static void fill_placeholder(uint8_t *destination,
                             const launcher_cover_card_t *card,
                             size_t source_x, size_t width)
{
    for (size_t y = 0u; y < LAUNCHER_COVER_HEIGHT; ++y) {
        for (size_t x = 0u; x < width; ++x) {
            put_pixel(destination, y * width + x,
                      placeholder_pixel(card, source_x + x, y));
        }
    }
}

static void load_center(const launcher_cover_card_t *card,
                        const launcher_cover_source_t *source)
{
    if (!card->has_cover || source == NULL ||
        !launcher_cover_store_read_payload(source, card->cover, 0u,
                                           s_center_pixels,
                                           sizeof(s_center_pixels))) {
        fill_placeholder(s_center_pixels, card, 0u, LAUNCHER_COVER_WIDTH);
    }
}

static void load_peek(uint8_t *destination,
                      const launcher_cover_card_t *card,
                      const launcher_cover_source_t *source, bool right_edge)
{
    uint8_t source_row[LAUNCHER_SIDE_SOURCE_WIDTH * 2u];
    size_t source_x = right_edge ?
                          LAUNCHER_COVER_WIDTH - LAUNCHER_SIDE_SOURCE_WIDTH : 0u;

    if (card->has_cover && source != NULL) {
        for (size_t y = 0u; y < LAUNCHER_SIDE_CARD_HEIGHT; ++y) {
            size_t source_y = y * LAUNCHER_COVER_HEIGHT /
                              LAUNCHER_SIDE_CARD_HEIGHT;
            size_t payload_offset =
                (source_y * LAUNCHER_COVER_WIDTH + source_x) * 2u;
            if (!launcher_cover_store_read_payload(
                    source, card->cover, payload_offset, source_row,
                    sizeof(source_row))) {
                break;
            }
            for (size_t x = 0u; x < LAUNCHER_SIDE_VISIBLE_WIDTH; ++x) {
                size_t source_sample = x * LAUNCHER_COVER_WIDTH /
                                       LAUNCHER_SIDE_CARD_WIDTH;
                size_t destination_pixel =
                    (y * LAUNCHER_SIDE_VISIBLE_WIDTH + x) * 2u;
                destination[destination_pixel] = source_row[source_sample * 2u];
                destination[destination_pixel + 1u] =
                    source_row[source_sample * 2u + 1u];
            }
            if (y + 1u == LAUNCHER_SIDE_CARD_HEIGHT) {
                return;
            }
        }
    }
    for (size_t y = 0u; y < LAUNCHER_SIDE_CARD_HEIGHT; ++y) {
        size_t source_y = y * LAUNCHER_COVER_HEIGHT /
                          LAUNCHER_SIDE_CARD_HEIGHT;
        for (size_t x = 0u; x < LAUNCHER_SIDE_VISIBLE_WIDTH; ++x) {
            size_t source_sample = x * LAUNCHER_COVER_WIDTH /
                                   LAUNCHER_SIDE_CARD_WIDTH;
            put_pixel(destination, y * LAUNCHER_SIDE_VISIBLE_WIDTH + x,
                      placeholder_pixel(card, source_x + source_sample,
                                        source_y));
        }
    }
}

static lv_obj_t *create_label(lv_obj_t *parent, int x, int y, int width,
                              int height, const lv_font_t *font,
                              uint32_t color, lv_text_align_t alignment)
{
    lv_obj_t *label = lv_label_create(parent);

    lv_obj_set_pos(label, x, y);
    lv_obj_set_size(label, width, height);
    lv_obj_set_style_text_font(label, font, 0);
    lv_obj_set_style_text_color(label, lv_color_hex(color), 0);
    lv_obj_set_style_text_align(label, alignment, 0);
    lv_label_set_long_mode(label, LV_LABEL_LONG_DOT);
    return label;
}

static lv_obj_t *create_image(lv_obj_t *parent, int x, int y,
                              const lv_image_dsc_t *source)
{
    lv_obj_t *image = lv_image_create(parent);

    lv_obj_set_pos(image, x, y);
    lv_image_set_src(image, source);
    return image;
}

bool launcher_ui_create(void)
{
    lv_obj_t *previous = s_screen;
    lv_obj_t *screen = lv_obj_create(NULL);

    if (screen == NULL) {
        return false;
    }
    if (s_blank_screen == NULL) {
        s_blank_screen = lv_screen_active();
    }
    s_screen = screen;
    lv_obj_remove_style_all(s_screen);
    lv_obj_set_style_bg_color(s_screen, lv_color_hex(COLOR_BACKGROUND), 0);
    lv_obj_set_style_bg_opa(s_screen, LV_OPA_COVER, 0);

    lv_obj_t *header = create_label(s_screen, 12, 8, 156, 20,
                                    &launcher_font_16_gb2312, COLOR_TEXT,
                                    LV_TEXT_ALIGN_LEFT);
    lv_label_set_text(header, "玩法库");
    s_battery = create_label(s_screen, 172, 8, 56, 20,
                             &launcher_font_16_gb2312, COLOR_MUTED,
                             LV_TEXT_ALIGN_RIGHT);

    s_shelf = lv_obj_create(s_screen);
    lv_obj_set_pos(s_shelf, 4, 32);
    lv_obj_set_size(s_shelf, 232, 168);
    lv_obj_set_style_bg_color(s_shelf, lv_color_hex(COLOR_SHELF), 0);
    lv_obj_set_style_bg_opa(s_shelf, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(s_shelf, 0, 0);
    lv_obj_set_style_radius(s_shelf, 8, 0);
    lv_obj_set_style_pad_all(s_shelf, 0, 0);

    s_left_image = create_image(s_screen, LAUNCHER_SIDE_LEFT_X,
                                LAUNCHER_SIDE_Y, &s_left_descriptor);
    s_right_image = create_image(s_screen, LAUNCHER_SIDE_RIGHT_X,
                                 LAUNCHER_SIDE_Y, &s_right_descriptor);
    lv_obj_set_style_opa(s_left_image, LAUNCHER_SIDE_OPACITY, 0);
    lv_obj_set_style_opa(s_right_image, LAUNCHER_SIDE_OPACITY, 0);
    s_center_frame = lv_obj_create(s_screen);
    lv_obj_set_pos(s_center_frame, 56, 32);
    lv_obj_set_size(s_center_frame, 128, 168);
    lv_obj_set_style_bg_opa(s_center_frame, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_color(s_center_frame, lv_color_hex(COLOR_FOCUS), 0);
    lv_obj_set_style_border_width(s_center_frame, 4, 0);
    lv_obj_set_style_radius(s_center_frame, 5, 0);
    lv_obj_set_style_pad_all(s_center_frame, 0, 0);
    s_center_image = create_image(s_screen, 60, 36, &s_center_descriptor);

    s_title = create_label(s_screen, 16, 204, 208, 24,
                           &launcher_font_16_gb2312, COLOR_TEXT,
                           LV_TEXT_ALIGN_CENTER);
    s_metadata = create_label(s_screen, 12, 230, 216, 20,
                              &launcher_font_16_gb2312, COLOR_MUTED,
                              LV_TEXT_ALIGN_CENTER);
    s_message = create_label(s_screen, 12, 254, 216, 22,
                             &launcher_font_16_gb2312, COLOR_TEXT,
                             LV_TEXT_ALIGN_CENTER);
    lv_label_set_long_mode(s_message, LV_LABEL_LONG_WRAP);
    s_indicator = create_label(s_screen, 12, 260, 216, 24,
                               &launcher_font_16_gb2312, COLOR_FOCUS,
                               LV_TEXT_ALIGN_CENTER);
    s_controls = create_label(s_screen, 8, 288, 224, 24,
                              &launcher_font_16_gb2312, COLOR_MUTED,
                              LV_TEXT_ALIGN_CENTER);
    lv_label_set_text(s_controls, "上下切换    确认选择");

    lv_screen_load(s_screen);
    if (previous != NULL && previous != s_screen && previous != s_blank_screen) {
        lv_obj_delete(previous);
    }
    return true;
}

static const char *state_name(launcher_slot_state_t state)
{
    switch (state) {
    case LAUNCHER_SLOT_EMPTY: return "空位置";
    case LAUNCHER_SLOT_INVALID: return "安装不完整";
    case LAUNCHER_SLOT_TRIAL: return "待验证";
    case LAUNCHER_SLOT_READY: return "准备就绪";
    }
    return "未知状态";
}

static void render_indicator(size_t selected, size_t slot_count)
{
    char text[40];

    if (slot_count == 0u) {
        snprintf(text, sizeof(text), "暂无玩法");
    } else {
        snprintf(text, sizeof(text), "位置 %u / %u",
                 (unsigned)selected + 1u, (unsigned)slot_count);
    }
    lv_label_set_text(s_indicator, text);
}

static void render_library(
    const launcher_model_t *model,
    const launcher_cover_record_t covers[LAUNCHER_MAX_SLOTS],
    const launcher_cover_source_t sources[LAUNCHER_MAX_SLOTS],
    const char *status_message)
{
    launcher_cover_view_t view;

    launcher_cover_view_build(model, covers, &view);
    load_center(&view.center, model->slot_count > 0u ?
                &sources[view.center.slot_id] : NULL);
    load_peek(s_left_peek_pixels, &view.left,
              view.left.slot_id < model->slot_count ?
              &sources[view.left.slot_id] : NULL, true);
    load_peek(s_right_peek_pixels, &view.right,
              view.right.slot_id < model->slot_count ?
              &sources[view.right.slot_id] : NULL, false);
    lv_obj_invalidate(s_center_image);
    lv_obj_invalidate(s_left_image);
    lv_obj_invalidate(s_right_image);
    lv_obj_clear_flag(s_center_image, LV_OBJ_FLAG_HIDDEN);
    if (view.left.slot_id < model->slot_count) {
        lv_obj_clear_flag(s_left_image, LV_OBJ_FLAG_HIDDEN);
    } else {
        lv_obj_add_flag(s_left_image, LV_OBJ_FLAG_HIDDEN);
    }
    if (view.right.slot_id < model->slot_count) {
        lv_obj_clear_flag(s_right_image, LV_OBJ_FLAG_HIDDEN);
    } else {
        lv_obj_add_flag(s_right_image, LV_OBJ_FLAG_HIDDEN);
    }
    lv_obj_clear_flag(s_center_frame, LV_OBJ_FLAG_HIDDEN);
    lv_obj_set_size(s_shelf, 232, 168);

    lv_obj_set_pos(s_title, 16, 204);
    lv_obj_set_size(s_title, 208, 24);
    lv_obj_add_flag(s_metadata, LV_OBJ_FLAG_HIDDEN);
    lv_obj_set_pos(s_message, 12, 232);
    lv_obj_set_size(s_message, 216, 22);
    lv_obj_set_style_text_line_space(s_message, 0, 0);

    lv_label_set_text(s_title, view.center.title);
    if (status_message != NULL && status_message[0] != '\0') {
        lv_label_set_text(s_message, status_message);
    } else if (launcher_model_all_empty(model)) {
        lv_label_set_text(s_message, "连接电脑，安装玩法");
    } else if (view.center.state == LAUNCHER_SLOT_EMPTY) {
        lv_label_set_text(s_message, "确认：查看安装帮助");
    } else if (view.center.state == LAUNCHER_SLOT_INVALID) {
        lv_label_set_text(s_message, "确认：查看修复帮助");
    } else {
        lv_label_set_text(s_message, "确认：启动  长按：详情");
    }
    lv_obj_set_style_border_color(
        s_center_frame,
        lv_color_hex(view.center.state == LAUNCHER_SLOT_INVALID ?
                         COLOR_WARNING : COLOR_FOCUS), 0);
    render_indicator(view.center.slot_id, model->slot_count);
    lv_label_set_text(s_controls, "上下切换    确认选择");
}

static void render_secondary(
    const launcher_model_t *model,
    const launcher_cover_record_t covers[LAUNCHER_MAX_SLOTS])
{
    const launcher_slot_info_t *slot = &model->slots[model->selected];
    launcher_cover_view_t view;
    char message[256];
    char first_time[24] = "暂无记录";
    char last_time[24] = "暂无记录";
    char launch_count[24] = "暂无记录";

    launcher_cover_view_build(model, covers, &view);

    lv_obj_add_flag(s_center_image, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(s_left_image, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(s_right_image, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(s_center_frame, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(s_metadata, LV_OBJ_FLAG_HIDDEN);
    lv_obj_set_size(s_shelf, 232, 226);
    lv_obj_set_pos(s_title, 12, 46);
    lv_obj_set_size(s_title, 216, 24);
    lv_obj_set_pos(s_metadata, 12, 74);
    lv_obj_set_size(s_metadata, 216, 24);
    lv_obj_set_pos(s_message, 12, 100);
    lv_obj_set_size(s_message, 216, 136);
    lv_obj_set_style_text_line_space(s_message, 0, 0);
    switch (model->page) {
    case LAUNCHER_PAGE_DETAILS:
        lv_label_set_text(s_title, view.center.title);
        lv_label_set_text(s_metadata, "玩法详情");
        lv_obj_set_style_text_line_space(s_message, -8, 0);
        (void)launcher_format_install_time(
            first_time, sizeof(first_time), slot->first_installed_at,
            slot->first_install_utc_offset_minutes);
        (void)launcher_format_install_time(
            last_time, sizeof(last_time), slot->last_installed_at,
            slot->last_install_utc_offset_minutes);
        if (slot->launch_count_valid) {
            snprintf(launch_count, sizeof(launch_count), "%lu",
                     (unsigned long)slot->launch_count);
        }
        snprintf(message, sizeof(message),
                 "位置：%u  %s\n版本：%s\n首次安装：%s\n最近安装：%s\n启动次数：%s",
                 (unsigned)model->selected + 1u,
                 state_name(view.center.state),
                 view.center.version != NULL && view.center.version[0] != '\0' ?
                     view.center.version : "暂无记录",
                 first_time, last_time, launch_count);
        lv_label_set_text(s_message, message);
        break;
    case LAUNCHER_PAGE_INSTALL_HELP:
        lv_label_set_text(s_title, "添加玩法");
        lv_label_set_text(s_metadata, "请将设备连接到电脑");
        lv_label_set_text(s_message, "打开玩法管理页面并选择安装位置");
        break;
    case LAUNCHER_PAGE_RECOVERY_HELP:
        lv_label_set_text(s_title, "修复位置");
        lv_label_set_text(s_metadata, "玩法安装不完整或无效");
        lv_label_set_text(s_message, "请使用玩法管理页面重新安装");
        break;
    case LAUNCHER_PAGE_LIBRARY:
        return;
    }
    render_indicator(model->selected, model->slot_count);
    lv_label_set_text(s_controls, "确认：返回玩法库");
}

void launcher_ui_render(
    const launcher_model_t *model,
    const launcher_cover_record_t covers[LAUNCHER_MAX_SLOTS],
    const launcher_cover_source_t cover_sources[LAUNCHER_MAX_SLOTS],
    int battery_percent,
    const char *status_message)
{
    if (s_screen == NULL || model == NULL || covers == NULL ||
        cover_sources == NULL) {
        return;
    }
    if (battery_percent >= 0 && battery_percent <= 100) {
        lv_label_set_text_fmt(s_battery, "%d%%", battery_percent);
    } else {
        lv_label_set_text(s_battery, "--");
    }
    if (model->page == LAUNCHER_PAGE_LIBRARY) {
        render_library(model, covers, cover_sources, status_message);
    } else {
        render_secondary(model, covers);
    }
}

void launcher_ui_destroy(void)
{
    lv_obj_t *screen = s_screen;

    if (screen != NULL && s_blank_screen != NULL) {
        lv_screen_load(s_blank_screen);
        lv_obj_delete(screen);
    }
    s_screen = NULL;
    s_battery = NULL;
    s_shelf = NULL;
    s_center_frame = NULL;
    s_center_image = NULL;
    s_left_image = NULL;
    s_right_image = NULL;
    s_title = NULL;
    s_metadata = NULL;
    s_message = NULL;
    s_indicator = NULL;
    s_controls = NULL;
}
