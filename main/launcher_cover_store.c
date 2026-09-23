#include "launcher_cover_store.h"

#include <string.h>

static uint32_t crc32_update(uint32_t crc, const uint8_t *bytes, size_t length)
{
    for (size_t index = 0; index < length; ++index) {
        crc ^= bytes[index];
        for (unsigned bit = 0; bit < 8u; ++bit) {
            crc = (crc >> 1u) ^ (0xedb88320u & (0u - (crc & 1u)));
        }
    }
    return crc;
}

static bool bounded_read(const launcher_cover_source_t *source, size_t offset,
                         void *destination, size_t length)
{
    if (source == NULL || source->read == NULL || destination == NULL ||
        offset > source->size || length > source->size - offset) {
        return false;
    }
    return source->read(source->context, offset, destination, length);
}

size_t launcher_cover_bank_offset(uint8_t slot_id, uint8_t bank)
{
    if (slot_id >= LAUNCHER_SLOT_COUNT || bank >= LAUNCHER_COVER_BANKS_PER_SLOT) {
        return SIZE_MAX;
    }
    return ((size_t)slot_id * LAUNCHER_COVER_BANKS_PER_SLOT + bank) *
           LAUNCHER_COVER_BANK_SIZE;
}

bool launcher_cover_store_read_payload(const launcher_cover_source_t *source,
                                       const launcher_cover_record_t *record,
                                       size_t payload_offset,
                                       void *destination, size_t length)
{
    size_t start;

    if (record == NULL || !record->valid || destination == NULL ||
        payload_offset > record->manifest.payload_length ||
        length > record->manifest.payload_length - payload_offset ||
        record->bank_offset > SIZE_MAX - LAUNCHER_COVER_PAYLOAD_OFFSET) {
        return false;
    }
    start = record->bank_offset + LAUNCHER_COVER_PAYLOAD_OFFSET;
    if (payload_offset > SIZE_MAX - start) {
        return false;
    }
    return bounded_read(source, start + payload_offset, destination, length);
}

static bool verify_bank(const launcher_cover_source_t *source, uint8_t slot_id,
                        uint8_t bank, const uint8_t image_sha256[32],
                        launcher_cover_record_t *record)
{
    uint8_t encoded[LAUNCHER_MANIFEST_ENCODED_SIZE];
    uint8_t chunk[LAUNCHER_COVER_VERIFY_CHUNK];
    size_t bank_offset = launcher_cover_bank_offset(slot_id, bank);
    size_t consumed = 0u;
    uint32_t crc = 0xffffffffu;

    memset(record, 0, sizeof(*record));
    if (bank_offset == SIZE_MAX ||
        !bounded_read(source, bank_offset, encoded, sizeof(encoded)) ||
        !launcher_manifest_decode(&record->manifest, encoded, sizeof(encoded)) ||
        record->manifest.slot_id != slot_id ||
        !launcher_manifest_matches_image(&record->manifest, image_sha256)) {
        return false;
    }
    record->valid = true;
    record->bank = bank;
    record->bank_offset = bank_offset;
    while (consumed < record->manifest.payload_length) {
        size_t remaining = record->manifest.payload_length - consumed;
        size_t read_length = remaining < sizeof(chunk) ? remaining : sizeof(chunk);

        if (!launcher_cover_store_read_payload(source, record, consumed, chunk,
                                               read_length)) {
            record->valid = false;
            return false;
        }
        crc = crc32_update(crc, chunk, read_length);
        consumed += read_length;
    }
    crc ^= 0xffffffffu;
    if (crc != record->manifest.payload_crc32) {
        record->valid = false;
        return false;
    }
    return true;
}

static bool generation_is_newer(uint32_t candidate, uint32_t current)
{
    return (int32_t)(candidate - current) > 0;
}

bool launcher_cover_store_select(const launcher_cover_source_t *source,
                                 uint8_t slot_id,
                                 const uint8_t image_sha256[32],
                                 launcher_cover_record_t *out)
{
    launcher_cover_record_t candidates[LAUNCHER_COVER_BANKS_PER_SLOT];
    bool valid[LAUNCHER_COVER_BANKS_PER_SLOT];

    if (out == NULL) {
        return false;
    }
    memset(out, 0, sizeof(*out));
    if (source == NULL || image_sha256 == NULL || slot_id >= LAUNCHER_SLOT_COUNT) {
        return false;
    }
    for (uint8_t bank = 0u; bank < LAUNCHER_COVER_BANKS_PER_SLOT; ++bank) {
        valid[bank] = verify_bank(source, slot_id, bank, image_sha256,
                                  &candidates[bank]);
    }
    if (!valid[0] && !valid[1]) {
        return false;
    }
    if (!valid[0]) {
        *out = candidates[1];
    } else if (!valid[1]) {
        *out = candidates[0];
    } else if (generation_is_newer(candidates[1].manifest.generation,
                                   candidates[0].manifest.generation)) {
        *out = candidates[1];
    } else {
        *out = candidates[0];
    }
    return true;
}
