/* Factory Launcher shell: scan the dynamic play library and switch by OTA. */
#include "launcher_boot.h"
#include "launcher_cover_store.h"
#include "launcher_dynamic_sidecar.h"
#include "launcher_model.h"
#include "launcher_slots.h"
#include "launcher_stats.h"
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

#include <stdio.h>
#include <string.h>

#define INPUT_QUEUE_DEPTH 8u

typedef struct {
    bsp_btn_t button;
    bsp_btn_ev_t event;
} input_event_t;

static const char *TAG = "launcher";
static launcher_model_t s_model;
static launcher_slot_info_t s_slots[LAUNCHER_MAX_SLOTS];
static launcher_cover_record_t s_covers[LAUNCHER_MAX_SLOTS];
static launcher_cover_source_t s_cover_sources[LAUNCHER_MAX_SLOTS];
static const esp_partition_t *s_cover_partition;
static size_t s_slot_count;
static QueueHandle_t s_input_queue;
static TaskHandle_t s_input_task;
static volatile bool s_input_ready;
static bool s_battery_available;
static unsigned s_selection_count;
static uint32_t s_heap_after_ui;
static bool s_stats_available;

static bool read_cover_partition(void *context, size_t offset,
                                 void *destination, size_t length)
{
    const esp_partition_t *partition = context;

    return partition != NULL && offset <= partition->size &&
           length <= partition->size - offset &&
           esp_partition_read(partition, offset, destination, length) == ESP_OK;
}

static void scan_covers(void)
{
    memset(s_covers, 0, sizeof(s_covers));
    memset(s_cover_sources, 0, sizeof(s_cover_sources));
    s_cover_partition = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, 0x40, "covers");
    if (s_cover_partition != NULL) {
        launcher_cover_source_t legacy = {
            .read = read_cover_partition,
            .context = (void *)s_cover_partition,
            .size = s_cover_partition->size,
        };
        for (size_t slot = 0u; slot < s_slot_count; ++slot) {
            s_cover_sources[slot] = legacy;
            if (s_slots[slot].state == LAUNCHER_SLOT_READY ||
                s_slots[slot].state == LAUNCHER_SLOT_TRIAL) {
                (void)launcher_cover_store_select(
                    &s_cover_sources[slot], (uint8_t)slot,
                    s_slots[slot].image_sha256, &s_covers[slot]);
            }
        }
        return;
    }
    for (size_t slot = 0u; slot < s_slot_count; ++slot) {
        const esp_partition_t *partition = launcher_slots_partition(slot);
        launcher_dynamic_record_t record;
        if (partition == NULL) {
            continue;
        }
        s_cover_sources[slot] = (launcher_cover_source_t){
            .read = read_cover_partition,
            .context = (void *)partition,
            .size = partition->size,
        };
        if (launcher_dynamic_sidecar_select(
                &s_cover_sources[slot], (uint8_t)slot, partition->size,
                &record)) {
            (void)launcher_dynamic_sidecar_cover(
                &s_cover_sources[slot], partition->size, &record,
                &s_covers[slot]);
        }
    }
}

static void classify_slot_trust(void)
{
    for (size_t slot = 0u; slot < s_slot_count; ++slot) {
        launcher_trust_record_t receipt;

        if (s_slots[slot].state != LAUNCHER_SLOT_READY &&
            s_slots[slot].state != LAUNCHER_SLOT_TRIAL) {
            continue;
        }
        if (s_slots[slot].trust_source == LAUNCHER_TRUST_DYNAMIC_SIDECAR) {
            continue;
        }
        if (s_cover_partition != NULL && launcher_trust_store_select(
                &s_cover_sources[slot], (uint8_t)slot,
                s_slots[slot].image_sha256,
                s_slots[slot].image_size, &receipt)) {
            s_slots[slot].trust_source = LAUNCHER_TRUST_INSTALL_RECEIPT;
            s_slots[slot].first_installed_at = receipt.first_installed_at;
            s_slots[slot].last_installed_at = receipt.last_installed_at;
            s_slots[slot].first_install_utc_offset_minutes =
                receipt.first_install_utc_offset_minutes;
            s_slots[slot].last_install_utc_offset_minutes =
                receipt.last_install_utc_offset_minutes;
            snprintf(s_slots[slot].source_id,
                     sizeof(s_slots[slot].source_id), "%s", receipt.source_id);
        } else if (s_covers[slot].valid) {
            /* V0.1 migration: an older SHA-bound cover is a local receipt. */
            s_slots[slot].trust_source = LAUNCHER_TRUST_LEGACY_COVER;
        } else {
            /* Preserve the established generic-play compatibility contract. */
            s_slots[slot].trust_source = LAUNCHER_TRUST_LEGACY_GENERIC;
            ESP_LOGW(TAG, "Position %u uses legacy generic trust",
                     (unsigned)slot + 1u);
        }
        if (s_slots[slot].source_id[0] == '\0' && s_covers[slot].valid) {
            snprintf(s_slots[slot].source_id,
                     sizeof(s_slots[slot].source_id), "%s",
                     s_covers[slot].manifest.source_id);
        }
    }
}

static void load_launch_counts(void)
{
    if (!s_stats_available) {
        return;
    }
    for (size_t slot = 0u; slot < s_slot_count; ++slot) {
        esp_err_t error;

        if (!launcher_slot_is_bootable(s_slots[slot].state)) {
            continue;
        }
        error = launcher_stats_read(slot, s_slots[slot].source_id,
                                    s_slots[slot].image_sha256,
                                    &s_slots[slot].launch_count);
        s_slots[slot].launch_count_valid = error == ESP_OK;
        if (error != ESP_OK) {
            ESP_LOGW(TAG, "Position %u launch count unavailable: %s",
                     (unsigned)slot + 1u, esp_err_to_name(error));
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
    launcher_ui_render(&s_model, s_covers, s_cover_sources, battery_percent(),
                       status_message);
    bsp_lvgl_unlock();
}

static void refresh_slots(void)
{
    esp_err_t error = launcher_slots_scan(s_slots, &s_slot_count);

    scan_covers();
    classify_slot_trust();
    load_launch_counts();
    launcher_model_refresh(&s_model, s_slots, s_slot_count);
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
        render("正在验证玩法…");
        esp_err_t error = launcher_boot_slot(
            result.slot_id, s_slots[result.slot_id].source_id);
        ESP_LOGE(TAG, "Position %u launch failed: %s",
                 (unsigned)result.slot_id + 1u, esp_err_to_name(error));
        refresh_slots();
        render("启动失败，未切换玩法");
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
    error = launcher_stats_init();
    s_stats_available = error == ESP_OK;
    if (!s_stats_available) {
        ESP_LOGW(TAG, "Launch statistics unavailable: %s",
                 esp_err_to_name(error));
    }
    (void)bsp_i2c_init();
    if (bsp_display_init() != ESP_OK || bsp_lvgl_init() == NULL) {
        ESP_LOGE(TAG,
                 "Display unavailable; check MOSI=%d SCLK=%d CS=%d DC=%d BL=%d",
                 BSP_LCD_MOSI, BSP_LCD_SCLK, BSP_LCD_CS, BSP_LCD_DC, BSP_LCD_BL);
        return;
    }
    bsp_display_backlight(100);

    error = launcher_slots_scan(s_slots, &s_slot_count);
    if (error != ESP_OK) {
        ESP_LOGW(TAG, "Initial position scan error: %s", esp_err_to_name(error));
    }
    scan_covers();
    classify_slot_trust();
    load_launch_counts();
    ESP_LOGI(TAG, "PERF startup scan+trust=%lld ms",
             (long long)((esp_timer_get_time() - started_at) / 1000));
    ESP_LOGI(TAG, "heap after cover scan: %lu",
             (unsigned long)esp_get_free_heap_size());
    launcher_model_init(&s_model, s_slots, s_slot_count);
    s_battery_available = bsp_battery_init() == ESP_OK;

    ESP_LOGI(TAG, "heap before UI: %lu",
             (unsigned long)esp_get_free_heap_size());
    if (!bsp_lvgl_lock(1000)) {
        ESP_LOGE(TAG, "LVGL lock unavailable");
        return;
    }
    bool ui_ready = launcher_ui_create();
    if (ui_ready) {
        launcher_ui_render(&s_model, s_covers, s_cover_sources,
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
        render("按键不可用，请修复后重启");
        return;
    }
    ESP_LOGI(TAG, "Ready: position=%u all_empty=%d battery=%d",
             (unsigned)s_model.selected + 1u,
             launcher_model_all_empty(&s_model), s_battery_available);
}
