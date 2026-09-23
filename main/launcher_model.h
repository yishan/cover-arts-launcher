#ifndef LAUNCHER_MODEL_H
#define LAUNCHER_MODEL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LAUNCHER_SLOT_COUNT 3u
#define LAUNCHER_PROJECT_NAME_MAX 32u
#define LAUNCHER_PROJECT_VERSION_MAX 32u

typedef enum {
    LAUNCHER_SLOT_EMPTY = 0,
    LAUNCHER_SLOT_INVALID,
    LAUNCHER_SLOT_TRIAL,
    LAUNCHER_SLOT_READY,
} launcher_slot_state_t;

typedef enum {
    LAUNCHER_TRUST_NONE = 0,
    LAUNCHER_TRUST_INSTALL_RECEIPT,
    LAUNCHER_TRUST_LEGACY_COVER,
    LAUNCHER_TRUST_LEGACY_GENERIC,
} launcher_trust_source_t;

typedef struct {
    launcher_slot_state_t state;
    uint32_t image_size;
    uint8_t image_sha256[32];
    launcher_trust_source_t trust_source;
    char project_name[LAUNCHER_PROJECT_NAME_MAX + 1u];
    char version[LAUNCHER_PROJECT_VERSION_MAX + 1u];
} launcher_slot_info_t;

typedef enum {
    LAUNCHER_PAGE_LIBRARY = 0,
    LAUNCHER_PAGE_DETAILS,
    LAUNCHER_PAGE_INSTALL_HELP,
    LAUNCHER_PAGE_RECOVERY_HELP,
} launcher_page_t;

typedef enum {
    LAUNCHER_INPUT_NONE = 0,
    LAUNCHER_INPUT_UP,
    LAUNCHER_INPUT_DOWN,
    LAUNCHER_INPUT_OK,
    LAUNCHER_INPUT_OK_LONG,
    LAUNCHER_INPUT_REFRESH,
} launcher_input_t;

typedef enum {
    LAUNCHER_ACTION_NONE = 0,
    LAUNCHER_ACTION_SELECTION_CHANGED,
    LAUNCHER_ACTION_REFRESH,
    LAUNCHER_ACTION_LAUNCH,
    LAUNCHER_ACTION_SHOW_DETAILS,
    LAUNCHER_ACTION_SHOW_INSTALL_HELP,
    LAUNCHER_ACTION_SHOW_RECOVERY_HELP,
    LAUNCHER_ACTION_SHOW_LIBRARY,
} launcher_action_t;

typedef struct {
    launcher_action_t action;
    size_t slot_id;
} launcher_result_t;

typedef struct {
    size_t selected;
    launcher_page_t page;
    launcher_slot_info_t slots[LAUNCHER_SLOT_COUNT];
} launcher_model_t;

void launcher_model_init(launcher_model_t *model,
                         const launcher_slot_info_t slots[LAUNCHER_SLOT_COUNT]);
void launcher_model_refresh(launcher_model_t *model,
                            const launcher_slot_info_t slots[LAUNCHER_SLOT_COUNT]);
launcher_result_t launcher_model_handle(launcher_model_t *model,
                                        launcher_input_t input);
bool launcher_model_all_empty(const launcher_model_t *model);
bool launcher_slot_is_bootable(launcher_slot_state_t state);

#endif
