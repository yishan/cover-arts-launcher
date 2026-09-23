#ifndef LAUNCHER_COVER_VIEW_H
#define LAUNCHER_COVER_VIEW_H

#include "launcher_cover_store.h"
#include "launcher_model.h"

typedef struct {
    size_t slot_id;
    launcher_slot_state_t state;
    bool has_cover;
    const launcher_cover_record_t *cover;
    const char *title;
    const char *version;
} launcher_cover_card_t;

typedef struct {
    launcher_cover_card_t center;
    launcher_cover_card_t left;
    launcher_cover_card_t right;
} launcher_cover_view_t;

void launcher_cover_view_build(
    const launcher_model_t *model,
    const launcher_cover_record_t covers[LAUNCHER_SLOT_COUNT],
    launcher_cover_view_t *out);

#endif
