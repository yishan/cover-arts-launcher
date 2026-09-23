idf_component_register(
    SRCS "main.c"
         "launcher_boot.c"
         "launcher_boot_policy.c"
         "launcher_cover_store.c"
         "launcher_cover_view.c"
         "launcher_manifest.c"
         "launcher_model.c"
         "launcher_slot_policy.c"
         "launcher_slots.c"
         "launcher_trust_store.c"
         "launcher_ui.c"
    INCLUDE_DIRS "."
    REQUIRES bsp app_update bootloader_support esp_partition esp_system esp_timer mbedtls
)

target_sources(${COMPONENT_LIB} PRIVATE
    "${CMAKE_CURRENT_LIST_DIR}/../assets/fonts/launcher_source_han_sans_sc_16_gb2312.c"
)
