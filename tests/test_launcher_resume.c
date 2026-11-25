#include "launcher_resume_policy.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static launcher_resume_record_t record_for(size_t slot_id, uint8_t fill)
{
    launcher_resume_record_t record;

    memset(&record, 0, sizeof(record));
    record.valid = true;
    record.slot_id = slot_id;
    memset(record.image_sha256, fill, sizeof(record.image_sha256));
    return record;
}

static launcher_resume_action_t decide(launcher_reset_kind_t reset_kind,
                                       const launcher_resume_record_t *record,
                                       size_t slot_count, bool bootable,
                                       uint8_t slot_fill)
{
    uint8_t slot_sha256[LAUNCHER_RESUME_SHA256_SIZE];

    memset(slot_sha256, slot_fill, sizeof(slot_sha256));
    return launcher_resume_decide(reset_kind, record, slot_count, bootable,
                                  slot_sha256);
}

static void test_deep_sleep_resumes_matching_slot(void)
{
    launcher_resume_record_t record = record_for(1u, 0x5a);

    assert(decide(LAUNCHER_RESET_DEEP_SLEEP, &record, 3u, true, 0x5a) ==
           LAUNCHER_RESUME_RELAUNCH);
}

static void test_power_on_or_other_reset_returns_to_library(void)
{
    launcher_resume_record_t record = record_for(0u, 0x11);

    assert(decide(LAUNCHER_RESET_POWER_ON, &record, 3u, true, 0x11) ==
           LAUNCHER_RESUME_DISCARD);
    assert(decide(LAUNCHER_RESET_OTHER, &record, 3u, true, 0x11) ==
           LAUNCHER_RESUME_DISCARD);
}

static void test_deep_sleep_without_record_shows_library(void)
{
    assert(decide(LAUNCHER_RESET_DEEP_SLEEP, NULL, 3u, false, 0x00) ==
           LAUNCHER_RESUME_SHOW_LIBRARY);

    launcher_resume_record_t invalid;
    memset(&invalid, 0, sizeof(invalid));
    invalid.slot_id = 2u;
    assert(decide(LAUNCHER_RESET_DEEP_SLEEP, &invalid, 3u, false, 0x00) ==
           LAUNCHER_RESUME_SHOW_LIBRARY);
}

static void test_deep_sleep_discards_stale_or_unbootable_record(void)
{
    launcher_resume_record_t record = record_for(2u, 0x33);

    assert(decide(LAUNCHER_RESET_DEEP_SLEEP, &record, 3u, false, 0x33) ==
           LAUNCHER_RESUME_DISCARD);
    assert(decide(LAUNCHER_RESET_DEEP_SLEEP, &record, 3u, true, 0x34) ==
           LAUNCHER_RESUME_DISCARD);
    assert(decide(LAUNCHER_RESET_DEEP_SLEEP, &record, 2u, true, 0x33) ==
           LAUNCHER_RESUME_DISCARD);
    assert(launcher_resume_decide(LAUNCHER_RESET_DEEP_SLEEP, &record, 3u, true,
                                  NULL) == LAUNCHER_RESUME_DISCARD);
}

int main(void)
{
    test_deep_sleep_resumes_matching_slot();
    test_power_on_or_other_reset_returns_to_library();
    test_deep_sleep_without_record_shows_library();
    test_deep_sleep_discards_stale_or_unbootable_record();
    puts("Launcher resume policy: PASS");
    return 0;
}
