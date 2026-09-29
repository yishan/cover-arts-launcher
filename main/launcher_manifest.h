#ifndef LAUNCHER_MANIFEST_H
#define LAUNCHER_MANIFEST_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LAUNCHER_COVER_MAGIC 0x31525643u /* "CVR1" in little-endian storage. */
#define LAUNCHER_COVER_SCHEMA 1u
#define LAUNCHER_MANIFEST_ENCODED_SIZE 256u
#define LAUNCHER_LEGACY_SLOT_COUNT 3u
#define LAUNCHER_COVER_WIDTH 120u
#define LAUNCHER_COVER_HEIGHT 160u
#define LAUNCHER_COVER_PAYLOAD_LENGTH 38400u
#define LAUNCHER_TITLE_MAX 64u
#define LAUNCHER_SOURCE_ID_MAX 48u
#define LAUNCHER_COVER_VERSION_MAX 24u

typedef enum {
    LAUNCHER_SOURCE_LOCAL_FILE = 0,
    LAUNCHER_SOURCE_PLAY_API = 1,
} launcher_source_kind_t;

typedef struct {
    uint32_t generation;
    uint8_t slot_id;
    uint8_t source_kind;
    uint16_t width;
    uint16_t height;
    uint32_t payload_length;
    uint32_t payload_crc32;
    uint8_t firmware_sha256[32];
    char title[LAUNCHER_TITLE_MAX + 1u];
    char source_id[LAUNCHER_SOURCE_ID_MAX + 1u];
    char version[LAUNCHER_COVER_VERSION_MAX + 1u];
} launcher_cover_manifest_t;

/**
 * Encode one manifest into the canonical 256-byte little-endian format.
 *
 * The function rejects unterminated strings, invalid UTF-8, unsupported cover
 * dimensions or source kinds, and Play API entries without a stable source ID.
 * It performs no allocation and is safe to call outside the LVGL task.
 */
bool launcher_manifest_encode(uint8_t out[LAUNCHER_MANIFEST_ENCODED_SIZE],
                              const launcher_cover_manifest_t *manifest);

/**
 * Decode and validate one canonical manifest.
 *
 * At least 256 readable bytes must be supplied. Trailing bytes, such as the
 * remainder of a 4 KiB manifest sector, are ignored.
 */
bool launcher_manifest_decode(launcher_cover_manifest_t *out,
                              const uint8_t *bytes, size_t length);

/** Return true when the manifest is bound to the supplied application SHA. */
bool launcher_manifest_matches_image(const launcher_cover_manifest_t *manifest,
                                     const uint8_t image_sha256[32]);

#endif
