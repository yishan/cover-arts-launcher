#ifndef LAUNCHER_CONTRACT_H
#define LAUNCHER_CONTRACT_H

#include "esp_err.h"

/**
 * Reverify the factory Launcher, select it as the boot target, and restart.
 *
 * The function returns only on failure. It never selects an unverified image.
 * Call it only from task context after the play confirms it is on its cover.
 */
esp_err_t launcher_contract_return_to_factory(void);

#endif
