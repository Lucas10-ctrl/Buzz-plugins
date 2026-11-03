# Docs

A documents editor inside Buzz. Agents can write first drafts, suggest edits you accept or reject, and answer comment threads.

Part of the Buzz Editor Lab port of the original CopyOS editors. Linux x64 preview, unsigned.

- Plugin id: `lucas.docs`
- Agent tools: `buzz_docs` (read, outline, write, suggest and reply in docs) and `buzz_docs_brand` (workspace brand and style guide). Also adds an **Agent docs** settings card.
- Saved work: shared with the other editor plugins in `xyz.block.buzz.desktop/editor-workspaces/`, so Docs, Canvas and Page Builder can be installed alone or together.

## Install from GitHub (this machine)

Settings → Plugins → Manage plugins → import from a Git or GitHub repository → `Lucas10-ctrl/Buzz-plugins`, branch `main` → pick **Docs** (`docs/plugin`) → install → restart Buzz.

`plugin/` holds only `manifest.json` and `plugin.js`. The manifest points at this plugin's backend (a ~200 MB Node runtime and bundle) by absolute path under `~/.local/share/xyz.block.buzz.desktop/editor-plugins/lucas.docs/<build id>/backend/`, checked by SHA-256. That backend is too big for git, so it is built locally. The GitHub install works on a machine that already has this build; anywhere else, rebuild first.

## Rebuild

Source and full steps: [buzz-editors](../buzz-editors). In short, from a restored source checkout:

```sh
bin/node plugin-package/build.mjs ~/Documents/GitHub/Buzz-plugins docs
cd ~/Documents/GitHub/Buzz-plugins/docs
backend/buzz-editor-host install.mjs      # prints the frontend folder
cp <printed frontend folder>/{manifest.json,plugin.js} plugin/
```

Add `--dry-run` to `install.mjs` to only print destinations, or `--copy-lab-data` once to copy saved Editor Lab work (only when Editor Lab is closed and no editor data exists yet). You can also skip the GitHub step and use Load from folder on the printed `frontend` folder.

Remove the older combined **Buzz Editors** plugin first: it adds the same agent tools, and Buzz refuses a second plugin with the same tool name.

On Arch/Omarchy, website cloning needs `sudo pacman -S --needed gst-plugins-good`.
