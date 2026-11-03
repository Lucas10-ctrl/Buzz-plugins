import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { parseDesignDocument } from "../../copyos-domain/src/design-schema.ts";
import { readPageAsset } from "./page-assets.ts";

/** Read saved comparison material only from this editor profile; source repositories are never opened for recovery or publication. */
export class CanvasComparables {
  constructor(private readonly dataRoot: string) {}

  /** Resolve an opaque catalog reference without creating or adopting a workspace.
   * @param reference - A hash returned by this profile's workspace catalog.
   * @returns Canonical saved workspace directory, with rendering storage free of symlinks.
   */
  async root(reference: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/u.test(reference))
      throw new Error("Unknown comparison workspace");
    const parent = join(await realpath(this.dataRoot), "workspaces");
    if ((await realpath(parent)) !== parent)
      throw new Error(
        "Comparison workspace parent must not be a symbolic link",
      );
    const root = join(parent, reference);
    if (!(await lstat(root)).isDirectory() || (await realpath(root)) !== root)
      throw new Error(
        "Comparison workspace must be a saved directory without symbolic links",
      );
    for (const path of ["designs", "assets", "assets/images", "assets/fonts"]) {
      const location = join(root, path);
      let entry: Stats;
      try {
        entry = await lstat(location);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          continue;
        throw error;
      }
      if (entry.isSymbolicLink() || !entry.isDirectory())
        throw new Error("Comparison storage must not use symbolic links");
      if (path !== "assets")
        for (const child of await readdir(location, { withFileTypes: true }))
          if (child.isSymbolicLink())
            throw new Error("Comparison storage must not use symbolic links");
    }
    const guide = join(root, "copyos.style-guide.json");
    try {
      if ((await lstat(guide)).isSymbolicLink())
        throw new Error("Comparison style guide must not use symbolic links");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
    return root;
  }

  private async files(root: string): Promise<string[]> {
    try {
      return (await readdir(join(root, "designs"), { withFileTypes: true }))
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith(".design.json"),
        )
        .map((entry) => entry.name.slice(0, -12))
        .sort();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return [];
      throw error;
    }
  }

  /** Read an original scene through the same bounded, symlink-refusing asset reader as preview.
   * @param root - A catalog-resolved workspace directory.
   * @param designId - Original scene identity.
   * @returns Validated original document, without changing its source files.
   */
  async read(root: string, designId: string) {
    if (!/^[a-f0-9-]{36}$/u.test(designId))
      throw new Error("Invalid comparison design identity");
    const file = await readPageAsset(root, `designs/${designId}.design.json`);
    if (file.unchanged) throw new Error("Comparison needs saved scene bytes");
    const document = parseDesignDocument(
      JSON.parse(Buffer.from(file.dataBase64, "base64").toString("utf8")),
    );
    if (document.id !== designId)
      throw new Error("Comparison design identity differs from its file");
    return document;
  }

  /** Page through previous designs without returning their entire scenes in a list.
   * @param root - Catalog-resolved source workspace.
   * @param offset - First design index.
   * @param limit - Maximum designs in this page, validated by the host.
   * @returns Scene summaries, invalid-file reports and the next offset.
   */
  async designs(root: string, offset: number, limit: number) {
    const files = await this.files(root);
    const designs = [],
      invalid = [];
    for (const id of files.slice(offset, offset + limit)) {
      try {
        const doc = await this.read(root, id);
        const artboards = doc.nodes.filter(
          (node) => node.parentId === null && node.kind === "frame",
        );
        designs.push({
          id: doc.id,
          title: doc.title.slice(0, 160),
          titleTruncated: doc.title.length > 160,
          revision: doc.revision,
          nodeCount: doc.nodes.length,
          artboardCount: artboards.length,
          artboards: artboards.slice(0, 10).map((node) => ({
            id: node.id,
            name: node.name.slice(0, 160),
            nameTruncated: node.name.length > 160,
            width: node.width,
            height: node.height,
          })),
        });
      } catch (error) {
        invalid.push({
          designId: id,
          error: (error instanceof Error ? error.message : String(error)).slice(
            0,
            500,
          ),
        });
      }
    }
    return {
      designs,
      invalid,
      total: files.length,
      nextOffset: offset + limit < files.length ? offset + limit : null,
    };
  }

  /** Discover only saved workspaces in this isolated profile, with bounded samples for choosing comparable work.
   * @param workspaceId - Current workspace, marked separately in the catalog.
   * @param offset - First catalog index.
   * @param limit - Maximum workspace entries in this page.
   * @returns Read-only opaque references; no source paths or external projects are adopted.
   */
  async list(workspaceId: string, offset: number, limit: number) {
    const parent = join(await realpath(this.dataRoot), "workspaces");
    if ((await realpath(parent)) !== parent)
      throw new Error(
        "Comparison workspace parent must not be a symbolic link",
      );
    const references = (await readdir(parent))
      .filter((name) => /^[a-f0-9]{64}$/u.test(name))
      .sort();
    const current = createHash("sha256").update(workspaceId).digest("hex");
    const workspaces = [],
      invalid = [];
    for (const reference of references.slice(offset, offset + limit)) {
      try {
        const root = await this.root(reference);
        const sample = await this.designs(root, 0, 3);
        workspaces.push({
          workspaceRef: reference,
          current: reference === current,
          designCount: sample.total,
          sampleDesigns: sample.designs.map(
            ({ id, title, titleTruncated, revision, nodeCount }) => ({
              id,
              title,
              titleTruncated,
              revision,
              nodeCount,
            }),
          ),
          invalid: sample.invalid,
        });
      } catch (error) {
        invalid.push({
          workspaceRef: reference,
          error: (error instanceof Error ? error.message : String(error)).slice(
            0,
            500,
          ),
        });
      }
    }
    return {
      workspaces,
      invalid,
      total: references.length,
      nextOffset: offset + limit < references.length ? offset + limit : null,
    };
  }
}
