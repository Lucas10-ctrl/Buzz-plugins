/** Stable Solo coordinates; unfiled work retains the lab's existing community directory. */
export function editorWorkspaceId(scope: string, projectId: string): string {
  return projectId ? JSON.stringify(["solo", scope, projectId]) : scope;
}
export const editorWorkspaceKey = "editor-lab:solo-workspace";
