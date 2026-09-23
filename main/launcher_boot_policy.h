#ifndef LAUNCHER_BOOT_POLICY_H
#define LAUNCHER_BOOT_POLICY_H

#include <stdbool.h>

typedef enum {
    LAUNCHER_LOCATION_FACTORY = 0,
    LAUNCHER_LOCATION_CHILD,
} launcher_location_t;

typedef enum {
    LAUNCHER_APP_EMPTY = 0,
    LAUNCHER_APP_STAGED,
    LAUNCHER_APP_TRIAL,
    LAUNCHER_APP_CONFIRMED,
    LAUNCHER_APP_FAILED,
} launcher_app_state_t;

typedef enum {
    LAUNCHER_BOOT_EVENT_SELECT = 0,
    LAUNCHER_BOOT_EVENT_CONFIRM,
    LAUNCHER_BOOT_EVENT_RESET,
    LAUNCHER_BOOT_EVENT_RETURN,
} launcher_boot_event_t;

typedef struct {
    launcher_location_t location;
    launcher_app_state_t app_state;
} launcher_boot_policy_t;

void launcher_boot_policy_init(launcher_boot_policy_t *policy,
                               launcher_app_state_t app_state);

/** Apply the documented factory/trial/confirmed transition if it is valid. */
bool launcher_boot_policy_apply(launcher_boot_policy_t *policy,
                                launcher_boot_event_t event);

#endif
