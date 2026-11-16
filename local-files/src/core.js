// Paths, safety rules and file access through the host. No UI.

export const SCHEME = "local-file:";
const TEXT_EXT = /\.(md|markdown|txt)$/i;
const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml" };
const VIDEO_TYPES = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
const LINK_EXT = /\.(md|markdown|png|jpe?g|gif|webp|avif|svg|mp4|m4v|webm|mov)$/i;
const ALLOWED_EXT = /\.(md|markdown|txt|png|jpe?g|gif|webp|avif|svg|mp4|m4v|webm|mov)$/i;
const MAX_BYTES = 5 * 1024 * 1024;
// Buzz's host.readFile refuses anything over 50 MB.
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

const extOf = (path) => (/\.([a-z0-9]+)$/i.exec(String(path))?.[1] ?? "").toLowerCase();

/** "image", "video" or "text" for a path the plugin opens; null otherwise. */
export function kindOf(path) {
  const ext = extOf(path);
  if (IMAGE_TYPES[ext]) return "image";
  if (VIDEO_TYPES[ext]) return "video";
  return TEXT_EXT.test(String(path)) ? "text" : null;
}

export const mimeOf = (path) => IMAGE_TYPES[extOf(path)] ?? VIDEO_TYPES[extOf(path)] ?? "application/octet-stream";

// ---- Paths ---------------------------------------------------------------

// A candidate starts with `~/` or `/` at a word edge and runs to whitespace or
// a character that never sits in the paths we link.
const CANDIDATE = /(^|[^\w/.~:-])((?:~\/|\/)[^\s`'"<>()[\]{}|\\]+)/g;
const TRAILING = /[.,;:!?*_]+$/;

/** Whether a path names a folder we link: under the home folder (`~/…`,
 * `/home/<you>/…`, `/Users/<you>/…`), and either ending in `/` or with no dot
 * in its last part. Files without an extension may match too; opening one
 * then says it isn't a folder. */
export function isFolderPath(path) {
  if (typeof path !== "string") return false;
  if (!(path.startsWith("~/") || /^\/(home|Users)\/[^/]+\/./.test(path) || path.startsWith("/root/"))) return false;
  if (path.split("/").includes("..")) return false;
  if (path.endsWith("/")) return true;
  return !path.split("/").pop().includes(".");
}

/** Markdown, image and video file paths, and folder paths, in plain text, as
 * UTF-16 ranges. */
export function findPaths(text) {
  const out = [];
  if (typeof text !== "string" || !text.includes("/")) return out;
  for (const match of text.matchAll(CANDIDATE)) {
    let path = match[2];
    path = path.replace(TRAILING, "");
    if (path.startsWith("//") || !(LINK_EXT.test(path) || isFolderPath(path))) continue;
    if (!path.startsWith("~/") && path.split("/").length < 3) continue;
    const start = match.index + match[1].length;
    out.push({ start, end: start + path.length, path });
  }
  return out;
}

/** Paths that sit inside inline code, fenced code blocks, or link/image
 * destinations of a message's Markdown. The host never offers these to inline
 * renderers, so they get buttons below the message instead. */
export function findCodePaths(content) {
  if (typeof content !== "string" || (!content.includes("`") && !content.includes("]("))) return [];
  const seen = new Set();
  const add = (code) => {
    for (const { path } of findPaths(code)) seen.add(path);
  };
  const fences = /(^|\n)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(\n\2[ \t]*(?=\n|$)|$)/g;
  const rest = content.replace(fences, (_all, lead, _fence, body) => {
    add(body);
    return lead;
  });
  const prose = rest.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_all, _ticks, code) => {
    add(code);
    return " ";
  });
  // Link and image destinations, e.g. ![storyboard](/home/me/board.jpg):
  // the host renders these itself, so the path never reaches inline renderers.
  for (const match of prose.matchAll(/\]\(\s*<?((?:~\/|\/)[^\s<>()]+?)>?(?:\s+"[^"]*")?\s*\)/g)) add(match[1]);
  return [...seen];
}

export const targetFor = (path) => `${SCHEME}${path}`;
export const FOLDER_SCHEME = "local-folder:";
export const folderTargetFor = (path) => `${FOLDER_SCHEME}${path}`;
export const folderOf = (target) =>
  typeof target === "string" && target.startsWith(FOLDER_SCHEME) ? target.slice(FOLDER_SCHEME.length) : null;
/** The side-pane target for a path found in a message. */
export const linkTarget = (path) => (LINK_EXT.test(path) ? targetFor(path) : folderTargetFor(path));
/** A folder's display name, keeping its trailing slash. */
export const folderName = (path) => `${fileName(path)}/`;

export function folderProblem(path) {
  if (typeof path !== "string" || !path) return "No folder was given.";
  if (path !== "~" && !path.startsWith("/") && !path.startsWith("~/")) return "Use a full path that starts with / or ~/.";
  if (path.split("/").includes("..")) return "Paths with .. are not allowed.";
  return null;
}
export const pathOf = (target) =>
  typeof target === "string" && target.startsWith(SCHEME) ? target.slice(SCHEME.length) : null;
export const fileName = (path) => String(path).split("/").filter(Boolean).pop() || String(path);

/** The plugin-side half of the safety rules; the shell script repeats them on
 * the real path. Returns a message for the person, or null when allowed. */
const ONLY_MESSAGE = "Only Markdown, text, image and video files can be opened.";

export function pathProblem(path) {
  if (typeof path !== "string" || !path) return "No file was given.";
  if (!path.startsWith("/") && !path.startsWith("~/")) return "Use a full path that starts with / or ~/.";
  if (!ALLOWED_EXT.test(path)) return ONLY_MESSAGE;
  if (path.split("/").includes("..")) return "Paths with .. are not allowed.";
  return null;
}

// ---- Native access ------------------------------------------------------
//
// Runs as `sh -c SCRIPT local-files <mode> <path>`. `resolve` prints the real
// path; `write` saves stdin there first. Failures exit with a code that
// HELPER_ERRORS explains. Buzz caps each declared argument at 1024 bytes, so
// the script stays terse and the messages live here.

export const SCRIPT = [
  'p="$2"',
  'case "$p" in "~/"*) p="$HOME/${p#"~/"}";; /*) ;; *) exit 2;; esac',
  'l=$(printf %s "$p" | tr A-Z a-z)',
  'case $l in *.md|*.markdown|*.txt) ;; *.png|*.jpg|*.jpeg|*.gif|*.webp|*.avif|*.svg|*.mp4|*.m4v|*.webm|*.mov) [ "$1" = write ] && exit 3;; *) exit 3;; esac',
  'h=$(cd -P -- "$HOME" && pwd -P) || exit 4',
  'd=$(cd -P -- "$(dirname -- "$p")" 2>/dev/null && pwd -P) || exit 5',
  'f="$d/$(basename -- "$p")"',
  'case "$f" in "$h"/*) ;; *) exit 6;; esac',
  '[ -L "$f" ] && exit 7',
  '[ -f "$f" ] || exit 5',
  'if [ "$1" = write ]; then',
  '[ -w "$f" ] || exit 8',
  't=$(mktemp "$d/.local-files.XXXXXX") || exit 9',
  'if cat >"$t" && cat "$t" >"$f"; then rm -f "$t"; else rm -f "$t"; exit 9; fi',
  'fi',
  "printf %s \"$f\"",
].join("\n");

// Runs as `sh -c FOLDER_SCRIPT local-files <mode> <path>`. Prints the real
// folder and the real home folder on two lines; `list` then prints one
// `type<TAB>bytes<TAB>name` line per entry (type d, f or l for a link), at
// most 2000, skipping hidden names and names with line breaks. `show` opens
// the folder in the system file manager instead.
export const FOLDER_SCRIPT = [
  'p="$2"',
  'case "$p" in "~") p="$HOME";; "~/"*) p="$HOME/${p#"~/"}";; /*) ;; *) exit 2;; esac',
  'h=$(cd -P -- "$HOME" && pwd -P) || exit 4',
  '[ -e "$p" ] || exit 5',
  '[ -d "$p" ] || exit 11',
  'f=$(cd -P -- "$p" 2>/dev/null && pwd -P) || exit 5',
  'case "$f/" in "$h"/*) ;; *) exit 6;; esac',
  "printf '%s\\n%s\\n' \"$f\" \"$h\"",
  'if [ "$1" = show ]; then',
  'for o in xdg-open open; do command -v $o >/dev/null && { nohup $o "$f" >/dev/null 2>&1 & exit 0; }; done',
  'exit 10',
  'fi',
  'cd "$f" || exit 5',
  'n=0',
  'for e in *; do',
  '[ -e "$e" ] || [ -L "$e" ] || continue',
  'case "$e" in *"',
  '"*) continue;; esac',
  'n=$((n+1)); [ $n -gt 2000 ] && break',
  'if [ -L "$e" ]; then t=l; elif [ -d "$e" ]; then t=d; else t=f; fi',
  's=0; [ $t = f ] && s=$(($(wc -c <"$e" 2>/dev/null || echo 0)))',
  "printf '%s\\t%s\\t%s\\n' $t $s \"$e\"",
  'done',
].join("\n");

export const FOLDER_ERRORS = {
  2: "Use a full path that starts with / or ~/.",
  4: "Your home folder could not be found.",
  5: "No such folder.",
  6: "Only folders inside your home folder are allowed.",
  10: "No file manager was found to open this folder.",
  11: "This is a file, not a folder.",
};

/** Parses the `list` output of FOLDER_SCRIPT. */
export function parseListing(out) {
  const lines = String(out ?? "").split("\n");
  const real = lines[0] ?? "";
  const home = lines[1] ?? "";
  const entries = [];
  for (const line of lines.slice(2)) {
    const m = /^([dfl])\t(\d*)\t(.+)$/.exec(line);
    if (m) entries.push({ type: m[1], size: Number(m[2]) || 0, name: m[3] });
  }
  entries.sort((a, b) => (a.type === "d") !== (b.type === "d") ? (a.type === "d" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  return { real, home, entries };
}

/** Folder access through the host's `folder` process. Tests pass their own. */
export function createFolders(host) {
  async function run(mode, path) {
    const problem = folderProblem(path);
    if (problem) throw new Error(problem);
    if (typeof host?.spawn !== "function") throw new Error("This version of Buzz can't run the folder helper.");
    let out = "";
    let err = "";
    const proc = await host.spawn("folder", { args: [mode, path], onStdout: (d) => (out += d), onStderr: (d) => (err += d) });
    const code = await proc.exited;
    await new Promise((r) => setTimeout(r, 0));
    if (code !== 0) throw new Error(FOLDER_ERRORS[code] || firstLine(err) || "The folder helper failed.");
    return out;
  }
  return {
    list: async (path) => parseListing(await run("list", path)),
    show: async (path) => void (await run("show", path)),
  };
}

export const HELPER_ERRORS = {
  2: "Use a full path that starts with / or ~/.",
  3: "Only Markdown, text, image and video files can be opened, and only text can be saved.",
  4: "Your home folder could not be found.",
  5: "No such file.",
  6: "Only files inside your home folder are allowed.",
  7: "Linked files are not allowed.",
  8: "This file is read-only.",
  9: "Could not save the file.",
};

const firstLine = (s) => String(s ?? "").trim().split("\n")[0];

/** File access through the host. Tests pass their own. */
export function createFiles(host) {
  async function run(mode, path, input) {
    if (typeof host?.spawn !== "function") throw new Error("This version of Buzz can't run the file helper.");
    let out = "";
    let err = "";
    const proc = await host.spawn("files", {
      args: [mode, path],
      onStdout: (d) => (out += d),
      onStderr: (d) => (err += d),
    });
    // Only a write reads stdin. `resolve` may exit before we could close
    // stdin, and the host then rejects end() with "No such process", so
    // stdin is left alone there; a failed end() is judged by the exit code.
    let endError = null;
    if (input !== undefined) {
      try {
        await proc.end(input);
      } catch (error) {
        endError = error;
      }
    }
    const code = await proc.exited;
    if (code === 0 && endError) throw endError;
    await new Promise((r) => setTimeout(r, 0));
    if (code !== 0) throw new Error(HELPER_ERRORS[code] || firstLine(err) || "The file helper failed.");
    return out.trim();
  }
  return {
    async read(path) {
      const problem = pathProblem(path);
      if (problem) throw new Error(problem);
      if (kindOf(path) !== "text") throw new Error("Only text files open as text.");
      const real = await run("resolve", path);
      if (typeof host.readFile !== "function") throw new Error("This version of Buzz can't read files.");
      const bytes = await host.readFile(real);
      if (bytes.byteLength > MAX_BYTES) throw new Error("This file is too large to show (over 5 MB).");
      return { real, text: new TextDecoder("utf-8").decode(bytes) };
    },
    async readBytes(path) {
      const problem = pathProblem(path);
      if (problem) throw new Error(problem);
      const real = await run("resolve", path);
      if (typeof host.readFile !== "function") throw new Error("This version of Buzz can't read files.");
      let bytes;
      try {
        bytes = await host.readFile(real);
      } catch (error) {
        if (/too large|exceed|limit/i.test(String(error?.message ?? error))) throw new Error("This file is too large to show (over 50 MB).");
        throw error;
      }
      if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error("This file is too large to show (over 50 MB).");
      return { real, bytes };
    },
    async write(path, text) {
      const problem = pathProblem(path);
      if (problem) throw new Error(problem);
      if (kindOf(path) !== "text") throw new Error("Only text files can be saved.");
      return run("write", path, text);
    },
  };
}

export function describe(error, path) {
  const message = String(error?.message ?? error ?? "");
  if (/no such file/i.test(message)) return `There is no file at ${path}. It may have been moved or deleted.`;
  return message || "Something went wrong.";
}

