import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { ComposerToolProps } from "../../../features/conversation/contracts";

type Editor = Pick<
  ComposerToolProps,
  | "session"
  | "scope"
  | "channelId"
  | "threadRootId"
  | "disabled"
  | "attachFiles"
  | "insertText"
  | "focus"
>;

/** Commands belong to one editor placement, never to another view of the same conversation. */
export class EditorComposerBridge {
  private readonly editors = new Map<symbol, Editor>();
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private changed() {
    for (const listener of this.listeners) listener();
  }
  attach(owner: symbol, editor: Editor): () => void {
    this.editors.set(owner, editor);
    this.changed();
    return () => {
      if (this.editors.get(owner) === editor) {
        this.editors.delete(owner);
        this.changed();
      }
    };
  }
  private editor(
    owner: symbol,
    session: Editor["session"],
    scope: string,
    channelId: string,
  ) {
    const editor = this.editors.get(owner);
    return editor &&
      editor.session === session &&
      editor.scope === scope &&
      editor.channelId === channelId &&
      !editor.threadRootId &&
      !editor.disabled
      ? editor
      : undefined;
  }
  available(
    owner: symbol,
    session: Editor["session"],
    scope: string,
    channelId: string,
  ): boolean {
    return !!this.editor(owner, session, scope, channelId);
  }
  insert(
    owner: symbol,
    session: Editor["session"],
    scope: string,
    channelId: string,
    text: string,
  ): boolean {
    const editor = this.editor(owner, session, scope, channelId);
    if (!editor?.insertText(text)) return false;
    editor.focus();
    return true;
  }
  attachFiles(
    owner: symbol,
    session: Editor["session"],
    scope: string,
    channelId: string,
    files: readonly File[],
  ): true | string {
    const editor = this.editor(owner, session, scope, channelId);
    return (
      editor?.attachFiles?.(files) ??
      "Attachments are unavailable in this conversation."
    );
  }
  clear(): void {
    this.editors.clear();
    this.changed();
  }
}

const Owner = createContext<{
  bridge: EditorComposerBridge;
  token: symbol;
} | null>(null);

/** Mark only this editor's native composer as the destination for its original context actions. */
export function EditorComposerOwner({
  bridge,
  token,
  children,
}: {
  bridge: EditorComposerBridge;
  token: symbol;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ bridge, token }), [bridge, token]);
  return <Owner.Provider value={value}>{children}</Owner.Provider>;
}

/** Buzz supplies revocable commands through its existing tool contribution; no extra composer is rendered. */
export function EditorComposerCapture(props: ComposerToolProps) {
  const owner = useContext(Owner);
  const {
    session,
    scope,
    channelId,
    threadRootId,
    disabled,
    insertText,
    attachFiles,
    focus,
  } = props;
  useLayoutEffect(
    () =>
      owner?.bridge.attach(owner.token, {
        session,
        scope,
        channelId,
        threadRootId,
        disabled,
        insertText,
        ...(attachFiles ? { attachFiles } : {}),
        focus,
      }),
    [
      owner,
      session,
      scope,
      channelId,
      threadRootId,
      disabled,
      insertText,
      attachFiles,
      focus,
    ],
  );
  return null;
}
