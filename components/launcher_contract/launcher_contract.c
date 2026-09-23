#include "launcher_contract.h"

#include "esp_image_format.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_system.h"

esp_err_t launcher_contract_mark_valid(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();

    if (running == NULL || running->type != ESP_PARTITION_TYPE_APP ||
        running->subtype < ESP_PARTITION_SUBTYPE_APP_OTA_0 ||
        running->subtype >= ESP_PARTITION_SUBTYPE_APP_OTA_MAX) {
        return ESP_ERR_INVALID_STATE;
    }
    return esp_ota_mark_app_valid_cancel_rollback();
}

esp_err_t launcher_contract_return_to_factory(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *factory = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_FACTORY, "factory");
    esp_partition_pos_t position;
    esp_image_metadata_t metadata;
    esp_err_t error;

    if (factory == NULL) {
        return ESP_ERR_NOT_FOUND;
    }
    if (running == factory) {
        return ESP_ERR_INVALID_STATE;
    }
    position.offset = factory->address;
    position.size = factory->size;
    if (esp_image_verify(ESP_IMAGE_VERIFY, &position, &metadata) != ESP_OK) {
        return ESP_ERR_OTA_VALIDATE_FAILED;
    }
    error = esp_ota_set_boot_partition(factory);
    if (error != ESP_OK) {
        return error;
    }
    esp_restart();
    return ESP_OK;
}
