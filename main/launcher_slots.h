#ifndef LAUNCHER_SLOTS_H
#define LAUNCHER_SLOTS_H

#include "launcher_model.h"

#include "esp_err.h"
#include "esp_partition.h"

/** Return an OTA partition for a zero-based position, or NULL. */
const esp_partition_t *launcher_slots_partition(size_t slot_id);

/** Return the contiguous number of OTA positions in the active table. */
size_t launcher_slots_count(void);

/** True when the active table uses per-position dynamic sidecars. */
bool launcher_slots_dynamic_layout(void);

/**
 * Verify and describe one position.
 *
 * Empty or invalid images are reported as states with ESP_OK. Flash read or
 * partition-table failures return an error and leave the position invalid.
 */
esp_err_t launcher_slots_inspect(size_t slot_id, launcher_slot_info_t *out);

/** Inspect all current positions, preserving an invalid state for failed reads. */
esp_err_t launcher_slots_scan(launcher_slot_info_t out[LAUNCHER_MAX_SLOTS],
                              size_t *slot_count);

/** Perform full image verification and SHA comparison immediately before boot. */
esp_err_t launcher_slots_verify(size_t slot_id,
                                const launcher_slot_info_t *expected);

#endif
