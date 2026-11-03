import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { EditorRepository as PagesStore } from "../../portable/editor-host/src/store.ts";
import { createDesignNode } from "../../portable/copyos-domain/src/design-model.ts";
import { createRequire } from "node:module";
const sharp = createRequire(
  new URL("../../portable/copyos-domain/package.json", import.meta.url),
)("sharp");

let root;
let store;
const workspaceId = "canvas-community";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-canvas-"));
  store = new PagesStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const call = (operation, fields = {}) =>
  store.call({ operation, input: { workspaceId, ...fields } });

it("keeps original artboards and layers editable across saves and restarts", async () => {
  const blank = await call("createDesign", { title: "Campaign canvas" });
  const frame = createDesignNode("frame", randomUUID(), "Desktop");
  const shape = {
    ...createDesignNode("rectangle", randomUUID(), "Manual shape"),
    parentId: frame.id,
  };
  const saved = await call("saveDesign", {
    document: { ...blank, nodes: [frame, shape] },
  });
  const edited = await call("editDesign", {
    designId: saved.id,
    expectedRevision: saved.revision,
    changes: { upsertNodes: [{ id: shape.id, name: "Agent refined shape" }] },
  });
  expect(edited.nodes[0]).toEqual(frame);
  expect(edited.nodes[1]).toMatchObject({
    id: shape.id,
    name: "Agent refined shape",
  });
  await expect(call("saveDesign", { document: saved })).rejects.toThrow(
    "Design changed in another editor",
  );
  store = new PagesStore(root);
  expect(await call("readDesign", { designId: saved.id })).toEqual(edited);
  expect(await call("listDesigns")).toEqual([edited]);
});

it("stores review comments independently without changing the design revision", async () => {
  const design = await call("createDesign", { title: "Reviewable canvas" });
  const comment = await call("addDesignComment", {
    designId: design.id,
    body: "Move this toward the center",
    target: { kind: "point", pageId: null, x: 10, y: 20 },
  });
  const list = await call("listDesignComments", { designId: design.id });
  expect(list.comments).toEqual([comment]);
  const resolved = await call("setDesignCommentStatus", {
    designId: design.id,
    commentId: comment.id,
    status: "resolved",
  });
  expect(resolved.status).toBe("resolved");
  expect(await call("readDesign", { designId: design.id })).toEqual(design);
});

it("round-trips scoped image assets and rejects arbitrary paths", async () => {
  const dataBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
  const image = await call("putDesignImage", { dataBase64 });
  expect(await call("readDesignImage", { reference: image.url })).toEqual({
    dataBase64,
    mimeType: "image/png",
  });
  await expect(
    call("readDesignImage", { reference: "../../private" }),
  ).rejects.toThrow();
});

it("reads real bundled font metadata without the old package resolver", async () => {
  const metadata = await call("getDesignFontMetadata", { family: "Inter" });
  expect(metadata.state).toBe("available");
  expect(metadata.axes.map((axis) => axis.tag)).toContain("wght");
});

it("renders a saved artboard with the original graphics engine and reports font substitutions", async () => {
  const blank = await call("createDesign", { title: "Artboard view" });
  const frame = {
    ...createDesignNode("frame", randomUUID(), "Red artboard"),
    width: 400,
    height: 600,
    fill: "#ff0000",
  };
  const text = {
    ...createDesignNode("text", randomUUID(), "Caption"),
    parentId: frame.id,
    y: 120,
    text: "Actual Canvas glyphs",
    fontFamily: "Unavailable Family",
  };
  const saved = await call("saveDesign", {
    document: { ...blank, nodes: [frame, text] },
  });
  const view = await call("viewDesign", {
    designId: saved.id,
    expectedRevision: saved.revision,
    artboardId: frame.id,
    top: 100,
    height: 100,
    maxWidth: 400,
  });
  expect(view.design).toEqual({
    id: saved.id,
    title: saved.title,
    revision: saved.revision,
  });
  expect(view.region).toEqual({ top: 100, height: 100 });
  expect(view.text).toContainEqual(
    expect.objectContaining({
      id: text.id,
      outcome: "substituted",
      family: "Unavailable Family",
    }),
  );
  const image = Buffer.from(view.dataBase64, "base64");
  expect(await sharp(image).metadata()).toMatchObject({
    width: 400,
    height: 100,
    format: "png",
  });
  const pixel = await sharp(image)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  expect([...pixel]).toEqual([255, 0, 0, 255]);
  await expect(
    call("viewDesign", {
      designId: saved.id,
      expectedRevision: saved.revision + 1,
    }),
  ).rejects.toThrow("revision changed");
  await expect(
    call("viewDesign", { designId: saved.id, artboardId: text.id }),
  ).rejects.toThrow("visible top-level frame");
});

it("retains the original bounded inspector, continuation cursors and complete field retrieval", async () => {
  const blank = await call("createDesign", { title: "Inspectable design" });
  const frames = ["One", "Two", "Three"].map((name) =>
    createDesignNode("frame", randomUUID(), name),
  );
  const text = {
    ...createDesignNode("text", randomUUID(), "Long copy"),
    parentId: frames[0].id,
    text: "Original editable copy. ".repeat(1200),
  };
  const saved = await call("saveDesign", {
    document: { ...blank, nodes: [...frames, text] },
  });
  const request = {
    designId: saved.id,
    revision: saved.revision,
    section: "layers",
    limit: 1,
    max_bytes: 16384,
  };
  const first = await call("inspectDesign", request);
  expect(Buffer.byteLength(JSON.stringify(first, null, 2))).toBeLessThanOrEqual(
    16384,
  );
  expect(first.items.map((item) => item.id)).toEqual([frames[0].id]);
  const second = await call("inspectDesign", {
    ...request,
    cursor: first.next_cursor,
  });
  expect(second.items.map((item) => item.id)).toEqual([frames[1].id]);
  await expect(
    call("inspectDesign", {
      ...request,
      section: "authored-layers",
      cursor: first.next_cursor,
    }),
  ).rejects.toThrow("cursor context");
  const copy = await call("inspectDesign", {
    designId: saved.id,
    revision: saved.revision,
    section: "authored-layers",
    node_ids_json: JSON.stringify([text.id]),
  });
  expect(copy.items[0].text_truncated).toBe(true);
  const field = {
    designId: saved.id,
    revision: saved.revision,
    section: "field",
    field_ref: copy.items[0].field_refs.text,
    max_bytes: 16384,
  };
  let part = await call("inspectDesign", field),
    complete = part.chunk;
  while (part.next_cursor) {
    part = await call("inspectDesign", { ...field, cursor: part.next_cursor });
    expect(
      Buffer.byteLength(JSON.stringify(part, null, 2)),
    ).toBeLessThanOrEqual(16384);
    complete += part.chunk;
  }
  expect(JSON.parse(complete)).toBe(text.text);
  await call("editDesign", {
    designId: saved.id,
    expectedRevision: saved.revision,
    changes: { upsertNodes: [{ id: frames[0].id, name: "Changed" }] },
  });
  await expect(
    call("inspectDesign", { ...request, cursor: first.next_cursor }),
  ).rejects.toThrow("revision changed");
});
