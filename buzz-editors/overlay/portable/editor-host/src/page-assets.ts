import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { extname, join } from "node:path";
import type { BigIntStats } from "node:fs";

const assetVersion = (stat: BigIntStats): string =>
  `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;

/** Matches the existing desktop host's maximum readable file size. */
export const PAGE_ASSET_MAX_BYTES = 50 * 1024 * 1024;
const mediaTypes: Readonly<Record<string, string>> = {
  ".css": "text/css",
  ".html": "text/html",
  ".htm": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/vnd.microsoft.icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

/** Read rendering assets only from the isolated workspace, without following imported symlinks.
 * @param workspaceRoot - Canonical directory owned by the editor repository.
 * @param relativePath - Decoded project-relative file path, without URL query or fragment.
 * @param knownVersion - Last observed file identity, size and modification metadata; omitted on first read.
 * @param sectionLibraryRoot - Optional canonical shared library for imported `library-assets/` resources.
 * @returns A byte-free acknowledgement for an unchanged file, otherwise bounded bytes and its version. A file changing during a read rejects.
 */
export async function readPageAsset(
  workspaceRoot: string,
  relativePath: string,
  knownVersion?: string,
  sectionLibraryRoot?: string,
) {
  const parts = relativePath.split("/");
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    parts.some(
      (part) =>
        !part ||
        part.startsWith(".") ||
        part === "node_modules" ||
        part.includes(":"),
    )
  )
    throw new Error("Asset path must be a project-relative rendering file");
  const mimeType =
    mediaTypes[extname(relativePath).toLowerCase()] ??
    "application/octet-stream";
  const shared =
    sectionLibraryRoot !== undefined &&
    relativePath.startsWith("library-assets/");
  const root = await realpath(shared ? sectionLibraryRoot : workspaceRoot);
  if (shared && root !== sectionLibraryRoot)
    throw new Error("Shared section library must not use symbolic links");
  let path = root;
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    const entry = await lstat(path);
    if (entry.isSymbolicLink())
      throw new Error("Preview assets must not use symbolic links");
    if (index < parts.length - 1 ? !entry.isDirectory() : !entry.isFile())
      throw new Error("Preview asset is not a regular file");
  }
  if ((await realpath(path)) !== path)
    throw new Error("Preview asset left its workspace");
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat({ bigint: true });
    if (!stat.isFile()) throw new Error("Preview asset is not a regular file");
    if (stat.size > PAGE_ASSET_MAX_BYTES)
      throw new Error("Preview asset exceeds 50 MB");
    const version = assetVersion(stat);
    if (knownVersion === version)
      return { path: relativePath, version, unchanged: true as const };
    const chunks: Buffer[] = [];
    let size = 0;
    // The inclusive end also bounds a file that grows after the size check.
    for await (const chunk of file.createReadStream({
      autoClose: false,
      end: PAGE_ASSET_MAX_BYTES,
    })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > PAGE_ASSET_MAX_BYTES)
        throw new Error("Preview asset exceeds 50 MB");
      chunks.push(bytes);
    }
    if (assetVersion(await file.stat({ bigint: true })) !== version)
      throw new Error(
        "Preview asset changed during the read; refresh to retry",
      );
    return {
      path: relativePath,
      version,
      unchanged: false as const,
      mimeType,
      dataBase64: Buffer.concat(chunks).toString("base64"),
    };
  } finally {
    await file.close();
  }
}
