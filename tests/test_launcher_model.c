#include "launcher_model.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

#define TEST_SLOT_COUNT 3u

static launcher_slot_info_t slot(launcher_slot_state_t state, const char *name)
{
    launcher_slot_info_t info = { .state = state };

    if (name != NULL) {
        snprintf(info.project_name, sizeof(info.project_name), "%s", name);
    }
    return info;
}

static void test_wraparound_visits_every_position(void)
{
    launcher_slot_info_t slots[TEST_SLOT_COUNT] = {
        slot(LAUNCHER_SLOT_READY, "One"),
        slot(LAUNCHER_SLOT_EMPTY, ""),
        slot(LAUNCHER_SLOT_INVALID, ""),
    };
    launcher_model_t model;

    launcher_model_init(&model, slots, TEST_SLOT_COUNT);
    assert(model.selected == 0u);
    assert(launcher_model_handle(&model, LAUNCHER_INPUT_UP).action ==
           LAUNCHER_ACTION_SELECTION_CHANGED);
    assert(model.selected == 2u);
    assert(launcher_model_handle(&model, LAUNCHER_INPUT_DOWN).slot_id == 0u);
    assert(launcher_model_handle(&model, LAUNCHER_INPUT_DOWN).slot_id == 1u);
    assert(launcher_model_handle(&model, LAUNCHER_INPUT_DOWN).slot_id == 2u);
}

static void test_all_empty_is_stable_and_never_launches(void)
{
    launcher_slot_info_t slots[TEST_SLOT_COUNT] = {
        slot(LAUNCHER_SLOT_EMPTY, ""),
        slot(LAUNCHER_SLOT_EMPTY, ""),
        slot(LAUNCHER_SLOT_EMPTY, ""),
    };
    launcher_model_t model;

    launcher_model_init(&model, slots, TEST_SLOT_COUNT);
    assert(launcher_model_all_empty(&model));
    for (size_t index = 0; index < TEST_SLOT_COUNT; ++index) {
        launcher_result_t result = launcher_model_handle(&model, LAUNCHER_INPUT_OK);
        assert(result.action == LAUNCHER_ACTION_SHOW_INSTALL_HELP);
        assert(model.page == LAUNCHER_PAGE_INSTALL_HELP);
        assert(launcher_model_handle(&model, LAUNCHER_INPUT_OK_LONG).action ==
               LAUNCHER_ACTION_SHOW_LIBRARY);
        assert(model.page == LAUNCHER_PAGE_LIBRARY);
        launcher_model_handle(&model, LAUNCHER_INPUT_DOWN);
    }
}

static void test_bootable_and_invalid_actions(void)
{
    launcher_slot_info_t slots[TEST_SLOT_COUNT] = {
        slot(LAUNCHER_SLOT_READY, "Ready"),
        slot(LAUNCHER_SLOT_TRIAL, "Trial"),
        slot(LAUNCHER_SLOT_INVALID, "Broken"),
    };
    launcher_model_t model;

    launcher_model_init(&model, slots, TEST_SLOT_COUNT);
    assert(launcher_model_handle(&model, LAUNCHER_INPUT_OK).action ==
           LAUNCHER_ACTION_LAUNCH);
    launcher_model_handle(&model, LAUNCHER_INPUT_DOWN);
    assert(launcher_model_handle(&model, LAUNCHER_INPUT_OK).action ==
           LAUNCHER_ACTION_LAUNCH);
    launcher_model_handle(&model, LAUNCHER_INPUT_DOWN);
    assert(launcher_model_handle(&model, LAUNCHER_INPUT_OK).action ==
           LAUNCHER_ACTION_SHOW_RECOVERY_HELP);
    assert(!launcher_slot_is_bootable(LAUNCHER_SLOT_INVALID));
    assert(!launcher_slot_is_bootable(LAUNCHER_SLOT_EMPTY));
    assert(launcher_slot_is_bootable(LAUNCHER_SLOT_TRIAL));
    assert(launcher_slot_is_bootable(LAUNCHER_SLOT_READY));
}

static void test_refresh_preserves_selection_and_updates_slots(void)
{
    launcher_slot_info_t before[TEST_SLOT_COUNT] = {
        slot(LAUNCHER_SLOT_EMPTY, ""),
        slot(LAUNCHER_SLOT_READY, "Old"),
        slot(LAUNCHER_SLOT_EMPTY, ""),
    };
    launcher_slot_info_t after[TEST_SLOT_COUNT] = {
        slot(LAUNCHER_SLOT_READY, "New"),
        slot(LAUNCHER_SLOT_INVALID, "Old"),
        slot(LAUNCHER_SLOT_EMPTY, ""),
    };
    launcher_model_t model;

    launcher_model_init(&model, before, TEST_SLOT_COUNT);
    launcher_model_handle(&model, LAUNCHER_INPUT_DOWN);
    launcher_model_refresh(&model, after, TEST_SLOT_COUNT);
    assert(model.selected == 1u);
    assert(model.slots[0].state == LAUNCHER_SLOT_READY);
    assert(strcmp(model.slots[0].project_name, "New") == 0);
    assert(model.slots[1].state == LAUNCHER_SLOT_INVALID);
    assert(!launcher_model_all_empty(&model));
}

static void test_details_and_secondary_back(void)
{
    launcher_slot_info_t slots[TEST_SLOT_COUNT] = {
        slot(LAUNCHER_SLOT_READY, "One"),
        slot(LAUNCHER_SLOT_EMPTY, ""),
        slot(LAUNCHER_SLOT_EMPTY, ""),
    };
    launcher_model_t model;

    launcher_model_init(&model, slots, TEST_SLOT_COUNT);
    assert(launcher_model_handle(&model, LAUNCHER_INPUT_OK_LONG).action ==
           LAUNCHER_ACTION_SHOW_DETAILS);
    assert(model.page == LAUNCHER_PAGE_DETAILS);
    assert(launcher_model_handle(&model, LAUNCHER_INPUT_DOWN).action ==
           LAUNCHER_ACTION_NONE);
    assert(launcher_model_handle(&model, LAUNCHER_INPUT_OK).action ==
           LAUNCHER_ACTION_SHOW_LIBRARY);
    assert(model.page == LAUNCHER_PAGE_LIBRARY);
}

int main(void)
{
    test_wraparound_visits_every_position();
    test_all_empty_is_stable_and_never_launches();
    test_bootable_and_invalid_actions();
    test_refresh_preserves_selection_and_updates_slots();
    test_details_and_secondary_back();
    puts("Launcher model: PASS");
    return 0;
}
