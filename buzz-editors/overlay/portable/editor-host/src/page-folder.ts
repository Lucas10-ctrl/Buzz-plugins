import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** Validate the original Builder's existing-project subfolder choice without adopting or copying another project.
 * @param workspaceRoot - The repository-owned project directory.
 * @param selected - The native picker result, absolute or home-relative.
 * @returns A portable subfolder path for the original import request.
 */
export async function validatePageFolder(
  workspaceRoot: string,
  selected: string,
): Promise<string> {
  const root = await realpath(workspaceRoot);
  const expanded = selected.startsWith("~/")
    ? join(homedir(), selected.slice(2))
    : selected;
  if (!isAbsolute(expanded) || expanded.includes("\0"))
    throw new Error("Choose a folder inside this editor workspace");
  const path = resolve(expanded);
  const subfolder = relative(root, path);
  if (
    !subfolder ||
    subfolder === ".." ||
    subfolder.startsWith(`..${sep}`) ||
    isAbsolute(subfolder)
  )
    throw new Error("Choose a subfolder inside this editor workspace");
  let current = root;
  for (const part of subfolder.split(sep)) {
    current = join(current, part);
    const entry = await lstat(current);
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error(
        "The selected project subfolder must be a directory without symbolic links",
      );
  }
  if ((await realpath(path)) !== path)
    throw new Error("The selected folder left this editor workspace");
  return subfolder.split(sep).join("/");
}
