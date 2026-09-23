#ifndef LAUNCHER_COVER_STORE_H
#define LAUNCHER_COVER_STORE_H

#include "launcher_manifest.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LAUNCHER_COVER_BANK_SIZE 0x10000u
#define LAUNCHER_COVER_BANKS_PER_SLOT 2u
#define LAUNCHER_COVER_PAYLOAD_OFFSET 0x1000u
#define LAUNCHER_COVER_USED_SIZE                                           \
    (LAUNCHER_SLOT_COUNT * LAUNCHER_COVER_BANKS_PER_SLOT *                 \
     LAUNCHER_COVER_BANK_SIZE)
#define LAUNCHER_COVER_VERIFY_CHUNK 256u

typedef bool (*launcher_cover_read_fn)(void *context, size_t offset,
                                       void *destination, size_t length);

typedef struct {
    launcher_cover_read_fn read;
    void *context;
    size_t size;
} launcher_cover_source_t;

typedef struct {
    bool valid;
    uint8_t bank;
    size_t bank_offset;
    launcher_cover_manifest_t manifest;
} launcher_cover_record_t;

size_t launcher_cover_bank_offset(uint8_t slot_id, uint8_t bank);

bool launcher_cover_store_select(const launcher_cover_source_t *source,
                                 uint8_t slot_id,
                                 const uint8_t image_sha256[32],
                                 launcher_cover_record_t *out);

bool launcher_cover_store_read_payload(const launcher_cover_source_t *source,
                                       const launcher_cover_record_t *record,
                                       size_t payload_offset,
                                       void *destination, size_t length);

#endif
