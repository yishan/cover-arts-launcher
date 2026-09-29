#include "launcher_cover_view.h"

#include <string.h>

static const char *fallback_title(const launcher_slot_info_t *slot)
{
    if (slot->project_name[0] != '\0') {
        return slot->project_name;
    }
    if (slot->state == LAUNCHER_SLOT_EMPTY) {
        return "空位置";
    }
    if (slot->state == LAUNCHER_SLOT_INVALID) {
        return "安装不完整";
    }
    return "未命名玩法";
}

static launcher_cover_card_t card_for(
    const launcher_model_t *model,
    const launcher_cover_record_t covers[LAUNCHER_MAX_SLOTS], size_t slot_id)
{
    const launcher_slot_info_t *slot = &model->slots[slot_id];
    const launcher_cover_record_t *cover = &covers[slot_id];
    bool has_cover = cover->valid && cover->manifest.slot_id == slot_id &&
                     (slot->state == LAUNCHER_SLOT_READY ||
                      slot->state == LAUNCHER_SLOT_TRIAL);
    launcher_cover_card_t card = {
        .slot_id = slot_id,
        .state = slot->state,
        .has_cover = has_cover,
        .cover = has_cover ? cover : NULL,
        .title = has_cover && cover->manifest.title[0] != '\0' ?
                     cover->manifest.title : fallback_title(slot),
        .version = has_cover && cover->manifest.version[0] != '\0' ?
                       cover->manifest.version : slot->version,
    };
    return card;
}

void launcher_cover_view_build(
    const launcher_model_t *model,
    const launcher_cover_record_t covers[LAUNCHER_MAX_SLOTS],
    launcher_cover_view_t *out)
{
    static const launcher_cover_card_t hidden = {
        .slot_id = LAUNCHER_MAX_SLOTS,
        .state = LAUNCHER_SLOT_EMPTY,
        .has_cover = false,
        .cover = NULL,
        .title = "",
        .version = "",
    };

    if (model == NULL || covers == NULL || out == NULL) {
        return;
    }
    if (model->slot_count == 0u) {
        static const launcher_cover_card_t empty = {
            .slot_id = 0u,
            .state = LAUNCHER_SLOT_EMPTY,
            .has_cover = false,
            .cover = NULL,
            .title = "空玩法库",
            .version = "",
        };
        out->center = empty;
        out->left = hidden;
        out->right = hidden;
        return;
    }
    out->center = card_for(model, covers, model->selected);
    if (model->slot_count == 1u) {
        out->left = hidden;
        out->right = hidden;
        return;
    }
    if (model->slot_count == 2u) {
        out->left = hidden;
        out->right = card_for(model, covers,
                              (model->selected + 1u) % model->slot_count);
        return;
    }
    out->left = card_for(model, covers,
                         (model->selected + model->slot_count - 1u) %
                             model->slot_count);
    out->right = card_for(model, covers,
                          (model->selected + 1u) % model->slot_count);
}
