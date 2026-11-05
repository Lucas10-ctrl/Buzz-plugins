# Buzz Editors source

Source for the editor plugins in this repo: [docs](../docs), [canvas](../canvas), [page-builder](../page-builder) and [all-editors](../all-editors).

The editors are built from a modified copy of the Buzz app, so this folder holds that source, not a plugin. One build produces all four plugins. Each single editor carries only its own editor and agent tools; All Editors carries all three. They share the same saved work.

The older combined **Buzz Editors** plugin (`buzz.editors`) was split into these three on 2026-11-03. Remove it from Buzz before installing these: it adds the same agent tools, and Buzz refuses a second plugin with the same tool name.

## What's here

| Path | What it is |
| --- | --- |
| `BASE_COMMIT` | The upstream [block/buzz-app](https://github.com/block/buzz-app) commit the changes sit on |
| `upstream.patch` | Edits to existing buzz-app files |
| `overlay/` | Files added on top (editor code in `src/bundled/editor-lab/`, the editors in `portable/`, packaging in `plugin-package/`) |
| `restore.sh` | Clones buzz-app at the base commit and applies both |
| `CHANGE_*.md` | Notes on individual changes |

Which editor a build carries is set in `overlay/src/bundled/editor-lab/native/editor-package.ts`. Editor Lab itself keeps all three; `plugin-package/build.mjs` defines one per plugin.

## Releasing

Teammates never build anything: each plugin downloads its runtime from a GitHub Release on first use.

To publish a new version, open **Actions → Editors release → Run workflow** and enter a new tag (for example `editors-v2`). The workflow builds the runtime on macOS (Apple Silicon and Intel), Linux and Windows, builds the four editor UIs, publishes them as a release with a `SHA256SUMS` file, then commits each plugin's `manifest.json` and `plugin.js` pointing at that release. Buzz offers the update to anyone who installed from GitHub.

## Build locally

```sh
./restore.sh ~/Documents/GitHub/buzz-editors-src
cd ~/Documents/GitHub/buzz-editors-src
bin/pnpm install
bin/pnpm editors:build
bin/node plugin-package/build.mjs ui ../release        # ui-<plugin>.mjs.gz
bin/node plugin-package/build.mjs runtime ../release   # runtime-<platform>.tar.gz for this machine
```

`build.mjs plugins <repo-root> --tag <tag> --sums <SHA256SUMS> [--base-url <url>]` writes the plugin manifests; `--base-url` points them at a local server for testing.

## Keeping this up to date

Every change to the editors gets committed here. From the working checkout (`buzz-editor-lab/buzz-app`):

```sh
git diff --binary > <this folder>/upstream.patch
git ls-files --others --exclude-standard -z | rsync -a --from0 --files-from=- ./ <this folder>/overlay/
```

## Changes

- 2026-11-04: Docs looks native to Buzz. Comments sit in the right margin beside the text they discuss (the panel becomes "All comments" and the fallback on narrow windows). A document list on the left replaces the title dropdown and holds the workspace picker. The header is a breadcrumb with History, Link and Share. Highlights, cards, rows and buttons use Buzz design tokens. Buzz's extra "Docs" header row and workspace row are gone.

- 2026-11-04: Docs can move a document to another Solo workspace (••• → Move to workspace…), with its history and attachments. Agents can do the same with `buzz_docs` `moveDoc` when “Let agents create docs” is on.
- 2026-11-03: one-click install on macOS, Linux and Windows. Plugins download a verified runtime from GitHub Releases on first use; added All Editors.
- 2026-11-03: split into three plugins (Docs, Canvas, Page Builder). Docs and Canvas name their brand tool `buzz_docs_brand` and `buzz_canvas_brand`; Page Builder keeps `buzz_brand`.
- 2026-11-03: agents can create docs. Settings → Agent docs → "Let agents create docs" (off by default). See `CHANGE_AGENT_CREATED_DOCS.md`.

## License

The editors are MIT, Copyright (c) 2026 Lucas Mondora (`overlay/portable/COPYOS-LICENSE`). The Buzz app they build on is Apache 2.0 (Block, Inc.). The `dsh-*` helper libraries (DeepSeek Harness) and the `copyos-web-clone` workflow, adapted from [OpenDesign](https://github.com/nexu-io/open-design)'s Web Clone, keep their own MIT licenses in their folders.
