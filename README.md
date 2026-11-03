# Buzz plugins

Plugins for the Buzz desktop app (0.7 preview). Each folder is one plugin.

| Plugin | What it does |
| --- | --- |
| [agent-skills](agent-skills) | Gives each agent its own skills: reusable instructions it loads when a task matches. Adds a Skills tab to every agent's settings. |
| [hermes-agents](hermes-agents) | Runs your Hermes Agent profiles as Buzz agents, each with its own memory, skills and model. |
| [docs](docs) | Docs editor with agent drafts, suggested edits and comment threads. |
| [canvas](canvas) | Canvas design editor: build from copy, marks, asset generation and design-to-page. |
| [page-builder](page-builder) | Visual page builder with website clones, a shared section library and Shopify/Vercel export. |

Docs, Canvas and Page Builder share their saved work, so install any one or all three. Their source lives in [buzz-editors](buzz-editors).

## Install a plugin

**agent-skills, hermes-agents:** Buzz → Settings → Plugins → Manage plugins → **Load from folder** → pick the plugin folder. Reload the same folder later to update it.

**docs, canvas, page-builder:** Settings → Plugins → Manage plugins → import from a Git or GitHub repository → `Lucas10-ctrl/Buzz-plugins`, branch `main` → pick the plugin. Their ~200 MB backend is built locally, not stored in git; see each folder's README.
