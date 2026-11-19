#include "launcher_resume_policy.h"

#include <string.h>

launcher_resume_action_t launcher_resume_decide(
    launcher_reset_kind_t reset_kind,
    const launcher_resume_record_t *record,
    size_t slot_count,
    bool slot_bootable,
    const uint8_t slot_sha256[LAUNCHER_RESUME_SHA256_SIZE])
{
    if (record == NULL || !record->valid) {
        return LAUNCHER_RESUME_SHOW_LIBRARY;
    }
    if (reset_kind != LAUNCHER_RESET_DEEP_SLEEP) {
        return LAUNCHER_RESUME_DISCARD;
    }
    if (record->slot_id >= slot_count || !slot_bootable ||
        slot_sha256 == NULL ||
        memcmp(record->image_sha256, slot_sha256,
               LAUNCHER_RESUME_SHA256_SIZE) != 0) {
        return LAUNCHER_RESUME_DISCARD;
    }
    return LAUNCHER_RESUME_RELAUNCH;
}
