#include "launcher_cover_view.h"

#include <string.h>

static const char *fallback_title(const launcher_slot_info_t *slot)
{
    if (slot->project_name[0] != '\0') {
        return slot->project_name;
    }
    if (slot->state == LAUNCHER_SLOT_EMPTY) {
        return "Empty position";
    }
    if (slot->state == LAUNCHER_SLOT_INVALID) {
        return "Installation incomplete";
    }
    return "Untitled play";
}

static launcher_cover_card_t card_for(
    const launcher_model_t *model,
    const launcher_cover_record_t covers[LAUNCHER_SLOT_COUNT], size_t slot_id)
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
    const launcher_cover_record_t covers[LAUNCHER_SLOT_COUNT],
    launcher_cover_view_t *out)
{
    if (model == NULL || covers == NULL || out == NULL) {
        return;
    }
    out->center = card_for(model, covers, model->selected);
    out->left = card_for(model, covers,
                         (model->selected + LAUNCHER_SLOT_COUNT - 1u) %
                             LAUNCHER_SLOT_COUNT);
    out->right = card_for(model, covers,
                          (model->selected + 1u) % LAUNCHER_SLOT_COUNT);
}
