// Local Files: API v1 plugin for the Buzz desktop app.
//
// A local Markdown path in a message (`/home/…/notes.md` or `~/notes.md`)
// becomes a link. Clicking it opens the file in a side-pane tab, rendered as
// Markdown, with Refresh and Edit. Edit shows the raw text; Save writes it back
// to disk and warns first if the file changed since it was opened.
//
// Safety: only .md, .markdown and .txt files inside the home folder, no linked
// files. A small `sh` script (manifest `host.processes`) checks every path
// before a read and does the write; the plugin checks the same rules first.

export const inject = ["react", "conversation", "panels", "host"];

export const SCHEME = "local-file:";
const LINK_EXT = /\.(md|markdown)$/i;
const ALLOWED_EXT = /\.(md|markdown|txt)$/i;
const MAX_BYTES = 5 * 1024 * 1024;

// ---- Paths ---------------------------------------------------------------

// A candidate starts with `~/` or `/` at a word edge and runs to whitespace or
// a character that never sits in the paths we link.
const CANDIDATE = /(^|[^\w/.~:-])((?:~\/|\/)[^\s`'"<>()[\]{}|\\]+)/g;
const TRAILING = /[.,;:!?*_]+$/;

/** Markdown file paths in plain text, as UTF-16 ranges. */
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

/** Paths that sit inside inline code or fenced code blocks of a message's
 * Markdown. The host never offers code to inline renderers, so these get
 * buttons below the message instead. */
export function findCodePaths(content) {
  if (typeof content !== "string" || !content.includes("`")) return [];
  const seen = new Set();
  const add = (code) => {
    for (const { path } of findPaths(code)) seen.add(path);
  };
  const fences = /(^|\n)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(\n\2[ \t]*(?=\n|$)|$)/g;
  const rest = content.replace(fences, (_all, lead, _fence, body) => {
    add(body);
    return lead;
  });
  for (const match of rest.matchAll(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g)) add(match[2]);
  return [...seen];
}

export const targetFor = (path) => `${SCHEME}${path}`;
export const pathOf = (target) =>
  typeof target === "string" && target.startsWith(SCHEME) ? target.slice(SCHEME.length) : null;
export const fileName = (path) => String(path).split("/").filter(Boolean).pop() || String(path);

/** The plugin-side half of the safety rules; the shell script repeats them on
 * the real path. Returns a message for the person, or null when allowed. */
export function pathProblem(path) {
  if (typeof path !== "string" || !path) return "No file was given.";
  if (!path.startsWith("/") && !path.startsWith("~/")) return "Use a full path that starts with / or ~/.";
  if (!ALLOWED_EXT.test(path)) return "Only .md, .markdown and .txt files can be opened.";
  if (path.split("/").includes("..")) return "Paths with .. are not allowed.";
  return null;
}

// ---- Native access ------------------------------------------------------
//
// Runs as `sh -c SCRIPT local-files <mode> <path>`. `resolve` prints the real
// path; `write` saves stdin there first. Errors go to stderr, one line.

export const SCRIPT = [
  "set -u",
  'mode="$1"; p="$2"',
  'case "$p" in "~/"*) p="$HOME/${p#"~/"}" ;; /*) ;; *) echo "Use a full path that starts with / or ~/." >&2; exit 2 ;; esac',
  "lower=$(printf '%s' \"$p\" | tr 'A-Z' 'a-z')",
  'case "$lower" in *.md|*.markdown|*.txt) ;; *) echo "Only .md, .markdown and .txt files can be opened." >&2; exit 3 ;; esac',
  'home=$(cd -P -- "$HOME" 2>/dev/null && pwd -P) || { echo "Your home folder could not be found." >&2; exit 4; }',
  'dir=$(cd -P -- "$(dirname -- "$p")" 2>/dev/null && pwd -P) || { echo "No such file: $2" >&2; exit 5; }',
  'f="$dir/$(basename -- "$p")"',
  'case "$f" in "$home"/*) ;; *) echo "Only files inside your home folder are allowed." >&2; exit 6 ;; esac',
  'if [ -L "$f" ]; then echo "Linked files are not allowed." >&2; exit 7; fi',
  'if [ ! -f "$f" ]; then echo "No such file: $2" >&2; exit 5; fi',
  'if [ "$mode" = write ]; then',
  '  if [ ! -w "$f" ]; then echo "This file is read-only." >&2; exit 8; fi',
  '  tmp=$(mktemp "$dir/.local-files.XXXXXX") || { echo "Could not save next to the file." >&2; exit 9; }',
  '  if cat > "$tmp" && cat "$tmp" > "$f"; then rm -f "$tmp"; else rm -f "$tmp"; echo "Could not save the file." >&2; exit 9; fi',
  "fi",
  "printf '%s' \"$f\"",
].join("\n");

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
    await proc.end(input ?? "");
    const code = await proc.exited;
    await new Promise((r) => setTimeout(r, 0));
    if (code !== 0) throw new Error(firstLine(err) || "The file helper failed.");
    return out.trim();
  }
  return {
    async read(path) {
      const problem = pathProblem(path);
      if (problem) throw new Error(problem);
      const real = await run("resolve", path);
      if (typeof host.readFile !== "function") throw new Error("This version of Buzz can't read files.");
      const bytes = await host.readFile(real);
      if (bytes.byteLength > MAX_BYTES) throw new Error("This file is too large to show (over 5 MB).");
      return { real, text: new TextDecoder("utf-8").decode(bytes) };
    },
    async write(path, text) {
      const problem = pathProblem(path);
      if (problem) throw new Error(problem);
      return run("write", path, text);
    },
  };
}

// ---- Markdown -------------------------------------------------------------
//
// A small GitHub-flavoured subset: headings, paragraphs (single newlines kept
// as line breaks, as in chat), lists with nesting and task boxes, quotes,
// fenced code, tables, rules, bold, italic, strikethrough, code and links.
// Output is a tree of plain objects; React elements are made from it, so no
// HTML from the file is ever injected.

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|$)/;
const QUOTE = /^ {0,3}>[ ]?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (s) => s.replace(/\t/g, "    ").match(/^ */)[0].length;
const blank = (s) => /^\s*$/.test(s);

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cell = "";
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (c === "`") {
      code = !code;
      cell += c;
    } else if (c === "|" && !code) {
      cells.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

const startsBlock = (line, next) =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  RULE.test(line) ||
  QUOTE.test(line) ||
  ITEM.test(line) ||
  (line.includes("|") && next !== undefined && TABLE_RULE.test(next) && next.includes("-"));

/** Parses Markdown into block nodes. */
export function parseBlocks(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  return blocksOf(lines);
}

function blocksOf(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      i++;
      continue;
    }
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", lang: fence[2] || "", text: body.join("\n") });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] ?? "" });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && !blank(lines[i]) && (QUOTE.test(lines[i]) || !startsBlock(lines[i], lines[i + 1]))) {
        const q = lines[i].match(QUOTE);
        body.push(q ? q[1] : lines[i]);
        i++;
      }
      blocks.push({ type: "quote", children: blocksOf(body) });
      continue;
    }
    if (line.includes("|") && TABLE_RULE.test(lines[i + 1] ?? "") && (lines[i + 1] ?? "").includes("-")) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null,
      );
      const rows = [];
      i += 2;
      while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
      blocks.push({ type: "table", head, align, rows });
      continue;
    }
    if (ITEM.test(line)) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }
    const para = [line];
    i++;
    while (i < lines.length && !blank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++]);
    blocks.push({ type: "paragraph", text: para.map((l) => l.trim()).join("\n") });
  }
  return blocks;
}

function parseList(lines, start) {
  const first = lines[start].match(ITEM);
  const base = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const list = { type: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] };
  let i = start;
  let item = null;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      // A blank line ends the list unless more of it follows.
      let j = i + 1;
      while (j < lines.length && blank(lines[j])) j++;
      const after = lines[j];
      if (after === undefined) break;
      const m = after.match(ITEM);
      if ((m && indentOf(m[1]) >= base && /\d/.test(m[2]) === ordered) || (!m && indentOf(after) > base && item)) {
        i = j;
        continue;
      }
      break;
    }
    const m = line.match(ITEM);
    if (m && indentOf(m[1]) < base) break;
    if (m && indentOf(m[1]) <= base + 1) {
      if (/\d/.test(m[2]) !== ordered) break;
      let text = m[3] ?? "";
      let task = null;
      const box = text.match(/^\[([ xX])\][ \t]+(.*)$/);
      if (box) {
        task = box[1] !== " ";
        text = box[2];
      }
      item = { text, task, children: [] };
      list.items.push(item);
      i++;
      continue;
    }
    if (m && item) {
      const [child, next] = parseList(lines, i);
      item.children.push(child);
      i = next;
      continue;
    }
    if (!item || (indentOf(line) <= base && startsBlock(line, lines[i + 1]))) break;
    if (indentOf(line) > base && FENCE.test(line.trim())) {
      // A fenced block inside an item.
      const pad = indentOf(line);
      const body = [];
      let j = i;
      body.push(line.trim());
      j++;
      const marker = line.trim().match(FENCE)[1];
      while (j < lines.length) {
        const raw = lines[j].replace(/\t/g, "    ");
        body.push(raw.slice(Math.min(pad, indentOf(raw))));
        j++;
        if (new RegExp(`^${marker[0]}{${marker.length},}\\s*$`).test(raw.trim())) break;
      }
      item.children.push(...blocksOf(body));
      i = j;
      continue;
    }
    item.text += `\n${line.trim()}`;
    i++;
  }
  return [list, i];
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~<>"]/;

/** Parses inline Markdown into nodes: text, br, code, strong, em, del, link. */
export function parseInline(src) {
  const nodes = [];
  let text = "";
  const flush = () => {
    if (text) nodes.push({ type: "text", value: text });
    text = "";
  };
  const s = String(src ?? "");
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && ESCAPABLE.test(s[i + 1] ?? "")) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "\n") {
      flush();
      nodes.push({ type: "br" });
      i++;
      continue;
    }
    if (c === "`") {
      const run = s.slice(i).match(/^`+/)[0];
      const close = s.indexOf(run, i + run.length);
      if (close > i) {
        let code = s.slice(i + run.length, close).replace(/\n/g, " ");
        if (/^ .* $/.test(code)) code = code.slice(1, -1);
        flush();
        nodes.push({ type: "code", value: code });
        i = close + run.length;
        continue;
      }
      text += run;
      i += run.length;
      continue;
    }
    if (c === "[") {
      const link = matchLink(s, i);
      if (link) {
        flush();
        nodes.push({ type: "link", href: link.href, children: parseInline(link.label) });
        i = link.end;
        continue;
      }
    }
    if ((c === "h" || c === "H") && /^https?:\/\//i.test(s.slice(i, i + 8)) && !/\w/.test(s[i - 1] ?? "")) {
      const url = s.slice(i).match(/^https?:\/\/[^\s<>]+/i)[0].replace(/[.,;:!?)*_]+$/, "");
      flush();
      nodes.push({ type: "link", href: url, children: [{ type: "text", value: url }] });
      i += url.length;
      continue;
    }
    if (c === "*" || c === "_" || c === "~") {
      const span = matchEmphasis(s, i);
      if (span) {
        flush();
        nodes.push({ type: span.type, children: parseInline(span.inner) });
        i = span.end;
        continue;
      }
    }
    text += c;
    i++;
  }
  flush();
  return nodes;
}

function matchLink(s, i) {
  let depth = 0;
  let j = i;
  for (; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "[") depth++;
    else if (s[j] === "]" && --depth === 0) break;
  }
  if (j >= s.length || s[j + 1] !== "(") return null;
  const m = s.slice(j + 2).match(/^\s*<?([^\s<>()]*(?:\([^\s()]*\)[^\s<>()]*)*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/);
  if (!m) return null;
  return { label: s.slice(i + 1, j), href: m[1], end: j + 2 + m[0].length };
}

function matchEmphasis(s, i) {
  const c = s[i];
  const double = s[i + 1] === c;
  if (c === "~" && !double) return null;
  const marker = double ? c + c : c;
  const after = s[i + marker.length];
  if (!after || /\s/.test(after)) return null;
  if (c === "_" && /\w/.test(s[i - 1] ?? "")) return null;
  let from = i + marker.length + 1;
  while (from <= s.length) {
    const close = s.indexOf(marker, from);
    if (close < 0) return null;
    const before = s[close - 1];
    const next = s[close + marker.length];
    const ok =
      !/\s/.test(before) &&
      (double || next !== c) &&
      (double || s[close - 1] !== c) &&
      !(c === "_" && /\w/.test(next ?? ""));
    if (ok) {
      const type = c === "~" ? "del" : double ? "strong" : "em";
      return { type, inner: s.slice(i + marker.length, close), end: close + marker.length };
    }
    from = close + 1;
  }
  return null;
}

const SAFE_HREF = /^(https?:|mailto:)/i;

// ---- Views ------------------------------------------------------------------

const UI = { "data-buzz-ui": "" };

const styles = {
  pane: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    background: "var(--surface-panel)",
    color: "var(--text-standard)",
  },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "var(--space-2) var(--space-4)",
    borderBottom: "1px solid var(--border-standard)",
    flexWrap: "wrap",
  },
  where: {
    flex: "1 1 12rem",
    minWidth: 0,
    color: "var(--text-metadata)",
    fontSize: "var(--text-body-sm)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    direction: "rtl",
    textAlign: "left",
  },
  scroll: { flex: 1, minHeight: 0, overflow: "auto", padding: "var(--space-4)" },
  markdown: {
    maxWidth: "72ch",
    overflowWrap: "anywhere",
    fontSize: "var(--text-message)",
    lineHeight: "var(--text-message--line-height)",
    letterSpacing: "var(--text-message--letter-spacing)",
  },
  plain: {
    margin: 0,
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-mono-lg)",
    lineHeight: "var(--text-mono-lg--line-height)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  editor: {
    flex: 1,
    minHeight: "16rem",
    width: "100%",
    boxSizing: "border-box",
    resize: "none",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-mono-lg)",
    lineHeight: "var(--text-mono-lg--line-height)",
    tabSize: 4,
  },
  status: { padding: "var(--space-6) var(--space-4)", color: "var(--text-metadata)", maxWidth: "60ch" },
  error: { padding: "var(--space-4)", maxWidth: "60ch" },
  banner: {
    margin: "var(--space-3) var(--space-4) 0",
    padding: "var(--space-3)",
    borderRadius: "var(--radius-card, 8px)",
    border: "1px solid var(--red-7, var(--border-standard))",
    background: "var(--red-3, transparent)",
    color: "var(--red-11, var(--text-standard))",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  note: { padding: "var(--space-1) var(--space-4)", color: "var(--text-metadata)", fontSize: "var(--text-body-sm)" },
  row: { display: "flex", gap: "var(--space-2)", flexWrap: "wrap" },
  h: [
    null,
    { fontSize: "1.6em", lineHeight: 1.25, fontWeight: 650, margin: "0 0 0.6em" },
    { fontSize: "1.35em", lineHeight: 1.3, fontWeight: 650, margin: "1.4em 0 0.5em" },
    { fontSize: "1.15em", lineHeight: 1.35, fontWeight: 650, margin: "1.2em 0 0.4em" },
    { fontSize: "1em", fontWeight: 650, margin: "1.1em 0 0.4em" },
    { fontSize: "0.95em", fontWeight: 650, margin: "1em 0 0.3em" },
    { fontSize: "0.9em", fontWeight: 650, margin: "1em 0 0.3em", color: "var(--text-metadata)" },
  ],
  p: { margin: "0 0 0.85em" },
  list: { margin: "0 0 0.85em", paddingInlineStart: "1.6em" },
  li: { margin: "0.25em 0" },
  quote: {
    margin: "0 0 0.85em",
    padding: "0 0 0 1em",
    borderInlineStart: "3px solid var(--border-standard)",
    color: "var(--text-subtle)",
  },
  codeBlock: {
    margin: "0 0 0.85em",
    padding: "var(--space-3)",
    borderRadius: "var(--radius-card, 8px)",
    border: "1px solid var(--border-standard)",
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-mono-lg)",
    lineHeight: "var(--text-mono-lg--line-height)",
    whiteSpace: "pre",
  },
  code: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    padding: "0.1em 0.3em",
    borderRadius: "4px",
    border: "1px solid var(--border-standard)",
  },
  rule: { border: 0, borderTop: "1px solid var(--border-standard)", margin: "1.4em 0" },
  tableWrap: { overflowX: "auto", margin: "0 0 0.85em" },
  table: { borderCollapse: "collapse", fontSize: "var(--text-body-sm)" },
  cell: { border: "1px solid var(--border-standard)", padding: "0.4em 0.7em", verticalAlign: "top" },
  link: { color: "var(--text-link)", textDecoration: "underline" },
  pathLink: {
    font: "inherit",
    padding: 0,
    margin: 0,
    border: 0,
    background: "none",
    color: "var(--text-link)",
    textDecoration: "underline",
    cursor: "pointer",
    overflowWrap: "anywhere",
    textAlign: "inherit",
  },
  chips: { display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginBlockStart: "var(--space-1)" },
};

/** Builds the React views. Exported so tests can render them. */
export function createViews(React, files, useTabTitle) {
  const h = React.createElement;

  const Button = ({ variant = "subtle", children, ...props }) =>
    h(
      "button",
      { type: "button", ...UI, className: "buzz-button", "data-variant": variant, "data-size": "sm", "data-disabled": props.disabled ? "" : undefined, ...props },
      h("span", { className: "buzz-button-label" }, children),
    );

  function inline(nodes, key = "i") {
    return nodes.map((n, idx) => {
      const k = `${key}.${idx}`;
      switch (n.type) {
        case "text":
          return n.value;
        case "br":
          return h("br", { key: k });
        case "code":
          return h("code", { key: k, style: styles.code }, n.value);
        case "strong":
          return h("strong", { key: k }, inline(n.children, k));
        case "em":
          return h("em", { key: k }, inline(n.children, k));
        case "del":
          return h("del", { key: k }, inline(n.children, k));
        case "link":
          return SAFE_HREF.test(n.href)
            ? h("a", { key: k, href: n.href, target: "_blank", rel: "noreferrer", style: styles.link }, inline(n.children, k))
            : h("span", { key: k }, inline(n.children, k));
        default:
          return null;
      }
    });
  }

  function block(b, key) {
    switch (b.type) {
      case "heading":
        return h(`h${b.level}`, { key, style: styles.h[b.level] }, inline(parseInline(b.text), key));
      case "paragraph":
        return h("p", { key, style: styles.p }, inline(parseInline(b.text), key));
      case "rule":
        return h("hr", { key, style: styles.rule });
      case "code":
        return h("pre", { key, style: styles.codeBlock, "data-lang": b.lang || undefined }, h("code", null, b.text));
      case "quote":
        return h("blockquote", { key, style: styles.quote }, b.children.map((c, i) => block(c, `${key}.${i}`)));
      case "list":
        return h(
          b.ordered ? "ol" : "ul",
          { key, style: styles.list, start: b.ordered && b.start !== 1 ? b.start : undefined },
          b.items.map((item, i) =>
            h(
              "li",
              { key: i, style: item.task === null ? styles.li : { ...styles.li, listStyle: "none", marginInlineStart: "-1.3em" } },
              item.task !== null &&
                h("input", { type: "checkbox", checked: item.task, readOnly: true, disabled: true, style: { marginInlineEnd: "0.5em" } }),
              inline(parseInline(item.text), `${key}.${i}`),
              item.children.map((c, j) => block(c, `${key}.${i}.${j}`)),
            ),
          ),
        );
      case "table": {
        const cell = (tag, text, col, k) =>
          h(tag, { key: k, style: { ...styles.cell, textAlign: b.align[col] || undefined, fontWeight: tag === "th" ? 650 : undefined } }, inline(parseInline(text), k));
        return h(
          "div",
          { key, style: styles.tableWrap },
          h(
            "table",
            { style: styles.table },
            h("thead", null, h("tr", null, b.head.map((t, c) => cell("th", t, c, `${key}.h${c}`)))),
            h("tbody", null, b.rows.map((row, r) => h("tr", { key: r }, b.head.map((_, c) => cell("td", row[c] ?? "", c, `${key}.${r}.${c}`))))),
          ),
        );
      }
      default:
        return null;
    }
  }

  function Rendered({ text, plain }) {
    const blocks = React.useMemo(() => (plain ? [] : parseBlocks(text)), [text, plain]);
    if (plain) return h("pre", { style: styles.plain }, text);
    return h("article", { style: styles.markdown, "data-local-files": "markdown" }, blocks.map((b, i) => block(b, String(i))));
  }

  function FilePanel({ target }) {
    const path = pathOf(target) ?? "";
    useTabTitle(fileName(path));
    const [state, setState] = React.useState({ status: "loading" });
    const [mode, setMode] = React.useState("view");
    const [draft, setDraft] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [conflict, setConflict] = React.useState(false);
    const [note, setNote] = React.useState("");
    const live = React.useRef(true);
    React.useEffect(() => () => void (live.current = false), []);

    const load = React.useCallback(async () => {
      setState((s) => (s.status === "ready" ? { ...s, refreshing: true } : { status: "loading" }));
      try {
        const { real, text } = await files.read(path);
        if (live.current) setState({ status: "ready", real, text });
      } catch (error) {
        if (live.current) setState({ status: "error", message: describe(error, path) });
      }
    }, [path]);
    React.useEffect(() => void load(), [load]);

    const save = async (force) => {
      setBusy(true);
      setNote("");
      try {
        if (!force) {
          const now = await files.read(path);
          if (now.text !== state.text) {
            if (live.current) setConflict(true);
            return;
          }
        }
        await files.write(path, draft);
        const fresh = await files.read(path);
        if (!live.current) return;
        setState({ status: "ready", real: fresh.real, text: fresh.text });
        setConflict(false);
        setMode("view");
        setNote("Saved.");
      } catch (error) {
        if (live.current) setNote(`Not saved: ${describe(error, path)}`);
      } finally {
        if (live.current) setBusy(false);
      }
    };

    const startEdit = () => {
      setDraft(state.text);
      setConflict(false);
      setNote("");
      setMode("edit");
    };
    const cancel = () => {
      setConflict(false);
      setNote("");
      setMode("view");
    };
    const discardAndReload = async () => {
      setConflict(false);
      setMode("view");
      await load();
    };

    const where = h("div", { style: styles.where, title: state.real || path }, h("bdi", null, state.real || path));
    const editing = mode === "edit";
    const bar = h(
      "div",
      { style: styles.bar, role: "toolbar", "aria-label": "File" },
      where,
      editing
        ? [
            h(Button, { key: "cancel", onClick: cancel, disabled: busy }, "Cancel"),
            h(Button, { key: "save", variant: "prominent", onClick: () => save(false), disabled: busy || draft === state.text }, busy ? "Saving…" : "Save"),
          ]
        : [
            h(Button, { key: "refresh", onClick: load, disabled: state.status === "loading" || state.refreshing, title: "Read the file again from disk" }, state.refreshing ? "Refreshing…" : "Refresh"),
            h(Button, { key: "edit", onClick: startEdit, disabled: state.status !== "ready" }, "Edit"),
          ],
    );

    let body;
    if (state.status === "loading") body = h("div", { style: styles.status }, "Opening…");
    else if (state.status === "error")
      body = h(
        "div",
        { style: styles.error, role: "alert" },
        h("p", { style: { ...styles.p, fontWeight: 650 } }, "Can't open this file"),
        h("p", { style: styles.p }, state.message),
      );
    else if (editing)
      body = h(
        "div",
        { style: { ...styles.scroll, display: "flex", flexDirection: "column" } },
        h("textarea", {
          ...UI,
          className: "buzz-textarea",
          "aria-label": `Edit ${fileName(path)}`,
          spellCheck: true,
          value: draft,
          onChange: (e) => setDraft(e.target.value),
          onKeyDown: (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              if (!busy && draft !== state.text) save(false);
            }
          },
          style: styles.editor,
        }),
      );
    else body = h("div", { style: styles.scroll }, h(Rendered, { text: state.text, plain: /\.txt$/i.test(path) }));

    return h(
      "div",
      { style: styles.pane, "data-local-files": "panel" },
      bar,
      conflict &&
        h(
          "div",
          { style: styles.banner, role: "alert" },
          h("strong", null, "This file changed on disk after you opened it."),
          h("span", null, "Saving now replaces those changes with yours."),
          h(
            "div",
            { style: styles.row },
            h(Button, { variant: "destructive", onClick: () => save(true), disabled: busy }, "Overwrite"),
            h(Button, { onClick: () => setConflict(false), disabled: busy }, "Keep editing"),
            h(Button, { onClick: discardAndReload, disabled: busy }, "Discard my edits and reload"),
          ),
        ),
      note && h("div", { style: styles.note, role: "status" }, note),
      body,
    );
  }

  /** A path in message prose, drawn as a link that opens the side pane. */
  function PathLink({ text, canOpen, open }) {
    const target = targetFor(text);
    if (!canOpen?.(target)) return text;
    return h(
      "button",
      { type: "button", style: styles.pathLink, title: `Open ${fileName(text)} beside the chat`, "data-local-files": "link", onClick: () => open(target) },
      text,
    );
  }

  /** Buttons below a message for paths written inside code. */
  function CodePaths({ message, canOpen, open }) {
    const paths = React.useMemo(() => findCodePaths(message?.content), [message?.content]);
    const openable = paths.filter((p) => canOpen?.(targetFor(p)));
    if (!openable.length) return null;
    return h(
      "div",
      { style: styles.chips, "data-local-files": "chips" },
      openable.map((p) => h(Button, { key: p, onClick: () => open(targetFor(p)), title: p }, `Open ${fileName(p)}`)),
    );
  }

  return { FilePanel, PathLink, CodePaths, Rendered };
}

export function describe(error, path) {
  const message = String(error?.message ?? error ?? "");
  if (/no such file/i.test(message)) return `There is no file at ${path}. It may have been moved or deleted.`;
  return message || "Something went wrong.";
}

// ---- Plugin -----------------------------------------------------------------

export function apply(ctx, overrides = {}) {
  const React = ctx.react;
  const files = overrides.files ?? createFiles(ctx.host);
  const useTabTitle = typeof ctx.panels?.useTabTitle === "function" ? ctx.panels.useTabTitle : () => {};
  const views = createViews(React, files, useTabTitle);

  ctx.panels.register({
    id: "file",
    title: "Local file",
    keepOpen: true,
    matches: (target) => {
      const path = pathOf(target);
      return path !== null && pathProblem(path) === null;
    },
    component: views.FilePanel,
  });

  ctx.conversation.registerInline({
    id: "paths",
    title: "Local file paths",
    matches: (content) => findPaths(content?.text).map(({ start, end }) => ({ start, end })),
    component: views.PathLink,
  });

  ctx.conversation.registerAccessory({
    id: "code-paths",
    title: "Open local files",
    placement: "message",
    component: views.CodePaths,
  });

  return views;
}
