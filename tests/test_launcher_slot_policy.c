#include "launcher_slot_policy.h"

#include <assert.h>
#include <stdio.h>

int main(void)
{
    assert(launcher_slot_state_from_ota(LAUNCHER_OTA_UNTRACKED) ==
           LAUNCHER_SLOT_READY);
    assert(launcher_slot_state_from_ota(LAUNCHER_OTA_NEW) ==
           LAUNCHER_SLOT_TRIAL);
    assert(launcher_slot_state_from_ota(LAUNCHER_OTA_PENDING_VERIFY) ==
           LAUNCHER_SLOT_TRIAL);
    assert(launcher_slot_state_from_ota(LAUNCHER_OTA_VALID) ==
           LAUNCHER_SLOT_READY);
    assert(launcher_slot_state_from_ota(LAUNCHER_OTA_UNDEFINED) ==
           LAUNCHER_SLOT_READY);

    /* An unadapted play is aborted by rollback after reset, but remains
     * installed and must be available for another one-shot launch. */
    assert(launcher_slot_state_from_ota(LAUNCHER_OTA_ABORTED) ==
           LAUNCHER_SLOT_READY);

    assert(launcher_slot_state_from_ota(LAUNCHER_OTA_INVALID) ==
           LAUNCHER_SLOT_INVALID);
    assert(launcher_slot_state_from_ota(LAUNCHER_OTA_READ_ERROR) ==
           LAUNCHER_SLOT_INVALID);

    puts("Launcher slot policy: PASS");
    return 0;
}
