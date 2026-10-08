#include "launcher_slots.h"

#include "launcher_dynamic_sidecar.h"
#include "launcher_slot_policy.h"

#include "esp_app_desc.h"
#include "esp_image_format.h"
#include "esp_ota_ops.h"
#include "mbedtls/sha256.h"

#include <string.h>

#define SLOT_HASH_CHUNK_SIZE 1024u

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
    const esp_partition_t *partition;

    if (slot_id >= LAUNCHER_MAX_SLOTS) {
        return NULL;
    }
    subtype = (esp_partition_subtype_t)(ESP_PARTITION_SUBTYPE_APP_OTA_0 +
                                        slot_id);
    partition = esp_partition_find_first(ESP_PARTITION_TYPE_APP, subtype, NULL);
    if (partition != NULL && launcher_slots_dynamic_layout()) {
        const esp_partition_t *factory = esp_partition_find_first(
            ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_FACTORY, NULL);
        uint32_t arena_start;
        if (factory == NULL || !launcher_dynamic_arena_start(
                factory->address, factory->size, &arena_start) ||
            !launcher_dynamic_allocation_valid(arena_start,
                                               partition->address,
                                               partition->size)) {
            return NULL;
        }
    }
    return partition;
}

size_t launcher_slots_count(void)
{
    size_t count = 0u;
    while (count < LAUNCHER_MAX_SLOTS &&
           launcher_slots_partition(count) != NULL) {
        ++count;
    }
    return count;
}

bool launcher_slots_dynamic_layout(void)
{
    return esp_partition_find_first(ESP_PARTITION_TYPE_DATA, 0x40,
                                    "covers") == NULL;
}

static bool read_partition(void *context, size_t offset,
                           void *destination, size_t length)
{
    const esp_partition_t *partition = context;
    return partition != NULL && offset <= partition->size &&
           length <= partition->size - offset &&
           esp_partition_read(partition, offset, destination, length) == ESP_OK;
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

    if (out == NULL || slot_id >= LAUNCHER_MAX_SLOTS) {
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
        out->state = launcher_slots_dynamic_layout() ? LAUNCHER_SLOT_INVALID :
                                                       LAUNCHER_SLOT_EMPTY;
        return ESP_OK;
    }

    if (launcher_slots_dynamic_layout()) {
        uint8_t header[24];
        launcher_cover_source_t source = {
            .read = read_partition,
            .context = (void *)partition,
            .size = partition->size,
        };
        launcher_dynamic_record_t record;

        if (esp_partition_read(partition, 0u, header, sizeof(header)) != ESP_OK ||
            header[0] != 0xe9u || header[1] == 0u || header[1] > 16u ||
            header[12] != 5u || header[13] != 0u ||
            !launcher_dynamic_sidecar_select(&source, (uint8_t)slot_id,
                                             partition->size, &record)) {
            return ESP_OK;
        }
        out->state = LAUNCHER_SLOT_READY;
        out->image_size = record.image_length;
        memcpy(out->image_sha256, record.firmware_sha256, 32u);
        out->trust_source = LAUNCHER_TRUST_DYNAMIC_SIDECAR;
        copy_fixed_string(out->project_name, sizeof(out->project_name),
                          record.title, sizeof(record.title));
        copy_fixed_string(out->version, sizeof(out->version), record.version,
                          sizeof(record.version));
        copy_fixed_string(out->source_id, sizeof(out->source_id),
                          record.source_id, sizeof(record.source_id));
        out->first_installed_at = record.first_installed_at;
        out->last_installed_at = record.last_installed_at;
        out->first_install_utc_offset_minutes =
            record.first_utc_offset_minutes;
        out->last_install_utc_offset_minutes = record.last_utc_offset_minutes;
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

esp_err_t launcher_slots_scan(launcher_slot_info_t out[LAUNCHER_MAX_SLOTS],
                              size_t *slot_count)
{
    esp_err_t first_error = ESP_OK;
    size_t count;

    if (out == NULL || slot_count == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    memset(out, 0, sizeof(*out) * LAUNCHER_MAX_SLOTS);
    count = launcher_slots_count();
    *slot_count = count;
    for (size_t slot_id = 0; slot_id < count; ++slot_id) {
        esp_err_t error = launcher_slots_inspect(slot_id, &out[slot_id]);
        if (error != ESP_OK && first_error == ESP_OK) {
            first_error = error;
        }
    }
    return first_error;
}

esp_err_t launcher_slots_verify(size_t slot_id,
                                const launcher_slot_info_t *expected)
{
    const esp_partition_t *partition = launcher_slots_partition(slot_id);
    esp_partition_pos_t position;
    esp_image_metadata_t metadata;
    uint8_t digest[32];
    esp_err_t error;

    if (partition == NULL || expected == NULL || expected->image_size == 0u ||
        expected->image_size > partition->size) {
        return ESP_ERR_INVALID_ARG;
    }
    position.offset = partition->address;
    position.size = partition->size;
    if (esp_image_verify(ESP_IMAGE_VERIFY, &position, &metadata) != ESP_OK ||
        metadata.image_len != expected->image_size) {
        return ESP_ERR_OTA_VALIDATE_FAILED;
    }
    error = hash_image(partition, expected->image_size, digest);
    if (error != ESP_OK) {
        return error;
    }
    return memcmp(digest, expected->image_sha256, sizeof(digest)) == 0 ?
               ESP_OK : ESP_ERR_INVALID_CRC;
}
