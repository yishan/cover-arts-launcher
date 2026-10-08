#include "launcher_slot_policy.h"

#include <assert.h>
#include <stdio.h>

int main(void)
{
    uint32_t arena_start = 0u;
    assert(launcher_dynamic_arena_start(0x10000u, 0x170000u, &arena_start));
    assert(arena_start == 0x180000u);
    assert(launcher_dynamic_arena_start(0x10000u, 0x0f0000u, &arena_start));
    assert(arena_start == 0x100000u);
    assert(!launcher_dynamic_arena_start(0x20000u, 0x0f0000u, &arena_start));
    assert(!launcher_dynamic_arena_start(0x10000u, 0x100000u, &arena_start));
    assert(!launcher_dynamic_arena_start(0x10000u, 0x0f0000u, NULL));
    assert(launcher_dynamic_allocation_valid(0x100000u, 0x100000u, 0x20000u));
    /* Existing allocations need not move when a reviewed layout is compact. */
    assert(launcher_dynamic_allocation_valid(0x100000u, 0x180000u, 0x20000u));
    assert(!launcher_dynamic_allocation_valid(0x180000u, 0x100000u, 0x20000u));
    assert(!launcher_dynamic_allocation_valid(0x100000u, 0xf0000u, 0x20000u));
    assert(!launcher_dynamic_allocation_valid(0x100000u, 0x100001u, 0x20000u));
    assert(!launcher_dynamic_allocation_valid(0x100000u, 0x100000u, 0x10000u));
    assert(!launcher_dynamic_allocation_valid(0x100000u, 0x7e0000u, 0x20000u));
    assert(!launcher_dynamic_allocation_valid(0x100000u, 0x100000u, UINT32_MAX));
    assert(!launcher_dynamic_allocation_valid(0u, 0x100000u, 0x20000u));
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
