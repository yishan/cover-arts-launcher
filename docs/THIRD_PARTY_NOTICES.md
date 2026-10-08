<p align="right">
  <a href="THIRD_PARTY_NOTICES.zh_CN.md">简体中文</a> · <strong>English</strong>
</p>

# Third-party notices

Cover Arts Launcher is distributed under the repository's [MIT License](../LICENSE).
The following notices describe material source and runtime dependencies included
in the v1.6.0 source distribution. They are acknowledgements and license records,
not claims of endorsement.

## FoloToy AI Passport

- Project: <https://github.com/FoloToy/ai-passport>
- License: MIT
- Use: board support, hardware interfaces, ESP-IDF project baseline, engineering
  checks, and documentation conventions.
- Notice: the original copyright notice remains in the repository
  [LICENSE](../LICENSE).

## meta-pass

- Project: <https://github.com/alexwwang/meta-pass>
- Reviewed revision: `994caaf52357d97323bffb82b2db9cc784afb1eb`
- License: MIT
- Use: the ESP image extraction parser is substantially adapted; the browser
  installation chain was studied and adapted for the AI Passport layout.
- Preserved license: [`tools/install-slot/LICENSE.meta-pass.txt`](../tools/install-slot/LICENSE.meta-pass.txt)
- Detailed boundary: [`docs/reference/meta-pass-borrowing.md`](reference/meta-pass-borrowing.md)

Cover Arts Launcher uses its own partition layout, metadata format, Cover Art
interface, validation, recovery rules, and device acceptance. It does not claim
to be an official meta-pass release.

## esptool-js

- Project: <https://github.com/espressif/esptool-js>
- Active browser runtime: 0.6.1
- License: Apache License 2.0
- Use: local Web Serial communication with the ESP32-C3.
- Preserved license: [`tools/install-slot/vendor/LICENSE.esptool-js.txt`](../tools/install-slot/vendor/LICENSE.esptool-js.txt)

The browser runtime executes locally. Cover conversion also happens locally and
does not upload a user-selected image to a third party.

The pinned esptool-js bundle contains its published runtime dependencies:
`pako` (MIT and Zlib), `atob-lite` (MIT), and `tslib` (0BSD). Their versions and
package integrity values are recorded in
[`tools/install-slot/package-lock.json`](../tools/install-slot/package-lock.json);
the pako license marker is retained in the generated bundle.
