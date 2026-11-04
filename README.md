# Buzz plugins

Plugins for the Buzz desktop app. Each folder is one plugin.

| Plugin | What it does |
| --- | --- |
| [docs](docs) | Docs editor: agent drafts, suggested edits and comment threads. |
| [canvas](canvas) | Canvas design editor: build from copy, marks, asset generation and design-to-page. |
| [page-builder](page-builder) | Visual page builder: website clones, shared section library, Shopify/Vercel export. |
| [all-editors](all-editors) | Docs, Canvas and Page Builder together in one install. |
| [agent-skills](agent-skills) | Gives each agent its own skills: reusable instructions it loads when a task matches. |
| [hermes-agents](hermes-agents) | Runs your Hermes Agent profiles as Buzz agents, each with its own skills, model, and memory managed by your Hermes setup. |

## Install

**Editors (docs, canvas, page-builder, all-editors):** in Buzz, open **Settings → Plugins → Manage plugins → import from a Git or GitHub repository**, enter `Lucas10-ctrl/Buzz-plugins`, branch `main`, pick the plugin and install. The first open downloads a shared runtime (about 130 MB, once per computer). Install either **All Editors** or the single editors, not both.

Works on macOS (Apple Silicon and Intel), Linux x64 and Windows x64.

**agent-skills, hermes-agents:** download or clone this repo, then in Buzz choose **Settings → Plugins → Manage plugins → Load from folder** and pick the plugin's folder.

## For AI assistants

To install an editor plugin for someone:

1. Nothing needs downloading or building by hand. Buzz installs the plugin from GitHub, and the plugin downloads and verifies its own runtime the first time it opens.
2. In the Buzz app: Settings → Plugins → Manage plugins → import from a Git or GitHub repository → `Lucas10-ctrl/Buzz-plugins`, branch `main` → pick `Docs`, `Canvas`, `Page Builder` or `All Editors` → Install → enable it after reviewing its access.
3. Check: the editor appears in Buzz's top bar. The first open can take a minute while the runtime downloads.
4. If it fails, the error names the cause (no internet, checksum mismatch, unsupported computer). Deleting the runtime cache (`buzz-editors` in the user's data folder, see the plugin README) forces a fresh download.

## License

MIT, Copyright (c) 2026 Lucas Mondora. See [LICENSE](LICENSE). The editor plugins bundle parts of the Buzz app (Apache 2.0) and a few third-party libraries; each lists them in its `THIRD-PARTY-NOTICES.md`.
