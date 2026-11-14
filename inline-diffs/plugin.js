// Inline Diffs: API v1 plugin for the Buzz desktop app.
//
// When a Claude Code, Codex or Pi agent running on this computer edits files
// during a turn, the agent's reply gets a "Changeset" card listing each file
// with lines added and removed. Clicking a file opens its changes in a side
// panel (one column or side by side), where "Ask" on a line wakes the agent in
// the same conversation about that line. Settings → Changesets sets the layout,
// text size, font and colours.
//
// How it works:
// 1. Tool hooks: before an edit/write tool runs, the plugin reads the file;
//    after it runs, it reads it again. That pair is saved for the turn.
// 2. Stop hook: closes the turn and finds its conversation from the agent
//    type's saved sessions.
// 3. The card is a message accessory. It shows under the agent's message that
//    ends the turn: the one matching the turn's last assistant message when the
//    agent type reports it, else the agent's latest message in that
//    conversation from the turn's time window.
// Everything stays on this computer (IndexedDB), so only the owner sees it.

export const inject = ["react", "agents", "conversation", "panels", "settingsCards", "host"];

const PREFIX = "lucas.inline-diffs.v1:";
export const TARGET = "buzz-changeset:";
export const HARNESSES = Object.freeze({
  claude: "buzz.claude-code/claude-code",
  codex: "buzz.codex/codex",
  pi: "buzz.pi/pi",
});
const MAX_TEXT_BYTES = 1024 * 1024; // larger files are listed, not diffed
const MAX_TURNS = 150;
const MAX_FILES = 200;
const WINDOW_MS = 2 * 60_000; // a reply may land this long after Stop
const PI_WINDOW_MS = 10 * 60_000;
const PENDING_MS = 10 * 60_000;
const MAX_D = 2000; // Myers edit-distance budget before a whole-block fallback

const pubkeyOf = (key) => String(key ?? "").slice(0, 64).toLowerCase();
const clip = (value, max) => String(value ?? "").slice(0, max);

// ---- Text and diffing -----------------------------------------------------

/** Lines of `text`, without the empty entry after a final newline. */
export function splitLines(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Bytes as text, or null when they look binary (a NUL, or not UTF-8). */
export function decodeText(bytes) {
  if (!bytes) return null;
  const head = bytes.subarray(0, 8000);
  for (let i = 0; i < head.length; i++) if (head[i] === 0) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Myers' diff over two line arrays: [{ t: "eq"|"del"|"add", a?, b?, text }],
 * `a`/`b` being 1-based old/new line numbers. Falls back to a delete-all,
 * add-all block when the edit distance passes `limit`. */
export function diffLines(a, b, limit = MAX_D) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--;
  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ t: "eq", a: i + 1, b: i + 1, text: a[i] });
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const mid = myers(midA, midB, limit) ?? [
    ...midA.map((_, i) => ({ t: "del", x: i })),
    ...midB.map((_, j) => ({ t: "add", y: j })),
  ];
  for (const op of mid) {
    if (op.t === "eq") ops.push({ t: "eq", a: start + op.x + 1, b: start + op.y + 1, text: midA[op.x] });
    else if (op.t === "del") ops.push({ t: "del", a: start + op.x + 1, text: midA[op.x] });
    else ops.push({ t: "add", b: start + op.y + 1, text: midB[op.y] });
  }
  for (let i = 0; i < a.length - endA; i++)
    ops.push({ t: "eq", a: endA + i + 1, b: endB + i + 1, text: a[endA + i] });
  return ops;
}

function myers(a, b, limit) {
  const n = a.length;
  const m = b.length;
  if (!n) return b.map((_, y) => ({ t: "add", y }));
  if (!m) return a.map((_, x) => ({ t: "del", x }));
  const max = Math.min(n + m, limit);
  const off = max + 1;
  const v = new Int32Array(2 * off + 2);
  const trace = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) x++, y++;
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return null;
  const out = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const t = trace[d];
    const at = (k) => t[k + d];
    const k = x - y;
    let prevK;
    if (d === 0) prevK = k;
    else prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) out.push({ t: "eq", x: --x, y: --y });
    if (d > 0) {
      if (x === prevX) out.push({ t: "add", y: --y });
      else out.push({ t: "del", x: --x });
    }
  }
  return out.reverse();
}

/** Lines added and removed between two texts. */
export function countChanges(before, after) {
  let added = 0;
  let removed = 0;
  for (const op of diffLines(splitLines(before), splitLines(after))) {
    if (op.t === "add") added++;
    else if (op.t === "del") removed++;
  }
  return { added, removed };
}

/** Ops grouped for display: changed runs with `context` lines around them,
 * the rest folded into { t: "fold", count, from } rows. context < 0 = all. */
export function foldOps(ops, context = 3) {
  if (context < 0) return ops;
  const keep = new Uint8Array(ops.length);
  ops.forEach((op, i) => {
    if (op.t === "eq") return;
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) keep[j] = 1;
  });
  const out = [];
  for (let i = 0; i < ops.length; ) {
    if (keep[i]) {
      out.push(ops[i++]);
      continue;
    }
    const from = i;
    while (i < ops.length && !keep[i]) i++;
    out.push({ t: "fold", count: i - from, from });
  }
  return out;
}

/** Rows for a side-by-side view: [{ left?, right? }], deletions paired with
 * the additions that follow them. */
export function splitRows(ops) {
  const rows = [];
  for (let i = 0; i < ops.length; ) {
    const op = ops[i];
    if (op.t === "eq" || op.t === "fold") {
      rows.push(op.t === "fold" ? { fold: op } : { left: op, right: op });
      i++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < ops.length && ops[i].t === "del") dels.push(ops[i++]);
    while (i < ops.length && ops[i].t === "add") adds.push(ops[i++]);
    for (let j = 0; j < Math.max(dels.length, adds.length); j++) rows.push({ left: dels[j], right: adds[j] });
  }
  return rows;
}

// ---- What a tool call edits -----------------------------------------------

/** Files named in a Codex `apply_patch` envelope. */
export function parseApplyPatch(text) {
  const files = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line.trim());
    if (m) files.push({ path: m[2].trim(), kind: m[1].toLowerCase() });
    const move = /^\*\*\* Move to: (.+)$/.exec(line.trim());
    if (move && files.length) files.push({ path: move[1].trim(), kind: "add" });
  }
  return files;
}

function findPatch(value, depth = 0) {
  if (typeof value === "string") return value.includes("*** Begin Patch") ? value : null;
  if (!value || typeof value !== "object" || depth > 3) return null;
  for (const item of Object.values(value)) {
    const found = findPatch(item, depth + 1);
    if (found) return found;
  }
  return null;
}

const CLAUDE_EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const PI_EDITS = new Set(["edit", "write"]);

/** The files one tool call may change: [{ path, cwd? }], or [] for other tools.
 * `input` is the harness's native hook input. */
export function editTargets(harness, input) {
  if (!input || typeof input !== "object") return [];
  if (harness === HARNESSES.pi) {
    const call = input.call ?? input;
    const name = String(call?.name ?? "").replace(/^.*__/, "");
    const args = call?.arguments ?? call?.args ?? {};
    const path = args.path ?? args.file_path;
    return PI_EDITS.has(name) && typeof path === "string" && path ? [{ path }] : [];
  }
  const tool = String(input.tool_name ?? "");
  const args = input.tool_input ?? {};
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : undefined;
  const at = (path) => (cwd ? { path, cwd } : { path });
  if (CLAUDE_EDITS.has(tool)) {
    const path = args.file_path ?? args.notebook_path ?? args.path;
    return typeof path === "string" && path ? [at(path)] : [];
  }
  const patch = findPatch(args) ?? (tool === "apply_patch" ? findPatch(input) : null);
  if (patch) return parseApplyPatch(patch).map((file) => at(file.path));
  return [];
}

/** Absolute (or ~/) path for a target, so pre and post reads pair up. */
export function resolvePath({ path, cwd }) {
  if (path.startsWith("/") || path.startsWith("~") || !cwd) return normalize(path);
  return normalize(`${cwd.replace(/\/+$/, "")}/${path}`);
}

function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "." || (part === "" && out.length)) continue;
    if (part === ".." && out.length > 1) out.pop();
    else out.push(part);
  }
  return out.join("/") || "/";
}

/** `path` shown relative to `cwd` when inside it. */
export function displayPath(path, cwd) {
  if (cwd) {
    const base = normalize(cwd).replace(/\/$/, "");
    if (path.startsWith(`${base}/`)) return path.slice(base.length + 1);
  }
  const home = /^\/home\/[^/]+\/|^\/Users\/[^/]+\//.exec(path);
  return home ? `~/${path.slice(home[0].length)}` : path;
}

// ---- Which conversation a session is --------------------------------------

/** { channelId, root? } for a harness session id, read from the agent type's
 * saved sessions (conversation key -> { id | threadId }). */
export function conversationOf(storage, harness, agent, session) {
  if (!storage || !session) return null;
  const pubkey = pubkeyOf(agent);
  const prefix =
    harness === HARNESSES.claude ? "buzz.claude-code.sessions.v1" : harness === HARNESSES.codex ? "buzz.codex.sessions.v" : null;
  if (!prefix) return null;
  let keys = [];
  try {
    keys = storage.keys();
  } catch {
    return null;
  }
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    let value;
    try {
      value = JSON.parse(storage.get(key) ?? "null");
    } catch {
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const own = key.endsWith(`:${agent}`) || key.endsWith(`:${pubkey}`);
    const map = own ? value : key === prefix ? (value[agent] ?? value[pubkey]) : null;
    if (!map || typeof map !== "object") continue;
    for (const [conversation, saved] of Object.entries(map)) {
      if (saved && (saved.id === session || saved.threadId === session)) return parseConversation(conversation);
    }
  }
  return null;
}

export function parseConversation(key) {
  const [channelId, root] = String(key).split("/");
  if (!channelId) return null;
  return root ? { channelId, root: root.toLowerCase() } : { channelId };
}

// ---- Turns ----------------------------------------------------------------

/** A file's entry in a turn, with its counts. */
export function fileEntry(path, display, before, after) {
  const binary = before?.binary || after?.binary;
  const large = (before?.size ?? 0) > MAX_TEXT_BYTES || (after?.size ?? 0) > MAX_TEXT_BYTES;
  const kind = binary ? "binary" : large ? "large" : "text";
  const text = (s) => (kind === "text" && s && !s.binary ? s.text : null);
  const entry = {
    path,
    display,
    kind,
    status: !before?.exists ? (after?.exists ? "added" : "gone") : !after?.exists ? "deleted" : "modified",
    before: text(before),
    after: text(after),
    beforeSize: before?.size ?? 0,
    afterSize: after?.size ?? 0,
    hashBefore: before?.hash ?? "",
    hashAfter: after?.hash ?? "",
    added: 0,
    removed: 0,
  };
  if (kind === "text") Object.assign(entry, countChanges(entry.before ?? "", entry.after ?? ""));
  return entry;
}

/** True when the file ended the turn as it began it. */
export function unchanged(file) {
  if (file.status === "gone") return true;
  if (file.status !== "modified") return false;
  if (file.kind === "text") return (file.before ?? "") === (file.after ?? "");
  return !!file.hashBefore && file.hashBefore === file.hashAfter;
}

export function totals(turn) {
  const files = Object.values(turn.files ?? {});
  return files.reduce(
    (sum, f) => ({ files: sum.files + 1, added: sum.added + f.added, removed: sum.removed + f.removed }),
    { files: 0, added: 0, removed: 0 },
  );
}

const sameRoot = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const messageMs = (message) => message.createdAtMs ?? message.createdAt * 1000;
const rootOf = (message) => String(message.threadRootId ?? message.id).toLowerCase();

const squash = (s) =>
  String(s ?? "")
    .replace(/[*_`#>\[\]()~-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** True when message text is the turn's last assistant message. */
export function sameText(content, last) {
  const a = squash(content);
  const b = squash(last);
  if (a.length < 8 || b.length < 8) return a === b && a.length > 0;
  const n = Math.min(160, a.length, b.length);
  return a.slice(0, n) === b.slice(0, n);
}

/** Turns whose card may go under `message`. `turns` is every saved turn. */
export function candidateTurns(message, turns, now = Date.now()) {
  if (!message?.authorId) return [];
  const author = pubkeyOf(message.authorId);
  if (message.signerId && pubkeyOf(message.signerId) !== author) return [];
  const t = messageMs(message);
  return turns.filter((turn) => {
    if (turn.pubkey !== author || !Object.keys(turn.files ?? {}).length) return false;
    if (turn.claim) return turn.claim.messageId === message.id;
    const conv = turn.conversation;
    if (conv && (conv.channelId !== message.channelId || (conv.root && !sameRoot(conv.root, rootOf(message))))) return false;
    if (turn.harness !== HARNESSES.pi && !turn.stopAt) return false;
    const end = turn.stopAt ? turn.stopAt + WINDOW_MS : turn.lastAt + PI_WINDOW_MS;
    const until = Math.min(end, turn.until ?? Infinity);
    return t >= turn.firstAt - 2000 && t <= until && t <= now + 60_000;
  });
}

// ---- Storage --------------------------------------------------------------

/** IndexedDB holding one record per turn, on this computer only. */
export function idbBackend(name = "lucas.inline-diffs", idb = globalThis.indexedDB) {
  if (!idb) return memoryBackend();
  let opened;
  const db = () =>
    (opened ??= new Promise((resolve, reject) => {
      const request = idb.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("turns", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  const run = async (mode, fn) => {
    const store = (await db()).transaction("turns", mode).objectStore("turns");
    return new Promise((resolve, reject) => {
      const request = fn(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };
  return {
    load: () => run("readonly", (s) => s.getAll()),
    put: (turn) => run("readwrite", (s) => s.put(turn)),
    delete: (id) => run("readwrite", (s) => s.delete(id)),
    close: () => opened?.then((d) => d.close()).catch(() => {}),
  };
}

export function memoryBackend(initial = []) {
  const map = new Map(initial.map((t) => [t.id, t]));
  return {
    map,
    load: async () => [...map.values()],
    put: async (turn) => void map.set(turn.id, structuredClone(turn)),
    delete: async (id) => void map.delete(id),
  };
}

const newId = (random = globalThis.crypto) =>
  `t_${[...random.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

async function sha(bytes) {
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${bytes.length}`;
  }
}

/** What a file holds right now: { exists, size, text?, binary?, hash }. */
export async function snapshotFile(readFile, target) {
  let bytes;
  try {
    bytes = await readFile(target.path, target.cwd ? { cwd: target.cwd } : undefined);
  } catch (error) {
    if (/no such file|not found|enoent/i.test(String(error?.message ?? error))) return { exists: false, size: 0, text: "", hash: "" };
    return null; // unreadable: leave this file out rather than guess
  }
  const size = bytes.length;
  if (size > MAX_TEXT_BYTES) return { exists: true, size, hash: await sha(bytes) };
  const text = decodeText(bytes);
  return text === null
    ? { exists: true, size, binary: true, hash: await sha(bytes) }
    : { exists: true, size, text, hash: await sha(bytes) };
}

/** Turns in memory, written through to `backend`. */
export function createStore(backend, { now = () => Date.now(), random } = {}) {
  const turns = new Map();
  const listeners = new Set();
  let list = [];
  const changed = () => {
    list = [...turns.values()].sort((a, b) => a.firstAt - b.firstAt);
    for (const listener of listeners) listener();
  };
  const save = (turn) => backend.put(turn).catch((e) => console.warn("Inline Diffs: save failed", e));
  const ready = backend
    .load()
    .then((saved) => {
      for (const turn of saved ?? []) if (turn?.id && !turns.has(turn.id)) turns.set(turn.id, turn);
      changed();
    })
    .catch((e) => console.warn("Inline Diffs: load failed", e));

  const openTurn = (agent, session) =>
    [...turns.values()].find((t) => t.agent === agent && t.session === session && !t.stopAt);

  function prune() {
    const sorted = [...turns.values()].sort((a, b) => b.firstAt - a.firstAt);
    for (const turn of sorted.slice(MAX_TURNS)) {
      turns.delete(turn.id);
      void backend.delete(turn.id).catch(() => {});
    }
  }

  return {
    ready,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    list: () => list,
    get: (id) => turns.get(id),
    openTurn,
    /** Adds one file change to the agent session's open turn. */
    record({ agent, session, harness, path, display, before, after }) {
      const at = now();
      let turn = openTurn(agent, session);
      if (!turn) {
        // A new turn starts after the last one in this session ended.
        for (const t of turns.values())
          if (t.agent === agent && t.session === session && t.stopAt && !t.until) {
            t.until = at;
            void save(t);
          }
        turn = {
          id: newId(random),
          agent,
          pubkey: pubkeyOf(agent),
          harness,
          session,
          conversation: null,
          firstAt: at,
          lastAt: at,
          stopAt: null,
          lastMessage: null,
          claim: null,
          files: {},
        };
      }
      const prior = turn.files[path];
      const first = prior
        ? {
            exists: prior.status !== "added" && prior.status !== "gone",
            size: prior.beforeSize,
            text: prior.before ?? undefined,
            binary: prior.kind === "binary",
            hash: prior.hashBefore,
          }
        : before;
      if (prior?.kind === "large") first.size = Math.max(first.size, MAX_TEXT_BYTES + 1);
      const entry = fileEntry(path, display, first, after);
      if (unchanged(entry)) delete turn.files[path];
      else if (Object.keys(turn.files).length < MAX_FILES || prior) turn.files[path] = entry;
      turn.lastAt = at;
      turns.set(turn.id, turn);
      void save(turn);
      changed();
      return turn;
    },
    /** Ends the session's open turn. Turns without changes are dropped. */
    stop({ agent, session, lastMessage, conversation }) {
      const turn = openTurn(agent, session);
      if (!turn) return undefined;
      if (!Object.keys(turn.files).length) {
        turns.delete(turn.id);
        void backend.delete(turn.id).catch(() => {});
        changed();
        return undefined;
      }
      turn.stopAt = now();
      if (typeof lastMessage === "string" && lastMessage.trim()) turn.lastMessage = clip(lastMessage, 4000);
      if (conversation) turn.conversation = conversation;
      void save(turn);
      prune();
      changed();
      return turn;
    },
    /** Fixes the card to `message` for good. */
    claim(id, message) {
      const turn = turns.get(id);
      if (!turn || turn.claim?.messageId === message.id) return;
      turn.claim = { messageId: message.id, channelId: message.channelId, root: rootOf(message) };
      if (!turn.stopAt) turn.stopAt = now(); // Pi: the reply ends the turn
      void save(turn);
      changed();
    },
    setConversation(id, conversation) {
      const turn = turns.get(id);
      if (!turn || !conversation) return;
      turn.conversation = conversation;
      void save(turn);
      changed();
    },
  };
}

// ---- Hooks ----------------------------------------------------------------

/** The tool hooks: pre reads the file, post reads it again and records both. */
export function createRecorder({ store, readFile, storage, now = () => Date.now() }) {
  const pending = new Map();
  const sweep = () => {
    const t = now();
    for (const [key, value] of pending) if (t - value.at > PENDING_MS) pending.delete(key);
  };
  const callId = (harness, input) =>
    String((harness === HARNESSES.pi ? (input?.call ?? input)?.id : input?.tool_use_id) ?? "");
  const keyOf = (agent, session, id, path) => `${agent}|${session}|${id}|${path}`;

  return {
    async before(harness, input, { agent, session }) {
      try {
        const targets = editTargets(harness, input);
        if (!targets.length) return undefined;
        sweep();
        const id = callId(harness, input);
        await Promise.all(
          targets.map(async (target) => {
            const path = resolvePath(target);
            const snapshot = await snapshotFile(readFile, { path });
            if (snapshot) pending.set(keyOf(agent, session, id, path), { snapshot, at: now() });
          }),
        );
      } catch (e) {
        console.warn("Inline Diffs: pre-tool read failed", e);
      }
      return undefined;
    },
    async after(harness, input, { agent, session }) {
      try {
        const targets = editTargets(harness, input);
        if (!targets.length) return undefined;
        const id = callId(harness, input);
        const seen = new Set();
        for (const target of targets) {
          const path = resolvePath(target);
          if (seen.has(path)) continue;
          seen.add(path);
          const key = keyOf(agent, session, id, path);
          const before = pending.get(key)?.snapshot ?? claudeOriginal(input);
          pending.delete(key);
          if (!before) continue; // never saw it before the edit: no honest diff
          const after = await snapshotFile(readFile, { path });
          if (!after) continue;
          store.record({ agent, session, harness, path, display: displayPath(path, target.cwd), before, after });
        }
      } catch (e) {
        console.warn("Inline Diffs: post-tool read failed", e);
      }
      return undefined;
    },
    stop(harness, input, { agent, session }) {
      try {
        store.stop({
          agent,
          session,
          lastMessage: input?.last_assistant_message,
          conversation: conversationOf(storage, harness, agent, session),
        });
      } catch (e) {
        console.warn("Inline Diffs: stop failed", e);
      }
      return undefined;
    },
  };
}

/** Claude reports the file before an Edit in `tool_response.originalFile`. */
function claudeOriginal(input) {
  const original = input?.tool_response?.originalFile;
  if (typeof original !== "string") return null;
  return { exists: true, size: original.length, text: original, hash: "" };
}

// ---- Asking about a line --------------------------------------------------

export function askText(turn, file, line, question) {
  const where = line ? `line ${line.number} (${line.side === "old" ? "before your change" : "after your change"})` : "this file";
  return [
    `Your owner is asking about a change you made in this conversation: \`${file.display}\`, ${where}.`,
    line ? `The line: \`${clip(line.text, 400).trim()}\`` : null,
    question?.trim() ? `Their question: ${clip(question.trim(), 2000)}` : "Explain what this change does and why you made it.",
    "Answer in this conversation.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---- Preferences ----------------------------------------------------------

export const DEFAULT_PREFS = Object.freeze({
  layout: "unified",
  size: "md",
  font: "mono",
  colors: "standard",
  wrap: false,
  context: 3,
});
const SIZES = { sm: "12px", md: "13px", lg: "15px" };
const FONTS = {
  mono: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  system: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  sans: "var(--font-sans, system-ui, sans-serif)",
};
const PALETTES = {
  standard: { add: "var(--green-3)", addMark: "var(--green-11)", del: "var(--red-3)", delMark: "var(--red-11)" },
  strong: { add: "var(--green-5)", addMark: "var(--green-12)", del: "var(--red-5)", delMark: "var(--red-12)" },
  colorblind: { add: "var(--blue-4, #dbeafe)", addMark: "var(--blue-11, #1d4ed8)", del: "var(--orange-4, #ffedd5)", delMark: "var(--orange-11, #c2410c)" },
};

export function readPrefs(storage) {
  try {
    const saved = JSON.parse(storage?.get(`${PREFIX}prefs`) ?? "null");
    if (!saved || typeof saved !== "object") return DEFAULT_PREFS;
    const p = { ...DEFAULT_PREFS };
    if (saved.layout === "split" || saved.layout === "unified") p.layout = saved.layout;
    if (SIZES[saved.size]) p.size = saved.size;
    if (FONTS[saved.font]) p.font = saved.font;
    if (PALETTES[saved.colors]) p.colors = saved.colors;
    if (typeof saved.wrap === "boolean") p.wrap = saved.wrap;
    if ([3, 10, -1].includes(saved.context)) p.context = saved.context;
    return Object.freeze(p);
  } catch {
    return DEFAULT_PREFS;
  }
}

function createPrefs(storage) {
  const listeners = new Set();
  let current = readPrefs(storage);
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async set(change) {
      current = Object.freeze({ ...current, ...change });
      for (const l of listeners) l();
      await storage?.set(`${PREFIX}prefs`, JSON.stringify(current));
    },
  };
}

// ---- Plugin ---------------------------------------------------------------

export function apply(ctx, { backend } = {}) {
  const { agents, conversation, panels, settingsCards, host } = ctx;
  const React = ctx.react;
  const store = createStore(backend ?? idbBackend());
  const prefs = createPrefs(agents.storage);
  const readFile = host.readFile ? host.readFile.bind(host) : async () => {
    throw new Error("No file access");
  };
  const recorder = createRecorder({ store, readFile, storage: agents.storage });
  ctx.effect?.(() => () => void backend?.close?.());

  const hooks = [
    [HARNESSES.claude, "PreToolUse", "before"],
    [HARNESSES.claude, "PostToolUse", "after"],
    [HARNESSES.claude, "Stop", "stop"],
    [HARNESSES.codex, "PreToolUse", "before"],
    [HARNESSES.codex, "PostToolUse", "after"],
    [HARNESSES.codex, "Stop", "stop"],
    [HARNESSES.pi, "beforeTool", "before"],
    [HARNESSES.pi, "afterTool", "after"],
  ];
  for (const [harness, event, method] of hooks) {
    try {
      agents.registerHook({
        // Ids are unique per plugin, not per agent type.
        id: `${harness.split("/")[1]}-${event}`.toLowerCase(),
        harness,
        event,
        run: (input, context) => recorder[method](harness, input, context),
      });
    } catch (error) {
      // The agent type isn't installed or its hooks aren't granted.
      console.warn(`Inline Diffs: ${harness} ${event} hook unavailable`, error);
    }
  }

  const ui = createUi(React, { store, prefs, agents });

  conversation.registerAccessory({
    id: "changeset",
    title: "Changeset",
    placement: "message",
    order: 50,
    component: ui.Card,
  });

  panels.register({
    id: "changeset",
    title: "Changes",
    matches: (target) => typeof target === "string" && target.startsWith(TARGET) && !!store.get(parseTarget(target).turn),
    component: ui.Panel,
  });

  settingsCards.register({
    id: "changesets",
    title: "Changesets",
    group: "App",
    component: ui.Settings,
  });
}

export function panelTarget(turnId, path) {
  return `${TARGET}${turnId}${path ? `?file=${encodeURIComponent(path)}` : ""}`;
}

export function parseTarget(target) {
  const rest = String(target).slice(TARGET.length);
  const [turn, query = ""] = rest.split("?");
  const file = new URLSearchParams(query).get("file");
  return { turn, file: file ?? null };
}

// ---- UI -------------------------------------------------------------------

const UI = { "data-buzz-ui": "" };

function createUi(React, { store, prefs, agents }) {
  const h = React.createElement;
  const useTurns = () => React.useSyncExternalStore(store.subscribe, store.list, store.list);
  const usePrefs = () => React.useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);

  // Candidate messages per turn, so the card shows only under the latest one.
  const seen = new Map();
  const seenListeners = new Set();
  let seenVersion = 0;
  const seenChanged = () => {
    seenVersion++;
    for (const l of seenListeners) l();
  };
  const subscribeSeen = (l) => (seenListeners.add(l), () => seenListeners.delete(l));
  const useSeen = () => React.useSyncExternalStore(subscribeSeen, () => seenVersion, () => seenVersion);

  const Button = ({ variant = "subtle", size = "sm", children, ...props }) =>
    h(
      "button",
      { type: "button", ...UI, className: "buzz-button", "data-variant": variant, "data-size": size, ...props },
      h("span", { className: "buzz-button-label" }, children),
    );

  const Counts = ({ added, removed, kind }) =>
    kind && kind !== "text"
      ? h("span", { style: styles.badge }, kind === "binary" ? "Binary" : "Too large to show")
      : h(
          "span",
          { style: styles.counts },
          h("span", { style: { color: "var(--green-11)" } }, `+${added}`),
          h("span", { style: { color: "var(--red-11)" } }, `−${removed}`),
        );

  function Card({ message, open, canOpen }) {
    const turns = useTurns();
    useSeen();
    const [expanded, setExpanded] = React.useState(false);
    const mine = React.useMemo(() => (message ? candidateTurns(message, turns) : []), [message, turns]);

    React.useEffect(() => {
      if (!message) return;
      const t = messageMs(message);
      for (const turn of mine) {
        if (turn.claim) continue;
        if (turn.lastMessage && sameText(message.content, turn.lastMessage)) {
          store.claim(turn.id, message);
          continue;
        }
        let byTurn = seen.get(turn.id);
        if (!byTurn) seen.set(turn.id, (byTurn = new Map()));
        if (!byTurn.has(message.id)) {
          byTurn.set(message.id, t);
          seenChanged();
        }
        // A message at or after Stop is the reply; keep the card there.
        if (turn.stopAt && t >= turn.stopAt - 10_000 && !turn.lastMessage) store.claim(turn.id, message);
      }
      return () => {
        for (const turn of mine) {
          if (seen.get(turn.id)?.delete(message.id)) seenChanged();
        }
      };
    }, [message, mine]);

    if (!message) return null;
    // Unclaimed: the agent's latest message in the turn's window gets the card.
    const shown = mine.filter(
      (turn) => turn.claim || Math.max(...(seen.get(turn.id)?.values() ?? [0])) === messageMs(message),
    );
    if (!shown.length) return null;

    return h(
      React.Fragment,
      null,
      shown.map((turn) => {
        const files = Object.values(turn.files).sort((a, b) => a.display.localeCompare(b.display));
        const sum = totals(turn);
        const visible = expanded ? files : files.slice(0, 8);
        const openFile = (path) => {
          if (!turn.claim) store.claim(turn.id, message);
          open?.(panelTarget(turn.id, path));
        };
        return h(
          "section",
          { key: turn.id, style: styles.card, "aria-label": "Changeset" },
          h(
            "header",
            { style: styles.cardHeader },
            h("span", { style: { fontWeight: "var(--type-weight-medium, 600)" } }, "Changeset"),
            h(
              "span",
              { style: styles.muted },
              `${sum.files} file${sum.files === 1 ? "" : "s"} changed`,
            ),
            h(Counts, { added: sum.added, removed: sum.removed }),
            h("span", { style: { flex: 1 } }),
            h("span", { style: styles.private, title: "Only you see this card. It is built from this computer." }, "Only you"),
          ),
          h(
            "ul",
            { style: styles.fileList },
            visible.map((file) =>
              h(
                "li",
                { key: file.path },
                h(
                  "button",
                  {
                    type: "button",
                    style: styles.fileRow,
                    title: file.path,
                    disabled: canOpen && !canOpen(panelTarget(turn.id, file.path)),
                    onClick: () => openFile(file.path),
                  },
                  h(StatusMark, { status: file.status }),
                  h(PathLabel, { path: file.display }),
                  h(Counts, file),
                ),
              ),
            ),
          ),
          files.length > 8
            ? h(Button, { variant: "plain", onClick: () => setExpanded(!expanded) }, expanded ? "Show fewer" : `Show all ${files.length} files`)
            : null,
        );
      }),
    );
  }

  const StatusMark = ({ status }) =>
    h(
      "span",
      {
        "aria-label": status,
        title: status,
        style: {
          ...styles.status,
          color: status === "added" ? "var(--green-11)" : status === "deleted" ? "var(--red-11)" : "var(--text-secondary)",
        },
      },
      status === "added" ? "A" : status === "deleted" ? "D" : "M",
    );

  function PathLabel({ path }) {
    const i = path.lastIndexOf("/");
    return h(
      "span",
      { style: styles.path },
      i >= 0 ? h("span", { style: styles.muted }, path.slice(0, i + 1)) : null,
      h("span", null, path.slice(i + 1)),
    );
  }

  function Panel({ target }) {
    const turns = useTurns();
    const p = usePrefs();
    const { turn: turnId, file: initial } = parseTarget(target);
    const turn = turns.find((t) => t.id === turnId);
    const files = React.useMemo(
      () => (turn ? Object.values(turn.files).sort((a, b) => a.display.localeCompare(b.display)) : []),
      [turn],
    );
    const [selected, setSelected] = React.useState(initial);
    const [filter, setFilter] = React.useState("");
    const [layout, setLayout] = React.useState(null);
    React.useEffect(() => setSelected(initial), [initial]);
    if (!turn) return h("p", { style: { padding: "var(--space-4)" } }, "This changeset is no longer on this computer.");
    const shownFiles = files.filter((f) => f.display.toLowerCase().includes(filter.trim().toLowerCase()));
    const file = files.find((f) => f.path === selected) ?? shownFiles[0] ?? files[0];
    const sum = totals(turn);
    const mode = layout ?? p.layout;
    return h(
      "div",
      { style: styles.panel },
      h(
        "div",
        { style: styles.toolbar },
        h("input", {
          ...UI,
          className: "buzz-input",
          "data-size": "sm",
          type: "search",
          placeholder: `Filter ${sum.files} file${sum.files === 1 ? "" : "s"}`,
          "aria-label": "Filter files",
          value: filter,
          onChange: (e) => setFilter(e.target.value),
          style: { flex: "1 1 10rem", minWidth: 0 },
        }),
        h(Segmented, {
          label: "Layout",
          value: mode,
          options: [
            ["unified", "One column"],
            ["split", "Side by side"],
          ],
          onChange: setLayout,
        }),
      ),
      h(
        "ul",
        { style: styles.panelFiles, "aria-label": "Changed files" },
        shownFiles.map((f) =>
          h(
            "li",
            { key: f.path },
            h(
              "button",
              {
                type: "button",
                style: { ...styles.fileRow, ...(f === file ? styles.fileRowActive : null) },
                "aria-current": f === file ? "true" : undefined,
                onClick: () => setSelected(f.path),
                title: f.path,
              },
              h(StatusMark, { status: f.status }),
              h(PathLabel, { path: f.display }),
              h(Counts, f),
            ),
          ),
        ),
        !shownFiles.length ? h("li", { style: { ...styles.muted, padding: "var(--space-2)" } }, "No files match.") : null,
      ),
      file ? h(FileDiff, { key: file.path, turn, file, prefs: p, layout: mode }) : null,
    );
  }

  function Segmented({ label, value, options, onChange }) {
    return h(
      "div",
      { role: "radiogroup", "aria-label": label, style: { display: "flex", gap: "var(--space-half, 2px)", flexWrap: "wrap" } },
      options.map(([key, text]) =>
        h(
          Button,
          {
            key: String(key),
            role: "radio",
            "aria-checked": value === key,
            variant: value === key ? "prominent" : "subtle",
            onClick: () => onChange(key),
          },
          text,
        ),
      ),
    );
  }

  function FileDiff({ turn, file, prefs: p, layout, sample }) {
    const [unfolded, setUnfolded] = React.useState(false);
    const [asking, setAsking] = React.useState(null);
    const ops = React.useMemo(
      () => (file.kind === "text" ? diffLines(splitLines(file.before ?? ""), splitLines(file.after ?? "")) : []),
      [file],
    );
    const rows = React.useMemo(() => foldOps(ops, unfolded ? -1 : p.context), [ops, unfolded, p.context]);
    const palette = PALETTES[p.colors];
    const codeStyle = {
      ...styles.code,
      fontFamily: FONTS[p.font],
      fontSize: SIZES[p.size],
      whiteSpace: p.wrap ? "pre-wrap" : "pre",
      overflowWrap: p.wrap ? "anywhere" : "normal",
    };
    if (file.kind !== "text")
      return h(
        "div",
        { style: styles.notice },
        file.kind === "binary"
          ? `Binary file ${file.status}: ${formatSize(file.beforeSize)} → ${formatSize(file.afterSize)}. Pictures show before and after in a later version.`
          : `This file is too large to show here (${formatSize(Math.max(file.beforeSize, file.afterSize))}).`,
      );
    if (!ops.some((op) => op.t !== "eq")) return h("div", { style: styles.notice }, "No line changes.");

    const askButton = (line) =>
      sample
        ? null
        : h(
            "button",
            {
              type: "button",
              className: "inline-diffs-ask",
              style: styles.ask,
              title: "Ask the agent about this line",
              "aria-label": `Ask about line ${line.number}`,
              onClick: () => setAsking(line),
            },
            "Ask",
          );

    const lineCell = (op, side) => {
      if (!op) return h("td", { colSpan: 2, style: { ...styles.empty } });
      const bg = op.t === "add" ? palette.add : op.t === "del" ? palette.del : "transparent";
      const number = side === "old" ? op.a : side === "new" ? op.b : null;
      return [
        h("td", { key: "n", style: { ...styles.gutter, background: bg } }, number ?? ""),
        h(
          "td",
          { key: "c", style: { ...codeStyle, background: bg } },
          h("span", { style: { ...styles.mark, color: op.t === "add" ? palette.addMark : palette.delMark } }, op.t === "add" ? "+" : op.t === "del" ? "−" : " "),
          op.text,
        ),
      ];
    };

    const lineInfo = (op) => ({
      number: op.t === "del" ? op.a : op.b,
      side: op.t === "del" ? "old" : "new",
      text: op.text,
    });

    const foldRow = (op, span) =>
      h(
        "tr",
        { key: `f${op.from}` },
        h(
          "td",
          { colSpan: span, style: styles.fold },
          h(Button, { variant: "plain", onClick: () => setUnfolded(true) }, `Show ${op.count} unchanged line${op.count === 1 ? "" : "s"}`),
        ),
      );

    const askRow = (key, span) =>
      asking && asking.key === key
        ? h(
            "tr",
            { key: `ask-${key}` },
            h("td", { colSpan: span, style: { padding: "var(--space-2)" } }, h(AskBox, { turn, file, line: asking, onDone: () => setAsking(null) })),
          )
        : null;

    let body;
    if (layout === "split") {
      body = splitRows(rows).flatMap((row, i) => {
        if (row.fold) return [foldRow(row.fold, 5)];
        const key = `s${i}`;
        const target = row.right ?? row.left;
        return [
          h(
            "tr",
            { key, className: "inline-diffs-row" },
            lineCell(row.left?.t === "add" ? null : row.left, "old"),
            lineCell(row.right?.t === "del" ? null : row.right, "new"),
            h("td", { style: styles.askCell }, askButton({ ...lineInfo(target), key })),
          ),
          askRow(key, 5),
        ];
      });
    } else {
      body = rows.flatMap((op, i) => {
        if (op.t === "fold") return [foldRow(op, 4)];
        const key = `u${i}`;
        const bg = op.t === "add" ? palette.add : op.t === "del" ? palette.del : "transparent";
        return [
          h(
            "tr",
            { key, className: "inline-diffs-row" },
            h("td", { style: { ...styles.gutter, background: bg } }, op.a ?? ""),
            h("td", { style: { ...styles.gutter, background: bg } }, op.b ?? ""),
            h(
              "td",
              { style: { ...codeStyle, background: bg } },
              h("span", { style: { ...styles.mark, color: op.t === "add" ? palette.addMark : palette.delMark } }, op.t === "add" ? "+" : op.t === "del" ? "−" : " "),
              op.text,
            ),
            h("td", { style: styles.askCell }, askButton({ ...lineInfo(op), key })),
          ),
          askRow(key, 4),
        ];
      });
    }
    return h(
      "div",
      { style: styles.diffWrap },
      sample ? null : h("div", { style: styles.diffTitle }, h(StatusMark, { status: file.status }), h(PathLabel, { path: file.display }), h(Counts, file)),
      h("div", { style: styles.scroll }, h("table", { style: styles.table }, h("tbody", null, body))),
    );
  }

  function AskBox({ turn, file, line, onDone }) {
    const [text, setText] = React.useState("");
    const [state, setState] = React.useState({ busy: false, error: "" });
    const claim = turn.claim;
    const running = (agents.snapshot?.().running ?? []).find((a) => a.key === turn.agent);
    const send = () => {
      if (!claim) return setState({ busy: false, error: "Open this file from the card under the agent's reply first." });
      setState({ busy: true, error: "" });
      try {
        agents.wake(turn.agent, { channel: claim.channelId, root: claim.root, text: askText(turn, file, line, text) });
        onDone();
      } catch (e) {
        setState({ busy: false, error: `The agent could not be woken: ${e?.message ?? e}` });
      }
    };
    return h(
      "form",
      {
        style: { display: "flex", flexDirection: "column", gap: "var(--space-1)" },
        onSubmit: (e) => (e.preventDefault(), send()),
      },
      h("span", { style: styles.muted }, `Ask about line ${line.number}${running ? "" : " (the agent isn't running on this computer)"}`),
      h("textarea", {
        ...UI,
        className: "buzz-textarea",
        rows: 2,
        autoFocus: true,
        placeholder: "Your question (optional)",
        value: text,
        onChange: (e) => setText(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), send());
          if (e.key === "Escape") onDone();
        },
      }),
      state.error ? h("span", { role: "alert", style: { color: "var(--red-11)" } }, state.error) : null,
      h(
        "div",
        { style: { display: "flex", gap: "var(--space-1)" } },
        h(Button, { variant: "prominent", type: "submit", disabled: state.busy || !running }, "Ask agent"),
        h(Button, { onClick: onDone }, "Cancel"),
      ),
    );
  }

  const SAMPLE = {
    path: "src/greeting.js",
    display: "src/greeting.js",
    kind: "text",
    status: "modified",
    before: 'export function greet(name) {\n  return "Hello " + name;\n}\n',
    after: 'export function greet(name = "there") {\n  const who = name.trim();\n  return `Hello, ${who}!`;\n}\n',
    added: 3,
    removed: 2,
  };

  function Settings() {
    const p = usePrefs();
    const row = (label, control) =>
      h("div", { style: styles.settingRow }, h("span", { style: { minWidth: "8rem" } }, label), control);
    return h(
      "div",
      { style: styles.settings },
      h(
        "p",
        { style: styles.muted },
        "How the Changeset panel shows an agent's changes. Changesets are made on this computer from your Claude Code, Codex and Pi agents, and only you see them.",
      ),
      row("Layout", h(Segmented, { label: "Layout", value: p.layout, options: [["unified", "One column"], ["split", "Side by side"]], onChange: (v) => prefs.set({ layout: v }) })),
      row("Text size", h(Segmented, { label: "Text size", value: p.size, options: [["sm", "Small"], ["md", "Medium"], ["lg", "Large"]], onChange: (v) => prefs.set({ size: v }) })),
      row("Font", h(Segmented, { label: "Font", value: p.font, options: [["mono", "Buzz mono"], ["system", "System mono"], ["sans", "Sans"]], onChange: (v) => prefs.set({ font: v }) })),
      row("Colors", h(Segmented, { label: "Colors", value: p.colors, options: [["standard", "Standard"], ["strong", "Strong"], ["colorblind", "Blue and orange"]], onChange: (v) => prefs.set({ colors: v }) })),
      row("Context", h(Segmented, { label: "Unchanged lines around changes", value: p.context, options: [[3, "3 lines"], [10, "10 lines"], [-1, "Whole file"]], onChange: (v) => prefs.set({ context: v }) })),
      row("Long lines", h(Segmented, { label: "Long lines", value: p.wrap, options: [[false, "Scroll"], [true, "Wrap"]], onChange: (v) => prefs.set({ wrap: v }) })),
      h("h3", { style: { margin: "var(--space-2) 0 0" } }, "Preview"),
      h("div", { style: { ...styles.card, maxWidth: "100%", width: "100%" } }, h(FileDiff, { file: SAMPLE, prefs: p, layout: p.layout, sample: true })),
    );
  }

  return { Card, Panel, Settings };
}

function formatSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const styles = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1)",
    width: "fit-content",
    minWidth: "min(22rem, 100%)",
    maxWidth: "min(40rem, 100%)",
    boxSizing: "border-box",
    marginTop: "var(--space-1)",
    padding: "var(--space-2) var(--space-3)",
    border: "1px solid var(--border-standard)",
    borderRadius: "var(--radius-control)",
    background: "var(--surface-panel)",
  },
  cardHeader: { display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" },
  private: { fontSize: "var(--text-caption)", color: "var(--text-tertiary)" },
  muted: { color: "var(--text-secondary)" },
  counts: { display: "inline-flex", gap: "var(--space-1)", fontFamily: "var(--font-mono)", fontSize: "var(--text-caption)", whiteSpace: "nowrap" },
  badge: {
    fontSize: "var(--text-caption)",
    padding: "0 var(--space-1)",
    borderRadius: "var(--radius-control)",
    background: "var(--surface-inset)",
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
  },
  fileList: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" },
  fileRow: {
    all: "unset",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    width: "100%",
    padding: "var(--space-half, 2px) var(--space-1)",
    borderRadius: "var(--radius-control)",
    cursor: "pointer",
    fontSize: "var(--text-body-sm, 13px)",
  },
  fileRowActive: { background: "var(--interaction-fill, var(--surface-inset))" },
  status: { fontFamily: "var(--font-mono)", fontSize: "var(--text-caption)", width: "1ch", flex: "none" },
  path: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr" },
  panel: { display: "flex", flexDirection: "column", gap: "var(--space-2)", height: "100%", minHeight: 0, padding: "var(--space-2)", boxSizing: "border-box" },
  toolbar: { display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" },
  panelFiles: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    maxHeight: "30%",
    overflow: "auto",
    flex: "none",
    borderBottom: "1px solid var(--border-standard)",
    paddingBottom: "var(--space-1)",
  },
  diffWrap: { display: "flex", flexDirection: "column", gap: "var(--space-1)", minHeight: 0, flex: 1 },
  diffTitle: { display: "flex", alignItems: "center", gap: "var(--space-2)", fontWeight: "var(--type-weight-medium, 600)" },
  scroll: { overflow: "auto", minHeight: 0, flex: 1, border: "1px solid var(--border-standard)", borderRadius: "var(--radius-control)" },
  table: { borderCollapse: "collapse", width: "100%", tableLayout: "auto" },
  gutter: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-caption)",
    color: "var(--text-tertiary)",
    textAlign: "right",
    padding: "0 var(--space-1)",
    userSelect: "none",
    verticalAlign: "top",
    width: "1%",
    whiteSpace: "nowrap",
  },
  code: { padding: "0 var(--space-2) 0 var(--space-1)", verticalAlign: "top", lineHeight: 1.5, color: "var(--text-primary)", width: "50%" },
  mark: { display: "inline-block", width: "1.5ch", userSelect: "none" },
  empty: { background: "var(--surface-inset)" },
  fold: { textAlign: "center", background: "var(--surface-inset)", padding: "var(--space-half, 2px)" },
  askCell: { width: "1%", padding: "0 var(--space-1)", verticalAlign: "top" },
  ask: {
    all: "unset",
    cursor: "pointer",
    fontSize: "var(--text-caption)",
    color: "var(--text-tertiary)",
    padding: "0 var(--space-1)",
  },
  notice: { padding: "var(--space-3)", color: "var(--text-secondary)", border: "1px dashed var(--border-standard)", borderRadius: "var(--radius-control)" },
  settings: { display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-2) 0" },
  settingRow: { display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" },
};
