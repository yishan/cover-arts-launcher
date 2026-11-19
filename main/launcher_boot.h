#ifndef LAUNCHER_BOOT_H
#define LAUNCHER_BOOT_H

#include "esp_err.h"

#include <stdbool.h>
#include <stddef.h>

/**
 * Reverify one position, select it through standard OTA data, and restart.
 *
 * Records the position for a deep-sleep resume. Set count_launch only for a
 * user-initiated launch so automatic sleep resumes do not inflate the count.
 */
esp_err_t launcher_boot_slot(size_t slot_id, const char *source_id,
                             bool count_launch);

#endif
