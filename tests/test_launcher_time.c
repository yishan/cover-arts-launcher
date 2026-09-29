#include "launcher_time.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

int main(void)
{
    char text[24];

    assert(launcher_format_install_time(text, sizeof(text), 1727222400u, 480));
    assert(strcmp(text, "2024-09-25 08:00") == 0);
    assert(launcher_format_install_time(text, sizeof(text), 1704067200u, -300));
    assert(strcmp(text, "2023-12-31 19:00") == 0);
    assert(!launcher_format_install_time(text, sizeof(text), 0u, 480));
    puts("Launcher install time: PASS");
    return 0;
}
