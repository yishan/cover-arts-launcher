#include "launcher_cover_view.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

#define TEST_SLOT_COUNT 3u

static launcher_slot_info_t slot(launcher_slot_state_t state,
                                 const char *name, const char *version)
{
    launcher_slot_info_t result = {.state = state};

    snprintf(result.project_name, sizeof(result.project_name), "%s", name);
    snprintf(result.version, sizeof(result.version), "%s", version);
    return result;
}

static void test_three_cards_stay_synchronized(void)
{
    launcher_slot_info_t slots[TEST_SLOT_COUNT] = {
        slot(LAUNCHER_SLOT_READY, "Firmware title", "0.1"),
        slot(LAUNCHER_SLOT_EMPTY, "", ""),
        slot(LAUNCHER_SLOT_TRIAL, "Trial title", "0.8"),
    };
    launcher_cover_record_t covers[LAUNCHER_MAX_SLOTS] = {0};
    launcher_model_t model;
    launcher_cover_view_t view;

    covers[0].valid = true;
    covers[0].manifest.slot_id = 0u;
    strcpy(covers[0].manifest.title, "Cover title");
    strcpy(covers[0].manifest.version, "1.2.3");
    launcher_model_init(&model, slots, TEST_SLOT_COUNT);

    launcher_cover_view_build(&model, covers, &view);
    assert(view.center.slot_id == 0u && view.left.slot_id == 2u);
    assert(view.right.slot_id == 1u && view.center.has_cover);
    assert(strcmp(view.center.title, "Cover title") == 0);
    assert(strcmp(view.center.version, "1.2.3") == 0);
    assert(view.center.state == LAUNCHER_SLOT_READY);

    launcher_model_handle(&model, LAUNCHER_INPUT_DOWN);
    launcher_cover_view_build(&model, covers, &view);
    assert(view.center.slot_id == 1u && view.left.slot_id == 0u);
    assert(view.right.slot_id == 2u && !view.center.has_cover);
    assert(strcmp(view.center.title, "空位置") == 0);

    launcher_model_handle(&model, LAUNCHER_INPUT_DOWN);
    launcher_cover_view_build(&model, covers, &view);
    assert(view.center.slot_id == 2u && view.left.slot_id == 1u);
    assert(view.right.slot_id == 0u && !view.center.has_cover);
    assert(strcmp(view.center.title, "Trial title") == 0);
}

static void test_bad_cover_never_hides_slot_state(void)
{
    launcher_slot_info_t slots[TEST_SLOT_COUNT] = {
        slot(LAUNCHER_SLOT_INVALID, "", ""),
        slot(LAUNCHER_SLOT_READY, "Ready", "2"),
        slot(LAUNCHER_SLOT_EMPTY, "", ""),
    };
    launcher_cover_record_t covers[LAUNCHER_MAX_SLOTS] = {0};
    launcher_model_t model;
    launcher_cover_view_t view;

    covers[0].manifest.slot_id = 0u;
    strcpy(covers[0].manifest.title, "Must not display");
    launcher_model_init(&model, slots, TEST_SLOT_COUNT);
    launcher_cover_view_build(&model, covers, &view);
    assert(!view.center.has_cover);
    assert(view.center.state == LAUNCHER_SLOT_INVALID);
    assert(strcmp(view.center.title, "安装不完整") == 0);

    for (unsigned index = 0; index < 100u; ++index) {
        launcher_model_handle(&model, (index & 1u) ? LAUNCHER_INPUT_UP :
                                                    LAUNCHER_INPUT_DOWN);
        launcher_cover_view_build(&model, covers, &view);
        assert(view.center.slot_id == model.selected);
        assert(view.left.slot_id == (model.selected + 2u) % 3u);
        assert(view.right.slot_id == (model.selected + 1u) % 3u);
    }
}

static void test_side_cards_show_only_distinct_installed_plays(void)
{
    launcher_slot_info_t slots[TEST_SLOT_COUNT] = {
        slot(LAUNCHER_SLOT_READY, "First", "1"),
        slot(LAUNCHER_SLOT_READY, "Second", "2"),
        slot(LAUNCHER_SLOT_READY, "Third", "3"),
    };
    launcher_cover_record_t covers[LAUNCHER_MAX_SLOTS] = {0};
    launcher_model_t model;
    launcher_cover_view_t view;

    launcher_model_init(&model, NULL, 0u);
    launcher_cover_view_build(&model, covers, &view);
    assert(view.left.slot_id == LAUNCHER_MAX_SLOTS);
    assert(view.right.slot_id == LAUNCHER_MAX_SLOTS);

    launcher_model_refresh(&model, slots, 1u);
    launcher_cover_view_build(&model, covers, &view);
    assert(view.center.slot_id == 0u);
    assert(view.left.slot_id == LAUNCHER_MAX_SLOTS);
    assert(view.right.slot_id == LAUNCHER_MAX_SLOTS);

    launcher_model_refresh(&model, slots, 2u);
    launcher_cover_view_build(&model, covers, &view);
    assert(view.center.slot_id == 0u);
    assert(view.left.slot_id == LAUNCHER_MAX_SLOTS);
    assert(view.right.slot_id == 1u);

    launcher_model_handle(&model, LAUNCHER_INPUT_DOWN);
    launcher_cover_view_build(&model, covers, &view);
    assert(view.center.slot_id == 1u);
    assert(view.left.slot_id == LAUNCHER_MAX_SLOTS);
    assert(view.right.slot_id == 0u);
}

int main(void)
{
    test_three_cards_stay_synchronized();
    test_bad_cover_never_hides_slot_state();
    test_side_cards_show_only_distinct_installed_plays();
    puts("Launcher cover view: PASS");
    return 0;
}
