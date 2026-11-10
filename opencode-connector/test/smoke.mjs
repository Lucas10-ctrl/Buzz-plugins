// Runs one real turn against OpenCode over ACP, on the chosen model, the way the plugin does.
// Usage: node test/smoke.mjs [model] ["message"]
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { AcpConnection, Turn, setModel } from "../acp.js";

const model = process.argv[2] ?? "lemonade/Qwen3.8-Flash-Next-Halogen";
const message = process.argv[3] ?? "Reply with exactly the word: pong";

const child = spawn("opencode", ["acp"], { cwd: homedir(), stdio: ["pipe", "pipe", "pipe"] });
child.stderr.setEncoding("utf8");
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));

const steps = [];
let turn = new Turn({ onStep: (s) => steps.push(s) });
const acp = new AcpConnection(
  { write: (t) => child.stdin.write(t) },
  { onUpdate: (p) => turn.update(p.update), log: (m) => console.error("[acp]", m) },
);
child.stdout.setEncoding("utf8");
child.stdout.on("data", (d) => acp.feed(d));
child.on("exit", (code) => acp.close(`OpenCode exited (${code})`));

const t0 = Date.now();
const timer = setTimeout(() => {
  console.error("TIMEOUT\n", stderr.slice(-2000));
  child.kill();
  process.exit(2);
}, 240_000);

try {
  const init = await acp.initialize();
  console.log("initialized:", init.agentInfo?.name, init.agentInfo?.version, `${Date.now() - t0}ms`);
  const sessionId = await acp.newSession(homedir());
  await setModel(acp, sessionId, model);
  console.log("session:", sessionId, "model:", model);
  const result = await acp.prompt(sessionId, message);
  console.log("stopReason:", result?.stopReason, `${Date.now() - t0}ms`);
  console.log("steps:", steps);
  console.log("REPLY:", JSON.stringify(turn.text));
  turn = new Turn();
  await acp.prompt(sessionId, "What word did you just reply with? Answer in one word.");
  console.log("REPLY2:", JSON.stringify(turn.text));
} catch (error) {
  console.error("FAILED:", error.message, error.data ?? "", "\n", stderr.slice(-2000));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  child.kill();
}
