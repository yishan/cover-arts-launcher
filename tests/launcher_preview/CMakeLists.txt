cmake_minimum_required(VERSION 3.16)
project(launcher_preview C)
set(CMAKE_C_STANDARD 11)

if(NOT EXISTS "${LVGL_DIR}/lvgl.h")
    message(FATAL_ERROR "Set LVGL_DIR to the pinned LVGL 9.5.0 source directory")
endif()
file(GLOB_RECURSE LVGL_SOURCES "${LVGL_DIR}/src/*.c")
add_library(lvgl_host STATIC ${LVGL_SOURCES})
target_include_directories(lvgl_host PUBLIC "${LVGL_DIR}")
target_compile_definitions(
    lvgl_host PUBLIC LV_CONF_PATH="${CMAKE_CURRENT_SOURCE_DIR}/lv_conf.h"
)

add_executable(
    launcher_preview
    preview.c
    ../../main/launcher_cover_store.c
    ../../main/launcher_cover_view.c
    ../../main/launcher_manifest.c
    ../../main/launcher_model.c
    ../../main/launcher_time.c
    ../../main/launcher_ui.c
    ../../assets/fonts/launcher_source_han_sans_sc_16_gb2312.c
)
target_include_directories(launcher_preview PRIVATE ../../main)
target_compile_options(launcher_preview PRIVATE -Wall -Wextra -Werror -UNDEBUG)
target_link_libraries(launcher_preview PRIVATE lvgl_host m)
