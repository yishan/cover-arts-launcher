#ifndef LAUNCHER_TIME_H
#define LAUNCHER_TIME_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

bool launcher_format_install_time(char *out, size_t out_size,
                                  uint64_t unix_seconds,
                                  int16_t utc_offset_minutes);

#endif
