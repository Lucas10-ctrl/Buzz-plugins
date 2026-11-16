# Local Files

Read and edit local Markdown files beside the chat.

When a message contains a path to a Markdown file on your computer, such as `~/Documents/brief.md` or `/home/you/notes/plan.md`, the path becomes a link. Click it and the file opens in a tab in the side pane, rendered as Markdown: headings, lists, bold, code blocks and tables. The tab stays open until you close it.

- **Refresh** reads the file again from disk.
- **Edit** shows the raw text. **Save** (or Ctrl/Cmd+S) writes it back and returns to the rendered view. **Cancel** throws your changes away.
- If the file changed on disk after you opened it, Save warns you first. You can overwrite it, keep editing, or discard your edits and load the disk version.

Paths in plain text become links. Paths written inside `code` or a code block get an **Open file.md** button under the message instead, because Buzz doesn't let plugins change code.

## Safety

- Only `.md`, `.markdown` and `.txt` files, and only inside your home folder.
- Linked files (symlinks), and folders that link outside your home, are refused.
- A missing or refused file shows a clear message in the tab.

Each read and write goes through a small `sh` script declared in the manifest. It resolves the real path and checks these rules again before anything is read or written. A save goes to a temporary file first, so the file is only replaced once all of your text has arrived.

## Permissions it asks for

- **Files** (`host.files`): to read the file you open.
- **Process** `sh`: runs the path check and the save described above.

## Install

Download or clone this repo, then in Buzz choose **Settings → Plugins → Manage plugins → Load from folder** and pick the `local-files` folder. Review the access it asks for, then enable it.

Needs Buzz desktop on macOS or Linux. Windows has no `sh`, so files won't open there.

## Tests

```sh
node --test local-files/plugin.test.mjs
```

The tests run the real `sh` script against a temporary home folder. React comes from a sibling Buzz checkout, or set `REACT_DIR`.

## Not yet

- Paths with spaces aren't detected.
- Links inside an open file to other local files aren't clickable.
- No live reload; use Refresh.
