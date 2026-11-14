# Changesets Plus

Buzz's built-in **Changesets**, with more. When an agent running on this computer finishes a turn in a chat with project folders, a card under its last message lists the files it changed, with lines added and removed. Only you see it.

What this adds to the built-in version:

- **One column or side by side.** Switch in the panel, or set the default in Settings.
- **File filter.** Type to narrow the panel's file list (every word must match, in any case).
- **Pictures before and after.** Changed PNG, JPEG, GIF, WebP, AVIF, BMP and ICO files show both versions next to each other. New and deleted pictures show the one that exists.
- **Settings → Changesets.** Layout, text size, font, how many unchanged lines to show around changes (3, 10 or the whole file), and whether long lines wrap, with a live preview. Colors follow Buzz's light and dark mode.
- **Ask about a line.** Each line has an **Ask** button. Add a question (or don't) and the agent is woken in the same conversation, with the file, folder, line number and line.

## Getting started

1. Turn off the built-in **Changesets** in **Settings → Plugins**, or you'll get two cards on each reply.
2. Install this one (below).
3. Add project folders to the chat's Canvas. Without them there's nothing to record and no card shows.
4. After an agent finishes a turn, choose a file on its card to open the changes beside the chat.

## How it works

This is Buzz's own Changesets code (from `block/buzz-app`, `src/bundled/changesets`), so it records turns the same way:

Before and after each turn, the plugin snapshots every project folder that is a Git repository: it adds the working tree to a temporary index and writes the tree. Your branch, index, and working files are untouched, but the snapshot objects are stored in the repository's object store. Run `git gc` to prune them once they are unreferenced. Snapshots take in at most 1,000 changed files, and leave out files over 5 MB.

Snapshots include untracked files that Git does not ignore, so a secret in an unignored file is copied into the object store. Keep secrets in `.gitignore`.

The first snapshot is taken when Buzz sees the turn begin, which can be slightly after the agent starts. Edits made in that gap are missing, and the card says so when the snapshot was slow. If another local agent works in the same folder during a turn, the card says some changes may not be that turn's. Agents on other computers and remote agents are not tracked. The most recent 300 turns are kept in this computer's app storage.

It compares folders rather than reading an agent's tools, so it should work for any agent Buzz runs on this computer, not just Claude Code and Codex. This copy has not been tried live yet.

## Permissions it asks for

- Running `git`, to snapshot project folders and read diffs and pictures from those snapshots.

## Install

Download or clone this repo, then in Buzz choose **Settings → Plugins → Manage plugins → Add**, then **Browse** under Add from folder, and pick the `changesets-plus` folder. `plugin.js` is already built.

## Develop

```sh
cd changesets-plus
pnpm install
pnpm build        # src/ -> plugin.js (esbuild, one file, no imports)
pnpm test         # vitest (turns, git, diffs, pictures, UI) + checks on the built plugin.js
pnpm typecheck
```

`src/git.ts`, `src/turns.ts`, `src/paths.ts`, `src/target.ts` and their tests are Buzz's own; see `THIRD-PARTY-NOTICES.md` for what changed. The UI in `src/index.ts` is rewritten with `ctx.react` and inline styles, because a plugin can't use Buzz's design-system components or CSS.

## Not yet

- Syntax colors.
- SVG pictures show as a text diff only.
