import { invoke, isTauri } from "@tauri-apps/api/core";
import type { EditorStore } from "./pages-client";

/** Use Buzz's existing native picker and retain the original project-subfolder rule.
 * @param store - The same repository transport used by Builder and its agent.
 * @param workspaceId - The editor workspace at the time the chooser opens.
 * @returns The validated project-relative folder, or null when the owner cancels.
 */
export async function pickPageFolder(
  store: EditorStore,
  workspaceId: string,
): Promise<string | null> {
  if (!isTauri())
    throw new Error(
      "Choose a project subfolder in Buzz Editor Lab desktop. The web preview has no native folder picker.",
    );
  const { projectRoot } = await store.call<{ projectRoot: string }>(
    "getPageWorkspace",
    { workspaceId },
  );
  const selected = await invoke<string | null>("workspace_pick_folder", {
    title: "Choose a subfolder in this editor workspace",
    start: projectRoot,
  });
  if (selected === null) return null;
  return store.call<string>("validatePageFolder", {
    workspaceId,
    path: selected,
  });
}
