// Runs one real turn against a Hermes profile, the way the plugin does.
// Usage: node test/smoke.mjs [profile] ["message"]
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { AcpConnection, Turn } from "../acp.js";

const profile = process.argv[2] ?? "copywriter";
const message = process.argv[3] ?? "Reply with exactly the word: pong";

const child = spawn("hermes", ["-p", profile, "acp"], {
  cwd: homedir(),
  stdio: ["pipe", "pipe", "pipe"],
});
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
child.on("exit", (code) => acp.close(`Hermes exited (${code})`));

const t0 = Date.now();
const timer = setTimeout(() => {
  console.error("TIMEOUT\n", stderr.slice(-2000));
  child.kill();
  process.exit(2);
}, 180_000);

try {
  const init = await acp.initialize();
  console.log("initialized:", init.agentInfo?.name, init.agentInfo?.version, `${Date.now() - t0}ms`);
  const sessionId = await acp.newSession(homedir());
  console.log("session:", sessionId);
  const result = await acp.prompt(sessionId, message);
  console.log("stopReason:", result?.stopReason, `${Date.now() - t0}ms`);
  console.log("steps:", steps);
  console.log("REPLY:", JSON.stringify(turn.text));
  // Second turn in the same session: does it remember?
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
