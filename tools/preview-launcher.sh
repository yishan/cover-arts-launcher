#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
lvgl_dir="${1:-${repo_root}/managed_components/lvgl__lvgl}"
output_dir="${2:-${repo_root}/build/launcher-preview}"

if [[ ! -f "${lvgl_dir}/lv_version.h" ]] ||
   ! grep -Eq 'LVGL_VERSION_MAJOR[[:space:]]+9' "${lvgl_dir}/lv_version.h" ||
   ! grep -Eq 'LVGL_VERSION_MINOR[[:space:]]+5' "${lvgl_dir}/lv_version.h" ||
   ! grep -Eq 'LVGL_VERSION_PATCH[[:space:]]+0' "${lvgl_dir}/lv_version.h"; then
    echo "Expected LVGL 9.5.0 sources; pass their directory as the first argument." >&2
    exit 1
fi

mkdir -p "${output_dir}"
if command -v cmake >/dev/null 2>&1; then
    cmake -S "${repo_root}/tests/launcher_preview" -B "${output_dir}/host-build" \
        -DLVGL_DIR="${lvgl_dir}" -DCMAKE_BUILD_TYPE=Debug
    cmake --build "${output_dir}/host-build" --parallel 6
    preview_bin="${output_dir}/host-build/launcher_preview"
else
    object_dir="${output_dir}/host-objects"
    lvgl_archive="${output_dir}/liblvgl_host.a"
    if [[ ! -f "${lvgl_archive}" ]]; then
        rm -rf "${object_dir}"
        mkdir -p "${object_dir}"
        find "${lvgl_dir}/src" -type f -name '*.c' | while IFS= read -r source; do
            relative=${source#"${lvgl_dir}/src/"}
            object="${object_dir}/${relative%.c}.o"
            mkdir -p "$(dirname "${object}")"
            "${CC:-cc}" -std=c11 -w -I"${lvgl_dir}" \
                -DLV_CONF_PATH="\"${repo_root}/tests/launcher_preview/lv_conf.h\"" \
                -c "${source}" -o "${object}"
            ar rcs "${lvgl_archive}" "${object}"
        done
    fi
    preview_bin="${output_dir}/launcher_preview"
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -UNDEBUG \
        -I"${lvgl_dir}" -I"${repo_root}/main" \
        -DLV_CONF_PATH="\"${repo_root}/tests/launcher_preview/lv_conf.h\"" \
        "${repo_root}/tests/launcher_preview/preview.c" \
        "${repo_root}/main/launcher_cover_store.c" \
        "${repo_root}/main/launcher_cover_view.c" \
        "${repo_root}/main/launcher_manifest.c" \
        "${repo_root}/main/launcher_model.c" \
        "${repo_root}/main/launcher_time.c" \
        "${repo_root}/main/launcher_ui.c" \
        "${repo_root}/assets/fonts/launcher_source_han_sans_sc_16_gb2312.c" \
        "${lvgl_archive}" -lm -o "${preview_bin}"
fi
"${preview_bin}" "${output_dir}"
echo "Launcher LVGL captures (PPM): ${output_dir}"
