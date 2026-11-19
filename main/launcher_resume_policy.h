#ifndef LAUNCHER_RESUME_POLICY_H
#define LAUNCHER_RESUME_POLICY_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LAUNCHER_RESUME_SHA256_SIZE 32u

/** Reset origins that affect whether a play session continues. */
typedef enum {
    LAUNCHER_RESET_OTHER = 0,
    LAUNCHER_RESET_POWER_ON,
    LAUNCHER_RESET_DEEP_SLEEP,
} launcher_reset_kind_t;

/** The play staged immediately before the device last restarted. */
typedef struct {
    bool valid;
    size_t slot_id;
    uint8_t image_sha256[LAUNCHER_RESUME_SHA256_SIZE];
} launcher_resume_record_t;

typedef enum {
    /** Show the Play Library; there is no session to continue. */
    LAUNCHER_RESUME_SHOW_LIBRARY = 0,
    /** Stage the recorded position again without user input. */
    LAUNCHER_RESUME_RELAUNCH,
    /** Drop a stale record before showing the Play Library. */
    LAUNCHER_RESUME_DISCARD,
} launcher_resume_action_t;

/**
 * Decide how to handle the play staged before the last restart.
 *
 * Only a deep-sleep wake continues the play: a power cycle, reset, panic, or
 * watchdog restart must still land in the Play Library. The recorded image
 * must still be present and bootable, otherwise the session is stale.
 */
launcher_resume_action_t launcher_resume_decide(
    launcher_reset_kind_t reset_kind,
    const launcher_resume_record_t *record,
    size_t slot_count,
    bool slot_bootable,
    const uint8_t slot_sha256[LAUNCHER_RESUME_SHA256_SIZE]);

#endif
