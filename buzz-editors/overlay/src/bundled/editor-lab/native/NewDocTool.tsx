import { useRef, useState } from "react";
import type { PluginModule } from "../../../plugins/api";
import type { ComposerToolProps } from "../../../features/conversation/contracts";
import {
  PopoverPopup,
  PopoverRoot,
  PopoverTrigger,
} from "../../../shared/design-system/ui/Popover";
import { IconButton } from "../../../shared/design-system/ui/IconButton";
import { Button } from "../../../shared/design-system/ui/Button";
import { Input } from "../../../shared/design-system/ui/Input";
import { FilePlusIcon } from "../../../shared/design-system/icons/index";
import { readView } from "../../../shared/view-state";
import type { EditorStore } from "./pages-client";
import { docChatLink, docTarget } from "./docs-route";
import { editorWorkspaceId, editorWorkspaceKey } from "./workspace";
import { useInEditorComposer } from "./editor-composer";
import styles from "./new-doc-tool.module.css";

type Ctx = Parameters<PluginModule["apply"]>[0];

/** Where a doc started from a chat lives: the chat's Solo workspace, else the one selected in Docs. */
export function chatDocWorkspace(ctx: Ctx, channelId: string): string {
  const { scope, session } = ctx.relay.snapshot();
  const community = scope ?? "local-preview";
  const solo = session.soloPreferences.snapshot().data;
  const filed = solo?.assignments[channelId];
  if (filed && solo?.sections.some((item) => item.id === filed))
    return editorWorkspaceId(community, filed);
  const selected = readView<unknown>(community, editorWorkspaceKey, "");
  return editorWorkspaceId(
    community,
    typeof selected === "string" ? selected : "",
  );
}

/** Message box button: anyone writing a message can start a doc and drop its link in. */
export function createNewDocTool(ctx: Ctx, store: EditorStore) {
  return function NewDocTool({
    channelId,
    disabled,
    insertResource,
    focus,
  }: ComposerToolProps) {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const input = useRef<HTMLInputElement>(null);
    const inEditor = useInEditorComposer();
    const create = async (then: "link" | "open") => {
      const name = title.trim() || "Untitled";
      setBusy(true);
      setError("");
      try {
        const workspaceId = chatDocWorkspace(ctx, channelId);
        const doc = await store.call<{ id: string }>("createDoc", {
          workspaceId,
          title: name,
          sections: [],
        });
        const added = insertResource({
          uri: docChatLink(workspaceId, doc.id),
          label: name,
        });
        if (added !== true && then === "link") {
          setError(added);
          return;
        }
        setOpen(false);
        setTitle("");
        if (then === "open")
          void ctx.navigation.open(
            docTarget({
              workspaceId,
              docId: doc.id,
              tabId: null,
              threadId: null,
              passage: null,
              token: undefined,
            }),
          );
        else focus();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not create the doc.",
        );
      } finally {
        setBusy(false);
      }
    };
    // Docs' own request box already has its document; the button is for chats.
    if (inEditor) return null;
    return (
      <PopoverRoot
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError("");
        }}
      >
        <PopoverTrigger
          disabled={disabled}
          render={
            <IconButton
              type="button"
              size="toolbar"
              disabled={disabled}
              aria-label="New doc"
              title="New doc"
              icon={<FilePlusIcon size={20} aria-hidden="true" />}
            />
          }
        />
        <PopoverPopup
          side="top"
          sideOffset={4}
          padding="none"
          initialFocus={input}
          aria-label="New doc"
          style={{ width: 320, overflow: "hidden" }}
        >
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) void create("link");
            }}
          >
            <label
              className={styles.label}
              htmlFor="buzz-new-doc-title"
              aria-label="New doc title"
            >
              New doc
            </label>
            <Input
              id="buzz-new-doc-title"
              ref={input}
              placeholder="Untitled"
              value={title}
              maxLength={200}
              disabled={busy}
              onValueChange={setTitle}
            />
            <p className={styles.hint}>
              The link goes into your message. Docs stay on this device.
            </p>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <Button
                type="button"
                variant="subtle"
                size="sm"
                disabled={busy}
                onClick={() => void create("open")}
              >
                Create and open
              </Button>
              <Button
                type="submit"
                variant="prominent"
                size="sm"
                disabled={busy}
              >
                Add to message
              </Button>
            </div>
          </form>
        </PopoverPopup>
      </PopoverRoot>
    );
  };
}
