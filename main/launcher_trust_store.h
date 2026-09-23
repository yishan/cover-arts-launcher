#ifndef LAUNCHER_TRUST_STORE_H
#define LAUNCHER_TRUST_STORE_H

#include "launcher_cover_store.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LAUNCHER_TRUST_RECORD_SIZE 256u
#define LAUNCHER_TRUST_BANK_SIZE 0x1000u
#define LAUNCHER_TRUST_BANKS_PER_SLOT 2u
#define LAUNCHER_TRUST_REGION_OFFSET LAUNCHER_COVER_USED_SIZE
#define LAUNCHER_TRUST_USED_SIZE                                           \
    (LAUNCHER_SLOT_COUNT * LAUNCHER_TRUST_BANKS_PER_SLOT *                 \
     LAUNCHER_TRUST_BANK_SIZE)

typedef enum {
    LAUNCHER_TRUST_POLICY_NONE = 0,
    LAUNCHER_TRUST_POLICY_RESIDENT = 1,
} launcher_trust_policy_t;

typedef struct {
    bool valid;
    uint8_t bank;
    uint32_t generation;
    uint8_t slot_id;
    launcher_trust_policy_t policy;
    uint32_t image_length;
    uint8_t firmware_sha256[32];
} launcher_trust_record_t;

size_t launcher_trust_bank_offset(uint8_t slot_id, uint8_t bank);

bool launcher_trust_store_select(const launcher_cover_source_t *source,
                                 uint8_t slot_id,
                                 const uint8_t image_sha256[32],
                                 uint32_t image_length,
                                 launcher_trust_record_t *out);

#endif
