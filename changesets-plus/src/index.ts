// Changesets Plus: Buzz's built-in Changesets plugin (block/buzz-app
// src/bundled/changesets, Apache-2.0) as an installable plugin, with:
// - one column / side by side diffs
// - a file filter in the panel
// - pictures before and after
// - a Changesets page in Settings (layout, text size, font, context, wrapping)
// - "Ask" on a line, which wakes the agent in the same conversation
//
// Turn recording (turns.ts, git.ts, paths.ts, target.ts) is Buzz's own code;
// the UI here is rewritten with `ctx.react` and inline styles because a
// plugin can't import Buzz's design-system components or CSS.
import { type ChangedFile, createGit } from "./git";
import { type Hunk, type Line, imageType, parsePatch, splitRows } from "./patch";
import { parseTarget, targetFor } from "./target";
import { type Turn, type TurnCheckout, type Turns, createTurns } from "./turns";
import type { ChannelMessage, Host } from "./types";

export { parsePatch, splitRows, binaryHunks, decodeBase85Line, applyDelta, addedBytes, inflate, imageType } from "./patch";
export { parseTarget, targetFor } from "./target";

export const inject = ["react", "panels", "host", "conversation", "relay", "agents", "settingsCards"];

// biome-ignore lint/suspicious/noExplicitAny: the host's React and services are untyped here.
type Any = any;

const PREFS_KEY = "lucas.changesets-plus.prefs.v1";
export type Prefs = Readonly<{
  layout: "unified" | "split";
  size: "sm" | "md" | "lg";
  font: "mono" | "system";
  context: number;
  wrap: boolean;
}>;
export const DEFAULT_PREFS: Prefs = Object.freeze({
  layout: "unified",
  size: "md",
  font: "mono",
  context: 3,
  wrap: false,
});
const SIZES = { sm: "12px", md: "13px", lg: "15px" } as const;
const FONTS = {
  mono: "var(--font-mono, ui-monospace, monospace)",
  system: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;
const CONTEXTS = [3, 10, 100_000];

export function readPrefs(storage: Pick<Storage, "getItem"> | undefined): Prefs {
  try {
    const saved = JSON.parse(storage?.getItem(PREFS_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return DEFAULT_PREFS;
    return Object.freeze({
      layout: saved.layout === "split" ? "split" : "unified",
      size: saved.size in SIZES ? saved.size : "md",
      font: saved.font in FONTS ? saved.font : "mono",
      context: CONTEXTS.includes(saved.context) ? saved.context : 3,
      wrap: saved.wrap === true,
    });
  } catch {
    return DEFAULT_PREFS;
  }
}

export function createPrefs(storage: Pick<Storage, "getItem" | "setItem"> | undefined) {
  const listeners = new Set<() => void>();
  let current = readPrefs(storage);
  return {
    get: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(change: Partial<Prefs>) {
      current = Object.freeze({ ...current, ...change });
      try {
        storage?.setItem(PREFS_KEY, JSON.stringify(current));
      } catch {
        // Storage off: the choice lasts until Buzz restarts.
      }
      for (const listener of listeners) listener();
    },
  };
}
type PrefStore = ReturnType<typeof createPrefs>;

/** Where a wake about this turn goes: its thread, or the chat's top level. */
export function wakePlace(turn: Pick<Turn, "channelId" | "thread">) {
  return turn.thread
    ? { channel: turn.channelId, root: turn.thread.toLowerCase() }
    : { channel: turn.channelId, topLevel: true };
}

export type AskLine = Readonly<{ number: number; side: "old" | "new"; text: string }>;

/** What the agent is told when its owner asks about a line. */
export function askText(
  checkout: Pick<TurnCheckout, "dir" | "label">,
  path: string,
  line: AskLine | undefined,
  question: string,
) {
  const where = line
    ? `line ${line.number} (${line.side === "old" ? "as it was before your change" : "after your change"})`
    : "this file";
  return [
    `Your owner is asking about a change you made in your last turn here: \`${path}\` in \`${checkout.dir}\`, ${where}.`,
    line ? `The line: \`${line.text.trim().slice(0, 400)}\`` : undefined,
    question.trim()
      ? `Their question: ${question.trim().slice(0, 2000)}`
      : "Explain what this change does and why you made it.",
    "Answer in this conversation.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
export const totals = (files: readonly { additions: number; deletions: number }[]) => ({
  additions: files.reduce((sum, file) => sum + file.additions, 0),
  deletions: files.reduce((sum, file) => sum + file.deletions, 0),
});
export const matchesFilter = (path: string, filter: string) =>
  filter
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((part) => path.toLowerCase().includes(part));

export function apply(ctx: Any, overrides: { turns?: Turns; storage?: Storage } = {}) {
  const host: Host = ctx.host;
  const storage = overrides.storage ?? globalThis.localStorage;
  const prefs = createPrefs(storage);
  let turns = overrides.turns;
  if (!turns) {
    if (!host.spawn) return; // desktop only: snapshots run git
    turns = createTurns(createGit(host.spawn.bind(host)), storage);
    const live = turns;
    ctx.effect(() => {
      let release: (() => void) | undefined;
      let bound: unknown;
      const bind = () => {
        const connection = ctx.relay.snapshot();
        const next = connection.status === "ready" ? connection.session : undefined;
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
    component: ui.TurnCards,
  });
  ctx.panels.register({
    id: "changes",
    title: "Changes",
    matches: (url: string) => typeof url === "string" && !!parseTarget(url),
    component: ui.Panel,
  });
  ctx.settingsCards.register({
    id: "changesets",
    title: "Changesets",
    group: "App",
    component: ui.Settings,
  });
}

// ---- UI -------------------------------------------------------------------

const UI = { "data-buzz-ui": "" };

function createUi(React: Any, turns: Turns, prefs: PrefStore, agents: Any) {
  const h = React.createElement;
  const usePrefs = (): Prefs => React.useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);

  /** Runs `load` again when `deps` change, or on `retry`. */
  function useLoaded<T>(load: (() => Promise<T>) | undefined, deps: unknown[]) {
    const [attempt, setAttempt] = React.useState(0);
    const [state, setState] = React.useState({} as { value?: T; error?: string });
    // biome-ignore lint/correctness/useExhaustiveDependencies: callers list what `load` reads.
    React.useEffect(() => {
      setState({});
      if (!load) return;
      let live = true;
      load().then(
        (value) => live && setState({ value }),
        (error) => live && setState({ error: error instanceof Error ? error.message : String(error) }),
      );
      return () => {
        live = false;
      };
    }, [...deps, attempt]);
    return { ...state, retry: () => setAttempt((n: number) => n + 1) };
  }

  const Button = ({ variant = "subtle", children, ...props }: Any) =>
    h(
      "button",
      { type: "button", ...UI, className: "buzz-button", "data-variant": variant, "data-size": "sm", ...props },
      h("span", { className: "buzz-button-label" }, children),
    );

  const Counts = ({ additions, deletions }: { additions: number; deletions: number }) =>
    h(
      "span",
      { style: styles.counts },
      h("span", { style: { color: "var(--text-success, var(--green-11))" } }, `+${additions}`),
      h("span", { style: { color: "var(--text-danger, var(--red-11))" } }, `−${deletions}`),
    );

  const Trailing = ({ file }: { file: ChangedFile }) =>
    file.binary ? h("span", { style: styles.badge }, imageType(file.path) ? "picture" : "binary") : h(Counts, file);

  const Mark = ({ status }: { status: ChangedFile["status"] }) =>
    h(
      "span",
      {
        title: status,
        "aria-label": status,
        style: {
          ...styles.mark,
          color:
            status === "added"
              ? "var(--text-success, var(--green-11))"
              : status === "deleted"
                ? "var(--text-danger, var(--red-11))"
                : "var(--text-secondary)",
        },
      },
      { added: "A", deleted: "D", renamed: "R", modified: "M" }[status],
    );

  function FileRow({ file, active, disabled, onClick }: Any) {
    const cut = file.path.lastIndexOf("/");
    return h(
      "button",
      {
        type: "button",
        style: { ...styles.row, ...(active ? styles.rowActive : null) },
        title: file.from ? `${file.from} → ${file.path}` : file.path,
        "aria-current": active ? "true" : undefined,
        disabled,
        onClick,
      },
      h(Mark, { status: file.status }),
      h(
        "span",
        { style: styles.path },
        cut >= 0 ? h("span", { style: styles.muted }, file.path.slice(0, cut + 1)) : null,
        file.path.slice(cut + 1),
      ),
      h(Trailing, { file }),
    );
  }

  /** Under an agent's last message in a turn: a card per changed checkout. */
  function TurnCards({ message, canOpen, open }: { message?: ChannelMessage; canOpen(t: string): boolean; open(t: string): boolean }) {
    React.useSyncExternalStore(turns.subscribe, turns.version);
    React.useEffect(() => {
      if (message) turns.claim(message);
    });
    const cards = message ? turns.cardsFor(message.id) : [];
    if (!cards.length) return null;
    return h(
      "div",
      { style: styles.cards },
      cards.flatMap((turn: Turn) =>
        turn.checkouts.map((checkout, index) =>
          checkout.files
            ? h(Card, { key: `${turn.id}:${checkout.dir}:${checkout.prefix}`, turn, checkout, index, canOpen, open })
            : null,
        ),
      ),
    );
  }

  const FIRST = 8;
  function Card({ turn, checkout, index, canOpen, open }: Any) {
    const [all, setAll] = React.useState(false);
    const { value: files, error, retry } = useLoaded<ChangedFile[]>(() => turns.summary(turn.id, index), [turn.id, index]);
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
          files ? h(Counts, totals(files)) : null,
        ),
      ),
      checkout.late
        ? h("p", { style: styles.note }, "Recording began a moment after the agent started, so its first edits may be missing.")
        : null,
      checkout.shared
        ? h("p", { style: styles.note }, "Another agent was working here too, so some of this may not be this turn's.")
        : null,
      error
        ? h("div", { role: "alert", style: styles.note }, `Couldn't read this changeset. ${error} `, h(Button, { variant: "ghost", onClick: retry }, "Try again"))
        : null,
      shown
        ? h(
            "ul",
            { style: styles.list, "aria-label": "Changed files" },
            shown.map((file) =>
              h("li", { key: file.path }, h(FileRow, { file, disabled: !opens, onClick: () => open(targetFor(turn.id, index, file.path)) })),
            ),
          )
        : null,
      files && files.length > FIRST
        ? h(Button, { variant: "ghost", onClick: () => setAll(!all) }, all ? "Show fewer" : `Show all ${files.length} files`)
        : null,
    );
  }

  function Segmented({ label, value, options, onChange }: Any) {
    return h(
      "div",
      { role: "radiogroup", "aria-label": label, style: styles.segmented },
      options.map(([key, text]: [unknown, string]) =>
        h(Button, { key: String(key), role: "radio", "aria-checked": value === key, variant: value === key ? "prominent" : "subtle", onClick: () => onChange(key) }, text),
      ),
    );
  }

  /** A recorded turn's checkout: a filterable file list and one file's diff. */
  function Panel({ target }: { target: string }) {
    React.useSyncExternalStore(turns.subscribe, turns.version);
    const p = usePrefs();
    const link = React.useMemo(() => parseTarget(target), [target]);
    const found = link && turns.find(link.turn, link.checkout);
    const [chosen, setChosen] = React.useState(link?.file);
    const [filter, setFilter] = React.useState("");
    const [layout, setLayout] = React.useState(undefined as Prefs["layout"] | undefined);
    React.useEffect(() => setChosen(link?.file), [link?.file]);
    const listed = useLoaded<ChangedFile[]>(link ? () => turns.summary(link.turn, link.checkout) : undefined, [link?.turn, link?.checkout]);
    if (!link || !found) return h("p", { role: "alert", style: styles.pad }, "This changeset was recorded in another Buzz.");
    const files = listed.value;
    const visible = files?.filter((file) => matchesFilter(file.path, filter)) ?? [];
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
        files ? h("span", { style: styles.muted }, `${plural(files.length, "file")} changed `, h(Counts, totals(files))) : null,
      ),
      listed.error
        ? h("div", { role: "alert" }, `Couldn't read this changeset. ${listed.error} `, h(Button, { variant: "ghost", onClick: listed.retry }, "Try again"))
        : !files
          ? h("p", { style: styles.muted }, "Reading the changes…")
          : null,
      files
        ? h(
            "div",
            { style: styles.toolbar },
            files.length > 1
              ? h("input", {
                  ...UI,
                  className: "buzz-input",
                  "data-size": "sm",
                  type: "search",
                  placeholder: `Filter ${plural(files.length, "file")}`,
                  "aria-label": "Filter files",
                  value: filter,
                  onChange: (e: Any) => setFilter(e.target.value),
                  style: { flex: "1 1 10rem", minWidth: 0 },
                })
              : null,
            h(Segmented, { label: "Layout", value: mode, options: [["unified", "One column"], ["split", "Side by side"]], onChange: setLayout }),
          )
        : null,
      files && files.length > 1
        ? h(
            "ul",
            { style: styles.panelList, "aria-label": "Changed files" },
            visible.map((each) => h("li", { key: each.path }, h(FileRow, { file: each, active: each === file, onClick: () => setChosen(each.path) }))),
            visible.length ? null : h("li", { style: { ...styles.muted, padding: "var(--space-2)" } }, "No files match."),
          )
        : null,
      files && file
        ? h(
            React.Fragment,
            null,
            h(
              "div",
              { style: styles.fileTitle },
              h(Mark, { status: file.status }),
              h("span", { style: styles.path }, file.from ? `${file.from} → ${file.path}` : file.path),
              h(Trailing, { file }),
              files.length > 1
                ? h(
                    "span",
                    { style: { display: "flex", gap: "var(--space-1)" } },
                    h(Button, { "aria-label": "Previous file", disabled: at <= 0, onClick: () => setChosen(visible[at - 1]?.path) }, "‹"),
                    h(Button, { "aria-label": "Next file", disabled: at < 0 || at >= visible.length - 1, onClick: () => setChosen(visible[at + 1]?.path) }, "›"),
                  )
                : null,
            ),
            h(FileView, { key: `${file.path}:${p.context}`, turn: found.turn, checkout: found.checkout, index: link.checkout, file, prefs: p, layout: mode }),
          )
        : null,
    );
  }

  function FileView({ turn, checkout, index, file, prefs: p, layout }: Any) {
    if (file.binary)
      return imageType(file.path)
        ? h(Pictures, { turn, index, file })
        : h("p", { style: styles.note }, "Binary file: no text diff to show.");
    return h(TextDiff, { turn, checkout, index, file, prefs: p, layout });
  }

  function Pictures({ turn, index, file }: Any) {
    const loaded = useLoaded<{ before?: Uint8Array; after?: Uint8Array }>(() => turns.images(turn.id, index, file), [turn.id, index, file.path]);
    const type = imageType(file.path) as string;
    const urls = React.useMemo(() => {
      const make = (bytes?: Uint8Array) => (bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type })) : undefined);
      return loaded.value ? { before: make(loaded.value.before), after: make(loaded.value.after) } : undefined;
    }, [loaded.value]);
    React.useEffect(
      () => () => {
        if (urls?.before) URL.revokeObjectURL(urls.before);
        if (urls?.after) URL.revokeObjectURL(urls.after);
      },
      [urls],
    );
    if (loaded.error) return h("p", { role: "alert", style: styles.note }, `Couldn't read the pictures. ${loaded.error}`);
    if (!urls) return h("p", { style: styles.muted }, "Reading the pictures…");
    const pane = (label: string, url: string | undefined, size: number | undefined, empty: string) =>
      h(
        "figure",
        { style: styles.figure },
        h("figcaption", { style: styles.muted }, label, size ? ` · ${formatSize(size)}` : ""),
        url ? h("img", { src: url, alt: `${file.path}, ${label.toLowerCase()}`, style: styles.image }) : h("div", { style: styles.noImage }, empty),
      );
    return h(
      "div",
      { style: styles.pictures },
      pane("Before", urls.before, loaded.value?.before?.length, file.status === "added" ? "New file" : "Not available"),
      pane("After", urls.after, loaded.value?.after?.length, file.status === "deleted" ? "Deleted" : "Not available"),
    );
  }

  function TextDiff({ turn, checkout, index, file, prefs: p, layout }: Any) {
    const [asking, setAsking] = React.useState(undefined as (AskLine & { key: string }) | undefined);
    const patch = useLoaded<string>(() => turns.patch(turn.id, index, file, p.context), [turn.id, index, file.path, p.context]);
    const hunks: Hunk[] = React.useMemo(() => (patch.value === undefined ? [] : (parsePatch(patch.value)[0]?.hunks ?? [])), [patch.value]);
    if (patch.error)
      return h("div", { role: "alert", style: styles.note }, patch.error, " ", h(Button, { variant: "ghost", onClick: patch.retry }, "Try again"));
    if (patch.value === undefined) return h("p", { style: styles.muted }, `Reading ${file.path}…`);
    if (!hunks.length) return h("p", { style: styles.note }, "No line changes (only the file's mode or name changed).");

    const code = {
      ...styles.code,
      fontFamily: FONTS[p.font as keyof typeof FONTS],
      fontSize: SIZES[p.size as keyof typeof SIZES],
      whiteSpace: p.wrap ? "pre-wrap" : "pre",
      overflowWrap: p.wrap ? "anywhere" : "normal",
    };
    const bg = (line?: Line) => (line?.t === "add" ? "var(--green-3)" : line?.t === "del" ? "var(--red-3)" : "transparent");
    const sign = (line: Line) =>
      h(
        "span",
        { style: { ...styles.sign, color: line.t === "add" ? "var(--green-11)" : "var(--red-11)" } },
        line.t === "add" ? "+" : line.t === "del" ? "−" : " ",
      );
    const ask = (line: Line, key: string) =>
      h(
        "button",
        {
          type: "button",
          style: styles.ask,
          title: "Ask the agent about this line",
          "aria-label": `Ask about line ${line.t === "del" ? line.a : line.b}`,
          onClick: () => setAsking({ key, number: (line.t === "del" ? line.a : line.b) as number, side: line.t === "del" ? "old" : "new", text: line.text }),
        },
        "Ask",
      );
    const askRow = (key: string, span: number) =>
      asking?.key === key
        ? h(
            "tr",
            { key: `ask:${key}` },
            h("td", { colSpan: span, style: { padding: "var(--space-2)" } }, h(AskBox, { turn, checkout, file, line: asking, onDone: () => setAsking(undefined) })),
          )
        : null;
    const hunkRow = (header: string, key: string, span: number) =>
      h("tr", { key }, h("td", { colSpan: span, style: styles.hunk }, header));

    let body: Any[];
    if (layout === "split") {
      body = splitRows(hunks).flatMap((row, i) => {
        if ("hunk" in row) return [hunkRow(row.hunk, `h${i}`, 5)];
        const key = `s${i}`;
        const left = row.left && row.left.t !== "add" ? row.left : undefined;
        const right = row.right && row.right.t !== "del" ? row.right : undefined;
        const cell = (line: Line | undefined, number: number | undefined) =>
          line
            ? [
                h("td", { key: "n", style: { ...styles.gutter, background: bg(line) } }, number),
                h("td", { key: "c", style: { ...code, width: "50%", background: bg(line) } }, sign(line), line.text),
              ]
            : [h("td", { key: "e", colSpan: 2, style: styles.blank })];
        return [
          h(
            "tr",
            { key },
            cell(left, left?.a),
            cell(right, right?.b),
            h("td", { style: styles.askCell }, ask((right ?? left) as Line, key)),
          ),
          askRow(key, 5),
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
              h("td", { style: styles.askCell }, ask(line, key)),
            ),
            askRow(key, 4),
          ];
        }),
      ]);
    }
    return h("div", { style: styles.scroll }, h("table", { style: styles.table }, h("tbody", null, body)));
  }

  function AskBox({ turn, checkout, file, line, onDone }: Any) {
    const [text, setText] = React.useState("");
    const [error, setError] = React.useState("");
    const running = (agents?.snapshot?.().running ?? []).find((agent: Any) => agent.pubkey === turn.agent);
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
      { style: styles.askBox, onSubmit: (e: Any) => (e.preventDefault(), send()) },
      h("span", { style: styles.muted }, `Ask about line ${line.number}`),
      h("textarea", {
        ...UI,
        className: "buzz-textarea",
        rows: 2,
        autoFocus: true,
        placeholder: "Your question (optional)",
        value: text,
        onChange: (e: Any) => setText(e.target.value),
        onKeyDown: (e: Any) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape") onDone();
        },
      }),
      error ? h("span", { role: "alert", style: { color: "var(--text-danger, var(--red-11))" } }, error) : null,
      h(
        "div",
        { style: { display: "flex", gap: "var(--space-1)" } },
        h(Button, { variant: "prominent", type: "submit", disabled: !running }, "Ask agent"),
        h(Button, { onClick: onDone }, "Cancel"),
      ),
    );
  }

  const SAMPLE: Hunk[] = parsePatch(
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
      " }",
    ].join("\n"),
  )[0]?.hunks as Hunk[];

  function Sample({ prefs: p }: { prefs: Prefs }) {
    const code = { ...styles.code, fontFamily: FONTS[p.font], fontSize: SIZES[p.size], whiteSpace: p.wrap ? "pre-wrap" : "pre" };
    const bg = (line?: Line) => (line?.t === "add" ? "var(--green-3)" : line?.t === "del" ? "var(--red-3)" : "transparent");
    const rows =
      p.layout === "split"
        ? splitRows(SAMPLE).flatMap((row, i) =>
            "hunk" in row
              ? []
              : [
                  h(
                    "tr",
                    { key: i },
                    ...[row.left?.t === "add" ? undefined : row.left, row.right?.t === "del" ? undefined : row.right].flatMap((line, j) =>
                      line
                        ? [
                            h("td", { key: `n${j}`, style: { ...styles.gutter, background: bg(line) } }, j ? line.b : line.a),
                            h("td", { key: `c${j}`, style: { ...code, width: "50%", background: bg(line) } }, line.text),
                          ]
                        : [h("td", { key: `e${j}`, colSpan: 2, style: styles.blank })],
                    ),
                  ),
                ],
          )
        : (SAMPLE[0]?.lines ?? []).map((line, i) =>
            h(
              "tr",
              { key: i },
              h("td", { style: { ...styles.gutter, background: bg(line) } }, line.a ?? ""),
              h("td", { style: { ...styles.gutter, background: bg(line) } }, line.b ?? ""),
              h("td", { style: { ...code, background: bg(line) } }, line.text),
            ),
          );
    return h("div", { style: styles.scroll }, h("table", { style: styles.table }, h("tbody", null, rows)));
  }

  function Settings() {
    const p = usePrefs();
    const row = (label: string, control: Any) => h("div", { style: styles.setting }, h("span", { style: { minWidth: "8rem" } }, label), control);
    return h(
      "div",
      { style: styles.settings },
      h(
        "p",
        { style: styles.muted },
        "How Changesets shows the files your agents change. Changesets are recorded on this computer for agents running here in a chat with project folders, and only you see them.",
      ),
      row("Layout", h(Segmented, { label: "Layout", value: p.layout, options: [["unified", "One column"], ["split", "Side by side"]], onChange: (v: Prefs["layout"]) => prefs.set({ layout: v }) })),
      row("Text size", h(Segmented, { label: "Text size", value: p.size, options: [["sm", "Small"], ["md", "Medium"], ["lg", "Large"]], onChange: (v: Prefs["size"]) => prefs.set({ size: v }) })),
      row("Font", h(Segmented, { label: "Font", value: p.font, options: [["mono", "Buzz mono"], ["system", "System mono"]], onChange: (v: Prefs["font"]) => prefs.set({ font: v }) })),
      row(
        "Around changes",
        h(Segmented, { label: "Unchanged lines around changes", value: p.context, options: [[3, "3 lines"], [10, "10 lines"], [100_000, "Whole file"]], onChange: (v: number) => prefs.set({ context: v }) }),
      ),
      row("Long lines", h(Segmented, { label: "Long lines", value: p.wrap, options: [[false, "Scroll"], [true, "Wrap"]], onChange: (v: boolean) => prefs.set({ wrap: v }) })),
      h("h3", { style: { margin: "var(--space-2) 0 0" } }, "Preview"),
      h(Sample, { prefs: p }),
    );
  }

  return { TurnCards, Panel, Settings };
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1 << 20) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1 << 20)).toFixed(1)} MB`;
}

const styles: Record<string, Any> = {
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
    color: "var(--text-standard, var(--text-primary))",
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
    fontSize: "var(--text-body-sm, 13px)",
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
    borderBottom: "1px solid var(--border-standard)",
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
    whiteSpace: "nowrap",
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
    backgroundPosition: "0 0, 8px 8px",
  },
  noImage: { padding: "var(--space-4)", textAlign: "center", color: "var(--text-secondary)", border: "1px dashed var(--border-standard)", borderRadius: "var(--radius-control)" },
  settings: { display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-2) 0" },
  setting: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-3)" },
};
