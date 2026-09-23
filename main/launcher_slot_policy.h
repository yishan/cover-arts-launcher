#ifndef LAUNCHER_SLOT_POLICY_H
#define LAUNCHER_SLOT_POLICY_H

#include "launcher_model.h"

/**
 * Host-testable OTA states used to classify an otherwise valid app image.
 *
 * ABORTED is the expected state after an unadapted one-shot play is reset and
 * the ESP-IDF rollback bootloader returns to the factory Launcher.
 */
typedef enum {
    LAUNCHER_OTA_UNTRACKED = 0,
    LAUNCHER_OTA_NEW,
    LAUNCHER_OTA_PENDING_VERIFY,
    LAUNCHER_OTA_VALID,
    LAUNCHER_OTA_INVALID,
    LAUNCHER_OTA_ABORTED,
    LAUNCHER_OTA_UNDEFINED,
    LAUNCHER_OTA_READ_ERROR,
} launcher_ota_state_t;

launcher_slot_state_t launcher_slot_state_from_ota(
    launcher_ota_state_t ota_state);

#endif
