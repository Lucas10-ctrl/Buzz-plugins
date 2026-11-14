// @vitest-environment node
// Tests for what changesets-plus adds to Buzz's Changesets.
import { deflateSync } from "node:zlib";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Checkout, addedPatch, changedFiles, filePatch, snapshot } from "./git";
import {
  DEFAULT_PREFS,
  askText,
  createPrefs,
  matchesFilter,
  readPrefs,
  wakePlace,
} from "./index";
import {
  addedBytes,
  applyDelta,
  binaryHunks,
  decodeBase85Line,
  imageType,
  parsePatch,
  splitRows,
} from "./patch";
import { only, realGit, repo, sh } from "./testing";
import { createTurns } from "./turns";

const git = realGit();
const here = (dir: string): Checkout => ({ dir, prefix: "", label: "t" });
const write = (dir: string, name: string, data: string | Uint8Array) => {
  mkdirSync(join(dir, name, ".."), { recursive: true });
  writeFileSync(join(dir, name), data);
};
// A tiny PNG-like file: binary (has NULs), with a PNG name.
const picture = (seed: number, size = 600) =>
  Uint8Array.from({ length: size }, (_, i) => (i < 8 ? [137, 80, 78, 71, 13, 10, 26, 10][i] : (i * seed) % 251) as number);

describe("parsePatch", () => {
  it("numbers each line on both sides", () => {
    const [file] = parsePatch(
      [
        "diff --git a/a.txt b/a.txt",
        "index 1..2 100644",
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1,3 +1,3 @@ fn",
        " one",
        "-two",
        "+TWO",
        " three",
        "@@ -10,2 +10,3 @@",
        " ten",
        "+ten and a half",
        " eleven",
        "\\ No newline at end of file",
        "",
      ].join("\n"),
    );
    expect(file?.oldPath).toBe("a.txt");
    expect(file?.newPath).toBe("a.txt");
    expect(file?.hunks.map((h) => h.header)).toEqual(["@@ -1,3 +1,3 @@ fn", "@@ -10,2 +10,3 @@"]);
    expect(file?.hunks[0]?.lines).toEqual([
      { t: "eq", a: 1, b: 1, text: "one" },
      { t: "del", a: 2, text: "two" },
      { t: "add", b: 2, text: "TWO" },
      { t: "eq", a: 3, b: 3, text: "three" },
    ]);
    expect(file?.hunks[1]?.lines.map((l) => [l.t, l.a, l.b])).toEqual([
      ["eq", 10, 10],
      ["add", undefined, 11],
      ["eq", 11, 12],
    ]);
  });

  it("reads new, deleted and binary files", () => {
    const files = parsePatch(
      [
        "diff --git a/n.txt b/n.txt",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/n.txt",
        "@@ -0,0 +1 @@",
        "+hi",
        "diff --git a/g.txt b/g.txt",
        "deleted file mode 100644",
        "--- a/g.txt",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "--- a line that starts with dashes",
        "diff --git a/p.png b/p.png",
        "Binary files a/p.png and b/p.png differ",
      ].join("\n"),
    );
    expect(files.map((f) => [f.oldPath, f.newPath, f.binary])).toEqual([
      [undefined, "n.txt", false],
      ["g.txt", undefined, false],
      ["p.png", "p.png", true],
    ]);
    expect(files[1]?.hunks[0]?.lines[0]).toEqual({ t: "del", a: 1, text: "-- a line that starts with dashes" });
  });
});

describe("splitRows", () => {
  it("puts deletions beside the additions after them", () => {
    const [file] = parsePatch("diff --git a/a b/a\n@@ -1,3 +1,4 @@\n a\n-b\n+B\n+B2\n c\n");
    const rows = splitRows(file?.hunks ?? []);
    expect(rows[0]).toEqual({ hunk: "@@ -1,3 +1,4 @@" });
    const pairs = rows.slice(1).map((r) => ("hunk" in r ? r.hunk : [r.left?.text, r.right?.text]));
    expect(pairs).toEqual([
      ["a", "a"],
      ["b", "B"],
      [undefined, "B2"],
      ["c", "c"],
    ]);
  });
});

describe("binary patches", () => {
  it("decodes git's base85 lines", () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 250, 251, 252]);
    expect([...decodeBase85Line(encodeLine(bytes))]).toEqual([...bytes]);
  });

  it("applies a git delta", () => {
    const base = new TextEncoder().encode("hello world");
    // Source size 11, target size 12: copy "hello " (0x90 = copy with one
    // size byte, offset 0), then insert the 6 bytes "there!".
    const delta = Uint8Array.from([11, 12, 0x90, 6, 6, ...new TextEncoder().encode("there!")]);
    expect(new TextDecoder().decode(applyDelta(base, delta))).toBe("hello there!");
    expect(() => applyDelta(new Uint8Array(3), delta)).toThrow(/another file/);
  });

  it("rebuilds a literal hunk", async () => {
    const data = picture(7);
    const z = deflateSync(data);
    const lines: string[] = [];
    for (let i = 0; i < z.length; i += 52) lines.push(encodeLine(z.subarray(i, i + 52)));
    const patch = `diff --git a/p.png b/p.png\nnew file mode 100644\nGIT binary patch\nliteral ${data.length}\n${lines.join("\n")}\n\nliteral 0\nHcmV?d00001\n\n`;
    expect(binaryHunks(patch).map((h) => [h.kind, h.size])).toEqual([
      ["literal", data.length],
      ["literal", 0],
    ]);
    expect([...((await addedBytes(patch)) ?? [])]).toEqual([...data]);
  });

  it("knows which files are pictures", () => {
    expect(imageType("a/b/Logo.PNG")).toBe("image/png");
    expect(imageType("x.jpeg")).toBe("image/jpeg");
    expect(imageType("x.svg")).toBeUndefined();
    expect(imageType("Makefile")).toBeUndefined();
  });
});

describe("pictures before and after, from real git", () => {
  it("reads both versions of a changed picture, and one of an added or deleted one", async () => {
    const first = picture(3);
    const second = picture(5, 900);
    const dir = repo({ "a.txt": "a\n" });
    write(dir, "img/logo.png", first);
    write(dir, "old.png", picture(11));
    sh(dir, "add", "--all");
    sh(dir, "commit", "-q", "-m", "pics");
    const c = here(dir);
    const before = await snapshot(git, c);
    write(dir, "img/logo.png", second);
    write(dir, "new.png", picture(13));
    rmSync(join(dir, "old.png"));
    const after = await snapshot(git, c);
    const files = await changedFiles(git, c, before, after);
    expect(files.every((f) => f.binary)).toBe(true);

    const storage = memoryStorage();
    // A finished turn as the recorder leaves it, so `images` can find it.
    const turn = {
      id: "t1",
      agent: "A",
      channelId: "c",
      viewer: "me",
      origin: "https://relay.example",
      start: 1,
      end: 2,
      checkouts: [{ ...c, before, after, files: files.length }],
    };
    storage.setItem("lucas.changesets-plus.turns.v1", JSON.stringify([turn]));
    const loaded = createTurns(git, storage);
    loaded.watch(fakeSession(), "https://relay.example");
    const changed = only(files.filter((f) => f.path === "img/logo.png"));
    const pics = await loaded.images("t1", 0, changed);
    expect([...(pics.before ?? [])]).toEqual([...first]);
    expect([...(pics.after ?? [])]).toEqual([...second]);
    const added = await loaded.images("t1", 0, only(files.filter((f) => f.path === "new.png")));
    expect(added.before).toBeUndefined();
    expect(added.after?.length).toBe(600);
    const deleted = await loaded.images("t1", 0, only(files.filter((f) => f.path === "old.png")));
    expect(deleted.after).toBeUndefined();
    expect(deleted.before?.length).toBe(600);
  });

  it("refuses a tree that is not a snapshot", async () => {
    await expect(addedPatch(git, here("/"), "nope", "a.png")).rejects.toThrow(/Not a snapshot/);
  });
});

describe("filePatch context", () => {
  it("shows as many unchanged lines as asked", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const dir = repo({ "a.txt": `${lines.join("\n")}\n` });
    const c = here(dir);
    const before = await snapshot(git, c);
    lines[15] = "changed";
    write(dir, "a.txt", `${lines.join("\n")}\n`);
    const after = await snapshot(git, c);
    const file = only(await changedFiles(git, c, before, after));
    const count = async (context?: number) =>
      parsePatch(await filePatch(git, c, before, after, file, context))[0]?.hunks[0]?.lines.length;
    expect(await count()).toBe(8); // 3 + del + add + 3
    expect(await count(0)).toBe(2);
    expect(await count(100_000)).toBe(31);
  });
});

describe("preferences", () => {
  it("default, saved, and bad values", () => {
    expect(readPrefs(memoryStorage())).toEqual(DEFAULT_PREFS);
    const storage = memoryStorage();
    const prefs = createPrefs(storage);
    let heard = 0;
    prefs.subscribe(() => heard++);
    prefs.set({ layout: "split", size: "lg" });
    expect(heard).toBe(1);
    expect(readPrefs(storage)).toMatchObject({ layout: "split", size: "lg", context: 3 });
    storage.setItem("lucas.changesets-plus.prefs.v1", JSON.stringify({ layout: "diagonal", size: "xl", context: 7, wrap: "yes" }));
    expect(readPrefs(storage)).toEqual(DEFAULT_PREFS);
    storage.setItem("lucas.changesets-plus.prefs.v1", "{not json");
    expect(readPrefs(storage)).toEqual(DEFAULT_PREFS);
  });
});

describe("asking about a line", () => {
  it("names the file, folder, line and question", () => {
    const text = askText({ dir: "/repo", label: "repo (main)" }, "src/a.ts", { number: 12, side: "new", text: "  return x;" }, " Why? ");
    expect(text).toContain("`src/a.ts` in `/repo`, line 12 (after your change)");
    expect(text).toContain("The line: `return x;`");
    expect(text).toContain("Their question: Why?");
    expect(askText({ dir: "/r", label: "r" }, "b", { number: 3, side: "old", text: "x" }, "")).toContain(
      "Explain what this change does",
    );
  });

  it("wakes the agent in the turn's thread, or at the chat's top level", () => {
    expect(wakePlace({ channelId: "c", thread: "ABC" })).toEqual({ channel: "c", root: "abc" });
    expect(wakePlace({ channelId: "c" })).toEqual({ channel: "c", topLevel: true });
  });
});

describe("file filter", () => {
  it("matches every word, in any case", () => {
    expect(matchesFilter("src/Components/Card.tsx", "card")).toBe(true);
    expect(matchesFilter("src/Components/Card.tsx", "src card")).toBe(true);
    expect(matchesFilter("src/Components/Card.tsx", "panel")).toBe(false);
    expect(matchesFilter("anything", "  ")).toBe(true);
  });
});

// ---- helpers ------------------------------------------------------------------

const B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
function encodeLine(bytes: Uint8Array) {
  const n = bytes.length;
  let out = n <= 26 ? String.fromCharCode(64 + n) : String.fromCharCode(96 + n - 26);
  for (let i = 0; i < n; i += 4) {
    let value = 0;
    for (let j = 0; j < 4; j++) value = value * 256 + (bytes[i + j] ?? 0);
    let chunk = "";
    for (let j = 0; j < 5; j++) {
      chunk = (B85[value % 85] as string) + chunk;
      value = Math.floor(value / 85);
    }
    out += chunk;
  }
  return out;
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

function fakeSession() {
  return {
    viewer: "me",
    agentChoices: { snapshot: () => ({ identities: [] }) },
    agentActivity: { activate: () => () => {}, snapshot: () => ({ local: [] }), subscribe: () => () => {} },
  };
}
