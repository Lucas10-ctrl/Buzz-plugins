import { spawn } from "node:child_process";
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

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// /proc/<pid>/stat field 22 (starttime), same value the sweep compares against.
function procStartTime(pid) {
  try {
    const stat = fs.readFileSync(path.join("/proc", String(pid), "stat"), "utf8");
    return Number(stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/)[19]) || null;
  } catch {
    return null;
  }
}

// Live (non-zombie) processes whose process group (stat field 5) is pgid.
// Leftover checks are scoped to each test's own process groups and profile
// folders — never a machine-wide pgrep another clone could trip over.
function groupMembers(pgid) {
  const members = [];
  let names;
  try {
    names = fs.readdirSync("/proc");
  } catch {
    return members;
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = fs.readFileSync(path.join("/proc", name, "stat"), "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
      if (fields[0] !== "Z" && Number(fields[2]) === pgid) members.push(Number(name));
    } catch {
      // The process vanished mid-scan.
    }
  }
  return members;
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

// Scoped leftover check for one launch: its Chrome group is empty and its
// temp profile folder is gone.
async function expectChromeGone(chromePid, profileDir) {
  const gone = await waitFor(() => groupMembers(chromePid).length === 0);
  expect(gone, `chrome group ${chromePid} should be gone`).toBe(true);
  if (profileDir) {
    const removed = await waitFor(() => !fs.existsSync(profileDir));
    expect(removed, `profile ${profileDir} should be removed`).toBe(true);
  }
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

function writeLauncherRecord(profileDir, record) {
  fs.writeFileSync(path.join(profileDir, "launcher.json"), JSON.stringify(record));
}

// Tracks fake Chromes so a failed assertion can never leak one past the suite.
const fakeChromes = [];

// A stand-in for Chrome's MAIN browser process, launched detached so it leads
// its own process group exactly like the real launcher does. The sweep only
// knows about it through launcher.json (chromePid + chromeStartTime), never
// through its command line.
function spawnFakeCloneChrome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webclone-cleanup-test-"));
  const script = path.join(dir, "fake-chrome.mjs");
  fs.writeFileSync(script, "setTimeout(() => {}, 120000);\n");
  const child = spawn(process.execPath, [script], { stdio: "ignore", detached: true });
  child.unref();
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
  // Never leave an orphan behind, even if a test failed midway.
  // Note: this sweeps the REAL os.tmpdir(), so it also SIGKILLs any genuinely
  // orphaned clone Chrome left on the machine by earlier dead runs. That is
  // the sweep's intended behaviour, not a test side effect to be surprised
  // by — a live clone's own folder is never touched (launcher still alive).
  sweepOrphanedBrowsers();
});

describeWithChrome("web-clone browser cleanup", () => {
  it("clean close kills Chrome and removes the temp profile", async () => {
    const browser = await systemChromium.launch({ executablePath: executable });
    const profileDir = browser.profileDir;
    expect(fs.existsSync(profileDir)).toBe(true);
    const chromePid = browser.child.pid;
    await browser.close();
    await expectChromeGone(chromePid, profileDir);
  }, 60_000);

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
    await expectChromeGone(pid, profileDir);
  }, 60_000);

  it("SIGINT kills the Chrome group before the script dies", async () => {
    const { child, ready } = runHelperScript(`
const browser = await systemChromium.launch({ executablePath: process.argv[2] });
console.log(\`READY \${browser.child.pid} \${browser.profileDir}\`);
setInterval(() => {}, 1_000); // keep the script alive on its own handle
`);
    const { pid, profileDir } = await ready;
    child.kill("SIGINT");
    await new Promise((resolve) => child.once("exit", resolve));
    await expectChromeGone(pid, profileDir);
  }, 60_000);

  it("SIGHUP (terminal closed, ssh dropped) kills the Chrome group", async () => {
    const { child, ready } = runHelperScript(`
const browser = await systemChromium.launch({ executablePath: process.argv[2] });
console.log(\`READY \${browser.child.pid} \${browser.profileDir}\`);
setInterval(() => {}, 1_000); // keep the script alive on its own handle
`);
    const { pid, profileDir } = await ready;
    child.kill("SIGHUP");
    await new Promise((resolve) => child.once("exit", resolve));
    await expectChromeGone(pid, profileDir);
  }, 60_000);

  it("a caller with only a SIGTERM handler still dies on SIGINT", async () => {
    // The caller's SIGTERM handler must not swallow SIGINT: our handler
    // re-raises the signal that was actually received when nothing else
    // handles it, so Ctrl-C still stops the script and kills Chrome.
    const { child, ready } = runHelperScript(`
process.on("SIGTERM", () => { process.exit(7); });
const browser = await systemChromium.launch({ executablePath: process.argv[2] });
console.log(\`READY \${browser.child.pid} \${browser.profileDir}\`);
setInterval(() => {}, 1_000); // keep the script alive on its own handle
`);
    const { pid, profileDir } = await ready;
    child.kill("SIGINT");
    const [code, signal] = await new Promise((resolve) =>
      child.once("exit", (c, s) => resolve([c, s])),
    );
    expect(code === null && signal === "SIGINT", `helper should die by SIGINT (code ${code} signal ${signal})`).toBe(true);
    await expectChromeGone(pid, profileDir);
  }, 60_000);

  it("a script that launches but never opens a page or calls close() exits and leaves nothing behind", async () => {
    // What child.unref() guarantees: with NO page open, the spawned Chrome
    // cannot hold the script open — falling off the end exits 0, and the
    // 'exit' handler kills the group and removes the profile. Once a page IS
    // open its CDP WebSocket keeps the event loop alive, so such a script
    // hangs until it is signalled — see the SIGHUP test below. Every current
    // caller launches inside try/finally, so close() always runs.
    const { child, ready } = runHelperScript(`
const browser = await systemChromium.launch({ executablePath: process.argv[2] });
console.log(\`READY \${browser.child.pid} \${browser.profileDir}\`);
`);
    const { pid, profileDir } = await ready;
    const code = await new Promise((resolve) => child.once("exit", resolve));
    expect(code, "script must exit on its own without close()").toBe(0);
    await expectChromeGone(pid, profileDir);
  }, 60_000);

  it("SIGHUP cleans up a script that opened a page and never called close()", async () => {
    // The "forgot close()" case with a real page: the page's CDP WebSocket
    // keeps the script running (it hangs), so cleanup cannot rely on exit —
    // but a terminal close / dropped ssh must still take Chrome with it.
    const { child, ready } = runHelperScript(`
const browser = await systemChromium.launch({ executablePath: process.argv[2] });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto("about:blank");
console.log(\`READY \${browser.child.pid} \${browser.profileDir}\`);
setInterval(() => {}, 1_000); // the script keeps running; it never calls close()
`);
    const { pid, profileDir } = await ready;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(child.exitCode, "a script holding an open page without close() stays running").toBe(null);
    child.kill("SIGHUP");
    await new Promise((resolve) => child.once("exit", resolve));
    await expectChromeGone(pid, profileDir);
  }, 60_000);

  it("a live clone with a real Chrome survives a second launch's sweep", async () => {
    const first = await systemChromium.launch({ executablePath: executable });
    // Launching a second clone sweeps leftovers first; the first clone's
    // launcher (this test process) is alive, so its Chrome must survive.
    const second = await systemChromium.launch({ executablePath: executable });
    expect(processAlive(first.child.pid), "a live clone's Chrome must survive another launch").toBe(true);
    expect(fs.existsSync(first.profileDir)).toBe(true);
    await first.close();
    await second.close();
    await expectChromeGone(first.child.pid, first.profileDir);
    await expectChromeGone(second.child.pid, second.profileDir);
  }, 60_000);

  it("an orphaned real Chrome is swept after its launcher is SIGKILLed", async () => {
    // The reviewer's finding A: a launcher killed by OOM / kill -9 / a closed
    // terminal must not leave Chrome behind forever. The next sweep kills the
    // recorded Chrome group and removes the profile.
    const { child, ready } = runHelperScript(`
const browser = await systemChromium.launch({ executablePath: process.argv[2] });
console.log(\`READY \${browser.child.pid} \${browser.profileDir}\`);
setInterval(() => {}, 1_000); // keep the script alive on its own handle
`);
    const { pid, profileDir } = await ready;
    expect(groupMembers(pid).length, "the real Chrome group is running before the kill").toBeGreaterThan(1);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    const killed = sweepOrphanedBrowsers();
    expect(killed, "the sweep must kill the orphaned Chrome").toContain(pid);
    await expectChromeGone(pid, profileDir);
  }, 60_000);
});

describe("sweepOrphanedBrowsers", () => {
  it("kills a clone Chrome whose launcher died and spares one whose launcher lives", async () => {
    // Dead launcher: a short-lived process whose pid is gone by sweep time.
    const dead = spawn(process.execPath, ["--version"], { stdio: "ignore" });
    const deadPid = dead.pid;
    await new Promise((resolve) => dead.once("exit", resolve));

    const orphanProfile = fs.mkdtempSync(path.join(os.tmpdir(), `${MARKER}-`));
    const orphan = spawnFakeCloneChrome();
    writeLauncherRecord(orphanProfile, {
      pid: deadPid,
      startTime: 1,
      chromePid: orphan.pid,
      chromeStartTime: procStartTime(orphan.pid),
    });

    // Live clone: launcher.json points at this still-running test process.
    const liveProfile = fs.mkdtempSync(path.join(os.tmpdir(), `${MARKER}-`));
    const live = spawnFakeCloneChrome();
    writeLauncherRecord(liveProfile, {
      pid: process.pid,
      startTime: procStartTime(process.pid),
      chromePid: live.pid,
      chromeStartTime: procStartTime(live.pid),
    });
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

  it("removes a stale profile folder whose Chrome is already gone", async () => {
    const dead = spawn(process.execPath, ["--version"], { stdio: "ignore" });
    const deadPid = dead.pid;
    await new Promise((resolve) => dead.once("exit", resolve));
    const staleProfile = fs.mkdtempSync(path.join(os.tmpdir(), `${MARKER}-`));
    writeLauncherRecord(staleProfile, {
      pid: deadPid,
      startTime: 1,
      chromePid: deadPid,
      chromeStartTime: 1,
    });
    const killed = sweepOrphanedBrowsers();
    expect(killed).not.toContain(deadPid);
    expect(fs.existsSync(staleProfile), "a stale profile is removed").toBe(false);
  });

  it("leaves a live launcher's folder alone when its record has no usable start time", () => {
    // Finding A: a null (or missing/non-numeric) startTime proves nothing.
    // Treating it as "launcher gone" would delete a live clone's profile on
    // any host where processStartTime() can't answer — on macOS, without
    // /proc, every pid would look dead. The sweep must leave the folder be.
    const liveProfile = fs.mkdtempSync(path.join(os.tmpdir(), `${MARKER}-`));
    writeLauncherRecord(liveProfile, { pid: process.pid, startTime: null });
    sweepOrphanedBrowsers();
    expect(
      fs.existsSync(liveProfile),
      "a live launcher's folder with startTime null must survive the sweep",
    ).toBe(true);
    fs.rmSync(liveProfile, { recursive: true, force: true });
  });

  it("spares a non-Chrome process that mentions the marker", async () => {
    // A command line that merely contains the marker (shells, grep, watchers)
    // must survive the sweep untouched — the sweep never reads command lines.
    const decoy = spawn("tail", ["-F", `/tmp/${MARKER}-decoy`], { stdio: "ignore" });
    const killed = sweepOrphanedBrowsers();
    expect(killed).not.toContain(decoy.pid);
    expect(processAlive(decoy.pid), "a non-Chrome marker process must survive").toBe(true);
    decoy.kill("SIGKILL");
    await waitFor(() => !processAlive(decoy.pid));
  });

  it("spares a non-Chrome group leader even when a marker folder holds a dead launcher record", async () => {
    // The reviewer's adversarial case: a /bin/sh leading its own group, with
    // the marker profile path in its argv and a launcher.json pointing at a
    // dead pid. The sweep only kills pids recorded as chromePid in a
    // launcher.json, and this sh was never launched by us — it must survive.
    const dead = spawn(process.execPath, ["--version"], { stdio: "ignore" });
    const deadPid = dead.pid;
    await new Promise((resolve) => dead.once("exit", resolve));
    const advProfile = fs.mkdtempSync(path.join(os.tmpdir(), `${MARKER}-adv-`));
    writeLauncherRecord(advProfile, { pid: deadPid, startTime: 1 });
    const sh = spawn("/bin/sh", ["-c", "sleep 60", `--user-data-dir=${advProfile}`], {
      stdio: "ignore",
      detached: true,
    });
    sh.unref();
    expect(await waitFor(() => processAlive(sh.pid))).toBe(true);
    const killed = sweepOrphanedBrowsers();
    expect(killed, "the sweep kills only recorded Chrome pids").not.toContain(sh.pid);
    expect(processAlive(sh.pid), "the non-Chrome group leader must survive").toBe(true);
    expect(fs.existsSync(advProfile), "the dead-launcher folder is still removed as stale").toBe(false);
    try {
      process.kill(-sh.pid, "SIGKILL");
    } catch {}
    await waitFor(() => !processAlive(sh.pid));
  });
});
