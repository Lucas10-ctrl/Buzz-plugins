# Buzz Editors source

Source for the three editor plugins in this repo: [docs](../docs), [canvas](../canvas) and [page-builder](../page-builder). Linux x64 preview.

The editors are built from a modified copy of the Buzz app, so this folder holds that source, not a plugin. One build produces all three plugins; each carries only its own editor and agent tool, and all three share the same saved work.

The older combined **Buzz Editors** plugin (`buzz.editors`) was split into these three on 2026-11-03. Remove it from Buzz before installing them: it adds the same agent tools, and Buzz refuses a second plugin with the same tool name.

## What's here

| Path | What it is |
| --- | --- |
| `BASE_COMMIT` | The upstream [block/buzz-app](https://github.com/block/buzz-app) commit the changes sit on |
| `upstream.patch` | Edits to existing buzz-app files |
| `overlay/` | Files added on top (editor code in `src/bundled/editor-lab/`, the editors in `portable/`, packaging in `plugin-package/`) |
| `restore.sh` | Clones buzz-app at the base commit and applies both |
| `CHANGE_*.md` | Notes on individual changes |

Which editor a build carries is set in `overlay/src/bundled/editor-lab/native/editor-package.ts`. Editor Lab itself keeps all three; `plugin-package/build.mjs` defines one per plugin.

## Rebuild and install

```sh
./restore.sh ~/Documents/GitHub/buzz-editors-src
cd ~/Documents/GitHub/buzz-editors-src
bin/pnpm install
bin/pnpm editors:build
bin/node plugin-package/build.mjs ~/Documents/GitHub/Buzz-plugins   # or add: docs canvas page-builder
```

That fills each plugin folder's `backend/` (not in git, about 200 MB) and `checksums.json`. Then, per plugin:

```sh
cd ~/Documents/GitHub/Buzz-plugins/docs
backend/buzz-editor-host install.mjs       # prints the frontend folder
cp <printed frontend folder>/{manifest.json,plugin.js} plugin/
```

Commit the new `plugin/` files so the GitHub install points at the new build.

## Keeping this up to date

Every change to the editors gets committed here. From the working checkout (`buzz-editor-lab/buzz-app`):

```sh
git diff --binary > <this folder>/upstream.patch
git ls-files --others --exclude-standard -z | rsync -a --from0 --files-from=- ./ <this folder>/overlay/
```

## Changes

- 2026-11-03: split into three plugins (Docs, Canvas, Page Builder). Docs and Canvas name their brand tool `buzz_docs_brand` and `buzz_canvas_brand`; Page Builder keeps `buzz_brand`.
- 2026-11-03: agents can create docs. Settings → Agent docs → "Let agents create docs" (off by default). See `CHANGE_AGENT_CREATED_DOCS.md`.

## License

The editors are MIT, Copyright (c) 2026 Lucas Mondora (`overlay/portable/COPYOS-LICENSE`). The Buzz app they build on is Apache 2.0 (Block, Inc.). The `dsh-*` helper libraries (DeepSeek Harness) and the `copyos-web-clone` workflow, adapted from [OpenDesign](https://github.com/nexu-io/open-design)'s Web Clone, keep their own MIT licenses in their folders.
