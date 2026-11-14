// Changesets Plus: built from src/ by `pnpm build`. Do not edit.
// Includes code from block/buzz-app (Apache-2.0) and @noble/curves (MIT).

// src/workspace.ts
var LIVE_CANVAS_BYTES = 256 * 1024;
var LIVE_CANVAS_LIMIT = `${LIVE_CANVAS_BYTES / 1024} KiB`;
var prefix = "<!-- buzz-session-workspace:v1 ";
var end = "<!-- /buzz-session-workspace -->";
function validateWorkspace(value) {
  const folders = [
    ...new Set(value.folders.map((path2) => path2.trim()).filter(Boolean))
  ];
  const path = (value2) => value2.length <= 2048 && [...value2].every((char) => char.charCodeAt(0) >= 32 && char !== "`");
  if (folders.length > 20 || folders.some((folder) => !path(folder)))
    throw new Error(
      "Use up to 20 workspace folders, without control characters or backticks."
    );
  const worktree = value.worktree && {
    location: value.worktree.location.trim(),
    baseBranch: value.worktree.baseBranch.trim()
  };
  if (worktree && (!folders.length || !worktree.location || !path(worktree.location) || !worktree.baseBranch || !path(worktree.baseBranch)))
    throw new Error(
      "Choose a workspace folder, worktree location, and base branch."
    );
  return { folders, ...worktree ? { worktree } : {}, canvas: value.canvas };
}
function workspaceDirectories(content) {
  if (!content.startsWith(prefix)) return [];
  try {
    const { folders, worktree } = parseWorkspace(content);
    return [.../* @__PURE__ */ new Set([...folders, ...worktree ? [worktree.location] : []])];
  } catch {
    return [];
  }
}
function parseWorkspace(content) {
  const lineEnd = content.indexOf(" -->\n");
  const blockEnd = content.indexOf(`
${end}

`, lineEnd);
  if (lineEnd < 0 || blockEnd < 0)
    throw new Error(
      "Workspace metadata is incomplete. Edit the raw Canvas before changing workspace settings."
    );
  let raw;
  try {
    raw = JSON.parse(content.slice(prefix.length, lineEnd));
  } catch {
    throw new Error(
      "Workspace metadata is invalid. Edit the raw Canvas before changing workspace settings."
    );
  }
  if (!raw || typeof raw !== "object" || !("folders" in raw) || !Array.isArray(raw.folders) || raw.folders.some((v) => typeof v !== "string"))
    throw new Error("Invalid workspace folders.");
  const worktree = "worktree" in raw ? raw.worktree : void 0;
  if (worktree !== void 0 && (!worktree || typeof worktree !== "object" || !("location" in worktree) || typeof worktree.location !== "string" || !("baseBranch" in worktree) || typeof worktree.baseBranch !== "string"))
    throw new Error("Invalid worktree settings.");
  return validateWorkspace({
    folders: raw.folders,
    ...worktree ? { worktree } : {},
    canvas: content.slice(blockEnd + end.length + 3)
  });
}

// src/paths.ts
var MAX_FOLDERS = 20;
var ABSOLUTE = /^(?:\/|~(?:[\\/]|$)|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/])/;
var PARENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
function projectFolders(canvas) {
  return workspaceDirectories(canvas ?? "").filter(
    (folder) => ABSOLUTE.test(folder) && !PARENT.test(folder) && !folder.includes("\0")
  ).slice(0, MAX_FOLDERS);
}
function gitDirectory(folder) {
  const home = /^~(?:[\\/](.*))?$/.exec(folder);
  return home ? home[1] || "." : folder;
}
var baseName = (path) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

// src/git.ts
var INDEX = "lucas.changesets-plus.index";
var SCAN_INDEX = "lucas.changesets-plus.scan";
var MAX_FILES = 1e3;
var MAX_FILE_BYTES = 5 << 20;
var MAX_PATCH_CHARS = 1e5;
var MAX_LIST_BYTES = 16 << 20;
var SAFE = [
  "--no-pager",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotepath=false"
];
var TREE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
var Unreadable = class extends Error {
};
function createGit(spawn) {
  return async (args, { env, input, limit = 1 << 20, timeout = 3e4 } = {}) => {
    const out = [];
    const err = [];
    let size = 0;
    let stopped;
    let running;
    const stop = (why) => {
      stopped ??= why;
      void running?.kill();
    };
    const child = await spawn("git", {
      args: [...SAFE, ...args],
      cwd: "~",
      env: {
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
        ...env
      },
      onStdout(data) {
        size += data.length;
        if (size > limit) stop("big");
        else out.push(data);
      },
      onStderr: (data) => void (err.length < 64 && err.push(data))
    });
    running = child;
    if (stopped) void child.kill();
    const timer = setTimeout(() => stop("slow"), timeout);
    await child.end(input).catch(() => {
    });
    const code = await child.exited.finally(() => clearTimeout(timer));
    if (stopped === "big")
      throw new Unreadable("This is too big to show here.");
    if (stopped === "slow") throw new Error("git took too long.");
    if (code !== 0)
      throw new Error(
        err.join("").trim().split("\n")[0] || `git exited with ${code}.`
      );
    return out.join("");
  };
}
async function checkoutsOf(git, folder) {
  const [top, prefix2 = ""] = (await git([
    "-C",
    gitDirectory(folder),
    "rev-parse",
    "--show-toplevel",
    "--show-prefix"
  ])).split("\n");
  if (!top) return [];
  const listing = await git([
    "-C",
    top,
    "worktree",
    "list",
    "--porcelain"
  ]).catch(() => `worktree ${top}
`);
  const checkouts = [];
  for (const block of listing.split("\n\n")) {
    const dir = /^worktree (.+)$/m.exec(block)?.[1];
    if (!dir || /^bare$/m.test(block) || /^prunable/m.test(block)) continue;
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
    const name = baseName(dir);
    checkouts.push({
      dir,
      prefix: prefix2,
      label: branch ? `${name} (${branch})` : name
    });
  }
  if (!checkouts.length)
    checkouts.push({ dir: top, prefix: prefix2, label: baseName(top) });
  return nest(checkouts);
}
function nest(checkouts) {
  for (const checkout of checkouts) {
    const inside = checkouts.filter(
      (other) => other.dir.startsWith(`${checkout.dir}/`)
    );
    if (inside.length)
      checkout.skip = inside.map(
        (other) => other.dir.slice(checkout.dir.length + 1)
      );
  }
  return checkouts;
}
async function startingTree(git, dir) {
  const log = await git(["-C", dir, "reflog", "show", "--format=%H", "HEAD"]);
  const first = log.trim().split("\n").at(-1) ?? "";
  if (!TREE.test(first)) return void 0;
  const tree = (await git(["-C", dir, "rev-parse", `${first}^{tree}`])).trim();
  return TREE.test(tree) ? tree : void 0;
}
var scopeOf = ({ prefix: prefix2, skip = [] }) => [
  `:(top,literal)${prefix2}`,
  ...skip.map((path) => `:(top,literal,exclude)${path}`)
];
var split0 = (text) => text.split("\0").filter(Boolean);
var queues = /* @__PURE__ */ new Map();
var seeded = /* @__PURE__ */ new Set();
function snapshot(git, checkout) {
  const run = (queues.get(checkout.dir) ?? Promise.resolve()).then(
    () => take(git, checkout)
  );
  queues.set(
    checkout.dir,
    run.catch(() => {
    })
  );
  return run;
}
async function take(git, checkout) {
  const at = ["-C", checkout.dir];
  const gitDir = (await git([...at, "rev-parse", "--absolute-git-dir"])).trim();
  const env = { GIT_INDEX_FILE: `${gitDir}/${INDEX}` };
  if (!seeded.has(gitDir)) {
    const head = (await git([...at, "rev-parse", "--verify", "-q", "HEAD^{tree}"]).catch(
      () => ""
    )).trim();
    if (head) await git([...at, "read-tree", "-m", head], { env });
    seeded.add(gitDir);
  }
  await reconcileIgnored(git, at, gitDir, env);
  const changed = split0(
    await git(
      [
        ...at,
        "ls-files",
        "-z",
        "--others",
        "--modified",
        "--exclude-standard",
        "--",
        ...scopeOf(checkout)
      ],
      { env, limit: MAX_LIST_BYTES }
    )
  );
  if (changed.length > MAX_FILES)
    throw new Error(`More than ${MAX_FILES} files changed.`);
  const large = changed.length ? await largeFiles(git, at, gitDir, changed) : [];
  await git(
    [...at, "add", "--all", "--pathspec-from-file=-", "--pathspec-file-nul"],
    {
      env,
      input: [
        ...scopeOf(checkout),
        ...large.map((path) => `:(top,literal,exclude)${path}`)
      ].join("\0"),
      timeout: 12e4
    }
  );
  return (await git([...at, "write-tree"], { env })).trim();
}
async function reconcileIgnored(git, at, gitDir, env) {
  const list = [
    "ls-files",
    "-z",
    "--cached",
    "--ignored",
    "--exclude-standard"
  ];
  const read = (extra, options) => git([...at, ...list, ...extra], { ...options, limit: MAX_LIST_BYTES });
  const [held, tracked] = await Promise.all([
    read([], { env }).then((text) => new Set(split0(text))),
    read(["--with-tree=HEAD"], {}).catch(() => read([], {})).then((text) => new Set(split0(text)))
  ]);
  const gone2 = [...held].filter((path) => !tracked.has(path));
  if (gone2.length)
    await git([...at, "update-index", "--force-remove", "-z", "--stdin"], {
      env,
      input: `${gone2.join("\0")}\0`
    });
  const missing = [...tracked].filter((path) => !held.has(path));
  if (!missing.length) return;
  const large = new Set(await largeFiles(git, at, gitDir, missing));
  const added = missing.filter((path) => !large.has(path));
  if (added.length)
    await git([...at, "update-index", "--add", "--remove", "-z", "--stdin"], {
      env,
      input: `${added.join("\0")}\0`,
      timeout: 12e4
    });
}
async function largeFiles(git, at, gitDir, paths) {
  const env = { GIT_INDEX_FILE: `${gitDir}/${SCAN_INDEX}` };
  await git([...at, "read-tree", "--empty"], { env });
  await git(
    [
      ...at,
      "update-index",
      "--add",
      "--remove",
      "--info-only",
      "-z",
      "--stdin"
    ],
    { env, input: `${paths.join("\0")}\0`, timeout: 12e4 }
  );
  const entries = (await git([...at, "ls-files", "--debug", "-z"], {
    env,
    limit: MAX_LIST_BYTES
  })).split("\0");
  const large = [];
  let name = entries[0] ?? "";
  for (const part of entries.slice(1)) {
    if (Number(/size: (\d+)/.exec(part)?.[1] ?? 0) > MAX_FILE_BYTES)
      large.push(name);
    name = part.slice(part.lastIndexOf("\n") + 1);
  }
  return large;
}
var STATUS = { A: "added", D: "deleted", R: "renamed" };
var compare = (before, after) => {
  if (!TREE.test(before) || !TREE.test(after))
    throw new Error("Not a snapshot.");
  return ["--no-ext-diff", "--no-textconv", "--no-color", "-M", before, after];
};
var gone = (error) => {
  const text = String(error);
  if (/bad object|unable to read tree|not a tree/i.test(text))
    throw new Unreadable("git has cleaned up this changeset's snapshots.");
  if (/cannot change to|No such file|not a git repository/i.test(text))
    throw new Unreadable("Its repository has moved or gone.");
  throw error;
};
async function changedFiles(git, checkout, before, after) {
  if (before === after) return [];
  const range = [...compare(before, after), "-z", "--", ...scopeOf(checkout)];
  const at = ["-C", checkout.dir, "diff"];
  const [names, numbers] = await Promise.all([
    git([...at, "--name-status", ...range]),
    git([...at, "--numstat", ...range])
  ]).catch(gone);
  const name = names.split("\0");
  const count = numbers.split("\0");
  const files = [];
  for (let n = 0, c = 0; n < name.length - 1; c++) {
    const letter = name[n++]?.charAt(0) ?? "M";
    const from = letter === "R" ? name[n++] : void 0;
    const path = name[n++] ?? "";
    const [added = "0", deleted = "0", inline = ""] = (count[c] ?? "").split(
      "	"
    );
    if (!inline) c += 2;
    const binary = added === "-";
    files.push({
      path,
      ...from === void 0 ? {} : { from },
      status: STATUS[letter] ?? "modified",
      additions: binary ? 0 : Number(added),
      deletions: binary ? 0 : Number(deleted),
      binary
    });
  }
  return files;
}
async function filePatch(git, checkout, before, after, file, context = 3) {
  const paths = [file.from, file.path].filter((path) => path !== void 0).map((path) => `:(top,literal)${path}`);
  return git(
    [
      "-C",
      checkout.dir,
      "diff",
      "--patch",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      `--unified=${Math.max(0, Math.min(context, 1e5))}`,
      ...compare(before, after),
      "--",
      ...paths
    ],
    { limit: MAX_PATCH_CHARS }
  ).catch(gone);
}
var EMPTY_TREE = {
  40: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  64: "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321"
};
var MAX_IMAGE_BYTES = 8 << 20;
function addedPatch(git, checkout, tree, path) {
  const empty = EMPTY_TREE[tree.length];
  if (!empty) return Promise.reject(new Error("Not a snapshot."));
  return git(
    [
      "-C",
      checkout.dir,
      "diff",
      "--binary",
      "--full-index",
      ...compare(empty, tree),
      "--",
      `:(top,literal)${path}`
    ],
    { limit: Math.ceil(MAX_IMAGE_BYTES * 1.3) + 4096 }
  ).catch(gone);
}

// src/patch.ts
var HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;
var unquote = (path) => path.startsWith('"') ? path.slice(1, -1).replace(/\\(.)/g, "$1") : path;
var side = (path, prefix2) => path === void 0 || path === "/dev/null" ? void 0 : unquote(path).replace(new RegExp(`^"?${prefix2}`), "");
function parsePatch(text) {
  const files = [];
  let file;
  let hunk;
  let a = 0;
  let b = 0;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m2 = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(raw);
      file = { binary: false, hunks: [], ...m2 ? { oldPath: m2[1], newPath: m2[2] } : {} };
      files.push(file);
      hunk = void 0;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (raw.startsWith("--- ")) {
        const path = side(raw.slice(4), "a/");
        if (path === void 0) delete file.oldPath;
        else file.oldPath = path;
      } else if (raw.startsWith("+++ ")) {
        const path = side(raw.slice(4), "b/");
        if (path === void 0) delete file.newPath;
        else file.newPath = path;
      } else if (raw.startsWith("rename from ")) file.oldPath = raw.slice(12);
      else if (raw.startsWith("rename to ")) file.newPath = raw.slice(10);
      else if (raw.startsWith("Binary files ") || raw === "GIT binary patch") file.binary = true;
      else if (raw.startsWith("new file mode")) delete file.oldPath;
      else if (raw.startsWith("deleted file mode")) delete file.newPath;
    }
    const m = HUNK.exec(raw);
    if (m) {
      a = Number(m[1]);
      b = Number(m[2]);
      hunk = { header: raw, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const mark = raw[0];
    const body = raw.slice(1);
    if (mark === " ") hunk.lines.push({ t: "eq", a: a++, b: b++, text: body });
    else if (mark === "-") hunk.lines.push({ t: "del", a: a++, text: body });
    else if (mark === "+") hunk.lines.push({ t: "add", b: b++, text: body });
    else if (mark === "\\") continue;
    else hunk = void 0;
  }
  return files;
}
function splitRows(hunks) {
  const rows = [];
  for (const hunk of hunks) {
    rows.push({ hunk: hunk.header });
    const lines = hunk.lines;
    for (let i = 0; i < lines.length; ) {
      const line = lines[i];
      if (line.t === "eq") {
        rows.push({ left: line, right: line });
        i++;
        continue;
      }
      const dels = [];
      const adds = [];
      while (lines[i]?.t === "del") dels.push(lines[i++]);
      while (lines[i]?.t === "add") adds.push(lines[i++]);
      for (let j = 0; j < Math.max(dels.length, adds.length); j++)
        rows.push({
          ...dels[j] ? { left: dels[j] } : {},
          ...adds[j] ? { right: adds[j] } : {}
        });
    }
  }
  return rows;
}
var B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
var B85_VALUE = new Map([...B85].map((char, index) => [char, index]));
function decodeBase85Line(line) {
  const first = line.charCodeAt(0);
  const length = first >= 65 && first <= 90 ? first - 64 : first >= 97 && first <= 122 ? first - 96 + 26 : -1;
  if (length < 0) throw new Error("Not a binary patch line.");
  const body = line.slice(1);
  const out = new Uint8Array(Math.ceil(body.length / 5) * 4);
  for (let i = 0, o = 0; i < body.length; i += 5, o += 4) {
    let value = 0;
    for (let j = 0; j < 5; j++) {
      const digit = B85_VALUE.get(body[i + j] ?? "");
      if (digit === void 0) throw new Error("Bad base85.");
      value = value * 85 + digit;
    }
    out[o] = value >>> 24 & 255;
    out[o + 1] = value >>> 16 & 255;
    out[o + 2] = value >>> 8 & 255;
    out[o + 3] = value & 255;
  }
  return out.slice(0, length);
}
function binaryHunks(patch) {
  const hunks = [];
  const lines = patch.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(literal|delta) (\d+)$/.exec(lines[i] ?? "");
    if (!m) continue;
    const parts = [];
    while (lines[i + 1]) parts.push(decodeBase85Line(lines[++i]));
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
      data.set(part, at);
      at += part.length;
    }
    hunks.push({ kind: m[1], size: Number(m[2]), data });
  }
  return hunks;
}
async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function applyDelta(base, delta) {
  let i = 0;
  const varint = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = delta[i++] ?? 0;
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    return value;
  };
  if (varint() !== base.length) throw new Error("The delta is for another file.");
  const out = new Uint8Array(varint());
  let o = 0;
  while (i < delta.length) {
    const op = delta[i++];
    if (op & 128) {
      let offset = 0;
      let size = 0;
      for (let bit = 0; bit < 4; bit++) if (op & 1 << bit) offset |= delta[i++] << 8 * bit;
      for (let bit = 0; bit < 3; bit++) if (op & 1 << 4 + bit) size |= delta[i++] << 8 * bit;
      if (size === 0) size = 65536;
      out.set(base.subarray(offset, offset + size), o);
      o += size;
    } else if (op) {
      out.set(delta.subarray(i, i + op), o);
      i += op;
      o += op;
    } else throw new Error("Bad delta.");
  }
  if (o !== out.length) throw new Error("The delta is incomplete.");
  return out;
}
async function addedBytes(patch) {
  const [first] = binaryHunks(patch);
  if (!first || first.kind !== "literal") return void 0;
  const bytes = await inflate(first.data);
  return bytes.length === first.size ? bytes : void 0;
}
var IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon"
};
var imageType = (path) => IMAGE_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];

// src/target.ts
var ORIGIN = "https://changeset.buzz.changesets.invalid";
var targetFor = (turn, checkout, file) => `${ORIGIN}/?turn=${turn}&checkout=${checkout}${file === void 0 ? "" : `&file=${encodeURIComponent(file)}`}`;
function parseTarget(target) {
  if (!target.startsWith(`${ORIGIN}/?`)) return void 0;
  const query = new URL(target).searchParams;
  const turn = query.get("turn") ?? "";
  const checkout = query.get("checkout") ?? "";
  if (!/^[0-9a-z]{1,40}$/.test(turn) || !/^\d{1,2}$/.test(checkout))
    return void 0;
  const file = query.get("file");
  return {
    turn,
    checkout: Number(checkout),
    ...file === null ? {} : { file }
  };
}

// node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/_u64.js
var fromNumH = (n) => n / 2 ** 32 | 0;
var fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view.setUint32(byteOffset, isLE ? l : h, isLE);
  view.setUint32(byteOffset + 4, isLE ? h : l, isLE);
}

// node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber(length, "length");
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
var aobject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
var aopts = (value, label) => {
  aobject(value, label);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
};
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
function asciiToBase16(ch) {
  return ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - (65 - 10) : ch >= 97 && ch <= 102 ? ch - (97 - 10) : void 0;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  if (hasHexBuiltin) {
    try {
      return Uint8Array.fromHex(hex);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RangeError(error.message);
      throw error;
    }
  }
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function checkOpts(defaults, opts, title = "opts") {
  aopts(defaults, "defaults");
  if (opts !== void 0)
    aopts(opts, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
  return merged;
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes(bytesLength = 32) {
  anumber(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take2 = Math.min(blockLen - this.pos, len - pos);
      if (take2 === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take2 === len ? data : data.subarray(pos, pos + take2), this.pos);
      this.pos += take2;
      pos += take2;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum(view, blockLen - 8, this.length * 8, isLE);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and makes sha256 3x slower (measured).
  A = 0;
  B = 0;
  C = 0;
  D = 0;
  E = 0;
  F = 0;
  G = 0;
  H = 0;
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  constructor() {
    super(32, SHA256_IV);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);

// node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/utils.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function aarray(item, title, inner = () => {
}) {
  if (!Array.isArray(item))
    throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
  for (let i = 0; i < item.length; i++)
    inner(item[i], `${title}[${i}]`);
  return item;
}
var abytes2 = (value, length, title) => abytes(value, length, title);
var anumber2 = anumber;
function aobject2(value, title = "object") {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
  return value;
}
function afunction(value, title) {
  if (typeof value !== "function")
    throw new TypeError(`"${title}" is invalid: expected function, got ${typeof value}`);
  return value;
}
var bytesToHex2 = bytesToHex;
var concatBytes2 = (...arrays) => concatBytes(...arrays);
var hexToBytes2 = (hex) => hexToBytes(hex);
var isBytes2 = isBytes;
var randomBytes2 = (bytesLength) => randomBytes(bytesLength);
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
var atitle2 = (title) => title ? `"${title}" ` : "";
function abool(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle2(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abignumber(n) {
  if (typeof n === "bigint") {
    if (!isPosBig(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber2(n);
  return n;
}
function asafenumber(value, title = "") {
  if (typeof value !== "number") {
    const prefix2 = title && `"${title}" `;
    throw new TypeError(prefix2 + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    const prefix2 = title && `"${title}" `;
    throw new RangeError(prefix2 + "expected safe integer, got " + value);
  }
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  return hexToNumber(bytesToHex(copyBytes(abytes(bytes)).reverse()));
}
function numberToBytesBE(n, len) {
  anumber(len);
  if (len === 0)
    throw new Error("zero output length is invalid");
  n = abignumber(n);
  const expectedLen = len * 2;
  const hex = n.toString(16);
  if (hex.length > expectedLen)
    throw new RangeError("number is too large");
  return hexToBytes(hex.padStart(expectedLen, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes2(bytes));
}
function asciiToBytes(ascii) {
  if (typeof ascii !== "string")
    throw new TypeError("ascii string expected, got " + typeof ascii);
  return Uint8Array.from(ascii, (c, i) => {
    const charCode = c.charCodeAt(0);
    if (c.length !== 1 || charCode > 127) {
      throw new RangeError(`string contains non-ASCII character "${ascii[i]}" with code ${charCode} at position ${i}`);
    }
    return charCode;
  });
}
function isPosBig(n) {
  return typeof n === "bigint" && _0n <= n;
}
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  if (n < _0n)
    throw new Error("expected non-negative bigint, got " + n);
  return n === _0n ? 0 : n.toString(2).length;
}
var bitMask = (n) => {
  asafenumber(n, "n");
  return (_1n << BigInt(n)) - _1n;
};
function validateObject(object, fields = {}, optFields = {}, title = "object") {
  aobject2(object, title);
  aobject2(fields, "fields");
  aobject2(optFields, "optFields");
  function checkField(fieldName, expectedType, isOpt) {
    const label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`;
    const val = object[fieldName];
    if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== void 0 : expectedType !== "function")) {
      throw new TypeError(`${label} is invalid: expected own property`);
    }
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}

// node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/abstract/modular.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n2 = /* @__PURE__ */ BigInt(0);
var _1n2 = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _15n = /* @__PURE__ */ BigInt(15);
var _16n = /* @__PURE__ */ BigInt(16);
var POW_WINDOWED_MIN = /* @__PURE__ */ BigInt("0x10000000000000000");
function mod(a, b) {
  if (b <= _0n2)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow(num2, power, modulo) {
  if (modulo <= _1n2)
    throw new Error("pow: expected modulus > 1, got " + modulo);
  if (typeof power !== "bigint")
    throw new TypeError("invalid exponent: expected bigint, got " + typeof power);
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return _1n2;
  if (power === _1n2)
    return num2;
  let d = num2 % modulo;
  if (d < _0n2)
    d += modulo;
  if (power < POW_WINDOWED_MIN) {
    let p2 = _1n2;
    while (power > _0n2) {
      if (power & _1n2)
        p2 = p2 * d % modulo;
      d = d * d % modulo;
      power >>= _1n2;
    }
    return p2;
  }
  const digits = [];
  while (power > _0n2) {
    digits.push(Number(power & _15n));
    power >>= _4n;
  }
  const table = new Array(16);
  table[0] = _1n2;
  table[1] = d;
  for (let i = 2; i < 16; i++)
    table[i] = table[i - 1] * d % modulo;
  let p = table[digits[digits.length - 1]];
  for (let w = digits.length - 2; w >= 0; w--) {
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    const digit = digits[w];
    if (digit !== 0)
      p = p * table[digit] % modulo;
  }
  return p;
}
function pow2(x, power, modulo) {
  if (modulo <= _1n2)
    throw new Error("pow2: expected modulus > 1, got " + modulo);
  if (power < _0n2)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  while (power-- > _0n2) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _1n2)
    throw new Error("invert: expected modulus > 1, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, u = _1n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    b = a, a = r, x = u, u = m;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function assertIsSquare(Fp, root, n) {
  const F = Fp;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function aoddModulus(order, fnName) {
  if ((order & _1n2) === _0n2)
    throw new Error(fnName + ": expected odd modulus, got " + order);
}
function sqrt3mod4(Fp, n) {
  const F = Fp;
  const p1div4 = (F.ORDER + _1n2) / _4n;
  const root = F.pow(n, p1div4);
  assertIsSquare(F, root, n);
  return root;
}
function sqrt5mod8(Fp, n) {
  const F = Fp;
  const p5div8 = (F.ORDER - _5n) / _8n;
  const n2 = F.mul(n, _2n);
  const v = F.pow(n2, p5div8);
  const nv = F.mul(n, v);
  const i = F.mul(F.mul(nv, _2n), v);
  const root = F.mul(nv, F.sub(i, F.ONE));
  assertIsSquare(F, root, n);
  return root;
}
function sqrt9mod16(P) {
  const Fp_ = Field(P);
  const tn = tonelliShanks(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n) / _16n;
  return ((Fp, n) => {
    const F = Fp;
    let tv1 = F.pow(n, c4);
    let tv2 = F.mul(tv1, c1);
    const tv3 = F.mul(tv1, c2);
    const tv4 = F.mul(tv1, c3);
    const e1 = F.eql(F.sqr(tv2), n);
    const e2 = F.eql(F.sqr(tv3), n);
    tv1 = F.cmov(tv1, tv2, e1);
    tv2 = F.cmov(tv4, tv3, e2);
    const e3 = F.eql(F.sqr(tv2), n);
    const root = F.cmov(tv1, tv2, e3);
    assertIsSquare(F, root, n);
    return root;
  });
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  aoddModulus(P, "tonelliShanks");
  let Q = P - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp, n) {
    const F = Fp;
    if (F.is0(n))
      return n;
    if (FpLegendre(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = F.mul(F.ONE, cc);
    let t = F.pow(n, Q);
    let R = F.pow(n, Q1div2);
    while (!F.eql(t, F.ONE)) {
      if (F.is0(t))
        throw new Error("Cannot find square root: probably non-prime P");
      let i = 1;
      let t_tmp = F.sqr(t);
      while (!F.eql(t_tmp, F.ONE)) {
        i++;
        t_tmp = F.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = F.pow(c, exponent);
      M = i;
      c = F.sqr(b);
      t = F.mul(t, c);
      R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  aoddModulus(P, "Fp.sqrt");
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  aobject2(field, "field");
  if (typeof field.ORDER !== "bigint")
    throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof field.ORDER);
  asafenumber(field.BYTES, "BYTES");
  asafenumber(field.BITS, "BITS");
  for (const name of FIELD_FIELDS)
    afunction(field[name], "field." + name);
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n2)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpInvertBatch(Fp, nums, passZero = false) {
  validateField(Fp);
  aarray(nums, "nums");
  abool(passZero, "passZero");
  const F = Fp;
  const inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num2, i) => {
    if (F.is0(num2))
      return acc;
    inverted[i] = acc;
    return F.mul(acc, num2);
  }, F.ONE);
  const invertedAcc = F.inv(multipliedAcc);
  nums.reduceRight((acc, num2, i) => {
    if (F.is0(num2))
      return acc;
    inverted[i] = F.mul(acc, inverted[i]);
    return F.mul(acc, num2);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp, n) {
  validateField(Fp);
  const F = Fp;
  aoddModulus(F.ORDER, "FpLegendre");
  const p1mod2 = (F.ORDER - _1n2) / _2n;
  const powered = F.pow(n, p1mod2);
  const yes = F.eql(powered, F.ONE);
  const zero = F.eql(powered, F.ZERO);
  const no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber2(nBitLength);
  if (n <= _0n2)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT = /* @__PURE__ */ new WeakMap();
var _Field = class {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n2;
  ONE = _1n2;
  _lengths;
  _mod;
  constructor(ORDER, opts = {}) {
    if (ORDER <= _1n2)
      throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
    let _nbitLength = void 0;
    this.isLE = false;
    if (opts != null && typeof opts === "object") {
      if (typeof opts.BITS === "number")
        _nbitLength = opts.BITS;
      if (typeof opts.sqrt === "function")
        Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
      if (typeof opts.isLE === "boolean")
        this.isLE = opts.isLE;
      if (opts.allowedLengths)
        this._lengths = Object.freeze(opts.allowedLengths.slice());
      if (typeof opts.modFromBytes === "boolean")
        this._mod = opts.modFromBytes;
    }
    const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    Object.freeze(this);
  }
  create(num2) {
    return mod(num2, this.ORDER);
  }
  isValid(num2) {
    if (typeof num2 !== "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num2);
    return _0n2 <= num2 && num2 < this.ORDER;
  }
  is0(num2) {
    return num2 === _0n2;
  }
  // is valid and invertible
  isValidNot0(num2) {
    return !this.is0(num2) && this.isValid(num2);
  }
  isOdd(num2) {
    return (num2 & _1n2) === _1n2;
  }
  neg(num2) {
    return mod(-num2, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num2) {
    return mod(num2 * num2, this.ORDER);
  }
  add(lhs, rhs) {
    return mod(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod(lhs * rhs, this.ORDER);
  }
  pow(num2, power) {
    return pow(num2, power, this.ORDER);
  }
  div(lhs, rhs) {
    return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
  }
  // Same as above, but doesn't normalize
  sqrN(num2) {
    return num2 * num2;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num2) {
    return invert(num2, this.ORDER);
  }
  sqrt(num2) {
    let sqrt = FIELD_SQRT.get(this);
    if (!sqrt)
      FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER));
    return sqrt(this, num2);
  }
  toBytes(num2) {
    return this.isLE ? numberToBytesLE(num2, this.BYTES) : numberToBytesBE(num2, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes2(bytes);
    const { _lengths: allowedLengths, BYTES, isLE, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
    if (modFromBytes)
      scalar = mod(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(lst) {
    return FpInvertBatch(this, lst, true);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    abool(condition, "condition");
    return condition ? b : a;
  }
};
function Field(ORDER, opts = {}) {
  Object.freeze(_Field.prototype);
  return new _Field(ORDER, opts);
}
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  if (fieldOrder <= _1n2)
    throw new Error("field order must be greater than 1");
  const bitLength = bitLen(fieldOrder - _1n2);
  return Math.ceil(bitLength / 8);
}
function getMinHashLength(fieldOrder) {
  const length = getFieldBytesLength(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField(key, fieldOrder, isLE = false) {
  abytes2(key);
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = Math.max(getMinHashLength(fieldOrder), 16);
  if (len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num2 = isLE ? bytesToNumberLE(key) : bytesToNumberBE(key);
  const reduced = mod(num2, fieldOrder - _1n2) + _1n2;
  return isLE ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}

// node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/abstract/curve.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n3 = /* @__PURE__ */ BigInt(0);
var _1n3 = /* @__PURE__ */ BigInt(1);
var _4n2 = /* @__PURE__ */ BigInt(4);
var BLIND_BYTES = 16;
var BLIND_BITS = 128;
var FW_WINDOW = 5;
var TABLE_BYTES_MAX = /* @__PURE__ */ (() => 2 ** 31)();
function validatePointCons(Point) {
  const pc = Point;
  if (typeof pc !== "function")
    throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
  afunction(pc.fromAffine, "Point.fromAffine");
  afunction(pc.fromBytes, "Point.fromBytes");
  afunction(pc.fromHex, "Point.fromHex");
  aobject2(pc.BASE, "Point.BASE");
  aobject2(pc.ZERO, "Point.ZERO");
  validateField(pc.Fp);
  validateField(pc.Fn);
}
function normalizeZ(c, points) {
  validatePointCons(c);
  validateMSMPoints(points, c);
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits, min = 1) {
  if (!Number.isSafeInteger(W) || W < min || W > bits)
    throw new Error("invalid window size, expected [" + min + ".." + bits + "], got W=" + W);
}
function validateTableBytes(numPoints, fpBytes) {
  const bytes = numPoints * (4 * fpBytes + 128);
  if (bytes > TABLE_BYTES_MAX)
    throw new Error("invalid window size: table would need ~" + Math.ceil(bytes / 2 ** 20) + " MiB, max " + TABLE_BYTES_MAX / 2 ** 20 + " MiB");
}
function probeRandomBytes(randomBytes3, length) {
  if (randomBytes3 === void 0)
    return void 0;
  afunction(randomBytes3, "randomBytes");
  try {
    const probe = randomBytes3(length);
    if (!isBytes2(probe) || probe.length !== length)
      return void 0;
  } catch {
    return void 0;
  }
  return randomBytes3;
}
function validateMSMPoints(points, c) {
  aarray(points, "points");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field, maxScalar) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    const ok = maxScalar === void 0 ? field.isValid(s) : isPosBig(s) && s < maxScalar;
    if (!ok)
      throw new Error("invalid scalar at index " + i);
  });
}
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getWindowSize(P) {
  return pointWindowSizes.get(P) || 1;
}
function oddMultiples(p, size) {
  const dbl = p.double();
  const t = [p];
  for (let j = 1; j < size; j++)
    t.push(t[j - 1].add(dbl));
  return t;
}
function wnafDigits(n, W) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const d = [];
  while (n > _0n3) {
    let w = 0;
    if (n & _1n3) {
      w = Number(n & mask);
      if (w >= half)
        w -= size;
      n -= BigInt(w);
    }
    d.push(w);
    n >>= _1n3;
  }
  return d;
}
function signedWindowDigits(n, W, windows) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const shiftBy = BigInt(W);
  const d = [];
  for (let w = 0; w < windows; w++) {
    let v = Number(n & mask);
    n >>= shiftBy;
    if (v > half) {
      v -= size;
      n += _1n3;
    }
    d.push(v);
  }
  if (n !== _0n3)
    throw new Error("invalid wnaf");
  return d;
}
function wnafWalk(zero, tables, digits) {
  let max = 0;
  for (const d of digits)
    max = Math.max(max, d.length);
  let acc = zero;
  for (let bit = max - 1; bit >= 0; bit--) {
    if (bit !== max - 1)
      acc = acc.double();
    for (let i = 0; i < digits.length; i++) {
      const w = digits[i][bit];
      if (w) {
        const item = tables[i][Math.abs(w) - 1 >> 1];
        acc = acc.add(w < 0 ? item.negate() : item);
      }
    }
  }
  return acc;
}
var ScalarMultiplier = class {
  Point;
  BASE;
  ZERO;
  randomBytes;
  wnafPrecomputes = /* @__PURE__ */ new WeakMap();
  baseCanBeBlinded;
  bits;
  // Parametrized with a given Point class (not individual point)
  constructor(Point, randomBytes3) {
    validatePointCons(Point);
    this.randomBytes = probeRandomBytes(randomBytes3, BLIND_BYTES);
    this.Point = Point;
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.bits = Point.Fn.BITS;
  }
  /**
   * Creates a signed fixed-window wNAF precomputation table: for every window w, the
   * multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P`, flattened. All doublings are baked into the table,
   * so cached multiplication is additions-only. `windows = ceil(bits/W) + 1`: the extra
   * window absorbs the final carry of signed-digit recoding.
   * For a 256-bit curve and W=6, the table is 44⋅32 = 1408 points.
   * @param point - Point instance
   * @param W - window size
   * @param bits - scalar bitlength the table must cover
   */
  buildWnafTable(point, W, bits) {
    const windows = Math.ceil(bits / W) + 1;
    const half = 2 ** (W - 1);
    const comp = [];
    let base = point;
    for (let w = 0; w < windows; w++) {
      let acc = base;
      for (let i = 0; i < half; i++) {
        comp.push(acc);
        acc = acc.add(base);
      }
      base = comp[comp.length - 1].double();
    }
    return { W, bits, windows, comp };
  }
  /**
   * Implements ec multiplication using precomputed signed fixed-window wNAF tables.
   * Constant-time: fixed window count with one table addition per window — zero digits feed
   * the fake accumulator — and no doublings; the lookup scans the whole window slice.
   * Scalar bounds are validated by the public entry points ({@link ScalarMultiplier.mulCT},
   * {@link ScalarMultiplier.mulCTBlinded}, {@link ScalarMultiplier.mulUnsafe});
   * signedWindowDigits throws if `n` exceeds the table.
   * @returns real and fake (for const-time) points
   */
  wnafCachedCT(precomputes, n) {
    const { W, windows, comp } = precomputes;
    const half = 2 ** (W - 1);
    const digits = signedWindowDigits(n, W, windows);
    let p = this.ZERO;
    let f = this.BASE;
    for (let w = 0; w < windows; w++) {
      const digit = digits[w];
      const start = w * half;
      const idx = Math.abs(digit) - 1;
      let sel = comp[start];
      for (let i = 1; i < half; i++)
        sel = i === idx ? comp[start + i] : sel;
      const neg = sel.negate();
      if (digit === 0)
        f = f.add(comp[start]);
      else
        p = p.add(digit < 0 ? neg : sel);
    }
    return { p, f };
  }
  // Cache key is point identity plus (W, bits); at most two entries exist per point (public-width
  // `Fn.BITS` and blinded `Fn.BITS + BLIND_BITS`). Callers must not reuse the same point with
  // incompatible `transform(...)` layouts and expect a separate cache entry.
  getWnafPrecomputes(W, point, bits, transform) {
    let entries = this.wnafPrecomputes.get(point);
    let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
    if (!comp) {
      comp = this.buildWnafTable(point, W, bits);
      if (typeof transform === "function")
        comp = { ...comp, comp: transform(comp.comp) };
      if (!entries) {
        entries = [];
        this.wnafPrecomputes.set(point, entries);
      }
      entries.push(comp);
    }
    return comp;
  }
  assertPoint(point) {
    if (!(point instanceof this.Point))
      throw new TypeError('"point" expected Point instance, got type=' + typeof point);
  }
  // Shared prologue of the constant-time entry points. Rejects scalar 0: in key/signature-style
  // callers a zero scalar means broken upstream plumbing, and concrete Points already reject it.
  // Uses inRange instead of Fn.isValidNot0: validateField() only certifies the arithmetic subset.
  validateMulInput(point, scalar) {
    this.assertPoint(point);
    if (!inRange(scalar, _1n3, this.Point.Fn.ORDER))
      throw new Error("invalid scalar");
  }
  // Constant-time dispatch shared by mulCT / mulCTBlinded. Un-precomputed points (W===1, e.g.
  // ECDH peer keys) skip building a throwaway cached table in favor of a small fixed-window
  // multiply. `n` must be < 2^bits.
  runCT(point, n, bits, transform) {
    const W = getWindowSize(point);
    if (W === 1)
      return this.fixedWindowCT(point, n, bits);
    return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
  }
  mulCT(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    return this.runCT(point, scalar, this.bits, transform);
  }
  mulCTBlinded(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    if (this.randomBytes === void 0)
      throw new Error("randomBytes is required for scalar blinding");
    const bits = this.Point.Fn.BITS + BLIND_BITS;
    const blind = this.randomBytes(BLIND_BYTES);
    if (!isBytes2(blind) || blind.length !== BLIND_BYTES)
      throw new Error("randomBytes returned invalid byte array");
    blind[0] = blind[0] & 63 | 128;
    const n = scalar + bytesToNumberBE(blind) * this.Point.Fn.ORDER;
    return this.runCT(point, n, bits, transform);
  }
  /**
   * Constant-time multiplication `n*point` for an un-precomputed point, via a small fixed window.
   * A cached wNAF table only pays off when reused; a flat 2^FW_WINDOW table (`size-1` adds) is
   * far cheaper to build for a single use. The point-operation sequence is independent of `n`:
   * build the table, then per window exactly FW_WINDOW doublings, a data-oblivious scan over
   * every table entry, and one addition (adds the identity when the window digit is 0 — never
   * skipped).
   *
   * `n` must be `< 2^bits`. Assumes complete addition (adding the identity costs the same as any
   * add), which holds for the Weierstrass/Edwards point types used here. The table is left in
   * projective form (no normalizeZ): normalizing this small a table costs more than the
   * mixed-add savings it would buy for a single multiply.
   * @returns real point `p`; `f` duplicates it only to match {@link wnafCachedCT}'s return shape
   * (this path needs no fake accumulator — its op-count is already scalar-independent).
   */
  fixedWindowCT(point, n, bits) {
    const W = FW_WINDOW;
    const size = 1 << W;
    const mask = bitMask(W);
    const table = new Array(size);
    table[0] = this.ZERO;
    for (let i = 1; i < size; i++)
      table[i] = table[i - 1].add(point);
    const windows = Math.ceil(bits / W);
    let acc = this.ZERO;
    for (let window = windows - 1; window >= 0; window--) {
      if (window !== windows - 1)
        for (let d = 0; d < W; d++)
          acc = acc.double();
      const digit = Number(n >> BigInt(window * W) & mask);
      let sel = table[0];
      for (let i = 1; i < size; i++)
        sel = i === digit ? table[i] : sel;
      acc = acc.add(sel);
    }
    return { p: acc, f: acc };
  }
  shouldBlind(point, cofactor) {
    if (this.randomBytes === void 0)
      return false;
    if (cofactor === _1n3)
      return true;
    if (point !== this.BASE)
      return false;
    if (this.baseCanBeBlinded === void 0)
      this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
    return this.baseCanBeBlinded;
  }
  mulSecret(point, scalar, cofactor, transform) {
    return this.shouldBlind(point, cofactor) ? this.mulCTBlinded(point, scalar, transform) : this.mulCT(point, scalar, transform);
  }
  mulUnsafe(point, scalar, transform) {
    this.assertPoint(point);
    if (!isPosBig(scalar))
      throw new Error("invalid scalar");
    const W = getWindowSize(point);
    if (W === 1 || scalar >= this.Point.Fn.ORDER)
      return mulAddUnsafe(this.Point, [point], [scalar], true);
    const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
    return this.wnafCachedCT(precomputes, scalar).p;
  }
  // Remembers the window size used for precomputed wNAF multiplication of the given point
  // and drops any previously built tables. Usually only the base point is precomputed.
  // W=1 resets the point to the un-precomputed (table-less) paths.
  // W is additionally capped so tables stay under ~2 GiB ({@link TABLE_BYTES_MAX}).
  setWindowSize(point, W) {
    this.assertPoint(point);
    validateW(W, this.bits);
    const windows = Math.ceil((this.bits + BLIND_BITS) / W) + 1;
    validateTableBytes(windows * 2 ** (W - 1), this.Point.Fp.BYTES);
    pointWindowSizes.set(point, W);
    this.wnafPrecomputes.delete(point);
  }
  // True when a window size is set: tables themselves are built lazily on first multiply.
  hasWindowSize(point) {
    return getWindowSize(point) !== 1;
  }
};
function mulAddUnsafe(c, points, scalars, allowOversized = false) {
  validatePointCons(c);
  validateMSMPoints(points, c);
  abool(allowOversized, "allowOversized");
  validateMSMScalars(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n2 : void 0);
  if (points.length !== scalars.length)
    throw new Error("arrays of points and scalars must have equal length");
  const tables = points.map((p) => oddMultiples(p, 4));
  const digits = scalars.map((n) => wnafDigits(n, 4));
  return wnafWalk(c.ZERO, tables, digits);
}
function createField(order, field, isLE) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE });
  }
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (type !== "weierstrass" && type !== "edwards")
    throw new Error('expected curve type "weierstrass" or "edwards"');
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  validateObject(curveOpts);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(isPosBig(val) && val !== _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp, Fn };
}
function createKeygen(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/abstract/weierstrass.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var divNearest = (num2, den) => (num2 + (num2 >= 0 ? den : -den) / _2n2) / den;
function _splitEndoScalar(k, basis, n) {
  aInRange("scalar", k, _0n4, n);
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest(b2 * k, n);
  const c2 = divNearest(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n4;
  const k2neg = k2 < _0n4;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n4;
  if (k1 < _0n4 || k1 >= MAX_NUM || k2 < _0n4 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed for k");
  }
  return { k1neg, k1, k2neg, k2 };
}
var _0n4 = /* @__PURE__ */ BigInt(0);
var _1n4 = /* @__PURE__ */ BigInt(1);
var _2n2 = /* @__PURE__ */ BigInt(2);
var _3n2 = /* @__PURE__ */ BigInt(3);
var _4n3 = /* @__PURE__ */ BigInt(4);
function weierstrass(params, extraOpts = {}) {
  const validated = createCurveFields("weierstrass", params, extraOpts);
  const Fp = validated.Fp;
  const Fn = validated.Fn;
  let CURVE = validated.CURVE;
  const { h: cofactor, n: CURVE_ORDER } = CURVE;
  validateObject(extraOpts, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object",
    randomBytes: "function"
  });
  const { endo: endoOpts, allowInfinityPoint, clearCofactor, isTorsionFree, fromBytes, toBytes } = extraOpts;
  const randomBytes3 = extraOpts.randomBytes === void 0 ? randomBytes2 : extraOpts.randomBytes;
  if (endoOpts) {
    if (!Fp.is0(CURVE.a) || typeof endoOpts.beta !== "bigint" || !Array.isArray(endoOpts.basises)) {
      throw new Error('invalid endo: expected "beta": bigint and "basises": array');
    }
  }
  const endo = endoOpts ? {
    beta: endoOpts.beta,
    basises: endoOpts.basises.map((basis) => [...basis])
  } : void 0;
  const lengths = getWLengths(Fp, Fn);
  function assertCompressionIsSupported() {
    if (!Fp.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function pointToBytes2(_c, point, isCompressed) {
    if (point.is0()) {
      if (!allowInfinityPoint)
        throw new Error("bad point: ZERO");
      return Uint8Array.of(0);
    }
    const { x, y } = point.toAffine();
    const bx = Fp.toBytes(x);
    abool(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp.isOdd(y);
      return concatBytes2(pprefix(hasEvenY), bx);
    } else {
      return concatBytes2(Uint8Array.of(4), bx, Fp.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    abytes2(bytes, void 0, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (allowInfinityPoint && length === 1 && head === 0)
      return { x: Fp.ZERO, y: Fp.ZERO };
    if (length === comp && (head === 2 || head === 3)) {
      const x = Fp.fromBytes(tail);
      if (!Fp.isValid(x))
        throw new Error("bad point: is not on curve, wrong x");
      const y2 = weierstrassEquation(x);
      let y;
      try {
        y = Fp.sqrt(y2);
      } catch (sqrtError) {
        const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + err);
      }
      assertCompressionIsSupported();
      const evenY = Fp.isOdd(y);
      const evenH = (head & 1) === 1;
      if (evenH !== evenY)
        y = Fp.neg(y);
      return { x, y };
    } else if (length === uncomp && head === 4) {
      const L = Fp.BYTES;
      const x = Fp.fromBytes(tail.subarray(0, L));
      const y = Fp.fromBytes(tail.subarray(L, L * 2));
      if (!isValidXY(x, y))
        throw new Error("bad point: is not on curve");
      return { x, y };
    } else {
      throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
    }
  }
  const encodePoint = toBytes === void 0 ? pointToBytes2 : toBytes;
  const decodePoint = fromBytes === void 0 ? pointFromBytes : fromBytes;
  const b3 = Fp.mul(CURVE.b, _3n2);
  const mulA = Fp.is0(CURVE.a) ? (_) => Fp.ZERO : (x) => Fp.mul(CURVE.a, x);
  function weierstrassEquation(x) {
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
  }
  function isValidXY(x, y) {
    const left = Fp.sqr(y);
    const right = weierstrassEquation(x);
    return Fp.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n2), _4n3);
  const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
  if (Fp.is0(Fp.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function acoord(title, n, banZero = false) {
    if (!Fp.isValid(n) || banZero && Fp.is0(n))
      throw new Error(`bad point coordinate ${title}`);
    return typeof n === "object" && n !== null ? Fp.create(n) : n;
  }
  function aprjpoint(other) {
    if (!(other instanceof Point))
      throw new Error("Weierstrass Point expected");
  }
  function splitEndoScalarN(k) {
    if (!endo || !endo.basises)
      throw new Error("no endo");
    return _splitEndoScalar(k, endo.basises, Fn.ORDER);
  }
  function pushWnafPair(points, scalars, p, k) {
    if (!Fn.isValid(k))
      throw new RangeError("invalid scalar: out of range");
    if (endo) {
      const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(k);
      const psi = new Point(Fp.mul(p.X, endo.beta), p.Y, p.Z);
      points.push(k1neg ? p.negate() : p, k2neg ? psi.negate() : psi);
      scalars.push(k1, k2);
    } else {
      points.push(p);
      scalars.push(k);
    }
  }
  const validityCache = /* @__PURE__ */ new WeakSet();
  class Point {
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
    static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
    static Fp = Fp;
    static Fn = Fn;
    X;
    Y;
    Z;
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    constructor(X, Y, Z) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y, true);
      this.Z = acoord("z", Z);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      if (Fp.is0(x) && Fp.is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp.ONE);
    }
    static fromBytes(bytes) {
      const P = Point.fromAffine(decodePoint(abytes2(bytes, void 0, "point")));
      P.assertValidity();
      return P;
    }
    static fromHex(hex) {
      return Point.fromBytes(hexToBytes2(hex));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     * @param isLazy - true will defer table computation until the first multiplication
     */
    precompute(windowSize = 6, isLazy = true) {
      wnaf.setWindowSize(this, windowSize);
      if (!isLazy)
        this.multiply(_3n2);
      return this;
    }
    // TODO: return `this`
    /** A point on curve is valid if it conforms to equation. */
    assertValidity() {
      const p = this;
      if (p.is0()) {
        if (allowInfinityPoint && Fp.is0(p.X) && Fp.eql(p.Y, Fp.ONE) && Fp.is0(p.Z))
          return;
        throw new Error("bad point: ZERO");
      }
      if (validityCache.has(p))
        return;
      const { x, y } = p.toAffine();
      if (!Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("bad point: x or y not field elements");
      if (!isValidXY(x, y))
        throw new Error("bad point: equation left != right");
      if (!p.isTorsionFree())
        throw new Error("bad point: not in prime-order subgroup");
      validityCache.add(p);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (!Fp.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !Fp.isOdd(y);
    }
    /** Compare one point to another. */
    equals(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
      const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
      return U1 && U2;
    }
    /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
    negate() {
      return new Point(this.X, Fp.neg(this.Y), this.Z);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X1);
      let t1 = Fp.mul(Y1, Y1);
      let t2 = Fp.mul(Z1, Z1);
      let t3 = Fp.mul(X1, Y1);
      t3 = Fp.add(t3, t3);
      Z3 = Fp.mul(X1, Z1);
      Z3 = Fp.add(Z3, Z3);
      X3 = mulA(Z3);
      Y3 = Fp.mul(b3, t2);
      Y3 = Fp.add(X3, Y3);
      X3 = Fp.sub(t1, Y3);
      Y3 = Fp.add(t1, Y3);
      Y3 = Fp.mul(X3, Y3);
      X3 = Fp.mul(t3, X3);
      Z3 = Fp.mul(b3, Z3);
      t2 = mulA(t2);
      t3 = Fp.sub(t0, t2);
      t3 = mulA(t3);
      t3 = Fp.add(t3, Z3);
      Z3 = Fp.add(t0, t0);
      t0 = Fp.add(Z3, t0);
      t0 = Fp.add(t0, t2);
      t0 = Fp.mul(t0, t3);
      Y3 = Fp.add(Y3, t0);
      t2 = Fp.mul(Y1, Z1);
      t2 = Fp.add(t2, t2);
      t0 = Fp.mul(t2, t3);
      X3 = Fp.sub(X3, t0);
      Z3 = Fp.mul(t2, t1);
      Z3 = Fp.add(Z3, Z3);
      Z3 = Fp.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X2);
      let t1 = Fp.mul(Y1, Y2);
      let t2 = Fp.mul(Z1, Z2);
      let t3 = Fp.add(X1, Y1);
      let t4 = Fp.add(X2, Y2);
      t3 = Fp.mul(t3, t4);
      t4 = Fp.add(t0, t1);
      t3 = Fp.sub(t3, t4);
      t4 = Fp.add(X1, Z1);
      let t5 = Fp.add(X2, Z2);
      t4 = Fp.mul(t4, t5);
      t5 = Fp.add(t0, t2);
      t4 = Fp.sub(t4, t5);
      t5 = Fp.add(Y1, Z1);
      X3 = Fp.add(Y2, Z2);
      t5 = Fp.mul(t5, X3);
      X3 = Fp.add(t1, t2);
      t5 = Fp.sub(t5, X3);
      Z3 = mulA(t4);
      X3 = Fp.mul(b3, t2);
      Z3 = Fp.add(X3, Z3);
      X3 = Fp.sub(t1, Z3);
      Z3 = Fp.add(t1, Z3);
      Y3 = Fp.mul(X3, Z3);
      t1 = Fp.add(t0, t0);
      t1 = Fp.add(t1, t0);
      t2 = mulA(t2);
      t4 = Fp.mul(b3, t4);
      t1 = Fp.add(t1, t2);
      t2 = Fp.sub(t0, t2);
      t2 = mulA(t2);
      t4 = Fp.add(t4, t2);
      t0 = Fp.mul(t1, t4);
      Y3 = Fp.add(Y3, t0);
      t0 = Fp.mul(t5, t4);
      X3 = Fp.mul(t3, X3);
      X3 = Fp.sub(X3, t0);
      t0 = Fp.mul(t3, t1);
      Z3 = Fp.mul(t5, Z3);
      Z3 = Fp.add(Z3, t0);
      return new Point(X3, Y3, Z3);
    }
    subtract(other) {
      aprjpoint(other);
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    /**
     * Constant time multiplication.
     * Uses precomputed tables (signed fixed-window wNAF) when available.
     * Uses scalar blinding and avoids endomorphism splitting in the secret-scalar path.
     * @param scalar - by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      if (!Fn.isValidNot0(scalar))
        throw new RangeError("invalid scalar: out of range");
      const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
      return normalize([p, f])[0];
    }
    /**
     * Non-constant-time multiplication. Uses width-4 wNAF with GLV endomorphism splitting
     * when available (two half-width scalars sharing one halved doubling chain).
     * It's faster, but should only be used when you don't care about
     * an exposed secret key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(scalar) {
      const p = this;
      const sc = scalar;
      if (!Fn.isValid(sc))
        throw new RangeError("invalid scalar: out of range");
      if (sc === _0n4 || p.is0())
        return Point.ZERO;
      if (sc === _1n4)
        return p;
      if (wnaf.hasWindowSize(this))
        return wnaf.mulUnsafe(p, sc, normalize);
      const points = [];
      const scalars = [];
      pushWnafPair(points, scalars, p, sc);
      return mulAddUnsafe(Point, points, scalars);
    }
    /**
     * Non-constant-time double-scalar multiplication `a⋅this + b⋅other` (Strauss–Shamir).
     * Both walks share one doubling chain via {@link mulAddUnsafe}, and GLV endomorphism
     * (when available) halves the chain again by splitting each scalar into two half-width
     * parts. Used by ECDSA verification and public-key recovery for `R = u1⋅G + u2⋅P`.
     * Only for public scalars.
     */
    mulAddUnsafe(a, other, b) {
      aprjpoint(other);
      const points = [];
      const scalars = [];
      pushWnafPair(points, scalars, this, a);
      pushWnafPair(points, scalars, other, b);
      return mulAddUnsafe(Point, points, scalars);
    }
    /**
     * Converts Projective point to affine (x, y) coordinates.
     * (X, Y, Z) ∋ (x=X/Z, y=Y/Z).
     * @param invertedZ - Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
     */
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      if (iz != null && !Fp.isValid(iz))
        throw new RangeError('"invertedZ" expected valid field element');
      const { X, Y, Z } = p;
      if (Fp.eql(Z, Fp.ONE))
        return { x: X, y: Y };
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp.ONE : Fp.inv(Z);
      const x = Fp.mul(X, iz);
      const y = Fp.mul(Y, iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: Fp.ZERO, y: Fp.ZERO };
      if (!Fp.eql(zz, Fp.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    /**
     * Checks whether Point is free of torsion elements (is in prime subgroup).
     * Always torsion-free for cofactor=1 curves.
     */
    isTorsionFree() {
      if (cofactor === _1n4)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.mulUnsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      if (cofactor === _1n4)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(cofactor);
    }
    isSmallOrder() {
      if (cofactor === _1n4)
        return this.is0();
      return this.clearCofactor().is0();
    }
    toBytes(isCompressed = true) {
      abool(isCompressed, "isCompressed");
      this.assertValidity();
      return encodePoint(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex2(this.toBytes(isCompressed));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const normalize = (points) => normalizeZ(Point, points);
  const wnaf = new ScalarMultiplier(Point, randomBytes3);
  if (wnaf.bits >= 6)
    Point.BASE.precompute(6);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}
function pprefix(hasEvenY) {
  return Uint8Array.of(hasEvenY ? 2 : 3);
}
function getWLengths(Fp, Fn) {
  return {
    secretKey: Fn.BYTES,
    publicKey: 1 + Fp.BYTES,
    publicKeyUncompressed: 1 + 2 * Fp.BYTES,
    publicKeyHasPrefix: true,
    // Raw compact `(r || s)` signature width; DER and recovered signatures use
    // different lengths outside this helper.
    signature: 2 * Fn.BYTES
  };
}

// node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/secp256k1.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var secp256k1_CURVE = {
  p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
  n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
  h: BigInt(1),
  a: BigInt(0),
  b: BigInt(7),
  Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
  Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
};
var secp256k1_ENDO = {
  beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
  basises: [
    [BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")],
    [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]
  ]
};
var _0n5 = /* @__PURE__ */ BigInt(0);
var _2n3 = /* @__PURE__ */ BigInt(2);
function sqrtMod(y) {
  const P = secp256k1_CURVE.p;
  const _3n3 = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
  const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
  const b2 = y * y * y % P;
  const b3 = b2 * b2 * y % P;
  const b6 = pow2(b3, _3n3, P) * b3 % P;
  const b9 = pow2(b6, _3n3, P) * b3 % P;
  const b11 = pow2(b9, _2n3, P) * b2 % P;
  const b22 = pow2(b11, _11n, P) * b11 % P;
  const b44 = pow2(b22, _22n, P) * b22 % P;
  const b88 = pow2(b44, _44n, P) * b44 % P;
  const b176 = pow2(b88, _88n, P) * b88 % P;
  const b220 = pow2(b176, _44n, P) * b44 % P;
  const b223 = pow2(b220, _3n3, P) * b3 % P;
  const t1 = pow2(b223, _23n, P) * b22 % P;
  const t2 = pow2(t1, _6n, P) * b2 % P;
  const root = pow2(t2, _2n3, P);
  if (!Fpk1.eql(Fpk1.sqr(root), y))
    throw new Error("Cannot find square root");
  return root;
}
var Fpk1 = /* @__PURE__ */ Field(secp256k1_CURVE.p, { sqrt: sqrtMod });
var Pointk1 = /* @__PURE__ */ weierstrass(secp256k1_CURVE, {
  Fp: Fpk1,
  endo: secp256k1_ENDO
});
var TAGGED_HASH_PREFIXES = /* @__PURE__ */ Object.create(null);
function taggedHash(tag, ...messages) {
  let tagP = TAGGED_HASH_PREFIXES[tag];
  if (tagP === void 0) {
    const tagH = sha256(asciiToBytes(tag));
    tagP = concatBytes2(tagH, tagH);
    TAGGED_HASH_PREFIXES[tag] = tagP;
  }
  return sha256(concatBytes2(tagP, ...messages));
}
var pointToBytes = (point) => point.toBytes(true).slice(1);
var affineXToBytes = ({ x }) => Fpk1.toBytes(x);
var hasEven = (y) => !Fpk1.isOdd(y);
function schnorrGetExtPubKey(priv) {
  const { Fn, BASE } = Pointk1;
  const d_ = Fn.fromBytes(abytes2(priv, 32, "secretKey"));
  const p = BASE.multiply(d_);
  const affine = p.toAffine();
  const scalar = hasEven(affine.y) ? d_ : Fn.neg(d_);
  return { scalar, bytes: affineXToBytes(affine) };
}
function lift_x(x) {
  const Fp = Fpk1;
  if (!Fp.isValidNot0(x))
    throw new Error("invalid x: Fail if x \u2265 p");
  const xx = Fp.sqr(x);
  const c = Fp.add(Fp.mulN(xx, x), BigInt(7));
  let y = Fp.sqrt(c);
  if (!hasEven(y))
    y = Fp.neg(y);
  const p = Pointk1.fromAffine({ x, y });
  p.assertValidity();
  return p;
}
var num = bytesToNumberBE;
function challenge(...args) {
  return Pointk1.Fn.create(num(taggedHash("BIP0340/challenge", ...args)));
}
function schnorrGetPublicKey(secretKey) {
  return schnorrGetExtPubKey(secretKey).bytes;
}
function schnorrSign(message, secretKey, auxRand = randomBytes(32)) {
  const { Fn, BASE } = Pointk1;
  const m = copyBytes(abytes2(message, void 0, "message"));
  const { bytes: px, scalar: d } = schnorrGetExtPubKey(secretKey);
  const a = abytes2(auxRand, 32, "auxRand");
  const t = Fn.toBytes(d ^ num(taggedHash("BIP0340/aux", a)));
  const rand = taggedHash("BIP0340/nonce", t, px, m);
  const k_ = Fn.create(num(rand));
  if (k_ === _0n5)
    throw new Error("sign failed: k is zero");
  const p = BASE.multiply(k_);
  const affine = p.toAffine();
  const k = hasEven(affine.y) ? k_ : Fn.neg(k_);
  const rx = affineXToBytes(affine);
  const e = challenge(rx, px, m);
  const sig = new Uint8Array(64);
  sig.set(rx, 0);
  sig.set(Fn.toBytes(Fn.create(k + e * d)), 32);
  if (!schnorrVerify(sig, m, px))
    throw new Error("sign: Invalid signature produced");
  return sig;
}
function schnorrVerify(signature, message, publicKey) {
  const { Fp, Fn, BASE } = Pointk1;
  const sig = abytes2(signature, 64, "signature");
  const m = abytes2(message, void 0, "message");
  const pub = abytes2(publicKey, 32, "publicKey");
  try {
    const P = lift_x(num(pub));
    const rBytes = sig.subarray(0, 32);
    const r = num(rBytes);
    if (!Fp.isValidNot0(r))
      return false;
    const s = num(sig.subarray(32, 64));
    if (!Fn.isValidNot0(s))
      return false;
    const e = challenge(rBytes, pointToBytes(P), m);
    const R = BASE.mulAddUnsafe(s, P, Fn.neg(e));
    const { x, y } = R.toAffine();
    if (R.is0() || !hasEven(y) || !Fp.eql(x, r))
      return false;
    return true;
  } catch (error) {
    return false;
  }
}
var schnorr = /* @__PURE__ */ (() => {
  const size = 32;
  const seedLength = 48;
  const randomSecretKey = (seed) => {
    seed = seed === void 0 ? randomBytes(seedLength) : seed;
    return mapHashToField(abytes2(seed, seedLength, "seed"), secp256k1_CURVE.n);
  };
  return Object.freeze({
    keygen: createKeygen(randomSecretKey, schnorrGetPublicKey),
    getPublicKey: schnorrGetPublicKey,
    sign: schnorrSign,
    verify: schnorrVerify,
    Point: Pointk1,
    utils: Object.freeze({
      randomSecretKey,
      taggedHash,
      lift_x,
      pointToBytes
    }),
    lengths: Object.freeze({
      secretKey: size,
      publicKey: size,
      publicKeyHasPrefix: false,
      signature: size * 2,
      seed: seedLength
    })
  });
})();

// src/canvas.ts
var CANVAS_INSTRUCTIONS = "canvas-instructions";
var KEY = /^[0-9a-f]{64}$/;
var SIG = /^[0-9a-f]{128}$/;
var CLAUSE = /^(kind=|created_at<|created_at>)(0|[1-9][0-9]*)$/;
var hexToBytes3 = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
async function ownerCanvas(canvas, owner, channelId) {
  if (!canvas?.available) return void 0;
  const head = await canvas.read(channelId);
  if (!head) return void 0;
  if (await approvedCanvas(head, owner)) return head.content;
  console.warn("Ignoring a Canvas its owner's side has not approved", channelId);
  return void 0;
}
async function approvedCanvas(head, owner) {
  if (head.tags.some((tag) => tag[0] === CANVAS_INSTRUCTIONS)) return false;
  return head.pubkey === owner || await attestedOwner(head) === owner;
}
async function attestedOwner(event) {
  const [tag, ...extra] = event.tags.filter((tag2) => tag2[0] === "auth");
  if (!tag || extra.length || !satisfied(tag[2] ?? "", event)) return void 0;
  const [name, owner, conditions, sig] = tag;
  const target = event.pubkey;
  if (name !== "auth" || tag.length !== 4 || !owner || conditions === void 0 || !sig || !KEY.test(owner) || !SIG.test(sig) || owner === target || !validConditions(conditions))
    return void 0;
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`nostr:agent-auth:${target}:${conditions}`)
    );
    return schnorr.verify(hexToBytes3(sig), new Uint8Array(digest), hexToBytes3(owner)) ? owner : void 0;
  } catch {
    return void 0;
  }
}
function validConditions(conditions) {
  return conditions === "" || conditions.split("&").every((clause) => {
    const [, name, digits] = CLAUSE.exec(clause) ?? [];
    if (!name || !digits) return false;
    return Number(digits) <= (name === "kind=" ? 65535 : 4294967295);
  });
}
function satisfied(conditions, event) {
  if (!validConditions(conditions)) return false;
  if (conditions === "") return true;
  return conditions.split("&").every((clause) => {
    const [, name, digits] = CLAUSE.exec(clause) ?? [];
    const value = Number(digits);
    if (name === "kind=") return event.kind === value;
    return name === "created_at<" ? event.created_at < value : event.created_at > value;
  });
}

// src/turns.ts
var TURNS_KEY = "lucas.changesets-plus.turns.v1";
var KEEP = 300;
var GRACE_MS = 15e3;
var KEEP_SUMMARIES = 50;
var LATE_MS = 1500;
var NEW_WORKTREES = 5;
var KEEP_PUBLISHED = 20;
var NONE = [];
var workKey = (work) => `${work.scope}:${work.agent}:${work.messageId}:${work.startedAt}`;
var sessionOf = (work) => `${work.agent}:${work.channelId}:${work.thread ? work.threadRootId : ""}`;
var runsHere = (session, agent) => session.agentChoices.snapshot().identities.some(
  (choice) => choice.pubkey === agent && choice.execution === "local"
);
function createTurns(git, storage = localStorage) {
  let turns = load();
  let identity;
  let version = 0;
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => {
    version++;
    for (const listener of listeners) listener();
  };
  const mine = (turn) => !!identity && turn.viewer === identity.viewer && turn.origin === identity.origin;
  const changed = (turn) => turn.checkouts.some((checkout) => checkout.files);
  let byChat = /* @__PURE__ */ new Map();
  let byMessage = /* @__PURE__ */ new Map();
  const chatOf = (agent, channelId) => `${agent}:${channelId}`;
  const reindex = () => {
    byChat = /* @__PURE__ */ new Map();
    byMessage = /* @__PURE__ */ new Map();
    for (const turn of turns) {
      if (turn.end && turn.message && changed(turn))
        byMessage.set(turn.message.id, [
          ...byMessage.get(turn.message.id) ?? [],
          turn
        ]);
      const key = chatOf(turn.agent, turn.channelId);
      byChat.set(key, [...byChat.get(key) ?? [], turn]);
    }
    for (const list of byChat.values()) list.sort((a, b) => a.start - b.start);
  };
  reindex();
  let saving;
  const store = () => {
    saving = void 0;
    try {
      storage.setItem(
        TURNS_KEY,
        JSON.stringify(turns.filter((t) => t.end && changed(t)).slice(-KEEP))
      );
    } catch {
    }
  };
  const save = () => {
    if (turns.length > KEEP * 2) turns = turns.slice(-KEEP * 2);
    reindex();
    saving ??= setTimeout(store, 1e3);
    notify();
  };
  const summaries = /* @__PURE__ */ new Map();
  const find = (id, index) => {
    const turn = turns.find((candidate) => candidate.id === id);
    const checkout = turn && mine(turn) ? turn.checkouts[index] : void 0;
    return turn && checkout?.after ? { turn, checkout, after: checkout.after } : void 0;
  };
  const recorded = (id, index) => {
    const found = find(id, index);
    if (!found)
      throw new Unreadable("This changeset was recorded in another Buzz.");
    return found;
  };
  const remember = (key, files) => {
    summaries.set(key, files);
    files.catch(() => summaries.delete(key));
    while (summaries.size > KEEP_SUMMARIES)
      summaries.delete(summaries.keys().next().value);
  };
  const active = /* @__PURE__ */ new Set();
  async function begin(session, signedIn, agent, channelId, thread) {
    if (!signedIn) return void 0;
    const start = Date.now();
    const record2 = {
      id: start.toString(36) + Math.random().toString(36).slice(2, 8),
      agent,
      channelId,
      ...signedIn,
      ...thread ? { thread } : {},
      start,
      checkouts: []
    };
    turns.push(record2);
    reindex();
    try {
      const canvas = await ownerCanvas(
        session.canvas,
        signedIn.viewer,
        channelId
      );
      const found = (await Promise.all(
        projectFolders(canvas).map(
          (folder) => checkoutsOf(git, folder).catch(() => [])
        )
      )).flat();
      const unique = found.filter(
        (checkout, index) => found.findIndex(
          (other) => other.dir === checkout.dir && other.prefix === checkout.prefix
        ) === index
      );
      const taken = await Promise.all(
        unique.map(async (checkout) => {
          const before = await snapshot(git, checkout).catch(() => void 0);
          return before ? {
            ...checkout,
            before,
            ...Date.now() - start > LATE_MS ? { late: true } : {}
          } : void 0;
        })
      );
      record2.checkouts = taken.filter((checkout) => !!checkout);
    } catch {
      record2.checkouts = [];
    }
    if (record2.checkouts.length) {
      for (const other of active)
        for (const ours of record2.checkouts)
          for (const theirs of other.checkouts)
            if (ours.dir === theirs.dir) ours.shared = theirs.shared = true;
      active.add(record2);
      return record2;
    }
    turns = turns.filter((turn) => turn !== record2);
    reindex();
    return void 0;
  }
  async function addedWorktrees(record2) {
    const key = (checkout) => `${checkout.dir}\0${checkout.prefix}`;
    const known2 = new Set(record2.checkouts.map(key));
    const origins = record2.checkouts.slice(0, 10);
    const found = (await Promise.all(
      origins.map(
        (origin) => checkoutsOf(git, origin.dir).then(
          (list) => list.map((checkout) => ({ ...checkout, prefix: origin.prefix })),
          () => []
        )
      )
    )).flat();
    const added = [];
    for (const checkout of found) {
      if (known2.has(key(checkout)) || added.length >= NEW_WORKTREES) continue;
      known2.add(key(checkout));
      const before = await startingTree(git, checkout.dir).catch(
        () => void 0
      );
      if (before) added.push({ ...checkout, before });
    }
    if (added.length) record2.checkouts = nest([...record2.checkouts, ...added]);
  }
  async function finish(record2) {
    await addedWorktrees(record2).catch(() => {
    });
    await Promise.all(
      record2.checkouts.map(async (checkout, index) => {
        const after = await snapshot(git, checkout).catch(() => void 0);
        checkout.files = 0;
        if (!after) return;
        checkout.after = after;
        const files = changedFiles(git, checkout, checkout.before, after);
        remember(`${record2.id}:${index}`, files);
        checkout.files = await files.then(
          (list) => list.length,
          () => 0
        );
      })
    );
    active.delete(record2);
    record2.end = Date.now();
    save();
  }
  const started = /* @__PURE__ */ new Map();
  const ended = /* @__PURE__ */ new Set();
  const known = /* @__PURE__ */ new Set();
  const handed = /* @__PURE__ */ new Map();
  function retire(record2) {
    active.delete(record2);
    turns = turns.filter((turn) => turn !== record2);
    reindex();
  }
  function forget(key) {
    const turn = started.get(key);
    started.delete(key);
    ended.delete(key);
    void turn?.then((record2) => record2 && !record2.end && retire(record2));
  }
  function publish(record2, ids) {
    const next = ids.slice(-KEEP_PUBLISHED);
    if (record2.published?.join() === next.join()) return;
    record2.published = next;
    for (const other of turns)
      if (other !== record2 && other.message && next.includes(other.message.id))
        delete other.message;
    save();
  }
  function watch(session, origin) {
    const signedIn = session.viewer && origin ? { viewer: session.viewer, origin } : void 0;
    if (signedIn?.viewer !== identity?.viewer || signedIn?.origin !== identity?.origin) {
      identity = signedIn;
      for (const key of [...started.keys()]) forget(key);
      known.clear();
      handed.clear();
      notify();
    }
    const activity = session.agentActivity;
    const release = activity.activate();
    const rows = activity.snapshot().local ?? [];
    const present = new Set(rows.map(workKey));
    for (const key of [...started.keys()]) if (!present.has(key)) forget(key);
    for (const key of present) if (!started.has(key)) known.add(key);
    const scan = () => {
      for (const work of activity.snapshot().local ?? []) {
        const key = workKey(work);
        const turn = started.get(key);
        if (turn && work.publishedMessageIds?.length) {
          const ids = work.publishedMessageIds;
          void turn.then((record2) => record2 && publish(record2, ids));
        }
        if (work.state === "waiting" || work.state === "working") {
          if (known.has(key) || turn) continue;
          if (!runsHere(session, work.agent)) {
            known.add(key);
            continue;
          }
          const place = sessionOf(work);
          const inherited = handed.get(place);
          handed.delete(place);
          const opened = inherited ?? begin(
            session,
            signedIn,
            work.agent,
            work.channelId,
            work.thread ? work.threadRootId : void 0
          ).catch(() => void 0);
          started.set(key, opened);
        } else if (turn && !ended.has(key)) {
          ended.add(key);
          if (work.state === "superseded") handed.set(sessionOf(work), turn);
          else void turn.then((record2) => record2 && finish(record2));
        }
      }
    };
    const stop = activity.subscribe(scan);
    scan();
    return () => {
      stop();
      release();
    };
  }
  function load() {
    try {
      const value = JSON.parse(storage.getItem(TURNS_KEY) ?? "[]");
      return Array.isArray(value) ? value.filter(isTurn) : [];
    } catch {
      return [];
    }
  }
  return {
    watch,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    version: () => version,
    flush() {
      if (saving === void 0) return;
      clearTimeout(saving);
      store();
    },
    /** Finds the turn `message` replies to: a later message from the same
     * agent in the same turn takes over its card. */
    claim(message) {
      const at = message.createdAtMs ?? message.createdAt * 1e3;
      const owner = turns.find(
        (turn) => mine(turn) && turn.published?.includes(message.id)
      );
      const all = byChat.get(chatOf(message.authorId, message.channelId));
      if (!owner && !all) return;
      const chat = (owner ? [owner] : all ?? []).filter(
        (turn) => mine(turn) && (owner || (message.threadRootId ? turn.thread === message.threadRootId : !turn.thread))
      );
      let claimed = false;
      chat.forEach((turn, index) => {
        if (!owner) {
          if (at < turn.start - 1e3) return;
          if (turn.end && at > turn.end + GRACE_MS) return;
          const next = chat[index + 1];
          if (next && at >= next.start - 1e3) return;
        }
        if (!turn.message || turn.message.at < at || turn.message.at === at && turn.message.id < message.id) {
          turn.message = { id: message.id, at };
          claimed = true;
        }
      });
      if (claimed) save();
    },
    /** The finished turns whose card `messageId` shows. */
    cardsFor: (messageId) => byMessage.get(messageId)?.filter(mine) ?? NONE,
    summary(id, index) {
      const key = `${id}:${index}`;
      const known2 = summaries.get(key);
      if (known2) return known2;
      try {
        const { checkout, after } = recorded(id, index);
        const files = changedFiles(git, checkout, checkout.before, after);
        remember(key, files);
        return files;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    patch(id, index, file, context) {
      const { checkout, after } = recorded(id, index);
      return filePatch(git, checkout, checkout.before, after, file, context);
    },
    /** A picture's bytes before and after the turn (changesets-plus). */
    async images(id, index, file) {
      const { checkout, after } = recorded(id, index);
      const read = (tree, path) => path === void 0 ? Promise.resolve(void 0) : addedPatch(git, checkout, tree, path).then(addedBytes);
      const [old, now] = await Promise.all([
        file.status === "added" ? void 0 : read(checkout.before, file.from ?? file.path),
        file.status === "deleted" ? void 0 : read(after, file.path)
      ]);
      return { before: old, after: now };
    },
    /** The turn and checkout a panel link names, if this Buzz recorded it. */
    find
  };
}
var strings = (value) => value === void 0 || Array.isArray(value) && value.every((item) => typeof item === "string");
var record = (value) => typeof value === "object" && value !== null;
var isTurn = (value) => record(value) && typeof value.id === "string" && typeof value.agent === "string" && typeof value.channelId === "string" && typeof value.viewer === "string" && typeof value.origin === "string" && (value.thread === void 0 || typeof value.thread === "string") && typeof value.start === "number" && strings(value.published) && Array.isArray(value.checkouts) && value.checkouts.every(
  (checkout) => record(checkout) && typeof checkout.dir === "string" && typeof checkout.prefix === "string" && typeof checkout.label === "string" && strings(checkout.skip) && typeof checkout.before === "string"
);

// src/index.ts
var inject = ["react", "panels", "host", "conversation", "relay", "agents", "settingsCards"];
var PREFS_KEY = "lucas.changesets-plus.prefs.v1";
var DEFAULT_PREFS = Object.freeze({
  layout: "unified",
  size: "md",
  font: "mono",
  context: 3,
  wrap: false
});
var SIZES = { sm: "12px", md: "13px", lg: "15px" };
var FONTS = {
  mono: "var(--font-mono, ui-monospace, monospace)",
  system: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
};
var CONTEXTS = [3, 10, 1e5];
function readPrefs(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(PREFS_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return DEFAULT_PREFS;
    return Object.freeze({
      layout: saved.layout === "split" ? "split" : "unified",
      size: saved.size in SIZES ? saved.size : "md",
      font: saved.font in FONTS ? saved.font : "mono",
      context: CONTEXTS.includes(saved.context) ? saved.context : 3,
      wrap: saved.wrap === true
    });
  } catch {
    return DEFAULT_PREFS;
  }
}
function createPrefs(storage) {
  const listeners = /* @__PURE__ */ new Set();
  let current = readPrefs(storage);
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(change) {
      current = Object.freeze({ ...current, ...change });
      try {
        storage?.setItem(PREFS_KEY, JSON.stringify(current));
      } catch {
      }
      for (const listener of listeners) listener();
    }
  };
}
function wakePlace(turn) {
  return turn.thread ? { channel: turn.channelId, root: turn.thread.toLowerCase() } : { channel: turn.channelId, topLevel: true };
}
function askText(checkout, path, line, question) {
  const where = line ? `line ${line.number} (${line.side === "old" ? "as it was before your change" : "after your change"})` : "this file";
  return [
    `Your owner is asking about a change you made in your last turn here: \`${path}\` in \`${checkout.dir}\`, ${where}.`,
    line ? `The line: \`${line.text.trim().slice(0, 400)}\`` : void 0,
    question.trim() ? `Their question: ${question.trim().slice(0, 2e3)}` : "Explain what this change does and why you made it.",
    "Answer in this conversation."
  ].filter(Boolean).join("\n");
}
var plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;
var totals = (files) => ({
  additions: files.reduce((sum, file) => sum + file.additions, 0),
  deletions: files.reduce((sum, file) => sum + file.deletions, 0)
});
var matchesFilter = (path, filter) => filter.trim().toLowerCase().split(/\s+/).every((part) => path.toLowerCase().includes(part));
function apply(ctx, overrides = {}) {
  const host = ctx.host;
  const storage = overrides.storage ?? globalThis.localStorage;
  const prefs = createPrefs(storage);
  let turns = overrides.turns;
  if (!turns) {
    if (!host.spawn) return;
    turns = createTurns(createGit(host.spawn.bind(host)), storage);
    const live = turns;
    ctx.effect(() => {
      let release;
      let bound;
      const bind = () => {
        const connection = ctx.relay.snapshot();
        const next = connection.status === "ready" ? connection.session : void 0;
        if (next === bound) return;
        release?.();
        bound = next;
        release = next && live.watch(next, connection.origin);
      };
      const stop = ctx.relay.subscribe(bind);
      bind();
      return () => {
        stop();
        release?.();
        live.flush();
      };
    });
  }
  const ui = createUi(ctx.react, turns, prefs, ctx.agents);
  ctx.conversation.registerAccessory({
    id: "changes",
    title: "Changed files",
    placement: "message",
    component: ui.TurnCards
  });
  ctx.panels.register({
    id: "changes",
    title: "Changes",
    matches: (url) => typeof url === "string" && !!parseTarget(url),
    component: ui.Panel
  });
  ctx.settingsCards.register({
    id: "changesets",
    title: "Changesets",
    group: "App",
    component: ui.Settings
  });
}
var UI = { "data-buzz-ui": "" };
function createUi(React, turns, prefs, agents) {
  const h = React.createElement;
  const usePrefs = () => React.useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);
  function useLoaded(load, deps) {
    const [attempt, setAttempt] = React.useState(0);
    const [state, setState] = React.useState({});
    React.useEffect(() => {
      setState({});
      if (!load) return;
      let live = true;
      load().then(
        (value) => live && setState({ value }),
        (error) => live && setState({ error: error instanceof Error ? error.message : String(error) })
      );
      return () => {
        live = false;
      };
    }, [...deps, attempt]);
    return { ...state, retry: () => setAttempt((n) => n + 1) };
  }
  const Button = ({ variant = "subtle", children, ...props }) => h(
    "button",
    { type: "button", ...UI, className: "buzz-button", "data-variant": variant, "data-size": "sm", ...props },
    h("span", { className: "buzz-button-label" }, children)
  );
  const Counts = ({ additions, deletions }) => h(
    "span",
    { style: styles.counts },
    h("span", { style: { color: "var(--text-success, var(--green-11))" } }, `+${additions}`),
    h("span", { style: { color: "var(--text-danger, var(--red-11))" } }, `\u2212${deletions}`)
  );
  const Trailing = ({ file }) => file.binary ? h("span", { style: styles.badge }, imageType(file.path) ? "picture" : "binary") : h(Counts, file);
  const Mark = ({ status }) => h(
    "span",
    {
      title: status,
      "aria-label": status,
      style: {
        ...styles.mark,
        color: status === "added" ? "var(--text-success, var(--green-11))" : status === "deleted" ? "var(--text-danger, var(--red-11))" : "var(--text-secondary)"
      }
    },
    { added: "A", deleted: "D", renamed: "R", modified: "M" }[status]
  );
  function FileRow({ file, active, disabled, onClick }) {
    const cut = file.path.lastIndexOf("/");
    return h(
      "button",
      {
        type: "button",
        style: { ...styles.row, ...active ? styles.rowActive : null },
        title: file.from ? `${file.from} \u2192 ${file.path}` : file.path,
        "aria-current": active ? "true" : void 0,
        disabled,
        onClick
      },
      h(Mark, { status: file.status }),
      h(
        "span",
        { style: styles.path },
        cut >= 0 ? h("span", { style: styles.muted }, file.path.slice(0, cut + 1)) : null,
        file.path.slice(cut + 1)
      ),
      h(Trailing, { file })
    );
  }
  function TurnCards({ message, canOpen, open }) {
    React.useSyncExternalStore(turns.subscribe, turns.version);
    React.useEffect(() => {
      if (message) turns.claim(message);
    });
    const cards = message ? turns.cardsFor(message.id) : [];
    if (!cards.length) return null;
    return h(
      "div",
      { style: styles.cards },
      cards.flatMap(
        (turn) => turn.checkouts.map(
          (checkout, index) => checkout.files ? h(Card, { key: `${turn.id}:${checkout.dir}:${checkout.prefix}`, turn, checkout, index, canOpen, open }) : null
        )
      )
    );
  }
  const FIRST = 8;
  function Card({ turn, checkout, index, canOpen, open }) {
    const [all, setAll] = React.useState(false);
    const { value: files, error, retry } = useLoaded(() => turns.summary(turn.id, index), [turn.id, index]);
    const shown = files && !all ? files.slice(0, FIRST) : files;
    const opens = canOpen(targetFor(turn.id, index));
    return h(
      "section",
      { style: styles.card, "aria-label": `Changeset: ${checkout.label}` },
      h(
        "header",
        { style: styles.header },
        h("strong", { style: { fontWeight: "var(--type-weight-medium, 600)" } }, checkout.label),
        h(
          "span",
          { style: styles.muted },
          files ? `${plural(files.length, "file")} changed ` : plural(checkout.files ?? 0, "file"),
          files ? h(Counts, totals(files)) : null
        )
      ),
      checkout.late ? h("p", { style: styles.note }, "Recording began a moment after the agent started, so its first edits may be missing.") : null,
      checkout.shared ? h("p", { style: styles.note }, "Another agent was working here too, so some of this may not be this turn's.") : null,
      error ? h("div", { role: "alert", style: styles.note }, `Couldn't read this changeset. ${error} `, h(Button, { variant: "ghost", onClick: retry }, "Try again")) : null,
      shown ? h(
        "ul",
        { style: styles.list, "aria-label": "Changed files" },
        shown.map(
          (file) => h("li", { key: file.path }, h(FileRow, { file, disabled: !opens, onClick: () => open(targetFor(turn.id, index, file.path)) }))
        )
      ) : null,
      files && files.length > FIRST ? h(Button, { variant: "ghost", onClick: () => setAll(!all) }, all ? "Show fewer" : `Show all ${files.length} files`) : null
    );
  }
  function Segmented({ label, value, options, onChange }) {
    return h(
      "div",
      { role: "radiogroup", "aria-label": label, style: styles.segmented },
      options.map(
        ([key, text]) => h(Button, { key: String(key), role: "radio", "aria-checked": value === key, variant: value === key ? "prominent" : "subtle", onClick: () => onChange(key) }, text)
      )
    );
  }
  function Panel({ target }) {
    React.useSyncExternalStore(turns.subscribe, turns.version);
    const p = usePrefs();
    const link = React.useMemo(() => parseTarget(target), [target]);
    const found = link && turns.find(link.turn, link.checkout);
    const [chosen, setChosen] = React.useState(link?.file);
    const [filter, setFilter] = React.useState("");
    const [layout, setLayout] = React.useState(void 0);
    React.useEffect(() => setChosen(link?.file), [link?.file]);
    const listed = useLoaded(link ? () => turns.summary(link.turn, link.checkout) : void 0, [link?.turn, link?.checkout]);
    if (!link || !found) return h("p", { role: "alert", style: styles.pad }, "This changeset was recorded in another Buzz.");
    const files = listed.value;
    const visible = files?.filter((file2) => matchesFilter(file2.path, filter)) ?? [];
    const file = files?.find((each) => each.path === chosen) ?? visible[0] ?? files?.[0];
    const at = file ? visible.indexOf(file) : -1;
    const mode = layout ?? p.layout;
    return h(
      "div",
      { style: styles.panel },
      h(
        "header",
        { style: styles.header },
        h("strong", null, found.checkout.label),
        files ? h("span", { style: styles.muted }, `${plural(files.length, "file")} changed `, h(Counts, totals(files))) : null
      ),
      listed.error ? h("div", { role: "alert" }, `Couldn't read this changeset. ${listed.error} `, h(Button, { variant: "ghost", onClick: listed.retry }, "Try again")) : !files ? h("p", { style: styles.muted }, "Reading the changes\u2026") : null,
      files ? h(
        "div",
        { style: styles.toolbar },
        files.length > 1 ? h("input", {
          ...UI,
          className: "buzz-input",
          "data-size": "sm",
          type: "search",
          placeholder: `Filter ${plural(files.length, "file")}`,
          "aria-label": "Filter files",
          value: filter,
          onChange: (e) => setFilter(e.target.value),
          style: { flex: "1 1 10rem", minWidth: 0 }
        }) : null,
        h(Segmented, { label: "Layout", value: mode, options: [["unified", "One column"], ["split", "Side by side"]], onChange: setLayout })
      ) : null,
      files && files.length > 1 ? h(
        "ul",
        { style: styles.panelList, "aria-label": "Changed files" },
        visible.map((each) => h("li", { key: each.path }, h(FileRow, { file: each, active: each === file, onClick: () => setChosen(each.path) }))),
        visible.length ? null : h("li", { style: { ...styles.muted, padding: "var(--space-2)" } }, "No files match.")
      ) : null,
      files && file ? h(
        React.Fragment,
        null,
        h(
          "div",
          { style: styles.fileTitle },
          h(Mark, { status: file.status }),
          h("span", { style: styles.path }, file.from ? `${file.from} \u2192 ${file.path}` : file.path),
          h(Trailing, { file }),
          files.length > 1 ? h(
            "span",
            { style: { display: "flex", gap: "var(--space-1)" } },
            h(Button, { "aria-label": "Previous file", disabled: at <= 0, onClick: () => setChosen(visible[at - 1]?.path) }, "\u2039"),
            h(Button, { "aria-label": "Next file", disabled: at < 0 || at >= visible.length - 1, onClick: () => setChosen(visible[at + 1]?.path) }, "\u203A")
          ) : null
        ),
        h(FileView, { key: `${file.path}:${p.context}`, turn: found.turn, checkout: found.checkout, index: link.checkout, file, prefs: p, layout: mode })
      ) : null
    );
  }
  function FileView({ turn, checkout, index, file, prefs: p, layout }) {
    if (file.binary)
      return imageType(file.path) ? h(Pictures, { turn, index, file }) : h("p", { style: styles.note }, "Binary file: no text diff to show.");
    return h(TextDiff, { turn, checkout, index, file, prefs: p, layout });
  }
  function Pictures({ turn, index, file }) {
    const loaded = useLoaded(() => turns.images(turn.id, index, file), [turn.id, index, file.path]);
    const type = imageType(file.path);
    const urls = React.useMemo(() => {
      const make = (bytes) => bytes ? URL.createObjectURL(new Blob([bytes], { type })) : void 0;
      return loaded.value ? { before: make(loaded.value.before), after: make(loaded.value.after) } : void 0;
    }, [loaded.value]);
    React.useEffect(
      () => () => {
        if (urls?.before) URL.revokeObjectURL(urls.before);
        if (urls?.after) URL.revokeObjectURL(urls.after);
      },
      [urls]
    );
    if (loaded.error) return h("p", { role: "alert", style: styles.note }, `Couldn't read the pictures. ${loaded.error}`);
    if (!urls) return h("p", { style: styles.muted }, "Reading the pictures\u2026");
    const pane = (label, url, size, empty) => h(
      "figure",
      { style: styles.figure },
      h("figcaption", { style: styles.muted }, label, size ? ` \xB7 ${formatSize(size)}` : ""),
      url ? h("img", { src: url, alt: `${file.path}, ${label.toLowerCase()}`, style: styles.image }) : h("div", { style: styles.noImage }, empty)
    );
    return h(
      "div",
      { style: styles.pictures },
      pane("Before", urls.before, loaded.value?.before?.length, file.status === "added" ? "New file" : "Not available"),
      pane("After", urls.after, loaded.value?.after?.length, file.status === "deleted" ? "Deleted" : "Not available")
    );
  }
  function TextDiff({ turn, checkout, index, file, prefs: p, layout }) {
    const [asking, setAsking] = React.useState(void 0);
    const patch = useLoaded(() => turns.patch(turn.id, index, file, p.context), [turn.id, index, file.path, p.context]);
    const hunks = React.useMemo(() => patch.value === void 0 ? [] : parsePatch(patch.value)[0]?.hunks ?? [], [patch.value]);
    if (patch.error)
      return h("div", { role: "alert", style: styles.note }, patch.error, " ", h(Button, { variant: "ghost", onClick: patch.retry }, "Try again"));
    if (patch.value === void 0) return h("p", { style: styles.muted }, `Reading ${file.path}\u2026`);
    if (!hunks.length) return h("p", { style: styles.note }, "No line changes (only the file's mode or name changed).");
    const code = {
      ...styles.code,
      fontFamily: FONTS[p.font],
      fontSize: SIZES[p.size],
      whiteSpace: p.wrap ? "pre-wrap" : "pre",
      overflowWrap: p.wrap ? "anywhere" : "normal"
    };
    const bg = (line) => line?.t === "add" ? "var(--green-3)" : line?.t === "del" ? "var(--red-3)" : "transparent";
    const sign = (line) => h(
      "span",
      { style: { ...styles.sign, color: line.t === "add" ? "var(--green-11)" : "var(--red-11)" } },
      line.t === "add" ? "+" : line.t === "del" ? "\u2212" : " "
    );
    const ask = (line, key) => h(
      "button",
      {
        type: "button",
        style: styles.ask,
        title: "Ask the agent about this line",
        "aria-label": `Ask about line ${line.t === "del" ? line.a : line.b}`,
        onClick: () => setAsking({ key, number: line.t === "del" ? line.a : line.b, side: line.t === "del" ? "old" : "new", text: line.text })
      },
      "Ask"
    );
    const askRow = (key, span) => asking?.key === key ? h(
      "tr",
      { key: `ask:${key}` },
      h("td", { colSpan: span, style: { padding: "var(--space-2)" } }, h(AskBox, { turn, checkout, file, line: asking, onDone: () => setAsking(void 0) }))
    ) : null;
    const hunkRow = (header, key, span) => h("tr", { key }, h("td", { colSpan: span, style: styles.hunk }, header));
    let body;
    if (layout === "split") {
      body = splitRows(hunks).flatMap((row, i) => {
        if ("hunk" in row) return [hunkRow(row.hunk, `h${i}`, 5)];
        const key = `s${i}`;
        const left = row.left && row.left.t !== "add" ? row.left : void 0;
        const right = row.right && row.right.t !== "del" ? row.right : void 0;
        const cell = (line, number) => line ? [
          h("td", { key: "n", style: { ...styles.gutter, background: bg(line) } }, number),
          h("td", { key: "c", style: { ...code, width: "50%", background: bg(line) } }, sign(line), line.text)
        ] : [h("td", { key: "e", colSpan: 2, style: styles.blank })];
        return [
          h(
            "tr",
            { key },
            cell(left, left?.a),
            cell(right, right?.b),
            h("td", { style: styles.askCell }, ask(right ?? left, key))
          ),
          askRow(key, 5)
        ];
      });
    } else {
      body = hunks.flatMap((hunk, n) => [
        hunkRow(hunk.header, `h${n}`, 4),
        ...hunk.lines.flatMap((line, i) => {
          const key = `u${n}:${i}`;
          return [
            h(
              "tr",
              { key },
              h("td", { style: { ...styles.gutter, background: bg(line) } }, line.a ?? ""),
              h("td", { style: { ...styles.gutter, background: bg(line) } }, line.b ?? ""),
              h("td", { style: { ...code, background: bg(line) } }, sign(line), line.text),
              h("td", { style: styles.askCell }, ask(line, key))
            ),
            askRow(key, 4)
          ];
        })
      ]);
    }
    return h("div", { style: styles.scroll }, h("table", { style: styles.table }, h("tbody", null, body)));
  }
  function AskBox({ turn, checkout, file, line, onDone }) {
    const [text, setText] = React.useState("");
    const [error, setError] = React.useState("");
    const running = (agents?.snapshot?.().running ?? []).find((agent) => agent.pubkey === turn.agent);
    const send = () => {
      if (!running) return setError("This agent isn't running on this computer.");
      try {
        agents.wake(running.key, { ...wakePlace(turn), text: askText(checkout, file.path, line, text) });
        onDone();
      } catch (e) {
        setError(`The agent could not be woken: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    return h(
      "form",
      { style: styles.askBox, onSubmit: (e) => (e.preventDefault(), send()) },
      h("span", { style: styles.muted }, `Ask about line ${line.number}`),
      h("textarea", {
        ...UI,
        className: "buzz-textarea",
        rows: 2,
        autoFocus: true,
        placeholder: "Your question (optional)",
        value: text,
        onChange: (e) => setText(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape") onDone();
        }
      }),
      error ? h("span", { role: "alert", style: { color: "var(--text-danger, var(--red-11))" } }, error) : null,
      h(
        "div",
        { style: { display: "flex", gap: "var(--space-1)" } },
        h(Button, { variant: "prominent", type: "submit", disabled: !running }, "Ask agent"),
        h(Button, { onClick: onDone }, "Cancel")
      )
    );
  }
  const SAMPLE = parsePatch(
    [
      "diff --git a/src/greet.js b/src/greet.js",
      "--- a/src/greet.js",
      "+++ b/src/greet.js",
      "@@ -1,3 +1,4 @@",
      "-export function greet(name) {",
      '-  return "Hello " + name;',
      '+export function greet(name = "there") {',
      "+  const who = name.trim();",
      "+  return `Hello, ${who}!`;",
      " }"
    ].join("\n")
  )[0]?.hunks;
  function Sample({ prefs: p }) {
    const code = { ...styles.code, fontFamily: FONTS[p.font], fontSize: SIZES[p.size], whiteSpace: p.wrap ? "pre-wrap" : "pre" };
    const bg = (line) => line?.t === "add" ? "var(--green-3)" : line?.t === "del" ? "var(--red-3)" : "transparent";
    const rows = p.layout === "split" ? splitRows(SAMPLE).flatMap(
      (row, i) => "hunk" in row ? [] : [
        h(
          "tr",
          { key: i },
          ...[row.left?.t === "add" ? void 0 : row.left, row.right?.t === "del" ? void 0 : row.right].flatMap(
            (line, j) => line ? [
              h("td", { key: `n${j}`, style: { ...styles.gutter, background: bg(line) } }, j ? line.b : line.a),
              h("td", { key: `c${j}`, style: { ...code, width: "50%", background: bg(line) } }, line.text)
            ] : [h("td", { key: `e${j}`, colSpan: 2, style: styles.blank })]
          )
        )
      ]
    ) : (SAMPLE[0]?.lines ?? []).map(
      (line, i) => h(
        "tr",
        { key: i },
        h("td", { style: { ...styles.gutter, background: bg(line) } }, line.a ?? ""),
        h("td", { style: { ...styles.gutter, background: bg(line) } }, line.b ?? ""),
        h("td", { style: { ...code, background: bg(line) } }, line.text)
      )
    );
    return h("div", { style: styles.scroll }, h("table", { style: styles.table }, h("tbody", null, rows)));
  }
  function Settings() {
    const p = usePrefs();
    const row = (label, control) => h("div", { style: styles.setting }, h("span", { style: { minWidth: "8rem" } }, label), control);
    return h(
      "div",
      { style: styles.settings },
      h(
        "p",
        { style: styles.muted },
        "How Changesets shows the files your agents change. Changesets are recorded on this computer for agents running here in a chat with project folders, and only you see them."
      ),
      row("Layout", h(Segmented, { label: "Layout", value: p.layout, options: [["unified", "One column"], ["split", "Side by side"]], onChange: (v) => prefs.set({ layout: v }) })),
      row("Text size", h(Segmented, { label: "Text size", value: p.size, options: [["sm", "Small"], ["md", "Medium"], ["lg", "Large"]], onChange: (v) => prefs.set({ size: v }) })),
      row("Font", h(Segmented, { label: "Font", value: p.font, options: [["mono", "Buzz mono"], ["system", "System mono"]], onChange: (v) => prefs.set({ font: v }) })),
      row(
        "Around changes",
        h(Segmented, { label: "Unchanged lines around changes", value: p.context, options: [[3, "3 lines"], [10, "10 lines"], [1e5, "Whole file"]], onChange: (v) => prefs.set({ context: v }) })
      ),
      row("Long lines", h(Segmented, { label: "Long lines", value: p.wrap, options: [[false, "Scroll"], [true, "Wrap"]], onChange: (v) => prefs.set({ wrap: v }) })),
      h("h3", { style: { margin: "var(--space-2) 0 0" } }, "Preview"),
      h(Sample, { prefs: p })
    );
  }
  return { TurnCards, Panel, Settings };
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1 << 20) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1 << 20)).toFixed(1)} MB`;
}
var styles = {
  cards: { display: "grid", gap: "var(--space-2)", marginBlockStart: "var(--space-2)" },
  card: {
    minWidth: 0,
    maxWidth: "min(40rem, 100%)",
    display: "grid",
    gap: "var(--space-2)",
    padding: "var(--space-3)",
    border: "1px solid var(--border-standard)",
    borderRadius: "var(--radius-control)",
    background: "var(--surface-panel)",
    color: "var(--text-standard, var(--text-primary))"
  },
  header: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "var(--space-2)" },
  note: { margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-body-sm)" },
  muted: { color: "var(--text-secondary)" },
  counts: { display: "inline-flex", gap: "var(--space-2)", fontFamily: "var(--font-mono)", fontSize: "var(--text-mono, 12px)", whiteSpace: "nowrap" },
  badge: { fontSize: "var(--text-caption)", padding: "0 var(--space-1)", borderRadius: "var(--radius-control)", background: "var(--surface-inset)", color: "var(--text-secondary)" },
  list: { display: "grid", margin: 0, padding: 0, listStyle: "none" },
  row: {
    all: "unset",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    width: "100%",
    padding: "var(--space-1) var(--space-2)",
    borderRadius: "var(--radius-control)",
    cursor: "pointer",
    fontSize: "var(--text-body-sm, 13px)"
  },
  rowActive: { background: "var(--interaction-fill, var(--surface-inset))" },
  mark: { fontFamily: "var(--font-mono)", fontSize: "var(--text-caption)", width: "1ch", flex: "none" },
  path: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  pad: { padding: "var(--space-3)" },
  panel: { display: "flex", flexDirection: "column", gap: "var(--space-3)", minWidth: 0, minHeight: 0, height: "100%" },
  toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2)" },
  segmented: { display: "flex", flexWrap: "wrap", gap: "var(--space-half, 2px)" },
  panelList: {
    margin: 0,
    padding: "0 0 var(--space-2)",
    listStyle: "none",
    maxHeight: "30%",
    overflow: "auto",
    flex: "none",
    borderBottom: "1px solid var(--border-standard)"
  },
  fileTitle: { display: "flex", alignItems: "center", gap: "var(--space-2)", fontWeight: "var(--type-weight-medium, 600)" },
  scroll: { overflow: "auto", minHeight: 0, flex: 1, border: "1px solid var(--border-standard)", borderRadius: "var(--radius-control)" },
  table: { borderCollapse: "collapse", width: "100%" },
  gutter: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-caption)",
    color: "var(--text-tertiary)",
    textAlign: "right",
    padding: "0 var(--space-1)",
    userSelect: "none",
    verticalAlign: "top",
    width: "1%",
    whiteSpace: "nowrap"
  },
  code: { padding: "0 var(--space-2) 0 var(--space-1)", verticalAlign: "top", lineHeight: 1.5, color: "var(--text-standard, var(--text-primary))" },
  sign: { display: "inline-block", width: "1.5ch", userSelect: "none" },
  blank: { background: "var(--surface-inset)" },
  hunk: { fontFamily: "var(--font-mono)", fontSize: "var(--text-caption)", color: "var(--text-secondary)", background: "var(--surface-inset)", padding: "var(--space-half, 2px) var(--space-2)" },
  askCell: { width: "1%", padding: "0 var(--space-1)", verticalAlign: "top" },
  ask: { all: "unset", cursor: "pointer", fontSize: "var(--text-caption)", color: "var(--text-tertiary)" },
  askBox: { display: "flex", flexDirection: "column", gap: "var(--space-1)" },
  pictures: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "var(--space-3)" },
  figure: { margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)", minWidth: 0 },
  image: {
    maxWidth: "100%",
    height: "auto",
    border: "1px solid var(--border-standard)",
    borderRadius: "var(--radius-control)",
    backgroundColor: "var(--surface-inset)",
    backgroundImage: "linear-gradient(45deg, var(--border-standard) 25%, transparent 25%, transparent 75%, var(--border-standard) 75%), linear-gradient(45deg, var(--border-standard) 25%, transparent 25%, transparent 75%, var(--border-standard) 75%)",
    backgroundSize: "16px 16px",
    backgroundPosition: "0 0, 8px 8px"
  },
  noImage: { padding: "var(--space-4)", textAlign: "center", color: "var(--text-secondary)", border: "1px dashed var(--border-standard)", borderRadius: "var(--radius-control)" },
  settings: { display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-2) 0" },
  setting: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-3)" }
};
export {
  DEFAULT_PREFS,
  addedBytes,
  apply,
  applyDelta,
  askText,
  binaryHunks,
  createPrefs,
  decodeBase85Line,
  imageType,
  inflate,
  inject,
  matchesFilter,
  parsePatch,
  parseTarget,
  plural,
  readPrefs,
  splitRows,
  targetFor,
  totals,
  wakePlace
};
