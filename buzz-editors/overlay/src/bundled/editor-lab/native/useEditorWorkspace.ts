import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { RelaySnapshot } from "../../../features/relay/service";
import { readView, subscribeView, writeView } from "../../../shared/view-state";
import { editorWorkspaceId, editorWorkspaceKey } from "./workspace";

/** All three editors and Brand settings select from Buzz's existing Solo workspaces. */
export function useEditorWorkspace(connection: RelaySnapshot) {
  const scope = connection.scope ?? "local-preview";
  const preferences = connection.session.soloPreferences;
  const snapshot = useSyncExternalStore(
    preferences.subscribe,
    preferences.snapshot,
    preferences.snapshot,
  );
  useEffect(() => {
    void preferences.ensure();
  }, [preferences]);
  const subscribe = useCallback(
    (listener: () => void) => subscribeView(scope, listener),
    [scope],
  );
  const read = useCallback(() => {
    const value = readView<unknown>(scope, editorWorkspaceKey, "");
    return typeof value === "string" ? value : "";
  }, [scope]);
  const selected = useSyncExternalStore(subscribe, read, () => "");
  const project = snapshot.data?.sections.find((item) => item.id === selected);
  // Never redirect a missing workspace's saved files into the unfiled directory.
  const unavailable = !!selected && !project;
  return {
    projectId: selected,
    workspaceId: editorWorkspaceId(scope, selected),
    name:
      project?.name ??
      (selected ? "Unavailable workspace" : "Unfiled editor work"),
    unavailable,
    choose: (id: string) => writeView(scope, editorWorkspaceKey, id),
  };
}
