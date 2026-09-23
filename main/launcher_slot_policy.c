#include "launcher_slot_policy.h"

launcher_slot_state_t launcher_slot_state_from_ota(
    launcher_ota_state_t ota_state)
{
    switch (ota_state) {
    case LAUNCHER_OTA_UNTRACKED:
    case LAUNCHER_OTA_VALID:
    case LAUNCHER_OTA_ABORTED:
    case LAUNCHER_OTA_UNDEFINED:
        return LAUNCHER_SLOT_READY;
    case LAUNCHER_OTA_NEW:
    case LAUNCHER_OTA_PENDING_VERIFY:
        return LAUNCHER_SLOT_TRIAL;
    case LAUNCHER_OTA_INVALID:
    case LAUNCHER_OTA_READ_ERROR:
        return LAUNCHER_SLOT_INVALID;
    }
    return LAUNCHER_SLOT_INVALID;
}
