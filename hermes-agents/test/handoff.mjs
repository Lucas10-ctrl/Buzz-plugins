// Two real Hermes agents on a stand-in relay: the owner tags only the first,
// it hands off to the second with an @mention, and the second answers.
// Also checks that forged or foreign handoffs are ignored and the loop cap.
//   node test/handoff.mjs [first-profile] [second-profile]
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const noble = `${homedir()}/Documents/GitHub/buzz-editor-lab/buzz-app/node_modules/@noble/curves/secp256k1.js`;
const { schnorr } = await import(noble);
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));
const plugin = await import("../plugin.js");
const [first = "copywriter", second = "reviewer"] = process.argv.slice(2);
const hex = (b) => Buffer.from(b).toString("hex");
const keypair = () => {
  const sk = schnorr.utils.randomSecretKey();
  return { sk, pk: hex(schnorr.getPublicKey(sk)) };
};
const owner = keypair();
const stranger = keypair();
const authTag = async (target, by = owner) => {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`nostr:agent-auth:${target}:`)));
  return ["auth", by.pk, "", hex(await schnorr.sign(d, by.sk))];
};

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
      end: async (t = "") => void child.stdin.end(t),
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
  pluginOwner: { id: "hermes.agents" },
  effect: (f) => effects.push(f()),
});

// ── stand-in relay ──
const events = [];
let clock = 1000;
let nextId = 1;
const agents = {};
const roster = [];
const matches = (e, f) =>
  (!f.ids || f.ids.includes(e.id)) &&
  (!f.kinds || f.kinds.includes(e.kind)) &&
  (!f.authors || f.authors.includes(e.pubkey)) &&
  Object.entries(f).every(([k, v]) => !k.startsWith("#") || e.tags.some((t) => t[0] === k.slice(1) && v.includes(t[1])));
const query = async (filters) => [...events, ...roster].filter((e) => filters.some((f) => matches(e, f)));
const store = (e) => {
  const ev = { id: String(nextId++).padStart(64, "0"), created_at: clock++, ...e };
  events.push(ev);
  return ev;
};

async function makeAgent(name, profile) {
  const { pk } = keypair();
  const auth = await authTag(pk);
  const handle = {
    key: `agent-${name}`,
    pubkey: pk,
    name,
    owner: owner.pk,
    query,
    async publish(e) {
      const ev = store({ ...e, pubkey: pk, tags: [...e.tags, auth] });
      console.log(`\n[${name} posted] p-tags=${JSON.stringify(ev.tags.filter((t) => t[0] === "p").map((t) => agentName(t[1])))}\n${ev.content}\n`);
      route(ev);
      return ev;
    },
  };
  agents[pk] = { handle, profile, name };
  roster.push({ id: `r${name}`, kind: 30177, pubkey: owner.pk, created_at: 1, content: JSON.stringify({ name }), tags: [["d", pk], ["runtime", "hermes"]] });
  return handle;
}
const agentName = (pk) => agents[pk]?.name ?? pk.slice(0, 6);

const runs = [];
const outcomes = [];
function route(ev) {
  for (const t of ev.tags) if (t[0] === "p" && agents[t[1]] && t[1] !== ev.pubkey) runs.push(deliver(agents[t[1]], ev));
}
async function deliver({ handle, profile, name }, event) {
  let done;
  let result = "pending";
  await type.run({
    trigger: { type: "mention", event },
    channelId: "chan1",
    agent: handle,
    config: { profile },
    signal: new AbortController().signal,
    workingUntil: (p) => (done = p),
    acknowledged() {},
    ignored: () => (result = "ignored"),
    step() {},
    interruptible() {},
  });
  if (done) result = (await done).ok ? "answered" : `failed`;
  outcomes.push({ name, from: agentName(event.pubkey) === event.pubkey.slice(0, 6) && event.pubkey === owner.pk ? "owner" : agentName(event.pubkey), result });
  return result;
}

const A = await makeAgent("Copywriter", first);
const B = await makeAgent("Reviewer", second);
let fails = 0;
const check = (label, ok) => {
  if (!ok) fails++;
  console.log(ok ? "ok  " : "FAIL", label);
};

// 1) Forged and foreign handoffs are ignored (no Hermes turn).
const forged = store({ kind: 9, pubkey: stranger.pk, content: "@Reviewer do it", tags: [["h", "chan1"], ["p", B.pubkey], await authTag(stranger.pk, stranger)] });
forged.tags[2][1] = owner.pk; // claims the owner without the owner's signature
check("forged owner claim is ignored", (await deliver(agents[B.pubkey], forged)) === "ignored");
const foreign = store({ kind: 9, pubkey: stranger.pk, content: "@Reviewer do it", tags: [["h", "chan1"], ["p", B.pubkey]] });
check("another member's mention is ignored", (await deliver(agents[B.pubkey], foreign)) === "ignored");

// 2) The real chain: the owner tags only Copywriter. (SKIP_CHAIN=1 skips it.)
if (!process.env.SKIP_CHAIN) {
const t0 = Date.now();
const start = store({
  kind: 9,
  pubkey: owner.pk,
  content:
    "[@Copywriter](nostr:npub1x) Write one 5-word headline for a cold brew coffee brand. Then hand it to @Reviewer, who rates it 1 to 10 in one line. Order: Copywriter, then Reviewer. Reviewer is last.",
  tags: [["h", "chan1"], ["p", A.pubkey]],
});
runs.push(deliver(agents[A.pubkey], start));
while (runs.length) await runs.shift();
console.log(`chain took ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(outcomes);
const posts = events.filter((e) => e.kind === 9 && agents[e.pubkey]);
const aPost = posts.find((e) => e.pubkey === A.pubkey);
const bPost = posts.find((e) => e.pubkey === B.pubkey);
check("Copywriter answered", !!aPost);
check("Copywriter's reply tags Reviewer", !!aPost?.tags.some((t) => t[0] === "p" && t[1] === B.pubkey));
check("Copywriter's reply links the mention", /\[@Reviewer\]\(nostr:npub1[02-9ac-hj-np-z]{58}\)/.test(aPost?.content ?? ""));
check("Reviewer answered after Copywriter", !!bPost && bPost.created_at > aPost.created_at);
check("Reviewer, last, tagged nobody", !!bPost && !bPost.tags.some((t) => t[0] === "p"));
check("in the same thread", [aPost, bPost].every((e) => e?.tags.some((t) => t[0] === "e" && t[1] === start.id)));
}

// 3) Loop cap: two agents that keep tagging each other stop after the cap,
// and the owner speaking again resets it. (A missing profile fails fast.)
const C = await makeAgent("Looper", "no-such-profile");
const capRoot = store({ kind: 9, pubkey: owner.pk, content: "loop test", tags: [["h", "chan1"]] });
const sibling = async () =>
  store({ kind: 9, pubkey: A.pubkey, content: "@Looper again", tags: [["h", "chan1"], ["e", capRoot.id, "", "reply"], ["p", C.pubkey], await authTag(A.pubkey)] });
const results = [];
for (let i = 0; i < 10; i++) results.push(await deliver(agents[C.pubkey], await sibling()));
check("handoffs stop after 8 in a row", results.slice(0, 8).every((r) => r !== "ignored") && results.slice(8).every((r) => r === "ignored"));
const ownerAgain = store({ kind: 9, pubkey: owner.pk, content: "@Looper go", tags: [["h", "chan1"], ["e", capRoot.id, "", "reply"], ["p", C.pubkey]] });
await deliver(agents[C.pubkey], ownerAgain);
check("the owner speaking resets the cap", (await deliver(agents[C.pubkey], await sibling())) !== "ignored");

for (const f of effects) f?.();
console.log(fails ? `${fails} FAILED` : "all passed");
setTimeout(() => process.exit(fails ? 1 : 0), 300);
