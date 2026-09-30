---
name: ai-passport-cover-arts-launcher
description: Audit or integrate an AI Passport play with the optional Cover Arts Launcher return protocol. Use when a creator wants Up Long to return from the play's existing cover page while preserving gameplay input and reboot-to-Launcher compatibility.
---

<p align="right">
  <a href="SKILL.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# AI Passport Cover Arts Launcher compatibility

Use this skill to audit, integrate, or verify a play's optional return path to
Cover Arts Launcher. The protocol is deliberately narrow: **Up Long is handled
only while the play's own cover/start page is active**. Gameplay, settings, and
all other states retain their existing Up Long behavior.

Read [`references/protocol.md`](references/protocol.md) before editing. Treat
the project's own state machine, input model, and repository rules as the source
of truth.

## Choose the requested mode

- **Audit:** inspect the play and report whether it can adopt the protocol. Do
  not change files.
- **Integrate:** add the return component and the smallest cover-state input
  hook, then test it.
- **Verify:** inspect an existing integration, run the available host/build
  checks, and produce a device checklist.

Do not infer permission to flash hardware, commit, push, publish, or open a pull
request. Obtain the authorization required by the active repository workflow.

## Inspect before editing

1. Read the repository's agent instructions and development/build guidance.
2. Start with `git status --short --branch`; preserve unrelated work.
3. Find the semantic input event for Up Long. Prefer an existing debounced long-
   press event over adding raw GPIO timing.
4. Identify the play's existing cover/start state and the single input-dispatch
   point where that state is known.
5. Check the partition assumptions. The helper finds a verified `factory`
   partition at runtime; never hardcode its address.

If the cover state cannot be identified reliably, stop and explain the blocker.
Do not add a global listener and do not create a new cover page just to satisfy
this protocol.

## Integrate the optional return path

1. Copy `assets/launcher_contract/` into the play's `components/` directory, or
   merge its single return function into an equivalent existing component.
2. Add `launcher_contract` to the application component's requirements.
3. At the existing input dispatcher, intercept Up Long only when the current
   state is the existing cover/start page:

```c
if (app_state == APP_STATE_COVER &&
    input.btn == BSP_BTN_UP &&
    input.event == BSP_BTN_LONG) {
    esp_err_t err = launcher_contract_return_to_factory();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "return to Launcher failed: %s", esp_err_to_name(err));
    }
    continue;
}

game_handle_input(input);
```

Adapt names to the project; preserve the guard's meaning. Call the helper from
the input/application task, not a GPIO, timer, or LVGL callback. If the play
must save state, complete a bounded save before calling the helper.

Do not call `esp_ota_mark_app_valid_cancel_rollback()` when the installation
relies on the Launcher's one-shot OTA behavior. Reset or power-cycle must remain
the universal fallback that returns an unadapted or adapted play to Launcher.

## Verify the boundary

Run the repository's smallest relevant host tests, then its documented build
gate. Inspect the final diff and verify all of the following:

- Up Long returns to Launcher from the existing cover/start page.
- Up Long remains untouched in gameplay, settings, pause, results, and other
  states.
- A missing, invalid, or already-running factory partition produces an error
  and leaves the play running.
- No factory address or product-specific partition offset is hardcoded.
- Reset or power-cycle still returns to Launcher.
- The change adds no new screen text unless the creator explicitly requested it.

Report Build, Host tests, Device tests, and Unverified separately. A successful
build is not on-device acceptance.

## Creator-facing copy

Use this short statement in a README or community listing:

> Supports Cover Arts Launcher return. On the play's cover page, hold Up for
> about 1.5 seconds to return to the play library.

Do not claim that Up Long is reserved throughout the play.

## Resources

- Protocol and acceptance details: [`references/protocol.md`](references/protocol.md)
- Reusable ESP-IDF component: [`assets/launcher_contract/`](assets/launcher_contract/)
- Public guide: `https://calm.yishan.app/skills/`
