import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
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

// /proc/self/stat field 22 (starttime), same value the sweep compares against.
function selfStartTime() {
  const stat = fs.readFileSync("/proc/self/stat", "utf8");
  return Number(stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/)[19]);
}

// Tracks fake Chromes so a failed assertion can never leak one past the suite.
const fakeChromes = [];

// A stand-in for Chrome's MAIN browser process: no --type= argument and a
// --user-data-dir=<tmpdir>/od-web-clone-browser-* argument, launched detached
// so it leads its own process group exactly like the real launcher does.
function spawnFakeCloneChrome(profileDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webclone-cleanup-test-"));
  const script = path.join(dir, "fake-chrome.mjs");
  fs.writeFileSync(script, "setTimeout(() => {}, 120000);\n");
  const child = spawn(process.execPath, [script, `--user-data-dir=${profileDir}`], {
    stdio: "ignore",
    detached: true,
  });
  fakeChromes.push(child);
  return child;
}

const executable = findSystemChromiumExecutable();
const describeWithChrome = executable ? describe : describe.skip;

afterAll(async () => {
  for (const fake of fakeChromes) {
    try {
      process.kill(-fake.pid, "SIGKILL");
    } catch {
      try {
        fake.kill("SIGKILL");
      } catch {}
    }
  }
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

  // Chrome startup under a full-suite load can exceed the default timeout;
  // give this case room instead of racing it (was flaky at ~32 s).
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
  }, 60_000);

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

  it("a live clone with a real Chrome survives a second launch's sweep", async () => {
    const first = await systemChromium.launch({ executablePath: executable });
    // Launching a second clone sweeps leftovers first; the first clone's
    // launcher (this test process) is alive, so its Chrome must survive.
    const second = await systemChromium.launch({ executablePath: executable });
    expect(processAlive(first.child.pid), "a live clone's Chrome must survive another launch").toBe(true);
    expect(fs.existsSync(first.profileDir)).toBe(true);
    await first.close();
    await second.close();
    await waitForMarkerProcessesGone();
  }, 60_000);
});

describe("sweepOrphanedBrowsers", () => {
  it("kills a clone Chrome whose launcher died and spares one whose launcher lives", async () => {
    // Dead launcher: a short-lived process whose pid is gone by sweep time.
    const dead = spawn(process.execPath, ["--version"], { stdio: "ignore" });
    const deadPid = dead.pid;
    await new Promise((resolve) => dead.once("exit", resolve));

    const orphanProfile = fs.mkdtempSync(path.join(os.tmpdir(), `${MARKER}-`));
    fs.writeFileSync(
      path.join(orphanProfile, "launcher.json"),
      JSON.stringify({ pid: deadPid, startTime: 1 }),
    );
    const orphan = spawnFakeCloneChrome(orphanProfile);

    // Live clone: launcher.json points at this still-running test process.
    const liveProfile = fs.mkdtempSync(path.join(os.tmpdir(), `${MARKER}-`));
    fs.writeFileSync(
      path.join(liveProfile, "launcher.json"),
      JSON.stringify({ pid: process.pid, startTime: selfStartTime() }),
    );
    const live = spawnFakeCloneChrome(liveProfile);
    expect(await waitFor(() => processAlive(orphan.pid) && processAlive(live.pid))).toBe(true);

    const killed = sweepOrphanedBrowsers();
    expect(killed, "sweep should kill the Chrome whose launcher died").toContain(orphan.pid);
    expect(killed, "sweep must spare a Chrome whose launcher is alive").not.toContain(live.pid);
    expect(await waitFor(() => !processAlive(orphan.pid))).toBe(true);
    expect(fs.existsSync(orphanProfile), "the sweep removes the orphan's profile folder").toBe(false);
    expect(processAlive(live.pid), "a Chrome whose launcher lives must survive").toBe(true);
    live.kill("SIGKILL");
    await waitFor(() => !processAlive(live.pid));
    fs.rmSync(liveProfile, { recursive: true, force: true });
  });

  it("spares a non-Chrome process that mentions the marker", async () => {
    // The reviewer's blocker: a command line that merely contains the marker
    // (shells, grep, watchers) must survive the sweep untouched. tail -F keeps
    // running with the marker in its argv even though the file never appears.
    const decoy = spawn("tail", ["-F", `/tmp/${MARKER}-decoy`], { stdio: "ignore" });
    const killed = sweepOrphanedBrowsers();
    expect(killed).not.toContain(decoy.pid);
    expect(processAlive(decoy.pid), "a non-Chrome marker process must survive").toBe(true);
    decoy.kill("SIGKILL");
    await waitFor(() => !processAlive(decoy.pid));
  });
});
