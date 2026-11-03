import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { File } from "node:buffer";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { EditorRepository as PagesStore } from "../../portable/editor-host/src/store.ts";
import { DocsModel } from "../../portable/copyos-apps/src/client/DocsModel.ts";
import { docsTransport } from "../../src/bundled/editor-lab/native/docs-client.ts";

let root;
let browserState;
let repository;
let store;
const models = [];
const workspaceId = "docs-community";
beforeEach(async () => {
  browserState = new JSDOM("", { url: "http://127.0.0.1/" });
  vi.stubGlobal("localStorage", browserState.window.localStorage);
  vi.stubGlobal("location", browserState.window.location);
  root = await mkdtemp(join(tmpdir(), "buzz-docs-"));
  repository = new PagesStore(root);
  store = { call: (operation, input) => repository.call({ operation, input }) };
});
afterEach(async () => {
  await Promise.all(models.splice(0).map((model) => model.dispose()));
  await rm(root, { recursive: true, force: true });
  browserState.window.close();
  vi.unstubAllGlobals();
});
const call = (operation, fields = {}) =>
  store.call(operation, { workspaceId, ...fields });
const model = () => {
  const value = new DocsModel(docsTransport(store));
  models.push(value);
  return value;
};

it("preserves the original model editor, tabs, undo and save/reopen workflow through Buzz storage", async () => {
  const editor = model();
  await editor.start(workspaceId);
  await editor.create("Shared document");
  let doc = editor.state.getSnapshot().document;
  editor.edit(doc.blocks[0].id, "Manual paragraph");
  await editor.flush();
  editor.captureEdit(() => editor.edit(doc.blocks[0].id, "Temporary edit"));
  editor.undoLocal();
  expect(editor.state.getSnapshot().document.blocks[0].content).toBe(
    "Manual paragraph",
  );
  editor.redoLocal();
  expect(editor.state.getSnapshot().document.blocks[0].content).toBe(
    "Temporary edit",
  );
  editor.undoLocal();
  await editor.flush();
  editor.addTab("Research");
  await editor.flush();
  doc = editor.state.getSnapshot().document;
  expect(doc.tabs.map((tab) => tab.title)).toContain("Research");
  const reopened = model();
  await reopened.start(workspaceId, doc.id);
  expect(
    reopened.state
      .getSnapshot()
      .document.blocks.some((block) => block.content === "Manual paragraph"),
  ).toBe(true);
  const exported = await reopened.export("markdown");
  expect(Buffer.from(exported.content, "base64").toString("utf8")).toContain(
    "Manual paragraph",
  );
});

it("keeps proposed agent edits reviewable and preserves unrelated concurrent manual text", async () => {
  const editor = model();
  await editor.start(workspaceId);
  await editor.create("Review document");
  let doc = editor.state.getSnapshot().document;
  const blockId = doc.blocks[0].id;
  editor.edit(blockId, "Original sentence. Manual ending.");
  await editor.flush();
  doc = editor.state.getSnapshot().document;
  const suggested = await call("suggestDoc", {
    docId: doc.id,
    blockId,
    expectedEpoch: doc.epoch,
    before: "Original sentence.",
    after: "Refined sentence.",
    note: "Improve clarity",
    start: 0,
  });
  expect(suggested.blocks[0].content).toBe("Original sentence. Manual ending.");
  editor.edit(blockId, "Original sentence. New manual ending.");
  await editor.flush();
  await editor.review(suggested.suggestions[0].id, "accept");
  expect(editor.state.getSnapshot().document.blocks[0].content).toBe(
    "Refined sentence. New manual ending.",
  );
  const history = await editor.history();
  expect(history.entries.length).toBeGreaterThan(1);
});

it("enforces viewer links and revocation using the original document capability rules", async () => {
  const doc = await call("createDoc", {
    title: "Shared read-only",
    sections: [],
  });
  const link = await call("shareDoc", { docId: doc.id, role: "viewer" });
  const reader = model();
  await reader.start(workspaceId, doc.id, link.token);
  expect(reader.state.getSnapshot().readOnly).toBe(true);
  await expect(
    call("controlDoc", { docId: doc.id, token: link.token, stopped: true }),
  ).rejects.toThrow();
  await call("shareDoc", { docId: doc.id, role: "restricted" });
  await expect(
    call("readDoc", { docId: doc.id, token: link.token }),
  ).rejects.toThrow();
});

it("rejects late proposals after stop and preserves the original text", async () => {
  const editor = model();
  await editor.start(workspaceId);
  await editor.create("Cancellation");
  let doc = editor.state.getSnapshot().document;
  editor.edit(doc.blocks[0].id, "Keep this");
  await editor.flush();
  doc = editor.state.getSnapshot().document;
  await editor.control(true);
  await expect(
    call("suggestDoc", {
      docId: doc.id,
      blockId: doc.blocks[0].id,
      expectedEpoch: doc.epoch,
      before: "Keep this",
      after: "Late edit",
      note: "",
      start: 0,
    }),
  ).rejects.toThrow("Writing stopped");
  expect((await call("readDoc", { docId: doc.id })).blocks[0].content).toBe(
    "Keep this",
  );
});

it("exchanges original pane presence without changing document content or revision", async () => {
  const doc = await call("createDoc", { title: "Presence", sections: [] });
  const first = randomUUID(),
    second = randomUUID();
  await call("presenceDoc", {
    docId: doc.id,
    peerId: first,
    state: { tabId: doc.id },
  });
  const joined = await call("presenceDoc", {
    docId: doc.id,
    peerId: second,
    state: { tabId: doc.id },
  });
  expect(joined.peers.map((peer) => peer.id)).toEqual([first]);
  expect(await call("readDoc", { docId: doc.id })).toEqual(doc);
});

it("retains anchored comments and their original resolve/reopen workflow", async () => {
  const editor = model();
  await editor.start(workspaceId);
  await editor.create("Commented document");
  const doc = editor.state.getSnapshot().document;
  const blockId = doc.blocks[0].id;
  editor.edit(blockId, "Discuss this passage.");
  await editor.flush();
  const draft = editor.commentDraft(blockId, "this passage", {
    from: 8,
    to: 20,
  });
  const commented = await editor.comment({
    type: "create",
    draft,
    text: "Please clarify this point.",
  });
  expect(commented.comments[0].quote).toBe("this passage");
  await editor.comment({ type: "resolve", threadId: draft.id, resolved: true });
  expect(editor.state.getSnapshot().document.comments[0].resolved).toBe(true);
  await editor.comment({
    type: "resolve",
    threadId: draft.id,
    resolved: false,
  });
  expect(editor.state.getSnapshot().document.comments[0].resolved).toBe(false);
});

it("imports and re-exports rich Markdown without discarding the preceding document’s unsaved manual text", async () => {
  const editor = model();
  await editor.start(workspaceId);
  await editor.create("Earlier manual document");
  const previous = editor.state.getSnapshot().document;
  editor.edit(
    previous.blocks[0].id,
    "Keep this manual draft when importing another file.",
  );
  const markdown = await readFile(
    new URL("../../../fixtures/docs-import-validation.md", import.meta.url),
    "utf8",
  );
  await editor.importFile(
    new File([markdown], "docs-import-validation.md", {
      type: "text/markdown",
    }),
  );
  const imported = editor.state.getSnapshot().document;
  expect(imported.id).not.toBe(previous.id);
  expect(imported.title).toBe("Buzz Markdown import validation");
  const old = await call("readDoc", { docId: previous.id });
  expect(old.blocks[0].content).toBe(
    "Keep this manual draft when importing another file.",
  );
  const reopened = model();
  await reopened.start(workspaceId, imported.id);
  const exported = await reopened.export("markdown");
  const text = Buffer.from(exported.content, "base64").toString("utf8");
  for (const content of [
    "# Buzz Markdown import validation",
    "**bold text**",
    "*italic text*",
    "`inline code`",
    "- First preserved list item",
    "| Tool | Expected behavior |",
    "> Keep this quoted note",
    "The closing paragraph must remain unchanged.",
  ])
    expect(text).toContain(content);
});

it("exports the original Word and PDF formats through the adapter", async () => {
  const editor = model();
  await editor.start(workspaceId);
  await editor.create("Portable exports");
  const doc = editor.state.getSnapshot().document;
  editor.edit(doc.blocks[0].id, "Text preserved in exported formats.");
  await editor.flush();
  const word = await editor.export("word");
  expect(word.mime).toBe(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  expect(Buffer.from(word.content, "base64").subarray(0, 2).toString()).toBe(
    "PK",
  );
  const pdf = await editor.export("pdf");
  expect(pdf.mime).toBe("application/pdf");
  expect(Buffer.from(pdf.content, "base64").subarray(0, 5).toString()).toBe(
    "%PDF-",
  );
});
