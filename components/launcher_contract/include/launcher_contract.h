#ifndef LAUNCHER_CONTRACT_H
#define LAUNCHER_CONTRACT_H

#include "esp_err.h"

/**
 * Confirm that the running child application is healthy.
 *
 * Call only after the child has initialized the behavior needed for normal
 * use. Calling this from the factory Launcher or a non-OTA image returns
 * ESP_ERR_INVALID_STATE.
 */
esp_err_t launcher_contract_mark_valid(void);

/**
 * Reverify the factory Launcher, select it as the boot target, and restart.
 *
 * The function returns only on failure. It never selects an unverified image.
 */
esp_err_t launcher_contract_return_to_factory(void);

#endif
