import type {
  DocsTransport,
  DocsModel,
  DocsAppActions,
} from "../../../../portable/copyos-apps/dist/types/copyos-apps/src/index";
import type { EditorStore } from "./pages-client";

/** Preserve the original Yjs transport, permissions, history, assets and review operations. */
export function docsTransport(store: EditorStore): DocsTransport {
  return {
    list: (workspaceId, trashed) =>
      store.call("listDocs", {
        workspaceId,
        ...(trashed === undefined ? {} : { trashed }),
      }),
    read: (input) => store.call("readDoc", input),
    create: (input) => store.call("createDoc", input),
    sync: (input) => store.call("syncDoc", input),
    control: (input) => store.call("controlDoc", input),
    share: (input) => store.call("shareDoc", input),
    export: (input) => store.call("exportDoc", input),
    review: (input) => store.call("reviewDocSuggestion", input),
    presence: (input) => store.call("presenceDoc", input),
    import: (input) => store.call("importDoc", input),
    putAsset: (input) => store.call("putDocAsset", input),
    readAsset: (input) => store.call("readDocAsset", input),
    comment: (input) => store.call("commentDoc", input),
    history: (input) => store.call("listDocHistory", input),
    version: (input) => store.call("readDocHistory", input),
    nameVersion: (input) => store.call("nameDocVersion", input),
    restore: (input) => store.call("restoreDocVersion", input),
    duplicate: (input) => store.call("duplicateDoc", input),
    trash: (input) => store.call("trashDoc", input),
  };
}

/** Bind the original model methods without replacing any editor workflow. */
export function docsActions(
  model: DocsModel,
): Omit<DocsAppActions, "draftDoc" | "stopAssistant"> {
  return {
    startDocs: model.start.bind(model),
    stopDocs: model.stop.bind(model),
    importDocFile: model.importFile.bind(model),
    uploadDocFiles: model.uploadFiles.bind(model),
    attachDocFiles: model.attachFiles.bind(model),
    resolveDocAsset: model.resolveAsset.bind(model),
    listDocHistory: model.history.bind(model),
    readDocHistory: model.version.bind(model),
    nameDocVersion: model.nameVersion.bind(model),
    restoreDocVersion: model.restore.bind(model),
    focusComment: model.focusComment.bind(model),
    commentDraft: model.commentDraft.bind(model),
    discardCommentDraft: model.discardCommentDraft.bind(model),
    recoverLegacyDoc: model.recoverLegacyDraft.bind(model),
    commentDoc: model.comment.bind(model),
    flushDocs: model.flush.bind(model),
    reviewDoc: model.review.bind(model),
    setDocCursor: model.setCursor.bind(model),
    anchorDocPassage: model.anchorPassage.bind(model),
    locateDocPassage: model.locatePassage.bind(model),
    editDoc: model.edit.bind(model),
    editDocPage: model.editPage.bind(model),
    captureDocEdit: model.captureEdit.bind(model),
    addDocBlock: model.add.bind(model),
    moveDocBlock: model.move.bind(model),
    undoDoc: model.undoLocal.bind(model),
    redoDoc: model.redoLocal.bind(model),
    duplicateDoc: model.duplicate.bind(model),
    trashDoc: model.trash.bind(model),
    refreshDocLibrary: model.refreshLibrary.bind(model),
    selectDoc: model.select.bind(model),
    selectDocTab: model.selectTab.bind(model),
    addDocTab: model.addTab.bind(model),
    renameDocTab: model.renameTab.bind(model),
    moveDocTab: model.moveTab.bind(model),
    createDoc: model.create.bind(model),
    controlDoc: model.control.bind(model),
    shareDoc: model.share.bind(model),
    exportDoc: model.export.bind(model),
  };
}
