#include "launcher_time.h"

#include <stdio.h>

bool launcher_format_install_time(char *out, size_t out_size,
                                  uint64_t unix_seconds,
                                  int16_t utc_offset_minutes)
{
    int64_t local_seconds;
    int64_t days;
    int64_t seconds_of_day;
    int64_t era;
    unsigned day_of_era;
    unsigned year_of_era;
    int year;
    unsigned day_of_year;
    unsigned month_part;
    unsigned day;
    unsigned month;

    if (out == NULL || out_size < 17u || unix_seconds == 0u ||
        unix_seconds > 253402300799u || utc_offset_minutes < -840 ||
        utc_offset_minutes > 840) {
        return false;
    }
    local_seconds = (int64_t)unix_seconds +
                    (int64_t)utc_offset_minutes * 60;
    if (local_seconds < 0) {
        return false;
    }
    days = local_seconds / 86400;
    seconds_of_day = local_seconds % 86400;

    /* Gregorian civil date from days since 1970-01-01. */
    days += 719468;
    era = days / 146097;
    day_of_era = (unsigned)(days - era * 146097);
    year_of_era = (day_of_era - day_of_era / 1460u + day_of_era / 36524u -
                   day_of_era / 146096u) / 365u;
    year = (int)year_of_era + (int)era * 400;
    day_of_year = day_of_era -
                  (365u * year_of_era + year_of_era / 4u -
                   year_of_era / 100u);
    month_part = (5u * day_of_year + 2u) / 153u;
    day = day_of_year - (153u * month_part + 2u) / 5u + 1u;
    month = month_part < 10u ? month_part + 3u : month_part - 9u;
    year += month <= 2u;

    return snprintf(out, out_size, "%04d-%02u-%02u %02lld:%02lld", year,
                    month, day, (long long)(seconds_of_day / 3600),
                    (long long)((seconds_of_day % 3600) / 60)) == 16;
}
