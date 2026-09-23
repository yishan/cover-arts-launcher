<p align="right">
  <a href="protocol.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Cover-page return protocol

## Compatibility levels

1. **General compatibility:** a valid ESP32-C3 application can be installed and
   launched without a Launcher SDK. Reset or power-cycle returns to Launcher.
2. **Enhanced cover return:** while the play's existing cover/start page is
   active, Up Long requests an immediate return to the verified factory Launcher.

Enhanced return is optional. It must not weaken general compatibility.

## Input contract

- Trigger: the project's semantic Up Long event; about 1.5 seconds is the
  recommended interaction duration when the project needs a value.
- Scope: only the existing cover/start state.
- Non-scope: gameplay, settings, pause, results, diagnostics, and every other
  state.
- UI: no extra label, modal, or toast is required.
- Failure: log a diagnostic error and keep the play running.

## Boot contract

`launcher_contract_return_to_factory()` discovers the labeled `factory`
partition, verifies its image, selects it as the next boot partition, and
restarts. It returns only on failure.

Do not hardcode the factory address. Do not select an unverified image. Do not
mark the child application valid when the Launcher relies on one-shot OTA
rollback for reboot-to-Launcher compatibility.

## Acceptance checklist

- Cover page + Up Long: Launcher appears.
- Gameplay + Up Long: original play behavior remains.
- Settings/other states + Up Long: original play behavior remains.
- Reset from the play: Launcher appears.
- Power-cycle from the play: Launcher appears.
- Missing/invalid factory in a controlled test: no reboot loop; error is logged.
