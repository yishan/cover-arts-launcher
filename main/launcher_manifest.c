#include "launcher_manifest.h"

#include <string.h>

enum {
    MAGIC_OFFSET = 0,
    SCHEMA_OFFSET = 4,
    ENCODED_SIZE_OFFSET = 6,
    GENERATION_OFFSET = 8,
    SLOT_OFFSET = 12,
    SOURCE_KIND_OFFSET = 13,
    WIDTH_OFFSET = 14,
    HEIGHT_OFFSET = 16,
    RESERVED_HEADER_OFFSET = 18,
    PAYLOAD_LENGTH_OFFSET = 20,
    PAYLOAD_CRC_OFFSET = 24,
    FIRMWARE_SHA_OFFSET = 28,
    TITLE_OFFSET = 60,
    SOURCE_ID_OFFSET = TITLE_OFFSET + LAUNCHER_TITLE_MAX + 1,
    VERSION_OFFSET = SOURCE_ID_OFFSET + LAUNCHER_SOURCE_ID_MAX + 1,
    RESERVED_BODY_OFFSET = VERSION_OFFSET + LAUNCHER_COVER_VERSION_MAX + 1,
    RECORD_CRC_OFFSET = LAUNCHER_MANIFEST_ENCODED_SIZE - 4,
};

static uint16_t read_u16_le(const uint8_t *bytes)
{
    return (uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8);
}

static uint32_t read_u32_le(const uint8_t *bytes)
{
    return (uint32_t)bytes[0] |
           ((uint32_t)bytes[1] << 8) |
           ((uint32_t)bytes[2] << 16) |
           ((uint32_t)bytes[3] << 24);
}

static void write_u16_le(uint8_t *bytes, uint16_t value)
{
    bytes[0] = (uint8_t)value;
    bytes[1] = (uint8_t)(value >> 8);
}

static void write_u32_le(uint8_t *bytes, uint32_t value)
{
    bytes[0] = (uint8_t)value;
    bytes[1] = (uint8_t)(value >> 8);
    bytes[2] = (uint8_t)(value >> 16);
    bytes[3] = (uint8_t)(value >> 24);
}

static uint32_t crc32_bytes(const uint8_t *bytes, size_t length)
{
    uint32_t crc = UINT32_MAX;

    for (size_t index = 0; index < length; ++index) {
        crc ^= bytes[index];
        for (unsigned int bit = 0; bit < 8; ++bit) {
            uint32_t mask = (uint32_t)-(int32_t)(crc & 1u);
            crc = (crc >> 1) ^ (0xedb88320u & mask);
        }
    }
    return ~crc;
}

static bool bytes_are_zero(const uint8_t *bytes, size_t length)
{
    for (size_t index = 0; index < length; ++index) {
        if (bytes[index] != 0u) {
            return false;
        }
    }
    return true;
}

static bool utf8_is_valid(const uint8_t *bytes, size_t length)
{
    size_t index = 0;

    while (index < length) {
        uint8_t first = bytes[index++];
        uint32_t codepoint;
        size_t continuation_count;

        if (first <= 0x7fu) {
            continue;
        }
        if (first >= 0xc2u && first <= 0xdfu) {
            codepoint = first & 0x1fu;
            continuation_count = 1;
        } else if (first >= 0xe0u && first <= 0xefu) {
            codepoint = first & 0x0fu;
            continuation_count = 2;
        } else if (first >= 0xf0u && first <= 0xf4u) {
            codepoint = first & 0x07u;
            continuation_count = 3;
        } else {
            return false;
        }
        if (continuation_count > length - index) {
            return false;
        }
        for (size_t offset = 0; offset < continuation_count; ++offset) {
            uint8_t next = bytes[index++];
            if ((next & 0xc0u) != 0x80u) {
                return false;
            }
            codepoint = (codepoint << 6) | (next & 0x3fu);
        }
        if ((continuation_count == 2 && codepoint < 0x800u) ||
            (continuation_count == 3 && codepoint < 0x10000u) ||
            (codepoint >= 0xd800u && codepoint <= 0xdfffu) ||
            codepoint > 0x10ffffu) {
            return false;
        }
    }
    return true;
}

static bool bounded_string_length(const char *text, size_t capacity, size_t *length)
{
    const char *terminator;

    if (text == NULL || length == NULL) {
        return false;
    }
    terminator = memchr(text, '\0', capacity);
    if (terminator == NULL) {
        return false;
    }
    *length = (size_t)(terminator - text);
    return utf8_is_valid((const uint8_t *)text, *length);
}

static bool manifest_is_valid(const launcher_cover_manifest_t *manifest)
{
    size_t title_length;
    size_t source_id_length;
    size_t version_length;

    if (manifest == NULL || manifest->slot_id >= LAUNCHER_SLOT_COUNT ||
        manifest->source_kind > LAUNCHER_SOURCE_PLAY_API ||
        manifest->width != LAUNCHER_COVER_WIDTH ||
        manifest->height != LAUNCHER_COVER_HEIGHT ||
        manifest->payload_length != LAUNCHER_COVER_PAYLOAD_LENGTH ||
        !bounded_string_length(manifest->title, sizeof(manifest->title),
                               &title_length) ||
        !bounded_string_length(manifest->source_id, sizeof(manifest->source_id),
                               &source_id_length) ||
        !bounded_string_length(manifest->version, sizeof(manifest->version),
                               &version_length)) {
        return false;
    }
    if (title_length == 0u) {
        return false;
    }
    if (manifest->source_kind == LAUNCHER_SOURCE_PLAY_API &&
        source_id_length == 0u) {
        return false;
    }
    return true;
}

static void encode_string(uint8_t *destination, size_t capacity, const char *source)
{
    size_t length = strlen(source);

    memset(destination, 0, capacity);
    memcpy(destination, source, length);
}

static bool decode_string(char *destination, size_t capacity,
                          const uint8_t *source)
{
    const uint8_t *terminator = memchr(source, 0, capacity);
    size_t length;

    if (terminator == NULL) {
        return false;
    }
    length = (size_t)(terminator - source);
    if (!bytes_are_zero(terminator, capacity - length) ||
        !utf8_is_valid(source, length)) {
        return false;
    }
    memcpy(destination, source, length);
    destination[length] = '\0';
    return true;
}

bool launcher_manifest_encode(uint8_t out[LAUNCHER_MANIFEST_ENCODED_SIZE],
                              const launcher_cover_manifest_t *manifest)
{
    if (out == NULL || !manifest_is_valid(manifest)) {
        return false;
    }

    memset(out, 0, LAUNCHER_MANIFEST_ENCODED_SIZE);
    write_u32_le(out + MAGIC_OFFSET, LAUNCHER_COVER_MAGIC);
    write_u16_le(out + SCHEMA_OFFSET, LAUNCHER_COVER_SCHEMA);
    write_u16_le(out + ENCODED_SIZE_OFFSET, LAUNCHER_MANIFEST_ENCODED_SIZE);
    write_u32_le(out + GENERATION_OFFSET, manifest->generation);
    out[SLOT_OFFSET] = manifest->slot_id;
    out[SOURCE_KIND_OFFSET] = manifest->source_kind;
    write_u16_le(out + WIDTH_OFFSET, manifest->width);
    write_u16_le(out + HEIGHT_OFFSET, manifest->height);
    write_u32_le(out + PAYLOAD_LENGTH_OFFSET, manifest->payload_length);
    write_u32_le(out + PAYLOAD_CRC_OFFSET, manifest->payload_crc32);
    memcpy(out + FIRMWARE_SHA_OFFSET, manifest->firmware_sha256,
           sizeof(manifest->firmware_sha256));
    encode_string(out + TITLE_OFFSET, sizeof(manifest->title), manifest->title);
    encode_string(out + SOURCE_ID_OFFSET, sizeof(manifest->source_id),
                  manifest->source_id);
    encode_string(out + VERSION_OFFSET, sizeof(manifest->version),
                  manifest->version);
    write_u32_le(out + RECORD_CRC_OFFSET, crc32_bytes(out, RECORD_CRC_OFFSET));
    return true;
}

bool launcher_manifest_decode(launcher_cover_manifest_t *out,
                              const uint8_t *bytes, size_t length)
{
    launcher_cover_manifest_t decoded;

    if (out == NULL || bytes == NULL || length < LAUNCHER_MANIFEST_ENCODED_SIZE ||
        read_u32_le(bytes + MAGIC_OFFSET) != LAUNCHER_COVER_MAGIC ||
        read_u16_le(bytes + SCHEMA_OFFSET) != LAUNCHER_COVER_SCHEMA ||
        read_u16_le(bytes + ENCODED_SIZE_OFFSET) != LAUNCHER_MANIFEST_ENCODED_SIZE ||
        read_u32_le(bytes + RECORD_CRC_OFFSET) !=
            crc32_bytes(bytes, RECORD_CRC_OFFSET) ||
        !bytes_are_zero(bytes + RESERVED_HEADER_OFFSET, 2u) ||
        !bytes_are_zero(bytes + RESERVED_BODY_OFFSET,
                        RECORD_CRC_OFFSET - RESERVED_BODY_OFFSET)) {
        return false;
    }

    memset(&decoded, 0, sizeof(decoded));
    decoded.generation = read_u32_le(bytes + GENERATION_OFFSET);
    decoded.slot_id = bytes[SLOT_OFFSET];
    decoded.source_kind = bytes[SOURCE_KIND_OFFSET];
    decoded.width = read_u16_le(bytes + WIDTH_OFFSET);
    decoded.height = read_u16_le(bytes + HEIGHT_OFFSET);
    decoded.payload_length = read_u32_le(bytes + PAYLOAD_LENGTH_OFFSET);
    decoded.payload_crc32 = read_u32_le(bytes + PAYLOAD_CRC_OFFSET);
    memcpy(decoded.firmware_sha256, bytes + FIRMWARE_SHA_OFFSET,
           sizeof(decoded.firmware_sha256));
    if (!decode_string(decoded.title, sizeof(decoded.title), bytes + TITLE_OFFSET) ||
        !decode_string(decoded.source_id, sizeof(decoded.source_id),
                       bytes + SOURCE_ID_OFFSET) ||
        !decode_string(decoded.version, sizeof(decoded.version),
                       bytes + VERSION_OFFSET) ||
        !manifest_is_valid(&decoded)) {
        return false;
    }

    *out = decoded;
    return true;
}

bool launcher_manifest_matches_image(const launcher_cover_manifest_t *manifest,
                                     const uint8_t image_sha256[32])
{
    return manifest != NULL && image_sha256 != NULL &&
           memcmp(manifest->firmware_sha256, image_sha256,
                  sizeof(manifest->firmware_sha256)) == 0;
}
