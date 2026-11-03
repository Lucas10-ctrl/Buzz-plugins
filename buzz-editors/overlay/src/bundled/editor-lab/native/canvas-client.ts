import type { PageDesignerActions } from "../../../../portable/copyos-apps/dist/types/copyos-apps/src/index";
import type { EditorStore } from "./pages-client";

/** Original Canvas operations use the same repositories as agent edits. */
export function canvasActions(store: EditorStore): PageDesignerActions {
  return {
    generation: {
      settings: () => store.call("generationSettings", {}),
      credentialStatus: (ref) =>
        store.call("generationCredentialStatus", { ref }),
      setCredential: (ref, value) =>
        store.call("setGenerationCredential", { ref, value }),
      start: (input) => store.call("startGeneration", input),
      list: (workspaceId) => store.call("listGenerations", { workspaceId }),
      cancel: (input) => store.call("cancelGeneration", input),
      readImage: (input) => store.call("readGenerationImage", input),
    },
    listDesigns: (workspaceId) => store.call("listDesigns", { workspaceId }),
    createDesign: (input) => store.call("createDesign", input),
    saveDesign: (input) => store.call("saveDesign", input),
    importDesign: (input) => store.call("importDesign", input),
    decodeDesignClipboard: (input) =>
      store.call("decodeDesignClipboard", input),
    getStyleGuide: (workspaceId) =>
      store.call("getStyleGuide", { workspaceId }),
    previewDesignPage: (input) => store.call("previewDesignPage", input),
    buildDesignPage: (input) => store.call("buildDesignPage", input),
    reviewDesignPageUpdate: (input) =>
      store.call("reviewDesignPageUpdate", input),
    applyDesignPageUpdate: (input) =>
      store.call("applyDesignPageUpdate", input),
    getDesignFontMetadata: (input) =>
      store.call("getDesignFontMetadata", input),
    listDesignFonts: (input) => store.call("listDesignFonts", input),
    installDesignFonts: (input) => store.call("installDesignFonts", input),
    uploadDesignFont: (input) => store.call("uploadDesignFont", input),
    readDesignFont: (input) => store.call("readDesignFont", input),
    listDesignComments: (input) => store.call("listDesignComments", input),
    addDesignComment: (input) => store.call("addDesignComment", input),
    setDesignCommentStatus: (input) =>
      store.call("setDesignCommentStatus", input),
    deleteDesignComment: (input) => store.call("deleteDesignComment", input),
    listDesignTemplates: (input) => store.call("listDesignTemplates", input),
    saveDesignTemplate: (input) => store.call("saveDesignTemplate", input),
    readDesignTemplate: (input) => store.call("readDesignTemplate", input),
    deleteDesignTemplate: (input) => store.call("deleteDesignTemplate", input),
    putDesignImage: (input) => store.call("putDesignImage", input),
    copyDesignImages: (input) => store.call("copyDesignImages", input),
    findUnusedDesignImages: (input) =>
      store.call("findUnusedDesignImages", input),
    removeUnusedDesignImages: (input) =>
      store.call("removeUnusedDesignImages", input),
  };
}

/** Read only an original Canvas asset reference; the server resolves the scoped image store. */
export function canvasImageReader(store: EditorStore, workspaceId: string) {
  return async (path: string): Promise<Blob> => {
    if (!path.startsWith("assets/images/"))
      throw new Error("Canvas requested a non-image file");
    const file = await store.call<{ dataBase64: string; mimeType: string }>(
      "readDesignImage",
      {
        workspaceId,
        reference: `copyos-asset:${path.slice("assets/images/".length)}`,
      },
    );
    return new Blob(
      [Uint8Array.from(atob(file.dataBase64), (char) => char.charCodeAt(0))],
      { type: file.mimeType },
    );
  };
}
