// Run: node --test agent-cards/plugin.test.mjs
// React comes from a sibling Buzz checkout, or set REACT_DIR to a folder whose
// node_modules has react and react-dom.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_PATTERNS,
  actionText,
  isProtected,
  guardCall,
  SERVICES,
  connect,
  createKeychain,
  serviceRequest,
  actionDetail,
  apply,
  checkAnswers,
  createStore,
  normalizeQuestions,
  parseCard,
  proseOf,
  submitAnswer,
  wakeText,
} from "./plugin.js";

const require = createRequire(
  join(process.env.REACT_DIR ?? join(homedir(), "Documents/GitHub/buzz-editor-lab"), "x.js"),
);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const AGENT = "a".repeat(64);
const OWNER = "b".repeat(64);
const STRANGER = "c".repeat(64);
const ROOT = "d".repeat(64);

function memoryStorage() {
  const map = new Map();
  return {
    keys: () => [...map.keys()],
    get: (k) => map.get(k) ?? null,
    async set(k, v) {
      if (v === null) map.delete(k);
      else map.set(k, v);
    },
    async add(k, v) {
      if (!map.has(k)) map.set(k, v);
      return map.get(k);
    },
  };
}

function fakeHost({ status = 200, body = '{"login":"lucas"}' } = {}) {
  const keychain = { value: null, broken: false };
  const requests = [];
  return {
    keychain,
    requests,
    async runCommand(id, input) {
      if (keychain.broken) return null;
      if (id.endsWith("-read")) return keychain.value === null ? null : keychain.value;
      if (id.endsWith("-write")) {
        keychain.lastInput = input;
        if (!keychain.dropsWrites) keychain.value = id.includes("mac") ? input.match(/-w (\S+)/)[1] : input;
        return "";
      }
      return null;
    },
    async request(req) {
      requests.push(req);
      return { status: typeof status === "function" ? status(req) : status, headers: {}, body };
    },
  };
}

async function setup({ running = true, host = fakeHost() } = {}) {
  const tools = new Map();
  const hooks = [];
  const wakes = [];
  const published = [];
  let renderer;
  let tab;
  let connectionsTab;
  const agent = { key: AGENT, pubkey: AGENT, name: "Engineer", owner: OWNER };
  const agents = {
    storage: memoryStorage(),
    addTool: (tool) => tools.set(tool.name, tool),
    registerTab: (t) => (t.id === "cards" ? (tab = t) : (connectionsTab = t)),
    registerHook: (hook) => hooks.push(hook),
    wake: (key, wake) => wakes.push({ key, ...wake }),
    snapshot: () => ({ running: running ? [agent] : [], agents: [agent] }),
    subscribe: () => () => {},
    find: (pubkey) => (pubkey === AGENT ? agent : undefined),
  };
  await apply({
    react: React,
    agents,
    conversation: { registerMessage: (r) => (renderer = r) },
    host,
  });
  const client = {
    key: AGENT,
    pubkey: AGENT,
    owner: OWNER,
    async publish(event) {
      const id = String(published.length).padStart(64, "e");
      published.push({ id, ...event });
      return { id, ...event };
    },
  };
  const call = (name, args, context = { channel: "chan", root: ROOT }) =>
    tools.get(name).call(client, context, args);
  const messageOf = (event, authorId = AGENT) => ({
    id: event.id,
    threadRootId: event.tags?.find((t) => t[0] === "e")?.[1],
    channelId: "chan",
    authorId,
    content: event.content,
    attachments: [],
    mentions: [],
    reactions: [],
    replyCount: 0,
    participants: [],
    createdAt: 0,
  });
  const hook = (input) => hooks[0].run(input, { agent: AGENT, session: "s" });
  return { host, connectionsTab: () => connectionsTab, tab: () => tab, hooks, hook, tools, wakes, published, renderer: () => renderer, agents, agent, call, messageOf };
}

test("questions are checked", () => {
  assert.throws(() => normalizeQuestions([]), /at least one/);
  assert.throws(() => normalizeQuestions(Array(6).fill({ prompt: "x" })), /at most 5/);
  assert.throws(
    () => normalizeQuestions([{ prompt: "Tone?", type: "single", options: ["a"] }]),
    /2 to 12 options/,
  );
  assert.throws(
    () => normalizeQuestions([{ name: "a", prompt: "x" }, { name: "a", prompt: "y" }]),
    /Two questions/,
  );
  assert.deepEqual(normalizeQuestions([{ prompt: "Why?" }]), [
    { name: "q1", prompt: "Why?", type: "text" },
  ]);
});

test("cards_ask posts a readable card as the agent in the thread", async () => {
  const s = await setup();
  const reply = await s.call("cards_ask", {
    title: "Ad brief",
    questions: [
      { name: "tone", prompt: "Which tone?", type: "single", options: ["Blunt", "Playful"], allowOther: true },
      { name: "notes", prompt: "Anything else?" },
    ],
  });
  assert.match(reply, /Posted question card c_[0-9a-f]{16}/);
  const [event] = s.published;
  assert.equal(event.kind, 9);
  assert.deepEqual(event.tags, [["h", "chan"], ["e", ROOT, "", "reply"], ["p", OWNER]]);
  assert.match(proseOf(event.content), /Which tone\?\n {3}Pick one: Blunt \/ Playful, or something else/);
  const card = parseCard(event.content);
  assert.equal(card.agent, AGENT);
  assert.equal(card.questions.length, 2);
});

test("a top-level chat gets no thread tag and no root", async () => {
  const s = await setup();
  await s.call("cards_ask", { questions: [{ prompt: "Ok?" }] }, { channel: "chan", root: ROOT, topLevel: true });
  assert.deepEqual(s.published[0].tags, [["h", "chan"], ["p", OWNER]]);
});

test("only an agent's own card is drawn as a card", async () => {
  const s = await setup();
  await s.call("cards_ask", { questions: [{ prompt: "Ok?" }] });
  const event = s.published[0];
  assert.equal(s.renderer().matches(s.messageOf(event)), true);
  assert.equal(s.renderer().matches(s.messageOf(event, STRANGER)), false);
  assert.equal(s.renderer().matches(s.messageOf({ ...event, content: "hi" })), false);
  const forged = event.content.replace(AGENT, STRANGER);
  assert.equal(s.renderer().matches(s.messageOf({ ...event, content: forged }, STRANGER)), false);
});

test("answers are checked against the options", () => {
  const card = {
    questions: normalizeQuestions([
      { name: "tone", prompt: "Tone?", type: "single", options: ["A", "B"] },
      { name: "ch", prompt: "Channels?", type: "multi", options: ["X", "Y"], allowOther: true },
    ]),
  };
  assert.deepEqual(checkAnswers(card, { tone: "A", ch: ["Y", "TikTok"] }), { tone: "A", ch: ["Y", "TikTok"] });
  assert.throws(() => checkAnswers(card, { tone: "Z", ch: ["X"] }), /not an option/);
  assert.throws(() => checkAnswers(card, { tone: "A", ch: [] }), /Answer "Channels\?"/);
});

test("answering wakes the agent once, in the card's thread", async () => {
  const s = await setup();
  await s.call("cards_ask", { questions: [{ name: "tone", prompt: "Tone?", options: ["A", "B"] }] });
  const message = s.messageOf(s.published[0]);
  const card = parseCard(message.content);
  const store = createStore(s.agents.storage);
  await submitAnswer(store, s.agents, message, card, s.agent, { answers: { tone: "B" } });
  await submitAnswer(store, s.agents, message, card, s.agent, { answers: { tone: "A" } });
  assert.equal(s.wakes[0].key, AGENT);
  assert.equal(s.wakes[0].channel, "chan");
  assert.equal(s.wakes[0].root, ROOT);
  assert.match(s.wakes[0].text, /"tone":"B"/);
  // The first answer stands; a second click neither changes it nor wakes again.
  assert.equal(s.wakes.length, 1);
  const read = JSON.parse(await s.call("cards_answer", { id: card.id }));
  assert.equal(read.status, "answered");
  assert.deepEqual(read.answers, { tone: "B" });
});

test("cards_answer is pending until answered and private to the agent", async () => {
  const s = await setup();
  const reply = await s.call("cards_approval", { summary: "Send 3 emails", tool: "gmail_send" });
  const id = reply.match(/c_[0-9a-f]{16}/)[0];
  assert.equal(JSON.parse(await s.call("cards_answer", { id })).status, "pending");
  await assert.rejects(s.call("cards_answer", { id: "c_0000000000000000" }), /no card/);
});

test("Always allow skips later approval cards for that tool", async () => {
  const s = await setup();
  await s.call("cards_approval", { summary: "Send 3 emails", detail: "to a, b, c", tool: "gmail_send" });
  const message = s.messageOf(s.published[0]);
  const card = parseCard(message.content);
  const store = createStore(s.agents.storage);
  await submitAnswer(store, s.agents, message, card, s.agent, { decision: "always" });
  assert.match(s.wakes[0].text, /APPROVED "Send 3 emails" \(tool: gmail_send\)/);
  const again = await s.call("cards_approval", { summary: "Send 2 more", tool: "gmail_send" });
  assert.match(again, /^Approved/);
  assert.equal(s.published.length, 1);
  const other = await s.call("cards_approval", { summary: "Delete a file", tool: "rm" });
  assert.match(other, /pending/);
});

test("deny tells the agent not to act, with the note", () => {
  const text = wakeText({ id: "c_1", kind: "approval", summary: "Buy it" }, { decision: "deny", note: "too pricey" });
  assert.match(text, /DENIED "Buy it".*Do not do it\. Their note: too pricey/);
});

test("a failed wake keeps the answer and says so", async () => {
  const s = await setup();
  await s.call("cards_approval", { summary: "Post it" });
  const message = s.messageOf(s.published[0]);
  const card = parseCard(message.content);
  const store = createStore(s.agents.storage);
  const agents = { ...s.agents, wake: () => { throw new Error("queue full"); } };
  await assert.rejects(
    submitAnswer(store, agents, message, card, s.agent, { decision: "once" }),
    /answer is saved.*queue full/,
  );
  assert.equal(store.answer(card.id).decision, "once");
});

test("the card shows buttons on the owner's device and plain text elsewhere", async () => {
  const s = await setup();
  await s.call("cards_approval", { summary: "Send 3 emails", tool: "gmail_send" });
  const props = { message: s.messageOf(s.published[0]) };
  const html = renderToStaticMarkup(React.createElement(s.renderer().component, props));
  assert.match(html, /Approval needed<\/span><strong>Send 3 emails<\/strong>/);
  // Chillin' (the default): accent card, main button inverted to stand out.
  assert.match(html, /data-vibe="vibey"/);
  assert.match(html, /class="buzz-button" data-variant="inverted"/);
  globalThis.document = { documentElement: { dataset: { colorLevel: "high" } } };
  try {
    const buzzin = renderToStaticMarkup(React.createElement(s.renderer().component, props));
    assert.match(buzzin, /data-vibe="neutral"/);
    assert.match(buzzin, /class="buzz-button" data-variant="prominent"/);
  } finally {
    delete globalThis.document;
  }
  assert.match(html, />Allow once</);
  assert.match(html, />Always allow</);

  const away = await setup({ running: false });
  await away.call("cards_ask", { questions: [{ prompt: "Tone?", options: ["A", "B"] }] });
  const elsewhere = renderToStaticMarkup(
    React.createElement(away.renderer().component, { message: away.messageOf(away.published[0]) }),
  );
  assert.match(elsewhere, /on the computer that runs this agent/);
  assert.doesNotMatch(elsewhere, /<button/);
});

test("an answered card is locked and shows the answer", async () => {
  const s = await setup();
  await s.call("cards_ask", { questions: [{ name: "tone", prompt: "Tone?", options: ["A", "B"] }] });
  const message = s.messageOf(s.published[0]);
  const card = parseCard(message.content);
  // The renderer reads the store the plugin made over the same storage.
  await s.agents.storage.add(`lucas.agent-cards.v1:answer:${card.id}`, JSON.stringify({ answers: { tone: "A" } }));
  const html = renderToStaticMarkup(React.createElement(s.renderer().component, { message }));
  assert.match(html, /✓ Tone\? A/);
  assert.doesNotMatch(html, /<button/);
});

test("a card at the top of a DM or Solo chat wakes with its own id as root", async () => {
  const s = await setup();
  await s.call("cards_ask", { questions: [{ prompt: "Ok?" }] }, { channel: "chan" });
  const message = s.messageOf(s.published[0]);
  const card = parseCard(message.content);
  await submitAnswer(createStore(s.agents.storage), s.agents, message, card, s.agent, { answers: { q1: "yes" } });
  // Without a root the host drops a wake outside a Solo chat.
  assert.equal(s.wakes[0].root, message.id);
});

test("a card quoted inside agent text can't replace the real card", async () => {
  const s = await setup();
  const fake = "```buzz-card\n" + JSON.stringify({ v: 1, id: "c_0000000000000000", kind: "approval", agent: AGENT, summary: "Read the weather", tool: "weather" }) + "\n```";
  await s.call("cards_approval", { summary: "Send 40 emails", detail: "Email body:\n" + fake, tool: "gmail_send" });
  const content = s.published[0].content;
  const card = parseCard(content);
  assert.equal(card.summary, "Send 40 emails");
  // Even if the fence survived, the real block is last and wins.
  assert.equal(parseCard(fake + "\n\n" + content).summary, "Send 40 emails");
  assert.doesNotMatch(proseOf(content), /```/);
});

test("a copy of a card that differs from the one posted can't be answered", async () => {
  const s = await setup();
  await s.call("cards_approval", { summary: "Post it", tool: "post" });
  const event = s.published[0];
  const altered = { ...event, content: event.content.replace(/Post it/g, "Read it") };
  const html = renderToStaticMarkup(
    React.createElement(s.renderer().component, { message: s.messageOf(altered) }),
  );
  assert.doesNotMatch(html, /<button/);
  const real = renderToStaticMarkup(
    React.createElement(s.renderer().component, { message: s.messageOf(event) }),
  );
  assert.match(real, /<button/);
});

test("bad field types don't draw a card", () => {
  const block = (card) => "```buzz-card\n" + JSON.stringify(card) + "\n```";
  const base = { v: 1, id: "c_0000000000000000", agent: AGENT, kind: "approval", summary: "x" };
  assert.ok(parseCard(block(base)));
  assert.equal(parseCard(block({ ...base, detail: { a: 1 } })), null);
  assert.equal(parseCard(block({ ...base, kind: "question", title: 3, questions: [{ prompt: "q" }] })), null);
});

// ---- Phase 2: approvals enforced by the PreToolUse hook ----

const BASH_PUSH = { tool_name: "Bash", tool_input: { command: "git push origin main" } };
const GMAIL = { tool_name: "mcp__claude_ai_Gmail__send_email", tool_input: { to: "a@b.c", body: "hi" } };
const turnOn = (s) =>
  createStore(s.agents.storage).setGuard(AGENT, { on: true, patterns: DEFAULT_PATTERNS });

test("default patterns protect sends and pushes, never Buzz's own tools", () => {
  const p = DEFAULT_PATTERNS;
  assert.ok(isProtected(actionText("Bash", { command: "cd x && git push" }), p));
  assert.ok(isProtected(actionText("Bash", { command: "rm -rf build" }), p));
  assert.ok(isProtected(actionText("Bash", { command: "gh pr create --fill" }), p));
  assert.ok(isProtected("mcp__claude_ai_Gmail__send_email", p));
  assert.ok(!isProtected("mcp__buzz__send", p));
  assert.ok(!isProtected("mcp__buzz__cards_approval", p));
  assert.ok(!isProtected(actionText("Bash", { command: "git status" }), p));
  assert.ok(!isProtected("Read", p));
  assert.ok(!isProtected("x", ["(", "# note"]), "a bad pattern is skipped");
});

test("the guard does nothing until the owner turns it on", async () => {
  const s = await setup();
  assert.equal(await s.hook(BASH_PUSH), undefined);
});

test("a stopped call needs an approval card, then runs exactly once", async () => {
  const s = await setup();
  await turnOn(s);
  const denied = await s.hook(BASH_PUSH);
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
  const request = denied.hookSpecificOutput.permissionDecisionReason.match(/r_[0-9a-f]{16}/)[0];

  await assert.rejects(s.call("cards_approval", { summary: "x", request: "r_0000000000000000" }), /No stopped call/);
  await s.call("cards_approval", { summary: "Push the fix", detail: "it's tiny", request });
  const message = s.messageOf(s.published[0]);
  const card = parseCard(message.content);
  // The card shows the real command from the guard, whatever the agent wrote.
  assert.equal(card.action, "Bash: git push origin main");
  assert.equal(card.tool, "Bash");

  await submitAnswer(createStore(s.agents.storage), s.agents, message, card, s.agent, { decision: "once" });
  assert.match(s.wakes[0].text, /Retry exactly the same call now; it is allowed once/);
  assert.equal(await s.hook(BASH_PUSH), undefined, "the retry runs");
  assert.equal((await s.hook(BASH_PUSH)).hookSpecificOutput.permissionDecision, "deny", "once only");
});

test("approval for one call doesn't let a different call through", async () => {
  const s = await setup();
  await turnOn(s);
  const denied = await s.hook(GMAIL);
  const request = denied.hookSpecificOutput.permissionDecisionReason.match(/r_[0-9a-f]{16}/)[0];
  await s.call("cards_approval", { summary: "Email a", request });
  const message = s.messageOf(s.published[0]);
  await submitAnswer(createStore(s.agents.storage), s.agents, message, parseCard(message.content), s.agent, { decision: "once" });
  const other = { ...GMAIL, tool_input: { to: "everyone@b.c", body: "hi" } };
  assert.equal((await s.hook(other)).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(await s.hook(GMAIL), undefined);
});

test("deny leaves the call stopped", async () => {
  const s = await setup();
  await turnOn(s);
  const request = (await s.hook(BASH_PUSH)).hookSpecificOutput.permissionDecisionReason.match(/r_[0-9a-f]{16}/)[0];
  await s.call("cards_approval", { summary: "Push", request });
  const message = s.messageOf(s.published[0]);
  await submitAnswer(createStore(s.agents.storage), s.agents, message, parseCard(message.content), s.agent, { decision: "deny" });
  assert.match(s.wakes[0].text, /DENIED/);
  assert.equal((await s.hook(BASH_PUSH)).hookSpecificOutput.permissionDecision, "deny");
});

test("Always allow covers a tool, but only the exact command for shell", async () => {
  const s = await setup();
  await turnOn(s);
  for (const call of [GMAIL, BASH_PUSH]) {
    const request = (await s.hook(call)).hookSpecificOutput.permissionDecisionReason.match(/r_[0-9a-f]{16}/)[0];
    await s.call("cards_approval", { summary: "ok", request });
    const message = s.messageOf(s.published.at(-1));
    await submitAnswer(createStore(s.agents.storage), s.agents, message, parseCard(message.content), s.agent, { decision: "always" });
  }
  assert.equal(await s.hook({ ...GMAIL, tool_input: { to: "z@b.c" } }), undefined, "any Gmail send now");
  assert.equal(await s.hook(BASH_PUSH), undefined);
  assert.equal(await s.hook(BASH_PUSH), undefined, "every time");
  const force = { tool_name: "Bash", tool_input: { command: "git push --force" } };
  assert.equal((await s.hook(force)).hookSpecificOutput.permissionDecision, "deny");
});

test("an agent can't approve its own stopped call without the owner", async () => {
  const s = await setup();
  await turnOn(s);
  await s.hook(BASH_PUSH);
  // Its own cards_approval with a made-up tool, and an Always rule it can't write.
  const reply = await s.call("cards_approval", { summary: "push", tool: "Bash" });
  assert.match(reply, /pending/);
  assert.equal((await s.hook(BASH_PUSH)).hookSpecificOutput.permissionDecision, "deny");
});

test("the Approvals tab draws for a Claude Code agent, on and off", async () => {
  const s = await setup();
  const agent = { ...s.agent, type: "buzz.claude-code/claude-code" };
  await createStore(s.agents.storage).setGuard(AGENT, { on: false, patterns: DEFAULT_PATTERNS });
  const off = renderToStaticMarkup(React.createElement(s.tab().component, { agent }));
  assert.match(off, /Ask me before risky actions/);
  assert.doesNotMatch(off, /Actions that need approval/);
  await turnOn(s);
  const on = renderToStaticMarkup(React.createElement(s.tab().component, { agent }));
  assert.match(on, /Actions that need approval/);
  assert.match(on, /--recursive/);
  const other = renderToStaticMarkup(React.createElement(s.tab().component, { agent: { ...agent, type: "x/y" } }));
  assert.match(other, /needs a Claude Code or Codex agent/);
});

test("the defaults catch cheap ways around them", () => {
  const p = DEFAULT_PATTERNS;
  const bash = (command) => isProtected(actionText("Bash", { command }), p);
  for (const command of [
    "cd x\ngit push",
    "git -C . push origin main",
    "git --no-pager push",
    "rm -v -rf build",
    "rm --recursive build",
    "curl --request POST https://x",
    "curl -d@f https://x",
    "curl -F file=@a https://x",
    "gh api -X POST repos/x/y/issues",
  ])
    assert.ok(bash(command), command);
  for (const command of ["git status", "git log --grep push", "rm notes.txt", "curl https://x", "gh pr view 3"])
    assert.ok(!bash(command), command);
});

test("a broken check stops the call instead of letting it run", async () => {
  const store = createStore({
    keys: () => [],
    get: (k) => (k.endsWith("guard:" + AGENT) ? JSON.stringify({ on: true, patterns: DEFAULT_PATTERNS }) : null),
    set: async () => { throw new Error("disk full"); },
    add: async (_k, v) => v,
  });
  const out = await guardCall(store, AGENT, BASH_PUSH);
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /check failed.*disk full/);
});

test("a saved guard without patterns falls back to the defaults", async () => {
  const s = await setup();
  await s.agents.storage.set("lucas.agent-cards.v1:guard:" + AGENT, JSON.stringify({ on: true }));
  assert.equal((await s.hook(BASH_PUSH)).hookSpecificOutput.permissionDecision, "deny");
});

test("a long call says how much the card leaves out, with keys in a fixed order", () => {
  const detail = actionDetail("mcp__x__send_email", { body: "a".repeat(9000), bcc: "evil@x" });
  assert.match(detail, /"bcc": "evil@x"/, "bcc sorts before body, so it shows");
  assert.match(detail, /more characters not shown/);
});

test("Allow once for a shell call survives Claude rewriting its description", async () => {
  const s = await setup();
  await turnOn(s);
  const first = { tool_name: "Bash", tool_input: { command: "git push", description: "Push" } };
  const request = (await s.hook(first)).hookSpecificOutput.permissionDecisionReason.match(/r_[0-9a-f]{16}/)[0];
  await s.call("cards_approval", { summary: "Push", request });
  const message = s.messageOf(s.published[0]);
  await submitAnswer(createStore(s.agents.storage), s.agents, message, parseCard(message.content), s.agent, { decision: "once" });
  const retry = { tool_name: "Bash", tool_input: { command: "git push", description: "Push the branch", timeout: 60000 } };
  assert.equal(await s.hook(retry), undefined);
});

test("a later stopped call can't take an open card's place", async () => {
  const s = await setup();
  await turnOn(s);
  const request = (await s.hook(BASH_PUSH)).hookSpecificOutput.permissionDecisionReason.match(/r_[0-9a-f]{16}/)[0];
  await s.call("cards_approval", { summary: "Push", request });
  // The agent overwrites the stored request with a different call under the same id.
  const store = createStore(s.agents.storage);
  const evil = { tool_name: "Bash", tool_input: { command: "git push --force" } };
  const { callHash } = await import("./plugin.js");
  await store.addRequest(AGENT, { id: request, hash: await callHash("Bash", evil.tool_input), tool: "Bash", action: "Bash: git push --force", detail: "x", at: Date.now() });
  const message = s.messageOf(s.published[0]);
  await submitAnswer(store, s.agents, message, parseCard(message.content), s.agent, { decision: "once" });
  assert.equal((await s.hook(evil)).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(await s.hook(BASH_PUSH), undefined);
});

test("Always allow on an agent's own card never opens the guard", async () => {
  const s = await setup();
  await turnOn(s);
  await s.call("cards_approval", { summary: "Send mail", tool: GMAIL.tool_name });
  const message = s.messageOf(s.published[0]);
  await submitAnswer(createStore(s.agents.storage), s.agents, message, parseCard(message.content), s.agent, { decision: "always" });
  assert.match(await s.call("cards_approval", { summary: "again", tool: GMAIL.tool_name }), /^Approved/);
  assert.equal((await s.hook(GMAIL)).hookSpecificOutput.permissionDecision, "deny");
});

// ---- Phase 3: connections ----

test("service requests only reach the service's own address, with its auth", () => {
  const gh = serviceRequest("github", "tok", { method: "GET", path: "/repos/a/b", query: { per_page: 5 } });
  assert.equal(gh.url, "https://api.github.com/repos/a/b?per_page=5");
  assert.equal(gh.headers.Authorization, "Bearer tok");
  assert.equal(serviceRequest("linear", "lin", { method: "POST", path: "/graphql", body: { query: "{x}" } }).headers.Authorization, "lin");
  assert.equal(serviceRequest("klaviyo", "pk", { path: "/api/lists/" }).headers.Authorization, "Klaviyo-API-Key pk");
  const stripe = serviceRequest("stripe", "sk", { method: "POST", path: "/v1/customers", body: { email: "a@b.c", metadata: { plan: "pro" } } });
  assert.equal(stripe.body, "email=a%40b.c&metadata%5Bplan%5D=pro");
  for (const path of ["//evil.com/x", "https://evil.com/x", "x", "/a b", "/a\\b"])
    assert.throws(() => serviceRequest("github", "tok", { path }), /path must start|only go to/, path);
  assert.throws(() => serviceRequest("nope", "tok", { path: "/" }), /Unknown service/);
  assert.throws(() => serviceRequest("github", "tok", { method: "TRACE", path: "/" }), /method/);
});

test("connecting tests the token and keeps it in the keychain, never in agent storage", async () => {
  const s = await setup();
  const store = createStore(s.agents.storage);
  const linked = { store, keychain: createKeychain(s.host, "linux"), host: s.host };
  const result = await connect(linked, "github", "  ghp_secret  ", [AGENT]);
  assert.deepEqual(result, { who: "lucas", access: [AGENT] });
  assert.equal(s.host.requests[0].headers.Authorization, "Bearer ghp_secret");
  assert.deepEqual(JSON.parse(atob(s.host.keychain.value)), { github: "ghp_secret" });
  for (const key of s.agents.storage.keys()) assert.doesNotMatch(s.agents.storage.get(key), /ghp_secret/);
  assert.equal(store.connections().github.who, "lucas");
});

test("a token the service rejects isn't saved", async () => {
  const s = await setup({ host: fakeHost({ status: 401, body: "{}" }) });
  const store = createStore(s.agents.storage);
  await assert.rejects(connect({ store, keychain: createKeychain(s.host, "linux"), host: s.host }, "github", "bad", "all"), /didn't accept that token/);
  assert.equal(s.host.keychain.value, null);
  assert.deepEqual(store.connections(), {});
});

test("an unreadable keychain is never overwritten", async () => {
  const s = await setup();
  const store = createStore(s.agents.storage);
  const linked = { store, keychain: createKeychain(s.host, "linux"), host: s.host };
  await connect(linked, "github", "one", "all");
  const saved = s.host.keychain.value;
  s.host.keychain.broken = true;
  await assert.rejects(connect(linked, "notion", "two", "all"), /keychain/);
  s.host.keychain.broken = false;
  assert.equal(s.host.keychain.value, saved);
});

test("macOS writes go through security's own input, not its arguments", async () => {
  const host = fakeHost();
  await createKeychain(host, "mac").update(() => ({ github: "x" }), false);
  assert.match(host.keychain.lastInput, /^add-generic-password -U -s buzz-agent-cards -a connections -w [A-Za-z0-9+/=]+\n$/);
});

test("the connections tool asks, then calls with the token the agent never sees", async () => {
  const s = await setup();
  assert.match(await s.call("connections", { action: "list" }), /github \(GitHub\): not connected/);
  await assert.rejects(s.call("connections", { action: "call", service: "github", path: "/user" }), /isn't connected/);

  const reply = await s.call("connections", { action: "request", service: "github", reason: "to open the PR you asked for" });
  assert.match(reply, /Posted Connect card c_/);
  const message = s.messageOf(s.published[0]);
  const card = parseCard(message.content);
  assert.equal(card.kind, "connect");
  const html = renderToStaticMarkup(React.createElement(s.renderer().component, { message }));
  assert.match(html, /Connect GitHub/);
  assert.match(html, /type="password"/);
  assert.match(html, /Only Engineer/);

  const store = createStore(s.agents.storage);
  await connect({ store, keychain: createKeychain(s.host, "linux"), host: s.host }, "github", "ghp_secret", [AGENT]);
  await submitAnswer(store, s.agents, message, card, s.agent, { who: "lucas", access: "one" });
  assert.match(s.wakes[0].text, /connected GitHub \(as lucas\)/);
  assert.doesNotMatch(s.wakes[0].text, /ghp_secret/);

  const out = await s.call("connections", { action: "call", service: "github", method: "GET", path: "/user" });
  assert.match(out, /^HTTP 200/);
  assert.doesNotMatch(out, /ghp_secret/);
  assert.equal(s.host.requests.at(-1).headers.Authorization, "Bearer ghp_secret");
  assert.match(await s.call("connections", { action: "request", service: "github" }), /already connected/);
  for (const event of s.published) assert.doesNotMatch(event.content, /ghp_secret/);
});

test("a connection for one agent isn't usable by another", async () => {
  const s = await setup();
  const store = createStore(s.agents.storage);
  await connect({ store, keychain: createKeychain(s.host, "linux"), host: s.host }, "github", "t", ["f".repeat(64)]);
  await assert.rejects(s.call("connections", { action: "call", service: "github", path: "/user" }), /isn't connected for you/);
  assert.match(await s.call("connections", { action: "list" }), /connected for other agents only/);
});

test("the Connections tab lists every service", async () => {
  const s = await setup();
  const html = renderToStaticMarkup(React.createElement(s.connectionsTab().component, { agent: { ...s.agent, type: "x/y" } }));
  for (const service of Object.values(SERVICES)) assert.match(html, new RegExp(service.name));
  assert.match(html, /Not connected/);
});

test("a save the keychain reports but didn't keep is caught", async () => {
  const host = fakeHost();
  host.keychain.dropsWrites = true;
  await assert.rejects(createKeychain(host, "linux").update(() => ({ github: "x" }), false), /Couldn't save/);
});

test("connecting another agent keeps the agents already using it", async () => {
  const s = await setup();
  const store = createStore(s.agents.storage);
  const linked = { store, keychain: createKeychain(s.host, "linux"), host: s.host };
  const other = "f".repeat(64);
  await connect(linked, "github", "t1", [other]);
  await connect(linked, "github", "t2", [AGENT]);
  assert.deepEqual(store.connections().github.agents, [other, AGENT]);
  await connect(linked, "github", "t3", "all");
  assert.equal(store.connections().github.agents, "all");
});

test("disconnect works even when the keychain entry is gone", async () => {
  const { disconnect } = await import("./plugin.js");
  const s = await setup();
  const store = createStore(s.agents.storage);
  const linked = { store, keychain: createKeychain(s.host, "linux"), host: s.host };
  await connect(linked, "github", "t", "all");
  s.host.keychain.value = null;
  assert.deepEqual(await disconnect(linked, "github"), { tokenRemoved: false });
  assert.deepEqual(store.connections(), {});
});

test("a token without read access gets a clear message", async () => {
  const s = await setup({ host: fakeHost({ status: 403, body: "{}" }) });
  const store = createStore(s.agents.storage);
  await assert.rejects(connect({ store, keychain: createKeychain(s.host, "linux"), host: s.host }, "klaviyo", "pk", "all"), /accepted the token, but it can't read your account/);
});

// ---- Sign-in cards ----

test("a link sign-in shows the page, its address and the code", async () => {
  const s = await setup();
  await assert.rejects(s.call("cards_signin", { service: "Shopify CLI", method: "link", url: "http://evil.test" }), /https/);
  await assert.rejects(s.call("cards_signin", { service: "Shopify CLI", method: "link" }), /needs the url/);
  await s.call("cards_signin", { service: "GitHub CLI", method: "link", url: "https://github.com/login/device", code: "ABCD-1234", command: "gh auth login --web" });
  const message = s.messageOf(s.published[0]);
  assert.match(message.content, /Sign-in page: https:\/\/github.com\/login\/device\nCode: ABCD-1234/);
  const html = renderToStaticMarkup(React.createElement(s.renderer().component, { message }));
  assert.match(html, /href="https:\/\/github.com\/login\/device"/);
  assert.match(html, /ABCD-1234/);
  assert.match(html, /Opens github.com/);
  assert.match(html, /gh auth login --web/);
  const card = parseCard(message.content);
  await submitAnswer(createStore(s.agents.storage), s.agents, message, card, s.agent, { done: true });
  assert.match(s.wakes[0].text, /says they've signed in to GitHub CLI/);
});

test("a browser sign-in waits for Start before anything runs", async () => {
  const s = await setup();
  await s.call("cards_signin", { service: "Notion", method: "browser", command: "claude mcp login notion" });
  const message = s.messageOf(s.published[0]);
  const html = renderToStaticMarkup(React.createElement(s.renderer().component, { message }));
  assert.match(html, /Start sign-in/);
  assert.doesNotMatch(html, /I&#x27;ve signed in/);
  const card = parseCard(message.content);
  assert.match(wakeText(card, { started: true }), /Start the sign-in now \(claude mcp login notion\)/);
  await createStore(s.agents.storage).markStarted(card.id);
  const after = renderToStaticMarkup(React.createElement(s.renderer().component, { message }));
  assert.match(after, /browser window that opened/);
  assert.match(after, /I&#x27;ve signed in/);
  await submitAnswer(createStore(s.agents.storage), s.agents, message, card, s.agent, { done: false });
  assert.match(s.wakes[0].text, /cancelled signing in to Notion/);
});

test("sign-in cards with a non-https link are not drawn", () => {
  const block = (card) => "```buzz-card\n" + JSON.stringify(card) + "\n```";
  const base = { v: 1, id: "c_0000000000000000", agent: AGENT, kind: "signin", service: "X", method: "link" };
  assert.ok(parseCard(block({ ...base, url: "https://x.test/" })));
  assert.equal(parseCard(block({ ...base, url: "javascript:alert(1)" })), null);
  assert.equal(parseCard(block({ ...base, url: "http://x.test/" })), null);
  assert.equal(parseCard(block(base)), null);
});
