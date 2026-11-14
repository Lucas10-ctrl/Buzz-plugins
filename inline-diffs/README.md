# Inline Diffs

When one of your agents changes files, its reply gets a **Changeset** card listing every file it changed in that turn, with lines added and removed.

- **Only you see it.** The card is built on your computer from your own agents' work. Nothing is posted to the chat, so everyone else sees just the reply.
- **Click a file** to open its changes in a panel beside the chat: one column or side by side, with line numbers and a filter for the file list. Long stretches of unchanged lines fold away; click to show them.
- **Ask about a line:** each line has an **Ask** button. Type a question (or leave it empty) and the agent is woken in the same conversation with the file, the line and your question.
- **Settings → Changesets:** layout, text size, font, colors (including a blue and orange option), how many unchanged lines to show around changes, and wrapping, with a live preview. Colors follow Buzz's light and dark mode.

Files that aren't text are listed with a **Binary** label, and files over 1 MB as **Too large to show**.

## Which agents

Claude Code, Codex and Pi agents running on this computer. Hermes agents don't send Buzz the tool events this needs yet.

- **Claude Code:** tested path.
- **Codex:** reads `apply_patch` edits; wired up, not yet tested live.
- **Pi:** Pi has no end-of-turn event, so a turn ends at the agent's next message, and its card is matched by time only. Only absolute file paths are read. Not yet tested live.

## How it works

1. Before an agent's edit or write tool runs, the plugin reads the file. After it runs, it reads it again. Each turn keeps each file's first and last version.
2. When the turn ends, the plugin finds the conversation from the agent type's saved sessions.
3. The card goes under the agent's message that matches the turn's last reply, or else its latest message in that conversation within 2 minutes of the turn ending.

Edits made through shell commands (`sed`, scripts, `git checkout`) are not seen; only the agent's edit and write tools are.

Changesets are kept in this computer's app storage (IndexedDB), the latest 150 turns.

## Permissions it asks for

- **Hooks on Claude Code, Codex and Pi agents**, to see their edit and write tools. It only observes: it never changes or blocks a tool call.
- **Reading files**, to read each edited file before and after the edit.

## Install

Download or clone this repo, then in Buzz choose **Settings → Plugins → Manage plugins → Add**, then **Browse** under Add from folder, and pick the `inline-diffs` folder.

## Tests

```sh
node --test inline-diffs/plugin.test.mjs
```

React comes from `~/Documents/GitHub/buzz-editor-lab`, or set `REACT_DIR` to a folder whose `node_modules` has `react` and `react-dom`.

## Not yet

- Pictures before and after.
- Hermes agents.
- Syntax colors.
