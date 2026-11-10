# Buzz plugins

Buzz is great for multi-agent coordination and project management. Here's some plugins I've built for  for the Buzz desktop app. Each folder is one plugin.

| Plugin | What it does |
| --- | --- |
| [docs](docs) | Make and edit notion like documents inside Buzz. Inspired by ChatGPT spaces and Claude Docs with agents and comment threads. |
| [canvas](canvas) | Figma-level design tool: 100% free. UI inspired by Figma, so it's easy to use and pick up. 100% agentically, or 100% manual design. Includes professional level options like variables, auto-layout etc. |
| [page-builder](page-builder) | Claude design, but on steroids: website clones, pre-made section library, true drag and drop editor, and fully agentic abilities, plus various export options.|
| [all-editors](all-editors) | Docs, Canvas and Page Builder together in one install. |
| [agent-skills](agent-skills) | Gives each agent its own skills with slash commands: reusable instructions it loads when a task matches. Isolated in buzz. |
| [hermes-agents](hermes-agents) | Assign hermes profiles for your Buzz agents, each with its own hermes skills, model, and memory managed by your Hermes setup. Not just running on hermes, but individual profiles. |
| [opencode-connector](opencode-connector) | Run OpenCode as a Buzz agent on any model it knows, including local models through Lemonade. Each thread is one continuing OpenCode session. |

## Install

**Editors (docs, canvas, page-builder, all-editors):** in Buzz, open **Settings → Plugins → Manage plugins → import from a Git or GitHub repository**, enter `Lucas10-ctrl/Buzz-plugins`, branch `main`, pick the plugin and install. The first open downloads a shared runtime (about 130 MB, once per computer). Install either **All Editors** or the single editors, not both.

Works on macOS (Apple Silicon and Intel), Linux x64 and Windows x64.

**agent-skills, hermes-agents, opencode-connector:** download or clone this repo, then in Buzz choose **Settings → Plugins → Manage plugins → Load from folder** and pick the plugin's folder.

## For AI assistants

To install an editor plugin for someone:

1. Nothing needs downloading or building by hand. Buzz installs the plugin from GitHub, and the plugin downloads and verifies its own runtime the first time it opens.
2. In the Buzz app: Settings → Plugins → Manage plugins → import from a Git or GitHub repository → `Lucas10-ctrl/Buzz-plugins`, branch `main` → pick `Docs`, `Canvas`, `Page Builder` or `All Editors` → Install → enable it after reviewing its access.
3. Check: the editor appears in Buzz's top bar. The first open can take a minute while the runtime downloads.
4. If it fails, the error names the cause (no internet, checksum mismatch, unsupported computer). Deleting the runtime cache (`buzz-editors` in the user's data folder, see the plugin README) forces a fresh download.

## License

MIT, Copyright (c) 2026 Lucas Mondora. See [LICENSE](LICENSE). The editor plugins bundle parts of the Buzz app (Apache 2.0) and a few third-party libraries; each lists them in its `THIRD-PARTY-NOTICES.md`.
