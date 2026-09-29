#!/usr/bin/env python3
"""Host tests for the configurable firmware-layout parser and verifier."""

from __future__ import annotations

import csv
import hashlib
import importlib.util
import struct
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
SPEC = importlib.util.spec_from_file_location(
    "verify_firmware", ROOT / "tools" / "verify_firmware.py"
)
assert SPEC and SPEC.loader
VERIFY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = VERIFY
SPEC.loader.exec_module(VERIFY)


DEFAULT_TABLE_OFFSET = 0x8000
DEFAULT_APP_OFFSET = 0x10000
DEFAULT_APP_SIZE = VERIFY.FLASH_SIZE - DEFAULT_APP_OFFSET

LAUNCHER_PARTITIONS = (
    ("nvs", "data", "nvs", 0x9000, 0x6000),
    ("phy_init", "data", "phy", 0xF000, 0x1000),
    ("factory", "app", "factory", 0x10000, 0x170000),
    ("otadata", "data", "ota", 0x7FE000, 0x2000),
)


def configured_partitions() -> tuple[tuple[str, str, str, int, int], ...]:
    rows: list[tuple[str, str, str, int, int]] = []
    with (ROOT / "partitions.csv").open(encoding="utf-8", newline="") as source:
        for raw_row in csv.reader(source):
            if not raw_row or raw_row[0].lstrip().startswith("#"):
                continue
            fields = [field.strip() for field in raw_row]
            rows.append(
                (fields[0], fields[1], fields[2], int(fields[3], 0), int(fields[4], 0))
            )
    return tuple(rows)


def sample_table(entries: tuple[tuple[int, int, int, int, str], ...] | None = None) -> bytes:
    if entries is None:
        entries = (
            (1, 2, 0x9000, 0x6000, "nvs"),
            (1, 1, 0xF000, 0x1000, "phy_init"),
            (0, 0, DEFAULT_APP_OFFSET, DEFAULT_APP_SIZE, "factory"),
        )
    raw = bytearray(b"\xff" * VERIFY.PARTITION_TABLE_SIZE)
    for index, (kind, subtype, offset, size, label) in enumerate(entries):
        VERIFY.ENTRY.pack_into(
            raw,
            index * VERIFY.ENTRY.size,
            0x50AA,
            kind,
            subtype,
            offset,
            size,
            label.encode().ljust(16, b"\0"),
            0,
        )
    marker = len(entries) * VERIFY.ENTRY.size
    struct.pack_into("<H", raw, marker, 0xEBEB)
    raw[marker + 16 : marker + 32] = hashlib.md5(raw[:marker]).digest()
    return bytes(raw)


def merged_with_table(
    table: bytes | None = None,
    table_offset: int = DEFAULT_TABLE_OFFSET,
    app_offset: int = DEFAULT_APP_OFFSET,
) -> bytearray:
    merged = bytearray(b"\xff" * (max(table_offset + VERIFY.PARTITION_TABLE_SIZE, app_offset) + 1))
    merged[
        table_offset : table_offset + VERIFY.PARTITION_TABLE_SIZE
    ] = table or sample_table()
    merged[app_offset] = 0xE9
    return merged


class PartitionParserTest(unittest.TestCase):
    def test_parses_minimal_layout_and_md5(self) -> None:
        partitions, found_md5 = VERIFY.parse_partition_table(sample_table())
        self.assertTrue(found_md5)
        self.assertEqual([item.label for item in partitions], ["nvs", "phy_init", "factory"])
        self.assertEqual(partitions[-1].size, DEFAULT_APP_SIZE)

    def test_rejects_bad_md5(self) -> None:
        raw = bytearray(sample_table())
        raw[28] ^= 1
        with self.assertRaisesRegex(ValueError, "MD5"):
            VERIFY.parse_partition_table(bytes(raw))


class FirmwareLayoutTest(unittest.TestCase):
    def test_repository_uses_launcher_partition_contract(self) -> None:
        actual = configured_partitions()
        self.assertEqual(actual, LAUNCHER_PARTITIONS)

        ordered = sorted(actual, key=lambda item: item[3])
        for left, right in zip(ordered, ordered[1:]):
            self.assertLessEqual(left[3] + left[4], right[3])
        self.assertEqual(ordered[-1][3] + ordered[-1][4], VERIFY.FLASH_SIZE)

        ota_sizes = [size for name, _, _, _, size in actual if name.startswith("ota_")]
        self.assertEqual(ota_sizes, [])
        self.assertEqual(actual[-1][3], 0x7FE000)

    def verify(
        self,
        merged: bytes,
        app_size: int = 1,
        table_offset: int = DEFAULT_TABLE_OFFSET,
        app_offset: int = DEFAULT_APP_OFFSET,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            build_dir = Path(directory)
            with (build_dir / "FoloToy-AI-Passport.bin").open("wb") as app_file:
                app_file.write(b"\xe9")
                app_file.truncate(app_size)
            VERIFY.verify_firmware_layout(merged, build_dir, table_offset, app_offset)

    def test_layout_verification_accepts_current_partition_table(self) -> None:
        self.verify(bytes(merged_with_table()))

    def test_accepts_custom_data_partition(self) -> None:
        entries = (
            (1, 2, 0x9000, 0x6000, "nvs"),
            (1, 1, 0xF000, 0x1000, "phy_init"),
            (0, 0, DEFAULT_APP_OFFSET, 0x300000, "factory"),
            (1, 2, 0x310000, 0x4000, "unused"),
        )
        self.verify(bytes(merged_with_table(sample_table(entries))))

    def test_rejects_overlapping_partitions(self) -> None:
        entries = (
            (1, 2, 0x9000, 0x6000, "nvs"),
            (1, 1, 0xE000, 0x2000, "phy_init"),
            (0, 0, DEFAULT_APP_OFFSET, DEFAULT_APP_SIZE, "factory"),
        )
        with self.assertRaisesRegex(ValueError, "overlap"):
            self.verify(bytes(merged_with_table(sample_table(entries))))

    def test_accepts_moved_app_partition(self) -> None:
        app_offset = 0x20000
        entries = (
            (1, 2, 0x9000, 0x6000, "nvs"),
            (1, 1, 0xF000, 0x1000, "phy_init"),
            (0, 0, app_offset, VERIFY.FLASH_SIZE - app_offset, "factory"),
        )
        merged = merged_with_table(sample_table(entries), app_offset=app_offset)
        self.verify(bytes(merged), app_offset=app_offset)

    def test_rejects_oversized_application(self) -> None:
        with self.assertRaisesRegex(ValueError, "application .* partition limit"):
            self.verify(bytes(merged_with_table()), DEFAULT_APP_SIZE + 1)

    def test_rejects_missing_application_image(self) -> None:
        merged = merged_with_table()
        merged[DEFAULT_APP_OFFSET] = 0xFF
        with self.assertRaisesRegex(ValueError, "no ESP application image"):
            self.verify(bytes(merged))

    def test_rejects_app_offset_without_matching_partition(self) -> None:
        app_offset = 0x20000
        merged = merged_with_table(app_offset=app_offset)
        with self.assertRaisesRegex(ValueError, "match exactly one app partition"):
            self.verify(bytes(merged), app_offset=app_offset)

    def test_rejects_duplicate_partition_labels(self) -> None:
        entries = (
            (1, 2, 0x9000, 0x6000, "data"),
            (1, 1, 0xF000, 0x1000, "data"),
            (0, 0, DEFAULT_APP_OFFSET, DEFAULT_APP_SIZE, "factory"),
        )
        with self.assertRaisesRegex(ValueError, "labels must be unique"):
            self.verify(bytes(merged_with_table(sample_table(entries))))


class FlashArgsTest(unittest.TestCase):
    def test_parses_configured_image_offsets(self) -> None:
        offsets = VERIFY.parse_flash_args(
            "--flash_mode dio --flash_size 8MB\n"
            "0x0 bootloader/bootloader.bin\n"
            "0x18000 FoloToy-AI-Passport.bin\n"
            "0x9000 partition_table/partition-table.bin\n"
        )
        self.assertEqual(offsets["FoloToy-AI-Passport.bin"], 0x18000)
        self.assertEqual(offsets["partition_table/partition-table.bin"], 0x9000)


if __name__ == "__main__":
    unittest.main()
