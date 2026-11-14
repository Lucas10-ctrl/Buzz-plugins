// Reading `git diff` output: text patches into rows to draw, and
// `--binary` patches back into the bytes of a picture.

export type Line = Readonly<{
  t: "eq" | "add" | "del";
  /** 1-based line numbers before / after. */
  a?: number;
  b?: number;
  text: string;
}>;
export type Hunk = Readonly<{ header: string; lines: readonly Line[] }>;
export type FilePatch = Readonly<{
  oldPath?: string;
  newPath?: string;
  binary: boolean;
  hunks: readonly Hunk[];
}>;

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;
const unquote = (path: string) =>
  path.startsWith('"') ? path.slice(1, -1).replace(/\\(.)/g, "$1") : path;
const side = (path: string | undefined, prefix: string) =>
  path === undefined || path === "/dev/null"
    ? undefined
    : unquote(path).replace(new RegExp(`^"?${prefix}`), "");

/** A unified patch (git's), one entry per file. */
export function parsePatch(text: string): FilePatch[] {
  const files: { oldPath?: string; newPath?: string; binary: boolean; hunks: Hunk[] }[] = [];
  let file: (typeof files)[number] | undefined;
  let hunk: { header: string; lines: Line[] } | undefined;
  let a = 0;
  let b = 0;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(raw);
      file = { binary: false, hunks: [], ...(m ? { oldPath: m[1], newPath: m[2] } : {}) };
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (raw.startsWith("--- ")) {
        const path = side(raw.slice(4), "a/");
        if (path === undefined) delete file.oldPath;
        else file.oldPath = path;
      } else if (raw.startsWith("+++ ")) {
        const path = side(raw.slice(4), "b/");
        if (path === undefined) delete file.newPath;
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
    else if (mark === "\\") continue; // "\ No newline at end of file"
    else hunk = undefined;
  }
  return files;
}

export type Row =
  | Readonly<{ hunk: string }>
  | Readonly<{ left?: Line; right?: Line }>;

/** Side-by-side rows: each run of deletions beside the additions after it. */
export function splitRows(hunks: readonly Hunk[]): Row[] {
  const rows: Row[] = [];
  for (const hunk of hunks) {
    rows.push({ hunk: hunk.header });
    const lines = hunk.lines;
    for (let i = 0; i < lines.length; ) {
      const line = lines[i] as Line;
      if (line.t === "eq") {
        rows.push({ left: line, right: line });
        i++;
        continue;
      }
      const dels: Line[] = [];
      const adds: Line[] = [];
      while (lines[i]?.t === "del") dels.push(lines[i++] as Line);
      while (lines[i]?.t === "add") adds.push(lines[i++] as Line);
      for (let j = 0; j < Math.max(dels.length, adds.length); j++)
        rows.push({
          ...(dels[j] ? { left: dels[j] } : {}),
          ...(adds[j] ? { right: adds[j] } : {}),
        });
    }
  }
  return rows;
}

// ---- Binary patches ---------------------------------------------------------

const B85 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
const B85_VALUE = new Map([...B85].map((char, index) => [char, index]));

/** One line of git's base85: a length letter, then 5 characters per 4 bytes. */
export function decodeBase85Line(line: string): Uint8Array {
  const first = line.charCodeAt(0);
  const length =
    first >= 65 && first <= 90 ? first - 64 : first >= 97 && first <= 122 ? first - 96 + 26 : -1;
  if (length < 0) throw new Error("Not a binary patch line.");
  const body = line.slice(1);
  const out = new Uint8Array(Math.ceil(body.length / 5) * 4);
  for (let i = 0, o = 0; i < body.length; i += 5, o += 4) {
    let value = 0;
    for (let j = 0; j < 5; j++) {
      const digit = B85_VALUE.get(body[i + j] ?? "");
      if (digit === undefined) throw new Error("Bad base85.");
      value = value * 85 + digit;
    }
    out[o] = (value >>> 24) & 255;
    out[o + 1] = (value >>> 16) & 255;
    out[o + 2] = (value >>> 8) & 255;
    out[o + 3] = value & 255;
  }
  return out.slice(0, length);
}

export type BinaryHunk = Readonly<{ kind: "literal" | "delta"; size: number; data: Uint8Array }>;

/** The forward and reverse hunks of each "GIT binary patch", still deflated. */
export function binaryHunks(patch: string): BinaryHunk[] {
  const hunks: BinaryHunk[] = [];
  const lines = patch.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(literal|delta) (\d+)$/.exec(lines[i] ?? "");
    if (!m) continue;
    const parts: Uint8Array[] = [];
    while (lines[i + 1]) parts.push(decodeBase85Line(lines[++i] as string));
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
      data.set(part, at);
      at += part.length;
    }
    hunks.push({ kind: m[1] as "literal" | "delta", size: Number(m[2]), data });
  }
  return hunks;
}

/** zlib-inflates `data` (git's binary hunks are zlib streams). */
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A git delta applied to `base`. */
export function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let i = 0;
  const varint = () => {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = delta[i++] ?? 0;
      value |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return value;
  };
  if (varint() !== base.length) throw new Error("The delta is for another file.");
  const out = new Uint8Array(varint());
  let o = 0;
  while (i < delta.length) {
    const op = delta[i++] as number;
    if (op & 0x80) {
      let offset = 0;
      let size = 0;
      for (let bit = 0; bit < 4; bit++) if (op & (1 << bit)) offset |= (delta[i++] as number) << (8 * bit);
      for (let bit = 0; bit < 3; bit++) if (op & (1 << (4 + bit))) size |= (delta[i++] as number) << (8 * bit);
      if (size === 0) size = 0x10000;
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

/** The file's bytes from a patch that adds it (so its first hunk is a
 * literal of the whole file). */
export async function addedBytes(patch: string): Promise<Uint8Array | undefined> {
  const [first] = binaryHunks(patch);
  if (!first || first.kind !== "literal") return undefined;
  const bytes = await inflate(first.data);
  return bytes.length === first.size ? bytes : undefined;
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

/** The picture type of `path`, if it is one the panel can show. */
export const imageType = (path: string) =>
  IMAGE_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];
