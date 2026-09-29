#include "launcher_dynamic_sidecar.h"

#include <string.h>

enum {
    TITLE_OFFSET = 84,
    TITLE_SIZE = 65,
    SOURCE_ID_OFFSET = 149,
    SOURCE_ID_SIZE = 49,
    VERSION_OFFSET = 198,
    VERSION_SIZE = 25,
    RESERVED_OFFSET = 223,
    CRC_OFFSET = LAUNCHER_DYNAMIC_RECORD_SIZE - 4,
};

static uint16_t read_u16_le(const uint8_t *bytes)
{
    return (uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8u);
}

static int16_t read_i16_le(const uint8_t *bytes)
{
    return (int16_t)read_u16_le(bytes);
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

static uint32_t crc32_bytes(const uint8_t *bytes, size_t length)
{
    uint32_t crc = 0xffffffffu;
    for (size_t index = 0u; index < length; ++index) {
        crc ^= bytes[index];
        for (unsigned bit = 0u; bit < 8u; ++bit) {
            crc = (crc >> 1u) ^ (0xedb88320u & (0u - (crc & 1u)));
        }
    }
    return crc ^ 0xffffffffu;
}

static bool bytes_are_zero(const uint8_t *bytes, size_t length)
{
    for (size_t index = 0u; index < length; ++index) {
        if (bytes[index] != 0u) {
            return false;
        }
    }
    return true;
}

static bool decode_field(char *destination, size_t destination_size,
                         const uint8_t *source, size_t source_size)
{
    const uint8_t *terminator = memchr(source, 0, source_size);
    size_t length;
    if (terminator == NULL) {
        return false;
    }
    length = (size_t)(terminator - source);
    if (length >= destination_size ||
        !bytes_are_zero(terminator, source_size - length)) {
        return false;
    }
    memcpy(destination, source, length);
    destination[length] = '\0';
    return true;
}

static bool allocation_matches(uint32_t image_length, size_t partition_size)
{
    size_t aligned;
    if (image_length == 0u || image_length > SIZE_MAX - 0xffffu) {
        return false;
    }
    aligned = ((size_t)image_length + 0xffffu) & ~(size_t)0xffffu;
    return aligned <= SIZE_MAX - LAUNCHER_DYNAMIC_SIDECAR_SIZE &&
           aligned + LAUNCHER_DYNAMIC_SIDECAR_SIZE == partition_size;
}

static bool read_record(const launcher_cover_source_t *source,
                        size_t offset, uint8_t slot_id,
                        size_t partition_size, uint8_t bank,
                        launcher_dynamic_record_t *out)
{
    static const uint8_t magic[4] = {'D', 'P', 'S', '1'};
    uint8_t bytes[LAUNCHER_DYNAMIC_RECORD_SIZE];
    uint64_t first;
    uint64_t last;
    int16_t first_offset;
    int16_t last_offset;
    bool cover_present;

    memset(out, 0, sizeof(*out));
    if (source == NULL || source->read == NULL ||
        offset > source->size || sizeof(bytes) > source->size - offset ||
        !source->read(source->context, offset, bytes, sizeof(bytes)) ||
        memcmp(bytes, magic, sizeof(magic)) != 0 ||
        read_u16_le(bytes + 4u) != 1u ||
        read_u16_le(bytes + 6u) != LAUNCHER_DYNAMIC_RECORD_SIZE ||
        read_u32_le(bytes + CRC_OFFSET) != crc32_bytes(bytes, CRC_OFFSET) ||
        bytes[12] != slot_id || bytes[13] > 1u || bytes[14] != 1u ||
        (bytes[15] & ~1u) != 0u ||
        !allocation_matches(read_u32_le(bytes + 16u), partition_size) ||
        !bytes_are_zero(bytes + RESERVED_OFFSET, CRC_OFFSET - RESERVED_OFFSET)) {
        return false;
    }
    cover_present = (bytes[15] & 1u) != 0u;
    if (cover_present) {
        if (read_u16_le(bytes + 52u) != LAUNCHER_COVER_WIDTH ||
            read_u16_le(bytes + 54u) != LAUNCHER_COVER_HEIGHT ||
            read_u32_le(bytes + 56u) != LAUNCHER_COVER_PAYLOAD_LENGTH) {
            return false;
        }
    } else if (read_u16_le(bytes + 52u) != 0u ||
               read_u16_le(bytes + 54u) != 0u ||
               read_u32_le(bytes + 56u) != 0u ||
               read_u32_le(bytes + 60u) != 0u) {
        return false;
    }
    first = read_u64_le(bytes + 64u);
    last = read_u64_le(bytes + 72u);
    first_offset = read_i16_le(bytes + 80u);
    last_offset = read_i16_le(bytes + 82u);
    if ((first == 0u) != (last == 0u) || last < first ||
        first_offset < -840 || first_offset > 840 ||
        last_offset < -840 || last_offset > 840 ||
        !decode_field(out->title, sizeof(out->title), bytes + TITLE_OFFSET,
                      TITLE_SIZE) || out->title[0] == '\0' ||
        !decode_field(out->source_id, sizeof(out->source_id),
                      bytes + SOURCE_ID_OFFSET, SOURCE_ID_SIZE) ||
        !decode_field(out->version, sizeof(out->version),
                      bytes + VERSION_OFFSET, VERSION_SIZE) ||
        (bytes[13] == 1u && out->source_id[0] == '\0')) {
        return false;
    }
    out->valid = true;
    out->bank = bank;
    out->generation = read_u32_le(bytes + 8u);
    out->slot_id = slot_id;
    out->source_kind = bytes[13];
    out->cover_present = cover_present;
    out->image_length = read_u32_le(bytes + 16u);
    memcpy(out->firmware_sha256, bytes + 20u, 32u);
    out->cover_crc32 = read_u32_le(bytes + 60u);
    out->first_installed_at = first;
    out->last_installed_at = last;
    out->first_utc_offset_minutes = first_offset;
    out->last_utc_offset_minutes = last_offset;
    return true;
}

static bool generation_is_newer(uint32_t candidate, uint32_t current)
{
    return (int32_t)(candidate - current) > 0;
}

bool launcher_dynamic_sidecar_select(
    const launcher_cover_source_t *source, uint8_t slot_id,
    size_t partition_size, launcher_dynamic_record_t *out)
{
    launcher_dynamic_record_t records[2];
    bool valid[2];
    size_t base;
    if (out == NULL || slot_id >= LAUNCHER_MAX_SLOTS ||
        partition_size < LAUNCHER_DYNAMIC_SIDECAR_SIZE) {
        return false;
    }
    memset(out, 0, sizeof(*out));
    base = partition_size - LAUNCHER_DYNAMIC_SIDECAR_SIZE;
    valid[0] = read_record(source, base + LAUNCHER_DYNAMIC_BANK_A_OFFSET,
                           slot_id, partition_size, 0u, &records[0]);
    valid[1] = read_record(source, base + LAUNCHER_DYNAMIC_BANK_B_OFFSET,
                           slot_id, partition_size, 1u, &records[1]);
    if (!valid[0] && !valid[1]) {
        return false;
    }
    if (!valid[0]) {
        *out = records[1];
    } else if (!valid[1] || !generation_is_newer(records[1].generation,
                                                  records[0].generation)) {
        *out = records[0];
    } else {
        *out = records[1];
    }
    return true;
}

bool launcher_dynamic_sidecar_cover(
    const launcher_cover_source_t *source, size_t partition_size,
    const launcher_dynamic_record_t *record, launcher_cover_record_t *out)
{
    launcher_cover_manifest_t manifest = {0};
    if (record == NULL || !record->valid || !record->cover_present ||
        out == NULL || partition_size < LAUNCHER_DYNAMIC_SIDECAR_SIZE) {
        if (out != NULL) {
            memset(out, 0, sizeof(*out));
        }
        return false;
    }
    manifest.generation = record->generation;
    manifest.slot_id = record->slot_id;
    manifest.source_kind = record->source_kind;
    manifest.width = LAUNCHER_COVER_WIDTH;
    manifest.height = LAUNCHER_COVER_HEIGHT;
    manifest.payload_length = LAUNCHER_COVER_PAYLOAD_LENGTH;
    manifest.payload_crc32 = record->cover_crc32;
    memcpy(manifest.firmware_sha256, record->firmware_sha256, 32u);
    memcpy(manifest.title, record->title, sizeof(manifest.title));
    memcpy(manifest.source_id, record->source_id, sizeof(manifest.source_id));
    memcpy(manifest.version, record->version, sizeof(manifest.version));
    return launcher_cover_store_direct(
        source, &manifest, partition_size - LAUNCHER_DYNAMIC_SIDECAR_SIZE, out);
}
