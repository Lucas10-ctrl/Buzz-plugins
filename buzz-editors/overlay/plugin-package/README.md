# Buzz editor plugins

This Linux x64 preview packages Docs, Canvas and Page Builder as three external plugins: `lucas.docs`, `lucas.canvas` and `lucas.page-builder`. Each bundles the same runtime (Node and the editor repository worker) and registers only its own editor and agent tools. All three use the same saved-work folder, so they can be installed alone or together. Running an installed plugin does not require CopyOS, the lab checkout or Codex. It requires a current Buzz host with API v1 native process artifacts and React 19.2 (`useEffectEvent`).

## Use the installed plugin

1. Open normal Buzz using its usual launcher.
2. Open Settings → Plugins.
3. Find **Docs**, **Canvas** or **Page Builder** and enable it after reviewing its requested access.
4. Open it in the top bar.
5. Choose an available Buzz agent to collaborate. The plugin uses normal Buzz’s identity and conversations.

If the plugin is absent, fully quit and reopen normal Buzz. The separate Editor Lab launcher opens a different installation.

The package is unsigned and installed disabled. Native enablement, installed-host compatibility and a connected agent workflow still require a human check. Browser rendering and separate native worker checks do not establish that acceptance.

Linux setup checks GStreamer’s `autoaudiosink` factory and prints installation instructions if it is unavailable. On Arch/Omarchy, run `sudo pacman -S --needed gst-plugins-good`, then fully quit and reopen Buzz. Setup does not install privileged system packages. The Builder repeats this check before dispatching a website clone and keeps the form open with instructions when the dependency is missing, preventing that workflow from loading media through the known failing configuration. This check does not validate every codec or existing page.

## Build and prepare

From the lab Buzz checkout, run `bin/node plugin-package/build.mjs [output-root] [docs|canvas|page-builder ...]`. The output root defaults to `../../Buzz-plugins`; each plugin gets its own folder. Run each folder's `install.mjs` with the bundled `backend/buzz-editor-host` executable to prepare the import folder; `--dry-run` reports destinations. Import the printed `frontend` folder in normal Buzz Settings → Plugins. Preparation alone does not install or enable the plugin.

`--copy-lab-data` copies saved files only when Editor Lab is closed and the destination does not exist. It verifies source and copied file hashes before publishing the copy. It does not merge, overwrite or remove original lab files. Unsaved drafts and browser preferences are not migrated.

Normal Buzz’s data folder contains `editor-plugins/<plugin id>/<generation>/` for the packaged runtime and `editor-workspaces/` for saved editor work. Linux uses `${XDG_DATA_HOME:-~/.local/share}/xyz.block.buzz.desktop/`. The editor provider credential helper uses the separate `xyz.block.buzz.editors.higgsfield` keyring namespace; provider credentials are not copied from the lab. Enter any required provider key through the plugin UI.

Imported reusable sections live in `editor-workspaces/section-library/.copywriter/sections/`. Their copied media and fonts use `library-assets/` paths under that shared library, available from every editor workspace. The worker applies the same regular-file, path traversal and symbolic-link checks used for workspace assets. Builder’s Add section library retains the imported titles and categories.

The small plugin entry and declared native process artifacts respect Buzz’s existing module-size and SHA-256 verification rules. The UI is a compressed sibling artifact loaded through the declared native process. It receives the host React instance and service contexts; the original editors remain the implementation owners.

## Checked snapshot

The package has passed actual plugin-manager import in a disposable profile, saved-data migration, native worker create/clone/delete/restore outside the checkout, payload registration/disposal and a model/session control test. Browser checks exercised the Blob loader and the three original editor surfaces. Live agent collaboration, native WebKit rendering, both themes and enlarged text remain pending in normal Buzz. Disabling the plugin leaves saved editor files intact.
