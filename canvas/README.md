# Canvas

A design canvas inside Buzz. Build designs from saved copy, mark areas for an agent to change, generate assets, and turn a design into a website page.

Part of the Buzz Editor Lab port of the original CopyOS editors. Linux x64 preview, unsigned.

- Plugin id: `lucas.canvas`
- Agent tools: `buzz_canvas` (read, edit, view and convert designs) and `buzz_canvas_brand` (workspace brand and style guide). Converting a design to a page works best with Page Builder installed too.
- Saved work: shared with the other editor plugins in `xyz.block.buzz.desktop/editor-workspaces/`, so Docs, Canvas and Page Builder can be installed alone or together.

## Install from GitHub (this machine)

Settings → Plugins → Manage plugins → import from a Git or GitHub repository → `Lucas10-ctrl/Buzz-plugins`, branch `main` → pick **Canvas** (`canvas/plugin`) → install → restart Buzz.

`plugin/` holds only `manifest.json` and `plugin.js`. The manifest points at this plugin's backend (a ~200 MB Node runtime and bundle) by absolute path under `~/.local/share/xyz.block.buzz.desktop/editor-plugins/lucas.canvas/<build id>/backend/`, checked by SHA-256. That backend is too big for git, so it is built locally. The GitHub install works on a machine that already has this build; anywhere else, rebuild first.

## Rebuild

Source and full steps: [buzz-editors](../buzz-editors). In short, from a restored source checkout:

```sh
bin/node plugin-package/build.mjs ~/Documents/GitHub/Buzz-plugins canvas
cd ~/Documents/GitHub/Buzz-plugins/canvas
backend/buzz-editor-host install.mjs      # prints the frontend folder
cp <printed frontend folder>/{manifest.json,plugin.js} plugin/
```

Add `--dry-run` to `install.mjs` to only print destinations, or `--copy-lab-data` once to copy saved Editor Lab work (only when Editor Lab is closed and no editor data exists yet). You can also skip the GitHub step and use Load from folder on the printed `frontend` folder.

Remove the older combined **Buzz Editors** plugin first: it adds the same agent tools, and Buzz refuses a second plugin with the same tool name.

On Arch/Omarchy, website cloning needs `sudo pacman -S --needed gst-plugins-good`.
