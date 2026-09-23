#!/usr/bin/env python3
"""Define the public firmware artifact name from one checked version source."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[1]
APP = "FoloToy-AI-Passport"
PRODUCT = "FoloToy-AI-Passport-Cover-Arts-Launcher"
VERSION_FILE = REPOSITORY / "firmware_version.txt"
SEMANTIC_VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)")


def read_version() -> str:
    version = VERSION_FILE.read_text(encoding="ascii").strip()
    if not SEMANTIC_VERSION.fullmatch(version):
        raise ValueError(f"invalid semantic firmware version: {version!r}")
    return version


VERSION = read_version()
FULL_BIN = f"{PRODUCT}-v{VERSION}-full.bin"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("field", choices=("app", "product", "version", "full-bin"))
    args = parser.parse_args(argv)
    print({
        "app": APP,
        "product": PRODUCT,
        "version": VERSION,
        "full-bin": FULL_BIN,
    }[args.field])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
