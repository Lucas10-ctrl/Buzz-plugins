// The writing surface: CodeMirror with Markdown shown Omawrite-style. The
// file's text is edited as-is; headings, bold and code are styled in place and
// the Markdown markers (#, **, `, >, list bullets) are dimmed, never removed.

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";

// ---- Commands (pure: state in, transaction spec out) ----------------------

/** Wraps each selection in `marker` (or unwraps it if already wrapped). An
 * empty selection gets an empty pair with the cursor between. */
export function toggleWrapSpec(state, marker) {
  const n = marker.length;
  return state.changeByRange((range) => {
    const before = state.sliceDoc(range.from - n, range.from);
    const after = state.sliceDoc(range.to, range.to + n);
    if (before === marker && after === marker) {
      return {
        changes: [
          { from: range.from - n, to: range.from },
          { from: range.to, to: range.to + n },
        ],
        range: EditorSelection.range(range.from - n, range.to - n),
      };
    }
    const inner = state.sliceDoc(range.from, range.to);
    if (inner.length >= 2 * n && inner.startsWith(marker) && inner.endsWith(marker)) {
      return {
        changes: { from: range.from, to: range.to, insert: inner.slice(n, -n) },
        range: EditorSelection.range(range.from, range.to - 2 * n),
      };
    }
    return {
      changes: [
        { from: range.from, insert: marker },
        { from: range.to, insert: marker },
      ],
      range: EditorSelection.range(range.from + n, range.to + n),
    };
  });
}

/** `[selection](url)` with `url` selected, ready to type over. */
export function linkSpec(state) {
  return state.changeByRange((range) => {
    const label = state.sliceDoc(range.from, range.to) || "link";
    const insert = `[${label}](url)`;
    const urlFrom = range.from + label.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlFrom, urlFrom + 3),
    };
  });
}

const run = (spec) => (view) => {
  if (view.state.readOnly) return false;
  view.dispatch(view.state.update(spec(view.state), { scrollIntoView: true, userEvent: "input" }));
  return true;
};

// ---- Look ---------------------------------------------------------------

const markdownStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.6em", fontWeight: "650", lineHeight: "1.3" },
  { tag: t.heading2, fontSize: "1.35em", fontWeight: "650", lineHeight: "1.35" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "650" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "650" },
  { tag: t.strong, fontWeight: "650" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, fontFamily: "var(--font-mono)", fontSize: "0.9em" },
  { tag: t.link, color: "var(--text-link)" },
  { tag: t.url, color: "var(--text-metadata)" },
  { tag: t.quote, color: "var(--text-subtle)" },
  // The Markdown markers themselves: present, but quiet.
  { tag: [t.processingInstruction, t.contentSeparator], color: "var(--text-metadata)", opacity: "0.55" },
  { tag: t.meta, color: "var(--text-metadata)" },
]);

const theme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--text-standard)",
    backgroundColor: "transparent",
    fontSize: "var(--text-message)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.65",
    padding: "var(--space-6, 24px) var(--space-4, 16px) 40vh",
  },
  ".cm-content": {
    maxWidth: "72ch",
    margin: "0 auto",
    caretColor: "var(--text-standard)",
    padding: 0,
  },
  ".cm-line": { padding: 0 },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text-standard)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent-overlay-highlight, rgba(80, 140, 255, 0.28)) !important",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--accent-overlay-quiet, rgba(80, 140, 255, 0.14))" },
  ".cm-searchMatch": {
    backgroundColor: "var(--accent-overlay-quiet, rgba(255, 200, 0, 0.25))",
    outline: "1px solid var(--border-standard)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--accent-overlay-highlight, rgba(255, 200, 0, 0.45))" },
  ".cm-placeholder": { color: "var(--text-metadata)" },
  ".cm-panels": {
    backgroundColor: "var(--surface-panel)",
    color: "var(--text-standard)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border-standard)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border-standard)" },
  ".cm-search": { padding: "var(--space-2, 8px) var(--space-4, 16px)", fontSize: "var(--text-body-sm)" },
  ".cm-search input, .cm-search button, .cm-search label": { fontSize: "var(--text-body-sm)" },
  ".cm-textfield": {
    backgroundColor: "transparent",
    color: "inherit",
    border: "1px solid var(--border-standard)",
    borderRadius: "6px",
    padding: "3px 6px",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "transparent",
    color: "inherit",
    border: "1px solid var(--border-standard)",
    borderRadius: "6px",
    padding: "3px 8px",
  },
  ".cm-panel.cm-search [name=close]": { color: "var(--text-metadata)" },
});

// ---- Editor ---------------------------------------------------------------

/**
 * Mounts the editor in `parent`. `kind` is "markdown" or "text".
 * `onChange(text)` runs after every edit; `onSave()` on Ctrl/Cmd+S.
 */
export function createEditor({ parent, text, kind = "markdown", onChange, onSave }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        EditorState.allowMultipleSelections.of(true),
        search({ top: true }),
        highlightSelectionMatches(),
        placeholder("Start writing…"),
        kind === "markdown" ? [markdown({ base: markdownLanguage }), syntaxHighlighting(markdownStyle)] : [],
        theme,
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => (onSave?.(), true) },
          { key: "Mod-b", preventDefault: true, run: run((s) => toggleWrapSpec(s, "**")) },
          { key: "Mod-i", preventDefault: true, run: run((s) => toggleWrapSpec(s, "*")) },
          { key: "Mod-k", preventDefault: true, run: run(linkSpec) },
          ...searchKeymap,
          ...historyKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange?.(update.state.doc.toString());
        }),
        EditorView.contentAttributes.of({ spellcheck: "true", "aria-label": "File text" }),
      ],
    }),
  });
  return {
    view,
    text: () => view.state.doc.toString(),
    /** Replaces the whole text (a reload from disk), keeping the cursor near
     * where it was. Not added to undo history as a typed edit. */
    replace(next) {
      const head = Math.min(view.state.selection.main.head, next.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: EditorSelection.cursor(head),
        userEvent: "reload",
      });
    },
    find: () => openSearchPanel(view),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
