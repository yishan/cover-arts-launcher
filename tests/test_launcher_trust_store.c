#include "launcher_trust_store.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

#define STORAGE_SIZE (LAUNCHER_TRUST_REGION_OFFSET + LAUNCHER_TRUST_USED_SIZE)

static uint8_t s_storage[STORAGE_SIZE];

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

static void write_u16_le(uint8_t *bytes, uint16_t value)
{
    bytes[0] = (uint8_t)value;
    bytes[1] = (uint8_t)(value >> 8u);
}

static void write_u32_le(uint8_t *bytes, uint32_t value)
{
    bytes[0] = (uint8_t)value;
    bytes[1] = (uint8_t)(value >> 8u);
    bytes[2] = (uint8_t)(value >> 16u);
    bytes[3] = (uint8_t)(value >> 24u);
}

static bool read_memory(void *context, size_t offset, void *destination,
                        size_t length)
{
    uint8_t *storage = context;
    if (offset > sizeof(s_storage) || length > sizeof(s_storage) - offset) {
        return false;
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

static void write_record(uint8_t slot_id, uint8_t bank, uint32_t generation,
                         uint32_t image_length, const uint8_t sha[32])
{
    uint8_t record[LAUNCHER_TRUST_RECORD_SIZE] = {0};
    size_t offset = launcher_trust_bank_offset(slot_id, bank);

    memcpy(record, "TRS1", 4u);
    write_u16_le(record + 4u, 1u);
    write_u16_le(record + 6u, LAUNCHER_TRUST_RECORD_SIZE);
    write_u32_le(record + 8u, generation);
    record[12] = slot_id;
    record[13] = LAUNCHER_TRUST_POLICY_RESIDENT;
    write_u32_le(record + 16u, image_length);
    memcpy(record + 20u, sha, 32u);
    write_u32_le(record + 252u, crc32_bytes(record, 252u));
    memcpy(s_storage + offset, record, sizeof(record));
}

static void test_selects_newest_exact_receipt(void)
{
    launcher_cover_source_t memory = source();
    launcher_trust_record_t record;
    uint8_t sha[32];

    memset(s_storage, 0xff, sizeof(s_storage));
    fill_sha(sha, 7u);
    write_record(1u, 0u, 10u, 0x12345u, sha);
    write_record(1u, 1u, 11u, 0x12345u, sha);
    assert(launcher_trust_store_select(&memory, 1u, sha, 0x12345u,
                                       &record));
    assert(record.valid && record.bank == 1u && record.generation == 11u);
    assert(record.policy == LAUNCHER_TRUST_POLICY_RESIDENT);
}

static void test_rejects_wrong_binding_and_corruption(void)
{
    launcher_cover_source_t memory = source();
    launcher_trust_record_t record;
    uint8_t sha[32];
    uint8_t other_sha[32];
    size_t offset;

    memset(s_storage, 0xff, sizeof(s_storage));
    fill_sha(sha, 12u);
    fill_sha(other_sha, 13u);
    write_record(2u, 0u, 3u, 4096u, sha);
    assert(!launcher_trust_store_select(&memory, 2u, other_sha, 4096u,
                                        &record));
    assert(!launcher_trust_store_select(&memory, 2u, sha, 4097u, &record));
    offset = launcher_trust_bank_offset(2u, 0u);
    s_storage[offset + 20u] ^= 0xffu;
    assert(!launcher_trust_store_select(&memory, 2u, sha, 4096u, &record));
}

int main(void)
{
    assert(launcher_trust_bank_offset(0u, 0u) == 0x60000u);
    assert(launcher_trust_bank_offset(2u, 1u) == 0x65000u);
    test_selects_newest_exact_receipt();
    test_rejects_wrong_binding_and_corruption();
    puts("Launcher trust store: PASS");
    return 0;
}
