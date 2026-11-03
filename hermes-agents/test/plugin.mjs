// Loads the built plugin with a stand-in for Buzz's ctx and runs real turns
// through it: a thread mention, a follow-up in the same thread, and a DM.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));
const plugin = await import("../plugin.js");
const profile = process.argv[2] ?? "copywriter";

const effects = [];
const host = {
  async runCommand(id) {
    const cmd = manifest.host.commands.find((c) => c.id === id);
    return execFileSync(cmd.program, cmd.args, { encoding: "utf8" });
  },
  async spawn(id, options) {
    const decl = manifest.host.processes.find((p) => p.id === id);
    if (!decl) throw new Error(`undeclared process ${id}`);
    const cwd = options.cwd === "~" ? homedir() : options.cwd;
    const child = spawn(decl.program, [...(decl.args ?? []), ...(options.args ?? [])], { cwd });
    child.stdout.setEncoding("utf8").on("data", (d) => options.onStdout?.(d));
    child.stderr.setEncoding("utf8").on("data", (d) => options.onStderr?.(d));
    return {
      write: async (t) => void child.stdin.write(t),
      end: async (t = "") => void child.stdin.end(t),
      kill: async () => void child.kill(),
      exited: new Promise((r) => child.on("exit", (c) => r(c))),
    };
  },
};
let type;
const ctx = {
  react: { createElement() {}, useState() {}, useEffect() {} },
  agents: { register: (t) => (type = t) },
  host,
  pluginOwner: { id: "hermes.agents" },
  effect: (f) => effects.push(f()),
};
await plugin.apply(ctx);
console.log("registered type:", type.id, "-", type.title, "| summary:", type.summary({ config: { profile } }));

const OWNER = "a".repeat(64);
const AGENT = "b".repeat(64);
const posted = [];
const handle = {
  key: "test-agent",
  pubkey: AGENT,
  name: "Copywriter",
  owner: OWNER,
  async publish(e) {
    posted.push(e);
    return { ...e, id: "f".repeat(64) };
  },
  async query(filters) {
    // channel "dm1" is a DM; anything else is a normal channel.
    if (filters[0]?.kinds?.[0] === 39000)
      return filters[0]["#d"][0] === "dm1" ? [{ tags: [["d", "dm1"], ["t", "dm"]] }] : [];
    return [];
  },
};

async function deliver(event, channelId) {
  let done;
  const delivery = {
    trigger: { type: "mention", event },
    channelId,
    agent: handle,
    config: { profile },
    signal: new AbortController().signal,
    workingUntil: (p) => (done = p),
    acknowledged() {},
    ignored: () => console.log("  (ignored)"),
    step: (s) => console.log("  step:", s),
    interruptible() {},
    current: () => true,
  };
  await type.run(delivery);
  return done ? await done : "ignored";
}

const t0 = Date.now();
const top = { id: "1".repeat(64), pubkey: OWNER, content: "[@Copywriter](nostr:npub1abc) Write a 5-word headline for a coffee brand. Just the headline.", tags: [["h", "chan1"], ["p", AGENT]], created_at: 1 };
console.log("1) thread mention ->", await deliver(top, "chan1"), `${Date.now() - t0}ms`);
const followUp = { id: "2".repeat(64), pubkey: OWNER, content: "Now make it 3 words.", tags: [["h", "chan1"], ["e", top.id, "", "reply"], ["p", AGENT]], created_at: 2 };
console.log("2) follow-up in thread ->", await deliver(followUp, "chan1"), `${Date.now() - t0}ms`);
const stranger = { ...top, id: "3".repeat(64), pubkey: "c".repeat(64) };
console.log("3) someone else ->", await deliver(stranger, "chan1"));
const dm = { id: "4".repeat(64), pubkey: OWNER, content: "Say hi in 3 words.", tags: [["h", "dm1"]], created_at: 3 };
console.log("4) DM ->", await deliver(dm, "dm1"), `${Date.now() - t0}ms`);

for (const e of posted) console.log("POSTED", JSON.stringify(e.tags), "::", JSON.stringify(e.content));
for (const f of effects) f?.();
setTimeout(() => process.exit(0), 500);
