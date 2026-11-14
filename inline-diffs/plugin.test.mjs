// Run: node --test inline-diffs/plugin.test.mjs
// React comes from a sibling Buzz checkout, or set REACT_DIR to a folder whose
// node_modules has react and react-dom.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  HARNESSES,
  apply,
  askText,
  candidateTurns,
  conversationOf,
  countChanges,
  createRecorder,
  createStore,
  decodeText,
  diffLines,
  displayPath,
  editTargets,
  foldOps,
  memoryBackend,
  panelTarget,
  parseApplyPatch,
  parseTarget,
  readPrefs,
  resolvePath,
  sameText,
  splitLines,
  splitRows,
} from "./plugin.js";

const require = createRequire(
  join(process.env.REACT_DIR ?? join(homedir(), "Documents/GitHub/buzz-editor-lab"), "x.js"),
);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const AGENT = "a".repeat(64);
const CHANNEL = "11111111-2222-3333-4444-555555555555";
const ROOT = "d".repeat(64);
const enc = (s) => new TextEncoder().encode(s);

function applyOps(ops) {
  return {
    a: ops.filter((o) => o.t !== "add").map((o) => o.text),
    b: ops.filter((o) => o.t !== "del").map((o) => o.text),
  };
}

test("diffLines reproduces both sides and counts minimal changes", () => {
  const a = splitLines("one\ntwo\nthree\nfour\nfive\n");
  const b = splitLines("one\n2\nthree\nfour\nfive\nsix\n");
  const ops = diffLines(a, b);
  assert.deepEqual(applyOps(ops), { a, b });
  assert.deepEqual(countChanges(a.join("\n"), b.join("\n")), { added: 2, removed: 1 });
  // Line numbers are 1-based on each side.
  assert.deepEqual(ops.find((o) => o.t === "add" && o.text === "six"), { t: "add", b: 6, text: "six" });
  assert.deepEqual(ops.find((o) => o.t === "del"), { t: "del", a: 2, text: "two" });
});

test("diffLines on random edits always reproduces both sides", () => {
  let seed = 7;
  const rand = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
  for (let round = 0; round < 200; round++) {
    const a = Array.from({ length: rand(30) }, () => `l${rand(6)}`);
    const b = a.slice();
    for (let i = 0; i < rand(8); i++) {
      const at = rand(b.length + 1);
      if (rand(2)) b.splice(at, 0, `n${rand(6)}`);
      else b.splice(at, 1);
    }
    assert.deepEqual(applyOps(diffLines(a, b)), { a, b });
  }
});

test("diffLines falls back to a block replace past its budget", () => {
  const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
  const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
  const ops = diffLines(a, b, 10);
  assert.deepEqual(applyOps(ops), { a, b });
  assert.equal(ops.filter((o) => o.t === "del").length, 50);
});

test("added and deleted files count every line", () => {
  assert.deepEqual(countChanges("", "a\nb\n"), { added: 2, removed: 0 });
  assert.deepEqual(countChanges("a\nb", ""), { added: 0, removed: 2 });
});

test("foldOps keeps context around changes and folds the rest", () => {
  const a = Array.from({ length: 20 }, (_, i) => `${i}`);
  const b = a.slice();
  b[10] = "x";
  const rows = foldOps(diffLines(a, b), 2);
  assert.deepEqual(
    rows.map((r) => (r.t === "fold" ? `fold${r.count}` : r.t)),
    ["fold8", "eq", "eq", "del", "add", "eq", "eq", "fold7"],
  );
  assert.equal(foldOps(diffLines(a, b), -1).length, 21);
});

test("splitRows pairs deletions with the additions after them", () => {
  const rows = splitRows(diffLines(["a", "b", "c"], ["a", "B", "B2", "c"]));
  assert.equal(rows.length, 4);
  assert.equal(rows[1].left.text, "b");
  assert.equal(rows[1].right.text, "B");
  assert.equal(rows[2].left, undefined);
  assert.equal(rows[2].right.text, "B2");
});

test("decodeText rejects binary and invalid UTF-8", () => {
  assert.equal(decodeText(enc("héllo")), "héllo");
  assert.equal(decodeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1])), null);
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0xfd])), null);
});

test("editTargets reads Claude, Codex and Pi edit calls", () => {
  assert.deepEqual(
    editTargets(HARNESSES.claude, { tool_name: "Edit", cwd: "/w", tool_input: { file_path: "/w/a.js" } }),
    [{ path: "/w/a.js", cwd: "/w" }],
  );
  assert.deepEqual(editTargets(HARNESSES.claude, { tool_name: "Bash", tool_input: { command: "ls" } }), []);
  assert.deepEqual(editTargets(HARNESSES.claude, { tool_name: "NotebookEdit", tool_input: { notebook_path: "/n.ipynb" } }), [
    { path: "/n.ipynb" },
  ]);
  const patch = "*** Begin Patch\n*** Update File: src/a.js\n@@\n-x\n+y\n*** Add File: b.txt\n+hi\n*** Delete File: c.txt\n*** End Patch";
  assert.deepEqual(
    editTargets(HARNESSES.codex, { tool_name: "apply_patch", cwd: "/repo", tool_input: { command: patch } }),
    [
      { path: "src/a.js", cwd: "/repo" },
      { path: "b.txt", cwd: "/repo" },
      { path: "c.txt", cwd: "/repo" },
    ],
  );
  assert.deepEqual(editTargets(HARNESSES.codex, { tool_name: "shell", tool_input: { command: ["ls"] } }), []);
  assert.deepEqual(editTargets(HARNESSES.pi, { id: "c1", name: "write", arguments: { path: "/tmp/a.txt", content: "x" } }), [
    { path: "/tmp/a.txt" },
  ]);
  assert.deepEqual(editTargets(HARNESSES.pi, { call: { id: "c1", name: "edit", arguments: { path: "/tmp/a" } }, result: {} }), [
    { path: "/tmp/a" },
  ]);
  assert.deepEqual(editTargets(HARNESSES.pi, { name: "buzz_send", arguments: { text: "hi" } }), []);
});

test("parseApplyPatch follows renames", () => {
  assert.deepEqual(parseApplyPatch("*** Update File: a.js\n*** Move to: b.js\n@@\n"), [
    { path: "a.js", kind: "update" },
    { path: "b.js", kind: "add" },
  ]);
});

test("resolvePath and displayPath", () => {
  assert.equal(resolvePath({ path: "src/../a.js", cwd: "/repo/" }), "/repo/a.js");
  assert.equal(resolvePath({ path: "./b/c.js", cwd: "/repo" }), "/repo/b/c.js");
  assert.equal(resolvePath({ path: "/abs/x", cwd: "/repo" }), "/abs/x");
  assert.equal(displayPath("/repo/src/a.js", "/repo"), "src/a.js");
  assert.equal(displayPath("/home/lucas/notes.md"), "~/notes.md");
});

function agentStorage(entries) {
  const map = new Map(Object.entries(entries));
  return { keys: () => [...map.keys()], get: (k) => map.get(k) ?? null, set: async (k, v) => (v === null ? map.delete(k) : map.set(k, v)) };
}

test("conversationOf finds the Claude and Codex conversation of a session", () => {
  const storage = agentStorage({
    [`buzz.claude-code.sessions.v1:${AGENT}`]: JSON.stringify({
      [CHANNEL]: { id: "s-channel", seen: 1, at: 1 },
      [`${CHANNEL}/${ROOT.toUpperCase()}`]: { id: "s-thread", seen: 1, at: 2 },
    }),
    [`buzz.codex.sessions.v17:thread:${AGENT}`]: JSON.stringify({ [`${CHANNEL}/${ROOT}`]: { threadId: "th-1", workspace: "/w" } }),
  });
  assert.deepEqual(conversationOf(storage, HARNESSES.claude, AGENT, "s-channel"), { channelId: CHANNEL });
  assert.deepEqual(conversationOf(storage, HARNESSES.claude, AGENT, "s-thread"), { channelId: CHANNEL, root: ROOT });
  assert.deepEqual(conversationOf(storage, HARNESSES.codex, AGENT, "th-1"), { channelId: CHANNEL, root: ROOT });
  assert.equal(conversationOf(storage, HARNESSES.claude, AGENT, "nope"), null);
  assert.equal(conversationOf(storage, HARNESSES.claude, "b".repeat(64), "s-channel"), null);
  assert.equal(conversationOf(storage, HARNESSES.pi, AGENT, "1"), null);
});

function fakeFiles(initial = {}) {
  const files = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === "string" ? enc(v) : v]));
  return {
    files,
    write: (path, text) => files.set(path, typeof text === "string" ? enc(text) : text),
    remove: (path) => files.delete(path),
    async readFile(path, options) {
      const full = options?.cwd && !path.startsWith("/") ? `${options.cwd}/${path}` : path;
      if (!files.has(full)) throw new Error(`No such file: ${full}`);
      return files.get(full);
    },
  };
}

async function recorderSetup({ files = {}, storage = agentStorage({}) } = {}) {
  let clock = 1_000_000;
  const fs = fakeFiles(files);
  const backend = memoryBackend();
  const store = createStore(backend, { now: () => clock });
  await store.ready;
  const recorder = createRecorder({ store, readFile: fs.readFile, storage, now: () => clock });
  return { fs, store, recorder, backend, tick: (ms) => (clock += ms), now: () => clock };
}

const context = { agent: AGENT, session: "s-thread" };

async function claudeEdit(env, path, apply, { tool = "Edit", id = Math.random().toString(36) } = {}) {
  const input = { tool_name: tool, tool_use_id: id, cwd: "/repo", tool_input: { file_path: path } };
  assert.equal(await env.recorder.before(HARNESSES.claude, input, context), undefined);
  apply();
  assert.equal(await env.recorder.after(HARNESSES.claude, { ...input, tool_response: {} }, context), undefined);
}

test("a Claude turn records each file's first and last state, then closes on Stop", async () => {
  const storage = agentStorage({
    [`buzz.claude-code.sessions.v1:${AGENT}`]: JSON.stringify({ [`${CHANNEL}/${ROOT}`]: { id: "s-thread", seen: 1, at: 1 } }),
  });
  const env = await recorderSetup({ files: { "/repo/a.js": "one\ntwo\n", "/repo/img.png": new Uint8Array([0x89, 0, 1]) }, storage });
  await claudeEdit(env, "/repo/a.js", () => env.fs.write("/repo/a.js", "one\nTWO\n"));
  await claudeEdit(env, "/repo/a.js", () => env.fs.write("/repo/a.js", "one\nTWO\nthree\n"));
  await claudeEdit(env, "/repo/new.md", () => env.fs.write("/repo/new.md", "# Hi\n"), { tool: "Write" });
  await claudeEdit(env, "/repo/img.png", () => env.fs.write("/repo/img.png", new Uint8Array([0x89, 0, 2])), { tool: "Write" });
  // Written and put back: not a change.
  await claudeEdit(env, "/repo/new.md", () => env.fs.write("/repo/new.md", "# Hi\n"), { tool: "Write" });
  await env.recorder.before(HARNESSES.claude, { tool_name: "Bash", tool_input: { command: "ls" } }, context);

  env.tick(5000);
  env.recorder.stop(HARNESSES.claude, { last_assistant_message: "Done. I changed **a.js**." }, context);
  const [turn] = env.store.list();
  assert.equal(turn.pubkey, AGENT);
  assert.deepEqual(turn.conversation, { channelId: CHANNEL, root: ROOT });
  assert.equal(turn.stopAt, env.now());
  const a = turn.files["/repo/a.js"];
  assert.equal(a.before, "one\ntwo\n");
  assert.equal(a.after, "one\nTWO\nthree\n");
  assert.deepEqual([a.added, a.removed, a.status, a.display], [2, 1, "modified", "a.js"]);
  assert.equal(turn.files["/repo/new.md"].status, "added");
  assert.equal(turn.files["/repo/img.png"].kind, "binary");
  assert.equal(turn.files["/repo/img.png"].before, null);
  // Saved through to the backend.
  assert.equal(env.backend.map.get(turn.id).files["/repo/a.js"].after, "one\nTWO\nthree\n");
});

test("a turn with no net changes is dropped at Stop, and Stop without a turn is a no-op", async () => {
  const env = await recorderSetup({ files: { "/repo/a.js": "x\n" } });
  await claudeEdit(env, "/repo/a.js", () => env.fs.write("/repo/a.js", "y\n"));
  await claudeEdit(env, "/repo/a.js", () => env.fs.write("/repo/a.js", "x\n"));
  env.recorder.stop(HARNESSES.claude, {}, context);
  assert.equal(env.store.list().length, 0);
  env.recorder.stop(HARNESSES.claude, {}, context);
  assert.equal(env.store.list().length, 0);
});

test("an edit with no pre-read uses Claude's originalFile, else is left out", async () => {
  const env = await recorderSetup({ files: { "/repo/a.js": "new\n", "/repo/b.js": "b2\n" } });
  await env.recorder.after(
    HARNESSES.claude,
    { tool_name: "Edit", tool_use_id: "x", tool_input: { file_path: "/repo/a.js" }, tool_response: { originalFile: "old\n" } },
    context,
  );
  await env.recorder.after(HARNESSES.claude, { tool_name: "Edit", tool_use_id: "y", tool_input: { file_path: "/repo/b.js" }, tool_response: {} }, context);
  env.recorder.stop(HARNESSES.claude, {}, context);
  const [turn] = env.store.list();
  assert.deepEqual(Object.keys(turn.files), ["/repo/a.js"]);
  assert.equal(turn.files["/repo/a.js"].before, "old\n");
});

test("Codex apply_patch records every file in the patch, deletions included", async () => {
  const env = await recorderSetup({ files: { "/repo/src/a.js": "a\n", "/repo/c.txt": "c\n" } });
  const patch = "*** Begin Patch\n*** Update File: src/a.js\n*** Add File: b.txt\n*** Delete File: c.txt\n*** End Patch";
  const input = { tool_name: "apply_patch", tool_use_id: "p1", cwd: "/repo", tool_input: { command: patch } };
  const ctx = { agent: AGENT, session: "th-1" };
  await env.recorder.before(HARNESSES.codex, input, ctx);
  env.fs.write("/repo/src/a.js", "A\n");
  env.fs.write("/repo/b.txt", "b\n");
  env.fs.remove("/repo/c.txt");
  await env.recorder.after(HARNESSES.codex, input, ctx);
  env.recorder.stop(HARNESSES.codex, { last_assistant_message: "ok" }, ctx);
  const files = env.store.list()[0].files;
  assert.deepEqual(
    Object.values(files).map((f) => [f.display, f.status, f.added, f.removed]).sort(),
    [
      ["b.txt", "added", 1, 0],
      ["c.txt", "deleted", 0, 1],
      ["src/a.js", "modified", 1, 1],
    ],
  );
});

test("Pi tool hooks record edits and never answer the hook", async () => {
  const env = await recorderSetup({ files: { "/tmp/p.txt": "1\n" } });
  const call = { id: "c1", name: "edit", arguments: { path: "/tmp/p.txt" } };
  const ctx = { agent: AGENT, session: "3" };
  assert.equal(await env.recorder.before(HARNESSES.pi, call, ctx), undefined);
  env.fs.write("/tmp/p.txt", "2\n");
  assert.equal(await env.recorder.after(HARNESSES.pi, { call, result: { content: [] } }, ctx), undefined);
  const [turn] = env.store.list();
  assert.equal(turn.stopAt, null);
  assert.equal(turn.files["/tmp/p.txt"].added, 1);
});

test("hooks never throw, even when reading fails", async () => {
  const store = createStore(memoryBackend());
  const recorder = createRecorder({
    store,
    readFile: async () => {
      throw new Error("permission denied");
    },
    storage: null,
  });
  const input = { tool_name: "Edit", tool_use_id: "z", tool_input: { file_path: "/x" }, tool_response: {} };
  assert.equal(await recorder.before(HARNESSES.claude, input, context), undefined);
  assert.equal(await recorder.after(HARNESSES.claude, input, context), undefined);
  assert.equal(recorder.stop(HARNESSES.claude, null, context), undefined);
  assert.equal(await recorder.before(HARNESSES.claude, null, context), undefined);
});

function turnAt({ firstAt, stopAt, conversation = { channelId: CHANNEL, root: ROOT }, harness = HARNESSES.claude, ...rest }) {
  return {
    id: `t_${firstAt}`,
    agent: AGENT,
    pubkey: AGENT,
    harness,
    session: "s",
    conversation,
    firstAt,
    lastAt: firstAt,
    stopAt,
    lastMessage: null,
    claim: null,
    files: { "/a": { path: "/a", display: "a", kind: "text", status: "modified", added: 1, removed: 0 } },
    ...rest,
  };
}

const message = (over = {}) => ({ id: "e".repeat(64), channelId: CHANNEL, authorId: AGENT, threadRootId: ROOT, createdAt: 1000, content: "Done", ...over });

test("candidateTurns matches the agent's message in the turn's conversation and window", () => {
  const turn = turnAt({ firstAt: 990_000, stopAt: 1_001_000 });
  const now = 2_000_000;
  assert.deepEqual(candidateTurns(message(), [turn], now), [turn]);
  assert.deepEqual(candidateTurns(message({ authorId: "b".repeat(64) }), [turn], now), []);
  assert.deepEqual(candidateTurns(message({ channelId: "other" }), [turn], now), []);
  assert.deepEqual(candidateTurns(message({ threadRootId: "f".repeat(64) }), [turn], now), []);
  assert.deepEqual(candidateTurns(message({ createdAt: 900 }), [turn], now), []);
  assert.deepEqual(candidateTurns(message({ createdAt: 1200 }), [turn], now), []);
  // Still running: no card yet (Claude/Codex). Pi has no Stop, so it shows.
  assert.deepEqual(candidateTurns(message(), [turnAt({ firstAt: 990_000, stopAt: null })], now), []);
  const pi = turnAt({ firstAt: 990_000, stopAt: null, harness: HARNESSES.pi, conversation: null });
  assert.deepEqual(candidateTurns(message(), [pi], now), [pi]);
  // A claimed turn shows only under its message.
  const claimed = { ...turn, claim: { messageId: "x" } };
  assert.deepEqual(candidateTurns(message(), [claimed], now), []);
  assert.deepEqual(candidateTurns(message({ id: "x" }), [claimed], now), [claimed]);
  // The next turn in the session ends this one's window.
  assert.deepEqual(candidateTurns(message(), [{ ...turn, until: 999_000 }], now), []);
  // Relay-attributed messages signed by someone else never match.
  assert.deepEqual(candidateTurns(message({ signerId: "c".repeat(64) }), [turn], now), []);
});

test("sameText ignores Markdown and spacing", () => {
  assert.ok(sameText("Done. I changed **a.js**.\n\nAll good", "Done.  I changed a.js. All good"));
  assert.ok(!sameText("Something else entirely", "Done. I changed a.js."));
});

test("targets round-trip", () => {
  const target = panelTarget("t_1", "/repo/a b.js");
  assert.deepEqual(parseTarget(target), { turn: "t_1", file: "/repo/a b.js" });
  assert.deepEqual(parseTarget(panelTarget("t_2")), { turn: "t_2", file: null });
});

test("askText names the file and line", () => {
  const text = askText({}, { display: "src/a.js" }, { number: 12, side: "new", text: "  return x;" }, "Why?");
  assert.match(text, /`src\/a.js`, line 12 \(after your change\)/);
  assert.match(text, /`return x;`/);
  assert.match(text, /Their question: Why\?/);
});

test("readPrefs falls back to defaults for missing or bad values", () => {
  assert.equal(readPrefs(agentStorage({})).layout, "unified");
  const p = readPrefs(agentStorage({ "lucas.inline-diffs.v1:prefs": JSON.stringify({ layout: "split", size: "xx", context: -1 }) }));
  assert.deepEqual([p.layout, p.size, p.context], ["split", "md", -1]);
});

async function activate({ turns = [], running = true, saved = {} } = {}) {
  const registered = { hooks: [], accessories: [], panels: [], settings: [], wakes: [] };
  const storage = agentStorage(saved);
  const ctx = {
    react: React,
    effect: () => {},
    host: { readFile: async () => enc("") },
    agents: {
      storage,
      registerHook: (hook) => registered.hooks.push(hook),
      wake: (key, wake) => registered.wakes.push([key, wake]),
      snapshot: () => ({ running: running ? [{ key: AGENT, pubkey: AGENT }] : [] }),
    },
    conversation: { registerAccessory: (a) => registered.accessories.push(a) },
    panels: { register: (p) => registered.panels.push(p) },
    settingsCards: { register: (s) => registered.settings.push(s) },
  };
  const backend = memoryBackend(turns);
  apply(ctx, { backend });
  await new Promise((r) => setTimeout(r, 0));
  return { registered, backend };
}

test("apply registers hooks for each agent type, the card, the panel and Settings", async () => {
  const { registered } = await activate();
  assert.deepEqual(
    registered.hooks.map((h) => `${h.harness} ${h.event}`),
    [
      "buzz.claude-code/claude-code PreToolUse",
      "buzz.claude-code/claude-code PostToolUse",
      "buzz.claude-code/claude-code Stop",
      "buzz.codex/codex PreToolUse",
      "buzz.codex/codex PostToolUse",
      "buzz.codex/codex Stop",
      "buzz.pi/pi beforeTool",
      "buzz.pi/pi afterTool",
    ],
  );
  // Contribution ids are unique per plugin, across agent types.
  assert.equal(new Set(registered.hooks.map((h) => h.id)).size, 8);
  for (const h of registered.hooks) assert.match(h.id, /^[a-z0-9][a-z0-9._-]*$/);
  assert.equal(registered.accessories[0].placement, "message");
  assert.equal(registered.settings[0].title, "Changesets");
});

const savedTurn = () =>
  turnAt({
    firstAt: 990_000,
    stopAt: 1_001_000,
    files: {
      "/repo/src/a.js": {
        path: "/repo/src/a.js",
        display: "src/a.js",
        kind: "text",
        status: "modified",
        before: "one\ntwo\n",
        after: "one\nTWO\nthree\n",
        added: 2,
        removed: 1,
      },
      "/repo/logo.png": { path: "/repo/logo.png", display: "logo.png", kind: "binary", status: "modified", before: null, after: null, added: 0, removed: 0, beforeSize: 10, afterSize: 12 },
    },
  });

test("the card lists files with counts and labels binary files", async () => {
  const { registered } = await activate({ turns: [savedTurn()] });
  const Card = registered.accessories[0].component;
  const html = renderToStaticMarkup(React.createElement(Card, { message: message({ id: "x" }), open: () => true, canOpen: () => true }));
  // Server rendering runs no effects, so an unclaimed turn has no seen
  // candidates yet: claim it to render.
  const claimed = { ...savedTurn(), claim: { messageId: "x", channelId: CHANNEL, root: ROOT } };
  const again = await activate({ turns: [claimed] });
  const html2 = renderToStaticMarkup(
    React.createElement(again.registered.accessories[0].component, { message: message({ id: "x" }), open: () => true, canOpen: () => true }),
  );
  assert.equal(html, "");
  assert.match(html2, /Changeset/);
  assert.match(html2, /2 files changed/);
  assert.match(html2, />\+2</);
  assert.match(html2, />−1</);
  assert.match(html2, /logo\.png/);
  assert.match(html2, /Binary/);
  assert.match(html2, /Only you/);
  // Other messages get no card.
  const none = renderToStaticMarkup(
    React.createElement(again.registered.accessories[0].component, { message: message({ id: "y" }), open: () => true }),
  );
  assert.equal(none, "");
});

test("the panel shows the selected file in one column or side by side", async () => {
  const claimed = { ...savedTurn(), claim: { messageId: "x", channelId: CHANNEL, root: ROOT } };
  const { registered } = await activate({ turns: [claimed] });
  const panel = registered.panels[0];
  const target = panelTarget(claimed.id, "/repo/src/a.js");
  assert.ok(panel.matches(target));
  assert.ok(!panel.matches(panelTarget("t_missing")));
  assert.ok(!panel.matches("https://example.com"));
  const html = renderToStaticMarkup(React.createElement(panel.component, { target, close: () => {} }));
  assert.match(html, /Filter 2 files/);
  assert.match(html, /One column/);
  assert.match(html, /TWO/);
  assert.match(html, /three/);
  assert.match(html, /Ask about line 2/);
  const bin = renderToStaticMarkup(React.createElement(panel.component, { target: panelTarget(claimed.id, "/repo/logo.png"), close: () => {} }));
  assert.match(bin, /Binary file modified: 10 B → 12 B/);
});

test("Settings renders every option and a live sample", async () => {
  const { registered } = await activate();
  const html = renderToStaticMarkup(React.createElement(registered.settings[0].component, { active: () => true }));
  for (const label of ["One column", "Side by side", "Small", "Large", "Buzz mono", "Blue and orange", "Whole file", "Wrap", "Preview"])
    assert.ok(html.includes(label), label);
  assert.match(html, /greet/);
  assert.doesNotMatch(html, /Ask about line/);
});

test("the panel follows the saved side-by-side layout", async () => {
  const claimed = { ...savedTurn(), claim: { messageId: "x", channelId: CHANNEL, root: ROOT } };
  const { registered } = await activate({
    turns: [claimed],
    saved: { "lucas.inline-diffs.v1:prefs": JSON.stringify({ layout: "split" }) },
  });
  const html = renderToStaticMarkup(
    React.createElement(registered.panels[0].component, { target: panelTarget(claimed.id, "/repo/src/a.js"), close: () => {} }),
  );
  assert.match(html, /aria-checked="true"[^>]*><span class="buzz-button-label">Side by side/);
  // "two" (old line 2) and "TWO" (new line 2) share a row.
  assert.match(html, /<tr[^>]*>(?:(?!<\/tr>).)*two(?:(?!<\/tr>).)*TWO/);
});
