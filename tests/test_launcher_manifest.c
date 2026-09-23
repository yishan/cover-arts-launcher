#include "launcher_manifest.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static launcher_cover_manifest_t valid_manifest(void)
{
    launcher_cover_manifest_t manifest = {
        .generation = 7,
        .slot_id = 1,
        .source_kind = LAUNCHER_SOURCE_PLAY_API,
        .width = LAUNCHER_COVER_WIDTH,
        .height = LAUNCHER_COVER_HEIGHT,
        .payload_length = LAUNCHER_COVER_PAYLOAD_LENGTH,
        .payload_crc32 = 0x12345678u,
    };

    for (size_t index = 0; index < sizeof(manifest.firmware_sha256); ++index) {
        manifest.firmware_sha256[index] = (uint8_t)(index + 1u);
    }
    strcpy(manifest.title, "Penalty Kick");
    strcpy(manifest.source_id, "play:281");
    strcpy(manifest.version, "1.2.3");
    return manifest;
}

static void test_valid_round_trip(void)
{
    launcher_cover_manifest_t input = valid_manifest();
    launcher_cover_manifest_t output;
    uint8_t encoded[LAUNCHER_MANIFEST_ENCODED_SIZE];

    assert(launcher_manifest_encode(encoded, &input));
    assert(launcher_manifest_decode(&output, encoded, sizeof(encoded)));
    assert(output.generation == input.generation);
    assert(output.slot_id == input.slot_id);
    assert(output.source_kind == input.source_kind);
    assert(output.width == input.width);
    assert(output.height == input.height);
    assert(output.payload_length == input.payload_length);
    assert(output.payload_crc32 == input.payload_crc32);
    assert(memcmp(output.firmware_sha256, input.firmware_sha256,
                  sizeof(input.firmware_sha256)) == 0);
    assert(strcmp(output.title, input.title) == 0);
    assert(strcmp(output.source_id, input.source_id) == 0);
    assert(strcmp(output.version, input.version) == 0);
    assert(launcher_manifest_matches_image(&output, input.firmware_sha256));
}

static void test_decode_rejects_bad_identity(void)
{
    launcher_cover_manifest_t input = valid_manifest();
    launcher_cover_manifest_t output;
    uint8_t encoded[LAUNCHER_MANIFEST_ENCODED_SIZE];

    assert(launcher_manifest_encode(encoded, &input));
    encoded[0] ^= 0x01u;
    assert(!launcher_manifest_decode(&output, encoded, sizeof(encoded)));

    assert(launcher_manifest_encode(encoded, &input));
    encoded[4] ^= 0x01u;
    assert(!launcher_manifest_decode(&output, encoded, sizeof(encoded)));
}

static void test_encode_rejects_invalid_fields(void)
{
    struct invalid_case {
        const char *name;
        launcher_cover_manifest_t manifest;
    } cases[5];
    uint8_t encoded[LAUNCHER_MANIFEST_ENCODED_SIZE];

    for (size_t index = 0; index < 5; ++index) {
        cases[index].manifest = valid_manifest();
    }
    cases[0].name = "slot";
    cases[0].manifest.slot_id = LAUNCHER_SLOT_COUNT;
    cases[1].name = "width";
    cases[1].manifest.width = LAUNCHER_COVER_WIDTH - 1u;
    cases[2].name = "height";
    cases[2].manifest.height = LAUNCHER_COVER_HEIGHT + 1u;
    cases[3].name = "payload";
    cases[3].manifest.payload_length = LAUNCHER_COVER_PAYLOAD_LENGTH + 1u;
    cases[4].name = "utf8";
    cases[4].manifest.title[0] = (char)0xc3;
    cases[4].manifest.title[1] = (char)0x28;
    cases[4].manifest.title[2] = '\0';

    for (size_t index = 0; index < 5; ++index) {
        if (launcher_manifest_encode(encoded, &cases[index].manifest)) {
            fprintf(stderr, "accepted invalid %s manifest\n", cases[index].name);
            assert(false);
        }
    }
}

static void test_source_rules(void)
{
    launcher_cover_manifest_t manifest = valid_manifest();
    launcher_cover_manifest_t output;
    uint8_t encoded[LAUNCHER_MANIFEST_ENCODED_SIZE];

    manifest.source_id[0] = '\0';
    assert(!launcher_manifest_encode(encoded, &manifest));

    manifest.source_kind = LAUNCHER_SOURCE_LOCAL_FILE;
    assert(launcher_manifest_encode(encoded, &manifest));
    assert(launcher_manifest_decode(&output, encoded, sizeof(encoded)));
    assert(output.source_id[0] == '\0');
}

static void test_sha_mismatch(void)
{
    launcher_cover_manifest_t manifest = valid_manifest();
    uint8_t other_sha[32];

    memcpy(other_sha, manifest.firmware_sha256, sizeof(other_sha));
    other_sha[31] ^= 0x01u;
    assert(!launcher_manifest_matches_image(&manifest, other_sha));
    assert(!launcher_manifest_matches_image(NULL, other_sha));
    assert(!launcher_manifest_matches_image(&manifest, NULL));
}

int main(void)
{
    test_valid_round_trip();
    test_decode_rejects_bad_identity();
    test_encode_rejects_invalid_fields();
    test_source_rules();
    test_sha_mismatch();
    puts("Launcher manifest: PASS");
    return 0;
}
