import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  readdir,
  symlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { beforeEach, afterEach, expect, it } from "vitest";
import { EditorRepository } from "../../portable/editor-host/src/store.ts";
import { createDesignNode } from "../../portable/copyos-domain/src/design-model.ts";

let root, store;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-canvas-copy-"));
  store = new EditorRepository(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const call = (operation, fields = {}, workspaceId = "current") =>
  store.call({ operation, input: { workspaceId, ...fields } });

it("retains original copy assets and their selected variant across restarts and reports malformed siblings", async () => {
  const copy = await call("createCopyAsset", {
    title: "Launch copy",
    label: "Original",
    body: "Keep this copy word for word.\n[This is a note.]",
  });
  const { projectRoot } = await call("getPageWorkspace");
  await writeFile(join(projectRoot, "copy", "broken.md"), "Invalid asset");
  const listed = await call("listCopyAssets");
  expect(listed.assets).toEqual([copy]);
  expect(listed.invalid).toHaveLength(1);
  store = new EditorRepository(root);
  expect(await call("readCopyAsset", { copyId: copy.id })).toEqual(copy);
  await expect(
    call("readCopyAsset", { copyId: copy.id }, "another"),
  ).rejects.toThrow("was not found");
});

it("pages through saved comparison work without changing source files or permitting writes to the source", async () => {
  const past = await call(
    "createDesign",
    { title: "Past landing page" },
    "past",
  );
  const frame = createDesignNode("frame", randomUUID(), "Reference hero");
  const saved = await call(
    "saveDesign",
    { document: { ...past, nodes: [frame] } },
    "past",
  );
  const { projectRoot } = await call("getPageWorkspace", {}, "past");
  const file = join(projectRoot, "designs", `${past.id}.design.json`);
  const before = await readFile(file, "utf8");
  const modified = (await stat(file)).mtimeMs;
  const catalog = await call("listCanvasWorkspaces", { offset: 0, limit: 1 });
  expect(catalog.total).toBe(2);
  expect(catalog.nextOffset).toBe(1);
  const workspaceRef = createHash("sha256").update("past").digest("hex");
  const list = await call("listComparableDesigns", { workspaceRef });
  expect(list.designs).toEqual([
    expect.objectContaining({ id: saved.id, title: saved.title, nodeCount: 1 }),
  ]);
  expect(list.designs[0]).not.toHaveProperty("nodes");
  expect(
    await call("readDesign", { workspaceRef, designId: saved.id }),
  ).toEqual(saved);
  const inspection = await call("inspectDesign", {
    workspaceRef,
    designId: saved.id,
    section: "overview",
  });
  expect(inspection).toBeDefined();
  await expect(
    call("editDesign", {
      workspaceRef,
      designId: saved.id,
      expectedRevision: saved.revision,
      changes: { deleteNodeIds: [frame.id] },
    }),
  ).rejects.toThrow("read-only");
  expect(await readFile(file, "utf8")).toBe(before);
  expect((await stat(file)).mtimeMs).toBe(modified);
});

it("uses the original template importer and revision guard while retaining unrelated manual artboards", async () => {
  const original = await call(
    "createDesign",
    { title: "Template source" },
    "past",
  );
  const frame = {
    ...createDesignNode("frame", randomUUID(), "Reusable frame"),
    width: 300,
    height: 400,
  };
  const text = {
    ...createDesignNode("text", randomUUID(), "Copy"),
    parentId: frame.id,
    text: "Keep reusable text",
  };
  const dataBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
  const image = await call("putDesignImage", { dataBase64 }, "past");
  const imageNode = {
    ...createDesignNode("image", randomUUID(), "Reusable image"),
    parentId: frame.id,
    imageUrl: image.url,
  };
  const source = await call(
    "saveDesign",
    {
      document: { ...original, nodes: [frame, text, imageNode] },
    },
    "past",
  );
  const template = await call(
    "saveDesignTemplate",
    {
      designId: source.id,
      nodeId: frame.id,
      title: "Reusable hero",
      category: "Landing pages",
      description: "Original snapshot",
    },
    "past",
  );
  let target = await call("createDesign", { title: "Build target" });
  const manual = createDesignNode(
    "frame",
    randomUUID(),
    "Keep manual artboard",
  );
  target = await call("saveDesign", {
    document: { ...target, nodes: [manual] },
  });
  const inserted = await call("insertDesignTemplate", {
    designId: target.id,
    templateId: template.id,
    expectedRevision: target.revision,
  });
  expect(inserted.document.nodes.find((node) => node.id === manual.id)).toEqual(
    manual,
  );
  expect(
    inserted.document.nodes.some(
      (node) => node.text === text.text && node.id !== text.id,
    ),
  ).toBe(true);
  expect(inserted.selectedIds).toHaveLength(1);
  const added = inserted.document.nodes.find(
    (node) => node.id === inserted.selectedIds[0],
  );
  expect(added.x).toBe(manual.x + manual.width + 80);
  await expect(
    call("insertDesignTemplate", {
      designId: target.id,
      templateId: template.id,
      expectedRevision: target.revision,
    }),
  ).rejects.toThrow("revision changed");
  expect(await call("readDesignImage", { reference: image.url })).toEqual({
    dataBase64,
    mimeType: "image/png",
  });
  expect(await call("readDesign", { designId: source.id }, "past")).toEqual(
    source,
  );
});

it("copies comparison images into the bound destination without changing the source or accepting filesystem paths", async () => {
  const dataBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
  const image = await call("putDesignImage", { dataBase64 }, "past");
  const workspaceRef = createHash("sha256").update("past").digest("hex");
  await expect(
    call("readDesignImage", { reference: image.url }),
  ).rejects.toThrow();
  expect(
    await call("copyComparableImages", { workspaceRef, urls: [image.url] }),
  ).toEqual({ copied: [image.url] });
  expect(await call("readDesignImage", { reference: image.url })).toEqual({
    dataBase64,
    mimeType: "image/png",
  });
  expect(
    await call("readDesignImage", { reference: image.url }, "past"),
  ).toEqual({ dataBase64, mimeType: "image/png" });
  await expect(
    call("copyComparableImages", { workspaceRef, urls: ["../../private"] }),
  ).rejects.toThrow();
  await expect(
    call("copyComparableImages", {
      workspaceRef,
      urls: [`copyos-asset:${"f".repeat(64)}.png`],
    }),
  ).rejects.toThrow();
});

it("refuses reference traversal and symbolic links without adopting source directories", async () => {
  await call("createDesign", { title: "Existing" }, "past");
  const { projectRoot } = await call("getPageWorkspace", {}, "past");
  const reference = "a".repeat(64);
  await symlink(projectRoot, join(root, "workspaces", reference), "dir");
  const catalog = await call("listCanvasWorkspaces");
  expect(catalog.invalid).toEqual([
    expect.objectContaining({ workspaceRef: reference }),
  ]);
  await expect(
    call("listComparableDesigns", { workspaceRef: reference }),
  ).rejects.toThrow("symbolic");
  await expect(
    call("listComparableDesigns", { workspaceRef: "../past" }),
  ).rejects.toThrow();
  const existing = await readdir(join(root, "workspaces"));
  await expect(
    call("listComparableDesigns", { workspaceRef: "b".repeat(64) }),
  ).rejects.toThrow();
  expect(await readdir(join(root, "workspaces"))).toEqual(existing);
});

it("bounds comparison summaries while leaving complete structure available through the original inspector", async () => {
  const original = await call(
    "createDesign",
    { title: "Many comparison frames" },
    "past",
  );
  const nodes = Array.from({ length: 50 }, (_, index) =>
    createDesignNode(
      "frame",
      randomUUID(),
      `Reference ${index} ${"x".repeat(180)}`,
    ),
  );
  const saved = await call(
    "saveDesign",
    { document: { ...original, nodes } },
    "past",
  );
  const workspaceRef = createHash("sha256").update("past").digest("hex");
  const result = await call("listComparableDesigns", {
    workspaceRef,
    limit: 1,
  });
  expect(result.designs[0].artboardCount).toBe(50);
  expect(result.designs[0].artboards).toHaveLength(10);
  expect(
    result.designs[0].artboards.every(
      (frame) => frame.name.length <= 160 && frame.nameTruncated,
    ),
  ).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(8000);
  const complete = await call("readDesign", {
    workspaceRef,
    designId: saved.id,
  });
  expect(complete.nodes).toEqual(saved.nodes);
});
