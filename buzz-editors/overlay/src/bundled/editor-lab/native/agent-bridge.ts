import type { PluginModule } from "../../../plugins/api";
import type { AddedTool } from "../../../buzz-mcp/session-tools";
import type { EditorStore } from "./pages-client";
import { EditorComposerBridge } from "./editor-composer";
import { canvasWebsiteGuide } from "./canvas-website";
import { docLink } from "./docs-route";
import { readView } from "../../../shared/view-state";
import { editorWorkspaceId, editorWorkspaceKey } from "./workspace";

type Ctx = Parameters<PluginModule["apply"]>[0];
export type EditorDocPermission = Readonly<{
  docId: string;
  epoch: number;
  context?: string;
  scope:
    | "document"
    | "section"
    | "selection"
    | "comment"
    | "continue"
    | "draft";
  editMode?: "suggest" | "apply";
  tabId?: string;
  blockId?: string;
  threadId?: string;
  selection?: Readonly<{ before: string; start: number }>;
  selections?: readonly Readonly<{
    blockId: string;
    before: string;
    start: number;
  }>[];
}>;
export type EditorConversation = Readonly<{
  workspaceId: string;
  agent: string;
  agentKey: string;
  channel: string;
  scope: string;
  docs?: EditorDocPermission;
  pageWorkflow?: Readonly<{ requestId: string }>;
  canvasCopy?: Readonly<{ designId: string }>;
}>;
/** View key for the owner's "Let agents create docs" setting; off unless saved as true. */
export const agentDocCreationKey = "editor-lab:agent-doc-creation";
/** Where an agent may start a doc without an owner's Docs request. */
export type EditorDocCreation = Readonly<{
  /** The editor workspace a new doc goes into; undefined refuses creation. */
  targetFor(
    agent: Readonly<{ key: string; pubkey: string }>,
  ): Readonly<{ workspaceId: string; scope: string }> | undefined;
}>;
/** A saved main-result page; this does not mean the agent has finished building it. */
export type EditorCreatedPage = Readonly<{ pageId: string; title: string }>;
const operations = [
  "getWorkspace",
  "prepareWorkflow",
  "validateShopifyExport",
  "listPages",
  "readPage",
  "createPage",
  "addPageSection",
  "addPageSectionVariant",
  "selectPageSectionVariant",
  "updatePageSectionVariant",
  "updatePageSectionVariants",
  "renamePageSection",
  "deletePageSection",
  "movePageSection",
  "addPageComment",
  "setPageCommentStatus",
  "listReusableSections",
  "saveReusableSection",
  "moveReusableSection",
  "deleteReusableSection",
  "exportPage",
] as const;

/** Binds agent tool access to the editor conversation the owner explicitly opened. */
export class EditorAgentBridge {
  readonly composer = new EditorComposerBridge();
  private readonly bindings = new Map<string, EditorConversation>();
  private readonly pageListeners = new Map<
    string,
    Set<(page: EditorCreatedPage) => void>
  >();
  constructor(
    private readonly store: EditorStore,
    private docCreation?: EditorDocCreation,
  ) {}
  bind(conversation: EditorConversation) {
    this.bindings.set(
      `${conversation.agentKey}:${conversation.channel}`,
      conversation,
    );
  }
  /** Prevent an in-flight turn from being redirected into another Solo workspace. */
  workspaceFor(agentKey: string, channel: string) {
    return this.bindings.get(`${agentKey}:${channel}`)?.workspaceId;
  }
  brandTool(): AddedTool {
    const allowed = ["readBrandContext", "createBrand", "saveStyleGuide"];
    return {
      name: "buzz_brand",
      description:
        "Read the active Solo workspace's original CopyOS brand profiles and website styleguide before branded work in Page Builder, Canvas or Docs. readBrandContext returns brands, guide and guideRevision. createBrand takes title, positioning, audience, voice, differentiators and guardrails (empty string allowed). saveStyleGuide takes name, css, sourceType:css|file|website, sourceLabel, optional sourceUrl and expectedRevision: the exact guideRevision from readBrandContext (null only if no guide exists). Propose changes before replacing an existing styleguide. Never apply imported CSS to Buzz. workspaceId is supplied by the owner's editor conversation; other workspaces are unavailable.",
      inputSchema: {
        type: "object",
        properties: {
          operation: { type: "string", enum: allowed },
          input: { type: "object", additionalProperties: true },
        },
        required: ["operation"],
        additionalProperties: false,
      },
      call: async (client, context, args) => {
        const binding = context.channel
          ? this.bindings.get(`${client.key}:${context.channel}`)
          : undefined;
        if (!binding || binding.agent !== client.pubkey)
          throw new Error(
            "Open this agent from an editor before using workspace branding",
          );
        if (
          typeof args.operation !== "string" ||
          !allowed.includes(args.operation)
        )
          throw new Error("Unknown brand operation");
        const input = args.input ?? {};
        if (typeof input !== "object" || Array.isArray(input))
          throw new Error("input must be an object");
        if ("workspaceId" in input && input.workspaceId !== binding.workspaceId)
          throw new Error("Workspace differs from this editor conversation");
        return JSON.stringify(
          await this.store.call(args.operation, {
            ...input,
            workspaceId: binding.workspaceId,
          }),
        );
      },
    };
  }
  clear() {
    this.bindings.clear();
    this.pageListeners.clear();
    this.composer.clear();
  }
  /** Observe the page created for one explicit workflow, until its owning view disposes.
   * @param requestId - The request reference placed in the owner's workflow message.
   * @param listener - Receives committed page identity/title, never a completion claim.
   * @returns Disposes only this observer.
   */
  onPageCreated(
    requestId: string,
    listener: (page: EditorCreatedPage) => void,
  ): () => void {
    const listeners = this.pageListeners.get(requestId) ?? new Set();
    listeners.add(listener);
    this.pageListeners.set(requestId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size && this.pageListeners.get(requestId) === listeners)
        this.pageListeners.delete(requestId);
    };
  }
  endDocumentRequest(agentKey: string, channel: string) {
    const key = `${agentKey}:${channel}`;
    const current = this.bindings.get(key);
    if (current) {
      const { docs: _, ...binding } = current;
      this.bindings.set(key, binding);
    }
  }
  /** Revoke a result handoff without rolling back an accepted repository write.
   * @param agentKey - The selected Buzz agent's local registration key.
   * @param channel - Its bound editor conversation.
   */
  endPageWorkflow(agentKey: string, channel: string) {
    const key = `${agentKey}:${channel}`;
    const current = this.bindings.get(key);
    if (current?.pageWorkflow) {
      this.pageListeners.delete(current.pageWorkflow.requestId);
      const { pageWorkflow: _, ...binding } = current;
      this.bindings.set(key, binding);
    }
  }
  /** End comparison reads for a stopped structured Canvas request; accepted copies are not rolled back.
   * @param agentKey - The selected Buzz agent's local registration key.
   * @param channel - Its bound editor conversation.
   */
  endCanvasCopyRequest(agentKey: string, channel: string) {
    const key = `${agentKey}:${channel}`;
    const current = this.bindings.get(key);
    if (current?.canvasCopy) {
      const { canvasCopy: _, ...binding } = current;
      this.bindings.set(key, binding);
    }
  }
  tool(): AddedTool {
    return {
      name: "buzz_pages",
      description:
        "Use buzz_brand readBrandContext before branded work. Read and edit the original Page Builder in the owner's editor conversation. Use listPages then readPage to obtain IDs and revisions. Mutating an existing page requires its latest expectedRevision; creation and shared-library operations do not take a page revision. Reusable sections are independent copies in the owner's shared library across Buzz workspaces. updatePageSectionVariant changes one existing section; updatePageSectionVariants applies changes atomically. HTML remains editable in the visual builder. Never replace unrelated sections. Available operations: " +
        operations.join(", ") +
        ". When a workflow message supplies workflowRequestId, pass that exact field to createPage for its main result page so the owner can open it. It identifies the workflow, not an idempotency guarantee. Omit it for unrelated page creation. getWorkspace returns this conversation's isolated projectRoot; resolve existing-page subfolders there. prepareWorkflow requires workflow:copyos-web-clone|shopify-section-export and returns the retained original guide/scripts in the isolated projectRoot; follow its exact paths and limitations using your normal Buzz execution and approval tools. validateShopifyExport requires directory:exports/<export-folder> and checks generated schema/template files without uploading; mode defaults to page (or section). Errors are paged: offset defaults to 0, limit to 50 (max 100); use nextOffset to retrieve the rest. input fields for page operations: pageId; sectionId; variantId; expectedRevision; title; label; templateId; html; toIndex; changes:[{sectionId,variantId,html}]; commentId,status; elementIndex,elementLabel,body; category,description; confirmDelete; format:html|json|copy|shopify|vercel. workspaceId comes from the editor conversation.",
      inputSchema: {
        type: "object",
        properties: {
          operation: { type: "string", enum: operations },
          input: { type: ["object", "null"], additionalProperties: true },
        },
        required: ["operation"],
        additionalProperties: false,
      },
      call: async (client, context, args) => {
        const binding = context.channel
          ? this.bindings.get(`${client.key}:${context.channel}`)
          : undefined;
        if (!binding || binding.agent !== client.pubkey)
          throw new Error(
            "Open this agent from the Page Builder before using its editor tools",
          );
        if (
          typeof args.operation !== "string" ||
          !operations.some((value) => value === args.operation)
        )
          throw new Error("Unknown page operation");
        const input = args.input;
        if (
          input !== undefined &&
          input !== null &&
          (typeof input !== "object" || Array.isArray(input))
        )
          throw new Error("input must be an object");
        const fields = input && typeof input === "object" ? input : {};
        const { workflowRequestId, ...parameters } =
          "workflowRequestId" in fields
            ? fields
            : { ...fields, workflowRequestId: undefined };
        if (
          workflowRequestId !== undefined &&
          (args.operation !== "createPage" ||
            typeof workflowRequestId !== "string" ||
            workflowRequestId !== binding.pageWorkflow?.requestId)
        )
          throw new Error(
            "Page workflow request differs from this editor conversation",
          );
        if (
          "workspaceId" in fields &&
          fields.workspaceId !== binding.workspaceId
        )
          throw new Error("Workspace differs from this editor conversation");
        if (
          ![
            "getWorkspace",
            "prepareWorkflow",
            "validateShopifyExport",
            "listPages",
            "readPage",
            "createPage",
            "listReusableSections",
            "saveReusableSection",
            "moveReusableSection",
            "deleteReusableSection",
            "exportPage",
          ].includes(args.operation) &&
          (!("expectedRevision" in fields) ||
            !Number.isSafeInteger(fields.expectedRevision))
        )
          throw new Error(
            "Read the page and supply expectedRevision before editing",
          );
        const payload =
          args.operation === "listPages" ||
          args.operation === "listReusableSections"
            ? binding.workspaceId
            : { ...parameters, workspaceId: binding.workspaceId };
        const operation =
          args.operation === "prepareWorkflow"
            ? "preparePageWorkflow"
            : args.operation === "getWorkspace"
              ? "getPageWorkspace"
              : args.operation;
        if (args.operation === "createPage") {
          const result = await this.store.call<{ id: string; title: string }>(
            operation,
            payload,
          );
          if (
            typeof workflowRequestId === "string" &&
            this.bindings.get(`${client.key}:${context.channel}`) === binding
          ) {
            for (const listener of [
              ...(this.pageListeners.get(workflowRequestId) ?? []),
            ]) {
              try {
                listener({ pageId: result.id, title: result.title });
              } catch (error) {
                console.warn(
                  "Page creation observer failed after the page was saved",
                  error,
                );
              }
            }
          }
          return JSON.stringify(result);
        }
        return JSON.stringify(await this.store.call(operation, payload));
      },
    };
  }
  canvasTool(): AddedTool {
    const allowed = [
      "listDesigns",
      "readDesign",
      "createDesign",
      "editDesign",
      "listDesignComments",
      "addDesignComment",
      "setDesignCommentStatus",
      "listDesignTemplates",
      "readDesignTemplate",
      "viewDesign",
      "inspectDesign",
      "getStyleGuide",
      "previewDesignPage",
      "buildDesignPage",
      "reviewDesignPageUpdate",
      "applyDesignPageUpdate",
      "readWorkflowGuide",
      "listCopy",
      "readCopy",
      "createCopy",
      "listWorkspaces",
      "listComparableDesigns",
      "insertDesignTemplate",
      "copyComparableImages",
    ];
    return {
      name: "buzz_canvas",
      description:
        "Build from copy can read the selected copy with readCopy (copyId); listCopy reports assets/invalid, and createCopy takes title,label,body. Use the saved selectedVariantId body verbatim. Only the owner’s structured Build from copy request enables listWorkspaces and listComparableDesigns. Their offset/limit pages return nextOffset; use the opaque workspaceRef for read-only readDesign/inspectDesign/viewDesign/getStyleGuide comparisons. copyComparableImages takes workspaceRef and urls and copies original image references into the current workspace without editing the source. insertDesignTemplate takes designId,templateId,expectedRevision,optional pageId; it uses the original clipboard importer, preserving manual artboards, styles, variables, components and embedded images. Its result contains document,selectedIds. " +
        "inspectDesign is the original byte-bounded inspector: designId plus section (overview, layers, authored-layers, children, design-system, semantics-structure, fills, text-runs, field), optional owner_id, node_ids_json, instance_path_json, query, revision, limit (1..100), max_bytes (16384..65536), cursor, field_ref and original resource selectors. Follow next_cursor with identical selectors; retrieve record_ref/field_refs through section:field. Prefer this over the explicitly unbounded readDesign for large scenes. " +
        "Use buzz_brand readBrandContext before branded work. Read and edit the original Canvas in the owner's editor conversation. readWorkflowGuide takes guide:canvas-to-website and returns the complete building workflow. listDesigns returns saved designs; readDesign takes designId and returns nodes, variables and revision. editDesign takes designId, expectedRevision and changes using the original Canvas batch format (upsertNodes, deleteNodeIds, variables). viewDesign returns a PNG for image-capable agents: designId, optional artboardId, expectedRevision, top, height (up to 2400 CSS px), maxWidth (320..2000). Its notes identify font substitutions and missing images. getStyleGuide reads workspace branding. previewDesignPage takes designId,nodeId,expectedRevision; buildDesignPage takes those plus its reviewed previewHash. For linked updates use reviewDesignPageUpdate then applyDesignPageUpdate with expectedPageRevision, previewHash and the reviewed resolution/resolutions. Conversion is a starting point; use buzz_pages to finish and verify the saved website. Preserve unrelated manual work. createDesign takes title. Comment/template operations use designId/commentId/templateId and their original fields. workspaceId is supplied by the conversation.",
      inputSchema: {
        type: "object",
        properties: {
          operation: { type: "string", enum: allowed },
          input: { type: "object", additionalProperties: true },
        },
        required: ["operation"],
        additionalProperties: false,
      },
      call: async (client, context, args) => {
        const binding = context.channel
          ? this.bindings.get(`${client.key}:${context.channel}`)
          : undefined;
        if (!binding || binding.agent !== client.pubkey)
          throw new Error(
            "Open this agent from Canvas before using its editor tools",
          );
        if (
          typeof args.operation !== "string" ||
          !allowed.includes(args.operation)
        )
          throw new Error("Unknown Canvas operation");
        const input = args.input ?? {};
        if (typeof input !== "object" || Array.isArray(input))
          throw new Error("input must be an object");
        if ("workspaceId" in input && input.workspaceId !== binding.workspaceId)
          throw new Error("Workspace differs from this editor conversation");
        if (
          (args.operation === "listWorkspaces" ||
            args.operation === "listComparableDesigns" ||
            "workspaceRef" in input) &&
          !binding.canvasCopy
        )
          throw new Error(
            "Start Build from copy before reading comparison workspaces",
          );
        if (args.operation === "readWorkflowGuide") {
          if (
            !("guide" in input) ||
            input.guide !== "canvas-to-website" ||
            Object.keys(input).some(
              (key) => key !== "guide" && key !== "workspaceId",
            )
          )
            throw new Error("Unknown Canvas workflow guide");
          return canvasWebsiteGuide();
        }
        if (args.operation === "viewDesign") {
          const { dataBase64, ...metadata } = await this.store.call<
            { dataBase64: string } & Record<string, unknown>
          >(args.operation, { ...input, workspaceId: binding.workspaceId });
          return {
            data: dataBase64,
            type: "image/png",
            text: JSON.stringify(metadata),
          };
        }
        if (args.operation === "inspectDesign")
          return JSON.stringify(
            await this.store.call(args.operation, {
              ...input,
              workspaceId: binding.workspaceId,
            }),
            null,
            2,
          );
        return JSON.stringify(
          await this.store.call(
            (
              {
                listCopy: "listCopyAssets",
                readCopy: "readCopyAsset",
                createCopy: "createCopyAsset",
                listWorkspaces: "listCanvasWorkspaces",
              } as Record<string, string>
            )[args.operation] ?? args.operation,
            {
              ...input,
              workspaceId: binding.workspaceId,
            },
          ),
        );
      },
    };
  }
  docsTool(): AddedTool {
    const allowed = [
      "createDoc",
      "listDocs",
      "readDoc",
      "suggestDoc",
      "applyDocEdit",
      "outlineDoc",
      "writeDoc",
      "appendDocSections",
      "createDocTab",
      "replyDocComment",
      "listDocHistory",
      "readDocHistory",
    ];
    return {
      name: "buzz_docs",
      description:
        "Use buzz_brand readBrandContext for workspace voice, guardrails and style guidance. " +
        "createDoc takes title,sections:[headings] (at least one) and starts a new doc in the owner's selected Docs workspace when the owner has turned on agent doc creation. It binds that doc to this conversation for drafting: follow it with writeDoc per section (blockId from its blocks, its epoch, done:true) and share the returned link. " +
        "Collaborate in the original Docs workspace. The owner's request binds the document, writing epoch and edit mode. readDoc returns the bound document, including blocks, tabs, epoch, revision, comments, suggestions and request (the owner’s exact context, selection and mode). Read it first. suggestDoc takes blockId,before,after,note,start (exact Markdown offset); it leaves content untouched for user review. applyDocEdit takes blockId,before,after,start and is allowed only for explicit apply requests. For a draft request, outlineDoc takes blockId,sections:[headings], optional title:{before,after}; read the returned new epoch before writeDoc. writeDoc takes blockId,epoch,content (append chunk),done and optional failed. appendDocSections takes epoch,sections; createDocTab takes title,sections,epoch. replyDocComment takes threadId,requestId,text. History reads take docId and optional before/revision. Workspace and Session attribution come from Buzz. Read before acting; preserve unrelated text.",
      inputSchema: {
        type: "object",
        properties: {
          operation: { type: "string", enum: allowed },
          input: { type: "object", additionalProperties: true },
        },
        required: ["operation"],
        additionalProperties: false,
      },
      call: async (client, context, args) => {
        if (args.operation === "createDoc")
          return this.createDoc(client, context.channel, args.input);
        const binding = context.channel
          ? this.bindings.get(`${client.key}:${context.channel}`)
          : undefined;
        const permission = binding?.docs;
        if (!binding || binding.agent !== client.pubkey || !permission)
          throw new Error(
            "Send a request from Docs before using its document tools",
          );
        if (
          typeof args.operation !== "string" ||
          !allowed.includes(args.operation)
        )
          throw new Error("Unknown Docs operation");
        const fields = args.input ?? {};
        if (typeof fields !== "object" || Array.isArray(fields))
          throw new Error("input must be an object");
        if (
          "workspaceId" in fields &&
          fields.workspaceId !== binding.workspaceId
        )
          throw new Error("Workspace differs from this editor conversation");
        if ("docId" in fields && fields.docId !== permission.docId)
          throw new Error("Document differs from the owner's request");
        const threadOperation =
          args.operation === "replyDocComment" ||
          args.operation === "suggestDoc";
        if (
          permission.threadId &&
          threadOperation &&
          "threadId" in fields &&
          fields.threadId !== permission.threadId
        )
          throw new Error("Comment thread differs from the owner's request");
        const input = {
          ...fields,
          ...(permission.threadId && threadOperation
            ? { threadId: permission.threadId }
            : {}),
          workspaceId: binding.workspaceId,
          docId: permission.docId,
        };
        if (args.operation === "readDoc") {
          const document = await this.store.call<Record<string, unknown>>(
            "readDoc",
            { workspaceId: binding.workspaceId, docId: permission.docId },
          );
          return JSON.stringify({ ...document, request: permission });
        }
        if (args.operation === "listDocs")
          return JSON.stringify([
            await this.store.call("readDoc", {
              workspaceId: binding.workspaceId,
              docId: permission.docId,
            }),
          ]);
        const mutable = ![
          "readDoc",
          "listDocHistory",
          "readDocHistory",
        ].includes(args.operation);
        if (mutable && ("token" in fields || "sessionId" in fields))
          throw new Error("Document authority and attribution come from Buzz");
        if (
          args.operation === "applyDocEdit" &&
          permission.editMode !== "apply"
        )
          throw new Error(
            "This request permits suggestions only; use suggestDoc for review",
          );
        if (
          [
            "outlineDoc",
            "writeDoc",
            "appendDocSections",
            "createDocTab",
          ].includes(args.operation) &&
          !["draft", "continue"].includes(permission.scope)
        )
          throw new Error("This request does not authorize document drafting");
        if (["applyDocEdit", "suggestDoc"].includes(args.operation)) {
          if (
            permission.blockId &&
            permission.scope !== "document" &&
            "blockId" in fields &&
            fields.blockId !== permission.blockId &&
            !permission.selections?.some(
              (part) => part.blockId === fields.blockId,
            )
          )
            throw new Error("Section differs from the owner's request");
          const selected =
            permission.selections?.find(
              (part) => "blockId" in fields && part.blockId === fields.blockId,
            ) ?? permission.selection;
          if (permission.scope === "selection") {
            if (
              !selected ||
              !("start" in fields) ||
              typeof fields.start !== "number" ||
              !("before" in fields) ||
              typeof fields.before !== "string" ||
              fields.start < selected.start ||
              fields.start + fields.before.length >
                selected.start + selected.before.length ||
              selected.before.slice(
                fields.start - selected.start,
                fields.start - selected.start + fields.before.length,
              ) !== fields.before
            )
              throw new Error(
                "Edit is outside the requested passage; ask the owner for a new selection",
              );
          }
        }
        if (
          [
            "outlineDoc",
            "writeDoc",
            "appendDocSections",
            "createDocTab",
            "applyDocEdit",
          ].includes(args.operation) &&
          "epoch" in fields &&
          fields.epoch !== permission.epoch
        )
          throw new Error(
            "Writing epoch differs from the owner's request; send a new request",
          );
        if (args.operation === "outlineDoc") {
          const document = await this.store.call<{ epoch: number }>(
            args.operation,
            { ...input, epoch: permission.epoch, sessionId: binding.channel },
          );
          const key = `${client.key}:${context.channel}`;
          if (this.bindings.get(key) === binding)
            this.bindings.set(key, {
              ...binding,
              docs: { ...permission, epoch: document.epoch },
            });
          return JSON.stringify(document);
        }
        if (
          args.operation === "applyDocEdit" ||
          args.operation === "appendDocSections"
        )
          return JSON.stringify(
            await this.store.call(args.operation, {
              ...input,
              epoch: permission.epoch,
              sessionId: binding.channel,
              ...(args.operation === "applyDocEdit" && permission.tabId
                ? { tabId: permission.tabId }
                : {}),
            }),
          );
        if (args.operation === "replyDocComment")
          return JSON.stringify(
            await this.store.call(args.operation, {
              ...input,
              sessionId: binding.channel,
            }),
          );
        if (args.operation === "writeDoc" || args.operation === "createDocTab")
          return JSON.stringify(
            await this.store.call(args.operation, {
              ...input,
              epoch: permission.epoch,
            }),
          );
        if (args.operation === "suggestDoc")
          return JSON.stringify(
            await this.store.call(args.operation, {
              ...input,
              expectedEpoch: permission.epoch,
              ...(permission.tabId ? { expectedTabId: permission.tabId } : {}),
            }),
          );
        return JSON.stringify(await this.store.call(args.operation, input));
      },
    };
  }
  /** Start a doc for an agent the owner allowed, then bind it to this conversation for drafting. */
  private async createDoc(
    client: Readonly<{ key: string; pubkey: string }>,
    channel: string | undefined,
    fields: unknown,
  ) {
    const target = channel ? this.docCreation?.targetFor(client) : undefined;
    if (!channel || !target)
      throw new Error(
        "Agent doc creation is off. The owner can turn on “Let agents create docs” in Settings → Agent docs, or send a request from Docs.",
      );
    if (typeof fields !== "object" || fields === null || Array.isArray(fields))
      throw new Error("input must be an object");
    const input = fields as Record<string, unknown>;
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const sections = Array.isArray(input.sections) ? input.sections : [];
    if (!title) throw new Error("createDoc needs a title");
    if (
      !sections.length ||
      !sections.every(
        (section) => typeof section === "string" && section.trim(),
      )
    )
      throw new Error("createDoc needs at least one section heading");
    const key = `${client.key}:${channel}`;
    const existing = this.bindings.get(key);
    if (existing && existing.workspaceId !== target.workspaceId)
      throw new Error(
        "This conversation is working in another editor workspace; switch Docs to it or start a new conversation.",
      );
    const doc = await this.store.call<{ id: string; epoch: number }>(
      "createDoc",
      { workspaceId: target.workspaceId, title, sections, sessionId: channel },
    );
    this.bindings.set(key, {
      ...(existing ?? {
        workspaceId: target.workspaceId,
        agent: client.pubkey,
        agentKey: client.key,
        channel,
        scope: target.scope,
      }),
      docs: {
        docId: doc.id,
        epoch: doc.epoch,
        scope: "draft",
        editMode: "apply",
        context: "A doc this agent created at the owner's request.",
      },
    });
    const link =
      typeof location === "undefined"
        ? undefined
        : docLink({
            workspaceId: target.workspaceId,
            docId: doc.id,
            tabId: null,
            threadId: null,
            passage: null,
            token: undefined,
          });
    return JSON.stringify(link ? { ...doc, link } : doc);
  }
  install(ctx: Ctx) {
    this.docCreation ??= {
      targetFor: (agent) => {
        const { scope } = ctx.relay.snapshot();
        if (!scope || ctx.agents.find(agent.pubkey)?.key !== agent.key)
          return undefined;
        if (readView<unknown>(scope, agentDocCreationKey, false) !== true)
          return undefined;
        const selected = readView<unknown>(scope, editorWorkspaceKey, "");
        return {
          scope,
          workspaceId: editorWorkspaceId(
            scope,
            typeof selected === "string" ? selected : "",
          ),
        };
      },
    };
    ctx.agents.addTool(this.tool());
    ctx.agents.addTool(this.canvasTool());
    ctx.agents.addTool(this.docsTool());
    ctx.agents.addTool(this.brandTool());
    ctx.effect(() => {
      let current = ctx.relay.snapshot();
      const unsubscribe = ctx.relay.subscribe(() => {
        const next = ctx.relay.snapshot();
        if (next.session !== current.session || next.scope !== current.scope)
          this.clear();
        current = next;
      });
      return () => {
        unsubscribe();
        this.clear();
      };
    });
  }
}
