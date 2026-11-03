# Buzz Editors

Docs, Canvas and Page Builder inside Buzz, with agent collaboration. Linux x64 preview.

This plugin is built from a modified copy of the Buzz app, so this folder holds its source plus the built plugin entry in `plugin/`.

## Install from GitHub (this machine)

Settings → Plugins → Manage plugins → import from a Git or GitHub repository → `Lucas10-ctrl/Lucas-buzz-plugins`, branch `main` → pick **Buzz Editors** (`buzz-editors/plugin`) → install → restart Buzz.

`plugin/` holds only `manifest.json` and `plugin.js`. The manifest points at the editor backend (a ~200 MB Node runtime and bundle) by absolute path under `~/.local/share/xyz.block.buzz.desktop/editor-plugins/buzz.editors/<build id>/backend/`, checked by SHA-256. That backend is too big for git (one file is 124 MB, over GitHub's 100 MB limit), so it is built locally. The GitHub install works on any machine that already has that backend build; anywhere else, rebuild first (below), then commit the new `frontend/manifest.json` and `plugin.js` into `plugin/`.

## What's here

| Path | What it is |
| --- | --- |
| `BASE_COMMIT` | The upstream [block/buzz-app](https://github.com/block/buzz-app) commit the changes sit on |
| `upstream.patch` | Edits to existing buzz-app files |
| `overlay/` | Files added on top (editor code in `src/bundled/editor-lab/`, the editors in `portable/`, packaging in `plugin-package/`) |
| `plugin/` | Built plugin entry for Buzz's GitHub import (current build `56511166…`) |
| `restore.sh` | Clones buzz-app at the base commit and applies both |
| `CHANGE_*.md` | Notes on individual changes |

## Rebuild and install

```sh
./restore.sh ~/Documents/GitHub/buzz-editors-src
cd ~/Documents/GitHub/buzz-editors-src
bin/pnpm install
bin/pnpm editors:build
bin/node plugin-package/build.mjs          # writes ../buzz-editors-plugin-package
cd ../buzz-editors-plugin-package
backend/buzz-editor-host install.mjs       # prints the frontend folder to import
```

Then in Buzz: Settings → Plugins → Manage plugins → Load from folder → pick the printed `frontend` folder → restart Buzz.

## Keeping this up to date

Every change to the plugin gets committed here. From the working checkout (`buzz-editor-lab/buzz-app`):

```sh
git diff --binary > <this folder>/upstream.patch
git ls-files --others --exclude-standard -z | rsync -a --from0 --files-from=- ./ <this folder>/overlay/
```

## Changes

- 2026-11-03: agents can create docs. Settings → Agent docs → "Let agents create docs" (off by default). See `CHANGE_AGENT_CREATED_DOCS.md`.
