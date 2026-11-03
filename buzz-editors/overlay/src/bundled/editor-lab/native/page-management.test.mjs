import {
  link,
  copyFile,
  unlink,
  mkdtemp,
  rm,
  mkdir,
  readdir,
  rename,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { EditorRepository } from "../../../../portable/editor-host/src/store.ts";
let root;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
it("clones all variations with independent identities and removes/restores only the selected saved revision", async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-page-management-"));
  const store = new EditorRepository(root);
  const call = (operation, input) => store.call({ operation, input }),
    workspaceId = "page-management";
  let page = await call("createPage", { workspaceId, title: "Original" });
  page = await call("addPageSection", {
    workspaceId,
    pageId: page.id,
    title: "Hero",
    templateId: "custom-html",
    label: "Original",
    html: "<h1>Hello</h1>",
  });
  const section = page.sections[0];
  page = await call("addPageSectionVariant", {
    workspaceId,
    pageId: page.id,
    sectionId: section.id,
    label: "Alternate",
    html: "<h1>Alternate</h1>",
  });
  page = await call("addPageComment", {
    workspaceId,
    pageId: page.id,
    sectionId: section.id,
    variantId: page.sections[0].selectedVariantId,
    elementIndex: 0,
    elementLabel: "Hero heading",
    body: "Keep this comment",
  });
  const request = {
    workspaceId,
    pageId: page.id,
    expectedRevision: page.revision,
  };
  const clone = await call("clonePage", request);
  expect(clone.id).not.toBe(page.id);
  expect(clone.title).toBe("Original (copy)");
  expect(clone.sections[0].id).not.toBe(section.id);
  expect(clone.sections[0].variants.map((v) => v.html)).toEqual(
    page.sections[0].variants.map((v) => v.html),
  );
  expect(clone.sections[0].variants[0].id).not.toBe(section.variants[0].id);
  expect(clone.comments[0].body).toBe("Keep this comment");
  expect(clone.comments[0].id).not.toBe(page.comments[0].id);
  expect(clone.comments[0].sectionId).toBe(clone.sections[0].id);
  expect(
    clone.sections[0].variants.some(
      (v) => v.id === clone.comments[0].variantId,
    ),
  ).toBe(true);
  await expect(
    call("deletePage", { ...request, expectedRevision: 0 }),
  ).rejects.toThrow("Page changed");
  expect((await call("listPages", workspaceId)).length).toBe(2);
  await call("deletePage", request);
  expect((await call("listPages", workspaceId)).map((p) => p.id)).toEqual([
    clone.id,
  ]);
  const restored = await call("restorePage", request);
  expect(restored).toEqual(page);
  expect((await call("listPages", workspaceId)).length).toBe(2);
  const orphaned = await call("deletePageSection", {
    workspaceId,
    pageId: page.id,
    sectionId: section.id,
    expectedRevision: page.revision,
  });
  const orphanCopy = await call("clonePage", {
    workspaceId,
    pageId: page.id,
    expectedRevision: orphaned.revision,
  });
  expect(orphanCopy.comments[0].body).toBe("Keep this comment");
  expect(orphanCopy.comments[0].sectionId).not.toBe(section.id);
});

it("rejects linked trash directories without moving the saved page", async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-trash-link-"));
  const store = new EditorRepository(root),
    workspaceId = "link-check";
  const page = await store.call({
    operation: "createPage",
    input: { workspaceId, title: "Safe page" },
  });
  const [hash] = await readdir(join(root, "workspaces"));
  const workspace = join(root, "workspaces", hash),
    outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(workspace, ".trash"));
  await expect(
    store.call({
      operation: "deletePage",
      input: { workspaceId, pageId: page.id, expectedRevision: page.revision },
    }),
  ).rejects.toThrow("Unsafe page directory");
  expect(await readdir(outside)).toEqual([]);
  expect(
    (await store.call({ operation: "listPages", input: workspaceId })).map(
      (p) => p.id,
    ),
  ).toContain(page.id);
});
it("manages a valid page whose saved filename was renamed", async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-page-name-"));
  const store = new EditorRepository(root),
    workspaceId = "name-check";
  const page = await store.call({
    operation: "createPage",
    input: { workspaceId, title: "Original" },
  });
  const [hash] = await readdir(join(root, "workspaces"));
  const directory = join(root, "workspaces", hash, "pages"),
    [filename] = await readdir(directory);
  await rename(join(directory, filename), join(directory, "renamed.page.json"));
  const input = {
    workspaceId,
    pageId: page.id,
    expectedRevision: page.revision,
  };
  const clone = await store.call({ operation: "clonePage", input });
  expect(clone.title).toBe("Original (copy)");
  await store.call({ operation: "deletePage", input });
  expect(
    (await store.call({ operation: "listPages", input: workspaceId })).map(
      (p) => p.id,
    ),
  ).toEqual([clone.id]);
});

it("finishes an interrupted delete only when trash is the same saved file", async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-page-interrupted-"));
  const store = new EditorRepository(root),
    workspaceId = "interrupted";
  const page = await store.call({
    operation: "createPage",
    input: { workspaceId, title: "Original" },
  });
  const [hash] = await readdir(join(root, "workspaces")),
    workspace = join(root, "workspaces", hash),
    directory = join(workspace, "pages"),
    [filename] = await readdir(directory),
    trash = join(workspace, ".trash", "pages");
  await mkdir(trash, { recursive: true });
  await copyFile(
    join(directory, filename),
    join(trash, `${page.id}.page.json`),
  );
  await expect(
    store.call({
      operation: "deletePage",
      input: { workspaceId, pageId: page.id, expectedRevision: page.revision },
    }),
  ).rejects.toThrow("different content");
  expect(await readdir(directory)).toContain(filename);
  await unlink(join(trash, `${page.id}.page.json`));
  await link(join(directory, filename), join(trash, `${page.id}.page.json`));
  const input = {
    workspaceId,
    pageId: page.id,
    expectedRevision: page.revision,
  };
  await store.call({ operation: "deletePage", input });
  expect(
    await store.call({ operation: "listPages", input: workspaceId }),
  ).toEqual([]);
  expect(await store.call({ operation: "restorePage", input })).toEqual(page);
});
