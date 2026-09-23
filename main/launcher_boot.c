#include "launcher_boot.h"

#include "launcher_model.h"
#include "launcher_cover_store.h"
#include "launcher_slots.h"
#include "launcher_trust_store.h"

#include "esp_image_format.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "esp_log.h"
#include "esp_partition.h"
#include "esp_timer.h"

static const char *TAG = "launcher_boot";

static bool read_cover_partition(void *context, size_t offset,
                                 void *destination, size_t length)
{
    const esp_partition_t *partition = context;

    return partition != NULL && offset <= partition->size &&
           length <= partition->size - offset &&
           esp_partition_read(partition, offset, destination, length) == ESP_OK;
}

static launcher_trust_source_t slot_trust_source(
    size_t slot_id, const launcher_slot_info_t *slot)
{
    const esp_partition_t *covers = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, 0x40, "covers");
    launcher_cover_source_t source = {
        .read = read_cover_partition,
        .context = (void *)covers,
        .size = covers != NULL ? covers->size : 0u,
    };
    launcher_trust_record_t receipt;
    launcher_cover_record_t legacy_cover;

    if (covers != NULL && slot != NULL && launcher_trust_store_select(
            &source, (uint8_t)slot_id, slot->image_sha256,
            slot->image_size, &receipt)) {
        return LAUNCHER_TRUST_INSTALL_RECEIPT;
    }
    if (covers != NULL && slot != NULL && launcher_cover_store_select(
            &source, (uint8_t)slot_id, slot->image_sha256, &legacy_cover)) {
        return LAUNCHER_TRUST_LEGACY_COVER;
    }
    return LAUNCHER_TRUST_LEGACY_GENERIC;
}

esp_err_t launcher_boot_slot(size_t slot_id)
{
    launcher_slot_info_t slot;
    const esp_partition_t *partition;
    esp_partition_pos_t position;
    esp_image_metadata_t metadata;
    esp_err_t error;
    int64_t started_at = esp_timer_get_time();
    launcher_trust_source_t trust_source;

    error = launcher_slots_inspect(slot_id, &slot);
    if (error != ESP_OK) {
        return error;
    }
    if (!launcher_slot_is_bootable(slot.state)) {
        return ESP_ERR_INVALID_STATE;
    }
    ESP_LOGI(TAG, "PERF slot=%u inspect=%lld ms", (unsigned)slot_id + 1u,
             (long long)((esp_timer_get_time() - started_at) / 1000));
    trust_source = slot_trust_source(slot_id, &slot);
    ESP_LOGI(TAG, "PERF slot=%u trust=%lld ms source=%d",
             (unsigned)slot_id + 1u,
             (long long)((esp_timer_get_time() - started_at) / 1000),
             (int)trust_source);
    if (trust_source == LAUNCHER_TRUST_LEGACY_GENERIC) {
        ESP_LOGW(TAG, "Position %u has no SHA-bound receipt; allowing generic compatibility launch",
                 (unsigned)slot_id + 1u);
    }

    partition = launcher_slots_partition(slot_id);
    if (partition == NULL) {
        return ESP_ERR_NOT_FOUND;
    }
    position.offset = partition->address;
    position.size = partition->size;
    if (esp_image_verify(ESP_IMAGE_VERIFY, &position, &metadata) != ESP_OK) {
        return ESP_ERR_OTA_VALIDATE_FAILED;
    }
    ESP_LOGI(TAG, "PERF slot=%u verify=%lld ms", (unsigned)slot_id + 1u,
             (long long)((esp_timer_get_time() - started_at) / 1000));
    error = esp_ota_set_boot_partition(partition);
    if (error != ESP_OK) {
        return error;
    }
    ESP_LOGI(TAG, "PERF slot=%u restart=%lld ms", (unsigned)slot_id + 1u,
             (long long)((esp_timer_get_time() - started_at) / 1000));
    esp_restart();
    return ESP_OK;
}
