#include "launcher_ui.h"

#include "launcher_cover_view.h"
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
                                    &lv_font_montserrat_14, COLOR_TEXT,
                                    LV_TEXT_ALIGN_LEFT);
    lv_label_set_text(header, "PLAY LIBRARY");
    s_battery = create_label(s_screen, 172, 8, 56, 20,
                             &lv_font_montserrat_14, COLOR_MUTED,
                             LV_TEXT_ALIGN_RIGHT);

    lv_obj_t *shelf = lv_obj_create(s_screen);
    lv_obj_set_pos(shelf, 4, 32);
    lv_obj_set_size(shelf, 232, 168);
    lv_obj_set_style_bg_color(shelf, lv_color_hex(COLOR_SHELF), 0);
    lv_obj_set_style_bg_opa(shelf, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(shelf, 0, 0);
    lv_obj_set_style_radius(shelf, 8, 0);
    lv_obj_set_style_pad_all(shelf, 0, 0);

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
    s_metadata = create_label(s_screen, 16, 230, 208, 18,
                              &lv_font_montserrat_14, COLOR_MUTED,
                              LV_TEXT_ALIGN_CENTER);
    s_message = create_label(s_screen, 12, 248, 216, 34,
                             &lv_font_montserrat_14, COLOR_TEXT,
                             LV_TEXT_ALIGN_CENTER);
    lv_label_set_long_mode(s_message, LV_LABEL_LONG_WRAP);
    s_indicator = create_label(s_screen, 12, 282, 216, 18,
                               &lv_font_montserrat_14, COLOR_FOCUS,
                               LV_TEXT_ALIGN_CENTER);
    s_controls = create_label(s_screen, 8, 301, 224, 18,
                              &lv_font_montserrat_14, COLOR_MUTED,
                              LV_TEXT_ALIGN_CENTER);
    lv_label_set_text(s_controls, "UP/DOWN    OK SELECT");

    lv_screen_load(s_screen);
    if (previous != NULL && previous != s_screen && previous != s_blank_screen) {
        lv_obj_delete(previous);
    }
    return true;
}

static const char *state_name(launcher_slot_state_t state)
{
    switch (state) {
    case LAUNCHER_SLOT_EMPTY: return "EMPTY";
    case LAUNCHER_SLOT_INVALID: return "INCOMPLETE";
    case LAUNCHER_SLOT_TRIAL: return "TRIAL";
    case LAUNCHER_SLOT_READY: return "READY";
    }
    return "UNKNOWN";
}

static void render_indicator(size_t selected)
{
    char text[24];

    snprintf(text, sizeof(text), "%s  %s  %s",
             selected == 0u ? "[1]" : " 1 ",
             selected == 1u ? "[2]" : " 2 ",
             selected == 2u ? "[3]" : " 3 ");
    lv_label_set_text(s_indicator, text);
}

static void render_library(
    const launcher_model_t *model,
    const launcher_cover_record_t covers[LAUNCHER_SLOT_COUNT],
    const launcher_cover_source_t *source, const char *status_message)
{
    launcher_cover_view_t view;
    char metadata[80];

    launcher_cover_view_build(model, covers, &view);
    load_center(&view.center, source);
    load_peek(s_left_peek_pixels, &view.left, source, true);
    load_peek(s_right_peek_pixels, &view.right, source, false);
    lv_obj_invalidate(s_center_image);
    lv_obj_invalidate(s_left_image);
    lv_obj_invalidate(s_right_image);
    lv_obj_clear_flag(s_center_image, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(s_left_image, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(s_right_image, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(s_center_frame, LV_OBJ_FLAG_HIDDEN);

    lv_label_set_text(s_title, view.center.title);
    if (view.center.version != NULL && view.center.version[0] != '\0') {
        snprintf(metadata, sizeof(metadata), "SLOT %u  |  %s  |  %s",
                 (unsigned)view.center.slot_id + 1u, view.center.version,
                 state_name(view.center.state));
    } else {
        snprintf(metadata, sizeof(metadata), "SLOT %u  |  %s",
                 (unsigned)view.center.slot_id + 1u,
                 state_name(view.center.state));
    }
    lv_label_set_text(s_metadata, metadata);
    if (status_message != NULL && status_message[0] != '\0') {
        lv_label_set_text(s_message, status_message);
    } else if (launcher_model_all_empty(model)) {
        lv_label_set_text(s_message, "Connect to a computer\nto add a play");
    } else if (view.center.state == LAUNCHER_SLOT_EMPTY) {
        lv_label_set_text(s_message, "OK: installation help");
    } else if (view.center.state == LAUNCHER_SLOT_INVALID) {
        lv_label_set_text(s_message, "OK: repair help");
    } else {
        lv_label_set_text(s_message, "OK: launch  |  Hold: details");
    }
    lv_obj_set_style_border_color(
        s_center_frame,
        lv_color_hex(view.center.state == LAUNCHER_SLOT_INVALID ?
                         COLOR_WARNING : COLOR_FOCUS), 0);
    render_indicator(view.center.slot_id);
    lv_label_set_text(s_controls, "UP/DOWN    OK SELECT");
}

static void render_secondary(const launcher_model_t *model)
{
    const launcher_slot_info_t *slot = &model->slots[model->selected];
    char metadata[80];

    lv_obj_add_flag(s_center_image, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(s_left_image, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(s_right_image, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(s_center_frame, LV_OBJ_FLAG_HIDDEN);
    switch (model->page) {
    case LAUNCHER_PAGE_DETAILS:
        lv_label_set_text(s_title, slot->project_name[0] != '\0' ?
                                      slot->project_name : "POSITION DETAILS");
        snprintf(metadata, sizeof(metadata), "SLOT %u | %s | %lu bytes",
                 (unsigned)model->selected + 1u, state_name(slot->state),
                 (unsigned long)slot->image_size);
        lv_label_set_text(s_metadata, metadata);
        lv_label_set_text(s_message, "Firmware and position information");
        break;
    case LAUNCHER_PAGE_INSTALL_HELP:
        lv_label_set_text(s_title, "ADD A PLAY");
        lv_label_set_text(s_metadata, "Connect this device to a computer");
        lv_label_set_text(s_message, "Open Play Manager and choose a slot");
        break;
    case LAUNCHER_PAGE_RECOVERY_HELP:
        lv_label_set_text(s_title, "REPAIR POSITION");
        lv_label_set_text(s_metadata, "Firmware is incomplete or invalid");
        lv_label_set_text(s_message, "Reinstall it with Play Manager");
        break;
    case LAUNCHER_PAGE_LIBRARY:
        return;
    }
    render_indicator(model->selected);
    lv_label_set_text(s_controls, "Hold OK to return to library");
}

void launcher_ui_render(
    const launcher_model_t *model,
    const launcher_cover_record_t covers[LAUNCHER_SLOT_COUNT],
    const launcher_cover_source_t *cover_source, int battery_percent,
    const char *status_message)
{
    if (s_screen == NULL || model == NULL || covers == NULL) {
        return;
    }
    if (battery_percent >= 0 && battery_percent <= 100) {
        lv_label_set_text_fmt(s_battery, "%d%%", battery_percent);
    } else {
        lv_label_set_text(s_battery, "--");
    }
    if (model->page == LAUNCHER_PAGE_LIBRARY) {
        render_library(model, covers, cover_source, status_message);
    } else {
        render_secondary(model);
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
