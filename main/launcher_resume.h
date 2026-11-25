#ifndef LAUNCHER_RESUME_H
#define LAUNCHER_RESUME_H

#include "launcher_resume_policy.h"

#include "esp_err.h"

/** Load the recorded session. NVS must already be initialized. */
esp_err_t launcher_resume_load(launcher_resume_record_t *record);

/** Record a successfully staged play so a sleep wake can restore it. */
esp_err_t launcher_resume_save(
    size_t slot_id,
    const uint8_t image_sha256[LAUNCHER_RESUME_SHA256_SIZE]);

/** Forget the recorded session after a restart that ends the play. */
esp_err_t launcher_resume_clear(void);

#endif
