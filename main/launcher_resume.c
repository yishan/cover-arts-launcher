#include "launcher_resume.h"

#include "launcher_model.h"

#include "nvs.h"

#include <string.h>

#define RESUME_NAMESPACE "ca_launcher"
#define RESUME_KEY "resume"
#define RESUME_MAGIC 0x52534D45u /* "RSME" */

typedef struct {
    uint32_t magic;
    uint32_t slot_id;
    uint8_t image_sha256[LAUNCHER_RESUME_SHA256_SIZE];
} resume_blob_t;

esp_err_t launcher_resume_load(launcher_resume_record_t *record)
{
    nvs_handle_t handle;
    resume_blob_t blob;
    size_t length = sizeof(blob);
    esp_err_t error;

    if (record == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    memset(record, 0, sizeof(*record));
    error = nvs_open(RESUME_NAMESPACE, NVS_READONLY, &handle);
    if (error != ESP_OK) {
        return error;
    }
    error = nvs_get_blob(handle, RESUME_KEY, &blob, &length);
    nvs_close(handle);
    if (error != ESP_OK) {
        return error;
    }
    if (length != sizeof(blob) || blob.magic != RESUME_MAGIC ||
        blob.slot_id >= LAUNCHER_MAX_SLOTS) {
        return ESP_ERR_INVALID_STATE;
    }
    record->valid = true;
    record->slot_id = blob.slot_id;
    memcpy(record->image_sha256, blob.image_sha256,
           sizeof(record->image_sha256));
    return ESP_OK;
}

esp_err_t launcher_resume_save(
    size_t slot_id,
    const uint8_t image_sha256[LAUNCHER_RESUME_SHA256_SIZE])
{
    nvs_handle_t handle;
    resume_blob_t blob = {
        .magic = RESUME_MAGIC,
        .slot_id = (uint32_t)slot_id,
    };
    esp_err_t error;

    if (image_sha256 == NULL || slot_id >= LAUNCHER_MAX_SLOTS) {
        return ESP_ERR_INVALID_ARG;
    }
    memcpy(blob.image_sha256, image_sha256, sizeof(blob.image_sha256));
    error = nvs_open(RESUME_NAMESPACE, NVS_READWRITE, &handle);
    if (error != ESP_OK) {
        return error;
    }
    error = nvs_set_blob(handle, RESUME_KEY, &blob, sizeof(blob));
    if (error == ESP_OK) {
        error = nvs_commit(handle);
    }
    nvs_close(handle);
    return error;
}

esp_err_t launcher_resume_clear(void)
{
    nvs_handle_t handle;
    esp_err_t error;

    error = nvs_open(RESUME_NAMESPACE, NVS_READWRITE, &handle);
    if (error != ESP_OK) {
        return error;
    }
    error = nvs_erase_key(handle, RESUME_KEY);
    if (error == ESP_ERR_NVS_NOT_FOUND) {
        error = ESP_OK;
    }
    if (error == ESP_OK) {
        error = nvs_commit(handle);
    }
    nvs_close(handle);
    return error;
}
