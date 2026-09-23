#include "launcher_cover_store.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static uint8_t s_storage[LAUNCHER_COVER_USED_SIZE];
static size_t s_largest_read;

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

static bool read_memory(void *context, size_t offset, void *destination,
                        size_t length)
{
    uint8_t *storage = context;

    if (offset > sizeof(s_storage) || length > sizeof(s_storage) - offset) {
        return false;
    }
    if (length > s_largest_read) {
        s_largest_read = length;
    }
    memcpy(destination, storage + offset, length);
    return true;
}

static launcher_cover_source_t source(void)
{
    launcher_cover_source_t result = {
        .read = read_memory,
        .context = s_storage,
        .size = sizeof(s_storage),
    };
    return result;
}

static void fill_sha(uint8_t sha[32], uint8_t seed)
{
    for (size_t index = 0; index < 32u; ++index) {
        sha[index] = (uint8_t)(seed + index);
    }
}

static void write_bank(uint8_t slot_id, uint8_t bank, uint32_t generation,
                       const uint8_t sha[32], uint8_t pixel_seed)
{
    uint8_t encoded[LAUNCHER_MANIFEST_ENCODED_SIZE];
    uint8_t payload[LAUNCHER_COVER_PAYLOAD_LENGTH];
    launcher_cover_manifest_t manifest = {
        .generation = generation,
        .slot_id = slot_id,
        .source_kind = LAUNCHER_SOURCE_LOCAL_FILE,
        .width = LAUNCHER_COVER_WIDTH,
        .height = LAUNCHER_COVER_HEIGHT,
        .payload_length = LAUNCHER_COVER_PAYLOAD_LENGTH,
    };
    size_t offset = launcher_cover_bank_offset(slot_id, bank);

    for (size_t index = 0; index < sizeof(payload); ++index) {
        payload[index] = (uint8_t)(pixel_seed + index);
    }
    manifest.payload_crc32 = crc32_bytes(payload, sizeof(payload));
    memcpy(manifest.firmware_sha256, sha, 32u);
    snprintf(manifest.title, sizeof(manifest.title), "Cover %u/%u",
             (unsigned)slot_id, (unsigned)bank);
    snprintf(manifest.version, sizeof(manifest.version), "%u.0",
             (unsigned)generation);
    assert(launcher_manifest_encode(encoded, &manifest));
    memcpy(s_storage + offset, encoded, sizeof(encoded));
    memcpy(s_storage + offset + LAUNCHER_COVER_PAYLOAD_OFFSET, payload,
           sizeof(payload));
}

static void reset_storage(void)
{
    memset(s_storage, 0xff, sizeof(s_storage));
    s_largest_read = 0u;
}

static void test_selects_newest_valid_bank_and_wraps(void)
{
    launcher_cover_record_t record;
    launcher_cover_source_t memory = source();
    uint8_t sha[32];

    reset_storage();
    fill_sha(sha, 7u);
    write_bank(1u, 0u, 41u, sha, 0x10u);
    write_bank(1u, 1u, 42u, sha, 0x20u);
    assert(launcher_cover_store_select(&memory, 1u, sha, &record));
    assert(record.valid && record.bank == 1u);
    assert(record.manifest.generation == 42u);
    assert(s_largest_read <= LAUNCHER_COVER_VERIFY_CHUNK);

    reset_storage();
    write_bank(1u, 0u, UINT32_MAX - 1u, sha, 0x30u);
    write_bank(1u, 1u, 2u, sha, 0x40u);
    assert(launcher_cover_store_select(&memory, 1u, sha, &record));
    assert(record.bank == 1u && record.manifest.generation == 2u);
}

static void test_falls_back_when_newer_bank_is_bad(void)
{
    launcher_cover_record_t record;
    launcher_cover_source_t memory = source();
    uint8_t sha[32];
    size_t newer;

    reset_storage();
    fill_sha(sha, 12u);
    write_bank(2u, 0u, 8u, sha, 0x51u);
    write_bank(2u, 1u, 9u, sha, 0x61u);
    newer = launcher_cover_bank_offset(2u, 1u);
    s_storage[newer + LAUNCHER_COVER_PAYLOAD_OFFSET + 17u] ^= 0xffu;
    assert(launcher_cover_store_select(&memory, 2u, sha, &record));
    assert(record.bank == 0u && record.manifest.generation == 8u);

    write_bank(2u, 1u, 10u, sha, 0x71u);
    s_storage[newer + LAUNCHER_MANIFEST_ENCODED_SIZE - 1u] ^= 0x01u;
    assert(launcher_cover_store_select(&memory, 2u, sha, &record));
    assert(record.bank == 0u);
}

static void test_rejects_erased_partial_wrong_sha_and_bounds(void)
{
    launcher_cover_record_t record;
    launcher_cover_source_t memory = source();
    uint8_t sha[32];
    uint8_t other_sha[32];
    uint8_t bytes[32];

    reset_storage();
    fill_sha(sha, 20u);
    fill_sha(other_sha, 21u);
    assert(!launcher_cover_store_select(&memory, 0u, sha, &record));
    assert(!record.valid);

    write_bank(0u, 0u, 1u, sha, 0x82u);
    assert(!launcher_cover_store_select(&memory, 0u, other_sha, &record));
    memset(s_storage + LAUNCHER_COVER_PAYLOAD_OFFSET + 100u, 0xff, 1000u);
    assert(!launcher_cover_store_select(&memory, 0u, sha, &record));

    reset_storage();
    write_bank(0u, 0u, 3u, sha, 0x93u);
    assert(launcher_cover_store_select(&memory, 0u, sha, &record));
    assert(launcher_cover_store_read_payload(&memory, &record, 4u, bytes,
                                             sizeof(bytes)));
    assert(!launcher_cover_store_read_payload(
        &memory, &record, LAUNCHER_COVER_PAYLOAD_LENGTH - 8u, bytes,
        sizeof(bytes)));
    memory.size = launcher_cover_bank_offset(0u, 0u) +
                  LAUNCHER_COVER_PAYLOAD_OFFSET + 16u;
    assert(!launcher_cover_store_read_payload(&memory, &record, 0u, bytes,
                                              sizeof(bytes)));
}

int main(void)
{
    test_selects_newest_valid_bank_and_wraps();
    test_falls_back_when_newer_bank_is_bad();
    test_rejects_erased_partial_wrong_sha_and_bounds();
    puts("Launcher cover store: PASS");
    return 0;
}
