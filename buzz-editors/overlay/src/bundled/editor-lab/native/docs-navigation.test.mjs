import { mkdtemp, rm } from "node:fs/promises";
import { File } from "node:buffer";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { EditorRepository } from "../../../../portable/editor-host/src/store.ts";
import { DocsModel } from "../../../../portable/copyos-apps/src/client/DocsModel.ts";
import { createMemoryHistory } from "../../../features/navigation/history.ts";
import { docsTransport } from "./docs-client.ts";
import { docTarget, readDocNavigation } from "./docs-route.ts";
import { docsNavigationActions } from "./docs-navigation.ts";

const workspaceId = "navigation-community";
let root, browser, repository, transport, model, history, opened, current;
const route = () =>
  readDocNavigation(history.snapshot().current.target.route.params);
const actions = (incoming = null) =>
  docsNavigationActions(
    model,
    workspaceId,
    () => current,
    (value) => {
      opened.push(value);
      history.push(docTarget(value));
    },
    incoming,
  );
beforeEach(async () => {
  browser = new JSDOM("", { url: "http://localhost/" });
  vi.stubGlobal("localStorage", browser.window.localStorage);
  vi.stubGlobal("location", browser.window.location);
  root = await mkdtemp(join(tmpdir(), "buzz-docs-navigation-"));
  repository = new EditorRepository(root);
  transport = docsTransport({
    call: (operation, input) => repository.call({ operation, input }),
  });
  model = new DocsModel(transport);
  await model.start(workspaceId);
  history = createMemoryHistory();
  opened = [];
  current = true;
});
afterEach(async () => {
  await model.dispose();
  history.dispose();
  await rm(root, { recursive: true, force: true });
  browser.window.close();
  vi.unstubAllGlobals();
});

it("addresses created, duplicated, selected and imported documents and retains Back/Forward visits", async () => {
  const ui = actions();
  await ui.createDoc("Original");
  const original = route().docId;
  model.edit(
    model.state.getSnapshot().document.blocks[0].id,
    "Unsaved manual text",
  );
  await ui.duplicateDoc("Copy");
  const copy = route().docId;
  expect(copy).not.toBe(original);
  expect(model.state.getSnapshot().document.blocks[0].content).toBe(
    "Unsaved manual text",
  );
  await ui.selectDoc(original);
  expect(route()).toMatchObject({
    docId: original,
    threadId: null,
    passage: null,
  });
  await ui.importDocFile(new File(["# Imported\n\nBody"], "imported.md"));
  const imported = route().docId;
  expect(imported).not.toBe(original);
  expect(model.state.getSnapshot().document.title).toBe("Imported");
  history.back();
  expect(route().docId).toBe(original);
  await model.start(workspaceId, route().docId);
  expect(model.state.getSnapshot().document.blocks[0].content).toBe(
    "Unsaved manual text",
  );
  history.forward();
  expect(route().docId).toBe(imported);
  await model.start(workspaceId, route().docId);
  expect(model.state.getSnapshot().document.title).toBe("Imported");
});

it("keeps tab choices addressable without turning inbound thread navigation into another visit", async () => {
  const ui = actions();
  await ui.createDoc("Tabs");
  const firstTab = route().tabId;
  ui.addDocTab("Research");
  const secondTab = route().tabId;
  expect(secondTab).not.toBe(firstTab);
  ui.selectDocTab(firstTab);
  expect(route().tabId).toBe(firstTab);
  const linked = {
    ...route(),
    tabId: secondTab,
    threadId: "11111111-1111-4111-8111-111111111111",
    token: "test-capability",
  };
  history.push(docTarget(linked));
  const count = opened.length;
  const inbound = actions(linked);
  inbound.selectDocTab(secondTab);
  expect(opened).toHaveLength(count);
  expect(route().threadId).toBe(linked.threadId);
  inbound.selectDocTab(firstTab);
  expect(route()).toMatchObject({
    tabId: firstTab,
    threadId: null,
    token: "test-capability",
  });
});

it("does not redirect a departed visit or publish a rejected selection", async () => {
  const ui = actions();
  await ui.createDoc("Original");
  const original = route().docId;
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const read = transport.read;
  transport.read = async (input) => {
    await waiting;
    return read(input);
  };
  const pending = ui.selectDoc(original);
  current = false;
  release();
  await pending;
  expect(opened).toHaveLength(1);
  current = true;
  await expect(
    ui.selectDoc("22222222-2222-4222-8222-222222222222"),
  ).rejects.toThrow();
  expect(opened).toHaveLength(1);
});

it("does not publish an older import after a newer document selection", async () => {
  const ui = actions();
  await ui.createDoc("Original");
  const original = route().docId;
  let release, started;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const importing = new Promise((resolve) => {
    started = resolve;
  });
  const importFile = transport.import;
  transport.import = async (input) => {
    started();
    await waiting;
    return importFile(input);
  };
  const pending = ui.importDocFile(new File(["# Late import"], "late.md"));
  const rejected = expect(pending).rejects.toThrow("library");
  await importing;
  await ui.selectDoc(original);
  release();
  await rejected;
  expect(route().docId).toBe(original);
  expect(opened).toHaveLength(2);
});
