#ifndef LAUNCHER_DYNAMIC_SIDECAR_H
#define LAUNCHER_DYNAMIC_SIDECAR_H

#include "launcher_cover_store.h"
#include "launcher_model.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LAUNCHER_DYNAMIC_SIDECAR_SIZE 0x10000u
#define LAUNCHER_DYNAMIC_RECORD_SIZE 512u
#define LAUNCHER_DYNAMIC_BANK_A_OFFSET 0xa000u
#define LAUNCHER_DYNAMIC_BANK_B_OFFSET 0xb000u

typedef struct {
    bool valid;
    uint8_t bank;
    uint32_t generation;
    uint8_t slot_id;
    uint8_t source_kind;
    bool cover_present;
    uint32_t image_length;
    uint8_t firmware_sha256[32];
    uint32_t cover_crc32;
    uint64_t first_installed_at;
    uint64_t last_installed_at;
    int16_t first_utc_offset_minutes;
    int16_t last_utc_offset_minutes;
    char title[LAUNCHER_TITLE_MAX + 1u];
    char source_id[LAUNCHER_SOURCE_ID_MAX + 1u];
    char version[LAUNCHER_COVER_VERSION_MAX + 1u];
} launcher_dynamic_record_t;

bool launcher_dynamic_sidecar_select(
    const launcher_cover_source_t *source, uint8_t slot_id,
    size_t partition_size, launcher_dynamic_record_t *out);

bool launcher_dynamic_sidecar_cover(
    const launcher_cover_source_t *source, size_t partition_size,
    const launcher_dynamic_record_t *record, launcher_cover_record_t *out);

#endif
