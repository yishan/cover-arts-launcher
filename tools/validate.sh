#!/usr/bin/env bash
set -euo pipefail

mode="${1:---all}"
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
    echo "Usage: $0 [--all|--static|--firmware]" >&2
}

run_static_checks() {
    local actionlint_bin
    local test_dir

    python3 tools/check_repo.py

    actionlint_bin="${ACTIONLINT_BIN:-}"
    if [[ -z "${actionlint_bin}" ]]; then
        actionlint_bin="$(command -v actionlint || true)"
    fi
    if [[ -z "${actionlint_bin}" || ! -x "${actionlint_bin}" ]]; then
        actionlint_bin="$(./tools/install-actionlint.sh)"
    fi
    "${actionlint_bin}" -color .github/workflows/*.yml

    test_dir="$(mktemp -d /tmp/ai-passport-host-tests.XXXXXX)"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Imain \
        tests/test_ui_pixel_math.c main/ui_pixel_math.c \
        -o "${test_dir}/test_ui_pixel_math"
    "${test_dir}/test_ui_pixel_math"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Imain \
        tests/test_demo_navigation.c main/demo_navigation.c \
        -o "${test_dir}/test_demo_navigation"
    "${test_dir}/test_demo_navigation"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Imain \
        tests/test_launcher_manifest.c main/launcher_manifest.c \
        -o "${test_dir}/test_launcher_manifest"
    "${test_dir}/test_launcher_manifest"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Imain \
        tests/test_launcher_cover_store.c main/launcher_cover_store.c \
        main/launcher_manifest.c -o "${test_dir}/test_launcher_cover_store"
    "${test_dir}/test_launcher_cover_store"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Imain \
        tests/test_launcher_trust_store.c main/launcher_trust_store.c \
        -o "${test_dir}/test_launcher_trust_store"
    "${test_dir}/test_launcher_trust_store"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Imain \
        tests/test_launcher_time.c main/launcher_time.c \
        -o "${test_dir}/test_launcher_time"
    "${test_dir}/test_launcher_time"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Imain \
        tests/test_launcher_cover_view.c main/launcher_cover_view.c \
        main/launcher_cover_store.c main/launcher_manifest.c \
        main/launcher_model.c -o "${test_dir}/test_launcher_cover_view"
    "${test_dir}/test_launcher_cover_view"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Imain \
        tests/test_launcher_model.c main/launcher_model.c \
        -o "${test_dir}/test_launcher_model"
    "${test_dir}/test_launcher_model"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Imain \
        tests/test_launcher_boot_policy.c main/launcher_boot_policy.c \
        -o "${test_dir}/test_launcher_boot_policy"
    "${test_dir}/test_launcher_boot_policy"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Imain \
        tests/test_launcher_slot_policy.c main/launcher_slot_policy.c \
        -o "${test_dir}/test_launcher_slot_policy"
    "${test_dir}/test_launcher_slot_policy"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Icomponents/bsp/src \
        tests/test_bsp_display_rounding.c components/bsp/src/bsp_display_rounding.c \
        -o "${test_dir}/test_bsp_display_rounding"
    "${test_dir}/test_bsp_display_rounding"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Icomponents/bsp/src \
        tests/test_bsp_es8311_sleep_check.c components/bsp/src/bsp_es8311_sleep_check.c \
        -o "${test_dir}/test_bsp_es8311_sleep_check"
    "${test_dir}/test_bsp_es8311_sleep_check"
    PYTHONDONTWRITEBYTECODE=1 python3 tests/test_deep_sleep_contract.py
    PYTHONDONTWRITEBYTECODE=1 python3 tests/test_launcher_shell_contract.py
    PYTHONDONTWRITEBYTECODE=1 python3 tests/test_launcher_art_contract.py
    PYTHONDONTWRITEBYTECODE=1 python3 tests/test_launcher_contract_source.py
    PYTHONDONTWRITEBYTECODE=1 python3 tests/test_check_repo.py
    PYTHONDONTWRITEBYTECODE=1 python3 tests/test_firmware_artifact.py
    PYTHONDONTWRITEBYTECODE=1 python3 tests/test_release_preflight.py
    PYTHONDONTWRITEBYTECODE=1 python3 tests/test_verify_firmware.py
    PYTHONDONTWRITEBYTECODE=1 python3 tests/test_archive_firmware.py
    PYTHONDONTWRITEBYTECODE=1 python3 tests/test_install_passport_skills.py
    node --test tools/install-slot/test-*.mjs
    rm -rf "${test_dir}"
    echo "Host tests: PASS"
}

run_firmware_checks() (
    local full_bin_name
    local validation_build_dir

    if ! command -v idf.py >/dev/null 2>&1; then
        echo "ERROR: idf.py is not available; activate ESP-IDF 5.5.3 first." >&2
        return 1
    fi

    full_bin_name="$(PYTHONDONTWRITEBYTECODE=1 python3 tools/firmware_artifact.py full-bin)"
    validation_build_dir="$(mktemp -d /tmp/ai-passport-firmware.XXXXXX)"
    trap 'case "${validation_build_dir}" in /tmp/ai-passport-firmware.*) rm -rf -- "${validation_build_dir}" ;; esac' EXIT

    SDKCONFIG_DEFAULTS="${repo_root}/sdkconfig.defaults" \
        idf.py -B "${validation_build_dir}" \
        -D "SDKCONFIG=${validation_build_dir}/sdkconfig" build
    idf.py -B "${validation_build_dir}" merge-bin \
        -o "${validation_build_dir}/${full_bin_name}"
    PYTHONDONTWRITEBYTECODE=1 python3 tools/verify_firmware.py "${validation_build_dir}"
    PYTHONDONTWRITEBYTECODE=1 python3 tools/archive_firmware.py create \
        "${validation_build_dir}" --archive-root "${repo_root}/build/firmware"
    mkdir -p "${repo_root}/build"
    install -m 0644 \
        "${validation_build_dir}/${full_bin_name}" \
        "${repo_root}/build/${full_bin_name}"
    echo "Firmware build: PASS (build/${full_bin_name})"
)

cd "${repo_root}"
case "${mode}" in
    --all)
        run_static_checks
        run_firmware_checks
        ;;
    --static)
        run_static_checks
        ;;
    --firmware)
        run_firmware_checks
        ;;
    *)
        usage
        exit 2
        ;;
esac
