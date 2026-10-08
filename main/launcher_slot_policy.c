#include "launcher_slot_policy.h"

bool launcher_dynamic_arena_start(uint32_t factory_address,
                                  uint32_t factory_size,
                                  uint32_t *arena_start)
{
    if (arena_start == NULL || factory_address != 0x10000u ||
        (factory_size != 0x170000u && factory_size != 0x0f0000u)) {
        return false;
    }
    *arena_start = factory_address + factory_size;
    return true;
}

bool launcher_dynamic_allocation_valid(uint32_t arena_start,
                                       uint32_t address, uint32_t size)
{
    return (arena_start == 0x180000u || arena_start == 0x100000u) &&
           address >= arena_start && address <= 0x7f0000u &&
           address % 0x10000u == 0u && size >= 0x20000u &&
           size % 0x10000u == 0u && size <= 0x7f0000u - address;
}

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
