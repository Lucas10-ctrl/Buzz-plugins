import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  sweepOrphanedBrowsers,
  systemChromium,
} from "../../portable/page-workflows/copyos-web-clone/scripts/lib/system-browser.mjs";
import { findSystemChromiumExecutable } from "../../portable/page-workflows/copyos-web-clone/scripts/lib/playwright-loader.mjs";

const MARKER = "od-web-clone-browser";
const LIB_PATH = new URL(
  "../../portable/page-workflows/copyos-web-clone/scripts/lib/system-browser.mjs",
  import.meta.url,
).pathname;

function markerProcesses() {
  try {
    const out = execFileSync("pgrep", ["-f", MARKER], { encoding: "utf8" });
    return out.split("\n").map(Number).filter(Boolean);
  } catch (error) {
    // pgrep exits 1 when nothing matches.
    if (error.status === 1) return [];
    throw error;
  }
}

async function waitForMarkerProcessesGone(timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (markerProcesses().length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(markerProcesses(), "no od-web-clone-browser processes should remain").toEqual([]);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

// Runs a child node script and resolves once it prints "READY <chromePid> <profileDir>".
function runHelperScript(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webclone-cleanup-test-"));
  const script = path.join(dir, "helper.mjs");
  fs.writeFileSync(script, `import { systemChromium } from ${JSON.stringify(LIB_PATH)};\n${body}`);
  const executablePath = findSystemChromiumExecutable();
  const child = spawn(process.execPath, [script, executablePath], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const match = stdout.match(/READY (\d+) (\S+)/);
      if (match) resolve({ pid: Number(match[1]), profileDir: match[2] });
    });
    child.stderr.on("data", () => {});
    child.once("exit", (code) => {
      const match = stdout.match(/READY (\d+) (\S+)/);
      if (match) resolve({ pid: Number(match[1]), profileDir: match[2] });
      else reject(new Error(`helper exited (code ${code}) before READY:\n${stdout}`));
    });
  });
  return { child, ready };
}

const executable = findSystemChromiumExecutable();
const describeWithChrome = executable ? describe : describe.skip;

afterAll(() => {
  // Never leave a marker process behind, even if a test failed midway.
  sweepOrphanedBrowsers();
});

describeWithChrome("web-clone browser cleanup", () => {
  it("clean close kills Chrome and removes the temp profile", async () => {
    const browser = await systemChromium.launch({ executablePath: executable });
    const profileDir = browser.profileDir;
    expect(fs.existsSync(profileDir)).toBe(true);
    await browser.close();
    await waitForMarkerProcessesGone();
    await waitFor(() => !fs.existsSync(profileDir));
    expect(fs.existsSync(profileDir)).toBe(false);
  });

  it("a script that throws midway leaves no Chrome behind", async () => {
    const { child, ready } = runHelperScript(`
const browser = await systemChromium.launch({ executablePath: process.argv[2] });
console.log(\`READY \${browser.child.pid} \${browser.profileDir}\`);
throw new Error("boom midway");
`);
    const { pid, profileDir } = await ready;
    expect(processAlive(pid)).toBe(true);
    const code = await new Promise((resolve) => child.once("exit", resolve));
    expect(code).not.toBe(0);
    await waitForMarkerProcessesGone();
    await waitFor(() => !fs.existsSync(profileDir));
    expect(fs.existsSync(profileDir)).toBe(false);
  });

  it("SIGINT kills the Chrome group before the script dies", async () => {
    const { child, ready } = runHelperScript(`
const browser = await systemChromium.launch({ executablePath: process.argv[2] });
console.log(\`READY \${browser.child.pid} \${browser.profileDir}\`);
await new Promise(() => {});
`);
    const { pid, profileDir } = await ready;
    child.kill("SIGINT");
    await new Promise((resolve) => child.once("exit", resolve));
    await waitForMarkerProcessesGone();
    await waitFor(() => !fs.existsSync(profileDir));
    expect(fs.existsSync(profileDir)).toBe(false);
  });
});

describe("sweepOrphanedBrowsers", () => {
  it("kills marker processes whose launcher died and spares live ones", async () => {
    // A direct child of this test process has a live, plausible launcher: it
    // must survive the sweep. The marker lives inside the -e code because node
    // rejects unknown CLI options.
    const alive = spawn(process.execPath, ["-e", `globalThis.m="${MARKER}-alive";setTimeout(() => {}, 120000)`], {
      stdio: "ignore",
    });
    // The helper shell backgrounds the marker process and exits, so the marker
    // process is reparented (to init or a subreaper) exactly like a Chrome
    // whose launching script died.
    const orphanShell = spawn(
      "sh",
      ["-c", `node -e 'globalThis.m="${MARKER}-orphan";setTimeout(() => {}, 120000)' & echo $!`],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    orphanShell.stdout.on("data", (chunk) => { out += String(chunk); });
    const orphanPid = await new Promise((resolve) => orphanShell.once("exit", () => resolve(Number(out.trim()))));
    expect(orphanPid).toBeGreaterThan(0);
    const reparented = () => {
      try {
        return processAlive(orphanPid) && Number(fs.readFileSync(`/proc/${orphanPid}/stat`, "utf8").split(/\s+/)[3]) !== orphanShell.pid;
      } catch {
        return false;
      }
    };
    expect(await waitFor(reparented)).toBe(true);

    const killed = sweepOrphanedBrowsers();
    expect(killed, "sweep should kill the reparented marker process").toContain(orphanPid);
    expect(await waitFor(() => !processAlive(orphanPid))).toBe(true);
    expect(sweepOrphanedBrowsers().filter((pid) => pid === alive.pid)).toEqual([]);
    expect(processAlive(alive.pid)).toBe(true);
    alive.kill("SIGKILL");
    await waitFor(() => !processAlive(alive.pid));
  });
});
