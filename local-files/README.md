# Local Files

Read and edit local Markdown files, and view local images and videos, beside the chat.

When a message contains a path to a Markdown file on your computer, such as `~/Documents/brief.md` or `/home/you/notes/plan.md`, the path becomes a link. Click it and the file opens in a tab in the side pane. The tab stays open until you close it.

The tab is one writing surface, in the style of Omawrite: you just type. Headings show large, bold shows bold, and the Markdown markers (`#`, `**`, backticks, list numbers) stay in the text but fade into the background, so the file on disk is exactly what you wrote.

- **Ctrl/Cmd+S** or **Save** writes the file. **Autosave** (off by default) saves a moment after you stop typing.
- **Ctrl/Cmd+B / I / K**: bold, italic, link. **Ctrl/Cmd+F** or **Find**: find and replace. Undo and redo work as usual.
- **The file is watched.** If an agent or another app saves it while nothing is unsaved here, the new version loads in by itself. If you have unsaved edits, a warning lets you keep yours, use the disk version, or decide later.
- **Unsaved edits survive** closing the tab or a crash; they come back the next time you open the file, as long as the file on disk hasn't changed since.
- `.txt` files open as plain text.

## Images and videos

Paths to images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.svg`) and videos (`.mp4`, `.m4v`, `.webm`, `.mov`) link the same way and open in a viewer tab: the picture fits the pane, and videos play with the usual controls. **Reload** loads the file again; images also refresh by themselves when the file changes. These files are never written. Buzz reads at most 50 MB per file, so bigger videos show a message instead. Whether a video plays depends on the formats the Buzz window supports (`.mov` often won't on Linux).

## Where paths are found

Paths in plain text become links. Paths written inside `code` or a code block get an **Open file.md** button under the message instead, because Buzz doesn't let plugins change code. The same goes for paths used as a Markdown image or link, such as `![storyboard](/home/you/board.jpg)`.

## Safety

- Only Markdown, text, image and video files (the extensions above), and only inside your home folder. Only `.md`, `.markdown` and `.txt` can be saved.
- Linked files (symlinks), and folders that link outside your home, are refused.
- A missing or refused file shows a clear message in the tab.

Each read and write goes through a small `sh` script declared in the manifest. It resolves the real path and checks these rules again before anything is read or written. A save goes to a temporary file first, so the file is only replaced once all of your text has arrived.

## Permissions it asks for

- **Files** (`host.files`): to read the file you open.
- **Process** `sh`: runs the path check and the save described above.

## Install

Download or clone this repo, then in Buzz choose **Settings → Plugins → Manage plugins → Load from folder** and pick the `local-files` folder. Review the access it asks for, then enable it.

Needs Buzz desktop on macOS or Linux. Windows has no `sh`, so files won't open there.

## Build and tests

`plugin.js` is generated: it bundles `src/` with CodeMirror (MIT, see `THIRD-PARTY-NOTICES.md`). Edit `src/`, then:

```sh
cd local-files
npm install
npm test        # builds plugin.js, then runs the tests
```

The tests run the real `sh` script against a temporary home folder. React comes from a sibling Buzz checkout, or set `REACT_DIR`.

## Not yet

- Paths with spaces aren't detected.
- Links inside an open file to other local files aren't clickable.
- Markers are dimmed, not hidden. Tables and images show as their Markdown text.
