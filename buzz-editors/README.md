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

- 2026-11-24: Canvas parity round 2 (ported from Creative Studio `canvas/parity-2`). Fonts have no face cap and load only the families a design uses; colour emoji (Noto Color Emoji, cached once per machine, laid out at Figma's size) and Noto Sans Symbols as a second symbol fallback; coloured text ranges, optical size and justified text; masks, background blur, image filters, corner smoothing and blur edges in the renderer; `createNodeFromSvg` with gradients, booleans, transforms, built-in icons (`canvas.icon`), `createAutoLayout`, `node.set`, `node.query`, and Figma-worded errors for what Canvas lacks. `buzz_canvas` gains `getDesignMetadata`, `listDesignIcons` and `uploadDesignFont {source}`; `readCanvasGuide {topic?}` serves the ten-topic Canvas design guide (`portable/editor-host/canvas-guide/*.md`, embedded into `canvas-guide.ts` by `portable/editor-host/scripts/embed-canvas-guide.mjs`), and the Canvas agent prompt tells the agent to read it first.
- 2026-11-24: finish the Buzz 1.0.6+ fix. The workspace dropdown (Docs list, Move to workspace, editor workspace switcher) came from Buzz's shared `WorkspaceControl`, which still read `soloPreferences` and crashed the page with "undefined is not an object (evaluating 'e.soloPreferences.snapshot')". The editors now use their own `WorkspacePicker`, which reads workspaces through `workspacePreferences`.
- 2026-11-23: Canvas agent tools catch up with Figma (ported from Creative Studio `canvas/gap`). `buzz_canvas` gains `runCanvasScript` (Figma Plugin API JavaScript on a Canvas design), `placeDesignImage` / `putDesignImage {source}` (pictures by path or URL), `installDesignFonts`, `getDesignSystem`, `exportDesign`, `viewDesign {scale}` (same pixels as the export) and `readCanvasGuide`. `editDesign` needs only id and kind for new layers, and text is measured with the real fonts on every agent write. 27 ad templates from the Studio ad-template Figma file are seeded into the Canvas template library; ★ ✓ ✕ draw through a symbol fallback. The operation list and description live in `portable/editor-host/src/canvas-agent.ts`.
- 2026-11-22: fix Docs, Canvas and Page Builder failing to open on Buzz 1.0.6 and later. Buzz merged Solo workspaces and channel groups into one workspace list (`sidebarPreferences`) and removed `soloPreferences`, which the editors read. They now read whichever the running Buzz has.
- 2026-11-14: anyone can start a doc from chat. The message box has a **New doc** button: name it, then add its link to the message or open it. Agents can create docs without setup (“Let agents create docs” is now on by default and can be turned off). New docs go into the Solo workspace the chat is filed in, otherwise the one selected in Docs. Doc links posted in chat are `buzz://plugin` links that open the doc and switch Docs to its workspace.

- 2026-11-04: Docs looks native to Buzz. Comments sit in the right margin beside the text they discuss (the panel becomes "All comments" and the fallback on narrow windows). A document list on the left replaces the title dropdown and holds the workspace picker. The header is a breadcrumb with History, Link and Share. Highlights, cards, rows and buttons use Buzz design tokens. Buzz's extra "Docs" header row and workspace row are gone.

- 2026-11-04: Docs can move a document to another Solo workspace (••• → Move to workspace…), with its history and attachments. Agents can do the same with `buzz_docs` `moveDoc` when “Let agents create docs” is on.
- 2026-11-03: one-click install on macOS, Linux and Windows. Plugins download a verified runtime from GitHub Releases on first use; added All Editors.
- 2026-11-03: split into three plugins (Docs, Canvas, Page Builder). Docs and Canvas name their brand tool `buzz_docs_brand` and `buzz_canvas_brand`; Page Builder keeps `buzz_brand`.
- 2026-11-03: agents can create docs. Settings → Agent docs → "Let agents create docs" (off by default). See `CHANGE_AGENT_CREATED_DOCS.md`.

## License

The editors are MIT, Copyright (c) 2026 Lucas Mondora (`overlay/portable/COPYOS-LICENSE`). The Buzz app they build on is Apache 2.0 (Block, Inc.). The `dsh-*` helper libraries (DeepSeek Harness) and the `copyos-web-clone` workflow, adapted from [OpenDesign](https://github.com/nexu-io/open-design)'s Web Clone, keep their own MIT licenses in their folders.
