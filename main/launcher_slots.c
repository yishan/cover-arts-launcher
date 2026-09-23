#include "launcher_slots.h"

#include "launcher_slot_policy.h"

#include "esp_app_desc.h"
#include "esp_image_format.h"
#include "esp_ota_ops.h"
#include "mbedtls/sha256.h"

#include <string.h>

#define SLOT_HASH_CHUNK_SIZE 1024u

static const char *const SLOT_LABELS[LAUNCHER_SLOT_COUNT] = {
    "ota_0",
    "ota_1",
    "ota_2",
};

static void copy_fixed_string(char *destination, size_t destination_size,
                              const char *source, size_t source_size)
{
    size_t length = 0;

    if (destination_size == 0u) {
        return;
    }
    while (length < source_size && source[length] != '\0') {
        ++length;
    }
    if (length >= destination_size) {
        length = destination_size - 1u;
    }
    memcpy(destination, source, length);
    destination[length] = '\0';
}

const esp_partition_t *launcher_slots_partition(size_t slot_id)
{
    esp_partition_subtype_t subtype;

    if (slot_id >= LAUNCHER_SLOT_COUNT) {
        return NULL;
    }
    subtype = (esp_partition_subtype_t)(ESP_PARTITION_SUBTYPE_APP_OTA_0 +
                                        slot_id);
    return esp_partition_find_first(ESP_PARTITION_TYPE_APP, subtype,
                                    SLOT_LABELS[slot_id]);
}

static esp_err_t partition_prefix_is_erased(const esp_partition_t *partition,
                                            bool *is_erased)
{
    uint8_t prefix[32];
    esp_err_t error;

    if (partition == NULL || is_erased == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    error = esp_partition_read(partition, 0, prefix, sizeof(prefix));
    if (error != ESP_OK) {
        return error;
    }
    *is_erased = true;
    for (size_t index = 0; index < sizeof(prefix); ++index) {
        if (prefix[index] != 0xffu) {
            *is_erased = false;
            break;
        }
    }
    return ESP_OK;
}

static esp_err_t hash_image(const esp_partition_t *partition,
                            uint32_t image_length, uint8_t output[32])
{
    mbedtls_sha256_context context;
    uint8_t buffer[SLOT_HASH_CHUNK_SIZE];
    uint32_t offset = 0;
    esp_err_t error = ESP_OK;

    if (partition == NULL || output == NULL || image_length == 0u ||
        image_length > partition->size) {
        return ESP_ERR_INVALID_ARG;
    }

    mbedtls_sha256_init(&context);
    if (mbedtls_sha256_starts(&context, 0) != 0) {
        mbedtls_sha256_free(&context);
        return ESP_FAIL;
    }
    while (offset < image_length) {
        size_t remaining = image_length - offset;
        size_t chunk_size = remaining < sizeof(buffer) ? remaining : sizeof(buffer);

        error = esp_partition_read(partition, offset, buffer, chunk_size);
        if (error != ESP_OK ||
            mbedtls_sha256_update(&context, buffer, chunk_size) != 0) {
            if (error == ESP_OK) {
                error = ESP_FAIL;
            }
            break;
        }
        offset += chunk_size;
    }
    if (error == ESP_OK && mbedtls_sha256_finish(&context, output) != 0) {
        error = ESP_FAIL;
    }
    mbedtls_sha256_free(&context);
    return error;
}

static launcher_slot_state_t state_from_ota(const esp_partition_t *partition)
{
    esp_ota_img_states_t ota_state;
    esp_err_t error = esp_ota_get_state_partition(partition, &ota_state);

    if (error == ESP_ERR_NOT_FOUND) {
        return launcher_slot_state_from_ota(LAUNCHER_OTA_UNTRACKED);
    }
    if (error != ESP_OK) {
        return launcher_slot_state_from_ota(LAUNCHER_OTA_READ_ERROR);
    }
    switch (ota_state) {
    case ESP_OTA_IMG_NEW:
        return launcher_slot_state_from_ota(LAUNCHER_OTA_NEW);
    case ESP_OTA_IMG_PENDING_VERIFY:
        return launcher_slot_state_from_ota(LAUNCHER_OTA_PENDING_VERIFY);
    case ESP_OTA_IMG_VALID:
        return launcher_slot_state_from_ota(LAUNCHER_OTA_VALID);
    case ESP_OTA_IMG_UNDEFINED:
        return launcher_slot_state_from_ota(LAUNCHER_OTA_UNDEFINED);
    case ESP_OTA_IMG_INVALID:
        return launcher_slot_state_from_ota(LAUNCHER_OTA_INVALID);
    case ESP_OTA_IMG_ABORTED:
        return launcher_slot_state_from_ota(LAUNCHER_OTA_ABORTED);
    }
    return LAUNCHER_SLOT_INVALID;
}

esp_err_t launcher_slots_inspect(size_t slot_id, launcher_slot_info_t *out)
{
    const esp_partition_t *partition;
    esp_partition_pos_t position;
    esp_image_metadata_t metadata;
    esp_app_desc_t description;
    bool is_erased;
    esp_err_t error;

    if (out == NULL || slot_id >= LAUNCHER_SLOT_COUNT) {
        return ESP_ERR_INVALID_ARG;
    }
    memset(out, 0, sizeof(*out));
    out->state = LAUNCHER_SLOT_INVALID;

    partition = launcher_slots_partition(slot_id);
    if (partition == NULL) {
        return ESP_ERR_NOT_FOUND;
    }
    error = partition_prefix_is_erased(partition, &is_erased);
    if (error != ESP_OK) {
        return error;
    }
    if (is_erased) {
        out->state = LAUNCHER_SLOT_EMPTY;
        return ESP_OK;
    }

    position.offset = partition->address;
    position.size = partition->size;
    if (esp_image_verify(ESP_IMAGE_VERIFY_SILENT, &position, &metadata) != ESP_OK ||
        metadata.image_len == 0u || metadata.image_len > partition->size ||
        esp_ota_get_partition_description(partition, &description) != ESP_OK) {
        return ESP_OK;
    }

    out->image_size = metadata.image_len;
    copy_fixed_string(out->project_name, sizeof(out->project_name),
                      description.project_name,
                      sizeof(description.project_name));
    copy_fixed_string(out->version, sizeof(out->version), description.version,
                      sizeof(description.version));
    error = hash_image(partition, metadata.image_len, out->image_sha256);
    if (error != ESP_OK) {
        return error;
    }
    out->state = state_from_ota(partition);
    return ESP_OK;
}

esp_err_t launcher_slots_scan(launcher_slot_info_t out[LAUNCHER_SLOT_COUNT])
{
    esp_err_t first_error = ESP_OK;

    if (out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    for (size_t slot_id = 0; slot_id < LAUNCHER_SLOT_COUNT; ++slot_id) {
        esp_err_t error = launcher_slots_inspect(slot_id, &out[slot_id]);
        if (error != ESP_OK && first_error == ESP_OK) {
            first_error = error;
        }
    }
    return first_error;
}
