import { lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { CopyOSGenerationRepository } from "../../copyos-domain/src/generations.ts";
import type {
  CopyOSGenerationImage,
  CopyOSGenerationRecord,
} from "../../copyos-domain/src/types.ts";
import { DESIGN_IMAGE_ASSET_MAX_BYTES } from "../../copyos-domain/src/design-image-assets.ts";
import { readPageAsset } from "./page-assets.ts";

async function directories(root: string): Promise<void> {
  for (const part of [
    ".copyos",
    ".copyos/generations",
    "assets",
    "assets/images",
    "assets/generated",
  ]) {
    const path = join(root, part);
    try {
      await mkdir(path);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
    }
    if ((await realpath(path)) !== path || !(await lstat(path)).isDirectory())
      throw new Error("Canvas generation storage must not use symbolic links");
  }
}
async function recordFile(root: string, id: string): Promise<void> {
  // The original repository validates the UUID before reading; callers here are saved records or parsed requests.
  const path = join(root, ".copyos/generations", `${id}.json`);
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info && (!info.isFile() || info.isSymbolicLink()))
    throw new Error("Canvas generation records must be ordinary files");
}
/** Keep the original durable format and operations, with the Buzz host's existing workspace-file policy. */
export class ScopedGenerationRepository extends CopyOSGenerationRepository {
  override async list(root: string) {
    await directories(root);
    return super.list(root);
  }
  override async read(root: string, id: string) {
    await directories(root);
    await recordFile(root, id);
    return super.read(root, id);
  }
  override async save(root: string, record: CopyOSGenerationRecord) {
    await directories(root);
    await recordFile(root, record.id);
    await super.save(root, record);
  }
  override async saveImage(
    root: string,
    id: string,
    index: number,
    bytes: Uint8Array,
    mimeType: CopyOSGenerationImage["mimeType"],
  ) {
    await directories(root);
    return super.saveImage(root, id, index, bytes, mimeType);
  }
  override async readImage(
    root: string,
    image: CopyOSGenerationImage,
  ): Promise<Buffer> {
    await directories(root);
    const value = await readPageAsset(root, image.file);
    if (value.unchanged)
      throw new Error("Canvas generation image bytes are required");
    const bytes = Buffer.from(value.dataBase64, "base64");
    if (
      bytes.length !== image.bytes ||
      bytes.length > DESIGN_IMAGE_ASSET_MAX_BYTES
    )
      throw new Error(
        "Canvas generation image size does not match its saved record",
      );
    return bytes;
  }
}
