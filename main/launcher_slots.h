#ifndef LAUNCHER_SLOTS_H
#define LAUNCHER_SLOTS_H

#include "launcher_model.h"

#include "esp_err.h"
#include "esp_partition.h"

/** Return the fixed OTA partition for a zero-based position, or NULL. */
const esp_partition_t *launcher_slots_partition(size_t slot_id);

/**
 * Verify and describe one position.
 *
 * Empty or invalid images are reported as states with ESP_OK. Flash read or
 * partition-table failures return an error and leave the position invalid.
 */
esp_err_t launcher_slots_inspect(size_t slot_id, launcher_slot_info_t *out);

/** Inspect all three positions, preserving an invalid state for failed reads. */
esp_err_t launcher_slots_scan(
    launcher_slot_info_t out[LAUNCHER_SLOT_COUNT]);

#endif
