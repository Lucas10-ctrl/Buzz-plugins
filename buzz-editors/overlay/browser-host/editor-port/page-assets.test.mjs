import { mkdtemp, mkdir, writeFile, rm, symlink, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  readPageAsset,
  PAGE_ASSET_MAX_BYTES,
} from "../../portable/editor-host/src/page-assets.ts";
import { EditorRepository } from "../../portable/editor-host/src/store.ts";

let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-page-assets-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("reads Unicode image and stylesheet files from the owner workspace through the repository transport", async () => {
  const store = new EditorRepository(root);
  const prepared = await store.call({
    operation: "preparePageWorkflow",
    input: { workspaceId: "asset-owner", workflow: "copyos-web-clone" },
  });
  await mkdir(join(prepared.projectRoot, "assets"));
  const content = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><text>日本語 café</text></svg>',
  );
  await writeFile(
    join(prepared.projectRoot, "assets", "日本語 café.svg"),
    content,
  );
  const result = await store.call({
    operation: "readPageAsset",
    input: { workspaceId: "asset-owner", path: "assets/日本語 café.svg" },
  });
  expect(result.mimeType).toBe("image/svg+xml");
  expect(Buffer.from(result.dataBase64, "base64")).toEqual(content);
  await expect(
    store.call({
      operation: "readPageAsset",
      input: { workspaceId: "different-owner", path: "assets/日本語 café.svg" },
    }),
  ).rejects.toThrow();
  await writeFile(
    join(prepared.projectRoot, "assets", "site.css"),
    "h1 { color: red }",
  );
  expect(
    (
      await store.call({
        operation: "readPageAsset",
        input: { workspaceId: "asset-owner", path: "assets/site.css" },
      })
    ).mimeType,
  ).toBe("text/css");
});

it.each([
  "../outside.png",
  "/outside.png",
  "a/../../outside.png",
  "C:/outside.png",
  "a\\outside.png",
  ".env",
  ".git/config.css",
  "node_modules/private.svg",
  "a\0.png",
])("refuses external or protected asset path %s", async (path) => {
  await expect(readPageAsset(root, path)).rejects.toThrow();
});

it("retains extensionless project assets rather than requiring a filename convention", async () => {
  await writeFile(join(root, "image-without-extension"), "binary fixture");
  const file = await readPageAsset(root, "image-without-extension");
  expect(file.mimeType).toBe("application/octet-stream");
  expect(Buffer.from(file.dataBase64, "base64").toString()).toBe(
    "binary fixture",
  );
});

it("refuses linked files and directories, including links that point within the same workspace", async () => {
  await mkdir(join(root, "images"));
  await writeFile(join(root, "images", "pixel.png"), "image fixture");
  await symlink(join(root, "images"), join(root, "linked"), "dir");
  await symlink(join(root, "images", "pixel.png"), join(root, "linked.png"));
  await expect(readPageAsset(root, "linked/pixel.png")).rejects.toThrow(
    "symbolic links",
  );
  await expect(readPageAsset(root, "linked.png")).rejects.toThrow(
    "symbolic links",
  );
  await expect(readPageAsset(root, "images.png")).rejects.toThrow();
  await mkdir(join(root, "directory.png"));
  await expect(readPageAsset(root, "directory.png")).rejects.toThrow(
    "regular file",
  );
});

it("rejects oversized resources before reading their bytes", async () => {
  const file = await open(join(root, "large.png"), "w");
  try {
    await file.truncate(PAGE_ASSET_MAX_BYTES + 1);
  } finally {
    await file.close();
  }
  await expect(readPageAsset(root, "large.png")).rejects.toThrow(
    "exceeds 50 MB",
  );
});

it("returns a byte-free acknowledgement for the current file version and fresh bytes after a change", async () => {
  const path = join(root, "asset.svg");
  await writeFile(path, "first content");
  const first = await readPageAsset(root, "asset.svg");
  expect(first.unchanged).toBe(false);
  const cached = await readPageAsset(root, "asset.svg", first.version);
  expect(cached).toEqual({
    path: "asset.svg",
    version: first.version,
    unchanged: true,
  });
  await writeFile(path, "changed content with a different length");
  const next = await readPageAsset(root, "asset.svg", first.version);
  expect(next.unchanged).toBe(false);
  expect(next.version).not.toBe(first.version);
  expect(Buffer.from(next.dataBase64, "base64").toString()).toBe(
    "changed content with a different length",
  );
  await expect(
    readPageAsset(root, "../asset.svg", next.version),
  ).rejects.toThrow();
});
