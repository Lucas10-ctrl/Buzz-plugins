// Copied from block/buzz-app src/features/solo/workspace.ts (Apache-2.0):
// the parts that read and write a Canvas's project-folder block.
export const LIVE_CANVAS_BYTES = 256 * 1024;
export const LIVE_CANVAS_LIMIT = `${LIVE_CANVAS_BYTES / 1024} KiB`;
export type Workspace = {
  folders: string[];
  worktree?: { location: string; baseBranch: string } | undefined;
  canvas: string;
};
const prefix = "<!-- buzz-session-workspace:v1 ";
const end = "<!-- /buzz-session-workspace -->";
const worktreeRule =
  "- Make code changes in that new worktree. A task that only reads code, or does not use a repository, usually does not need one.";
export const emptyWorkspace = (): Workspace => ({ folders: [], canvas: "" });

export function validateWorkspace(value: Workspace): Workspace {
  const folders = [
    ...new Set(value.folders.map((path) => path.trim()).filter(Boolean)),
  ];
  const path = (value: string) =>
    value.length <= 2048 &&
    [...value].every((char) => char.charCodeAt(0) >= 32 && char !== "`");
  if (folders.length > 20 || folders.some((folder) => !path(folder)))
    throw new Error(
      "Use up to 20 workspace folders, without control characters or backticks.",
    );
  const worktree = value.worktree && {
    location: value.worktree.location.trim(),
    baseBranch: value.worktree.baseBranch.trim(),
  };
  if (
    worktree &&
    (!folders.length ||
      !worktree.location ||
      !path(worktree.location) ||
      !worktree.baseBranch ||
      !path(worktree.baseBranch))
  )
    throw new Error(
      "Choose a workspace folder, worktree location, and base branch.",
    );
  return { folders, ...(worktree ? { worktree } : {}), canvas: value.canvas };
}

/** Workspace preferences remain ordinary Canvas instructions, as in the reference workflow. */
export function workspaceCanvas(input: Workspace): string {
  const value = validateWorkspace(input);
  if (new TextEncoder().encode(value.canvas).length > LIVE_CANVAS_BYTES)
    throw new Error(`Keep Canvas below ${LIVE_CANVAS_LIMIT}.`);
  if (!value.folders.length) return value.canvas;
  const metadata = JSON.stringify({
    folders: value.folders,
    worktree: value.worktree,
  })
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
  const instructions = value.worktree
    ? [
        "## Workspace instructions",
        "",
        ...value.folders.map(
          (folder) =>
            `- Use \`${folder}\` for review only. Do not make changes directly in it.`,
        ),
        `- Before starting new work, fetch the latest \`${value.worktree.baseBranch}\` branch from origin.`,
        `- For each repository that needs changes, create a new worktree under \`${value.worktree.location}\` from \`origin/${value.worktree.baseBranch}\`.`,
        worktreeRule,
      ]
    : [
        "## Project folders",
        "",
        ...value.folders.map((folder) => `- \`${folder}\``),
      ];
  const canvas = [
    `${prefix}${metadata} -->`,
    ...instructions,
    end,
    "",
    value.canvas,
  ].join("\n");
  if (new TextEncoder().encode(canvas).length > LIVE_CANVAS_BYTES)
    throw new Error(
      `Keep Canvas and workspace instructions below ${LIVE_CANVAS_LIMIT}.`,
    );
  return canvas;
}


/** The folders a Canvas's workspace block lets an agent work in: its project
 * folders, then its worktree location. Unlike `readWorkspace`, hand edits to
 * the block's instructions are kept, so an agent still finds its folders; a
 * missing or malformed block names none. */
export function workspaceDirectories(content: string): string[] {
  if (!content.startsWith(prefix)) return [];
  try {
    const { folders, worktree } = parseWorkspace(content);
    return [...new Set([...folders, ...(worktree ? [worktree.location] : [])])];
  } catch {
    return [];
  }
}

function parseWorkspace(content: string): Workspace {
  const lineEnd = content.indexOf(" -->\n");
  const blockEnd = content.indexOf(`\n${end}\n\n`, lineEnd);
  if (lineEnd < 0 || blockEnd < 0)
    throw new Error(
      "Workspace metadata is incomplete. Edit the raw Canvas before changing workspace settings.",
    );
  let raw: unknown;
  try {
    raw = JSON.parse(content.slice(prefix.length, lineEnd));
  } catch {
    throw new Error(
      "Workspace metadata is invalid. Edit the raw Canvas before changing workspace settings.",
    );
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    !("folders" in raw) ||
    !Array.isArray(raw.folders) ||
    raw.folders.some((v) => typeof v !== "string")
  )
    throw new Error("Invalid workspace folders.");
  const worktree = "worktree" in raw ? raw.worktree : undefined;
  if (
    worktree !== undefined &&
    (!worktree ||
      typeof worktree !== "object" ||
      !("location" in worktree) ||
      typeof worktree.location !== "string" ||
      !("baseBranch" in worktree) ||
      typeof worktree.baseBranch !== "string")
  )
    throw new Error("Invalid worktree settings.");
  return validateWorkspace({
    folders: raw.folders,
    ...(worktree
      ? { worktree: worktree as { location: string; baseBranch: string } }
      : {}),
    canvas: content.slice(blockEnd + end.length + 3),
  });
}

/** One existing encrypted template record per project. */
export async function projectTemplateId(projectId: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(projectId),
  );
  return `me-section-${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
