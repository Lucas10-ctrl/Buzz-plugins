// Run: node --test local-files/plugin.test.mjs
// React comes from a sibling Buzz checkout, or set REACT_DIR to a folder whose
// node_modules has react and react-dom.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SCRIPT,
  apply,
  createFiles,
  createViews,
  findCodePaths,
  findPaths,
  parseBlocks,
  parseInline,
  pathOf,
  pathProblem,
  targetFor,
} from "./plugin.js";

const require = createRequire(
  join(process.env.REACT_DIR ?? join(homedir(), "Documents/GitHub/buzz-editor-lab"), "x.js"),
);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));

// ---- Paths ------------------------------------------------------------------

test("finds ~/ and absolute Markdown paths in prose", () => {
  const text = "See ~/Documents/a/b.md, and /home/lucas/x/y.markdown. Not /tmp/z.txt or https://x.com/a.md";
  const found = findPaths(text).map((m) => m.path);
  assert.deepEqual(found, ["~/Documents/a/b.md", "/home/lucas/x/y.markdown"]);
  const [first] = findPaths(text);
  assert.equal(text.slice(first.start, first.end), "~/Documents/a/b.md");
});

test("skips non-paths", () => {
  assert.deepEqual(findPaths("a/b.md and foo.md and //host/a.md and /a.md.bak").map((m) => m.path), []);
  assert.deepEqual(findPaths("no slashes here"), []);
});

test("finds paths in inline code and fenced blocks only", () => {
  const content = [
    "Plain ~/plain.md here.",
    "Code `~/Documents/in-code.md` here.",
    "```",
    "/home/lucas/fenced/file.md",
    "```",
  ].join("\n");
  assert.deepEqual(findCodePaths(content), ["/home/lucas/fenced/file.md", "~/Documents/in-code.md"]);
  assert.deepEqual(findCodePaths("nothing ~/x.md"), []);
});

test("targets round-trip and safety rules", () => {
  assert.equal(pathOf(targetFor("~/a.md")), "~/a.md");
  assert.equal(pathOf("https://x"), null);
  assert.equal(pathProblem("~/a.md"), null);
  assert.equal(pathProblem("/home/lucas/a.TXT"), null);
  assert.match(pathProblem("~/a.sh"), /Only \.md/);
  assert.match(pathProblem("a.md"), /full path/);
  assert.match(pathProblem("~/x/../a.md"), /\.\./);
});

// ---- Markdown ---------------------------------------------------------------

test("parses headings, lists, tables, code and quotes", () => {
  const md = [
    "# Title",
    "Line one",
    "line two",
    "",
    "- a",
    "  - nested",
    "- [x] done",
    "",
    "1. first",
    "   *Visual: under it*",
    "2. second",
    "",
    "| A | B |",
    "| :- | -: |",
    "| 1 | `x|y` |",
    "",
    "```js",
    "const a = 1;",
    "```",
    "> quoted",
    "---",
  ].join("\n");
  const blocks = parseBlocks(md);
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "list", "list", "table", "code", "quote", "rule"]);
  assert.equal(blocks[1].text, "Line one\nline two");
  assert.equal(blocks[2].items[0].children[0].items[0].text, "nested");
  assert.equal(blocks[2].items[1].task, true);
  assert.equal(blocks[3].items[0].text, "first\n*Visual: under it*");
  assert.deepEqual(blocks[4].align, ["left", "right"]);
  assert.deepEqual(blocks[4].rows[0], ["1", "`x|y`"]);
  assert.equal(blocks[5].lang, "js");
});

test("parses inline marks", () => {
  const nodes = parseInline("**bold** and *it* and ~~gone~~ and `code` and [link](https://a.b) snake_case_name");
  assert.deepEqual(
    nodes.map((n) => n.type),
    ["strong", "text", "em", "text", "del", "text", "code", "text", "link", "text"],
  );
  assert.equal(nodes.at(-1).value, " snake_case_name");
});

test("renders Markdown without raw HTML", () => {
  const { Rendered } = createViews(React, {}, () => {});
  const html = renderToStaticMarkup(
    React.createElement(Rendered, { text: "# Hi\n\n<script>alert(1)</script> **b** [x](javascript:alert(1))" }),
  );
  assert.match(html, /<h1[^>]*>Hi<\/h1>/);
  assert.match(html, /<strong>b<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /javascript:/);
});

// ---- Registration -----------------------------------------------------------

function fakeCtx() {
  const reg = { panels: [], inline: [], accessories: [] };
  return {
    reg,
    ctx: {
      react: React,
      host: {},
      panels: { register: (p) => reg.panels.push(p), useTabTitle: () => {} },
      conversation: {
        registerInline: (r) => reg.inline.push(r),
        registerAccessory: (a) => reg.accessories.push(a),
      },
    },
  };
}

test("registers a panel, an inline renderer and a message accessory", () => {
  const { ctx, reg } = fakeCtx();
  apply(ctx, { files: {} });
  const [panel] = reg.panels;
  assert.equal(panel.keepOpen, true);
  assert.equal(panel.matches(targetFor("~/a.md")), true);
  assert.equal(panel.matches(targetFor("~/a.sh")), false);
  assert.equal(panel.matches("https://example.com/a.md"), false);
  const [inline] = reg.inline;
  assert.deepEqual(inline.matches({ text: "open ~/a.md now" }), [{ start: 5, end: 11 }]);
  assert.equal(reg.accessories[0].placement, "message");
});

test("path link opens the side pane target", () => {
  const { ctx, reg } = fakeCtx();
  apply(ctx, { files: {} });
  const Link = reg.inline[0].component;
  const html = renderToStaticMarkup(
    React.createElement(Link, { text: "~/a.md", canOpen: () => true, open: () => true }),
  );
  assert.match(html, /<button[^>]*data-local-files="link"[^>]*>~\/a.md<\/button>/);
  assert.equal(renderToStaticMarkup(React.createElement(Link, { text: "~/a.md", canOpen: () => false })), "~/a.md");
  const Chips = reg.accessories[0].component;
  const chips = renderToStaticMarkup(
    React.createElement(Chips, { message: { content: "`~/x/b.md`" }, canOpen: () => true, open: () => true }),
  );
  assert.match(chips, /Open b.md/);
  assert.equal(renderToStaticMarkup(React.createElement(Chips, { message: { content: "hi" }, canOpen: () => true })), "");
});

// ---- The shell helper, run for real --------------------------------------

test("manifest runs the same helper script", () => {
  const [proc] = manifest.host.processes;
  assert.equal(proc.program, "sh");
  assert.deepEqual(proc.args, ["-c", SCRIPT, "local-files"]);
  assert.equal(manifest.host.files, true);
});

test("manifest passes Buzz's host process limits", () => {
  // crates/plugin-manager valid_program: program [A-Za-z0-9._-]{1,80},
  // at most 16 args, each at most 1024 bytes without NUL.
  for (const proc of manifest.host.processes) {
    assert.match(proc.program, /^[A-Za-z0-9._-]{1,80}$/);
    assert.ok(proc.args.length <= 16);
    for (const arg of proc.args) {
      assert.ok(Buffer.byteLength(arg) <= 1024, `arg is ${Buffer.byteLength(arg)} bytes`);
      assert.ok(!arg.includes("\0"));
    }
  }
  assert.ok(manifest.description.length <= 280);
});

/** A host whose spawn runs the manifest's process for real, with HOME set. */
function realHost(home) {
  return {
    async spawn(id, { args, onStdout, onStderr }) {
      const proc = manifest.host.processes.find((p) => p.id === id);
      const child = spawn(proc.program, [...proc.args, ...args], { env: { ...process.env, HOME: home } });
      child.stdout.on("data", (d) => onStdout(String(d)));
      child.stderr.on("data", (d) => onStderr(String(d)));
      const exited = new Promise((r) => child.on("close", (code) => r(code)));
      return { end: async (data) => child.stdin.end(data), exited };
    },
    async readFile(path) {
      return new Uint8Array(await readFile(path));
    },
  };
}

test("reads and writes inside home, refuses everything else", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "local-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  await mkdir(join(home, "docs"), { recursive: true });
  await writeFile(join(home, "docs", "a.md"), "# One\n");
  await writeFile(join(root, "outside.md"), "secret");
  await writeFile(join(home, "docs", "run.sh"), "echo");
  await symlink(join(root, "outside.md"), join(home, "docs", "link.md"));
  await symlink(root, join(home, "escape"));
  const files = createFiles(realHost(home));

  const read = await files.read("~/docs/a.md");
  assert.equal(read.text, "# One\n");
  assert.equal(read.real, join(home, "docs", "a.md"));

  await files.write("~/docs/a.md", "# Two\nwith ünïcode\n");
  assert.equal(await readFile(join(home, "docs", "a.md"), "utf8"), "# Two\nwith ünïcode\n");

  await assert.rejects(files.read("~/docs/missing.md"), /No such file/);
  await assert.rejects(files.read(join(root, "outside.md")), /home folder/);
  await assert.rejects(files.read("~/escape/outside.md"), /home folder/);
  await assert.rejects(files.read("~/docs/link.md"), /Linked files/);
  await assert.rejects(files.write("~/docs/run.sh", "x"), /Only \.md/);
  await assert.rejects(files.write(join(root, "outside.md"), "x"), /home folder/);
  assert.equal(await readFile(join(root, "outside.md"), "utf8"), "secret");
});
