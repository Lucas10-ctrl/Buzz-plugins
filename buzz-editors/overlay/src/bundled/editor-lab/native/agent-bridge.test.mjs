import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorRepository as PagesStore } from "../../../../portable/editor-host/src/store.ts";
import { EditorAgentBridge } from "./agent-bridge.ts";
import { createDesignNode } from "../../../../portable/copyos-domain/src/design-model.ts";
import { randomUUID } from "node:crypto";

let root;
let store;
let bridge;
let tool;
const agent = { key: "community:agent", pubkey: "agent" };
const context = { channel: "editor-dm" };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-agent-pages-"));
  const repository = new PagesStore(root);
  store = { call: (operation, input) => repository.call({ operation, input }) };
  bridge = new EditorAgentBridge(store);
  tool = bridge.tool();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const bind = () =>
  bridge.bind({
    workspaceId: "workspace",
    agent: agent.pubkey,
    agentKey: agent.key,
    channel: context.channel,
    scope: "community",
  });

it("enables past-work comparison only for the owner’s structured Canvas copy request and keeps source designs read-only", async () => {
  const canvas = bridge.canvasTool();
  const past = await store.call("createDesign", {
    workspaceId: "past",
    title: "Past email reference",
  });
  bind();
  const copy = JSON.parse(
    await canvas.call(agent, context, {
      operation: "createCopy",
      input: {
        title: "Email copy",
        label: "Original",
        body: "Keep this copy.",
      },
    }),
  );
  expect(
    JSON.parse(
      await canvas.call(agent, context, {
        operation: "readCopy",
        input: { copyId: copy.id },
      }),
    ),
  ).toEqual(copy);
  await expect(
    canvas.call(agent, context, { operation: "listWorkspaces" }),
  ).rejects.toThrow("Start Build from copy");
  bridge.bind({
    workspaceId: "workspace",
    agent: agent.pubkey,
    agentKey: agent.key,
    channel: context.channel,
    scope: "community",
    canvasCopy: { designId: past.id },
  });
  const catalog = JSON.parse(
    await canvas.call(agent, context, { operation: "listWorkspaces" }),
  );
  const source = catalog.workspaces.find((workspace) =>
    workspace.sampleDesigns.some((design) => design.id === past.id),
  );
  expect(source).toBeDefined();
  expect(
    JSON.parse(
      await canvas.call(agent, context, {
        operation: "readDesign",
        input: { workspaceRef: source.workspaceRef, designId: past.id },
      }),
    ),
  ).toEqual(past);
  await expect(
    canvas.call(agent, context, {
      operation: "editDesign",
      input: {
        workspaceRef: source.workspaceRef,
        designId: past.id,
        expectedRevision: past.revision,
        changes: { upsertNodes: [] },
      },
    }),
  ).rejects.toThrow("read-only");
  bridge.endCanvasCopyRequest(agent.key, context.channel);
  await expect(
    canvas.call(agent, context, {
      operation: "readDesign",
      input: { workspaceRef: source.workspaceRef, designId: past.id },
    }),
  ).rejects.toThrow("Start Build from copy");
  expect(
    await store.call("readDesign", { workspaceId: "past", designId: past.id }),
  ).toEqual(past);
});

it("keeps a saved page successful and notifies other observers when one observer throws", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    bridge.bind({
      workspaceId: "workspace",
      agent: agent.pubkey,
      agentKey: agent.key,
      channel: context.channel,
      scope: "community",
      pageWorkflow: { requestId: "observer-failure" },
    });
    bridge.onPageCreated("observer-failure", () => {
      throw new Error("Observer failed");
    });
    const notified = vi.fn();
    bridge.onPageCreated("observer-failure", notified);
    const page = JSON.parse(
      await tool.call(agent, context, {
        operation: "createPage",
        input: { title: "Saved once", workflowRequestId: "observer-failure" },
      }),
    );
    expect(notified).toHaveBeenCalledWith({
      pageId: page.id,
      title: "Saved once",
    });
    expect(warning).toHaveBeenCalledTimes(1);
    expect(
      (await store.call("listPages", "workspace")).map((page) => page.title),
    ).toEqual(["Saved once"]);
  } finally {
    warning.mockRestore();
  }
});

it("announces a workflow-created page only for its exact bound request and never for unrelated page creation", async () => {
  const created = [];
  const stop = bridge.onPageCreated("workflow-one", (page) =>
    created.push(page),
  );
  bridge.bind({
    workspaceId: "workspace",
    agent: agent.pubkey,
    agentKey: agent.key,
    channel: context.channel,
    scope: "community",
    pageWorkflow: { requestId: "workflow-one" },
  });
  await expect(
    tool.call(agent, context, {
      operation: "createPage",
      input: { title: "Wrong request", workflowRequestId: "other" },
    }),
  ).rejects.toThrow("workflow request");
  expect(await store.call("listPages", "workspace")).toEqual([]);
  await tool.call(agent, context, {
    operation: "createPage",
    input: { title: "Unrelated manual request" },
  });
  expect(created).toEqual([]);
  const page = JSON.parse(
    await tool.call(agent, context, {
      operation: "createPage",
      input: { title: "Agent result", workflowRequestId: "workflow-one" },
    }),
  );
  expect(created).toEqual([{ pageId: page.id, title: "Agent result" }]);
  stop();
  await tool.call(agent, context, {
    operation: "createPage",
    input: { title: "Later result", workflowRequestId: "workflow-one" },
  });
  expect(created).toHaveLength(1);
});

it("does not hand off a page whose creation finishes after its workflow is cancelled", async () => {
  let release, entered;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const repository = new PagesStore(root);
  const held = new EditorAgentBridge({
    call: async (operation, input) => {
      if (operation === "createPage") {
        entered();
        await pending;
      }
      return repository.call({ operation, input });
    },
  });
  const created = [];
  held.onPageCreated("cancelled-workflow", (page) => created.push(page));
  held.bind({
    workspaceId: "workspace",
    agent: agent.pubkey,
    agentKey: agent.key,
    channel: context.channel,
    scope: "community",
    pageWorkflow: { requestId: "cancelled-workflow" },
  });
  const result = held.tool().call(agent, context, {
    operation: "createPage",
    input: {
      title: "Saved after cancellation",
      workflowRequestId: "cancelled-workflow",
    },
  });
  try {
    await started;
    held.endPageWorkflow(agent.key, context.channel);
  } finally {
    release();
  }
  const page = JSON.parse(await result);
  expect(created).toEqual([]);
  expect(
    await repository.call({
      operation: "readPage",
      input: { workspaceId: "workspace", pageId: page.id },
    }),
  ).toMatchObject({ title: "Saved after cancellation" });
  await expect(
    held.tool().call(agent, context, {
      operation: "createPage",
      input: {
        title: "Stale retry",
        workflowRequestId: "cancelled-workflow",
      },
    }),
  ).rejects.toThrow("workflow request");
});

it("returns only the bound page workspace to the selected agent", async () => {
  await expect(
    tool.call(agent, context, { operation: "getWorkspace" }),
  ).rejects.toThrow("Open this agent");
  bind();
  const result = JSON.parse(
    await tool.call(agent, context, { operation: "getWorkspace" }),
  );
  expect(result).toEqual(
    await store.call("getPageWorkspace", { workspaceId: "workspace" }),
  );
  await expect(
    tool.call(agent, context, {
      operation: "getWorkspace",
      input: { workspaceId: "other" },
    }),
  ).rejects.toThrow("Workspace differs");
  await expect(
    tool.call(agent, { channel: "other" }, { operation: "getWorkspace" }),
  ).rejects.toThrow("Open this agent");
});

it("prepares retained Builder workflows only for the chosen agent and bound editor workspace", async () => {
  const args = {
    operation: "prepareWorkflow",
    input: { workflow: "copyos-web-clone" },
  };
  await expect(tool.call(agent, context, args)).rejects.toThrow(
    "Open this agent",
  );
  bind();
  const prepared = JSON.parse(await tool.call(agent, context, args));
  expect(prepared.workflow).toBe("copyos-web-clone");
  expect(prepared.instructions).toContain("buzz_pages");
  await expect(
    tool.call({ ...agent, pubkey: "other" }, context, args),
  ).rejects.toThrow("Open this agent");
  await expect(
    tool.call(agent, context, {
      ...args,
      input: { ...args.input, workspaceId: "other" },
    }),
  ).rejects.toThrow("Workspace differs");
  await expect(
    tool.call(agent, context, { ...args, input: { workflow: "arbitrary" } }),
  ).rejects.toThrow();
});

it("builds an artboard through the original reviewed conversion and retains unrelated manual layers", async () => {
  bind();
  const canvas = bridge.canvasTool();
  const call = async (operation, input = {}) =>
    JSON.parse(await canvas.call(agent, context, { operation, input }));
  const blank = await call("createDesign", { title: "Canvas to Builder" });
  const frame = {
    ...createDesignNode("frame", randomUUID(), "Website"),
    width: 600,
    height: 400,
  };
  const unrelated = createDesignNode(
    "rectangle",
    randomUUID(),
    "Keep my manual shape",
  );
  let saved = await store.call("saveDesign", {
    workspaceId: "workspace",
    document: { ...blank, nodes: [frame, unrelated] },
  });
  const request = {
    designId: saved.id,
    nodeId: frame.id,
    expectedRevision: saved.revision,
  };
  const preview = await call("previewDesignPage", request);
  expect(preview.state).toBe("ready");
  await expect(
    call("buildDesignPage", { ...request, previewHash: "0".repeat(64) }),
  ).rejects.toThrow();
  expect(await store.call("listPages", "workspace")).toEqual([]);
  const built = await call("buildDesignPage", {
    ...request,
    previewHash: preview.previewHash,
  });
  const pages = await store.call("listPages", "workspace");
  expect(pages).toHaveLength(1);
  expect(pages[0].conversion.sourceDesignId).toBe(saved.id);
  expect(pages[0].conversion.sourceFrameId).toBe(frame.id);
  saved = await call("readDesign", { designId: saved.id });
  expect(saved.nodes.find((node) => node.id === frame.id)).toEqual(frame);
  expect(saved.nodes.find((node) => node.id === unrelated.id)).toEqual(
    unrelated,
  );
  expect(
    saved.nodes.some((node) => node.pageLink?.pageId === pages[0].id),
  ).toBe(true);
  expect(built.page.id).toBe(pages[0].id);
  await expect(call("previewDesignPage", request)).rejects.toThrow(
    "Design changed",
  );
});

it("serves complete website guidance only inside a bound editor conversation", async () => {
  const canvas = bridge.canvasTool();
  await expect(
    canvas.call(agent, context, {
      operation: "readWorkflowGuide",
      input: { guide: "canvas-to-website" },
    }),
  ).rejects.toThrow("Open this agent");
  bind();
  const guide = await canvas.call(agent, context, {
    operation: "readWorkflowGuide",
    input: { guide: "canvas-to-website" },
  });
  expect(guide).toContain("buzz_canvas viewDesign");
  expect(guide).toContain("1440px, 768px and 390px widths plus 320px");
  expect(guide).toContain("Do not publish unused design variants");
  expect(guide).not.toMatch(/\b\w+_copyos_\w+\b/);
  await expect(
    canvas.call(agent, context, {
      operation: "readWorkflowGuide",
      input: { guide: "../../secret" },
    }),
  ).rejects.toThrow("Unknown Canvas workflow guide");
});

it("reviews linked updates and preserves manual Builder edits made after a prior review", async () => {
  bind();
  const canvas = bridge.canvasTool();
  const call = async (operation, input = {}) =>
    JSON.parse(await canvas.call(agent, context, { operation, input }));
  const blank = await call("createDesign", { title: "Linked update" });
  const frame = {
    ...createDesignNode("frame", randomUUID(), "Website"),
    width: 600,
    height: 400,
  };
  const saved = await store.call("saveDesign", {
    workspaceId: "workspace",
    document: { ...blank, nodes: [frame] },
  });
  const source = {
    designId: saved.id,
    nodeId: frame.id,
    expectedRevision: saved.revision,
  };
  const preview = await call("previewDesignPage", source);
  const built = await call("buildDesignPage", {
    ...source,
    previewHash: preview.previewHash,
  });
  const manual = await store.call("addPageSection", {
    workspaceId: "workspace",
    pageId: built.page.id,
    expectedRevision: built.page.revision,
    title: "Manual section",
    templateId: "custom-html",
    label: "Original",
    html: "<section>Manual copy outside the conversion</section>",
  });
  const design = await call("readDesign", { designId: saved.id });
  const changed = await call("editDesign", {
    designId: saved.id,
    expectedRevision: design.revision,
    changes: { upsertNodes: [{ id: frame.id, fill: "#00ff00" }] },
  });
  const update = {
    designId: saved.id,
    nodeId: frame.id,
    expectedRevision: changed.revision,
  };
  const oldReview = await call("reviewDesignPageUpdate", update);
  expect(oldReview.state).toBe("update");
  const section = manual.sections[1];
  await store.call("updatePageSectionVariant", {
    workspaceId: "workspace",
    pageId: manual.id,
    expectedRevision: manual.revision,
    sectionId: section.id,
    variantId: section.selectedVariantId,
    html: "<section>Newer manual copy must survive</section>",
  });
  await expect(
    call("applyDesignPageUpdate", {
      ...update,
      expectedPageRevision: oldReview.pageRevision,
      previewHash: oldReview.previewHash,
    }),
  ).rejects.toThrow("Page changed in Builder after review");
  const reviewed = await call("reviewDesignPageUpdate", update);
  const applied = await call("applyDesignPageUpdate", {
    ...update,
    expectedPageRevision: reviewed.pageRevision,
    previewHash: reviewed.previewHash,
  });
  expect(applied.page.sections).toHaveLength(2);
  expect(applied.page.sections[1].variants[0].html).toContain(
    "Newer manual copy must survive",
  );
  expect(applied.page.conversion.sourceRevision).toBe(changed.revision);
  expect(
    await store.call("readPage", {
      workspaceId: "workspace",
      pageId: manual.id,
    }),
  ).toEqual(applied.page);
});

it("returns the original Canvas rendering as a native Buzz image reply with saved-revision metadata", async () => {
  bind();
  const blank = await store.call("createDesign", {
    workspaceId: "workspace",
    title: "Visual inspection",
  });
  const frame = {
    ...createDesignNode("frame", randomUUID(), "Artboard"),
    width: 320,
    height: 200,
  };
  const saved = await store.call("saveDesign", {
    workspaceId: "workspace",
    document: { ...blank, nodes: [frame] },
  });
  const result = await bridge.canvasTool().call(agent, context, {
    operation: "viewDesign",
    input: {
      designId: saved.id,
      artboardId: frame.id,
      expectedRevision: saved.revision,
      maxWidth: 320,
    },
  });
  expect(result.type).toBe("image/png");
  expect(Buffer.from(result.data, "base64").subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(JSON.parse(result.text)).toMatchObject({
    design: { id: saved.id, revision: saved.revision },
    artboard: { id: frame.id },
    width: 320,
    height: 200,
  });
});

it("edits the same original page repository as manual editing and rejects a stale agent revision", async () => {
  bind();
  const page = JSON.parse(
    await tool.call(agent, context, {
      operation: "createPage",
      input: { title: "Shared work" },
    }),
  );
  const input = {
    workspaceId: "workspace",
    pageId: page.id,
    expectedRevision: page.revision,
    title: "Hero",
    templateId: "custom-html",
    label: "Original",
    html: "<section>Manual work</section>",
  };
  const manual = await store.call("addPageSection", input);
  await expect(
    tool.call(agent, context, {
      operation: "addPageSection",
      input: { ...input, title: "Agent work" },
    }),
  ).rejects.toThrow("Page changed in another editor");
  const saved = JSON.parse(
    await tool.call(agent, context, {
      operation: "readPage",
      input: { pageId: page.id },
    }),
  );
  expect(saved).toEqual(manual);
});

it("requires the explicitly bound native agent membership and conversation", async () => {
  bind();
  for (const [client, channel] of [
    [{ ...agent, key: "other-community:agent" }, context.channel],
    [{ ...agent, pubkey: "other-agent" }, context.channel],
    [agent, "another-dm"],
    [agent, undefined],
  ])
    await expect(
      tool.call(client, { channel }, { operation: "listPages" }),
    ).rejects.toThrow("Open this agent from the Page Builder");
  await expect(
    tool.call(agent, context, {
      operation: "listPages",
      input: { workspaceId: "another-workspace" },
    }),
  ).rejects.toThrow("Workspace differs");
  expect(
    JSON.parse(await tool.call(agent, context, { operation: "listPages" })),
  ).toEqual([]);
  bridge.clear();
  await expect(
    tool.call(agent, context, { operation: "listPages" }),
  ).rejects.toThrow("Open this agent from the Page Builder");
});

it("requires revisions before edits and refuses tools outside the published page operations", async () => {
  bind();
  await expect(
    tool.call(agent, context, { operation: "deletePageSection", input: {} }),
  ).rejects.toThrow("supply expectedRevision");
  await expect(
    tool.call(agent, context, {
      operation: "readExport",
      input: { path: "/private" },
    }),
  ).rejects.toThrow("Unknown page operation");
});

it("allows a bound Buzz agent to edit Canvas while preserving a newer manual revision", async () => {
  bind();
  const canvas = bridge.canvasTool();
  const created = JSON.parse(
    await canvas.call(agent, context, {
      operation: "createDesign",
      input: { title: "Shared canvas" },
    }),
  );
  const manual = await store.call("saveDesign", {
    workspaceId: "workspace",
    document: { ...created, title: "Manual title" },
  });
  await expect(
    canvas.call(agent, context, {
      operation: "editDesign",
      input: {
        designId: created.id,
        expectedRevision: created.revision,
        changes: {},
      },
    }),
  ).rejects.toThrow("Design changed in another editor");
  expect(
    JSON.parse(
      await canvas.call(agent, context, {
        operation: "readDesign",
        input: { designId: created.id },
      }),
    ),
  ).toEqual(manual);
});

it("revokes editor bindings when the native community changes and on plugin disposal", async () => {
  const tools = [];
  const listeners = new Set();
  let snapshot = { session: {}, scope: "community" };
  let dispose;
  bridge.install({
    agents: { addTool: (tool) => tools.push(tool) },
    relay: {
      snapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    effect: (effect) => {
      dispose = effect();
    },
  });
  bind();
  expect(tools.map((tool) => tool.name)).toEqual([
    "buzz_pages",
    "buzz_canvas",
    "buzz_docs",
    "buzz_brand",
  ]);
  snapshot = { ...snapshot, scope: "another-community" };
  for (const listener of listeners) listener();
  await expect(
    tool.call(agent, context, { operation: "listPages" }),
  ).rejects.toThrow("Open this agent");
  bind();
  dispose();
  expect(listeners.size).toBe(0);
  await expect(
    tool.call(agent, context, { operation: "listPages" }),
  ).rejects.toThrow("Open this agent");
});

it("keeps Docs agent changes reviewable and confines selection edits to the requested passage", async () => {
  const doc = await store.call("createDoc", {
    workspaceId: "workspace",
    title: "Review",
    sections: [],
  });
  const blockId = doc.blocks[0].id;
  const outlined = await store.call("outlineDoc", {
    workspaceId: "workspace",
    docId: doc.id,
    blockId,
    epoch: doc.epoch,
    sections: ["Opening"],
    sessionId: "fixture",
  });
  const saved = await store.call("writeDoc", {
    workspaceId: "workspace",
    docId: doc.id,
    blockId,
    epoch: outlined.epoch,
    content: "Original passage. Manual ending.",
    done: true,
  });
  bridge.bind({
    workspaceId: "workspace",
    agent: agent.pubkey,
    agentKey: agent.key,
    channel: context.channel,
    scope: "community",
    docs: {
      docId: doc.id,
      epoch: saved.epoch,
      context: "Refine the selected passage and preserve my ending.",
      scope: "selection",
      blockId,
      tabId: doc.id,
      selection: { start: 0, before: "Original passage." },
    },
  });
  const docs = bridge.docsTool();
  const current = JSON.parse(
    await docs.call(agent, context, { operation: "readDoc" }),
  );
  expect(current.request.context).toBe(
    "Refine the selected passage and preserve my ending.",
  );
  expect(current.request.selection).toEqual({
    start: 0,
    before: "Original passage.",
  });
  await expect(
    docs.call(agent, context, {
      operation: "applyDocEdit",
      input: {
        blockId,
        before: "Original passage.",
        after: "Changed.",
        start: 0,
      },
    }),
  ).rejects.toThrow("suggestions only");
  await expect(
    docs.call(agent, context, {
      operation: "suggestDoc",
      input: {
        blockId,
        before: "Manual ending.",
        after: "Overwritten.",
        start: 18,
        note: "",
      },
    }),
  ).rejects.toThrow("outside the requested passage");
  const proposal = JSON.parse(
    await docs.call(agent, context, {
      operation: "suggestDoc",
      input: {
        blockId,
        before: "Original passage.",
        after: "Refined passage.",
        start: 0,
        note: "Clearer",
      },
    }),
  );
  expect(proposal.blocks[0].content).toBe(saved.blocks[0].content);
  const accepted = await store.call("reviewDocSuggestion", {
    workspaceId: "workspace",
    docId: doc.id,
    suggestionId: proposal.suggestions[0].id,
    decision: "accept",
  });
  expect(accepted.blocks[0].content).toBe("Refined passage. Manual ending.");
  await expect(
    docs.call(agent, context, {
      operation: "readDoc",
      input: { docId: "another-document" },
    }),
  ).rejects.toThrow("Document differs");
});

it("carries a Docs drafting request through outline and writing epochs with native conversation attribution", async () => {
  const doc = await store.call("createDoc", {
    workspaceId: "workspace",
    title: "Draft",
    sections: [],
  });
  const blockId = doc.blocks[0].id;
  bridge.bind({
    workspaceId: "workspace",
    agent: agent.pubkey,
    agentKey: agent.key,
    channel: context.channel,
    scope: "community",
    docs: { docId: doc.id, epoch: doc.epoch, scope: "draft", blockId },
  });
  const docs = bridge.docsTool();
  const outlined = JSON.parse(
    await docs.call(agent, context, {
      operation: "outlineDoc",
      input: { blockId, sections: ["Opening", "Evidence"] },
    }),
  );
  expect(outlined.epoch).toBeGreaterThan(doc.epoch);
  const written = JSON.parse(
    await docs.call(agent, context, {
      operation: "writeDoc",
      input: {
        blockId,
        epoch: outlined.epoch,
        content: "Agent draft for review.",
        done: true,
      },
    }),
  );
  expect(written.blocks[0].content).toBe("Agent draft for review.");
  const history = await store.call("listDocHistory", {
    workspaceId: "workspace",
    docId: doc.id,
  });
  expect(
    history.entries.some(
      (entry) =>
        entry.actor === "assistant" && entry.sessionId === context.channel,
    ),
  ).toBe(true);
  bridge.endDocumentRequest(agent.key, context.channel);
  await expect(
    docs.call(agent, context, { operation: "readDoc", input: {} }),
  ).rejects.toThrow("Send a request from Docs");
});

it("lets an allowed agent create and draft a doc from any conversation, and refuses otherwise", async () => {
  const channel = { channel: "team-thread" };
  const allowed = new EditorAgentBridge(store, {
    targetFor: (caller) =>
      caller.key === agent.key
        ? { workspaceId: "workspace", scope: "community" }
        : undefined,
  });
  const docs = allowed.docsTool();
  await expect(
    bridge.docsTool().call(agent, channel, {
      operation: "createDoc",
      input: { title: "Plan", sections: ["Goal"] },
    }),
  ).rejects.toThrow("Agent doc creation is off");
  await expect(
    docs.call({ key: "other", pubkey: "other" }, channel, {
      operation: "createDoc",
      input: { title: "Plan", sections: ["Goal"] },
    }),
  ).rejects.toThrow("Agent doc creation is off");
  await expect(
    docs.call(
      agent,
      {},
      {
        operation: "createDoc",
        input: { title: "Plan", sections: ["Goal"] },
      },
    ),
  ).rejects.toThrow("Agent doc creation is off");
  await expect(
    docs.call(agent, channel, {
      operation: "createDoc",
      input: { title: "Plan", sections: [] },
    }),
  ).rejects.toThrow("at least one section");
  const created = JSON.parse(
    await docs.call(agent, channel, {
      operation: "createDoc",
      input: { title: "Demand gen plan", sections: ["Goal", "Funnel"] },
    }),
  );
  expect(created.title).toBe("Demand gen plan");
  expect(created.blocks.map((block) => block.label)).toEqual([
    "Goal",
    "Funnel",
  ]);
  const current = JSON.parse(
    await docs.call(agent, channel, { operation: "readDoc" }),
  );
  expect(current.request).toMatchObject({
    docId: created.id,
    scope: "draft",
    editMode: "apply",
  });
  const written = JSON.parse(
    await docs.call(agent, channel, {
      operation: "writeDoc",
      input: {
        blockId: created.blocks[0].id,
        epoch: created.epoch,
        content: "100 paid signups in 90 days.",
        done: true,
      },
    }),
  );
  expect(written.blocks[0].content).toContain("100 paid signups");
  await expect(
    docs.call(agent, channel, {
      operation: "readDoc",
      input: { docId: "another-document" },
    }),
  ).rejects.toThrow("Document differs");
  const listed = await store.call("listDocs", { workspaceId: "workspace" });
  expect(listed.some((doc) => doc.id === created.id)).toBe(true);
});

it("refuses agent doc creation into a different workspace than the conversation's editor binding", async () => {
  const elsewhere = new EditorAgentBridge(store, {
    targetFor: () => ({ workspaceId: "other-workspace", scope: "community" }),
  });
  elsewhere.bind({
    workspaceId: "workspace",
    agent: agent.pubkey,
    agentKey: agent.key,
    channel: context.channel,
    scope: "community",
  });
  await expect(
    elsewhere.docsTool().call(agent, context, {
      operation: "createDoc",
      input: { title: "Plan", sections: ["Goal"] },
    }),
  ).rejects.toThrow("another editor workspace");
});
