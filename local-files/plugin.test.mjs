// Run: npm test (from local-files/, after npm install), or
// node --test local-files/plugin.test.mjs against the committed bundle.
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
  createDrafts,
  createViews,
  findCodePaths,
  findPaths,
  pathOf,
  pathProblem,
  targetFor,
} from "./plugin.js";
import { linkSpec, toggleWrapSpec } from "./src/editor.js";
import { EditorSelection, EditorState } from "@codemirror/state";

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

// ---- Editor commands ------------------------------------------------------

const stateWith = (doc, from, to = from) => EditorState.create({ doc, selection: EditorSelection.single(from, to) });
const applySpec = (state, spec) => state.update(spec).state;

test("Ctrl+B wraps, and unwraps, the selection", () => {
  let s = applySpec(stateWith("make this bold", 5, 9), toggleWrapSpec(stateWith("make this bold", 5, 9), "**"));
  assert.equal(s.doc.toString(), "make **this** bold");
  assert.equal(s.sliceDoc(s.selection.main.from, s.selection.main.to), "this");
  s = applySpec(s, toggleWrapSpec(s, "**"));
  assert.equal(s.doc.toString(), "make this bold");
});

test("an empty selection gets a pair with the cursor inside", () => {
  const start = stateWith("ab", 1);
  const s = applySpec(start, toggleWrapSpec(start, "*"));
  assert.equal(s.doc.toString(), "a**b");
  assert.equal(s.selection.main.head, 2);
});

test("Ctrl+K makes a link with the url selected", () => {
  const start = stateWith("see docs here", 4, 8);
  const s = applySpec(start, linkSpec(start));
  assert.equal(s.doc.toString(), "see [docs](url) here");
  assert.equal(s.sliceDoc(s.selection.main.from, s.selection.main.to), "url");
});

test("drafts round-trip and tolerate junk", () => {
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
  const drafts = createDrafts(storage);
  assert.equal(drafts.get("~/a.md"), null);
  drafts.set("~/a.md", "base", "mine");
  assert.deepEqual(drafts.get("~/a.md"), { base: "base", text: "mine" });
  drafts.clear("~/a.md");
  assert.equal(drafts.get("~/a.md"), null);
  map.set("lucas.local-files.draft:~/b.md", "{not json");
  assert.equal(drafts.get("~/b.md"), null);
});

test("panel shows Opening… before the file is read", () => {
  const { FilePanel } = createViews(React, { read: () => new Promise(() => {}) }, () => {}, { drafts: createDrafts(null) });
  const html = renderToStaticMarkup(React.createElement(FilePanel, { target: targetFor("~/a.md") }));
  assert.match(html, /Opening…/);
  assert.match(html, /data-local-files="panel"/);
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
  // Cordis rejects any non-function return value with "Invalid effect".
  assert.equal(apply(ctx, { files: {} }), undefined);
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

test("resolve never touches stdin of a process that may have exited", async () => {
  // Buzz removes a process once it exits; end() then rejects "No such process".
  const calls = [];
  const host = {
    async spawn(_id, { args, onStdout }) {
      calls.push(args[0]);
      onStdout(args[0] === "resolve" ? "/home/u/a.md" : "/home/u/a.md");
      return {
        end: async () => {
          throw new Error("No such process");
        },
        exited: Promise.resolve(0),
      };
    },
    readFile: async () => new TextEncoder().encode("# Hi"),
  };
  const files = createFiles(host);
  assert.equal((await files.read("~/a.md")).text, "# Hi");
  // A write whose stdin could not be delivered is reported, not called saved.
  await assert.rejects(files.write("~/a.md", "x"), /No such process/);
  assert.deepEqual(calls, ["resolve", "write"]);
});
