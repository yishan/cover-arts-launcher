/* Factory Launcher shell: scan three positions, render, and switch by OTA. */
#include "launcher_boot.h"
#include "launcher_cover_store.h"
#include "launcher_model.h"
#include "launcher_slots.h"
#include "launcher_trust_store.h"
#include "launcher_ui.h"

#include "bsp_battery.h"
#include "bsp_button.h"
#include "bsp_display.h"
#include "bsp_i2c.h"
#include "bsp_pins.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_partition.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#define INPUT_QUEUE_DEPTH 8u

typedef struct {
    bsp_btn_t button;
    bsp_btn_ev_t event;
} input_event_t;

static const char *TAG = "launcher";
static launcher_model_t s_model;
static launcher_slot_info_t s_slots[LAUNCHER_SLOT_COUNT];
static launcher_cover_record_t s_covers[LAUNCHER_SLOT_COUNT];
static launcher_cover_source_t s_cover_source;
static const esp_partition_t *s_cover_partition;
static QueueHandle_t s_input_queue;
static TaskHandle_t s_input_task;
static volatile bool s_input_ready;
static bool s_battery_available;
static unsigned s_selection_count;
static uint32_t s_heap_after_ui;

static bool read_cover_partition(void *context, size_t offset,
                                 void *destination, size_t length)
{
    const esp_partition_t *partition = context;

    return partition != NULL && offset <= partition->size &&
           length <= partition->size - offset &&
           esp_partition_read(partition, offset, destination, length) == ESP_OK;
}

static const launcher_cover_source_t *cover_source(void)
{
    return s_cover_partition != NULL ? &s_cover_source : NULL;
}

static void scan_covers(void)
{
    s_cover_partition = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, 0x40, "covers");
    s_cover_source = (launcher_cover_source_t){0};
    if (s_cover_partition != NULL) {
        s_cover_source.read = read_cover_partition;
        s_cover_source.context = (void *)s_cover_partition;
        s_cover_source.size = s_cover_partition->size;
    }
    for (size_t slot = 0u; slot < LAUNCHER_SLOT_COUNT; ++slot) {
        s_covers[slot] = (launcher_cover_record_t){0};
        if (s_cover_partition != NULL &&
            (s_slots[slot].state == LAUNCHER_SLOT_READY ||
             s_slots[slot].state == LAUNCHER_SLOT_TRIAL)) {
            (void)launcher_cover_store_select(&s_cover_source, (uint8_t)slot,
                                              s_slots[slot].image_sha256,
                                              &s_covers[slot]);
        }
    }
}

static void classify_slot_trust(void)
{
    for (size_t slot = 0u; slot < LAUNCHER_SLOT_COUNT; ++slot) {
        launcher_trust_record_t receipt;

        if (s_slots[slot].state != LAUNCHER_SLOT_READY &&
            s_slots[slot].state != LAUNCHER_SLOT_TRIAL) {
            continue;
        }
        if (s_cover_partition != NULL && launcher_trust_store_select(
                &s_cover_source, (uint8_t)slot, s_slots[slot].image_sha256,
                s_slots[slot].image_size, &receipt)) {
            s_slots[slot].trust_source = LAUNCHER_TRUST_INSTALL_RECEIPT;
        } else if (s_covers[slot].valid) {
            /* V0.1 migration: an older SHA-bound cover is a local receipt. */
            s_slots[slot].trust_source = LAUNCHER_TRUST_LEGACY_COVER;
        } else {
            /* Preserve the established generic-play compatibility contract. */
            s_slots[slot].trust_source = LAUNCHER_TRUST_LEGACY_GENERIC;
            ESP_LOGW(TAG, "Position %u uses legacy generic trust",
                     (unsigned)slot + 1u);
        }
    }
}

static launcher_input_t map_input(const input_event_t *input)
{
    if (input == NULL) {
        return LAUNCHER_INPUT_NONE;
    }
    if (input->button == BSP_BTN_OK && input->event == BSP_BTN_LONG) {
        return LAUNCHER_INPUT_OK_LONG;
    }
    if (input->event != BSP_BTN_CLICK) {
        return LAUNCHER_INPUT_NONE;
    }
    switch (input->button) {
    case BSP_BTN_UP:
        return LAUNCHER_INPUT_UP;
    case BSP_BTN_DOWN:
        return LAUNCHER_INPUT_DOWN;
    case BSP_BTN_OK:
        return LAUNCHER_INPUT_OK;
    }
    return LAUNCHER_INPUT_NONE;
}

static int battery_percent(void)
{
    return s_battery_available ? bsp_battery_soc() : -1;
}

static void render(const char *status_message)
{
    if (!bsp_lvgl_lock(500)) {
        ESP_LOGW(TAG, "LVGL lock timeout while rendering");
        return;
    }
    launcher_ui_render(&s_model, s_covers, cover_source(), battery_percent(),
                       status_message);
    bsp_lvgl_unlock();
}

static void refresh_slots(void)
{
    esp_err_t error = launcher_slots_scan(s_slots);

    scan_covers();
    classify_slot_trust();
    launcher_model_refresh(&s_model, s_slots);
    if (error != ESP_OK) {
        ESP_LOGW(TAG, "Position scan completed with error: %s",
                 esp_err_to_name(error));
    }
}

static void process_input(const input_event_t *input)
{
    launcher_input_t mapped = map_input(input);
    launcher_result_t result;

    if (mapped == LAUNCHER_INPUT_NONE) {
        return;
    }
    result = launcher_model_handle(&s_model, mapped);
    switch (result.action) {
    case LAUNCHER_ACTION_LAUNCH: {
        render("Verifying firmware...");
        esp_err_t error = launcher_boot_slot(result.slot_id);
        ESP_LOGE(TAG, "Position %u launch failed: %s",
                 (unsigned)result.slot_id + 1u, esp_err_to_name(error));
        refresh_slots();
        render("Launch failed; firmware was not selected");
        break;
    }
    case LAUNCHER_ACTION_SELECTION_CHANGED:
        ++s_selection_count;
        if (s_selection_count == 100u) {
            uint32_t current = esp_get_free_heap_size();
            ESP_LOGI(TAG, "heap after 100 selections: %lu",
                     (unsigned long)current);
            if (current < s_heap_after_ui) {
                ESP_LOGW(TAG, "selection heap drift: baseline=%lu current=%lu",
                         (unsigned long)s_heap_after_ui,
                         (unsigned long)current);
            }
        }
        render(NULL);
        break;
    case LAUNCHER_ACTION_SHOW_DETAILS:
    case LAUNCHER_ACTION_SHOW_INSTALL_HELP:
    case LAUNCHER_ACTION_SHOW_RECOVERY_HELP:
    case LAUNCHER_ACTION_SHOW_LIBRARY:
        render(NULL);
        break;
    case LAUNCHER_ACTION_REFRESH:
        refresh_slots();
        render(NULL);
        break;
    case LAUNCHER_ACTION_NONE:
        break;
    }
}

static void input_task(void *argument)
{
    input_event_t input;

    (void)argument;
    for (;;) {
        if (xQueueReceive(s_input_queue, &input, portMAX_DELAY) == pdTRUE) {
            process_input(&input);
        }
    }
}

/* Button callbacks run on the button component's timer task: enqueue only. */
static void on_key(bsp_btn_t button, bsp_btn_ev_t event, void *user)
{
    input_event_t input = {
        .button = button,
        .event = event,
    };

    (void)user;
    if (!s_input_ready || s_input_queue == NULL) {
        return;
    }
    (void)xQueueSend(s_input_queue, &input, 0);
}

static esp_err_t start_input(void)
{
    s_input_queue = xQueueCreate(INPUT_QUEUE_DEPTH, sizeof(input_event_t));
    if (s_input_queue == NULL) {
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreate(input_task, "launcher_input", 4096, NULL, 5,
                    &s_input_task) != pdPASS) {
        vQueueDelete(s_input_queue);
        s_input_queue = NULL;
        return ESP_ERR_NO_MEM;
    }
    esp_err_t error = bsp_button_init(on_key, NULL);
    if (error != ESP_OK) {
        vTaskDelete(s_input_task);
        s_input_task = NULL;
        vQueueDelete(s_input_queue);
        s_input_queue = NULL;
        return error;
    }
    s_input_ready = true;
    return ESP_OK;
}

void app_main(void)
{
    esp_err_t error;
    int64_t started_at = esp_timer_get_time();

    ESP_LOGI(TAG, "Cover Art Launcher bring-up shell");
    (void)bsp_i2c_init();
    if (bsp_display_init() != ESP_OK || bsp_lvgl_init() == NULL) {
        ESP_LOGE(TAG,
                 "Display unavailable; check MOSI=%d SCLK=%d CS=%d DC=%d BL=%d",
                 BSP_LCD_MOSI, BSP_LCD_SCLK, BSP_LCD_CS, BSP_LCD_DC, BSP_LCD_BL);
        return;
    }
    bsp_display_backlight(100);

    error = launcher_slots_scan(s_slots);
    if (error != ESP_OK) {
        ESP_LOGW(TAG, "Initial position scan error: %s", esp_err_to_name(error));
    }
    scan_covers();
    classify_slot_trust();
    ESP_LOGI(TAG, "PERF startup scan+trust=%lld ms",
             (long long)((esp_timer_get_time() - started_at) / 1000));
    ESP_LOGI(TAG, "heap after cover scan: %lu",
             (unsigned long)esp_get_free_heap_size());
    launcher_model_init(&s_model, s_slots);
    s_battery_available = bsp_battery_init() == ESP_OK;

    ESP_LOGI(TAG, "heap before UI: %lu",
             (unsigned long)esp_get_free_heap_size());
    if (!bsp_lvgl_lock(1000)) {
        ESP_LOGE(TAG, "LVGL lock unavailable");
        return;
    }
    bool ui_ready = launcher_ui_create();
    if (ui_ready) {
        launcher_ui_render(&s_model, s_covers, cover_source(),
                           battery_percent(), NULL);
    }
    bsp_lvgl_unlock();
    if (!ui_ready) {
        ESP_LOGE(TAG, "Launcher UI allocation failed");
        return;
    }
    s_heap_after_ui = esp_get_free_heap_size();
    ESP_LOGI(TAG, "PERF startup ui-ready=%lld ms",
             (long long)((esp_timer_get_time() - started_at) / 1000));

    error = start_input();
    if (error != ESP_OK) {
        ESP_LOGE(TAG, "Buttons unavailable: %s", esp_err_to_name(error));
        render("Buttons unavailable; restart after repair");
        return;
    }
    ESP_LOGI(TAG, "Ready: position=%u all_empty=%d battery=%d",
             (unsigned)s_model.selected + 1u,
             launcher_model_all_empty(&s_model), s_battery_available);
}
