#ifndef LAUNCHER_BOOT_H
#define LAUNCHER_BOOT_H

#include "esp_err.h"

#include <stddef.h>

/** Reverify one position, select it through standard OTA data, and restart. */
esp_err_t launcher_boot_slot(size_t slot_id);

#endif
