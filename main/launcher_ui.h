#ifndef LAUNCHER_UI_H
#define LAUNCHER_UI_H

#include "launcher_cover_store.h"
#include "launcher_model.h"

#include <stdbool.h>

/** Create the Cover Art selector. Caller must hold the LVGL lock. */
bool launcher_ui_create(void);

/** Render current model state. Caller must hold the LVGL lock. */
void launcher_ui_render(
    const launcher_model_t *model,
    const launcher_cover_record_t covers[LAUNCHER_SLOT_COUNT],
    const launcher_cover_source_t *cover_source, int battery_percent,
    const char *status_message);

/** Delete all Launcher UI objects. Caller must hold the LVGL lock. */
void launcher_ui_destroy(void);

#endif
