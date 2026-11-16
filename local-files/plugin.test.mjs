// Run: npm test (from local-files/, after npm install), or
// node --test local-files/plugin.test.mjs against the committed bundle.
// React comes from a sibling Buzz checkout, or set REACT_DIR to a folder whose
// node_modules has react and react-dom.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FOLDER_SCRIPT,
  SCRIPT,
  createFolders,
  folderOf,
  folderProblem,
  folderTargetFor,
  formatSize,
  isFolderPath,
  linkTarget,
  parseListing,
  apply,
  createFiles,
  createDrafts,
  createViews,
  findCodePaths,
  findPaths,
  kindOf,
  mimeOf,
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
  const text = "See ~/Documents/a/b.md, and /home/lucas/x/y.markdown. Not /tmp/z.txt or https://x.com/a.md or /tmp/r.sh";
  const found = findPaths(text).map((m) => m.path);
  assert.deepEqual(found, ["~/Documents/a/b.md", "/home/lucas/x/y.markdown"]);
  const [first] = findPaths(text);
  assert.equal(text.slice(first.start, first.end), "~/Documents/a/b.md");
});

test("finds image and video paths in prose", () => {
  const text = "Video: ~/ads/video/cut-v2.mp4 and board /home/lucas/ads/storyboard-v2.JPG, logo ~/a/logo.svg.";
  assert.deepEqual(findPaths(text).map((m) => m.path), ["~/ads/video/cut-v2.mp4", "/home/lucas/ads/storyboard-v2.JPG", "~/a/logo.svg"]);
  assert.equal(kindOf("~/a.mp4"), "video");
  assert.equal(kindOf("~/a.MOV"), "video");
  assert.equal(kindOf("~/a.jpeg"), "image");
  assert.equal(kindOf("~/a.md"), "text");
  assert.equal(kindOf("~/a.sh"), null);
  assert.equal(mimeOf("~/a.jpg"), "image/jpeg");
  assert.equal(mimeOf("~/a.webm"), "video/webm");
});

test("finds paths in Markdown image and link destinations", () => {
  const content = "![storyboard](/home/lucas/ads/storyboard-v2.jpg)\n[cut](<~/ads/cut.mp4>) and [site](https://x.com/a.png)";
  assert.deepEqual(findCodePaths(content), ["/home/lucas/ads/storyboard-v2.jpg", "~/ads/cut.mp4"]);
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
  assert.equal(pathProblem("~/a.mp4"), null);
  assert.match(pathProblem("~/a.sh"), /Only Markdown/);
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
function realHost(home, env = {}) {
  return {
    async spawn(id, { args, onStdout, onStderr }) {
      const proc = manifest.host.processes.find((p) => p.id === id);
      const child = spawn(proc.program, [...proc.args, ...args], { env: { ...process.env, ...env, HOME: home } });
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
  await assert.rejects(files.write("~/docs/run.sh", "x"), /Only Markdown/);
  await assert.rejects(files.write(join(root, "outside.md"), "x"), /home folder/);
  assert.equal(await readFile(join(root, "outside.md"), "utf8"), "secret");
});

test("reads images and videos as bytes, never writes them", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "local-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  await mkdir(join(home, "v"), { recursive: true });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  await writeFile(join(home, "v", "shot.PNG"), png);
  await writeFile(join(home, "v", "cut.mp4"), Buffer.from("not really a video"));
  const files = createFiles(realHost(home));
  const img = await files.readBytes("~/v/shot.PNG");
  assert.equal(img.real, join(home, "v", "shot.PNG"));
  assert.deepEqual(Buffer.from(img.bytes), png);
  assert.equal((await files.readBytes("~/v/cut.mp4")).bytes.byteLength, 18);
  await assert.rejects(files.read("~/v/cut.mp4"), /text/);
  await assert.rejects(files.write("~/v/cut.mp4", "x"), /Only text/);
  // The shell script refuses a media write on its own, too.
  const host = realHost(home);
  let code;
  const proc = await host.spawn("files", { args: ["write", "~/v/cut.mp4"], onStdout() {}, onStderr() {} });
  await proc.end("x");
  code = await proc.exited;
  assert.equal(code, 3);
  assert.equal(await readFile(join(home, "v", "cut.mp4"), "utf8"), "not really a video");
});

test("media panel and panel switch render without throwing", () => {
  const files = { readBytes: () => new Promise(() => {}), read: () => new Promise(() => {}) };
  const views = createViews(React, files, () => {}, { drafts: createDrafts(null), mountEditor: () => ({}) });
  const html = renderToStaticMarkup(React.createElement(views.AnyPanel, { target: targetFor("~/v/cut.mp4") }));
  assert.match(html, /Opening/);
  assert.match(html, /Reload/);
  assert.doesNotMatch(html, /Save/);
  const md = renderToStaticMarkup(React.createElement(views.AnyPanel, { target: targetFor("~/v/a.md") }));
  assert.match(md, /Opening/);
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

// ---- Folders ----------------------------------------------------------------

test("finds folder paths under home, not other slash words", () => {
  const text =
    "Files: /home/lucas/Documents/Intelliminds/videos/30-day-reels-shorts/renders/ and ~/Documents/Intelliminds/social/hyperframes. " +
    "Not /slideshow, /motion-graphics, /usr/local/bin, origin/main, /api/v1/users or ~/x/run.sh; file ~/a/b.md.";
  assert.deepEqual(findPaths(text).map((m) => m.path), [
    "/home/lucas/Documents/Intelliminds/videos/30-day-reels-shorts/renders/",
    "~/Documents/Intelliminds/social/hyperframes",
    "~/a/b.md",
  ]);
  assert.equal(isFolderPath("/Users/me/Desktop"), true);
  assert.equal(isFolderPath("~/.hermes/profiles/"), true);
  assert.equal(isFolderPath("~/.env.local"), false);
  assert.equal(isFolderPath("~/a/../b"), false);
  assert.equal(linkTarget("~/a/b.md"), targetFor("~/a/b.md"));
  assert.equal(linkTarget("~/a/b/"), folderTargetFor("~/a/b/"));
  assert.equal(folderOf(folderTargetFor("~/x")), "~/x");
  assert.equal(folderOf(targetFor("~/x.md")), null);
  assert.equal(folderProblem("~/x"), null);
  assert.match(folderProblem("x/y"), /full path/);
  assert.match(folderProblem("/home/u/../etc"), /\.\./);
  assert.deepEqual(findCodePaths("Here: **`/home/lucas/videos/renders/`**"), ["/home/lucas/videos/renders/"]);
});

test("parses a listing, folders first in natural order", () => {
  const out = "/home/u/r\n/home/u\nf\t20\tday10.mp4\nf\t10\tday2.mp4\nd\t0\tday01-carousel\nl\t0\tlink\nnonsense\n";
  const { real, home, entries } = parseListing(out);
  assert.equal(real, "/home/u/r");
  assert.equal(home, "/home/u");
  assert.deepEqual(entries.map((e) => e.name), ["day01-carousel", "day2.mp4", "day10.mp4", "link"]);
  assert.equal(entries[1].size, 10);
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(2048), "2 KB");
  assert.equal(formatSize(3.5 * 1048576), "3.5 MB");
});

test("manifest declares the folder helper", () => {
  const proc = manifest.host.processes.find((p) => p.id === "folder");
  assert.equal(proc.program, "sh");
  assert.deepEqual(proc.args, ["-c", FOLDER_SCRIPT, "local-files"]);
});

test("lists and shows folders inside home, refuses everything else", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "local-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const renders = join(home, "videos", "renders");
  await mkdir(join(renders, "day01-carousel"), { recursive: true });
  await writeFile(join(renders, "day01-ig.mp4"), Buffer.alloc(1234));
  await writeFile(join(renders, "notes.md"), "# n");
  await writeFile(join(renders, ".hidden"), "x");
  await writeFile(join(renders, "odd\nname.md"), "x");
  await writeFile(join(renders, "with space.png"), "x");
  await symlink(root, join(home, "escape"));
  await symlink(join(renders, "notes.md"), join(renders, "alias.md"));
  await mkdir(join(root, "outside"));
  const folders = createFolders(realHost(home));

  const listing = await folders.list("~/videos/renders/");
  assert.equal(listing.real, renders);
  assert.equal(listing.home, home);
  assert.deepEqual(
    listing.entries.map((e) => [e.type, e.name, e.size]),
    [
      ["d", "day01-carousel", 0],
      ["l", "alias.md", 0],
      ["f", "day01-ig.mp4", 1234],
      ["f", "notes.md", 3],
      ["f", "with space.png", 1],
    ],
  );
  assert.equal((await folders.list("~")).real, home);
  assert.equal((await folders.list(home)).entries.find((e) => e.name === "videos").type, "d");
  await assert.rejects(folders.list("~/videos/missing"), /No such folder/);
  await assert.rejects(folders.list("~/videos/renders/notes.md"), /not a folder/);
  await assert.rejects(folders.list(join(root, "outside")), /inside your home/);
  await assert.rejects(folders.list("~/escape"), /inside your home/);
  await assert.rejects(folders.list("~/escape/outside"), /inside your home/);
  await assert.rejects(folders.list("~/videos/../.."), /\.\./);

  // `show` hands the real folder to xdg-open (a stand-in here).
  const bin = join(root, "bin");
  const log = join(root, "opened.txt");
  await mkdir(bin);
  await writeFile(join(bin, "xdg-open"), `#!/bin/sh\nprintf %s "$1" > "${log}"\n`);
  await chmod(join(bin, "xdg-open"), 0o755);
  const shown = createFolders(realHost(home, { PATH: `${bin}:${process.env.PATH}` }));
  await shown.show("~/videos/renders");
  for (let i = 0; i < 50; i++) {
    try {
      if ((await readFile(log, "utf8")) === renders) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(await readFile(log, "utf8"), renders);
  await assert.rejects(shown.show(join(root, "outside")), /inside your home/);
});

test("folder panel renders, and folder targets register", () => {
  const views = createViews(React, {}, () => {}, { drafts: createDrafts(null), folders: { list: () => new Promise(() => {}) } });
  const html = renderToStaticMarkup(React.createElement(views.FolderPanel, { target: folderTargetFor("~/v/renders/") }));
  assert.match(html, /Opening…/);
  assert.match(html, /Open in file manager/);
  assert.match(html, /data-local-files="folder"/);

  const { ctx, reg } = fakeCtx();
  apply(ctx, { files: {}, folders: {} });
  const folder = reg.panels.find((p) => p.id === "folder");
  assert.equal(folder.keepOpen, true);
  assert.equal(folder.matches(folderTargetFor("~/v/renders/")), true);
  assert.equal(folder.matches(folderTargetFor("v/renders")), false);
  assert.equal(folder.matches(targetFor("~/a.md")), false);
  const Link = reg.inline[0].component;
  let opened = null;
  const link = renderToStaticMarkup(React.createElement(Link, { text: "~/v/renders/", canOpen: (t) => t === folderTargetFor("~/v/renders/"), open: (t) => (opened = t) }));
  assert.match(link, /title="Open renders\/ beside the chat"/);
  const Chips = reg.accessories[0].component;
  const chips = renderToStaticMarkup(
    React.createElement(Chips, { message: { content: "`/home/lucas/v/renders`" }, canOpen: () => true, open: () => true }),
  );
  assert.match(chips, /Open renders\//);
});
