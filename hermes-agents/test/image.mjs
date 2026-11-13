// Runs one real turn with an image attached, the way Buzz delivers it: the
// message has an `imeta` tag and a Markdown link to a sign-in-only media URL,
// and `agent.media(url)` (Buzz's download for agents) returns the file.
// Usage: node test/image.mjs <image.png> [profile]
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));
const plugin = await import("../plugin.js");
const imagePath = process.argv[2];
const profile = process.argv[3] ?? "copywriter";
if (!imagePath) throw new Error("usage: node test/image.mjs <image.png> [profile]");
const bytes = readFileSync(imagePath);

const host = {
  async runCommand(id) {
    const cmd = manifest.host.commands.find((c) => c.id === id);
    return execFileSync(cmd.program, cmd.args, { encoding: "utf8" });
  },
  async spawn(id, options) {
    const decl = manifest.host.processes.find((p) => p.id === id);
    const cwd = options.cwd === "~" ? homedir() : options.cwd;
    const child = spawn(decl.program, [...(decl.args ?? []), ...(options.args ?? [])], { cwd });
    child.stdout.setEncoding("utf8").on("data", (d) => options.onStdout?.(d));
    child.stderr.setEncoding("utf8").on("data", (d) => options.onStderr?.(d));
    return {
      write: async (t) => void child.stdin.write(t),
      kill: async () => void child.kill(),
      exited: new Promise((r) => child.on("exit", (c) => r(c))),
    };
  },
};
let type;
const effects = [];
await plugin.apply({
  react: { createElement() {}, useState() {}, useEffect() {} },
  agents: { register: (t) => (type = t) },
  host,
  effect: (f) => effects.push(f()),
});

const OWNER = "a".repeat(64);
const HASH = "13f68ce8901f1cadf0c61dd860fbe34cbbf4376a000cd3adfab6aa1aa3dfec86";
const URL_ = `https://example.communities.buzz.xyz/media/${HASH}.png`;
const posted = [];
const mediaCalls = [];
const handle = {
  key: "test-agent",
  pubkey: "b".repeat(64),
  name: "Tester",
  owner: OWNER,
  async publish(e) {
    posted.push(e);
    return { ...e, id: "f".repeat(64) };
  },
  async query() {
    return [];
  },
  async media(url) {
    mediaCalls.push(url);
    return { path: imagePath, type: "png", size: bytes.length, data: bytes.toString("base64") };
  },
};

const event = {
  id: "1".repeat(64),
  pubkey: OWNER,
  content: `What program is open on the right half of this screenshot, and what is it doing? One sentence.\n\n![image.png](${URL_})`,
  tags: [["h", "dm1"], ["imeta", `url ${URL_}`, "m image/png", `x ${HASH}`]],
  created_at: 1,
};
let done;
await type.run({
  trigger: { type: "mention", event },
  channelId: "dm1",
  agent: handle,
  config: { profile },
  workingUntil: (p) => (done = p),
  acknowledged() {},
  ignored: () => console.log("(ignored)"),
  step: (s) => console.log("step:", s),
  interruptible() {},
});
console.log("result:", await done);
console.log("media() called with:", mediaCalls);
for (const e of posted) console.log("POSTED:", e.content);
for (const f of effects) f?.();
setTimeout(() => process.exit(0), 500);
