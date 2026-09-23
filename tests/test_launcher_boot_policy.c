#include "launcher_boot_policy.h"

#include <assert.h>
#include <stdio.h>

static void test_factory_selects_first_trial(void)
{
    launcher_boot_policy_t policy;

    launcher_boot_policy_init(&policy, LAUNCHER_APP_STAGED);
    assert(policy.location == LAUNCHER_LOCATION_FACTORY);
    assert(launcher_boot_policy_apply(&policy, LAUNCHER_BOOT_EVENT_SELECT));
    assert(policy.location == LAUNCHER_LOCATION_CHILD);
    assert(policy.app_state == LAUNCHER_APP_TRIAL);
}

static void test_adapted_trial_confirms_and_survives_reset(void)
{
    launcher_boot_policy_t policy;

    launcher_boot_policy_init(&policy, LAUNCHER_APP_STAGED);
    assert(launcher_boot_policy_apply(&policy, LAUNCHER_BOOT_EVENT_SELECT));
    assert(launcher_boot_policy_apply(&policy, LAUNCHER_BOOT_EVENT_CONFIRM));
    assert(policy.app_state == LAUNCHER_APP_CONFIRMED);
    assert(launcher_boot_policy_apply(&policy, LAUNCHER_BOOT_EVENT_RESET));
    assert(policy.location == LAUNCHER_LOCATION_CHILD);
    assert(policy.app_state == LAUNCHER_APP_CONFIRMED);
}

static void test_unadapted_play_reset_returns_ready_to_factory(void)
{
    launcher_boot_policy_t policy;

    launcher_boot_policy_init(&policy, LAUNCHER_APP_STAGED);
    assert(launcher_boot_policy_apply(&policy, LAUNCHER_BOOT_EVENT_SELECT));
    assert(launcher_boot_policy_apply(&policy, LAUNCHER_BOOT_EVENT_RESET));
    assert(policy.location == LAUNCHER_LOCATION_FACTORY);
    assert(policy.app_state == LAUNCHER_APP_STAGED);

    assert(launcher_boot_policy_apply(&policy, LAUNCHER_BOOT_EVENT_SELECT));
    assert(policy.location == LAUNCHER_LOCATION_CHILD);
    assert(policy.app_state == LAUNCHER_APP_TRIAL);
}

static void test_explicit_return_uses_factory(void)
{
    launcher_boot_policy_t policy;

    launcher_boot_policy_init(&policy, LAUNCHER_APP_CONFIRMED);
    policy.location = LAUNCHER_LOCATION_CHILD;
    assert(launcher_boot_policy_apply(&policy, LAUNCHER_BOOT_EVENT_RETURN));
    assert(policy.location == LAUNCHER_LOCATION_FACTORY);
    assert(policy.app_state == LAUNCHER_APP_CONFIRMED);
}

static void test_invalid_transitions_are_rejected(void)
{
    launcher_boot_policy_t policy;

    launcher_boot_policy_init(&policy, LAUNCHER_APP_EMPTY);
    assert(!launcher_boot_policy_apply(&policy, LAUNCHER_BOOT_EVENT_SELECT));
    assert(!launcher_boot_policy_apply(&policy, LAUNCHER_BOOT_EVENT_CONFIRM));
    assert(!launcher_boot_policy_apply(&policy, LAUNCHER_BOOT_EVENT_RETURN));
    assert(policy.location == LAUNCHER_LOCATION_FACTORY);
}

int main(void)
{
    test_factory_selects_first_trial();
    test_adapted_trial_confirms_and_survives_reset();
    test_unadapted_play_reset_returns_ready_to_factory();
    test_explicit_return_uses_factory();
    test_invalid_transitions_are_rejected();
    puts("Launcher boot policy: PASS");
    return 0;
}
