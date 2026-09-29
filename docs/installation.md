<p align="right">
  <a href="installation.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Install Cover Arts Launcher v1.3.1

## Requirements

- FoloToy AI Passport with ESP32-C3 and 8 MiB Flash.
- Desktop Chrome or Edge with Web Serial.
- A data-capable USB cable and stable power.
- The v1.3.1 complete image and `SHA256SUMS.txt` from the same GitHub Release.

## Before installation

Complete installation migrates the Flash layout; it is not an in-place play
update. It replaces an older fixed-position layout with the v1.3.1 dynamic play
area and clears plays and covers installed under the old Launcher. Prepare to
add those plays again after migration.

Keep the cable and power stable. If the browser, cable, or power is interrupted,
return the device to ROM download mode, reconnect, and restart complete
installation from the beginning.

## Recommended browser flow

1. Download `FoloToy-AI-Passport-Cover-Arts-Launcher-v1.3.1-full.bin` and
   `SHA256SUMS.txt` from the
   [v1.3.1 Release](https://github.com/yishan/cover-arts-launcher/releases/tag/v1.3.1).
2. Open the hosted [Play Manager](https://calm.yishan.app/) in desktop Chrome or
   Edge.
3. Select complete Launcher installation and connect the USB Serial/JTAG device.
4. Select the complete `.bin`, enter the published SHA-256, and review the chip,
   Flash-size, and migration warning.
5. Confirm installation and wait for erase, write, and read-back verification.
6. After restart, confirm that the device enters the Cover Art library. An empty
   play library is a valid initial state.

## Verify the download

macOS or Linux:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

Windows PowerShell:

```powershell
Get-FileHash .\FoloToy-AI-Passport-Cover-Arts-Launcher-v1.3.1-full.bin -Algorithm SHA256
```

Compare the result with `SHA256SUMS.txt`.

## Recovery

Do not try to boot a partially written installation. Keep the error message,
reconnect, and repeat complete installation. To leave Cover Arts Launcher
entirely, use the official recovery or firmware installation flow for the exact
AI Passport hardware revision.
