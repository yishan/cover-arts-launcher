#include "launcher_boot_policy.h"

#include <stddef.h>

void launcher_boot_policy_init(launcher_boot_policy_t *policy,
                               launcher_app_state_t app_state)
{
    if (policy == NULL) {
        return;
    }
    policy->location = LAUNCHER_LOCATION_FACTORY;
    policy->app_state = app_state;
}

bool launcher_boot_policy_apply(launcher_boot_policy_t *policy,
                                launcher_boot_event_t event)
{
    if (policy == NULL) {
        return false;
    }
    switch (event) {
    case LAUNCHER_BOOT_EVENT_SELECT:
        if (policy->location != LAUNCHER_LOCATION_FACTORY ||
            (policy->app_state != LAUNCHER_APP_STAGED &&
             policy->app_state != LAUNCHER_APP_CONFIRMED)) {
            return false;
        }
        policy->location = LAUNCHER_LOCATION_CHILD;
        if (policy->app_state == LAUNCHER_APP_STAGED) {
            policy->app_state = LAUNCHER_APP_TRIAL;
        }
        return true;
    case LAUNCHER_BOOT_EVENT_CONFIRM:
        if (policy->location != LAUNCHER_LOCATION_CHILD ||
            policy->app_state != LAUNCHER_APP_TRIAL) {
            return false;
        }
        policy->app_state = LAUNCHER_APP_CONFIRMED;
        return true;
    case LAUNCHER_BOOT_EVENT_RESET:
        if (policy->location != LAUNCHER_LOCATION_CHILD) {
            return false;
        }
        if (policy->app_state == LAUNCHER_APP_TRIAL) {
            policy->location = LAUNCHER_LOCATION_FACTORY;
            policy->app_state = LAUNCHER_APP_STAGED;
            return true;
        }
        return policy->app_state == LAUNCHER_APP_CONFIRMED;
    case LAUNCHER_BOOT_EVENT_RETURN:
        if (policy->location != LAUNCHER_LOCATION_CHILD ||
            (policy->app_state != LAUNCHER_APP_TRIAL &&
             policy->app_state != LAUNCHER_APP_CONFIRMED)) {
            return false;
        }
        policy->location = LAUNCHER_LOCATION_FACTORY;
        return true;
    }
    return false;
}
