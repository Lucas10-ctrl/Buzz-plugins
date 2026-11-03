// Opt-in build acceptance in a clean copy with no CopyOS checkout or inherited dependencies.
import { execFileSync, spawnSync } from "node:child_process";
import { constants } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "buzz-editor-bootstrap-"));
const checkout = join(root, "buzz");
const logs = join(root, "logs");
await mkdir(checkout);
await mkdir(logs);
const files = execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  { cwd: source },
)
  .toString()
  .split("\0")
  .filter(Boolean);
for (const file of files) {
  if (
    file.split("/").includes("node_modules") ||
    (file.startsWith(".env") && file !== ".env.example")
  )
    continue;
  await mkdir(dirname(join(checkout, file)), { recursive: true });
  await cp(join(source, file), join(checkout, file), {
    mode: constants.COPYFILE_FICLONE,
  });
}
function run(label, command, args, expected = 0) {
  const result = spawnSync(command, args, {
    cwd: checkout,
    encoding: "utf8",
    maxBuffer: 32_000_000,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return writeFile(join(logs, `${label}.log`), output).then(() => {
    if (result.status !== expected)
      throw new Error(
        `${label} exited ${result.status}; see ${join(logs, `${label}.log`)}`,
      );
    process.stdout.write(`${label}: passed\n`);
    return output;
  });
}
try {
  const pnpm = join(
    checkout,
    "bin",
    process.platform === "win32" ? "pnpm.exe" : "pnpm",
  );
  await run("root-frozen-install", pnpm, ["install", "--frozen-lockfile"]);
  await run("editor-build", pnpm, ["editors:build"]);
  await run("frontend-types", pnpm, ["typecheck"]);
  await run("frontend-build", pnpm, ["exec", "vite", "build"]);
  await run("worker-artifact", pnpm, [
    "exec",
    "vitest",
    "run",
    "browser-host/editor-port/desktop-artifact.test.mjs",
  ]);
  const audit = ["scripts/audit-editor-source.mjs"];
  const retained = join(
    checkout,
    "portable/libraries/dsh-util-crypto/lib/index.js",
  );
  const bytes = await readFile(retained);
  try {
    await writeFile(
      retained,
      Buffer.concat([
        bytes,
        Buffer.from("\n// altered verification fixture\n"),
      ]),
    );
    const output = await run(
      "reject-changed-library",
      process.execPath,
      audit,
      1,
    );
    if (!output.includes("Retained editor library changed"))
      throw new Error("Audit did not identify the altered library");
  } finally {
    await writeFile(retained, bytes);
  }
  const modules = join(checkout, "portable/copyos-apps/node_modules"),
    saved = `${modules}.verification`;
  await rename(modules, saved);
  try {
    await symlink(
      join(source, "portable/copyos-apps/node_modules"),
      modules,
      process.platform === "win32" ? "junction" : "dir",
    );
    const output = await run(
      "reject-external-dependencies",
      process.execPath,
      audit,
      1,
    );
    if (!output.includes("Editor dependencies leave the Buzz checkout"))
      throw new Error("Audit did not identify external dependencies");
  } finally {
    await rm(modules);
    await rename(saved, modules);
  }
  await run("restored-source-audit", process.execPath, audit);
  const report = {
    sourceFiles: files.length,
    independentCheckout: true,
    frozenInstall: true,
    workerArtifactSuite: "browser-host/editor-port/desktop-artifact.test.mjs",
    rejectedChangedLibrary: true,
    rejectedExternalDependencies: true,
    platform: process.platform,
    arch: process.arch,
    logs,
  };
  await writeFile(
    join(root, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(
    `Independent editor bootstrap evidence: ${join(root, "report.json")}\n`,
  );
} finally {
  // This directory contains only the disposable verification copy created above.
  await rm(checkout, { recursive: true, force: true });
}
