/** Stable Solo coordinates; unfiled work retains the lab's existing community directory. */
export function editorWorkspaceId(scope: string, projectId: string): string {
  return projectId ? JSON.stringify(["solo", scope, projectId]) : scope;
}
export const editorWorkspaceKey = "editor-lab:solo-workspace";

type WorkspaceRecord = Readonly<{
  sections: readonly Readonly<{ id: string; name: string }>[];
  assignments: Readonly<Record<string, string>>;
}>;
/** The part of a workspace preferences store the editors read. */
export type WorkspacePreferences = Readonly<{
  snapshot: () => Readonly<{ data?: WorkspaceRecord | null | undefined }>;
  subscribe: (listener: () => void) => () => void;
  ensure: () => Promise<unknown> | unknown;
}>;

/**
 * Buzz's personal workspaces. Buzz 1.0.6 merged Solo workspaces and channel
 * groups into one record on `sidebarPreferences` and removed
 * `soloPreferences`; older builds keep Solo workspaces on `soloPreferences`.
 */
export function workspacePreferences(session: object): WorkspacePreferences {
  const source = session as {
    soloPreferences?: WorkspacePreferences;
    sidebarPreferences?: WorkspacePreferences;
  };
  return source.soloPreferences ?? source.sidebarPreferences ?? noWorkspaces;
}
const emptySnapshot = Object.freeze({ data: undefined });
const noWorkspaces: WorkspacePreferences = Object.freeze({
  snapshot: () => emptySnapshot,
  subscribe: () => () => {},
  ensure: () => undefined,
});
