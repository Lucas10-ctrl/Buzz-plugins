# Editor plugin packaging

`build.mjs` builds four Buzz plugins from Editor Lab: Docs (`lucas.docs`), Canvas (`lucas.canvas`), Page Builder (`lucas.page-builder`) and All Editors (`lucas.editors`). Each single editor registers only its own page and agent tools; All Editors registers all three. They share saved work in Buzz's data folder (`editor-workspaces/`).

- `build.mjs ui <dir>` builds `ui-<plugin>.mjs.gz`, the editor UI each plugin loads (platform independent).
- `build.mjs runtime <dir>` packs this machine's runtime as `runtime-<platform>-<arch>.tar.gz`: Node (`buzz-editor-host`), the repository worker (`editor-bootstrap.mjs`, `editor-host.tgz`), the credential helper, `media-support.mjs` and `launch.mjs`. Run `pnpm editors:build` first. `BUZZ_CARGO` overrides the cargo binary.
- `build.mjs plugins <repo> --tag <tag> --sums <SHA256SUMS>` writes each plugin's `manifest.json`, `plugin.js`, `LICENSE` and `THIRD-PARTY-NOTICES.md`.

Each manifest declares four host processes: `editor-ui` and `editor-repository` run `sh` (macOS, Linux), the `-win` pair runs PowerShell. On first use the launcher downloads `SHA256SUMS` (its hash is in the manifest), then the runtime and UI it lists, verifies each, unpacks the runtime once under the user's data folder (`buzz-editors/<tag>/<platform>/`) and starts `launch.mjs`. `plugin.js` picks the Windows pair from the user agent and loads the UI from the launcher's base64 output.

The Buzz-plugins repo's Editors release workflow runs all of this on every platform and publishes the release.
