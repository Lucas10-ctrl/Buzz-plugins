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

/** Markdown, image and video file paths in plain text, as UTF-16 ranges. */
export function findPaths(text) {
  const out = [];
  if (typeof text !== "string" || !text.includes("/")) return out;
  for (const match of text.matchAll(CANDIDATE)) {
    let path = match[2];
    path = path.replace(TRAILING, "");
    if (path.startsWith("//") || !LINK_EXT.test(path)) continue;
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

