#include "launcher_trust_store.h"

#include <string.h>

static uint16_t read_u16_le(const uint8_t *bytes)
{
    return (uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8u);
}

static uint32_t read_u32_le(const uint8_t *bytes)
{
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8u) |
           ((uint32_t)bytes[2] << 16u) | ((uint32_t)bytes[3] << 24u);
}

static uint64_t read_u64_le(const uint8_t *bytes)
{
    return (uint64_t)read_u32_le(bytes) |
           ((uint64_t)read_u32_le(bytes + 4u) << 32u);
}

static int16_t read_i16_le(const uint8_t *bytes)
{
    return (int16_t)read_u16_le(bytes);
}

static uint32_t crc32_bytes(const uint8_t *bytes, size_t length)
{
    uint32_t crc = 0xffffffffu;

    for (size_t index = 0; index < length; ++index) {
        crc ^= bytes[index];
        for (unsigned bit = 0; bit < 8u; ++bit) {
            crc = (crc >> 1u) ^ (0xedb88320u & (0u - (crc & 1u)));
        }
    }
    return crc ^ 0xffffffffu;
}

size_t launcher_trust_bank_offset(uint8_t slot_id, uint8_t bank)
{
    if (slot_id >= LAUNCHER_LEGACY_SLOT_COUNT ||
        bank >= LAUNCHER_TRUST_BANKS_PER_SLOT) {
        return SIZE_MAX;
    }
    return LAUNCHER_TRUST_REGION_OFFSET +
           ((size_t)slot_id * LAUNCHER_TRUST_BANKS_PER_SLOT + bank) *
               LAUNCHER_TRUST_BANK_SIZE;
}

static bool read_record(const launcher_cover_source_t *source, uint8_t slot_id,
                        uint8_t bank, const uint8_t image_sha256[32],
                        uint32_t image_length, launcher_trust_record_t *record)
{
    static const uint8_t magic[4] = {'T', 'R', 'S', '1'};
    uint8_t encoded[LAUNCHER_TRUST_RECORD_SIZE];
    size_t offset = launcher_trust_bank_offset(slot_id, bank);
    uint16_t schema_version;

    memset(record, 0, sizeof(*record));
    if (source == NULL || source->read == NULL || image_sha256 == NULL ||
        offset == SIZE_MAX || offset > source->size ||
        sizeof(encoded) > source->size - offset ||
        !source->read(source->context, offset, encoded, sizeof(encoded)) ||
        memcmp(encoded, magic, sizeof(magic)) != 0 ||
        read_u16_le(encoded + 6u) != LAUNCHER_TRUST_RECORD_SIZE ||
        encoded[12] != slot_id ||
        encoded[13] != LAUNCHER_TRUST_POLICY_RESIDENT ||
        encoded[14] != 0u || encoded[15] != 0u ||
        read_u32_le(encoded + 16u) != image_length ||
        memcmp(encoded + 20u, image_sha256, 32u) != 0 ||
        read_u32_le(encoded + 252u) != crc32_bytes(encoded, 252u)) {
        return false;
    }
    schema_version = read_u16_le(encoded + 4u);
    if (schema_version == 1u) {
        for (size_t index = 52u; index < 252u; ++index) {
            if (encoded[index] != 0u) {
                return false;
            }
        }
    } else if (schema_version == 2u) {
        uint64_t first = read_u64_le(encoded + 52u);
        uint64_t last = read_u64_le(encoded + 60u);
        int16_t first_offset = read_i16_le(encoded + 68u);
        int16_t last_offset = read_i16_le(encoded + 70u);
        bool terminated = false;

        if ((first == 0u) != (last == 0u) ||
            (first != 0u && last < first) || first_offset < -840 ||
            first_offset > 840 || last_offset < -840 || last_offset > 840) {
            return false;
        }
        for (size_t index = 0u; index <= LAUNCHER_SOURCE_ID_MAX; ++index) {
            if (encoded[72u + index] == 0u) {
                terminated = true;
                break;
            }
        }
        if (!terminated) {
            return false;
        }
        for (size_t index = 121u; index < 252u; ++index) {
            if (encoded[index] != 0u) {
                return false;
            }
        }
    } else {
        return false;
    }
    record->valid = true;
    record->schema_version = schema_version;
    record->bank = bank;
    record->generation = read_u32_le(encoded + 8u);
    record->slot_id = slot_id;
    record->policy = LAUNCHER_TRUST_POLICY_RESIDENT;
    record->image_length = image_length;
    memcpy(record->firmware_sha256, image_sha256, 32u);
    if (schema_version == 2u) {
        record->first_installed_at = read_u64_le(encoded + 52u);
        record->last_installed_at = read_u64_le(encoded + 60u);
        record->first_install_utc_offset_minutes = read_i16_le(encoded + 68u);
        record->last_install_utc_offset_minutes = read_i16_le(encoded + 70u);
        memcpy(record->source_id, encoded + 72u, LAUNCHER_SOURCE_ID_MAX + 1u);
        record->source_id[LAUNCHER_SOURCE_ID_MAX] = '\0';
    }
    return true;
}

static bool generation_is_newer(uint32_t candidate, uint32_t current)
{
    return (int32_t)(candidate - current) > 0;
}

bool launcher_trust_store_select(const launcher_cover_source_t *source,
                                 uint8_t slot_id,
                                 const uint8_t image_sha256[32],
                                 uint32_t image_length,
                                 launcher_trust_record_t *out)
{
    launcher_trust_record_t candidates[LAUNCHER_TRUST_BANKS_PER_SLOT];
    bool valid[LAUNCHER_TRUST_BANKS_PER_SLOT];

    if (out == NULL) {
        return false;
    }
    memset(out, 0, sizeof(*out));
    if (slot_id >= LAUNCHER_LEGACY_SLOT_COUNT || image_sha256 == NULL ||
        image_length == 0u) {
        return false;
    }
    for (uint8_t bank = 0u; bank < LAUNCHER_TRUST_BANKS_PER_SLOT; ++bank) {
        valid[bank] = read_record(source, slot_id, bank, image_sha256,
                                  image_length, &candidates[bank]);
    }
    if (!valid[0] && !valid[1]) {
        return false;
    }
    if (!valid[0]) {
        *out = candidates[1];
    } else if (!valid[1]) {
        *out = candidates[0];
    } else if (generation_is_newer(candidates[1].generation,
                                   candidates[0].generation)) {
        *out = candidates[1];
    } else {
        *out = candidates[0];
    }
    return true;
}
