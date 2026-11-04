import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { EditorRepository } from "../../../../portable/editor-host/src/store.ts";

const from = JSON.stringify(["solo", "scope", "from"]);
const to = JSON.stringify(["solo", "scope", "to"]);
let root;
let repository;
const call = (operation, input) => repository.call({ operation, input });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-docs-move-"));
  repository = new EditorRepository(root);
});
afterEach(async () => {
  await repository.dispose();
  await rm(root, { recursive: true, force: true });
});

it("moves a doc with its text, history and attachments to another workspace", async () => {
  const doc = await call("createDoc", {
    workspaceId: from,
    title: "Report",
    sections: ["Summary"],
  });
  await call("writeDoc", {
    workspaceId: from,
    docId: doc.id,
    blockId: doc.blocks[0].id,
    epoch: doc.epoch,
    content: "Moved text",
    done: true,
  });
  await call("putDocAsset", {
    workspaceId: from,
    docId: doc.id,
    name: "notes.txt",
    dataBase64: Buffer.from("notes").toString("base64"),
  });
  const moved = await call("moveDoc", {
    workspaceId: from,
    docId: doc.id,
    targetWorkspaceId: to,
  });
  expect(moved.id).toBe(doc.id);
  expect(await call("listDocs", { workspaceId: from })).toEqual([]);
  const read = await call("readDoc", { workspaceId: to, docId: doc.id });
  expect(read.blocks[0].content).toBe("Moved text");
  const history = await call("listDocHistory", {
    workspaceId: to,
    docId: doc.id,
  });
  expect(history.entries.length).toBeGreaterThan(1);
  await expect(
    call("moveDoc", { workspaceId: to, docId: doc.id, targetWorkspaceId: to }),
  ).rejects.toThrow("already in that workspace");
  await expect(
    call("moveDoc", {
      workspaceId: from,
      docId: doc.id,
      targetWorkspaceId: to,
    }),
  ).rejects.toThrow("not in the current workspace");
});

it("refuses to move a doc through a shared link", async () => {
  const doc = await call("createDoc", {
    workspaceId: from,
    title: "Private",
    sections: ["One"],
  });
  await expect(
    call("moveDoc", {
      workspaceId: from,
      docId: doc.id,
      token: "link",
      targetWorkspaceId: to,
    }),
  ).rejects.toThrow("Only the document owner");
});
