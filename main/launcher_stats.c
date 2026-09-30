#include "launcher_stats.h"

#include "launcher_model.h"

#include "mbedtls/sha256.h"
#include "nvs.h"
#include "nvs_flash.h"

#include <limits.h>
#include <stdio.h>
#include <string.h>

#define STATS_NAMESPACE "ca_launcher"
#define STATS_MAGIC 0x53544154u

typedef struct {
    uint32_t magic;
    uint8_t identity[32];
    uint32_t count;
} stats_record_t;

static esp_err_t make_identity(const char *source_id,
                               const uint8_t firmware_sha256[32],
                               uint8_t identity[32])
{
    if (source_id != NULL && source_id[0] != '\0') {
        return mbedtls_sha256((const unsigned char *)source_id,
                              strlen(source_id), identity, 0) == 0 ?
                   ESP_OK : ESP_FAIL;
    }
    if (firmware_sha256 == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    memcpy(identity, firmware_sha256, 32u);
    return ESP_OK;
}

static void key_for_slot(size_t slot_id, char key[8])
{
    snprintf(key, 8u, "slot%u", (unsigned)slot_id);
}

static bool record_matches(const stats_record_t *record,
                           const uint8_t identity[32])
{
    return record->magic == STATS_MAGIC &&
           memcmp(record->identity, identity, 32u) == 0;
}

static esp_err_t find_identity_record(nvs_handle_t handle,
                                      size_t preferred_slot,
                                      const uint8_t identity[32],
                                      stats_record_t *record,
                                      size_t *record_slot)
{
    for (size_t pass = 0u; pass < 2u; ++pass) {
        for (size_t slot = 0u; slot < LAUNCHER_MAX_SLOTS; ++slot) {
            char key[8];
            size_t length = sizeof(*record);
            esp_err_t error;

            if ((pass == 0u && slot != preferred_slot) ||
                (pass == 1u && slot == preferred_slot)) {
                continue;
            }
            key_for_slot(slot, key);
            error = nvs_get_blob(handle, key, record, &length);
            if (error == ESP_ERR_NVS_NOT_FOUND) {
                continue;
            }
            if (error != ESP_OK) {
                return error;
            }
            if (length == sizeof(*record) && record_matches(record, identity)) {
                *record_slot = slot;
                return ESP_OK;
            }
        }
    }
    return ESP_ERR_NOT_FOUND;
}

static esp_err_t store_record_at_slot(nvs_handle_t handle, size_t slot_id,
                                      size_t old_slot,
                                      const stats_record_t *record)
{
    char key[8];
    esp_err_t error;

    key_for_slot(slot_id, key);
    error = nvs_set_blob(handle, key, record, sizeof(*record));
    if (error == ESP_OK && old_slot != slot_id && old_slot < LAUNCHER_MAX_SLOTS) {
        key_for_slot(old_slot, key);
        error = nvs_erase_key(handle, key);
        if (error == ESP_ERR_NVS_NOT_FOUND) {
            error = ESP_OK;
        }
    }
    if (error == ESP_OK) {
        error = nvs_commit(handle);
    }
    return error;
}

esp_err_t launcher_stats_init(void)
{
    return nvs_flash_init();
}

esp_err_t launcher_stats_read(size_t slot_id, const char *source_id,
                              const uint8_t firmware_sha256[32],
                              uint32_t *launch_count)
{
    nvs_handle_t handle;
    stats_record_t record;
    uint8_t identity[32];
    size_t record_slot = LAUNCHER_MAX_SLOTS;
    esp_err_t error;

    if (slot_id >= LAUNCHER_MAX_SLOTS || launch_count == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    *launch_count = 0u;
    error = make_identity(source_id, firmware_sha256, identity);
    if (error != ESP_OK) {
        return error;
    }
    error = nvs_open(STATS_NAMESPACE, NVS_READWRITE, &handle);
    if (error != ESP_OK) {
        return error;
    }
    error = find_identity_record(handle, slot_id, identity, &record,
                                 &record_slot);
    if (error == ESP_OK) {
        *launch_count = record.count;
        if (record_slot != slot_id) {
            error = store_record_at_slot(handle, slot_id, record_slot, &record);
        }
    } else if (error == ESP_ERR_NOT_FOUND) {
        error = ESP_OK;
    }
    nvs_close(handle);
    return error;
}

esp_err_t launcher_stats_record_launch(size_t slot_id, const char *source_id,
                                       const uint8_t firmware_sha256[32],
                                       uint32_t *launch_count)
{
    nvs_handle_t handle;
    stats_record_t record = {.magic = STATS_MAGIC};
    stats_record_t existing;
    size_t record_slot = LAUNCHER_MAX_SLOTS;
    esp_err_t error;

    if (slot_id >= LAUNCHER_MAX_SLOTS) {
        return ESP_ERR_INVALID_ARG;
    }
    error = make_identity(source_id, firmware_sha256, record.identity);
    if (error != ESP_OK) {
        return error;
    }
    error = nvs_open(STATS_NAMESPACE, NVS_READWRITE, &handle);
    if (error != ESP_OK) {
        return error;
    }
    error = find_identity_record(handle, slot_id, record.identity, &existing,
                                 &record_slot);
    if (error == ESP_OK) {
        record.count = existing.count == UINT32_MAX ? UINT32_MAX :
                       existing.count + 1u;
    } else if (error == ESP_ERR_NOT_FOUND) {
        record.count = 1u;
    } else {
        nvs_close(handle);
        return error;
    }
    error = store_record_at_slot(handle, slot_id, record_slot, &record);
    nvs_close(handle);
    if (error == ESP_OK && launch_count != NULL) {
        *launch_count = record.count;
    }
    return error;
}
