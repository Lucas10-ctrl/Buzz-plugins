// Local Files: API v1 plugin for the Buzz desktop app.
//
// A local Markdown path in a message (`/home/…/notes.md` or `~/notes.md`)
// becomes a link. Clicking it opens the file in a side-pane tab as one
// Omawrite-style writing surface: Markdown is styled in place with its markers
// dimmed, and you just type. Ctrl/Cmd+S saves, optional autosave, find and
// replace, Ctrl/Cmd+B/I/K. Changes made on disk by someone else (an agent)
// load in by themselves, or raise a warning when you have unsaved edits.
//
// Built from src/ with `npm run build`; plugin.js is the generated bundle.

import { createEditor } from "./editor.js";
import { createFiles, describe, fileName, findCodePaths, findPaths, pathOf, pathProblem, targetFor } from "./core.js";

export * from "./core.js";
export { linkSpec, toggleWrapSpec } from "./editor.js";

export const inject = ["react", "conversation", "panels", "host"];

const POLL_MS = 4000;
const AUTOSAVE_MS = 1200;
const DRAFT_PREFIX = "lucas.local-files.draft:";
const AUTOSAVE_KEY = "lucas.local-files.autosave";

const UI = { "data-buzz-ui": "" };

const styles = {
  pane: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    background: "var(--surface-panel)",
    color: "var(--text-standard)",
  },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "var(--space-2) var(--space-4)",
    borderBottom: "1px solid var(--border-standard)",
    flexWrap: "wrap",
  },
  where: {
    flex: "1 1 10rem",
    minWidth: 0,
    color: "var(--text-metadata)",
    fontSize: "var(--text-body-sm)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    direction: "rtl",
    textAlign: "left",
  },
  state: { color: "var(--text-metadata)", fontSize: "var(--text-body-sm)", whiteSpace: "nowrap" },
  editor: { flex: 1, minHeight: 0, overflow: "hidden" },
  status: { padding: "var(--space-6) var(--space-4)", color: "var(--text-metadata)", maxWidth: "60ch" },
  error: { padding: "var(--space-4)", maxWidth: "60ch" },
  p: { margin: "0 0 0.85em" },
  banner: {
    margin: "var(--space-3) var(--space-4) 0",
    padding: "var(--space-3)",
    borderRadius: "var(--radius-card, 8px)",
    border: "1px solid var(--red-7, var(--border-standard))",
    background: "var(--red-3, transparent)",
    color: "var(--red-11, var(--text-standard))",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  note: { padding: "var(--space-1) var(--space-4)", color: "var(--text-metadata)", fontSize: "var(--text-body-sm)" },
  row: { display: "flex", gap: "var(--space-2)", flexWrap: "wrap" },
  pathLink: {
    font: "inherit",
    padding: 0,
    margin: 0,
    border: 0,
    background: "none",
    color: "var(--text-link)",
    textDecoration: "underline",
    cursor: "pointer",
    overflowWrap: "anywhere",
    textAlign: "inherit",
  },
  chips: { display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginBlockStart: "var(--space-1)" },
};

/** Unsaved text kept per file in the webview, so a closed tab or a crash
 * doesn't lose it. `base` is the disk text it was written against. */
export function createDrafts(storage = globalThis.localStorage) {
  const key = (path) => DRAFT_PREFIX + path;
  return {
    get(path) {
      try {
        const v = JSON.parse(storage?.getItem(key(path)) ?? "null");
        return v && typeof v.base === "string" && typeof v.text === "string" ? v : null;
      } catch {
        return null;
      }
    },
    set(path, base, text) {
      try {
        storage?.setItem(key(path), JSON.stringify({ base, text }));
      } catch {
        /* Storage full or unavailable: the editor still works. */
      }
    },
    clear(path) {
      try {
        storage?.removeItem(key(path));
      } catch {
        /* ignore */
      }
    },
  };
}

/** Builds the React views. Exported so tests can render them. */
export function createViews(React, files, useTabTitle, { drafts = createDrafts(), mountEditor = createEditor } = {}) {
  const h = React.createElement;

  const Button = ({ variant = "subtle", children, ...props }) =>
    h(
      "button",
      { type: "button", ...UI, className: "buzz-button", "data-variant": variant, "data-size": "sm", "data-disabled": props.disabled ? "" : undefined, ...props },
      h("span", { className: "buzz-button-label" }, children),
    );

  function FilePanel({ target }) {
    const path = pathOf(target) ?? "";
    useTabTitle(fileName(path));
    const [load, setLoad] = React.useState({ status: "loading" });
    const [dirty, setDirty] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [conflict, setConflict] = React.useState(false);
    const [note, setNote] = React.useState("");
    const [autosave, setAutosave] = React.useState(() => {
      try {
        return globalThis.localStorage?.getItem(AUTOSAVE_KEY) === "on";
      } catch {
        return false;
      }
    });
    // Mutable state the editor callbacks and timers read without re-rendering.
    const live = React.useRef({ alive: true, base: "", editor: null, saving: false, conflict: false, timer: 0 });
    const host = React.useRef(null);
    React.useEffect(() => {
      const l = live.current;
      l.alive = true;
      return () => {
        l.alive = false;
        clearTimeout(l.timer);
        l.editor?.destroy();
        l.editor = null;
      };
    }, []);
    React.useEffect(() => void (live.current.conflict = conflict), [conflict]);

    const markClean = (text) => {
      live.current.base = text;
      drafts.clear(path);
      setDirty(false);
    };

    const save = React.useCallback(
      async (force = false) => {
        const l = live.current;
        if (!l.editor || l.saving) return;
        const text = l.editor.text();
        l.saving = true;
        setBusy(true);
        setNote("");
        try {
          if (!force) {
            const disk = await files.read(path);
            if (disk.text !== l.base) {
              if (l.alive) setConflict(true);
              return;
            }
          }
          await files.write(path, text);
          if (!l.alive) return;
          setConflict(false);
          if (l.editor.text() === text) markClean(text);
          else l.base = text;
          setNote("Saved.");
        } catch (error) {
          if (l.alive) setNote(`Not saved: ${describe(error, path)}`);
        } finally {
          l.saving = false;
          if (l.alive) setBusy(false);
        }
      },
      [path],
    );
    const saveRef = React.useRef(save);
    saveRef.current = save;
    const autosaveRef = React.useRef(autosave);
    autosaveRef.current = autosave;

    // Open: read the file, restore an unsaved draft written against the same
    // disk text, and mount the editor.
    const open = React.useCallback(async () => {
      const l = live.current;
      setLoad({ status: "loading" });
      setConflict(false);
      setNote("");
      try {
        const { real, text } = await files.read(path);
        if (!l.alive) return;
        l.base = text;
        const draft = drafts.get(path);
        let start = text;
        if (draft && draft.text !== text) {
          if (draft.base === text) {
            start = draft.text;
            setNote("Restored your unsaved changes.");
          } else drafts.clear(path);
        }
        setDirty(start !== text);
        setLoad({ status: "ready", real });
        l.initial = start;
      } catch (error) {
        if (l.alive) setLoad({ status: "error", message: describe(error, path) });
      }
    }, [path]);
    React.useEffect(() => void open(), [open]);

    // Mount the editor once the host element exists.
    React.useEffect(() => {
      const l = live.current;
      if (load.status !== "ready" || !host.current || l.editor) return;
      l.editor = mountEditor({
        parent: host.current,
        text: l.initial ?? l.base,
        kind: /\.txt$/i.test(path) ? "text" : "markdown",
        onSave: () => saveRef.current(false),
        onChange: (text) => {
          const changed = text !== l.base;
          setDirty(changed);
          if (changed) drafts.set(path, l.base, text);
          else drafts.clear(path);
          clearTimeout(l.timer);
          if (changed && autosaveRef.current && !l.conflict)
            l.timer = setTimeout(() => saveRef.current(false), AUTOSAVE_MS);
        },
      });
      l.editor.focus();
    }, [load.status, path]);

    // Watch the file: pull in outside changes when nothing is unsaved here,
    // warn when there is.
    React.useEffect(() => {
      if (load.status !== "ready") return;
      const l = live.current;
      let stopped = false;
      const tick = async () => {
        if (stopped || l.saving || l.conflict || globalThis.document?.visibilityState === "hidden") return;
        try {
          const { text } = await files.read(path);
          if (stopped || !l.alive || l.saving || text === l.base || !l.editor) return;
          if (l.editor.text() === l.base) {
            l.editor.replace(text);
            markClean(text);
            setNote("Updated from disk.");
          } else setConflict(true);
        } catch {
          /* A missing file shows on the next save or refresh. */
        }
      };
      const id = setInterval(tick, POLL_MS);
      return () => {
        stopped = true;
        clearInterval(id);
      };
    }, [load.status, path]);

    const reloadFromDisk = async () => {
      const l = live.current;
      setBusy(true);
      try {
        const { text } = await files.read(path);
        if (!l.alive) return;
        l.editor?.replace(text);
        markClean(text);
        setConflict(false);
        setNote("Loaded the version on disk.");
      } catch (error) {
        if (l.alive) setNote(describe(error, path));
      } finally {
        if (l.alive) setBusy(false);
      }
    };

    const toggleAutosave = () => {
      const next = !autosave;
      setAutosave(next);
      try {
        globalThis.localStorage?.setItem(AUTOSAVE_KEY, next ? "on" : "off");
      } catch {
        /* ignore */
      }
      if (next && dirty && !conflict) save(false);
    };

    const ready = load.status === "ready";
    const stateLabel = !ready
      ? ""
      : conflict
        ? "Changed on disk"
        : busy
          ? "Saving…"
          : dirty
            ? autosave
              ? "Editing…"
              : "Unsaved changes"
            : "Saved";

    const bar = h(
      "div",
      { style: styles.bar, role: "toolbar", "aria-label": "File" },
      h("div", { style: styles.where, title: load.real || path }, h("bdi", null, load.real || path)),
      ready && h("span", { style: styles.state, role: "status", "data-local-files": "state" }, stateLabel),
      ready && h(Button, { key: "find", onClick: () => live.current.editor?.find(), title: "Find and replace (Ctrl/Cmd+F)" }, "Find"),
      ready &&
        h(
          Button,
          { key: "auto", onClick: toggleAutosave, "aria-pressed": autosave, title: "Save by itself a moment after you stop typing" },
          autosave ? "Autosave on" : "Autosave off",
        ),
      ready &&
        h(
          Button,
          {
            key: "reload",
            onClick: () => (dirty ? setConflict(true) : reloadFromDisk()),
            disabled: busy,
            title: "Load the file again from disk",
          },
          "Reload",
        ),
      ready &&
        h(
          Button,
          { key: "save", variant: "prominent", onClick: () => save(false), disabled: busy || !dirty, title: "Save (Ctrl/Cmd+S)" },
          busy ? "Saving…" : "Save",
        ),
    );

    let body = null;
    if (load.status === "loading") body = h("div", { style: styles.status }, "Opening…");
    else if (load.status === "error")
      body = h(
        "div",
        { style: styles.error, role: "alert" },
        h("p", { style: { ...styles.p, fontWeight: 650 } }, "Can't open this file"),
        h("p", { style: styles.p }, load.message),
        h(Button, { onClick: open }, "Try again"),
      );

    return h(
      "div",
      { style: styles.pane, "data-local-files": "panel" },
      bar,
      conflict &&
        h(
          "div",
          { style: styles.banner, role: "alert" },
          h("strong", null, dirty ? "This file changed on disk while you were editing." : "Reload this file?"),
          h(
            "span",
            null,
            dirty
              ? "Someone else (maybe an agent) saved it. Choose which version to keep."
              : "Nothing is unsaved here.",
          ),
          h(
            "div",
            { style: styles.row },
            dirty && h(Button, { variant: "destructive", onClick: () => save(true), disabled: busy }, "Keep mine (overwrite)"),
            h(Button, { onClick: reloadFromDisk, disabled: busy }, dirty ? "Use the disk version" : "Reload"),
            h(Button, { onClick: () => setConflict(false), disabled: busy }, dirty ? "Decide later" : "Cancel"),
          ),
        ),
      note && h("div", { style: styles.note, role: "status" }, note),
      body,
      // The editor's element stays mounted once ready, so CodeMirror keeps its DOM.
      ready && h("div", { ref: host, style: styles.editor, "data-local-files": "editor" }),
    );
  }

  /** A path in message prose, drawn as a link that opens the side pane. */
  function PathLink({ text, canOpen, open }) {
    const target = targetFor(text);
    if (!canOpen?.(target)) return text;
    return h(
      "button",
      { type: "button", style: styles.pathLink, title: `Open ${fileName(text)} beside the chat`, "data-local-files": "link", onClick: () => open(target) },
      text,
    );
  }

  /** Buttons below a message for paths written inside code. */
  function CodePaths({ message, canOpen, open }) {
    const paths = React.useMemo(() => findCodePaths(message?.content), [message?.content]);
    const openable = paths.filter((p) => canOpen?.(targetFor(p)));
    if (!openable.length) return null;
    return h(
      "div",
      { style: styles.chips, "data-local-files": "chips" },
      openable.map((p) => h(Button, { key: p, onClick: () => open(targetFor(p)), title: p }, `Open ${fileName(p)}`)),
    );
  }

  return { FilePanel, PathLink, CodePaths };
}

export function apply(ctx, overrides = {}) {
  const React = ctx.react;
  const files = overrides.files ?? createFiles(ctx.host);
  const useTabTitle = typeof ctx.panels?.useTabTitle === "function" ? ctx.panels.useTabTitle : () => {};
  const views = createViews(React, files, useTabTitle, overrides);

  ctx.panels.register({
    id: "file",
    title: "Local file",
    keepOpen: true,
    matches: (target) => {
      const path = pathOf(target);
      return path !== null && pathProblem(path) === null;
    },
    component: views.FilePanel,
  });

  ctx.conversation.registerInline({
    id: "paths",
    title: "Local file paths",
    matches: (content) => findPaths(content?.text).map(({ start, end }) => ({ start, end })),
    component: views.PathLink,
  });

  ctx.conversation.registerAccessory({
    id: "code-paths",
    title: "Open local files",
    placement: "message",
    component: views.CodePaths,
  });
  // Return nothing: Cordis treats a returned value from apply as an effect
  // and rejects anything that is not a function ("Invalid effect").
}
