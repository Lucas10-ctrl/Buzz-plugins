// Stage an offline desktop worker from the exact installed dependency graph; no registry install runs in the shipped app.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
  copyFile,
  chmod,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";
import { parseSync, Visitor } from "rolldown/utils";
import { rolldown } from "rolldown";
import { create } from "tar";

const root = fileURLToPath(new URL("../", import.meta.url));
const host = join(root, "portable/editor-host");
// This command replaces only its owned build output, never a caller-selected directory.
if (process.argv.length > 2)
  throw new Error("build-editor-host does not accept an output directory");
const destination = resolve(host, "runtime");
const resources = join(root, "src-tauri/resources/bin");
const nodeBinary = join(
  resources,
  process.platform === "win32" ? "buzz-editor-host.exe" : "buzz-editor-host",
);
await rm(join(host, "dist"), { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    join(root, "node_modules/typescript/bin/tsc"),
    "-p",
    join(host, "tsconfig.json"),
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir(dirname(destination), { recursive: true });
const staging = await mkdtemp(join(dirname(destination), ".editor-host-"));
const packages = new Map();
const packageRecords = [];
const seedLinks = new Map();
const nodeHome = dirname(dirname(process.execPath));
const npmCli = [
  join(nodeHome, "lib/node_modules/npm/bin/npm-cli.js"),
  join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
];
let npm;
for (const path of npmCli)
  if (await stat(path).catch(() => null)) {
    npm = path;
    break;
  }

async function locate(name, start) {
  for (let directory = start; ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", name);
    try {
      await stat(join(candidate, "package.json"));
      return await realpath(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (dirname(directory) === directory)
      throw new Error(
        `Missing editor runtime package ${name}, required by ${start}`,
      );
  }
}
const packageName = (name) =>
  name.startsWith("@")
    ? name.split("/").slice(0, 2).join("/")
    : name.split("/")[0];
async function link(path, target) {
  await mkdir(dirname(path), { recursive: true });
  await symlink(
    relative(dirname(path), target),
    path,
    process.platform === "win32" ? "junction" : "dir",
  );
}
async function install(source) {
  if (packages.has(source)) return packages.get(source);
  const manifest = JSON.parse(
    await readFile(join(source, "package.json"), "utf8"),
  );
  const key = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const context = join(
    staging,
    ".deps",
    `${manifest.name.replaceAll("/", "+")}-${manifest.version}-${key}`,
  );
  const target = join(context, "node_modules", manifest.name);
  packages.set(source, target);
  await mkdir(target, { recursive: true });
  if (source.includes(`${sep}node_modules${sep}`)) {
    // Registry package directories already contain published files; rebuild their dependency links below.
    await cp(source, target, {
      recursive: true,
      dereference: true,
      mode: constants.COPYFILE_FICLONE,
      filter: (path) =>
        !relative(source, path)
          .split(sep)
          .some(
            (part) =>
              part === "node_modules" ||
              part === ".git" ||
              part.startsWith(".env"),
          ),
    });
  } else {
    // Workspace dependencies contribute only their declared published files, never repository data or tests.
    if (!npm)
      throw new Error("The pinned Node distribution has no npm file-list tool");
    const packed = spawnSync(
      process.execPath,
      [npm, "pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: source, encoding: "utf8", maxBuffer: 16_000_000 },
    );
    if (packed.status !== 0)
      throw new Error(`Could not enumerate ${manifest.name}: ${packed.stderr}`);
    const list = JSON.parse(packed.stdout)[0].files;
    for (const { path } of list) {
      if (path.startsWith("/") || path.split("/").includes(".."))
        throw new Error("Invalid runtime package path");
      await mkdir(dirname(join(target, path)), { recursive: true });
      await copyFile(
        join(source, path),
        join(target, path),
        constants.COPYFILE_FICLONE,
      );
    }
  }
  const optionalMissing = [];
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  };
  for (const name of Object.keys(dependencies)) {
    let dependency;
    try {
      dependency = await locate(name, source);
    } catch (error) {
      if (
        (manifest.optionalDependencies?.[name] ||
          manifest.peerDependenciesMeta?.[name]?.optional) &&
        error.message.startsWith("Missing editor runtime package")
      ) {
        optionalMissing.push(name);
        continue;
      }
      throw error;
    }
    const dependencyTarget = join(context, "node_modules", name);
    const installed = await install(dependency);
    if (dependencyTarget !== target) await link(dependencyTarget, installed);
  }
  packageRecords.push({
    name: manifest.name,
    version: manifest.version,
    optionalMissing,
  });
  if (packageRecords.length % 25 === 0)
    process.stdout.write(
      `Staged ${packageRecords.length} editor runtime packages\n`,
    );
  return target;
}
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(path);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const source = await readFile(path, "utf8");
    const file = parseSync(path, source);
    if (file.errors.length)
      throw new Error(`Could not parse runtime module ${path}`);
    const imports = new Set();
    const module = (node) => {
      if (node.source && typeof node.source.value === "string")
        imports.add(node.source.value);
    };
    new Visitor({
      ImportDeclaration: module,
      ExportNamedDeclaration: module,
      ExportAllDeclaration: module,
      ImportExpression: (node) => {
        if (typeof node.source.value === "string")
          imports.add(node.source.value);
      },
      CallExpression: (node) => {
        const call = node.callee;
        if (
          node.arguments.length === 1 &&
          typeof node.arguments[0].value === "string" &&
          ((call.type === "Identifier" && call.name === "require") ||
            (call.type === "CallExpression" &&
              call.callee.type === "Identifier" &&
              call.callee.name === "createRequire"))
        )
          imports.add(node.arguments[0].value);
      },
    }).visit(file.program);
    const original = join(
      root,
      "portable",
      relative(join(host, "dist"), path).replace(/\.js$/, ".ts"),
    );
    for (const specifier of imports) {
      if (
        specifier.startsWith(".") ||
        specifier.startsWith("/") ||
        isBuiltin(specifier)
      )
        continue;
      const name = packageName(specifier);
      const source = await locate(name, dirname(original));
      const area = relative(join(host, "dist"), path).split(sep)[0];
      const identity = `${area}/${name}`;
      const existing = seedLinks.get(identity);
      if (existing && existing !== source)
        throw new Error(
          `Editor sources resolve incompatible roots for ${name}`,
        );
      seedLinks.set(identity, source);
    }
  }
}
try {
  await scan(join(host, "dist"));
  await cp(join(host, "dist"), staging, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
  });
  await cp(
    join(root, "portable/copyos-domain/fonts"),
    join(staging, "copyos-domain/fonts"),
    { recursive: true, mode: constants.COPYFILE_FICLONE },
  );
  await cp(
    join(root, "portable/page-workflows"),
    join(staging, "page-workflows"),
    {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
    },
  );
  for (const [identity, source] of seedLinks) {
    const slash = identity.indexOf("/");
    await link(
      join(
        staging,
        identity.slice(0, slash),
        "node_modules",
        identity.slice(slash + 1),
      ),
      await install(source),
    );
  }
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify({ private: true, type: "module" }) + "\n",
  );
  await writeFile(
    join(staging, "runtime.json"),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        node: process.versions.node,
        packages: packageRecords.sort((a, b) => a.name.localeCompare(b.name)),
      },
      null,
      2,
    ) + "\n",
  );
  for (const name of ["LICENSE", "LICENSE.md"]) {
    try {
      await copyFile(join(nodeHome, name), join(staging, "NODE-LICENSE"));
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await copyFile(
    join(root, "portable/COPYOS-LICENSE"),
    join(staging, "COPYOS-LICENSE"),
  );
  await mkdir(resources, { recursive: true });
  const credentialBuild = spawnSync(
    join(root, "bin", process.platform === "win32" ? "cargo.exe" : "cargo"),
    ["build", "--locked", "--release", "-p", "buzz-editor-credentials"],
    { cwd: root, stdio: "inherit" },
  );
  if (credentialBuild.error) throw credentialBuild.error;
  if (credentialBuild.status !== 0)
    throw new Error("Canvas credential helper build failed");
  const credentialName =
    process.platform === "win32"
      ? "buzz-editor-credentials.exe"
      : "buzz-editor-credentials";
  await copyFile(
    join(
      resolve(root, process.env.CARGO_TARGET_DIR ?? "target"),
      "release",
      credentialName,
    ),
    join(resources, credentialName),
  );
  await chmod(join(resources, credentialName), 0o755);
  await create(
    {
      file: join(resources, "editor-host.tgz.new"),
      cwd: staging,
      gzip: true,
      portable: true,
    },
    ["."],
  );
  const bootstrap = await rolldown({
    input: join(host, "bootstrap.mjs"),
    platform: "node",
  });
  try {
    await bootstrap.write({
      file: join(resources, "editor-bootstrap.mjs.new"),
      format: "esm",
    });
  } finally {
    await bootstrap.close();
  }
  await copyFile(
    process.execPath,
    `${nodeBinary}.new`,
    constants.COPYFILE_FICLONE,
  );
  await chmod(`${nodeBinary}.new`, 0o755);
  await rm(destination, { recursive: true, force: true });
  await rename(staging, destination);
  await rename(
    join(resources, "editor-host.tgz.new"),
    join(resources, "editor-host.tgz"),
  );
  await rename(
    join(resources, "editor-bootstrap.mjs.new"),
    join(resources, "editor-bootstrap.mjs"),
  );
  await rename(`${nodeBinary}.new`, nodeBinary);
  // Remove the superseded directory layout from this command's own resource output.
  await rm(join(resources, "editor-host"), { recursive: true, force: true });
  process.stdout.write(
    `Desktop editors staged with Node ${process.versions.node} and ${packages.size} packages at ${destination}\n`,
  );
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}
