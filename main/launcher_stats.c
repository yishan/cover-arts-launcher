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
    char key[8];
    size_t length = sizeof(record);
    esp_err_t error;

    if (slot_id >= LAUNCHER_MAX_SLOTS || launch_count == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    *launch_count = 0u;
    error = make_identity(source_id, firmware_sha256, identity);
    if (error != ESP_OK) {
        return error;
    }
    error = nvs_open(STATS_NAMESPACE, NVS_READONLY, &handle);
    if (error == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }
    if (error != ESP_OK) {
        return error;
    }
    key_for_slot(slot_id, key);
    error = nvs_get_blob(handle, key, &record, &length);
    nvs_close(handle);
    if (error == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }
    if (error != ESP_OK) {
        return error;
    }
    if (length == sizeof(record) && record.magic == STATS_MAGIC &&
        memcmp(record.identity, identity, sizeof(identity)) == 0) {
        *launch_count = record.count;
    }
    return ESP_OK;
}

esp_err_t launcher_stats_record_launch(size_t slot_id, const char *source_id,
                                       const uint8_t firmware_sha256[32],
                                       uint32_t *launch_count)
{
    nvs_handle_t handle;
    stats_record_t record = {.magic = STATS_MAGIC};
    stats_record_t existing;
    char key[8];
    size_t length = sizeof(existing);
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
    key_for_slot(slot_id, key);
    error = nvs_get_blob(handle, key, &existing, &length);
    if (error == ESP_OK && length == sizeof(existing) &&
        existing.magic == STATS_MAGIC &&
        memcmp(existing.identity, record.identity, 32u) == 0) {
        record.count = existing.count == UINT32_MAX ? UINT32_MAX :
                       existing.count + 1u;
    } else if (error == ESP_ERR_NVS_NOT_FOUND || error == ESP_OK) {
        record.count = 1u;
    } else {
        nvs_close(handle);
        return error;
    }
    error = nvs_set_blob(handle, key, &record, sizeof(record));
    if (error == ESP_OK) {
        error = nvs_commit(handle);
    }
    nvs_close(handle);
    if (error == ESP_OK && launch_count != NULL) {
        *launch_count = record.count;
    }
    return error;
}
