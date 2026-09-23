<p align="right">
  <a href="installation.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Install Cover Arts Launcher v1.0.0

## Requirements

- FoloToy AI Passport with ESP32-C3 and 8 MiB Flash.
- Desktop Chrome or Edge with Web Serial support.
- A data-capable USB cable and stable power.
- The v1.0.0 full firmware and its SHA-256 value from the same GitHub Release.

## Before installation

The complete-system flow is a layout migration, not an in-place application
update. It erases all three play positions, all cover banks, and the Launcher OTA
state before writing the Launcher bootloader, partition table, and factory app.
It does not preserve previously installed plays.

Keep the cable connected throughout the operation. If the browser, cable, or
power disconnects, reconnect the device in ROM download mode and restart the
complete-system flow from the beginning.

## Recommended browser flow

1. Download `FoloToy-AI-Passport-Cover-Arts-Launcher-v1.0.0-full.bin` and
   `SHA256SUMS.txt` from the [v1.0.0 Release](https://github.com/yishan/cover-arts-launcher/releases/tag/v1.0.0).
2. Open the [Play Manager](https://cover-arts-launcher.yishan.app/) in desktop
   Chrome or Edge.
3. Choose complete-system installation and connect the USB Serial/JTAG device.
4. Select the full `.bin`, paste its published SHA-256, and review the detected
   chip, Flash size, and partition migration warning.
5. Confirm installation and wait for erase, write, and readback verification to
   complete.
6. After the manager reports that it sent reset, confirm the empty Cover Art
   library on the device. The three empty positions are valid.

## Integrity check

On macOS or Linux:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

On Windows PowerShell, compare the result of:

```powershell
Get-FileHash .\FoloToy-AI-Passport-Cover-Arts-Launcher-v1.0.0-full.bin -Algorithm SHA256
```

## Recovery

If installation fails, do not try to launch a partially written position. Keep
the error message, reconnect, and start the complete-system flow again. To leave
Cover Arts Launcher entirely, use the official recovery or firmware installation
procedure for the exact AI Passport hardware revision.
