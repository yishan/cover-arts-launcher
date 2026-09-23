#include "launcher_model.h"

#include <string.h>

static launcher_result_t result(launcher_action_t action, size_t slot_id)
{
    launcher_result_t value = {
        .action = action,
        .slot_id = slot_id,
    };
    return value;
}

void launcher_model_init(launcher_model_t *model,
                         const launcher_slot_info_t slots[LAUNCHER_SLOT_COUNT])
{
    if (model == NULL) {
        return;
    }
    memset(model, 0, sizeof(*model));
    model->page = LAUNCHER_PAGE_LIBRARY;
    if (slots != NULL) {
        memcpy(model->slots, slots, sizeof(model->slots));
    }
}

void launcher_model_refresh(launcher_model_t *model,
                            const launcher_slot_info_t slots[LAUNCHER_SLOT_COUNT])
{
    if (model == NULL || slots == NULL) {
        return;
    }
    memcpy(model->slots, slots, sizeof(model->slots));
}

bool launcher_slot_is_bootable(launcher_slot_state_t state)
{
    return state == LAUNCHER_SLOT_TRIAL || state == LAUNCHER_SLOT_READY;
}

bool launcher_model_all_empty(const launcher_model_t *model)
{
    if (model == NULL) {
        return false;
    }
    for (size_t index = 0; index < LAUNCHER_SLOT_COUNT; ++index) {
        if (model->slots[index].state != LAUNCHER_SLOT_EMPTY) {
            return false;
        }
    }
    return true;
}

launcher_result_t launcher_model_handle(launcher_model_t *model,
                                        launcher_input_t input)
{
    if (model == NULL) {
        return result(LAUNCHER_ACTION_NONE, 0u);
    }

    if (model->page != LAUNCHER_PAGE_LIBRARY) {
        if (input == LAUNCHER_INPUT_OK_LONG) {
            model->page = LAUNCHER_PAGE_LIBRARY;
            return result(LAUNCHER_ACTION_SHOW_LIBRARY, model->selected);
        }
        return result(LAUNCHER_ACTION_NONE, model->selected);
    }

    switch (input) {
    case LAUNCHER_INPUT_UP:
        model->selected = (model->selected + LAUNCHER_SLOT_COUNT - 1u) %
                          LAUNCHER_SLOT_COUNT;
        return result(LAUNCHER_ACTION_SELECTION_CHANGED, model->selected);
    case LAUNCHER_INPUT_DOWN:
        model->selected = (model->selected + 1u) % LAUNCHER_SLOT_COUNT;
        return result(LAUNCHER_ACTION_SELECTION_CHANGED, model->selected);
    case LAUNCHER_INPUT_OK_LONG:
        model->page = LAUNCHER_PAGE_DETAILS;
        return result(LAUNCHER_ACTION_SHOW_DETAILS, model->selected);
    case LAUNCHER_INPUT_REFRESH:
        return result(LAUNCHER_ACTION_REFRESH, model->selected);
    case LAUNCHER_INPUT_OK:
        switch (model->slots[model->selected].state) {
        case LAUNCHER_SLOT_READY:
        case LAUNCHER_SLOT_TRIAL:
            return result(LAUNCHER_ACTION_LAUNCH, model->selected);
        case LAUNCHER_SLOT_EMPTY:
            model->page = LAUNCHER_PAGE_INSTALL_HELP;
            return result(LAUNCHER_ACTION_SHOW_INSTALL_HELP, model->selected);
        case LAUNCHER_SLOT_INVALID:
            model->page = LAUNCHER_PAGE_RECOVERY_HELP;
            return result(LAUNCHER_ACTION_SHOW_RECOVERY_HELP, model->selected);
        }
        break;
    case LAUNCHER_INPUT_NONE:
        break;
    }
    return result(LAUNCHER_ACTION_NONE, model->selected);
}
