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
                         const launcher_slot_info_t *slots, size_t slot_count)
{
    if (model == NULL) {
        return;
    }
    memset(model, 0, sizeof(*model));
    model->page = LAUNCHER_PAGE_LIBRARY;
    model->slot_count = slot_count <= LAUNCHER_MAX_SLOTS ? slot_count : 0u;
    if (slots != NULL && model->slot_count > 0u) {
        memcpy(model->slots, slots,
               model->slot_count * sizeof(model->slots[0]));
    }
}

void launcher_model_refresh(launcher_model_t *model,
                            const launcher_slot_info_t *slots,
                            size_t slot_count)
{
    if (model == NULL || slot_count > LAUNCHER_MAX_SLOTS ||
        (slots == NULL && slot_count > 0u)) {
        return;
    }
    memset(model->slots, 0, sizeof(model->slots));
    model->slot_count = slot_count;
    if (slot_count > 0u) {
        memcpy(model->slots, slots, slot_count * sizeof(model->slots[0]));
    }
    if (model->selected >= (slot_count > 0u ? slot_count : 1u)) {
        model->selected = 0u;
    }
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
    for (size_t index = 0; index < model->slot_count; ++index) {
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
        if (input == LAUNCHER_INPUT_OK || input == LAUNCHER_INPUT_OK_LONG) {
            model->page = LAUNCHER_PAGE_LIBRARY;
            return result(LAUNCHER_ACTION_SHOW_LIBRARY, model->selected);
        }
        return result(LAUNCHER_ACTION_NONE, model->selected);
    }

    switch (input) {
    case LAUNCHER_INPUT_UP:
        if (model->slot_count == 0u) {
            return result(LAUNCHER_ACTION_NONE, 0u);
        }
        model->selected = (model->selected + model->slot_count - 1u) %
                          model->slot_count;
        return result(LAUNCHER_ACTION_SELECTION_CHANGED, model->selected);
    case LAUNCHER_INPUT_DOWN:
        if (model->slot_count == 0u) {
            return result(LAUNCHER_ACTION_NONE, 0u);
        }
        model->selected = (model->selected + 1u) % model->slot_count;
        return result(LAUNCHER_ACTION_SELECTION_CHANGED, model->selected);
    case LAUNCHER_INPUT_OK_LONG:
        if (model->slot_count == 0u) {
            model->page = LAUNCHER_PAGE_INSTALL_HELP;
            return result(LAUNCHER_ACTION_SHOW_INSTALL_HELP, 0u);
        }
        model->page = LAUNCHER_PAGE_DETAILS;
        return result(LAUNCHER_ACTION_SHOW_DETAILS, model->selected);
    case LAUNCHER_INPUT_REFRESH:
        return result(LAUNCHER_ACTION_REFRESH, model->selected);
    case LAUNCHER_INPUT_OK:
        if (model->slot_count == 0u) {
            model->page = LAUNCHER_PAGE_INSTALL_HELP;
            return result(LAUNCHER_ACTION_SHOW_INSTALL_HELP, 0u);
        }
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
