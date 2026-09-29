#ifndef LAUNCHER_STATS_H
#define LAUNCHER_STATS_H

#include "esp_err.h"

#include <stddef.h>
#include <stdint.h>

esp_err_t launcher_stats_init(void);
esp_err_t launcher_stats_read(size_t slot_id, const char *source_id,
                              const uint8_t firmware_sha256[32],
                              uint32_t *launch_count);
esp_err_t launcher_stats_record_launch(size_t slot_id, const char *source_id,
                                       const uint8_t firmware_sha256[32],
                                       uint32_t *launch_count);

#endif
