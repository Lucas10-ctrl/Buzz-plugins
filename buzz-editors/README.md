# Buzz Editors

Docs, Canvas and Page Builder inside Buzz, with agent collaboration. Linux x64 preview.

This plugin is built from a modified copy of the Buzz app, so this folder holds its source rather than a ready-to-load plugin. You can't "Load from folder" here. Restore the source, build the package, then load the package's `frontend` folder.

## What's here

| Path | What it is |
| --- | --- |
| `BASE_COMMIT` | The upstream [block/buzz-app](https://github.com/block/buzz-app) commit the changes sit on |
| `upstream.patch` | Edits to existing buzz-app files |
| `overlay/` | Files added on top (editor code in `src/bundled/editor-lab/`, the editors in `portable/`, packaging in `plugin-package/`) |
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
